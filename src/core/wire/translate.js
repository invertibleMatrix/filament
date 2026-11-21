// Cross-format translation between Anthropic Messages and OpenAI Chat Completions: requests, JSON responses and
// SSE streams in both directions. Lossy steps are reported in `notes` so the request record can show them.
import { usageFromAnthropic, usageFromOpenAI } from "./usage.js";
import { parseKnown, createSseEventReader } from "./sse.js";
import { INCOMPLETE_STREAM } from "./errors.js";
import { DEFAULT_OUTPUT_TOKENS } from "../tokens.js";

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const EFFORT_OAI_TO_ANT = {
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};
const STOP_ANT_TO_OAI = {
  end_turn: "stop",
  stop_sequence: "stop",
  max_tokens: "length",
  tool_use: "tool_calls",
  refusal: "content_filter",
  pause_turn: "stop",
};
const STOP_OAI_TO_ANT = {
  stop: "end_turn",
  length: "max_tokens",
  tool_calls: "tool_use",
  function_call: "tool_use",
  content_filter: "refusal",
};
const parseJson = (s, fallback = {}) => {
  if (isObj(s)) return s;
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
};
const textOfParts = (c) =>
  typeof c === "string"
    ? c
    : Array.isArray(c)
      ? c.map((p) => (typeof p === "string" ? p : p?.type === "text" ? p.text || "" : "")).join("")
      : "";
// A malformed tool call without an id needs one — and it must be the SAME id on every retry: a random id makes a
// failover resend different bytes for the same history, which breaks the provider's cached prefix and can split a
// tool_use/tool_result pair. FNV-1a over the call's content: deterministic, dependency-free, unique enough per call.
const stableId = (prefix, seed) => {
  let h = 0x811c9dc5;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${prefix}_${h.toString(36)}`;
};

// ---------------------------------------------------------------------------------------------------
// OpenAI request -> Anthropic request
// ---------------------------------------------------------------------------------------------------
/**
 * One OpenAI content part as an Anthropic content block, or null for a part Anthropic has no block for.
 * @param {any} p @param {string[]} notes
 */
function anthropicPart(p, notes) {
  if (typeof p === "string") return { type: "text", text: p };
  if (p?.type === "text") return { type: "text", text: p.text || "" };
  if (p?.type === "image_url") {
    const url = p.image_url?.url || "";
    const dm = /^data:([^;]+);base64,(.+)$/s.exec(url);
    return dm
      ? { type: "image", source: { type: "base64", media_type: dm[1], data: dm[2] } }
      : { type: "image", source: { type: "url", url } };
  }
  if (p?.type === "file" && p.file) {
    const dm = /^data:([^;]+);base64,(.+)$/s.exec(p.file.file_data || "");
    const name = p.file.filename || "attachment";
    notes.push(`file part "${name}" converted to an Anthropic document`);
    if (dm && /^image\//i.test(dm[1])) return { type: "image", source: { type: "base64", media_type: dm[1], data: dm[2] } };
    if (dm && dm[1] === "application/pdf")
      return {
        type: "document",
        title: name,
        source: { type: "base64", media_type: "application/pdf", data: dm[2] },
      };
    if (dm)
      return {
        type: "document",
        title: name,
        source: {
          type: "text",
          media_type: "text/plain",
          data: Buffer.from(dm[2], "base64").toString("utf8"),
        },
      };
    return {
      type: "text",
      text: `[attached file ${name} referenced by id; not available to this provider]`,
    };
  }
  if (p?.type === "input_audio") notes.push("audio part dropped (Anthropic has no audio input)");
  return null;
}

// `defaultMaxTokens`: the `max_tokens` Anthropic requires when the client sent none — the front door passes the most
// the model can write inside its window (HarnessV3-FailurePoints §13).
export function openaiToAnthropicRequest(src, { defaultMaxTokens = DEFAULT_OUTPUT_TOKENS } = {}) {
  const notes = [];
  const out = { model: src.model, messages: [] };
  const systemParts = [];
  const pushMsg = (role, blocks) => {
    if (!blocks.length) return;
    const last = out.messages.at(-1);
    if (last && last.role === role) last.content.push(...blocks);
    else out.messages.push({ role, content: blocks });
  };
  for (const m of src.messages || []) {
    if (!m) continue;
    if (m.role === "system" || m.role === "developer") {
      const t = textOfParts(m.content);
      if (t) systemParts.push(t);
      continue;
    }
    if (m.role === "tool") {
      // A tool_result takes the images and files a tool message's parts carry beside its words; words alone stay the
      // string they were.
      const parts = Array.isArray(m.content)
        ? m.content.map((p) => anthropicPart(p, notes)).filter((b) => b && !(b.type === "text" && !b.text))
        : [];
      const media = Array.isArray(m.content) && m.content.some((p) => p?.type === "image_url" || p?.type === "file");
      pushMsg("user", [
        {
          type: "tool_result",
          tool_use_id: m.tool_call_id || stableId("call_unknown", textOfParts(m.content)),
          content: media && parts.length ? parts : textOfParts(m.content) || "",
        },
      ]);
      continue;
    }
    if (m.role === "assistant") {
      const blocks = [];
      const t = textOfParts(m.content);
      if (t) blocks.push({ type: "text", text: t });
      if (m.reasoning_content)
        notes.push("assistant reasoning_content dropped (no signed thinking block to replay)");
      for (const tc of m.tool_calls || [])
        blocks.push({
          type: "tool_use",
          id:
            tc.id ||
            stableId(
              "call",
              `${tc.function?.name || tc.name || "tool"}:${tc.function?.arguments ?? tc.arguments ?? ""}`,
            ),
          name: tc.function?.name || tc.name || "tool",
          input: parseJson(tc.function?.arguments ?? tc.arguments, {}),
        });
      if (!blocks.length) blocks.push({ type: "text", text: "" });
      pushMsg("assistant", blocks);
      continue;
    }
    // user
    const blocks = [];
    if (typeof m.content === "string") blocks.push({ type: "text", text: m.content });
    else
      for (const p of m.content || []) {
        const b = anthropicPart(p, notes);
        if (b) blocks.push(b);
      }
    pushMsg("user", blocks.length ? blocks : [{ type: "text", text: "" }]);
  }
  // Anthropic requires the first message to be from the user: fold a leading assistant message into the system prompt.
  if (out.messages.length && out.messages[0].role !== "user") {
    const lead = out.messages.shift();
    const t = lead.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    if (t) systemParts.push(`The conversation began with this assistant message:\n${t}`);
    notes.push(
      "leading assistant message folded into the system prompt (Anthropic requires a user message first)",
    );
  }
  // Every tool_use must be answered by a tool_result in the next user message, and every tool_result must refer to a
  // known tool_use; clients that were interrupted mid-loop violate both, and Anthropic rejects the whole request.
  for (let i = 0; i < out.messages.length; i++) {
    const m = out.messages[i];
    if (m.role !== "assistant") continue;
    const ids = m.content.filter((b) => b.type === "tool_use").map((b) => b.id);
    if (!ids.length) continue;
    let next = out.messages[i + 1];
    if (!next || next.role !== "user") {
      next = { role: "user", content: [] };
      out.messages.splice(i + 1, 0, next);
    }
    const have = new Set(next.content.filter((b) => b.type === "tool_result").map((b) => b.tool_use_id));
    const missing = ids.filter((id) => !have.has(id));
    if (missing.length) {
      next.content.unshift(
        ...missing.map((id) => ({
          type: "tool_result",
          tool_use_id: id,
          content: "[no result was returned for this tool call]",
          is_error: true,
        })),
      );
      notes.push(`${missing.length} tool call(s) without a result were given a placeholder result`);
    }
  }
  const known = new Set(
    out.messages.flatMap((m) =>
      m.role === "assistant" ? m.content.filter((b) => b.type === "tool_use").map((b) => b.id) : [],
    ),
  );
  for (const m of out.messages)
    if (m.role === "user") {
      let fixed = 0;
      // An orphan result's words become text, and the images and files it carried go beside them.
      m.content = m.content.flatMap((b) =>
        b.type === "tool_result" && !known.has(b.tool_use_id)
          ? (fixed++,
            [
              {
                type: "text",
                text: `[tool result for ${b.tool_use_id}]: ${typeof b.content === "string" ? b.content : textOfParts(b.content)}`,
              },
              ...(Array.isArray(b.content) ? b.content.filter((x) => x.type !== "text") : []),
            ])
          : [b],
      );
      if (fixed) notes.push(`${fixed} orphan tool result(s) converted to text`);
    }
  if (systemParts.length) out.system = systemParts.join("\n\n");
  if (Array.isArray(src.tools) && src.tools.length) {
    out.tools = src.tools
      .filter((t) => t?.type === "function" || t?.function)
      .map((t) => {
        const f = t.function || t;
        return {
          name: f.name,
          ...(f.description ? { description: f.description } : {}),
          input_schema: isObj(f.parameters) ? f.parameters : { type: "object", properties: {} },
        };
      });
  }
  const tc = src.tool_choice;
  if (tc === "none") out.tool_choice = { type: "none" };
  else if (tc === "required") out.tool_choice = { type: "any" };
  else if (isObj(tc) && tc.type === "function") out.tool_choice = { type: "tool", name: tc.function?.name };
  else if (tc === "auto" || tc == null) {
    if (out.tools && src.parallel_tool_calls === false)
      out.tool_choice = { type: "auto", disable_parallel_tool_use: true };
  }
  out.max_tokens = src.max_completion_tokens ?? src.max_tokens ?? defaultMaxTokens;
  if (src.max_completion_tokens == null && src.max_tokens == null)
    notes.push(`max_tokens defaulted to ${defaultMaxTokens} (required by Anthropic)`);
  if (src.temperature != null) out.temperature = src.temperature;
  if (src.top_p != null) out.top_p = src.top_p;
  if (src.stop != null) out.stop_sequences = Array.isArray(src.stop) ? src.stop : [src.stop];
  if (src.stream === true) out.stream = true;
  const eff =
    typeof src.reasoning_effort === "string"
      ? src.reasoning_effort
      : isObj(src.reasoning)
        ? src.reasoning.effort
        : null;
  if (eff) {
    out.thinking = { type: "adaptive" };
    out.output_config = { effort: EFFORT_OAI_TO_ANT[eff] || "high" };
    if (!EFFORT_OAI_TO_ANT[eff]) notes.push(`reasoning_effort ${eff} unknown -> high`);
  }
  if (src.response_format?.type === "json_schema" && src.response_format.json_schema?.schema) {
    out.output_config = {
      ...(out.output_config || {}),
      format: { type: "json_schema", schema: src.response_format.json_schema.schema },
    };
  } else if (src.response_format?.type === "json_object")
    notes.push("response_format json_object has no Anthropic equivalent; ask for JSON in the prompt");
  if (typeof src.user === "string") out.metadata = { user_id: src.user.slice(0, 256) };
  if (src.n && src.n > 1) notes.push("n > 1 not supported; one completion returned");
  if (src.logprobs) notes.push("logprobs dropped");
  notes.unshift("translated OpenAI -> Anthropic request");
  return { body: out, notes };
}

// ---------------------------------------------------------------------------------------------------
// Anthropic request -> OpenAI request
// ---------------------------------------------------------------------------------------------------
/** Who handed the model an attachment, for the words that name one a provider cannot take. */
const USER_ATTACHED = { from: "The user attached", ask: "Ask for its text if you need it." };
/** "1 image", "2 images", "1 image and 1 document". @param {any[]} media */
const mediaWords = (media) => {
  const n = (/** @type {string} */ type) => media.filter((b) => b.type === type).length;
  const words = (/** @type {number} */ k, /** @type {string} */ w) => (k ? [`${k} ${w}${k === 1 ? "" : "s"}`] : []);
  return [...words(n("image"), "image"), ...words(n("document"), "document")].join(" and ");
};
/**
 * One Anthropic content block as an OpenAI user-message part, or null for a block that has none.
 * @param {any} b @param {string[]} notes @param {{ from: string, ask: string }} origin  whose attachment a document is
 */
function openaiPart(b, notes, origin) {
  if (b.type === "text") return { type: "text", text: b.text || "" };
  if (b.type === "image") {
    const s = b.source || {};
    return {
      type: "image_url",
      image_url: {
        url: s.type === "base64" ? `data:${s.media_type || "image/png"};base64,${s.data}` : s.url || "",
      },
    };
  }
  if (b.type === "document") {
    const sc = b.source || {};
    const name = b.title || "document";
    const mime = sc.media_type || (sc.type === "text" ? "text/plain" : "application/pdf");
    const textLike =
      sc.type === "text" || sc.type === "content" || /^text\//i.test(mime) || /json|xml|csv|markdown|yaml/i.test(mime);
    if (textLike) {
      const t =
        sc.type === "text"
          ? sc.data || ""
          : sc.type === "content"
            ? textOfParts(sc.content)
            : Buffer.from(sc.data || "", "base64").toString("utf8");
      notes.push(`document "${name}" inlined as text`);
      return { type: "text", text: `--- Attached file: ${name} ---\n${t}\n--- end of ${name} ---` };
    }
    if (sc.type === "base64" && /^image\//i.test(mime)) {
      notes.push(`document "${name}" sent as an image`);
      return { type: "image_url", image_url: { url: `data:${mime};base64,${sc.data}` } };
    }
    notes.push(`document "${name}" (${mime}) cannot be expressed in OpenAI format; named in the text instead`);
    return {
      type: "text",
      text: `[${origin.from} "${name}" (${mime}${sc.data ? `, ${Math.round((sc.data.length * 3) / 4 / 1024)} KB` : ""}), which this provider cannot receive as a file. ${origin.ask}]`,
    };
  }
  return null;
}

export function anthropicToOpenaiRequest(src, { maxTokensField = "max_tokens", includeUsage = true } = {}) {
  const notes = [];
  const out = { model: src.model, messages: [] };
  /** Each call's tool by its id: a result's images are named by the call that showed them. */
  const callNames = new Map();
  for (const m of src.messages || [])
    if (m?.role === "assistant" && Array.isArray(m.content))
      for (const b of m.content) if (b?.type === "tool_use") callNames.set(b.id, b.name);
  const sys = textOfParts(
    Array.isArray(src.system) ? src.system : src.system ? [{ type: "text", text: src.system }] : [],
  );
  if (sys) out.messages.push({ role: "system", content: sys });
  for (const m of src.messages || []) {
    if (!m) continue;
    if (m.role === "system") {
      const t = textOfParts(m.content);
      if (t) out.messages.push({ role: "system", content: t });
      continue;
    } // mid-conversation system message
    const blocks =
      typeof m.content === "string"
        ? [{ type: "text", text: m.content }]
        : Array.isArray(m.content)
          ? m.content
          : [];
    if (m.role === "assistant") {
      const msg = { role: "assistant", content: null };
      const parts = [];
      const calls = [];
      for (const b of blocks) {
        if (b.type === "text") parts.push(b.text || "");
        else if (b.type === "tool_use")
          calls.push({
            id: b.id,
            type: "function",
            function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
          });
        else if (b.type === "thinking" || b.type === "redacted_thinking") {
          /* not replayable across formats */
        }
      }
      if (blocks.some((b) => b.type === "thinking" || b.type === "redacted_thinking"))
        notes.push("thinking blocks dropped from history (OpenAI format cannot carry them)");
      msg.content = parts.join("") || null;
      if (calls.length) msg.tool_calls = calls;
      if (msg.content == null && !calls.length) msg.content = "";
      out.messages.push(msg);
      continue;
    }
    // user: tool results become `tool` messages, the rest a user message with parts. A tool message takes text
    // only and nothing may stand between them, so a result's images and documents open that user message, each
    // named by the call it came from (HarnessV3-Tools TL-D17).
    const results = blocks.filter((b) => b.type === "tool_result");
    const carried = [];
    const carriedMedia = [];
    for (const r of results) {
      const media = Array.isArray(r.content) ? r.content.filter((b) => b?.type === "image" || b?.type === "document") : [];
      const text = textOfParts(r.content) || (typeof r.content === "string" ? r.content : "");
      out.messages.push({
        role: "tool",
        tool_call_id: r.tool_use_id,
        content: text || (media.length ? `[${mediaWords(media)}, in the message after the tool results]` : ""),
      });
      if (!media.length) continue;
      const call = `tool call ${r.tool_use_id}${callNames.has(r.tool_use_id) ? ` (${callNames.get(r.tool_use_id)})` : ""}`;
      const one = media.length === 1 ? `the ${media[0].type}` : `the ${mediaWords(media)}`;
      carried.push({ type: "text", text: `[${one[0].toUpperCase()}${one.slice(1)} from ${call}:]` });
      for (const b of media) carried.push(openaiPart(b, notes, { from: `${call[0].toUpperCase()}${call.slice(1)} returned`, ask: "Get its text another way if you need it." }));
      carriedMedia.push(...media);
    }
    if (carriedMedia.length)
      notes.push(`${mediaWords(carriedMedia)} from tool results carried in a user message after the tool messages (OpenAI tool messages take text only)`);
    const rest = blocks.filter((b) => b.type !== "tool_result");
    if (rest.length || carried.length) {
      const parts = [...carried, ...rest.map((b) => openaiPart(b, notes, USER_ATTACHED))].filter(Boolean);
      const onlyText = parts.every((p) => p.type === "text");
      out.messages.push({ role: "user", content: onlyText ? parts.map((p) => p.text).join("") : parts });
    }
  }
  if (Array.isArray(src.tools) && src.tools.length) {
    const custom = src.tools.filter((t) => t && t.name && (t.input_schema || !t.type || t.type === "custom"));
    if (custom.length !== src.tools.length)
      notes.push("server tools (web_search, bash, …) dropped: OpenAI-format upstreams do not run them");
    out.tools = custom.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        ...(t.description ? { description: t.description } : {}),
        parameters: t.input_schema || { type: "object", properties: {} },
      },
    }));
  }
  const tc = src.tool_choice;
  if (isObj(tc)) {
    if (tc.type === "none") out.tool_choice = "none";
    else if (tc.type === "any") out.tool_choice = "required";
    else if (tc.type === "tool") out.tool_choice = { type: "function", function: { name: tc.name } };
    else out.tool_choice = "auto";
    if (tc.disable_parallel_tool_use) out.parallel_tool_calls = false;
  }
  if (src.max_tokens != null) out[maxTokensField] = src.max_tokens;
  if (src.temperature != null) out.temperature = src.temperature;
  if (src.top_p != null) out.top_p = src.top_p;
  if (Array.isArray(src.stop_sequences) && src.stop_sequences.length) out.stop = src.stop_sequences;
  if (src.stream === true) {
    out.stream = true;
    if (includeUsage) out.stream_options = { include_usage: true };
  }
  const eff = src.output_config?.effort;
  if (eff) out.reasoning_effort = eff;
  else if (src.thinking && src.thinking.type !== "disabled") {
    out.reasoning_effort = "medium";
    notes.push("thinking on without effort -> reasoning_effort medium");
  }
  if (src.output_config?.format?.type === "json_schema")
    out.response_format = {
      type: "json_schema",
      json_schema: { name: "response", schema: src.output_config.format.schema, strict: true },
    };
  if (src.metadata?.user_id) out.user = src.metadata.user_id;
  if ("speed" in src) notes.push("speed (fast mode) has no OpenAI equivalent; dropped");
  notes.unshift("translated Anthropic -> OpenAI request");
  return { body: out, notes };
}

// ---------------------------------------------------------------------------------------------------
// JSON responses
// ---------------------------------------------------------------------------------------------------
/**
 * @typedef {object} TranslateOptions
 * @property {string} [model]  the model name the client asked for, stamped on the translated reply
 * @property {boolean} [reasoning]  carry thinking across as reasoning content (default true)
 * @property {import("../ports.js").Clock} [now]  the clock for invented ids and `created` stamps
 * @property {(over: import("../lines.js").Over) => void} [onOver]  a stream's translator: told of each event it drops
 *   for a line past what Filament reads of one (`sseReader`)
 */

/** @param {any} msg @param {TranslateOptions} [opts] */
export function anthropicToOpenaiResponse(msg, { model, reasoning = true, now = Date.now } = {}) {
  const content =
    (msg.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("") || null;
  const thinking = (msg.content || [])
    .filter((b) => b.type === "thinking" && b.thinking)
    .map((b) => b.thinking)
    .join("\n");
  const tool_calls = (msg.content || [])
    .filter((b) => b.type === "tool_use")
    .map((b) => ({
      id: b.id,
      type: "function",
      function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
    }));
  const u = msg.usage || {};
  const prompt =
    (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  const message = {
    role: "assistant",
    content,
    ...(tool_calls.length ? { tool_calls } : {}),
    ...(reasoning && thinking ? { reasoning_content: thinking } : {}),
  };
  return {
    id: msg.id ? `chatcmpl-${msg.id}` : `chatcmpl-${now()}`,
    object: "chat.completion",
    created: Math.floor(now() / 1000),
    model: model || msg.model,
    choices: [{ index: 0, message, finish_reason: STOP_ANT_TO_OAI[msg.stop_reason] || "stop" }],
    usage: {
      prompt_tokens: prompt,
      completion_tokens: u.output_tokens || 0,
      total_tokens: prompt + (u.output_tokens || 0),
      prompt_tokens_details: { cached_tokens: u.cache_read_input_tokens || 0 },
    },
  };
}

/** @param {any} res @param {TranslateOptions} [opts] */
export function openaiToAnthropicResponse(res, { model, reasoning = true, now = Date.now } = {}) {
  const ch = res.choices?.[0] || {};
  const m = ch.message || {};
  const content = [];
  const rc = m.reasoning_content || m.reasoning;
  if (reasoning && typeof rc === "string" && rc) content.push({ type: "thinking", thinking: rc });
  const text = textOfParts(m.content);
  if (text) content.push({ type: "text", text });
  for (const tc of m.tool_calls || [])
    content.push({
      type: "tool_use",
      id: tc.id || stableId("call", `${tc.function?.name || "tool"}:${tc.function?.arguments ?? ""}`),
      name: tc.function?.name || "tool",
      input: parseJson(tc.function?.arguments, {}),
    });
  if (!content.length) content.push({ type: "text", text: "" });
  const u = res.usage || {};
  const cached = u.prompt_tokens_details?.cached_tokens || 0;
  return {
    id: res.id ? String(res.id).replace(/^chatcmpl-/, "msg_") : `msg_${now()}`,
    type: "message",
    role: "assistant",
    model: model || res.model,
    content,
    stop_reason: STOP_OAI_TO_ANT[ch.finish_reason] || "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: Math.max(0, (u.prompt_tokens || 0) - cached),
      output_tokens: u.completion_tokens || 0,
      cache_read_input_tokens: cached,
      cache_creation_input_tokens: 0,
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Streams. Each translator takes raw SSE text chunks from the upstream and returns SSE text for the client.
// `state` mirrors createSseScanner's shape so usage/stop reason/thinking chars keep flowing into records.
// ---------------------------------------------------------------------------------------------------
// `onEvent(data, parse)`: each event's data, and the parse to read it with — one that takes what a reader before this
// one parsed of the same chunk (`push`'s `known`, core/wire/sse.js `parseKnown`) instead of parsing it again. The events
// are read as core/wire/sse.js `createSseEventReader` reads them: one with a line past what Filament reads of one is
// dropped, `onOver` told, and the stream translated on past it.
/**
 * @param {(data: string, parse: (payload: string) => any) => void} onEvent
 * @param {{ onOver?: (over: import("../lines.js").Over) => void }} [o]
 */
export function sseReader(onEvent, { onOver = () => {} } = {}) {
  /** @type {(payload: string) => any} */
  let parse = JSON.parse;
  const events = createSseEventReader((_event, data) => {
    const payload = data.join("\n");
    if (payload) onEvent(payload, parse);
  }, { onOver });
  return {
    /** @param {string} chunk @param {import("./sse.js").Parsed | null} [known] */
    push(chunk, known = null) {
      parse = parseKnown(known);
      events.push(String(chunk));
    },
    flush() {
      parse = JSON.parse;
      events.end();
    },
  };
}

// Anthropic SSE -> OpenAI chunks
/** @param {TranslateOptions} [opts] */
export function createAnthropicToOpenaiStream({ model, reasoning = true, now = Date.now, onOver = () => {} } = {}) {
  const state = { usage: {}, stopReason: null, error: null, thinkingChars: 0, textChars: 0, events: 0 };
  let id = `chatcmpl-${now()}`,
    created = Math.floor(now() / 1000),
    out = "",
    started = false,
    finished = false,
    doneSent = false;
  const blocks = {};
  let toolIndex = -1;
  const chunk = (delta, finish = null, extra = {}) => {
    out += `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
  };
  /** The stream's end as an error, the OpenAI way: its chunk, then [DONE]. @param {string} message @param {string} type */
  const fail = (message, type) => {
    state.error = message;
    out += `data: ${JSON.stringify({ error: { message, type } })}\n\ndata: [DONE]\n\n`;
    doneSent = true;
    finished = true;
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
      case "message_start":
        id = e.message?.id ? `chatcmpl-${e.message.id}` : id;
        usageFromAnthropic(e.message?.usage, state.usage);
        if (!started) {
          started = true;
          chunk({ role: "assistant", content: "" });
        }
        break;
      case "content_block_start": {
        const b = e.content_block || {};
        blocks[e.index] = { type: b.type, tool: null };
        if (b.type === "tool_use") {
          toolIndex++;
          blocks[e.index].tool = toolIndex;
          chunk({
            tool_calls: [
              { index: toolIndex, id: b.id, type: "function", function: { name: b.name, arguments: "" } },
            ],
          });
        }
        break;
      }
      case "content_block_delta": {
        const d = e.delta || {};
        const blk = blocks[e.index] || {};
        if (d.type === "text_delta") {
          state.textChars += (d.text || "").length;
          chunk({ content: d.text || "" });
        } else if (d.type === "thinking_delta") {
          state.thinkingChars += (d.thinking || "").length;
          if (reasoning) chunk({ reasoning_content: d.thinking || "" });
        } else if (d.type === "input_json_delta")
          chunk({ tool_calls: [{ index: blk.tool ?? 0, function: { arguments: d.partial_json || "" } }] });
        break;
      }
      case "message_delta": {
        usageFromAnthropic(e.usage, state.usage);
        const sr = e.delta?.stop_reason;
        if (sr) state.stopReason = sr;
        if (!finished) {
          finished = true;
          if (!started) {
            started = true;
            chunk({ role: "assistant", content: "" });
          }
          chunk({}, STOP_ANT_TO_OAI[sr] || "stop");
          const u = state.usage;
          const prompt = (u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
          out += `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [], usage: { prompt_tokens: prompt, completion_tokens: u.output || 0, total_tokens: prompt + (u.output || 0), prompt_tokens_details: { cached_tokens: u.cacheRead || 0 } } })}\n\n`;
        }
        break;
      }
      case "message_stop":
        out += "data: [DONE]\n\n";
        doneSent = true;
        break;
      case "error":
        fail(e.error?.message || JSON.stringify(e.error || e), e.error?.type || "api_error");
        break;
      default:
        break; // ping, content_block_stop
    }
  }, { onOver });
  return {
    state,
    /** @param {string} chunk @param {import("./sse.js").Parsed | null} [known] */
    push(chunk, known = null) {
      reader.push(chunk, known);
      const s = out;
      out = "";
      return s;
    },
    end() {
      reader.flush();
      // A stream that ended with neither its message_delta nor its message_stop broke off mid-reply: it ends as an
      // error, never with a finish the upstream never sent.
      if (!finished && !doneSent) fail(INCOMPLETE_STREAM, "api_error");
      if (!finished && started) {
        chunk({}, "stop");
        finished = true;
      }
      if (started && !doneSent) {
        out += "data: [DONE]\n\n";
        doneSent = true;
      }
      const s = out;
      out = "";
      return s;
    },
  };
}

// OpenAI chunks -> Anthropic SSE
/** @param {TranslateOptions} [opts] */
export function createOpenaiToAnthropicStream({ model, reasoning = true, now = Date.now, onOver = () => {} } = {}) {
  const state = { usage: {}, stopReason: null, error: null, thinkingChars: 0, textChars: 0, events: 0 };
  let out = "",
    started = false,
    finished = false,
    doneSaid = false,
    msgId = `msg_${now()}`;
  let index = -1,
    openType = null; // current open content block
  const toolBlocks = new Map(); // openai tool index -> anthropic block index
  const ev = (type, data) => {
    out += `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  };
  const start = () => {
    if (started) return;
    started = true;
    ev("message_start", {
      message: {
        id: msgId,
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
  };
  const closeOpen = () => {
    if (openType) {
      ev("content_block_stop", { index });
      openType = null;
    }
  };
  const open = (type, block) => {
    closeOpen();
    index++;
    openType = type;
    ev("content_block_start", { index, content_block: block });
  };
  /** The stream's end as an error, the Anthropic way. @param {string} message */
  const fail = (message) => {
    state.error = message;
    start();
    ev("error", { error: { type: "api_error", message } });
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
      fail(c.error.message || JSON.stringify(c.error));
      return;
    }
    if (c.id) msgId = String(c.id).replace(/^chatcmpl-/, "msg_");
    if (c.usage) usageFromOpenAI(c.usage, state.usage);
    const ch = c.choices?.[0];
    if (!ch) return;
    start();
    const d = ch.delta || {};
    const rc = d.reasoning_content ?? d.reasoning;
    if (typeof rc === "string" && rc) {
      state.thinkingChars += rc.length;
      if (reasoning) {
        if (openType !== "thinking") open("thinking", { type: "thinking", thinking: "" });
        ev("content_block_delta", { index, delta: { type: "thinking_delta", thinking: rc } });
      }
    }
    if (typeof d.content === "string" && d.content) {
      state.textChars += d.content.length;
      if (openType !== "text") open("text", { type: "text", text: "" });
      ev("content_block_delta", { index, delta: { type: "text_delta", text: d.content } });
    }
    for (const tc of d.tool_calls || []) {
      const ti = tc.index ?? 0;
      if (!toolBlocks.has(ti)) {
        open("tool_use", {
          type: "tool_use",
          id: tc.id || `call_${ti}_${now()}`,
          name: tc.function?.name || "tool",
          input: {},
        });
        toolBlocks.set(ti, index);
      }
      const args = tc.function?.arguments;
      if (args)
        ev("content_block_delta", {
          index: toolBlocks.get(ti),
          delta: { type: "input_json_delta", partial_json: args },
        });
    }
    if (ch.finish_reason && !finished) {
      finished = true;
      state.stopReason = STOP_OAI_TO_ANT[ch.finish_reason] || "end_turn";
      closeOpen();
    }
  }, { onOver });
  const finalize = () => {
    if (!started) start();
    closeOpen();
    const u = state.usage;
    ev("message_delta", {
      delta: { stop_reason: state.stopReason || "end_turn", stop_sequence: null },
      usage: {
        input_tokens: u.input || 0,
        output_tokens: u.output || 0,
        cache_read_input_tokens: u.cacheRead || 0,
        cache_creation_input_tokens: 0,
      },
    });
    ev("message_stop", {});
  };
  return {
    state,
    /** @param {string} chunk @param {import("./sse.js").Parsed | null} [known] */
    push(chunk, known = null) {
      reader.push(chunk, known);
      const s = out;
      out = "";
      return s;
    },
    end() {
      reader.flush();
      // A stream that ended with neither a finish_reason nor its [DONE] broke off mid-reply: it ends as an error, never
      // with an end_turn the upstream never sent.
      if (!state.error) {
        if (finished || doneSaid) finalize();
        else fail(INCOMPLETE_STREAM);
      }
      const s = out;
      out = "";
      return s;
    },
  };
}
