// Per-request records: in-memory ring for the UI, JSONL file on disk, cost estimation, live events.
import { statSync, openSync, readSync, closeSync, existsSync } from "node:fs";
import { appendFile, stat, rename, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import { DailyUsage, localDay, computeTps, isMemoryRecord } from "./daily-usage.js";
import { TRAFFIC_SOURCES } from "../core/schema.js";
import { isModelCall } from "../core/turn-facts.js";
export { localDay };

export const MAX_LOG_BYTES = 50 * 1024 * 1024;

/**
 * Rotated generations of the request log kept beside the current file: `.1` (newest) … `.N` (oldest), 50 MB each.
 * One generation kept ~10 minutes of agent traffic (records run ~500 KB) and an incident 20 minutes old was already
 * gone from disk (BUG-22, 2026-09-30); five keep the last hour or so, at up to 300 MB of disk with the current file.
 */
export const LOG_GENERATIONS = 5;

/**
 * A log's files that exist, oldest first: `.N` … `.1`, then the current file. The request log keeps `LOG_GENERATIONS`;
 * the operation log keeps its own count (oplog.js).
 * @param {string} logPath
 * @param {number} [generations]  how many rotated generations the log keeps
 * @returns {string[]}
 */
export function logGenerationFiles(logPath, generations = LOG_GENERATIONS) {
  const out = [];
  for (let i = generations; i >= 1; i--) if (existsSync(`${logPath}.${i}`)) out.push(`${logPath}.${i}`);
  if (existsSync(logPath)) out.push(logPath);
  return out;
}

/**
 * Rotate a log one generation: `.N-1` → `.N` … `.1` → `.2`, then the current file → `.1`. Only the oldest generation
 * is dropped: renamed over `.1`, the current file would destroy the generation `.1` holds (BUG-22). A generation that
 * was never written leaves a gap that moves down with the rest. It happens whole or not at all: each file moves to a
 * name no file holds — the oldest generation set aside first, and deleted once the rest have moved — and the current
 * file last, so a move another program's open file stops is undone with every move before it, and each generation
 * stays in place; the caller's next append tries again.
 * @param {string} path  the current log file
 * @param {number} [generations]  how many rotated generations the log keeps
 * @returns {Promise<boolean>}  whether the current file went: rotated, or there was none to rotate
 */
export async function rotateLog(path, generations = LOG_GENERATIONS) {
  if (!existsSync(path)) return true;
  const dropping = `${path}.dropping`;
  /** @type {[string, string][]} */
  const moves = [];
  if (existsSync(`${path}.${generations}`)) moves.push([`${path}.${generations}`, dropping]);
  for (let i = generations - 1; i >= 1; i--) if (existsSync(`${path}.${i}`)) moves.push([`${path}.${i}`, `${path}.${i + 1}`]);
  moves.push([path, `${path}.1`]);
  /** @type {[string, string][]} */
  const made = [];
  for (const [from, to] of moves) {
    try {
      await rename(from, to);
      made.push([from, to]);
    } catch {
      for (const [back, at] of made.reverse()) await rename(at, back).catch(() => {});
      return false;
    }
  }
  await unlink(dropping).catch(() => {});
  return true;
}
/**
 * How far back the request log reaches (HarnessV3-Responsiveness R7): the time of the oldest record in the oldest
 * file that exists, how many files, their bytes, and the most they can hold. With `storeBodies` at `full` a long agent
 * session writes megabytes a request, and the owner's log reached back 25 minutes when a question about the morning
 * came; the reach says so before the question does. A record's `ts` is its second key, so the first 4 KB of a file
 * name its oldest record even when that line is megabytes long.
 * @param {string} logPath  the current log file
 * @returns {{ since: string | null, files: number, bytes: number, maxBytes: number }}
 */
export function readLogReach(logPath) {
  const files = logGenerationFiles(logPath);
  let bytes = 0;
  for (const f of files) {
    try {
      bytes += statSync(f).size;
    } catch {}
  }
  let since = null;
  for (const f of files) {
    let fd = -1;
    try {
      fd = openSync(f, "r");
      const buf = Buffer.alloc(4096);
      const n = readSync(fd, buf, 0, buf.length, 0);
      const m = /"ts":"([^"]+)"/.exec(buf.toString("utf8", 0, n).split("\n")[0]);
      if (m) since = m[1];
    } catch {
    } finally {
      if (fd >= 0) closeSync(fd);
    }
    if (since) break;
  }
  return { since, files: files.length, bytes, maxBytes: MAX_LOG_BYTES * (LOG_GENERATIONS + 1) };
}
const RESTORE_CHUNK = 256 * 1024;
const RESTORE_SCAN_CAP = MAX_LOG_BYTES + 16 * 1024 * 1024;

// Newest-first JSONL tail without loading the whole file. Reads from EOF in `chunkBytes` windows, stitches the
// one line that straddles each boundary, and stops once `keep` records parse (or the scan cap is hit). W3.2: the
// previous restore allocated min(size, 66 MB) in one Buffer even when keepLastRequests was 500 small rows.
export function readLastJsonlRecords(
  path,
  { keep = 500, chunkBytes = RESTORE_CHUNK, maxScanBytes = RESTORE_SCAN_CAP } = {},
) {
  let size = 0;
  try {
    size = statSync(path).size;
  } catch {
    return { records: [], bytesRead: 0 };
  }
  const want = Math.max(1, Math.floor(Number(keep) || 0));
  if (!size || want <= 0) return { records: [], bytesRead: 0 };
  const chunk = Math.max(4096, Math.floor(Number(chunkBytes) || RESTORE_CHUNK));
  const scanCap = Math.max(chunk, Math.floor(Number(maxScanBytes) || RESTORE_SCAN_CAP));
  const fd = openSync(path, "r");
  const newestFirst = [];
  let pos = size,
    bytesRead = 0,
    buf = Buffer.alloc(0);
  const take = (slice) => {
    if (!slice.length) return;
    const line = slice[slice.length - 1] === 0x0d ? slice.subarray(0, slice.length - 1) : slice;
    if (!line.length) return;
    try {
      const r = JSON.parse(line.toString("utf8"));
      if (r && r.id && r.ts) {
        if (r.status === "pending") r.status = "aborted";
        newestFirst.push(r);
      }
    } catch {
      /* a truncated or corrupt line is skipped */
    }
  };
  try {
    while (pos > 0 && newestFirst.length < want && bytesRead < scanCap) {
      const n = Math.min(chunk, pos, scanCap - bytesRead);
      pos -= n;
      const piece = Buffer.allocUnsafe(n);
      // A read may answer fewer bytes than it was asked for: it goes on until the piece is whole. A file that cannot
      // fill it is shorter than when it was measured, and the scan ends on the records it read whole — the line it was
      // inside of is let go, never parsed from bytes the read did not fill.
      let got = 0;
      while (got < n) {
        const k = readSync(fd, piece, got, n - got, pos + got);
        if (!k) break;
        got += k;
      }
      bytesRead += got;
      if (got < n) {
        buf = Buffer.alloc(0);
        break;
      }
      buf = buf.length ? Buffer.concat([piece, buf], n + buf.length) : piece;
      let nl;
      while (newestFirst.length < want && (nl = buf.lastIndexOf(0x0a)) >= 0) {
        take(buf.subarray(nl + 1));
        buf = buf.subarray(0, nl);
      }
    }
    if (pos === 0 && buf.length && newestFirst.length < want) take(buf);
  } finally {
    closeSync(fd);
  }
  newestFirst.reverse();
  return { records: newestFirst, bytesRead };
}

// Who caused a request. ONE classifier, applied in `publicRecord`, so the record, the API's `source=` filter and the
// dashboard's Traffic tabs all read the same value: the browser never re-derives it from user-agent strings or record
// fields. The label map lives in the schema and the two are pinned to each other by a test, because a source the UI
// cannot label is a source the user cannot filter — and an unlabelled row in a "show me everything" view is exactly
// the kind of thing that gets shipped green.
export const TRAFFIC_SOURCE_KEYS = Object.keys(TRAFFIC_SOURCES);

// Filament's own loopback callers, recognised by user-agent. One list, two entry points (`recordSource` for a tagged
// record, `headersAreInternal` for the request path before the record is tagged) — so the rule cannot drift between
// them, which is the failure class this project keeps paying for.
/** @type {ReadonlyArray<[RegExp, string]>} */
const INTERNAL_UAS = [
  [/^filament-memory\//, "memory"],
  [/^filament-ping\//, "ping"],
  [/^filament-assistant\//, "assistant"],
  [/^filament-housekeeping\//, "housekeeping"],
];

export function recordSource(rec) {
  // Memory's own calls first: a summary's slice or a
  // learning pass is more usefully described by its purpose than by the loopback that carried it.
  if (isMemoryRecord(rec)) return "memory";
  const ua = String(rec?.ua || "");
  for (const [re, source] of INTERNAL_UAS) if (re.test(ua)) return source;
  if (rec?.replayOf) return "replay";
  // A compaction's summary written by a fork of the session's own request: it rides the developer's lineage, as Enhance
  // does, but it is no sub-agent's run (HarnessV3-FixRound decision 27).
  if (rec?.forkFor === "compaction") return "compaction";
  // A sub-agent is an agent-loop parent of its own, launched by a loop, the developer or /subagent: named first, so
  // Traffic and the tray tell it from the turn that launched it.
  if (rec?.subagentOf) return "subagent";
  // The agent loop's parent (agent/<model>) carries the turn's tokens and no cost; its ticks are the records that
  // really hit an upstream. Telling them apart is what makes the parent's $0.00 readable instead of alarming.
  if (rec?.agent) return "agent-loop";
  if (rec?.agentOf) return "agent-tick";
  return "client";
}

// Is this an inbound request one of Filament's own subsystems made? Used where the record has not been tagged yet —
// the body-capture decision runs before `rec.memoryFor` is set — and by `observability.storeInternalBodies`, which
// keeps learning and summary PROMPTS (your conversation text) out of the stored bodies by default.
export function headersAreInternal(headers) {
  if (!headers) return false;
  if (headers["x-filament-memory-purpose"]) return true;
  const ua = String(headers["user-agent"] || "");
  return INTERNAL_UAS.some(([re]) => re.test(ua));
}

// Which records a query wants. `client` is the default everywhere except the Traffic tabs, so every existing consumer
// (the Usage page, the daily rollups, the budget alert, the assistant, the `/cost` command) keeps its meaning: this
// change makes memory's calls VISIBLE, it does not silently fold them into anyone's totals.
export function recordInScope(rec, scope = "client") {
  if (scope === "all") return true;
  const mem = isMemoryRecord(rec);
  return scope === "memory" ? mem : !mem;
}

/** By client's names for what no tool of the person's sent: a session's own turn in the harness, and a call of
 *  Filament's own (a replay, a coding agent's own cycle, a round whose turn is no longer kept). */
export const HARNESS_CLIENT = "Filament harness";
export const OWN_CLIENT = "Filament (its own calls)";

/**
 * Who asked for a model call: the tool that began its turn. A turn's rounds and a sub-agent's reach the front door
 * from Filament itself, over loopback, where they go by the name `node` — read by user agent alone, every one of them
 * was a client called "node" (HarnessV4_Tasks C7). The walk goes up to the request nothing began; a session's own turn
 * is the harness's, and a call of Filament's own whose beginning is no longer kept says so. One rule for the 24-hour
 * summary and for the days' own sums (`DailyUsage`'s `who`), read as a call finishes: what began it is still kept then.
 * @param {any} r  the record
 * @param {(id: string) => any} kept  a record still kept, by its id
 * @returns {string}
 */
export function clientOf(r, kept) {
  let top = r;
  for (let hop = 0; hop < 32; hop++) {
    const up = kept(top.agentOf || top.subagentOf || top.parentRequest);
    if (!up || up === top) break;
    top = up;
  }
  if (top.api === "session") return HARNESS_CLIENT;
  const name = String(top.ua || "unknown").split(/[\s/]/)[0] || "unknown";
  return name === "node" ? OWN_CLIENT : name;
}

/** The sources that are a turn of their own: what a row in "now" stands for. */
const TURN_SOURCES = new Set(["agent-loop", "subagent"]);
/** What the live list says of a reply as it streams (`live()`): a turn of Filament's own takes these from its model
 *  call in flight (`nestLive`). */
const STREAM_FIGURES = ["liveOutTokens", "liveThinkTokens", "liveTps", "liveTpsNow", "liveTpsWriting", "sinceOutputMs"];
/**
 * The in-flight list with every request placed under the turn it belongs to (HarnessV3-Responsiveness R6). A turn's
 * model calls and a sub-agent's turn carry `parentId` when that parent is still in flight too, and a turn says what
 * it is doing right now (`now`): a model call in flight, else its newest tool still open (`wait` reads as waiting),
 * else a wait on its sub-agents since the round began, else working. The tray and the dashboard draw one row per
 * turn from it — the turn and its current call were two unrelated rows, and between calls the turn's row alone read
 * "waiting…" for minutes.
 *
 * A turn takes no byte of a reply itself: what streams is its model call's. Its own record counted the time since
 * its first byte as silence, so every turn read `stalled` three seconds in, with nothing streamed, while its call
 * wrote (HarnessV4_Tasks U1, found on the Requests page). Its stream figures are its call's in flight; between
 * calls it has none, and is not stalled: `now` says what it does.
 * @param {any[]} active  `usage.live()`
 * @param {(runId: string) => any[] | null} recentEvents  a run's newest events, or null when there is no such run
 * @param {number} [now]  epoch ms, the run events' clock
 */
export function nestLive(active, recentEvents, now = Date.now()) {
  const ids = new Set(active.map((r) => r.id));
  const rows = active.map((r) => ({ ...r, parentId: [r.agentOf, r.subagentOf].find((p) => p && ids.has(p)) || null }));
  for (const r of rows) {
    if (!TURN_SOURCES.has(r.source)) continue;
    const call = rows.find((c) => c.parentId === r.id && !TURN_SOURCES.has(c.source));
    for (const k of STREAM_FIGURES) r[k] = call ? (call[k] ?? null) : null;
    r.stalled = !!call?.stalled;
    if (call) {
      r.now = { what: "model", model: call.model, forMs: call.elapsedMs ?? null };
      continue;
    }
    const evs = recentEvents(r.id);
    if (!evs) continue;
    /** @type {Map<string, any>} */
    const open = new Map();
    /** @type {any} */
    let waiting = null;
    let lastTs = null;
    for (const e of evs) {
      if (e.type === "tool-start") open.set(String(e.id), e);
      else if (e.type === "tool-end") open.delete(String(e.id));
      else if (e.type === "round-start") waiting = null;
      else if (e.type === "waiting") waiting = e;
      if (Number(e.ts) > 0) lastTs = Number(e.ts);
    }
    const tool = [...open.values()].at(-1);
    const since = (/** @type {any} */ e) => (Number(e?.ts) > 0 ? Math.max(0, now - Number(e.ts)) : null);
    if (tool?.name === "wait") r.now = { what: "waiting", why: "waiting for its sub-agents", forMs: since(tool) };
    else if (tool) r.now = { what: "tool", name: tool.name, args: tool.args ?? null, forMs: since(tool) };
    else if (waiting) r.now = { what: "waiting", why: waiting.why ?? null, forMs: since(waiting) };
    else r.now = { what: "working", forMs: lastTs ? Math.max(0, now - lastTs) : null };
  }
  return rows;
}

// Pricing lookups live in core/pricing.js; re-exported for the callers that learned them here.
export {
  normalizeModelForPricing,
  contextWindowFor,
  estimateCost,
} from "../core/pricing.js";
import { estimateCost, priceSourceOf } from "../core/pricing.js";

export class UsageStore extends EventEmitter {
  constructor({ dataDir, options }) {
    super();
    this.dataDir = dataDir;
    this.options = options;
    this.records = [];
    this.byId = new Map();
    this.setMaxListeners(100);
    this.#restore();
    // Per-day totals live in their own small file; without a request log (tests, `logFile: ""`) they stay in memory.
    const logFile = options?.logFile;
    const dlog = (level, msg) => this.emit(level === "warn" ? "warn" : "info", msg);
    // Two durable stores: client traffic (general) and memory's own model calls, split by isMemoryRecord so each page
    // sees only its own past. The general store counts model calls alone (isModelCall, HarnessV3-Launch LD-D9), and
    // keeps who asked for each by the day: its client (`clientOf`, by the ring's own index — a call's parents are in it
    // as it finishes) and the project memory booked it on, as summary() reads them.
    this.dailyStore = new DailyUsage({
      dataDir,
      persist: !!logFile,
      filter: (r) => !isMemoryRecord(r) && isModelCall(r),
      who: (r) => ({ client: clientOf(r, (id) => this.byId.get(id)), project: r.memory?.project || null }),
      log: dlog,
    });
    this.memDailyStore = new DailyUsage({
      dataDir,
      file: "memory-usage.json",
      persist: !!logFile,
      filter: isMemoryRecord,
      rowExtra: (r) => ({ purpose: r.memoryFor.purpose }),
      log: dlog,
    });
  }

  // Reload the most recent records from the JSONL log so a restart does not blank the dashboard: the current file's
  // newest first, then each rotated generation's, newest first, until the ring is full — a restart just after a
  // rotation finds them in `.1`.
  #restore() {
    const file = this.options?.logFile;
    if (!file || !this.dataDir) return;
    try {
      const keep = this.options?.keepLastRequests || 500;
      /** Each file's records, oldest first; the files oldest first. @type {any[][]} */
      const parts = [];
      let have = 0;
      for (const path of logGenerationFiles(join(this.dataDir, file)).reverse()) {
        if (have >= keep) break;
        const { records } = readLastJsonlRecords(path, { keep: keep - have });
        parts.unshift(records);
        have += records.length;
      }
      for (const r of parts.flat()) {
        r._t0 = performance.now() - (r.totalMs || 0);
        r.restored = true;
        this.records.push(r);
        this.byId.set(r.id, r);
      }
    } catch {
      /* no log yet */
    }
  }

  configure(options) {
    this.options = options;
    this.dailyStore.persist = !!(options?.logFile && this.dataDir);
    this.memDailyStore.persist = this.dailyStore.persist;
  }

  /** The request log's reach (`readLogReach`), worked out once and again after a rotation; the appends since only add
   *  their bytes. Null without a log. */
  logReach() {
    const file = this.options?.logFile;
    if (!file || !this.dataDir) return null;
    if (!this.#reach || !this.#reach.since) this.#reach = readLogReach(join(this.dataDir, file));
    return { ...this.#reach };
  }
  /** @type {{ since: string | null, files: number, bytes: number, maxBytes: number } | null} */
  #reach = null;

  start(meta) {
    const id = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
    const rec = {
      id,
      ts: new Date().toISOString(),
      status: "pending",
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0 },
      cost: null,
      ttftMs: null,
      totalMs: null,
      changes: [],
      ...meta,
    };
    rec._t0 = performance.now();
    this.records.push(rec);
    this.byId.set(id, rec);
    const keep = this.options?.keepLastRequests || 500;
    // W3.7: when the ring is full, drop a finished tick or sub-agent call before a client request so a long agent turn
    // cannot evict the traffic you actually wanted to see. Pending rows of any source stay — and so do the finished
    // calls of a turn still running, which it reads by id until it ends (its cache's state, its recalls, its list price,
    // where its context ended: the owner's chat of 11-11, whose ticks a ring full of client requests dropped one by one).
    /** @param {any} r */
    const held = (r) => r.status === "pending" || ((r.agentOf || r.subagentOf) && this.byId.get(r.agentOf || r.subagentOf)?.status === "pending");
    while (this.records.length > keep) {
      let dropAt = -1;
      for (let i = 0; i < this.records.length; i++) {
        const r = this.records[i];
        if (held(r)) continue;
        if (r.agentOf || r.subagentOf) {
          dropAt = i;
          break;
        }
      }
      if (dropAt < 0) dropAt = this.records.findIndex((r) => !held(r));
      if (dropAt < 0) break;
      const old = this.records.splice(dropAt, 1)[0];
      this.byId.delete(old.id);
    }
    if (this.options?.broadcast !== false)
      this.emit("event", { type: "start", record: this.publicRecord(rec) });
    return rec;
  }

  // The first byte of the reply: the request stops being "pending" (sent on, nothing back yet) and is "in flight".
  // Broadcast at once so the dashboard flips the state without waiting for the next throttled progress event.
  // `buffered: true` marks the calls where that moment is NOT a real first byte — the whole reply was already in
  // hand (an upstream that answered a streaming request with plain JSON, or a reply Filament wrote itself). Without
  // the distinction, a comparison of first-byte times puts a genuine TTFT next to a total and calls it a speedup.
  firstByte(rec, { buffered = false } = {}) {
    if (rec.ttftMs != null) return;
    rec.ttftMs = Math.round(performance.now() - rec._t0);
    if (buffered) rec.ttftBuffered = true;
    for (const f of rec._onFirstByte || []) {
      try {
        f(rec);
      } catch {}
    }
    // Run once, they go: a closure keeps the whole scope it was made in alive — the request it was made for, the chat
    // composed for it — and the record stays among the last kept for long after (the crashes of 11-14).
    delete rec._onFirstByte;
    if (this.options?.broadcast !== false)
      this.emit("event", { type: "first-byte", record: this.publicRecord(rec) });
  }

  /** An observer run inside `finish`, after the tokens settle and before the record persists; its string return is
   * appended to the record's changes. The cache-churn watch stamps the request that crossed its line this way.
   * @param {(rec: any) => string | null} fn */
  setOnFinishRecord(fn) {
    this.onFinishRecord = fn;
  }

  // Streaming progress. Every call records a sample (time, characters so far) for the speed over the last second and
  // notes when output last grew, and how long it has been writing; the broadcast to the dashboard is throttled to one
  // event per second per request, the newest held-back state said at that second's end (`sayProgress`). `thinkChars`
  // (part of outChars) and `stage` (thinking / answering / using tools) are optional extras for agents; `thinkTokens`,
  // an agent's own count of what it has thought so far, where it says one (Claude's estimate: its thinking may stream
  // no words; HarnessV4_Tasks B10).
  /** @param {any} rec @param {{ outChars?: number, thinkChars?: number | null, thinkTokens?: number | null, stage?: string | null }} [p] */
  progress(rec, { outChars = 0, thinkChars = null, thinkTokens = null, stage = null } = {}) {
    const now = performance.now();
    rec.liveOutChars = outChars;
    if (thinkChars != null) rec.liveThinkChars = thinkChars;
    if (thinkTokens != null) rec.liveThinkSaid = thinkTokens;
    if (stage) rec.liveStage = stage;
    // An agent's stage that writes nothing (its tools, a question to you) stops the writing: the time to its next
    // words is none of it (`_writeFrom`).
    if (stage && !WRITING_STAGES.has(stage)) rec._writeFrom = null;
    if (outChars > (rec._lastOutChars || 0) || rec._lastOutput == null) {
      rec._writing = addWriting(rec._writing || { ms: 0, chars: 0 }, rec._writeFrom, rec._lastOutChars || 0, now, outChars);
      rec._lastOutput = now;
      rec._writeFrom = now;
      rec._lastOutChars = outChars;
    }
    const s = (rec._samples ||= []);
    s.push([now, outChars]);
    while (s.length > 1 && now - s[0][0] > 5000) s.shift();
    if (rec._lastProgress && now - rec._lastProgress < 1000) {
      // What the throttle holds back is said when its second ends: a stream that stalls right after would otherwise
      // leave its last figures unsaid for as long as it stalls (HarnessV4_Tasks U3-5: a compaction's row).
      if (!rec._progressDue && this.options?.broadcast !== false) {
        rec._progressDue = setTimeout(() => {
          rec._progressDue = null;
          if (rec.totalMs == null) this.sayProgress(rec);
        }, 1000 - (now - rec._lastProgress));
        rec._progressDue.unref?.();
      }
      return;
    }
    this.sayProgress(rec, now);
  }

  /**
   * A call's progress, broadcast. `quietMs` is how long ago its output last grew: zero as it grows, the wait since
   * where the throttle held the word back.
   * @param {any} rec @param {number} [now]
   */
  sayProgress(rec, now = performance.now()) {
    clearTimeout(rec._progressDue);
    rec._progressDue = null;
    rec._lastProgress = now;
    if (this.options?.broadcast !== false)
      this.emit("event", { type: "progress", record: this.publicRecord(rec), quietMs: rec._lastOutput != null ? Math.max(0, Math.round(now - rec._lastOutput)) : 0 });
  }
  // In-flight requests as the dashboard shows them. phase: `pending` (sent on, no byte of the reply yet) or
  // `streaming` (the reply is arriving). Times: elapsed, the wait before the first byte, the streaming time. Output so
  // far (~4 characters per token; thinking counted separately when known — by the agent's own count where it says one
  // and that is more than its streamed words come to), the average speed since the first byte, the
  // speed over the last second, the speed while it was writing (its pauses left out, as the composer's gauge counts
  // it), how long the output has been quiet (an agent thinking or running a tool shows as a pause), and what the agent
  // is doing when it said so.
  live() {
    // Deliberately unscoped: everything in flight is worth seeing, whatever caused it — a summary's slice call among
    // them, on the Home live panel while it runs and in Traffic after.
    const now = performance.now();
    return this.records
      .filter((r) => r.status === "pending")
      .map((r) => {
        const elapsed = Math.round(now - r._t0);
        const streaming = r.ttftMs != null;
        const streamMs = streaming ? Math.max(1, elapsed - r.ttftMs) : 0;
        const thinkWords = r.liveThinkChars != null ? Math.ceil(r.liveThinkChars / 4) : null;
        const thinkTok = r.liveThinkSaid != null ? Math.max(thinkWords || 0, r.liveThinkSaid) : thinkWords;
        const outTok = Math.ceil((r.liveOutChars || 0) / 4) + (thinkTok || 0) - (thinkWords || 0);
        const sinceOutputMs = !streaming
          ? null
          : r._lastOutput != null
            ? Math.round(now - r._lastOutput)
            : streamMs;
        return {
          ...this.publicRecord(r),
          phase: streaming ? "streaming" : "pending",
          elapsedMs: elapsed,
          waitMs: streaming ? r.ttftMs : elapsed,
          streamMs,
          liveOutTokens: outTok,
          liveThinkTokens: thinkTok,
          liveTps: streamMs ? Math.round((outTok / (streamMs / 1000)) * 10) / 10 : null,
          liveTpsNow: streaming ? rateNow(r._samples, now) : null,
          liveTpsWriting: streaming ? writingRate(r._writing) : null,
          sinceOutputMs,
          stalled: streaming && sinceOutputMs > 3000,
          stage: r.liveStage || null,
        };
      });
  }

  /**
   * @param {any} rec @param {any} patch @param {any} [upstreamTable]
   * @param {{ billing?: "metered" | "plan" }} [opts]  how the model is billed at its upstream (`billingFor`); metered when unsaid
   */
  finish(rec, patch, upstreamTable = null, opts = {}) {
    // One finish per record, as the app closes it once (app/finish.js): a record that already closed says nothing the
    // second time — run again, the observers would count it twice (the churn watch the leg) and the daily rollup book it
    // twice.
    if (rec.totalMs != null) return;
    Object.assign(rec, patch);
    // A call that ended without the reply it was counting — failed mid-stream, cut, its client gone — keeps what had
    // streamed, so a stuck call and a working one can be told apart afterwards (HarnessV3-FailurePoints §5.1 item 4).
    if (rec.status !== "ok" && rec.textChars == null && rec.thinkingChars == null && Number(rec.liveOutChars) > 0) {
      rec.thinkingChars = Number(rec.liveThinkChars) || 0;
      rec.textChars = Math.max(0, Number(rec.liveOutChars) - rec.thinkingChars);
    }
    rec.totalMs = Math.round(performance.now() - rec._t0);
    for (const f of rec._onFinish || []) {
      try {
        f(rec);
      } catch {}
    } // e.g. the memory trace attaches itself
    // The record observer (the cache-churn watch): run after the tokens settle and before the record persists, so
    // its verdict lands on the very request that crossed the line and survives the reload.
    if (this.onFinishRecord) {
      try {
        const note = this.onFinishRecord(rec);
        if (note) (rec.changes ||= []).push(note);
      } catch {}
    }
    rec.tps = computeTps(rec); // output tokens per second (see daily.js for the rating rules)
    clearTimeout(rec._progressDue);
    for (const k of [
      "liveOutChars",
      "liveThinkChars",
      "liveThinkSaid",
      "liveStage",
      "_lastProgress",
      "_progressDue",
      "_lastOutput",
      "_writeFrom",
      "_lastOutChars",
      "_samples",
      "_writing",
      // The observers, run (`firstByte`'s say why): one whose first byte never came goes here.
      "_onFirstByte",
      "_onFinish",
    ])
      delete rec[k];
    // Two figures (Providers D8). `listCost` is the tokens at the card — the upstream's own, else the built-in
    // estimates; null when nothing names the model. `cost` is what was paid: the list figure on a
    // metered model, 0 on a plan (its subscription pays). A provider that stated what it charged keeps that figure
    // as `cost` (patch.cost), and so does an agent that reported one. An agent turn's tokens are estimates: it is
    // paid by the agent's subscription (`cost` null unless the agent said), and its list figure comes only from a
    // card the operator wrote, never from a built-in guess — or from the agent itself, which prices its own tokens at
    // the API's rates (patch.listCost).
    if (rec.tokens) {
      const model = rec.upstreamModel || rec.model;
      const operatorPriced = priceSourceOf(model, upstreamTable) === "upstream";
      rec.listCost =
        patch.listCost != null ? patch.listCost : rec.estimatedTokens && !operatorPriced ? null : estimateCost(model, rec.tokens, upstreamTable, { fast: rec.speed === "fast", flex: rec.speed === "flex" });
      rec.billing = opts.billing === "plan" ? "plan" : "metered";
      if (!("cost" in patch)) rec.cost = rec.estimatedTokens ? null : rec.billing === "plan" ? 0 : rec.listCost;
    }
    this.persist(rec);
    // Each store's filter says what it counts: the general one model calls alone (an agent-loop parent carries the
    // turn's tokens for the client-facing contract, but its ticks are what really hit upstreams), the memory one
    // memory's own.
    this.dailyStore.add(rec);
    this.memDailyStore.add(rec);
    if (this.options?.broadcast !== false) {
      // A subscriber's throw is the subscriber's: escaping here it would reach the reply path's catch, which tells a
      // client whose reply already completed that its stream failed.
      try {
        this.emit("event", { type: "finish", record: this.publicRecord(rec) });
      } catch (e) {
        this.emit("warn", `usage: a finish subscriber threw on ${rec.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // `source` is derived here rather than stored at `start()`: the tags that decide it (`memoryFor`, `replayOf`,
  // `agentOf`, `subagentOf`) are attached to the record *after* it starts, so only the finished record can be
  // classified. Both the list view and the detail view go through the same one function, so the row and its drawer
  // can never disagree about who caused a request.
  publicRecord(rec) {
    const { inboundBody, shapedBody, translation, shapedHeaders, memoryTrace, ...rest } = stripPrivate(rec);
    return {
      ...rest,
      source: recordSource(rec),
      phase: rec.status === "pending" ? (rec.ttftMs == null ? "pending" : "streaming") : undefined,
      hasBodies: !!(inboundBody || shapedBody),
      hasTranslation: !!translation,
      hasMemoryTrace: memoryTrace ? true : undefined,
    };
  }

  detail(id) {
    const rec = this.byId.get(id);
    if (!rec) return null;
    return { ...stripPrivate(rec), source: recordSource(rec) };
  }

  // `scope` decides which records a view sees: "client" (the default), "memory" (Filament's own calls) or "all" (the
  // unified Traffic feed).
  list(limit = 100, { scope = "client" } = {}) {
    return this.records
      .filter((r) => recordInScope(r, scope))
      .slice(-limit)
      .reverse()
      .map((r) => this.publicRecord(r));
  }
  memoryList(limit = 100) {
    return this.list(limit, { scope: "memory" });
  }
  // Every record in the ring that belongs to one archived session, oldest first: the client requests the memory
  // service placed on the chain, memory's own calls tagged for it, and the ticks and sub-agent calls whose parent is
  // one of those. Raw records (not `publicRecord`), for aggregation; `capped` says the ring is full,
  // so requests older than its oldest row may be missing from what this returns.
  forChain(chainId) {
    const id = String(chainId);
    const ids = new Set();
    const out = [];
    for (const r of this.records)
      if (r.memory?.chain === id || r.memoryFor?.chain === id) {
        ids.add(r.id);
        out.push(r);
      }
    const parents = (r) => [r.agentOf, r.subagentOf, r.parentRequest].filter(Boolean);
    let grew = true;
    while (grew) {
      grew = false;
      for (const r of this.records)
        if (!ids.has(r.id) && parents(r).some((p) => ids.has(p))) {
          ids.add(r.id);
          out.push(r);
          grew = true;
        }
    }
    out.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    const keep = this.options?.keepLastRequests || 500;
    return { records: out, capped: this.records.length >= keep };
  }

  /**
   * How fast a model has answered lately: the median time to its first byte and the median output tokens a second of
   * its newest finished calls in the ring that measured both (the newest `n`), found by the name it was asked for or
   * the name its upstream knows it by. Null where the ring holds none: nothing is guessed.
   * @param {string} model @param {number} [n]
   * @returns {{ ttftMs: number, tps: number, calls: number } | null}
   */
  speedOf(model, n = 20) {
    const name = String(model || "");
    /** @type {number[]} */
    const first = [];
    /** @type {number[]} */
    const rate = [];
    for (let i = this.records.length - 1; name && i >= 0 && rate.length < n; i--) {
      const r = this.records[i];
      if (r.status !== "ok" || !(r.tps > 0) || r.ttftMs == null || (r.model !== name && r.upstreamModel !== name)) continue;
      first.push(Number(r.ttftMs));
      rate.push(Number(r.tps));
    }
    if (!rate.length) return null;
    const mid = (/** @type {number[]} */ a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
    return { ttftMs: mid(first), tps: mid(rate), calls: rate.length };
  }

  /**
   * How long a model's calls of one kind of Filament's own writing have taken lately, whole — the wait for its first
   * byte, its thinking, its words (HarnessV4_Tasks C33): the median of its newest finished ones in the ring (the newest
   * `n`). "compact": a compaction's summary — one call over the transcript, a slice of one, or a fork of the session's
   * own request. Null where the ring holds none: nothing is guessed.
   * @param {string} model @param {"compact"} kind @param {number} [n]
   * @returns {{ ms: number, calls: number } | null}
   */
  callTimeOf(model, kind, n = 10) {
    const name = String(model || "");
    /** @type {number[]} */
    const took = [];
    for (let i = this.records.length - 1; name && i >= 0 && took.length < n; i--) {
      const r = this.records[i];
      const mine = r.memoryFor?.purpose === kind || (kind === "compact" && r.forkFor === "compaction");
      if (!mine || r.status !== "ok" || !(Number(r.totalMs) > 0) || (r.model !== name && r.upstreamModel !== name)) continue;
      took.push(Number(r.totalMs));
    }
    if (!took.length) return null;
    return { ms: took.sort((x, y) => x - y)[Math.floor(took.length / 2)], calls: took.length };
  }

  /**
   * @param {number} [sinceMs]
   * @param {{ scope?: string, projectNamed?: ((id: string) => { name?: string | null, cwd?: string | null } | null) | null }} [opts]
   *   `projectNamed` names each By project bucket — its folder's name and the folder (HarnessV3-Launch LD-D8); without
   *   it the buckets carry their numbers alone.
   */
  summary(sinceMs = 24 * 3600 * 1000, { scope = "client", projectNamed = null } = {}) {
    const since = Date.now() - sinceMs;
    const out = {
      requests: 0,
      errors: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0 },
      cost: 0,
      // the same tokens at list price (Providers P4), and how many requests named one
      listCost: 0,
      listCostN: 0,
      byModel: {},
      byUpstream: {},
      byClient: {},
      byProject: {},
    };
    // Who asked for a model call: the tool that began its turn (`clientOf`), by the records the ring holds now.
    const kept = new Map(this.records.map((r) => [r.id, r]));
    for (const r of this.records) {
      if (!recordInScope(r, scope)) continue;
      if (new Date(r.ts).getTime() < since) continue;
      // Model calls alone, as the durable daily store counts them: a turn's parent (the agent loop's) is none — its
      // ticks are counted, and its own tokens are theirs added up, every agent turn read twice otherwise (backlog 20) —
      // and neither is Filament's own answer or a request stopped at the loop's door.
      if (!isModelCall(r)) continue;
      out.requests++;
      if (r.status === "error") out.errors++;
      for (const k of Object.keys(out.tokens)) out.tokens[k] += r.tokens?.[k] || 0;
      out.cost += r.cost || 0;
      if (typeof r.listCost === "number") {
        out.listCost += r.listCost;
        out.listCostN++;
      }
      const bm = (out.byModel[r.model] ||= {
        requests: 0,
        errors: 0,
        input: 0,
        cacheRead: 0,
        cacheWrite: 0,
        output: 0,
        thinking: 0,
        cost: 0,
        costN: 0,
        listCost: 0,
        listCostN: 0,
        ttftSum: 0,
        ttftN: 0,
        tpsSum: 0,
        tpsN: 0,
      });
      bm.requests++;
      if (r.status === "error") bm.errors++;
      bm.input += r.tokens?.input || 0;
      bm.cacheRead += r.tokens?.cacheRead || 0;
      bm.cacheWrite += r.tokens?.cacheWrite || 0;
      bm.output += r.tokens?.output || 0;
      bm.thinking += r.tokens?.thinking || 0;
      bm.cost += r.cost || 0;
      if (typeof r.cost === "number") bm.costN++;
      if (typeof r.listCost === "number") {
        bm.listCost += r.listCost;
        bm.listCostN++;
      }
      if (r.ttftMs != null) {
        bm.ttftSum += r.ttftMs;
        bm.ttftN++;
      }
      if (r.tps != null) {
        bm.tpsSum += r.tps;
        bm.tpsN++;
      }
      const bu = (out.byUpstream[r.upstream] ||= { requests: 0, errors: 0 });
      bu.requests++;
      if (r.status === "error") bu.errors++;
      // Who spent it and where: the client that asked (`clientOf`), the project memory booked it on (its folder, else
      // its turn's, LD-D8) — the Usage page answers "which tool / which folder burned the money".
      const client = clientOf(r, (id) => kept.get(id));
      const bc = (out.byClient[client] ||= { requests: 0, errors: 0, cost: 0, output: 0 });
      bc.requests++;
      if (r.status === "error") bc.errors++;
      bc.cost += r.cost || 0;
      bc.output += r.tokens?.output || 0;
      const project = r.memory?.project;
      if (project) {
        const bp = (out.byProject[project] ||= { requests: 0, errors: 0, cost: 0, output: 0 });
        bp.requests++;
        if (r.status === "error") bp.errors++;
        bp.cost += r.cost || 0;
        bp.output += r.tokens?.output || 0;
      }
    }
    if (projectNamed)
      for (const [id, bp] of Object.entries(out.byProject)) {
        const p = projectNamed(id);
        Object.assign(bp, { name: p?.name ?? null, cwd: p?.cwd ?? null });
      }
    const cacheable = out.tokens.input + out.tokens.cacheRead + out.tokens.cacheWrite;
    out.cacheHitRate = cacheable ? out.tokens.cacheRead / cacheable : 0;
    out.cost = Math.round(out.cost * 1e4) / 1e4;
    out.listCost = Math.round(out.listCost * 1e4) / 1e4;
    // Timing per model (the leaderboard's speed columns): means over the requests that reported them; the
    // raw sums are working fields and never leave (the Assistant's get_usage reads the same buckets).
    for (const bm of Object.values(out.byModel)) {
      if (bm.ttftN) bm.avgTtftMs = Math.round(bm.ttftSum / bm.ttftN);
      if (bm.tpsN) bm.avgTps = Math.round((bm.tpsSum / bm.tpsN) * 10) / 10;
      bm.cost = Math.round(bm.cost * 1e4) / 1e4;
      delete bm.ttftSum;
      delete bm.ttftN;
      delete bm.tpsSum;
      delete bm.tpsN;
    }
    return out;
  }

  // Per-minute buckets for the last `minutes`: requests, errors, output tokens, mean first-byte latency.
  // `scope` defaults to client traffic, so the Home chart keeps meaning "your tools"; a caller can ask for "all"
  // and get Filament's own calls in the same buckets. `calls`: model calls alone, as the durable daily store counts them
  // — a turn's parent is none, its ticks are — for a Dashboard's numbers (AF-D12), which read the same as by the day.
  timeline(minutes = 60, { scope = "client", calls = false } = {}) {
    const now = Date.now();
    const start = now - minutes * 60000;
    const buckets = Array.from({ length: minutes }, (_, i) => ({
      t: start + i * 60000,
      requests: 0,
      errors: 0,
      output: 0,
      input: 0,
      ttftSum: 0,
      ttftN: 0,
    }));
    for (const r of this.records) {
      if (!recordInScope(r, scope)) continue;
      if (calls && !isModelCall(r)) continue;
      const t = new Date(r.ts).getTime();
      if (t < start) continue;
      const b = buckets[Math.min(minutes - 1, Math.floor((t - start) / 60000))];
      b.requests++;
      if (r.status === "error") b.errors++;
      b.output += r.tokens?.output || 0;
      b.input += (r.tokens?.input || 0) + (r.tokens?.cacheRead || 0);
      if (r.ttftMs != null) {
        b.ttftSum += r.ttftMs;
        b.ttftN++;
      }
    }
    return buckets.map((b) => ({
      t: b.t,
      requests: b.requests,
      errors: b.errors,
      output: b.output,
      input: b.input,
      ttftMs: b.ttftN ? Math.round(b.ttftSum / b.ttftN) : null,
    }));
  }
  // Per-day totals for the last `days` (local midnight boundaries): requests, tokens, cost, top models.
  // `scope` defaults to client traffic: this feeds the Home 7-day chart, and folding Filament's own calls in would
  // change what "my week cost" means. The durable rollups (`dailyStore`/`memDailyStore`) are a separate mechanism
  // and stay split — see `finish()`.
  daily(days = 7, { scope = "client" } = {}) {
    const out = [];
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      out.push({
        day: localDay(d),
        start: d.getTime(),
        requests: 0,
        errors: 0,
        input: 0,
        output: 0,
        thinking: 0,
        cacheRead: 0,
        cost: 0,
        byModel: {},
      });
    }
    const first = out[0].start;
    for (const r of this.records) {
      if (!recordInScope(r, scope)) continue;
      const t = new Date(r.ts).getTime();
      if (t < first) continue;
      const b = out.find((x, i) => t >= x.start && (i === out.length - 1 || t < out[i + 1].start));
      if (!b) continue;
      b.requests++;
      if (r.status === "error") b.errors++;
      b.input += (r.tokens?.input || 0) + (r.tokens?.cacheRead || 0);
      b.output += r.tokens?.output || 0;
      b.thinking += r.tokens?.thinking || 0;
      b.cacheRead += r.tokens?.cacheRead || 0;
      b.cost += r.cost || 0;
      const m = (b.byModel[r.model] ||= { requests: 0, output: 0, cost: 0 });
      m.requests++;
      m.output += r.tokens?.output || 0;
      m.cost += r.cost || 0;
    }
    return out.map((b) => ({
      ...b,
      cost: Math.round(b.cost * 1e4) / 1e4,
      byModel: Object.entries(b.byModel)
        .sort((a, c) => c[1].requests - a[1].requests)
        .slice(0, 5)
        .map(([model, v]) => ({ model, ...v })),
    }));
  }
  // Health per upstream over the window: volume, error rate, latency percentiles, throughput, last error.
  // Scope defaults to client traffic; `all` adds Filament's own calls, which matters when a memory model is the one
  // failing: its errors would be invisible here with every one filtered out.
  upstreamStats(sinceMs = 24 * 3600 * 1000, { scope = "client" } = {}) {
    const since = Date.now() - sinceMs;
    const by = {};
    const pct = (arr, p) => {
      if (!arr.length) return null;
      const s = [...arr].sort((a, b) => a - b);
      return s[Math.min(s.length - 1, Math.floor(p * s.length))];
    };
    for (const r of this.records) {
      if (!recordInScope(r, scope) || !r.upstream || new Date(r.ts).getTime() < since) continue;
      const u = (by[r.upstream] ||= {
        requests: 0,
        errors: 0,
        ttft: [],
        total: [],
        tps: [],
        output: 0,
        input: 0,
        cost: 0,
        lastError: null,
        lastAt: null,
        models: {},
      });
      u.requests++;
      if (r.status === "error") {
        u.errors++;
        u.lastError = { at: r.ts, message: String(r.error || "").slice(0, 200), model: r.model };
      }
      if (r.ttftMs != null) u.ttft.push(r.ttftMs);
      if (r.totalMs != null && r.status !== "pending") u.total.push(r.totalMs);
      if (r.tps) u.tps.push(r.tps);
      u.output += r.tokens?.output || 0;
      u.input += (r.tokens?.input || 0) + (r.tokens?.cacheRead || 0);
      u.cost += r.cost || 0;
      u.lastAt = r.ts;
      u.models[r.upstreamModel || r.model] = (u.models[r.upstreamModel || r.model] || 0) + 1;
    }
    return Object.fromEntries(
      Object.entries(by).map(([id, u]) => [
        id,
        {
          requests: u.requests,
          errors: u.errors,
          errorRate: u.requests ? u.errors / u.requests : 0,
          ttftP50: pct(u.ttft, 0.5),
          ttftP95: pct(u.ttft, 0.95),
          totalP50: pct(u.total, 0.5),
          tpsP50: pct(u.tps, 0.5),
          output: u.output,
          input: u.input,
          cost: Math.round(u.cost * 1e4) / 1e4,
          lastError: u.lastError,
          lastAt: u.lastAt,
          topModels: Object.entries(u.models)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([m, n]) => ({ model: m, requests: n })),
        },
      ]),
    );
  }

  // Appends run off the request path (a busy agent must not wait on the disk); flush() lets a shutdown or a test wait.
  #dirReady = false;
  persist(rec) {
    const file = this.options?.logFile;
    if (!file) return;
    const line = JSON.stringify(stripPrivate(rec)) + "\n";
    this.#writes = (this.#writes || Promise.resolve())
      .then(async () => {
        // Once, not per request: mkdir is a syscall and this chain runs for every logged request. Kept inside the chain
        // (rather than done at construction) so a failure is retried on the next write instead of being swallowed.
        if (!this.#dirReady) {
          await mkdir(this.dataDir, { recursive: true });
          this.#dirReady = true;
        }
        const path = join(this.dataDir, file);
        try {
          // A full log another program holds open stays as it is, its generations with it, and takes this record; the
          // next append tries the rotation again. One that rotated may have let the oldest file go: the reach is read again.
          const st = await stat(path);
          if (st.size > MAX_LOG_BYTES && (await rotateLog(path))) this.#reach = null;
        } catch {}
        await appendFile(path, line);
        if (this.#reach) {
          this.#reach.bytes += Buffer.byteLength(line);
          if (!this.#reach.files) this.#reach = null; // the first write made the first file
        }
      })
      .catch((e) => this.emit("warn", `could not write ${file}: ${e.message}`));
  }
  #writes = null;
  // Every promise chained, not fired-and-forgotten: the daily stores now write asynchronously, so a shutdown that did
  // not wait for them could exit mid-write and lose the last of the usage data. `allSettled` because one store
  // failing must not stop the caller from awaiting the others.
  flush() {
    return Promise.allSettled([
      this.#writes || Promise.resolve(),
      this.dailyStore.flush(),
      this.memDailyStore.flush(),
    ]).then(() => undefined);
  }
}

// The redaction helpers live in ./redact.js (a leaf module): the op log redacts at the sink, and importing them from
// here would close an import cycle (ops → usage → schema → ops). Re-exported so every existing caller is unchanged.
import { redactSecrets, redactUnterminatedSecretTail } from "../core/redact.js";
export { redactSecrets, redactUnterminatedSecretTail };

// Working fields (timers, progress samples) start with an underscore and never leave the process.
function stripPrivate(rec) {
  const out = {};
  for (const k of Object.keys(rec)) if (k[0] !== "_") out[k] = rec[k];
  return out;
}

// Output speed over roughly the last second: tokens (characters ÷ 4) added since the newest sample that is at least
// a second old, or since the first sample while the stream is younger than that. No output in the last second = 0.
export function rateNow(samples, now, windowMs = 1000) {
  if (!samples?.length) return 0;
  const last = samples[samples.length - 1];
  if (now - last[0] > windowMs) return 0;
  let base = samples[0];
  for (let i = samples.length - 1; i >= 0; i--)
    if (now - samples[i][0] >= windowMs) {
      base = samples[i];
      break;
    }
  const dt = Math.max(windowMs, now - base[0]);
  return Math.round(((last[1] - base[1]) / 4 / (dt / 1000)) * 10) / 10;
}

// Writing time, counted the way the composer's speed gauge counts it (ui/harness/lib/speed.js: PAUSE_MS, LEAST_MS), so
// the tray and the composer say one speed: output that grows within WRITE_PAUSE_MS of its last growth was being
// written — a provider may send its words in bursts (Z.AI's GLM, some two seconds apart); a longer gap, or one an
// agent's stage says was no writing (its tools running, its question waiting), was a pause, and neither its time nor
// the output that ends it counts.
export const WRITE_PAUSE_MS = 4000;
const WRITE_LEAST_MS = 250;
/** An agent's stages that are writing: the rest stop it. */
const WRITING_STAGES = new Set(["thinking", "answering"]);

/**
 * The writing so far, once the output grew from `fromChars` at `fromAt` to `chars` at `at`.
 * @param {{ ms: number, chars: number }} w @param {number | null | undefined} fromAt @param {number} fromChars
 * @param {number} at @param {number} chars
 */
export function addWriting(w, fromAt, fromChars, at, chars) {
  if (fromAt == null || at - fromAt > WRITE_PAUSE_MS) return w;
  return { ms: w.ms + (at - fromAt), chars: w.chars + (chars - fromChars) };
}

/** Tokens a second (characters ÷ 4) over the writing so far; null before a quarter second of it. @param {{ ms: number, chars: number } | null | undefined} w */
export function writingRate(w) {
  return w && w.ms >= WRITE_LEAST_MS ? Math.round((w.chars / 4 / (w.ms / 1000)) * 10) / 10 : null;
}
