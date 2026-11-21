// @ts-check
// The compactor (HarnessV3 Compaction methods — the plan is the vault's HarnessV3-Compaction.md, §5): how a session's
// window makes room, through one door for every caller — the harness's turn start at the compaction line, Compact now,
// and the preview's figures. The composer only says a request is over the line (`overLine`); the compactor decides how
// to make room by the session's method, weighs every way first — locally, the composer is pure — and writes what it
// did: a summary row the next composition starts from (summary), or compaction marks on the turns it reshaped (fold).
// Nothing is deleted anywhere: the archive keeps every turn, and a mark only changes how a turn renders.
//
// Three kinds (the owner's rules of 10-31), each making the history smaller:
//   same model  the session's own model writes one summary of every finished turn since the last — forking its warm
//               prompt cache when it can, so the conversation is read at the cache's price (method summary, writer
//               session);
//   side model  a side model writes it (`context.compaction.model`, else memory's model where one is set; writer model);
//   fold        every finished turn but the newest `keepWhole` folds to its report — local, no model call; offered
//               where the earlier turns it leaves weigh `context.compaction.instantTokens` or less.
// A writer that does not fork reads the turns whole where they fit one call of its window; else their tool calls fold
// first (`readingOf`): a side model's folded turns at the instant line or under are that fold, with no call; above it,
// the folded copy is summarized in one call where it fits, and in the slice pass's sequential slices where nothing else does.
// What a writer reads is Filament's copy of the chat: the summary before, whole, and the turns since — a coding
// agent's as their folds (its copy holds each turn's words and not its tool output), the loop's with their calls and
// results.
// A coding agent's copy also moves on by itself (`copy`): where the agent compacted its own context and handed no
// summary over, or the copy passed the session's line, a summary is written for the copy alone — no session moves.
import { estimateBodyTokens, estimateTokens, fittedMaxTokens, replyHeadroom } from "../../core/tokens.js";
import { textOfMessage } from "../../core/messages.js";
import { billingForModel, contextWindowWithSourceFor, outputCeiling, priceCardFor } from "../../core/routing.js";
import { parseModelSuffix } from "../../core/shaping.js";
import { sliceRoom, normalizeTrimPolicy } from "../../core/trim.js";
import { COMPACTION_AGENT_WAYS, COMPACTION_METHODS, COMPACTION_WRITERS, INSTANT_TOKENS, SHAPE_RANK } from "../../services/session-settings.js";
import { compactionModelOf, compactionHead, copyWindow, earlierOf, earlierSummaries, summarize, summaryOfReply, summaryRequest, writtenTokens, readMessages, summaryPieces, transcriptOf, transcriptTokens, transcriptWithin, summaryHead, usableWindow, spanWords, SUMMARY_SHAPE, SUMMARY_ESTIMATE_CEILING } from "./compaction.js";
import { methodName } from "../../core/context-words.js";
import { compactedShapeOf } from "./shapes.js";
import { backAfterSummary } from "./reattach.js";
import { MORE_WAIT_MS } from "../agent/still-open.js";
import { CHATS_AGENT, createSkillsBack } from "../agent/skills-back.js";
import { agentSessionOf, codingAgentOf } from "../engine.js";
import { leadingTeams } from "../../core/teams-on.js";

/** The window assumed for a writer whose window nobody states — most models' floor. */
export const ASSUMED_WINDOW = 128_000;
/** Which row kind a compaction writes, by what asked for it (the stored vocabulary every reader knows). */
const KIND_BY_TRIGGER = Object.freeze({ line: "plain", manual: "manual" });
/**
 * The least room a fork's reply may have: a short summary of 2,048 tokens and the notes written before it; with less,
 * the summary is written from the transcript instead.
 */
export const FORK_MIN_TOKENS = writtenTokens(2048);

/** The instruction a fork of the session's own warm request gets, as its newest user text: the summary's shape. */
export const FORK_SUMMARY_INSTRUCTION = `[Filament: this conversation has reached its compaction line. Write its compaction summary now: a later model continues the work from your summary alone, in place of everything above — the summary an earlier compaction left at the start included.\n\n${SUMMARY_SHAPE}\n\nDo not call any tool: answer with the analysis and the summary only.]`;
/** What a fork's summary costs beyond the cached conversation: the instruction itself, written once. */
export const FORK_INSTRUCTION_TOKENS = estimateTokens(FORK_SUMMARY_INSTRUCTION);

/**
 * What a coding agent's own compaction is told to keep (HarnessV3-ACP AC5-5): the person's words (a typed
 * `/compact <words>`), on one line: it follows the agent's `/compact`. "" for none.
 * @param {string} words
 */
export const ownInstruction = (words) => String(words || "").replace(/\s+/g, " ").trim();

/**
 * The instruction a fork of the agent loop's live conversation gets mid-turn (turn.js), at the compaction line or on
 * the developer's own Compact: the turn's work so far becomes one summary, its newest `keep` rounds staying as they
 * are — the same cut the loop's fold makes (loop.js `compactWork`), written in the summary's shape. The first words
 * say which asked: a manual Compact never "reached the compaction line" (backlog 8a; HarnessV3-FixRound F1 item 9).
 * @param {number} keep @param {"line" | "manual"} [door]
 */
export const roundsForkInstruction = (keep, door = "line") =>
  `[Filament: ${door === "manual" ? "the developer asked to compact this turn now" : "this turn has reached the compaction line"}. Write the summary that replaces this turn's work so far — everything after the user's newest message, a summary of earlier rounds included —${keep > 0 ? ` except your last ${keep} round${keep === 1 ? "" : "s"} of tool calls and their results, which stay as they are. A later model continues the work from your summary alone.` : " your newest tool calls and their results too: nothing of it stays but your summary. You continue the work from it, as from your brief."}\n\n${SUMMARY_SHAPE}\n\nDo not call any tool: answer with the analysis and the summary only.]`;

/**
 * @typedef {"fold" | "summary"} Method
 * @typedef {{ sent: number, earlier: number, perTurn: { n: number, tokens: number }[] }} Measure
 *   `earlier`: what the earlier turns weigh as they go — the summary before them and the turns, the system prompt, the
 *   tools and the new message aside
 * @typedef {(o: { turns: any[], compactions: any[] }) => Promise<Measure>} MeasureFn
 * @typedef {{ state: "warm" | "cold" | "uncached" | "none", leftMs: number, tokens: number, model: string | null, thinking?: number | null } | null} CacheState
 * @typedef {{ model: string, fork: boolean, why: string, cost: number | null, listCost: number | null, agent?: true }} Writer
 * @typedef {{ cost: number | null, listCost: number | null }} Priced
 * @typedef {{ model: string, write: (instruction: string, signal: AbortSignal | null) => Promise<import("../../core/ports.js").AgentSummary> }} SelfWriter
 */
/**
 * Where a running compaction is, said as it moves (HarnessV3-FailurePoints §5.1 item 3): who writes the summary, or
 * the slice pass's step, with how far through the turns it is when that is known.
 * @typedef {(s: { message: string, percent?: number | null, planned?: number | null }) => void} StepSink
 *   `planned`: the calls a slice pass expects to make, counted before it starts
 *   a coding agent writing Filament's summary of its own session (HarnessV3-ACP AC5-4): the session's model, and how it
 *   is asked
 */

/** The compaction section of a document, read with its defaults. @param {any} doc */
export function compactionSettingsOf(doc) {
  const c = doc?.context?.compaction || {};
  const num = (/** @type {any} */ v, /** @type {number} */ d, /** @type {number} */ lo, /** @type {number} */ hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);
  return {
    method: /** @type {Method} */ (COMPACTION_METHODS.includes(c.method) ? c.method : "summary"),
    keepWhole: num(c.keepWhole, 1, 0, 10),
    writer: /** @type {"session" | "model" | null} */ (COMPACTION_WRITERS.includes(c.writer) ? c.writer : null),
    instantTokens: num(c.instantTokens, INSTANT_TOKENS, 0, 1_000_000),
    // A coding agent's session (HarnessV3-ACP AC5): how it makes room, and whether a cold one asks before going on.
    agent: /** @type {"suggested" | "own" | "self" | "ours"} */ (COMPACTION_AGENT_WAYS.includes(c.agent) ? c.agent : "suggested"),
    resumeQuestion: c.resumeQuestion !== false,
    // …and whether a message asks first where what the chat sends ahead of its history changed (agent/prefix.js).
    changeQuestion: c.changeQuestion !== false,
    // …and whether Filament keeps its copy of the chat in step with the agent (HarnessV4_Tasks C29).
    follow: c.follow !== false,
  };
}

/** Two model names for the same model, the suffixes aside. @param {any} cfg @param {string | null | undefined} a @param {string | null | undefined} b */
export const sameModel = (cfg, a, b) => {
  const base = (/** @type {string} */ m) => parseModelSuffix(String(m || "").replace(/^agent\//, ""), cfg?.rules).base.toLowerCase();
  return !!a && !!b && base(a) === base(b);
};

/** A model's window and where the number came from; `assumed` when nobody states one. @param {any} cfg @param {string} model */
export function writerWindow(cfg, model) {
  const w = model ? contextWindowWithSourceFor(cfg, model) : { tokens: null, source: null };
  return w.tokens ? { tokens: Number(w.tokens), source: /** @type {string} */ (w.source) } : { tokens: ASSUMED_WINDOW, source: "assumed" };
}

/**
 * What one call of a writer reads at most — the slice pass's budget for its window — with the window and the most one
 * slice's own summary runs to. A reading bigger than `budget` is written across slices, never cut to fit.
 * @param {any} cfg @param {any} memory @param {string | null} chainId @param {string} model
 */
export function oneCallRoom(cfg, memory, chainId, model) {
  const window = writerWindow(cfg, model).tokens;
  const room = sliceRoom(window, normalizeTrimPolicy(memory?.sliceConfig?.() || {}));
  return { window, budget: Math.max(room.minSlice, room.budget), summaryTokens: room.summaryTokens };
}

/** Dollars for token counts on a model's price card; null when nothing prices it. @param {any} cfg @param {string} model @param {{ input?: number, output?: number, cacheRead?: number, cacheWrite?: number }} t */
export function costOf(cfg, model, t) {
  const p = model ? priceCardFor(cfg, model) : null;
  if (!p) return null;
  const usd = ((t.input || 0) * (p.input || 0) + (t.output || 0) * (p.output || 0) + (t.cacheRead || 0) * (p.cacheRead || 0) + (t.cacheWrite || 0) * (p.cacheWrite || 0)) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}

/**
 * What a call would cost on `model`: `cost` is what would be paid — $0 on a subscription plan, priced or not — and
 * `listCost` is the same tokens at the price card (null when nothing prices it).
 * @param {any} cfg @param {string} model @param {{ input?: number, output?: number, cacheRead?: number, cacheWrite?: number }} t
 * @returns {Priced}
 */
export function pricedOf(cfg, model, t) {
  const listCost = costOf(cfg, model, t);
  return { cost: model && billingForModel(cfg, model) === "plan" ? 0 : listCost, listCost };
}

/**
 * The rule between two priced models (models.js orders a list by it): the lower paid figure wins, and a side nobody
 * prices loses to one that is priced.
 * On a tie — two plan models both pay $0 — the lower list price wins, an unpriced one losing again; still even, `a`.
 * @param {Priced} a @param {Priced} b
 */
export function cheaperOf(a, b) {
  if (a.cost == null) return false;
  if (b.cost == null || a.cost < b.cost - 1e-9) return true;
  if (a.cost > b.cost + 1e-9) return false;
  if (a.listCost == null) return b.listCost == null;
  return b.listCost == null || a.listCost <= b.listCost + 1e-9;
}

/** How many of a session's newest summaries the size guess reads (HarnessV4_Tasks C30 item 6): they say how its
 *  writer writes now, and a long session's every summary is never opened for a guess (each opens on its first read). */
export const SUMMARY_ESTIMATE_PAST = 5;

/**
 * How long a summary will likely come back: the session's newest summaries when it has some (the median of up to
 * SUMMARY_ESTIMATE_PAST), else a rule of thumb — about 6% of what it condenses, between 1,000 tokens and
 * SUMMARY_ESTIMATE_CEILING.
 * @param {number} transcriptTokens @param {readonly any[]} compactions  oldest first
 */
export function summaryEstimate(transcriptTokens, compactions) {
  /** @type {number[]} */
  const past = [];
  const list = compactions || [];
  for (let i = list.length - 1; i >= 0 && past.length < SUMMARY_ESTIMATE_PAST; i--) {
    const n = list[i]?.text ? estimateTokens(String(list[i].text)) : 0;
    if (n > 0) past.push(n);
  }
  past.sort((a, b) => a - b);
  if (past.length) return Math.min(SUMMARY_ESTIMATE_CEILING, past[Math.floor(past.length / 2)]);
  return Math.min(SUMMARY_ESTIMATE_CEILING, Math.max(1000, Math.round(transcriptTokens * 0.06)));
}

/**
 * The room one call that summarizes a whole transcript is held to (turn.js `exchangesGiveWay`): its reply first — the
 * notes and the summary a transcript that size is guessed to need (`writtenTokens(summaryEstimate)`, the earlier
 * summaries it carries setting the guess, as a session's own do), never more than the model can write (`ceiling`) —
 * and the request the rest of the window less the reply's headroom. The owner's share of the window one call may read
 * (`sliceBudgetFraction`, core/trim.js `sliceRoom`, without the slice pass's ceiling on one slice, which bounds slices
 * of a few hundred words each) bounds the request below that, never above it. Where the model writes less than such a
 * transcript's summary needs, the request is held to the longest transcript whose summary it can write.
 * @param {{ window: number, ceiling: number, policy?: any, past?: readonly string[] }} o  `past`: the earlier summaries' words
 * @returns {{ request: number, reply: number }}
 */
export function summaryCallRoom({ window, ceiling, policy = {}, past = [] }) {
  const compactions = past.map((text) => ({ text }));
  const need = (/** @type {number} */ tokens) => writtenTokens(summaryEstimate(tokens, compactions));
  const share = sliceRoom(window, { ...(policy || {}), maxSliceTokens: 0 }).budget;
  let request = Math.max(0, Math.min(share, window - replyHeadroom(window) - Math.min(ceiling, need(share))));
  if (need(request) > ceiling && need(0) <= ceiling) {
    let [lo, hi] = [0, request];
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (need(mid) <= ceiling) lo = mid;
      else hi = mid;
    }
    request = lo;
  }
  return { request, reply: Math.min(ceiling, need(request)) };
}

/**
 * A side agent's earlier exchanges summarized from their transcript, in one call of `model` (turn.js and acp-turn.js
 * `exchangesGiveWay`): the transcript held to the request `summaryCallRoom` leaves once the reply has what a summary of
 * it needs, and the call asking for the rest of the window, both weighed on the scale `factor` sets (the lane's learned
 * estimator factor; none where it has none). Within that room, compaction.js `transcriptWithin` gives way as little as
 * it must — `grow` at the line, else as after a size refusal — its start the message at `start`, its task what `isTask`
 * names. → the summary, and how its transcript was read in a note's words (`from`); or why none was written.
 * @param {any} memory
 * @param {{ gone: any[], model: string, window: number | null, ceiling: number, factor?: number | null, grow: boolean, start?: number,
 *   isTask?: ((text: string) => boolean) | null, chainId?: string | null, signal?: AbortSignal | null }} o
 * @returns {Promise<{ text: string, from: string } | { error: string }>}
 */
export async function transcriptSummary(memory, { gone, model, window, ceiling, factor = null, grow, start = 0, isTask = null, chainId = null, signal = null }) {
  /** What one call over `transcript` weighs (compaction.js `summarize`, `summaryRequest`), asking for no thinking. @param {string} transcript */
  const weigh = (transcript) => estimateBodyTokens(summaryRequest(transcript), "conversation", factor);
  /** @type {ReturnType<typeof transcriptWithin>} */
  let reading = null;
  let text = "";
  try {
    const call = window ? summaryCallRoom({ window, ceiling, policy: memory?.sliceConfig?.(), past: earlierSummaries(gone) }) : null;
    // The transcript's own tokens on the estimate's scale: the call less its brief and prompt, the lane's factor off.
    const limit = call ? Math.floor((call.request - weigh("")) / (Number(factor) > 0 ? Number(factor) : 1)) : Infinity;
    reading = transcriptWithin(gone, limit, { start, grow, isTask });
    if (!reading) return { error: `their start and their earlier summaries alone do not fit one call of ${model} in its ${Number(window).toLocaleString()}-token window` };
    const room = window ? fittedMaxTokens({ window, request: weigh(reading.text), cap: ceiling, floor: 1 }) : null;
    text = await summarize(memory, { transcript: reading.text, model, chainId, signal, maxTokens: room });
  } catch (/** @type {any} */ e) {
    return { error: `${model} could not summarize them: ${e.message}` };
  }
  if (!text) return { error: `${model} wrote no summary of them` };
  /** What a cut took, in the note's words. @param {{ of: string, to: number, count: number }} c */
  const tookWords = (c) =>
    `${c.of === "task" ? "its task" : c.of === "agent" ? (c.count === 1 ? "one of its replies" : `${c.count} of its replies`) : c.count === 1 ? "one message to it" : `${c.count} messages to it`} cut to ${c.to.toLocaleString()} characters`;
  const gave = [...reading.cuts.map(tookWords), ...(reading.left ? [`its oldest ${reading.left === 1 ? "line" : `${reading.left.toLocaleString()} lines`} left out`] : [])];
  return { text, from: `from their transcript${gave.length ? `, ${gave.join(", ")} to fit one call` : ""}` };
}

/**
 * A stand-in text of `tokens` tokens, by Filament's count (core/tokens.js: a word of four letters is one, a lone space
 * none): the weight a summary not yet written will have in the composition. "summary " counted 1.5 where 2 were meant,
 * and a guess of 6.5K weighed 4.9K (the owner's look of 10-24).
 * @param {number} tokens
 */
export const filler = (tokens) => "word ".repeat(Math.max(1, Math.round(tokens)));

/** The turns with `turnIds` carrying a compaction mark at `shape` (clones — the archive's turns are never touched). @param {any[]} turns @param {Set<number>} turnIds @param {string} shape */
function marked(turns, turnIds, shape) {
  return turns.map((t) => (turnIds.has(t.turnId) ? { ...t, meta: { ...(t.meta || {}), compacted: { shape, id: 0, at: 0 } } } : t));
}

/**
 * Who writes a compaction summary, and whether it forks the warm cache: the document's writer choice — the same model
 * (session) or the side model (model: a named `context.compaction.model`, else the model set for memory `cheapModel`) —
 * over the rule where none is chosen: a named compaction model, else the session's. Pure: the turn-start compactor and
 * the agent loop's fold at the line (turn.js) ask the same question with their own cache state. `outTokens` is the
 * summary's size; each writer is priced for the notes it writes before it too (`writtenTokens`), on a transcript of
 * `transcriptTokens` — the compactor prices each writer again on what it would really read (`readingOf`).
 * A writer is a model Filament calls, or a coding agent's model the person named or gave memory (HarnessV4_Tasks C33):
 * the agent reads the transcript in a session of its own, opened for the one call and closed after it, on its plan and
 * with its own prompt on top (`agent` on the writer says so). A session on a coding agent is summarised by the model
 * named, else memory's, whatever the writer choice — its warm session is the agent's own to summarise (HarnessV3-ACP
 * AC5-2), and its agent stands in for no model nobody named.
 * @param {{ cfg: any, doc: any, sessionModel: string, cheapModel?: string | null, cache: CacheState, transcriptTokens: number, outTokens: number }} o
 * @returns {{ chosen: Writer | null, session: { model: string, fork: boolean } & Priced | null,
 *   side: { model: string, agent?: true } & Priced | null, error?: string }}
 */
export function chooseWriter({ cfg, doc, sessionModel, cheapModel: summarizer = null, cache, transcriptTokens, outTokens }) {
  const choice = compactionSettingsOf(doc).writer;
  const named = String(compactionModelOf(doc, "") || "").trim();
  // A session on a coding agent is one whose route lands on the agent first, as its turns do (`agentSessionOf`): one
  // that falls back on an agent is the model's, its warm cache its own to write from (the hunt of 11-08).
  const onAgent = !!sessionModel && !!agentSessionOf(cfg, sessionModel);
  const cheapModel = named || String(summarizer || "").trim();
  const byAgent = !!cheapModel && !!codingAgentOf(cfg, cheapModel);
  const forkable = !onAgent && !!sessionModel && cache?.state === "warm" && sameModel(cfg, cache.model, sessionModel);
  const output = writtenTokens(outTokens);
  const session = sessionModel && !onAgent
    ? {
        model: sessionModel,
        fork: forkable,
        ...(forkable
          ? pricedOf(cfg, sessionModel, { cacheRead: cache?.tokens || transcriptTokens, cacheWrite: FORK_INSTRUCTION_TOKENS, output })
          : pricedOf(cfg, sessionModel, { input: transcriptTokens, output })),
      }
    : null;
  const side = cheapModel
    ? { model: cheapModel, ...pricedOf(cfg, cheapModel, { input: transcriptTokens, output }), ...(byAgent ? { agent: /** @type {const} */ (true) } : {}) }
    : null;
  /** The session's own model as the writer. @param {string} why @returns {Writer | null} */
  const asSession = (why) => (session ? { model: session.model, fork: session.fork, why, cost: session.cost, listCost: session.listCost } : null);
  /** A named model as the writer (it forks too when it is the session's own). @param {string} model @param {string} why @returns {Writer} */
  const asModel = (model, why) =>
    session && sameModel(cfg, model, session.model)
      ? { model, fork: session.fork, why, cost: session.cost, listCost: session.listCost }
      : { model, fork: false, why, ...pricedOf(cfg, model, { input: transcriptTokens, output }), ...(codingAgentOf(cfg, model) ? { agent: /** @type {const} */ (true) } : {}) };
  /** @type {Writer | null} */
  let chosen = null;
  const sideWhy = named ? "context.compaction.model" : "memory's model";
  if (onAgent) chosen = side ? asModel(side.model, `${named ? "context.compaction.model" : "memory's model"} (the session's is a coding agent)`) : null;
  else if (choice === null) chosen = named ? asModel(named, "context.compaction.model") : asSession("the session's model");
  else if (choice === "session") chosen = asSession("the session's model (writer: session)");
  else chosen = side ? asModel(side.model, `${sideWhy} (writer: model)`) : null;
  const none = onAgent
    ? "no model to summarize with: name one in context.compaction.model (a coding agent's model writes it too, in a session of its own), or set memory's model (Settings › Memory › Model)"
    : choice === "model"
      ? "no side model to summarize with: name one in context.compaction.model, or set memory's model (Settings › Memory › Model)"
      : "no model to summarize with: set model.name or context.compaction.model";
  return { chosen, session, side, ...(chosen ? {} : { error: none }) };
}

/**
 * @param {{ memory: any, config: { get: () => any }, ops: { record: (kind: string, title: string, o?: any) => any },
 *   log: (level: string, msg: string) => void,
 *   subagents?: { forkCall: (chainId: string, instruction: string, o?: any) => Promise<any>, cacheOf: (chainId: string) => any } | null,
 *   speedOf?: ((model: string) => { ttftMs: number, tps: number, calls: number } | null) | null,
 *   timeOf?: ((model: string, kind: "compact") => { ms: number, calls: number } | null) | null,
 *   teams?: import("../../services/teams.js").TeamStore | null,
 *   graphKept?: ((chainId: string) => import("../../core/task-graph.js").Kept | null) | null,
 *   graphWhere?: ((chainId: string, crew: import("../../core/task-graph.js").Crew) => string | null) | null,
 *   stillOpen?: Pick<import("../agent/still-open.js").StillOpen, "lines" | "told" | "untold"> & Partial<Pick<import("../agent/still-open.js").StillOpen, "refresh" | "folded">> | null,
 *   skillsLoaded?: ((chainId: string) => { name: string, turn: number }[]) | null,
 *   now?: () => number }} deps
 *   The plan's "about how long" is counted from the request log: `timeOf`, how long that model's summaries have taken,
 *   whole; else `speedOf`, its measured speed (its first byte, its tokens a second) — which
 *   leaves out what it thinks before it writes. With neither, or for a model the log has no finished call of, the
 *   plan says none. `teams`: a session's open tasks come back after a summary in its planner's words, and a team's
 *   lead's name its members. `graphKept`: what is kept behind each of their tasks (E33), marked. `graphWhere`: where the
 *   planner stands, the running and paused tasks' checkpoints in it (E41 P1), after the graph. `stillOpen`: what is
 *   still open in the chat for its main agent (agent/still-open.js), last — its main agent hears it once the summary
 *   lands (`told`); after the agent's own compaction, which says none, its next turn's first prompt does (`untold`), and
 *   so it does after a fold, which brings nothing back after it (`folded`, the owner's of 11-09: every compaction
 *   reminds). What the folder holds is read for it as the compaction starts (`refresh`), and waited for as a summary lands.
 *   `skillsLoaded`: the skills a coding agent loaded with Filament's skill tool in the turns Filament's copy holds since
 *   its head, the newest first (service.js): what its own compaction may take with it, owed to it with what is still
 *   open (`own`, agent/skills-back.js).
 */
export function createCompactor({ memory, config, ops, log, subagents = null, speedOf = null, timeOf = null, teams = null, graphKept = null, graphWhere = null, stillOpen = null, skillsLoaded = null, now = Date.now }) {
  const archive = () => memory?.archive;
  /** The skills each chat's coding agent is owed after its own compaction: what one asked of it outside a turn took, too. */
  const skillsBack = createSkillsBack({ archive });

  /**
   * Who writes this session's summary (`chooseWriter` under the app's config and the model set for memory).
   * @param {{ doc: any, sessionModel: string, cache: CacheState, transcriptTokens: number, outTokens: number }} o
   */
  const writerFor = (o) => chooseWriter({ cfg: config.get(), cheapModel: String(memory?.summarizerModel?.() || "").trim(), ...o });

  /**
   * Every way weighed, nothing called and nothing written: what the next request would weigh after each, what each
   * would cost and who would write it (`plan`), and the turns each would work on (`work`, for run). `methods` are the
   * session's own: fold, and summary by the session's writer; `writers` weighs a summary by each writer side by side —
   * the same model (`session`) and the side model (`side`) — and `recommended` says which the cache is for (the owner's
   * rules of 10-31): the same model while its cache is warm and a fork of it has room to write, else the side model.
   * `turns` are the session's finished turns as the composer takes them (adapted); `measure` composes them under the
   * session's document and says what the request weighs, per turn too. `root` is the session's folder: what a summary
   * brings back after it is read from there (`backAfter`), with the chain's task graph. `held` is what a coding agent's
   * context holds (HarnessV3-ACP AC5-3): the session is weighed by it, not by the composition, which only seeds the
   * fresh agent session a compaction starts — what each method's `after` is.
   * @param {{ chain: any, doc: any, turns: any[], compactions: any[], sessionModel: string, window: number | null, measure: MeasureFn, root?: string | null, held?: number | null }} o
   */
  async function weigh({ chain, doc, turns, compactions, sessionModel, window, measure, root = null, held = null }) {
    const set = compactionSettingsOf(doc);
    const cfg = config.get();
    const win = Number(window) > 0 ? Number(window) : null;
    // What a compaction works on is Filament's copy as the composer sends it: the turns past its head, the one a
    // coding agent compacted its own context in the middle of from that compaction on (`copyTurns`).
    const { head, fromN, inWindow } = copyWindow(turns, compactions);
    const lead = head ? earlierOf(head) : null;
    const cur = await measure({ turns, compactions });
    // What the session holds now: the composition — or what a coding agent's context holds.
    const now = Number(held) > 0 ? Number(held) : cur.sent;

    // fold: every finished turn in the window but the newest `keepWhole` — those a mark would move further.
    const kept = new Set(inWindow.slice(Math.max(0, inWindow.length - set.keepWhole)).map((t) => t.turnId));
    const targetsFor = (/** @type {string} */ shape) =>
      inWindow.filter((t) => !kept.has(t.turnId) && (SHAPE_RANK[/** @type {keyof typeof SHAPE_RANK} */ (compactedShapeOf(t) || "raw")] ?? 0) < (SHAPE_RANK[/** @type {keyof typeof SHAPE_RANK} */ (shape)] ?? 0));
    const foldTargets = targetsFor("fold");
    const folded = foldTargets.length ? await measure({ turns: marked(turns, new Set(foldTargets.map((t) => t.turnId)), "fold"), compactions }) : cur;
    const foldAfter = folded.sent;
    // A mark only makes room where it renders smaller than the turns already go: turns of words alone, or turns an
    // earlier fold already marked, fold to what they are, and marking them frees nothing — said so, never written as
    // if it had.
    const foldFrees = foldAfter < now;
    const foldRuns = foldTargets.length > 0 && foldFrees;
    // The instant line (`context.compaction.instantTokens`): what the fold leaves of the earlier turns, the summary
    // before them included, at it or under — the fold is offered then, and a side model's reading is the fold itself.
    const instant = foldRuns && set.instantTokens > 0 && folded.earlier <= set.instantTokens;

    // summary: every turn since the head, and the transcript a writer reads of them — whole, or with their tool calls
    // folded. A coding agent's copy holds each turn's words and not its tool output: its whole is its folds.
    const agentCopy = !!sessionModel && !!agentSessionOf(cfg, sessionModel);
    const wholeTokens = transcriptTokens(summaryPieces(lead, inWindow, agentCopy));
    /** @type {number | null} */
    let foldedCount = null;
    const foldedTokens = () => (foldedCount ??= agentCopy ? wholeTokens : transcriptTokens(summaryPieces(lead, inWindow, true)));
    const summaryOut = summaryEstimate(wholeTokens, compactions);
    // What comes back after a summary of the turns up to `toTurn` (HarnessV3-AtHome AH-D9 b): weighed with the
    // summary's stand-in here, read again when the summary is written (`backAfter`, each time it is asked).
    /** @param {number} toTurn */
    const backAfter = (toTurn) =>
      backAfterSummary({ doc, turns, toTurn, head, root, window: win || ASSUMED_WINDOW, graph: chain?.meta?.graph, teams: leadingTeams(cfg, chain?.kind === "team", teams), kept: chain ? graphKept?.(chain.id) ?? null : null, where: chain && graphWhere ? (crew) => graphWhere(chain.id, crew) : null, open: chain ? stillOpen?.lines(chain.id) ?? null : null, owed: Object.keys(chain?.meta?.letters?.asks || {}) });
    const last = inWindow[inWindow.length - 1];
    const summaryAfter = last
      ? (await measure({ turns, compactions: [...compactions, { from_turn: head ? Number(head.from_turn) || 1 : fromN, to_turn: last.n, kind: "pending", text: filler(summaryOut), attached: backAfter(last.n).text || null }] })).sent
      : cur.sent;

    const cache = /** @type {CacheState} */ (subagents?.cacheOf?.(chain.id) || null);
    // Whether a fork of the warm cache could write the summary at all: the kept request, the newest turn's answer after
    // it and the instruction must leave a summary's room under the window, above the kept thinking budget — the fit
    // the fork itself is held to (subagents.js `forkCall`). Warm but too full is said as such, and priced as what
    // would really run: the transcript call.
    const forkRequest = cache ? (Number(cache.tokens) || 0) + (last?.final ? estimateTokens(textOfMessage(last.final)) : 0) + FORK_INSTRUCTION_TOKENS : 0;
    const forkRoom = cache?.state === "warm" ? fittedMaxTokens({ window: win, request: forkRequest, cap: outputCeiling(cfg, cache.model || sessionModel), floor: FORK_MIN_TOKENS, thinking: Number(cache.thinking) || 0 }) : null;
    const writers = writerFor({ doc, sessionModel, cache: forkRoom != null ? cache : null, transcriptTokens: wholeTokens, outTokens: summaryOut });
    /**
     * About how long `calls` of a model take, one after another, writing `written` tokens between them: by how long
     * its calls of that kind have taken in the request log, whole (HarnessV4_Tasks C33: a writer that thinks first took
     * 57 s where its speed said 21); else by its measured speed. Null where the log has no finished call of it: no
     * time is made up.
     * @param {string | null | undefined} model @param {number} calls @param {number} written @param {"compact"} kind
     */
    const aboutMs = (model, calls, written, kind) => {
      if (!model || !(calls > 0)) return null;
      const past = timeOf?.(model, kind) || null;
      if (past) return Math.round(calls * past.ms);
      const s = speedOf?.(model) || null;
      return s && s.tps > 0 ? Math.round(calls * s.ttftMs + (written / s.tps) * 1000) : null;
    };
    /** Whether a writer is the side model: any model but the session's own. @param {{ model: string } | null} w */
    const isSide = (w) => !!w && !(writers.session && sameModel(cfg, w.model, writers.session.model));
    /**
     * How a writer reads the turns (the owner's rules of 10-31; `writeSummary` reads them so): a fork reads the warm
     * conversation itself; any other writer reads the turns whole where they fit one call of its window, else with
     * their tool calls folded — and a side model whose folded turns are at the instant line or under is not called at
     * all: the compaction is the fold. Folded turns still too big for one call go in the slice pass's sequential slices.
     * @param {{ model: string, fork: boolean }} w @param {boolean} side
     */
    const readingOf = (w, side) => {
      if (w.fork) return { reads: /** @type {const} */ ("fork"), tokens: Number(cache?.tokens) || wholeTokens, slices: 1, sliceBudget: null, sliceTokens: 0 };
      const room = oneCallRoom(cfg, memory, chain.id, w.model);
      const at = { sliceBudget: room.budget, sliceTokens: room.summaryTokens };
      if (wholeTokens <= room.budget) return { reads: /** @type {const} */ ("whole"), tokens: wholeTokens, slices: 1, ...at };
      if (side && instant) return { reads: /** @type {const} */ ("instant"), tokens: 0, slices: 0, ...at };
      const f = foldedTokens();
      return f <= room.budget ? { reads: /** @type {const} */ ("folded"), tokens: f, slices: 1, ...at } : { reads: /** @type {const} */ ("slices"), tokens: f, slices: Math.ceil(f / room.budget), ...at };
    };
    const output = writtenTokens(summaryOut);
    /**
     * A summary by `w` as the plan says it — what it reads and how, what it costs and about how long it takes — or why
     * it cannot run (`error`). A side model's reading that is the instant fold says the fold's figures: no call.
     * @param {{ model: string, fork: boolean, agent?: true } | null} w @param {string | null | undefined} error
     */
    const summaryBy = (w, error) => {
      if (!inWindow.length) return { after: cur.sent, exact: false, headTurns: 0, model: w?.model || null, fork: false, reads: null, slices: 0, cost: null, listCost: null, possible: false, why: "no finished turn to summarize" };
      if (!w) return { after: summaryAfter, exact: false, headTurns: inWindow.length, model: null, fork: false, reads: null, slices: 0, cost: null, listCost: null, possible: false, why: error || "no model to summarize with", status: 400 };
      const r = readingOf(w, isSide(w));
      const by = { model: w.model, ...(w.agent ? { agentWriter: true } : {}) };
      if (r.reads === "instant")
        return { after: foldAfter, exact: true, headTurns: inWindow.length, turns: foldTargets.length, earlier: folded.earlier, ...by, fork: false, reads: r.reads, transcriptTokens: foldedTokens(), slices: 0, sliceBudget: r.sliceBudget, calls: 0, cost: 0, listCost: 0, aboutMs: null, possible: true };
      const priced = w.fork ? pricedOf(cfg, w.model, { cacheRead: r.tokens, cacheWrite: FORK_INSTRUCTION_TOKENS, output }) : pricedOf(cfg, w.model, { input: r.tokens, output });
      return {
        after: summaryAfter,
        exact: false,
        headTurns: inWindow.length,
        transcriptTokens: r.tokens,
        summaryTokens: summaryOut,
        reads: r.reads,
        slices: r.slices,
        sliceBudget: r.sliceBudget,
        aboutMs: aboutMs(w.model, r.slices, r.slices * (r.slices > 1 ? r.sliceTokens : summaryOut), "compact"),
        ...by,
        fork: !!w.fork,
        cost: priced.cost,
        listCost: priced.listCost,
        possible: true,
      };
    };
    /** A writer's window and where the number came from (`assumed` when nobody states one). @param {string} model */
    const windowOf = (model) => {
      const ww = writerWindow(cfg, model);
      return { window: ww.tokens, windowSource: ww.source };
    };
    const side = writers.side ? { model: writers.side.model, fork: !!writers.session?.fork && sameModel(cfg, writers.side.model, writers.session.model), ...(writers.side.agent ? { agent: /** @type {const} */ (true) } : {}) } : null;
    const bySession = writers.session ? { ...summaryBy(writers.session, null), window: win } : null;
    const bySide = side ? { ...summaryBy(side, null), ...windowOf(side.model) } : null;
    const summary = summaryBy(writers.chosen, writers.error);
    const recommended = bySession?.possible && bySession.fork ? "session" : bySide?.possible ? "model" : bySession?.possible ? "session" : null;

    const methods = {
      // `exact`: whether `after` is the composition itself (a fold) or weighed with a stand-in for what is not written
      // yet (a summary) — the preview says ≈ for those.
      fold: {
        after: foldAfter,
        exact: true,
        turns: foldTargets.length,
        earlier: folded.earlier,
        calls: 0,
        cost: 0,
        listCost: 0,
        possible: foldRuns,
        instant,
        ...(!foldTargets.length
          ? { why: inWindow.length ? "every older turn is already folded or kept whole" : "no finished turn to fold" }
          : !foldFrees
            ? { why: "folding frees nothing: every older turn already goes as its fold or smaller" }
            : !instant
              ? { instantWhy: set.instantTokens > 0 ? `it leaves ≈${folded.earlier.toLocaleString()} tokens of the earlier turns, over the ${set.instantTokens.toLocaleString()} an instant fold may leave` : "an instant fold is off (context.compaction.instantTokens 0)" }
              : {}),
      },
      summary,
    };
    return {
      plan: {
        now,
        window: win,
        // The compaction line (the same `usableWindow` the composer and the loop aim at).
        line: win ? usableWindow(win, doc?.context?.compaction) : null,
        mode: doc?.context?.compaction?.mode === "auto" ? "auto" : "ask",
        method: set.method,
        writer: set.writer,
        keepWhole: set.keepWhole,
        instantTokens: set.instantTokens,
        recommended,
        fromTurn: fromN,
        turns: inWindow.length,
        methods,
        writers: {
          session: bySession,
          side: bySide,
          chosen: writers.chosen,
          cache: cache ? { state: cache.state, leftMs: cache.leftMs, tokens: cache.tokens, model: cache.model, forkRoom } : null,
        },
      },
      work: {
        lists: { fold: foldTargets, summary: inWindow },
        writer: writers.chosen,
        lead,
        head,
        folded: agentCopy,
        backAfter,
      },
    };
  }

  /** The figures alone — what the preview shows. @param {Parameters<typeof weigh>[0]} o */
  async function plan(o) {
    return (await weigh(o)).plan;
  }

  /**
   * The summary of `list` (the finished turns since the head, or its older part): a fork of the session's warm
   * request when the writer is the session's model and the summary stands for the whole window, else one call over
   * the transcript — the turns whole where they fit the writer's slice budget, else with their tool calls folded (the
   * owner's rules of 10-31: `folded` in the answer) — and only where even the folded turns are bigger than it,
   * the slice pass's sequential slices of them.
   * `window` is the session model's: the fork's reply is fitted to what it leaves (a kept request near the line has
   * little room for a summary), and a fork with too little room is not made.
   * `folded` says the summary is for a coding agent's copy of the chat: its turns are read as their folds
   * (compaction.js `readTurn`) from the start. `job` names the compaction each call is part of, and `onStep` hears where it is (§5.1
   * item 3).
   * @param {{ chain: any, list: any[], lead: string | null, whole: boolean, writer: Writer, window?: number | null, signal?: AbortSignal | null,
   *   folded?: boolean, job?: string | null, onStep?: StepSink | null }} o
   * @returns {Promise<{ text: string, how: "fork" | "call" | "slices", model: string, calls?: number, folded?: true }>}
   */
  async function writeSummary({ chain, list, lead, whole, writer, window = null, signal = null, folded = false, job = null, onStep = null }) {
    const cfg = config.get();
    if (writer.fork && whole && subagents?.forkCall) {
      const last = list[list.length - 1];
      onStep?.({ message: `a fork of the session's own request writes the summary (${writer.model})` });
      const f = await subagents.forkCall(chain.id, FORK_SUMMARY_INSTRUCTION, {
        model: writer.model, signal, endsWith: last?.final ? textOfMessage(last.final) : null,
        window: Number(window) || 0, minTokens: FORK_MIN_TOKENS, stream: true, textOnly: true, forkFor: "compaction", retry: true, job,
      });
      const text = f?.ok ? summaryOfReply(f.text) : "";
      if (text) return { text, how: "fork", model: writer.model };
      // A stop, or Send without it, ended the fork: nothing more is called, and no failure is logged of it.
      if (signal?.aborted) throw new Error("the summary's call was stopped");
      if (f && !f.ok) log("warn", `sessions: ${chain.id} compaction fork failed (${f.error}); summarizing the transcript instead`);
    }
    const room = oneCallRoom(cfg, memory, chain.id, writer.model);
    let pieces = summaryPieces(lead, list, folded);
    let tokens = transcriptTokens(pieces);
    // Too big whole for one call: the tool calls fold first.
    const folds = !folded && tokens > room.budget;
    if (folds) {
      pieces = summaryPieces(lead, list, true);
      tokens = transcriptTokens(pieces);
    }
    const reads = folded || folds;
    const as = folds ? { folded: /** @type {const} */ (true) } : {};
    if (tokens > room.budget && memory?.sliceSummarize) {
      const messages = [...(lead ? summaryHead(lead) : []), ...list.flatMap((t) => readMessages(t, reads))];
      // The calls the pass expects to make, as the plan counted them: its progress says them of this total.
      const planned = Math.ceil(tokens / room.budget);
      const r = await memory.sliceSummarize({ chainId: chain.id, messages, model: writer.model, windowTokens: room.window, signal, jobId: job, onProgress: (p) => onStep?.({ message: p.message, percent: p.percent, planned }) });
      return { text: String(r.text || "").trim(), how: "slices", model: writer.model, calls: r.calls, ...as };
    }
    onStep?.({ message: `${writer.model} writes the summary in one call${folds ? ", from the turns with their tool calls folded" : ""}` });
    return { text: await summarize(memory, { transcript: transcriptOf(pieces), model: writer.model, chainId: chain.id, signal, jobId: job }), how: "call", model: writer.model, ...as };
  }

  /**
   * The summary a coding agent writes of its own session (HarnessV3-ACP AC5-4: Self), asked as a fork of Filament's
   * warm request is (`FORK_SUMMARY_INSTRUCTION`): the agent's analysis dropped, as every summary's is.
   * @param {SelfWriter} self @param {AbortSignal | null} signal
   */
  async function selfSummary(self, signal) {
    const r = await self.write(FORK_SUMMARY_INSTRUCTION, signal);
    return { text: summaryOfReply(r.text), how: r.how === "fork" ? "agent-fork" : "agent", model: self.model, usage: r.usage };
  }

  /**
   * Make room: the method asked (else the session's), run and written — a summary by the session's writer, whose
   * side model's reading of turns that fold to the instant line or under is the fold itself. `trigger` says who
   * asked — `line` (the harness's turn start) or `manual` (Compact now) — which is the row's kind. `guard` is asked
   * right before anything is written (a summary takes minutes, and a turn that started meanwhile owns the history's
   * head): a reason from it refuses the write. A failure carries the status a caller answers with. Once its row is
   * written, the compaction starts its learning run, named by its trigger (`learning`, said in its note and op —
   * HarnessV3-Memory M7-D27). A summary's row carries what came back after it (AH-D9 b), read from `root` once the
   * summary is written. `held` weighs a coding agent's session by what its context holds (`weigh`); with `orFold`, a
   * method that needs a model to write with and has none gives way to fold, which calls none — a coding agent's session
   * at its line (HarnessV3-ACP AC5-2). With `self`, the agent writes the summary of its own session (AC5-4), which
   * needs no model of Filament's: the summary method, whatever the session's. `skip` lets the summary go (Send without
   * it), where `signal` stops the turn itself; with `fallback` — a turn waits on it, sent as Filament composes it — a
   * summary whose writer fails, falls silent or is let go gives way to fold, and without it one let go writes nothing
   * (the filament-agent plan's D6). `job` and `onStep` go to the summary's writer: its calls carry the job's id, and
   * it says its steps (HarnessV3-FailurePoints §5.1 item 3).
   * @param {{ chain: any, doc: any, turns: any[], compactions: any[], sessionModel: string, window: number | null, measure: MeasureFn, held?: number | null, orFold?: boolean,
   *   trigger: "line" | "manual", method?: string | null, signal?: AbortSignal | null, fallback?: boolean, skip?: AbortSignal | null,
   *   guard?: (() => string | null) | null, root?: string | null, self?: SelfWriter | null, job?: string | null, onStep?: StepSink | null }} o
   * @returns {Promise<{ ok: true, method: Method, kind: string, id: number, fromTurn: number, toTurn: number, chars: number, before: number, after: number, model: string | null, how: string, note: string, learning: Learning | null }
   *   | { ok: false, method: Method | null, status: number, error: string }>}
   */
  async function run({ chain, doc, turns, compactions, sessionModel, window, measure, trigger, method = null, signal = null, fallback = false, skip = null, guard = null, root = null, held = null, orFold = false, self = null, job = null, onStep = null }) {
    // What the folder holds, read while the summary is written: the block after it says it.
    const reading = stillOpen?.refresh?.(chain.id) ?? null;
    const { plan: p, work } = await weigh({ chain, doc, turns, compactions, sessionModel, window, measure, root, held });
    const asked = self ? "summary" : method || p.method;
    if (!COMPACTION_METHODS.includes(asked)) return { ok: false, method: null, status: 400, error: `"${asked}" is not a compaction method` };
    let m = /** @type {Method} */ (asked);
    /** @type {any} */
    let est = p.methods[m];
    // The agent is the writer the summary lacks: only nothing to summarize stops it.
    const selfCan = !!self && (est.possible || est.status === 400);
    const folds = !self && orFold && m !== "fold" && !est.possible && est.status === 400 && p.methods.fold.possible;
    if (folds) {
      m = "fold";
      est = p.methods.fold;
    }
    // Refused for want of a model: the way that needs none is named, where it can run.
    const free = est.status === 400 && p.methods.fold.possible ? ` — ${methodName("fold", { keepWhole: p.keepWhole })} makes room with no model call` : "";
    if (!est.possible && !selfCan) return { ok: false, method: m, status: est.status || 409, error: `${m}: ${est.why || "nothing to do"}${free}` };
    /** Refused right before the write, in the words the guard gives. */
    const blocked = () => (signal?.aborted ? "stopped before anything was written" : guard?.() || null);
    const kind = KIND_BY_TRIGGER[trigger] || "manual";
    const a = archive();
    // The method asked by its name, with its number, as the page says it (HarnessV4_Tasks U3, UX-4).
    const asks = methodName(asked, { keepWhole: p.keepWhole });
    const why = folds ? ` (${asks}: no model to write with, and folding calls none)` : "";
    const words = trigger === "line" ? "at the compaction line" : "on request";

    /** Fold, written here: no model is asked. `lwhy` ends the note's clause. @param {any} lest @param {string} lwhy */
    const landFold = async (lest, lwhy) => {
      const stop = blocked();
      if (stop) return { ok: /** @type {const} */ (false), method: /** @type {const} */ ("fold"), status: 409, error: stop };
      const list = work.lists.fold;
      const fromTurn = list[0].n, toTurn = list[list.length - 1].n;
      const { id } = a.compactTurns(chain.id, { turnIds: list.map((/** @type {any} */ t) => t.turnId), shape: "fold", kind, method: "fold", fromTurn, toTurn, window: "harness", detail: { before: p.now, after: lest.after, exact: !!lest.exact, model: null, how: "local" } });
      // A fold brings nothing back after it: the next turn's first message says what is open (the owner's of 11-09).
      stillOpen?.folded?.(chain.id);
      const learning = learns(chain, trigger);
      const note = `compaction: ${spanWords(fromTurn, toTurn)} folded ${words}${lwhy} — ≈${p.now.toLocaleString()} → ≈${lest.after.toLocaleString()} tokens${learningWords(learning)}`;
      ops.record("compaction", `session ${chain.id}: turns ${fromTurn}–${toTurn} folded (fold, ${words})`, { sub: "fold", detail: { chainId: chain.id, fromTurn, toTurn, turns: list.length, before: p.now, after: lest.after, trigger, ...learningDetail(learning) }, ref: { chainId: chain.id } });
      return { ok: /** @type {const} */ (true), method: /** @type {const} */ ("fold"), kind, id, fromTurn, toTurn, chars: 0, before: p.now, after: lest.after, model: null, how: "local", note, learning };
    };
    if (m === "fold") return landFold(est, why);
    // The side model's turns, their tool calls folded, at the instant line or under (the owner's rules of 10-31): the
    // fold itself, and no model is called.
    if (!self && est.reads === "instant")
      return landFold(p.methods.fold, ` (the side model's reading: the turns, their tool calls folded, leave ≈${Number(est.earlier).toLocaleString()} tokens, within the ${p.instantTokens.toLocaleString()} of an instant fold, so no model call)`);

    const list = work.lists.summary;
    const writer = work.writer;
    if (!writer && !self) return { ok: false, method: m, status: 400, error: est.why || "no model to summarize with" };
    const who = self ? `the agent (${self.model})` : `the compaction model (${writer?.model})`;
    // The writer stops with the turn, and where the person lets the summary go (`skip`), with that too.
    const writing = skip && signal ? AbortSignal.any([signal, skip]) : skip || signal;
    /** Fold in the summary's place (D6), where it can make room: at once, and with no model. @param {string} lwhy */
    const foldInstead = async (lwhy) => (p.methods.fold.possible ? landFold(p.methods.fold, lwhy) : null);
    /** The person let the summary go (Send without it): fold where the turn falls back on it, else nothing is
     *  written. */
    const letGo = async () =>
      (fallback && (await foldInstead(" (you sent it on without the summary; folding calls no model)"))) || {
        ok: /** @type {const} */ (false),
        method: m,
        status: 409,
        error: fallback ? `sent on without the summary, and fold has no room to make: ${/** @type {any} */ (p.methods.fold).why || "nothing to fold"}` : "sent on without the summary",
      };
    /** @type {{ text: string, how: string, model: string, calls?: number, folded?: true, usage?: import("../../core/ports.js").AgentSummary["usage"] }} */
    let w;
    // How long the summary took to write: its row says it (HarnessV4_Tasks U3-5, UX-8).
    const began = now();
    try {
      if (self) onStep?.({ message: `${self.model} writes the summary of its own session` });
      w = self
        ? await selfSummary(self, writing)
        : await writeSummary({ chain, list, lead: work.lead, whole: true, writer: /** @type {Writer} */ (writer), window: p.window, signal: writing, folded: work.folded, job, onStep });
    } catch (/** @type {any} */ e) {
      if (signal?.aborted) return { ok: false, method: m, status: 409, error: "stopped before anything was written" };
      if (skip?.aborted) return letGo();
      const failed = `${who} failed: ${String(e.message || e).slice(0, 200)}`;
      log("warn", `sessions: ${chain.id} compaction of turns ${p.fromTurn}–${list[list.length - 1].n} failed: ${e.message}`);
      return (fallback && (await foldInstead(` (${failed}, so folding made the room; it calls no model)`))) || { ok: false, method: m, status: 502, error: failed };
    }
    const head = work.head;
    const fromTurn = head ? Number(head.from_turn) || 1 : p.fromTurn;
    const toTurn = list[list.length - 1].n;
    const landing = !!w.text && !signal?.aborted && !skip?.aborted;
    // Read now, not when it was weighed: the summary took its time, and the files are what the disk holds when it lands.
    // What the folder holds, as its read came in — waited for a little where it is still under way.
    if (landing && reading) await Promise.race([reading, new Promise((r) => setTimeout(r, MORE_WAIT_MS).unref?.())]);
    const back = landing ? work.backAfter(toTurn) : null;
    // What the next request weighs with the summary as it was written — the composition itself, where the plan weighed
    // a stand-in for it (HarnessV4_Tasks U3-5: the row says what happened, not what was guessed before it). Weighed
    // before the guard is asked, so nothing waits between the guard and the write. A measure that fails keeps the
    // plan's figure, said as the estimate it is.
    const weighed = landing
      ? await measure({ turns, compactions: [...compactions, { from_turn: fromTurn, to_turn: toTurn, kind: "pending", text: w.text, attached: back?.text || null }] }).then((x) => Number(x.sent) || null, () => null)
      : null;
    const stop = blocked();
    if (stop) return { ok: false, method: m, status: 409, error: stop };
    // Let go while it wrote: a slice pass ends early with the slices it has, not with an error — the person's word
    // stands over a summary of part of the turns.
    if (skip?.aborted) return letGo();
    if (!w.text) {
      const empty = `${who} returned an empty summary`;
      return (fallback && (await foldInstead(` (${empty}, so folding made the room; it calls no model)`))) || { ok: false, method: m, status: 502, error: empty };
    }
    // A summary that leaves the chat no smaller than it is (HarnessV4_Tasks C30 item 7): a short chat's turns weigh less
    // than a summary of them. Room is what was asked for, so it is not written — a turn that waits on it folds instead,
    // where folding makes room — and the answer says so by its figures; the way's line said it would, before. What the
    // session holds now is its measure: Filament's composition, or what a coding agent's context holds, the room its
    // fresh start from the copy makes.
    if (weighed != null && weighed >= p.now) {
      const bigger = `${who} wrote a summary that leaves the chat no smaller — ≈${weighed.toLocaleString()} tokens with it, ≈${p.now.toLocaleString()} as it is — so nothing was written`;
      return (fallback && (await foldInstead(` (${bigger}; folding calls no model)`))) || { ok: false, method: m, status: 409, error: bigger };
    }
    const after = weighed ?? est.after;
    // What a coding agent holds (`held`) is not Filament's composition: there the figure stays an estimate.
    const exact = weighed != null && !(Number(held) > 0);
    const { id } = a.addCompaction(chain.id, { fromTurn, toTurn, summaryText: w.text, kind, window: "harness", method: m, detail: { before: p.now, after, exact, model: w.model, how: w.how, ...(w.calls ? { calls: w.calls } : {}), ...(w.folded ? { folded: true } : {}), ms: Math.max(0, now() - began) }, attached: back?.text ? back : null });
    // What is still open, as the block after it says it, is what the agent reads from now on.
    stillOpen?.told(chain.id);
    const learning = learns(chain, trigger);
    const how =
      w.how === "fork"
        ? `${w.model}, from its warm cache`
        : w.how === "slices"
          ? `${w.model}, in ${w.calls ?? "several"} slices`
          : w.how === "agent-fork"
            ? `${w.model}, the agent itself, in a fork of its session`
            : w.how === "agent"
              ? `${w.model}, the agent itself, in its session`
              : w.model;
    const read = w.folded ? ", from the turns with their tool calls folded (too big whole for one call)" : "";
    const note = `compaction: ${spanWords(fromTurn, toTurn)} summarized ${words} by ${how}${read}${why}${learningWords(learning)}`;
    // What an agent's summary cost, as it counted it (AC5-4): an op's detail keeps flat figures only.
    const u = w.usage;
    ops.record("compaction", `session ${chain.id}: turns ${fromTurn}–${toTurn} compacted into one summary (${m}, ${words})`, {
      sub: kind,
      detail: {
        chainId: chain.id, fromTurn, toTurn, chars: w.text.length, model: w.model, how: w.how, method: m, trigger, window: p.window,
        ...(u ? { inputTokens: u.input, outputTokens: u.output, cacheReadTokens: u.cacheRead, cacheWriteTokens: u.cacheWrite } : {}),
        ...learningDetail(learning),
      },
      ref: { chainId: chain.id },
    });
    return { ok: true, method: m, kind, id, fromTurn, toTurn, chars: w.text.length, before: p.now, after, model: w.model, how: w.how, note, learning };
  }

  /**
   * The agent compacts its own session (HarnessV3-ACP AC5-5) — on Compact now, a typed `/compact`, or at its line under
   * the way own: `agent` asks it, with what to keep (`words`, `ownInstruction`) and, with `fork`,
   * a fork of the session kept from before, for Undo. Once the agent says it compacted, its row is written — the method
   * own, the trigger's kind, the agent's figures where it named them, and the summary it handed over where it handed
   * one (`facts.summary`, the agent's name `by`): Filament's copy of the chat starts from that summary from then on, as
   * the agent's own context does, so the copy stays the size of what the agent holds. An agent that hands none over
   * (Codex, Cursor) leaves the copy's turns as they were. An undo takes the row away: the copy's turns stand again,
   * for the session a fork kept from before, or a fresh one. Nothing is learned from it, and no guard is asked: the
   * archive keeps every turn, and what the agent did stands. Refused when no
   * turn finished since the agent's last own compaction. A summary handed over keeps the block after it with its row
   * (`blockAfter`, of the turns it stands for), as one handed over in the middle of a turn does (agent-copy.js): what
   * starts from the copy is handed the files, the plan, the task graph and what is still open (the review of cb2d2d1f0).
   * @param {{ chain: any, turns: any[], compactions: any[], model: string, by?: string | null, trigger: "line" | "manual", words?: string, fork: boolean,
   *   blockAfter?: ((toTurn: number) => { text: string } | null) | null,
   *   agent: (o: { keep: string, fork: boolean, record: (facts: import("../../core/ports.js").AgentOwnCompaction) => number, signal: AbortSignal | null,
   *     onEvent: ((ev: any) => void) | null }) => Promise<import("../../core/ports.js").AgentOwnCompaction>,
   *   signal?: AbortSignal | null, onEvent?: ((ev: any) => void) | null }} o
   * @returns {Promise<{ ok: true, method: "own", kind: string, id: number, fromTurn: number, toTurn: number, chars: number, before: number, after: number, model: string, how: "agent-own", forked: boolean, note: string, learning: null }
   *   | { ok: false, method: "own", status: number, error: string }>}
   */
  async function own({ chain, turns, compactions, model, by = null, trigger, words = "", fork, blockAfter = null, agent, signal = null, onEvent = null }) {
    const last = turns.at(-1);
    if (!last) return { ok: false, method: "own", status: 409, error: "nothing to compact: the session has no completed turns" };
    const prior = compactions.filter((c) => c.method === "own").at(-1);
    if (prior && Number(prior.to_turn) >= last.n)
      return { ok: false, method: "own", status: 409, error: `nothing to compact: the agent compacted its own context after turn ${prior.to_turn}, and no turn has finished since` };
    const head = compactionHead(compactions);
    const fromTurn = head ? Number(head.from_turn) || 1 : turns[0].n;
    const toTurn = last.n;
    const keep = ownInstruction(words);
    const kind = KIND_BY_TRIGGER[trigger] || "manual";
    // The skills it has loaded, read before it compacts: a summary it hands over moves the copy's head past them.
    const loaded = skillsLoaded?.(chain.id) ?? [];
    /** The row once written, with what the agent said. */
    const got = { row: /** @type {{ id: number, facts: import("../../core/ports.js").AgentOwnCompaction } | null} */ (null) };
    /** @param {import("../../core/ports.js").AgentOwnCompaction} facts */
    const record = (facts) => {
      // `untold`: the agent takes no instructions for it, and what to keep was not passed on.
      const detail = { ...(facts.tokensBefore ? { before: facts.tokensBefore } : {}), ...(facts.tokensAfter ? { after: facts.tokensAfter } : {}), exact: true, model, ...(by ? { by } : {}), how: "agent-own", ms: facts.ms, ...(facts.forked ? { forked: true } : {}), ...(keep && !facts.instructed ? { untold: true } : {}) };
      const back = facts.summary && blockAfter ? blockAfter(toTurn) : null;
      const { id } = archive().addCompaction(chain.id, { fromTurn, toTurn, summaryText: facts.summary ? String(facts.summary) : null, kind, window: "harness", method: "own", detail, attached: back?.text ? back : null });
      got.row = { id, facts };
      return id;
    };
    try {
      await agent({ keep, fork, record, signal, onEvent });
    } catch (/** @type {any} */ e) {
      // A row written stands: the agent compacted, whatever failed after.
      if (!got.row) {
        if (signal?.aborted) return { ok: false, method: "own", status: 409, error: "stopped before the agent compacted" };
        log("warn", `sessions: ${chain.id} the agent's own compaction failed: ${e.message}`);
        // Its words end a clause of the note's ("…: why, so Filament made room on its copy instead").
        return { ok: false, method: "own", status: 502, error: `the agent's own compaction failed: ${String(e.message || e).trim().replace(/\.$/, "").slice(0, 300)}` };
      }
    }
    // The agent's bridge lists the compaction (`record`) before it answers.
    const { id, facts: f } = /** @type {NonNullable<typeof got.row>} */ (got.row);
    // Its own summary may have left out what is still open, and nothing after it said it: the next turn's first prompt
    // does — and names the skills it had loaded, kept with the chat until then as a compaction in a turn keeps them.
    stillOpen?.untold(chain.id);
    skillsBack.compacted(chain.id, CHATS_AGENT, [...loaded].reverse());
    const when = trigger === "line" ? "at the compaction line" : "on request";
    const figures = f.tokensBefore && f.tokensAfter ? ` — ${f.tokensBefore.toLocaleString()} → ${f.tokensAfter.toLocaleString()} tokens` : f.tokensBefore ? ` — at ${f.tokensBefore.toLocaleString()} tokens` : "";
    const kept = f.forked ? "; a fork keeps the session from before, for Undo" : "";
    const unsaid = keep && !f.instructed ? "; it takes no instructions for it, so what to keep was not passed on" : "";
    const copy = f.summary ? "; Filament's copy of the chat starts from its summary" : "; it handed no summary over, so Filament's copy keeps the turns as they were";
    const note = `compaction: ${spanWords(fromTurn, toTurn)} compacted ${when} by the agent itself (${model}), in its own session${figures}${copy}${kept}${unsaid}`;
    // What the compaction cost, as the agent counted it: an op's detail keeps flat figures only.
    const u = f.usage;
    ops.record("compaction", `session ${chain.id}: turns ${fromTurn}–${toTurn} compacted by the agent itself (own, ${when})`, {
      sub: kind,
      detail: {
        chainId: chain.id, fromTurn, toTurn, model, how: "agent-own", method: "own", trigger, ms: f.ms,
        ...(f.tokensBefore ? { before: f.tokensBefore } : {}), ...(f.tokensAfter ? { after: f.tokensAfter } : {}), ...(f.forked ? { forked: true } : {}),
        ...(u ? { inputTokens: u.input, outputTokens: u.output, cacheReadTokens: u.cacheRead, cacheWriteTokens: u.cacheWrite } : {}),
      },
      ref: { chainId: chain.id },
    });
    return { ok: true, method: "own", kind, id, fromTurn, toTurn, chars: String(f.summary || "").length, before: f.tokensBefore, after: f.tokensAfter, model, how: "agent-own", forked: f.forked, note, learning: null };
  }

  /**
   * What a summary of the copy alone would read, and whether it is worth writing (HarnessV4_Tasks C29). `list`: the
   * copy's finished turns since its head, all but the newest; `lead`: the summary the copy stands on; `read`: what the
   * writer reads, in tokens; `stands`: what those turns weigh in the copy as it is composed (`measure`: the session's
   * own form of them — their words, or all of them under Whole); `out`: how long a summary is guessed to run
   * (`summaryEstimate`). `worth`: the turns weigh more than the summary would. Under that a summary would cost a model
   * call and leave the copy no smaller, so the copy keeps the turns, and is asked again as it grows. Null with no turn
   * to stand for.
   * @param {{ turns: any[], compactions: any[], measure: MeasureFn }} o
   */
  async function copyRead({ turns, compactions, measure }) {
    const { head, inWindow } = copyWindow(turns, compactions);
    const list = inWindow.slice(0, -1);
    if (!list.length) return null;
    const lead = head ? earlierOf(head) : null;
    const read = transcriptTokens(summaryPieces(lead, list, true));
    const taken = new Set(list.map((t) => t.n));
    const stands = (await measure({ turns, compactions })).perTurn.reduce((sum, t) => sum + (taken.has(t.n) ? t.tokens : 0), 0);
    const out = summaryEstimate(read, compactions);
    return { head, list, lead, read, stands, out, worth: stands > out };
  }

  /**
   * Filament's copy of a coding agent's chat moves on by a summary written for the copy alone (HarnessV4_Tasks C29).
   * The agent compacts its own context; where it hands its summary over, the copy starts from that (agent-copy.js).
   * Where it hands none (Codex, Cursor; a session that held less than the chat), the copy would keep every turn while
   * the agent starts over again and again, and outgrow any window. So a model Filament calls — the compaction model,
   * else memory's — writes the copy's summary: the summary the copy stood on, read whole, then the finished turns
   * since as their folds — all but the newest, which stays as it was said. The row moves no agent session
   * (`ofCopyAlone`), is not one to undo, starts no learning run and brings no file back: it is read when a fresh
   * session starts, which may be much later. `why`: the agent compacted its own context (`agent`, `by` its name), or
   * the copy passed the session's line (`line`). `fresh` reads the chat's compactions again right before the write:
   * where the copy starts at or past these turns by then — the person compacted, the agent handed a summary over —
   * nothing is written. `reads` is what the caller weighed (`copyRead`): nothing is written with no turn to stand
   * for, nor where the turns weigh no more than a summary would (`worth`).
   * @param {{ chain: any, doc: any, reads: Awaited<ReturnType<typeof copyRead>>, sessionModel: string, why: "agent" | "line", by?: string | null,
   *   fresh: () => any[], signal?: AbortSignal | null, job?: string | null, onStep?: StepSink | null }} o
   * @returns {Promise<{ ok: true, id: number, kind: string, method: "summary", fromTurn: number, toTurn: number, chars: number, model: string, how: string, note: string }
   *   | { ok: false, status: number, error: string }>}
   */
  async function copy({ chain, doc, reads, sessionModel, why, by = null, fresh, signal = null, job = null, onStep = null }) {
    if (!reads)
      return { ok: false, status: 409, error: "nothing for the copy's summary to stand for: its newest finished turn stays as it was said, and no other has finished since the copy's start" };
    if (!reads.worth) return { ok: false, status: 409, error: `Filament's copy keeps its turns: ${smallWords(reads)}` };
    const { head, list, lead, read } = reads;
    const writers = writerFor({ doc, sessionModel, cache: null, transcriptTokens: read, outTokens: reads.out });
    const writer = writers.chosen;
    if (!writer) return { ok: false, status: 400, error: writers.error || "no model to summarize with" };
    const fromTurn = head ? Number(head.from_turn) || 1 : list[0].n;
    const toTurn = list[list.length - 1].n;
    const began = now();
    /** @type {Awaited<ReturnType<typeof writeSummary>>} */
    let w;
    try {
      w = await writeSummary({ chain, list, lead, whole: false, writer, signal, folded: true, job, onStep });
    } catch (/** @type {any} */ e) {
      if (signal?.aborted) return { ok: false, status: 409, error: "stopped before anything was written" };
      log("warn", `sessions: ${chain.id} the summary of turns ${list[0].n}–${toTurn} for Filament's copy failed: ${e.message}`);
      return { ok: false, status: 502, error: `the compaction model (${writer.model}) failed: ${String(e.message || e).slice(0, 200)}` };
    }
    if (signal?.aborted) return { ok: false, status: 409, error: "stopped before anything was written" };
    if (!w.text) return { ok: false, status: 502, error: `the compaction model (${writer.model}) returned an empty summary` };
    const at = compactionHead(fresh());
    if (at && Number(at.to_turn) >= toTurn) return { ok: false, status: 409, error: `Filament's copy starts after turn ${at.to_turn} by now: nothing was written` };
    // What the summary read and what it wrote, by Filament's count: the copy's own figures, no request's.
    const wrote = estimateTokens(w.text);
    const { id } = archive().addCompaction(chain.id, {
      fromTurn, toTurn, summaryText: w.text, kind: "plain", window: "harness", method: "summary",
      detail: { copy: why, ...(by ? { by } : {}), before: read, after: wrote, exact: false, model: w.model, how: w.how, ...(w.calls ? { calls: w.calls } : {}), ms: Math.max(0, now() - began) },
    });
    const how = w.how === "slices" ? `${w.model}, in ${w.calls ?? "several"} slices` : w.model;
    const cause = why === "agent" ? `${by || "the agent"} compacted its own context and handed no summary over` : "the copy passed the session's compaction line";
    const note = `compaction: ${spanWords(fromTurn, toTurn)} summarized for Filament's copy of the chat alone, by ${how} — ${cause}; the agent's own session goes on as it is, and a fresh one starts from this summary and the turns since`;
    ops.record("compaction", `session ${chain.id}: turns ${fromTurn}–${toTurn} summarized for Filament's copy alone (${why === "agent" ? "the agent compacted its own context" : "the copy passed the line"})`, {
      sub: "copy",
      detail: { chainId: chain.id, fromTurn, toTurn, chars: w.text.length, model: w.model, how: w.how, method: "summary", trigger: why, before: read, after: wrote },
      ref: { chainId: chain.id },
    });
    return { ok: true, id, kind: "plain", method: "summary", fromTurn, toTurn, chars: w.text.length, model: w.model, how: w.how, note };
  }

  /**
   * The compaction just written starts its learning run (HarnessV3-Memory M7-D27): memory's answer, or null when memory
   * has no learner door (a compactor built without one).
   * @param {any} chain @param {string} door
   * @returns {Learning | null}
   */
  function learns(chain, door) {
    return memory?.compacted ? memory.compacted(chain.id, { door }) : null;
  }

  return { plan, run, own, copy, copyRead, writerFor, writeSummary };
}

/**
 * Why no summary is written for the copy yet (`copyRead` without `worth`), in words.
 * @param {{ stands: number, out: number }} reads
 */
export const smallWords = ({ stands, out }) =>
  `the turns it would stand for weigh ≈${stands.toLocaleString()} tokens there, no more than a summary would (≈${out.toLocaleString()}) — Filament writes the copy's summary once they weigh more`;

/** What memory answers when a compaction starts its learning run (HarnessV3-Memory M7-D27). @typedef {{ learning: true, model: string } | { learning: false, why: string }} Learning */

/**
 * What a compaction's note says of its learning run (M7-D27): learning from the turns now, or why not; "" when memory
 * did not answer.
 * @param {Learning | null} l
 */
export function learningWords(l) {
  if (!l) return "";
  return l.learning ? `; learning from them now on ${l.model}` : `; nothing learned from them now: ${l.why}`;
}
/** The compaction op's detail of its learning run (M7-D27): `started`, or why not. @param {Learning | null} l */
export function learningDetail(l) {
  if (!l) return {};
  return { learning: l.learning ? "started" : l.why };
}
