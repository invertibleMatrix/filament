// @ts-check
// A thread git's processes start on, one of `spawn-pool.js`'s: on Windows a process starts on the thread that asks for
// it, and the start alone holds that thread tens of milliseconds — far longer with many starting at once.
//
// What a process says goes to two files, never to pipes. On Windows a start hands the new process every handle open to
// be inherited at that moment (libuv's CreateProcessW inherits them all), and the end of a pipe a starting process
// writes to is one until its own start returns. With starts on several threads at once, a process that lives on — an
// agent, a server, a test command, a clone — would hold a git's pipe open, and a call answered at the end of git's
// output would wait for that process. A file another process holds changes nothing: the call is answered once git has
// exited, from what its files hold, and they are removed. Standard input stays a pipe: git reads to its end when the
// end this thread writes is closed, and that end is never handed on. The files are named by the pool for the process,
// the thread and the call (`filament-spawn-<pid>-<thread>-<id>`), in the call it asks: those of a thread that stops
// mid-call — before or after its start — are removed by the pool, which knows their names; those of a Filament that
// ended mid-call, by the next thread that starts anywhere, which removes every one whose process no longer runs.
//
// Each call runs as execFile would run it: past its `timeout` the process is stopped, and what it said up to there
// comes back; past `maxBuffer` on either of its outputs (measured every `MEASURE_MS`, and again at its exit) it is
// stopped and what it said is kept up to there, never a character cut in two; a stop ends it; and how it ended goes
// back in execFile's terms — the parts of its error a caller reads (`code`, `killed`, `message`). What it said comes
// back as text, or as bytes for `encoding: "buffer"`, handed over without a copy. The process's id goes back the
// moment it has one. A call `spawn` refuses outright — an argument it cannot take — goes back as thrown, for that one
// call alone; a call asked to start after `startBy` (its caller has answered for it, waiting past a start that hung
// here) starts nothing, answered as past its time, and so does one whose stop is heard before its start — every message
// waiting on the port is heard before each start (`startAsked`) —, answered as stopped. `startBy` is read on the
// process's monotonic clock, as the pool set it: a jump of the wall clock moves neither. Every call asked gets one last
// answer from the thread, so the pool knows when a thread it answered for has got past what held it.
import { parentPort, receiveMessageOnPort } from "node:worker_threads";
import { spawn } from "node:child_process";
import { closeSync, fstatSync, openSync, readdirSync, readSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** How often what a running process said is measured against its cap. */
const MEASURE_MS = 100;
/** execFile's own cap, where a call names none. */
const MAX_BUFFER = 1024 * 1024;
const STREAMS = /** @type {const} */ (["stdout", "stderr"]);
/** How long after a thread starts it removes what ended processes left. */
const SWEEP_AFTER_MS = 1000;
/** A call's file: the process, the thread and the call it is for, and which output. */
const FILE = /^filament-spawn-(\d+)-\d+-\d+\.(?:stdout|stderr)$/;

/**
 * @typedef {{ cwd?: string, env?: Record<string, string | undefined>, timeout?: number, maxBuffer?: number, windowsHide?: boolean, encoding?: "utf8" | "buffer" }} RunOptions
 * @typedef {{ code: unknown, killed: boolean, message: string }} Failure
 * @typedef {{ code: number | null, signal: string | null }} Exit
 * @typedef {"timeout" | "stdout" | "stderr" | "stop"} Why  why the thread stopped a process: past its time, past its cap on that output, or asked to
 */
/**
 * A call asked of the thread: `run` the process (its id, what it runs, how, what it reads on its standard input, the
 * files its output goes to, and the time past which it starts nothing, on `clock`), or `stop` the call with that id.
 * @typedef {{ run: { id: number, file: string, args: string[], options: RunOptions, input: string | Uint8Array | null, files: string[], startBy: number | null } } | { stop: number }} Ask
 */
/** The clock a call's `startBy` is read by, here and in the pool: monotonic, one for the whole process, in ms. */
const clock = () => Number(process.hrtime.bigint() / 1_000_000n);
/**
 * What the thread tells of a call: its process `started` (its id, what it runs, the files its output goes to), or how it
 * ended — `failure` execFile's error (null when the process exited 0 within its cap) with what the process said (text,
 * or bytes for `encoding: "buffer"`), its id and its `exit` (both null where none started) — or `thrown` where spawn
 * refused the call before any process started.
 * @typedef {{ started: number, pid: number, file: string, args: string[], files: string[] }
 *   | { id: number, pid: number | null, failure: Failure | null, stdout: string | Uint8Array, stderr: string | Uint8Array, exit: Exit | null }
 *   | { id: number, thrown: { name: string, message: string, code: unknown } }} Told
 */

/** The calls under way, by id: each one's stop. @type {Map<number, () => void>} */
const running = new Map();
/** Files a removal missed (another program had them open): tried again as each later call ends. @type {Set<string>} */
const leftover = new Set();
const port = /** @type {import("node:worker_threads").MessagePort} */ (parentPort);
/** @param {Told} told @param {ArrayBuffer[]} [handed]  bytes handed over whole, not copied */
const tell = (told, handed = []) => port.postMessage(told, handed);

/** @param {string[]} paths */
function remove(paths) {
  for (const p of paths) {
    try {
      rmSync(p, { force: true });
      leftover.delete(p);
    } catch {
      leftover.add(p);
    }
  }
}

/** Whether a process runs. @param {number} pid */
function runs(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // Another account's process, which this one may not signal, runs all the same.
    return /** @type {any} */ (e)?.code === "EPERM";
  }
}

/** The calls' files of every process that no longer runs: what a Filament that ended mid-call left behind. */
function sweep() {
  const dir = tmpdir();
  /** @type {string[]} */
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  /** @type {Map<number, boolean>} */
  const asked = new Map();
  for (const name of names) {
    const owner = Number(FILE.exec(name)?.[1] ?? NaN);
    if (!owner || owner === process.pid) continue;
    if (!asked.has(owner)) asked.set(owner, runs(owner));
    if (!asked.get(owner)) remove([join(dir, name)]);
  }
}

/**
 * The first `n` bytes of a file, in a buffer of their own (one that can be handed to another thread whole).
 * @param {number} fd @param {number} n
 */
function head(fd, n) {
  const b = new Uint8Array(n);
  let got = 0;
  while (got < n) {
    const r = readSync(fd, b, got, n - got, got);
    if (!r) break;
    got += r;
  }
  return got < n ? b.subarray(0, got) : b;
}

/**
 * How many of `b`'s first `n` bytes end on a whole UTF-8 character: the last one's lead byte and the bytes it needs,
 * else up to before it.
 * @param {Uint8Array} b @param {number} n
 */
function whole(b, n) {
  let lead = n - 1;
  while (lead >= 0 && n - lead <= 3 && (b[lead] & 0xc0) === 0x80) lead--;
  if (lead < 0) return n;
  const c = b[lead];
  const length = c < 0x80 ? 1 : (c & 0xe0) === 0xc0 ? 2 : (c & 0xf0) === 0xe0 ? 3 : (c & 0xf8) === 0xf0 ? 4 : 1;
  return lead + length <= n ? n : lead;
}

/** @param {Extract<Ask, { run: any }>["run"]} call */
function run({ id, file, args, options, input, files: paths, startBy }) {
  if (startBy != null && clock() > startBy) {
    // Past its time before it started, as a timeout says it: a caller that hears this before the pool's own clock
    // answers reads it as the pool's would read.
    tell({ id, pid: null, failure: { code: null, killed: true, message: `${file} ran past its time before its thread got to it, and started nothing` }, stdout: "", stderr: "", exit: null });
    return;
  }
  const cap = options.maxBuffer ?? MAX_BUFFER;
  const bytes = options.encoding === "buffer";
  /** @type {number[]} */
  const fds = [];
  const drop = () => {
    for (const fd of fds) {
      try {
        closeSync(fd);
      } catch {}
    }
    remove([...paths, ...leftover]);
  };
  /** @type {import("node:child_process").ChildProcess} */
  let child;
  try {
    for (const p of paths) fds.push(openSync(p, "w+"));
  } catch (e) {
    drop();
    const err = /** @type {any} */ (e);
    const failure = { code: "ERR_SPAWN_FILES", killed: false, message: `the files the process's output goes to could not be made (${String(err?.message || err)})` };
    tell({ id, pid: null, failure, stdout: "", stderr: "", exit: null });
    return;
  }
  try {
    child = spawn(file, args, { cwd: options.cwd, env: options.env, windowsHide: options.windowsHide, stdio: ["pipe", fds[0], fds[1]] });
  } catch (e) {
    drop();
    const err = /** @type {any} */ (e);
    tell({ id, thrown: { name: String(err?.name || "Error"), message: String(err?.message || err), code: err?.code } });
    return;
  }
  // Its id the moment it has one, so a thread that stops before the process is heard from still leaves it known.
  if (child.pid !== undefined) tell({ started: id, pid: child.pid, file, args, files: paths });
  /** Why this thread stopped the process, the first reason. @type {Why | null} */
  let why = null;
  /** @param {Why} reason */
  const stop = (reason) => {
    why ??= reason;
    child.kill();
  };
  /** The output past its cap, if one is. */
  const over = () => STREAMS.find((_, i) => fstatSync(fds[i]).size > cap) ?? null;
  const timer = options.timeout && options.timeout > 0 ? setTimeout(() => stop("timeout"), options.timeout) : null;
  const measure = setInterval(() => {
    const past = over();
    if (past) stop(past);
  }, MEASURE_MS);
  running.set(id, () => stop("stop"));
  let done = false;
  /** @param {Exit | null} exit @param {any} [refused]  spawn's error where no process started */
  const finish = (exit, refused = null) => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    clearInterval(measure);
    running.delete(id);
    child.stdin?.destroy();
    /** @type {Told} */
    let told;
    /** @type {ArrayBuffer[]} */
    let handed = [];
    try {
      if (!refused) why ??= over();
      const said = fds.map((fd) => {
        const size = fstatSync(fd).size;
        const b = head(fd, Math.min(size, cap));
        return bytes ? b : Buffer.from(b.buffer, b.byteOffset, size > cap ? whole(b, b.length) : b.length).toString("utf8");
      });
      const [stdout, stderr] = said;
      const text = typeof stderr === "string" ? stderr : Buffer.from(stderr).toString("utf8");
      /** @type {Failure | null} */
      const failure = refused
        ? { code: refused.code, killed: false, message: String(refused.message || refused) }
        : why === "stdout" || why === "stderr"
          ? { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", killed: false, message: `${why} maxBuffer length exceeded` }
          : why === "stop"
            ? { code: "ABORT_ERR", killed: false, message: "The operation was aborted" }
            : exit && exit.code === 0 && exit.signal === null
              ? null
              : { code: exit?.code ?? null, killed: !!child.killed, message: `Command failed: ${[file, ...args].join(" ")}\n${text}` };
      told = { id, pid: child.pid ?? null, failure, stdout, stderr, exit };
      handed = said.flatMap((s) => (typeof s === "string" ? [] : [/** @type {ArrayBuffer} */ (s.buffer)]));
    } catch (e) {
      const err = /** @type {any} */ (e);
      told = { id, pid: child.pid ?? null, failure: { code: err?.code, killed: false, message: String(err?.message || err) }, stdout: "", stderr: "", exit };
    }
    // Removed before the answer goes: a process may end as soon as it has its last one, this thread with it.
    drop();
    tell(told, handed);
  };
  child.once("exit", (code, signal) => finish({ code, signal }));
  // A process that never started; a kill that failed is answered by the process's exit, or by the pool's deadline.
  child.on("error", (e) => child.pid === undefined && finish(null, e));
  // A process that ends before it read all of it says why through its exit; the pipe's own error is that same end.
  child.stdin?.on("error", () => {});
  if (input != null) child.stdin?.end(input);
}

/** How a call stopped before its start ends: as one its stop ended, no process started. */
const STOPPED = Object.freeze({ code: "ABORT_ERR", killed: false, message: "The operation was aborted" });
/** The calls asked to run and not yet started, by id, in the order they were asked. @type {Map<number, Extract<Ask, { run: any }>["run"]>} */
const asked = new Map();
/** A call asked to run waits its turn; a stop ends its process, or — not yet started — answers it, and it never starts. @param {Ask} ask */
function heard(ask) {
  if (!("stop" in ask)) asked.set(ask.run.id, ask.run);
  else if (asked.delete(ask.stop)) tell({ id: ask.stop, pid: null, failure: STOPPED, stdout: "", stderr: "", exit: null });
  else running.get(ask.stop)?.();
}
let starting = false;
/**
 * The calls asked, started in turn, each only once every message waiting on the port is heard: a stop sent right
 * behind its call, or while a start before it held this thread (an antivirus holding CreateProcess), comes first, and
 * that call starts nothing.
 */
function startAsked() {
  if (starting) return;
  starting = true;
  try {
    for (;;) {
      for (let m = receiveMessageOnPort(port); m; m = receiveMessageOnPort(port)) heard(m.message);
      const next = asked.values().next();
      if (next.done) break;
      asked.delete(next.value.id);
      run(next.value);
    }
  } finally {
    starting = false;
  }
}
port.on("message", (/** @type {Ask} */ ask) => {
  heard(ask);
  startAsked();
});
// Once the first calls are under way: a temp folder may hold many thousand names.
setTimeout(sweep, SWEEP_AFTER_MS).unref();
