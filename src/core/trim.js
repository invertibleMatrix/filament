// The slice pass's maths, pure: a summary of a conversation too big for one call of its writer, read in sequential
// slices (services/trim.js runs it; the compactor's summary falls to it when even the folded turns outgrow one call —
// the owner's rules of 10-31).
//
// Three properties matter and each has its own mechanism:
//   * It fits the writer's window, however big the conversation is. Slices are sized adaptively: after each call
//     returns, the summary it actually produced is measured, and the next slice gets whatever room is left under
//     `sliceBudgetFraction × window − responseReserve`. The slice count is discovered, never precomputed, so a chatty
//     summarizer shrinks the next slice instead of overflowing.
//   * The carried prefix cannot eat the budget. Carried summaries grow monotonically, so past
//     `digestCapFraction` of the slice budget they are re-compressed into one rolling digest. That single call
//     changes the carried prefix and loses prompt-cache reuse; between re-compressions the prefix is
//     append-only and caches normally.
//   * The cut points are turn boundaries (core/turns.js `turnGroups`/`isToolLeg`), so a summary never ends half a
//     tool loop. A turn bigger than one slice is cut at its steps (`partsOfTurn`), and one step bigger than the
//     whole budget at message boundaries — the slice is rendered TEXT going to the summarizer, not a wire request,
//     so there is no validity constraint, only coherence.
//
// Per-slice summaries are cached by content hash (archive.trimSlice*), so a second compaction or a restart never pays
// twice. The originals stay byte-exact in the archive forever: `@mem load <id> full` retrieves anything a summary
// dropped, and the learner extracts durable items from the same turns.

import { isToolLeg, turnGroups } from "./turns.js";
import { estimateTokens } from "./tokens.js";
import { sha256 as sha } from "./hash.js";
import { clamp } from "./util.js";
import { inBrief, resultsInBrief, textOfMessage } from "./messages.js";
export { turnGroups };

// One regex for "this request is the client asking its model to summarize the conversation", shared by both
// detectors so they cannot drift: memory-brain.js sets `signals.compactionRequest` from it (which is what archives
// the summary afterwards), and the handed stage also calls `isCompactionRequest` below — because the brain's signal
// only exists when memory's prepare pass ran to that point, and a summary cut at the output cap is named on a muted
// chain or an agent route too. The two differ only in how they find the newest human message; see isCompactionRequest.
export const COMPACTION_PROMPT_RE =
  /(create|write|produce|provide) (a |an )?(detailed |concise |comprehensive |thorough )?summary of (the|this|our) conversation|summar(ize|ise) (the|this|our) conversation (so far|above|history)|conversation summary for (continuation|compaction|context)|your task is to (create|write) a (detailed )?summary/i;

// Bumped when the prompts change meaning: a cached slice summary written by an older prompt is not reused.
export const PROMPT_VERSION = 1;

export const TRIM_DEFAULTS = {
  sliceBudgetFraction: 0.7, // carried summaries + the next slice may use this share of the writer's window
  digestCapFraction: 0.3, // past this share of the slice budget, carried summaries are re-compressed
  // Ceiling on ONE slice, in tokens, whatever the summarizer's window would allow; 0 disables it. One summary condenses
  // one slice to about `sliceSummaryTokens`, so a slice's size sets how much detail survives: without it a 1M window's
  // 700k-token slice would come back as one summary of some 1,100 words. (It was first set for an edge proxy that
  // killed a 171,614-token call at ~126 s with a Cloudflare 524; every summary call streams now.)
  maxSliceTokens: 100000,
  sliceSummaryTokens: 1500, // the length each slice summary is asked for, in words in its prompt; never a cap
  // Floor under one slice summary, as a share of the slice's own tokens. Measured: grok-4.6 answered an 88,925-token
  // slice with 51 tokens — three sentences for 86 messages — with HTTP 200 and `end_turn`, so it passed the empty-reply
  // guard and half the conversation left the summary for $0.18. Under the floor the slice is retried at half the size
  // (and the rest of the pass stays there); a summary that cannot be split further is kept but marked. 0 disables.
  minSummaryPercent: 0.5,
  tailMessageCapChars: 24000, // the cap on one rendered message (a 500 KB tool result), said where it bites
};

export const estTokens = estimateTokens;
// The floor under a slice summary: `percent` of the slice it condenses, but never more than a quarter of the length
// asked for (a summary asked for 200 tokens is not held to 500). 0 when the check is off. Compared against the reply's
// estimated tokens, the same estimate the slice itself was measured with, so the ratio is like against like.
export function summaryFloor(sliceTokens, summaryTokens, percent) {
  if (!(Number(percent) > 0)) return 0;
  return Math.max(
    0,
    Math.min(
      Math.ceil(((Number(sliceTokens) || 0) * Number(percent)) / 100),
      Math.floor((Number(summaryTokens) || 0) * 0.25),
    ),
  );
}
// A hollow reply is retried on a smaller slice at most this many times per pass: every retry is a paid call.
const MAX_HOLLOW_RETRIES = 3;
// The slice pass's policy from config: numbers clamped, unknowns dropped.
export function normalizeTrimPolicy(p = {}, defaults = TRIM_DEFAULTS) {
  const d = { ...TRIM_DEFAULTS, ...(defaults || {}) };
  const out = {
    sliceBudgetFraction: clamp(p?.sliceBudgetFraction ?? d.sliceBudgetFraction, 0.2, 0.95) || 0.7,
    digestCapFraction: clamp(p?.digestCapFraction ?? d.digestCapFraction, 0.05, 0.9) || 0.3,
    sliceSummaryTokens: Math.round(clamp(p?.sliceSummaryTokens ?? d.sliceSummaryTokens, 200, 16000)) || 1500,
    // 0 disables the ceiling. `normalizeTrimPolicy` is a whitelist: a key in TRIM_DEFAULTS and the schema but not
    // here is dropped.
    maxSliceTokens: Math.round(clamp(p?.maxSliceTokens ?? d.maxSliceTokens, 0, 10_000_000)) || 0,
    minSummaryPercent: clamp(p?.minSummaryPercent ?? d.minSummaryPercent, 0, 20), // 0 = no floor
    tailMessageCapChars:
      Math.round(clamp(p?.tailMessageCapChars ?? d.tailMessageCapChars, 500, 2_000_000)) || 24000,
  };
  // A carried prefix may not consume the whole slice budget, or no slice ever fits.
  if (out.digestCapFraction >= out.sliceBudgetFraction) out.digestCapFraction = out.sliceBudgetFraction / 2;
  return out;
}

// ---- rendering -----------------------------------------------------------------------------------------
// The summarizer reads text, not wire messages. Tool calls keep their name and a slice of their arguments
// (a decision to call `edit` on `src/server.js` is context; the 4 KB patch body usually is not), images and
// thinking contribute nothing, and a per-message cap stops one giant tool result from eating a whole slice.
function toolCallLines(m, cap = 300) {
  const out = [];
  const push = (name, args) => {
    if (!name) return;
    const a = String(args ?? "")
      .replace(/\s+/g, " ")
      .trim();
    out.push(`⚙ ${String(name).slice(0, 60)}${a ? `(${a.slice(0, cap)}${a.length > cap ? "…" : ""})` : ""}`);
  };
  // A visual's arguments read as its title and what it is, never its code, and an artifact's publish its page as its
  // size (messages.js `inBrief`), in every shape.
  const brief = (name, args) => {
    const b = inBrief(name, args);
    return typeof b === "string" ? b : JSON.stringify(b ?? {});
  };
  if (Array.isArray(m?.content))
    for (const b of m.content)
      if (b?.type === "tool_use" || b?.type === "server_tool_use")
        push(b.name, brief(b.name, b.input));
  for (const c of Array.isArray(m?.tool_calls) ? m.tool_calls : [])
    push(c?.function?.name || c?.name, brief(c?.function?.name || c?.name, c?.function?.arguments ?? c?.arguments ?? ""));
  if (m?.type === "function_call") push(m.name, brief(m.name, m.arguments));
  return out.join("\n");
}
// Attachments are not text, but their PRESENCE is context: a turn where the user pasted a screenshot of an error
// reads differently from one where they described it. One placeholder each, never the bytes.
function mediaLines(m) {
  const out = [];
  const walk = (b) => {
    if (!b || typeof b !== "object") return;
    if (Array.isArray(b)) {
      for (const x of b) walk(x);
      return;
    }
    const t = b.type;
    if (t === "image" || t === "input_image" || t === "image_url") out.push("[image]");
    else if (t === "document" || t === "file") out.push("[document]");
    else if (t === "tool_result" || t === "function_call_output") walk(b.content ?? b.output);
    else if (t === "message" && Array.isArray(b.content)) walk(b.content);
  };
  walk(Array.isArray(m?.content) ? m.content : null);
  return out.join(" ");
}
export function renderMessage(m, { cap = 12000 } = {}) {
  const role =
    m?.role || (m?.type === "function_call_output" || m?.type === "tool_result" ? "user" : "assistant");
  // An artifact given whole reads as what it is and where, never its files (messages.js `resultsInBrief`).
  const text = textOfMessage(resultsInBrief(m)).trim();
  const calls = toolCallLines(m);
  const media = mediaLines(m);
  const body = [text, calls, media].filter(Boolean).join("\n");
  if (!body) return `[${role}]: (no text)`;
  return body.length > cap
    ? `[${role}]: ${body.slice(0, cap)}\n[…${body.length - cap} more characters in Filament's archive…]`
    : `[${role}]: ${body}`;
}
export const renderMessages = (messages, opts = {}) =>
  (Array.isArray(messages) ? messages : []).map((m) => renderMessage(m, opts));

// ---- words in pieces ------------------------------------------------------------------------------------
// The cap on one rendered message is for traffic: a 500 KB tool result is no summarizer's reading. A message of words
// alone can be longer than the cap too — the summary an earlier pass wrote, a turn's fold, a long paste — and every
// word of it is the conversation. Such a message becomes consecutive messages of the same role, cut between lines,
// each within `chars`: a pass reads all of it, and a slice can end inside it.
/** @param {string} text @param {number} max @returns {string[]} */
function piecesOfText(text, max) {
  /** @type {string[]} */
  const out = [];
  let cur = "";
  for (const line of text.split("\n")) {
    // A line longer than a piece is cut where the piece ends.
    for (let at = 0; at === 0 || at < line.length; at += max) {
      const part = line.slice(at, at + max);
      if (cur && cur.length + 1 + part.length > max) {
        out.push(cur);
        cur = part;
      } else cur = cur ? `${cur}\n${part}` : part;
    }
  }
  if (cur) out.push(cur);
  return out;
}
/** A message of words alone: the person's or the model's, with no tool call, result or media in it. @param {any} m */
const isWords = (m) =>
  (m?.role === "user" || m?.role === "assistant") &&
  !m.tool_calls?.length &&
  (typeof m.content === "string" || (Array.isArray(m.content) && m.content.length > 0 && m.content.every((/** @type {any} */ b) => b?.type === "text")));
/** @param {any[]} messages @param {number} chars  the most characters one piece holds @returns {any[]} */
export function wordsInPieces(messages, chars) {
  const max = Math.max(1, Math.floor(chars));
  return (Array.isArray(messages) ? messages : []).flatMap((m) => {
    if (!isWords(m)) return [m];
    const text = textOfMessage(m);
    return text.length <= max ? [m] : piecesOfText(text, max).map((piece) => ({ role: m.role, content: [{ type: "text", text: piece }] }));
  });
}
/** The most characters one piece holds: under the cap on one message, and small enough for the smallest slice a pass
 *  makes. One definition for the slice pass and the compactor's plan of it. @param {{ tailMessageCapChars: number }} P
 *  @param {{ minSlice: number }} room */
export const pieceChars = (P, room) => Math.min(P.tailMessageCapChars, room.minSlice * 2);
// ---- turn structure: core/turns.js (turnGroups, re-exported above) --------------------------------------

// ---- turns in parts -------------------------------------------------------------------------------------
// Inside a turn, every model reply starts a step: the reply (with its tool calls) and the tool results that answer
// it. A cut placed before a step never separates a call from its result, in any wire format.
const isStepStart = (m) => m?.role === "assistant" || m?.type === "function_call";
const stepStarts = (body, from, to) => {
  const out = [];
  for (let i = from + 1; i < to; i++) if (isStepStart(body[i])) out.push(i);
  return out;
};
// One long tool loop is one turn but far too coarse a unit for a pass: a slice takes whole turns, and a 200-call turn
// bigger than one slice would be cut wherever the budget ran out. Cut such a turn at step boundaries into parts of at
// most `maxTokens` rendered tokens, the first part carrying the user's message; downstream, a part is handled exactly
// like a turn.
export function partsOfTurn(body, tokens, group, maxTokens) {
  const starts = stepStarts(body, group.from, group.to);
  if (starts.length < 2) return [group];
  const cuts = [group.from, ...starts.slice(1), group.to]; // segment k = [cuts[k], cuts[k+1]); the first holds the user message and step 1
  const parts = [];
  let from = cuts[0],
    acc = 0;
  for (let k = 0; k + 1 < cuts.length; k++) {
    let t = 0;
    for (let i = cuts[k]; i < cuts[k + 1]; i++) t += tokens[i] || 0;
    if (acc > 0 && acc + t > maxTokens) {
      parts.push({ from, to: cuts[k] });
      from = cuts[k];
      acc = 0;
    }
    acc += t;
  }
  parts.push({ from, to: group.to });
  return parts;
}
// ---- how much one call may carry --------------------------------------------------------------------------
// The prompt AND the reply have to fit the summarizer's window, so the reply's room comes off the slice budget. The
// trap this avoids: with a fixed reply reserve, a small window (a 6k cheap model) leaves no room for any slice at
// all, and the pass quietly summarizes nothing. So the length asked for shrinks first — a shorter summary beats no
// summary — and the minimum slice shrinks with the window, so a pass always makes progress until the window is
// genuinely too small to hold one message. The compactor's plan uses the SAME numbers, so it cannot over-promise.
// `summaryTokens` is the length the prompt asks for (`words`), never a cap: a call asks for the most its model can
// write inside its window (memory's callModel, HarnessV3-FailurePoints §13), and the summary is kept whole. `win` is
// the writer's window as its caller states it — the compactor's assumed one where nobody states it (`ASSUMED_WINDOW`).
export function sliceRoom(win, policy = {}) {
  const P = normalizeTrimPolicy(policy);
  const w = Math.max(0, Number(win) || 0);
  const frac = Math.max(1024, Math.floor(P.sliceBudgetFraction * w));
  const summaryTokens = Math.max(200, Math.min(P.sliceSummaryTokens, Math.floor(frac * 0.5)));
  const reserve = Math.max(512, summaryTokens);
  const ceiling = Math.max(0, Number(P.maxSliceTokens) || 0); // 0 = no ceiling
  const minSlice = Math.min(2048, Math.max(256, Math.floor(frac * 0.25)), ...(ceiling > 0 ? [ceiling] : []));
  // The ceiling is applied HERE, in the one function every caller goes through, rather than in the loop alone. Doing it
  // only in the loop would let a plan promise one slice for a pass that really makes dozens of capped ones. One
  // place, every caller, no twin to forget.
  return {
    window: w,
    frac,
    summaryTokens,
    reserve,
    minSlice,
    ceiling,
    budget: ceiling > 0 ? Math.min(frac - reserve, ceiling) : frac - reserve,
    words: Math.max(120, Math.floor(summaryTokens * 0.75)),
  };
}

// Is this request the client asking its model to summarize the conversation? The newest human message decides:
// a tool-result leg that happens to contain those words is a tool loop, not a person asking to compact.
export function isCompactionRequest(format, body) {
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m?.role !== "user") continue;
    if (isToolLeg(m, format)) return false;
    return COMPACTION_PROMPT_RE.test(textOfMessage(m));
  }
  return false;
}

// ---- prompts --------------------------------------------------------------------------------------------
const trimPrompt = (
  words,
) => `You compress one part of a long conversation between a user and a coding assistant, so the work can continue after that part is dropped from context.
Write a dense factual summary of the EXCERPT, at most ${words} words:
- what the user asked for, in their own terms
- every decision made, with the reason when one was given
- files, paths, functions, commands, model names, numbers, versions and test results that matter
- what was done and what it produced; what failed and why; what was explicitly rejected
- open threads, pending work, and anything said to come next
Short bullet lines of plain text. No preamble, no restating these instructions, no speculation, no praise.
Earlier summaries of the SAME conversation may precede the excerpt: do not repeat them, continue from them and note only what changed.
Never write a secret, API key, token or password; if the excerpt contains one, say "a secret was redacted".`;

const DIGEST_PROMPT = `You merge several consecutive summaries of one conversation into a single rolling digest, so the older parts of a long session can be carried forward in a few hundred words.
Keep: the user's goals, every decision and its reason, the state of each file or component touched, what failed and why, and what remains to be done.
Drop: repetition, narration, anything already superseded by a later summary.
At most 600 words, short bullet lines of plain text, no preamble. Never write a secret, API key or token.`;

const carriedPrefix = (digest, slices) => {
  const parts = [];
  if (digest) parts.push(`ROLLING DIGEST OF THE EARLIER PARTS:\n${digest}`);
  if (slices.length)
    parts.push(
      `SUMMARIES ALREADY WRITTEN, IN ORDER:\n${slices.map((s) => `- part ${s.n}: ${s.text}`).join("\n")}`,
    );
  return parts.length ? `${parts.join("\n\n")}\n\n---\n\n` : "";
};
// The cache key covers what changes the answer: the prompt version, the word cap and the slice's own bytes.
// The carried prefix is deliberately NOT part of it — a slice's summary is a function of the slice, and
// reusing one written with a shorter prefix is the whole point of the cache (a second summary of the same text must not re-pay).
export const sliceKey = (sliceText, words) => sha(`${PROMPT_VERSION}\n${words}\n${sliceText}`);

function percentOf(groups, gi) {
  return groups.length ? Math.min(99, Math.round((100 * gi) / groups.length)) : 0;
}
// One slice: whole turn groups while they fit the budget, always at least one group. A group bigger than the
// whole budget is split at a message boundary: the slice takes its oldest messages that fit, and what is left of the
// group is the next slice's (`rest`), so a single huge tool loop neither stalls the pass nor loses a message to it.
function pickSlice({ groups, rendered, tokens, from, budget }) {
  const g0 = groups[from];
  const gsum = (g) => {
    let n = 0;
    for (let i = g.from; i < g.to; i++) n += tokens[i] || 0;
    return n;
  };
  let next = from,
    acc = 0,
    fromMsg = g0.from,
    toMsg = g0.to,
    rest = null;
  if (gsum(g0) <= budget) {
    for (let i = from; i < groups.length; i++) {
      const t = gsum(groups[i]);
      if (acc + t > budget && i > from) break;
      acc += t;
      next = i + 1;
      toMsg = groups[i].to;
    }
  } else {
    // Oversized single turn (one tool loop bigger than the whole budget): its oldest messages that fit, at least one,
    // never zero progress. The messages after them are the group's `rest`, which the pass reads next, so the whole
    // turn is summarized in order. One message bigger than the budget is clipped below, and the pass counts that.
    next = from + 1;
    let i = g0.from;
    let n = 0;
    for (; i < g0.to; i++) {
      const t = tokens[i] || 0;
      if (n + t > budget && i > g0.from) break;
      n += t;
    }
    toMsg = i;
    acc = n;
    if (toMsg < g0.to) rest = { from: toMsg, to: g0.to };
  }
  let text = rendered.slice(fromMsg, toMsg).join("\n\n");
  // A slice is over its budget only where one message alone is bigger than it: that message is cut to the budget, by
  // the estimate that sized it, and what went is counted. Every other slice goes whole.
  let clippedChars = 0;
  if (acc > budget) {
    const keep = Math.floor((text.length * budget) / acc);
    clippedChars = text.length - keep;
    text = text.slice(0, keep) + `\n[…${clippedChars} more characters of this slice were left out to fit the summarizer's window…]`;
  }
  return { fromMsg, toMsg, next, rest, text, clippedChars, tokens: Math.max(Math.min(acc, budget), estTokens(text)) };
}

/**
 * The slice pass as ONE summary text: the harness compactor's head when the turns it summarizes outgrew one call.
 * The turns it keeps stay real turns beside the summary, so this is the digest and the parts alone, each part saying
 * what it condensed; `missing` names what the pass could not summarize.
 * @param {{ digest: string | null, slices: { n: number, from: number, to: number, text: string, tokens?: number, sourceTokens?: number, hollow?: boolean }[], missing?: string | null }} o
 */
export function joinSlices({ digest, slices, missing = null }) {
  const parts = [];
  if (digest) parts.push(`## Earlier, condensed\n${digest}`);
  for (const s of slices)
    parts.push(
      `## Part ${s.n} — messages ${s.from} to ${s.to}${s.hollow ? " (unusually short for its size — treat this part as incomplete; the originals are in Filament's archive)" : ""}\n${s.text}`,
    );
  if (missing) parts.push(`## Not represented\n${missing}`);
  return parts.join("\n\n");
}

export {
  trimPrompt,
  DIGEST_PROMPT,
  isToolLeg,
  MAX_HOLLOW_RETRIES,
  carriedPrefix,
  percentOf,
  pickSlice,
};
