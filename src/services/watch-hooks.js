// @ts-check
// A watcher's address, kept (the plan of 11-11, its v2-b): for each webhook watcher that is on, its token — the random
// part of `/watch/<token>`, 128 bits — by its project and its id, in `<dataDir>/watch-hooks.json`, written for its
// owner alone; with it, where the watcher takes signed posts alone, its signing secret, sealed with the installation's
// secret.key as other secrets are unless `server.encryptSecrets` is off, and whether the person was shown it. Kept
// here and never in the Space's document: that goes to the page, to other machines' feeds and into copies of the
// project, and an agent that read its watcher's address there could wake itself. Which watcher has one is its
// source's to say (app/watchers/webhook.js): made at its Switch on (`ensure`), another on the person's word (`renew`),
// none once it is changed, switched off or removed (`drop`). A token is found by comparing every one kept, each in
// the same time (`find`).
// Beside the file, the bodies of the posts that wait for a wake: `<dataDir>/watch-hooks/<project>/<watcher>/<post>.json`,
// each its moment, content type, kept headers and body — `keep` at most for a watcher, the oldest going —, by the id
// Filament gave the post (`newPost`: its moment, then 64 random bits), which its event carries. They go with the
// watcher, and one by one as its source says (`dropPosts`). The cost of keeping them as files: a post's body is read
// by whoever reads this folder, as the Space's own files are.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WATCH_LIMITS } from "../core/watchers.js";
import { isSealed, loadKey, open, seal } from "./config/secrets.js";

export const WATCH_HOOKS_FILE = "watch-hooks.json";
export const WATCH_HOOKS_DIR = "watch-hooks";

/**
 * @typedef {{ token: string, at: number, onAt: number, secret?: string, shown?: true }} WatchAddress
 *   a watcher's address: its token, when it was made, the Switch on it was made for (the watcher's `onAt`), and for one
 *   that takes signed posts its secret — open, in memory — and whether the person was shown it
 * @typedef {{ at: number, type: string, headers: Record<string, string>, body: string }} KeptPost
 *   a post as kept: when it came, its content type, its headers that name no secret, its body as text
 * @typedef {ReturnType<typeof createWatchHooks>} WatchHooks
 */

/** A new token: 128 random bits, in hex. */
const newToken = () => randomBytes(16).toString("hex");
/** A new signing secret: 256 random bits, in hex. */
const newSecret = () => randomBytes(32).toString("hex");
/** @param {unknown} s */
const digest = (s) => createHash("sha256").update(String(s ?? "")).digest();
/**
 * Whether a token given is this one, in the same time whatever it is and however long: each is hashed, and the two
 * hashes compared whole. @param {string} kept @param {unknown} given
 */
const sameToken = (kept, given) => timingSafeEqual(digest(kept), digest(given));
/** A post's id: its moment in base 36, nine digits, then 64 random bits in hex — so its files sort by when they came. */
const POST_ID = /^([0-9a-z]{9})-[0-9a-f]{16}$/;
/** Posts in the order they came. @param {{ id: string, at: number }} a @param {{ id: string, at: number }} b */
const byMoment = (a, b) => a.at - b.at || a.id.localeCompare(b.id);
/** A project's or a watcher's id as a folder's name: itself where it is plain, else a hash of it. @param {string} name */
const folderOf = (name) => (/^[A-Za-z0-9_-]{1,80}$/.test(name) ? name : `h${digest(name).toString("hex").slice(0, 32)}`);

/**
 * @param {{ dataDir: string | null, encrypt?: () => boolean, now?: () => number, log?: (level: string, msg: string) => void,
 *   same?: (kept: string, given: unknown) => boolean, keep?: number }} o
 *   `dataDir`: where the file and the bodies are (none: kept in memory alone, for the tests); `encrypt`: whether secrets
 *   are sealed on disk now (`server.encryptSecrets`); `same`: how a token is compared (the tests' count); `keep`: the
 *   bodies kept for a watcher, as many as the events that wait for one
 */
export function createWatchHooks({ dataDir, encrypt = () => true, now = Date.now, log = () => {}, same = sameToken, keep = WATCH_LIMITS.events }) {
  const file = dataDir ? join(dataDir, WATCH_HOOKS_FILE) : null;
  const root = dataDir ? join(dataDir, WATCH_HOOKS_DIR) : null;
  /** Each watcher's address, by its project, then its id. @type {Map<string, Map<string, WatchAddress>>} */
  const addresses = new Map();
  /** Each watcher's posts kept, oldest first, by its folder (`dirKey`). @type {Map<string, { id: string, at: number }[]>} */
  const posts = new Map();
  /** The folder each post is kept in, by its id. @type {Map<string, string>} */
  const where = new Map();
  /** The posts themselves where no folder holds them (`dataDir` none). @type {Map<string, KeptPost>} */
  const held = new Map();

  /** @param {string} project @param {string} id */
  const dirKey = (project, id) => `${folderOf(project)}/${folderOf(id)}`;
  /** @param {string} key  a watcher's folder, by its key */
  const dirOf = (key) => join(/** @type {string} */ (root), ...key.split("/"));

  if (file)
    try {
      const raw = JSON.parse(readFileSync(file, "utf8"));
      const key = loadKey(/** @type {string} */ (dataDir), { create: false });
      let lost = 0;
      for (const [project, watchers] of Object.entries(raw?.watchers || {})) {
        /** @type {Map<string, WatchAddress>} */
        const m = new Map();
        for (const [id, rec] of Object.entries(/** @type {Record<string, any>} */ (watchers || {}))) {
          if (typeof rec?.token !== "string" || !/^[0-9a-f]{32}$/.test(rec.token)) continue;
          /** @type {WatchAddress} */
          const a = { token: rec.token, at: Number(rec.at) || 0, onAt: Number(rec.onAt) || 0 };
          if (typeof rec.secret === "string")
            try {
              if (isSealed(rec.secret) && !key) throw new Error("no secret.key");
              a.secret = isSealed(rec.secret) ? open(rec.secret, /** @type {Buffer} */ (key)) : rec.secret;
              if (rec.shown === true) a.shown = true;
            } catch {
              lost += 1;
              continue;
            }
          m.set(id, a);
        }
        if (m.size) addresses.set(project, m);
      }
      if (lost) log("warn", `watch hooks: ${lost} signing ${lost === 1 ? "secret" : "secrets"} could not be opened (sealed with another secret.key?): ${lost === 1 ? "that watcher gets" : "those watchers get"} a new address`);
    } catch (/** @type {any} */ e) {
      if (e?.code !== "ENOENT") log("warn", `watch hooks: ${WATCH_HOOKS_FILE} could not be read (${e?.message || e}); every watcher a program posts to gets a new address`);
    }

  // The bodies a stop left: found again by their folders and names. A folder of a watcher that has no address — its
  // address dropped as Filament stopped — goes.
  if (root) {
    const live = new Set([...addresses].flatMap(([project, m]) => [...m.keys()].map((id) => dirKey(project, id))));
    /** @param {string} dir */
    const names = (dir) => {
      try {
        return readdirSync(dir, { withFileTypes: true });
      } catch {
        return [];
      }
    };
    for (const p of names(root).filter((e) => e.isDirectory()))
      for (const w of names(join(root, p.name)).filter((e) => e.isDirectory())) {
        const key = `${p.name}/${w.name}`;
        if (!live.has(key)) {
          rmSync(dirOf(key), { recursive: true, force: true });
          continue;
        }
        /** @type {{ id: string, at: number }[]} */
        const list = [];
        for (const e of names(dirOf(key))) {
          const m = e.isFile() && e.name.endsWith(".json") ? POST_ID.exec(e.name.slice(0, -5)) : null;
          if (m) list.push({ id: m[0], at: parseInt(m[1], 36) });
        }
        list.sort(byMoment);
        if (list.length) posts.set(key, list);
        for (const post of list) where.set(post.id, key);
      }
  }

  /** Every address written, secrets sealed where secrets are sealed; a write the disk refuses throws, and changes nothing. */
  const save = () => {
    if (!file || !dataDir) return;
    mkdirSync(dataDir, { recursive: true });
    const key = encrypt() && [...addresses.values()].some((m) => [...m.values()].some((a) => a.secret !== undefined)) ? loadKey(dataDir) : null;
    const body = {
      version: 1,
      watchers: Object.fromEntries([...addresses].map(([project, m]) => [project, Object.fromEntries([...m].map(([id, a]) => [id, { ...a, ...(a.secret !== undefined ? { secret: key ? seal(a.secret, key) : a.secret } : {}) }]))])),
    };
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(body, null, 2), { mode: 0o600 });
      renameSync(tmp, file);
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }
  };
  /** A watcher's address replaced, or taken out, then written; the disk refusing it puts it back. @param {string} project @param {string} id @param {WatchAddress | null} next */
  const put = (project, id, next) => {
    const before = addresses.get(project)?.get(id) ?? null;
    /** @param {WatchAddress | null} a */
    const set = (a) => {
      const m = addresses.get(project) || new Map();
      if (a) m.set(id, a);
      else m.delete(id);
      if (m.size) addresses.set(project, m);
      else addresses.delete(project);
    };
    set(next);
    try {
      save();
    } catch (e) {
      set(before);
      throw e;
    }
  };

  /** A watcher's address as kept, or null. @param {string} project @param {string} id @returns {WatchAddress | null} */
  const of = (project, id) => addresses.get(project)?.get(id) ?? null;

  /** Posts of a watcher taken out, their files with them. @param {string} key @param {(p: { id: string, at: number }) => boolean} gone */
  const forget = (key, gone) => {
    const list = posts.get(key) || [];
    for (const p of list.filter(gone)) {
      where.delete(p.id);
      held.delete(p.id);
      if (root) rmSync(join(dirOf(key), `${p.id}.json`), { force: true });
    }
    const left = list.filter((p) => !gone(p));
    if (left.length) posts.set(key, left);
    else posts.delete(key);
  };

  return {
    of,
    /** Every watcher that has an address. @returns {{ project: string, id: string, address: WatchAddress }[]} */
    all: () => [...addresses].flatMap(([project, m]) => [...m].map(([id, address]) => ({ project, id, address }))),
    /**
     * A watcher's address for the Switch on it stands at (`onAt`): the one kept where it was made for that one, with a
     * secret as `sign` says; else a new one — and a new secret —, the old one let go.
     * @param {string} project @param {string} id @param {{ onAt: number, sign: boolean }} o
     * @returns {WatchAddress}
     */
    ensure(project, id, { onAt, sign }) {
      const had = of(project, id);
      if (had && had.onAt === onAt && (had.secret !== undefined) === sign) return had;
      /** @type {WatchAddress} */
      const a = { token: newToken(), at: now(), onAt, ...(sign ? { secret: newSecret() } : {}) };
      put(project, id, a);
      return a;
    },
    /**
     * A new address for a watcher that has one, the old one let go at once — its secret with it, where it has one; null
     * where it has none. @param {string} project @param {string} id @returns {WatchAddress | null}
     */
    renew(project, id) {
      const had = of(project, id);
      if (!had) return null;
      /** @type {WatchAddress} */
      const a = { token: newToken(), at: now(), onAt: had.onAt, ...(had.secret !== undefined ? { secret: newSecret() } : {}) };
      put(project, id, a);
      return a;
    },
    /** A watcher's secret was shown to the person: it is shown no more. @param {string} project @param {string} id */
    shown(project, id) {
      const had = of(project, id);
      if (had && had.secret !== undefined && !had.shown) put(project, id, { ...had, shown: true });
    },
    /**
     * The watcher a token opens, or null: every address compared, each in the same time, whatever the token.
     * @param {unknown} token @returns {{ project: string, id: string, address: WatchAddress } | null}
     */
    find(token) {
      /** @type {{ project: string, id: string, address: WatchAddress } | null} */
      let found = null;
      for (const [project, m] of addresses) for (const [id, address] of m) if (same(address.token, token)) found = { project, id, address };
      return found;
    },
    /** A watcher's address and the bodies kept for it, gone: it was changed, switched off or removed. @param {string} project @param {string} id */
    drop(project, id) {
      if (of(project, id)) put(project, id, null);
      const key = dirKey(project, id);
      forget(key, () => true);
      if (!root) return;
      rmSync(dirOf(key), { recursive: true, force: true });
      // Its project's folder too, once it holds no other watcher's.
      try {
        rmdirSync(join(root, folderOf(project)));
      } catch {}
    },

    /** A new post's id, for a post that came at `at`. @param {number} at */
    newPost: (at) => `${Math.max(0, Math.floor(at)).toString(36).padStart(9, "0").slice(-9)}-${randomBytes(8).toString("hex")}`,
    /**
     * A post kept for a watcher, under its id; past `keep` of them the oldest go. A write the disk refuses throws, and
     * keeps nothing. @param {string} project @param {string} id @param {string} post @param {KeptPost} kept
     */
    keepPost(project, id, post, kept) {
      const m = POST_ID.exec(post);
      if (!m) throw new Error("a post is kept under the id Filament gave it");
      const key = dirKey(project, id);
      if (root) {
        const dir = dirOf(key);
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        const to = join(dir, `${post}.json`);
        const tmp = `${to}.${process.pid}.tmp`;
        try {
          writeFileSync(tmp, JSON.stringify(kept), { mode: 0o600 });
          renameSync(tmp, to);
        } catch (e) {
          rmSync(tmp, { force: true });
          throw e;
        }
      } else held.set(post, kept);
      where.set(post, key);
      const list = [...(posts.get(key) || []), { id: post, at: parseInt(m[1], 36) }].sort(byMoment);
      posts.set(key, list);
      const over = list.slice(0, Math.max(0, list.length - keep)).map((p) => p.id);
      if (over.length) forget(key, (p) => over.includes(p.id));
    },
    /** A post as kept, by its id; null where it is not kept, or does not read. @param {string} post @returns {KeptPost | null} */
    postOf(post) {
      const key = where.get(post);
      if (!key) return null;
      if (!root) return held.get(post) ?? null;
      try {
        const p = JSON.parse(readFileSync(join(dirOf(key), `${post}.json`), "utf8"));
        if (!p || typeof p !== "object" || typeof p.body !== "string") return null;
        return { at: Number(p.at) || 0, type: String(p.type || ""), headers: Object.fromEntries(Object.entries(p.headers || {}).map(([k, v]) => [k, String(v)])), body: p.body };
      } catch {
        return null;
      }
    },
    /** The posts kept for a watcher, oldest first: each by its id, and when it came. @param {string} project @param {string} id */
    posts: (project, id) => (posts.get(dirKey(project, id)) || []).map((p) => ({ ...p })),
    /** Posts of a watcher's kept no more: the wake that read them ended. @param {string} project @param {string} id @param {readonly string[]} ids */
    dropPosts(project, id, ids) {
      forget(dirKey(project, id), (p) => ids.includes(p.id));
    },
  };
}
