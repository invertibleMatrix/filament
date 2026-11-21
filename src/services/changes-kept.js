// @ts-check
// A turn's or a run's changes, cut to the rows its card draws, kept on disk across a restart (the owner's of 11-18: "The
// first time you open a very large turn after a restart, it takes about 65 seconds. After that it's fast."): kept in
// memory, an answer goes with the process, and the next start walks the turn's git again. One store a kind, a file an
// answer, named by whose it is (a chat, a run) and what was asked, holding what it rests on: an answer is read back only
// where its owner, key, basis and question are the ones asked, and kept only where its walk was slow and told all git
// knew (`worthKeeping`). A deleted chat's go with it (`purge`); a store holds `most`, the one read longest ago going
// first, and none older than `maxAgeDays` where that is said. Every failure is a miss, or nothing written.
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** The most answers one store keeps. */
export const CHANGES_KEPT_MOST = 256;
/** A walk this slow, or slower, is worth its answer kept past the process. */
export const KEPT_SLOW_MS = 1000;
/** The files' own shape: one of another is a miss. */
const FORMAT = 1;
/** A file being written that a stopped process left behind goes after this long. */
const LEFT_MS = 60 * 60 * 1000;

/** @param {string} s */
const hash = (s) => createHash("sha256").update(s).digest("hex");

/**
 * Whether a walk's answer may be kept past the process: one that took `slowMs` or more, and was told all git knew
 * (`walkOf` in adapters/git/changes.js).
 * @param {{ ms: number, partly: boolean } | null} walk @param {number} [slowMs]
 */
export const worthKeeping = (walk, slowMs = KEPT_SLOW_MS) => !!walk && !walk.partly && walk.ms >= slowMs;

/**
 * @param {{ dir: string | null, most?: number, maxAgeDays?: () => number, slowMs?: number, log?: (level: string, msg: string) => void, now?: () => number }} o
 *   `dir`: where the store keeps its files; null keeps none. `maxAgeDays`: an answer read longer ago than that goes; 0
 *   or none, no age. `slowMs`: how slow a walk is worth its answer kept (`worth`).
 */
export function createChangesKept({ dir, most = CHANGES_KEPT_MOST, maxAgeDays = () => 0, slowMs = KEPT_SLOW_MS, log = () => {}, now = Date.now }) {
  let written = 0;
  /** The owners purged in this process: a walk that ends after its chat's deletion writes nothing that stays. One id a chat deleted. @type {Set<string>} */
  const purged = new Set();
  /** The writes under way, a read's mark of its time too. @type {Set<Promise<void>>} */
  const writing = new Set();
  /** @param {Promise<void>} p */
  const track = (p) => {
    writing.add(p);
    void p.finally(() => writing.delete(p));
    return p;
  };
  /** @param {string} owner */
  const prefix = (owner) => `${hash(owner).slice(0, 16)}-`;
  /** @param {string} owner @param {string} key @param {string} query */
  const fileOf = (owner, key, query) => join(/** @type {string} */ (dir), `${prefix(owner)}${hash(`${key}\n${query}`).slice(0, 32)}.json`);
  /** @param {any} e */
  const said = (e) => String(e?.code || e?.message || e);

  /** The store held to `most` answers and `maxAgeDays`, and what a stopped process left half written gone. */
  const trim = async () => {
    if (!dir) return;
    const names = await readdir(dir).catch(() => /** @type {string[]} */ ([]));
    const t = now();
    const days = Number(maxAgeDays()) || 0;
    /** @type {{ name: string, at: number }[]} */
    const kept = [];
    for (const name of names) {
      const at = await stat(join(dir, name)).then((s) => s.mtimeMs, () => null);
      if (at === null) continue;
      if (name.endsWith(".tmp")) {
        if (t - at > LEFT_MS) await rm(join(dir, name), { force: true }).catch(() => {});
      } else if (name.endsWith(".json")) {
        if (days > 0 && t - at > days * 86400_000) await rm(join(dir, name), { force: true }).catch(() => {});
        else kept.push({ name, at });
      }
    }
    kept.sort((a, b) => a.at - b.at);
    for (const { name } of kept.slice(0, Math.max(0, kept.length - most))) await rm(join(dir, name), { force: true }).catch(() => {});
  };

  return {
    on: !!dir,
    /** Whether a walk's answer is worth keeping here (`worthKeeping`). @param {{ ms: number, partly: boolean } | null} walk */
    worth: (walk) => worthKeeping(walk, slowMs),
    /**
     * The answer kept for `query` under `key`, whose is `owner`, while `basis` holds; null where none is, or reading it
     * failed. One read is marked read now, so the store's bound takes the ones read longest ago.
     * @param {string} owner @param {string} key @param {string} basis @param {string} query
     * @returns {Promise<any>}
     */
    async get(owner, key, basis, query) {
      if (!dir) return null;
      const file = fileOf(owner, key, query);
      /** @type {any} */
      let kept;
      try {
        kept = JSON.parse(await readFile(file, "utf8"));
      } catch (/** @type {any} */ e) {
        if (e?.code !== "ENOENT") log("warn", `changes kept: ${file} could not be read (${said(e)}): read from git`);
        return null;
      }
      if (kept?.format !== FORMAT || kept.owner !== owner || kept.key !== key || kept.basis !== basis || kept.query !== query || kept.answer == null) return null;
      const at = new Date(now());
      void track(utimes(file, at, at).catch(() => {}));
      return kept.answer;
    },
    /**
     * `answer` kept for `query` under `key`, whose is `owner`, resting on `basis`: in place of any kept for the same
     * question. Written whole under a name of its own first, so a reader never finds half of one.
     * @param {string} owner @param {string} key @param {string} basis @param {string} query @param {any} answer
     */
    put(owner, key, basis, query, answer) {
      if (!dir) return Promise.resolve();
      const at = /** @type {string} */ (dir);
      const file = fileOf(owner, key, query);
      const part = `${file}.${process.pid}.${++written}.tmp`;
      return track((async () => {
        try {
          await mkdir(at, { recursive: true });
          await writeFile(part, JSON.stringify({ format: FORMAT, owner, key, basis, query, answer }));
          await rename(part, file);
        } catch (e) {
          log("warn", `changes kept: ${file} could not be written (${said(e)})`);
          await rm(part, { force: true }).catch(() => {});
          return;
        }
        // Its owner purged while it was written — before or after the purge read the folder —: it goes.
        if (purged.has(owner)) return void (await rm(file, { force: true }).catch((e) => log("warn", `changes kept: ${file} could not be removed (${said(e)})`)));
        await trim().catch((e) => log("warn", `changes kept: ${at} could not be trimmed (${said(e)})`));
      })());
    },
    /** The writes under way, and the reads' marks, ended. */
    settled: () => Promise.all([...writing]).then(() => {}),
    /** Every answer kept whose is `owner` gone, and any written for it later in this process: a chat deleted. @param {string} owner */
    async purge(owner) {
      purged.add(owner);
      if (!dir) return;
      const start = prefix(owner);
      const names = await readdir(dir).catch(() => /** @type {string[]} */ ([]));
      for (const name of names) if (name.startsWith(start)) await rm(join(dir, name), { force: true }).catch((e) => log("warn", `changes kept: ${name} could not be removed (${said(e)})`));
    },
    /** The store held to its bounds now: at a start, where no answer is written for a while. */
    sweep: () => trim().catch((e) => log("warn", `changes kept: ${dir} could not be trimmed (${said(e)})`)),
  };
}
