// @ts-check
// Message readers shared by every layer that looks inside a wire message: the visible text of a message and the
// kind that gives it its purpose, in all three wire shapes (Anthropic blocks, OpenAI content/tool_calls/role tool,
// Responses items), and the calls an agent's conversation made. Pure: no I/O, no config.
import { redactSecrets } from "./redact.js";
import { cut, listed } from "./text.js";
import { isSvg } from "./visual-look.js";

const ASK_LINE_HEAD = "[Filament: the developer named saved agents for you to consult:";
/**
 * The line Filament puts ahead of a developer's message where their session names saved agents its main agent may ask
 * (HarnessV4_Tasks E15 step 3, AG-74): a rule in the instructions alone is not in a model's mind when it weighs two
 * ways, and the message is. One of Filament's own blocks ("[Filament: …]"), the same words for either engine. It tells
 * the agent to ask (AG-76): a coding agent read "you may ask" as leave to skip it.
 * @param {readonly string[]} tags
 */
export const askLine = (tags) => `${ASK_LINE_HEAD} ${tags.join(", ")}. Before you settle a choice between ways that could both be right, in a plan or in the files, ask one first.]`;

/**
 * Whether a block of words is one of Filament's own (`[Filament: …]`, `[Filament brought these back …]`): it opens with
 * Filament's bracket. Filament's notes in a conversation — a reply cut at its ceiling, what came back after a summary,
 * a command's end — all open so; words that open with one of its heads and go on to someone's (a retry, a question the
 * main agent asks) open so too, and are told apart by their place, not here.
 * @param {string | null | undefined} text
 */
export const filamentBlock = (text) => /^\s*\[Filament[\s:]/.test(String(text ?? ""));
const ASK_LINE_AT_HEAD = /^\s*\[Filament: the developer named saved agents for you to consult:[^\]]*\]\n?/;
/**
 * The line Filament puts ahead of a developer's message that names agents or teams with an `@` past its start
 * (HarnessV4_OneAgent_Plan OA2, L27, L48: "there should be a process mid way instead of it immediately going to tagged
 * agent"): nothing started at Send — the main agent is to use each, when the work is ready for it, through Filament's
 * `agent` tool (a saved agent, by its tag as `saved_agent`) or its `team` tool (a team, sent beside the chat). The
 * same words for either engine: a coding agent's tools of Filament's go by those names too. `off`: the tools this chat
 * has switched off, said so, so the agent says it cannot rather than tries. One of Filament's own blocks, archived with
 * the message; news once, so every reader keeps it. `note`: the message went into a running turn as a note, and the
 * line beside it.
 * @param {readonly { tag?: string, key?: string, name: string }[]} named
 * @param {{ note?: boolean, off?: { agent?: boolean, team?: boolean } }} [o]
 */
export const useLine = (named, { note = false, off = {} } = {}) => {
  const agents = named.filter((n) => n.tag);
  const teams = named.filter((n) => !n.tag && n.key);
  const one = named.length === 1;
  const who = listed([...agents.map((a) => `${a.name} (@${a.tag})`), ...teams.map((t) => `the ${t.name} team (@${t.key})`)]);
  const how = [
    ...(agents.length
      ? [off.agent ? `Filament's agent tool is off in this chat, so you cannot launch ${agents.length === 1 ? "that agent" : "those agents"}` : `launch ${agents.length === 1 ? "the agent" : "each agent"} with Filament's agent tool (saved_agent ${listed(agents.map((a) => `"${a.tag}"`))})`]
      : []),
    ...(teams.length
      ? [off.team ? `Filament's team tool is off in this chat, so you cannot send ${teams.length === 1 ? "that team" : "those teams"}` : `send ${teams.length === 1 ? "the team" : "each team"} with Filament's team tool (action "send", team ${listed(teams.map((t) => `"${t.key}"`))})`]
      : []),
  ];
  const able = !(agents.length && off.agent) && !(teams.length && off.team);
  return `[Filament: the developer wants you to use ${who} here, named with @ in ${note ? "the message they just sent you" : "this message"}. Nothing has started: ${how.join("; ")}${able ? ` when the work is ready for ${one ? "it" : "them"}, and say in your answer if you do not` : ", and say so in your answer"}.]`;
};
/**
 * A text without that line at its head. A block of its own as the message is sent and kept; the first line of the one
 * text a turn's fold joins the message's blocks into (shapes.js), with the developer's words under it.
 * @param {unknown} text
 */
const sansAskLine = (text) => String(text ?? "").replace(ASK_LINE_AT_HEAD, "");
/**
 * The line ahead of a message of the person's own while Parallelize tasks is on in Settings › Experimental (the owner's
 * plan mode of 11-06, piece D): the same words every time, so what is cached before it never moves. Standing words, as the ask line
 * is: every reader but the turn's own model leaves it out (`isAskLine`, `withoutAskLine`; the review of 2aaed3e0e).
 */
export const SIDE_BY_SIDE_LINE = "[Filament: Parallelize tasks is on — where this work has independent parts, plan them as tasks that run at once, each naming the files it writes; else go on as you would.]";
/** A block that is the side by side line. @param {any} b */
const isSideBlock = (b) => b?.type === "text" && String(b.text ?? "").trim() === SIDE_BY_SIDE_LINE;
/**
 * Whether a text block is that line and no more — or the side by side line: standing words, said with every message,
 * and news to no reader. @param {unknown} text
 */
export const isAskLine = (text) => (ASK_LINE_AT_HEAD.test(String(text ?? "")) && !sansAskLine(text).trim()) || String(text ?? "").trim() === SIDE_BY_SIDE_LINE;
/**
 * A message without that line, nor the side by side line: what every reader but the turn's own model is shown of it — a label, a one-line stub,
 * a view a sub-agent is handed, a summary's transcript, a search. The model's own conversation keeps the message as it
 * was sent, and so does whatever tells one message from another (its identity hash, `pinHashOf`).
 * @param {any} msg
 */
export function withoutAskLine(msg) {
  const content = msg?.content;
  const opens = (/** @type {any} */ b) => b?.type === "text" && ASK_LINE_AT_HEAD.test(String(b.text ?? ""));
  // The side by side line goes too (piece D): standing words as well.
  if (!Array.isArray(content) || !content.some((b) => opens(b) || isSideBlock(b))) return msg;
  return { ...msg, content: content.flatMap((b) => (isSideBlock(b) ? [] : !opens(b) ? [b] : sansAskLine(b.text).trim() ? [{ ...b, text: sansAskLine(b.text) }] : [])) };
}

/** Characters of a call's input memory reads with a report (HarnessV3-Memory M7-D18). */
const CALL_INPUT_CHARS = 200;

/** A visual's call, by the loop's name or a coding agent's for Filament's tool (`mcp__filament__show_visual`). */
const VISUAL_CALL = /(?:^|__|\.)show_visual$/;
/**
 * Claude desktop's picture call, as a chat made in its Code tab and imported from Claude Code holds it
 * (`mcp__visualize__show_widget`; its server may go by another name). Its code is `widget_code`.
 */
const DESKTOP_VISUAL_CALL = /^mcp__.+__show_widget$/;
/** The longest title a visual has: it is a name, which heads the visual and names its file. */
export const VISUAL_TITLE_MAX = 80;
/** The most lines a visual shows while it is drawn. */
export const VISUAL_LINES_MAX = 4;
/** A visual's title as a name: lower case, words joined by `_`. @param {unknown} t */
export const visualTitle = (t) =>
  String(t ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
/** A visual's lines while it is drawn: a line or a list of them, the first four that say something. @param {unknown} l */
export const visualLines = (l) =>
  (Array.isArray(l) ? l : typeof l === "string" ? [l] : [])
    .filter((x) => typeof x === "string" && x.trim())
    .map((x) => x.trim())
    .slice(0, VISUAL_LINES_MAX);

/** An artifact's call, by the loop's name or a coding agent's for Filament's tool (`mcp__filament__artifact`). */
const ARTIFACT_CALL = /(?:^|__|\.)artifact$/;

/**
 * A call's input as a reader of the session reads it — memory, a summary's writer, a sub-agent's view of the session —
 * where the input is code only the page draws: a visual reads as its title and what it is, never its code
 * (HarnessV4_Visuals_Plan VC-32, VC-38) — Filament's own, or Claude desktop's in an imported chat (VC-79) — and an
 * artifact's publish as its title and the rest of what it was given, its page and files by their size
 * (HarnessV4_Artifacts_Plan AFC-52). The model's own conversation keeps the call whole, so it can change what it made.
 * Any other input is itself. An input as OpenAI sends it, a JSON string, reads in brief the same.
 * @param {unknown} name @param {any} input
 */
export function inBrief(name, input) {
  const n = String(name ?? "");
  if (ARTIFACT_CALL.test(n)) return artifactInBrief(input);
  const desktop = DESKTOP_VISUAL_CALL.test(n);
  if (!desktop && !VISUAL_CALL.test(n)) return input;
  const given = typeof input === "string" ? argsOf(input) : input;
  if (!given || typeof given !== "object") return input;
  const code = desktop ? given.widget_code : given.code;
  if (desktop && typeof code !== "string") return input;
  const text = typeof code === "string" ? code : "";
  const what = isSvg(text) ? "an SVG drawing" : "an HTML fragment";
  return { title: given.title, drew: `${what} of ${text.length.toLocaleString("en-US")} characters, shown to the developer` };
}

/** A count of characters, in words. @param {string} s */
const charsOf = (s) => `${s.length.toLocaleString("en-US")} characters`;
/**
 * An artifact call's input in brief: everything it was given but its page and its files' text, which read as their
 * size. One that carries neither is itself.
 * @param {any} input
 */
function artifactInBrief(input) {
  const given = typeof input === "string" ? argsOf(input) : input;
  if (!given || typeof given !== "object" || (typeof given.html !== "string" && !Array.isArray(given.files))) return input;
  const { html, files, ...rest } = given;
  return {
    ...rest,
    ...(typeof html === "string" ? { html: `a page of ${charsOf(html)}` } : {}),
    ...(Array.isArray(files) ? { files: files.map((/** @type {any} */ f) => `${String(f?.path ?? "?")} (${typeof f?.content === "string" ? charsOf(f.content) : "no text"})`) } : {}),
  };
}

/** An artifact's answer that gives it whole: its read, or a publish refused over a version its session had not read. */
const ARTIFACT_WHOLE = /^Address: http:\/\/[a-z0-9-]+\.art\.localhost:\d+\/.*$/m;
/** Where its files begin, after what it is and where. */
const ARTIFACT_FILES = "\n\n--- ";
/**
 * A tool's answer as a reader of the session reads it (HarnessV4_Artifacts_Plan AFC-52): an artifact given whole keeps
 * what it is and where, and its files read as their size; any other answer is itself.
 * @param {string} text
 */
export function withoutArtifactFiles(text) {
  if (typeof text !== "string") return text;
  const at = ARTIFACT_WHOLE.exec(text);
  const cut = at ? text.indexOf(ARTIFACT_FILES, at.index) : -1;
  if (cut < 0) return text;
  return `${text.slice(0, cut)}\n\n[its files, ${charsOf(text.slice(cut + 2))}, are left out here]`;
}

/**
 * A message as a reader of the session reads it: each tool result that gives an artifact whole, without its files
 * (`withoutArtifactFiles`). Any other message is itself.
 * @param {any} m
 */
export function resultsInBrief(m) {
  if (!Array.isArray(m?.content) || !m.content.some((/** @type {any} */ b) => b?.type === "tool_result")) {
    if (m?.role === "tool" && typeof m.content === "string") {
      const t = withoutArtifactFiles(m.content);
      return t === m.content ? m : { ...m, content: t };
    }
    return m;
  }
  /** @param {any} c */
  const brief = (c) =>
    typeof c === "string" ? withoutArtifactFiles(c) : Array.isArray(c) ? c.map((x) => (x?.type === "text" && typeof x.text === "string" ? { ...x, text: withoutArtifactFiles(x.text) } : x)) : c;
  return { ...m, content: m.content.map((/** @type {any} */ b) => (b?.type === "tool_result" ? { ...b, content: brief(b.content) } : b)) };
}

/**
 * A picture Claude desktop drew, from its call's block in an imported chat (HarnessV4_Visuals_Plan VS-D15, VC-72): its
 * call's id, its title as a name, its code whole, its lines while drawn, and where it was made — so the page gives
 * Claude desktop's own names Filament's colors (VS-D56). Null for any other block, and for a `show_widget` call with
 * no code (VC-78).
 * @param {any} block
 * @returns {{ id: string, title: string, code: string, loading: string[], madeIn: "claude-desktop" } | null}
 */
export function desktopVisualOf(block) {
  if (block?.type !== "tool_use" || !block.id || !DESKTOP_VISUAL_CALL.test(String(block.name ?? ""))) return null;
  const input = block.input;
  const code = input?.widget_code;
  if (typeof code !== "string" || !code.trim()) return null;
  return { id: String(block.id), title: visualTitle(input?.title).slice(0, VISUAL_TITLE_MAX) || "visual", code, loading: visualLines(input?.loading_messages), madeIn: "claude-desktop" };
}

/**
 * The calls an agent's conversation made, oldest first: each tool's name, its input as given, and whether its result
 * was an error. Every wire shape a turn is archived in: Anthropic blocks (the harness's loop and its sub-agents, Claude
 * Code), OpenAI's `tool_calls` and Responses `function_call` items. Only an Anthropic result says it failed
 * (`is_error`): the others' calls read as done.
 * @param {any[] | null | undefined} convo  the conversation (its messages)
 * @returns {{ name: string, input: unknown, ok: boolean }[]}
 */
export function callsMade(convo) {
  /** @type {Set<string>} */
  const failed = new Set();
  /** @type {{ id: unknown, name: unknown, input: unknown }[]} */
  const uses = [];
  for (const m of Array.isArray(convo) ? convo : []) {
    if (m?.type === "function_call") uses.push({ id: m.call_id, name: m.name, input: argsOf(m.arguments) });
    if (m?.role === "assistant" && Array.isArray(m.tool_calls))
      for (const c of m.tool_calls) uses.push({ id: c?.id, name: c?.function?.name, input: argsOf(c?.function?.arguments) });
    for (const b of Array.isArray(m?.content) ? m.content : []) {
      if (m.role === "assistant" && b?.type === "tool_use") uses.push({ id: b.id, name: b.name, input: b.input });
      else if (b?.type === "tool_result" && b.is_error) failed.add(b.tool_use_id);
    }
  }
  return uses.map((u) => ({ name: String(u.name || "?"), input: u.input, ok: !failed.has(String(u.id)) }));
}
/**
 * The calls an agent's conversation made, as memory reads them (HarnessV3-Memory M7-D18, M7-D26, M7-D29): each tool, its
 * input in brief with secrets redacted, and whether its result was an error, oldest first (`callsMade`).
 * @param {any[] | null | undefined} convo  the conversation (its messages)
 * @returns {{ tool: string, input: string, ok: boolean }[]}
 */
export function callLog(convo) {
  return callsMade(convo).map((c) => ({ tool: c.name, input: cut(redactSecrets(JSON.stringify(inBrief(c.name, c.input) ?? {})), CALL_INPUT_CHARS), ok: c.ok }));
}
/** A call's arguments as OpenAI sends them, a JSON string: the value it holds, else the string itself. @param {unknown} a */
function argsOf(a) {
  if (typeof a !== "string") return a;
  try {
    return JSON.parse(a);
  } catch {
    return a;
  }
}
/**
 * A call log as a learning model reads it (HarnessV3-Memory M7-D18, M7-D29): the newest `most` calls, oldest first, each
 * `- tool input`, a failed one marked, and how many that is of all of them ("3", or "the newest 40 of 120").
 * @param {{ tool: string, input: string, ok: boolean }[]} calls @param {number} most
 */
export function callsRead(calls, most) {
  const shown = calls.slice(-most);
  return {
    count: shown.length === calls.length ? String(calls.length) : `the newest ${shown.length} of ${calls.length}`,
    lines: shown.map((c) => `- ${c.tool} ${c.input}${c.ok ? "" : " (failed)"}`),
  };
}

/**
 * The message of a turn a coding agent began by itself (HarnessV3-ACP AC3-9), in Filament's words, since nobody typed
 * one: the background tasks whose end the agent read, else that it went on by itself. The archive keeps it as the
 * turn's message, which a model reading the session later reads; the transcript's row draws the tasks. One copy: a
 * turn Filament ran and one read from an agent's own files (services/memory/import) say it the same.
 * @param {string} agent @param {readonly { status: string, summary: string }[]} tasks
 */
export function ownTurnText(agent, tasks) {
  if (!tasks.length) return `${agent} went on by itself.`;
  const [one] = tasks;
  if (tasks.length === 1) return `A background task ended (${one.status || "ended"})${one.summary ? `: ${one.summary}` : "."}`;
  return [`${tasks.length} background tasks ended:`, ...tasks.map((t) => `- (${t.status || "ended"}) ${t.summary || "(no summary)"}`)].join("\n");
}

// Visible text of a message in any wire shape: string content, Anthropic blocks (text, and the text inside
// tool_result blocks), OpenAI string content or content parts, Responses items. Images, thinking and tool inputs
// contribute nothing; a truncation marker (see putMessage) contributes nothing either.
export function textOfMessage(msg) {
  if (msg == null) return "";
  if (typeof msg === "string") return msg;
  if (Array.isArray(msg)) return msg.map(blockText).filter(Boolean).join("\n");
  if (typeof msg !== "object") return "";
  const c = msg.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map(blockText).filter(Boolean).join("\n");
  if (typeof msg.text === "string") return msg.text;
  if (typeof msg.output === "string") return msg.output; // Responses function_call_output
  return "";
}
export function blockText(b) {
  if (b == null) return "";
  if (typeof b === "string") return b;
  switch (b.type) {
    case "text":
    case "input_text":
    case "output_text":
      return typeof b.text === "string" ? b.text : "";
    case "tool_result":
    case "function_call_output":
      return textOfMessage(b.content ?? b.output);
    // A tool Claude Code's ToolSearch loaded, by its name: its result holds those names, and no text.
    case "tool_reference":
      return typeof b.tool_name === "string" ? b.tool_name : "";
    case "image":
    case "input_image":
    case "image_url":
    case "document":
    case "thinking":
    case "redacted_thinking":
    case "reasoning":
    case "tool_use":
    case "server_tool_use":
    case "function_call":
      return "";
    default:
      return textOfMessage(b);
  }
}
/**
 * What a message says, piece by piece, in any wire shape — what a search of the archive reads (the filament-agent plan's
 * Phase 4): its words (`text`), each tool call as its name and its input (`call`), each tool result's text (`result`).
 * Images and thinking (a Responses reasoning item among them) say nothing here.
 * @param {any} msg @returns {{ kind: "text" | "call" | "result", text: string }[]}
 */
export function messagePieces(msg) {
  /** @type {{ kind: "text" | "call" | "result", text: string }[]} */
  const out = [];
  const add = (/** @type {"text" | "call" | "result"} */ kind, /** @type {any} */ s) => {
    const text = String(s ?? "");
    if (text.trim()) out.push({ kind, text });
  };
  if (msg == null || msg.type === "reasoning") return out;
  if (typeof msg === "string") add("text", msg);
  else if (msg.type === "function_call") add("call", `${msg.name ?? ""} ${msg.arguments ?? ""}`);
  else if (msg.type === "function_call_output" || msg.role === "tool") add("result", textOfMessage(msg.output ?? msg.content));
  else {
    for (const b of typeof msg.content === "string" ? [msg.content] : Array.isArray(msg.content) ? msg.content : [])
      if (b?.type === "tool_use" || b?.type === "server_tool_use") add("call", `${b.name ?? ""} ${JSON.stringify(b.input ?? {})}`);
      else if (b?.type === "tool_result") add("result", textOfMessage(b.content));
      else add("text", blockText(b));
    for (const c of Array.isArray(msg.tool_calls) ? msg.tool_calls : []) add("call", `${c?.function?.name ?? ""} ${c?.function?.arguments ?? ""}`);
  }
  return out;
}
// The kind that gives a message its purpose. Assistant messages: a tool call outranks the text around it (the turn
// goes on), text outranks thinking. User messages: text outranks tool results (the user said something), which
// outrank images. OpenAI shapes (string content, tool_calls, role "tool") and Responses items map onto the same six.
export function messageKind(msg, role = msg?.role) {
  if (typeof msg === "string") return msg.trim() ? "text" : "other";
  if (msg == null || typeof msg !== "object") return "other";
  if (role === "tool" || msg.type === "function_call_output") return "tool_result";
  if (msg.type === "function_call" || (Array.isArray(msg.tool_calls) && msg.tool_calls.length))
    return "tool_use";
  if (msg.type === "reasoning") return "thinking";
  const has = new Set();
  const c = msg.content;
  if (typeof c === "string") {
    if (c.trim()) has.add("text");
  } else if (Array.isArray(c)) for (const b of c) has.add(blockKind(b));
  else if (msg.type && msg.type !== "message") has.add(blockKind(msg)); // a bare block
  if (typeof msg.text === "string" && msg.text.trim()) has.add("text");
  if (typeof msg.reasoning_content === "string" && msg.reasoning_content) has.add("thinking");
  const order =
    role === "assistant"
      ? ["tool_use", "text", "thinking", "image", "tool_result"]
      : ["text", "tool_result", "image", "tool_use", "thinking"];
  return order.find((k) => has.has(k)) || "other";
}
export function blockKind(b) {
  if (b == null) return "other";
  if (typeof b === "string") return b.trim() ? "text" : "other";
  switch (b.type) {
    case "text":
    case "input_text":
    case "output_text":
      return String(b.text ?? "").trim() ? "text" : "other";
    case "tool_use":
    case "server_tool_use":
    case "function_call":
      return "tool_use";
    case "tool_result":
    case "function_call_output":
    case "web_search_tool_result":
      return "tool_result";
    case "thinking":
    case "redacted_thinking":
    case "reasoning":
      return "thinking";
    case "image":
    case "input_image":
    case "image_url":
    case "document":
      return "image";
    case "message":
      return messageKind(b, b.role); // Responses output item
    default:
      return "other";
  }
}
