// The agent's side of a turn, read: session/update notifications become the events the application renders and
// the totals the record keeps; a finished prompt's usage becomes token counts. Cursor's own extensions for a call
// (its to-do list, a sub-agent's facts, an image's) are read here too.
import { missingFields, missingNote, undrawnNote } from "./schema.js";
import { CLAUDE_COMPACT_WINDOWS, claudeCompactWindow } from "./toolset.js";
import { agentCompacted } from "../context.js";
import { owes } from "../compactions.js";
import { saysCache } from "../../../core/cache-facts.js";

/**
 * Cursor's own extensions that name a call (its ACP page), with the answer each gets. Cursor sends them as requests
 * right after the call's end and reads nothing of the answer but this word.
 */
export const CURSOR_ANSWERS = Object.freeze({ "cursor/update_todos": "accepted", "cursor/task": "completed", "cursor/generate_image": "generated" });
/** Cursor's tools whose facts come right after their end, in an extension of their own (`cursor/task`, `cursor/generate_image`). */
const DESCRIBED_AFTER = new Set(["task", "generateImage"]);
/**
 * Gemini CLI names no tool on a call, but titles a call to an MCP server's tool "<tool> (<server> MCP Server)" (its
 * `DiscoveredMCPTool`), unless the call has a `command`, which is its title then.
 */
const GEMINI_MCP_TITLE = /^(\S+) \((.+?) MCP Server\)$/;
/**
 * Cursor names no tool on a call to an MCP server's tool either: the call's input says it, `{ providerIdentifier,
 * toolName, args }` and nothing else, and its question before the tool runs is titled "<server>-<tool>: <tool>" (the
 * tool's name as its model knows it, then its own), the arguments its words.
 */
const CURSOR_MCP_INPUT = new Set(["providerIdentifier", "toolName", "args"]);
const CURSOR_MCP_ASKED = /^(.+)-(.+): \2$/;

/**
 * The parameters an agent sends as a call's first words, in JSON (Gemini CLI's explanation of an MCP call; Cursor's
 * question before one, fenced as JSON), as an object; nothing for any other words (Gemini's note for parameters too
 * long to send). @param {any} content
 */
const wordsAsInput = (content) => {
  const c = Array.isArray(content) && content.length === 1 ? content[0] : null;
  const text = (c?.type === "content" && c.content?.type === "text" ? String(c.content.text || "") : "").replace(/^```json\n([\s\S]*)\n```$/, "$1");
  if (!text.startsWith("{")) return undefined;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The server and tool an agy 1.5 call to an MCP server's tool names, run together as `<server>_<tool>`: the longest of
 * the session's servers it begins with, each as agy may write its name (anything but letters, digits, `_` and `-` as
 * `_`), else up to its first `_`. Null where it names no tool.
 * @param {string} joined @param {readonly string[]} servers
 * @returns {{ server: string, tool: string } | null}
 */
function agyServerOf(joined, servers) {
  /** @type {{ server: string, at: number } | null} */
  let best = null;
  for (const s of servers)
    for (const as of new Set([s, s.replace(/[^A-Za-z0-9_-]/g, "_"), s.replace(/[^A-Za-z0-9_]/g, "_")]))
      if (as && joined.length > as.length + 1 && joined.startsWith(`${as}_`) && (!best || as.length > best.at)) best = { server: s, at: as.length };
  if (best) return { server: best.server, tool: joined.slice(best.at + 1) };
  const i = joined.indexOf("_");
  return i > 0 && i < joined.length - 1 ? { server: joined.slice(0, i), tool: joined.slice(i + 1) } : null;
}

/** The MCP servers a session was opened with, by name, Filament's own among them where it was. @param {any} conv @returns {string[]} */
export const serverNames = (conv) => (Array.isArray(conv?.opened?.mcpServers) ? conv.opened.mcpServers.map((/** @type {any} */ s) => String(s?.name || "")).filter(Boolean) : []);

/**
 * A call to an MCP server's tool, as each agent says one (HarnessV3-ACP, AC4's drive D2): Cursor by its input for it;
 * Claude by the tool's own name, `mcp__<server>__<tool>`; Antigravity by its `_meta.mcp` (read in 1.4.5, signed in: its
 * title runs server and tool together with `_`, and its input holds the arguments under `arguments` and again beside
 * them), and from 1.5 by its name alone (read live on 1.5.14: `mcp_<server>_<tool>`, titled "Run mcp_<server>_<tool>",
 * of no kind of its own, its input the arguments with agy's own `toolSummary` beside them, which the server never
 * gets; an update of the call that carries no name, by that title); Gemini CLI by the call's title, Cursor's question before the tool runs by its own — a title names one only on
 * a call of no kind of its own. Its input is its arguments, as this update or question says them; null for any other call.
 * @param {any} tc  an ACP tool call, an update of one, or the call a permission's question is for
 * @param {string} name  the tool's own name, where the agent says it
 * @param {readonly string[]} [servers]  the MCP servers the session was opened with (`serverNames`), which agy's name
 *   runs together with the tool's; Filament's own where none is said
 * @returns {{ server: string, tool: string, input: any } | null}
 */
export function mcpCallOf(tc, name, servers = []) {
  const raw = tc?.rawInput;
  if (raw && typeof raw === "object" && typeof raw.providerIdentifier === "string" && typeof raw.toolName === "string" && Object.keys(raw).every((k) => CURSOR_MCP_INPUT.has(k)))
    return { server: raw.providerIdentifier, tool: raw.toolName, input: raw.args };
  const own = /^mcp__(.+?)__(.+)$/.exec(name);
  if (own) return { server: own[1], tool: own[2], input: raw };
  const agy = tc?._meta?.is_mcp_tool_call === true ? tc._meta.mcp : null;
  if (agy && typeof agy.server === "string" && agy.server && typeof agy.tool === "string" && agy.tool)
    return { server: agy.server, tool: agy.tool, input: raw && typeof raw === "object" && raw.arguments && typeof raw.arguments === "object" ? raw.arguments : raw };
  const ofKind = !tc?.kind || String(tc.kind).toLowerCase() === "other";
  // Its title alone only on an update of the call: a question names the call, and no other agent's is taken for one.
  const joined = typeof tc?.name === "string" ? /^mcp_(.+)$/.exec(tc.name)?.[1] : tc?.sessionUpdate === "tool_call_update" ? /^Run mcp_(.+)$/.exec(String(tc?.title || "").trim())?.[1] : undefined;
  const at = ofKind && joined ? agyServerOf(joined, servers.length ? servers : ["filament"]) : null;
  if (at) return { ...at, input: raw && typeof raw === "object" && "toolSummary" in raw ? Object.fromEntries(Object.entries(raw).filter(([k]) => k !== "toolSummary")) : raw };
  if (name || !ofKind) return null;
  const title = String(tc?.title || "");
  const gemini = GEMINI_MCP_TITLE.exec(title);
  // Gemini's words on an update of the call are its result.
  if (gemini) return { server: gemini[2], tool: gemini[1], input: raw ?? (tc?.sessionUpdate === "tool_call_update" ? undefined : wordsAsInput(tc?.content)) };
  const asked = CURSOR_MCP_ASKED.exec(title);
  return asked ? { server: asked[1], tool: asked[2], input: wordsAsInput(tc?.content) } : null;
}

/**
 * Cursor's to-do list after one of its updates (`cursor/update_todos`): merged by id when the update says `merge` —
 * an item it names changes in place, a new one joins the end — else the update's list, whole.
 * @param {any[] | undefined} was @param {any} params
 * @returns {{ id: string, content: string, status: string }[]}
 */
export function mergeTodos(was, params) {
  const items = (Array.isArray(params?.todos) ? params.todos : [])
    .filter((t) => t && typeof t.content === "string")
    .map((t) => ({ id: String(t.id ?? ""), content: t.content, status: String(t.status || "pending") }));
  if (params?.merge !== true) return items;
  const list = (Array.isArray(was) ? was : []).map((t) => ({ ...t }));
  for (const t of items) {
    const i = t.id ? list.findIndex((x) => x.id === t.id) : -1;
    if (i >= 0) list[i] = t;
    else list.push(t);
  }
  return list;
}

// Added / removed lines of one diff block, the way a code review counts them (multiset difference of lines).
export function diffLineCounts(oldText, newText) {
  const count = (t) => {
    const m = new Map();
    for (const l of String(t || "").split(/\r?\n/)) m.set(l, (m.get(l) || 0) + 1);
    return m;
  };
  const a = count(oldText),
    b = count(newText);
  let added = 0,
    removed = 0;
  for (const [l, n] of b) added += Math.max(0, n - (a.get(l) || 0));
  for (const [l, n] of a) removed += Math.max(0, n - (b.get(l) || 0));
  if (!String(oldText || "").length) ((added = String(newText || "").split(/\r?\n/).length), (removed = 0));
  return { added, removed };
}

/**
 * A raw message's name, the request record's and the Agents page's alike: its type, and its subtype when it has one
 * (`result/success`).
 * @param {any} message
 */
/**
 * Claude's raw messages that say work while it runs (HarnessV3-FailurePoints §5.1 item 2): a task's start, change and
 * progress, and the model's thinking so far. The running turn's to say, and the session's tasks': never held for a turn
 * of the agent's own, nor kept with the session's raw messages, where their numbers would crowd out the work.
 */
export const PROGRESS_FRAMES = new Set(["task_started", "task_updated", "task_progress", "thinking_tokens"]);
/**
 * A sub-agent's end as ACP's sub-agents RFD says it (`subagent_update`, idle, with why it stopped), in the words of the
 * form before it (`subagent_state_update`): an end the agent gives no reason for is no claim it finished.
 */
const RFD_ENDS = Object.freeze({ end_turn: "completed", max_tokens: "completed", max_turn_requests: "completed", refusal: "failed", error: "failed", cancelled: "cancelled" });
/** Whether a raw message is one of the progress frames. @param {any} m */
export const isProgressFrame = (m) => m?.type === "system" && PROGRESS_FRAMES.has(String(m.subtype || ""));

export const rawType = (message) => {
  const type = String(message?.type || "unknown");
  return message?.subtype ? `${type}/${message.subtype}` : type;
};

/** A model message's words: its text, or its text blocks one after another. @param {any} m */
function wordsOf(m) {
  if (typeof m?.content === "string") return m.content;
  return (Array.isArray(m?.content) ? m.content : []).filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
}

/**
 * Claude's words for an API error it met, as one of its raw messages says them: a top-level `<synthetic>` message
 * naming its `error`, with the id its chunks carry (the API message's, else the SDK message's uuid). Null for any
 * other.
 * @param {any} message
 * @returns {{ id: string, words: string } | null}
 */
function apiErrorOf(message) {
  if (message?.type !== "assistant" || message.parent_tool_use_id || !message.error || message.message?.model !== "<synthetic>") return null;
  const id = typeof message.message.id === "string" && message.message.id ? message.message.id : typeof message.uuid === "string" ? message.uuid : "";
  return { id, words: wordsOf(message.message) || String(message.error) };
}

/**
 * A compaction's figures as the agent says them: its context's tokens before and after, its time, and whether it was
 * asked for (a /compact's, `manual`). Those it did not say are left out.
 * @param {any} before @param {any} after @param {any} ms @param {any} trigger
 */
const figuresOf = (before, after, ms, trigger) => ({
  ...(Number(before) > 0 ? { tokensBefore: Number(before) } : {}),
  ...(Number(after) > 0 ? { tokensAfter: Number(after) } : {}),
  ...(Number(ms) > 0 ? { ms: Number(ms) } : {}),
  ...(trigger === "manual" ? { manual: true } : {}),
});

/** How much more of its summary an agent writes before its growth is said again: about fifty tokens. */
const WRITTEN_STEP = 200;

/**
 * The agent compacting its own context, in each way it says it (HarnessV3-ACP AC5-7), read into compaction events: its
 * start, its end, why it failed, its figures and the summary it kept.
 * - ACP's way: `compaction_update`, the summary's chunks coming before its end (`compaction_summary_chunk`).
 *   claude-agent-acp sends them from 0.87 to a client that declares `session.compaction`, as Filament does.
 * - The way before it, and claude-agent-acp's to a client that declares nothing: a call of the agent's own making that
 *   no model made, so not a tool — its "Compact conversation", marked `_meta.contextCompaction` (before 0.87) or named
 *   `compact` (0.87 on), its figures in the mark or in its `rawOutput`.
 * - Claude's raw `compact_boundary` says the figures, which its adapter keeps from ACP's way from 0.87: they go on the
 *   newest compaction that completed without them.
 * One compaction's events share its id. Its start and its end are said once; its figures may come after its end, and
 * an end said again only adds what it says anew. Between them its summary's growth is said as its chunks come
 * (`written`: the chars so far, HarnessV4_Tasks U3-5), at each `WRITTEN_STEP` of it, not at each chunk. `update` reads
 * a session update and `raw` one of Claude's raw messages, into their events; `update` is null for an update that is
 * no compaction's.
 */
export function createCompactionReader() {
  /** What each compaction's summary chunks have said so far. @type {Map<string, string>} */
  const chunks = new Map();
  /** The step of its growth each compaction's last `written` said. @type {Map<string, number>} */
  const told = new Map();
  /** The compactions that started, and those that ended. */
  const started = new Set();
  const ended = new Set();
  /** The newest compaction: whether it failed, and whether its figures were said. */
  let newest = { id: "", failed: false, figured: false };
  /**
   * One compaction's word: its start once, its end once, and what else it says, anew.
   * @param {string} id @param {string} state @param {Record<string, any>} facts
   * @returns {any[]}
   */
  const said = (id, state, facts) => {
    // An agent that names its compactions by no id says them all as one: a start after an end is another compaction's,
    // whose start, end and figures are its own. One that says no start either has only its first told from an end said again.
    if (!id && state === "started" && ended.has(id)) {
      started.delete(id);
      ended.delete(id);
      newest = { id, failed: false, figured: false };
    }
    const first = state === "started" ? !started.has(id) && !ended.has(id) : state ? !ended.has(id) : false;
    if (first) {
      started.add(id);
      if (state !== "started") ended.add(id);
      if (newest.id !== id) newest = { id, failed: false, figured: false };
      newest.failed = state === "failed";
    }
    if (newest.id === id && "tokensBefore" in facts) newest.figured = true;
    if (!first && !Object.keys(facts).length) return [];
    return [{ type: "compaction", id, ...(first ? { state } : {}), ...facts }];
  };
  /** @param {any} u @returns {any[] | null} */
  const update = (u) => {
    const k = u?.sessionUpdate;
    if (k === "compaction_summary_chunk") {
      const id = String(u.compactionId || "");
      if (ended.has(id) || u.content?.type !== "text") return [];
      const sofar = (chunks.get(id) || "") + (u.content.text || "");
      chunks.set(id, sofar);
      const step = Math.floor(sofar.length / WRITTEN_STEP);
      if (step <= (told.get(id) || 0)) return [];
      told.set(id, step);
      return [{ type: "compaction", id, written: sofar.length }];
    }
    if (k === "compaction_update") {
      const id = String(u.compactionId || "");
      const status = String(u.status || "");
      const state = status === "in_progress" ? "started" : status === "completed" ? "completed" : status === "failed" || status === "cancelled" ? "failed" : "";
      // A summary the agent streamed as chunks is not sent again on the end (its adapter's way).
      const summary = Array.isArray(u.summary) ? wordsOf({ content: u.summary }) : state === "completed" ? chunks.get(id) || "" : "";
      const error = status === "cancelled" ? "it was cancelled before it finished" : typeof u.error === "string" ? u.error : "";
      if (state === "completed" || state === "failed") {
        chunks.delete(id);
        told.delete(id);
      }
      return said(id, state, { ...(summary.trim() ? { summary: summary.trim() } : {}), ...(state === "failed" && error ? { error } : {}) });
    }
    if (k !== "tool_call" && k !== "tool_call_update") return null;
    const cc = u._meta?.contextCompaction;
    const named = u._meta?.claudeCode?.toolName === "compact";
    if (!(cc && typeof cc === "object") && !named) return null;
    const facts = cc && typeof cc === "object" ? cc : u.rawOutput && typeof u.rawOutput === "object" ? u.rawOutput : {};
    const status = String(u.status || "");
    const state = status === "completed" || status === "failed" ? status : status ? "started" : "";
    return said(String(u.toolCallId || ""), state, {
      ...figuresOf(facts.preTokens, facts.postTokens, facts.durationMs, facts.trigger),
      ...(typeof facts.error === "string" && facts.error ? { error: facts.error } : {}),
    });
  };
  /** @param {any} message @returns {any[]} */
  const raw = (message) => {
    if (message?.type !== "system" || message.subtype !== "compact_boundary" || message.parent_tool_use_id) return [];
    if (!newest.id || newest.failed || newest.figured) return [];
    const m = message.compact_metadata || {};
    const facts = figuresOf(m.pre_tokens, m.post_tokens, m.duration_ms, m.trigger);
    return Object.keys(facts).length ? said(newest.id, "", facts) : [];
  };
  return { update, raw };
}

/**
 * The reader of a session Filament prompts outside a turn (HarnessV3-ACP AC5-4: the summary the agent writes for
 * Filament; AC5-5: the agent's own compaction, asked for): the text the agent says on the session itself — not a
 * sub-agent's, and not Claude's words for an API error it met, which come as a message of their own and are kept apart
 * (`apiError`) — and its own compaction as it says it (`compaction`: its events merged, each handed to `onEvent`; its
 * figures in Claude's raw messages, `createCompactionReader`) — and the newest figure of what the session has cost so far
 * (`cost`: a `usage_update`'s, Claude's running total). The
 * rest a session's reader is handed reaches nobody: a call asked about or kept from running, a raw message beyond the
 * error, and Cursor's extensions, answered as Cursor's page documents.
 * @param {(ev: any) => void} [onEvent]
 */
export function createTextReader(onEvent = () => {}) {
  let text = "";
  let apiError = "";
  /** @type {number | null} */
  let cost = null;
  /** @type {Set<string>} */
  const apiErrorIds = new Set();
  /** @type {Record<string, any> | null} */
  let compaction = null;
  const compactions = createCompactionReader();
  /** @param {any} ev */
  const heard = (ev) => {
    compaction = { ...compaction, ...ev };
    onEvent(ev);
  };
  /** @param {any} u @param {{ subagent: string } | null} [from] */
  const read = (u, from = null) => {
    if (from) return;
    const evs = compactions.update(u);
    if (evs) return void evs.forEach(heard);
    if (u?.sessionUpdate === "usage_update" && typeof u.cost?.amount === "number") cost = Math.round(u.cost.amount * 1e6) / 1e6;
    if (u?.sessionUpdate !== "agent_message_chunk" || u.content?.type !== "text") return;
    if (!apiErrorIds.has(u.messageId)) text += u.content.text || "";
  };
  read.asked = () => {};
  read.notRun = () => {};
  read.touch = () => {};
  /** @param {any} message */
  read.raw = (message) => {
    compactions.raw(message).forEach(heard);
    const e = apiErrorOf(message);
    if (!e) return;
    if (e.id) apiErrorIds.add(e.id);
    apiError = e.words;
  };
  /** @param {string} method */
  read.ext = (method) => ({ outcome: { outcome: /** @type {Record<string, string>} */ (CURSOR_ANSWERS)[method] } });
  /** What the agent said. */
  read.text = () => text;
  /** Claude's words for the API error it met, the newest; "" when it met none. */
  read.apiError = () => apiError;
  /** The agent's own compaction as it said it — its state, its figures, its error, its summary — or null when it said none. */
  read.compaction = () => compaction;
  /** The newest figure of what the session has cost so far, as the agent said it; null where it said none. */
  read.cost = () => cost;
  return read;
}

/**
 * The window a `usage_update` names, where it is the model's: a size, or null (HarnessV4_Tasks A8). Claude's adapter
 * (0.87.0) names the window it holds for the session, which a turn's result corrects to the model's own
 * (`modelUsage`'s `contextWindow`); until then it is Claude Code's `getContextUsage().rawMaxTokens`, and that is the
 * auto-compact window the session was opened with (A3) — every update of a session's first turn, and of a turn
 * stopped before its result. A size that is the window the session's line handed is the line's, not the model's:
 * taken as the model's, the meter drew the line as a share of it, the share the person then set moved the line once
 * the model's came back, and the next turn's line was the share of the wrong one (seen live: a 400,000 line was a
 * 433,000-token window, then 93% of 1,000,000). The most window Claude Code takes is the 1M models' own, and stands.
 * @param {any} size @param {any} conv
 */
export function modelWindow(size, conv) {
  if (!(typeof size === "number" && size > 0)) return null;
  const handed = conv?.line != null ? claudeCompactWindow(conv.line).window : null;
  return handed != null && size === handed && handed < CLAUDE_COMPACT_WINDOWS.most ? null : size;
}

/** How long Claude may stay idle, owing an answer to a background task, before the turn ends without it. */
const FOLLOWUP_IDLE_MS = 3000;
/** How long the agent's own turn waits after its cycle's result for what Claude's adapter says of it (its usage). */
const OWN_CLOSE_MS = 2000;

/**
 * The listener for one turn's session/update stream. `out` accumulates what the turn produced; every update is
 * activity (`heard`): Claude owing an answer to a background task is idle only after a quiet while. An update is read
 * against ACP's schema as pinned (HarnessV3-ACP AC0-2): a kind the reader does not draw, and a drawn one that
 * lacks what the schema requires, are named in the notes, once per kind a turn.
 * A sub-agent's own session reaches the reader of the turn that launched it (AC1-2): its events say whose they are.
 * `raw` takes Claude's raw SDK messages, which come beside the updates; the newest `keepRaw` of them stay on the
 * conversation (`conv.raw`, in memory only — AC1-7). Claude's words for an API error it met come among them, as a
 * message of their own, and the prompt then fails with them: they are kept off the reply (`apiError`), for the
 * failure to say once.
 * `followup` is the rest of the turn: Claude reads a background task that ended (its sub-agent, a command it left
 * running) in its next model call, and answers one that ended after the turn's last call in a cycle of its own — which
 * the adapter holds the prompt for only while a sub-agent the turn launched still runs. What such a cycle spent no
 * prompt's answer reports (`followups`), unless it took in words queued at the agent, still waiting for their answer,
 * which then reports it (`carried`, asked as its result comes).
 * `own`: the turn shows a cycle Claude began by itself, between turns (HarnessV3-ACP AC3-9): it ends with the cycle's
 * result (`ownEnd`) and what the adapter says after it — the context's size, Claude going idle — or OWN_CLOSE_MS
 * after it; what the result says it spent is the turn's (`ownSpend`), and the cycles after it, of words it took once it
 * ended, spent theirs (`resultsAfterOwn`); a model cycle after its result (`ownOver`) is not the turn's unless the turn
 * reads on for words it queued, still waiting for the cycle that runs them (`readsOn`). `state` is Claude's word for
 * whether it works, as it stood when the turn began. While the agent waits on Filament's answer to something it asked
 * (`waitsOn`: a permission, a write, a command), it is not idle, whatever its word.
 */
export function createUpdateReader({ out, conv, turn, onEvent, notes, keepRaw = 0, own = false, state = "", carried = (/** @type {any} */ _result) => false, readsOn = () => false, waitsOn = () => false }) {
  const named = new Set();
  /** A background task ended (`task_notification`) since Claude's last model call began: no call has read it yet. */
  let unread = false;
  /** The turn's own cycle is over (its `result` came): a model call after it begins a cycle of Claude's own. */
  let cycleOver = false;
  /** A cycle reads a task that ended (it began while one was unread, after the turn's own), and its result has not come. */
  let answering = false;
  /** Whose Claude's newest message was: a sub-agent's (the call that launched it), or the turn's own (null). */
  let rawFrom = null;
  /** The model Claude's newest message of the turn's own ran on: the model a cycle's result counts its usage under. */
  let mainModel = "";
  /** Claude's words for an API error it met: a top-level `<synthetic>` message naming its `error`. */
  let apiError = "";
  /** The ids that message's chunks carry: its words are the failure's, not the reply's. @type {Set<string>} */
  const apiErrorIds = new Set();
  /** Claude's own word for whether it is working (`session_state_changed`). */
  let agentState = state;
  /** The result that ended the cycle an `own` turn shows. @type {any} */
  let ownResult = null;
  /** What that cycle spent, by its result (`resultSpend`). @type {ReturnType<typeof resultSpend> | null} */
  let ownSpent = null;
  /** How many of the turn's own cycles' results had come by that result, it among them. */
  let ownAt = 0;
  /** What the turn's own cycles spent, in order, as their results say it (`resultSpend`). @type {ReturnType<typeof resultSpend>[]} */
  const cycleResults = [];
  /** What the answers to those cycles left out of their rows, in the same order (`unlistedOf`). @type {(ReturnType<typeof unlistedOf>)[]} */
  const cycleUnlisted = [];
  /**
   * What Claude's answers to background tasks spent, in order, by their results; `carried`: the answer took in queued
   * words, whose answer reports it.
   * @type {{ spent: ReturnType<typeof resultSpend>, carried: boolean }[]}
   */
  const followResults = [];
  /** What the adapter says after that result has come, or its wait is over. */
  let ownClosed = false;
  /** A model cycle began, or ended, in what the turn read: an own turn a sub-agent's question drew may read none. */
  let cycled = false;
  /** The agent compacted its context during the turn, after the turn's prompt (AC-R4). */
  let compactedHere = false;
  /** The agent compacting its own context, and its sub-agents theirs, each session's own (AC5-7). */
  const compactions = createCompactionReader();
  const subCompactions = createCompactionReader();
  const closeOwn = () => {
    ownClosed = true;
    wake?.();
  };
  let heard = Date.now();
  /** The waiting `followup`'s look at what changed. @type {(() => void) | null} */
  let wake = null;
  const heardNow = () => {
    heard = Date.now();
  };
  const say = (k, note) => {
    if (named.has(k)) return;
    named.add(k);
    notes.push(note);
  };
  /** Each call's own tool name, as the agent said it on any of its updates. */
  const toolNames = new Map();
  /** The calls a permission's question announced (`read.asked`): whole, as the agent is about to run them. */
  const askedCalls = new Set();
  /**
   * The ending update of a call whose facts Cursor sends right after it (DESCRIBED_AFTER): held until they come, the
   * agent's next update, or the turn's end (`flush`), so the call ends once, with them.
   * @type {{ id: string, ev: any, emit: (ev: any) => void } | null}
   */
  let held = null;
  const release = () => {
    if (!held) return;
    const { ev, emit } = held;
    held = null;
    emit(ev);
  };
  /**
   * The agent compacting its own context (`createCompactionReader`): its events, and once it completed, the record says
   * so. The summary of a session that holds less than the whole chat (`owes`) is said for that (`partial`): Filament's
   * copy of the chat does not start from it.
   * @param {any} ev @param {(ev: any) => void} emit @param {boolean} sub  a sub-agent's session sent it
   */
  const compaction = (ev, emit, sub) => {
    emit(ev.summary && !sub && owes(conv) ? { ...ev, partial: true } : ev);
    if (ev.state === "completed" && !sub) {
      say("compaction", "acp: the agent compacted its context during this turn");
      // What Filament said ahead of its prompts may be summarised away, steering too: the next prompt says it again
      // (AC4-1, AC-R4).
      compactedHere = true;
      if (conv) agentCompacted(conv);
    }
  };
  /** @param {any} u @param {{ subagent: string } | null} [from]  the sub-agent whose session sent it */
  const read = (u, from = null) => {
    heardNow();
    wake?.();
    release();
    const sub = from?.subagent || null;
    const emit = sub ? (ev) => onEvent({ ...ev, subagent: sub }) : onEvent;
    const k = u.sessionUpdate;
    // A chunk names its model call (`messageId`): where it changes, the agent's next round begins.
    const msg = typeof u.messageId === "string" && u.messageId ? { messageId: u.messageId } : {};
    const compacting = (sub ? subCompactions : compactions).update(u);
    if (k === "agent_message_chunk") {
      const t = u.content?.type === "text" ? u.content.text || "" : "";
      if (t && !apiErrorIds.has(u.messageId)) emit({ type: "text", text: t, ...msg });
    } else if (k === "agent_thought_chunk") {
      const t = u.content?.type === "text" ? u.content.text || "" : "";
      if (t) emit({ type: "thought", text: t, ...msg });
    } else if (compacting) {
      for (const ev of compacting) compaction(ev, emit, !!sub);
    } else if (k === "tool_call" || k === "tool_call_update") {
      let rec = out.tools.find((t) => t.id === u.toolCallId);
      if (!rec) {
        rec = { id: u.toolCallId, title: u.title || "", kind: u.kind || "", status: u.status || "pending" };
        out.tools.push(rec);
        // When it began, on the agent's process: what a stop reads to know what its command started (B13).
        turn?.proc?.callBegan?.(turn, rec.id);
      } else {
        if (u.title) rec.title = u.title;
        if (u.kind) rec.kind = u.kind;
        if (u.status) rec.status = u.status;
      }
      for (const c of Array.isArray(u.content) ? u.content : [])
        if (c && c.type === "diff") {
          const d = diffLineCounts(c.oldText, c.newText);
          out.linesAdded = (out.linesAdded || 0) + d.added;
          out.linesRemoved = (out.linesRemoved || 0) + d.removed;
        }
      const meta = u._meta || {};
      const parent = meta.claudeCode?.parentToolUseId || meta.parentToolCallId || null;
      const to = meta.terminal_output;
      const tx = meta.terminal_exit;
      const terminalOutput =
        to != null
          ? {
              output: typeof to === "string" ? to : (to.output ?? to.data ?? to.text ?? ""),
              exitCode: tx?.exitCode ?? tx?.exit_code ?? null,
            }
          : null;
      // Tag a call that came through Filament's OWN MCP toolset rather than the agent's built-in tools. It has to be
      // decided here, where the `mcp__filament__` prefix is still on the title: the rewrite below strips it, so
      // nothing downstream could tell the two apart — and the steering leak rate (P6) is exactly that distinction.
      if (/^`?mcp__filament__/.test(rec.title)) rec.routed = true;
      // Same prefix test as the routing tag above, backtick and all: the two used to differ, so a title wrapped in
      // backticks was counted as routed yet never decoded — the agent's raw `mcp__filament__Read` stayed on screen
      // instead of `Read <path>`, and the kind stayed "other". One spelling, in both places; the closing backtick goes
      // with the opening one, as acp-render.js reads the title.
      if (/^`?mcp__filament__/.test(rec.title) && u.rawInput && typeof u.rawInput === "object") {
        const ri = u.rawInput;
        const name = rec.title.replace(/^`?mcp__filament__/, "").replace(/`$/, "");
        const target = ri.file_path || ri.command || ri.pattern || ri.path || "";
        rec.title = `${name}${target ? " " + String(target).slice(0, 160) : ""}`;
        if (!rec.kind || rec.kind === "other")
          rec.kind =
            name === "Bash"
              ? "execute"
              : name === "Edit" || name === "Write"
                ? "edit"
                : name === "Glob" || name === "Grep"
                  ? "search"
                  : name === "Read"
                    ? "read"
                    : rec.kind;
      }
      // The tool's own name, where the agent says it: Claude's adapter on every update of the call, Qoder where it
      // announces the call (`_meta.qoder`), Cursor in the input of its own tools (`_toolName`: task, updateTodos,
      // askQuestion, createPlan, generateImage).
      const said = [meta.claudeCode?.toolName, meta.qoder?.toolName, u.rawInput?._toolName].find((n) => typeof n === "string" && n) || "";
      if (said) toolNames.set(u.toolCallId, said);
      // A call to an MCP server's tool, however the agent says it, is named as Claude names one, its arguments its
      // input; one to Filament's own server is routed, as Claude's is.
      const mcp = mcpCallOf(u, said, serverNames(conv));
      if (mcp) toolNames.set(u.toolCallId, `mcp__${mcp.server}__${mcp.tool}`);
      if (mcp?.server === "filament") rec.routed = true;
      const input = mcp ? mcp.input : u.rawInput;
      const ev = {
        type: "tool",
        phase: k === "tool_call" ? "call" : "update",
        id: u.toolCallId,
        title: rec.title,
        kind: rec.kind,
        status: rec.status,
        routed: !!rec.routed,
        content: u.content,
        locations: u.locations,
        rawInput: input,
        rawOutput: u.rawOutput,
        toolName: toolNames.get(u.toolCallId) || "",
        parentToolCallId: parent,
        ...(askedCalls.has(u.toolCallId) ? { asked: true } : {}),
        terminalOutput,
        exitCode: tx?.exitCode ?? tx?.exit_code ?? null,
      };
      if ((rec.status === "completed" || rec.status === "failed") && DESCRIBED_AFTER.has(ev.toolName)) held = { id: String(u.toolCallId), ev, emit };
      else emit(ev);
    } else if (k === "plan") {
      const entries = Array.isArray(u.entries) ? u.entries : [];
      // The client's own task list, when it has one: a TodoWrite tool call instead of a text checklist (the agent is
      // not blocked by it). A sub-agent's plan is its own, never the client's or the turn's — and Claude's adapter
      // names no sub-agent on one: it sends a plan right after the message it read it from (a TodoWrite call, a task
      // tool's result), which says whose it is.
      const owner = sub || rawFrom;
      onEvent({ type: "plan", entries, ...(owner ? { subagent: owner } : { bridged: turn.bridgePlan(entries) || undefined }) });
    } else if (k === "available_commands_update")
      onEvent({ type: "commands", commands: conv.commands || [] });
    else if (k === "usage_update" || k === "usage") {
      // The size as the model's window, or none (`modelWindow`): the meter, the turn's facts and the model's window
      // Filament keeps all read it from here.
      const size = modelWindow(u.size, conv);
      // An agent that compacts with no word of it (Gemini CLI compresses its history and says nothing): what it holds
      // falling to under half, from 20,000 tokens or more in the same session, is taken as its compaction, so the next
      // prompt says Filament's standing context again (the review of 11-10: summarised away, it was never said again).
      if (typeof u.used === "number" && !sub && conv) {
        const before = conv.usedSeenIn === conv.sessionId ? Number(conv.usedSeen) || 0 : 0;
        if (!compactedHere && before >= 20000 && u.used < before / 2) {
          say("compaction", `acp: the agent's context fell from ${before.toLocaleString("en-US")} to ${u.used.toLocaleString("en-US")} tokens with no compaction said: taken as one, and Filament's standing context is said again`);
          compactedHere = true;
          agentCompacted(conv);
        }
        conv.usedSeen = u.used;
        conv.usedSeenIn = conv.sessionId;
      }
      if (typeof u.used === "number")
        out.context = {
          used: u.used,
          size,
          cost:
            u.cost && typeof u.cost.amount === "number"
              ? Math.round(u.cost.amount * 1e6) / 1e6
              : (out.context?.cost ?? null),
        };
      onEvent({ type: "usage", usage: size === u.size ? u : { ...u, size } });
      if (ownResult) closeOwn();
    } else if (k === "notice") {
      // What the agent tells the person beside its answer (HarnessV4_Tasks C21; ACP's session notices, which Filament
      // declares): a line of its own on the page, never the reply's words. Plain text, as ACP has it; a sub-agent's
      // says whose.
      const title = typeof u.title === "string" ? u.title.trim() : "";
      const description = typeof u.description === "string" ? u.description.trim() : "";
      if (title) emit({ type: "agent-notice", severity: typeof u.severity === "string" && u.severity ? u.severity : "info", title, ...(description ? { description } : {}) });
    } else if (k === "session_info_update") {
      if (typeof u.title === "string" && u.title.trim()) {
        out.title = u.title.trim().slice(0, 120);
        onEvent({ type: "info", title: out.title });
      }
    } else if (k === "current_mode_update" || k === "config_option_update") {
      onEvent({ type: "config", mode: conv.mode, modelId: conv.modelId, effort: conv.effort });
    } else if (k === "subagent_spawned" || k === "subagent_started")
      emit({
        type: "subagent",
        state: "spawned",
        id: u.subagentSessionId || u.agentId || u.toolCallId || "",
        name: u.name || u.agentType || u.subagentType || "",
        // Claude's adapter says what it was asked as `task`.
        description: u.task || u.description || (typeof u.prompt === "string" ? u.prompt : ""),
      });
    else if (k === "subagent_state_update")
      emit({ type: "subagent", state: u.state || "", id: u.subagentSessionId || u.agentId || "" });
    else if (k === "subagent_update") {
      // ACP's sub-agents RFD, as Claude's adapter speaks it from 0.93: the child's session announced on its parent's,
      // running — its title the agent's type, its description what its launch was called — and its end there, idle.
      // Waiting on a question (`requires_action`) says nothing: the question is drawn as it comes.
      const id = typeof u.sessionId === "string" ? u.sessionId : "";
      const state = String(u.state?.state || "");
      if (state === "idle") emit({ type: "subagent", state: RFD_ENDS[String(u.state?.stopReason || "")] || "disconnected", id });
      else if (state === "unknown") emit({ type: "subagent", state: "disconnected", id });
      else if (state === "running" || (!state && (u.title || u.description)))
        emit({ type: "subagent", state: "spawned", id, name: String(u.description || u.title || ""), description: "", ...(u.title ? { kind: String(u.title) } : {}) });
    } else if (k === "session_message" || k === "session_message_chunk") {
      /* what a sub-agent is told on its own session (the RFD): its launch's prompt, which the launch's card holds */
    } else if (k === "user_message_chunk") {
      /* history replay after session/load: the client already has it */
    } else {
      if (k) say(k, undrawnNote(k));
      return;
    }
    const missing = missingFields(u);
    if (missing.length) say(k, missingNote(k, missing));
  };
  /**
   * One of Cursor's extensions (CURSOR_ANSWERS) for a call of this turn: its to-do list becomes the turn's plan, merged
   * into the session's (`conv.todos`, which Cursor keeps across turns), the cancelled items left out; a sub-agent's
   * model and an image's file join the call's held end. Returns Cursor's answer.
   * @param {string} method @param {any} params
   */
  read.ext = (method, params) => {
    heardNow();
    if (method === "cursor/update_todos") {
      release();
      conv.todos = mergeTodos(conv.todos, params);
      const entries = conv.todos.filter((t) => t.status !== "cancelled").map((t) => ({ content: t.content, status: t.status, priority: "medium" }));
      onEvent({ type: "plan", entries, bridged: turn.bridgePlan(entries) || undefined });
    } else if (held && held.id === String(params?.toolCallId || "")) {
      const { ev } = held;
      if (method === "cursor/task" && typeof params.model === "string" && params.model) ev.model = params.model;
      if (method === "cursor/generate_image" && typeof params.filePath === "string" && params.filePath) ev.file = params.filePath;
      release();
    }
    return { outcome: { outcome: CURSOR_ANSWERS[method] } };
  };
  /**
   * The call a permission request is for, read as an update of it (ACP's request describes its call): an agent that
   * asks before a call runs may announce that call only there (Gemini CLI, Qoder), so its card is drawn from it. A
   * call heard of before keeps its status.
   * @param {any} toolCall @param {{ subagent: string } | null} [from]  the sub-agent whose session asked
   */
  read.asked = (toolCall, from = null) => {
    if (!toolCall?.toolCallId) return;
    askedCalls.add(toolCall.toolCallId);
    const known = out.tools.some((t) => t.id === toolCall.toolCallId);
    const { status, ...call } = toolCall;
    read({ ...call, sessionUpdate: known ? "tool_call_update" : "tool_call", ...(known ? {} : { status: status || "pending" }) }, from);
  };
  /**
   * A call its permission's answer kept from running ends there (`declined`: the person's answer; `refused`: a rule's,
   * the switch's or the permission policy's, `why` saying which; `stopped`: the turn stopped while it was asked): such
   * an agent says nothing more of a call it never ran. One that ended is left as it is.
   * @param {string} toolCallId @param {"declined" | "refused" | "stopped"} how @param {string} why
   * @param {{ subagent: string } | null} [from]  the sub-agent whose session asked
   */
  read.notRun = (toolCallId, how, why, from = null) => {
    const rec = out.tools.find((t) => t.id === toolCallId);
    if (!rec || rec.status === "completed" || rec.status === "failed") return;
    rec.status = "failed";
    const ev = { type: "tool", phase: "update", id: toolCallId, title: rec.title, kind: rec.kind, status: "failed", routed: !!rec.routed, toolName: toolNames.get(toolCallId) || "", notRun: how, ...(why ? { why } : {}) };
    onEvent(from?.subagent ? { ...ev, subagent: from.subagent } : ev);
  };
  /**
   * The agent asked Filament for something (a file, a terminal's output), or had its answer: activity, as its words
   * are. Claude polling a command Filament runs for it, saying nothing else, has not gone idle on the answer it owes
   * (the bug report's L23): the quiet while starts again from now.
   */
  read.touch = () => {
    heardNow();
    wake?.();
  };
  /** The turn is over: a call's held end goes out as it is. */
  read.flush = release;
  /** The agent compacted its context during the turn: what the turn's prompt said may be gone with it (AC-R4). */
  read.compacted = () => compactedHere;
  /** Claude's words for the API error it met during the turn, the newest; "" when it met none. */
  read.apiError = () => apiError;
  /** The model Claude's newest message of its own ran on, as the message names it; "" where none named one. */
  read.mainModel = () => mainModel;
  /** One of Claude's raw SDK messages (AC1-2): the model's own message, a tool's result, the turn's result. @param {any} message */
  read.raw = (message) => {
    heardNow();
    if (!message || typeof message !== "object") return;
    if (message.type === "assistant" || message.type === "user") rawFrom = message.parent_tool_use_id ? String(message.parent_tool_use_id) : null;
    const model = message.type === "assistant" && !rawFrom ? message.message?.model : null;
    if (typeof model === "string" && model && model !== "<synthetic>") mainModel = model;
    const met = apiErrorOf(message);
    if (met) {
      if (met.id) apiErrorIds.add(met.id);
      apiError = met.words;
    }
    for (const ev of compactions.raw(message)) compaction(ev, onEvent, false);
    // A housekeeping task is not the model's to answer (the SDK's `skip_transcript`, `ambient`). Each of Claude's model
    // calls (`status: requesting`) reads every task that ended before it; a cycle of its own that reads one ends with a
    // result that says so (`origin: task-notification`).
    const sys = message.type === "system" ? String(message.subtype || "") : "";
    if (sys === "task_notification" && !message.skip_transcript && !message.ambient) unread = true;
    else if (sys === "status" && message.status === "requesting") {
      if (unread && cycleOver) answering = true;
      unread = false;
      cycled = true;
    } else if (sys === "session_state_changed") {
      agentState = String(message.state || "");
      if (ownResult && agentState === "idle") ownClosed = true;
    } else if (message.type === "result") {
      cycled = true;
      if (own && !ownResult) {
        ownResult = message;
        ownSpent = resultSpend(message, mainModel);
        setTimeout(closeOwn, OWN_CLOSE_MS).unref?.();
      }
      // The cycle that read a task's end is over with its result: Claude's answer to it, or the cycle of words queued at
      // the agent that read it in one of its calls, whose result names the words' origin.
      answering = false;
      if (message.origin?.kind === "task-notification") {
        followResults.push({ spent: resultSpend(message, mainModel), carried: !!carried(message) });
      } else {
        cycleOver = true;
        cycleResults.push(resultSpend(message, mainModel));
        cycleUnlisted.push(unlistedOf(message, mainModel));
      }
      if (message === ownResult) ownAt = cycleResults.length;
    }
    if (keepRaw > 0 && !isProgressFrame(message)) {
      const kept = (conv.raw ||= []);
      kept.push({ at: Date.now(), type: rawType(message), message });
      if (kept.length > keepRaw) kept.splice(0, kept.length - keepRaw);
    }
    onEvent({ type: "raw", message });
    wake?.();
  };
  /**
   * When what the turn waits for has come (`owed` turns false): `answered`; else Claude stays idle without it (`idle`),
   * or the turn is stopped (`stopped`). While Claude works no clock bounds the wait: its process ending does, raced
   * by the bridge (`ending`).
   * @param {() => boolean} owed @param {AbortSignal | null} signal
   * @returns {Promise<"answered" | "idle" | "stopped">}
   */
  const awaitOwed = (owed, signal) => {
    if (!owed()) return Promise.resolve("answered");
    if (signal?.aborted) return Promise.resolve("stopped");
    return new Promise((resolve) => {
      /** @type {any} */
      let timer = null;
      /** @param {"answered" | "idle" | "stopped"} how */
      const done = (how) => {
        clearTimeout(timer);
        wake = null;
        signal?.removeEventListener("abort", stop);
        resolve(how);
      };
      const stop = () => done("stopped");
      const check = () => {
        if (!owed()) return done("answered");
        clearTimeout(timer);
        // Claude works on what the turn waits for at once: idle (or never saying) for long, it is not coming.
        if (agentState !== "running" && agentState !== "requires_action" && !waitsOn()) timer = setTimeout(() => done("idle"), Math.max(0, FOLLOWUP_IDLE_MS - (Date.now() - heard)));
      };
      wake = check;
      signal?.addEventListener("abort", stop, { once: true });
      check();
    });
  };
  /**
   * The turn's end, once its prompt settled: at once when no task that ended is left for Claude to answer; else when
   * the cycle that answers it ends, Claude stays idle without one, or the turn is stopped (`awaitOwed`).
   * @param {AbortSignal | null} [signal]
   */
  read.followup = (signal = null) => awaitOwed(() => unread || answering, signal);
  /**
   * The end of the cycle an `own` turn shows: its result and what the adapter says after it (`answered`), Claude idle
   * without one, or a stop.
   * @param {AbortSignal | null} [signal]
   */
  read.ownEnd = (signal = null) => awaitOwed(() => !ownResult || !ownClosed, signal);
  /** Whether the cycle an `own` turn shows has had its result. */
  read.ownOver = () => !!ownResult;
  /** Whether a model cycle began or ended in what the turn read. */
  read.cycled = () => cycled;
  /** Whether the turn reads on past that cycle: words it queued still wait for the cycle that runs them. */
  read.readsOn = () => readsOn();
  /** What the cycle an `own` turn shows spent, by its result — its usage and the models that counted it; null before it came. */
  read.ownSpend = () => ownSpent;
  /** What the cycles after the one an `own` turn shows spent, by their results: none before its result came. */
  read.resultsAfterOwn = () => (ownResult ? cycleResults.slice(ownAt) : []);
  /** How many results of the turn's own cycles have come (a background task's answer is no cycle of its prompts). */
  read.resultsHeard = () => cycleResults.length;
  /** What the turn's own cycles whose results came after the first `n` spent. @param {number} n */
  read.resultsSince = (n) => cycleResults.slice(n);
  /**
   * What the answers to the turn's first `n` cycles left out of their rows (`unlistedOf`), from its cycle `from` on: the
   * calls the first result of a query that resumed the session counted beyond its main loop's. Every cycle's where no
   * `n` is given.
   * @param {number} [n] @param {number} [from]
   */
  read.unlisted = (n = cycleUnlisted.length, from = 0) => /** @type {ReturnType<typeof resultSpend>[]} */ (cycleUnlisted.slice(from, n).filter(Boolean));
  /**
   * What Claude's answers to background tasks heard by the turn spent: those whose queued words' answer reports it
   * too where `carriedToo` (that answer never came).
   * @param {boolean} [carriedToo]
   */
  read.followups = (carriedToo = false) => followResults.filter((f) => carriedToo || !f.carried).map((f) => f.spent);
  return read;
}

/**
 * What one of Claude's cycles spent, by its result (its raw `result` message, which says it however the cycle ended):
 * its usage as the API counts it; null where it says none.
 * @param {any} message
 */
export function readResultUsage(message) {
  const u = message?.usage;
  if (!u || typeof u !== "object" || (typeof u.input_tokens !== "number" && typeof u.output_tokens !== "number")) return null;
  return {
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
    cacheWrite: u.cache_creation_input_tokens || 0,
    total: null,
    ...seenIf(saysCache(u.cache_read_input_tokens, u.cache_creation_input_tokens)),
  };
}

/** The mark of a usage that carried a cache count (core/cache-facts.js): nothing where it carried none. @param {unknown} said */
const seenIf = (said) => (said ? { cacheSeen: true } : {});

/**
 * The models that counted one of Claude's cycles, by its result: its usage, under the model its main thread ran on
 * (`model`) as the result's `modelUsage` spells it — the key sharing the longest start with it, as Claude's adapter
 * matches them ("claude-sonnet-5[1m]" for "claude-sonnet-5") — else as the message said it. That `modelUsage` is no
 * cycle's own: Claude's SDK says the session's running total there, every model call since the session opened, so a
 * sub-agent's calls in the cycle go unnamed rather than the session's whole spend named. Null where no model is known,
 * or the result says nothing spent.
 * @param {any} message @param {string} model
 */
export function readResultModelUsage(message, model) {
  const u = readResultUsage(message);
  if (!u || !model || u.input + u.output + u.cacheRead + u.cacheWrite === 0) return null;
  const mu = message.modelUsage && typeof message.modelUsage === "object" ? message.modelUsage : {};
  let named = model;
  let shared = 0;
  for (const key of Object.keys(mu)) {
    let n = 0;
    while (n < key.length && key[n] === model[n]) n++;
    if (n > shared) [named, shared] = [key, n];
  }
  return [{ model: named, input: u.input, output: u.output, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite }];
}

/**
 * What one of Claude's cycles spent, by its result: every call's, each under its model, where the bridge read what the
 * session's running totals grew by with it (`ledgerSpend` — its sub-agents' calls beside its main loop's); else its
 * usage, its main loop's, under the model its main thread ran on (`readResultModelUsage`).
 * @param {any} message @param {string} model
 */
export function resultSpend(message, model) {
  const grew = ledgerSpend.get(message)?.grew;
  const rows = grew ? Object.entries(grew).map(([name, t]) => ({ model: name, ...t })) : [];
  return rows.length ? spendOfRows(rows, readResultUsage(message)?.cacheSeen) : { usage: readResultUsage(message), modelUsage: readResultModelUsage(message, model) };
}

/**
 * Calls by model as what they spent together: their usage summed, and the rows themselves. `said`: whether the
 * result they are read from carried a cache count (`readResultUsage`), which the running totals alone do not tell.
 * @param {({ model: string } & Tokens)[]} rows @param {unknown} [said]
 */
function spendOfRows(rows, said) {
  const sum = (/** @type {keyof Tokens} */ k) => rows.reduce((n, r) => n + r[k], 0);
  return { usage: { input: sum("input"), output: sum("output"), cacheRead: sum("cacheRead"), cacheWrite: sum("cacheWrite"), total: /** @type {number | null} */ (null), ...seenIf(said) }, modelUsage: rows };
}

/** @typedef {{ input: number, output: number, cacheRead: number, cacheWrite: number }} Tokens */

/**
 * What the bridge read of each of Claude's results against its session's running totals (`#heardRun`): what the
 * result's reading grew by over the one before it, by model (`grew`; null where the reading it grew from is not known),
 * and whether Claude's adapter lists the answer's rows as its main loop's alone (`mainOnly`: the first result of a query
 * that resumed the session).
 * @type {WeakMap<object, { grew: Record<string, Tokens> | null, mainOnly: boolean }>}
 */
export const ledgerSpend = new WeakMap();

/**
 * A result's `modelUsage` as the running totals by model it is (Claude's SDK: every call of the query's, its sub-agents'
 * too); null where it counts nothing — a crashed run's zeroed result says nothing of those totals.
 * @param {any} mu
 * @returns {Record<string, Tokens> | null}
 */
export function readingOf(mu) {
  if (!mu || typeof mu !== "object") return null;
  /** @type {Record<string, Tokens>} */
  const out = {};
  for (const [model, u] of Object.entries(mu)) {
    if (!u || typeof u !== "object") continue;
    out[model] = { input: Number(u.inputTokens) || 0, output: Number(u.outputTokens) || 0, cacheRead: Number(u.cacheReadInputTokens) || 0, cacheWrite: Number(u.cacheCreationInputTokens) || 0 };
  }
  return Object.values(out).some((t) => t.input + t.output + t.cacheRead + t.cacheWrite > 0) ? out : null;
}

/**
 * What a reading grew by over an earlier one, each model that grew: a model whose count fell began again (a /clear),
 * its reading its growth, as Claude's adapter reads them (`modelUsageIncrement`).
 * @param {Record<string, Tokens>} reading @param {Record<string, Tokens>} base
 * @returns {Record<string, Tokens>}
 */
export function growth(reading, base) {
  /** @type {Record<string, Tokens>} */
  const out = {};
  for (const [model, t] of Object.entries(reading)) {
    const b = base[model];
    const d = b ? { input: t.input - b.input, output: t.output - b.output, cacheRead: t.cacheRead - b.cacheRead, cacheWrite: t.cacheWrite - b.cacheWrite } : t;
    const g = d.input < 0 || d.output < 0 || d.cacheRead < 0 || d.cacheWrite < 0 ? t : d;
    if (g.input + g.output + g.cacheRead + g.cacheWrite > 0) out[model] = g;
  }
  return out;
}

/**
 * What the answer to one of Claude's cycles left out of its rows, where Claude's adapter lists them as the main loop's
 * alone (the first result of a query that resumed the session: its reading carries what the transcript saved, which
 * the adapter cannot tell from the turn's own): what the result's reading grew by beyond its main loop's usage — its
 * sub-agents' calls, each under its model (`ledgerSpend`). Null where nothing was left out, or nothing tells it.
 * @param {any} message @param {string} model  the model the main loop ran on
 */
function unlistedOf(message, model) {
  const seen = ledgerSpend.get(message);
  const grew = seen?.mainOnly ? seen.grew : null;
  const main = grew ? readResultModelUsage(message, model)?.[0] : null;
  if (!grew || !main || !grew[main.model]) return null;
  /** @type {({ model: string } & Tokens)[]} */
  const rows = [];
  for (const [name, g] of Object.entries(grew)) {
    const t = name === main.model ? { input: g.input - main.input, output: g.output - main.output, cacheRead: g.cacheRead - main.cacheRead, cacheWrite: g.cacheWrite - main.cacheWrite } : g;
    if (t.input < 0 || t.output < 0 || t.cacheRead < 0 || t.cacheWrite < 0) return null;
    if (t.input + t.output + t.cacheRead + t.cacheWrite > 0) rows.push({ model: name, ...t });
  }
  return rows.length ? spendOfRows(rows, readResultUsage(message)?.cacheSeen) : null;
}

// What a turn spent, as the agent counts it: exact tokens instead of the 4-chars-per-token estimate. ACP's `usage`
// (Claude's adapter, Qoder), else the total on the prompt result's `_meta.quota` (Gemini CLI's, in snake_case). A
// usage that carried a cache count is marked (`cacheSeen`, core/cache-facts.js): ACP's are optional, and `_meta.quota`
// has none. `cachedInInput`: the agent's `inputTokens` is its whole prompt, what it read from its cache among them
// (its card, as a drive saw: `readProfile`), so the input beside the cache is what is left of it. A total that adds up
// says which it is, whatever the card: Antigravity's older server counted its cache within its input, agy 1.5 counts it
// beside (read live on 1.5.14: 2,275 input, 7,482 read from its cache, 261 output, 10,018 in all).
/** @param {any} res @param {{ cachedInInput?: boolean } | null} [how] */
export function readUsage(res, how = null) {
  const ru = res?.usage;
  if (
    ru &&
    typeof ru === "object" &&
    (typeof ru.inputTokens === "number" || typeof ru.outputTokens === "number")
  ) {
    const cacheRead = ru.cachedReadTokens || ru.cachedInputTokens || 0;
    const [input, output, write] = [ru.inputTokens || 0, ru.outputTokens || 0, ru.cachedWriteTokens || 0];
    const total = typeof ru.totalTokens === "number" && cacheRead > 0 ? ru.totalTokens : null;
    const within = total == null ? null : total === input + output || total === input + output + write ? true : total === input + output + cacheRead || total === input + output + cacheRead + write ? false : null;
    return {
      input: (within ?? how?.cachedInInput) ? Math.max(0, input - cacheRead) : input,
      output: ru.outputTokens || 0,
      cacheRead,
      cacheWrite: ru.cachedWriteTokens || 0,
      total: ru.totalTokens || null,
      ...seenIf(saysCache(ru.cachedReadTokens, ru.cachedInputTokens, ru.cachedWriteTokens)),
    };
  }
  const tc = res?._meta?.quota?.token_count;
  if (tc && typeof tc === "object" && (typeof tc.input_tokens === "number" || typeof tc.output_tokens === "number"))
    return { input: tc.input_tokens || 0, output: tc.output_tokens || 0, cacheRead: 0, cacheWrite: 0, total: null };
  return null;
}

/**
 * What a turn spent over its prompts — more than one where its next step carried it on (HarnessV3-ACP AC-D6): each
 * prompt's usage summed, its total only where every prompt said one, and the per-model counts summed by model. A prompt
 * whose answer names the models that counted it spent what those say (`answerUsage`): Claude's adapter says its main
 * loop's alone as `usage`, and every call's — a sub-agent's on its own model — by model. With them, the cycles no
 * prompt's answer reported (`cycles`, by Claude's results: a turn that failed in them).
 * @param {any[]} results  the prompts' results, in order
 * @param {ReturnType<typeof resultSpend>[]} [cycles]  what cycles of Claude's whose prompts never answered spent, in order
 * @param {{ cachedInInput?: boolean } | null} [how]  how the agent counts its input (`readUsage`)
 */
export function turnUsage(results, cycles = [], how = null) {
  /** @type {ReturnType<typeof readUsage>} */
  let usage = null;
  /** @type {Map<string, any> | null} */
  let byModel = null;
  /** @param {ReturnType<typeof readUsage>} u @param {any[] | null} mu */
  const add = (u, mu) => {
    if (u)
      usage = usage
        ? {
            input: usage.input + u.input,
            output: usage.output + u.output,
            cacheRead: usage.cacheRead + u.cacheRead,
            cacheWrite: usage.cacheWrite + u.cacheWrite,
            total: usage.total != null && u.total != null ? usage.total + u.total : null,
            ...seenIf(usage.cacheSeen || u.cacheSeen),
          }
        : u;
    if (mu) byModel ||= new Map();
    for (const m of mu || []) {
      const was = byModel?.get(m.model);
      byModel?.set(m.model, was ? { model: m.model, input: was.input + m.input, output: was.output + m.output, cacheRead: was.cacheRead + m.cacheRead, cacheWrite: was.cacheWrite + m.cacheWrite } : m);
    }
  };
  for (const res of results) {
    const mu = readModelUsage(res);
    add(answerUsage(res, mu, how), mu);
  }
  for (const c of cycles) add(c.usage, c.modelUsage);
  return { usage, modelUsage: byModel ? [...byModel.values()] : null };
}

/**
 * What one prompt spent, by its answer: the models that counted it added up where it names them (`mu`), each call
 * once whichever model ran it, else its usage (`readUsage`). Its cache counts are said where a model's row carried
 * one, or its usage did.
 * @param {any} res @param {ReturnType<typeof readModelUsage>} mu @param {{ cachedInInput?: boolean } | null} [how]
 * @returns {ReturnType<typeof readUsage>}
 */
function answerUsage(res, mu, how = null) {
  if (!mu?.length) return readUsage(res, how);
  const sum = (/** @type {"input" | "output" | "cacheRead" | "cacheWrite"} */ k) => mu.reduce((n, m) => n + (Number(m[k]) || 0), 0);
  const [input, output, cacheRead, cacheWrite] = [sum("input"), sum("output"), sum("cacheRead"), sum("cacheWrite")];
  const said = readUsage(res)?.cacheSeen || res._meta.quota.model_usage.some((/** @type {any} */ m) => saysCache(m?.token_count?.cachedInputTokens, m?.token_count?.cachedReadTokens, m?.token_count?.cachedWriteTokens));
  return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite, ...seenIf(said) };
}

// Per-model usage on the prompt result's `_meta.quota`: Claude's adapter counts in camelCase (as codex-acp does),
// Gemini CLI and Qoder in snake_case.
export function readModelUsage(res) {
  const mu = res?._meta?.quota?.model_usage;
  if (Array.isArray(mu))
    return mu
      .filter((m) => m && m.model)
      .map((m) => {
        const t = m.token_count || {};
        return {
          model: m.model,
          input: t.inputTokens ?? t.input_tokens ?? 0,
          output: t.outputTokens ?? t.output_tokens ?? 0,
          cacheRead: t.cachedInputTokens || t.cachedReadTokens || 0,
          cacheWrite: t.cachedWriteTokens || 0,
        };
      });
  return null;
}
