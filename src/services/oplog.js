// The operation log: everything Filament does that is NOT a model call, as durable, filterable events.
//
// Before this, an operation was observable only if it happened to leave a mark on a request record. Health cooldowns,
// config changes, background jobs, engine lifecycle, learner runs and alerts were either stdout-only (94 `log()` call
// sites, nothing persisted) or held in in-memory rings that vanish on restart. The W8 compaction incident needed two
// API endpoints, hand-matched timestamps and a lucky catch — the job objects were still in RAM — to reconstruct
// what happened, and one of the six passes' jobs was already gone.
//
// CONTENT-FREE BY CONTRACT, the same discipline MemoryTrace follows: ids, counts, durations, decisions. Never
// conversation text. `detail` values are truncated and the key count capped so a caller cannot accidentally turn this
// into a second copy of your chats — which would matter a lot now that it is written to disk and shown in the UI.
import { statSync, openSync, readSync, closeSync } from "node:fs";
import { appendFile, stat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
// The sink redacts, not just each producer: an upstream that echoes a credential in an error body would otherwise
// land in ops.jsonl through a thrown error's message on any present or FUTURE producer (the `log` channel already
// redacts its own lines for exactly this reason). Redact first, truncate after — truncating first could halve a
// token and evade the patterns.
import { redactSecrets } from "../core/redact.js";
import { OP_KINDS, OP_KIND_KEYS, DEFAULT_OP_KINDS } from "../core/op-kinds.js";
import { logGenerationFiles, rotateLog } from "./records.js";

// The kinds live in core/op-kinds.js (data the config schema needs without importing this log); re-exported here.
export {
  OP_KINDS,
  OP_KIND_KEYS,
  NOISY_OP_KINDS,
  DEFAULT_OP_KINDS,
  WIRED_OP_KINDS,
} from "../core/op-kinds.js";

const MAX_LOG_BYTES = 20 * 1024 * 1024;
/**
 * Rotated generations of the log kept beside the current file: `.1` (newest) … `.5` (oldest), 20 MB each, 120 MB at
 * most with the current file. They rotate as the request log's do (records.js `rotateLog`, BUG-22): only the oldest
 * goes, and a restart reads back across them.
 */
const OP_LOG_GENERATIONS = 5;
const MAX_DETAIL_KEYS = 24;
const MAX_DETAIL_STRING = 160;

// Bound a detail object so this log cannot become a second copy of a conversation. Numbers, booleans and short strings
// only; anything longer is cut with an ellipsis, and extra keys are dropped rather than truncated mid-value. Strings
// are redacted BEFORE the cut, so a credential in an upstream error body cannot reach the disk in the first 160 chars.
export function sanitizeDetail(detail) {
  if (!detail || typeof detail !== "object") return undefined;
  const safe = (s) => {
    const r = redactSecrets(String(s));
    return r.length > MAX_DETAIL_STRING ? `${r.slice(0, MAX_DETAIL_STRING)}…` : r;
  };
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(detail)) {
    if (n++ >= MAX_DETAIL_KEYS) {
      out._truncatedKeys = true;
      break;
    }
    if (v == null) continue;
    if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = safe(v);
    else if (Array.isArray(v))
      out[k] = v.slice(0, 12).map((x) => (typeof x === "object" ? "[obj]" : safe(x).slice(0, 60)));
    else out[k] = "[obj]";
  }
  return Object.keys(out).length ? out : undefined;
}

export class OpLog extends EventEmitter {
  constructor({ dataDir, options = {}, log = null } = {}) {
    super();
    this.dataDir = dataDir;
    this.options = options;
    this.log = log;
    this.ops = [];
    this.byId = new Map();
    this.#writes = null;
    this.#dirReady = false;
    this.#restore();
  }
  #writes;
  #dirReady;
  #closed = false;
  // The log file's size as this log knows it, and the file it is of: read once with a stat, then kept as it appends and
  // rotates — this log is the file's one writer — so an append costs no stat. Null where it is not known (not read yet,
  // or a write failed part way), and read again then.
  #size = null;
  #sizeOf = null;

  configure(options) {
    this.options = options || {};
  }
  get enabled() {
    return this.options?.ops?.enabled !== false;
  }
  // A floor of 10 rather than 50: silently ignoring a smaller setting would be the log lying about its own retention.
  // 0, a negative number or a non-number all mean "unset" and fall back to the default — documented, not guessed at.
  get keepLast() {
    const n = Number(this.options?.ops?.keepLast);
    return Number.isFinite(n) && n > 0 ? Math.max(10, Math.floor(n)) : 2000;
  }
  get file() {
    return this.options?.ops?.logFile ?? "ops.jsonl";
  }
  // Which kinds are shown by default. An explicit list wins; otherwise everything except the firehose kinds.
  get shownKinds() {
    const list = this.options?.ops?.kinds;
    return Array.isArray(list) && list.length
      ? list.filter((k) => OP_KIND_KEYS.includes(k))
      : DEFAULT_OP_KINDS;
  }

  // Record one operation. Returns the stored event (or null when the log is off), so a caller can pass its id on.
  // Never throws: observability must not be able to break the thing it is observing.
  record(kind, title, { sub = null, level = "info", detail = null, ms = null, ref = null } = {}) {
    if (!this.enabled || !OP_KIND_KEYS.includes(kind)) return null;
    try {
      const op = {
        id: `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
        ts: new Date().toISOString(),
        kind,
        sub: sub ? String(sub).slice(0, 48) : null,
        level: ["info", "warn", "error"].includes(level) ? level : "info",
        title: String(redactSecrets(String(title || ""))).slice(0, 300),
        detail: sanitizeDetail(detail) || undefined,
        ms: typeof ms === "number" ? Math.round(ms) : null,
        ref:
          ref && typeof ref === "object"
            ? Object.fromEntries(
                Object.entries(ref)
                  .filter(([, v]) => v != null)
                  .map(([k, v]) => [k, String(v).slice(0, 64)]),
              )
            : undefined,
      };
      this.ops.push(op);
      this.byId.set(op.id, op);
      const keep = this.keepLast;
      while (this.ops.length > keep) {
        const old = this.ops.shift();
        this.byId.delete(old.id);
      }
      this.#persist(op);
      this.emit("op", op);
      return op;
    } catch (e) {
      this.log?.("warn", `ops: could not record a ${kind} event (${String(e?.message || e).slice(0, 120)})`);
      return null;
    }
  }

  // Newest first, filtered. `kinds` may be a single kind or a list; `q` matches the title and any detail value.
  list({ kinds = null, since = 0, limit = 200, q = "", before = null } = {}) {
    const want = kinds
      ? (Array.isArray(kinds) ? kinds : [kinds]).filter((k) => OP_KIND_KEYS.includes(k))
      : null;
    const needle = String(q || "")
      .trim()
      .toLowerCase();
    const cut = before ? Date.parse(before) : 0;
    const out = [];
    for (let i = this.ops.length - 1; i >= 0 && out.length < limit; i--) {
      const o = this.ops[i];
      if (want && !want.includes(o.kind)) continue;
      const t = Date.parse(o.ts);
      if (t < since) continue;
      if (cut && t >= cut) continue;
      if (
        needle &&
        !`${o.title} ${o.sub || ""} ${o.kind} ${Object.values(o.detail || {}).join(" ")}`
          .toLowerCase()
          .includes(needle)
      )
        continue;
      out.push(o);
    }
    return out;
  }

  // Counts per kind over the window, so the UI can label a chip "health (4)" instead of guessing.
  counts({ since = 0 } = {}) {
    const out = Object.fromEntries(OP_KIND_KEYS.map((k) => [k, 0]));
    for (const o of this.ops) if (Date.parse(o.ts) >= since) out[o.kind] = (out[o.kind] || 0) + 1;
    return out;
  }

  // Appends run off the request path; flush() lets a shutdown or a test wait. Serialized, so two writes never
  // interleave and a rename can never race another rename of the same temp path.
  #persist(op) {
    const file = this.file;
    if (!file || !this.dataDir || this.#closed) return;
    this.#writes = (this.#writes || Promise.resolve())
      .then(async () => {
        if (!this.#dirReady) {
          await mkdir(this.dataDir, { recursive: true });
          this.#dirReady = true;
        }
        const path = join(this.dataDir, file);
        if (this.#sizeOf !== path) {
          this.#sizeOf = path;
          this.#size = null;
        }
        if (this.#size === null)
          try {
            this.#size = (await stat(path)).size;
          } catch (e) {
            if (e?.code === "ENOENT") this.#size = 0;
          }
        // A full log another program holds open stays as it is, its generations with it, and takes this operation; the
        // next append tries the rotation again.
        if (this.#size !== null && this.#size > MAX_LOG_BYTES && (await rotateLog(path, OP_LOG_GENERATIONS))) this.#size = 0;
        const line = `${JSON.stringify(op)}\n`;
        try {
          await appendFile(path, line);
        } catch (e) {
          this.#size = null;
          throw e;
        }
        if (this.#size !== null) this.#size += Buffer.byteLength(line);
      })
      .catch((e) => this.emit("warn", `ops: could not write ${file}: ${e.message}`));
  }
  flush() {
    return this.#writes || Promise.resolve();
  }
  /** The server's stop, after the last flush: later operations stay in the ring and are never written — a dir the
   *  stopped instance owned may already be gone, and the mkdir above would bring it back (HarnessV3-FixRound F1 item 1). */
  close() {
    this.#closed = true;
  }

  // Reload recent operations so a restart does not blank the System tab: the current file's newest first, then each
  // rotated generation's, newest first, until the ring is full — a restart just after a rotation finds the ring's
  // operations in `.1`, and every reader of the log reads this ring.
  #restore() {
    const file = this.file;
    if (!file || !this.dataDir) return;
    const keep = this.keepLast;
    const found = [];
    for (const path of logGenerationFiles(join(this.dataDir, file), OP_LOG_GENERATIONS).reverse()) {
      if (found.length >= keep) break;
      found.push(...newestOps(path, keep - found.length));
    }
    found.reverse();
    for (const o of found) {
      this.ops.push(o);
      this.byId.set(o.id, o);
    }
  }
}

/**
 * The newest `want` operations of one of the log's files, newest first. Each file is capped by rotation, so its tail is
 * read whole, up to a generation's size; a read that starts inside a line lets that line go. Nothing where the file
 * cannot be read.
 * @param {string} path @param {number} want
 */
function newestOps(path, want) {
  const found = [];
  try {
    const size = statSync(path).size;
    if (!size) return found;
    const read = Math.min(size, MAX_LOG_BYTES + 4 * 1024 * 1024);
    const fd = openSync(path, "r");
    const buf = Buffer.alloc(read);
    // A read may answer fewer bytes than it was asked for: it goes on until the tail is whole, and a file shorter than
    // when it was measured gives what it holds — never the zeros a read did not fill.
    let got = 0;
    try {
      while (got < read) {
        const k = readSync(fd, buf, got, read - got, size - read + got);
        if (!k) break;
        got += k;
      }
    } finally {
      closeSync(fd);
    }
    const lines = buf.subarray(0, got).toString("utf8").split("\n");
    if (read < size) lines.shift();
    for (let i = lines.length - 1; i >= 0 && found.length < want; i--) {
      const l = lines[i].trim();
      if (!l) continue;
      try {
        const o = JSON.parse(l);
        if (o && o.id && o.ts && OP_KIND_KEYS.includes(o.kind)) found.push(o);
      } catch {}
    }
  } catch {
    /* no such file */
  }
  return found;
}

// ---------------------------------------------------------------------------------------------------
// The wiring: which service events become which operations. These mappers are the op shapes' one home — the
// composition root calls them, the services stay independent of the log and keep working with observability off.
// ---------------------------------------------------------------------------------------------------

// Jobs become durable operations: `this.jobs` holds 20 in memory and is gone on restart; this survives both.
/** @param {any} memory @param {any} ops */
export function wireMemoryOps(memory, ops) {
  memory.onJobEvent = (job, phase, err) => {
    try {
      const r = job.result && typeof job.result === "object" ? job.result : null;
      const ms = job.startedAt && job.endedAt ? Date.parse(job.endedAt) - Date.parse(job.startedAt) : null;
      // A THROWN pass has no result, so its ids come from the job itself (attached at creation): without that the
      // one kind of pass you most need to find later — the crashed one — is an orphan no chain filter can reach.
      const ref = {
        jobId: job.id,
        chainId: r?.chain || job.chain || null,
        requestId: r?.requestId || job.requestId || null,
      };
      ops.record(
        "job",
        phase === "start"
          ? `${job.kind} started`
          : phase === "error"
            ? `${job.kind} failed: ${String(job.error || err?.message || "").slice(0, 160)}`
            : phase === "refused"
              ? `${job.kind} refused: ${String(r?.reason || "").slice(0, 160)}`
              : `${job.kind} finished`,
        {
          sub: phase,
          level: phase === "error" ? "error" : phase === "refused" ? "warn" : "info",
          ms,
          ref,
          detail: { kind: job.kind, percent: job.percent, progressEntries: (job.progress || []).length },
        },
      );
    } catch {
      /* observability must never break the job it is observing */
    }
  };
  // Learning runs -> the operation log. Assigned on the SERVICE and forwarded to the learner inside start(),
  // because the learner is constructed when a memory folder is opened and nulled by stop() - assigning straight to
  // memory.learner.onOp here would attach to null at boot and be lost on the first reopen. Until now the only record
  // of a learning run was learner.recent: in-RAM, capped at 100 entries, gone on restart.
  memory.onLearnerOp = (title, opts) => ops.record("learner", title, opts);
  // Curator passes -> the operation log, forwarded the same way: the curator is rebuilt on every memory open.
  memory.onCuratorOp = (title, opts) => ops.record("curator", title, opts);
  // Engine lifecycle -> the operation log, forwarded to the MemoryEngine instance inside start() for the same reason
  // as the learner: the engine is constructed lazily when a memory folder is opened and nulled by stop().
  // stderrTail is in-RAM (last 50 lines) and status() is a snapshot, so a sidecar that died hours ago and gave up
  // after three failures left nothing durable behind — which is exactly the kind of question this log exists for.
  memory.onEngineOp = (title, opts) => ops.record("engine", title, opts);
  // Every engine CALL -> the operation log as the noisy `engineop` kind (recorded, hidden by default). Forwarded
  // for the same reason as the lifecycle hook: the engine is built in start() and nulled by stop().
  memory.onEngineCallOp = (title, opts) => ops.record("engineop", title, opts);
  // Every memory search -> the operation log as the noisy `search` kind (recorded, hidden by default). Forwarded the
  // same way: the brain is rebuilt on every memory open.
  memory.onSearchOp = (title, opts) => ops.record("search", title, opts);
  // Archive-level operations -> the operation log. Deletes, backups, restores and reindexes are methods on the
  // long-lived MemoryService itself, so no forwarder is needed (unlike the learner and engine, which are rebuilt).
  memory.onArchiveOp = (title, opts) => ops.record("archive", title, opts);
}

// Every health state change becomes an operation, wrapped in ONE place rather than at each call site: five sites
// mutate health today (the finish() rollup, an unreachable upstream, a bad HTTP status, an error inside a 200
// stream, and the manual reset endpoint) and a sixth would be invisible if each had to remember to announce itself.
// This is also what makes W8's D1 diagnosable: a cooldown that was caused by a client hanging up now shows up as an
// event with the message that triggered it, next to the request that triggered it.
/** @param {any} health @param {any} ops */
export function wireHealthOps(health, ops) {
  const _fail = health.recordFailure.bind(health);
  health.recordFailure = (id, opts) => {
    const r = _fail(id, opts);
    if (r?.cooledDown) {
      ops.record(
        "health",
        `${id} cooled down for ${Math.round(r.waitMs / 1000)}s after ${r.failures} failure(s)`,
        {
          sub: "cooldown",
          level: "warn",
          ms: r.waitMs,
          detail: {
            upstream: id,
            failures: r.failures,
            waitMs: r.waitMs,
            status: opts?.status ?? null,
            retryable: opts?.retryable ?? null,
            message: String(opts?.message || "").slice(0, 160),
          },
          ref: { upstreamId: id },
        },
      );
    }
    return r;
  };
  const _reset = health.reset.bind(health);
  health.reset = (id) => {
    const r = _reset(id);
    ops.record("health", `${id}'s cooldown, failure count and learned concurrency cap were cleared by hand`, {
      sub: "reset",
      detail: { upstream: id },
      ref: { upstreamId: id },
    });
    return r;
  };
  const _ok = health.recordSuccess.bind(health);
  health.recordSuccess = (id, opts) => {
    // A success on a HEALTHY upstream is the common case — one op per request would be the firehose the log
    // deliberately hides. Only a success that CLEARS something is an event: without it the System tab showed every
    // upstream going down and none of them coming back. The pre-state is SNAPSHOT INTO SCALARS before calling
    // through — `state.get` returns the live object, which recordSuccess then mutates, so reading `before.failures`
    // after the call would always see zeros (the probe caught exactly that).
    const b = health.state.get(id); // `state.get`, never `#s`: a first-ever success must not manufacture a dirty board
    const hadFailures = b?.failures || 0;
    const hadCooldownUntil = b?.cooldownUntil || 0;
    const now = Date.now();
    const r = _ok(id, opts);
    if (b && (hadFailures > 0 || hadCooldownUntil > now)) {
      const early = hadCooldownUntil > now ? Math.round((hadCooldownUntil - now) / 1000) : 0;
      ops.record(
        "health",
        `${id} recovered — a successful call cleared ${hadFailures} failure(s)${early ? ` and ended its cooldown ${early}s early` : " after its cooldown had lapsed"}`,
        {
          sub: "recovered",
          detail: {
            upstream: id,
            failures: hadFailures,
            cooldownLeftMs: Math.max(0, hadCooldownUntil - now),
          },
          ref: { upstreamId: id },
        },
      );
    }
    return r;
  };
  const _quota = health.recordQuota.bind(health);
  health.recordQuota = (id, q) => {
    const r = _quota(id, q);
    ops.record("health", `${id} reported its remaining quota`, {
      sub: "quota",
      detail: { upstream: id, ...(q && typeof q === "object" ? q : {}) },
      ref: { upstreamId: id },
    });
    return r;
  };
}
