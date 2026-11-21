// @ts-check
// The pool keeps a clock on each call its threads run (`adapters/git/spawn-pool.js`): a thread held in a start (an
// antivirus holding CreateProcess) holds its own timers and every call queued behind it, stops included. Past a call's
// time and the pool's margin, or that margin past its stop, the call is answered on the pool's side and its thread
// told to stop it, which it does through the process's handle once it is free; a call the thread gets to only after
// that starts nothing. A thread that stops ends its calls with why and removes their files; a process of theirs still
// running is named in a warning. Nothing ends a process by its id: Windows hands an ended process's id to another.
// The threads here are the real one wrapped by a fixture that hangs or breaks it. Every repository is a throwaway.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createSpawnPool, SPAWN_CHANNEL } from "../src/adapters/git/spawn-pool.js";

/** The code of the warning that names a process a stopped thread left running (`SPAWN_LEFT`). */
const SPAWN_LEFT = "FILAMENT_SPAWN_LEFT";

/** How long `fixtures/spawn-thread-hangs-marked.js` holds its thread (its own `HANG_MS`): a call that waited it out would wait seconds. */
const MARKED_HANG_MS = 8000;

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
  const dir = mkdtempSync(join(tmpdir(), "filament-deadline-"));
  made.push(dir);
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const run = (/** @type {string[]} */ args) => execFileSync("git", args, { cwd: dir, env, windowsHide: true });
  run(["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, "a.txt"), "one\n");
  run(["add", "."]);
  run(["commit", "-q", "-m", "init"]);
  return dir;
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
/** A process a test left running, ended — one that ended meanwhile is no error. @param {number} pid */
const stopLeft = (pid) => {
  try {
    process.kill(pid);
  } catch {}
};
/** Whether a process has ended within a few seconds (an end asked of Windows takes a moment). @param {number} pid */
const ends = async (pid) => {
  for (let i = 0; i < 100 && alive(pid); i++) await sleep(20);
  return !alive(pid);
};
/** The processes the pools start, as told on the channel: each with the thread that started it. */
const started = () => {
  /** @type {{ pid: number, args: string[], thread: number }[]} */
  const seen = [];
  const on = (/** @type {any} */ m) => void (m.event === "start" && seen.push({ pid: m.pid, args: m.args, thread: m.thread }));
  subscribe(SPAWN_CHANNEL, on);
  return { seen, done: () => unsubscribe(SPAWN_CHANNEL, on) };
};
/**
 * How long a thread started for a call may take to boot and start its first process, under a full run's load: seconds
 * (the runs of 11-10: over 5 s, and 7.3 s). What a test here claims is where a call goes, which the thread its process
 * started on says, never how soon a new thread is up.
 */
const BOOT_MS = 60_000;
/**
 * A pool's `n` threads started and idle, one call on each at once: a held call then starts on a thread already up,
 * before the pool answers for it — a thread still booting past that would hear its stop first and start nothing.
 * @param {ReturnType<typeof createSpawnPool>} pool @param {string} dir @param {number} n
 */
const warm = async (pool, dir, n) => {
  const runs = await Promise.all(Array.from({ length: n }, () => pool.execFile("git", ["rev-parse", "--verify", "HEAD"], how(dir, BOOT_MS))));
  assert.deepEqual(runs.map((r) => r.failure), runs.map(() => null), "the threads are up");
};
/**
 * The process a call with these arguments started, as told on the channel.
 * @template {{ args: string[] }} T @param {T[]} seen @param {string} arg @returns {T | undefined}
 */
const startOf = (seen, arg) => seen.find((s) => s.args.includes(arg));
/** The files the pools' threads in this process write calls' output to, as they stand. */
const ownFiles = () => readdirSync(tmpdir()).filter((n) => n.startsWith(`filament-spawn-${process.pid}-`));
/** @param {string} dir @param {number} timeout */
const how = (dir, timeout) => ({ cwd: dir, env: /** @type {Record<string, string>} */ (process.env), timeout, maxBuffer: 1024 * 1024, windowsHide: true });

// (fails before: yes — a call queued behind a held start, its stop with it, waited for the start; a call running when
// its thread was held ran on past its time, its process too. On a thread already up since 11-11, as the three below: the
// call's 500 ms and the margin were all a new thread had to boot and start its process in, and one still booting past
// them hears the call's stop first and starts nothing — no thread held, and the queued call writes its ref)
test("a thread held in a start: its calls are answered past their time and the margin, their processes ended by it once it is free, and a call it gets to late starts nothing", { skip }, async () => {
  const dir = repo();
  const pool = createSpawnPool({ url: new URL("./fixtures/spawn-thread-hangs-marked.js", import.meta.url), threads: 1, marginMs: 300 });
  await warm(pool, dir, 1);
  const watch = started();
  try {
    const t0 = performance.now();
    const since = () => Math.round(performance.now() - t0);
    // Waits on its input, so only a timeout or a stop ends it: its start is the one the thread is then held after.
    const running = pool.execFile("git", ["-c", "filament.hang=1", "hash-object", "--stdin"], how(dir, 2000)).then((r) => ({ r, at: since() }));
    // The thread is held from the moment it has told that start.
    for (let i = 0; i < 250 && !watch.seen.length; i++) await sleep(20);
    assert.equal(watch.seen.length, 1, "the running call's process started: its thread is held");
    // The hold began before this, and no sooner than the call was asked.
    const heldBy = since();
    // A ref it would write, were it ever started.
    const queued = pool.execFile("git", ["update-ref", "refs/heads/late", "HEAD"], how(dir, 200)).then((r) => ({ r, at: since() }));
    const stop = new AbortController();
    const stopped = pool.execFile("git", ["version"], how(dir, 60_000), { signal: stop.signal }).then((r) => ({ r, at: since() }));
    setTimeout(() => stop.abort(), 100);
    const [a, b, c] = await Promise.all([running, queued, stopped]);
    assert.deepEqual([a.r.failure?.code, a.r.failure?.killed], [null, true], "past its time: answered as timed out");
    assert.deepEqual([b.r.failure?.code, b.r.failure?.killed], [null, true], "queued past its time: answered as timed out");
    assert.equal(c.r.failure?.code, "ABORT_ERR", "stopped while queued: answered as stopped");
    // The thread is held `MARKED_HANG_MS` from its start, which came after the call was asked: an answer sooner than
    // that after the asking came while it was held.
    const bound = MARKED_HANG_MS - 500;
    assert.ok(a.at < bound && b.at < bound && c.at < bound, `answered while the thread was still held: ${a.at}, ${b.at}, ${c.at} ms`);
    assert.equal(watch.seen.length, 1, "one process started: the running call's");
    // Nothing here ends it by its id: its thread does, through its handle, once it is free again.
    await sleep(300);
    assert.equal(alive(watch.seen[0].pid), true, "the running call's process runs on while its thread is held");
    await sleep(Math.max(0, heldBy + MARKED_HANG_MS - since()));
    assert.ok(await ends(watch.seen[0].pid), "and is ended by its thread once that is free");
    // Once the thread is free again, the call answered past its time while queued starts nothing.
    await sleep(Math.max(0, heldBy + MARKED_HANG_MS + 300 - since()));
    const after = await pool.execFile("git", ["rev-parse", "--verify", "-q", "refs/heads/late"], how(dir, 60_000));
    assert.deepEqual([after.failure?.code, after.stdout], [1, ""], "the queued call wrote nothing");
    // (fails before: yes — the review of 11-03: the call stopped while queued, answered here as stopped, started once
    // its thread was free — a settle read's git on the developer's files after the Apply that stopped it had written)
    assert.deepEqual(watch.seen.map((s) => s.args.join(" ")), ["-c filament.hang=1 hash-object --stdin", "rev-parse --verify -q refs/heads/late"], "no process started for either: the stopped call neither");
  } finally {
    watch.done();
  }
});

// (fails before: yes — the review of 11-03: a thread whose held call was answered here looked idle, took the next call,
// and that call waited the hold out — every stop of a call on it too. Asked by its thread since spawn-held of 11-11: a
// bound of 4 s on the next call measured a new thread's boot under a full run's load, 7.3 s once)
test("a thread held in a start, its call answered here, is given no new call while another thread can take it", { skip }, async () => {
  const dir = repo();
  const pool = createSpawnPool({ url: new URL("./fixtures/spawn-thread-hangs-marked.js", import.meta.url), threads: 2, marginMs: 300 });
  await warm(pool, dir, 2);
  const watch = started();
  try {
    // Waits on its input; its thread is held once it has started.
    const held = await pool.execFile("git", ["-c", "filament.hang=1", "hash-object", "--stdin"], how(dir, 2000));
    assert.deepEqual([held.failure?.code, held.failure?.killed], [null, true], "answered here, past its time and the margin");
    const t0 = performance.now();
    const next = await pool.execFile("git", ["rev-parse", "--verify", "HEAD"], how(dir, BOOT_MS));
    const ms = Math.round(performance.now() - t0);
    assert.equal(next.failure, null);
    const [hold, went] = [startOf(watch.seen, "filament.hang=1"), startOf(watch.seen, "rev-parse")];
    assert.ok(hold && went, `the held call's process and the next one's: ${JSON.stringify(watch.seen)}`);
    assert.notEqual(went.thread, hold.thread, `the next call ran on the held thread ${hold.thread}, answered after ${ms} ms`);
    // The held thread, free again, answers what it owed, and takes calls again.
    await sleep(MARKED_HANG_MS);
    const again = await Promise.all([1, 2].map(() => pool.execFile("git", ["rev-parse", "--verify", "HEAD"], how(dir, 60_000))));
    assert.deepEqual(again.map((r) => r.failure), [null, null]);
  } finally {
    watch.done();
    for (const s of watch.seen) stopLeft(s.pid);
  }
});

// (fails before: yes — the review of 11-03: with both threads started, a held one owing one answer tied with one running
// one call, and the tie went to the held thread: the call waited the hold out. Asked by its thread since spawn-held of
// 11-11: the second thread's first process, waited for 5 s, came later under a full run's load)
test("both threads started, one held and one busy: a new call goes to the busy one, never the held one", { skip }, async () => {
  const dir = repo();
  const pool = createSpawnPool({ url: new URL("./fixtures/spawn-thread-hangs-marked.js", import.meta.url), threads: 2, marginMs: 300 });
  await warm(pool, dir, 2);
  const watch = started();
  const busy = new AbortController();
  try {
    // The first thread is held once the marked call has started; the second runs a git that waits on its input.
    const held = pool.execFile("git", ["-c", "filament.hang=1", "hash-object", "--stdin"], how(dir, 2000));
    const t1 = performance.now();
    while (!watch.seen.length && performance.now() - t1 < BOOT_MS) await sleep(20);
    const running = pool.execFile("git", ["hash-object", "--stdin"], how(dir, BOOT_MS), { signal: busy.signal });
    while (watch.seen.length < 2 && performance.now() - t1 < BOOT_MS) await sleep(20);
    assert.equal(watch.seen.length, 2, "both threads have a process");
    const [hold, run] = watch.seen;
    assert.ok(hold.args.includes("filament.hang=1") && run.thread !== hold.thread, `the busy call has a thread of its own: ${JSON.stringify(watch.seen)}`);
    const answered = await held;
    assert.deepEqual([answered.failure?.code, answered.failure?.killed], [null, true], "the held call answered here");
    const t0 = performance.now();
    const next = await pool.execFile("git", ["rev-parse", "--verify", "HEAD"], how(dir, 60_000));
    const ms = Math.round(performance.now() - t0);
    assert.equal(next.failure, null);
    const went = startOf(watch.seen, "rev-parse");
    assert.ok(went, JSON.stringify(watch.seen));
    assert.equal(went.thread, run.thread, `the next call ran on the held thread ${hold.thread}, answered after ${ms} ms`);
    busy.abort();
    assert.equal((await running).failure?.code, "ABORT_ERR");
  } finally {
    busy.abort();
    watch.done();
    for (const s of watch.seen) stopLeft(s.pid);
  }
});

// (fails before: yes — the same review: a thread held for good was never replaced, and every call went to it)
test("every thread held: one is retired, a new one takes the call, and the retired one answers what it owes once free", { skip }, async () => {
  const dir = repo();
  const pool = createSpawnPool({ url: new URL("./fixtures/spawn-thread-hangs-marked.js", import.meta.url), threads: 1, marginMs: 300 });
  await warm(pool, dir, 1);
  const watch = started();
  try {
    const held = await pool.execFile("git", ["-c", "filament.hang=1", "hash-object", "--stdin"], how(dir, 2000));
    assert.equal(held.failure?.killed, true, "answered here, its only thread held");
    const t0 = performance.now();
    const next = await pool.execFile("git", ["rev-parse", "--verify", "HEAD"], how(dir, BOOT_MS));
    const ms = Math.round(performance.now() - t0);
    assert.equal(next.failure, null);
    // Asked by its thread, as the two above (spawn-held of 11-11): a new thread's boot is no measure of where it went.
    const [hold, went] = [startOf(watch.seen, "filament.hang=1"), startOf(watch.seen, "rev-parse")];
    assert.ok(hold && went, `the held call's process and the next one's: ${JSON.stringify(watch.seen)}`);
    assert.notEqual(went.thread, hold.thread, `the next call ran on the held thread ${hold.thread}, answered after ${ms} ms`);
    // Once free, the retired thread ends the process it held through its handle.
    await sleep(MARKED_HANG_MS);
    assert.ok(await ends(hold.pid), "the held call's process is ended once its thread is free");
  } finally {
    watch.done();
    for (const s of watch.seen) stopLeft(s.pid);
  }
});

// (fails before: yes — the Hunter's of 11-03: the pool learnt a call's files from its thread's word of the start, and a
// thread that stopped before that word left them in the temp folder for good)
test("a thread that stops between a process's start and its word of it leaves no file of the call behind", { skip }, async () => {
  const dir = repo();
  const pool = createSpawnPool({ url: new URL("./fixtures/spawn-thread-dies-before-told.js", import.meta.url), threads: 1 });
  const r = await pool.execFile("git", ["--version"], how(dir, 60_000));
  assert.equal(r.failure?.code, "ERR_SPAWN_THREAD");
  for (let i = 0; i < 100 && ownFiles().length; i++) await sleep(20);
  assert.deepEqual(ownFiles(), [], "the call's files are removed");
});

// (fails before: yes — the review of 11-03: a call's latest start was set by the pool's wall clock and read by its
// thread's, and a jump of the system's time failed every call queued)
test("a jump of the wall clock fails no call: its latest start is read on the monotonic clock", { skip }, async () => {
  const dir = repo();
  const pool = createSpawnPool({ url: new URL("./fixtures/spawn-thread-wall-clock-jumped.js", import.meta.url), threads: 1 });
  const r = await pool.execFile("git", ["rev-parse", "--verify", "HEAD"], how(dir, 60_000));
  assert.equal(r.failure, null, JSON.stringify(r.failure));
});

// (fails before: yes — the same review: a call its thread got to too late was answered killed: false, which git() read
// as no timeout, where the pool's own clock answers it timed out)
test("a call its thread gets to past its time starts nothing, and is answered as timed out", { skip }, async () => {
  const dir = repo();
  const pool = createSpawnPool({ url: new URL("./fixtures/spawn-thread-late.js", import.meta.url), threads: 1 });
  const watch = started();
  try {
    const r = await pool.execFile("git", ["rev-parse", "--verify", "HEAD"], how(dir, 60_000));
    assert.deepEqual([r.failure?.code, r.failure?.killed], [null, true], JSON.stringify(r.failure));
    assert.match(String(r.failure?.message), /ran past its time/);
    assert.deepEqual(watch.seen, [], "nothing started");
  } finally {
    watch.done();
  }
});

// (fails before: yes — a stopped thread's processes were ended by their ids, which Windows may have handed to another
// process by then, and no word named one)
test("a thread that stops ends its calls with why and removes their files; a process still running is named, never ended by its id; the next call starts another thread", { skip }, async () => {
  const dir = repo();
  const pool = createSpawnPool({ url: new URL("./fixtures/spawn-thread-dies.js", import.meta.url), threads: 1 });
  const watch = started();
  /** @type {Error[]} */
  const warned = [];
  const onWarning = (/** @type {Error} */ w) => void (/** @type {any} */ (w).code === SPAWN_LEFT && warned.push(w));
  process.on("warning", onWarning);
  try {
    const t0 = performance.now();
    // A git that runs on whatever happens to its input: its alias holds it for 15 s.
    const r = await pool.execFile("git", ["-c", "alias.hold=!sleep 15", "hold"], how(dir, 60_000));
    const ms = performance.now() - t0;
    assert.equal(r.failure?.code, "ERR_SPAWN_THREAD");
    assert.match(String(r.failure?.message), /^the thread that starts processes stopped \(the thread broke\)$/);
    assert.ok(ms < 5000, `answered when its thread stopped, after ${Math.round(ms)} ms`);
    assert.equal(watch.seen.length, 1);
    const { pid } = watch.seen[0];
    await sleep(300);
    assert.equal(alive(pid), true, "its process runs on: nothing ends it by its id");
    assert.deepEqual(warned.map((w) => w.message), [`git (process ${pid}) may still be running: the thread that started it stopped (the thread broke), and nothing will stop it`]);
    for (let i = 0; i < 100 && ownFiles().length; i++) await sleep(20);
    assert.deepEqual(ownFiles(), [], "and the files its output went to are removed");
    const next = await pool.execFile("git", ["rev-parse", "--verify", "HEAD"], how(dir, 60_000));
    assert.deepEqual([next.failure, /^[0-9a-f]{40}$/.test(next.stdout.trim())], [null, true]);
  } finally {
    process.off("warning", onWarning);
    watch.done();
    for (const s of watch.seen) stopLeft(s.pid);
  }
});

// (fails before: yes — a Filament that ended mid-call left its calls' files in the temp folder for good)
test("a thread that starts removes the calls' files a process that no longer runs left, and no running one's", { skip }, async () => {
  const dir = repo();
  // An id no process has (Windows' are multiples of four, and none runs this high), and one that runs.
  const gone = 999_999_996;
  const live = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore", windowsHide: true });
  const name = (/** @type {number} */ pid, /** @type {string} */ s) => join(tmpdir(), `filament-spawn-${pid}-1-1.${s}`);
  const left = [name(gone, "stdout"), name(gone, "stderr")];
  const kept = name(Number(live.pid), "stdout");
  try {
    for (const f of [...left, kept]) writeFileSync(f, "what a call said\n");
    const pool = createSpawnPool();
    const r = await pool.execFile("git", ["rev-parse", "--verify", "HEAD"], how(dir, 60_000));
    assert.equal(r.failure, null);
    for (let i = 0; i < 150 && left.some(existsSync); i++) await sleep(20);
    assert.deepEqual([...left.map(existsSync), existsSync(kept)], [false, false, true]);
  } finally {
    live.kill();
    for (const f of [...left, kept]) rmSync(f, { force: true });
  }
});
