// @ts-check
// Long-term memory on autopilot: the turn is archived, the session briefing and related memory are placed so
// provider caches survive, corrections and decisions are captured, and the model is offered the memory tools.
// A coding agent's turn gets the same placements (HarnessV3-ACP AC4-2), which the agent path lifts out and hands over
// through the agent's own channels; it keeps its own tools and reaches memory's through Filament's. What answers an
// agent's tool call (a client's tool leg) and a turn the agent began by itself are archived only, and so is a session
// turn of a chat Memory settings leave out (`kept`): its turn is the chat's own record, and nothing of memory's rides it
// but filament_recall, which reads that record alone — on its machinery's calls too.
// A housekeeping request from the client (title, summary, probe) gets nothing. A request memory could not read — its
// situate or prepare failed — carries memory's tools all the same where its chat's requests carry them (t420), and a call
// of theirs is answered that memory is unavailable.
import { findUpstream } from "../../../core/routing.js";
import { capsAt } from "../../../core/model-caps.js";
import { attachMemoryTools, attachRecallTool, carriesOwnTools, toolsAsSent, toolsRefusalKey } from "../../memory-tools.js";
import { upstreamModelOf } from "../../plan.js";
import { isMachineryRequest } from "../../../services/house.js";
import { NO_PROJECT_ID } from "../../../core/project-id.js";
import { lineageParentOf } from "../../../core/turn-facts.js";
import { turnEngine } from "../../engine.js";
import { carryAdded } from "../../../core/wire/responses.js";
import { detectHousekeeping } from "../../housekeeping.js";

/**
 * The project a request's spend books on in Usage's By project (HarnessV3-Launch LD-D8): the folder memory placed it
 * in, else the one its turn works in — a call that names no folder of its own is its turn's work. A request in no
 * folder, for no turn in one, is no project's.
 * @param {any} prep @param {any} rec @param {any} usage
 * @returns {string | undefined}
 */
function bookedProject(prep, rec, usage) {
  if (prep.project && prep.project !== NO_PROJECT_ID) return prep.project;
  const parent = lineageParentOf(rec);
  return (parent && usage?.byId?.get(parent)?.memory?.project) || undefined;
}

/** @type {import("../context.js").Stage} */
export async function memoryPrepare(ctx, { config, memory, destination, usage, toolsRefused, teams = null }) {
  const { format, body, pre, rec, candidates, route, requested } = ctx;
  const { sit, kept, trace } = ctx.memory;
  // Who answers: the route's first, or the coding agent a turn of its own goes to (dispatch's `ownCycle`), whatever
  // the route names first now. One switched off is passed over, as dispatch passes it: a route whose own upstream is
  // off is how a chat's turns go to its model without the loop, the loop being always on (the owner's of 11-09).
  const first = candidates.find((c) => findUpstream(config(), c.upstream)) || candidates[0];
  const answers = (pre?.api === "session" && pre.ownCycle?.upstream) || first?.upstream;
  const memAgent = !!destination(findUpstream(config(), answers))?.agent;
  ctx.flags.memAgent = memAgent;
  let prep = null;
  // What memory prepares: the request memory situated, or the session turn of a chat Memory settings leave out
  // (`kept`), whose turn alone it keeps — its prepare places nothing and offers no tool (brain.js `prepare`).
  const at = sit || kept;
  // A request that carries no tools of its own gets memory's only while its model takes them (HarnessV3-AtHome
  // AH-D1): one that refused them is remembered (dispatch/verdict.js), and memory's settings read the refusal. A
  // model whose row or listing says it takes none (HarnessV4_Tasks E4) is offered none before it can refuse, the
  // client's own tools or not: those go as the client sent them, and memory adds none beside them. So with
  // filament_recall, on a request memory situated or one of a chat it keeps apart (`at`).
  const ownTools = carriesOwnTools(body, pre?.responsesBody);
  /** The model that answers, where it takes no tools or refused them: who and why; else null. */
  const refusedHere = () => {
    if (!first || first.upstream !== answers) return null;
    const model = upstreamModelOf(config(), first, route, requested) || requested.base;
    const said = capsAt(config(), findUpstream(config(), first.upstream), model).tools;
    const refused = ownTools ? null : toolsRefused.get(toolsRefusalKey(first.upstream, model));
    if (!said.available) return { upstream: first.upstream, model, said: said.source };
    return refused ? { upstream: first.upstream, model, ...refused } : null;
  };
  /**
   * Memory's tools put on the request, said on its record in `line`'s words: the client's own tools as it sent them
   * kept for the retry a model that refuses tools gets (dispatch/verdict.js). @param {(n: number) => string} line
   */
  const offerTools = (line) => {
    const asSent = ownTools ? null : toolsAsSent(body, pre?.responsesBody || null);
    const n = attachMemoryTools(format, body, pre?.responsesBody || null);
    if (!n) return;
    (rec.priorChanges ||= []).push(line(n));
    trace?.step("tools added to the request", { tools: n, format });
    ctx.memory.toolsAdded = asSent;
    ctx.memory.toolsAddedAre = "memory";
  };
  // A request memory could not read — its situate failed, or its prepare — carries memory's tools where its chat's
  // requests carry them (t420): with none, the tools section under the conversation would shrink for it and grow back
  // with the next, and the provider write the whole conversation to its cache twice for one miss. Where they ride is
  // read as a working request reads it, from what is known without memory's reading: memory, its autopilot and its tools
  // on for the chat's settings (`toolsRide`; a chat not known, only where no chat or project chose memory's tools), no
  // Memory setting leaving the request out (one whose leaving-out could not be read is left out), a model that takes
  // tools and has not refused them, no coding agent answering (its session has memory's tools its own way), and no
  // housekeeping. They go on where a working request's go, before filament_recall. A call of theirs is answered that
  // memory is unavailable (memory-loop.js), never run; the record keeps why.
  /** Why memory missed the request, where it did. */
  const missedWhy = () => prep?.missed || (ctx.memory.failed ? ctx.memory.failedWhy || "memory could not read the request" : null);
  const settingsKnown = sit?.settings ?? kept?.settings ?? ctx.memory.settingsOnly?.settings;
  const ridesMissed = () =>
    !!missedWhy() && !prep?.tools && !prep?.leftOut && !memAgent && !ctx.flags.housekeeping && !refusedHere() && !detectHousekeeping(format, body) &&
    !ctx.memory.excludedOrUnread?.() && memory.toolsRide(settingsKnown ?? null, { known: !!(sit || kept || ctx.memory.settingsOnly) });
  const offerMissed = () => {
    const why = missedWhy();
    if (!prep) (rec.priorChanges ||= []).push(`memory: skipped (${why}) — the request goes on without memory`);
    offerTools((n) => `memory: memory's tools stay offered (${n}), as every request of the chat carries them, so the tools the provider caches do not change; a call of theirs is answered that memory is unavailable`);
    ctx.memory.down = why;
    if (rec.memory) rec.memory.tools = true;
  };
  // The recall tool (HarnessV2 §6.4) rides on every request Filament makes for its own chats — a session's turn, each
  // tick of its loop, its forks, its sub-agents and their ticks — muted or not: a fold, a result policy or cap, a
  // summary each leave turns only it brings back whole, and a tool that came and went with them would change the
  // tools section under the conversation the provider caches. Own is the sessions API's door, or Filament's
  // machinery (lineage a client cannot forge: house-only headers). An outside client's request gets none: it is
  // proxied, memory apart. A model that takes no tools, or refused them, gets none either, as memory's. A chat Memory
  // settings leave out has it too (`prep.leftOut`): it reads only the chat's own record, which the chat keeps. On a
  // request that carried no tools of its own, where memory's did not ride, a model that refuses it for the tool gets
  // the request again without it (dispatch/verdict.js), as one that refuses memory's does.
  const recall = pre?.api === "session" || isMachineryRequest(ctx.headers);
  /** filament_recall put on the request, said on its record. */
  const offerRecall = () => {
    const asSent = ownTools || ctx.memory.toolsAdded ? null : toolsAsSent(body, pre?.responsesBody || null);
    const n = attachRecallTool(format, body, pre?.responsesBody || null);
    ctx.flags.recallTool = true;
    if (!n) return;
    (rec.priorChanges ||= []).push("context: filament_recall offered to the model — pointers and folded turns in the history resolve through it (Filament answers from the archive)");
    trace?.step("recall tool added to the request", { format });
    if (asSent) {
      ctx.memory.toolsAdded = asSent;
      ctx.memory.toolsAddedAre = "recall";
    }
  };
  /**
   * A request memory could not read, of a chat Filament runs, has filament_recall all the same where memory named no
   * chain for it — its prepare failing before its turn opened, or its situate leaving no situation — on the chat it
   * names (`session`), so the tools section stays as every request of the chat carries it. Its calls stand in that chat
   * (`standIn`, memory-loop.js): they read its record, and what a reply cannot carry waits where a working request's
   * would — a loop's tick under its own run, since several loops may run on one session at once (brain.js `deferTo`).
   * @param {string} chain
   */
  const recallStandIn = (chain) => {
    offerRecall();
    const of = String(ctx.headers?.["x-filament-agent-of"] || "");
    ctx.memory.standIn = { chain, deferTo: of ? `${chain}/${of}` : chain };
  };
  // Housekeeping was detected once in situate (Step 3 D12); this stage reads its flag.
  if (at && !ctx.flags.housekeeping) {
    const refused = refusedHere();
    if (refused) at.toolsRefused = refused;
    const lock = pre?.lock || null;
    prep = await memory.prepare(at, {
      requestId: rec.id,
      upstream: answers || "",
      captureOnly: memAgent && (at.position === "toolLeg" || !!at.ownCycle),
      // Who answers the turn, stamped on it when it opens (HarnessV3-AtHome AH-O7): the engine stage has resolved it.
      engine: turnEngine(ctx.agent, teams, ctx.lead || null),
      // What memory makes a harness turn wait on is said on its lock, and the person may send it without
      // (HarnessV3-FailurePoints §5.1 item 3).
      waiting: lock ? lock.turns.waiting(lock.key, lock.token) : null,
    });
    // A passthrough to a Responses upstream sends the input items, never the chat body memory wrote into: what it added
    // to a person's or a tool's message rides the item that message came from (the bug report's H13).
    if (prep && pre?.responsesBody && pre.responsesSources) carryAdded(pre.responsesBody, pre.responsesSources);
    if (prep) {
      for (const n of prep.notes || []) (rec.priorChanges ||= []).push(n);
      rec.memory = {
        chain: prep.chain,
        project: bookedProject(prep, rec, usage),
        // How many of Filament's own texts (command answers, cues) situate left out of this request's history (D11);
        // not a change line, because the same exchanges drop out on every request.
        localDropped: ctx.memory.localDropped || undefined,
        // The chain's turn number (1-based): what `/api/memory/sessions/:id/changes?turn=` and a fork's `atTurn` take,
        // and what a person means by "turn 3". The archive row behind it is `turnId`.
        turn: prep.turnN || undefined,
        turnId: prep.turn || undefined,
        position: prep.position,
        client: prep.client || at.client,
        signals: prep.signals ? Object.keys(prep.signals) : undefined,
        briefing: prep.briefing || 0,
        injected: prep.injected || 0,
        tokens: prep.tokens || 0,
        ids: prep.ids || [],
        tools: !!prep.tools,
        loaded: prep.loaded || undefined,
        muted: prep.muted || undefined,
        quiet: prep.quiet || undefined,
        // Why Memory settings leave the request out, in their words: its cost is the chat's spend, as any call's is, and
        // none of the chat's goal, which rides on memory's work (finish.js).
        leftOut: prep.leftOut || undefined,
        // The standing blocks' weight (briefing, goal) in estimated tokens; the view stage adds the
        // rest of the request's anatomy (`rec.view.composition`), so a record says what its context was made of.
        composition: prep.composition || undefined,
      };
      // A harness session's turn: the number the session gave it rides its head, as the page that sent it numbered it
      // itself, and another tab's turn may have taken that number first.
      if (pre?.api === "session" && prep.turnN && !ctx.res.headersSent) ctx.res.setHeader("x-filament-turn", String(prep.turnN));
      if (prep.tools && !memAgent) offerTools((n) => `memory: ${n} filament_memory_* tools offered to the model (Filament runs the calls)`);
      else if (ridesMissed()) offerMissed();
      // filament_recall after them (`recall`); on a missed request whose prepare named no chain, on the chat it names.
      if (recall && !memAgent && !at.toolsRefused) {
        if (prep.chain) offerRecall();
        else if (missedWhy() && ctx.memory.session?.chain) recallStandIn(ctx.memory.session.chain);
      }
    }
  } else if (sit)
    trace?.step("memory stays out", {
      why: "a housekeeping request from the client (title, summary, probe)",
    });
  // A request memory could not situate at all (no `at`): its tools as its chat's requests carry them (`ridesMissed`),
  // and filament_recall after them on the chat it names, where it is a chat Filament runs (`recallStandIn`).
  if (!at && !ctx.flags.housekeeping && missedWhy()) {
    if (ridesMissed()) offerMissed();
    if (recall && !memAgent && ctx.memory.session?.chain && !refusedHere() && !detectHousekeeping(format, body)) recallStandIn(ctx.memory.session.chain);
  }
  ctx.memory.prep = prep;
  return "continue";
}
