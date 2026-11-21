// @ts-check
// Compaction's one home (HarnessV3 Step 4 D1): the words a summarizer gets, which model writes a summary, how long a
// summary may take, where the usable window ends, what a turn looks like to a summarizer, and the summary as the head
// of a history. The harness's compaction at turn start, Compact now, a fork's brief, the
// agent loop's fold at the compaction line and /autofit all come here; none of them keeps a copy.
import { filamentBlock, inBrief, textOfMessage, withoutArtifactFiles, withoutAskLine } from "../../core/messages.js";
import { lazyOver } from "../../core/lazy.js";
import { cut as cutWords } from "../../core/text.js";
import { cutWeights, estimateTokens, joinedTokens, textWeight } from "../../core/tokens.js";
import { rawMessages, renderTurn } from "./shapes.js";

/**
 * The longest a compaction summary is guessed to run when its writer is priced (compactor.js `summaryEstimate`). It
 * caps nothing: a writer asks for the most its model can write (HarnessV3-FailurePoints §13).
 */
export const SUMMARY_ESTIMATE_CEILING = 20_000;

/** The compaction model's brief, for every path that summarizes a conversation. */
export const COMPACTION_SYSTEM =
  "You write compaction summaries for a coding assistant's conversation: a later model continues the work from your summary alone, so it must carry every fact, path, decision and open question the conversation established. No preamble, no commentary about summarizing.";

/**
 * What a compaction summary holds and how it is written (HarnessV3-AtHome AH-D9 a): the shape Claude Code's own
 * compaction keeps a long task alive with, in our words. Notes come first, in an `<analysis>` block the writer thinks
 * in and Filament drops (`summaryOfReply`); then the summary, under nine headings. Every summary of a conversation
 * Filament asks a model for carries it: the call over a transcript (`compactionPrompt`), and the forks of a session's
 * warm cache and of an agent turn's rounds (compactor.js). The slice pass (services/trim.js) has its own words.
 */
export const SUMMARY_SHAPE = [
  "First think in an <analysis> block: go through the conversation in order and note, part by part, what the user asked for and meant, what was done and how, the decisions taken, the files, functions and commands involved, the code that mattered, each error and its fix, and anything the user said about how the work should be done. Then check that nothing a later model will need is missing. These notes are yours alone: they are dropped, and only the summary is kept.",
  "Then write the summary in a <summary> block, under these nine numbered headings, in this order:",
  "1. Request and intent: everything the user asked for and what they meant by it, in detail.",
  "2. Key concepts: the technologies, frameworks, conventions and ideas the work rests on.",
  "3. Files and code: each file read, written or changed, why it matters and what changed in it, with the code a later model will need quoted.",
  "4. Errors and fixes: each error met, how it was fixed, and what the user said about it.",
  "5. Problem solving: what was worked out, and what is still being worked out.",
  "6. The user's messages: every message the user wrote, tool results aside, each in a line or two and in order. They show how the request moved. Then every rule, constraint, preference and correction the user gave on how to work, word for word: a later model keeps to them.",
  "7. Pending tasks: what the user asked for that is not done yet.",
  "8. Current work: exactly what was being done just before this point: the files, the code, the last step taken.",
  "9. Next step: the step that follows directly from the current work, if the user's newest request calls for one, with that request quoted word for word so the work does not drift from it. With nothing left to do, say so.",
  'Write plainly. A heading with nothing under it says "None."',
].join("\n");

/**
 * The prompt the compaction model receives over a transcript (HarnessV2 §6.8 step 2): the conversation in its own
 * tags, then the shape, so the instructions come after what they are about.
 * @param {string} transcript
 */
export function compactionPrompt(transcript) {
  return `Summarize the conversation below so that work can continue from your summary alone.\n\n<conversation>\n${transcript}\n</conversation>\n\n${SUMMARY_SHAPE}`;
}

/** The request `summarize` sends over a transcript, as a body to weigh. @param {string} transcript */
export const summaryRequest = (transcript) => ({ system: COMPACTION_SYSTEM, messages: [{ role: "user", content: compactionPrompt(transcript) }] });

/**
 * The summary in a writer's reply (AH-D9 a): the `<summary>` block's text, with the `<analysis>` notes before it
 * dropped. A reply without the tags is the summary as it stands. Notes that never end (the reply ran out of room)
 * leave nothing, so the caller falls back as it does for an empty reply. A block opens only at the start of a line;
 * the notes end at the `</analysis>` the summary follows, and the summary at its last `</summary>`. So a summary that
 * quotes the tags (a session working on this code, say) is neither cut short nor emptied.
 * @param {string | null | undefined} text
 */
export function summaryOfReply(text) {
  let s = String(text || "");
  const notes = s.search(/(?:^|\n)[ \t]*<analysis>/i);
  if (notes >= 0) {
    const rest = s.slice(notes);
    const end = /<\/analysis>\s*(?=<summary>)/i.exec(rest) || /<\/analysis>/i.exec(rest);
    s = `${s.slice(0, notes)}\n${end ? rest.slice(end.index + end[0].length) : ""}`;
  }
  const open = /(?:^|\n)[ \t]*<summary>/i.exec(s);
  if (!open) return s.trim();
  const body = s.slice(open.index + open[0].length);
  const close = body.toLowerCase().lastIndexOf("</summary>");
  return (close >= 0 ? body.slice(0, close) : body).trim();
}

/**
 * What a writer writes for a summary of `tokens`: the summary, and the notes before it, assumed as long as the
 * summary (AH-D9 a; the tour measures it). What a summary costs, and the least room a fork's reply needs, use this.
 * @param {number} tokens
 */
export const writtenTokens = (tokens) => 2 * tokens;

/**
 * Which model writes this session's compaction summaries (D2): the document's `context.compaction.model` when it
 * names one, else the path's own fallback — the session's model for the harness, the loop and
 * /autofit. Every compaction path calls this with the document it runs
 * under, so one setting governs them all and a session that chose nothing keeps each path's default.
 * @template F
 * @param {any} doc  the nested settings document the request runs under (or null)
 * @param {F} fallback
 * @returns {string | F}
 */
export function compactionModelOf(doc, fallback) {
  const named = String(doc?.context?.compaction?.model ?? "").trim();
  return named || fallback;
}

/**
 * Where the usable window ends — the one compaction line the harness's composer, the agent loop and the meter all
 * aim at: the percentage you set of the model's real window (`context.compaction.thresholdPercent`, 85 by default —
 * compact before the edge, not at it). What guarantees the request still fits is not this line but the composer's
 * `max_tokens` clamp (`window − request`), so no hidden reserve is subtracted here. Never below 1,000 tokens.
 * @param {number} window  the model's context window, in tokens
 * @param {{ thresholdPercent?: number } | null | undefined} compaction  the document's `context.compaction` section
 */
export function usableWindow(window, compaction) {
  const pct = linePercentOf(compaction);
  return Math.max(1000, Math.floor(window * (pct / 100)));
}

/**
 * The band a line named in tokens may take, in percent of the window (`lineOf`): the one the page's slider takes. Under
 * the lowest a compaction has next to no room to land beneath the line; past the highest the reply has no room.
 */
export const LINE_MIN = 15;
export const LINE_MAX = 95;

/**
 * The line's percent of the window as every reader takes it: what the document says, 85 where it says none.
 * @param {{ thresholdPercent?: number } | null | undefined} compaction  the document's `context.compaction` section
 */
export function linePercentOf(compaction) {
  return Math.min(100, Math.max(1, Number(compaction?.thresholdPercent) || 85));
}

/**
 * The most a side agent's compaction line reaches, in tokens: where its work stays sharp and a round's cost stays
 * reasonable (the owner's word of 11-02: "the sweet spot i have found ... is 400K").
 */
export const SIDE_LINE_MOST = 400_000;

/**
 * A side agent's compaction line: the default share of its model's window, never past `SIDE_LINE_MOST` — 400,000 on a
 * window of 500,000 or more, 85% of a smaller one, which leaves its compaction room to run. The person sets no line
 * for a side agent; a main chat's line is the one it chose (`usableWindow`).
 * @param {number} window  the side agent's model's context window, in tokens
 */
export function sideLineOf(window) {
  return Math.min(SIDE_LINE_MOST, usableWindow(window, null));
}

/**
 * Ask the compaction model for a summary of a transcript: the brief and the prompt are compaction's own; the call
 * asks for the most the model can write (memory's `callModel`), and no clock ends it (HarnessV3-FailurePoints §4 A). Returns the summary without the writer's notes (`summaryOfReply`; "" when the model said nothing
 * else); a failure throws — each caller decides whether that refuses, falls back or is only logged.
 * @param {{ callModel: (o: any) => Promise<any> }} memory
 * `jobId` names the compaction the call is part of, for its progress (HarnessV3-FailurePoints §5.1 item 3).
 * `maxTokens`: the reply's room as the caller weighed the call (`summaryRequest`), on the scale it weighed the
 * transcript by, so the call and its room are one measure; else memory's own (`callRoom`).
 * @param {{ transcript: string, model?: string | null, chainId?: string | null, signal?: AbortSignal | null, jobId?: string | null, maxTokens?: number | null }} o
 */
export async function summarize(memory, { transcript, model = null, chainId = null, signal = null, jobId = null, maxTokens = null }) {
  const text = await memory.callModel({
    system: COMPACTION_SYSTEM,
    user: compactionPrompt(transcript),
    ...(model ? { model } : {}),
    purpose: "compact",
    chainId,
    ...(signal ? { signal } : {}),
    ...(jobId ? { jobId } : {}),
    ...(Number(maxTokens) > 0 ? { maxTokens: Math.floor(Number(maxTokens)) } : {}),
  });
  return summaryOfReply(text);
}

/**
 * A turn as a summarizer reads it whole — what was asked and what was answered, every word, and each tool call and
 * what it returned. The one transcript builder for the turn-start compaction, Compact now, a fork's brief. Turns too
 * big whole for one call of their writer are read with their tool calls folded (`foldedTranscript`), and only where
 * even that is too big, across slices (compactor.js `writeSummary`): never cut to fit.
 * @param {{ n: number, user: any, work?: any[], final: any }} t
 */
export function turnTranscript(t) {
  const lines = [`## Turn ${t.n}`, `User: ${textOfMessage(withoutAskLine(t.user))}`];
  for (const m of t.work || []) {
    if (m?.role === "assistant" && Array.isArray(m.content))
      for (const b of m.content) {
        if (b?.type === "text" && String(b.text).trim()) lines.push(`Assistant: ${String(b.text)}`);
        if (b?.type === "tool_use") lines.push(`Tool call ${b.name}: ${JSON.stringify(inBrief(b.name, b.input) ?? {})}`);
      }
    if (m?.role === "user" && Array.isArray(m.content))
      for (const b of m.content) if (b?.type === "tool_result") lines.push(`Result: ${withoutArtifactFiles(textOfMessage({ role: "user", content: b.content }))}`);
  }
  if (t.final) lines.push(`Assistant: ${textOfMessage(t.final)}`);
  return lines.join("\n");
}

/**
 * A turn as a summarizer reads it where the reader the summary is for holds the turn's words and not its tool traffic:
 * what was asked, then what the model said with each tool call on one line — the turn's fold (`renderTurn`), all of
 * it. No result is read: the model's own words say what it found, and its calls what it touched.
 * @param {import("./shapes.js").TurnBody} t
 */
export function foldedTranscript(t) {
  const [user, ...said] = renderTurn(t, "fold", {}).messages;
  return [`## Turn ${t.n}`, `User: ${textOfMessage(withoutAskLine(user))}`, ...said.map((m) => `Assistant: ${textOfMessage(m)}`)].join("\n");
}

/**
 * One turn as a summarizer reads it, in one call: folded (`foldedTranscript`) where the summary is for a coding agent's
 * copy of the chat, which holds each turn's words and not its tool output; else with its calls and results.
 * @param {import("./shapes.js").TurnBody} t @param {boolean} [folded]
 */
export const readTurn = (t, folded = false) => (folded ? foldedTranscript(t) : turnTranscript(t));

/**
 * One turn as a slice pass reads it, as messages: its fold where it is read folded, else as archived.
 * @param {import("./shapes.js").TurnBody} t @param {boolean} [folded]
 */
export const readMessages = (t, folded = false) => (folded ? renderTurn(t, "fold", {}).messages : rawMessages(t));

/** What stands between the pieces of a summary's transcript. */
const PIECE_BREAK = "\n\n";

/**
 * The pieces of the transcript a summary is written from: the summary it continues (`lead`, as `earlierSummary` says
 * it), then each turn (`readTurn`).
 * @param {string | null} lead @param {import("./shapes.js").TurnBody[]} list
 * @param {boolean} [folded]  the summary is for a coding agent's copy
 * @returns {string[]}
 */
export const summaryPieces = (lead, list, folded = false) => /** @type {string[]} */ ([lead, ...list.map((t) => readTurn(t, folded))].filter(Boolean));

/** The transcript its pieces make (`summaryPieces`). @param {readonly string[]} pieces */
export const transcriptOf = (pieces) => pieces.join(PIECE_BREAK);

/**
 * What the transcript its pieces make weighs, as `estimateTokens` counts it, the turns an earlier count read not
 * classified again (core/tokens.js `joinedTokens`): a long chat's transcript is tens of megabytes, weighed by every
 * plan and compaction. @param {readonly string[]} pieces
 */
export const transcriptTokens = (pieces) => joinedTokens(pieces, PIECE_BREAK);

/**
 * The transcript a summary is written from (`summaryPieces`, joined).
 * @param {string | null} lead @param {import("./shapes.js").TurnBody[]} list
 * @param {boolean} [folded]  the summary is for a coding agent's copy
 */
export function summaryTranscript(lead, list, folded = false) {
  return transcriptOf(summaryPieces(lead, list, folded));
}

/**
 * A composed conversation as plain text, for a reader the messages were not written for (a sub-agent's view of its
 * session): who said what, each tool call on one line, each result cut to `resultChars`, each of the assistant's
 * words to `saidChars` and each of the words it was told to `toldChars`, thinking left out, and the line that names
 * whom the session's agent may ask (`withoutAskLine`): it speaks to that agent, not to this reader.
 * @param {any[]} messages @param {number} [resultChars] @param {number} [saidChars] @param {number} [toldChars]
 */
export function messagesTranscript(messages, resultChars = 2000, saidChars = Infinity, toldChars = Infinity) {
  return readOut(piecesOf(messages, false), { result: resultChars, said: saidChars, told: toldChars });
}

/**
 * A conversation as the writer of its next summary reads it: `messagesTranscript`'s, cut as it cuts, but an earlier
 * compaction's summary where Filament put one (`earlierSummaryAt`) said for what it is — as the session's compactor says
 * its head and the loop's fold an earlier fold, without the lead's word to the model that continues — and whole: it
 * already is the compressed form of what came before it, and the new summary carries its facts forward.
 * @param {any[]} messages @param {number} [resultChars] @param {number} [saidChars] @param {number} [toldChars]
 */
export function summaryReading(messages, resultChars = 2000, saidChars = Infinity, toldChars = Infinity) {
  return readOut(piecesOf(messages, true), { result: resultChars, said: saidChars, told: toldChars });
}

/**
 * The cut a reading takes after a size refusal, and the least it takes where whole it does not fit: each result to
 * 2,000 characters, each of the agent's words to 2,000 and each it was told to 8,000, as the loop's fold of a turn's
 * rounds cuts them.
 * @type {Readonly<{ result: number, said: number, told: number }>}
 */
export const READING_CUT = Object.freeze({ result: 2000, said: 2000, told: 8000 });

/**
 * The earlier summaries a conversation carries, where Filament put them (`earlierSummaryAt`), as its next summary's
 * writer reads them: what a summary written from it must carry on. @param {any[]} messages
 */
export const earlierSummaries = (messages) => piecesOf(messages, true).filter((p) => p.summary).map((p) => p.text);

/**
 * A conversation's reading (`summaryReading`) that one call of its summary holds: at most `limit` tokens, as
 * `estimateTokens` counts them. Its start — the message that holds its task (`start`: the first, or a fork's own,
 * subagents.js `forkTaskAt`; `isTask` names the task among its words, else its last words that are not Filament's own)
 * — is kept as one: no part of it is left out, and its task is never cut but as a last resort; an earlier summary is
 * never cut or left out. A summary goes on from the newest work, so the newest exchange — from the last message to the
 * agent in someone's words (`piecesOf`) — gives way last. Each way is tried in turn, the first that fits taken:
 * 1. At the line (`grow`): whole; else the older pieces cut, the oldest first, as few as make it fit, each to
 *    `READING_CUT`; else, all of them cut, the older lines left out, the oldest first; else, all of them gone, the
 *    newest exchange's words cut to the longest length that fits — what the agent was told to four times what it said,
 *    as `READING_CUT` holds them: those are the asks the summary must quote, the agent's own words what it condenses;
 *    else the newest exchange cut as `READING_CUT` cuts and its oldest lines left out.
 * 2. After a size refusal: everything cut as `READING_CUT` cuts — a conversation refused for size is not weighed again
 *    near the room, as the estimate that let it go out under its line was wrong about it — then its oldest lines left
 *    out, as few as make it fit.
 * 3. All of them again, in the same order, with the task cut as words told are: a task may be bigger than one call
 *    holds, where it fit the window it was sent in; an earlier summary, written within the window, never is but where
 *    the window shrank. Once the task is cut, the newest exchange still gives way last.
 * Lines left out leave one line where they were saying how many; the start's pieces and the earlier summaries among
 * them follow it in their order. Each piece is weighed once, exactly, and each way is found by halving over those
 * weights; the reading found is built and counted once to confirm it, and found again under the overrun where it does
 * not fit. → `left`: the lines left out; `cuts`: what was cut of the words kept, by whose and to how many characters.
 * Null where nothing fits: the start and the earlier summaries alone are past one call.
 * @param {any[]} messages @param {number} limit
 * @param {{ start?: number, grow?: boolean, isTask?: ((text: string) => boolean) | null }} [o]
 * @returns {{ text: string, left: number, cuts: ReadingCuts } | null}
 */
export function transcriptWithin(messages, limit, { start = 0, grow = false, isTask = null } = {}) {
  const pieces = piecesOf(messages, true, start, isTask);
  const read = weighedPieces(pieces);
  for (let room = limit, tries = 0; tries < 3; tries++) {
    const found = readingIn(read, room, grow);
    if (!found) return null;
    const text = readOut(pieces, found);
    const n = estimateTokens(text);
    if (n <= limit) return { text, left: found.leave, cuts: cutsOf(read, found) };
    room -= n - limit;
  }
  return null;
}

/** Whether words are cut at `cap`: core/text.js `cut`, handed one more, keeps them whole up to that. @param {string} text @param {number} cap */
const isCut = (text, cap) => text.length > cap + 1;

/**
 * What was cut of a reading's words, by whose: the agent's own (`agent`), what it was told (`told`), its task (`task`),
 * each with the characters they kept and how many were cut to them.
 * @typedef {{ of: "agent" | "told" | "task", to: number, count: number }[]} ReadingCuts
 */

/**
 * One way of reading a conversation: the older pieces cut, the oldest first (`older`, how many); the newest exchange's
 * words cut to a length (`newest`, the agent's; Infinity for none); the lines left out, the oldest first (`leave`);
 * whether the task is cut (`task`).
 * @typedef {{ older: number, newest: number, leave: number, task: boolean }} Way
 */

/**
 * The characters a piece keeps under a way, the ellipsis after them (core's `cut` counts it in its length, so it is
 * handed one more); Infinity for all of it. @param {Piece} p @param {Way} way
 */
const capOf = (p, way) => {
  if (p.kind === "result") return READING_CUT.result;
  if (p.kind !== "words") return Infinity;
  const told = p.who !== "Assistant";
  if (p.task) return way.task ? READING_CUT.told : Infinity;
  if (p.newest) return way.newest === Infinity ? Infinity : told ? way.newest * (READING_CUT.told / READING_CUT.said) : way.newest;
  return (p.olderAt ?? Infinity) < way.older ? (told ? READING_CUT.told : READING_CUT.said) : Infinity;
};

/**
 * The pieces' weights, each counted once and exactly (core/tokens.js `textWeight`): a line's whole, and for words cut as
 * `READING_CUT` cuts them; the newest exchange's words, which may be cut to any length, by `cutWeights`, which weighs
 * every cut of them from one pass. A result is said cut as every reading cuts it. With them, how many older pieces may
 * be cut, how many lines may go, and which go first.
 * @param {Piece[]} pieces
 */
function weighedPieces(pieces) {
  let olderCut = 0;
  const weights = pieces.map((p) => {
    /** @type {{ whole: number, std: number, stdCap: number, head: number, length: number, at: ((n: number) => number) | null }} */
    const none = { whole: 0, std: 0, stdCap: 0, head: 0, length: 0, at: null };
    if (p.kind === "gap") return none;
    if (p.kind !== "words") return { ...none, whole: textWeight(p.kind === "result" ? `${p.label}: ${cutWords(p.text, READING_CUT.result + 1)}` : p.text) };
    const head = `${p.who}: `;
    const stdCap = p.who === "Assistant" ? READING_CUT.said : READING_CUT.told;
    if (!p.task && !p.newest) p.olderAt = olderCut++;
    return { whole: textWeight(head + p.text), std: textWeight(head + cutWords(p.text, stdCap + 1)), stdCap, head: head.length, length: p.text.length, at: p.newest && !p.task ? cutWeights(head + p.text) : null };
  });
  const going = pieces.reduce((/** @type {number[]} */ at, p, i) => (mayGo(p) && at.push(i), at), []);
  return { pieces, weights, olderCut, going, olderGoing: going.filter((i) => !pieces[i].newest).length };
}

/**
 * A way's weight, by the pieces' own: each piece under its cap, the lines left out taken away and the line that says
 * so added, rounded up once as the text they make is (core/tokens.js `textWeight`).
 * @param {ReturnType<typeof weighedPieces>} read @param {Way} way
 */
function weightOf(read, way) {
  const gone = new Set(read.going.slice(0, way.leave));
  let n = gone.size ? textWeight(leftOutLine(gone.size)) : 0;
  for (const [i, p] of read.pieces.entries()) {
    if (gone.has(i)) continue;
    const w = read.weights[i];
    const cap = capOf(p, way);
    n += p.kind !== "words" || !isCut(p.text, cap) ? w.whole : cap === w.stdCap || !w.at ? w.std : w.at(w.head + cap);
  }
  return Math.ceil(n);
}

/**
 * The first way that holds `room` tokens, in the order `transcriptWithin` gives way in; null where none does.
 * @param {ReturnType<typeof weighedPieces>} read @param {number} room @param {boolean} grow
 * @returns {Way | null}
 */
function readingIn(read, room, grow) {
  const fits = (/** @type {Way} */ way) => weightOf(read, way) <= room;
  const all = read.olderCut;
  const most = read.going.length;
  const std = READING_CUT.said;
  // The task is cut only where nothing else can give way; once it is, the rest gives way again in the same order, so the
  // newest exchange still goes last.
  for (const task of read.pieces.some((p) => p.task && isCut(p.text, READING_CUT.told)) ? [false, true] : [false]) {
    if (grow) {
      const whole = { older: 0, newest: Infinity, leave: 0, task };
      if (fits(whole)) return whole;
      const cutOld = (/** @type {number} */ k) => ({ older: k, newest: Infinity, leave: 0, task });
      if (all && fits(cutOld(all))) return cutOld(fewest(1, all, (k) => fits(cutOld(k))));
      const leaveOld = (/** @type {number} */ k) => ({ older: all, newest: Infinity, leave: k, task });
      if (read.olderGoing && fits(leaveOld(read.olderGoing))) return leaveOld(fewest(1, read.olderGoing, (k) => fits(leaveOld(k))));
      // The length at which none of the newest exchange's words is cut: the way just tried, which did not fit.
      const cutNew = (/** @type {number} */ c) => ({ older: all, newest: c, leave: read.olderGoing, task });
      const top = read.pieces.reduce((n, p, i) => (p.newest && p.kind === "words" && !p.task ? Math.max(n, Math.ceil((read.weights[i].length - 1) / (p.who === "Assistant" ? 1 : READING_CUT.told / READING_CUT.said))) : n), 0);
      if (top > std && fits(cutNew(std))) return cutNew(longest(std, top, (c) => fits(cutNew(c))));
    }
    // The way the leaving out starts from: past the older lines where the line's own ways have taken them already.
    const from = grow ? read.olderGoing : 0;
    const way = (/** @type {number} */ k) => ({ older: all, newest: std, leave: k, task });
    if (fits(way(from))) return way(from);
    if (most > from && fits(way(most))) return way(fewest(from + 1, most, (k) => fits(way(k))));
  }
  return null;
}

/**
 * The fewest in [lo, hi] for which `ok` holds, where it holds at `hi` and holds on from wherever it first does. From one
 * line left out on, each further one takes a line's weight away and adds at most a digit to the count the note says, so
 * leaving more out never weighs more; with none left out there is no note, which is why none is tried apart.
 * @param {number} lo @param {number} hi @param {(n: number) => boolean} ok
 */
function fewest(lo, hi, ok) {
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ok(mid)) hi = mid;
    else lo = mid + 1;
  }
  return hi;
}

/**
 * The longest in [lo, hi) for which `ok` holds, where it holds at `lo` and not at `hi`: a longer cut never weighs less.
 * @param {number} lo @param {number} hi @param {(n: number) => boolean} ok
 */
function longest(lo, hi, ok) {
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * What a way cut of the words it kept, by whose and to how many characters: the lines it left out are no part of it.
 * @param {ReturnType<typeof weighedPieces>} read @param {Way} way @returns {ReadingCuts}
 */
function cutsOf(read, way) {
  const gone = new Set(read.going.slice(0, way.leave));
  /** @type {Map<string, { of: "agent" | "told" | "task", to: number, count: number }>} */
  const seen = new Map();
  for (const [i, p] of read.pieces.entries()) {
    if (p.kind !== "words" || gone.has(i)) continue;
    const to = capOf(p, way);
    if (!isCut(p.text, to)) continue;
    const of = p.task ? "task" : p.who === "Assistant" ? "agent" : "told";
    const had = seen.get(`${of} ${to}`);
    if (had) had.count++;
    else seen.set(`${of} ${to}`, { of, to, count: 1 });
  }
  return [...seen.values()];
}

/** The line that stands where `n` lines of a reading were left out. @param {number} n */
const leftOutLine = (n) => `[${n} earlier ${n === 1 ? "line of this conversation is" : "lines of this conversation are"} left out here: with them, it did not fit one call of its summarizer]`;

/**
 * One piece of a conversation as a transcript says it: a message's words (`words`, `who` said them), a tool result
 * (`result`, under its `label`), a line said as it is (`line`: a tool call, a picture, an earlier summary), or the empty
 * line where the user speaks after the assistant (`gap`). `start`: it is part of the message that holds the
 * conversation's task; `task`: it is that task; `summary`: an earlier compaction's summary; `newest`: it is part of the
 * newest exchange; `olderAt`: an older piece's words, their place among them.
 * @typedef {{ kind: "words" | "result" | "line" | "gap", text: string, who?: string, label?: string, start?: boolean, task?: boolean, summary?: boolean, newest?: boolean, olderAt?: number }} Piece
 */

/** Whether a piece may be left out of a reading that does not fit: neither its start nor an earlier summary. @param {Piece} p */
const mayGo = (p) => p.kind !== "gap" && !p.start && !p.summary;

/**
 * The pieces as a transcript says them, under `cut` — the caps a `Way` sets, or `READING_CUT`-like caps for every piece
 * alike — the first `leave` that may go (`mayGo`) left out: where they were, one line says how many, and the start's
 * pieces and the earlier summaries among them follow it in their order.
 * @param {Piece[]} pieces @param {Way | { result: number, said: number, told: number }} cut @param {number} [leave]
 */
function readOut(pieces, cut, leave = "leave" in cut ? cut.leave : 0) {
  /** @param {Piece} p */
  const capFor = (p) => ("older" in cut ? capOf(p, cut) : p.kind === "result" ? cut.result : p.who === "Assistant" ? cut.said : cut.told);
  /** @param {Piece} p */
  const said = (p) => (p.kind === "words" ? `${p.who}: ${cutWords(p.text, capFor(p) + 1)}` : p.kind === "result" ? `${p.label}: ${cutWords(p.text, capFor(p) + 1)}` : p.text);
  if (!(leave > 0)) return pieces.map(said).join("\n");
  let first = -1;
  let last = -1;
  let n = 0;
  for (let i = 0; i < pieces.length && n < leave; i++)
    if (mayGo(pieces[i])) {
      if (first < 0) first = i;
      last = i;
      n++;
    }
  if (first < 0) return pieces.map(said).join("\n");
  const kept = pieces.slice(first, last + 1).filter((p) => p.kind !== "gap" && !mayGo(p));
  return [...pieces.slice(0, first).map(said), leftOutLine(n), ...kept.map(said), ...pieces.slice(last + 1).map(said)].join("\n");
}

/**
 * An earlier compaction's summary where Filament puts one in a conversation, as its next summary's writer reads it.
 * The session's compactor knows its head by the compaction row, never by words; a conversation that keeps no row has
 * the places Filament puts a summary, each in its own words: its first message, where a give-way leaves its start
 * (`summaryHead`) and where a session's composed history starts — taken only where it opens with exactly the line
 * `summaryLead` writes for the span it names (`summaryLeadOf`), or `leadOf` for a coding agent's own summary
 * (`ownLeadOf`), and said as the compactor says its head (`earlierSummary`, `earlierOwnSummary`); and the message after
 * the model's line a fold of a turn's rounds leaves (`roundsHead`, `ROUNDS_LINE`), which the loop knows its own fold by
 * (`roundsSummaryOf`), said as the loop's fold says one (`earlierRounds`). The same words anywhere else are a message's
 * like any other. Null where none is.
 * @param {any[]} messages @param {number} i  the message's place @param {string} text  its first words, trimmed
 * @returns {string | null}
 */
function earlierSummaryAt(messages, i, text) {
  if (i === 0) {
    const head = summaryLeadOf(text);
    if (head) return earlierSummary(head.fromTurn, head.toTurn, head.text);
    const own = ownLeadOf(text);
    return own ? earlierOwnSummary(own.who, own.standsFor, own.text) : null;
  }
  const line = messages[i - 1];
  const afterFold = line?.role === "assistant" && Array.isArray(line.content) && line.content.length === 1 && line.content[0]?.type === "text" && line.content[0].text === ROUNDS_LINE;
  const rounds = afterFold ? roundsSummaryOf(text) : null;
  return rounds === null ? null : earlierRounds(rounds);
}

/**
 * The pieces of `messagesTranscript`: each block's own (a word's lines are one), and an empty one where the user speaks
 * after the assistant. Read for a summary (`reading`), an earlier summary where Filament put one is said for what it is
 * (`earlierSummaryAt`) and marked `summary`: no cut reaches it; a result is read without the blank its end may carry, so
 * the lines join as they weigh apart. The message at `start` is marked as the conversation's start, its task the last
 * of its words `isTask` names, else its last words that are not one of Filament's own blocks (core/messages.js
 * `filamentBlock`), else its last words — where it opens with an earlier summary, that summary holds the task. The
 * pieces from the newest message to the agent in someone's words on — not only Filament's own blocks, not an earlier
 * summary: a note of a reply cut at its ceiling rides a message of its own within the work — are marked `newest`: its
 * newest exchange. Words that open with one of Filament's heads and go on to someone's are read as Filament's here, and
 * the newest exchange starts earlier for them: more of the conversation is kept as its newest, never less.
 * @param {any[]} messages @param {boolean} reading @param {number} [start] @param {((text: string) => boolean) | null} [isTask]
 * @returns {Piece[]}
 */
function piecesOf(messages, reading, start = -1, isTask = null) {
  /** @type {Piece[]} */
  const pieces = [];
  let prev = "";
  /** A message's words, each with its place in it. @param {any} m @returns {{ text: string, j: number }[]} */
  const wordsOf = (m) => (typeof m?.content === "string" ? [{ text: m.content, j: 0 }] : Array.isArray(m?.content) ? m.content.map((/** @type {any} */ b, /** @type {number} */ j) => ({ text: b?.type === "text" ? String(b.text ?? "") : "", j })) : []).filter((w) => w.text.trim());
  /** Whether a message is someone's words to the agent. @param {any} m @param {number} i */
  const asks = (m, i) => m?.role === "user" && wordsOf(m).some((w) => !filamentBlock(w.text) && !(w.j === 0 && earlierSummaryAt(messages, i, w.text.trim()) !== null));
  /** Whether a message holds words to the agent at all. @param {any} m */
  const says = (m) => m?.role === "user" && wordsOf(m).length > 0;
  /** The newest message `ok` takes, from the end. @param {(m: any, i: number) => boolean} ok */
  const newestWhere = (ok) => {
    for (let i = messages.length - 1; i >= 0; i--) if (ok(messages[i], i)) return i;
    return -1;
  };
  const newestAt = Math.max(0, reading ? (newestWhere(asks) >= 0 ? newestWhere(asks) : newestWhere(says)) : 0);
  for (const [i, sent] of messages.entries()) {
    const who = sent?.role === "assistant" ? "Assistant" : "User";
    const m = who === "User" ? withoutAskLine(sent) : sent;
    const blocks = Array.isArray(m?.content) ? m.content : [{ type: "text", text: String(m?.content ?? "") }];
    const own = { ...(i === start ? { start: true } : {}), ...(reading && i >= newestAt ? { newest: true } : {}) };
    const from = pieces.length;
    for (const [j, b] of blocks.entries()) {
      if (b?.type === "text" && String(b.text ?? "").trim()) {
        if (who === "User" && prev === "Assistant") pieces.push({ kind: "gap", text: "" });
        const t = String(b.text).trim();
        const earlier = reading && who === "User" && j === 0 ? earlierSummaryAt(messages, i, t) : null;
        if (earlier !== null) pieces.push({ kind: "line", text: earlier, summary: true, ...own });
        else pieces.push({ kind: "words", who, text: t, ...own });
        prev = who;
      } else if (b?.type === "tool_use") {
        pieces.push({ kind: "line", text: `Tool call ${b.name}: ${JSON.stringify(inBrief(b.name, b.input) ?? {}).slice(0, 300)}`, ...own });
        prev = "Assistant";
      } else if (b?.type === "tool_result") {
        const t = withoutArtifactFiles(textOfMessage({ role: "user", content: b.content }));
        pieces.push({ kind: "result", label: `Result${b.is_error ? " (error)" : ""}`, text: reading ? t.trimEnd() : t, ...own });
      } else if (b?.type === "image") pieces.push({ kind: "line", text: `${who}: [an image]`, ...own });
    }
    if (i !== start) continue;
    const mine = pieces.slice(from).filter((p) => p.kind !== "gap");
    const words = mine.filter((p) => p.kind === "words");
    const task = (isTask ? words.filter((p) => isTask(p.text)) : []).at(-1) || words.filter((p) => !filamentBlock(p.text)).at(-1) || words.at(-1);
    if (task && !mine[0]?.summary) task.task = true;
  }
  return pieces;
}

/**
 * A span in words: (4, 4) → "turn 4", (1, 3) → "turns 1–3"; `noun` names what is counted.
 * @param {number} from @param {number} to @param {string} [noun]
 */
export const spanWords = (from, to, noun = "turn") => (Number(from) === Number(to) ? `${noun} ${from}` : `${noun}s ${from}–${to}`);

/**
 * The compaction summary's text as the model reads it at the head of a history it continues from, for a range of
 * turns (HarnessV3-AtHome AH-D9 c): Filament compacted those turns into it, and the model carries on from it without
 * recapping it.
 * @param {number} fromTurn @param {number} toTurn @param {string | null | undefined} text
 */
export function summaryLead(fromTurn, toTurn, text) {
  return `[Filament compacted ${spanWords(fromTurn, toTurn)} into the summary below. Carry on from it where the conversation stands, without recapping it.]\n${String(text || "").trim()}`;
}

/**
 * A `summaryLead` read back: the span it names and the summary after it, where the text's first line is exactly the
 * line `summaryLead` writes for that span. Null for any other text, one that only opens with its words among them.
 * @param {string | null | undefined} text
 * @returns {{ fromTurn: number, toTurn: number, text: string } | null}
 */
export function summaryLeadOf(text) {
  const s = String(text ?? "");
  const span = /^\[Filament compacted turns? (\d+)(?:–(\d+))? /.exec(s);
  const end = s.indexOf("\n");
  if (!span || end < 0) return null;
  const fromTurn = Number(span[1]);
  const toTurn = Number(span[2] ?? span[1]);
  return s.slice(0, end + 1) === summaryLead(fromTurn, toTurn, "") ? { fromTurn, toTurn, text: s.slice(end + 1) } : null;
}

/**
 * The turn a coding agent compacted its own context in the middle of, where Filament's copy follows that compaction
 * (`detail.during`); null for every other row. The agent's summary stands for the turns before that one (the row's
 * span, none where it is the session's first) and for that turn's work up to the compaction: the last tool call before
 * it is `detail.cutAfter`, none where it fell before any. Such a row describes the agent's session and moves none, so
 * the chat's sessions do not follow it as they follow Filament's compactions, and it is not one to undo.
 * @param {{ detail?: any, [k: string]: any } | null | undefined} c
 * @returns {number | null}
 */
export const madeDuring = (c) => {
  const n = c?.detail?.during;
  return Number.isInteger(n) && n > 0 ? Number(n) : null;
};

/**
 * Who wrote a compaction's summary where a coding agent did, compacting its own context (`method: "own"`): the name
 * the row kept. Null for a summary Filament had written, and for an agent's compaction that handed none over.
 * @param {{ method?: string | null, text?: string | null, detail?: any } | null | undefined} c
 * @returns {string | null}
 */
export const ownWriter = (c) => (c?.method === "own" && c.text != null ? String(c.detail?.by || "The agent") : null);

/**
 * Whether a compaction is of Filament's copy alone (HarnessV4_Tasks C28, C29): it changed where the copy of a coding
 * agent's chat starts and moved no agent session. Two are: the agent's own compaction in the middle of a turn, which
 * the copy follows (`madeDuring`), and the summary Filament writes for the copy where the agent compacted and handed
 * none over, or the copy passed the session's line (`detail.copy`: "agent" or "line"; compactor.js `copy`). The chat's
 * sessions do not follow such a row as they follow Filament's compactions, and what the agent holds is not judged by it.
 * @param {{ detail?: any, [k: string]: any } | null | undefined} c
 */
export const ofCopyAlone = (c) => madeDuring(c) != null || !!c?.detail?.copy;

/**
 * The newest turn a compaction of Filament's copy alone stands for whole or in part, which a session must have seen to
 * hold all the summary stands for: the turn an agent compacted its own context in the middle of (`madeDuring`), else
 * the last turn the summary Filament wrote for the copy stands for.
 * @param {{ to_turn?: any, detail?: any }} c
 */
const reaches = (c) => madeDuring(c) ?? (Number(c.to_turn) || 0);

/**
 * What the chat's agent sessions stand on (HarnessV3-ACP AC5-1, HarnessV4_Tasks A8): `base`, the newest of Filament's
 * compactions, 0 before any, which every session follows; and `rows`, by agent (`""` for one that answered no turn),
 * the newer one an agent's session stands on where a compaction of Filament's copy alone moved it. Such a row moves the
 * agents that had not seen all it stands for as it was written — their newest turn begun by then was before the newest
 * it reaches (`reaches`): a session of theirs holds less than its summary stands for, and starts fresh from the copy
 * rather than be handed the summary on top of what it holds. The agent that compacted, and one that took a turn of the
 * chat while the copy's summary was written, saw all of it, and their sessions go on. Only rows that say otherwise than
 * `base` are kept (adapters/agents/compactions.js `standsOn` reads them).
 * @param {readonly { id?: any, created_at?: any, [k: string]: any }[]} compactions
 * @param {readonly { n: number, startedAt?: any, meta?: any }[]} turns
 * @returns {{ base: number, rows: Map<string, number> }}
 */
export function compactionBases(compactions, turns) {
  let base = 0;
  /** @type {any[]} */
  const alone = [];
  for (const c of compactions) {
    const id = Number(c?.id) || 0;
    if (!id) continue;
    if (ofCopyAlone(c)) alone.push(c);
    else base = Math.max(base, id);
  }
  /** @param {any} t @returns {string | null} */
  const upOf = (t) => t.meta?.facts?.upstream ?? t.meta?.cut?.held?.upstream ?? null;
  const ups = [...new Set(turns.map(upOf).filter((u) => u != null).map(String))];
  /** Each agent's rows: the newest that moved it, from `base` on. @type {Map<string, number>} */
  const on = new Map([["", base], ...ups.map((u) => /** @type {[string, number]} */ ([u, base]))]);
  // The rows as they were written, beside the turns as they began: each agent's newest turn begun by then.
  const begun = [...turns].sort((a, b) => (Number(a.startedAt) || 0) - (Number(b.startedAt) || 0));
  /** @type {Map<string, number>} */
  const newest = new Map();
  let i = 0;
  for (const c of [...alone].sort((a, b) => (Number(a.created_at) || 0) - (Number(b.created_at) || 0))) {
    for (; i < begun.length && (Number(begun[i].startedAt) || 0) < (Number(c.created_at) || 0); i++) {
      const up = upOf(begun[i]);
      if (up != null) newest.set(String(up), Math.max(newest.get(String(up)) || 0, Number(begun[i].n) || 0));
    }
    for (const [up, at] of on) if ((up ? newest.get(up) || 0 : 0) < reaches(c)) on.set(up, Math.max(at, Number(c.id)));
  }
  const any = on.get("") ?? base;
  /** @type {Map<string, number>} */
  const rows = new Map();
  if (any !== base) rows.set("", any);
  for (const up of ups) if (on.get(up) !== any) rows.set(up, on.get(up) ?? base);
  return { base, rows };
}

/**
 * Whether the chat's agent sessions went on while Filament's copy took this head: a coding agent's own summary, or the
 * one Filament wrote for the copy alone. A session that goes on under such a head is told its place in the copy (the
 * `SEEN_HEADER` of adapters/agents/compactions.js).
 * @param {{ method?: string | null, text?: string | null, detail?: any } | null | undefined} head
 */
export const sessionsWentOn = (head) => !!ownWriter(head) || !!head?.detail?.copy;

/**
 * What a compaction's summary stands for, in words: its turns, and for one made in the middle of a turn that turn's
 * work up to it.
 * @param {{ from_turn?: any, to_turn?: any, detail?: any }} c
 */
export function standsFor(c) {
  const from = Number(c.from_turn) || 1, to = Number(c.to_turn) || 0;
  const during = madeDuring(c);
  if (during == null) return spanWords(from, to);
  const part = `the work of turn ${during} up to then`;
  return to >= from ? `${spanWords(from, to)} and ${part}` : part;
}

/**
 * The head's text as the model reads it (`summaryLead`), by who wrote the summary: Filament, or a coding agent as it
 * compacted its own context, which Filament's copy of the chat starts from.
 * @param {{ from_turn?: any, to_turn?: any, text?: string | null, method?: string | null, detail?: any }} head
 */
export function leadOf(head) {
  const who = ownWriter(head);
  if (!who) return summaryLead(Number(head.from_turn) || 1, Number(head.to_turn), head.text);
  const during = madeDuring(head);
  return `[${who} compacted its own context${during == null ? "" : ` during turn ${during}`}: its summary below stands for ${standsFor(head)}. Carry on from it where the conversation stands, without recapping it.]\n${String(head.text || "").trim()}`;
}

/**
 * A coding agent's head as `leadOf` writes it, read back: who wrote the summary, what it stands for, and the summary,
 * where the text's first line is exactly the line `leadOf` writes for them. Null for any other text.
 * @param {string | null | undefined} text
 * @returns {{ who: string, standsFor: string, text: string } | null}
 */
export function ownLeadOf(text) {
  const s = String(text ?? "");
  const end = s.indexOf("\n");
  const line = /^\[(.+) compacted its own context(?: during turn \d+)?: its summary below stands for (.+)\. Carry on from it where the conversation stands, without recapping it\.\]$/.exec(end < 0 ? "" : s.slice(0, end));
  return line ? { who: line[1], standsFor: line[2], text: s.slice(end + 1) } : null;
}

/** The same for a range of one turn's rounds: the agent loop's fold, at the compaction line or on the developer's Compact. */
export function roundsLead(fromRound, toRound, text) {
  return `[Filament compacted ${spanWords(fromRound, toRound, "round")} of this turn into the summary below. Carry on from it where the work stands, without recapping it.]\n${text}`;
}

/**
 * The summary a `roundsLead` carries, without its lead line: how the loop knows its own earlier fold in the turn's
 * work. Null for any other text.
 * @param {string | null | undefined} text
 */
export function roundsSummaryOf(text) {
  const s = String(text ?? "");
  return /^\[Filament compacted rounds? \d/.test(s) ? s.slice(s.indexOf("\n") + 1) : null;
}

/**
 * An earlier fold's summary (`roundsSummaryOf`) as the transcript a new summary is written from says it: for what it
 * is, without its lead's word to the model that continues. @param {string} text
 */
export const earlierRounds = (text) => `Summary of earlier rounds:\n${text}`;

/**
 * An earlier summary as the head of a transcript a new summary is written from: said for what it is, without the
 * lead's word to the model that continues (`summaryLead`), so the writer carries its facts into the new summary.
 * @param {number} fromTurn @param {number} toTurn @param {string | null | undefined} text
 */
export const earlierSummary = (fromTurn, toTurn, text) => `[The summary an earlier compaction wrote of ${spanWords(fromTurn, toTurn)}]\n${String(text || "").trim()}`;

/**
 * The same of a head, by who wrote it (`leadOf`): a coding agent's own summary is said for whose it is.
 * @param {{ from_turn?: any, to_turn?: any, text?: string | null, method?: string | null, detail?: any }} head
 */
export function earlierOf(head) {
  const who = ownWriter(head);
  if (!who) return earlierSummary(Number(head.from_turn) || 1, Number(head.to_turn), head.text);
  return earlierOwnSummary(who, standsFor(head), head.text);
}

/**
 * A coding agent's own summary as the head of a transcript a new summary is written from: said for whose it is and what
 * it stands for, without the lead's word to the model that continues (`leadOf`).
 * @param {string} who @param {string} stands @param {string | null | undefined} text
 */
export const earlierOwnSummary = (who, stands, text) => `[The summary ${who} wrote as it compacted its own context: it stands for ${stands}]\n${String(text || "").trim()}`;

export const SUMMARY_ACK = "Understood — I continue from that summary.";

/** The model's line a fold leaves in place of the rounds it takes (`roundsHead`), ahead of their summary. */
export const ROUNDS_LINE = "Working on it.";

/**
 * The summary a history starts from: the compaction with text that covers the most of the front (its `to_turn` the
 * highest), the newest of two that cover the same — the turns up to it are gone from the window, the summary stands
 * for them. A row with no text (its message gone, or a fold compaction that reshaped turns instead) stands for
 * nothing; one a coding agent made in the session's first turn stands for no whole turn, and for that turn's start
 * (`madeDuring`). A row with no id is one being weighed, the newest there is. Null when no row does. The rows are
 * ranked before any text is asked for, and the first in rank that has one is the head: where a row's text is opened
 * on first read (service.js `compactionsOf`), no summary behind the head is opened to find it.
 * @template {{ id?: any, to_turn?: any, text?: string | null, detail?: any }} C
 * @param {readonly C[]} compactions
 * @returns {C | null}
 */
export function compactionHead(compactions) {
  const age = (/** @type {C} */ c) => (c.id == null ? Infinity : Number(c.id) || 0);
  return (
    [...(compactions || [])]
      .filter((c) => c && (Number(c.to_turn) > 0 || madeDuring(c) != null))
      .sort((a, b) => Number(b.to_turn) - Number(a.to_turn) || (age(b) > age(a) ? 1 : age(b) < age(a) ? -1 : 0))
      .find((c) => c.text != null) || null
  );
}

/** The words that stand in a turn where a coding agent compacted its own context. @param {string | null | undefined} by */
export const ownCompactionMark = (by) => `[${by || "The agent"} compacted its own context at this point of the turn: the work before it is in the summary above.]`;

/**
 * A turn from where its agent compacted its own context on (`madeDuring`): the person's message, the model's line and
 * the mark in place of the work the summary stands for (as a fold of the loop's opens a turn's work, `roundsHead`),
 * then the work after it. The work starts after the results of the last call before the compaction
 * (`detail.cutAfter`), from the top where none came before; the person's words that reached the agent with those
 * results stay, with the mark. A turn whose work no longer holds that call comes whole: nothing is cut on a guess.
 * A turn as the archive lists it opens its work from those results on alone (archive.js `workFrom`), the place kept:
 * the work the summary stands for is not opened at each composition (the owner's of 11-17: a long chat's views opened
 * 3,616 messages of one turn to keep 146). The copy leaves what the turn has not opened unopened (`lazyOver`).
 * @template {{ work?: any[] }} T
 * @param {T} t @param {{ detail?: any }} head
 * @returns {T}
 */
export function afterOwnCompaction(t, head) {
  const call = head.detail?.cutAfter == null ? null : String(head.detail.cutAfter);
  const answers = (/** @type {any} */ m) => m?.role === "user" && Array.isArray(m.content) && m.content.some((/** @type {any} */ b) => b?.type === "tool_result" && String(b.tool_use_id) === call);
  /** @type {any} */
  const listed = t;
  const from = call != null && typeof listed.workFrom === "function" ? /** @type {any[] | null} */ (listed.workFrom(`answers:${call}`, answers)) : undefined;
  if (from === null) return t;
  const work = from ?? (Array.isArray(t.work) ? t.work : []);
  const at = from ? 0 : call == null ? -1 : work.findIndex(answers);
  if (call != null && at < 0) return t;
  const said = at < 0 ? [] : work[at].content.filter((/** @type {any} */ b) => b?.type === "text");
  const rest = work.slice(at + 1);
  // The person's words taken before any call are a message of their own: they ride with the mark, so the messages alternate.
  const first = rest[0];
  const words = first?.role === "user" && Array.isArray(first.content) && first.content.every((/** @type {any} */ b) => b?.type === "text") ? first.content : null;
  return /** @type {T} */ (
    lazyOver(t, {
      work: [
        { role: "assistant", content: [{ type: "text", text: ROUNDS_LINE }] },
        { role: "user", content: [{ type: "text", text: ownCompactionMark(head.detail?.by) }, ...said, ...(words || [])] },
        ...(words ? rest.slice(1) : rest),
      ],
    })
  );
}

/**
 * The turns as Filament's copy of a history holds them: the one a coding agent compacted its own context in the middle
 * of, where the copy starts from that compaction's summary (the head's `madeDuring`), from the compaction on
 * (`afterOwnCompaction`); every other as it is. Cut as archived, ahead of the turn adapter (core/turn-adapter.js),
 * which may fold a turn into text that has no call left to cut at.
 * @template {{ n: number, work?: any[] }} T
 * @param {readonly T[]} turns @param {readonly { id?: any, to_turn?: any, text?: string | null, detail?: any }[]} compactions
 * @returns {T[]}
 */
export function copyTurns(turns, compactions) {
  const head = compactionHead(compactions);
  const during = head ? madeDuring(head) : null;
  return turns.map((t) => (head && Number(t.n) === during ? afterOwnCompaction(t, head) : t));
}

/**
 * Where Filament's copy of a history starts: its head (`compactionHead`) and the turns after what the head stands for.
 * What the composer sends and what a compaction weighs and summarizes are this, of the copy's turns (`copyTurns`).
 * @template {{ n: number }} T
 * @template {{ id?: any, to_turn?: any, text?: string | null, detail?: any }} C
 * @param {readonly T[]} turns @param {readonly C[]} compactions
 * @returns {{ head: C | null, fromN: number, inWindow: T[] }}
 */
export function copyWindow(turns, compactions) {
  const head = compactionHead(compactions);
  const fromN = head ? Number(head.to_turn) + 1 : 1;
  return { head, fromN, inWindow: turns.filter((t) => t.n >= fromN) };
}

/**
 * The summary as the head of a history: its own user message and a one-line acknowledgment, so alternation holds
 * and the real user messages stay byte-clean. (Prepending it to a user message would archive the summary text into
 * that turn — the pipeline stores the newest user message as sent — and double it on the next request.) What came
 * back after the summary (`attached`, reattach.js) rides in the same message, as its second block.
 * @param {string} text @param {string | null} [attached]
 */
export function summaryHead(text, attached = null) {
  return [
    { role: "user", content: [{ type: "text", text }, ...(attached ? [{ type: "text", text: attached }] : [])] },
    { role: "assistant", content: [{ type: "text", text: SUMMARY_ACK }] },
  ];
}

/**
 * The agent loop's fold as the head of a turn's work: the model's line (`ROUNDS_LINE`), then the summary as its own
 * user message, what came back after it (`attached`) as its second block. It takes the place of the rounds it folds,
 * a reply first and results last, so the messages alternate as they did: from the person's message, or the results a
 * resumed turn's work follows, to the rounds kept. The archive keeps such a turn as one it can send again
 * (`trajectoryProblem`; the bug report's L6).
 * @param {string} text @param {string | null} [attached]
 */
export function roundsHead(text, attached = null) {
  return [
    { role: "assistant", content: [{ type: "text", text: ROUNDS_LINE }] },
    { role: "user", content: [{ type: "text", text }, ...(attached ? [{ type: "text", text: attached }] : [])] },
  ];
}
