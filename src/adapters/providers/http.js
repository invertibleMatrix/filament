// Upstream forwarding, streaming passthrough with usage scanning, and stream<->JSON conversion.
import { StringDecoder } from "node:string_decoder";
import { usageFromAnthropic, usageFromOpenAI, usageFromResponses } from "../../core/wire/usage.js";
import { createSseDataReader, createSseFold, parseKnown } from "../../core/wire/sse.js";
import { EFFORT_LEVELS, UPSTREAM_TYPES } from "../../core/schema.js";
import { upstreamBaseUrl, upstreamVersionedBase, authHeaders } from "../../core/routing.js";
import { providerFetch } from "./fetch.js";
// Hot path: bytes from the upstream are written to the client as they arrive; only SSE "data:" lines are
// inspected, and only to pull usage numbers out. No buffering of the full response in streaming mode.

/**
 * How long a reply's body may send nothing at all before Filament cuts it (the owner's word of 10-29): a provider that
 * stopped mid-reply with its connection still open held an agent's round forever — a Hunter on ZAI sat at round 104,
 * "Working" in Now, for as long as Filament ran. A slow reply that is still working sends bytes — its thinking, a
 * provider's keep-alive — so ten minutes of silence is a reply that will not come. Cut, it is a stream that broke off on
 * the provider's side, which Filament's own loops ask again (core/retry.js). `FILAMENT_SILENT_REPLY_MS` sets another
 * limit, for a test.
 */
export const SILENT_REPLY_MS = 10 * 60_000;

/** The silence limit now: the environment's, where it names one. */
const silentReplyMs = () => {
  const n = Number(process.env.FILAMENT_SILENT_REPLY_MS);
  return Number.isFinite(n) && n > 0 ? n : SILENT_REPLY_MS;
};

/** A while as a failure says it: "10 min", "0.3 s". @param {number} ms */
export const whileWords = (ms) => (ms % 60_000 === 0 ? `${ms / 60_000} min` : `${Math.round(ms / 100) / 10} s`);

/** A reply's silence as its failure says it: "it sent nothing for 10 min mid-reply". @param {number} ms */
export const silentWords = (ms) => `it sent nothing for ${whileWords(ms)} mid-reply`;

/**
 * A reply's body that fails once its provider has sent nothing for `ms` while it was waited on — the time a slow reader
 * takes is never counted — aborting the request (`abort`) so its connection closes. One timer for the whole body,
 * started again at each read: the read is the chunk's one promise, and the silence fails the body from the timer itself.
 * @param {Response} res @param {() => void} abort @param {number} ms
 * @returns {Response}
 */
function silenceWatched(res, abort, ms) {
  if (!res.body) return res;
  const reader = res.body.getReader();
  /** A read is out: the silence counts only then — a timer that fires between reads is no silence. */
  let waiting = false;
  /** The silence's failure, once it came: the read it outran fails or ends after it, and nothing is said of that. @type {Error | null} */
  let silenced = null;
  /** @type {ReadableStreamDefaultController<Uint8Array> | null} */
  let controller = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  const onSilence = () => {
    if (!waiting || !controller) return;
    silenced = Object.assign(new Error(silentWords(ms)), { code: "FILAMENT_SILENT_REPLY" });
    abort();
    reader.cancel().catch(() => {});
    controller.error(silenced);
  };
  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const body = new ReadableStream({
    async pull(c) {
      controller = c;
      // Between reads the timer holds nothing open: it counts, and keeps the process up, only while a read is out.
      if (timer) timer.refresh().ref();
      else timer = setTimeout(onSilence, ms);
      waiting = true;
      try {
        const { value, done } = await reader.read();
        waiting = false;
        timer?.unref();
        if (silenced) return;
        if (done) {
          stop();
          c.close();
        } else c.enqueue(value);
      } catch (e) {
        waiting = false;
        if (silenced) return;
        stop();
        c.error(e);
      }
    },
    cancel(reason) {
      stop();
      return reader.cancel(reason);
    },
  });
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

// The request to the provider waits for the reply's head as long as the provider takes (HarnessV3-FailurePoints §4 A);
// between the chunks of its body, until it has sent nothing for the silence limit (`SILENT_REPLY_MS`). It ends when the
// provider answers or fails, when the network fails it, or when the client hangs up (`signal`) — one that already has
// sends the provider nothing: an abort that came before the listener is never heard by it. `fetchImpl`: another way
// there — another machine's Filament, pinned to its certificate (filament.js).
export async function forwardRequest({ url, headers, bodyString, signal, fetchImpl = providerFetch }) {
  signal?.throwIfAborted();
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetchImpl(url, { method: "POST", headers, body: bodyString, signal: ctrl.signal });
    return {
      res: silenceWatched(res, () => ctrl.abort(), silentReplyMs()),
      cleanup: () => signal?.removeEventListener("abort", onAbort),
      abort: () => ctrl.abort(),
    };
  } catch (e) {
    signal?.removeEventListener("abort", onAbort);
    throw e;
  }
}

/**
 * A provider's reply whose body failed while it was read, its client still there — its connection lost, or cut by its
 * silence (`SILENT_REPLY_MS`): the provider's failure, which the reply's close judges it by as by a stream that broke
 * off, never one of Filament's own (dispatch/reply-stream.js, reply-json.js: returned as `broke`, never thrown). Its
 * message is the failure's own.
 */
export class ReplyReadError extends Error {
  /** @param {unknown} cause */
  constructor(cause) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "ReplyReadError";
  }
}

// Resolve when the socket can take more data, or when it is gone. Awaiting a bare "drain" hangs forever if the
// client disconnects while the write buffer is full, which left ghost in-flight requests behind.
export function waitDrain(stream) {
  return new Promise((resolve) => {
    if (!stream || stream.destroyed || stream.writableEnded || stream.closed) return resolve();
    const done = () => {
      stream.off("drain", done);
      stream.off("close", done);
      stream.off("error", done);
      resolve();
    };
    stream.once("drain", done);
    stream.once("close", done);
    stream.once("error", done);
  });
}

// ---------------------------------------------------------------------------------------------------
// Usage extraction
// ---------------------------------------------------------------------------------------------------
// The usage readers live in core/wire/usage.js; re-exported for the callers that learned them here.
export { usageFromAnthropic, usageFromOpenAI, usageFromResponses } from "../../core/wire/usage.js";
const responsesStop = (r) =>
  r?.status === "incomplete"
    ? r.incomplete_details?.reason || "incomplete"
    : r?.status === "failed"
      ? "failed"
      : (r?.output || []).some((it) => it.type === "function_call")
        ? "tool_calls"
        : "stop";

// Incremental SSE scanner. Feed decoded text; it tracks usage, stop reason, error and thinking chars, the tool calls the
// reply makes (`toolCalls`: a tool_use block, a Chat Completions call's index, a Responses function call), and whether
// the reply said its end (`ended`: its stop reason, finish_reason, [DONE] or final response — a stream that stopped with
// none broke off mid-reply). `feed` and `end` take what a reader before it parsed of the same text (`known`,
// core/wire/sse.js `parseKnown`), and `parsed` is what the last of them parsed, for the reader after it. A line past
// what Filament reads of one is dropped, `onOver` told.
/** @param {string} format @param {{ onOver?: (over: import("../../core/lines.js").Over) => void }} [o] */
export function createSseScanner(format, { onOver = () => {} } = {}) {
  const state = { usage: {}, stopReason: null, error: null, thinkingChars: 0, textChars: 0, toolCalls: 0, events: 0, ended: false };
  /** The Chat Completions calls counted, by their index: a call's arguments come in many chunks. @type {Set<number>} */
  const calls = new Set();
  /** @type {import("../../core/wire/sse.js").Parsed} */
  let parsed = [];
  /** @type {(payload: string) => any} */
  let parse = JSON.parse;
  const onData = (dataStr) => {
    if (!dataStr) return;
    if (dataStr === "[DONE]") {
      state.ended = true;
      return;
    }
    let j;
    try {
      j = parse(dataStr);
    } catch {
      return;
    }
    parsed.push([dataStr, j]);
    state.events++;
    if (format === "anthropic") {
      if (j.type === "message_start") usageFromAnthropic(j.message?.usage, state.usage);
      else if (j.type === "message_delta") {
        usageFromAnthropic(j.usage, state.usage);
        if (j.delta?.stop_reason) {
          state.stopReason = j.delta.stop_reason;
          state.ended = true;
        }
      } else if (j.type === "message_stop") state.ended = true;
      else if (j.type === "content_block_start") {
        if (j.content_block?.type === "tool_use") state.toolCalls++;
      } else if (j.type === "content_block_delta") {
        if (j.delta?.type === "thinking_delta") state.thinkingChars += (j.delta.thinking || "").length;
        else if (j.delta?.type === "text_delta") state.textChars += (j.delta.text || "").length;
      } else if (j.type === "error") state.error = j.error?.message || JSON.stringify(j.error || j);
    } else if (format === "responses") {
      if (j.type === "response.output_text.delta") state.textChars += String(j.delta || "").length;
      else if (j.type === "response.output_item.added") {
        if (j.item?.type === "function_call") state.toolCalls++;
      } else if (
        j.type === "response.reasoning_summary_text.delta" ||
        j.type === "response.reasoning_text.delta"
      )
        state.thinkingChars += String(j.delta || "").length;
      else if (
        j.type === "response.completed" ||
        j.type === "response.incomplete" ||
        j.type === "response.failed"
      ) {
        usageFromResponses(j.response?.usage, state.usage);
        if (typeof j.response?.service_tier === "string") state.usage.tier = j.response.service_tier;
        state.stopReason = responsesStop(j.response);
        state.final = j.response || null;
        state.ended = true;
        if (j.type === "response.failed") state.error = j.response?.error?.message || "response failed";
      } else if (j.type === "error") state.error = j.message || "error";
    } else {
      if (j.usage) usageFromOpenAI(j.usage, state.usage);
      // The tier the provider served (xAI and OpenAI name it on every chunk): a fast request bills fast only if it matches.
      if (typeof j.service_tier === "string") state.usage.tier = j.service_tier;
      const c = j.choices?.[0];
      if (c?.finish_reason) {
        state.stopReason = c.finish_reason;
        state.ended = true;
      }
      // Reasoning comes as `reasoning_content` or, from OpenRouter, Ollama and the like, `reasoning`: read as the
      // translators read it, one spelling a delta.
      const thought = c?.delta?.reasoning_content ?? c?.delta?.reasoning;
      if (typeof thought === "string" && thought) state.thinkingChars += thought.length;
      if (c?.delta?.content) state.textChars += String(c.delta.content).length;
      for (const tc of Array.isArray(c?.delta?.tool_calls) ? c.delta.tool_calls : []) calls.add(Number(tc?.index) || 0);
      state.toolCalls = calls.size;
      if (j.error) state.error = j.error?.message || JSON.stringify(j.error);
    }
  };
  const reader = createSseDataReader(onData, { onOver });
  return {
    state,
    /** @param {string} text @param {import("../../core/wire/sse.js").Parsed | null} [known] */
    feed(text, known = null) {
      parsed = [];
      parse = parseKnown(known);
      reader.feed(text);
    },
    /** @param {import("../../core/wire/sse.js").Parsed | null} [known] */
    end(known = null) {
      parsed = [];
      parse = parseKnown(known);
      reader.end();
    },
    get parsed() {
      return parsed;
    },
  };
}

// First-event gate: decide, before any byte is forwarded, whether an SSE reply that arrived as HTTP 200 opens
// with an error instead of content (the OpenAI-compat convention of putting errors inside the stream). Generic
// over the three wire formats — the same incremental scanner the pipeline uses reports both. On "live" the
// buffered chunks and the still-open reader are handed back so the caller can reattach them losslessly — with `idle`,
// settled once the gate reads no more: a timeout's verdict leaves the gate's read out, and its chunk joins `chunks`.
export async function gateSseFirstEvent(body, format, { firstEventMs = 1500, maxBufferBytes = 65536 } = {}) {
  const scanner = createSseScanner(format);
  const decoder = new TextDecoder();
  const chunks = [];
  const reader = body.getReader();
  let bytes = 0,
    settled = false,
    timer = null,
    /** @type {Promise<void>} */ idle = Promise.resolve();
  const settle = (v) => {
    settled = true;
    if (timer) clearTimeout(timer);
    return v;
  };
  const verdict = await new Promise((resolve) => {
    timer = setTimeout(() => resolve(settle({ verdict: "live", reason: "timeout" })), firstEventMs);
    idle = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) {
            resolve(settle({ verdict: "live", reason: "end" }));
            return;
          }
          chunks.push(value); // every consumed chunk is kept, so a late timeout can never lose bytes
          if (settled) return;
          bytes += value.byteLength;
          scanner.feed(decoder.decode(value, { stream: true }));
          const st = scanner.state;
          if (st.error && !st.textChars && !st.thinkingChars) {
            resolve(settle({ verdict: "error", error: st.error }));
            return;
          }
          if (st.textChars || st.thinkingChars) {
            resolve(settle({ verdict: "live", reason: "content" }));
            return;
          }
          if (bytes >= maxBufferBytes) {
            resolve(settle({ verdict: "live", reason: "bulk" }));
            return;
          }
        }
      } catch (e) {
        resolve(settle({ verdict: "error", error: `the reply could not be read: ${e.message}` }));
      }
    })();
  });
  return {
    ...verdict,
    chunks,
    reader,
    idle,
    cancel: () => {
      try {
        reader.cancel();
      } catch {}
    },
  };
}

/**
 * The body the gate held back, followed by everything its reader still holds: byte-for-byte the original stream, read
 * as its own reader asks — a client that reads slowly holds the provider back, where pumping it all in at once buffered
 * the whole reply. The gate's read still out when its verdict came is the next chunk in order: it is waited for first.
 * @param {{ chunks: Uint8Array[], reader: ReadableStreamDefaultReader<Uint8Array>, idle: Promise<void> }} gate
 */
export function reattachSseBody({ chunks, reader, idle }) {
  let next = 0;
  return new ReadableStream({
    async pull(controller) {
      await idle;
      if (next < chunks.length) return controller.enqueue(chunks[next++]);
      try {
        const { value, done } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (e) {
        try {
          controller.error(e);
        } catch {}
      }
    },
    cancel() {
      try {
        reader.cancel();
      } catch {}
    },
  });
}

// Pipe an upstream streaming body to the client response. Returns scanner state when done: with `fold`, the reply
// the bytes streamed folded as they came, in the scanner's format or the one `fold` names (a Responses-wire reply,
// which the scanner reads as its provider's) — `fold.reply()` is `sseToJson` of that text, the text never kept, read
// as Buffer would decode the bytes, which keeps a leading BOM where the scanner's decoding drops it. `onOver`: told of
// each line past what Filament reads of one, which the scanner and the fold drop (the bytes go to the client as they
// came); a fold that lacks one is the format's error in words that say so. `gone`: whether the client is gone — it hung
// up, or a stop ended its request — which aborts the read with the request (forwardRequest): the reply ends there, its
// state what the stream said so far, as at a hang-up the send waits on (`waitDrain`), never as the upstream's failure.
// A read that fails with its client still there ends it there too, its state what the stream said so far, the
// provider's failure said beside it (`broke`, a `ReplyReadError`). `scanner`: the caller's own, which it reads what the
// stream said so far off while the stream is read — one in the format's own otherwise.
/**
 * @param {{ upstreamRes: any, clientRes: any, format: string, onFirstByte?: () => void, onProgress?: (chars: number) => void,
 *   fold?: boolean | import("../../core/types.js").WireFormat, onOver?: (over: import("../../core/lines.js").Over) => void,
 *   gone?: () => boolean, scanner?: ReturnType<typeof createSseScanner> }} o
 */
export async function pipeStream({
  upstreamRes,
  clientRes,
  format,
  onFirstByte,
  onProgress,
  fold = false,
  onOver = () => {},
  gone = () => false,
  scanner = createSseScanner(format, { onOver }),
}) {
  const decoder = new TextDecoder();
  const folding = fold ? { reply: createSseFold(typeof fold === "string" ? fold : format, { onOver, whole: true }), text: new StringDecoder("utf8") } : null;
  let first = true;
  /** The read that failed with its client still there: the provider's failure. @type {ReplyReadError | null} */
  let broke = null;
  const reader = upstreamRes.body.getReader();
  try {
    for (;;) {
      /** @type {ReadableStreamReadResult<Uint8Array>} */
      let read;
      try {
        read = await reader.read();
      } catch (e) {
        if (!gone()) broke = new ReplyReadError(e);
        break;
      }
      const { value, done } = read;
      if (done) break;
      if (first) {
        first = false;
        onFirstByte?.();
      }
      if (clientRes) {
        if (!clientRes.write(value)) {
          await waitDrain(clientRes);
          if (clientRes.destroyed) {
            await reader.cancel().catch(() => {});
            break;
          }
        }
      }
      scanner.feed(decoder.decode(value, { stream: true }));
      folding?.reply.feed(folding.text.write(value), scanner.parsed);
      onProgress?.(scanner.state.textChars + scanner.state.thinkingChars);
    }
    scanner.feed(decoder.decode());
    folding?.reply.feed(folding.text.end(), scanner.parsed);
    scanner.end();
    folding?.reply.end(scanner.parsed);
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
  return {
    ...scanner.state,
    fold: folding?.reply ?? null,
    broke,
  };
}

// Stream <-> JSON conversions live in core/wire/sse.js; re-exported so existing importers keep working.
export { sseToJson, jsonToSse } from "../../core/wire/sse.js";

// ---------------------------------------------------------------------------------------------------
// The HTTP provider as a destination (core/ports.js `Destination`): the shaped request forwarded as-is, the model
// list from GET /v1/models (cached per upstream; the composition root persists the cache), the connection test.
// ---------------------------------------------------------------------------------------------------
const modelCache = new Map(); // upstream id -> { at, names, windows, caps }
// Persisted across restarts by the server so model lists show up instantly after a restart.
export function seedModelCache(obj) {
  for (const [id, v] of Object.entries(obj || {}))
    if (v && Array.isArray(v.names))
      modelCache.set(id, { at: v.at || 0, names: v.names, windows: plainWindows(v.windows), caps: plainCapsTable(v.caps) });
}
export function dumpModelCache() {
  return Object.fromEntries(modelCache);
}
/** When this upstream's list was last discovered (ms), or 0 when it never was. @param {string} upstreamId */
export function discoveredAt(upstreamId) {
  return modelCache.get(String(upstreamId || ""))?.at || 0;
}
/** Drop an upstream's discovered list: it was removed, or its listing now comes from somewhere else. @param {string} upstreamId */
export function forgetModelCache(upstreamId) {
  return modelCache.delete(String(upstreamId || ""));
}
/**
 * The entries of a model listing, in the shapes providers publish: OpenAI's `{ data: [...] }`, `{ models: [...] }`
 * (Gemini, Ollama), or a bare array. Discovery and the connection test read the same list. @param {any} j
 */
function listingOf(j) {
  return Array.isArray(j?.data) ? j.data : Array.isArray(j?.models) ? j.models : Array.isArray(j) ? j : [];
}
/** A listing entry's model name (a bare string, or its `id`/`name`), or "" when it has none. @param {any} m */
const listedName = (m) => {
  const s = typeof m === "string" ? m : m?.id || m?.name;
  return typeof s === "string" ? s : "";
};
/**
 * The context windows this upstream's own model listing stated, when discovery captured any: `{ [name]: tokens }`
 * in the endpoint's spelling. Consumers resolve against the RENDERED wire name; pricing's lookup gives it the
 * tier between the operator's tables and the built-in estimates.
 * @param {string} upstreamId
 * @returns {Record<string, number> | null}
 */
export function discoveredWindows(upstreamId) {
  const w = modelCache.get(String(upstreamId || ""))?.windows;
  return w && Object.keys(w).length ? w : null;
}
/**
 * The names this upstream's own model listing returned at the last discovery, or null when it was never asked.
 * @param {string} upstreamId
 * @returns {string[] | null}
 */
export function discoveredNames(upstreamId) {
  const n = modelCache.get(String(upstreamId || ""))?.names;
  return Array.isArray(n) && n.length ? n : null;
}
/**
 * What this upstream's own model listing stated about each model beyond its window — the reasoning levels it takes,
 * whether it takes extended thinking, its output ceiling, whether it takes tools — `{ [name]: caps }` in the
 * endpoint's spelling, or null when the listing said nothing (OpenAI's and xAI's list names only; Anthropic's states
 * the first three, OpenRouter's the last two).
 * @param {string} upstreamId
 * @returns {Record<string, { efforts?: string[], thinking?: boolean, maxOutput?: number, tools?: boolean }> | null}
 */
export function discoveredCaps(upstreamId) {
  const c = modelCache.get(String(upstreamId || ""))?.caps;
  return c && Object.keys(c).length ? c : null;
}
/** Only plain number records survive the cache round-trip; anything else discovery met is noise. */
function plainWindows(w) {
  if (!w || typeof w !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(w))
    if (typeof v === "number" && Number.isFinite(v) && v >= 1000 && v <= 100_000_000) out[k] = v;
  return out;
}
/** One model's stated capabilities, kept only in the shape Filament reads (a cache file edited by hand is sanitized,
 *  never trusted). @param {any} c */
function plainCaps(c) {
  if (!c || typeof c !== "object") return null;
  /** @type {{ efforts?: string[], thinking?: boolean, maxOutput?: number, tools?: boolean }} */
  const out = {};
  if (Array.isArray(c.efforts)) out.efforts = EFFORT_LEVELS.filter((l) => c.efforts.includes(l));
  if (typeof c.thinking === "boolean") out.thinking = c.thinking;
  const mo = Number(c.maxOutput);
  if (c.maxOutput != null && Number.isFinite(mo) && mo >= 256 && mo <= 10_000_000) out.maxOutput = Math.floor(mo);
  if (typeof c.tools === "boolean") out.tools = c.tools;
  return Object.keys(out).length ? out : null;
}
/** @param {any} t */
function plainCapsTable(t) {
  if (!t || typeof t !== "object") return {};
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, v] of Object.entries(t)) {
    const c = plainCaps(v);
    if (c) out[k] = c;
  }
  return out;
}
/**
 * The capabilities a listing entry states, read from the shapes providers actually publish: Anthropic's
 * `capabilities.effort.<level>.supported` and `capabilities.thinking.supported` beside its `max_tokens` (only with its
 * `max_input_tokens`: elsewhere `max_tokens` is not always the output ceiling), OpenRouter's
 * `top_provider.max_completion_tokens`, Groq's top-level `max_completion_tokens`; whether it takes tools from
 * OpenRouter's `supported_parameters` (the whole list of what it takes, so one without `tools` says none) and
 * Mistral's `capabilities.function_calling`. A listing that does not say is not read as "no": absence claims nothing.
 * Fast mode is never listed (Anthropic's is a beta header, xAI's a service tier) — that one is the operator's to
 * declare.
 * @param {any} m
 */
function capsOf(m) {
  if (!m || typeof m !== "object") return null;
  const c = m.capabilities && typeof m.capabilities === "object" ? m.capabilities : null;
  /** @type {{ efforts?: string[], thinking?: boolean, maxOutput?: number, tools?: boolean }} */
  const out = {};
  if (Array.isArray(m.supported_parameters) && m.supported_parameters.length) out.tools = m.supported_parameters.includes("tools");
  else if (typeof c?.function_calling === "boolean") out.tools = c.function_calling;
  const e = c?.effort;
  if (e && typeof e === "object") {
    if (e.supported === false) out.efforts = [];
    else if (e.supported === true) {
      const levels = EFFORT_LEVELS.filter((l) => e[l]?.supported === true);
      if (levels.length) out.efforts = levels;
    }
  }
  if (typeof c?.thinking?.supported === "boolean") out.thinking = c.thinking.supported;
  const max = m.max_input_tokens != null ? m.max_tokens : m.top_provider?.max_completion_tokens ?? m.max_completion_tokens;
  return plainCaps({ ...out, ...(max != null ? { maxOutput: max } : {}) });
}
// The fields a provider's model listing uses for its context window, when it states one at all. OpenRouter and
// LM Studio are the common ones; OpenAI's and Anthropic's listings carry nothing, which is why discovery also
// leaves this empty. First field present wins; a value outside sane bounds is dropped, not trusted.
const WINDOW_FIELDS = ["context_length", "max_model_len", "max_context_length", "max_input_tokens", "context_window"];
const windowOf = (m) => {
  if (!m || typeof m !== "object") return null;
  for (const f of WINDOW_FIELDS) {
    const n = Number(m[f]);
    if (Number.isFinite(n) && n >= 1000 && n <= 100_000_000) return n;
  }
  return null;
};

/**
 * One GET of an upstream's model list, under both auth styles, read in every listing shape: the status, the time, the
 * body's text, and the entries — null when the body is not a listing (not JSON, or JSON of another shape). Discovery,
 * the connection test and the add flow's probe all read the list through this, so they can never disagree on it.
 * @param {any} u
 * @returns {Promise<{ status: number, ok: boolean, ms: number, text: string, json: any, parseError: Error | null, list: any[] | null }>}
 */
async function readListing(u) {
  const [base, ver] = upstreamVersionedBase(u);
  const path = u.modelsPath && u.modelsPath.trim() ? u.modelsPath.trim() : `/${ver}/models`;
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`;
  const t0 = performance.now();
  // Composed as a request's are (core/shaping.js `shapeHeaders`): the upstream's own extra headers over the defaults,
  // and its key over them, so a provider that asks for a header of its own lists its models too.
  const r = await fetch(url, {
    headers: {
      "anthropic-version": "2023-06-01",
      "user-agent": "filament/0.1",
      ...Object.fromEntries(Object.entries(u.headers && typeof u.headers === "object" ? u.headers : {}).map(([k, v]) => [k.toLowerCase(), String(v)])),
      ...authHeaders(u, "openai"),
      ...authHeaders(u, "anthropic"),
    },
    signal: AbortSignal.timeout(15000),
  });
  return listingRead(r, t0);
}

/**
 * The most a model listing may be, in bytes: OpenRouter's, the largest a provider publishes, its every model described
 * and priced, is a few megabytes; another machine's Filament, or whatever answers at a provider's address, that sends on
 * without end fills nothing here.
 */
const LISTING_MAX = 16 * 1024 * 1024;

/**
 * A model listing's answer read whole, as `readListing` reads it, from a GET that started at `t0` (performance.now()):
 * one that says it is longer than LISTING_MAX, or goes on past it, fails in words — the rest unread, its connection
 * let go.
 * @param {Response} r @param {number} t0
 */
export async function listingRead(r, t0) {
  const tooMuch = () => new Error(`its model list is more than ${LISTING_MAX / 1024 / 1024} MB: it is read no further`);
  if (Number(r.headers.get("content-length")) > LISTING_MAX) {
    void r.body?.cancel().catch(() => {});
    throw tooMuch();
  }
  /** @type {Uint8Array[]} */
  const parts = [];
  let size = 0;
  const reader = r.body?.getReader();
  while (reader) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > LISTING_MAX) {
      void reader.cancel().catch(() => {});
      throw tooMuch();
    }
    parts.push(value);
  }
  const text = new TextDecoder().decode(Buffer.concat(parts, size));
  let json = null;
  /** @type {Error | null} */
  let parseError = null;
  try {
    json = JSON.parse(text);
  } catch (e) {
    parseError = /** @type {Error} */ (e);
  }
  const list = Array.isArray(json?.data) || Array.isArray(json?.models) || Array.isArray(json) ? listingOf(json) : null;
  return { status: r.status, ok: r.ok, ms: Math.round(performance.now() - t0), text, json, parseError, list };
}

/**
 * The names a listing gave, with the context windows and capabilities its entries state beside them (most providers
 * state none; Anthropic's and OpenRouter-style listings do), each kept per name in the endpoint's spelling.
 * @param {any[]} list
 */
export function namesOfListing(list) {
  const names = list.map(listedName).filter(Boolean);
  /** @type {Record<string, number>} */
  const windows = {};
  /** @type {Record<string, any>} */
  const caps = {};
  for (const m of list) {
    if (!m || typeof m !== "object") continue;
    const name = m.id || m.name;
    if (typeof name !== "string" || !name) continue;
    const w = windowOf(m);
    if (w != null) windows[name] = w;
    const c = capsOf(m);
    if (c) caps[name] = c;
  }
  return { names, windows, caps };
}

/**
 * An upstream's names: from the cache on a read, asked of it on a Refresh or a save. `read`: how its listing is read —
 * GET /{ver}/models here; another machine's through its Filament (filament.js) —, whose throw is the error said.
 * @param {any} upstream @param {{ force?: boolean, read?: typeof readListing }} [o]
 */
export async function fetchUpstreamModels(upstream, { force = false, read = readListing } = {}) {
  const manual = (upstream.models || []).filter(Boolean);
  if (
    upstream.discoverModels === false ||
    UPSTREAM_TYPES[upstream.type]?.local ||
    UPSTREAM_TYPES[upstream.type]?.builtin
  )
    return { names: manual, source: "manual" };
  const cached = modelCache.get(upstream.id);
  // Discovery is asked for by the dashboard's Refresh and by a save that added or changed the upstream
  // (`createModelCache`, in the background) — never by a page being opened: a read that is not forced answers from
  // the cache plus the manual list (F16's four-second picker was a read that fetched).
  if (!force)
    return cached
      ? { names: [...new Set([...cached.names, ...manual])], source: "cache" }
      : { names: manual, source: "manual" };
  try {
    const got = await read(upstream);
    if (!got.ok) throw new Error(`HTTP ${got.status}`);
    if (got.parseError) throw got.parseError;
    const { names, windows, caps } = namesOfListing(got.list || []);
    modelCache.set(upstream.id, { at: Date.now(), names, windows, caps });
    return { names: [...new Set([...names, ...manual])], source: "discovered", windowCount: Object.keys(windows).length, capsCount: Object.keys(caps).length };
  } catch (e) {
    return { names: manual, source: "error", error: e.message, cached: cached?.names || [] };
  }
}

// Connection test: GET /v1/models under both auth styles; the status, a sample of the body and the names it listed
// (the first 500) are what the dashboard shows — the person sees the models before anything is saved (Providers F2).
// An upstream with no key (Ollama, LM Studio, a gateway on this computer) is asked without one; one that then refuses
// is said to ask for a key.
/**
 * @param {any} u
 * @returns {Promise<{ ok: boolean, status: number, ms: number, models: number | null, names: string[], sample: string, error?: string }>}
 */
export async function testProvider(u) {
  const t0 = performance.now();
  try {
    const got = await readListing(u);
    const names = got.list ? got.list.map(listedName).filter(Boolean) : null;
    const wantsKey = !u.apiKey && (got.status === 401 || got.status === 403);
    return {
      ok: got.status < 400,
      status: got.status,
      ms: got.ms,
      models: names ? names.length : null,
      names: names ? names.slice(0, 500) : [],
      sample: got.text.slice(0, 200),
      ...(wantsKey ? { error: "it asks for a key, and none is set" } : {}),
    };
  } catch (e) {
    return { ok: false, status: 0, ms: Math.round(performance.now() - t0), models: null, names: [], sample: "", error: noAnswerWords(u, e) };
  }
}

/**
 * Why a listing read got no answer, as the person reads it under a Test or the add sheet's key box: the plain fact
 * first, the system's code after it.
 * @param {any} u @param {any} e
 */
function noAnswerWords(u, e) {
  let host = "";
  try {
    host = new URL(upstreamVersionedBase(u)[0]).host;
  } catch {}
  const code = e.cause?.code || "";
  if (e.name === "TimeoutError") return "no answer within 15 seconds";
  if (code === "ECONNREFUSED") return `nothing answers at ${host} (${code})`;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return `no such host: ${host} (${code})`;
  if (e.cause?.message === "bad port") return `${host}: that port is blocked for web requests (bad port)`;
  return code || (e.cause?.message ? `${e.message}: ${e.cause.message}` : e.message);
}

/**
 * The add flow's probe (Providers P1): a draft provider's whole model list, asked once and kept nowhere — the model
 * cache is only written for an upstream that was saved (a save that adds one asks it itself), so a probe that is
 * abandoned leaves nothing behind. A keyless draft (Ollama, LM Studio) is asked without a key.
 * @param {any} u
 * @returns {Promise<{ ok: boolean, status: number, ms: number, names: string[], sample: string, error?: string }>}
 */
export async function probeProviderModels(u) {
  const t0 = performance.now();
  try {
    const got = await readListing(u);
    const sample = got.text.slice(0, 300);
    if (!got.ok) return { ok: false, status: got.status, ms: got.ms, names: [], sample, error: `HTTP ${got.status}` };
    if (!got.list) return { ok: false, status: got.status, ms: got.ms, names: [], sample, error: "the answer is not a model list" };
    return { ok: true, status: got.status, ms: got.ms, names: namesOfListing(got.list).names, sample };
  } catch (e) {
    return { ok: false, status: 0, ms: Math.round(performance.now() - t0), names: [], sample: "", error: noAnswerWords(u, e) };
  }
}

/** @returns {import("../../core/ports.js").Destination} */
export function httpDestination(upstream) {
  return {
    id: upstream.id,
    type: upstream.type,
    label: "HTTP provider",
    transport: null,
    agent: null,
    answers: {
      open: ({ url, headers, bodyString, signal }) => forwardRequest({ url, headers, bodyString, signal }),
      unreachable: (e) => ({
        message: `upstream ${upstream.id} unreachable: ${e.cause?.code || e.message}`,
        retryable: true,
      }),
    },
    listModels: (opts = {}) => fetchUpstreamModels(upstream, opts),
    test: () => testProvider(upstream),
  };
}
