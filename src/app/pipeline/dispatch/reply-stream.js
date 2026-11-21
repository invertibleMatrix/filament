// @ts-check
// The streaming reply: the upstream's SSE forwarded to the client through the stages this request needs — memory
// tool interception (in the upstream's shape), Responses events → Chat Completions chunks, then Chat Completions ↔
// Anthropic for the client — with a scanner on the client-facing text for usage and counts. When no stage is needed
// the bytes are piped straight through.
import { pipeStream, waitDrain, createSseScanner, ReplyReadError } from "../../../adapters/providers/http.js";
import { createSseFold, droppedLines } from "../../../core/wire/sse.js";
import {
  createAnthropicToOpenaiStream,
  createOpenaiToAnthropicStream,
} from "../../../core/wire/translate.js";
import { createResponsesToChatStream } from "../../../core/wire/responses.js";
import { INCOMPLETE_STREAM, streamError } from "../../../core/wire/errors.js";
import {
  createMemoryToolStream,
  genericFromStream,
  createCueStream,
} from "../../memory-tools.js";
import { usageAndCost } from "../../../core/usage-cost.js";
import { createTierSniffer } from "../../../core/wire/usage.js";
import { estimateBodyTokens } from "../../../core/tokens.js";
import { parseModelSuffix } from "../../../core/shaping.js";
import { observeRatio, totalInputOf } from "../../../services/token-calib.js";
import { sseHead } from "../respond.js";

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
export async function streamReply(ctx, { config, log, usage, finish }, rc, loop) {
  const cfg = config();
  const { res, format, body, rec } = ctx;
  const { p, passthroughHeaders, xlat, wireResp, scanFmt, clientFmt, reasoningOn } = rc;
  const {
    memTools,
    keepsTurn,
    maxRounds,
    memCue,
    memCueSentence,
    noteCue,
    memAfter,
    noteToolRounds,
    noteCompactionCut,
    runRound,
    deferRun,
    deferAnswered,
    followUp,
    finishWithheld,
  } = loop;
  let ures = rc.ures;
  /** The status the provider refused the follow-up the reply ended on with, or null. @type {number | null} */
  let refusedWith = null;
  /** The follow-up the reply ended on was aborted on its way, the client's signal standing or not (`followUp`). */
  let followUpAborted = false;
  /** The client is gone: it hung up, or a stop ended its request (route.js) — Filament's own end of the reply. */
  const gone = () => res.destroyed || ctx.client.abort.signal.aborted;
  res.writeHead(200, sseHead({ "x-accel-buffering": "no", ...passthroughHeaders }));
  res.flushHeaders?.();
  /** @type {any} */
  let st;
  /** The staged path's reader of the upstream's own bytes for the tier it served. @type {ReturnType<typeof createTierSniffer> | null} */
  let tiers = null;
  // A line past what Filament reads of one is said once, for the whole reply (core/wire/sse.js `droppedLines`). The
  // readers beside the client's stream — the scanner and memory's fold — drop it from what they read, and the client
  // gets it as it came; a stage the stream goes through on its way — memory's tool stage, a translation, the cue, the
  // Responses front door's translation — drops it from what the client gets.
  const staged = memTools || wireResp || xlat || keepsTurn;
  const through = memTools || wireResp || xlat || (staged && !!memCueSentence) || (ctx.pre?.api === "responses" && !p.passthrough);
  const dropped = droppedLines(
    log,
    rec.id,
    through
      ? "its client got the reply without it, and so do the request's usage, its record and memory's copy of the reply"
      : "its client got it as it came; the request's usage, its record and memory's copy of the reply go without it",
  );
  // A Responses-wire upstream streams Responses events even when the client speaks another format.
  /** @type {any} */
  const memStage = memTools ? createMemoryToolStream(wireResp ? "responses" : scanFmt, { onOver: dropped.onOver }) : null;
  /** @type {any[]} */
  const stages = [];
  if (wireResp) stages.push(createResponsesToChatStream({ model: p.shaped.body.model, onOver: dropped.onOver }));
  if (xlat)
    stages.push(
      format === "openai"
        ? createAnthropicToOpenaiStream({ model: body.model, reasoning: reasoningOn, onOver: dropped.onOver })
        : createOpenaiToAnthropicStream({ model: body.model, reasoning: reasoningOn, onOver: dropped.onOver }),
    );
  if (!memStage && !stages.length && !keepsTurn) {
    // What the stream says as it is read: what the reply has cost so far (`rc.spent`), as its record bills it at the end.
    const scanner = createSseScanner(scanFmt, { onOver: dropped.onOver });
    rc.spent = () => scanner.state.usage;
    st = await pipeStream({
      upstreamRes: ures,
      clientRes: res,
      format: scanFmt,
      onFirstByte: () => usage.firstByte(rec),
      onProgress: (chars) => usage.progress(rec, { outChars: chars }),
      onOver: dropped.onOver,
      gone,
      scanner,
    });
    // A read that failed with its client still there — the provider's connection lost, or its silence — ends the stream
    // on the failure's words, its record keeping what the stream said so far.
    if (st.broke) {
      st.error = st.broke.message;
      try {
        res.write(streamError(clientFmt, st.error));
      } catch {}
    }
  } else {
    const scanner = createSseScanner(clientFmt, { onOver: dropped.onOver });
    // What the reply has cost so far (`rc.spent`), as its record bills it at the end. The client-facing events carry the
    // conversation's true size (first round's prompt); the record keeps what the loop actually processed across every
    // round — the billing truth. A translated stream told its client the usage its own format says, which says less than
    // the provider did — a Chat Completions usage folds Anthropic's cache writes into its prompt, and neither format's
    // carries the other's hour of writes, thinking count or stated charge — and nothing where the stream stopped before
    // its end, a Chat Completions stream saying it last: the record bills what the provider said, as the first stage read
    // it in the provider's own words.
    rc.spent = () => memStage?.totalUsage?.() ?? (stages.length ? stages[0].state.usage : scanner.state.usage);
    // The scanner reads the client-facing stream, which a translation may have stripped of the tier the provider named.
    tiers = createTierSniffer();
    // What the client was shown, folded into the reply as it goes out, for memory to archive on the turn its prepare
    // opened at the end (`keepsTurn`, a muted chat's among them): never kept as text and parsed again then.
    const fold = keepsTurn ? createSseFold(clientFmt, { onOver: dropped.onOver }) : null;
    const cueStage = memCueSentence ? createCueStream(clientFmt, memCueSentence, { onOver: dropped.onOver }) : null;
    // Each event is parsed once on its way: every reader of a piece of the text hands what it parsed of it to the next
    // reader of the same piece (core/wire/sse.js `parseKnown`) — the memory stage to the first stage or the scanner, the
    // scanner to the fold. A stage writes text of its own, which the reader after it parses.
    /** @param {string} t @param {import("../../../core/wire/sse.js").Parsed | null} [known]  what the memory stage parsed of `t` */
    const forward = (t, known = null) => {
      for (const s of stages) {
        t = s.push(t, known);
        known = null;
      }
      if (t) {
        scanner.feed(t, known);
        const read = scanner.parsed;
        fold?.feed(t, read);
        if (cueStage) t = cueStage.push(t);
        return res.write(t); // a harness turn's heartbeat rides res.write's wrap (session-turns.js `renewOnWrite`)
      }
      return true;
    };
    const decoder = new TextDecoder();
    let first = true;
    /** The round whose memory calls ran last, as the stream built it (`runRound`). @type {any} */
    let answeredGeneric = null;
    for (let round = 0; ; round++) {
      const reader = /** @type {ReadableStream<Uint8Array>} */ (ures.body).getReader();
      /** The client went while this round's body was read: its read, aborted with the request, failed. */
      let cut = false;
      /** This round's read failed with its client still there: the provider's failure. @type {ReplyReadError | null} */
      let broke = null;
      try {
        for (;;) {
          /** @type {ReadableStreamReadResult<Uint8Array>} */
          let read;
          try {
            read = await reader.read();
          } catch (e) {
            // A client gone — it hung up, or a stop ended its request — aborts the read with the request (forwardRequest):
            // the reply ends there, as at a hang-up the send waits on (`waitDrain`), never as the upstream's failure. A read
            // that fails with its client still there — the provider's connection lost, or its silence — ends it there
            // too: the provider's failure.
            if (gone()) cut = true;
            else broke = new ReplyReadError(e);
            break;
          }
          const { value, done } = read;
          if (done) break;
          if (first) {
            first = false;
            usage.firstByte(rec);
          }
          let t = decoder.decode(value, { stream: true });
          tiers.feed(t);
          if (memStage) t = memStage.push(t);
          const writable = forward(t, memStage?.parsed);
          usage.progress(rec, {
            outChars: scanner.state.textChars + scanner.state.thinkingChars,
            thinkChars: scanner.state.thinkingChars,
          });
          if (writable === false) {
            await waitDrain(res);
            if (res.destroyed) {
              await reader.cancel().catch(() => {});
              break;
            }
          }
        }
        let flush = decoder.decode();
        if (memStage) flush = memStage.push(flush);
        forward(flush, memStage?.parsed);
      } finally {
        try {
          reader.releaseLock();
        } catch {}
      }
      if (broke) {
        // The reply ends on the failure's words, said as the provider would say an error, which the client and the
        // readers beside its stream read as no end of the reply: memory archives neither an answer nor a summary from it,
        // and the record keeps what the streams said so far. A follow-up's reply broken so is a follow-up that failed:
        // what the rounds' calls returned rides the session's next request as each round got it, and the exchange put
        // back ends before the newest round.
        forward(memStage ? memStage.finish({ error: broke.message }) : streamError(wireResp ? "responses" : scanFmt, broke.message));
        if (answeredGeneric) {
          await deferAnswered();
          finishWithheld(answeredGeneric, { answered: true });
        }
        break;
      }
      if (!memStage) break;
      // A client gone while a follow-up's reply streamed — it hung up, or a stop ended its request — was handed none of
      // the rounds' results by the model: what their calls returned rides the session's next request, each round's as it
      // got it, so a writer that ran is told there and never run again.
      if (res.destroyed || cut) {
        if (answeredGeneric) await deferAnswered("gone");
        break;
      }
      const r = memStage.endResponse();
      forward(r.forwarded);
      // A follow-up's reply that said an error — with its end or without — or stopped short of saying its end, a stream
      // the provider cut, is a follow-up that failed, its client still there: what the rounds' calls returned rides the
      // session's next request as each round got it, and the exchange put back ends before the newest round, which the
      // model's reply never answered.
      if (answeredGeneric && (r.failed || !r.generic.ended)) {
        await deferAnswered();
        finishWithheld(answeredGeneric, { answered: true });
        break;
      }
      if (r.needsFollowUp && round < maxRounds) {
        answeredGeneric = genericFromStream(r.generic);
        await runRound(answeredGeneric, r.responseId);
        memStage.nextResponse();
        const next = await followUp();
        if (!("res" in next)) {
          // A follow-up that failed ends the reply on an error event. A client gone while it was asked, or a follow-up
          // aborted on its way, is told nothing more: its request ends aborted (below), never as the upstream's failure.
          if ("gone" in next) followUpAborted = true;
          else if (!gone()) forward(memStage.finish({ error: "memory follow-up failed; the reply ends here" }));
          if ("refused" in next) refusedWith = next.refused.status;
          // What the rounds' calls returned rides the session's next request as each round got it — its client still there
          // or gone: the exchange put back ends before this round, which the model's reply never answered, and the next
          // request knows what its calls did — a writer's among them — never running them again.
          await deferAnswered("gone" in next ? "gone" : "failed");
          // The client was shown the merged rounds: recorded up to the round before this one (BUG-11b).
          finishWithheld(genericFromStream(r.generic), { answered: true });
          break;
        }
        ures = next.res;
        continue;
      }
      if (r.needsFollowUp) {
        forward(memStage.finish({}));
        await deferRun(r.ours, "limit");
        (rec.changes ||= []).push(
          `memory: memory tool round limit (${maxRounds}) reached; the model's last call(s) run now and their results ride along with the client's next request`,
        );
        // The client was shown the merged rounds all the same: the exchange is recorded too (BUG-11b).
        finishWithheld(genericFromStream(r.generic));
        break;
      }
      if (r.deferred.length) await deferRun(r.deferred, "mixed");
      // The last round ended normally: what the client was shown is known, and the exchange can be put back (BUG-11).
      finishWithheld(genericFromStream(r.generic));
      break;
    }
    let tail = "";
    for (const s of stages) tail = s.push(tail) + s.end();
    // A stage ends a stream that stopped before its reply did as an error: the upstream's cut, never a client that is
    // gone — one that hung up, whose reader Filament cancelled itself, or one a stop ended — nor a follow-up aborted on
    // its way, which is neither written nor counted against the upstream.
    if (tail && !gone() && !followUpAborted) {
      scanner.feed(tail);
      fold?.feed(tail, scanner.parsed);
      if (cueStage) tail = cueStage.push(tail);
      res.write(tail);
    }
    if (cueStage) {
      const rest = cueStage.end();
      if (rest) res.write(rest);
      if (cueStage.applied) noteCue();
    }
    scanner.end();
    st = scanner.state;
    if (fold) {
      fold.end(scanner.parsed);
      let j = null;
      try {
        j = fold.reply();
      } catch {}
      memAfter(clientFmt, j);
    } else if (memTools) noteToolRounds();
  }
  // A stream that stopped short of saying its end — no stop reason, finish_reason, [DONE] or final response, and no
  // error of its own — broke off mid-reply: its record says so in the words a translated stream ends with, never as a
  // finished reply. A client that is gone is Filament's own end of it, never the upstream's cut: the request was
  // aborted — it went while the send waited for it to read (`waitDrain`), while a round's body was read (its read
  // aborted with the request), or while memory's follow-up was asked — and so is a follow-up aborted on its way. Its
  // rounds' tokens so far are what it cost; its turn is left unanswered, the fold holding no end of the reply, so the
  // client's retry goes on with it.
  const away = gone() || followUpAborted;
  if (!st.error && !st.ended && !away) st.error = INCOMPLETE_STREAM;
  const aborted = !st.error && !st.ended && away;
  res.end();
  rc.fw.cleanup();
  const summed = rc.spent();
  // The loop's sum keeps token counts only: the tier the provider served (the last round's) rides along, so a fast
  // request downgraded to the default tier is billed standard on this path too.
  const servedTier = tiers?.tier || st.usage?.tier;
  const total = summed && servedTier && summed.tier !== servedTier ? { ...summed, tier: servedTier } : summed;
  if (!st.error) noteCompactionCut(st.stopReason, total);
  finish(
    rec,
    {
      status: st.error ? "error" : aborted ? "aborted" : "ok",
      httpStatus: 200,
      // A stream that ended on a follow-up the provider refused: the status it refused it with, which finish.js judges
      // the provider by as it judges a first attempt so refused — never as a stream that broke off, the 200 its head
      // went out as.
      _upstreamStatus: refusedWith,
      ...usageAndCost(rec, total),
      stopReason: st.stopReason,
      thinkingChars: st.thinkingChars,
      textChars: st.textChars,
      // The tool calls the client was shown, as the scanner on its stream counted them: what tells whether its loop goes
      // on (memory's `endsClientTurn`) where a translated stop reason does not.
      _toolCalls: st.toolCalls,
      error: st.error || (aborted ? "client disconnected" : undefined),
    },
  );
  // What the reply is beside its record — the Responses store's copy for previous_response_id, the calibration — comes
  // once the record is closed whole: a throw of Filament's own there costs the record nothing (reply.js).
  if (p.passthrough && st.final) res.noteResponse?.(st.final);
  // Same calibration read as the JSON path — over the CLIENT-FACING usage (`st.usage`: the first round's prompt),
  // never the loop's summed total: the estimate pairs with the body the first round sent, and a memory tool-loop's
  // totalUsage() sums every round's input against that one body, which would teach the ratio an N× lie the
  // plausibility band happily passes.
  if (!st.error) {
    const ti = totalInputOf(st.usage);
    if (ti)
      observeRatio(
        p.upstream.id,
        parseModelSuffix(p.shaped?.body?.model || body.model, cfg.rules).base,
        () => estimateBodyTokens(p.shaped?.body, "request", null, { weights: ctx.weights ?? null }),
        ti,
      );
  }
}
