// @ts-check
// Processes started off the server's thread. On Windows Node starts a process on the thread that asks for it, and the
// start (CreateProcess) holds that thread 15 to 25 ms for one and far longer when many start at once: fifty git runs
// asked together held the server's thread over a second in one piece, every request and stream waiting on it. Here
// each start happens on one of a few worker threads (`spawn-thread.js`), and only what the process said comes back.
// The threads start as calls need them — a second one only while the first has calls under way, so one slow start
// does not hold every other call — and none keeps the process alive while it has nothing under way. A thread that owes
// answers for calls answered here is held, and takes no new call while another thread can; where every thread is held,
// one is retired and a new one started in its place (`threadFor`).
//
// A thread answers for its calls, and this one keeps a clock on each all the same: past the call's time and
// `SPAWN_MARGIN_MS` more — or that margin past its stop — the call is answered here and its thread told to stop it,
// which it does through the process's own handle once it can, and a thread that gets to the call only then starts
// nothing — it hears every stop waiting for it before each start: a start that hangs on the thread (an antivirus
// holding CreateProcess) holds every call queued behind it, and their stops with them, and a call answered here as
// stopped must never start after its caller has gone on. A call stopped before it is asked starts nothing at all; a
// stop is answered once its process has exited. Nothing here ends a process by its id, which Windows hands to another
// process once it has ended. A thread that stops ends its calls with why and removes the files their output went to; a
// process of theirs still running is named in a warning (`SPAWN_LEFT`), with nobody to stop it. Each process started
// and ended is told on `SPAWN_CHANNEL`, for whoever traces them.
import { channel } from "node:diagnostics_channel";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

/** How many threads start processes, at most. */
export const SPAWN_THREADS = 2;
/** How long past a call's time, or past its stop, its thread may take to answer before it is answered here. */
export const SPAWN_MARGIN_MS = 10_000;
/**
 * The diagnostics channel each process the threads start is told on: `{ event: "start", pid, file, args, thread }` once
 * it has started — `thread` the id of the thread that started it —, `{ event: "exit", pid, code, signal }` once it has
 * ended. Nothing is told while nobody listens.
 */
export const SPAWN_CHANNEL = "filament.spawn";
/** The code of the warning (`process.emitWarning`) that names a process a stopped thread left running. */
export const SPAWN_LEFT = "FILAMENT_SPAWN_LEFT";

/** @typedef {import("./spawn-thread.js").Told} Told */
/** @typedef {import("./spawn-thread.js").Failure} Failure */
/** @typedef {import("./spawn-thread.js").RunOptions} RunOptions */
/**
 * What a process said: bytes where its options ask for them (`encoding: "buffer"`), else text.
 * @template {RunOptions} [O=RunOptions] @typedef {O extends { encoding: "buffer" } ? Buffer : string} Said
 */
/**
 * How a call ended, and what its process said.
 * @template {RunOptions} [O=RunOptions] @typedef {{ failure: Failure | null, stdout: Said<O>, stderr: Said<O> }} Ran
 */
/**
 * A call: its process once started, what it runs, the files its output goes to (named here, before its thread starts
 * it), and its end.
 * @typedef {{ pid: number | null, file: string, files: string[], end: (told: Told) => void }} Call
 */
/**
 * A thread: its calls under way, and `owed`, those answered here before it answered them — it is held, in a start or
 * a call that will not end, until it does. `retired`: it is given no new call, and ends once it owes nothing.
 * @typedef {{ worker: Worker, calls: Map<number, Call>, owed: Map<number, Call>, gone: string | null, retired: boolean }} Thread
 */

const told = channel(SPAWN_CHANNEL);
/** What the thread handed over: text as it is, bytes as a Buffer over the same memory. @param {string | Uint8Array} s */
const said = (s) => (typeof s === "string" ? s : Buffer.from(s.buffer, s.byteOffset, s.byteLength));
/** The clock a call's `startBy` is read by, here and on its thread: monotonic, one for the whole process, in ms. */
const clock = () => Number(process.hrtime.bigint() / 1_000_000n);
/** A process left to run with nobody to stop it, named in a warning. @param {Call} call @param {string} why */
const leftRunning = (call, why) =>
  process.emitWarning(`${call.file} (process ${call.pid}) may still be running: the thread that started it stopped (${why}), and nothing will stop it`, { code: SPAWN_LEFT });

/**
 * A pool of threads that start processes: `execFile`, each call started on one of at most `threads` threads made from
 * `url` (`spawn-thread.js`), answered here `marginMs` past its time or its stop where its thread has not.
 * @param {{ url?: URL, threads?: number, marginMs?: number }} [o]
 */
export function createSpawnPool({ url = new URL("./spawn-thread.js", import.meta.url), threads: most = SPAWN_THREADS, marginMs = SPAWN_MARGIN_MS } = {}) {
  /** The threads calls go to. @type {Thread[]} */
  const threads = [];
  /**
   * Threads given no new call, each held where every thread was: they answer what they can, and end once they owe
   * nothing. @type {Set<Thread>}
   */
  const retired = new Set();
  let lastId = 0;

  /**
   * A thread that has stopped: every call under way on it ends with the reason, and every call's files go — under way,
   * or answered here and still owed —, a process of theirs still running named (`SPAWN_LEFT`).
   */
  function lost(/** @type {Thread} */ t, /** @type {string} */ why) {
    if (t.gone) return;
    t.gone = why;
    const at = threads.indexOf(t);
    if (at >= 0) threads.splice(at, 1);
    retired.delete(t);
    /** @param {Call} call */
    const left = (call) => {
      if (call.pid != null) leftRunning(call, why);
      for (const f of call.files) rm(f, { force: true }).catch(() => {});
    };
    for (const call of t.owed.values()) left(call);
    t.owed.clear();
    for (const [id, call] of t.calls) {
      left(call);
      call.end({ id, pid: call.pid, failure: { code: "ERR_SPAWN_THREAD", killed: false, message: `the thread that starts processes stopped (${why})` }, stdout: "", stderr: "", exit: null });
    }
  }

  /** A retired thread that owes nothing and has nothing under way ends. @param {Thread} t */
  function endIfDone(t) {
    if (!t.retired || t.calls.size || t.owed.size || t.gone) return;
    t.gone = "it was retired, and owed nothing more";
    retired.delete(t);
    void t.worker.terminate();
  }

  /** A thread started: none of the process's own flags, which it needs none of and some of which refuse it (`--input-type`). */
  function startThread() {
    /** @type {Thread} */
    const t = { worker: new Worker(url, { execArgv: [] }), calls: new Map(), owed: new Map(), gone: null, retired: false };
    t.worker.unref();
    t.worker.on("message", (/** @type {Told} */ m) => {
      if ("started" in m) {
        if (told.hasSubscribers) told.publish({ event: "start", pid: m.pid, file: m.file, args: m.args, thread: t.worker.threadId });
        const call = t.calls.get(m.started) ?? t.owed.get(m.started);
        // A process started for a call answered here already: its thread was told to stop it, and does.
        if (call) call.pid = m.pid;
        // One whose thread stopped before it was heard: nobody stops it, and its files go here.
        else if (t.gone) {
          leftRunning({ pid: m.pid, file: m.file, files: m.files, end: () => {} }, t.gone);
          for (const f of m.files) rm(f, { force: true }).catch(() => {});
        }
        return;
      }
      if ("exit" in m && m.exit && m.pid != null && told.hasSubscribers) told.publish({ event: "exit", pid: m.pid, ...m.exit });
      t.owed.delete(m.id);
      t.calls.get(m.id)?.end(m);
      endIfDone(t);
    });
    t.worker.on("error", (e) => lost(t, e.message));
    t.worker.on("exit", (code) => lost(t, `it exited ${code}`));
    threads.push(t);
    return t;
  }

  /**
   * The thread a call goes to (the reviews of 11-03): one with nothing under way and nothing owed; else a new one while
   * there may be more; else, of those that owe nothing, the one with the fewest calls — a thread that owes answers is
   * held, in a start or a call that will not end, and a call given it would wait that out, so it takes none while
   * another can. Where every thread is held, the one that owes most is retired — given no new call; it answers what it
   * can once free, its processes stopped through their handles, and ends once it owes nothing — and a new one takes its
   * place, while fewer than `threads` are retired; past that, the held thread with the fewest calls and owed answers.
   */
  function threadFor() {
    const free = threads.filter((t) => !t.owed.size);
    const idle = free.find((t) => !t.calls.size);
    if (idle) return idle;
    if (threads.length < most) return startThread();
    if (free.length) return free.reduce((a, b) => (b.calls.size < a.calls.size ? b : a));
    if (retired.size < most) {
      const held = threads.reduce((a, b) => (b.owed.size > a.owed.size ? b : a));
      threads.splice(threads.indexOf(held), 1);
      held.retired = true;
      retired.add(held);
      return startThread();
    }
    const load = (/** @type {Thread} */ t) => t.calls.size + t.owed.size;
    return threads.reduce((a, b) => (load(b) < load(a) ? b : a));
  }

  /**
   * `execFile(file, args, options)` started on a thread of its own, `input` written to the process's standard input and
   * `signal` stopping it, as the same call on this thread would. Resolves with how it ended — `failure` execFile's
   * error (its `code`, whether it `killed` the process, its message), null on an exit of 0 — and what the process
   * said, as text or (`encoding: "buffer"`) bytes; rejects as execFile throws where it refuses the call outright.
   * @template {RunOptions} O
   * @param {string} file @param {string[]} args @param {O} options
   * @param {{ signal?: AbortSignal | null, input?: string | Uint8Array | null }} [how]
   * @returns {Promise<Ran<O>>}
   */
  function execFile(file, args, options, { signal = null, input = null } = {}) {
    return new Promise((resolveRan, reject) => {
      const empty = options.encoding === "buffer" ? Buffer.alloc(0) : "";
      // Stopped before it is asked: nothing starts.
      if (signal?.aborted) {
        resolveRan(/** @type {Ran<O>} */ ({ failure: { code: "ABORT_ERR", killed: false, message: "The operation was aborted" }, stdout: empty, stderr: empty }));
        return;
      }
      const t = threadFor();
      const id = ++lastId;
      const time = options.timeout && options.timeout > 0 ? options.timeout : null;
      // The files its output goes to, named for the process, the thread and the call: known here before it starts, so a
      // thread that stops at any moment leaves none behind.
      const base = join(tmpdir(), `filament-spawn-${process.pid}-${t.worker.threadId}-${id}`);
      const files = [`${base}.stdout`, `${base}.stderr`];
      // An option that cannot go to another thread throws here, before anything waits on the call.
      t.worker.postMessage({ run: { id, file, args, options, input, files, startBy: time == null ? null : clock() + time + marginMs } });
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let late;
      /** The call answered here, and its thread told to stop it: the thread owes its own answer still. @param {Failure} failure */
      const answer = (failure) => {
        t.owed.set(id, call);
        t.worker.postMessage({ stop: id });
        call.end({ id, pid: call.pid, failure, stdout: "", stderr: "", exit: null });
      };
      const onStop = () => {
        t.worker.postMessage({ stop: id });
        clearTimeout(late);
        late = setTimeout(() => answer({ code: "ABORT_ERR", killed: false, message: "The operation was aborted" }), marginMs);
      };
      /** @type {Call} */
      const call = {
        pid: null,
        file,
        files,
        end: (m) => {
          if (t.calls.get(id) !== call) return;
          t.calls.delete(id);
          clearTimeout(late);
          if (!t.calls.size) t.worker.unref();
          signal?.removeEventListener("abort", onStop);
          if ("thrown" in m) reject(Object.assign(new Error(m.thrown.message), { name: m.thrown.name, code: m.thrown.code }));
          else if ("failure" in m)
            resolveRan(/** @type {Ran<O>} */ ({ failure: m.failure, stdout: m.stdout === "" ? empty : said(m.stdout), stderr: m.stderr === "" ? empty : said(m.stderr) }));
        },
      };
      t.calls.set(id, call);
      t.worker.ref();
      if (time != null) late = setTimeout(() => answer({ code: null, killed: true, message: `${file} ran past its time, and its thread did not answer` }), time + marginMs);
      signal?.addEventListener("abort", onStop, { once: true });
    });
  }

  return { execFile };
}

const pool = createSpawnPool();
/** `execFile` on the threads of this process's pool (`createSpawnPool`). */
export const execFileOffThread = pool.execFile;
