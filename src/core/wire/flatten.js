// @ts-check
// Either wire format read as plain turns, [{ role: "system" | "user" | "assistant", text }]: what an agent is told,
// what the memory brain reads, what the token estimate counts. Tool calls and results become bracketed summaries —
// cut to a line's worth, or whole where a harness chat's fresh agent session is seeded (`whole`, HarnessV4_Tasks A7):
// a turn the composition sends whole reaches the agent whole. Another model's reasoning is never replayed.
import { carriesReturned } from "./responses.js";

/** A message's content as text: a call's input cut at 800 characters and a result at 4,000, unless `whole`. */
const render = (content, whole) => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content);
  return content
    .map((b) => {
      if (typeof b === "string") return b;
      if (!b || typeof b !== "object") return "";
      if (b.type === "text") return b.text || "";
      if (b.type === "thinking" || b.type === "redacted_thinking" || b.type === "reasoning") return ""; // never replay another model's reasoning
      if (b.type === "tool_use") {
        const input = b.input ? JSON.stringify(b.input) : "";
        return `[called tool ${b.name}${input ? " with " + (whole ? input : input.slice(0, 800)) : ""}]`;
      }
      if (b.type === "tool_result") {
        const t = render(b.content, whole);
        return `[tool result${b.is_error ? " (error)" : ""}: ${whole ? t : `${t.slice(0, 4000)}${t.length > 4000 ? "…" : ""}`}]`;
      }
      if (b.type === "image" || b.type === "image_url") return "[image]";
      if (b.type === "document") return `[file: ${b.title || b.source?.media_type || "document"}]`;
      if (b.type === "file") return `[file: ${b.file?.filename || "attachment"}]`;
      return b.text || "";
    })
    .filter(Boolean)
    .join("\n");
};
const cutTextOf = (content) => render(content, false);
export const textOf = cutTextOf;
/** The same text with nothing cut: every call's whole input and every result's whole text. */
export const wholeTextOf = (content) => render(content, true);

// Clients such as Claude Code inject <system-reminder> blocks into user messages (skill lists, dates,
// hook output, memory recall). They are addressed to the client's own model, not to another agent, and they hide
// the user's real text (a typed `/sessions` arrives after four reminder blocks). Strip them; count what was removed.
const REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>\s*/gi;
export function stripReminders(text) {
  let n = 0;
  const out = String(text || "")
    .replace(REMINDER_RE, () => {
      n++;
      return "";
    })
    .trim();
  return { text: out, removed: n };
}

/**
 * An Anthropic user message's content that only answers tool calls: tool results, and none of the person's words beside
 * them (a reminder a client adds is none of theirs). @param {unknown} content
 */
export const answersCallsOnly = (content) =>
  Array.isArray(content) &&
  content.some((b) => b?.type === "tool_result") &&
  content.every((b) => b?.type === "tool_result" || (b?.type === "text" && !stripReminders(b.text).text) || (typeof b === "string" && !stripReminders(b).text));

/** Whether a flattened message is a turn of the person's: a user message, not one that only answers tool calls. */
export const isUserTurn = (/** @type {{ role: string, toolResults?: boolean }} */ m) => m.role === "user" && !m.toolResults;

// Normalize either wire format into [{role:'system'|'user'|'assistant', text}]; a user message that only answers tool
// calls is marked `toolResults` (no turn of the person's: `isUserTurn`), as is what a Responses client's tools returned
// beside their outputs (`carriesReturned`). `whole`: every call with its whole input, every result whole — where an
// answer made only of calls is otherwise named by its tools alone.
export function flattenMessages(format, body, { whole = false } = {}) {
  const textOf = whole ? wholeTextOf : cutTextOf;
  const out = [];
  if (format === "anthropic") {
    const sys = textOf(body.system);
    if (sys) out.push({ role: "system", text: sys });
    for (const m of body.messages || []) {
      const text = textOf(m.content);
      if (!whole && m.role === "assistant" && Array.isArray(m.content)) {
        const calls = m.content.filter((b) => b?.type === "tool_use").map((b) => b.name);
        if (calls.length && !text) {
          out.push({ role: "assistant", text: `[called tools: ${calls.join(", ")}]` });
          continue;
        }
      }
      if (m.role !== "assistant") {
        const sr = stripReminders(text);
        out.push({ role: "user", text: sr.text, reminders: sr.removed, ...(answersCallsOnly(m.content) ? { toolResults: true } : {}) });
        continue;
      }
      out.push({ role: "assistant", text });
    }
  } else {
    for (const m of body.messages || []) {
      if (m.role === "system" || m.role === "developer") {
        const t = textOf(m.content);
        if (t) out.push({ role: "system", text: t });
        continue;
      }
      if (m.role === "tool") {
        const t = textOf(m.content);
        out.push({ role: "user", text: `[tool result: ${whole ? t : t.slice(0, 4000)}]`, toolResults: true });
        continue;
      }
      let text = textOf(m.content);
      if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length)
        text = [
          text,
          whole
            ? m.tool_calls.map((c) => `[called tool ${c.function?.name || c.name}${c.function?.arguments ? ` with ${c.function.arguments}` : ""}]`).join("\n")
            : `[called tools: ${m.tool_calls.map((c) => c.function?.name || c.name).join(", ")}]`,
        ]
          .filter(Boolean)
          .join("\n");
      if (m.role !== "assistant") {
        const sr = stripReminders(text);
        out.push({ role: "user", text: sr.text, reminders: sr.removed, ...(carriesReturned(m) ? { toolResults: true } : {}) });
        continue;
      }
      out.push({ role: "assistant", text });
    }
  }
  return out;
}
