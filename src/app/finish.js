// @ts-check
// Closing the record: the store takes the final tokens and cost, a served-by-a-fallback raises its alert, and the
// health board hears the outcome (an abort is never the upstream's fault). The pipeline and the commands reach this
// as deps.finish.
import { estimateCost, billingFor } from "../core/pricing.js";
import { billedByChildren, booksOnSession, ownAgentCall, spentIn, subagentCall } from "../core/turn-facts.js";
import { cacheSaid } from "../core/cache-facts.js";

/**
 * @param {object} f
 * @param {any} f.config  the ConfigStore
 * @param {any} f.usage  the record store
 * @param {any} f.health  the health board
 * @param {any} f.liveAborts  request id → the AbortController for an in-flight request; closing the record frees its slot
 * @param {(kind: string, text: string, key?: string) => void} f.pushAlert
 * @param {(level: string, ...args: any[]) => void} f.log
 * @param {any} [f.memory]  the memory façade, for its spend; absent in the few callers without memory
 * @param {((chainId: string, spend: any) => void) | null} [f.spent]  a session's spend ledger booked a request: an open
 *   page's Spend moves with each of a turn's model calls, not at its end. `spend` is the ledger as it was written
 *   (`meta.spend`).
 */
export function createFinish({ config, usage, health, liveAborts, pushAlert, log, memory = null, spent = null }) {
  return function finish(rec, patch) {
    // A record closes once (`_closed`, a `_` field: the store strips those before a persist or a client sees them). A
    // part of its close that throws — the store's persist, a ledger — reaches the caller, and a reply path's catch then
    // closes the record again: the close it had is its close, and the second says nothing. A part that throws costs the
    // close none of the parts after it: each runs, and the first throw reaches the caller once they all have.
    if (rec._closed) return;
    rec._closed = true;
    const failure = { threw: false, error: /** @type {unknown} */ (undefined) };
    /** @param {() => void} part */
    const run = (part) => {
      try {
        part();
      } catch (e) {
        if (failure.threw) return;
        failure.threw = true;
        failure.error = e;
      }
    };
    liveAborts.delete(rec.id);
    const upstream = (config.get().upstreams || []).find((u) => u.id === rec.upstream) || null;
    // A coding agent's turn says how the login it ran as pays (HarnessV3-ACP, AC3's drive D3); the rest are billed as
    // their upstream is.
    run(() => usage.finish(rec, patch, upstream?.pricing || null, { billing: patch?.billing || billingFor(String(rec.upstreamModel || rec.model || ""), upstream) }));
    // The session's spend ledger books this request (Step 5 D6): the session's own model
    // calls — a client request, an agent-loop tick, a sub-agent's call, each booked on the session the work is for
    // (memory.sessionChainOf follows a tick or a sub-agent to it) — not Filament's answers to commands, not memory's
    // own calls, and not the shell record of an agent turn (its ticks book themselves; the shell would count their
    // output twice, as the daily rollup already knows). The two
    // predicates are the one answer (Facade D2) — the daily rollup and the facts fold read the same ones. A request
    // refused before any model spent on it (Filament's own refusal, a provider's 529) books nothing (`spentIn`, as
    // `/cost` counts): no request of the spend, none unpriced, never the Cache widget's last request.
    const sessionChain = memory && booksOnSession(rec) && !billedByChildren(rec) && spentIn(rec) ? memory.sessionChainOf(rec) : null;
    /** What the spend ledger booked, where it booked: the page is told once the archive holds it. @type {any} */
    let booked = null;
    /** Whether the turn's running mark went with the ledgers' writes. */
    let stopped = false;
    const ledgers = () => {
      if (memory && sessionChain) {
        // The spend, in one write of the chain's meta.
        const byId = (/** @type {string} */ id) => usage.byId?.get(id) || null;
        booked = memory.spendAdd?.(sessionChain, ledgerEntry(rec, upstream, ownAgentCall(rec, byId), subagentCall(rec, byId)));
      }
      // The turn's facts (Facade D2): folded and stored in the same synchronous step as the record's close — a page
      // that hears the turn ended can never ask for the facts before they exist. The fold itself declines what does
      // not book on a session, so this is one unconditional call.
      memory?.turnFactsAdd?.(rec);
      // Its turn runs no more under this request (HarnessV3-FailurePoints finding 3): only a turn still running at a
      // restart is cut off by it.
      memory?.turnStopped?.(rec);
      stopped = true;
    };
    // These writes of a model call's end — its spend, its turn's facts, its turn's running mark — are
    // one transaction of the archive's, one commit where each was its own. A throw from one of them is what it was:
    // what was written before it stays, the rest of them is not run — the running mark aside (below) — and it reaches
    // the caller once the close is done.
    const book = () => run(ledgers);
    // A transaction that cannot begin or commit costs the record's close nothing, as each write's own commit failing
    // never did (each ledger call keeps its own guard): it is logged, and nothing it held is said.
    try {
      if (memory?.archive) memory.archive.transaction(book);
      else book();
    } catch (/** @type {any} */ e) {
      booked = null;
      stopped = false;
      log("warn", `ledgers: ${rec.id}'s bookings were not written (${String(e?.message || e).slice(0, 120)})`);
    }
    // The request runs its turn no more whatever became of the ledgers: a transaction that could not begin or commit,
    // or a ledger that threw before it, leaves the turn's running mark to a write of its own.
    if (!stopped) run(() => memory?.turnStopped?.(rec));
    // Saying it is the page's news, never the record's close: a failure is logged and the close goes on. The spend as
    // it was written goes with it, so the news needs no read of the chain.
    if (booked && spent)
      try {
        spent(/** @type {string} */ (sessionChain), booked);
      } catch (/** @type {any} */ e) {
        log("warn", `spend: a booking on ${sessionChain} could not be said (${String(e?.message || e).slice(0, 120)})`);
      }
    // What the closed record tells beyond itself — the alert of a request a backup served, the health board — is told
    // as the close's patch says the outcome, whatever a part before it threw.
    run(() => {
      if ((rec.attempt || 0) > 1 && patch.status === "ok" && config.get().alerts?.failover !== false)
        pushAlert(
          "failover",
          `a request was served by ${rec.upstream} after ${rec.attempt - 1} failover${rec.attempt === 2 ? "" : "s"}; its row in Traffic has the trail`,
          `failover:${rec.id}`,
        );
      if (!rec.upstream) return;
      if (patch.status === "ok")
        health.recordSuccess(rec.upstream, { ttftMs: rec.ttftMs, totalMs: rec.totalMs });
      else if (patch.status === "error" && rec.healthRecordedFor !== rec.upstream) {
        // An abort is never the upstream's fault: W8 D1 cooled a healthy provider because a cancelled compaction
        // was recorded as a retryable 502. `status: "aborted"` is the primary gate; the error-text check is a belt
        // in case a caller still passes status:"error" with an abort message.
        const cancelled = /client disconnected|operation was aborted/i.test(String(patch.error || ""));
        if (!cancelled) {
          // What the provider answered: the status the client got, or the one the provider refused a memory follow-up
          // with once the stream's head had gone out as 200 (`_upstreamStatus`).
          const status = patch._upstreamStatus ?? patch.httpStatus;
          const r = health.recordFailure(rec.upstream, {
            status,
            message: patch.error,
            retryable: status && status !== 200 ? undefined : true,
          }); /* an "error" with HTTP 200 is a stream that broke off: the upstream's fault */
          if (r.cooledDown) {
            (rec.changes ||= []).push(
              `health: ${rec.upstream} cooling down ${Math.round(r.waitMs / 1000)} s after ${r.failures} failure(s)`,
            );
            log(
              "warn",
              `${rec.upstream} cooling down for ${Math.round(r.waitMs / 1000)} s (${r.failures} failure(s))`,
            );
          }
        }
      }
      if (rec.providerMeta) health.recordMeta(rec.upstream, rec.providerMeta);
    });
    if (failure.threw) throw failure.error;
  };
}

/**
 * The session's spend ledger's entry for a request's tokens and figures (`memory.spendAdd`), as its close books it.
 * `own`: the session's own agent's call, which the ledger's last request is (core/turn-facts.js `ownAgentCall`);
 * `agent`: a sub-agent's, which the ledger counts apart too (`subagentCall`). `cacheSeen`: its usage said its cache
 * numbers (core/cache-facts.js), which the ledger's average and its last request go by; `upstream`: where it went,
 * which says whether the chat's next request goes there too.
 * @param {any} rec @param {any} upstream @param {boolean} own @param {boolean} [agent]
 */
export function ledgerEntry(rec, upstream, own, agent = false) {
  const t = rec.tokens || {};
  const model = String(rec.upstreamModel || rec.model || "");
  // The cache's savings, booked with the call (Step 6 §2.2 Cache): what the same request would have cost with every
  // token billed as plain input — reads at the read price instead of the input price, writes at the write price
  // instead of once-only — against what it did cost, both at list price (Providers P4: on a plan the paid figure is $0
  // and says nothing about the cache). Unpriced is unpriced: no fake zero.
  const noCache = rec.listCost == null
    ? null
    : estimateCost(model, { input: (Number(t.input) || 0) + (Number(t.cacheRead) || 0) + (Number(t.cacheWrite) || 0), output: Number(t.output) || 0 }, upstream?.pricing || null, { fast: rec.speed === "fast", flex: rec.speed === "flex" });
  return {
    at: Date.now(),
    requestId: rec.id,
    usd: Number(rec.cost) || 0,
    // the same tokens at list price (Providers D8): what a plan's requests are worth, as analytics
    listUsd: Number(rec.listCost) || 0,
    model,
    inputTokens: Number(t.input) || 0,
    outputTokens: Number(t.output) || 0,
    cacheReadTokens: Number(t.cacheRead) || 0,
    cacheWriteTokens: Number(t.cacheWrite) || 0,
    cacheWrite1hTokens: Number(t.cacheWrite1h) || 0,
    cacheSeen: cacheSaid(t),
    upstream: String(rec.upstream || ""),
    savedUsd: noCache != null ? Math.max(0, Math.round((noCache - rec.listCost) * 1e6) / 1e6) : 0,
    unpriced: rec.cost == null ? 1 : 0,
    listUnpriced: rec.listCost == null ? 1 : 0,
    // The session's last request is its own agent's: a side agent's call books its spend, never that. A coding
    // agent's turn is one record for all its model calls: its newest is the last request.
    own,
    agent,
    ...(rec._lastModelCall ? { call: rec._lastModelCall } : {}),
  };
}

/**
 * What a harness chat's coding agent spent in cycles of its own that no turn showed, left as the chat goes — let go
 * of unused past its keep limit (the ACP bridge's `onSpentLeft`): booked on the chat's own record, its spend ledger,
 * under its last turn and priced as that turn was billed — the agent's figure at the API's prices where it said one,
 * else its tokens at the card; paid where the turn's login paid by use, worth that while a plan paid it. Never the
 * ledger's last request: it is no call of the chat's prompts. → whether it was booked: false where the chat has no
 * ledger, or its record holds no turn of it that spent.
 * @param {{ config: any, usage: any, memory: any, log: (level: string, ...args: any[]) => void, spent?: ((chainId: string, spend: any) => void) | null }} deps
 * @returns {(left: { chain: string, facts: any }) => boolean}
 */
export function createLeftSpend({ config, usage, memory, log, spent = null }) {
  return ({ chain, facts }) => {
    if (!memory?.spendAdd || !facts?.usage) return false;
    const last = usage
      .forChain(chain)
      .records.filter((/** @type {any} */ r) => booksOnSession(r) && !billedByChildren(r) && spentIn(r) && memory.sessionChainOf(r) === chain)
      .at(-1);
    if (!last) return false;
    const upstream = (config.get().upstreams || []).find((/** @type {any} */ u) => u.id === last.upstream) || null;
    const model = String(last.upstreamModel || last.model || "");
    const t = facts.usage;
    const listCost = typeof facts.context?.cost === "number" ? facts.context.cost : estimateCost(model, t, upstream?.pricing || null);
    const rec = {
      id: last.id,
      upstreamModel: model,
      speed: last.speed,
      tokens: { input: Number(t.input) || 0, output: Number(t.output) || 0, cacheRead: Number(t.cacheRead) || 0, cacheWrite: Number(t.cacheWrite) || 0, ...(t.cacheSeen ? { cacheSeen: true } : {}) },
      listCost,
      cost: listCost == null ? null : last.billing === "plan" ? 0 : listCost,
    };
    const booked = memory.spendAdd(chain, ledgerEntry(rec, upstream, false));
    if (!booked) return false;
    // Saying it is the page's news, never the booking: a failure is logged, as a close's is.
    try {
      spent?.(chain, booked);
    } catch (/** @type {any} */ e) {
      log("warn", `spend: a booking on ${chain} could not be said (${String(e?.message || e).slice(0, 120)})`);
    }
    return true;
  };
}
