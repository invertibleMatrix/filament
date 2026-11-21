// @ts-check
// The accepted reply, delivered: an upstream error handed on in the client's format, a stream forwarded through the
// stages it needs, or a whole reply read, run through the memory tool loop and sent as JSON (or as the SSE a
// streaming client asked for). A failure on the way is answered honestly: an error body, or an error event when
// the head is already out — the provider judged for it only where it was the provider's, a reply whose read failed,
// which its branch answers; a throw of Filament's own judges none.
import { errorBody, streamError, translateError } from "../../../core/wire/errors.js";
import { responseHeaders, providerMeta } from "../../../core/wire/upstream-headers.js";
import { requestWasAborted } from "../../../services/health.js";
import { usageAndCost } from "../../../core/usage-cost.js";
import { sendJson } from "../respond.js";
import { createMemoryLoop } from "./memory-loop.js";
import { streamReply } from "./reply-stream.js";
import { jsonReply } from "./reply-json.js";

/** @typedef {import("../context.js").RequestContext} RequestContext */
/** @typedef {import("../../deps.js").AppDeps} AppDeps */
/** @typedef {import("./attempt.js").AttemptResult} AttemptResult */
/** @typedef {import("./verdict.js").Accepted} Accepted */
/** @typedef {import("../../../core/types.js").WireFormat} WireFormat */
/** @typedef {ReturnType<typeof createMemoryLoop>} MemoryLoop */

/**
 * What both reply branches and the memory loop share, set up once from the accepted upstream reply.
 * @typedef {object} ReplyContext
 * @property {any} p  the plan: upstream, shaped body, rules, wire API, passthrough
 * @property {{ res: Response, cleanup: () => void }} fw  the forwarded request; a memory follow-up replaces it
 * @property {Response} ures  the upstream reply
 * @property {string | null} preText  an error body already read; never read the stream again
 * @property {(wireNow: string | null) => Promise<AttemptResult>} attempt  the same request to the same candidate again
 * @property {string} ct  the upstream's content-type
 * @property {Record<string, string>} passthroughHeaders  the upstream headers the rules forward, plus Filament's own
 * @property {WireFormat} upFmt  format of what comes back from the upstream
 * @property {boolean} xlat  translate the reply back to the client's format
 * @property {boolean} wireResp  the upstream answered in the Responses shape: converted to Chat Completions first
 * @property {WireFormat} scanFmt  what the scanner reads while bytes pass through untouched
 * @property {WireFormat} clientFmt  the shape the client receives
 * @property {boolean} reasoningOn
 * @property {{ sit: any, prep: any } | null} memState  memory's situation and prepare result, when memory took part
 * @property {() => any} spent  what the reply has cost so far, as its record bills it, kept by the branch that reads it:
 *   a throw of Filament's own mid-reply closes the record with it — the rounds paid, and what the stream being read said
 */

/**
 * @param {RequestContext} ctx
 * @param {AppDeps} deps
 * @param {Accepted & { attempt: ReplyContext["attempt"] }} accepted
 */
export async function deliverReply(ctx, deps, accepted) {
  const { config, log, usage, finish } = deps;
  const cfg = config();
  const { res, format, rec } = ctx;
  const { p, ures, preText, attempt } = accepted;
  const { upstream, shaped } = p;
  const ct = ures.headers.get("content-type") || "";
  const upstreamStreaming = ct.includes("text/event-stream");
  const passthroughHeaders = responseHeaders(ures, p.rules);
  passthroughHeaders["x-filament-request-id"] = rec.id;
  passthroughHeaders["x-filament-upstream"] = upstream.id;
  rec.providerMeta = providerMeta(ures);
  /** @type {WireFormat} */
  const upFmt = p.upstreamFormat || format;
  const xlat = upFmt !== format;
  const wireResp = p.wireApi === "responses" && !p.passthrough;
  const scanFmt = p.passthrough ? "responses" : upFmt;
  if (xlat) rec.translatedFormats = `${format} -> ${upFmt}`;
  const reasoningOn = p.rules.translate?.reasoning !== false;
  const clientFmt = p.passthrough ? "responses" : format;
  /** @type {ReplyContext} */
  const rc = {
    p,
    fw: accepted.fw,
    ures,
    preText,
    attempt,
    ct,
    passthroughHeaders,
    upFmt,
    xlat,
    wireResp,
    scanFmt,
    clientFmt,
    reasoningOn,
    memState: ctx.memory.prep ? { sit: ctx.memory.sit, prep: ctx.memory.prep } : null,
    spent: () => null,
  };
  const loop = createMemoryLoop(ctx, deps, rc);
  try {
    if (ures.status !== 200) {
      const text = preText ?? (await ures.text().catch(() => ""));
      rc.fw.cleanup();
      usage.firstByte(rec);
      res.writeHead(ures.status, {
        "content-type": "application/json; charset=utf-8",
        ...passthroughHeaders,
      });
      res.end(translateError(text, upFmt, format));
      finish(rec, { status: "error", httpStatus: ures.status, error: text.slice(0, 500) });
      return;
    }
    if (upstreamStreaming && shaped.clientWantsStream) await streamReply(ctx, deps, rc, loop);
    else await jsonReply(ctx, deps, rc, loop);
  } catch (/** @type {any} */ e) {
    rc.fw.cleanup?.();
    const aborted = requestWasAborted(e, ctx.client.abort);
    // A throw here is Filament's own — a reply whose read failed is its branch's to answer (`broke`), never thrown. A
    // record not closed yet keeps it as the failure it is, in its words, and its close judges no provider for it: its
    // health is settled with nothing said. One whose close threw it is closed already, and stays as it closed
    // (finish.js).
    if (!aborted) rec.healthRecordedFor = rec.upstream;
    // A throw after the reply went out whole — its record's close, say — failed no stream: it is said as what it is,
    // Filament's own failure after the reply ended, at a warning's level, as the close's own failures are (finish.js).
    const after = !aborted && res.writableEnded;
    log(
      aborted ? "info" : after ? "warn" : "error",
      `${rec.id} ${aborted ? "client disconnected" : after ? `Filament's own failure after the reply ended: ${e.message}` : `stream failure: ${e.message}`}`,
    );
    /** The client had the reply's head already: it got 200, its stream ending on the failure. */
    const headed = res.headersSent;
    if (!headed)
      sendJson(
        res,
        502,
        errorBody(format, 502, aborted ? "client disconnected" : `stream failure: ${e.message}`),
        // The head a failure says (dispatch.js): its request; a failure of Filament's own names no provider.
        { "x-filament-request-id": rec.id },
      );
    // A reply that went out whole — a throw after its end, its record's close among them — is told nothing more: a write
    // after the end is an error the response emits with no one listening, which ends the process.
    else if (!res.writableEnded) {
      try {
        if (!aborted) res.write(streamError(rc.clientFmt, e.message));
      } catch {}
      try {
        res.end();
      } catch {}
    }
    finish(rec, {
      status: aborted ? "aborted" : "error",
      ...(aborted ? {} : { httpStatus: headed ? 200 : 502 }),
      // What the reply cost before the throw — paid, whatever became of its delivery.
      ...usageAndCost(rec, rc.spent() || {}),
      error: aborted ? "client disconnected" : e.message,
    });
  }
}
