// @ts-check
// Writing a reply to the client's socket: a JSON body, the head of an event stream, and the whole of a reply Filament
// authored itself (a chat command's answer, a housekeeping title) in the client's wire format, streamed or not.
import { jsonToSse } from "../../core/wire/sse.js";

/** @typedef {import("../../core/types.js").WireFormat} WireFormat */
/** @typedef {import("node:http").ServerResponse} ServerResponse */

/**
 * A JSON reply. A no-op once the response has ended: some helper already answered (the JSON body parser's 400).
 * @param {ServerResponse} res
 * @param {number} status
 * @param {unknown} obj
 * @param {Record<string, string | string[]>} [extra]  headers beside content-type and content-length (a list: one line each, as Set-Cookie takes)
 */
export function sendJson(res, status, obj, extra = {}) {
  if (res.writableEnded || res.destroyed) return;
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...extra,
  });
  res.end(body);
}

/**
 * The headers that open an SSE reply, plus the caller's (the request id, the upstream, proxy hints).
 * @param {Record<string, string>} [extra]
 * @returns {Record<string, string>}
 */
export const sseHead = (extra = {}) => ({
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache",
  connection: "keep-alive",
  ...extra,
});

/**
 * A reply Filament wrote itself, delivered whole: as one SSE burst when the client asked for a stream, else as JSON.
 * The request id travels as a header either way.
 * @param {ServerResponse} res
 * @param {{ format: WireFormat, stream: boolean, requestId: string, msg: unknown }} reply
 */
export function replyLocally(res, { format, stream, requestId, msg }) {
  if (stream) {
    res.writeHead(200, sseHead({ "x-filament-request-id": requestId }));
    res.end(jsonToSse(format, msg));
  } else sendJson(res, 200, msg, { "x-filament-request-id": requestId });
}
