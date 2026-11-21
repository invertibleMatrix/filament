// The memory engine: Mnemosyne running as a child process of Filament (sidecar/mnemosyne_sidecar.py), spoken to
// over newline-delimited JSON on stdin/stdout. No network, no MCP. This module owns the process: lazy start,
// health (`hello`), one outstanding request set, restart with backoff after a crash, `degraded` after three failures
// in a row so the brain can run archive-only, and the Mnemosyne config.yaml Filament writes before every start
// (Mnemosyne reads config.yaml before the environment). No call has a clock (HarnessV3-FailurePoints §4 B): it ends
// with the engine's answer, its error or its exit, however long the engine works on it; how long a turn waits is the
// turn's to bound (the brain's). What is watched is whether the engine still answers at all: while a call is in
// flight and the engine has said nothing for `pingMs`, it is pinged, and the sidecar answers a ping on a thread of its
// own whatever it is working on. One that says nothing for `stallMs`, not even to a ping, has stalled: it is logged
// once, recorded, and restarted as the person's Restart does it, each call in flight ending in words. One that stalls
// again soon after is stopped and counted as a failure, as a crash is, so an engine that stalls each time it starts
// ends degraded, and is left stopped until the person restarts it.
//
// It implements the MemoryStore interface from docs/memory-architecture.md §3.1. Memory content never enters logs.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { killTree } from "../tools/kill-tree.js";
import { LINE_MAX, createLineReader, overFields } from "../../core/lines.js";
import { durationWords } from "../../core/text.js";

const BACKOFF_MS = [1_000, 5_000, 30_000];
/** How long a stop waits for the engine's tree to be killed, and then for its process to end. */
const STOP_WAIT_MS = 5_000;
/** How long an engine with a call in flight may say nothing before it is pinged, and how often the watch looks. */
const PING_MS = 5_000;
/** How long an engine with a call in flight may say nothing at all, not even to a ping, before it is taken as stalled. */
const STALL_MS = 60_000;
/** A stall within this many `stallMs` of the one before it is the engine stalling again: the restart did not help. */
const STALL_RUN_SPAN = 10;

// Environment for the sidecar (docs/memory-architecture.md §4). `memoryFolder` holds mnemosyne/, `engineDir` the
// managed Python and caches; `base` is where Filament reaches itself, which the engine's model calls come back to.
// Secrets travel only through the environment, never through config.yaml.
export function sidecarEnv({
  memoryFolder,
  engineDir,
  base = "http://127.0.0.1:20300",
  apiKey = "",
  model = "",
  llmEnabled = false,
  embeddings = true,
  embeddingModel = "",
  bank = "default",
  session = "filament",
}) {
  const mn = join(memoryFolder, "mnemosyne");
  const env = {
    MNEMOSYNE_DATA_DIR: mn,
    MNEMOSYNE_BLOB_DIR: join(mn, "blobs"),
    MNEMOSYNE_BACKUP_DIR: join(mn, "backups"),
    MNEMOSYNE_FASTEMBED_CACHE_DIR: join(engineDir, "cache", "fastembed"),
    MNEMOSYNE_MODEL_CACHE_DIR: join(engineDir, "cache", "models"),
    HERMES_HOME: join(engineDir, "hermes-home"),
    MNEMOSYNE_BANK: bank || "default",
    MNEMOSYNE_DEFAULT_SCOPE: "global",
    MNEMOSYNE_CROSS_SESSION: "1",
    MNEMOSYNE_WM_TTL_HOURS: "87600",
    MNEMOSYNE_AUTO_SLEEP_ENABLED: "false",
    // Filament owns what is true (HarnessV3-Memory MD-0): the engine's model refresh wrote guesses ("Project 'test' at
    // H:\test") and applied them by itself, and Filament served them as memory (F12). Off, both halves.
    MNEMOSYNE_SLEEP_MODEL_REFRESH_ENABLED: "false",
    MNEMOSYNE_SLEEP_MODEL_REFRESH_AUTO_APPLY: "false",
    MNEMOSYNE_LLM_ENABLED: llmEnabled ? "true" : "false",
    FILAMENT_MEMORY_SESSION: session,
    PYTHONUTF8: "1",
    PYTHONUNBUFFERED: "1",
    PYTHONIOENCODING: "utf-8",
    HF_HUB_DISABLE_TELEMETRY: "1",
    TOKENIZERS_PARALLELISM: "false",
  };
  // The engine's model calls come back to Filament under /memory-engine/: served like /v1, tagged as the engine's own, never captured.
  if (llmEnabled) {
    env.MNEMOSYNE_LLM_BASE_URL = `${base}/memory-engine/v1`;
    if (apiKey) env.MNEMOSYNE_LLM_API_KEY = apiKey;
    if (model) env.MNEMOSYNE_LLM_MODEL = model;
  }
  if (!embeddings) env.MNEMOSYNE_NO_EMBEDDINGS = "1";
  // The model the engine's install warmed (engine.json `embeddingModel`, the memory plan's c2): the one its cache holds,
  // so nothing is fetched. None named, the engine runs its own.
  else if (embeddingModel) env.MNEMOSYNE_EMBEDDING_MODEL = embeddingModel;
  return env;
}

// config.yaml outranks the environment in Mnemosyne and is auto-written with every key (including secrets copied
// from the environment) on first start when missing. Filament writes its own, without secrets, before every start.
export function writeMnemosyneConfig(memoryFolder, env) {
  const dir = join(memoryFolder, "mnemosyne");
  mkdirSync(dir, { recursive: true });
  const keys = [
    "MNEMOSYNE_DATA_DIR",
    "MNEMOSYNE_BLOB_DIR",
    "MNEMOSYNE_BACKUP_DIR",
    "MNEMOSYNE_FASTEMBED_CACHE_DIR",
    "MNEMOSYNE_DEFAULT_SCOPE",
    "MNEMOSYNE_CROSS_SESSION",
    "MNEMOSYNE_WM_TTL_HOURS",
    "MNEMOSYNE_AUTO_SLEEP_ENABLED",
    "MNEMOSYNE_SLEEP_MODEL_REFRESH_ENABLED",
    "MNEMOSYNE_SLEEP_MODEL_REFRESH_AUTO_APPLY",
    "MNEMOSYNE_LLM_ENABLED",
    "MNEMOSYNE_LLM_BASE_URL",
    "MNEMOSYNE_LLM_MODEL",
  ];
  const yamlValue = (v) =>
    /^(true|false)$/i.test(v) ? v.toLowerCase() : /^-?\d+(\.\d+)?$/.test(v) ? v : JSON.stringify(v);
  const lines = [
    "# Written by Filament before every engine start. Edit memory settings in the Filament console instead.",
    "# Secrets are never written here; they reach Mnemosyne through the environment.",
  ];
  for (const k of keys)
    if (env[k] !== undefined && env[k] !== "")
      lines.push(`${k.replace(/^MNEMOSYNE_/, "").toLowerCase()}: ${yamlValue(String(env[k]))}`);
  if (env.MNEMOSYNE_NO_EMBEDDINGS === "1") lines.push("no_embeddings: true", "embeddings_off: true");
  writeFileSync(join(dir, "config.yaml"), lines.join("\n") + "\n");
}

/**
 * How long an engine that has exited is waited on for the end of its stderr. What the pipe still holds was written
 * before the exit and comes at once; the wait ends there too when something the engine started holds the pipe open.
 */
const LAST_WORDS_MS = 500;
/**
 * Settles once an engine that has exited has no more to say on stderr; at once for one still running, whose stderr
 * ends with it.
 * @param {import("node:child_process").ChildProcess | null | undefined} child @returns {Promise<void>}
 */
const lastWords = (child) =>
  new Promise((done) => {
    const err = child?.stderr;
    if (!child || !err || err.readableEnded || err.destroyed || (child.exitCode == null && child.signalCode == null)) return done();
    const timer = setTimeout(done, LAST_WORDS_MS);
    timer.unref?.();
    const ended = () => {
      clearTimeout(timer);
      done();
    };
    err.once("end", ended);
    err.once("close", ended);
  });

export class MemoryEngine {
  // command/args: the interpreter and script (the managed venv's python + sidecar path; tests use node + a fake).
  // trace: the request's memory trace, looked up per call (the memory service keeps it in an AsyncLocalStorage);
  // handed in like `onOp` so the engine records its calls there without importing the service.
  // pingMs/stallMs: the watch over an engine with calls in flight (PING_MS, STALL_MS; tests give shorter ones).
  constructor({
    command,
    args = [],
    env = {},
    cwd = undefined,
    memoryFolder = "",
    log = () => {},
    spawnImpl = spawn,
    backoffMs = BACKOFF_MS,
    writeConfig = true,
    trace = () => null,
    pingMs = PING_MS,
    stallMs = STALL_MS,
  } = {}) {
    Object.assign(this, {
      command,
      args,
      env,
      cwd,
      memoryFolder,
      log,
      spawnImpl,
      backoffMs,
      writeConfig,
      trace,
      pingMs,
      stallMs,
    });
    this.child = null;
    this.state = "stopped";
    this.pending = new Map();
    this.nextId = 0;
    this.lines = this.#reader();
    this.hello = null;
    this.lastError = null;
    this.failures = 0;
    this.backoffUntil = 0;
    this.startedAt = 0;
    this.calls = 0;
    this.starting = null;
    this.stderrTail = [];
    this.stopped = false;
    /**
     * The engine's last stall, kept until Filament stops (`#stalled`), and how many it had: `run` counts the stalls in
     * a row, each soon after the one before.
     * @type {{ at: number, quietMs: number, calls: number, ops: string[], pid: number | null, run: number } | null}
     */
    this.stalled = null;
    this.stalls = 0;
  }
  /** The stalls in a row, each within `STALL_RUN_SPAN` stall-times of the one before, and when the last came. */
  #stallRun = 0;
  #stalledAt = 0;
  /** Why the engine is left stopped, after stalling again each time it started; the person's restart clears it. @type {string | null} */
  #leftStopped = null;

  // Engine lifecycle as durable operations, injected through MemoryService as `store.onOp` — the same pattern as
  // `memory.onJobEvent`, `bridge.onOp` and `memory.onLearnerOp`, so this module never imports the op log and keeps
  // working with observability off. `stderrTail` is in-RAM (last 50 lines) and `status()` is a snapshot, so "the
  // sidecar died overnight and gave up after three tries" had no durable record anywhere.
  #op(title, opts) {
    try {
      this.onOp?.(title, opts);
    } catch {
      /* observability must never break the engine */
    }
  }
  // Counts and state only, by contract. The sidecar's stderr can carry file paths and, in a traceback, whatever it
  // was working on, so no stderr TEXT is put here: the server log already carries it as a `log` operation, and what
  // the engine operation adds is the engine's own state at that moment. `lastError` is the one string that reaches
  // the durable log and it is truncated, because ops.jsonl is kept for weeks.
  #counts(extra) {
    return {
      state: this.state,
      pid: this.child?.pid ?? null,
      calls: this.calls,
      pending: this.pending.size,
      failures: this.failures,
      lastError: this.lastError ? String(this.lastError).slice(0, 160) : null,
      ...(extra || {}),
    };
  }

  status() {
    return {
      state: this.state,
      pid: this.child?.pid || null,
      startedAt: this.startedAt || null,
      hello: this.hello,
      lastError: this.lastError,
      failures: this.failures,
      backoffUntil: this.backoffUntil || null,
      calls: this.calls,
      pending: this.pending.size,
      stderr: this.stderrTail.slice(-5),
      // `out`: left stopped for its stalls, until the person restarts it.
      stalled: this.stalled ? { ...this.stalled, count: this.stalls, out: !!this.#leftStopped } : null,
    };
  }

  /** Closed for good (`close`): memory dropped this engine, and nothing starts it again. */
  closed = false;

  // Start (or reuse) the child and wait for `hello`. Throws while backing off so callers can degrade gracefully, and
  // once closed: whoever still holds an engine memory dropped — a turn begun before, the learner — gets no process.
  async ensure() {
    if (this.closed) throw new Error("memory engine closed: memory has opened another");
    if (this.state === "ready" && this.child) return this.hello;
    if (this.starting) return this.starting;
    if (this.#leftStopped) throw new Error(this.#leftStopped);
    if (Date.now() < this.backoffUntil)
      throw new Error(
        `memory engine is backing off after ${this.failures} failure(s): ${this.lastError || "unknown error"}`,
      );
    this.starting = this.#start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  async #start() {
    this.stopped = false;
    this.state = "starting";
    this.lines = this.#reader();
    if (this.writeConfig && this.memoryFolder) {
      try {
        writeMnemosyneConfig(this.memoryFolder, this.env);
      } catch (e) {
        this.log("warn", `memory: could not write config.yaml: ${e.message}`);
      }
    }
    if (this.env.MNEMOSYNE_DATA_DIR) {
      try {
        mkdirSync(this.env.MNEMOSYNE_DATA_DIR, { recursive: true });
      } catch {}
    }
    let child;
    try {
      child = this.spawnImpl(this.command, this.args, {
        cwd: this.cwd,
        env: { ...process.env, ...this.env },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (e) {
      this.#failed(`spawn failed: ${e.message}`);
      throw e;
    }
    this.child = child;
    this.startedAt = Date.now();
    this.#heardAt = this.startedAt;
    // Spawned and ready are separate operations on purpose: a spawn with no ready after it is a sidecar that hung
    // during its handshake, which is a different failure from one that never started, and the snapshot cannot tell
    // them apart after the fact.
    this.#op(`memory engine sidecar spawned (pid ${child?.pid ?? "?"})`, {
      sub: "spawn",
      detail: this.#counts(),
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => this.#onData(d));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d) => {
      for (const line of String(d).split(/\r?\n/))
        if (line.trim()) {
          this.stderrTail.push(line.slice(0, 300));
          if (this.stderrTail.length > 50) this.stderrTail.shift();
          if (/^(error|critical)\t/.test(line)) {
            this.log("warn", `memory engine: ${line.slice(0, 200)}`);
            this.#op(`memory engine wrote to stderr (${line.slice(0, line.indexOf("\t"))})`, {
              sub: "stderr",
              level: /^critical\t/.test(line) ? "error" : "warn",
              detail: this.#counts({
                severity: line.slice(0, line.indexOf("\t")).slice(0, 12),
                stderrLines: this.stderrTail.length,
              }),
            });
          }
        }
    });
    for (const s of [child.stdout, child.stderr, child.stdin]) s.on("error", () => {});
    child.on("error", (e) => {
      this.#failed(`process error: ${e.message}`);
    });
    child.on("exit", (code, signal) => {
      if (this.child === child) this.#exited(code, signal);
    });
    try {
      const hello = await this.#send("hello", {});
      this.hello = hello;
      this.state = "ready";
      this.failures = 0;
      this.backoffUntil = 0;
      this.lastError = null;
      this.log(
        "info",
        `memory engine ready: Mnemosyne ${hello?.version || "?"}, embeddings ${hello?.embeddings ? "on" : "off"}, ${hello?.counts?.working ?? "?"} working memories`,
      );
      this.#op(
        `memory engine ready: Mnemosyne ${hello?.version || "?"}, embeddings ${hello?.embeddings ? "on" : "off"}`,
        {
          sub: "ready",
          detail: this.#counts({
            version: hello?.version ? String(hello.version).slice(0, 40) : null,
            embeddings: !!hello?.embeddings,
            working: Number(hello?.counts?.working) || 0,
            handshakeMs: this.startedAt ? Date.now() - this.startedAt : null,
          }),
        },
      );
      return hello;
    } catch (e) {
      // Stopped on purpose while it said hello — its replacement, its removal, a restart —: no failure of the engine's,
      // and none is counted or said (the hunt of 10-28: every replacement at start logged "hello failed" as one).
      if (e?.stopped) throw Object.assign(new Error("memory engine stopped before it was ready"), { stopped: true });
      // What an engine writes as it dies — a traceback, why it could not start — reaches Filament after its exit
      // (HarnessV4_Tasks C15: the failure then named an exit code and nothing else): the tail is read once its
      // stderr has ended.
      await lastWords(child);
      const tail = this.stderrTail.slice(-3).join(" | ");
      // The stderr tail is diagnostic, and the engine op contract is counts-only. It must NOT be folded into
      // lastError: #counts reads lastError into every engine op and into the failure titles, and those are durable —
      // a traceback there would echo into ops.jsonl on every subsequent op. The tail goes to the server log (the
      // `log` kind is the text channel) and to the thrown error the caller surfaces; lastError stays clean.
      this.#failed(`hello failed: ${e.message}`);
      if (tail) this.log("warn", `memory engine stderr: ${tail}`);
      this.#kill(child);
      throw new Error(`hello failed: ${e.message}${tail ? ` (${tail})` : ""}`);
    }
  }

  /**
   * @param {string} msg
   * @param {number} [count]  the failures in a row this one makes: the one after the last, or a stall run's own
   *   (`#stalled`), which the successful starts between its stalls do not end
   */
  #failed(msg, count = this.failures + 1) {
    this.lastError = msg;
    this.failures = count;
    this.backoffUntil =
      Date.now() + (this.backoffMs[Math.min(this.failures - 1, this.backoffMs.length - 1)] || 30_000);
    this.state = this.failures >= 3 ? "degraded" : "stopped";
    this.log("warn", `memory engine: ${msg}`);
    // EVERY failure is recorded, not only the third. The first failure is when you want to know; the transition to
    // `degraded` is when Filament has given up and memory silently falls back to the archive alone. Different lines,
    // different levels — and before this, neither was durable.
    const degraded = this.state === "degraded";
    this.#op(
      degraded
        ? `memory engine degraded after ${this.failures} failures: ${String(msg).slice(0, 120)}`
        : `memory engine failure #${this.failures}: ${String(msg).slice(0, 120)}`,
      {
        sub: degraded ? "degraded" : "failed",
        level: degraded ? "error" : "warn",
        detail: this.#counts({ backoffMs: Math.max(0, this.backoffUntil - Date.now()) }),
      },
    );
  }

  #exited(code, signal) {
    const wasReady = this.state === "ready";
    const rejected = this.pending.size; // in-flight engine calls this exit is about to fail
    this.child = null;
    this.#unwatch();
    for (const [, p] of this.pending) p.reject(new Error(`memory engine exited (${signal || code})`));
    this.pending.clear();
    if (this.stopped) {
      this.state = "stopped";
      return;
    }
    // The exit is recorded before #failed adds its own line, because #failed reports the FAILURE while this reports
    // the PROCESS going away — and an exit during startup takes the second branch below, which #failed never sees, so
    // without this line a sidecar that dies mid-handshake vanishes without a trace.
    this.#op(`memory engine process exited (code ${code ?? "?"}${signal ? ", signal " + signal : ""})`, {
      sub: "exit",
      level: wasReady ? "warn" : "info",
      detail: this.#counts({
        code: code ?? null,
        signal: signal || null,
        wasReady,
        pendingRejected: rejected,
      }),
    });
    if (wasReady) this.#failed(`exited unexpectedly (${signal || code})`);
    else if (this.state === "starting") this.state = "stopped";
  }

  // The engine goes with what it started (kill-tree.js). Settles once the kill is carried out; only a stop waits for it.
  #kill(child) {
    return killTree(child, { warn: (what) => this.log("warn", `memory engine ${child?.pid}: taskkill ${what}; killing the engine directly`) });
  }

  // The engine's answers, a line each: an answer carrying a whole recall or a long document arrives in many chunks, and
  // each chunk is searched for its newline once (core/lines.js) — not the whole answer so far, again, at every chunk.
  // Each is held to `LINE_MAX`: one past it is dropped unread (`#onOver`).
  #reader() {
    return createLineReader((line) => this.#onLine(line), { onOver: (over) => this.#onOver(over) });
  }

  #onData(chunk) {
    this.lines.push(chunk);
  }

  // An answer past what a line holds, dropped unread: the call it answers, by the id its start or its end says
  // (`overFields`), fails in words, where it would wait for an answer that never comes. Its size alone is logged.
  #onOver(over) {
    const { id } = overFields(over);
    const p = id == null ? undefined : this.pending.get(id);
    const words = `${Math.round(over.length / 2 ** 20)} MiB on one line, past the ${LINE_MAX / 2 ** 20} MiB Filament reads of one answer`;
    this.log("warn", `memory engine: ${p ? `its answer to ${p.op}` : "an answer"} was ${words}: dropped unread`);
    if (!p) return;
    this.pending.delete(id);
    const e = new Error(`the memory engine answered ${p.op} with ${words}: Filament dropped the answer unread`);
    e.kind = "mnemosyne";
    p.reject(e);
  }

  #onLine(raw) {
    const line = raw.trim();
    if (!line) return;
    // Whatever it says — an answer, a ping's, a line that is no JSON — the engine still answers.
    this.#heardAt = Date.now();
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      this.log("debug", `memory engine said something that is not JSON (${line.length} chars)`);
      return;
    }
    if (msg.id == null) {
      if (msg.ok === false) this.lastError = msg.error || "engine error";
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else {
      const e = new Error(msg.error || "engine error");
      e.kind = msg.kind || "mnemosyne";
      p.reject(e);
    }
  }

  #send(op, args) {
    const id = ++this.nextId;
    const child = this.child;
    // Its process went between the call's start and its send (a stop, the person's restart): said as that.
    if (!child) return Promise.reject(new Error(`the memory engine stopped before ${op} was sent`));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, op });
      this.#watch();
      try {
        child.stdin.write(JSON.stringify({ id, op, args }) + "\n");
      } catch (e) {
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  /** When the engine last said anything, or the watch began counting its silence. */
  #heardAt = 0;
  /** When the watch last looked. */
  #lookedAt = 0;
  /** The watch's next look, while a call is in flight. @type {ReturnType<typeof setTimeout> | null} */
  #watching = null;
  /** The watch over an engine with calls in flight: started by the first call, it ends when none is left. */
  #watch() {
    if (this.#watching) return;
    // The silence counts from now: an engine idle until this call owed nobody an answer.
    this.#heardAt = this.#lookedAt = Date.now();
    this.#nextLook();
  }
  #nextLook() {
    this.#watching = setTimeout(() => this.#look(), this.pingMs);
    this.#watching.unref?.();
  }
  #unwatch() {
    if (this.#watching) clearTimeout(this.#watching);
    this.#watching = null;
  }
  #look() {
    this.#watching = null;
    if (!this.child || this.stopped || this.closed || !this.pending.size) return;
    const now = Date.now();
    // Filament itself was held since the last look — the machine asleep, or its own thread busy — so what the engine
    // said meanwhile may still be unread: its silence is counted afresh, never blamed on it.
    if (now - this.#lookedAt > this.pingMs * 3) this.#heardAt = now;
    this.#lookedAt = now;
    const quiet = now - this.#heardAt;
    if (quiet >= this.stallMs) return void this.#stalled(quiet);
    // No call of its own: the answer moves `heardAt`, and the sidecar answers it whatever it is working on.
    if (quiet >= this.pingMs)
      try {
        this.child.stdin.write(JSON.stringify({ id: ++this.nextId, op: "ping", args: {} }) + "\n");
      } catch {}
    this.#nextLook();
  }
  /**
   * The engine answered nothing for `quiet` ms with calls in flight, not even a ping: stalled, which no slow call is,
   * since the sidecar answers a ping whatever it works on. Logged once and recorded, kept for the pages
   * (`stalled`), and restarted as the person's Restart does it: each call in flight ends saying why. A stall soon after
   * the one before (`STALL_RUN_SPAN`) is the engine stalling again, which a restart did not help: it is stopped and
   * counted as a failure, its backoff with it, the stalls in a row making the count, so one that stalls each time it
   * starts is degraded by its fourth and left stopped (`#leftStopped`), not restarted each minute.
   * @param {number} quiet
   */
  #stalled(quiet) {
    const now = Date.now();
    const ops = [...this.pending.values()].map((p) => p.op);
    const kinds = [...new Set(ops)];
    const pid = this.child?.pid ?? null;
    const words = `stopped answering for ${durationWords(quiet)}, not even to a ping`;
    this.#stallRun = this.#stalledAt && now - this.#stalledAt < this.stallMs * STALL_RUN_SPAN ? this.#stallRun + 1 : 1;
    this.#stalledAt = now;
    this.stalls += 1;
    const run = this.#stallRun;
    this.stalled = { at: now, quietMs: quiet, calls: ops.length, ops: kinds.slice(0, 8), pid, run };
    const inFlight = `with ${ops.length} call${ops.length === 1 ? "" : "s"} in flight (${kinds.join(", ")})`;
    if (run === 1) {
      this.log("warn", `memory engine ${pid ?? "?"}: ${words}, ${inFlight}; restarting it`);
      this.#op(`memory engine stalled: it ${words} (pid ${pid ?? "?"}); restarting it`, {
        sub: "stall",
        level: "error",
        detail: this.#counts({ pid, quietMs: quiet, stalls: this.stalls }),
      });
      this.restart({ why: words }).catch((e) => this.log("warn", `memory engine: the restart after it stalled did not bring it back: ${String(e?.message || e).slice(0, 200)}`));
      return;
    }
    const child = this.child;
    this.child = null;
    this.#unwatch();
    if (child) this.#kill(child);
    this.state = "stopped";
    const again = `${words}, again soon after it was restarted for that (${run} stalls in a row)`;
    // A start under way ends with its hello, as one stopped on purpose: the failure is this one, counted once.
    for (const p of this.pending.values()) p.reject(Object.assign(new Error(`the memory engine ${again}, and was stopped while ${p.op} was in flight`), { stopped: true }));
    this.pending.clear();
    this.log("warn", `memory engine ${pid ?? "?"}: stalled again, ${inFlight}; stopping it`);
    this.#op(`memory engine stalled again: it ${words} (pid ${pid ?? "?"}, ${run} stalls in a row); stopping it`, {
      sub: "stall",
      level: "error",
      detail: this.#counts({ pid, quietMs: quiet, stalls: this.stalls, run }),
    });
    const count = Math.max(this.failures + 1, run - 1);
    const left = `stopped answering each time it was started (${run} stalls in a row, the last for ${durationWords(quiet)}), so Filament left it stopped: memory goes on without it until it is restarted`;
    if (count >= 3) this.#leftStopped = `the memory engine ${left}`;
    this.#failed(count >= 3 ? left : again, count);
  }

  async call(op, args = {}) {
    const tr = this.trace();
    const t = performance.now();
    const cold = this.state !== "ready";
    try {
      await this.ensure();
      this.calls += 1;
      const r = await this.#send(op, args);
      tr?.engineCall(op, performance.now() - t, true, {
        rows: Array.isArray(r) ? r.length : undefined,
        started: cold || undefined,
      });
      this.#callOp(op, true, performance.now() - t, cold, r);
      return r;
    } catch (e) {
      tr?.engineCall(op, performance.now() - t, false, {
        error: String(e?.message || e).slice(0, 160),
        started: cold || undefined,
      });
      this.#callOp(op, false, performance.now() - t, cold, null, e);
      throw e;
    }
  }

  // Every call into the engine, as a durable operation (the noisy `engineop` kind, recorded but hidden by default).
  // The request trace already records these per request; this is the durable copy that outlives it — including the
  // calls no request is tracing. `op` is a fixed enum (remember, recall, stats...), so it is content-free by
  // construction; `rows` is a count. Never the arguments or the result, because those are memories.
  #callOp(op, ok, ms, cold, r, err = null) {
    try {
      this.onCallOp?.(`engine ${op} ${ok ? "ok" : "failed"}`, {
        sub: "call",
        level: ok ? "info" : "warn",
        ms: Math.round(ms),
        detail: {
          op,
          ok: !!ok,
          cold: cold || undefined,
          rows: Array.isArray(r) ? r.length : undefined,
          error: err ? String(err?.message || err).slice(0, 160) : undefined,
        },
      });
    } catch {
      /* observability must never break an engine call */
    }
  }

  /** The stop under way: a second stop waits for the same one. @type {Promise<void> | null} */
  #stopping = null;
  /** Settles once the engine's process has ended (its files free to replace), a second call with the first. */
  stop() {
    return (this.#stopping ??= this.#stop().finally(() => {
      this.#stopping = null;
    }));
  }
  async #stop() {
    this.stopped = true;
    const child = this.child;
    if (!child) {
      this.state = "stopped";
      return;
    }
    try {
      await Promise.race([this.#send("shutdown", {}), new Promise((r) => setTimeout(r, 2_000))]);
    } catch {}
    const pid = child?.pid ?? null;
    const ended = new Promise((r) => {
      if (child.exitCode != null || child.signalCode != null) r(undefined);
      else child.once("exit", () => r(undefined));
    });
    const killed = this.#kill(child);
    this.child = null;
    this.#unwatch();
    this.state = "stopped";
    // A call still in flight is answered now. The exit event that rejects pending calls after a crash never reaches
    // them (this.child is cleared first), so its caller would wait for ever.
    for (const p of this.pending.values()) p.reject(Object.assign(new Error(`memory engine stopped while ${p.op} was in flight`), { stopped: true }));
    this.pending.clear();
    // A deliberate stop is not a failure: #exited returns early when this.stopped is set, so this is the only line a
    // clean shutdown gets. It also carries the call total, which is the only durable record of how much work the
    // sidecar did over its lifetime.
    this.#op(`memory engine stopped (pid ${pid ?? "?"})`, { sub: "stop", detail: this.#counts({ pid }) });
    // An install over this engine (the release's, at start) replaces files its process holds until it has ended.
    // taskkill has no clock of its own: one not done in the time the exit is given is let go, and the engine ended
    // directly, so a stop always settles.
    const late = await Promise.race([killed.then(() => false), new Promise((r) => setTimeout(() => r(true), STOP_WAIT_MS).unref?.())]);
    if (late && child.exitCode == null && child.signalCode == null) {
      this.log("warn", `memory engine ${pid}: taskkill did not finish in ${STOP_WAIT_MS / 1000} s; killing the engine directly`);
      try {
        child.kill();
      } catch {}
    }
    await Promise.race([ended, new Promise((r) => setTimeout(r, STOP_WAIT_MS).unref?.())]);
  }
  /** Stops the engine for good: settles once its process has ended, and nothing starts it again. */
  close() {
    this.closed = true;
    return this.stop();
  }

  /**
   * The person restarts an engine they see hung (HarnessV4_Tasks U1; HarnessV3-FailurePoints §14.3), and the watch
   * one that stalled (`why`, what it did: `#stalled`): no call has a clock, so nothing here restarts it for being
   * slow. Its process is ended without waiting for its word — a hung one gives none — each call in flight ends saying
   * so, and it starts again at once, with no backoff and no failure counted. A start that hung in its handshake ends
   * the same way. The person's restart begins afresh: an engine left stopped for its stalls starts, and its next
   * stall is a first one. Throws where the engine does not come back, with why.
   * @param {{ why?: string | null }} [o]
   * @returns {Promise<{ cut: number, pid: number | null }>}  the calls it cut, and the process it ended
   */
  async restart({ why = null } = {}) {
    const child = this.child;
    const pid = child?.pid ?? null;
    const starting = this.starting;
    if (!why) {
      this.#leftStopped = null;
      this.#stallRun = 0;
      this.#stalledAt = 0;
    }
    this.stopped = true;
    this.child = null;
    this.#unwatch();
    if (child) this.#kill(child);
    this.state = "stopped";
    const cut = [...this.pending.values()].filter((p) => p.op !== "hello").length;
    const restarted = why ? `${why}, and was restarted` : "was restarted";
    for (const p of this.pending.values()) p.reject(new Error(`the memory engine ${restarted} while ${p.op} was in flight`));
    this.pending.clear();
    this.#op(why ? `memory engine restarted: it ${why} (pid ${pid ?? "?"})` : `memory engine restarted by the person (pid ${pid ?? "?"})`, { sub: "restart", detail: this.#counts({ pid, cut }) });
    await starting?.catch(() => {});
    this.failures = 0;
    this.backoffUntil = 0;
    this.lastError = null;
    await this.ensure();
    return { cut, pid };
  }

  // ---- MemoryStore interface ----
  async helloInfo() {
    return this.ensure();
  }
  async recall(query, { topK = 8, temporalWeight = 0, source, fromDate, toDate, hydrate = true } = {}) {
    return this.call("recall", {
      query,
      top_k: topK,
      temporal_weight: temporalWeight,
      source,
      from_date: fromDate,
      to_date: toDate,
      hydrate,
    });
  }
  /**
   * The memories nearest a text by meaning alone (the memory plan's c2), from `minSim` up, each with its similarity as
   * its score: what `recall`, which keeps only rows sharing a word with the query, never answers. `strict`: an engine
   * that could not embed the text fails the call rather than finding nothing (the curator's lookups, the memory plan's f6).
   * @param {string} text @param {{ topK?: number, minSim?: number, strict?: boolean }} [o]
   */
  async dense(text, { topK = 8, minSim = 0, strict = false } = {}) {
    return this.call("dense", { text, top_k: topK, min_sim: minSim, ...(strict ? { strict: true } : {}) });
  }
  async remember({
    content,
    source = "filament",
    importance = 0.6,
    scope = "global",
    veracity = "stated",
    memoryType,
    metadata,
    pin = false,
    dedupe = true,
    extractEntities,
    valid,
  } = {}) {
    // `valid: true`: the engine dedupes on exact content even onto a row it was told to invalidate; a copy of a claim
    // that stands must be served, so a row it lands on is made valid again (HarnessV3-Memory M2-2).
    return this.call("remember", {
      content,
      source,
      importance,
      scope,
      veracity,
      memory_type: memoryType,
      metadata,
      pin,
      dedupe,
      extract_entities: extractEntities,
      ...(valid ? { valid: true } : {}),
    });
  }
  async get(id) {
    return this.call("get", { id });
  }
  async update(id, { content, importance } = {}) {
    return this.call("update", { id, content, importance });
  }
  async forget(id) {
    return this.call("forget", { id });
  }
  /** Retire a memory without deleting it; recall skips it from now on. @param {string} id @param {string | null} [replacementId] */
  async invalidate(id, replacementId = null) {
    return this.call("invalidate", { id, replacement_id: replacementId });
  }
  /** Undo an invalidation. @param {string} id */
  async restore(id) {
    return this.call("restore", { id });
  }
  /** Mark what the engine wrote by itself as superseded; returns the ids per table (working, episodic, canonical). */
  async fence() {
    return this.call("fence", {});
  }
  /**
   * A page of the rows recall can serve, oldest first, for the adoption pass (HarnessV3-Memory M2-3); `next` is the
   * cursor for the following page, or null after the last. @param {{ table?: "working" | "episodic", after?: number, limit?: number }} [o]
   */
  async rows({ table = "working", after = 0, limit = 500 } = {}) {
    return this.call("rows", { table, after, limit });
  }
  async pin(id, on = true) {
    return this.call("pin", { id, on });
  }
  async canonical({ owner = "user", category } = {}) {
    return this.call("canonical_list", { owner, category });
  }
  async canonicalSet({ owner = "user", category, name, body, source = "filament", confidence = 1 }) {
    return this.call("canonical_set", { owner, category, name, body, source, confidence });
  }
  async canonicalForget({ owner = "user", category, name }) {
    return this.call("canonical_forget", { owner, category, name });
  }
  async stats() {
    return this.call("stats", {});
  }
  async hygiene({ action = "audit", limit = 200, minScore = 0.3, ids, dryRun = false } = {}) {
    return action === "audit"
      ? this.call("hygiene_audit", { limit, min_score: minScore })
      : this.call("hygiene_clean", {
          action: action === "clean" ? "" : action,
          limit,
          min_score: minScore,
          ids,
          dry_run: dryRun,
        });
  }
  async exportTo(path) {
    return this.call("export", { path });
  }
  async importFrom(path, { force = false, dryRun = false } = {}) {
    return this.call("import", { path, force, dry_run: dryRun });
  }
  async backup(dir) {
    return this.call("backup", { dir });
  }
  async reindex() {
    return this.call("reindex", {});
  }
  async diagnose() {
    return this.call("diagnose", {});
  }
  async tool(name, args = {}) {
    return this.call("tool", { name, arguments: args });
  }
}
