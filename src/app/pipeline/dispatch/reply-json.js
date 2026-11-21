// @ts-check
// The non-streaming reply to the client (the upstream may still stream): one whole reply read as JSON, the memory
// tool rounds answered and merged into what the client sees, the reply translated to the client's format when the
// upstream speaks another, and sent as JSON — or as SSE when the client asked for a stream the upstream did not give.
import { pipeStream, createSseScanner, ReplyReadError } from "../../../adapters/providers/http.js";
import { droppedLines, jsonToSse } from "../../../core/wire/sse.js";
import { usageFromAnthropic, usageFromOpenAI, usageFromResponses } from "../../../core/wire/usage.js";
import { anthropicToOpenaiResponse, openaiToAnthropicResponse } from "../../../core/wire/translate.js";
import { responseToChat, responseObjectToSse } from "../../../core/wire/responses.js";
import {
  parseReply,
  ourCalls,
  otherCalls,
  mergeJsonRounds,
  totalUsageOf,
  sumUsage,
  applyCueJson,
} from "../../memory-tools.js";
import { failureHead } from "./attempt.js";
import { errorBody, translateError } from "../../../core/wire/errors.js";
import { responseHeaders, providerMeta } from "../../../core/wire/upstream-headers.js";
import { usageAndCost } from "../../../core/usage-cost.js";
import { estimateBodyTokens } from "../../../core/tokens.js";
import { parseModelSuffix } from "../../../core/shaping.js";
import { observeRatio, totalInputOf } from "../../../services/token-calib.js";
import { sendJson } from "../respond.js";

/** @typedef {import("../context.js").RequestContext} RequestContext */
/** @typedef {import("../../deps.js").AppDeps} AppDeps */
/** @typedef {import("./reply.js").ReplyContext} ReplyContext */
/** @typedef {import("./reply.js").MemoryLoop} MemoryLoop */

/**
 * @param {RequestContext} ctx
 * @param {AppDeps} deps
 * @param {ReplyContext} rc
 * @param {MemoryLoop} loop
 */
export async function jsonReply(ctx, { config, log, usage, finish }, rc, loop) {
  const cfg = config();
  const { res, format, body, rec } = ctx;
  const { p, ct, passthroughHeaders, upFmt, xlat, wireResp, scanFmt, clientFmt, reasoningOn } = rc;
  const { shaped } = p;
  const { memTools, maxRounds, memCue, memCueSentence, noteCue, memAfter, noteToolRounds, noteCompactionCut, runRound, deferRun, deferAnswered, followUp, finishWithheld } = loop;
  const fmtJ = p.passthrough ? "responses" : upFmt; // shape of `json` once Responses-wire replies are converted
  /**
   * What the replies read so far have cost (`rc.spent`), in the provider's own words: each one read whole (`readReply`),
   * and what the stream being read has said so far, off its scanner.
   */
  const paid = { whole: /** @type {any[]} */ ([]), reading: /** @type {ReturnType<typeof createSseScanner> | null} */ (null) };
  rc.spent = () => sumUsage([totalUsageOf(fmtJ, paid.whole), paid.reading?.state.usage].filter(Boolean));
  /**
   * Read one upstream reply completely, as JSON in fmtJ. Responses-wire replies become Chat Completions. `gone`: whether
   * the client is gone, which ends a streamed reply's read where the read fails, its state what the stream said so far
   * (`pipeStream`); a whole JSON reply's read the request's abort cut throws. A read that fails with its client still
   * there — the provider's connection lost, or its silence — is the provider's failure (`broke`), beside what its stream
   * said so far.
   * @param {Response} u @param {() => boolean} gone
   * @returns {Promise<{ json: any, st: any, text: string | null, broke?: ReplyReadError | null }>}
   */
  const readReply = async (u, gone) => {
    if ((u.headers.get("content-type") || "").includes("text/event-stream")) {
      // The reply is folded as its events come, each parsed once (the scanner's parse is the fold's); a Responses-wire
      // reply's fold reads it as Responses events, the scanner as its provider's, and its final response is converted. A
      // line past what Filament reads of one, which the scanner and the fold drop, is said once, and the fold lacks what
      // it said: the reply is the error that says so (core/wire/sse.js `lineDroppedWords`).
      const dropped = droppedLines(log, rec.id, "it was dropped unread, and the reply with it: the client is answered with an error that says so");
      const scanner = createSseScanner(scanFmt, { onOver: dropped.onOver });
      paid.reading = scanner;
      const st2 = await pipeStream({
        upstreamRes: u,
        clientRes: null,
        format: scanFmt,
        onFirstByte: () => usage.firstByte(rec),
        onProgress: (chars) => usage.progress(rec, { outChars: chars }),
        fold: wireResp ? "responses" : true,
        onOver: dropped.onOver,
        gone,
        scanner,
      });
      paid.reading = null;
      if (st2.broke) return { json: null, st: st2, text: null, broke: st2.broke };
      const folded = /** @type {NonNullable<typeof st2.fold>} */ (st2.fold).reply();
      // A Responses-wire fold answers its final response (its status or its output said), converted here, or its own
      // error — no final response, or a line it dropped — which is the reply as it stands.
      let j = wireResp && (folded?.status || folded?.output) ? responseToChat(folded, { model: shaped.body.model }) : folded;
      if (wireResp && j?.usage) {
        usageFromOpenAI(j.usage, st2.usage);
        st2.stopReason = j.choices?.[0]?.finish_reason || st2.stopReason;
      }
      // an error event inside the stream
      if (st2.error && j && !(j.type === "error" || j.error))
        j =
          upFmt === "anthropic"
            ? { type: "error", error: { type: "api_error", message: st2.error } }
            : { error: { message: st2.error, type: "server_error" } };
      if (j?.usage) paid.whole.push(j.usage);
      return { json: j, st: st2, text: null };
    }
    // The upstream answered a whole JSON reply (it does not stream, or the client did not ask for a stream): this
    // "first byte" is the moment the entire reply was ready, so it is marked as buffered. Without that mark a
    // comparison would put a real TTFT next to a total and call the difference a speedup.
    /** @type {string} */
    let text;
    try {
      text = await u.text();
    } catch (e) {
      if (gone()) throw e;
      return { json: null, st: null, text: null, broke: new ReplyReadError(e) };
    }
    usage.firstByte(rec, { buffered: true });
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      j = null;
    }
    if (wireResp && j && j.object === "response") j = responseToChat(j, { model: shaped.body.model });
    if (j?.usage) paid.whole.push(j.usage);
    return { json: j, st: null, text };
  };
  /** The client is gone: it hung up, or a stop ended its request (route.js). */
  const gone = () => ctx.client.abort.signal.aborted;
  /**
   * A reply whose read failed with its client still there — the provider's failure — answered 502 in the failure's words,
   * in the head a failure says, naming the provider it met; its record closes on it with what the streams said so far
   * (`total`), which judges the provider as by a stream that broke off (finish.js).
   * @param {ReplyReadError} broke @param {any} total
   */
  const readFailed = (broke, total) => {
    log("error", `${rec.id} stream failure: ${broke.message}`);
    sendJson(res, 502, errorBody(format, 502, `stream failure: ${broke.message}`), { "x-filament-request-id": rec.id, ...failureHead({ upstream: p.upstream.id }) });
    finish(rec, { status: "error", httpStatus: 502, ...usageAndCost(rec, total || {}), error: broke.message });
  };
  const opened = await readReply(rc.ures, gone);
  let { json, st, text } = opened;
  rc.fw.cleanup();
  // A client gone while the reply streamed — it hung up, or a stop ended its request, which aborts the read with the
  // request (forwardRequest) — was shown nothing: aborted with what the stream said so far, as a stream cut so ends on
  // the stream paths (reply-stream.js), its turn left unanswered for the client's retry.
  if (st && !st.error && !st.ended && gone()) {
    sendJson(res, 502, errorBody(format, 502, "client disconnected"));
    finish(rec, { status: "aborted", ...usageAndCost(rec, st.usage), error: "client disconnected" });
    return;
  }
  // A reply whose read failed, its client still there, was shown nothing: what its stream said so far is on its record.
  if (opened.broke) {
    readFailed(opened.broke, st?.usage);
    return;
  }
  const isErrJson = (j) =>
    !!j && (j.type === "error" || (upFmt === "openai" && !!j.error && !j.choices && j.object !== "response"));
  /**
   * What the rounds cost, summed — the billing truth — with the tier the provider served on the last of them (`last`,
   * its reply): the sum keeps token counts only. @param {any[]} rounds @param {any} last
   */
  const roundsTotal = (rounds, last) => {
    const total = totalUsageOf(fmtJ, rounds.map((r) => r?.usage).filter(Boolean));
    const tier = typeof last?.service_tier === "string" ? last.service_tier : st?.usage?.tier;
    return total && typeof tier === "string" && tier ? { ...total, tier } : total;
  };
  // Memory tool rounds: the model asked memory; answer it, ask again, and merge what the client sees. A follow-up that
  // fails — its client gone, refused, out of reach, its reply's read broken, or its reply an error — was shown the
  // client nothing yet: it is
  // never answered with the rounds before it merged, and its turn is left unanswered for the client's retry, no answer
  // and no compaction summary archived from their words. What the rounds' calls returned rides the session's next
  // request as each round got it (`deferAnswered`), its client still there or gone: a writer that ran is told there,
  // never run again.
  let loopTotal = null;
  /** The head the client is answered in: the provider's reply's (`passthroughHeaders`), or that of the follow-up the rounds end on. */
  let head = passthroughHeaders;
  if (memTools && json && !isErrJson(json)) {
    const rounds = [json];
    for (let round = 0; round < maxRounds; round++) {
      const g = parseReply(fmtJ, json);
      const ours = ourCalls(g);
      if (!ours.length) break;
      if (otherCalls(g).length) {
        await deferRun(ours, "mixed");
        break;
      }
      // A client already gone — its reply said its end before its read was aborted — runs no further round: no memory
      // call of the model's runs for a request nobody waits on, and it ends aborted with what the rounds cost (below).
      /** @type {import("./memory-loop.js").FollowUp} */
      let next = { gone: true };
      if (!gone()) {
        await runRound(g, json.id || null);
        next = await followUp();
      }
      // A client gone while the follow-up's reply is read — it hung up, or a stop ended its request — aborts the read
      // with the request (forwardRequest), as one gone while it was asked ends it (`followUp`): a streamed reply's read
      // ends there with what its stream said so far, which the rounds' tokens are counted with (`cut`); a whole JSON
      // reply's read throws, having said nothing.
      const r2 =
        "res" in next
          ? await readReply(next.res, gone).catch((e) => {
              if (gone()) return null;
              throw e;
            })
          : null;
      const cut = !!r2?.st && !r2.st.error && !r2.st.ended && gone();
      // Its read failed with its client still there: the provider's failure, beside what its stream said so far.
      const broke = r2?.broke ?? null;
      if (!r2 || cut || broke) {
        rc.fw.cleanup();
        noteToolRounds();
        const said = cut || broke ? r2?.st?.usage : null;
        const total = said ? sumUsage([roundsTotal(rounds, json), said].filter(Boolean)) : roundsTotal(rounds, json);
        const cost = usageAndCost(rec, total);
        if ("refused" in next) {
          // Refused: answered as the provider refused it — its status, its words in the client's format, the head the
          // rules hand on — as a first attempt refused so is (reply.js), and no other provider is asked, the conversation
          // carrying memory's results already. The record closes on that status, its provider judged as for that attempt
          // (`followUp`, finish.js).
          const { refused } = next;
          await deferAnswered();
          res.writeHead(refused.status, {
            "content-type": "application/json; charset=utf-8",
            ...responseHeaders(refused.res, p.rules),
            "x-filament-request-id": rec.id,
            "x-filament-upstream": p.upstream.id,
          });
          res.end(translateError(refused.text, upFmt, format));
          finish(rec, { status: "error", httpStatus: refused.status, ...cost, error: refused.text.slice(0, 500) });
        } else if ("failed" in next) {
          // Out of reach, or never made: answered as a first attempt failing so is when no other provider answers
          // (dispatch.js), its provider judged as for that attempt (`followUp`).
          const { failed } = next;
          await deferAnswered();
          sendJson(res, failed.status, errorBody(format, failed.status, failed.message), { "x-filament-request-id": rec.id, ...failureHead(failed) });
          finish(rec, { status: "error", httpStatus: failed.status, ...cost, error: failed.message });
        } else if (broke) {
          // Its read failed: answered as a reply whose read failed is (`readFailed`), with the rounds' tokens and what its
          // stream said, the provider judged as by a stream that broke off; the record keeps what its reply's head said.
          if ("res" in next) rec.providerMeta = providerMeta(next.res);
          await deferAnswered();
          readFailed(broke, total);
        } else {
          // The client gone: aborted with what the rounds cost, never as a reply, as reply.js ends a hang-up's — what the
          // rounds' calls returned riding the session's next request all the same, a writer that ran told there and never
          // run again.
          await deferAnswered("gone");
          sendJson(res, 502, errorBody(format, 502, "client disconnected"));
          finish(rec, { status: "aborted", ...cost, error: "client disconnected" });
        }
        return;
      }
      rc.fw.cleanup();
      text = r2.text;
      if (r2.st) st = r2.st;
      // The client is answered in the head of the reply the rounds end on — the merged rounds' last, or an error said in
      // their place — its request at the provider and its limits as they stand, and the record keeps what that head said
      // of the provider, as a first attempt's does (reply.js).
      if ("res" in next) {
        head = { ...responseHeaders(next.res, p.rules), "x-filament-request-id": rec.id, "x-filament-upstream": p.upstream.id };
        rec.providerMeta = providerMeta(next.res);
      }
      if (!r2.json || isErrJson(r2.json)) {
        // A reply that is an error — said inside a 200, or a stream cut before its end — or nothing usable is answered
        // below as a first attempt's such reply is, with what the rounds cost and what it said of its own, in its own head.
        json = r2.json;
        text = null;
        loopTotal = sumUsage([roundsTotal(rounds, rounds[rounds.length - 1]), r2.st?.usage].filter(Boolean));
        noteToolRounds();
        await deferAnswered();
        break;
      }
      json = r2.json;
      rounds.push(json);
    }
    if (json && !isErrJson(json) && (rounds.length > 1 || ourCalls(parseReply(fmtJ, json)).length)) {
      const leftover = ourCalls(parseReply(fmtJ, json));
      if (leftover.length && !otherCalls(parseReply(fmtJ, json)).length) {
        // The round limit: the last round's calls never ran, and run now, their results riding the session's next request.
        await deferRun(leftover, "limit");
        // The client is shown the merged rounds all the same, so the exchange is recorded too (BUG-11b).
        if (rounds.length > 1) finishWithheld(parseReply(fmtJ, json));
      }
      // The last round came back whole: record the exchange (BUG-11).
      else if (rounds.length > 1) finishWithheld(parseReply(fmtJ, json));
      loopTotal = roundsTotal(rounds, json);
      json = mergeJsonRounds(fmtJ, rounds);
      text = null;
    }
  }
  // A 200 with nothing usable in it — a stream that carried no events, or a body that is not JSON where translation
  // needs it — is an upstream error too; only untranslated bytes may go through as they are.
  const empty = !json && (text === null || xlat || wireResp);
  if (empty)
    log("warn", `${rec.id} upstream ${p.upstream.id} answered 200 with nothing usable in it (empty reply)`);
  const isErr = empty || isErrJson(json);
  const u =
    json && !isErr
      ? upFmt === "anthropic"
        ? usageFromAnthropic(json.usage)
        : p.passthrough
          ? usageFromResponses(json.usage)
          : usageFromOpenAI(json.usage)
      : st?.usage || {};
  // The tier the provider served, from the reply itself or the stream it was collected from (a fast request bills
  // fast only when it matches the tier asked for).
  const servedTier = json && !isErr && typeof json.service_tier === "string" ? json.service_tier : st?.usage?.tier;
  if (typeof servedTier === "string" && servedTier) u.tier = servedTier;
  const thinkingChars = json?.content
    ? json.content.filter((b) => b.type === "thinking").reduce((n, b) => n + (b.thinking || "").length, 0)
    : json?.output
      ? json.output
          .filter((it) => it.type === "reasoning")
          .reduce((n, it) => n + (it.summary || []).reduce((m, s2) => m + (s2.text || "").length, 0), 0)
      : (json?.choices?.[0]?.message?.reasoning_content || "").length;
  const stop =
    json?.stop_reason ||
    json?.choices?.[0]?.finish_reason ||
    (p.passthrough ? json?.status : undefined) ||
    st?.stopReason;
  let outJson = json;
  if (xlat && json && !isErr)
    outJson =
      format === "openai"
        ? anthropicToOpenaiResponse(json, { model: body.model, reasoning: reasoningOn })
        : openaiToAnthropicResponse(json, { model: body.model, reasoning: reasoningOn });
  else if (xlat && json && isErr) outJson = JSON.parse(translateError(JSON.stringify(json), upFmt, format));
  const status = isErr ? 502 : 200;
  if (memCue && outJson && !isErr) {
    memAfter(clientFmt, outJson);
    if (memCueSentence && applyCueJson(clientFmt, outJson, memCueSentence)) noteCue();
    text = null;
  }
  if (!isErr && !memCue) memAfter(clientFmt, outJson);
  if (shaped.clientWantsStream && outJson && !isErr) {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      ...head,
    });
    res.end(p.passthrough ? responseObjectToSse(outJson) : jsonToSse(format, outJson));
  } else if (text !== null && !xlat && !wireResp && !isErr) {
    // the upstream's bytes, untouched
    res.writeHead(200, { "content-type": ct || "application/json", ...head });
    res.end(text);
  } else
    sendJson(
      res,
      status,
      outJson ?? errorBody(format, 502, "empty reply from the upstream"),
      head,
    );
  if (!isErr) noteCompactionCut(stop, loopTotal || u);
  finish(
    rec,
    {
      status: isErr ? "error" : "ok",
      httpStatus: status,
      ...usageAndCost(rec, loopTotal || u),
      stopReason: stop,
      thinkingChars,
      textChars: st?.textChars,
      // The tool calls the client was shown: what tells whether its loop goes on (memory's `endsClientTurn`), where the
      // upstream's stop reason, read before the reply was translated, does not.
      _toolCalls: isErr ? 0 : parseReply(clientFmt, outJson).blocks.filter((/** @type {any} */ b) => b.type === "tool_use").length,
      error: empty
        ? "empty reply from the upstream"
        : isErr
          ? json?.error?.message || json?.error?.type || "upstream error"
          : undefined,
    },
  );
  // What the reply is beside its record — the Responses store's copy for previous_response_id, the calibration — comes
  // once the reply went out and its record is closed whole: a throw of Filament's own there costs neither (reply.js).
  if (p.passthrough && json?.object === "response") res.noteResponse?.(json);
  // Calibration reads the receipt, not the provider: what it tokenized over what we estimated for the body sent.
  // `u` is the merged client-facing usage (the first round's prompt when a memory tool-loop ran) — it pairs with
  // the first body. The loop's summed total is deliberately NOT used: it would teach the ratio an N× lie.
  if (!isErr) {
    const ti = totalInputOf(u);
    if (ti)
      observeRatio(
        p.upstream.id,
        parseModelSuffix(p.shaped?.body?.model || body.model, cfg.rules).base,
        () => estimateBodyTokens(p.shaped?.body, "request", null, { weights: ctx.weights ?? null }),
        ti,
      );
  }
}
