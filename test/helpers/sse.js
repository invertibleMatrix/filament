// @ts-check
// An Anthropic reply's SSE in the pieces a test feeds it by (wait.js's `fedStream`), one event's raw text each, so a
// stop, a subscriber or a check lands exactly between two of them — and the readers for what a client got back.

/** One SSE event. @param {string} event @param {any} data */
export const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** @param {string} id @param {string} [model] */
export const messageStart = (id, model = "m-1") =>
  sse("message_start", { type: "message_start", message: { id, type: "message", role: "assistant", model, content: [], usage: { input_tokens: 10, output_tokens: 1 } } });

/** The reply's end: its stop reason and output count, then message_stop. @param {string} stopReason @param {number} outputTokens */
export const messageEnd = (stopReason, outputTokens) => [
  sse("message_delta", { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: outputTokens } }),
  sse("message_stop", { type: "message_stop" }),
];

/** A text reply opened: the message, then its text block at index 0. */
export const textOpen = () => [messageStart("msg_s"), sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })];
/** @param {string} text */
export const textDelta = (text) => sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
export const textClose = () => [sse("content_block_stop", { type: "content_block_stop", index: 0 }), ...messageEnd("end_turn", 12)];
/** A whole text reply, one delta per chunk. @param {string[]} chunks */
export const textDeltas = (chunks) => [...textOpen(), ...chunks.map(textDelta), ...textClose()];

/** A tool call opened: the message, then the tool_use block at index 0 (its input follows as `toolInput` pieces).
 *  @param {string} id  the call's id, the one the leg's tool_result names @param {string} [name] */
export const toolOpen = (id, name = "Read") => [
  messageStart(`msg_${id}`),
  sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name, input: {} } }),
];
/** @param {string} json  a piece of the call's input */
export const toolInput = (json) => sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: json } });
/** The call's block closed, then the reply's end on tool_use. */
export const toolClose = () => [sse("content_block_stop", { type: "content_block_stop", index: 0 }), ...messageEnd("tool_use", 20)];
/** @param {string} thinking */
export const thinkingDelta = (thinking) => sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking } });

/** The text deltas a client read over the Anthropic wire, a stop's note among them. @param {{ data: any }[]} events */
export const textsOf = (events) => events.filter((e) => e.data?.delta?.type === "text_delta").map((e) => e.data.delta.text);
/** The content chunks a client read over the OpenAI wire. @param {{ data: any }[]} events */
export const contentOf = (events) => events.map((e) => e.data?.choices?.[0]?.delta?.content).filter((c) => typeof c === "string" && c);
