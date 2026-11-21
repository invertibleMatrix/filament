// @ts-check
// The failover loop: each candidate in order gets one try — an ACP agent runs its own turn, a provider is asked and
// its reply judged — and the first accepted reply is delivered. The same candidate is asked again after a compaction,
// the next one after a failure; when none answered, the last error goes to the client — naming the provider it met,
// as a delivered reply does, so Filament's own loops can tell a provider's failure from Filament's own refusal and try
// it again (HarnessV3-AtHome AH-F4); `x-should-retry: false` when its adapter judged another try pointless.
import { findUpstream } from "../../../core/routing.js";
import { namesAgentUpstream, namesMachineUpstream } from "../../../core/schema.js";
import { forAnotherMachine, modelsLentTo } from "../../../services/devices.js";
import { addsNothing } from "../../../core/conversation.js";
import { errorBody } from "../../../core/wire/errors.js";
import { sendJson } from "../respond.js";
import { createFailoverTrail, createAttempt, failureHead, unreachable } from "../dispatch/attempt.js";
import { judgeReply } from "../dispatch/verdict.js";
import { pdfsAsSent } from "../dispatch/pdfs.js";
import { deliverReply } from "../dispatch/reply.js";
import { stampComposed } from "./composed.js";
import { chatLeftOutOf, turnMemState } from "./situate.js";

/** @typedef {import("../../acp-turn.js").AcpTurnArgs} AcpTurnArgs */

/** What a request's record names of whose it is, as the route stage starts it: its attempts' records name the same. */
const LINEAGE = Object.freeze(["api", "replayOf", "agentOf", "subagentOf", "subagent", "forkFor", "jobId", "cwd"]);

/**
 * A coding agent's attempt that failed before its first word, after model calls of its own (`spent`, as acp-turn.js
 * hands it back): a record of its own, a child of the request's, so what it spent counts — on the session's spend, the
 * turn's facts and the chat's counts — priced and named as its own agent's while the next candidate serves. It is the
 * request's in every reader's eyes, its lineage the request's (`LINEAGE`): a sub-agent's attempt is a sub-agent's call,
 * a compaction fork's its job's, memory's own memory's. Its failure was judged where it failed: its close judges no
 * health.
 * @param {import("../context.js").RequestContext} ctx @param {import("../../deps.js").AppDeps} deps @param {any} spent
 */
function keepAttempt(ctx, { usage, finish }, spent) {
  const { req, format, body, route, headers, rec } = ctx;
  const { upstream, upstreamModel, error, tokens, acp, call, changes, ...costs } = spent;
  /** @type {Record<string, any>} */
  const lineage = {};
  for (const key of LINEAGE) if (rec[key] != null) lineage[key] = rec[key];
  const kept = usage.start({ format, model: body.model, route: route.match, upstream, upstreamModel, stream: body.stream === true, clientIp: req.socket.remoteAddress, ua: headers["user-agent"] || "", ...lineage });
  if (rec.memoryFor) kept.memoryFor = rec.memoryFor;
  kept.parentRequest = rec.id;
  kept.attempt = rec.attempt;
  kept.healthRecordedFor = upstream;
  // Its newest model call, the session's last request as a turn's is (finish.js), and what the attempt said of its cost.
  if (call) kept._lastModelCall = call;
  if (Array.isArray(changes) && changes.length) (kept.changes ||= []).push(...changes);
  if (rec.clientSession) kept.clientSession = rec.clientSession;
  if (rec.memory?.chain) kept.memory = { chain: rec.memory.chain };
  finish(kept, { status: "error", httpStatus: 502, error, tokens: { ...kept.tokens, ...tokens }, estimatedTokens: false, ...costs, acp });
}

/**
 * @param {{ turn: (args: AcpTurnArgs) => Promise<{ failedEarly: true, error: string, reason?: string, detail?: string | null, spent?: any } | void> }} agentTurn
 * @returns {import("../context.js").Stage}
 */
export const dispatch = (agentTurn) => async (ctx, deps) => {
  const { config, log, destination, finish, wireApiFor } = deps;
  const cfg = config();
  const { res, format, body, raw, headers, requested, route, rec, candidates, t0 } = ctx;
  const trail = createFailoverTrail(rec);
  // A turn of a coding agent's own goes to the agent whose cycle it shows, and to no other (HarnessV3-ACP AC3-9).
  const ownCycle = ctx.pre?.api === "session" ? ctx.pre.ownCycle ?? null : null;
  // The harness turn's lock: an agent's steps before its session is up are said on it (HarnessV3-FailurePoints §5.1
  // item 2).
  const lock = ctx.pre?.lock || null;
  /** @type {AcpTurnArgs["phase"]} */
  const phase = lock ? (p) => void lock.turns.setPhase(lock.key, lock.token, p) : null;
  /** @type {AcpTurnArgs["named"]} */
  const named = lock ? (requestId) => void lock.turns.renew(lock.key, lock.token, { requestId }) : null;
  // A session turn's seed made to fit (HarnessV3-FailurePoints D9): its record shows the composition the agent's new
  // session is seeded from, and says why. A turn that asks before room is made hands its word on as it is.
  const asked = ctx.pre?.reseed || null;
  /**
   * A body as a coding agent takes it: a PDF as its text (pdfs.js), said on the record where the turn's own words
   * are kept. @param {any} sent @param {string} agentId
   */
  const forAgent = async (sent, agentId) => {
    if (format !== "anthropic") return sent;
    const asSent = await pdfsAsSent(sent, { native: false, why: `${agentId} is a coding agent` });
    for (const note of asSent.notes) if (!rec.priorChanges?.includes(note)) (rec.priorChanges ||= []).push(note);
    return asSent.body;
  };
  /** @param {string} agentId @returns {AcpTurnArgs["reseed"]} */
  const reseedAt = (agentId) =>
    typeof asked === "function"
      ? async (said) => {
          const r = await asked(said);
          if (!("body" in r)) return r;
          if (r.composition) stampComposed(rec, r.composition, r.body, format);
          return { ...r, body: await forAgent(r.body, agentId) };
        }
      : asked;
  for (let i = 0; i < candidates.length; i++) {
    if (ownCycle && candidates[i].upstream !== ownCycle.upstream) continue;
    // An ACP agent can be the primary or a fallback; if it fails before producing output, the next candidate runs.
    const candUp = findUpstream(cfg, candidates[i].upstream);
    // Never for another machine's chat (services/devices.js `modelsLentTo`): checked here, where an agent is reached —
    // one the parse and route stages took for off may be on now —, and a third machine's models, which that machine
    // lends to this one alone — one the configuration names since those stages read it; nor that for a loop's call for
    // another machine's agents' chat here (`forAnotherMachine`).
    const lent = modelsLentTo(ctx.req);
    const third = forAnotherMachine(ctx.req, headers) && namesMachineUpstream(cfg, candidates[i].upstream);
    if (third || (lent && (namesAgentUpstream(cfg, candidates[i].upstream) || destination(candUp)?.agent))) {
      const said = namesMachineUpstream(cfg, candidates[i].upstream)
        ? `another machine's chats use this machine's own models; ${candidates[i].upstream} is another machine's, which it lends to this machine alone`
        : `another machine's chats use this machine's API models; ${candidates[i].upstream} is a coding agent, which works on this machine alone`;
      sendJson(res, 403, errorBody(format, 403, said), { "x-filament-request-id": rec.id });
      finish(rec, { status: "error", httpStatus: 403, error: said });
      return "replied";
    }
    // A coding agent Filament launched (core/conversation.js `addsNothing`) calling a model whose route goes to a coding agent: an
    // agent would start inside the first one's model call, and nothing bounds that chain. Refused in words.
    if (addsNothing(headers) && destination(candUp)?.agent) {
      const said = `${candidates[i].upstream} is a coding agent, and this call is a coding agent's that Filament launched: one does not run inside another's model call — name a model a provider answers`;
      sendJson(res, 403, errorBody(format, 403, said), { "x-filament-request-id": rec.id });
      finish(rec, { status: "error", httpStatus: 403, error: said });
      return "replied";
    }
    if (destination(candUp)?.agent) {
      rec.attempt = i + 1;
      trail.servedBy(candUp.id, i); // an agent taking over after a failed provider is a failover too
      const r = await agentTurn.turn({
        res,
        format,
        body: await forAgent(body, candUp.id),
        raw,
        inboundHeaders: headers,
        requested,
        route,
        candidate: candidates[i],
        upstream: candUp,
        rec,
        clientAbort: ctx.client.abort,
        isLast: !!ownCycle || i === candidates.length - 1,
        // Memory left the request out or did not prepare it: its rules and knobs all the same, and the session its own
        // tools ride.
        mem: turnMemState(ctx.memory),
        // Whether memory leaves the request's chat out — a Memory setting's words, or Filament's own call — where memory's
        // own tools stay off; a turn whose situate failed is its chat's, which keeps them.
        leftOut: chatLeftOutOf(ctx.memory),
        // Its caller reaches its own project's sessions alone: so do memory's tools, memory situating the request or not.
        confined: !!ctx.memory.confined,
        // Only a harness session's own turn, asked for by its page (R3): a front-door reply stays byte for byte.
        runEvents: ctx.pre?.api === "session" && ctx.pre?.runEvents === true,
        unattended: ctx.pre?.api === "session" && ctx.pre?.unattended === true,
        // What the agent the session moved to is handed with its first prompt (sessions/reattach.js `handoverFor`).
        handover: ctx.pre?.api === "session" ? ctx.pre.handover ?? null : null,
        session: ctx.pre?.api === "session",
        ownCycle,
        lead: ctx.lead || null,
        phase,
        named,
        reseed: reseedAt(candUp.id),
      });
      if (r?.failedEarly) {
        trail.lastError = { status: 502, message: r.error };
        // An agent's failure is the trail's as a provider's is: its headline, and under it what the agent wrote as
        // it ended (HarnessV4_Tasks B10).
        trail.note(candUp.id, null, r.reason || r.error, r.detail);
        if (r.spent) keepAttempt(ctx, deps, r.spent);
        rec.attempt = i + 1;
        continue;
      }
      return "replied";
    }
    const attempt = createAttempt(ctx, deps, { candidate: candidates[i], index: i });
    const first = await attempt(wireApiFor(candUp));
    const loop = {
      candUp,
      index: i,
      attempt,
      unreachable: (e, up) => unreachable(ctx, deps, trail, e, up),
      trail,
    };
    const verdict = await judgeReply(ctx, deps, loop, first);
    if (verdict === "next") continue;
    if (verdict === "done") return "replied";
    await deliverReply(ctx, deps, { ...verdict, attempt });
    return "replied";
  }
  const status = trail.lastError?.status || 502;
  const met = failureHead(trail.lastError);
  const said = trail.lastError?.message || (ownCycle ? `${ownCycle.upstream} is on this session's route no longer: the turn its agent began by itself has no way to it` : "no usable upstream");
  // Nobody on a route with backups answered: the record keeps what each said as it failed, as one a backup served
  // does (HarnessV4_Tasks B10).
  if (candidates.length > 1 && trail.failed.length) rec.failover = { trail: trail.failed.slice(), servedBy: null };
  sendJson(res, status, errorBody(format, status, said), { "x-filament-request-id": rec.id, ...met });
  finish(rec, { status: "error", httpStatus: status, error: said });
  log("debug", `${rec.id} failed in ${Math.round(performance.now() - t0)}ms`);
  return "replied";
};
