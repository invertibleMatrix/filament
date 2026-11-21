// @ts-check
// The failover order for this route (health-sorted, with the routing notes that explains it), the request record
// opened and stamped with what the headers say about the request's lineage, and the client's hang-up wired to an
// AbortController every later stage can pass along.
import { findUpstream, renderUpstreamModel } from "../../../core/routing.js";
import { capsAt } from "../../../core/model-caps.js";
import { carriesOwnTools } from "../../memory-tools.js";
import { upstreamModelOf } from "../../plan.js";
import { redactAndCap } from "../../../core/redact.js";
import { headersAreInternal } from "../../../services/records.js";
import { clientConversationId } from "../../../core/conversation.js";
import { isMachineUpstream, namesAgentUpstream, namesMachineUpstream } from "../../../core/schema.js";
import { offlineWords } from "../../../adapters/providers/filament.js";
import { forAnotherMachine, modelsLentTo } from "../../../services/devices.js";
import { ADDS_NOTHING_LINE, addsNothing } from "../../../core/conversation.js";

/** @type {import("../context.js").Stage} */
export async function route(ctx, { config, usage, health, liveAborts }) {
  const cfg = config();
  const { req, res, format, body, raw, pre, headers, requested, route } = ctx;
  const failover = cfg.rules.resilience?.failover === true;
  // A turn of a coding agent's own goes to the agent whose cycle it shows and to no other (dispatch's `ownCycle`): its
  // one candidate is that agent's place on the route, first or a backup, failover on or off — none where the route
  // names it no longer. It fails over to nothing, so nothing orders it.
  const ownCycle = pre?.api === "session" ? pre.ownCycle ?? null : null;
  // Another machine's chat's call (services/devices.js `modelsLentTo`) fails over to no coding agent, switched on or off:
  // one would work on this machine for it (the parse stage refuses a route that names one first); nor to a third
  // machine's models, lent to this one alone — nor a loop's call for another machine's agents' chat here
  // (`forAnotherMachine`).
  const lent = modelsLentTo(req);
  const theirs = forAnotherMachine(req, headers);
  const named = [{ upstream: route.upstream, upstreamModel: route.upstreamModel }, ...(route.fallbacks || [])].filter((c) => !(lent && namesAgentUpstream(cfg, c.upstream)) && !(theirs && namesMachineUpstream(cfg, c.upstream)));
  // A coding agent Filament launched (core/conversation.js `addsNothing`) goes to no coding agent, first or a backup: its
  // providers alone, failing over among them (the review of c04dd3507: a 403 mid-failover lost a provider's own error).
  // With none, dispatch refuses it in words.
  const marked = addsNothing(headers);
  const providers = marked ? named.filter((c) => !namesAgentUpstream(cfg, c.upstream)) : named;
  const onRoute = providers.length ? providers : named;
  const rawCandidates = ownCycle ? onRoute.filter((c) => c.upstream === ownCycle.upstream).slice(0, 1) : failover ? onRoute : onRoute.slice(0, 1);
  const { ordered, parked: cooled } = failover && !ownCycle
    ? health.order(rawCandidates, {
        strategy: route.strategy || "in_order",
        routeKey: route.match,
        cfg,
        modelFor: (c) =>
          renderUpstreamModel(c.upstreamModel ?? route.upstreamModel, requested.base, route.captures || []),
      })
    : { ordered: rawCandidates, parked: [] };
  // Another machine found offline (adapters/providers/filament.js `offlineWords`) waits behind the rest for as long as
  // the picker says so — its OFFLINE_KEPT_MS, never health's first ten seconds of cooldown — and is still tried last, as
  // one cooling down is: a route whose backup answers pays no connect wait on a sleeping machine meanwhile.
  const asleep = (/** @type {{ upstream: string }} */ c) => {
    const u = findUpstream(cfg, c.upstream);
    return !!u && isMachineUpstream(u) && !!offlineWords(u.id);
  };
  const late = ordered.length > 1 ? ordered.filter(asleep) : [];
  const candidates = late.length ? [...ordered.filter((c) => !late.includes(c)), ...late] : ordered;
  const parked = late.length ? [...new Set([...cooled, ...late.map((c) => c.upstream)])] : cooled;
  const routingNotes = [...(pre?.notes || []), ...(ctx.notes || [])];
  const { dropped, agent, unread } = ctx.setAside;
  if (dropped.length || agent)
    routingNotes.push(
      `routing: Filament's own headers and user agents count only on Filament's own calls, and this request is a client's — ${[
        dropped.length ? `dropped ${dropped.join(", ")}` : "",
        agent ? `the user agent ${agent} is kept only as "unverified ${agent}"` : "",
      ]
        .filter(Boolean)
        .join("; ")}`,
    );
  // A coding agent Filament launched, its calls back through this door (core/conversation.js `addsNothing`): said on its record.
  if (marked) routingNotes.push(`context: the client asked Filament to add nothing (${ADDS_NOTHING_LINE}) — a coding agent Filament launched, whose turn has Filament's memory, context and tools already; routed and recorded alone`);
  if (marked && providers.length && providers.length < named.length)
    routingNotes.push(`routing: a coding agent's call goes to no coding agent: ${named.filter((c) => !providers.includes(c)).map((c) => c.upstream).join(", ")} left off its route`);
  if (unread.length)
    routingNotes.push(`memory: ${unread.join(", ")} set aside — a session is loaded by its id only for a caller that could read every session anyway: one on this machine that names it as its own, or one with the admin token`);
  if (!failover && !ownCycle && (route.fallbacks || []).length)
    routingNotes.push(`routing: failover is off; ${route.fallbacks.length} backup(s) ignored`);
  // A client's own tools to a model that takes none (HarnessV4_Tasks E4) go as the client sent them — nothing rewrites
  // a client's request — and the record says the model is marked, so a refusal that follows is explained.
  const first = candidates[0];
  if (first && carriesOwnTools(body, pre?.responsesBody)) {
    const sent = upstreamModelOf(cfg, first, route, requested) || requested.base;
    const said = capsAt(cfg, findUpstream(cfg, first.upstream), sent).tools;
    if (!said.available)
      routingNotes.push(
        `tools: ${sent} at ${first.upstream} takes no tools (${said.source === "operator" ? "its row on the Upstreams page says so" : "its provider's model list says so"}); the client's own tools are sent as it sent them`,
      );
  }
  if (
    route.strategy &&
    route.strategy !== "in_order" &&
    candidates.length > 1 &&
    !parked.includes(candidates[0].upstream)
  )
    routingNotes.push(`routing: ${route.strategy} picked ${candidates[0].upstream} first`);
  if (parked.length)
    routingNotes.push(
      parked.length === rawCandidates.length
        ? `routing: every upstream on this route is cooling down, out of quota or offline; trying ${candidates[0].upstream} anyway`
        : `routing: ${parked.join(", ")} moved last (cooling down, out of quota or offline)`,
    );

  // Which request this one belongs to: a replay of an earlier request (linked, grouped, auditable), an agent-loop
  // tick, a sub-agent (the request that launched it, or `owner`, and its id) — lineage only a house call carries (the
  // parse stage set a client's aside); and the folder the work belongs to — what memory resolves the project from.
  // Named in the start itself: the start event is what the dashboard and Traffic hold until the record's next one,
  // and a loop's parent record sends none until it ends — lineage set after it read one turn with a sub-agent as
  // three calls in flight, each a client's.
  /** @param {string} name @param {number} max */
  const header = (name, max) => (headers[name] ? String(headers[name]).slice(0, max) : undefined);
  /** @type {Record<string, string>} */
  const lineage = {};
  for (const [key, name, max] of /** @type {[string, string, number][]} */ ([
    ["replayOf", "x-filament-replay-of", 64],
    ["agentOf", "x-filament-agent-of", 64],
    ["subagentOf", "x-filament-subagent-of", 64],
    ["subagent", "x-filament-subagent", 32],
    // what a fork of a session's own request is for (`compaction`): Traffic names its source from the start
    ["forkFor", "x-filament-fork", 32],
    // the job the call is part of (a compaction): the job counts its calls from their start, so what
    // they cost is summed over all of them (HarnessV4_Tasks U3-11)
    ["jobId", "x-filament-job", 64],
    ["cwd", "x-filament-cwd", 400],
  ])) {
    const v = header(name, max);
    if (v) lineage[key] = v;
  }
  const rec = usage.start({
    format,
    api: pre?.api || undefined,
    model: body.model,
    route: route.match,
    upstream: null,
    upstreamModel: null,
    stream: body.stream === true,
    // Another machine's chat's call is said by the device it came from, which Usage reads by its id, and from where a
    // proxy here took it (guards.js `callerAddress`, as the device's last seen says it): at the tailnet's door, the
    // socket is this machine's own.
    clientIp: lent?.lastSeenFrom || req.socket.remoteAddress,
    ua: headers["user-agent"] || "",
    ...(lent ? { device: { id: lent.id, name: lent.name } } : {}),
    ...lineage,
  });
  // Filament's own calls (memory learning, recall rewriting, compaction summaries and their slices, the engine, the
  // dashboard assistant, health pings) carry PROMPTS that are your conversation text. Now that Traffic lists them
  // beside your clients' requests they stay metadata-only unless you ask for their bodies — which is what the
  // memory guide's "Filament's own traffic is never captured" promise already claimed. The record says why a body
  // is absent rather than leaving the drawer silently empty.
  const internalCall = headersAreInternal(headers);
  // Another machine's chat's prompt and answer are its own: Traffic keeps what it spent, never what it said.
  const bodiesAllowed = !lent && (!internalCall || cfg.observability.storeInternalBodies === true);
  if (lent)
    rec.bodyWithheld = `another machine's chat (${lent.name}): its prompt and its answer are kept on that machine, never here`;
  else if (internalCall && !bodiesAllowed)
    rec.bodyWithheld =
      "Filament's own call: its prompt is not stored unless observability.storeInternalBodies is on";
  if (bodiesAllowed && cfg.observability.storeBodies === "full")
    rec.inboundBody = redactAndCap(raw, cfg.observability.maxStoredBodyBytes);
  const clientAbort = new AbortController();
  liveAborts.set(rec.id, clientAbort);
  // Two hooks, because only one of them actually fires: on modern Node an IncomingMessage emits "close" when the
  // request COMPLETES (which has already happened by the time the body is read), so `req.on("close")` registered
  // here never sees a hang-up. ServerResponse "close" does fire on premature termination. Without it, a client
  // that hangs up mid-turn leaves the agent loop working and billing with nobody listening.
  // A native session's turn belongs to the server, not to the connection that started it (HarnessV2 D1): the
  // harness reloading or a tab closing leaves the turn running and archiving; it re-attaches through the run's
  // events and the transcript. Only a stop ends such a turn: the session's own (its `signal`), the cancel row
  // (`/requests/:id/cancel`), or a `stop` steer.
  if (ctx.pre?.api !== "session") {
    req.on("close", () => {
      if (!res.writableEnded) clientAbort.abort();
    });
    res.on("close", () => {
      if (!res.writableEnded) clientAbort.abort();
    });
  } else if (ctx.pre.signal) {
    const stop = ctx.pre.signal;
    if (stop.aborted) clientAbort.abort();
    else stop.addEventListener("abort", () => clientAbort.abort(), { once: true });
  }

  rec.clientSession = clientConversationId(headers) || undefined;
  ctx.memory.traceOn(rec);
  // Memory's own model calls (learning, the engine's consolidation) are tagged, so the dashboard shows their cost apart.
  if (headers["x-filament-memory-purpose"] || /^filament-memory\//.test(headers["user-agent"] || ""))
    rec.memoryFor = {
      purpose: headers["x-filament-memory-purpose"] || "memory",
      ...(headers["x-filament-memory-for"] ? { chain: headers["x-filament-memory-for"] } : {}),
      ...(headers["x-filament-parent-request"] ? { parent: headers["x-filament-parent-request"] } : {}),
    };
  // Which client request caused this one. Without it a summary and its slice calls, or a learning pass and the
  // turn that triggered it, can only be matched by hand against timestamps — which is exactly what made the W8
  // compaction incident need two endpoints and a lucky catch (the job objects were still in RAM) to reconstruct.
  if (headers["x-filament-parent-request"])
    rec.parentRequest = String(headers["x-filament-parent-request"]).slice(0, 64);
  if (routingNotes.length) rec.priorChanges = [...routingNotes];

  ctx.rec = rec;
  ctx.failover = failover;
  ctx.candidates = candidates;
  ctx.client = { abort: clientAbort };
  // `housekeeping` is situate's one detection (Step 3 D12), the answer memoryPrepare reads.
  ctx.flags = {
    internalCall,
    bodiesAllowed,
    memAgent: false,
    askedToCompact: false,
    housekeeping: !!ctx.memory?.housekeeping,
  };
  return "continue";
}
