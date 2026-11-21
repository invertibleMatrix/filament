// @ts-check
// Error replies on the wire: the body Filament writes when it refuses or fails a request itself, and the translation
// of a provider's error body into the client's format when the two differ.

/** @typedef {import("../types.js").WireFormat} WireFormat */

/**
 * The error a stream that ended before its reply did is said as, whichever wire it came on: a cut is never passed on
 * as a finished reply, and every reader of one — a client, the record, Filament's own loop — reads the same words.
 */
export const INCOMPLETE_STREAM = "incomplete upstream stream";

/**
 * The error body for a status, in the client's format. `type` overrides the type the status implies.
 * @param {WireFormat} format
 * @param {number} status
 * @param {string} message
 * @param {string} [type]
 */
export function errorBody(format, status, message, type) {
  if (format === "anthropic")
    return {
      type: "error",
      error: {
        type:
          type ||
          (status === 400
            ? "invalid_request_error"
            : status === 401
              ? "authentication_error"
              : status === 404
                ? "not_found_error"
                : status === 413
                  ? "request_too_large"
                  : status === 429
                    ? "rate_limit_error"
                    : "api_error"),
        message,
      },
    };
  // OpenAI's `code` is a code's name or null, never the HTTP status: the status is the reply's own.
  return {
    error: {
      message,
      type: type || (status >= 500 ? "server_error" : "invalid_request_error"),
      code: null,
    },
  };
}

/**
 * The SSE text a stream that failed after its first byte ends with, in the client's format: Anthropic's error event,
 * a Chat Completions error chunk and its [DONE], a Responses error event.
 * @param {WireFormat} format
 * @param {string} message
 */
export function streamError(format, message) {
  if (format === "anthropic")
    return `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "api_error", message } })}\n\n`;
  if (format === "responses")
    return `event: error\ndata: ${JSON.stringify({ type: "error", code: "server_error", message, param: null })}\n\n`;
  return `data: ${JSON.stringify({ error: { message, type: "server_error", code: null } })}\n\ndata: [DONE]\n\n`;
}

/**
 * An upstream's error body (text) rewritten into the client's format; returned untouched when the formats match or
 * the text is not JSON.
 * @param {string} text
 * @param {WireFormat} from
 * @param {WireFormat} to
 */
export function translateError(text, from, to) {
  if (from === to) return text;
  /** @type {any} */
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    return text;
  }
  if (to === "openai")
    return JSON.stringify({
      error: { message: j?.error?.message || text, type: j?.error?.type || "api_error", code: null },
    });
  return JSON.stringify({
    type: "error",
    error: { type: j?.error?.type || "api_error", message: j?.error?.message || text },
  });
}
