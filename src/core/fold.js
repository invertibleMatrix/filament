// The fold: a finished turn as its REPORT — the user's message (text only), one line per tool call, the model's text
// in order. Most of a finished turn's bytes are TRAFFIC — tool calls, tool results, thinking — while its outcome sits
// in the text the model wrote at the end of it. A fold compaction sends turns this way, and so do a fresh agent
// session's start (`context.carry`), a fork's folded inheritance and a sub-agent's folded view. Nothing is deleted
// anywhere: the archive keeps every byte, and filament_recall brings a folded turn back by its number.
//
// Deterministic: a folded turn is a pure function of its bytes and VIEW_VERSION, so every request sends the same
// folded turn and the provider's cache of the prefix holds.
import { sha256 as sha } from "./hash.js";
import { squash, cut } from "./text.js";
import { textOfMessage } from "./messages.js";
import { canonicalOf } from "./tool-vocab.js";

// Bumped when the fold's output changes shape: every folded turn changes bytes at once (one cache write), on purpose.
// 2 (11-06): a tally keeps its sub-agents' reports and names the turn's recall; a line per call is as it was.
// 3 (11-07): a wait's reports are cut each, a launch's notice and an empty wait keep none; a line per call names the
// turn's recall too, where the turn's number is known.
export const VIEW_VERSION = 3;

// ---- the stub ---------------------------------------------------------------------------------------------------
// One line for one tool call. The argument that identifies the call (a path, a command, a pattern) and what came back
// in ten words: a short result verbatim, a long one as its size, an error as its first line. Deterministic from the
// bytes, so the same call always folds to the same line.
const ARG_KEYS = [
  "file_path",
  "path",
  "notebook_path",
  "command",
  "cmd",
  "pattern",
  "glob",
  "query",
  "q",
  "url",
  "prompt",
  "description",
  "text",
  "content",
  "old_string",
  "input",
];
export function argSummary(input, max = 80) {
  let obj = input;
  if (typeof obj === "string") {
    try {
      obj = JSON.parse(obj);
    } catch {
      return cut(squash(obj), max);
    }
  }
  if (!obj || typeof obj !== "object") return obj == null ? "" : cut(squash(String(obj)), max);
  for (const k of ARG_KEYS)
    if (obj[k] != null && obj[k] !== "")
      return cut(squash(typeof obj[k] === "string" ? obj[k] : JSON.stringify(obj[k])), max);
  const keys = Object.keys(obj);
  if (!keys.length) return "";
  return cut(
    squash(keys.map((k) => `${k}=${typeof obj[k] === "string" ? obj[k] : JSON.stringify(obj[k])}`).join(" ")),
    max,
  );
}
export function resultSummary(text, isError = false, max = 120) {
  const t = String(text ?? "");
  if (!t.trim()) return isError ? "error (no detail)" : "(no output)";
  if (isError) return `error: ${cut(squash(t), max)}`;
  const flat = squash(t);
  if (flat.length <= max) return flat;
  const lines = t.replace(/\n$/, "").split("\n").length;
  const kb =
    t.length >= 1024 ? `${(t.length / 1024).toFixed(t.length >= 10240 ? 0 : 1)} KB` : `${t.length} chars`;
  return `${lines} line${lines === 1 ? "" : "s"} · ${kb}`;
}
export const stubLine = (name, input, resultText, isError, stubChars = 160) =>
  cut(
    `⚙ ${String(name || "tool").slice(0, 60)}${(() => {
      const a = argSummary(input);
      return a ? ` ${a}` : "";
    })()} → ${resultText === undefined ? "(no result)" : resultSummary(resultText, isError)}`,
    stubChars,
  );
// What the re-read counter compares: the same tool on the same primary argument is the same call.
export const stubKey = (name, input) =>
  `${String(name || "").toLowerCase()}|${argSummary(input, 200).toLowerCase()}`;

// ---- the tally --------------------------------------------------------------------------------------------------
// One line for all of a turn's tool calls, where a reader wants the turn's words and not its traffic (`calls: "tally"`,
// the form a fresh coding-agent session carries unless the session chose another: `context.carry` words). It says how
// many calls of each tool ran, how many failed, and the files they wrote or edited, in the order each was first
// changed, in any tool vocabulary (`canonicalOf`). Deterministic from the bytes, as a stub is.
/** The most files a tally names, and the most tools; what is past either is counted. */
const TALLY_FILES = 40;
const TALLY_TOOLS = 12;
/** A call's input as an object: an OpenAI call carries it as JSON text. @param {any} input */
const inputOf = (input) => {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
};
function callTally() {
  /** @type {Map<string, number>} */
  const tools = new Map();
  /** @type {string[]} */
  const changed = [];
  const seen = new Set();
  let calls = 0,
    failed = 0;
  return {
    /** @param {any} name @param {any} input @param {boolean | undefined} isError */
    add(name, input, isError) {
      const n = String(name || "tool").slice(0, 60);
      tools.set(n, (tools.get(n) || 0) + 1);
      calls++;
      if (isError) failed++;
      const c = canonicalOf(n, inputOf(input));
      const path = c && (c.kind === "write" || c.kind === "edit") ? String(c.fields.path ?? "").trim().replace(/\\/g, "/") : "";
      if (!path || seen.has(path)) return;
      seen.add(path);
      changed.push(path);
    },
    /**
     * The line, null for a turn that called no tool. `turn`: the turn's number, where the reader knows it — the line then
     * says how to bring the output back (filament_recall), not to run the tools again.
     * @param {number | null} [turn] @returns {string | null}
     */
    line(turn = null) {
      if (!calls) return null;
      const byCount = [...tools.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const named = byCount.slice(0, TALLY_TOOLS).map(([n, c]) => (c > 1 ? `${n}×${c}` : n));
      const more = byCount.length - named.length;
      const files = changed.slice(0, TALLY_FILES);
      const rest = changed.length - files.length;
      return [
        `⚙ [Filament left this turn's ${calls} tool call${calls === 1 ? "" : "s"} out: ${named.join(", ")}${more > 0 ? ` and ${more} more tool${more === 1 ? "" : "s"}` : ""}`,
        failed ? ` · ${failed} failed` : "",
        files.length ? ` · changed ${files.join(", ")}${rest > 0 ? ` and ${rest} more file${rest === 1 ? "" : "s"}` : ""}` : "",
        Number(turn) > 0 ? ` — filament_recall({ turn: ${Number(turn)} }) brings its output back]` : " — re-run a tool if you need its output]",
      ].join("");
    },
  };
}

// ---- a sub-agent's report ---------------------------------------------------------------------------------------
// What a turn's sub-agents found is the turn's outcome, not its traffic (the owner's of 11-06: a moved chat carried five
// research agents' reports as one counted line, and its agent launched them again). Where a tally leaves the calls out,
// each launch that answered with its report keeps it, where it fell among the turn's words, cut past REPORT_CHARS. A
// launch in the background answers with its notice, and its report comes back through Filament's wait or envelope,
// whose answer is kept the same way (the review of 8bcb358fc), each report it brought cut on its own.
/** The most of one sub-agent's report a tally keeps. */
export const REPORT_CHARS = 8000;
/** A sub-agent's launch: the clients' Agent and Task, Filament's agent, and Filament's agent over its MCP. @param {string} name */
const launches = (name) => SUBAGENT_TOOLS.has(name) || /^mcp__.+__agent$/.test(name);
/** What brings a background launch's report back: Filament's wait and envelope, its loop's or over its MCP. @param {string} name */
const collects = (name) => name === "wait" || name === "envelope" || /^mcp__.+__(wait|envelope)$/.test(name);
/**
 * A launch that answered only that its sub-agent runs on — in the background, as the loop's and a lead's agent launch
 * unasked, followed up there, sent there by the developer, outlasting its call, Claude Code's async agent: its report
 * comes back later, and is kept there (the hunt of carry-reports).
 */
const RUNS_ON = /^(?:\[Filament: )?(?:(?:Launched|Asked) [^\n]*?\bsa_\w+[^\n]*? in the background\.|[^\n]*?\bsa_\w+ took your [^\n]*? in the background\.|the developer sent sub-agent [^\n]*? to the background|[^\n]*? is still (?:thinking|working), longer than one of your calls may wait|Async agent launched successfully)/;
/**
 * A wait or an envelope that brought no report says so first — a lead's look at its workers may follow (the hunt of
 * carry-reports); one that brought reports says how many, or that the sealed ones open here, and them below it.
 */
const BROUGHT_NOTHING = /^(?:Waited [^.;:\n]{1,40}(?: and |: (?!(?:one message|\d+ messages) from Filament:\n))|Nothing to wait for:(?![^\n]*oldest first:\n)|No envelope is sealed)/;
/** One report cut past REPORT_CHARS. @param {string} text */
const capped = (text) => (text.length > REPORT_CHARS ? `${text.slice(0, REPORT_CHARS)}\n[… ${(text.length - REPORT_CHARS).toLocaleString("en-US")} more characters of this report]` : text);
/**
 * A launch's report as the tally keeps it, or the reports a wait or an envelope brought back; null where the call
 * launched nothing that reported — a launch in the background, Filament's agent tool listing models, applying a
 * change or stopping a sub-agent, a letter written.
 * @param {any} name @param {any} input @param {{ text: string, isError: boolean } | undefined} r
 */
function reportOf(name, input, r) {
  const n = String(name || "");
  const launch = launches(n);
  if ((!launch && !collects(n)) || !r || r.isError) return null;
  const args = inputOf(input) || {};
  const text = String(r.text ?? "").trim();
  if (!text || args.run_in_background === true) return null;
  if (launch && (args.list_models === true || args.apply_changes === true || args.mark_applied === true || args.stop === true || RUNS_ON.test(text))) return null;
  if (!launch && (args.to != null || args.answer != null || BROUGHT_NOTHING.test(text))) return null;
  const who = launch ? squash(args.description || args.subagent_type || "").slice(0, 80) : "";
  // A wait's or an envelope's answer says each message it brought as a `[Filament: …` of its own: each is cut alone.
  const kept = launch ? capped(text) : text.split(/\n\n(?=\[Filament: )/).map(capped).join("\n\n");
  return `⚙ ${n.slice(0, 60)}${who ? ` (${who})` : ""} ${launch ? "reported" : "brought back"}:\n${kept}`;
}

// ---- per-format readers -----------------------------------------------------------------------------------------
const blockText = (c) =>
  typeof c === "string"
    ? c
    : Array.isArray(c)
      ? c
          .map((b) =>
            typeof b === "string"
              ? b
              : b?.type === "text"
                ? String(b.text ?? "")
                : b?.type === "image" || b?.type === "image_url" || b?.type === "input_image"
                  ? "[image]"
                  : b?.type === "document" || b?.type === "file"
                    ? "[document]"
                    : "",
          )
          .filter(Boolean)
          .join("\n")
      : c == null
        ? ""
        : String(c);

// The tool results of a group, by id: anthropic tool_result blocks inside user messages, openai `tool` messages.
function collectResults(messages, from, to, format) {
  const out = new Map();
  for (let i = from; i < to; i++) {
    const m = messages[i];
    if (format === "anthropic") {
      if (m?.role === "user" && Array.isArray(m.content))
        for (const b of m.content)
          if (b?.type === "tool_result")
            out.set(String(b.tool_use_id), { text: blockText(b.content), isError: !!b.is_error });
    } else if (m?.role === "tool")
      out.set(String(m.tool_call_id), { text: blockText(m.content), isError: false });
  }
  return out;
}
// The tool calls of one assistant message, in order: [{ id, name, input }].
function callsOf(m, format) {
  const out = [];
  if (format === "anthropic") {
    if (Array.isArray(m?.content))
      for (const b of m.content)
        if (b?.type === "tool_use" || b?.type === "server_tool_use")
          out.push({ id: String(b.id ?? ""), name: b.name, input: b.input });
  } else
    for (const c of Array.isArray(m?.tool_calls) ? m.tool_calls : [])
      out.push({
        id: String(c?.id ?? ""),
        name: c?.function?.name || c?.name,
        input: c?.function?.arguments ?? c?.arguments,
      });
  return out;
}

// ---- the fold ---------------------------------------------------------------------------------------------------
// A completed turn → two messages: the user's message (text only) and one assistant message carrying the model's text
// and one stub per tool call, in the order they happened. No tool blocks remain, so the folded turn is valid in every
// wire format without any pairing bookkeeping. `P.calls: "tally"` leaves the stubs out for one line that counts them
// (`callTally`), ahead of the model's text, and keeps what the turn's sub-agents reported where it fell (`reportOf`);
// `P.turn`, the turn's number where the caller knows it, lets that line name the recall that brings the rest back.
export function foldGroup(messages, group, format, P) {
  const { from, to } = group;
  const results = collectResults(messages, from, to, format);
  const first = messages[from];
  const userText = blockText(first?.content);
  const lines = [];
  const tally = P.calls === "tally" ? callTally() : null;
  let stubs = 0;
  for (let i = from + 1; i < to; i++) {
    const m = messages[i];
    if (m?.role === "assistant") {
      if (Array.isArray(m.content))
        for (const b of m.content) {
          const t = b?.type === "text" ? String(b.text ?? "") : "";
          if (t.trim()) lines.push(t.trim());
        }
      else if (typeof m.content === "string" && m.content.trim()) lines.push(m.content.trim());
      for (const c of callsOf(m, format)) {
        const r = results.get(c.id);
        if (tally) {
          tally.add(c.name, c.input, r?.isError);
          const report = reportOf(c.name, c.input, r);
          if (report) lines.push(report);
        } else lines.push(stubLine(c.name, c.input, r?.text, r?.isError, P.stubChars));
        stubs++;
      }
    } else if (m?.role === "user" && format === "anthropic" && Array.isArray(m.content)) {
      // A tool-result leg may also carry text the client added (a system reminder, a note): that is conversation.
      for (const b of m.content) if (b?.type === "text" && String(b.text ?? "").trim()) lines.push(String(b.text).trim());
    }
  }
  const userMsg =
    format === "anthropic"
      ? {
          role: "user",
          content:
            P.foldImages || !Array.isArray(first?.content)
              ? typeof first?.content === "string"
                ? first.content
                : [{ type: "text", text: userText || "(no text)" }]
              : first.content,
        }
      : {
          role: "user",
          content: typeof first?.content === "string" ? first.content : userText || "(no text)",
        };
  const head = tally
    ? tally.line(P.turn)
    : stubs
      ? `[Filament folded this turn: ${stubs} tool call${stubs === 1 ? "" : "s"} shown one line each — ${Number(P.turn) > 0 ? `filament_recall({ turn: ${Number(P.turn)} }) brings its output back` : "re-run a tool if you need its output"}]`
      : null;
  const body = [head, ...lines].filter(Boolean).join("\n");
  const asstMsg =
    format === "anthropic"
      ? { role: "assistant", content: [{ type: "text", text: body || "(no text)" }] }
      : { role: "assistant", content: body || "(no text)" };
  return { messages: [userMsg, asstMsg], stubs };
}

// ---- composition -------------------------------------------------------------------------------------------------
// What a request is made of, in characters by class. The measurement that showed 29% tool traffic and a 30% thinking
// share on the request that carried a fix turn — made permanent, per request, so the fold's effect is visible.
/** The sub-agent launchers whose calls and results count as sub-agent traffic: Filament's own `agent`, and those of the
 *  clients it fronts (Claude Code's `Agent` and `Task`). */
const SUBAGENT_TOOLS = new Set(["agent", "Agent", "Task"]);
/** A report or launch notice Filament hands a session's loop, as a user text block of its own (subagents.js). */
const SUBAGENT_DELIVERY = /^\[Filament: [^\]\n]{0,120}?\bsub-agent sa_[0-9a-f]{8}\b/;
/**
 * `subagents` is what sub-agents occupy of the conversation — their launching calls, the results those calls got,
 * and the reports and notices Filament delivered — carved out of the tool and user classes, so the classes still add
 * up to the whole; `subagentCalls` counts the launches (they count among `toolCalls` too).
 * @param {any[]} messages
 * @param {string} format
 * @param {{ system?: any, tools?: any }} [extra]
 */
export function composition(messages, format, { system = null, tools = null } = {}) {
  const c = {
    userText: 0,
    assistantText: 0,
    toolUse: 0,
    toolResult: 0,
    thinking: 0,
    subagents: 0,
    images: 0,
    system: JSON.stringify(system ?? "").length,
    tools: JSON.stringify(tools ?? []).length,
    messages: Array.isArray(messages) ? messages.length : 0,
    toolCalls: 0,
    subagentCalls: 0,
  };
  /** The launching calls' ids, so their results count with them. */
  const launches = new Set();
  for (const m of Array.isArray(messages) ? messages : []) {
    for (const b of Array.isArray(m?.content) ? m.content : []) if (b?.type === "tool_use" && b.id && SUBAGENT_TOOLS.has(String(b.name))) launches.add(String(b.id));
    for (const t of Array.isArray(m?.tool_calls) ? m.tool_calls : []) if (t?.id && SUBAGENT_TOOLS.has(String(t.function?.name))) launches.add(String(t.id));
  }
  for (const m of Array.isArray(messages) ? messages : []) {
    if (m?.role === "system" || m?.role === "developer") {
      c.system += blockText(m.content).length;
      continue;
    }
    if (m?.role === "tool") {
      if (launches.has(String(m.tool_call_id))) c.subagents += blockText(m.content).length;
      else c.toolResult += blockText(m.content).length;
      continue;
    }
    if (Array.isArray(m?.content))
      for (const b of m.content) {
        if (b?.type === "text") {
          const text = String(b.text ?? "");
          if (m.role === "user" && SUBAGENT_DELIVERY.test(text)) c.subagents += text.length;
          else if (m.role === "user") c.userText += text.length;
          else c.assistantText += text.length;
        } else if (b?.type === "tool_use" || b?.type === "server_tool_use") {
          const chars = JSON.stringify(b.input ?? "").length;
          if (launches.has(String(b.id))) {
            c.subagents += chars;
            c.subagentCalls++;
          } else c.toolUse += chars;
          c.toolCalls++;
        } else if (b?.type === "tool_result") {
          if (launches.has(String(b.tool_use_id))) c.subagents += blockText(b.content).length;
          else c.toolResult += blockText(b.content).length;
        } else if (b?.type === "thinking" || b?.type === "redacted_thinking")
          c.thinking += JSON.stringify(b).length;
        else if (
          b?.type === "image" ||
          b?.type === "image_url" ||
          b?.type === "document" ||
          b?.type === "file"
        )
          c.images++;
      }
    else if (typeof m?.content === "string") {
      if (m.role === "user") c.userText += m.content.length;
      else c.assistantText += m.content.length;
    }
    for (const t of Array.isArray(m?.tool_calls) ? m.tool_calls : []) {
      const chars = String(t?.function?.arguments ?? "").length;
      if (launches.has(String(t?.id))) {
        c.subagents += chars;
        c.subagentCalls++;
      } else c.toolUse += chars;
      c.toolCalls++;
    }
    if (typeof m?.reasoning_content === "string") c.thinking += m.reasoning_content.length;
  }
  return c;
}

/// ---- a turn's identity -------------------------------------------------------------------------------------------
// A turn is found again by a hash of its user message, not by an index: indices shift when the client compacts, a hash
// finds the same turn.
/** D3's identity of a person message: the hash of its trimmed text. A message with no text (an image, a document)
 *  is not "the empty message" — its identity is its non-text blocks, so two different screenshots are two messages. */
export const pinHashOf = (userMessage) => {
  const text = textOfMessage(userMessage).trim();
  if (text) return sha(text).slice(0, 16);
  const content = Array.isArray(userMessage?.content) ? userMessage.content : [];
  const other = content.filter((b) => !(typeof b === "string" || b?.type === "text"));
  return sha(other.length ? JSON.stringify(other) : "").slice(0, 16);
};

