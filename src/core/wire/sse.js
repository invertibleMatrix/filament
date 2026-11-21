// @ts-check
// Pure conversions between a complete JSON reply and its SSE stream form, both directions, for the three
// wire formats. Used when the client's stream preference differs from what went upstream and when Filament
// answers a request itself.

import { createAnthropicFold } from "./anthropic-fold.js";
import { INCOMPLETE_STREAM } from "./errors.js";
import { LINE_MAX, createLineReader } from "../lines.js";

/** @typedef {import("../types.js").WireFormat} WireFormat */
/** @typedef {import("../lines.js").Over} Over */

/**
 * The payloads one reader parsed from a piece of a stream's text, `[payload, value]` in the order it read them: handed
 * to the next reader of the same piece, so an event is parsed once on its way through Filament (`parseKnown`).
 * @typedef {[string, any][]} Parsed
 */

/** A line past what Filament reads of one, by its size. @param {number} length */
const pastLineMax = (length) => `a line of ${Math.round(length / 2 ** 20)} MiB, past the ${LINE_MAX / 2 ** 20} MiB Filament reads of one`;
/**
 * What a reply read whole says when a line of its stream was past what Filament reads of one (core/lines.js
 * `LINE_MAX`): the line went unread, so the reply lacks what it said. A client asking for the reply is answered it, 502.
 * @param {number} length
 */
export const lineDroppedWords = (length) => `the reply had ${pastLineMax(length)}: it was dropped unread, and the reply with it`;
/** `lineDroppedWords` as the format's error reply. @param {WireFormat} format @param {number} length */
const lineDroppedReply = (format, length) => {
  const message = lineDroppedWords(length);
  return format === "anthropic" ? { type: "error", error: { type: "api_error", message } } : { error: { message, type: "server_error" } };
};

/**
 * What a reply's readers drop of it, said once: each reader of its stream drops a line past what Filament reads of one
 * (`LINE_MAX`), and the log hears of the first alone, in words, under `who` — the request, or what read it — with what
 * the reply comes to without it (`after`). Every reader of the one reply is given the same `onOver`.
 * @param {(level: string, msg: string) => void} log @param {string} who @param {string} after
 */
export function droppedLines(log, who, after) {
  let told = false;
  return {
    /** @param {Over} over */
    onOver: (over) => {
      if (told) return;
      told = true;
      log("warn", `${who}: the reply had ${pastLineMax(over.length)}, which its readers dropped: ${after}`);
    },
  };
}

/**
 * A parse that takes what another reader of the same text already parsed: the next of `known` when its payload is this
 * very string — the same string parses to the same value — else `JSON.parse`, which throws as it would. A payload the
 * other reader never read (an event a stage added or rewrote) or read cut otherwise is parsed here, so
 * the answer is always the parse's own. A value taken is shared with the reader that parsed it: no reader changes one.
 * @param {Parsed | null | undefined} known
 * @returns {(payload: string) => any}
 */
export function parseKnown(known) {
  let at = 0;
  return (payload) => {
    if (known && at < known.length && known[at][0] === payload) return known[at++][1];
    return JSON.parse(payload);
  };
}

/**
 * A reply's events folded into the reply, an event at a time, as `sseToJson` folds a whole stream's: `event` each
 * parsed payload in order, `done` at a Chat Completions stream's `[DONE]`, `reply` once at the end. An event the
 * format's fold cannot read (a payload that is no object where one is read) breaks the fold, and `reply` throws what it
 * threw — the whole text's fold threw there too.
 * @param {WireFormat} format
 * @returns {{ event: (e: any) => void, done: () => void, reply: () => any }}
 */
export function createReplyFold(format) {
  const fold = format === "anthropic" ? createAnthropicFold() : format === "responses" ? responsesFold() : openaiFold();
  /** @type {{ error: unknown } | null} */
  let broken = null;
  return {
    event(e) {
      if (broken) return;
      try {
        fold.event(e);
      } catch (error) {
        broken = { error };
      }
    },
    done() {
      if (!broken && "done" in fold && typeof fold.done === "function") fold.done();
    },
    reply() {
      if (broken) throw broken.error;
      return fold.reply();
    },
  };
}

/** A Responses stream's fold: its final response, or the error it said, or that it said neither. */
function responsesFold() {
  /** @type {any} */
  let final = null,
    /** @type {any} */ err = null;
  return {
    /** @param {any} e */
    event(e) {
      if (e.type === "response.completed" || e.type === "response.incomplete" || e.type === "response.failed")
        final = e.response;
      else if (e.type === "error") err = e;
    },
    reply: () =>
      final || {
        error: { message: err?.message || "the Responses stream ended without a final response", type: err?.code || "server_error" },
      },
  };
}

/**
 * A Chat Completions stream's fold: its chunks' deltas added up per choice. A stream that said an error folds to that
 * error, in the words the usage scanner names it with, and nothing after it counts — the words before it are no reply,
 * as an Anthropic stream's error event says (anthropic-fold.js). One that said neither a finish_reason nor its [DONE]
 * broke off mid-reply, and folds to the error the translators end such a stream with.
 */
function openaiFold() {
  /** @type {any} */
  let out = null;
  /** @type {Record<number, any>} */
  const choices = {};
  /** @type {any} */
  let usage = null;
  let ended = false;
  /** The error the stream said, once it said one. @type {any} */
  let failed = null;
  return {
    done() {
      ended = true;
    },
    /** @param {any} e */
    event(e) {
      if (failed) return;
      if (e.error) {
        failed = { error: { message: e.error.message || JSON.stringify(e.error), type: "server_error" } };
        return;
      }
      if (!out) out = { id: e.id, object: "chat.completion", created: e.created, model: e.model };
      if (e.usage) usage = e.usage;
      for (const c of e.choices || []) {
        const acc = (choices[c.index] ||= {
          index: c.index,
          message: { role: "assistant", content: "" },
          finish_reason: null,
        });
        const d = c.delta || {};
        if (d.content) acc.message.content += d.content;
        if (d.reasoning_content)
          acc.message.reasoning_content = (acc.message.reasoning_content || "") + d.reasoning_content;
        // OpenRouter, Ollama and the like spell it `reasoning`: kept under the provider's own name.
        if (typeof d.reasoning === "string" && d.reasoning)
          acc.message.reasoning = (acc.message.reasoning || "") + d.reasoning;
        if (d.tool_calls)
          for (const tc of d.tool_calls) {
            const list = (acc.message.tool_calls ||= []);
            const t = (list[tc.index] ||= {
              id: tc.id,
              type: "function",
              function: { name: "", arguments: "" },
            });
            if (tc.id) t.id = tc.id;
            if (tc.function?.name) t.function.name += tc.function.name;
            if (tc.function?.arguments) t.function.arguments += tc.function.arguments;
          }
        if (c.finish_reason) {
          acc.finish_reason = c.finish_reason;
          ended = true;
        }
      }
    },
    reply() {
      if (failed) return failed;
      if (!out) return { error: { message: "empty upstream stream", type: "server_error" } };
      if (!ended) return { error: { message: INCOMPLETE_STREAM, type: "server_error" } };
      out.choices = Object.values(choices).map((c) => ({
        ...c,
        message: { ...c.message, tool_calls: c.message.tool_calls?.filter(Boolean) },
      }));
      if (usage) out.usage = usage;
      return out;
    },
  };
}

/**
 * Fold a complete SSE body back into the reply it streamed. A broken or empty stream comes back as that
 * format's error object rather than throwing, and so does one with a line past what Filament reads of one, in words
 * that say so (`lineDroppedWords`).
 * @param {WireFormat} format
 * @param {string} sseText
 * @returns {any}
 */
export function sseToJson(format, sseText) {
  const fold = createSseFold(format, { whole: true });
  fold.feed(sseText);
  fold.end();
  return fold.reply();
}

/**
 * A streamed reply folded as its SSE text arrives into what `sseToJson` answers for the whole text — the text never
 * kept, and a payload another reader of the same text parsed (`known`) not parsed again. `feed` each piece as it comes,
 * `end` once the text is done (a last line without its newline counts), `reply` then. A line past what Filament reads
 * of one is dropped from the fold, `onOver` told. `whole`: the fold is the reply, as `sseToJson`'s is — one that lacks
 * such a line is the format's error in words that say so (`lineDroppedWords`); without it the fold goes on without it.
 * @param {WireFormat} format @param {{ onOver?: (over: Over) => void, whole?: boolean }} [o]
 */
export function createSseFold(format, { onOver = () => {}, whole = false } = {}) {
  const fold = createReplyFold(format);
  /** @type {(payload: string) => any} */
  let parse = JSON.parse;
  /** The longest line dropped from the fold, 0 for none. */
  let lost = 0;
  const reader = createSseDataReader((d) => {
    if (d === "[DONE]") fold.done();
    if (!d || d === "[DONE]") return;
    let e;
    try {
      e = parse(d);
    } catch {
      return;
    }
    fold.event(e);
  }, {
    onOver: (over) => {
      lost = Math.max(lost, over.length);
      onOver(over);
    },
  });
  return {
    /** @param {string} text @param {Parsed | null} [known] */
    feed(text, known = null) {
      parse = parseKnown(known);
      reader.feed(text);
    },
    /** @param {Parsed | null} [known] */
    end(known = null) {
      parse = parseKnown(known);
      reader.end();
    },
    reply: () => (whole && lost ? lineDroppedReply(format, lost) : fold.reply()),
  };
}

/**
 * An incremental `data:` line reader over decoded SSE text: `feed` as chunks arrive, `end` once the body is done
 * (a last line without its newline still counts). `onData` gets each payload string, `[DONE]` included, exactly
 * once — the parse is the caller's, since the three formats read the payload differently. Each chunk is searched for
 * its newlines once (core/lines.js): a long line in many chunks — a reply's whole message in one event — is not. A
 * line past what Filament reads of one (`LINE_MAX`) is dropped unread, and `onOver` told of it — at its newline, or at
 * `end` when the text ended inside it: a reply that streams on to its client loses only what this reader would have
 * made of it.
 * @param {(data: string) => void} onData @param {{ onOver?: (over: Over) => void }} [o]
 */
export function createSseDataReader(onData, { onOver = () => {} } = {}) {
  /** @param {string} raw */
  const onLine = (raw) => {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("data:")) onData(line.slice(5).trim());
  };
  const read = () => createLineReader(onLine, { onOver: (over) => void onOver(over) });
  let lines = read();
  return {
    /** @param {string} text */
    feed(text) {
      lines.push(text);
    },
    end() {
      const rest = lines.end();
      lines = read();
      if (rest.startsWith("data:")) onData(rest.slice(5).trim());
    },
  };
}

/**
 * SSE events read off a stream's text as it comes, its lines through core/lines.js: `onEvent(event, data, block)` at
 * the blank line that ends each — the name its `event:` line gives (null for none), its `data:` lines' payloads (none
 * for an event without), and its lines as they came, LF-ended: a stream framed with CRLF reads as an LF one, a CRLF cut
 * between two pieces too. An event with a line past what Filament reads of one (`LINE_MAX`) is dropped whole, `onOver`
 * told of that line: a stage that reads a stream this way never holds one. `end` reads what the stream left after its
 * last blank line as one more event; `rest` gives it back as it came instead. Either starts the reader afresh, a line
 * past `LINE_MAX` the stream ended inside told then.
 * @param {(event: string | null, data: string[], block: string) => void} onEvent
 * @param {{ onOver?: (over: Over) => void }} [o]
 */
export function createSseEventReader(onEvent, { onOver = () => {} } = {}) {
  /** The lines of the event under way, without their line ends. @type {string[]} */
  let held = [];
  /** The event under way had a line past `LINE_MAX`: the rest of it goes unread, to its blank line. */
  let dropped = false;
  /** The event under way's end: told, unless it was dropped. */
  const ended = () => {
    const lines = held;
    const skip = dropped;
    held = [];
    dropped = false;
    if (skip || !lines.length) return;
    /** @type {string | null} */
    let event = null;
    /** @type {string[]} */
    const data = [];
    for (const l of lines) {
      if (l.startsWith("event:")) event = l.slice(6).trim();
      else if (l.startsWith("data:")) data.push(l.slice(5).trim());
    }
    onEvent(event, data, lines.join("\n"));
  };
  /** @param {string} raw */
  const onLine = (raw) => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (!line) ended();
    else if (!dropped) held.push(line);
  };
  const read = () =>
    createLineReader(onLine, {
      onOver: (over) => {
        dropped = true;
        held = [];
        onOver(over);
      },
    });
  let lines = read();
  /** What the stream left after its last newline, a line past `LINE_MAX` it ended inside told of; the reader afresh. */
  const tail = () => {
    const t = lines.end();
    lines = read();
    return t.endsWith("\r") ? t.slice(0, -1) : t;
  };
  return {
    /** @param {string} text */
    push(text) {
      lines.push(text);
    },
    end() {
      const t = tail();
      if (t) onLine(t);
      ended();
    },
    rest() {
      const t = tail();
      const out = dropped ? "" : held.map((l) => `${l}\n`).join("") + t;
      held = [];
      dropped = false;
      return out;
    },
  };
}

/**
 * Write a complete reply as the SSE stream a streaming client expects: one delta per block, then the stop.
 * @param {WireFormat} format
 * @param {any} json
 * @returns {string}
 */
export function jsonToSse(format, json) {
  /** @type {(type: string, data: unknown) => string} */
  const ev = (type, data) =>
    format === "anthropic"
      ? `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
      : `data: ${JSON.stringify(data)}\n\n`;
  if (format === "anthropic") {
    let s = "";
    const { content = [], ...msg } = json;
    s += ev("message_start", {
      type: "message_start",
      message: {
        ...msg,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { ...(msg.usage || {}), output_tokens: 0 },
      },
    });
    content.forEach((b, i) => {
      if (b.type === "text") {
        s += ev("content_block_start", {
          type: "content_block_start",
          index: i,
          content_block: { type: "text", text: "" },
        });
        s += ev("content_block_delta", {
          type: "content_block_delta",
          index: i,
          delta: { type: "text_delta", text: b.text || "" },
        });
      } else if (b.type === "thinking") {
        s += ev("content_block_start", {
          type: "content_block_start",
          index: i,
          content_block: { type: "thinking", thinking: "" },
        });
        if (b.thinking)
          s += ev("content_block_delta", {
            type: "content_block_delta",
            index: i,
            delta: { type: "thinking_delta", thinking: b.thinking },
          });
        if (b.signature)
          s += ev("content_block_delta", {
            type: "content_block_delta",
            index: i,
            delta: { type: "signature_delta", signature: b.signature },
          });
      } else if (b.type === "tool_use") {
        s += ev("content_block_start", {
          type: "content_block_start",
          index: i,
          content_block: { type: "tool_use", id: b.id, name: b.name, input: {} },
        });
        s += ev("content_block_delta", {
          type: "content_block_delta",
          index: i,
          delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input || {}) },
        });
      } else {
        s += ev("content_block_start", { type: "content_block_start", index: i, content_block: b });
      }
      s += ev("content_block_stop", { type: "content_block_stop", index: i });
    });
    s += ev("message_delta", {
      type: "message_delta",
      delta: { stop_reason: json.stop_reason || "end_turn", stop_sequence: json.stop_sequence ?? null },
      usage: json.usage || {},
    });
    s += ev("message_stop", { type: "message_stop" });
    return s;
  }
  const base = { id: json.id, object: "chat.completion.chunk", created: json.created, model: json.model };
  let s = "";
  for (const c of json.choices || []) {
    const m = c.message || {};
    s += ev("", {
      ...base,
      choices: [
        {
          index: c.index,
          delta: {
            role: "assistant",
            content: m.content || "",
            ...(m.reasoning_content ? { reasoning_content: m.reasoning_content } : {}),
            ...(typeof m.reasoning === "string" && m.reasoning ? { reasoning: m.reasoning } : {}),
            ...(m.tool_calls ? { tool_calls: m.tool_calls.map((t, i) => ({ index: i, ...t })) } : {}),
          },
          finish_reason: null,
        },
      ],
    });
    s += ev("", {
      ...base,
      choices: [{ index: c.index, delta: {}, finish_reason: c.finish_reason || "stop" }],
    });
  }
  if (json.usage) s += ev("", { ...base, choices: [], usage: json.usage });
  s += "data: [DONE]\n\n";
  return s;
}
