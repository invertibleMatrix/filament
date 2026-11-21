// @ts-check
// The git commands a piece of Filament starts, each by its words. git() (snapshot.js) and gitBytes (worktree.js) start
// theirs on the spawn pool's threads (src/adapters/git/spawn-pool.js), which load child_process of their own: no patch
// of this thread's reaches them, and the pool tells each on its channel instead (`SPAWN_CHANNEL`). A git() whose time
// runs past 60 s still starts on this thread, through execFile.
import cp from "node:child_process";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";
import { SPAWN_CHANNEL } from "../../src/adapters/git/spawn-pool.js";

/** A git command's words: its arguments, the `-c name=value` pairs Filament sets before them dropped. @param {string[]} args */
export const wordsOf = (args) => args.filter((a, i) => a !== "-c" && args[i - 1] !== "-c");
/** @param {unknown} file */
const isGit = (file) => /^git(\.exe)?$/i.test(basename(String(file)));

/**
 * What `go` gives, and the git commands it started, each by its words: those the pool's threads started, as the pool
 * tells them, and those started on this thread through execFile.
 * @template T @param {() => Promise<T>} go @returns {Promise<{ out: T, runs: string[][] }>}
 */
export async function gitRuns(go) {
  /** @type {string[][]} */
  const runs = [];
  const execFile = cp.execFile;
  /** @type {any} */ (cp).execFile = function (/** @type {any} */ file, /** @type {any[]} */ ...rest) {
    if (isGit(file)) runs.push(wordsOf(Array.isArray(rest[0]) ? rest[0].map(String) : []));
    return /** @type {any} */ (execFile).call(this, file, ...rest);
  };
  syncBuiltinESMExports();
  const pooled = (/** @type {any} */ m) => void (m.event === "start" && isGit(m.file) && runs.push(wordsOf(m.args.map(String))));
  subscribe(SPAWN_CHANNEL, pooled);
  try {
    return { out: await go(), runs };
  } finally {
    unsubscribe(SPAWN_CHANNEL, pooled);
    /** @type {any} */ (cp).execFile = execFile;
    syncBuiltinESMExports();
  }
}
