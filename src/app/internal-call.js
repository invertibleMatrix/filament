// @ts-check
// A model call through Filament's own front door — the pattern every server-side loop copies (plan §4.3): an
// agent-loop tick, a sub-agent's round, the reader's read are ordinary /v1/messages requests with lineage headers,
// so routing, failover, rules, memory and billing all apply and the traffic stays labelled. They authenticate with
// the house key (services/house.js), which is what makes their lineage count; the caller's headers cannot replace it. With `onDelta` the call
// streams and forwards each text and thinking delta as it arrives; the result is the assembled message either way.
// A failure says what its caller needs to try it again (HarnessV3-AtHome AH-F4, core/retry.js): which provider it
// came from, and what that provider's Retry-After and `x-should-retry` ask. A call names itself to the front door
// (`x-filament-call`): when it waits for a slot at its provider it hears so, in words, and when the slot is its own
// (AH-F5). It has no clock (HarnessV3-FailurePoints §4 A): it ends when the provider answers or fails, or when its
// caller's signal ends it. It goes over loopback (services/loopback.js), never through Node's fetch, whose own 300 s
// waits would end it. A body past what the front door takes in one request (`server.maxBodyBytes`) goes with its
// older pictures, PDFs and files left out until it is within (`withinFrontDoor`), and the result says so.
import { randomUUID } from "node:crypto";
import { mediaIn } from "../core/media.js";
import { createSseDataReader, lineDroppedWords } from "../core/wire/sse.js";
import { createAnthropicFold } from "../core/wire/anthropic-fold.js";
import { callWaits } from "../services/call-waits.js";
import { houseAuth } from "../services/house.js";
import { loopbackPost } from "../services/loopback.js";
import { STREAM_ERROR_STATUS, retryAfterSeconds } from "../core/retry.js";
import { selfAddress } from "../services/config/store.js";
import { mediaWithin, sizeWords } from "./pipeline/dispatch/pdfs.js";

/** @typedef {{ kind: "text" | "thinking" | "signature", text: string }} Delta  a signature delta carries the provider's signature for the thinking block that just streamed */
/** @typedef {{ id: string, name: string, text: string }} CallPiece  a tool call as the model writes it: its id and name, and the next piece of its input's JSON ("" as it opens) */
/**
 * @typedef {object} InternalCallArgs
 * @property {any} body
 * @property {Record<string, string>} [headers]
 * @property {AbortSignal | null} [signal]
 * @property {((d: Delta) => void) | null} [onDelta]
 * @property {((c: CallPiece) => void) | null} [onCall]  with `onDelta`: each tool call's input as the model writes it, a
 *   piece at a time — the call itself still comes whole in the result
 * @property {((q: import("../services/call-waits.js").QueueNews | null) => void) | null} [onQueue]  the call waits for a
 *   slot at its provider (the news, in words), and has it (null)
 * @property {((c: import("../services/call-waits.js").MemoryCall) => void) | null} [onMemory]  each memory call Filament
 *   ran inside the call, as it ran: the reply never carries them
 * @property {import("../core/tokens.js").BlockWeights | null} [weights]  a keeper with a name for each of the body's
 *   blocks (tokens.js `everyNamed`): the front door reads the body back as a copy, and weighs each block of it by what
 *   its block weighed (`sentThrough`)
 */

/**
 * The bodies on their way through the front door, by the call's id (`x-filament-call`), with the keeper that names
 * their blocks: a body sent as it is — none of it left out to get it through — whose caller gave one.
 * @type {Map<string, { messages: any[], weights: import("../core/tokens.js").BlockWeights }>}
 */
const sending = new Map();

/**
 * What a call of Filament's own sent, while it is on its way: its messages and the keeper that names their blocks
 * (`InternalCallArgs.weights`) — the front door's body is their copy, block for block. Null for any other call.
 * @param {string | null | undefined} callId
 */
export const sentThrough = (callId) => (callId ? sending.get(String(callId)) || null : null);
/**
 * @typedef {{ ok: boolean, status: number, json: any, id: string | null, upstream: string | null, retryAfter: number | null, shouldRetry: boolean | null, inStream?: boolean, notes?: string[] }} InternalCallResult
 *   `upstream`: the provider that answered or failed (`x-filament-upstream`), null when Filament refused the call itself;
 *   `retryAfter`: the seconds the reply's Retry-After asks (`retryAfterSeconds`); `shouldRetry`: its `x-should-retry`;
 *   `inStream`: the failure came inside a 200 stream — the provider's stream broke off, or said an error mid-way;
 *   `notes`: what of the body was left out to get it through the front door (`withinFrontDoor`), for the caller's record
 */

/**
 * A body as its text, within what the front door takes in one request (`most`, server.maxBodyBytes): past it, its older
 * pictures, PDFs and files are left out (pdfs.js `mediaWithin`) until it is within, the newest message's kept whole —
 * a body still past it then goes as it is, and the front door's refusal stands. With what was left out, for the record.
 * @param {any} body @param {number} most @returns {Promise<{ text: string, notes: string[] }>}
 */
export async function withinFrontDoor(body, most) {
  let text = JSON.stringify(body);
  let over = Buffer.byteLength(text) - most;
  if (!(most > 0) || over <= 0) return { text, notes: [] };
  const why = `the ${sizeWords(most)} Filament takes in one request (server.maxBodyBytes), the newest first`;
  const newest = Array.isArray(body?.messages) ? body.messages.length - 1 : -1;
  // The room the body's words leave its media. What stands in a left-out one's place takes some of it (a PDF's text
  // most), so a body still past the limit is cut again with a third less room at the least, until none older is left.
  let bytes = mediaIn(body).reduce((n, p) => n + p.bytes, 0) - over;
  for (;;) {
    const got = await mediaWithin(body, { bytes: Math.max(0, bytes), pdfs: true, why });
    text = JSON.stringify(got.body);
    over = Buffer.byteLength(text) - most;
    if (over <= 0 || bytes <= 0 || !mediaIn(got.body).some((p) => p.m !== newest)) return { text, notes: got.notes };
    bytes = Math.min(bytes - over, Math.floor((bytes * 2) / 3));
  }
}

/**
 * `selfBase`: where Filament reaches itself now (AppDeps); the configuration's address where no composition says.
 * @param {{ config: () => any, log: (level: string, msg: string) => void, selfBase?: () => string }} deps
 * @returns {(args: InternalCallArgs) => Promise<InternalCallResult>}
 */
export function createInternalCall({ config, log, selfBase = () => selfAddress(config().server) }) {
  return async ({ body, headers = {}, signal = null, onDelta = null, onCall = null, onQueue = null, onMemory = null, weights = null }) => {
    const callId = randomUUID();
    const unlisten = callWaits.listen(callId, {
      queued: (news) => onQueue?.(news),
      slot: () => onQueue?.(null),
      memory: (c) => onMemory?.(c),
    });
    try {
      const sent = await withinFrontDoor(onDelta ? { ...body, stream: true } : body, Number(config().server?.maxBodyBytes) || 0);
      // The messages as they were when the text was made: the caller's array may move on while the call is on its way.
      if (weights && !sent.notes.length && Array.isArray(body?.messages)) sending.set(callId, { messages: body.messages.slice(), weights });
      const r = await loopbackPost(`${selfBase()}/v1/messages`, {
        headers: {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          ...headers,
          "x-filament-call": callId,
          ...houseAuth(),
        },
        body: sent.text,
        signal,
      });
      const id = r.headers.get("x-filament-request-id");
      const should = r.headers.get("x-should-retry");
      const told = { upstream: r.headers.get("x-filament-upstream") || null, retryAfter: retryAfterSeconds(r.headers), shouldRetry: should === "true" ? true : should === "false" ? false : null, ...(sent.notes.length ? { notes: sent.notes } : {}) };
      // A reply that is not SSE (an upstream that answered JSON, an error) is read as JSON, so a loop never depends on
      // streaming to finish.
      if (!onDelta || !String(r.headers.get("content-type") || "").includes("text/event-stream") || !r.body)
        return { ok: r.ok, status: r.status, json: await r.json().catch(() => null), id, ...told };
      // The reply is folded as its events come, each parsed once: a sub-agent's call streams its whole run, and keeping
      // the stream's text to parse again at the end was a second copy and a second parse of all of it.
      const fold = createAnthropicFold();
      /** The tool calls the stream opened, by their block's index. @type {Map<number, { id: string, name: string }>} */
      const calls = new Map();
      /** How long the reply's longest line past what Filament reads of one was (`LINE_MAX`): its event is lost. */
      let lost = 0;
      const reader = createSseDataReader((data) => {
        if (!data || data === "[DONE]") return;
        let j;
        try {
          j = JSON.parse(data);
        } catch {
          return;
        }
        fold.event(j);
        try {
          if (onCall && j?.type === "content_block_start" && j.content_block?.type === "tool_use") {
            const c = { id: String(j.content_block.id ?? ""), name: String(j.content_block.name ?? "") };
            calls.set(Number(j.index), c);
            onCall({ ...c, text: "" });
            return;
          }
          if (j?.type !== "content_block_delta") return;
          const d = j.delta || {};
          if (d.type === "text_delta" && d.text) onDelta({ kind: "text", text: d.text });
          else if (d.type === "thinking_delta" && d.thinking) onDelta({ kind: "thinking", text: d.thinking });
          else if (d.type === "signature_delta" && d.signature) onDelta({ kind: "signature", text: d.signature });
          else if (onCall && d.type === "input_json_delta" && d.partial_json) {
            const c = calls.get(Number(j.index));
            if (c) onCall({ ...c, text: String(d.partial_json) });
          }
        } catch (/** @type {any} */ e) {
          log("warn", `internal call: a delta could not be delivered (${e.message})`);
        }
      }, { onOver: (over) => void (lost = Math.max(lost, over.length)) });
      const decoder = new TextDecoder();
      const bodyReader = r.body.getReader();
      for (;;) {
        const { value, done } = await bodyReader.read();
        if (done) break;
        reader.feed(decoder.decode(value, { stream: true }));
      }
      reader.end();
      // A reply with a line too long to read is missing what that line said: the call fails, in words.
      if (lost) {
        const message = lineDroppedWords(lost);
        log("warn", `internal call: ${message}`);
        return { ok: false, status: 502, json: { type: "error", error: { type: "api_error", message } }, id, ...told, inStream: true };
      }
      const json = fold.reply();
      // An error inside a 200 stream is still an error (the first-event gate's lesson): report it as the non-streaming
      // path would, so the caller's `!r.ok` branch sees it — with the status its type stands for, so an overloaded
      // provider is tried again and a refused request is not.
      const failed = json?.type === "error" || (json?.error && !json?.content);
      return { ok: r.ok && !failed, status: failed && r.ok ? STREAM_ERROR_STATUS[String(json?.error?.type)] ?? 502 : r.status, json, id, ...told, ...(failed && r.ok ? { inStream: true } : {}) };
    } finally {
      sending.delete(callId);
      unlisten();
    }
  };
}
