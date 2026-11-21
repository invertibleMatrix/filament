// @ts-check
// git's processes start off the server's thread (`adapters/git/spawn-pool.js`): on Windows a process starts on the
// thread that asks for it, and fifty git runs asked together held the server's thread over a second in one piece while
// theirs started (the owner's report of 11-02, "filament starts crawling"). `git()` answers as it did — an exit, what
// git read and said, a timeout, a stop, an answer cut at its cap, a missing git, a call refused outright — the files
// git's output went to are gone once it is answered, and the threads keep no process alive with nothing under way.
// Every repository here is a throwaway under the temp folder.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import childProcess, { execFileSync, spawnSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { git } from "../src/adapters/git/snapshot.js";
import { createSpawnPool, SPAWN_CHANNEL } from "../src/adapters/git/spawn-pool.js";

/** The code of the warning that names a process a stopped thread left running (`SPAWN_LEFT`). */
const SPAWN_LEFT = "FILAMENT_SPAWN_LEFT";

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
/** @param {string} cwd @param {string[]} args */
const run = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", env: ENV, windowsHide: true }).trim();
/** git's name for a blob of "hello\n". */
const HELLO = "ce013625030ba8dba906f756967f9e9ca394464a";
/** A throwaway repository with one commit. */
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-spawn-"));
  made.push(dir);
  run(dir, ["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, "a.txt"), "one\n");
  run(dir, ["add", "."]);
  run(dir, ["commit", "-q", "-m", "init"]);
  return dir;
};

// (fails before: yes — git's process started on the calling thread, through its execFile: one call each)
test("a git run starts no process on the server's thread", { skip }, async (t) => {
  const dir = repo();
  const execFile = t.mock.method(childProcess, "execFile");
  const spawn = t.mock.method(childProcess, "spawn");
  syncBuiltinESMExports();
  t.after(() => {
    execFile.mock.restore();
    spawn.mock.restore();
    syncBuiltinESMExports();
  });
  const r = await git(["rev-parse", "--show-toplevel"], { cwd: dir });
  assert.deepEqual([r.code, r.error, !!r.out], [0, null, true]);
  assert.deepEqual([execFile.mock.callCount(), spawn.mock.callCount()], [0, 0]);
});

// (fails before: yes — fifty runs at once held the thread 1.0 to 1.9 s in one piece on Windows; a generous bound, so a
// loaded machine's pauses do not fail it)
test("fifty git runs asked together never hold the server's thread for long", { skip }, async () => {
  const dir = repo();
  await git(["rev-parse", "HEAD"], { cwd: dir });
  let longest = 0;
  let last = performance.now();
  const tick = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  }, 10);
  try {
    const all = await Promise.all(Array.from({ length: 50 }, () => git(["rev-parse", "--show-toplevel", "--verify", "-q", "HEAD"], { cwd: dir })));
    assert.deepEqual(all.filter((r) => r.code !== 0), []);
  } finally {
    clearInterval(tick);
  }
  assert.ok(longest < 500, `the thread was held ${Math.round(longest)} ms at once`);
});

test("git answers as before: an exit, its words, what it read, a missing folder, a call refused outright", { skip }, async () => {
  const dir = repo();
  const head = run(dir, ["rev-parse", "HEAD"]);
  assert.deepEqual(await git(["rev-parse", "HEAD"], { cwd: dir }), { code: 0, out: head, err: "", error: null });
  const nope = await git(["rev-parse", "--verify", "nope"], { cwd: dir });
  assert.deepEqual([nope.code, nope.out, nope.error], [128, "", null]);
  assert.match(nope.err, /^fatal: /);
  const hashed = await git(["hash-object", "--stdin"], { cwd: dir, input: "hello\n" });
  assert.deepEqual(hashed, { code: 0, out: HELLO, err: "", error: null });
  const gone = await git(["--version"], { cwd: join(dir, "gone") });
  assert.deepEqual(gone, { code: -1, out: "", err: "", error: `the folder git was asked to work in does not exist (${join(dir, "gone")})` });
  await assert.rejects(git(["a\0b"], { cwd: dir }), { name: "TypeError", code: "ERR_INVALID_ARG_VALUE" });
});

/**
 * What `fn` gives, how long it took, and the processes the pool started meanwhile.
 * @template T @param {() => Promise<T>} fn @returns {Promise<{ value: T, ms: number, pids: number[] }>}
 */
const watched = async (fn) => {
  /** @type {number[]} */
  const pids = [];
  const on = (/** @type {any} */ m) => void (m.event === "start" && pids.push(m.pid));
  subscribe(SPAWN_CHANNEL, on);
  const started = performance.now();
  try {
    const value = await fn();
    return { value, ms: performance.now() - started, pids };
  } finally {
    unsubscribe(SPAWN_CHANNEL, on);
  }
};
/** Whether a process runs. @param {number} pid */
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// (fails before: yes — with no stop sent to the thread the calls still came back abandoned, after git's own 60 s, or
// the pool's margin; now each is answered within seconds, and its process is gone)
test("git answers as before: a timeout, a stop under way, a stop before it starts — each soon, its process ended", { skip }, async () => {
  const dir = repo();
  // hash-object --stdin with nothing written waits on its input until it is ended: only a timeout or a stop ends it.
  const timedOut = await watched(() => git(["hash-object", "--stdin"], { cwd: dir, timeoutMs: 1000 }));
  assert.deepEqual(timedOut.value, { code: -1, out: "", err: "", error: "git hash-object timed out", timedOut: true });
  assert.ok(timedOut.ms < 4000, `timed out after ${Math.round(timedOut.ms)} ms`);
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 300);
  const abandoned = { code: -1, out: "", err: "", error: "git hash-object was abandoned (the request ended)" };
  const under = await watched(() => git(["hash-object", "--stdin"], { cwd: dir, signal: stop.signal }));
  assert.deepEqual(under.value, abandoned);
  assert.ok(under.ms < 3000, `stopped under way, answered after ${Math.round(under.ms)} ms`);
  const before = await watched(() => git(["hash-object", "--stdin"], { cwd: dir, signal: AbortSignal.abort() }));
  assert.deepEqual(before.value, abandoned);
  assert.ok(before.ms < 3000, `stopped before it started, answered after ${Math.round(before.ms)} ms`);
  const pids = [...timedOut.pids, ...under.pids, ...before.pids];
  assert.ok(timedOut.pids.length === 1 && under.pids.length === 1, `the processes started: ${pids}`);
  assert.deepEqual(pids.filter(alive), [], "each process is gone once its call is answered");
});

// A stop's answer is what a settle read waits for before an Apply writes: on Windows the process a stop has not yet
// ended still holds the files it reads. A program that runs on, fed more than a pipe holds — one reading it as git's
// `cat-file --batch` and `hash-object --stdin-paths` read theirs, one never reading it — is stopped under way.
test("a stop is answered once its process has exited, never at the stop: one reading its input, one that never reads it", async () => {
  const pool = createSpawnPool();
  const input = Buffer.alloc(16 * 1024 * 1024, 120);
  for (const [why, script] of [
    ["reading its input", "process.stdin.resume(); setInterval(() => {}, 1000);"],
    ["never reading it", "setInterval(() => {}, 1000);"],
  ]) {
    /** @type {Map<number, number>} */
    const exited = new Map();
    let pid = 0;
    /** @type {() => void} */
    let came = () => {};
    const started = new Promise((r) => (came = () => r(undefined)));
    const on = (/** @type {any} */ m) => {
      if (m.event === "start" && m.file === process.execPath) {
        pid = m.pid;
        came();
      } else if (m.event === "exit") exited.set(m.pid, performance.now());
    };
    subscribe(SPAWN_CHANNEL, on);
    try {
      const stop = new AbortController();
      const call = pool.execFile(process.execPath, ["-e", script], { timeout: 60_000, windowsHide: true, encoding: "buffer" }, { signal: stop.signal, input });
      await started;
      await new Promise((r) => setTimeout(r, 300));
      stop.abort();
      const r = await call;
      const at = performance.now();
      assert.equal(r.failure?.code, "ABORT_ERR", why);
      assert.ok((exited.get(pid) ?? Infinity) <= at, `${why}: its exit told before its answer`);
      assert.equal(alive(pid), false, `${why}: its process gone at its answer`);
    } finally {
      unsubscribe(SPAWN_CHANNEL, on);
      if (pid && alive(pid)) process.kill(pid);
    }
  }
});

// (fails before: yes — the review of 11-03: a call stopped while it waited behind another's start was started once its
// thread got to it — its process holding the thread 15 to 25 ms — and then stopped; one stopped before it was asked too)
test("a call stopped while it waits behind another's start, or before it is asked, starts nothing, and is answered as stopped", { skip }, async () => {
  const dir = repo();
  const pool = createSpawnPool({ threads: 1 });
  // Its thread started and idle.
  await pool.execFile("git", ["--version"], { cwd: dir, timeout: 60_000, windowsHide: true });
  const behind = new AbortController();
  const asked = watched(async () => {
    // The first holds the thread in its start (CreateProcess, milliseconds) while the second is asked and stopped.
    const first = pool.execFile("git", ["rev-parse", "--verify", "HEAD"], { cwd: dir, timeout: 60_000, windowsHide: true });
    const second = pool.execFile("git", ["hash-object", "--stdin"], { cwd: dir, timeout: 60_000, windowsHide: true }, { signal: behind.signal });
    behind.abort();
    return Promise.all([first, second]);
  });
  const { value: [first, r], ms, pids } = await asked;
  assert.equal(first.failure, null);
  assert.deepEqual([r.failure?.code, pids.length], ["ABORT_ERR", 1], "the first started; the stopped one did not");
  assert.ok(ms < 3000, `answered after ${Math.round(ms)} ms`);
  const before = await watched(() => pool.execFile("git", ["hash-object", "--stdin"], { cwd: dir, timeout: 60_000, windowsHide: true }, { signal: AbortSignal.abort() }));
  assert.deepEqual([before.value.failure?.code, before.pids], ["ABORT_ERR", []], "stopped before it was asked: nothing started");
  assert.ok(before.ms < 1000, `answered after ${Math.round(before.ms)} ms`);
});

test("git answers as before: an answer past its cap is cut there, the rest never read", { skip }, async () => {
  const dir = repo();
  writeFileSync(join(dir, "big.txt"), "x".repeat(9 * 1024 * 1024));
  const blob = run(dir, ["hash-object", "-w", "big.txt"]);
  const big = await git(["cat-file", "-p", blob], { cwd: dir });
  assert.deepEqual([big.code, big.cut, big.timedOut, big.out.length], [-1, true, undefined, 8 * 1024 * 1024]);
});

// (fails before: yes — the cap counted bytes and cut where it fell, a character's first byte decoded as U+FFFD)
test("an answer cut at its cap ends on a whole character", { skip }, async () => {
  const dir = repo();
  // One byte, then two-byte characters: the cap, an even number of bytes, falls inside one.
  writeFileSync(join(dir, "wide.txt"), `a${"é".repeat(5 * 1024 * 1024)}`);
  const blob = run(dir, ["hash-object", "-w", "wide.txt"]);
  const big = await git(["cat-file", "-p", blob], { cwd: dir });
  assert.deepEqual([big.cut, big.out.includes("�"), big.out.length, Buffer.byteLength(big.out)], [true, false, (8 * 1024 * 1024) / 2, 8 * 1024 * 1024 - 1]);
});

test("a git past its time answers with what it said up to there", { skip }, async () => {
  const dir = repo();
  const r = await git(["-c", "alias.slow=!echo said; sleep 5", "slow"], { cwd: dir, timeoutMs: 1500 });
  assert.deepEqual([r.timedOut, r.out, r.error], [true, "said", "git slow timed out"]);
});

// (fails before: yes — the files' own error, ENOENT where the temp folder is gone, read as "git is not installed")
test("a pool thread that cannot make the files a process's output goes to says so, not that the program is missing", { skip }, async () => {
  const dir = repo();
  const was = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
  // A thread takes the environment as it stands when it starts.
  const nowhere = join(dir, "no-such-folder");
  Object.assign(process.env, { TEMP: nowhere, TMP: nowhere, TMPDIR: nowhere });
  try {
    const pool = createSpawnPool();
    const r = await pool.execFile("git", ["--version"], { cwd: dir, timeout: 60_000, windowsHide: true });
    assert.equal(r.failure?.code, "ERR_SPAWN_FILES");
    assert.match(String(r.failure?.message), /^the files the process's output goes to could not be made \(.+no-such-folder.+\)$/);
  } finally {
    for (const [k, v] of Object.entries(was)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
});

// (fails before: yes — a process's id went out on its next tick, and a thread that stopped first left it unnamed)
test("a thread that stops the moment it has started a process still names it", { skip }, async () => {
  const dir = repo();
  const pool = createSpawnPool({ url: new URL("./fixtures/spawn-thread-dies-at-once.js", import.meta.url), threads: 1 });
  /** @type {any[]} */
  const warned = [];
  const onWarning = (/** @type {any} */ w) => void (w.code === SPAWN_LEFT && warned.push(w));
  process.on("warning", onWarning);
  /** @type {number[]} */
  const pids = [];
  const on = (/** @type {any} */ m) => void (m.event === "start" && pids.push(m.pid));
  subscribe(SPAWN_CHANNEL, on);
  try {
    // A git that runs on whatever happens to its input: its alias holds it for 10 s.
    const r = await pool.execFile("git", ["-c", "alias.hold=!sleep 10", "hold"], { cwd: dir, timeout: 60_000, windowsHide: true });
    assert.equal(r.failure?.code, "ERR_SPAWN_THREAD");
    await new Promise((done) => setImmediate(done));
    assert.equal(pids.length, 1);
    assert.deepEqual(warned.map((w) => w.message), [`git (process ${pids[0]}) may still be running: the thread that started it stopped (the thread broke at once), and nothing will stop it`]);
  } finally {
    process.off("warning", onWarning);
    unsubscribe(SPAWN_CHANNEL, on);
    for (const pid of pids) alive(pid) && process.kill(pid);
  }
});

/** The files the pool's threads in this process write calls' output to, as they stand. */
const ownFiles = () => readdirSync(tmpdir()).filter((n) => n.startsWith(`filament-spawn-${process.pid}-`));

test("the files a call's output goes to are gone once it is answered: an exit, a failure, a cut, a timeout, a stop", { skip }, async () => {
  const dir = repo();
  writeFileSync(join(dir, "big.txt"), "x".repeat(9 * 1024 * 1024));
  const blob = run(dir, ["hash-object", "-w", "big.txt"]);
  await Promise.all([
    git(["rev-parse", "HEAD"], { cwd: dir }),
    git(["rev-parse", "--verify", "nope"], { cwd: dir }),
    git(["cat-file", "-p", blob], { cwd: dir }),
    git(["hash-object", "--stdin"], { cwd: dir, timeoutMs: 1000 }),
    git(["hash-object", "--stdin"], { cwd: dir, signal: AbortSignal.timeout(300) }),
  ]);
  assert.deepEqual(ownFiles(), []);
});

// A process of its own, started with a flag a thread started from a file refuses (`--input-type`): the threads take
// none of the process's flags. (fails before: yes, the files — a thread answered before it removed them, and a process
// that ended with its last answer took the thread with it, the files left behind)
test("the threads keep no process alive with nothing under way, keep it alive while a run is, and leave no files as it ends", { skip }, () => {
  const dir = repo();
  const url = pathToFileURL(join(import.meta.dirname, "..", "src", "adapters", "git", "snapshot.js")).href;
  // The process ends the moment it has its answer, its threads with it, as a command-line run does.
  const script = `const { git } = await import(${JSON.stringify(url)}); const r = await git(["hash-object", "--stdin"], { cwd: ${JSON.stringify(dir)}, input: "hello\\n" }); process.stdout.write(r.out + "\\n", () => process.exit(0));`;
  for (let i = 0; i < 6; i++) {
    const p = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 30_000, windowsHide: true });
    assert.deepEqual([p.signal, p.status, p.stdout.trim()], [null, 0, HELLO]);
    assert.deepEqual(readdirSync(tmpdir()).filter((n) => n.startsWith(`filament-spawn-${p.pid}-`)), [], "no file of its calls is left");
  }
});
