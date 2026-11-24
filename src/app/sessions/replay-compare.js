// @ts-check
// Replay-compare (HarnessV2 §10.6): "duplicate this session under other settings and replay the last N turns". The
// session is forked at the turn before the replayed ones (or a fresh session is opened when every turn is replayed),
// the feature's settings written on the copy, and the original turns' user messages sent to it one by one through the front door — the same
// row the harness uses. A run (`kind: replay-compare`) carries the progress: one `replay-turn` event per turn with
// both sides' numbers, and the whole table on `run-end`. The comparison is what the records say: tokens sent and
// billed, history → sent, cost, time. Nothing is written back to the original.
import { randomBytes } from "node:crypto";
import { loopbackPost } from "../../services/loopback.js";
import { selfAddress } from "../../services/config/store.js";
import { flatten } from "../../services/session-settings.js";

/** @typedef {Record<string, any>} Rec */
/**
 * @typedef {object} Side
 * @property {string | null} requestId
 * @property {string | null} status
 * @property {number | null} sentTokens  the history as sent, by Filament's count (the view)
 * @property {number | null} historyTokens
 * @property {number | null} inputTokens  what the upstream billed
 * @property {number | null} outputTokens
 * @property {number | null} cacheReadTokens
 * @property {number | null} costUsd
 * @property {number | null} ms
 * @property {string | null} form  the composer's form the turn went out in
 */

export const REPLAY_MAX_TURNS = 10;
const numOrNull = (/** @type {unknown} */ v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/** One side of the table from a request record (the original's or the replay's). @param {Rec | null} rec @param {number | null} ms @returns {Side} */
export function sideOf(rec, ms = null) {
  if (!rec) return { requestId: null, status: null, sentTokens: null, historyTokens: null, inputTokens: null, outputTokens: null, cacheReadTokens: null, costUsd: null, ms, form: null };
  return {
    requestId: String(rec.id),
    status: rec.status || null,
    sentTokens: numOrNull(rec.view?.sentTokens),
    historyTokens: numOrNull(rec.view?.historyTokens),
    inputTokens: numOrNull(rec.tokens?.input),
    outputTokens: numOrNull(rec.tokens?.output),
    cacheReadTokens: numOrNull(rec.tokens?.cacheRead),
    // An agent turn costs what its loop spent; the shell record itself bills one round at $0 (§9.3.4).
    costUsd: numOrNull(rec.agent?.spentUsd) ?? (typeof rec.cost === "number" ? rec.cost : null),
    ms: ms ?? numOrNull(rec.totalMs),
    form: rec.view?.form || null,
  };
}

/** The totals of one side over the rows. @param {Side[]} sides */
export function totalsOf(sides) {
  const sum = (/** @type {(s: Side) => number | null} */ pick) => sides.reduce((n, s) => n + (pick(s) || 0), 0);
  return { sentTokens: sum((s) => s.sentTokens), inputTokens: sum((s) => s.inputTokens), outputTokens: sum((s) => s.outputTokens), cacheReadTokens: sum((s) => s.cacheReadTokens), costUsd: Math.round(sum((s) => s.costUsd) * 1e6) / 1e6, ms: sum((s) => s.ms), turns: sides.length };
}

/**
 * @param {{
 *   sessions: { fork: Function, create: Function, patchSettings: Function },
 *   archive: () => any,
 *   usage: { detail: (id: string) => Rec | null },
 *   runs: { startRun: Function, endRun: Function } | null,
 *   events: { publish: (topic: string, payload: any) => any } | null,
 *   config: { get: () => any },
 *   log: (level: string, msg: string) => void,
 *   now?: () => number,
 *   selfBase?: () => string,
 * }} deps  `selfBase`: where Filament reaches itself now (AppDeps), the fork's turns' door
 */
export function createReplayCompare({ sessions, archive, usage, runs, events, config, log, now = Date.now, selfBase = () => selfAddress(config.get().server) }) {
  /** @type {Map<string, { runId: string, forkId: string, source: string, startedAt: number }>} */
  const active = new Map();
  /** The front door, from inside: the fork's turn row on loopback, as the harness would call it, waited on to its end
   *  (HarnessV3-FailurePoints §4 A; services/loopback.js: Node's fetch would give up on a reply's head at 300 s). The
   *  fork's turn stops as any session's does. Nobody is at the page for it (`unattended`, HarnessV4_Tasks C26): past
   *  the copy's line it makes room by the copy's method, and it goes into a cold cache, with no question first — a
   *  message a person later sends into the copy is asked as in any session. */
  const postTurn = async (/** @type {string} */ forkId, /** @type {any} */ content) => {
    const cfg = config.get();
    const key = (cfg.server?.inboundKeys || [])[0] || "";
    const t0 = now();
    const r = await loopbackPost(`${selfBase()}/api/sessions/${encodeURIComponent(forkId)}/turns`, {
      headers: { "content-type": "application/json", "x-filament-ui": "1", "x-api-key": key },
      body: JSON.stringify({ content, stream: false, unattended: true }),
    });
    const text = await r.text().catch(() => "");
    return { ok: r.ok, status: r.status, requestId: r.headers.get("x-filament-request-id"), ms: now() - t0, error: r.ok ? null : text.slice(0, 300) };
  };
  return {
    /**
     * Start one. Returns as soon as the copy exists and the run is open; the turns replay in the background. The copy
     * runs under the source's settings with `settings` over them, a session patch the feature names (memory off, tool
     * results as one line), or under your defaults alone (`defaults`: its own layer left behind).
     * @param {string} id  the source session
     * @param {{ settings?: any, defaults?: boolean, turns?: number, strategy?: string | null }} o
     */
    async start(id, { settings = null, defaults = false, turns = 3, strategy = null } = {}) {
      /** @type {any} */
      let a;
      try {
        a = archive();
      } catch (/** @type {any} */ e) {
        throw Object.assign(new Error(`replay-compare needs the archive: ${e?.message || "no archive"}`), { status: 503 });
      }
      const chain = a.getChain(id);
      if (!chain) throw Object.assign(new Error("no such session"), { status: 404 });
      if (active.has(id)) throw Object.assign(new Error("a replay-compare is already running for this session"), { status: 409, detail: active.get(id) });
      // Reserved before the first await, so a second POST racing this one meets the 409 rather than a second fork.
      active.set(id, { runId: "pending", forkId: "", source: id, startedAt: now() });
      try {
        return await begin(a, chain, id, { settings, defaults, turns, strategy });
      } catch (e) {
        if (active.get(id)?.runId === "pending") active.delete(id);
        throw e;
      }
    },
  };

  /**
   * The start proper, under the reservation: the checks, the copy, the run, the background replay.
   * @param {any} a @param {any} chain @param {string} id @param {{ settings: any, defaults: boolean, turns: number, strategy: string | null }} o
   */
  async function begin(a, chain, id, { settings, defaults, turns, strategy }) {
    // A turn Filament answered itself (`@mem`, `/help`) has no model call to compare; the replay takes the model's turns.
    const all = a.turnBodies(id);
    const completed = all.filter((/** @type {any} */ t) => t.final && !t.meta?.command);
    if (!completed.length) throw Object.assign(new Error("the session has no finished model turns to replay"), { status: 400 });
    const n = Math.min(REPLAY_MAX_TURNS, Math.max(1, Math.floor(Number(turns) || 1)), completed.length);
    const toReplay = completed.slice(-n);
    // The fork is cut at the newest finished turn before the first replayed one (a fork refuses an open turn), so it
    // holds everything that turn saw.
    const before = all.filter((/** @type {any} */ t) => t.final && Number(t.n) < Number(toReplay[0].n));
    const atTurn = before.length ? Number(before[before.length - 1].n) || 0 : 0;
    const patch = settings && typeof settings === "object" && !Array.isArray(settings) && Object.keys(flatten(settings)).length ? settings : null;
    // What the copy runs under, in words: the run's title and the table's line say it.
    const under = [defaults ? "your defaults" : "", patch ? Object.entries(flatten(patch)).map(([k, v]) => `${k} ${JSON.stringify(v)}`).join(", ") : ""].filter(Boolean).join(" with ") || "the same settings";
    // The copy: a fork just before the replayed turns, or a fresh session when they are all of them. A patch its layer
    // would refuse is refused before either is made.
    let forkId;
    if (atTurn >= 1) {
      const f = await sessions.fork(id, { atTurn, strategy, settings: defaults ? "project" : "inherit" });
      forkId = String(f.chainId);
      if (patch)
        try {
          sessions.patchSettings(forkId, { patch }, { via: "replay-compare" });
        } catch (/** @type {any} */ e) {
          throw Object.assign(new Error(`the copy ${forkId} could not take the settings: ${e?.message || e}`), { status: 400 });
        }
    } else {
      // A fresh copy starts as a new chat does, from your defaults, the patch over them — made from its chat, so one of
      // the person's in the copy Run on placed for it works there too (sessions `create`'s `source`).
      const row = sessions.create({ cwd: chain.meta?.cwd || a.getProject(chain.project_id)?.cwd || process.cwd(), model: chain.model || null, title: `replay of ${chain.title || id}`, settings: patch, kind: "fork", source: id });
      forkId = String(row.id);
      a.mergeMeta(forkId, { replayOf: { from: id, atTurn: 0 } });
    }
    a.mergeMeta(forkId, { replayOf: { from: id, atTurn, turns: toReplay.map((t) => Number(t.n)), under } });
    const runId = `rc-${randomBytes(4).toString("hex")}`;
    const meta = { source: id, fork: forkId, under, atTurn, turns: toReplay.map((t) => Number(t.n)), strategy: strategy || null };
    runs?.startRun({ id: runId, kind: "replay-compare", title: `replay ${n} turn${n === 1 ? "" : "s"} of ${chain.title || id} under ${under}`, meta });
    active.set(id, { runId, forkId, source: id, startedAt: now() });
    const publish = (/** @type {any} */ evt) => {
      try {
        events?.publish(`run:${runId}`, evt);
      } catch {}
    };
    // The turns replay after the answer went out: the caller follows the run.
    (async () => {
      /** @type {{ n: number, of: number, status: string, original: Side, replay: Side, error?: string }[]} */
      const rows = [];
      let status = "done";
      let at = toReplay[0];
      try {
        for (const [i, t] of toReplay.entries()) {
          at = t;
          const originalRec = (t.requestIds || []).map((/** @type {string} */ rid) => usage.detail(rid)).filter(Boolean).pop() || null;
          const original = sideOf(originalRec);
          const posted = await postTurn(forkId, t.user?.content ?? t.user);
          const replayRec = posted.requestId ? usage.detail(posted.requestId) : null;
          const replay = sideOf(replayRec, posted.ms);
          const row = { n: Number(t.n), of: n, status: posted.ok ? "ok" : "error", original, replay, ...(posted.error ? { error: posted.error } : {}) };
          rows.push(row);
          publish({ type: "replay-turn", ...row, i: i + 1 });
          if (!posted.ok) {
            status = "error";
            break;
          }
        }
      } catch (/** @type {any} */ e) {
        status = "error";
        log("warn", `replay-compare ${runId}: ${e?.message || e}`);
        publish({ type: "replay-turn", n: Number(at?.n) || 0, of: n, status: "error", original: sideOf(null), replay: sideOf(null), error: String(e?.message || e).slice(0, 300) });
      } finally {
        active.delete(id);
        const summary = { ...meta, rows, totals: { original: totalsOf(rows.map((r) => r.original)), replay: totalsOf(rows.map((r) => r.replay)) }, replayed: rows.filter((r) => r.status === "ok").length };
        runs?.endRun(runId, { status, summary });
      }
    })();
    return { runId, forkId, atTurn, turns: meta.turns, under };
  }
}
