// @ts-check
// One turn adapter (HarnessV3 Step 3 D6): a turn archived in another window's wire format and tool vocabulary,
// made fit for the request at hand. `adaptTurn(turn, { format, tools, from })` returns the turn's messages in the
// target format with every tool call rebuilt against the tools the request actually declares (`buildCall`), the
// target's schemas deciding the field names. A turn from the requesting window never goes through here.
//
// Translated when every tool call translates; folded as a whole — with the fold, never half a turn — when any
// call cannot (a vocabulary has no spelling for what it says) or any body was cut at storage. When the tools the turn
// was made with are known (`madeWith`: the harness's own turn under the other engine, HarnessV3-AtHome AH-O7), a call
// passes by name only to the very tool that took it — the same name and schema. Thinking blocks
// are dropped: their signatures belong to another model's request. Pure: the same turn, target format and
// declared tools give the same bytes (`ADAPTER_VERSION` freezes the recipe, the way VIEW_VERSION does). A folded turn
// is text, with no call left for a later fold to count: it comes with its calls counted in one line as well
// (`tallied`), for a view that carries a turn's words alone.
import { canonicalOf, buildCall, KINDS } from "./tool-vocab.js";
import { foldGroup } from "./fold.js";
import { anthropicToOpenaiRequest, openaiToAnthropicRequest } from "./wire/translate.js";

/** The adapter's recipe version: a change in the translation rules bumps it, so what the composer froze and what
 *  it would build now can be told apart. */
// 2 (11-06): a folded turn's count names the turn's recall and keeps its sub-agents' reports (fold.js).
export const ADAPTER_VERSION = 2;

/** The fold's knobs as the adapter uses them (the composer's own shapes apply on top, with their own knobs). */
const FOLD_P = { stubChars: 160, foldImages: true };

/**
 * A turn's archived wire format, detected from shape (D4): `tool_calls` or a `tool` role means OpenAI,
 * `tool_use`/`tool_result` blocks mean Anthropic; plain text is valid in either (the caller's word wins there).
 * @param {any[]} messages
 * @returns {"anthropic" | "openai" | null}
 */
export function wireFormatOf(messages) {
  for (const m of Array.isArray(messages) ? messages : []) {
    if (m?.role === "tool" || Array.isArray(m?.tool_calls)) return "openai";
    if (Array.isArray(m?.content))
      for (const b of m.content) {
        if (b?.type === "tool_use" || b?.type === "tool_result") return "anthropic";
        if (b?.type === "tool_calls") return "openai";
      }
  }
  return null;
}

/**
 * Adapt a turn from another window.
 * @param {{ n?: number, user?: any, work?: any[], final?: any }} turn  the archive's turn body
 * @param {{ format?: "anthropic" | "openai", tools?: { name: string, schema: any }[], from?: "anthropic" | "openai" | null, madeWith?: { name: string, schema: any }[] | null }} [o]
 *   `format` — the target; `tools` — the tools the request declares; `from` — the turn's stored format (else
 *   detected); `madeWith` — the tools the turn was made with, when they are known
 * @returns {{ messages: any[], mode: "translated" | "folded", reason: string | null, tallied?: any[], talliedBare?: any[] }}
 *   `talliedBare`: the count again without the recall it names, for a reader that has no filament_recall
 */
export function adaptTurn(turn, { format = "anthropic", tools = [], from = null, madeWith = null } = {}) {
  const raw = [turn?.user, ...(turn?.work || []), turn?.final].filter(Boolean);
  if (!raw.length) return { messages: [], mode: "translated", reason: null };
  const srcFormat = from || wireFormatOf(raw) || "anthropic";
  const messages = dropThinking(raw);
  // A body cut at storage (the archive's `truncated` stub) cannot go out as a marker: the fold renders its head.
  if (messages.some((m) => m?._filament_truncated === true))
    return folded(messages, srcFormat, format, "a stored body was cut", turn?.n);
  const rebuilt = rebuildCalls(messages, srcFormat, tools, madeWith);
  if (!rebuilt.ok) return folded(messages, srcFormat, format, `tool calls with no equivalent here (${[...new Set(rebuilt.lost)].join(", ")})`, turn?.n);
  return { messages: convert(rebuilt.messages, srcFormat, format), mode: "translated", reason: null };
}

/** `thinking`/`redacted_thinking` blocks dropped — another model's signatures never ride a rebuilt request. A
 *  message that said nothing but thinking is dropped whole: an empty content array would ride the request as a
 *  message that says nothing (a thinking-only message never carries a tool call, so no pairing can break). */
function dropThinking(messages) {
  const out = [];
  for (const m of messages) {
    if (Array.isArray(m?.content) && m.content.some((/** @type {any} */ b) => b?.type === "thinking" || b?.type === "redacted_thinking")) {
      const content = m.content.filter((/** @type {any} */ b) => b?.type !== "thinking" && b?.type !== "redacted_thinking");
      if (content.length) out.push({ ...m, content });
    } else out.push(m);
  }
  return out;
}

/**
 * Rebuild every tool call against the declared tools. MCP tools, the memory family, the never-crossing kinds and
 * anything the table does not know pass through when the request declares the same full name, and only then — and,
 * when the turn's own tools are known (`madeWith`), only to a tool of the same schema: the loop's agent tool and a
 * team's lead's share a name and take different calls. Returns ok:false with the names that had no equivalent — the
 * whole turn folds, never half of it.
 * @param {any[]} messages @param {"anthropic" | "openai"} srcFormat @param {{ name: string, schema: any }[]} tools
 * @param {{ name: string, schema: any }[] | null} madeWith
 */
function rebuildCalls(messages, srcFormat, tools, madeWith) {
  /** @type {string[]} */
  const lost = [];
  const declared = new Map(tools.map((t) => [String(t?.name || ""), JSON.stringify(t?.schema ?? null)]));
  const made = madeWith ? new Map(madeWith.map((t) => [String(t?.name || ""), JSON.stringify(t?.schema ?? null)])) : null;
  /** @param {string} name */
  const passes = (name) => declared.has(name) && (!made || made.get(name) === declared.get(name));
  const one = (name, input) => {
    const canon = canonicalOf(name, input);
    // Full names pass through when the request declares the same tool — MCP tools, the memory family, and the
    // never-crossing kinds too: D5's "no" is about the crossing (Claude Code's WebFetch carries a `prompt` ours has
    // no equivalent for), not about rebuilding a call against the very tool that took it.
    if (!canon || canon.kind === "memory" || canon.kind === "mcp" || KINDS[canon.kind]?.never)
      return passes(name) ? { name, input } : (lost.push(name), null);
    const built = buildCall(canon.kind, canon.fields, tools, canon.extra);
    return built || (lost.push(name), null);
  };
  const out = messages.map((m) => {
    if (Array.isArray(m?.content)) {
      const content = m.content.map((/** @type {any} */ b) => {
        if (b?.type !== "tool_use") return b;
        const next = one(b.name, b.input);
        return next ? { ...b, name: next.name, input: next.input } : b;
      });
      return { ...m, content };
    }
    if (Array.isArray(m?.tool_calls)) {
      const tool_calls = m.tool_calls.map((/** @type {any} */ c) => {
        let input = {};
        try { input = JSON.parse(String(c?.function?.arguments ?? "{}")); } catch { input = {}; }
        const next = one(c?.function?.name, input);
        if (!next) return c;
        return { ...c, function: { ...c.function, name: next.name, arguments: JSON.stringify(next.input) } };
      });
      return { ...m, tool_calls };
    }
    return m;
  });
  return lost.length ? { ok: false, lost } : { ok: true, messages: out };
}

/** The whole turn as its fold — in its own format first (the fold is deterministic from the bytes), then
 *  converted: the fold's messages are text-only, so the conversion cannot lose a call. Twice: a line per call, and
 *  the calls counted in one line (`tallied`), which names the turn's recall where its number is known.
 *  @param {any[]} messages @param {"anthropic" | "openai"} srcFormat @param {"anthropic" | "openai"} format @param {string} reason
 *  @param {number} [n] the turn's number
 *  @returns {{ messages: any[], mode: "translated" | "folded", reason: string | null, tallied: any[], talliedBare?: any[] }} */
function folded(messages, srcFormat, format, reason, n) {
  const as = (/** @type {"each" | "tally"} */ calls, turn = 0) => convert(foldGroup(messages, { from: 0, to: messages.length }, srcFormat, { ...FOLD_P, calls, ...(calls === "tally" && turn > 0 ? { turn } : {}) }).messages, srcFormat, format);
  const named = Number(n) > 0 ? Number(n) : 0;
  // A reader with no filament_recall (a coding agent that takes no MCP tools) is told to re-run a tool instead.
  return { messages: as("each"), mode: "folded", reason, tallied: as("tally", named), ...(named ? { talliedBare: as("tally") } : {}) };
}

/** Wire-format conversion through the existing translators applied to a minimal body — no second translator. */
function convert(messages, from, to) {
  if (from === to || !messages.length) return messages;
  if (from === "anthropic" && to === "openai") return anthropicToOpenaiRequest({ model: "x", max_tokens: 1, messages }).body.messages || messages;
  if (from === "openai" && to === "anthropic") return openaiToAnthropicRequest({ model: "x", messages }).body.messages || messages;
  return messages;
}
