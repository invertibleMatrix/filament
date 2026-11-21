// The memory trace: everything the memory layer did for one request, as timed steps, without any memory content.
//
// One `MemoryTrace` per request travels through the pipeline in an AsyncLocalStorage so the brain, the engine and
// the tool loop can add steps without threading a parameter everywhere. The server attaches `trace.toJSON()` to the
// request record when the request finishes (`rec.memoryTrace`), and the dashboard draws it as a timeline: what
// happened before the upstream was called (the blocking part), during the reply (tool rounds), after it
// (bookkeeping) and later (fire-and-forget engine writes, learning).
//
// Only counts, ids, durations, scores and decisions are recorded. The search words taken from the user's own
// message are kept (they explain what was looked up) after dropping anything that looks like a secret.
import { AsyncLocalStorage } from "node:async_hooks";

const als = new AsyncLocalStorage();
export const currentTrace = () => als.getStore() || null;
export const withTrace = (trace, fn) => (trace ? als.run(trace, fn) : fn());
/** Run work that belongs to no request (the engine outbox) outside whichever trace is current. @template T @param {() => T} fn @returns {T} */
export const outsideTrace = (fn) => als.exit(fn);

const MAX_STEPS = 200;
const round = (n) => Math.round(n * 10) / 10;
const SECRET_TOKEN =
  /^(sk-|key-|xox[a-z]-|ghp_|gho_|github_pat_|AKIA|eyJ)|[A-Za-z0-9_-]{32,}|[A-Fa-f0-9]{24,}/;
// Search words safe to keep on a record: short, nothing key-shaped.
export const safeQuery = (q) =>
  String(q || "")
    .split(/\s+/)
    .filter((w) => w && w.length <= 40 && !SECRET_TOKEN.test(w))
    .slice(0, 16)
    .join(" ");
const clean = (meta) => {
  const out = {};
  for (const [k, v] of Object.entries(meta || {})) {
    if (v === undefined || v === null || typeof v === "function") continue;
    out[k] = typeof v === "string" ? v.slice(0, 200) : v;
  }
  return out;
};

export class MemoryTrace {
  constructor({ now = () => performance.now() } = {}) {
    this.now = now;
    this.t0 = now();
    this.steps = [];
    this.depth = 0;
    this.phase = "before";
    this.marks = {};
    this.engine = { calls: 0, ms: 0, errors: 0 };
    this.tools = { rounds: 0, calls: 0, ms: 0 };
    this.dropped = 0;
  }
  // Align the offsets with the request record's clock (the trace starts a little before the record exists).
  rebase(t0) {
    if (typeof t0 !== "number") return;
    const delta = this.t0 - t0;
    if (delta) for (const s of this.steps) s.at = round(s.at + delta);
    for (const k of Object.keys(this.marks)) this.marks[k] = round(this.marks[k] + delta);
    this.t0 = t0;
  }
  setPhase(p) {
    this.phase = p;
  }
  mark(name) {
    this.marks[name] = round(this.now() - this.t0);
  }
  // A point in time (or something that already happened, with `ms`).
  step(name, meta = {}) {
    const s = { at: round(this.now() - this.t0), phase: this.phase, depth: this.depth, name, ...clean(meta) };
    if (this.steps.length >= MAX_STEPS) {
      this.dropped++;
      return s;
    }
    this.steps.push(s);
    return s;
  }
  // Time an async function; nested steps recorded inside it sit one level deeper.
  async span(name, fn, meta = {}) {
    const t = this.now();
    const s = this.step(name, meta);
    this.depth++;
    try {
      const r = await fn(s);
      s.ms = round(this.now() - t);
      return r;
    } catch (e) {
      s.ms = round(this.now() - t);
      s.error = String(e?.message || e).slice(0, 200);
      throw e;
    } finally {
      this.depth--;
    }
  }
  spanSync(name, fn, meta = {}) {
    const t = this.now();
    const s = this.step(name, meta);
    this.depth++;
    try {
      const r = fn(s);
      s.ms = round(this.now() - t);
      return r;
    } catch (e) {
      s.ms = round(this.now() - t);
      s.error = String(e?.message || e).slice(0, 200);
      throw e;
    } finally {
      this.depth--;
    }
  }
  // One call to the engine (Mnemosyne): op, time, outcome, a row count when the answer is a list.
  engineCall(op, ms, ok, extra = {}) {
    this.engine.calls++;
    this.engine.ms = round(this.engine.ms + ms);
    if (!ok) this.engine.errors++;
    this.step(`engine ${op}`, { kind: "engine", ms: round(ms), ok, ...extra });
  }
  toolRound(calls, ms) {
    this.tools.rounds++;
    this.tools.calls += calls;
    this.tools.ms = round(this.tools.ms + ms);
  }
  // What the dashboard sums up: the time memory added before the upstream was called, the time it spent in
  // tool rounds (the model asking memory mid-reply), and the bookkeeping after the reply (off the critical path).
  summary() {
    const top = (phase) =>
      this.steps
        .filter((s) => s.phase === phase && s.depth === 0 && typeof s.ms === "number")
        .reduce((a, s) => a + s.ms, 0);
    const blockingMs = round(top("before"));
    const afterMs = round(top("after"));
    const laterMs = round(top("later"));
    const asyncEngine = this.steps.filter((s) => s.kind === "engine" && s.async).length;
    return {
      blockingMs,
      afterMs,
      laterMs,
      toolRounds: this.tools.rounds,
      toolCalls: this.tools.calls,
      toolMs: this.tools.ms,
      engineCalls: this.engine.calls,
      engineMs: this.engine.ms,
      engineErrors: this.engine.errors,
      engineAsync: asyncEngine,
      modelCalls: 0,
      firstByteAt: this.marks.firstByte ?? null,
      steps: this.steps.length,
      dropped: this.dropped || undefined,
    };
  }
  toJSON() {
    return { steps: this.steps, marks: this.marks, summary: this.summary() };
  }
}
