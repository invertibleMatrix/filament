// @ts-check
// A git() call whose time runs past git()'s own (`timeoutMs` above its 60 s: a checkout, a clone, a fetch) starts on
// the server's thread, as every process did before the pool, and every other git on the pool's threads
// (`adapters/git/spawn-pool.js`). On Windows each start hands the new process every handle open to be inherited at that
// moment, and the end of a pipe a starting process writes to is one until its own start returns: a git started on a
// thread while this thread starts a command (a shell tool, an agent, rg) keeps that command's output open for its own
// life, and whoever waits on the command's end waits on the git. A short git is gone in a moment; a long one is
// started where every other start is, one at a time, so it inherits none of them. Every repository here is a
// throwaway under the temp folder.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import childProcess, { execFileSync, spawn } from "node:child_process";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { syncBuiltinESMExports } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { git, gitProgram } from "../src/adapters/git/snapshot.js";
import { SPAWN_CHANNEL } from "../src/adapters/git/spawn-pool.js";

const hasGit = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
})();
const skip = !hasGit && "git is not on PATH";
/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});
/** A throwaway repository with one commit. */
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-long-"));
  made.push(dir);
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const run = (/** @type {string[]} */ args) => execFileSync("git", args, { cwd: dir, env, windowsHide: true });
  run(["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, "a.txt"), "one\n");
  run(["add", "."]);
  run(["commit", "-q", "-m", "init"]);
  return dir;
};
/** A time past git()'s own 60 s, as a checkout's or a clone's. */
const LONG_MS = 5 * 60_000;
/** How many long gits start, and how many commands at least start beside them. */
const ENOUGH = 20;

// (fails before: yes — every git() call started on a pool thread, a five-minute checkout's too)
test("a git() call whose time runs past git()'s own starts on this thread; one within it, on a pool thread", { skip }, async (t) => {
  const dir = repo();
  // The git to start is found first: its own `--exec-path` is neither call's.
  await gitProgram();
  const execFile = t.mock.method(childProcess, "execFile");
  syncBuiltinESMExports();
  /** @type {string[]} */
  const pooled = [];
  const on = (/** @type {any} */ m) => void (m.event === "start" && pooled.push(m.args.at(-1)));
  subscribe(SPAWN_CHANNEL, on);
  t.after(() => {
    unsubscribe(SPAWN_CHANNEL, on);
    execFile.mock.restore();
    syncBuiltinESMExports();
  });
  const long = await git(["rev-parse", "--verify", "HEAD"], { cwd: dir, timeoutMs: LONG_MS });
  const short = await git(["rev-parse", "--verify", "--short", "HEAD"], { cwd: dir });
  assert.deepEqual([long.code, short.code, long.out.startsWith(short.out)], [0, 0, true]);
  assert.deepEqual(execFile.mock.calls.map((c) => /** @type {any} */ (c.arguments)[1].at(-1)), ["HEAD"], "the long one on this thread");
  assert.deepEqual(pooled, ["HEAD"], "the short one on a pool thread");
  assert.equal(execFile.mock.calls.length, 1);
});

// (fails before: yes — long gits started on the pool's threads beside the commands this thread started, and a command
// whose output one of them had inherited ended only when that git did)
test("a command started on this thread is heard to its end at once while long gits start beside it", { skip }, async () => {
  const dir = repo();
  const stop = new AbortController();
  /** @type {Promise<unknown>[]} */
  const long = [];
  let going = true;
  // Long gits keep starting, each waiting on its input until the end, as a checkout or a clone runs on.
  const starter = (async () => {
    while (going && long.length < ENOUGH) {
      long.push(git(["hash-object", "--stdin"], { cwd: dir, signal: stop.signal, timeoutMs: LONG_MS }));
      await sleep(25);
    }
  })();
  /** How long after its exit each command's output ended; Infinity where it had not ended 2 s on. @type {number[]} */
  const gaps = [];
  try {
    // As many commands as long gits at least, however slowly a loaded machine starts them.
    const t0 = performance.now();
    while ((gaps.length < ENOUGH || long.length < ENOUGH) && performance.now() - t0 < 30_000) {
      gaps.push(
        await new Promise((done) => {
          const c = spawn("git", ["--version"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
          c.stdout.resume();
          c.stderr.resume();
          c.on("exit", () => {
            const at = performance.now();
            const held = setTimeout(() => done(Infinity), 2000);
            c.on("close", () => (clearTimeout(held), done(performance.now() - at)));
          });
        }),
      );
    }
  } finally {
    going = false;
    await starter;
    stop.abort();
    await Promise.all(long);
  }
  const held = gaps.filter((g) => g === Infinity).length;
  assert.equal(held, 0, `${held} of ${gaps.length} commands' output held past 2 s by ${long.length} long gits`);
  assert.ok(gaps.length >= ENOUGH && long.length >= ENOUGH, `${gaps.length} commands beside ${long.length} long gits`);
});
