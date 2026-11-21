// @ts-check
// Copies of a project sent here by another machine for its agents (the remote plan's cp-send): each a git bundle that
// comes in parts (adapters/git/send.js `bundleSnapshot` there), kept on disk as it comes, so a send cut short goes on
// from where it stopped, after a restart too; once whole and its sha-256 checked, taken into the project's mirror
// (adapters/git/send.js `importBundle`, handed in) in that machine's store (services/copies.js `storeOf`), which its
// agents never reach. A send counts in the machine's room as it opens; a machine has `OPEN_MAX` open at once; one not
// added to for a day goes; one taken answers the same again, for a sender whose wait was cut. Cleared copies end the
// sends into their stores first. A copy is taken again for a launch, or let go for room, only once what its last chat
// changed in it is kept in the mirror for that chat to read back (`keepFirst`, the review of 11-11); nothing is captured
// from a copy while a turn of its chat runs in it. Another machine's agents' own: every other caller is refused
// (http/admin/transfers.js).
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, mkdirSync } from "node:fs";
import { appendFile, open as openFile, readdir, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { folderKeyOf, inFolder } from "./copies.js";

/** The most one part carries, in bytes, before its base64. */
export const PART_MAX_BYTES = 8 * 1024 ** 2;
/** How long a send cut short, or one taken, is kept to go on with or to answer again. */
export const PARTIAL_TTL_MS = 24 * 3600_000;
/** How many sends one device has open at once. */
export const OPEN_MAX = 4;
/** How long a send stays untouched before a new one may take its place among a device's `OPEN_MAX`. */
const STALE_MS = 10 * 60_000;
/** How long cleared copies wait for a send's step under way into their stores, as a chat's turn is waited for. */
const CLEARED_WAIT_MS = 30_000;
/** A project's mirror in its store, which each copy of it is checked out from (cp-place). */
export const MIRROR = "mirror.git";
/** How long a copy taken for a launch is held while it is checked out: a large project's files written, then cleared. */
const CHECKOUT_HOLD_MS = 75 * 60_000;
/** How often a copy being checked out is held again. */
const HOLD_AGAIN_MS = 10 * 60_000;
/** How long a copy checked out is held for its chat to start there, whose turns hold it from then. */
export const BIND_MS = 15 * 60_000;
/** Where the sends of a project come in, in its store. */
const INCOMING = "incoming";
/** The most one part of a capture going back carries, in bytes, before its base64. */
export const BACK_PART_BYTES = 4 * 1024 ** 2;
/** How long a capture going back is kept for its sender to read, a part read again included. */
export const BACK_TTL_MS = 30 * 60_000;
/**
 * How many captures going back one device has kept at once: the one read longest ago goes for a newer one. Every
 * sub-agent a machine launches here comes through its one device, a fan-out's ending together.
 */
const BACKS_MAX = 16;

/**
 * @typedef {{ status: number, error: string, have?: number, lacks?: boolean, runs?: boolean }} Refused  `lacks`: the bundle builds on a
 *   commit the mirror does not hold, for the sender to send it whole; `runs`: a turn still runs in the copy asked about
 * @typedef {{ commit: string, project: string }} Taken
 * @typedef {{ id: string, device: string, project: string, repo: string, store: string, mirror: string, file: string, bytes: number, sha256: string,
 *   queue: Promise<unknown>, at: number, taking?: boolean, done?: Taken }} Transfer  `at`: when it was last touched; `taking`: whole, and
 *   being taken in; `done`: what its take answered; `repo`: the repository it is of, as its machine tells it apart ("": none sent)
 * @typedef {{ id: string, device: string, copy: string, chat: string, commit: string, kept: boolean, dir: string, file: string, bytes: number, sha256: string, at: number }} Going
 *   a capture going back to the machine whose sub-agent made it (cp-back), kept in its own temp folder until `BACK_TTL_MS`
 *   after it was last read; `kept`: one of what was kept of a copy as `chat` left it (`keepFirst`), not of the copy
 * @typedef {{ id: string, folder: string, project: string, chat: string, repo?: string, turn?: boolean }} CopyHere  a copy as the copies say it
 * @typedef {{ ok: true, base: string, commit: string, unchanged: boolean, had: boolean, files: number, left: { path: string, why: string }[], dir: string | null, file: string | null, bytes: number, sha256: string } | { ok: false, error: string, gone?: true }} Captured
 */

/** A file's sha-256, read as a stream. @param {string} file */
const sha256Of = async (file) => {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest("hex");
};

/**
 * @param {{ copies: { storeOf: (deviceId: string, project: string, o?: { make?: boolean, repo?: string }) => { ok: true, folder: string } | { ok: false, why: string, busy?: boolean },
 *     roomFor: (deviceId: string, bytes: number, o?: { spare?: ReadonlySet<string> | null }) => string, measureStore?: (deviceId: string, project: string, repo?: string) => Promise<number>,
 *     take?: (deviceId: string, project: string, o?: { leaseMs?: number, repo?: string, fresh?: boolean, again?: string, spare?: ReadonlySet<string> | null }) => { ok: true, copy: { id: string, folder: string }, reused: boolean } | { ok: false, why: string },
 *     hold?: (id: string, leaseMs?: number) => unknown, keep?: (id: string, ms?: number) => unknown, release?: (id: string) => unknown, measure?: (id: string) => Promise<number>,
 *     get?: (id: string) => CopyHere | null | undefined,
 *     copyAt?: (deviceId: string, folder: string) => { id: string } | null,
 *     idle?: (deviceId: string, project: string, o?: { repo?: string, not?: readonly string[] }) => CopyHere | null,
 *     needs?: (deviceId: string, o?: { copy?: boolean, more?: number, not?: readonly string[] }) => CopyHere[],
 *     keepState?: (id: string, k: { name: string, base: string, commit: string, files?: number, left?: { path: string, why: string }[] }) => string,
 *     keptOf?: (deviceId: string, copy: string, chat: string) => { project: string, repo?: string, name: string, base: string, commit: string, files: number, left: { path: string, why: string }[] } | null,
 *     keptRead?: (deviceId: string, copy: string, chat: string) => unknown, keptNames?: (deviceId: string, project: string) => string[],
 *     sent?: (id: string, commit: string) => unknown, keeps?: number,
 *     root?: string, onCleared?: (fn: (c: { keys: string[] }) => unknown) => unknown },
 *   take: (mirror: string, file: string) => Promise<{ ok: true, commit: string } | { ok: false, error: string, lacks?: boolean }>,
 *   haves: (mirror: string) => Promise<string[]>,
 *   has?: ((mirror: string, commit: string) => Promise<boolean>) | null,
 *   checkout?: ((mirror: string, folder: string, commit: string, o: { pin: string, root?: string | null }) => Promise<{ ok: true, commit: string } | { ok: false, error: string }>) | null,
 *   capture?: ((mirror: string, folder: string, o: { pin: string, haves?: readonly string[], bundle?: boolean }) => Promise<Captured>) | null,
 *   keep?: ((mirror: string, commit: string, name: string) => Promise<string>) | null,
 *   kept?: ((mirror: string, name: string, o: { base: string, haves?: readonly string[] }) => Promise<{ ok: true, commit: string, dir: string, file: string, bytes: number, sha256: string } | { ok: false, error: string, gone?: true }>) | null,
 *   drop?: ((mirror: string, live: readonly string[]) => Promise<unknown>) | null,
 *   log?: (level: string, line: string) => void, now?: () => number }} o
 *   `take`: a bundle taken into a mirror, `haves`: the commits a mirror holds, `has`: whether it holds one, `checkout`: a
 *   copy checked out of it, `capture`: what a copy's sub-agent changed in it, bundled to go back; `keep`: a capture kept
 *   in the mirror under a name of its own, `kept`: one bundled to go back, `drop`: every kept one but those named let go
 *   (adapters/git/send.js `importBundle`, `mirrorHaves`, `mirrorHas`, `checkoutCopy`, `captureCopy`, `keepCapture`,
 *   `bundleKept`, `dropKept`, which the composition root hands in)
 */
export function createTransfers({ copies, take, haves: havesOf, has = null, checkout = null, capture = null, keep = null, kept: bundleOf = null, drop: dropOf = null, log = () => {}, now = () => Date.now() }) {
  /** @type {Map<string, Transfer>} */
  const open = new Map();
  /** @type {Map<string, Going>} */
  const going = new Map();
  /** A capture going back let go, its temp folder with it. @param {Going} g */
  const letGo = (g) => {
    going.delete(g.id);
    void rm(g.dir, { recursive: true, force: true }).catch(() => {});
  };
  /** Captures kept past `BACK_TTL_MS` go. */
  const purgeGoing = () => {
    for (const g of [...going.values()]) if (now() - g.at > BACK_TTL_MS) letGo(g);
  };
  /**
   * A capture kept for its machine to read (`backPart`): one kept before for the same copy and chat is the older, and
   * this one stands for it; of a device's `BACKS_MAX`, the one read longest ago gives way. → its id.
   * @param {string} device @param {Omit<Going, "id" | "device" | "at">} g
   */
  const goes = (device, g) => {
    purgeGoing();
    for (const x of [...going.values()]) if (x.copy === g.copy && x.chat === g.chat) letGo(x);
    // The one read longest ago gives way, never one being read now.
    const theirs = [...going.values()].filter((x) => x.device === device).sort((x, y) => x.at - y.at);
    for (const x of theirs.slice(0, Math.max(0, theirs.length - BACKS_MAX + 1))) letGo(x);
    const id = `bk_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    going.set(id, { ...g, id, device, at: now() });
    return id;
  };
  /** Each mirror's takes, one after another. @type {Map<string, Promise<unknown>>} */
  const taking = new Map();
  /**
   * A project's store, made unless `make` is false (a question alone); one being removed is refused for a moment (503).
   * `repo`: the repository it is of, as its machine tells it apart, which its store is found by (services/copies.js
   * `storeName`: two repositories of one folder name keep two); none from a machine whose Filament sends none yet.
   * @param {string} device @param {unknown} project @param {unknown} repo @param {boolean} [make]
   * @returns {{ folder: string, mirror: string, incoming: string, repo: string } | Refused}
   */
  const where = (device, project, repo, make = true) => {
    const p = typeof project === "string" ? project.trim() : "";
    if (!p || p.length > 200) return { status: 400, error: "project is the project's name, 200 characters at most" };
    const r = repo == null || repo === "" ? "" : String(repo);
    if (r && !/^[0-9a-f]{40}$/.test(r)) return { status: 400, error: "repo is what tells the project's repository apart, 40 hex digits" };
    const s = copies.storeOf(device, p, { make, repo: r });
    if (!s.ok) return { status: s.busy ? 503 : 403, error: s.why };
    return { folder: s.folder, mirror: join(s.folder, MIRROR), incoming: join(s.folder, INCOMING), repo: r };
  };
  /** A size on disk, 0 for none. @param {string} f */
  const sizeOf = async (f) => (await stat(f).catch(() => null))?.size ?? 0;
  /** A send dropped, its part with it. @param {Transfer} t */
  const drop = (t) => {
    open.delete(t.id);
    if (!t.done) void t.queue.then(() => rm(t.file, { force: true })).catch(() => {});
  };
  /** Sends untouched a day go, and the parts on disk no send names that are as old. @param {string} incoming */
  const purge = async (incoming) => {
    for (const t of [...open.values()]) if (now() - t.at > PARTIAL_TTL_MS) drop(t);
    for (const name of await readdir(incoming).catch(() => /** @type {string[]} */ ([]))) {
      const f = join(incoming, name);
      const st = await stat(f).catch(() => null);
      if (st && now() - st.mtimeMs > PARTIAL_TTL_MS && ![...open.values()].some((t) => t.file === f)) await rm(f, { force: true }).catch(() => {});
    }
  };
  /** One transfer's steps, one after another. @param {Transfer} t @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
  const inTurn = (t, fn) => {
    const next = t.queue.then(fn, fn);
    t.queue = next.catch(() => {});
    return next;
  };
  /** One mirror's takes, one after another. @param {string} mirror @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
  const inMirror = (mirror, fn) => {
    const next = (taking.get(mirror) ?? Promise.resolve()).then(fn, fn);
    const settled = next.catch(() => {});
    taking.set(mirror, settled);
    void settled.then(() => taking.get(mirror) === settled && taking.delete(mirror));
    return next;
  };
  /**
   * A copy's state kept in its mirror as its chat left it, before a newer launch's checkout writes over it or it goes
   * for room (the review of 11-11: what its sub-agent changed there and never came back went with it): captured as a
   * change going back is, kept there under a name of its own, and said to the copies (`keepState`), which answer its
   * chat's ask from it for as long as they keep one. One mirror's step, the caller's. A copy no chat was started in, or
   * one that is gone, holds nothing to keep. → "" once kept, or with nothing to keep; else why not, in words: the copy
   * then stays as it is.
   * @param {string} device @param {string} mirror @param {CopyHere} c
   */
  const keepFirst = async (device, mirror, c) => {
    if (!capture || !keep || !copies.keepState || !c.chat) return "";
    /** @type {Captured} */
    let got;
    try {
      got = await capture(mirror, c.folder, { pin: basename(c.folder), haves: [], bundle: false });
    } catch (/** @type {any} */ e) {
      got = { ok: false, error: String(e?.message || e).slice(0, 300) };
    }
    if (!got.ok) return got.gone ? "" : got.error;
    if (got.dir) void rm(got.dir, { recursive: true, force: true }).catch(() => {});
    const name = got.unchanged ? "" : `${basename(c.folder)}-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const why = (name && (await keep(mirror, got.commit, name))) || copies.keepState(c.id, { name, base: got.base, commit: got.commit, files: got.files, left: got.left });
    // What the copies keep no more of this mirror goes: one past its while, one that gave way, one just refused.
    await dropOf?.(mirror, copies.keptNames?.(device, c.project) ?? []).catch(() => {});
    if (why) log("warn", `[transfers] the state of a copy of ${c.project} could not be kept, and the copy stays as it is: ${why}`);
    return why;
  };
  /**
   * The idle copies that would go for room (`needs`), each one's state kept first in its own mirror → those that may
   * go: kept, or with nothing to keep; the next oldest is asked in the place of one that could not be kept.
   * @param {string} device @param {{ copy?: boolean, more?: number }} o
   * @returns {Promise<Set<string> | null>}  null where the copies keep no state (any idle one goes)
   */
  const spared = async (device, o) => {
    if (!copies.needs || !copies.keepState) return null;
    /** @type {Set<string>} */
    const may = new Set();
    /** @type {string[]} */
    const not = [];
    for (;;) {
      const next = copies.needs(device, { ...o, not }).filter((c) => !may.has(c.id));
      if (!next.length) return may;
      for (const c of next) {
        const w = where(device, c.project, c.repo, false);
        if (!("status" in w) && !(await inMirror(w.mirror, () => keepFirst(device, w.mirror, c)))) may.add(c.id);
        else not.push(c.id);
      }
    }
  };
  /** @param {string} device @param {string} id @returns {Transfer | Refused} */
  const mine = (device, id) => {
    const t = open.get(id);
    if (t && t.device === device) {
      t.at = now();
      return t;
    }
    return { status: 404, error: `no transfer ${id} of this device's: open it again (POST /transfers), and it goes on from where it stopped` };
  };
  // Copies cleared end the sends into their stores first: none adds to a folder that goes, and a take under way is
  // waited for, `CLEARED_WAIT_MS` at most — a file it still holds then stays for the sweep.
  copies.onCleared?.(async ({ keys }) => {
    const hit = [...open.values()].filter((t) => keys.some((k) => inFolder(folderKeyOf(t.store), k)));
    for (const t of hit) open.delete(t.id);
    /** @type {NodeJS.Timeout | undefined} */
    let timer;
    await Promise.race([Promise.allSettled(hit.map((t) => t.queue)), new Promise((r) => (timer = setTimeout(r, CLEARED_WAIT_MS)))]);
    clearTimeout(timer);
  });

  return {
    /**
     * The commits a project's mirror holds, newest first, for the sender's next bundle to build on.
     * @param {string} device @param {unknown} project @param {unknown} [repo] @returns {Promise<{ haves: string[] } | Refused>}
     */
    async haves(device, project, repo = "") {
      const w = where(device, project, repo, false);
      if ("status" in w) return w;
      return { haves: await havesOf(w.mirror) };
    },
    /**
     * A send opened, or opened again: what came of it already (`have`, in bytes) is kept, so it goes on from there; one
     * taken already answers what its take did (`done`). Refused where the machine's room here would not hold it.
     * @param {string} device @param {{ project?: unknown, repo?: unknown, bytes?: unknown, sha256?: unknown }} b
     * @returns {Promise<{ id: string, have: number, done?: Taken } | Refused>}
     */
    async open(device, b) {
      const w = where(device, b?.project, b?.repo);
      if ("status" in w) return w;
      const bytes = Number(b?.bytes);
      if (!Number.isSafeInteger(bytes) || bytes <= 0) return { status: 400, error: "bytes is the bundle's size, a whole number above 0" };
      const sha256 = typeof b?.sha256 === "string" ? b.sha256.toLowerCase() : "";
      if (!/^[0-9a-f]{64}$/.test(sha256)) return { status: 400, error: "sha256 is the bundle's sha-256, 64 hex digits" };
      const file = join(w.incoming, `${sha256}.part`);
      // Found, or kept, before anything is waited for: two opens of one send are one transfer.
      const again = [...open.values()].find((t) => t.file === file && t.device === device);
      if (again) {
        again.at = now();
        // Whole and being taken in: answered now, so the sender asks its commit again and waits on that.
        if (again.taking) return { id: again.id, have: again.bytes };
        return inTurn(again, async () => (again.done ? { id: again.id, have: again.bytes, done: again.done } : { id: again.id, have: await sizeOf(file) }));
      }
      const theirs = [...open.values()].filter((t) => t.device === device && !t.done).sort((x, y) => x.at - y.at);
      if (theirs.length >= OPEN_MAX) {
        const stale = theirs.find((t) => now() - t.at > STALE_MS);
        if (!stale) return { status: 429, error: `this machine has ${theirs.length} sends open here, the most it may: send again once one ends` };
        drop(stale);
      }
      const others = theirs.filter((t) => open.has(t.id)).reduce((n, t) => n + t.bytes, 0);
      // An idle copy goes for this send's room only once its state is kept; that waited for, another open of this
      // send may have come meanwhile, and is the one transfer.
      const waits = !!copies.needs?.(device, { copy: false, more: bytes + others }).length;
      const spare = waits ? await spared(device, { copy: false, more: bytes + others }) : null;
      if (waits && [...open.values()].some((t) => t.file === file && t.device === device)) return this.open(device, b);
      const no = copies.roomFor(device, bytes + others, { spare });
      if (no) return { status: 413, error: no };
      const id = `tr_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
      /** @type {Transfer} */
      const t = { id, device, project: String(b.project).trim(), repo: w.repo, store: w.folder, mirror: w.mirror, file, bytes, sha256, queue: Promise.resolve(), at: now() };
      open.set(id, t);
      return inTurn(t, async () => {
        mkdirSync(w.incoming, { recursive: true });
        await purge(w.incoming);
        let have = await sizeOf(file);
        if (have > bytes) {
          await rm(file, { force: true });
          have = 0;
        }
        return { id, have };
      });
    },
    /**
     * One part, added where the send stands: `offset` is what came already; any other is refused with where it stands.
     * @param {string} device @param {string} id @param {{ offset?: unknown, data?: unknown }} b
     * @returns {Promise<{ have: number } | Refused>}
     */
    async part(device, id, b) {
      const t = mine(device, id);
      if ("status" in t) return t;
      const data = typeof b?.data === "string" ? b.data : "";
      if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return { status: 400, error: "data is the part's bytes in base64" };
      const buf = Buffer.from(data, "base64");
      if (buf.length > PART_MAX_BYTES) return { status: 413, error: `a part carries ${PART_MAX_BYTES / 1024 ** 2} MB at most` };
      return inTurn(t, async () => {
        if (t.done) return { have: t.bytes };
        const have = await sizeOf(t.file);
        if (Number(b?.offset) !== have) return { status: 409, error: `this transfer stands at ${have} bytes: send the part from there`, have };
        if (have + buf.length > t.bytes) return { status: 400, error: `the part runs past the ${t.bytes} bytes the transfer was opened for` };
        await appendFile(t.file, buf);
        return { have: have + buf.length };
      });
    },
    /**
     * A send done: whole, its sha-256 the one it was opened with, then taken into the project's mirror. → the commit;
     * asked again, the same answer.
     * @param {string} device @param {string} id @returns {Promise<Taken | Refused>}
     */
    async commit(device, id) {
      const t = mine(device, id);
      if ("status" in t) return t;
      return inTurn(t, async () => {
        if (t.done) return t.done;
        const have = await sizeOf(t.file);
        if (have !== t.bytes) return { status: 409, error: `this transfer stands at ${have} of its ${t.bytes} bytes: send the rest first`, have };
        if ((await sha256Of(t.file)) !== t.sha256) {
          open.delete(t.id);
          await rm(t.file, { force: true }).catch(() => {});
          return { status: 422, error: "the copy that came is not the one sent (its sha-256 differs): it is dropped, send it again" };
        }
        t.taking = true;
        const taken = await inMirror(t.mirror, () => take(t.mirror, t.file)).finally(() => (t.taking = false));
        await rm(t.file, { force: true }).catch(() => {});
        if (!taken.ok) {
          open.delete(t.id);
          log("warn", `[transfers] a copy of ${t.project} was not taken in: ${taken.error}`);
          return { status: 422, error: taken.error, ...(taken.lacks ? { lacks: true } : {}) };
        }
        t.done = { commit: taken.commit, project: t.project };
        t.at = now();
        void copies.measureStore?.(device, t.project, t.repo).catch(() => {});
        return t.done;
      });
    },
    /**
     * A copy of a project taken for a launch and checked out at `commit`, which its mirror holds (cp-place): an idle one
     * of that project's taken again, its installs kept, else one made (services/copies.js `take`), held while it is
     * checked out, then a while for its chat to start there (`BIND_MS`), whose turns hold it from then. A commit the
     * mirror lacks is refused before any copy is taken. → its id and folder, for the chat started there; refused in
     * words, the copy let go again.
     * `keeps`: how long what its sub-agent changes there is kept after its chat last used the copy — in the copy, then
     * as what was kept of it (`keepFirst`) —, for its machine to say.
     * @param {string} device @param {{ project?: unknown, repo?: unknown, commit?: unknown }} b
     * @returns {Promise<{ copy: string, folder: string, reused: boolean, keeps?: number } | Refused>}
     */
    async place(device, b) {
      if (!checkout || !copies.take) return { status: 503, error: "this Filament checks no copy out" };
      const w = where(device, b?.project, b?.repo);
      if ("status" in w) return w;
      const commit = typeof b?.commit === "string" ? b.commit.trim() : "";
      if (!/^[0-9a-f]{40}$/.test(commit)) return { status: 400, error: "commit is the copy's commit, 40 hex digits" };
      if (has && !(await has(w.mirror, commit).catch(() => false))) return { status: 422, error: `the commit ${commit.slice(0, 12)} is not here: send the copy first` };
      const project = String(b?.project).trim();
      const o = { leaseMs: CHECKOUT_HOLD_MS, repo: w.repo };
      const take_ = copies.take.bind(copies);
      // An idle copy is taken again only once its state is kept in the mirror, one mirror's step with its take, so no
      // other launch of the project looks at it between the two; one whose state cannot be kept is passed over and
      // stays as its chat left it (the review of 11-11).
      const again = !copies.idle
        ? take_(device, project, o)
        : await inMirror(w.mirror, async () => {
            /** @type {string[]} */
            const not = [];
            for (let c = copies.idle?.(device, project, { repo: w.repo, not }); c; c = copies.idle?.(device, project, { repo: w.repo, not })) {
              const t = (await keepFirst(device, w.mirror, c)) ? null : take_(device, project, { ...o, again: c.id });
              if (t?.ok) return t;
              not.push(c.id);
            }
            return null;
          });
      // None to take again: one is made, the idle copies that go for its room kept first, each in its own mirror.
      const took = again ?? take_(device, project, { ...o, fresh: true, spare: await spared(device, { copy: true }) });
      if (!took.ok) return { status: 429, error: took.why };
      const { id, folder } = took.copy;
      /** @type {{ ok: true, commit: string } | { ok: false, error: string }} */
      let out;
      // Held again while the checkout waits behind its mirror's takes and runs, and as it starts: a wait that outlasts
      // the hold lets no other launch take the copy meanwhile.
      const keep = setInterval(() => copies.hold?.(id, CHECKOUT_HOLD_MS), HOLD_AGAIN_MS);
      keep.unref?.();
      try {
        out = await inMirror(w.mirror, () => {
          copies.hold?.(id, CHECKOUT_HOLD_MS);
          return /** @type {NonNullable<typeof checkout>} */ (checkout)(w.mirror, folder, commit, { pin: basename(folder), root: copies.root ?? null });
        });
      } catch (/** @type {any} */ e) {
        out = { ok: false, error: `the copy could not be checked out: ${String(e?.message || e).slice(0, 300)}` };
      } finally {
        clearInterval(keep);
      }
      if (!out.ok) {
        copies.release?.(id);
        return { status: 422, error: out.error };
      }
      copies.hold?.(id, BIND_MS);
      void copies.measure?.(id).catch(() => {});
      return { copy: id, folder, reused: took.reused, ...(keep && copies.keepState && copies.keeps ? { keeps: copies.keeps } : {}) };
    },
    /**
     * What a launch's sub-agent changed in its copy here, to go back to its machine (cp-back): the copy this device's
     * machine took, still its chat's (`chat`), captured on the commit it was checked out at, one mirror's step at a time,
     * without what that machine holds (`haves`). → the capture, kept `BACK_TTL_MS` for its parts to be read (`id`);
     * `unchanged` or `had` with none to read; or refused in words. A copy that went to a newer launch, or for room, is
     * answered from what was kept of it as that chat left it (`keepFirst`), for as long as the copies keep one.
     * @param {string} device @param {{ copy?: unknown, chat?: unknown, haves?: unknown }} b
     * @returns {Promise<{ id: string | null, base: string, commit: string, unchanged: boolean, had: boolean, files: number, left: { path: string, why: string }[], bytes: number, sha256: string } | Refused>}
     */
    async back(device, b) {
      if (!capture || !copies.get || !copies.copyAt) return { status: 503, error: "this Filament sends no change back" };
      const id = typeof b?.copy === "string" ? b.copy.trim() : "";
      const chat = String(b?.chat ?? "");
      const haves = (Array.isArray(b?.haves) ? b.haves : []).filter((h) => typeof h === "string" && /^[0-9a-f]{40}$/.test(h)).slice(0, 20);
      const c = id ? copies.get(id) : null;
      const k = id && chat && !(c && c.chat === chat) ? copies.keptOf?.(device, id, chat) : null;
      if (k) {
        const w = where(device, k.project, k.repo, false);
        if ("status" in w) return w;
        const said = { base: k.base, commit: k.commit, unchanged: !k.name, had: false, files: k.files, left: k.left, bytes: 0, sha256: "" };
        if (!k.name) return { id: null, ...said };
        if (haves.includes(k.commit)) {
          copies.keptRead?.(device, id, chat);
          return { id: null, ...said, had: true };
        }
        if (!bundleOf) return { status: 503, error: "this Filament sends no change back" };
        /** @type {Awaited<ReturnType<NonNullable<typeof bundleOf>>>} */
        let bundled;
        try {
          bundled = await inMirror(w.mirror, () => bundleOf(w.mirror, k.name, { base: k.base, haves }));
        } catch (/** @type {any} */ e) {
          bundled = { ok: false, error: String(e?.message || e).slice(0, 300) };
        }
        if (!bundled.ok) {
          log("warn", `[transfers] what was kept of a copy of ${k.project} could not go back: ${bundled.error}`);
          return { status: bundled.gone ? 404 : 422, error: bundled.error };
        }
        return { id: goes(device, { copy: id, chat, commit: k.commit, kept: true, dir: bundled.dir, file: bundled.file, bytes: bundled.bytes, sha256: bundled.sha256 }), ...said, bytes: bundled.bytes, sha256: bundled.sha256 };
      }
      if (!c || copies.copyAt(device, c.folder)?.id !== id) return { status: 404, error: `no copy ${id.slice(0, 60)} of this machine's here: it was cleared, or left idle until it went` };
      if (!c.chat || c.chat !== chat) return { status: 410, error: "its copy here went to a newer launch of its project once its chat let it go, and nothing is kept of what it changed there any more" };
      // A turn of its chat runs in it now: what it holds is half written, and nothing is read of it until that turn
      // ends (the review of 11-11: a change came back half done) — its machine asks again.
      if (c.turn) return { status: 409, error: "a turn of its chat still runs in its copy here: what it changes is read once that turn has ended", runs: true };
      // Its chat's a while more: a bring back that fails is tried again for about that while (the swarm's review of 11-10).
      copies.keep?.(id);
      const w = where(device, c.project, c.repo, false);
      if ("status" in w) return w;
      /** @type {Captured} */
      let got;
      try {
        got = await inMirror(w.mirror, () => /** @type {NonNullable<typeof capture>} */ (capture)(w.mirror, c.folder, { pin: basename(c.folder), haves }));
      } catch (/** @type {any} */ e) {
        got = { ok: false, error: String(e?.message || e).slice(0, 300) };
      }
      if (!got.ok) {
        log("warn", `[transfers] what changed in a copy of ${c.project} could not go back: ${got.error}`);
        return { status: got.gone ? 404 : 422, error: got.error };
      }
      const said = { base: got.base, commit: got.commit, unchanged: got.unchanged, had: got.had, files: got.files, left: got.left, bytes: got.bytes, sha256: got.sha256 };
      // Held by its machine, as it says: what is kept of the copy later is one read back.
      if (got.had) copies.sent?.(id, got.commit);
      if (!got.file || !got.dir) return { id: null, ...said };
      return { id: goes(device, { copy: id, chat, commit: got.commit, kept: false, dir: got.dir, file: got.file, bytes: got.bytes, sha256: got.sha256 }), ...said };
    },
    /**
     * A part of a capture going back, from `offset`: `BACK_PART_BYTES` at most, in base64, and whether it is the last.
     * @param {string} device @param {string} id @param {unknown} offset
     * @returns {Promise<{ offset: number, data: string, end: boolean } | Refused>}
     */
    async backPart(device, id, offset) {
      purgeGoing();
      const g = going.get(id);
      if (!g || g.device !== device) return { status: 404, error: `no capture ${String(id).slice(0, 60)} of this device's here: ask for it again (POST /transfers/back)` };
      g.at = now();
      const at = Number(offset);
      if (!Number.isSafeInteger(at) || at < 0 || at > g.bytes) return { status: 400, error: `offset is where the part starts, 0 to ${g.bytes}` };
      const fh = await openFile(g.file, "r");
      try {
        const buf = Buffer.alloc(Math.min(BACK_PART_BYTES, g.bytes - at));
        const { bytesRead } = await fh.read(buf, 0, buf.length, at);
        const end = at + bytesRead >= g.bytes;
        // Read whole by its machine: what is kept of the copy is, or will be, one read back, the first to give way.
        if (end && g.kept) copies.keptRead?.(device, g.copy, g.chat);
        else if (end) copies.sent?.(g.copy, g.commit);
        return { offset: at, data: buf.subarray(0, bytesRead).toString("base64"), end };
      } finally {
        await fh.close();
      }
    },
  };
}
