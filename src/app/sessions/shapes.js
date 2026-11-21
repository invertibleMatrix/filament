// @ts-check
// Context shapes (HarnessV2 §6): how one completed turn reaches the model. Two shapes — `raw` (the trajectory byte
// for byte) and `fold` (the user's text, one stub line per tool call, the model's text — core/fold.js) — and the
// result policies on turns sent raw: `keep`, `status` (each result its ten-word line), `clear`,
// `dedupe-to-tail` (the same call's older results point at the newest) and `pointer` (every result a
// pointer). A pointer is `r:<hash8>` (a result), which `filament_recall` resolves, as it brings a turn back by its
// number (§6.4).
//
// The shapes go one way (SHAPE_RANK): a compaction folds a turn, and no form sends it raw again.
import { foldGroup, resultSummary, stubKey, VIEW_VERSION } from "../../core/fold.js";
import { shortHash } from "../../core/hash.js";
import { lazyOver } from "../../core/lazy.js";
import { estimateTokens } from "../../core/tokens.js";
import { callsMade } from "../../core/messages.js";
import { kindOfName, pathsWritten } from "../../core/tool-vocab.js";
import { SHAPE_RANK } from "../../services/session-settings.js";

export { VIEW_VERSION };
export const SHAPES = Object.freeze(["raw", "fold"]);
/** Only these tools' results are cleared by the loop's overflow recovery. */
export const COMPACTABLE_TOOLS = Object.freeze(["read", "bash", "powershell", "grep", "glob", "web_fetch", "web_search", "edit", "write", "apply_patch"]);
export const CLEARED_TEXT = "[Old tool result content cleared]";

/**
 * @typedef {{ turnId: number, n: number, startedAt?: number, user: any, work: any[], final: any, meta: Record<string, any>, summary?: string | null,
 *   finished?: boolean, tallied?: { user: any, work: any[], final: any }, talliedBare?: { user: any, work: any[], final: any }, model?: string | null }} TurnBody
 *   `tallied`: a turn the turn adapter folded into text (core/turn-adapter.js), as the same fold with its tool calls
 *   counted in one line — what a fold that counts calls renders of it, the text having no call left to count.
 *   `talliedBare`: the same count without the recall it names, for a reader that has no filament_recall.
 *   `finished`: the archive's word that the turn has its final answer (`turnBodies`), which opens no message to say
 *   so; a body made any other way says it by its `final`.
 */

/** The archived messages of a completed turn in order. @param {TurnBody} t */
export function rawMessages(t) {
  return [t.user, ...(t.work || []), t.final].filter(Boolean);
}

/** What a turn cut off before its reply answers with (`modelTurnsOf`): words alone, valid in every wire format. */
export const CUT_OFF_LINE =
  "(turn cut off before its reply: it never finished, and no reply was recorded. What it did before that, such as file edits or commands, may already be on disk.)";

/**
 * Whether a turn was cut off before its reply (the filament-agent plan's 2b-C D8): it has none, and a request ran it
 * when this Filament started (`bootAt`) — its `meta.running` mark, set before then and never cleared by the request's
 * close. A restart or a crash ended it, so none can come. A turn whose request had already failed or stopped is not
 * (HarnessV3-FailurePoints finding 3).
 * @param {TurnBody} t @param {number} bootAt
 */
export const cutOffBefore = (t, bootAt) => !t.final && Number(t.meta?.running) < bootAt;

/**
 * What a turn that failed after doing work answers with (`modelTurnsOf`, HarnessV3-FailurePoints §6 item 1): what it
 * had said, then why it failed — words alone, valid in every wire format.
 * @param {{ cause: string, text?: string }} failed  the turn's `meta.failed`
 */
export const failedLine = (failed) => `${failed.text ? `${failed.text}\n\n` : ""}[this turn failed: ${failed.cause}]`;

/**
 * Whether the model's provider refused a turn: its newest request ended with the stop reason `refusal` (a safety
 * filter's verdict, Claude's `refusal`, OpenAI's `content_filter`), as the turn's facts keep it.
 * @param {TurnBody} t
 */
export const refusedTurn = (t) => t.meta?.facts?.stopReason === "refusal";

/** What a refused turn's message is in the history (`modelTurnsOf`): Filament's words, never the person's. */
export const REFUSED_USER = "(Filament: this turn's message is left out: the model's provider refused the turn.)";
/** How many files a refused turn's line names before it counts the rest. */
const REFUSED_FILES = 12;

/**
 * What a refused turn that did work answers with (`modelTurnsOf`): that it is left out, and what it did that is on
 * disk — the files its write and edit calls named and the commands it ran, as Filament archived the calls, else how
 * many calls it made. Words alone, valid in every wire format; none of the turn's own.
 * @param {any[]} work  the turn's work
 */
export function refusedLine(work) {
  const files = pathsWritten(work);
  const named = files.slice(0, REFUSED_FILES);
  const more = files.length - named.length;
  const list = more ? `${named.join(", ")} and ${more} more` : named.length > 1 ? `${named.slice(0, -1).join(", ")} and ${named.at(-1)}` : named[0];
  const calls = callsMade(work);
  const ran = calls.filter((c) => kindOfName(c.name) === "shell").length;
  const commands = ran ? ` and ran ${ran} command${ran === 1 ? "" : "s"}` : "";
  const one = files.length === 1;
  const did = files.length
    ? `Before it was refused it wrote to ${list}${commands}: ${one ? "that file" : "those files"} may hold its unfinished changes, so check ${one ? "it" : "them"} (git status, git diff) before you redo any of it.`
    : calls.length
      ? `Before it was refused it made ${calls.length} tool call${calls.length === 1 ? "" : "s"}, and what ${calls.length === 1 ? "that" : "they"} did may already be on disk.`
      : "It made no tool call before it was refused.";
  return `[The model's provider refused this turn, so Filament leaves it out of the history. ${did}]`;
}

/**
 * The turns a model sees, from the archive's rows: each finished turn, each one that failed after doing work
 * (`meta.failed`), and each one cut off before its reply (`cutOffBefore`). What a failed or cut-off turn did is real,
 * and a model that never hears of it repeats or contradicts it: it rides with the work the archive holds of it,
 * Filament's line as its reply (`failedLine`, `CUT_OFF_LINE`), `meta.cutOff` saying a cut. A cut-off turn's work is what
 * the next start rebuilt from its run log (app/sessions/cut-turns.js), which folds (`trajectoryProblem`). A call left
 * with no result makes an invalid trajectory, which folds, as any does. A failed turn that did nothing drops out: its
 * Retry sends it again. Not Filament's own answers (`meta.command`), nor a rewound turn. A finished turn is known by
 * its row (`finished`): its messages stay unopened until something renders them.
 *
 * A turn the model's provider refused (`refusedTurn`) is left out: sent again, its words — the person's, a message
 * taken into it, its work, its summary — are refused again, and every message after with them. One that did work
 * stands as Filament's line on what it wrote (`refusedLine`, `meta.refused`), so the agent neither repeats nor
 * contradicts it; one that did none drops out. Pure.
 * @param {TurnBody[]} bodies @param {number} bootAt
 * @returns {TurnBody[]}
 */
export function modelTurnsOf(bodies, bootAt) {
  // Each copy leaves what its turn has not opened unopened (`lazyOver`): a turn's messages are opened where they are read.
  return bodies.flatMap((t) =>
    t.meta?.command || t.meta?.rewound
      ? []
      : refusedTurn(t)
        ? t.work?.length
          ? [lazyOver(t, { user: { role: "user", content: REFUSED_USER }, work: [], final: { role: "assistant", content: refusedLine(t.work) }, summary: null, meta: { ...t.meta, refused: true } })]
          : []
      : (t.finished ?? !!t.final)
        ? [t]
        : t.meta?.failed && t.work?.length
          ? [lazyOver(t, { final: { role: "assistant", content: failedLine(t.meta.failed) } })]
        : cutOffBefore(t, bootAt)
          ? [lazyOver(t, { final: { role: "assistant", content: CUT_OFF_LINE }, meta: { ...t.meta, cutOff: true } })]
          : [],
  );
}

/** A result's pointer: the first eight hex digits of its text's hash — what `filament_recall({ result })` takes. @param {string} text */
export const resultRef = (text) => shortHash(String(text ?? ""), 8);

/** The text of a tool_result block, whatever shape its content takes. @param {any} b */
export const resultText = (b) =>
  typeof b?.content === "string"
    ? b.content
    : Array.isArray(b?.content)
      ? b.content.map((c) => (c?.type === "text" ? String(c.text ?? "") : "")).join("\n")
      : b?.content == null ? "" : JSON.stringify(b.content);

/** The further-down of two shapes (the one the model sees less of). @param {string} a @param {string} b */
export const lowerShape = (a, b) => ((SHAPE_RANK[/** @type {keyof typeof SHAPE_RANK} */ (a)] ?? 0) >= (SHAPE_RANK[/** @type {keyof typeof SHAPE_RANK} */ (b)] ?? 0) ? a : b);

/**
 * Why a turn's archived trajectory cannot go to the model raw, or null when it can: the roles must alternate from
 * the user's message to the final, and every tool_use must be answered by the next message's tool_results (an
 * imported or half-written turn may break either; sent raw it would fail every later request of the session). And
 * work rebuilt from a run log (`meta.cut.logged`, app/sessions/cut-turns.js) is a record of the turn, not what its
 * model wrote — a call's input there is the log's clipped target — so it never rides as the model's own calls.
 * @param {TurnBody} t
 */
export function trajectoryProblem(t) {
  if (t.meta?.cut?.logged) return "its work was rebuilt from its run log after a restart cut it off";
  const msgs = rawMessages(t);
  if (msgs.length < 2) return "fewer than two messages";
  if (msgs[0]?.role !== "user") return "does not start with the user's message";
  if (msgs[msgs.length - 1]?.role !== "assistant") return "does not end with the assistant's reply";
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    const want = i % 2 === 0 ? "user" : "assistant";
    if (m?.role !== want) return `message ${i + 1} is ${m?.role || "unknown"}, expected ${want}`;
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    const uses = m.content.filter((b) => b?.type === "tool_use").map((b) => String(b.id));
    if (!uses.length) continue;
    const next = msgs[i + 1];
    const answered = new Set(Array.isArray(next?.content) ? next.content.filter((b) => b?.type === "tool_result").map((b) => String(b.tool_use_id)) : []);
    const open = uses.filter((id) => !answered.has(id));
    if (open.length) return `tool_use ${open[0]} has no tool_result`;
  }
  return null;
}

/** tool_use id → { name, input } across a turn's assistant messages. @param {any[]} messages */
export function toolCalls(messages) {
  /** @type {Map<string, { name: string, input: any }>} */
  const calls = new Map();
  for (const m of messages)
    if (m?.role === "assistant" && Array.isArray(m.content))
      for (const b of m.content) if (b?.type === "tool_use" && b.id) calls.set(String(b.id), { name: String(b.name || ""), input: b.input });
  return calls;
}

/** tool_use id → tool name across a turn's assistant messages. @param {any[]} messages */
export function toolNames(messages) {
  return new Map([...toolCalls(messages)].map(([id, c]) => [id, c.name]));
}

/**
 * Replace tool results in place of a message list: `pick(block, meta)` returns the new content, or the new block
 * itself, or undefined to keep.
 * @param {any[]} messages @param {(b: any, at: { mi: number, bi: number }) => any} pick
 */
function mapResults(messages, pick) {
  let changed = 0;
  const out = messages.map((m, mi) => {
    if (m?.role !== "user" || !Array.isArray(m.content)) return m;
    let touched = false;
    const content = m.content.map((b, bi) => {
      if (b?.type !== "tool_result") return b;
      const next = pick(b, { mi, bi });
      if (next === undefined) return b;
      touched = true;
      changed++;
      return typeof next === "string" ? { ...b, content: next } : next;
    });
    return touched ? { ...m, content } : m;
  });
  return { messages: out, changed };
}

/**
 * `status`: every tool result becomes its summary line (size / first error line / the text when short). The tool
 * pairs stay intact, so the turn is still a valid trajectory.
 * @param {any[]} messages
 */
export function statusResults(messages) {
  return mapResults(messages, (b) => {
    const text = resultText(b);
    const short = resultSummary(text, !!b.is_error);
    return short === text ? undefined : short;
  });
}

/** What a finished turn's lines must save before One line rewrites it (the owner's of 11-07): the rewrite costs the
 *  provider's cache one miss over the turn, which a smaller saving does not pay back. */
export const LINE_MIN_TOKENS = 10000;

/**
 * `line` (One line): every tool result becomes its summary line, as `status` makes it, and where the line leaves
 * something out it carries the result's recall id, which `filament_recall` brings back whole (the owner's of 11-07). A
 * short result is already its own line; an empty one says so, with nothing to bring back; one cleared, already a
 * pointer or holding a picture is left alone. A reader with no filament_recall (`recall` false) gets the line alone.
 * `messages` is one turn's: where its lines save fewer than `min` tokens (LINE_MIN_TOKENS), counted without the
 * calibration factor so the same turn always decides the same, the turn goes as it ran and its cache holds.
 * @param {any[]} messages @param {{ recall?: boolean, min?: number }} [o]
 */
export function lineResults(messages, o = {}) {
  const min = o.min ?? LINE_MIN_TOKENS;
  let ids = 0;
  let saved = 0;
  const r = mapResults(messages, (b) => {
    const text = resultText(b);
    if (text === CLEARED_TEXT || /^result r:[0-9a-f]{8} /.test(text)) return undefined;
    // A result with a picture stays whole: no line says what it shows, and recall brings back its text alone.
    if (Array.isArray(b.content) && b.content.some((/** @type {any} */ x) => x?.type !== "text")) return undefined;
    const short = resultSummary(text, !!b.is_error);
    if (short === text) return undefined;
    const line = o.recall === false || !text.trim() ? short : `${short} — result r:${resultRef(text)}`;
    if (line !== short) ids++;
    saved += estimateTokens(text) - estimateTokens(line);
    return line;
  });
  return saved < min ? { messages, changed: 0, ids: 0 } : { ...r, ids };
}

/** One result's pointer line: what `pointer` and `dedupe-to-tail` leave in the result's place. @param {string} text @param {boolean} isError */
export function pointerLine(text, isError) {
  const lines = text ? text.replace(/\n$/, "").split("\n").length : 0;
  return `result r:${resultRef(text)} (${lines} line${lines === 1 ? "" : "s"}, ${isError ? "error" : "ok"}) — filament_recall({ result: "r:${resultRef(text)}" }) brings it back`;
}

/**
 * `pointer`: every tool result becomes its pointer line; lossless because the archive keeps the result and the recall
 * tool resolves the pointer (§6.4). A result already cleared or already a pointer is left alone.
 * @param {any[]} messages
 */
export function pointerResults(messages) {
  return mapResults(messages, (b) => {
    const text = resultText(b);
    if (!text.trim() || text === CLEARED_TEXT || /^result r:[0-9a-f]{8} /.test(text)) return undefined;
    return pointerLine(text, !!b.is_error);
  });
}

/**
 * `dedupe-to-tail` across a whole history: the same call (`stubKey(name, input)`) made in several turns keeps only the
 * newest result raw; the older ones say which turn supersedes them and carry their own pointer. `turnOf(mi)` names
 * the turn a message index belongs to.
 * @param {any[]} messages @param {(mi: number) => number} turnOf
 */
export function dedupeResults(messages, turnOf) {
  const calls = toolCalls(messages);
  /** @type {Map<string, { mi: number, bi: number, id: string }[]>} */
  const byKey = new Map();
  messages.forEach((m, mi) => {
    if (m?.role !== "user" || !Array.isArray(m.content)) return;
    m.content.forEach((b, bi) => {
      if (b?.type !== "tool_result") return;
      const c = calls.get(String(b.tool_use_id));
      if (!c || !c.name) return;
      const key = stubKey(c.name, c.input);
      (byKey.get(key) || byKey.set(key, []).get(key))?.push({ mi, bi, id: String(b.tool_use_id) });
    });
  });
  /** @type {Map<string, number>} tool_use id → the turn that supersedes it */
  const superseded = new Map();
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    const newest = list[list.length - 1];
    for (const older of list.slice(0, -1)) superseded.set(older.id, turnOf(newest.mi));
  }
  if (!superseded.size) return { messages, changed: 0 };
  return mapResults(messages, (b) => {
    const by = superseded.get(String(b.tool_use_id));
    if (by == null) return undefined;
    const text = resultText(b);
    if (text === CLEARED_TEXT) return undefined;
    return { ...b, content: `→ superseded by the same call in turn ${by} (r:${resultRef(text)}; filament_recall brings this one back)` };
  });
}

/**
 * The loop's overflow recovery (loop.js): a round the provider refused for size is retried once with the results of
 * compactable tools older than the newest `keepRecent` replaced by the cleared marker. Counted across the whole list,
 * newest first, so the newest work stays whole. A composition never clears.
 * @param {any[]} messages @param {{ keepRecent?: number, tools?: "compactable" | "all" }} [o]
 */
export function clearResults(messages, { keepRecent = 5, tools = "compactable" } = {}) {
  const names = toolNames(messages);
  /** @type {{ mi: number, bi: number }[]} */
  const eligible = [];
  messages.forEach((m, mi) => {
    if (m?.role !== "user" || !Array.isArray(m.content)) return;
    m.content.forEach((b, bi) => {
      if (b?.type !== "tool_result") return;
      const name = (names.get(String(b.tool_use_id)) || "").toLowerCase();
      if ((tools === "all" || COMPACTABLE_TOOLS.includes(name)) && resultText(b) !== CLEARED_TEXT) eligible.push({ mi, bi });
    });
  });
  const clear = eligible.slice(0, Math.max(0, eligible.length - Math.max(0, keepRecent)));
  if (!clear.length) return { messages, cleared: 0 };
  const byMessage = new Map();
  for (const c of clear) (byMessage.get(c.mi) || byMessage.set(c.mi, new Set()).get(c.mi)).add(c.bi);
  const out = messages.map((m, mi) => {
    const set = byMessage.get(mi);
    if (!set) return m;
    return { ...m, content: m.content.map((b, bi) => (set.has(bi) ? { ...b, content: CLEARED_TEXT } : b)) };
  });
  return { messages: out, cleared: clear.length };
}

/**
 * The model's thinking blocks taken out of a turn's assistant messages (`model.thinking.keepInHistory: false`): the
 * provider ignores earlier turns' thinking, and stripping it saves the tokens. A message left with no block keeps a
 * placeholder so the trajectory stays valid.
 * @param {any[]} messages
 */
export function stripThinking(messages) {
  let stripped = 0;
  const out = messages.map((m) => {
    if (m?.role !== "assistant" || !Array.isArray(m.content)) return m;
    const content = m.content.filter((b) => b?.type !== "thinking" && b?.type !== "redacted_thinking");
    if (content.length === m.content.length) return m;
    stripped += m.content.length - content.length;
    return { ...m, content: content.length ? content : [{ type: "text", text: "(thinking)" }] };
  });
  return { messages: out, stripped };
}

/**
 * Whether turn `t` paused and `next` is the turn that answered it (HarnessV3-Views V6-11): `t` ends with Filament's
 * note — the permission, the question — and `next` opens with the answer, then the reply that asked: it resumes what
 * the note asked (`resumes`, the pause's kind). The note and the answer are Filament's exchange with the developer: the
 * model, resumed, saw its calls answered by their results and neither of them.
 * @param {TurnBody} t @param {TurnBody | undefined} next
 */
export const answeredPause = (t, next) => !!t?.meta?.notice?.kind && next?.meta?.resumes === t.meta.notice.kind;

/**
 * The turn without Filament's note in its final, for every shape but raw (V6-11): a fold says the turn's own words
 * and calls only. No final is left when the note was all of it.
 * @param {TurnBody} t @returns {TurnBody}
 */
export function withoutNote(t) {
  const note = String(t.meta?.notice?.text || "");
  if (!note || !Array.isArray(t.final?.content)) return t;
  const content = t.final.content.filter((/** @type {any} */ b) => !(b?.type === "text" && b.text === note));
  return { ...t, final: content.length ? { ...t.final, content } : null };
}

/**
 * Render one completed turn under a shape. `fold` is deterministic from the bytes and the fold's knobs (VIEW_VERSION). A
 * turn asked for raw whose trajectory is not a valid conversation renders as a fold instead, with the reason in
 * `fallback`.
 * @param {TurnBody} t @param {string} kind
 * @param {{ stubChars?: number, foldImages?: boolean, keepThinking?: boolean, calls?: "each" | "tally", recall?: boolean }} [view]
 *   `recall`: false where the reader has no filament_recall (a coding agent that takes no MCP tools) — a count then
 *   says to re-run a tool, never names the recall
 * @returns {{ kind: "raw" | "fold", messages: any[], stubs: number, fallback?: string, stripped?: number }}
 */
export function renderTurn(t, kind, view = {}) {
  const raw = rawMessages(t);
  if (!raw.length) return { kind: "raw", messages: raw, stubs: 0 };
  const problem = kind === "raw" ? trajectoryProblem(t) : null;
  if (kind === "raw" && !problem) {
    if (view.keepThinking) return { kind: "raw", messages: raw, stubs: 0 };
    const s = stripThinking(raw);
    return { kind: "raw", messages: s.messages, stubs: 0, ...(s.stripped ? { stripped: s.stripped } : {}) };
  }
  // A turn asked for raw that folded says why: without it the composer wrote no note.
  return { ...foldOf(t, raw, view), ...(problem ? { fallback: problem } : {}) };
}

/**
 * How a form's folds show a turn's tool calls: each on a line of its own, or all counted in one (Words).
 * @param {string | null | undefined} form @returns {"each" | "tally"}
 */
export const callsOf = (form) => (form === "words" ? "tally" : "each");

/**
 * A turn's fold: of its messages, or — counting the calls of a turn the adapter folded into text — of the adapter's own
 * count (`tallied`, or `talliedBare` for a reader with no recall).
 * @param {TurnBody} t @param {any[]} raw @param {{ stubChars?: number, foldImages?: boolean, calls?: "each" | "tally", recall?: boolean }} view
 */
const foldOf = (t, raw, view) => {
  const recall = view.recall !== false;
  const tallied = recall ? t.tallied : t.talliedBare || t.tallied;
  return fold(view.calls === "tally" && tallied ? rawMessages(/** @type {any} */ (tallied)) : raw, view, recall ? t.n : undefined);
};

/**
 * @param {any[]} raw @param {{ stubChars?: number, foldImages?: boolean, calls?: "each" | "tally" }} view
 * @param {number} [turn] the turn's number: a count of its calls names the recall that brings them back
 */
function fold(raw, view, turn) {
  const P = { stubChars: view.stubChars ?? 160, foldImages: view.foldImages ?? true, calls: view.calls ?? "each", ...(Number(turn) > 0 ? { turn: Number(turn) } : {}) };
  const folded = foldGroup(raw, { from: 0, to: raw.length }, "anthropic", P);
  return { kind: /** @type {"fold"} */ ("fold"), messages: folded.messages, stubs: folded.stubs };
}

/**
 * The shape a form gives a position (newest finished turn = 0): plain (Whole) sends every turn raw, fold and words
 * fold every one — Words counting each turn's calls in one line (`callsOf`) — and fold+2 keeps the newest two raw.
 * @param {number} pos @param {string} form
 */
export function shapeAt(pos, form) {
  if (form === "plain") return "raw";
  if (form === "fold+2") return pos < 2 ? "raw" : "fold";
  return "fold";
}

/**
 * The shape each finished turn takes under a form, newest finished turn at position 0. A compaction's mark
 * (`meta.compacted`: a fold compaction, or a fork's folded inheritance, folded the turn) holds under every form: under
 * plain the turn renders at the mark, under the others the mark is a floor.
 * @param {number} count finished turns @param {string} form
 * @param {(string | null)[]} [compacted] the compaction mark's shape per turn (oldest first) or null
 * @returns {string[]} kind per turn, oldest first
 */
export function shapePlan(count, form, compacted = []) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const ck = markedShape(compacted[i]);
    const planned = shapeAt(count - 1 - i, form);
    out.push(ck ? lowerShape(ck, planned) : planned);
  }
  return out;
}

/**
 * The shape a mark renders a turn at, or null for none: a compaction marked the turn, so a shape no turn takes folds
 * it — the one compacted shape — as a kind `renderTurn` does not know folds; it never sends the turn whole again.
 * @param {unknown} s
 */
const markedShape = (s) => (typeof s === "string" && s ? (SHAPES.includes(s) ? s : "fold") : null);

/** The shape a compaction marked a turn at (`meta.compacted`), or null. @param {{ meta?: any }} t */
export const compactedShapeOf = (t) => markedShape(t?.meta?.compacted?.shape);
