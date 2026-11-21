// @ts-check
// An Anthropic stream folded into the reply it streamed, an event at a time as the events arrive — never keeping the
// stream's text or parsing any event twice. A sub-agent's call streams its whole run, and every agent round streams
// its reply: the text kept whole and read again at the end was a second copy and a second parse of everything that
// came. `sseToJson("anthropic", …)` (sse.js) folds a whole stream's text through the same fold. An error event ends
// the fold; an event that is no object, or a stop before any start, is a stream with no message. The reply is whole
// once it says its stop reason (`message_delta`) or its `message_stop`: its stop reason comes after its last block's
// stop, so a stream that lost only its last event is the finished reply the translators, the usage scanner and
// memory's stream stage read it as.
import { INCOMPLETE_STREAM } from "./errors.js";

/**
 * @returns {{ event: (e: any) => void, reply: () => any }}  `event` each parsed event in order; `reply` once, at the
 *   stream's end: the message, or the error object `sseToJson` answers a broken, empty or failed stream with
 */
export function createAnthropicFold() {
  /** @type {any} */
  let msg = null;
  /** @type {any[]} */
  const blocks = [];
  /** The error event's answer, once one came: nothing after it counts. @type {any} */
  let failed = null;
  return {
    event(e) {
      if (failed || !e || typeof e !== "object") return;
      if (e.type === "message_start") msg = { ...e.message, content: [] };
      else if (e.type === "content_block_start") blocks[e.index] = { ...e.content_block, _json: "" };
      else if (e.type === "content_block_delta") {
        const b = blocks[e.index];
        if (!b) return;
        const d = e.delta || {};
        if (d.type === "text_delta") b.text = (b.text || "") + d.text;
        else if (d.type === "thinking_delta") b.thinking = (b.thinking || "") + d.thinking;
        else if (d.type === "signature_delta") b.signature = (b.signature || "") + d.signature;
        else if (d.type === "input_json_delta") b._json += d.partial_json || "";
      } else if (e.type === "message_delta") {
        if (msg) {
          msg.stop_reason = e.delta?.stop_reason ?? msg.stop_reason;
          msg.stop_sequence = e.delta?.stop_sequence ?? null;
          msg.usage = { ...(msg.usage || {}), ...(e.usage || {}) };
          if (e.delta?.stop_reason) msg._complete = true;
        }
      } else if (e.type === "error") failed = { error: e.error || { type: "api_error", message: "upstream stream error" }, type: "error" };
      else if (e.type === "message_stop" && msg) msg._complete = true;
    },
    reply() {
      if (failed) return failed;
      if (!msg) return { type: "error", error: { type: "api_error", message: "empty upstream stream" } };
      if (!msg._complete) return { type: "error", error: { type: "api_error", message: INCOMPLETE_STREAM } };
      delete msg._complete;
      msg.content = blocks.filter(Boolean).map((b) => {
        const { _json, ...rest } = b;
        if (rest.type === "tool_use") {
          try {
            rest.input = _json ? JSON.parse(_json) : rest.input || {};
          } catch {
            rest.input = {};
          }
        }
        return rest;
      });
      return msg;
    },
  };
}
