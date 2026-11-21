// @ts-check
// The composer (HarnessV2 §9): archived turns + the session's settings + the new user message → the request body the
// pipeline receives, and a report of what each turn became. Pure over its inputs, and it never calls a model: when
// the request reaches the compaction line it says so (`overLine`) and the compactor (compactor.js) makes room by the
// session's method — then the caller composes again. Every finished turn goes whole, as it was sent, but where a
// compaction folded it; a fresh agent session's start, a sub-agent's folded view and a lead's record of a team's chat
// name a form of their own (`form`: shapes.js `shapeAt`).
//
// Determinism: the same turns, compactions and settings hash give identical bytes, so the provider's cached prefix
// holds from one turn to the next (D8).
import { createBlockWeights, DEFAULT_OUTPUT_TOKENS, estimateBodyTokens, replyHeadroom, THINKING_MIN } from "../../core/tokens.js";
import { renderTurn, callsOf, shapePlan, statusResults, pointerResults, lineResults, dedupeResults, rawMessages, compactedShapeOf, answeredPause, withoutNote, VIEW_VERSION } from "./shapes.js";
import { ADAPTER_VERSION } from "../../core/turn-adapter.js";
import { usableWindow, leadOf, summaryHead, copyWindow, madeDuring } from "./compaction.js";
import { withLettersRecall, withRecall } from "./reattach.js";

export const DEFAULT_WINDOW = 200000;

/**
 * @typedef {{ n: number, turnId: number, shape: string, compacted: boolean, tokens: number, stubs: number, fallback?: string, adapted?: "translated" | "folded" }} TurnReport
 * @typedef {{ form: string, results: string, version: number, turns: TurnReport[], historyTokens: number,
 *   sentTokens: number, fixedTokens: number, earlierTokens: number, totalTurns: number, underSummary: number, foldedTurns: number, rawTurns: number,
 *   stubs: number, deduped: number, pointers: number, thinkingStripped: number, adapterVersion: number,
 *   factor: number | null,
 *   head: { fromTurn: number, toTurn: number, kind: string } | null,
 *   overLine: boolean, needsCompaction: boolean, thinking: number | null,
 *   window: number, usable: number, notes: string[] }} ComposeReport
 * @typedef {{ body: any, report: ComposeReport, places: number[] }} Composition
 *   `places`: the turn each of the body's messages ahead of the new one is from, in their order.
 */

/**
 * What Filament's copy of a chat is to a coding agent that holds the conversation itself, after what the copy weighs
 * (HarnessV4_Tasks C20).
 */
export const COPY_WORDS =
  "While the agent goes on in its own session it holds the conversation itself, and this copy is not sent; a fresh agent session, or a switch to another model, starts from it — Compact now makes room on it";

/**
 * Messages with each block of what came back after a fold (reattach.js) as this reader is told it: its letters' lines
 * say filament_recall where it has the tool (`recall`). A message nothing changes in stays the same object, so what its
 * blocks weigh is not weighed again.
 * @param {any[]} msgs @param {boolean} recall
 */
const lettersSaid = (msgs, recall) =>
  msgs.map((m) => {
    if (m?.role !== "user" || !Array.isArray(m.content)) return m;
    let changed = false;
    const content = m.content.map((/** @type {any} */ b) => {
      if (b?.type !== "text" || typeof b.text !== "string") return b;
      const text = withLettersRecall(b.text, recall);
      if (text === b.text) return b;
      changed = true;
      return { ...b, text };
    });
    return changed ? { ...m, content } : m;
  });

/**
 * `turns`: the completed turns, oldest first. `compactions`: summaries already written (text decrypted; null when
 * gone, or a fold row that carries none), each with what came back after it (`attached`, decrypted; reattach.js).
 * `settings`: the effective document (resolveSettings().effective). `form`: how the finished turns go, plain (Whole)
 * unless a caller names another (shapes.js `shapeAt`); `results` the result policy with it, else the document's.
 * `newUser`: the new user message. `window`: the destination's context window in tokens. `fixed`: what rides
 * beside the body on the way out — the agent loop's system prompt and tools (HarnessV3-Launch LD-D6) — weighed with
 * it against the compaction line and the window; `sentTokens` stays the body's own measure. `agentHolds`: a coding
 * agent answers and holds the conversation in its own session, so the composition is Filament's copy of the chat —
 * what a fresh agent session or a switch to another model starts from, and nothing this turn sends: the window stage
 * says so in the copy's words, and notes no clamp of a request that is the agent's own (HarnessV4_Tasks C20). `asks`:
 * the turn asks before it makes room (`context.compaction.mode` ask, for a message a person sends: HarnessV4_Tasks
 * C26), so a request past the line stops here (`needsCompaction`) where another is compacted by its caller.
 * `media`: what a request's pictures, PDFs and files weigh on the wire (pdfs.js `mediaWeights`): one past its room,
 * and a PDF that goes as its text, as the words that go instead, the PDFs' pages read before (`readPdfs`) — from
 * outside, as the factor is. `weights`: the keeper of what the turns' blocks weigh (`createBlockWeights`), the
 * sessions service's, which knows a block of the archive's by its name across compositions; none, one for this
 * composition.
 * @param {{
 *   turns: import("./shapes.js").TurnBody[],
 *   compactions?: { id?: number, from_turn: number, to_turn: number, kind: string, method?: string | null, text: string | null, attached?: string | null, detail?: any }[],
 *   settings: any,
 *   form?: string | null, results?: string | null, recall?: boolean,
 *   newUser: any,
 *   model: string, maxTokens?: number, stream?: boolean, system?: any, tools?: any[],
 *   window?: number | null,
 *   factor?: number | null,
 *   media?: ((messages: any[]) => (block: any) => string | null) | null,
 *   fixed?: number,
 *   agentHolds?: boolean,
 *   asks?: boolean,
 *   weights?: import("../../core/tokens.js").BlockWeights | null,
 * }} args
 * @returns {Promise<Composition>}
 */
export async function compose(args) {
  // Composing awaits nothing else, and the widgets' preview composes the whole history about a dozen times in a row:
  // the event loop is let in before each composition, so a request that arrived meanwhile — a turn's stream, the
  // dashboard's poll — is answered between them instead of after all of them (HarnessV3-Responsiveness R2).
  await new Promise((r) => setImmediate(r));
  const { turns, compactions = [], settings, newUser, model, stream = true, system = null, tools = null } = args;
  // The calibration factor for the destination upstream+model, when the caller knows one: an input like any other,
  // so the determinism contract (same inputs → identical bytes) holds — a drifting factor can reshape old turns and
  // break the provider's cached prefix, which is exactly why it arrives from outside instead of being read here.
  const factor = Number(args.factor) > 0 ? Number(args.factor) : null;
  const fixed = Number(args.fixed) > 0 ? Math.round(Number(args.fixed)) : 0;
  // What each block weighs (`createBlockWeights`), the caller's keeper or this composition's own: a block weighed once
  // is not stringified and hashed again. No block changes in place here — a result rewritten is a new block, weighed
  // anew.
  const weights = args.weights || createBlockWeights();
  const media = args.media || null;
  /** @param {any} b @param {"conversation" | "request"} [scope] */
  const estBody = (b, scope) => estimateBodyTokens(b, scope || "conversation", factor, { weights, media: media ? media(b.messages) : null });
  const ctx = settings?.context || {};
  const form = String(args.form || "plain");
  const results = String(args.results || ctx.results || "keep");
  const window = Number(args.window) > 0 ? Number(args.window) : DEFAULT_WINDOW;
  const comp = ctx.compaction || {};
  // The one compaction line: your percentage of the real window (compaction.js). The reply's room is not subtracted
  // here — the max_tokens clamp below guarantees the fit — so the percentage set is the percentage got.
  const usable = usableWindow(window, comp);
  /** @type {string[]} */
  const notes = [];

  // The reply's room and the thinking budget (§5.1): thinking rides the body when set; it must leave room under
  // max_tokens, so a budget that does not gets clamped and the clamp is said. The caller resolves the session's
  // cap or the model's stated maximum output; this floor is what remains when nobody knows better.
  let maxTokens = Number(args.maxTokens) > 0 ? Number(args.maxTokens) : DEFAULT_OUTPUT_TOKENS;
  let thinking = Number(settings?.model?.thinking?.budget) > 0 ? Math.floor(Number(settings.model.thinking.budget)) : null;
  if (thinking != null && thinking < THINKING_MIN) {
    notes.push(`thinking: the budget ${thinking} is below the provider's floor of ${THINKING_MIN}; thinking stays off`);
    thinking = null;
  }
  // The provider wants THINKING_MIN ≤ budget_tokens < max_tokens: a budget at or over max_tokens is clamped to leave
  // the floor's worth of room for the answer, never below the floor itself; when max_tokens cannot hold the floor
  // plus one token, thinking stays off.
  if (thinking != null && thinking >= maxTokens) {
    const was = thinking;
    if (maxTokens <= THINKING_MIN) {
      thinking = null;
      notes.push(`thinking: max_tokens ${maxTokens} leaves no room for a thinking budget (at least ${THINKING_MIN}, under max_tokens); thinking stays off`);
    } else {
      thinking = Math.max(THINKING_MIN, maxTokens - THINKING_MIN);
      notes.push(`thinking: the budget ${was} does not leave room under max_tokens ${maxTokens}; clamped to ${thinking}`);
    }
  }

  // The head: the newest compaction that still covers the front of the history; turns up to its `to_turn` are gone
  // from the window (the summary stands for them, as the first user message and its acknowledgment), the archive
  // keeps every one of them. Where a coding agent compacted its own context in the middle of a turn, that turn
  // comes from there on: cut by whoever read the turns (`copyTurns`).
  const { head, inWindow } = copyWindow(turns, compactions);

  // What a compaction marked (a fold compaction, a fork's folded inheritance): a floor under every form.
  const compacted = inWindow.map((t) => compactedShapeOf(t));
  const plan = shapePlan(inWindow.length, form, compacted);
  // A reader with no filament_recall (a coding agent that takes no MCP tools): a count says to re-run a tool instead.
  const view = { ...(ctx.view || {}), keepThinking: settings?.model?.thinking?.keepInHistory === true, calls: callsOf(form), ...(args.recall === false ? { recall: false } : {}) };

  // A pause and its answer (HarnessV3-Views V6-11): the turn that paused ends with Filament's note, and the turn that
  // answered it opens with the developer's answer. Neither reaches the model: sent raw, the two turns join into the
  // trajectory it ran (`assemble`) — the same bytes its resumed requests sent, so the provider's cache holds across
  // the pause; shaped otherwise, the asking turn leaves its note out.
  const asked = inWindow.map((t, i) => answeredPause(t, inWindow[i + 1]));
  /** One turn rendered under a kind, with the per-turn result policy applied to raw. @param {number} i @param {string} kind */
  const renderOne = (i, kind) => {
    const t = inWindow[i];
    let r = renderTurn(asked[i] && kind !== "raw" ? withoutNote(t) : t, kind, view);
    // A raw asking turn whose trajectory cannot go raw folds as any other shape does: without the note.
    if (asked[i] && kind === "raw" && r.kind !== "raw") r = { ...renderTurn(withoutNote(t), "fold", view), ...(r.fallback ? { fallback: r.fallback } : {}) };
    let msgs = r.messages;
    if (r.kind === "raw" && results === "status") msgs = statusResults(msgs).messages;
    if (r.kind === "raw" && results === "pointer") msgs = pointerResults(msgs).messages;
    // One line: each result its line and, where the line leaves something out, its recall id, on a turn whose lines
    // save LINE_MIN_TOKENS or more.
    let ids = 0;
    if (r.kind === "raw" && results === "line") ({ messages: msgs, ids } = lineResults(msgs, { recall: args.recall !== false }));
    // A fold of the loop's in the turn's work keeps its letters' lines without the recall words: said to a reader that
    // has filament_recall (reattach.js `withLettersRecall`; the owner's of 11-09, D6).
    msgs = lettersSaid(msgs, args.recall !== false);
    return { ...r, messages: msgs, tokens: estBody({ messages: msgs }), ids };
  };
  const rendered = inWindow.map((_, i) => renderOne(i, plan[i]));

  const historyTokens = estBody({ messages: inWindow.flatMap(rawMessages) });
  const lead = head ? leadOf(head) : null;
  // The summary's pair, what came back after it as this reader is told it: the turns the summary stands for come back
  // through filament_recall, said only where it has the tool (reattach.js `withRecall`; the owner's of 11-09, D6).
  const from = Number(head?.from_turn) || 1;
  const stands = head && Number(head.to_turn) >= from ? { from, to: Number(head.to_turn) } : null;
  const headMsgs = lead ? summaryHead(lead, withRecall(head?.attached, args.recall === false ? null : stands) || null) : [];
  /** @param {any[]} msgs */
  const bodyOf = (msgs) => {
    const list = [...headMsgs, ...msgs, newUser];
    return {
      model, max_tokens: maxTokens, stream, ...(system ? { system } : {}), messages: list, ...(tools?.length ? { tools } : {}),
      ...(thinking != null ? { thinking: { type: "enabled", budget_tokens: thinking } } : {}),
    };
  };
  /** The whole history from the rendered turns, with the cross-turn policies applied. */
  let deduped = 0;
  /** The turn each of the history's messages is from, as it was last assembled. @type {number[]} */
  let turnOf = [];
  const assemble = () => {
    /** @type {any[]} */
    const history = [];
    turnOf = [];
    rendered.forEach((r, i) => {
      // The join (V6-11): an asking turn sent raw ends without its note when its answer goes raw too, and that answer
      // opens without the developer's message — the reply that asked follows the asking turn's own work.
      const from = i > 0 && asked[i - 1] && r.kind === "raw" && rendered[i - 1].kind === "raw" ? 1 : 0;
      const to = asked[i] && r.kind === "raw" && rendered[i + 1]?.kind === "raw" ? r.messages.length - 1 : r.messages.length;
      for (const m of r.messages.slice(from, to)) {
        history.push(m);
        turnOf.push(inWindow[i].n);
      }
    });
    if (results === "dedupe-to-tail") {
      const d = dedupeResults(history, (mi) => turnOf[mi]);
      deduped = d.changed;
      return d.messages;
    }
    return history;
  };
  const history = assemble();
  const body = bodyOf(history);
  const sent = estBody(body);

  /** @type {TurnReport[]} */
  const perTurn = inWindow.map((t, i) => {
    const r = rendered[i];
    return {
      n: t.n, turnId: t.turnId, shape: r.kind, compacted: !!compacted[i], tokens: r.tokens, stubs: r.stubs,
      ...(r.fallback ? { fallback: r.fallback } : {}),
      ...(t.meta?.adapted ? { adapted: t.meta.adapted } : {}),
    };
  });
  // Another window's turns that folded because their tools have no equivalent here (D7): one line, every turn named.
  {
    const folded = inWindow.filter((t) => t.meta?.adapted === "folded");
    if (folded.length) {
      const why = [...new Set(folded.map((t) => String(t.meta.adaptedWhy || "").replace(/^tool calls with no equivalent here \((.*)\)$/, "$1")).filter(Boolean))].join("; ");
      notes.push(`context: turn${folded.length === 1 ? "" : "s"} ${folded.map((t) => t.n).join(", ")} folded — ${folded.length === 1 ? "its tool has" : "their tools have"} no equivalent here${why ? ` (${why})` : ""}`);
    }
  }
  // A fallback fold is the archive's fault: said.
  inWindow.forEach((t, i) => {
    const r = rendered[i];
    if (r.fallback && plan[i] === "raw") notes.push(`turn ${t.n} folded instead of raw: its archived trajectory is not a valid conversation (${r.fallback})`);
  });
  const thinkingStripped = rendered.reduce((n, r) => n + (r.stripped || 0), 0);
  const pointers = results === "line" ? rendered.reduce((n, r) => n + r.ids, 0) : results === "pointer" ? rendered.filter((r) => r.kind === "raw").reduce((n, r) => n + r.messages.reduce((k, m) => k + (m.role === "user" && Array.isArray(m.content) ? m.content.filter((b) => b?.type === "tool_result").length : 0), 0), 0) : 0;
  if (deduped) notes.push(`dedupe-to-tail: ${deduped} older result${deduped === 1 ? "" : "s"} of repeated calls point at the newest`);

  let needsCompaction = false;

  // The window stage (§6.8): at the compaction line — your percentage of the
  // model's window — the request is over the line, and the compactor makes room by the session's method before the
  // caller composes again; a turn that asks first (`asks`) stops here instead, and its caller asks the person.
  // The request is the body and what rides beside it (`fixed`, LD-D6): the line guards what the provider receives.
  const whole = sent + fixed;
  const weighs = fixed ? `the request weighs ${whole.toLocaleString()} (its prompt and tools ≈${fixed.toLocaleString()})` : `the history weighs ${sent.toLocaleString()}`;
  const overLine = whole >= usable && inWindow.length > 0;
  const agentHolds = args.agentHolds === true;
  /** A note of the window stage about the request as it goes out: none for a copy that is not sent. @param {string} n */
  const sentNote = (n) => void (agentHolds || notes.push(n));
  if (overLine && args.asks === true) {
    needsCompaction = true;
    sentNote(`${weighs} of the ${window.toLocaleString()}-token window, past the ${usable.toLocaleString()}-token compaction line: this session asks before it makes room (context.compaction.mode)`);
  }
  // The fit guarantee (Step 6): the line is a plain percentage now, so the reply's room is guaranteed by clamping
  // max_tokens to what remains of the window — the floor is the least a reply may ask for. Below the floor nothing
  // fits, and the turn stops in words (needsCompaction) rather than sending a request the provider must refuse.
  // The clamp holds a headroom back: `sent` measures the body as composed, but the lane appends furniture after
  // the compose (memory's briefing — budgeted at 1,200 tokens — its blocks and tools), and the estimate itself
  // drifts a little against the provider's count; an exact-fit clamp would spend the turn's one refusal on that.
  const headroom = replyHeadroom(window);
  const room = window - whole;
  if (agentHolds && (needsCompaction || room < THINKING_MIN))
    notes.push(`Filament's copy of the chat weighs ≈${whole.toLocaleString()} of the agent's ${window.toLocaleString()}-token window, ${room < THINKING_MIN ? `leaving under the ${THINKING_MIN.toLocaleString()}-token reply floor` : `past the ${usable.toLocaleString()}-token compaction line`}. ${COPY_WORDS}`);
  if (room < THINKING_MIN) {
    needsCompaction = true;
    sentNote(`the request leaves ${Math.max(0, room).toLocaleString()} tokens of the ${window.toLocaleString()}-token window — not even the ${THINKING_MIN.toLocaleString()}-token reply floor fits; compact before the next turn`);
  } else if (maxTokens > room - headroom) {
    const was = maxTokens;
    maxTokens = Math.max(THINKING_MIN, Math.min(maxTokens, room - headroom));
    body.max_tokens = maxTokens;
    sentNote(`max_tokens ${was.toLocaleString()} clamped to ${maxTokens.toLocaleString()} — the request is ${whole.toLocaleString()} of the ${window.toLocaleString()}-token window, ${headroom.toLocaleString()} held for what rides after the compose (memory's briefing, blocks and tools) and the estimate's own drift`);
    // The thinking budget must stay under the clamped max_tokens too, by the rule above.
    if (thinking != null && thinking >= maxTokens) {
      if (maxTokens <= THINKING_MIN) {
        thinking = null;
        delete body.thinking;
        sentNote(`thinking: the clamped max_tokens ${maxTokens.toLocaleString()} leaves no room for a thinking budget; thinking stays off`);
      } else {
        thinking = Math.max(THINKING_MIN, maxTokens - THINKING_MIN);
        body.thinking = { type: "enabled", budget_tokens: thinking };
        sentNote(`thinking: clamped to ${thinking.toLocaleString()} under the clamped max_tokens`);
      }
    }
  }
  if (thinkingStripped) notes.push(`${thinkingStripped} thinking block${thinkingStripped === 1 ? "" : "s"} of earlier turns left out (model.thinking.keepInHistory is off)`);

  const count = (k) => perTurn.filter((p) => p.shape === k).length;
  const report = {
    form, results, version: VIEW_VERSION, adapterVersion: ADAPTER_VERSION, turns: perTurn, historyTokens, sentTokens: sent, fixedTokens: fixed,
    // History-scoped and history-comparable: sentTokens measures the whole outgoing body (summary head, the new
    // user message, system, tools), so diffing it against historyTokens understates the fold by the draft and
    // clamps to zero whenever the fold saved less than the draft weighed. This one is the shaped history alone.
    shapedTokens: estBody({ messages: history }),
    // The earlier turns as they go — the summary before them and the shaped history, never the system prompt, the tools
    // or the new message: what an instant fold is held to (`context.compaction.instantTokens`).
    earlierTokens: estBody({ messages: [...headMsgs, ...history] }),
    totalTurns: turns.length, underSummary: turns.length - inWindow.length,
    foldedTurns: count("fold"), rawTurns: count("raw"),
    stubs: perTurn.reduce((n, p) => n + p.stubs, 0), deduped, pointers, thinkingStripped,
    // The calibration factor these numbers carry (null = the plain heuristic): the meter can say which scale it is
    // showing instead of mixing one with the other unlabeled.
    factor: factor ?? null,
    head: head ? { fromTurn: Number(head.from_turn) || 1, toTurn: Number(head.to_turn), kind: String(head.kind), ...(madeDuring(head) == null ? {} : { during: madeDuring(head) }) } : null,
    overLine, needsCompaction, thinking,
    window, usable, notes,
  };
  // The turn each message ahead of the new one is from: the head's (the turn its summary reaches into, or ends with),
  // a turn of the window's.
  const headTurn = head ? (madeDuring(head) ?? Number(head.to_turn)) : 0;
  const places = [...(lead ? [headTurn, headTurn] : []), ...turnOf];
  return { body, report, places };
}
