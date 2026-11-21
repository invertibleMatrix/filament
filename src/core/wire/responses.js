// OpenAI Responses API (`POST /v1/responses`) on top of Filament's Chat Completions pipeline.
//
// A Responses request becomes a Chat Completions request, which then goes through routing, rules, translation and the
// agent bridge like any other request; the Chat Completions reply, JSON or stream, becomes a Responses object or the
// Responses event stream on the way out. Conversation state (`previous_response_id`) is kept in memory for an hour:
// Filament has no database, so a client that wants durable state sends the full `input` each turn (Codex does).
import { randomBytes } from "node:crypto";
import { sseReader } from "./translate.js";
import { usageFromOpenAI } from "./usage.js";
import { INCOMPLETE_STREAM } from "./errors.js";

const rid = (prefix) => `${prefix}_${randomBytes(12).toString("hex")}`;
export const newResponseId = (now = Date.now) =>
  `resp_${now().toString(36)}${randomBytes(6).toString("hex")}`;

const invalid = (message, param = null) =>
  Object.assign(new Error(message), { status: 400, param, code: "invalid_request" });

// ---------------------------------------------------------------------------------------------------
// Request: Responses -> Chat Completions
// ---------------------------------------------------------------------------------------------------

/**
 * A person's or a tool's message of the chat body, with the input item it came from: `at`, the item's place in what a
 * passthrough sends (`input`); `len`, the message's content as converted (its characters, or its parts).
 * @typedef {{ message: any, at: number, len: number }} Source
 */

// `prior` = the items of the conversation this request continues (resolved from previous_response_id by the caller).
// Returns the chat body, the normalised input items (kept for the next turn), notes for the request record, what a
// passthrough to a Responses upstream sends as its input, and where each person's or tool's message came from in it.
/**
 * @param {any} src
 * @param {object} [opts]
 * @param {any[]} [opts.prior]
 */
export function responsesToChat(src, { prior = [] } = {}) {
  const notes = [];
  if (src.background === true)
    throw invalid(
      "background responses are not supported by Filament; send the request in the foreground",
      "background",
    );
  /** @type {number[]} */
  const at = [];
  const items = normalizeInput(src.input, notes, at);
  const messages = [];
  if (typeof src.instructions === "string" && src.instructions.trim())
    messages.push({ role: "system", content: src.instructions });
  let reasoningSeen = false;
  const all = [...prior, ...items];
  // What a passthrough sends as the input: the client's own when nothing came before it, else the prior items and
  // these. A message's source is its item's place in it.
  const input = prior.length ? all : src.input;
  /** @param {number} k */
  const placeOf = (k) => (prior.length ? k : at[k]);
  /** @type {Source[]} */
  const sources = [];
  /** @param {any} m @param {number} place */
  const keep = (m, place) =>
    sources.push({ message: m, at: place, len: typeof m.content === "string" || Array.isArray(m.content) ? m.content.length : 0 });
  /** Each call's function by its id: what a call's images are named by. */
  const callNames = new Map(all.filter((it) => it.type === "function_call").map((it) => [it.call_id, it.name]));
  // A function output's images and files wait for the run of outputs to end: nothing may stand between the tool
  // messages that answer one assistant message (HarnessV3-Tools TL-D17). They come from the run's last output.
  /** @type {any[]} */
  const carried = [];
  let lastOutput = -1;
  const flush = () => {
    if (!carried.length) return;
    const m = { role: "user", content: carried.splice(0) };
    messages.push(m);
    keep(m, lastOutput);
  };
  for (const [k, it] of all.entries()) {
    if (it.type === "reasoning") {
      reasoningSeen = true;
      continue;
    }
    if (it.type !== "function_call_output") flush();
    const from = messages.length;
    appendItem(messages, it, notes, carried, callNames);
    for (const m of messages.slice(from)) if (m.role === "user" || m.role === "tool") keep(m, placeOf(k));
    if (it.type === "function_call_output") lastOutput = placeOf(k);
  }
  flush();
  if (reasoningSeen)
    notes.push(
      "responses: reasoning items from earlier turns are kept in the conversation but not replayed to the model",
    );
  const chat = { model: src.model, messages, stream: src.stream === true };
  if (src.stream === true) chat.stream_options = { include_usage: true };
  if (src.max_output_tokens != null) chat.max_completion_tokens = src.max_output_tokens;
  for (const k of ["temperature", "top_p", "parallel_tool_calls", "user"])
    if (src[k] != null) chat[k] = src[k];
  if (src.reasoning?.effort) chat.reasoning_effort = src.reasoning.effort;
  const fmt = src.text?.format;
  if (fmt?.type === "json_schema")
    chat.response_format = {
      type: "json_schema",
      json_schema: {
        name: fmt.name || "response",
        schema: fmt.schema || {},
        ...(fmt.strict != null ? { strict: fmt.strict } : {}),
        ...(fmt.description ? { description: fmt.description } : {}),
      },
    };
  else if (fmt?.type === "json_object") chat.response_format = { type: "json_object" };
  const tools = [];
  for (const t of Array.isArray(src.tools) ? src.tools : []) {
    if (t?.type === "function" && t.name)
      tools.push({
        type: "function",
        function: {
          name: t.name,
          ...(t.description ? { description: t.description } : {}),
          parameters: t.parameters || { type: "object", properties: {} },
          ...(t.strict != null ? { strict: t.strict } : {}),
        },
      });
    else
      notes.push(
        `responses: hosted tool "${t?.type || "?"}" dropped (only function tools work through Filament; the client runs them)`,
      );
  }
  if (tools.length) chat.tools = tools;
  if (src.tool_choice != null) {
    const tc = src.tool_choice;
    if (typeof tc === "string") chat.tool_choice = tc;
    else if (tc.type === "function" && tc.name)
      chat.tool_choice = { type: "function", function: { name: tc.name } };
    else if (tc.type === "allowed_tools") {
      chat.tool_choice = tc.mode === "required" ? "required" : "auto";
      notes.push(`responses: tool_choice allowed_tools narrowed to "${chat.tool_choice}"`);
    } else chat.tool_choice = "auto";
  }
  return { chat, items, notes, input, sources };
}

/**
 * What memory added to a Responses request's person and tool messages, carried onto the input items they came from: a
 * passthrough to a Responses upstream sends the input, never the chat body memory wrote its blocks into (the bug
 * report's H13). The system prompt's blocks memory places itself (`instructions`). The input is replaced, never
 * changed in place: the client's body and the conversation kept for `previous_response_id` keep their items as they
 * came.
 * @param {any} responsesBody @param {Source[]} sources
 */
export function carryAdded(responsesBody, sources) {
  /** @type {Map<number, string[]>} */
  const added = new Map();
  for (const { message, at, len } of sources) {
    const c = message.content;
    const texts = (
      typeof c === "string"
        ? [c.slice(len).replace(/^\n+/, "")]
        : Array.isArray(c)
          ? c.slice(len).map((p) => (p?.type === "text" ? p.text : ""))
          : []
    ).filter(Boolean);
    if (texts.length) added.set(at, [...(added.get(at) || []), ...texts]);
  }
  if (!added.size) return;
  const input = responsesBody.input;
  if (typeof input === "string") responsesBody.input = [input, ...(added.get(0) || [])].join("\n\n");
  else responsesBody.input = input.map((it, i) => (added.has(i) ? withTexts(it, added.get(i) || []) : it));
}

/**
 * An input item with words after its own: a message's content, a function output's output. An item of another shape
 * than the API's goes as it came. @param {any} it @param {string[]} texts
 */
function withTexts(it, texts) {
  const key = it.type === "function_call_output" ? "output" : "content";
  const v = it[key];
  if (typeof v === "string") return { ...it, [key]: [v, ...texts].join("\n\n") };
  if (Array.isArray(v)) return { ...it, [key]: [...v, ...texts.map((text) => ({ type: "input_text", text }))] };
  return it;
}

/**
 * The client's input as items of the shapes Filament reads, each one's place in the input it came from in `at` (a
 * string input is one message, at 0). @param {any} input @param {string[]} notes @param {number[]} at
 */
function normalizeInput(input, notes, at) {
  if (input == null) throw invalid("input is required", "input");
  if (typeof input === "string") {
    at.push(0);
    return [{ type: "message", role: "user", content: [{ type: "input_text", text: input }] }];
  }
  if (!Array.isArray(input)) throw invalid("input must be a string or an array of items", "input");
  const out = [];
  for (const [i, it] of input.entries()) {
    if (!it || typeof it !== "object") continue;
    const before = out.length;
    const type = it.type || (it.role ? "message" : null);
    if (type === "message") {
      const role = it.role || "user";
      const content =
        typeof it.content === "string"
          ? [{ type: role === "assistant" ? "output_text" : "input_text", text: it.content }]
          : Array.isArray(it.content)
            ? it.content
            : [];
      out.push({ type: "message", role, content, ...(it.id ? { id: it.id } : {}) });
    } else if (type === "function_call")
      out.push({
        type,
        ...(it.id ? { id: it.id } : {}),
        call_id: it.call_id || it.id || rid("call"),
        name: it.name || "",
        arguments: typeof it.arguments === "string" ? it.arguments : JSON.stringify(it.arguments ?? {}),
      });
    else if (type === "function_call_output")
      out.push({
        type,
        call_id: it.call_id,
        // A list (text, images, files) is kept as it came: appendItem splits it, and the next turn replays it.
        output: typeof it.output === "string" || Array.isArray(it.output) ? it.output : JSON.stringify(it.output ?? ""),
      });
    else if (type === "reasoning")
      out.push({
        type,
        ...(it.id ? { id: it.id } : {}),
        summary: Array.isArray(it.summary) ? it.summary : [],
      });
    else if (type === "item_reference")
      notes.push(
        `responses: item_reference ${it.id || ""} ignored (Filament keeps no item store; send the item itself)`,
      );
    else notes.push(`responses: input item of type "${type}" ignored`);
    if (out.length > before) at.push(i);
  }
  return out;
}

/** The line that opens what a list output carried after the tool messages, naming the call it answers. */
const returnedLead = (/** @type {string} */ call, /** @type {string | undefined} */ name, /** @type {boolean} */ beside) =>
  `[What tool call ${call}${name ? ` (${name})` : ""} returned${beside ? " beside its text" : ""}:]`;
const RETURNED_LEAD = /^\[What tool call \S+(?: \([^)]*\))? returned(?: beside its text)?:\]$/;
/**
 * Whether a chat message is what a Responses client's list outputs carried after the tool messages
 * (`responsesToChat`): what its tools returned, none of the person's words. @param {any} m
 */
export const carriesReturned = (m) =>
  m?.role === "user" && Array.isArray(m.content) && m.content[0]?.type === "text" && RETURNED_LEAD.test(m.content[0].text || "");

const partsText = (parts) =>
  (parts || []).map((p) => (typeof p === "string" ? p : p?.text || p?.refusal || "")).join("");

const isTextPart = (p) => typeof p === "string" || p?.type === "input_text" || p?.type === "output_text" || p?.type === "text";

/** One Responses content part as a Chat Completions part, or null (a note says why when it was dropped). */
function chatPart(p, notes) {
  if (typeof p === "string") return { type: "text", text: p };
  if (p.type === "input_text" || p.type === "output_text" || p.type === "text") return { type: "text", text: p.text || "" };
  if (p.type === "input_image") {
    const url = typeof p.image_url === "string" ? p.image_url : p.image_url?.url;
    if (url) return { type: "image_url", image_url: { url, ...(p.detail ? { detail: p.detail } : {}) } };
    notes.push("responses: input_image by file_id ignored (Filament keeps no files; send a URL or a data: URL)");
    return null;
  }
  if (p.type === "input_file") {
    if (p.file_data) return { type: "file", file: { file_data: p.file_data, filename: p.filename || "file" } };
    if (p.file_url) return { type: "text", text: `[file: ${p.file_url}]` };
    notes.push("responses: input_file by file_id ignored (Filament keeps no files; send file_data)");
    return null;
  }
  if (p.type === "refusal") return { type: "text", text: p.refusal || "" };
  return null;
}

function appendItem(messages, it, notes, carried, callNames) {
  if (it.type === "message") {
    const role = it.role === "developer" ? "system" : it.role;
    if (role === "assistant") {
      messages.push({ role: "assistant", content: partsText(it.content) });
      return;
    }
    const parts = (it.content || []).map((p) => chatPart(p, notes)).filter(Boolean);
    const simple = parts.every((p) => p.type === "text");
    messages.push({
      role: role === "system" ? "system" : "user",
      content: simple ? parts.map((p) => p.text).join("") : parts,
    });
    return;
  }
  if (it.type === "function_call") {
    const call = { id: it.call_id, type: "function", function: { name: it.name, arguments: it.arguments } };
    const last = messages[messages.length - 1];
    if (last && last.role === "assistant") {
      (last.tool_calls ||= []).push(call);
      if (!last.content) last.content = null;
    } else messages.push({ role: "assistant", content: null, tool_calls: [call] });
    return;
  }
  if (it.type === "function_call_output") {
    if (!Array.isArray(it.output)) {
      messages.push({ role: "tool", tool_call_id: it.call_id, content: it.output });
      return;
    }
    // A list output: its words are the tool message (a tool message takes text only); its images and files go to
    // the user message after the run of outputs, named by the call they came from.
    const text = partsText(it.output.filter(isTextPart));
    const media = it.output.filter((p) => !isTextPart(p)).map((p) => chatPart(p, notes)).filter(Boolean);
    messages.push({ role: "tool", tool_call_id: it.call_id, content: text || (media.length ? "[what the call returned is in the message after the tool results]" : "") });
    if (!media.length) return;
    carried.push({ type: "text", text: returnedLead(it.call_id, callNames.get(it.call_id), !!text) }, ...media);
  }
}

// ---------------------------------------------------------------------------------------------------
// Response objects
// ---------------------------------------------------------------------------------------------------

export function responseSkeleton(src, { id, created, model }) {
  return {
    id,
    object: "response",
    created_at: created,
    status: "in_progress",
    background: false,
    error: null,
    incomplete_details: null,
    instructions: src.instructions ?? null,
    max_output_tokens: src.max_output_tokens ?? null,
    max_tool_calls: null,
    model: model || src.model,
    output: [],
    parallel_tool_calls: src.parallel_tool_calls ?? true,
    previous_response_id: src.previous_response_id ?? null,
    prompt_cache_key: src.prompt_cache_key ?? null,
    reasoning: { effort: src.reasoning?.effort ?? null, summary: src.reasoning?.summary ?? null },
    safety_identifier: src.safety_identifier ?? null,
    service_tier: "default",
    store: src.store !== false,
    temperature: src.temperature ?? 1,
    text: src.text ?? { format: { type: "text" } },
    tool_choice: src.tool_choice ?? "auto",
    tools: Array.isArray(src.tools) ? src.tools : [],
    top_logprobs: 0,
    top_p: src.top_p ?? 1,
    truncation: src.truncation ?? "disabled",
    usage: null,
    user: null,
    metadata: src.metadata ?? {},
  };
}

export function usageToResponses(u) {
  if (!u) return null;
  const input = u.prompt_tokens || 0,
    output = u.completion_tokens || 0;
  return {
    input_tokens: input,
    input_tokens_details: { cached_tokens: u.prompt_tokens_details?.cached_tokens || 0 },
    output_tokens: output,
    output_tokens_details: { reasoning_tokens: u.completion_tokens_details?.reasoning_tokens || 0 },
    total_tokens: u.total_tokens ?? input + output,
  };
}

const messageItem = (id, text) => ({
  id,
  type: "message",
  status: "completed",
  role: "assistant",
  content: [{ type: "output_text", text, annotations: [], logprobs: [] }],
});
const reasoningItem = (id, text) => ({
  id,
  type: "reasoning",
  summary: text ? [{ type: "summary_text", text }] : [],
});
const functionCallItem = (id, callId, name, args) => ({
  id,
  type: "function_call",
  status: "completed",
  call_id: callId,
  name,
  arguments: args,
});

function finishStatus(resp, finish) {
  if (finish === "length") {
    resp.status = "incomplete";
    resp.incomplete_details = { reason: "max_output_tokens" };
  } else if (finish === "content_filter") {
    resp.status = "incomplete";
    resp.incomplete_details = { reason: "content_filter" };
  } else resp.status = "completed";
}

// Chat Completions JSON -> Responses object
export function chatToResponse(completion, src, { id, created }) {
  const resp = responseSkeleton(src, { id, created, model: completion.model || src.model });
  const ch = completion.choices?.[0] || {};
  const msg = ch.message || {};
  if (msg.reasoning_content) resp.output.push(reasoningItem(rid("rs"), msg.reasoning_content));
  const text =
    typeof msg.content === "string"
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("")
        : "";
  if (text) resp.output.push(messageItem(rid("msg"), text));
  for (const tc of msg.tool_calls || [])
    resp.output.push(
      functionCallItem(
        rid("fc"),
        tc.id || rid("call"),
        tc.function?.name || "",
        tc.function?.arguments ?? "{}",
      ),
    );
  resp.usage = usageToResponses(completion.usage);
  finishStatus(resp, ch.finish_reason);
  return resp;
}

// Chat Completions chunks -> Responses events. Items open in the order they first appear (a reasoning summary, the
// message text, one function call per tool index) and close when another kind begins or the stream ends. `onOver`: told
// of each chunk dropped for a line past what Filament reads of one (translate.js `sseReader`).
/** @param {any} src @param {{ id?: string, created?: number, model?: string, onOver?: (over: import("../lines.js").Over) => void }} [o] */
export function createChatToResponsesStream(src, { id, created, model, onOver = () => {} } = {}) {
  const resp = responseSkeleton(src, { id, created, model: model || src.model });
  const state = { status: "in_progress", error: null, usage: null, finish: null, events: 0 };
  let out = "",
    seq = 0,
    started = false,
    done = false,
    doneSaid = false,
    open = null;
  const ev = (type, data) => {
    out += `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: seq++, ...data })}\n\n`;
  };
  const start = () => {
    if (started) return;
    started = true;
    ev("response.created", { response: { ...resp, output: [] } });
    ev("response.in_progress", { response: { ...resp, output: [] } });
  };
  const closeOpen = () => {
    if (!open) return;
    const o = open;
    open = null;
    const base = { item_id: o.item.id, output_index: o.index };
    if (o.kind === "message") {
      const part = { type: "output_text", text: o.text, annotations: [], logprobs: [] };
      ev("response.output_text.done", { ...base, content_index: 0, logprobs: [], text: o.text });
      ev("response.content_part.done", { ...base, content_index: 0, part });
      o.item.content = [part];
      o.item.status = "completed";
    } else if (o.kind === "reasoning") {
      const part = { type: "summary_text", text: o.text };
      ev("response.reasoning_summary_text.done", { ...base, summary_index: 0, text: o.text });
      ev("response.reasoning_summary_part.done", { ...base, summary_index: 0, part });
      o.item.summary = [part];
    } else {
      ev("response.function_call_arguments.done", {
        ...base,
        call_id: o.item.call_id,
        name: o.item.name,
        arguments: o.text,
      });
      o.item.arguments = o.text;
      o.item.status = "completed";
    }
    ev("response.output_item.done", { output_index: o.index, item: o.item });
  };
  const openItem = (kind, item, toolIndex = null) => {
    closeOpen();
    const index = resp.output.length;
    resp.output.push(item);
    open = { kind, item, index, text: "", toolIndex };
    ev("response.output_item.added", { output_index: index, item: { ...item } });
    if (kind === "message")
      ev("response.content_part.added", {
        item_id: item.id,
        output_index: index,
        content_index: 0,
        part: { type: "output_text", text: "", annotations: [], logprobs: [] },
      });
    if (kind === "reasoning")
      ev("response.reasoning_summary_part.added", {
        item_id: item.id,
        output_index: index,
        summary_index: 0,
        part: { type: "summary_text", text: "" },
      });
  };
  const complete = () => {
    if (done) return;
    done = true;
    start();
    closeOpen();
    resp.usage = usageToResponses(state.usage);
    finishStatus(resp, state.finish);
    state.status = resp.status;
    ev(resp.status === "completed" ? "response.completed" : "response.incomplete", { response: resp });
  };
  const fail = (err) => {
    if (done) return;
    done = true;
    start();
    closeOpen();
    state.error = err?.message || String(err);
    resp.status = "failed";
    resp.error = { code: err?.code || err?.type || "server_error", message: state.error };
    state.status = "failed";
    ev("error", { code: resp.error.code, message: state.error, param: null });
    ev("response.failed", { response: resp });
  };
  const reader = sseReader((data, parse) => {
    if (data === "[DONE]") {
      doneSaid = true;
      return;
    }
    let c;
    try {
      c = parse(data);
    } catch {
      return;
    }
    state.events++;
    if (c.error) {
      fail(c.error);
      return;
    }
    start();
    if (c.usage) state.usage = c.usage;
    if (c.model && !resp.model) resp.model = c.model;
    const ch = c.choices?.[0];
    if (!ch) return;
    const d = ch.delta || {};
    if (typeof d.reasoning_content === "string" && d.reasoning_content) {
      if (!open || open.kind !== "reasoning")
        openItem("reasoning", { id: rid("rs"), type: "reasoning", summary: [] });
      open.text += d.reasoning_content;
      ev("response.reasoning_summary_text.delta", {
        item_id: open.item.id,
        output_index: open.index,
        summary_index: 0,
        delta: d.reasoning_content,
      });
    }
    if (typeof d.content === "string" && d.content) {
      if (!open || open.kind !== "message")
        openItem("message", {
          id: rid("msg"),
          type: "message",
          status: "in_progress",
          role: "assistant",
          content: [],
        });
      open.text += d.content;
      ev("response.output_text.delta", {
        item_id: open.item.id,
        output_index: open.index,
        content_index: 0,
        delta: d.content,
        logprobs: [],
      });
    }
    for (const tc of Array.isArray(d.tool_calls) ? d.tool_calls : []) {
      const idx = tc.index ?? 0;
      if (!open || open.kind !== "function_call" || open.toolIndex !== idx)
        openItem(
          "function_call",
          {
            id: rid("fc"),
            type: "function_call",
            status: "in_progress",
            call_id: tc.id || rid("call"),
            name: tc.function?.name || "",
            arguments: "",
          },
          idx,
        );
      else {
        if (tc.id && !open.item.call_id) open.item.call_id = tc.id;
        if (tc.function?.name && !open.item.name) open.item.name = tc.function.name;
      }
      const args = tc.function?.arguments || "";
      if (args) {
        open.text += args;
        ev("response.function_call_arguments.delta", {
          item_id: open.item.id,
          output_index: open.index,
          call_id: open.item.call_id,
          delta: args,
        });
      }
    }
    if (ch.finish_reason) state.finish = ch.finish_reason;
  }, { onOver });
  return {
    state,
    resp,
    push(chunk) {
      reader.push(chunk);
      const s = out;
      out = "";
      return s;
    },
    end() {
      reader.flush();
      // A chat stream that ended with neither a finish_reason nor its [DONE] broke off mid-reply: the response failed,
      // never completed with what came of it.
      if (state.finish || doneSaid) complete();
      else fail({ message: INCOMPLETE_STREAM });
      const s = out;
      out = "";
      return s;
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// The other direction: talking TO a server that only offers /v1/responses (upstream `wireApi = responses`).
// The pipeline keeps working in Chat Completions; the request is repacked on the way out and the reply on the way in.
// ---------------------------------------------------------------------------------------------------

const contentText = (c) =>
  typeof c === "string"
    ? c
    : Array.isArray(c)
      ? c.map((p) => (typeof p === "string" ? p : p?.text || "")).join("")
      : "";

/** One Chat Completions content part as a Responses input part, or null for a part with none. */
const responsesPart = (p) => {
  if (p.type === "text") return { type: "input_text", text: p.text || "" };
  if (p.type === "image_url") {
    const url = typeof p.image_url === "string" ? p.image_url : p.image_url?.url;
    return url ? { type: "input_image", image_url: url, ...(p.image_url?.detail ? { detail: p.image_url.detail } : {}) } : null;
  }
  if (p.type === "file" && p.file?.file_data)
    return { type: "input_file", file_data: p.file.file_data, ...(p.file.filename ? { filename: p.file.filename } : {}) };
  return null;
};

// Chat Completions request -> Responses request
export function chatToResponsesRequest(chat) {
  const out = { model: chat.model, input: [], store: false };
  const sys = [];
  for (const m of chat.messages || []) {
    if (m.role === "system" || m.role === "developer") {
      const t = contentText(m.content);
      if (t) sys.push(t);
      continue;
    }
    if (m.role === "tool") {
      // A function_call_output takes the images and files a tool message's parts carry beside its words, as a list;
      // words alone stay the string they were.
      const parts = Array.isArray(m.content)
        ? m.content.map(responsesPart).filter((q) => q && !(q.type === "input_text" && !q.text))
        : [];
      out.input.push({
        type: "function_call_output",
        call_id: m.tool_call_id,
        output: parts.some((q) => q.type !== "input_text") ? parts : contentText(m.content),
      });
      continue;
    }
    if (m.role === "assistant") {
      const text = contentText(m.content);
      if (text)
        out.input.push({ type: "message", role: "assistant", content: [{ type: "output_text", text }] });
      for (const tc of m.tool_calls || [])
        out.input.push({
          type: "function_call",
          call_id: tc.id || rid("call"),
          name: tc.function?.name || "",
          arguments:
            typeof tc.function?.arguments === "string"
              ? tc.function.arguments
              : JSON.stringify(tc.function?.arguments ?? {}),
        });
      continue;
    }
    if (typeof m.content === "string") {
      out.input.push({ role: "user", content: [{ type: "input_text", text: m.content }] });
      continue;
    }
    const parts = (Array.isArray(m.content) ? m.content : []).map(responsesPart).filter(Boolean);
    out.input.push({ role: "user", content: parts.length ? parts : [{ type: "input_text", text: "" }] });
  }
  if (sys.length) out.instructions = sys.join("\n\n");
  if (chat.stream === true) out.stream = true;
  const max = chat.max_completion_tokens ?? chat.max_tokens;
  if (max != null) out.max_output_tokens = max;
  // `service_tier` is spelled alike in both APIs (priority / flex processing): a client's own tier crosses as it is.
  for (const k of ["temperature", "top_p", "parallel_tool_calls", "user", "service_tier"])
    if (chat[k] != null) out[k] = chat[k];
  if (chat.reasoning_effort) out.reasoning = { effort: chat.reasoning_effort };
  const tools = (Array.isArray(chat.tools) ? chat.tools : [])
    .filter((t) => t?.type === "function" && t.function?.name)
    .map((t) => ({
      type: "function",
      name: t.function.name,
      ...(t.function.description ? { description: t.function.description } : {}),
      parameters: t.function.parameters || { type: "object", properties: {} },
      ...(t.function.strict != null ? { strict: t.function.strict } : {}),
    }));
  if (tools.length) out.tools = tools;
  if (chat.tool_choice != null) {
    const tc = chat.tool_choice;
    out.tool_choice =
      typeof tc === "string" ? tc : tc.function?.name ? { type: "function", name: tc.function.name } : "auto";
  }
  const rf = chat.response_format;
  if (rf?.type === "json_schema")
    out.text = {
      format: {
        type: "json_schema",
        name: rf.json_schema?.name || "response",
        schema: rf.json_schema?.schema || {},
        ...(rf.json_schema?.strict != null ? { strict: rf.json_schema.strict } : {}),
      },
    };
  else if (rf?.type === "json_object") out.text = { format: { type: "json_object" } };
  return out;
}

/**
 * @typedef {{ model?: string, now?: import("../ports.js").Clock, onOver?: (over: import("../lines.js").Over) => void }} ConvertOptions
 *   `now` = the clock for ids and `created`; `onOver`, a stream's converter's: told of each event it drops for a line
 *   past what Filament reads of one (translate.js `sseReader`)
 */

// Responses object -> Chat Completions JSON (or an OpenAI-shaped error when the response failed)
/** @param {any} resp @param {ConvertOptions} [opts] */
export function responseToChat(resp, { model, now = Date.now } = {}) {
  if (resp?.status === "failed" || (resp?.error && !resp.output))
    return {
      error: {
        message: resp?.error?.message || "response failed",
        type: resp?.error?.code || "server_error",
      },
    };
  const msg = { role: "assistant", content: null };
  const texts = [],
    reasons = [],
    calls = [];
  for (const it of resp?.output || []) {
    if (it.type === "message")
      texts.push(
        (it.content || [])
          .filter((p) => p.type === "output_text")
          .map((p) => p.text || "")
          .join(""),
      );
    else if (it.type === "reasoning") {
      const s = (it.summary || []).map((p) => p.text || "").join("");
      const c = Array.isArray(it.content) ? it.content.map((p) => p.text || "").join("") : "";
      if (s || c) reasons.push(s || c);
    } else if (it.type === "function_call")
      calls.push({
        id: it.call_id || it.id || rid("call"),
        type: "function",
        function: { name: it.name || "", arguments: it.arguments ?? "{}" },
      });
  }
  const text = texts.join("");
  if (text) msg.content = text;
  if (reasons.length) msg.reasoning_content = reasons.join("\n");
  if (calls.length) msg.tool_calls = calls;
  const finish =
    resp?.status === "incomplete"
      ? resp.incomplete_details?.reason === "content_filter"
        ? "content_filter"
        : "length"
      : calls.length
        ? "tool_calls"
        : "stop";
  const out = {
    id: `chatcmpl-${resp?.id || now().toString(36)}`,
    object: "chat.completion",
    created: resp?.created_at || Math.floor(now() / 1000),
    model: resp?.model || model,
    choices: [{ index: 0, message: msg, finish_reason: finish }],
  };
  const u = resp?.usage;
  if (u)
    out.usage = {
      prompt_tokens: u.input_tokens || 0,
      completion_tokens: u.output_tokens || 0,
      total_tokens: u.total_tokens ?? (u.input_tokens || 0) + (u.output_tokens || 0),
      prompt_tokens_details: { cached_tokens: u.input_tokens_details?.cached_tokens || 0 },
      completion_tokens_details: { reasoning_tokens: u.output_tokens_details?.reasoning_tokens || 0 },
      ...(typeof u.cost_in_usd_ticks === "number" ? { cost_in_usd_ticks: u.cost_in_usd_ticks } : {}),
    };
  return out;
}

// Responses SSE -> Chat Completions chunks. `state` is what Filament's scanner would have collected from real chunks.
/** @param {ConvertOptions} [opts] */
export function createResponsesToChatStream({ model, now = Date.now, onOver = () => {} } = {}) {
  const state = { usage: {}, stopReason: null, error: null, thinkingChars: 0, textChars: 0, events: 0 };
  let out = "",
    id = `chatcmpl-${now().toString(36)}`,
    created = Math.floor(now() / 1000),
    started = false,
    finished = false,
    toolIndex = -1;
  const tools = new Map(); // function_call item id -> { index, argChars }
  const chunk = (delta, finish = null, extra = {}) => {
    out += `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
  };
  const start = () => {
    if (!started) {
      started = true;
      chunk({ role: "assistant", content: "" });
    }
  };
  const fail = (message, type) => {
    if (finished) return;
    finished = true;
    start();
    state.error = message;
    out += `data: ${JSON.stringify({ error: { message, type: type || "server_error" } })}\n\ndata: [DONE]\n\n`;
  };
  const complete = (resp) => {
    if (finished) return;
    finished = true;
    start();
    const c = responseToChat(resp || {}, { model });
    if (c.error) {
      finished = false;
      return fail(c.error.message, c.error.type);
    }
    state.stopReason = c.choices[0].finish_reason;
    chunk({}, state.stopReason);
    if (c.usage) usageFromOpenAI(c.usage, state.usage);
    out += `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [], usage: c.usage || {} })}\n\ndata: [DONE]\n\n`;
  };
  const reader = sseReader((data, parse) => {
    if (data === "[DONE]") return;
    let e;
    try {
      e = parse(data);
    } catch {
      return;
    }
    state.events++;
    switch (e.type) {
      case "response.created":
        if (e.response?.id) id = `chatcmpl-${e.response.id}`;
        if (e.response?.model) model = e.response.model;
        start();
        break;
      case "response.output_text.delta":
        start();
        state.textChars += (e.delta || "").length;
        chunk({ content: e.delta || "" });
        break;
      case "response.reasoning_summary_text.delta":
      case "response.reasoning_text.delta":
        start();
        state.thinkingChars += (e.delta || "").length;
        chunk({ reasoning_content: e.delta || "" });
        break;
      case "response.output_item.added":
        if (e.item?.type === "function_call") {
          start();
          toolIndex++;
          tools.set(e.item.id, { index: toolIndex, argChars: 0 });
          chunk({
            tool_calls: [
              {
                index: toolIndex,
                id: e.item.call_id || e.item.id,
                type: "function",
                function: { name: e.item.name || "", arguments: "" },
              },
            ],
          });
        }
        break;
      case "response.function_call_arguments.delta": {
        start();
        const t = tools.get(e.item_id);
        const idx = t ? t.index : Math.max(0, toolIndex);
        if (t) t.argChars += (e.delta || "").length;
        chunk({ tool_calls: [{ index: idx, function: { arguments: e.delta || "" } }] });
        break;
      }
      case "response.function_call_arguments.done": {
        const t = tools.get(e.item_id);
        if (t && t.argChars === 0 && e.arguments) {
          t.argChars = e.arguments.length;
          chunk({ tool_calls: [{ index: t.index, function: { arguments: e.arguments } }] });
        }
        break;
      }
      case "response.output_item.done":
        if (e.item?.type === "function_call" && !tools.has(e.item.id)) {
          start();
          toolIndex++;
          tools.set(e.item.id, { index: toolIndex, argChars: (e.item.arguments || "").length });
          chunk({
            tool_calls: [
              {
                index: toolIndex,
                id: e.item.call_id || e.item.id,
                type: "function",
                function: { name: e.item.name || "", arguments: e.item.arguments || "" },
              },
            ],
          });
        }
        break; // a server that sends whole calls without deltas
      case "response.completed":
      case "response.incomplete":
        complete(e.response);
        break;
      case "response.failed":
        fail(e.response?.error?.message || "response failed", e.response?.error?.code);
        break;
      case "error":
        fail(e.message || "error", e.code);
        break;
      default:
        break;
    }
  }, { onOver });
  return {
    state,
    /** @param {string} text @param {import("./sse.js").Parsed | null} [known] */
    push(text, known = null) {
      reader.push(text, known);
      const s = out;
      out = "";
      return s;
    },
    end() {
      reader.flush();
      // A stream that ended before its final event broke off mid-reply: it ends as an error, never with a finish the
      // upstream never sent.
      if (!finished) fail(INCOMPLETE_STREAM);
      const s = out;
      out = "";
      return s;
    },
  };
}

// A finished Responses object replayed as the Responses event stream (a JSON reply for a client that streams).
export function responseObjectToSse(resp) {
  let seq = 0,
    out = "";
  const ev = (type, data) => {
    out += `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: seq++, ...data })}\n\n`;
  };
  ev("response.created", { response: { ...resp, status: "in_progress", output: [] } });
  ev("response.in_progress", { response: { ...resp, status: "in_progress", output: [] } });
  (resp.output || []).forEach((item, index) => {
    const opened =
      item.type === "message"
        ? { ...item, status: "in_progress", content: [] }
        : item.type === "function_call"
          ? { ...item, status: "in_progress", arguments: "" }
          : item.type === "reasoning"
            ? { ...item, summary: [] }
            : item;
    ev("response.output_item.added", { output_index: index, item: opened });
    if (item.type === "message")
      (item.content || []).forEach((part, ci) => {
        if (part.type !== "output_text") return;
        const base = { item_id: item.id, output_index: index, content_index: ci };
        ev("response.content_part.added", { ...base, part: { ...part, text: "" } });
        if (part.text) ev("response.output_text.delta", { ...base, delta: part.text, logprobs: [] });
        ev("response.output_text.done", { ...base, text: part.text || "", logprobs: [] });
        ev("response.content_part.done", { ...base, part });
      });
    else if (item.type === "reasoning")
      (item.summary || []).forEach((part, si) => {
        const base = { item_id: item.id, output_index: index, summary_index: si };
        ev("response.reasoning_summary_part.added", { ...base, part: { ...part, text: "" } });
        if (part.text) ev("response.reasoning_summary_text.delta", { ...base, delta: part.text });
        ev("response.reasoning_summary_text.done", { ...base, text: part.text || "" });
        ev("response.reasoning_summary_part.done", { ...base, part });
      });
    else if (item.type === "function_call") {
      const base = { item_id: item.id, output_index: index, call_id: item.call_id };
      if (item.arguments) ev("response.function_call_arguments.delta", { ...base, delta: item.arguments });
      ev("response.function_call_arguments.done", {
        ...base,
        name: item.name,
        arguments: item.arguments || "",
      });
    }
    ev("response.output_item.done", { output_index: index, item });
  });
  ev(
    resp.status === "incomplete"
      ? "response.incomplete"
      : resp.status === "failed"
        ? "response.failed"
        : "response.completed",
    { response: resp },
  );
  return out;
}
