// @ts-check
// git's processes start on threads of their own (`adapters/git/spawn-pool.js`), beside every other process Filament
// starts on its own thread. On Windows each start hands the new process every handle open to be inherited at that
// moment (libuv's CreateProcessW inherits them all), and the end of a pipe a starting process writes to is one, until
// its start returns. Two starts at once on two threads: a process that lives on (an agent, a server, a test command)
// keeps a git's output open, and a call that waits for the end of git's output waits for that process. git's calls
// read what git said from files, answered once git has exited, so no other process holds them up. Every repository
// here is a throwaway under the temp folder.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { git, gitProgram } from "../src/adapters/git/snapshot.js";

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
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** A throwaway repository with one commit. */
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-inherit-"));
  made.push(dir);
  const run = (/** @type {string[]} */ args) => execFileSync("git", args, { cwd: dir, env: ENV, windowsHide: true });
  run(["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, "a.txt"), "one\n");
  run(["add", "."]);
  run(["commit", "-q", "-m", "init"]);
  return dir;
};
/** How long a call waits before it counts as held. */
const HELD_MS = 10_000;

// (fails before: yes — git's output came through pipes, answered at their end: a process started beside a git kept
// that git's pipe open, and its call waited until that process ended)
test("git's calls answer while long-lived processes start beside them, on this thread and on git's own", { skip }, async () => {
  const dir = repo();
  // Git itself, not Git for Windows' launcher (`gitProgram`): a launcher ended at its start can leave its git running,
  // holding this process's pipes open past the test.
  const program = await gitProgram();
  /** Long-lived processes started on this thread, as an agent or a command is: each waits on its input until ended. */
  /** @type {import("node:child_process").ChildProcess[]} */
  const beside = [];
  let starting = true;
  const starter = (async () => {
    while (starting && beside.length < 400) {
      beside.push(spawn(program.file, ["hash-object", "--stdin"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: program.env({ ...process.env }) }));
      await sleep(1);
    }
  })();
  // Long-lived gits through git() itself — their time past git()'s own, so they start on this thread — beside the quick
  // ones on the pool's threads.
  const stop = new AbortController();
  const long = Array.from({ length: 4 }, () => git(["hash-object", "--stdin"], { cwd: dir, signal: stop.signal, timeoutMs: 120_000 }));
  try {
    /** @type {{ i: number, ms: number, ok: boolean }[]} */
    const timed = [];
    // Three bursts of forty, one after another, each beside the processes still starting.
    for (let wave = 0; wave < 3; wave++)
      timed.push(
        ...(await Promise.all(
          Array.from({ length: 40 }, async (_, k) => {
            const i = wave * 40 + k;
            const started = performance.now();
            const call = i % 4 === 0 ? git(["hash-object", "--stdin"], { cwd: dir, input: `x${i}\n` }) : git(["rev-parse", "--verify", "-q", "HEAD"], { cwd: dir });
            const r = await Promise.race([call, sleep(HELD_MS).then(() => null)]);
            return { i, ms: Math.round(performance.now() - started), ok: r?.code === 0 };
          }),
        )),
      );
    const held = timed.filter((t) => t.ms >= HELD_MS);
    assert.deepEqual(held, [], `${held.length} of ${timed.length} calls held past ${HELD_MS} ms (${beside.length} processes started beside them)`);
    assert.deepEqual(timed.filter((t) => !t.ok), []);
    assert.ok(beside.length >= 10, `processes started beside the calls: ${beside.length}`);
  } finally {
    starting = false;
    await starter;
    for (const c of beside) c.kill();
    stop.abort();
    await Promise.all(long);
  }
});
