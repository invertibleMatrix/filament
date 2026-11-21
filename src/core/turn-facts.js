// @ts-check
// A turn's facts (HarnessV3-Facade D2): the numbers and notes one agent turn produced, folded once per request as
// the requests finish and stored on the archived turn (`meta.facts`), so every client's turn keeps its figures for
// good instead of for as long as a 500-row ring holds them. The fold is pure; the two predicates here are also the
// one answer to "parents don't bill" — the daily rollup, the goal/spend booking and this fold all read them, where
// each used to say it its own way.
//
// A record's turn is its root's: follow the lineage (`agentOf`, `subagentOf`, `parentRequest`) up to the record that
// has none; that root's `memory.turnId` is the turn. The roots are the turn's OWN requests — a harness turn's
// request, or each leg of an outside client's tool loop. A tick or a sub-agent is a child: its cost lands on the turn,
// its own internal chain's turn gets no facts.
import { seenWith } from "./cache-facts.js";

/**
 * Whether a record's billing is carried by its children (D2): an agent-loop parent carries the turn's tokens for
 * the client-facing contract, but its ticks are the calls that really hit upstreams. Counting both would double the
 * turn.
 * @param {any} rec
 */
export function billedByChildren(rec) {
  return !!(rec && rec.agent);
}

/**
 * A request Filament answered itself (`/set …`, `/goal …`, `/cost`, `@mem …`): a request through Filament, but no
 * model's. Some are marked `local`; a command answered on the loop's own turn carries `memory.command` alone.
 * @param {any} rec
 */
export function answeredByFilament(rec) {
  return !!(rec && (rec.local || (rec.memory && rec.memory.command)));
}

/**
 * Whether a record's spend is in: it has closed answered, or spent on its way — a stream its client hung up on
 * (`aborted`) was billed for what it streamed, a reply that failed past its first tokens for those. One refused
 * before any model spent on it (Filament's own refusal, a provider's 529) is no model's call to count, in a cache
 * line least of all; one in flight is not in yet.
 * @param {any} rec
 */
export function spentIn(rec) {
  if (!rec || rec.status === "pending") return false;
  const t = rec.tokens || {};
  return rec.status === "ok" || (rec.cost || 0) > 0 || (t.input || 0) + (t.output || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0) > 0;
}

/**
 * Whether a record books on its session (D2): memory's own model calls (`memoryFor`) and Filament's own answers
 * (`local`, a command's turn) belong to no turn's numbers.
 * @param {any} rec
 */
export function booksOnSession(rec) {
  return !!(rec && !rec.memoryFor && !answeredByFilament(rec));
}

/** The upstream id of the synthetic route (app/engine.js): how a turn enters the agent loop, never a provider. */
export const ENTRY_UPSTREAMS = Object.freeze({ agent: "__agent__" });

/**
 * Whether a record is a model call of its own, as Usage counts them (HarnessV3-Launch LD-D9): not a turn's parent
 * (its ticks are the calls), not Filament's own answer, and not a request that stopped at the loop's entry before it
 * reached any provider (the loop renames the upstream once it runs).
 * @param {any} rec
 */
export function isModelCall(rec) {
  return !!rec && !billedByChildren(rec) && !answeredByFilament(rec) && rec.upstream !== ENTRY_UPSTREAMS.agent;
}

/**
 * The lineage parent a record's numbers flow through, or null when the record is its own root. A sub-agent's run
 * flows into the request that launched it (a turn, a /subagent command); one the developer launched from the side
 * (`owner`) is a root of its own, with no turn.
 * @param {any} rec
 * @returns {string | null}
 */
export function lineageParentOf(rec) {
  if (!rec) return null;
  const launcher = rec.subagentOf && rec.subagentOf !== "owner" ? rec.subagentOf : null;
  return rec.agentOf || launcher || rec.parentRequest || null;
}

/**
 * Whether a model call is the session's own agent's — a round of its loop, its coding agent's turn — and no side
 * agent's (a sub-agent, a team's worker, a card that started by itself, a second look's Reviewer) nor Filament's fork of the
 * conversation: nothing on its way up to its turn (`agentOf`) was sent as a sub-agent's (`subagentOf`, `subagent`).
 * Their calls are the session's spend; the last request the Cache shows is its own agent's.
 * @param {any} rec @param {(id: string) => any} byId  a record by its id, null where the store has none
 */
export function ownAgentCall(rec, byId) {
  const seen = new Set();
  for (let cur = rec; cur; cur = cur.agentOf ? byId(String(cur.agentOf)) : null) {
    if (cur.subagentOf || cur.subagent || seen.has(cur.id)) return false;
    seen.add(cur.id);
  }
  return !!rec;
}

/**
 * Whether a model call is a sub-agent's — a round of a run sent as one (`subagent`), on it or on the run it is a round
 * of (`agentOf`) — and so the chat's sub-agents' share of its spend (the owner's of 11-05). A fork of the conversation
 * names no sub-agent: it is the chat's own, as its agent's turns are.
 * @param {any} rec @param {(id: string) => any} byId  a record by its id, null where the store has none
 */
export function subagentCall(rec, byId) {
  const seen = new Set();
  for (let cur = rec; cur; cur = cur.agentOf ? byId(String(cur.agentOf)) : null) {
    if (cur.subagent) return true;
    if (seen.has(cur.id)) return false;
    seen.add(cur.id);
  }
  return false;
}

/** When the record started (ms, from its ISO stamp). @param {any} rec */
export function recordStartMs(rec) {
  const t = Date.parse(rec?.ts || "");
  return Number.isFinite(t) ? t : 0;
}

/** When the record finished (ms): its start plus the total `finish` measured. @param {any} rec */
export function recordFinishMs(rec) {
  return recordStartMs(rec) + (Number(rec?.totalMs) || 0);
}

/**
 * What stopped a coding agent's turn on its plan (HarnessV3-ACP AC3-6), from its record: a failure the agent called a
 * limit while its account had a window spent, or Codex said why it stopped. The windows that ran out, when the plan
 * is free again (every one of them reset; null where one names no reset), Codex's reason, and whose plan it was. Null
 * for any other failure: an overloaded service, or a moment's rate limit with room left in every window, is no
 * plan's end.
 * @param {any} rec
 */
export function planLimit(rec) {
  const a = rec?.acp?.account;
  if (rec?.failure?.kind !== "limit" || !a) return null;
  const at = recordFinishMs(rec);
  /** @type {any[]} */
  const spent = (Array.isArray(a.windows) ? a.windows : []).filter(
    (/** @type {any} */ w) => (w.resetsAt == null || w.resetsAt > at) && (w.status === "rejected" || (Number(w.usedPercent) || 0) >= 100),
  );
  if (!spent.length && !a.reached) return null;
  return {
    windows: spent.map((w) => ({ id: w.id, label: w.label, resetsAt: w.resetsAt ?? null })),
    freeAt: spent.length && spent.every((w) => w.resetsAt != null) ? Math.max(...spent.map((w) => Number(w.resetsAt))) : null,
    reached: a.reached || null,
    account: { kind: a.kind, label: a.label, email: a.email ?? null },
    upstream: rec.upstream || null,
  };
}

/**
 * The models a turn's tokens were counted on, summed by model (HarnessV4_Tasks C13): most written first, then by
 * name — the same list whichever of the turn's records folds first.
 * @param {any[] | null | undefined} prev  the list so far @param {any[]} counted  a record's `acp.modelUsage`
 */
function countedModels(prev, counted) {
  const by = new Map((prev || []).map((m) => [String(m.model), { ...m }]));
  for (const m of counted) {
    const model = String(m.model);
    const was = by.get(model) || { model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    by.set(model, {
      model,
      input: was.input + (Number(m.input) || 0),
      output: was.output + (Number(m.output) || 0),
      cacheRead: was.cacheRead + (Number(m.cacheRead) || 0),
      cacheWrite: was.cacheWrite + (Number(m.cacheWrite) || 0),
    });
  }
  return [...by.values()].sort((a, b) => b.output - a.output || (a.model < b.model ? -1 : a.model > b.model ? 1 : 0));
}

// The newest-own-request selection keeps its comparison point on the facts object under a symbol: it rides the
// in-process fold chain and vanishes when the facts are stored (JSON.stringify drops symbol keys), so nothing private
// ever reaches the archive.
const OWN_AT = Symbol("ownAt");
/** How much of what a failure said under its words a turn keeps: an agent's stderr tail, for the card's fold. */
const ERROR_DETAIL_CHARS = 4000;

/**
 * Fold one record into a turn's facts. `own` marks one of the turn's own requests (a root); everything else folds
 * as a call that billed. Every summed and selected field is order-free — "the newest own request" is picked by
 * finish time, the sums by addition — so the facts come out the same whichever of a turn's requests finishes first,
 * folded one at a time as each does. `changes` keeps the finish order of the own requests and of the turn's own
 * loop rounds (`round`: a round's notes — a flex or fast downgrade, the model rewrite, the tier fields sent — were
 * lost behind the parent's, HarnessV3-FixRound F2 item 14), de-duplicated; the fold runs in finish order, so the
 * stored order is deterministic. A sub-agent's notes stay their own.
 *
 * A record that does not book on its session (memory's own call, Filament's answer) changes nothing.
 *
 * @param {any} prev  the facts so far, or null for the turn's first record
 * @param {any} rec   the finished record
 * @param {{ own?: boolean, round?: boolean }} [o]  `own`: this record is one of the turn's own requests; `round`: a
 *   round of the turn's own agent loop (its parent is the turn's root)
 * @returns {any} the new facts (a fresh object; `prev` is never mutated)
 */
export function foldTurnFacts(prev, rec, { own = false, round = false } = {}) {
  const base = prev || null;
  if (!booksOnSession(rec)) return base;
  const bill = !billedByChildren(rec);
  const start = recordStartMs(rec);
  const finish = recordFinishMs(rec);
  /** @type {any} */
  const f = base
    ? { ...base, tokens: { ...base.tokens } }
    : {
        v: 1,
        requests: 0,
        calls: 0,
        model: null,
        models: null,
        upstream: null,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        held: null,
        costUsd: null,
        listUsd: null,
        startedAt: null,
        endedAt: null,
        stopReason: null,
        context: null,
        memory: null,
        view: null,
        failovers: 0,
        errors: 0,
        error: null,
        errorDetail: null,
        limit: null,
        needsRoom: null,
        signIn: null,
        agentSession: null,
        changes: [],
        changesMore: 0,
      };
  f[OWN_AT] = base?.[OWN_AT] || 0;
  if (own) {
    f.requests = (base?.requests || 0) + 1;
    f.startedAt = base?.startedAt == null ? start : Math.min(base.startedAt, start);
    f.failovers = (base?.failovers || 0) + Math.max(0, (Number(rec.attempt) || 1) - 1);
    if (rec.status === "error") f.errors = (base?.errors || 0) + 1;
    if (!f[OWN_AT] || finish >= f[OWN_AT]) {
      f[OWN_AT] = finish;
      f.model = rec.upstreamModel || rec.model || null;
      f.upstream = rec.upstream || null;
      f.stopReason = rec.stopReason ?? null;
      // A turn whose newest request failed keeps the failure's words: a reload draws it failed, as it was live.
      f.error = rec.status === "error" && rec.error ? String(rec.error).slice(0, 500) : null;
      // And what was said under them — a coding agent's own error (HarnessV3-FailurePoints §5.2): the card's fold.
      f.errorDetail = rec.status === "error" && rec.errorDetail ? String(rec.errorDetail).slice(0, ERROR_DETAIL_CHARS) : null;
      // And what stopped it, where its agent's plan did: the limit card outlives the record ring.
      f.limit = rec.status === "error" ? planLimit(rec) : null;
      // Or where a coding agent refused it for its size (HarnessV4_Tasks C26): the banner offers the ways to make room.
      f.needsRoom = rec.status === "error" && rec.failure?.kind === "overflow" ? true : null;
      // Or where its agent's login refused it (HarnessV3-ACP AC3-7): the account the banner's Sign in signs in. Not
      // where someone is signed in and the account's plan or credit refused it (`signedIn`, the review of 11-19).
      f.signIn = rec.status === "error" && rec.failure?.kind === "auth" && !rec.failure.signedIn && rec.upstream ? { upstream: rec.upstream } : null;
      // Whether a coding agent's turn ran in a session of the agent's (HarnessV4_Tasks C26): false where it ended
      // before one was up — stopped as it opened, refused at its login — so the agent holds nothing of it; null for a
      // model Filament calls.
      f.agentSession = rec.acp ? !!rec.acp.sessionId : null;
      // The model its coding agent says answered, and where that is not the one asked for (core/answering-model.js
      // `answeredAs`) both names — with the words Filament said under the turn (`said`) on the turn that said them.
      if (rec.acp?.agentModel) f.agentModel = String(rec.acp.agentModel);
      else delete f.agentModel;
      const other = rec.acp?.otherModel;
      if (other?.chosen && other?.answered) f.otherModel = { chosen: String(other.chosen), answered: String(other.answered), ...(other.said ? { said: String(other.said) } : {}) };
      else delete f.otherModel;
      const t = rec.tokens || {};
      f.held = (Number(t.input) || 0) + (Number(t.cacheRead) || 0) + (Number(t.cacheWrite) || 0);
      // `held` there: an agent turn's newest round as the provider counted it (its record's columns are round one's),
      // or what a coding agent's context holds as it counted it — `estimated` where Filament's estimate stands in. `point`:
      // where a coding agent handed the line makes room by itself (HarnessV4_Tasks U3-2).
      const lastHeld = Number(rec.context?.last?.held) > 0 ? Number(rec.context.last.held) : null;
      const point = Number(rec.context?.point?.at) > 0 ? { at: Number(rec.context.point.at), line: Number(rec.context.point.line) || null } : null;
      // `own`: a coding agent's own share of its context, its prompt and tools, where the turn measured it (HarnessV4_Tasks C33).
      const ownShare = Number(rec.context?.own) > 0 ? Number(rec.context.own) : null;
      f.context = rec.context
        ? { window: rec.context.window ?? null, usable: rec.context.usable ?? null, verdict: rec.context.verdict ?? null, source: rec.context.source ?? null, ...(lastHeld ? { held: lastHeld, ...(rec.context.last.estimated ? { estimated: true } : {}) } : {}), ...(point ? { point } : {}), ...(ownShare ? { own: ownShare } : {}) }
        : null;
      const mem = rec.memory || null;
      const recalls = (base?.memory?.recalls || 0) + (Number(mem?.recalls) || 0);
      f.memory = mem
        ? {
            injected: Number(mem.injected) || 0,
            tokens: Number(mem.tokens) || 0,
            briefing: Number(mem.briefing) || 0,
            related: mem.cue && typeof mem.cue === "object" ? mem.cue : null,
            ...(recalls ? { recalls } : {}),
          }
        : recalls
          ? { injected: 0, tokens: 0, briefing: 0, related: null, recalls }
          : null;
      f.view = rec.view
        ? {
            form: rec.view.form ?? null,
            foldedTurns: Number(rec.view.foldedTurns) || 0,
            savedTokens: Math.max(0, (Number(rec.view.historyTokens) || 0) - (Number(rec.view.shapedTokens ?? rec.view.sentTokens) || 0)),
          }
        : null;
    }
  }
  if (own || round) {
    const changes = Array.isArray(rec.changes) ? rec.changes : [];
    const seen = new Set(f.changes);
    for (const c of changes) {
      const line = String(c || "");
      if (!line || seen.has(line)) continue;
      seen.add(line);
      if (f.changes.length < 30) f.changes.push(line);
      else f.changesMore = (f.changesMore || 0) + 1;
    }
  }
  // The turn's end is the newest finish of anything that booked on it — an agent parent closes after its last
  // round, and its finish is when the turn really ended.
  f.endedAt = base?.endedAt == null ? finish : Math.max(base.endedAt, finish);
  if (bill) {
    f.calls = (base?.calls || 0) + 1;
    const t = rec.tokens || {};
    f.tokens.input += Number(t.input) || 0;
    f.tokens.output += Number(t.output) || 0;
    f.tokens.cacheRead += Number(t.cacheRead) || 0;
    f.tokens.cacheWrite += Number(t.cacheWrite) || 0;
    // The prompt tokens of the calls whose usage said its cache numbers (cache-facts.js): what the turn's share read
    // from the cache is taken of. None kept while no call said any — a turn with none is a gap, never 0% — and facts
    // folded before the count are counted by their figures.
    const seen = seenWith(base?.tokens, t);
    if (seen > 0) f.tokens.cacheSeen = seen;
    // Of those writes, an hour's cache's, where the provider split them: what the turn's markers asked the provider
    // for, which says how long the cache it left lives.
    if (t.cacheWrite1h != null) f.tokens.cacheWrite1h = (Number(f.tokens.cacheWrite1h) || 0) + (Number(t.cacheWrite1h) || 0);
    // The models those tokens were counted on, where a coding agent said them: `model` is the one the turn asked
    // for, and the agent may have answered on others too — a helper or a sub-agent on its own model, or one it
    // retried on when the session's model declined (HarnessV4_Tasks C13: a turn on three models named one).
    const counted = Array.isArray(rec.acp?.modelUsage) ? rec.acp.modelUsage.filter((/** @type {any} */ m) => m?.model) : [];
    if (counted.length) f.models = countedModels(base?.models, counted);
    // costUsd stays null while nothing named a price — "unknown" is never written as 0. The running sum is
    // normalized on every add: float addition is not associative, and the same costs in a different fold order
    // would otherwise differ in the last bits.
    const c = rec.cost == null ? null : Number(rec.cost) || 0;
    if (c != null) f.costUsd = Math.round(((f.costUsd || 0) + c) * 1e12) / 1e12;
    // The same tokens at list price (Providers P4), by the same rule: on a plan the turn paid $0 and this is what
    // it was worth; null while no call named a list price.
    const l = rec.listCost == null ? null : Number(rec.listCost) || 0;
    if (l != null) f.listUsd = Math.round(((f.listUsd || 0) + l) * 1e12) / 1e12;
    const recalls = Number(rec.memory?.recalls) || 0;
    if (recalls && !own) {
      // A child's recalls join the turn's count even when the newest own request had none of its own.
      f.memory = f.memory ? { ...f.memory, recalls: (f.memory.recalls || 0) + recalls } : { injected: 0, tokens: 0, briefing: 0, related: null, recalls };
    }
  }
  return f;
}
