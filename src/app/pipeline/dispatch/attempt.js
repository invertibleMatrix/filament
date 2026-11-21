// @ts-check
// One try against one candidate: plan, take a concurrency slot, record what is sent, forward. Returns the plan and
// the upstream reply, or what went wrong. Used twice when a server turns out to have no /v1/chat/completions.
// Every call holds its slot by name, and a call that waits for one says what it waits behind (HarnessV3-AtHome AH-F5).
import { confirmedWords } from "../../../core/slots.js";
import { redactAndCap, redactHeaders } from "../../../core/redact.js";
import { summarizeBody } from "../../../core/body-summary.js";
import { durationWords } from "../../../core/text.js";
import { errorBody } from "../../../core/wire/errors.js";
import { requestWasAborted } from "../../../services/health.js";
import { callWaits } from "../../../services/call-waits.js";
import { recordSource } from "../../../services/records.js";
import { MEDIA_BYTES } from "../../../core/media.js";
import { modelsLentTo } from "../../../services/devices.js";
import { isMachineUpstream } from "../../../core/schema.js";
import { keptStateNamed } from "../../../core/provider-state.js";
import { sendJson } from "../respond.js";
import { carriesPdf, mediaWithin, pdfsAsSent, readsPdfs } from "./pdfs.js";

/** The room a request has for its pictures, PDFs and files, in a note's words (core/media.js MEDIA_BYTES). */
const MEDIA_ROOM = `the ${MEDIA_BYTES / (1024 * 1024)} MB of pictures, PDFs and files one request carries, the newest first`;

/** @typedef {import("../context.js").RequestContext} RequestContext */
/** @typedef {import("../../deps.js").AppDeps} AppDeps */
/**
 * @typedef {{ p: any, fw: { res: Response, cleanup: () => void } } | { error: { status: number, message: string } } | { p: any, thrown: any }} AttemptResult
 *   `fw.cleanup` also releases the concurrency slot
 */

/**
 * The failover bookkeeping one request keeps across its candidates.
 * @typedef {object} FailoverTrail
 * @property {{ status: number, message: string, upstream?: string, retryable?: boolean } | null} lastError  `upstream`
 *   and `retryable` on a provider Filament could not reach: which, and whether its adapter judged another try worth it —
 *   the dispatch's final failure says both (HarnessV3-AtHome AH-F4)
 * @property {{ upstream: string, status: number | null, reason: string, detail?: string }[]} failed  the entries that
 *   failed before one answered: `reason` the headline, `detail` all it said where that is more (HarnessV4_Tasks B10)
 * @property {(upstreamId: string, status: number | null, said: unknown, detail?: string | null) => void} note  `said`:
 *   all the provider answered, or an agent's headline with what it wrote as it ended in `detail`; the failure of a
 *   candidate that took the request over takes back the line `servedBy` said of it, and its name as the candidate that
 *   served (`rec.failover.servedBy` null, the trail kept)
 * @property {(upstreamId: string, index: number) => void} servedBy  stamps the record when a backup answers or takes the
 *   request over, its line in the notes every later attempt opens with (`priorChanges`)
 */

/**
 * What holds a slot, in the words a waiting call says (HarnessV3-AtHome AH-F5), by its record's source — one for each
 * of Traffic's sources (core/schema.js TRAFFIC_SOURCES).
 * @type {Readonly<Record<string, string>>}
 */
export const HOLDER_WORDS = Object.freeze({
  client: "a request from your tools",
  memory: "a memory call",
  "agent-loop": "an agent turn",
  "agent-tick": "a turn's model call",
  subagent: "a sub-agent's call",
  compaction: "a compaction fork",
  replay: "a replay",
  assistant: "the console assistant",
  housekeeping: "a housekeeping call",
  ping: "a health ping",
});

/**
 * A call as the holder of a slot: its record, and what it is in words — a sub-agent's when it is background work.
 * @param {any} rec @param {boolean} background
 * @returns {import("../../../services/health.js").SlotHolder}
 */
function holderOf(rec, background) {
  const source = recordSource(rec);
  if (!background) return { id: rec.id, what: HOLDER_WORDS[source] || source };
  return { id: rec.id, what: source === "agent-tick" ? "a sub-agent's model call" : source === "compaction" ? "a sub-agent's compaction fork" : "a sub-agent's call" };
}

/** The holders of a lane's slots in words: three named, the rest counted. @param {import("../../../services/health.js").SlotHolder[]} holders */
function holdersWords(holders) {
  const named = holders.slice(0, 3).map((h) => `${h.what} (${h.id})`);
  if (holders.length > 3) named.push(`${holders.length - 3} more`);
  return named.length > 1 ? `${named.slice(0, -1).join(", ")} and ${named.at(-1)}` : named[0] || "the calls in flight";
}

/** @param {any} rec @returns {FailoverTrail} */
/** The most of what a provider or an agent said as it failed that a trail's entry keeps under its headline. */
const FAIL_DETAIL_CHARS = 4000;

export function createFailoverTrail(rec) {
  /** The record's line of the candidate that took the request over (`servedBy`). @type {string | null} */
  let served = null;
  /** @type {FailoverTrail} */
  const trail = {
    lastError: null,
    failed: [],
    note(upstreamId, status, said, detail = null) {
      const whole = String(said || "");
      const reason = whole.slice(0, 160);
      const more = String(detail || "").trim() || (whole.length > reason.length ? whole : "");
      const kept = more.length > FAIL_DETAIL_CHARS ? `${more.slice(0, FAIL_DETAIL_CHARS)}… (${more.length - FAIL_DETAIL_CHARS} more characters)` : more;
      trail.failed.push({ upstream: upstreamId, status: status || null, reason, ...(kept ? { detail: kept } : {}) });
      // A candidate that took the request over and failed after all — an agent before its first word — served nothing:
      // the record's line of it goes, and the record names no candidate that served it until one does, its trail kept —
      // whatever ends the request next, a client that leaves among it.
      if (served) {
        for (const list of [rec.priorChanges, rec.changes]) {
          const at = Array.isArray(list) ? list.lastIndexOf(served) : -1;
          if (at >= 0) list.splice(at, 1);
        }
        served = null;
        rec.failover = { trail: trail.failed.slice(), servedBy: null };
      }
    },
    servedBy(upstreamId, i) {
      if (!trail.failed.length) return;
      rec.failover = { trail: trail.failed.slice(), servedBy: upstreamId, attempt: i + 1 };
      // Said on the record whatever attempt comes after — a memory follow-up, an agent's turn — each opening its changes
      // with the notes gathered so far.
      served = `failover: served by ${upstreamId} (#${i + 1} in order) after ${trail.failed.map((t) => `${t.upstream} failed${t.status ? ` with HTTP ${t.status}` : ""}`).join(", ")}`;
      (rec.priorChanges ||= []).push(served);
      (rec.changes ||= []).push(served);
    },
  };
  return trail;
}

/**
 * @param {RequestContext} ctx
 * @param {AppDeps} deps
 * @param {{ candidate: any, index: number }} which
 * @returns {(wireNow: string | null) => Promise<AttemptResult>}
 */
export function createAttempt(
  ctx,
  { config, log, health, concurrency, plan, destination },
  { candidate, index },
) {
  const { format, body, raw, pre, headers: inboundHeaders, requested, route, rec } = ctx;
  return async (wireNow) => {
    const cfg = config();
    /** @param {any} sent */
    const planned = (sent) =>
      plan({
        format,
        body: sent,
        inboundHeaders,
        candidate,
        route,
        requested,
        requestId: rec.id,
        wire: wireNow,
        responsesBody: pre?.responsesBody || null,
      });
    let p = planned(body);
    if (p.error) return { error: { status: 502, message: p.error } };
    // The pictures, PDFs and files a request carries go within the room it has, the newest whole; then a PDF goes as it
    // is to a model that reads PDFs, as far as a request takes them, and as its text to every other (pdfs.js).
    const model = p.shaped.body?.model;
    const native = format === "anthropic" && readsPdfs(p.upstreamFormat, model);
    // Another machine's chat's PDFs (services/devices.js `modelsLentTo`) are read by no program of this machine's: each
    // goes as it came to a model that reads PDFs, the provider's own limits its to say, and a model that reads none is
    // refused one in words — never handed this machine's pdftotext's reading of it.
    const lent = !!modelsLentTo(ctx.req);
    if (lent && format === "anthropic" && carriesPdf(body) && !native)
      return { error: { status: 400, message: `${model || "this model"} at ${p.upstream.id} reads no PDF, and this machine reads none for another machine's chat: send the PDF's text, or call a Claude model` } };
    // Another machine's models (adapters/providers/filament.js) take a PDF as it came — that machine's model reads it,
    // or that machine refuses it in words —, and nothing this machine's provider keeps on its account, which that
    // machine refuses: a request that names some goes to the next candidate.
    const there = isMachineUpstream(p.upstream);
    const kept = there ? keptStateNamed(p.upstreamFormat, p.shaped.body) : "";
    if (kept)
      return { error: { status: 400, message: `${model || "this model"} at ${p.upstream.id} is another machine's, and the request names ${kept}, which this machine's provider keeps on this machine's account: send what it holds instead, or call a model of this machine's` } };
    const within = await mediaWithin(body, { bytes: MEDIA_BYTES, pdfs: (native || there) && !lent, why: MEDIA_ROOM, ...(lent ? { pdftotext: null } : {}) });
    let sent = within.body;
    const notes = within.notes;
    if (format === "anthropic" && carriesPdf(sent) && !lent && !there) {
      const asSent = await pdfsAsSent(sent, { native, why: `${model || "the model"} at ${p.upstream.id} is not a Claude model on the Anthropic wire` });
      sent = asSent.body;
      notes.push(...asSent.notes);
    }
    if (sent !== body) {
      p = planned(sent);
      if (p.error) return { error: { status: 502, message: p.error } };
    }
    p.shaped.changes.push(...notes);
    const { upstream, shaped, headers, url } = p;
    Object.assign(rec, {
      upstream: upstream.id,
      upstreamModel: shaped.body.model,
      changes: [...(rec.priorChanges || []), ...shaped.changes],
      attempt: index + 1,
    });
    // Fast mode bills at the row's fastMultiplier: the record says the request went out fast (a failover to a
    // candidate that does not take it clears the mark again) — Anthropic's `speed`, or a provider's own fields. A fast
    // mode that asks for a service tier also says which: the reply names the tier it served, and only that tier bills fast.
    // The flex tier (Providers P5) is marked the same way, with the tier its fields ask for: it bills at the row's
    // flexMultiplier only when the reply names that tier (`usageAndCost`).
    if (shaped.fast || shaped.body?.speed === "fast") rec.speed = "fast";
    else if (shaped.flex) rec.speed = "flex";
    else delete rec.speed;
    const tier = rec.speed === "fast" ? p.caps?.fast?.params?.service_tier : undefined;
    if (typeof tier === "string" && tier) rec.fastTier = tier;
    else delete rec.fastTier;
    const flexTier = rec.speed === "flex" ? p.caps?.flex?.params?.service_tier : undefined;
    if (typeof flexTier === "string" && flexTier) rec.flexTier = flexTier;
    else delete rec.flexTier;
    let slot = { release() {}, waitedMs: 0, queued: false };
    /** What the call waited behind, in words, once it had to wait: the ceiling in force and what held its slots. */
    let cause = "";
    let bodyString;
    try {
      const model = shaped.body.model;
      // Only what the provider showed caps a lane: a model's agent limit (core/slots.js) counts agents, never calls (the
      // owner's word of 11-05), and nothing is set here by hand.
      /** The ceiling in force at this lane — what the provider showed — and its source. */
      const inForce = (now = Date.now()) => health.observedCeiling(upstream.id, model, now);
      /** That ceiling said: how many calls at a time, and where that came from. @param {NonNullable<ReturnType<typeof inForce>>} c @param {number} now */
      const ceilingWords = (c, now) =>
        `${model} runs ${c.cap} call${c.cap === 1 ? "" : "s"} at a time at ${upstream.id} (${c.from === "headers" ? "from its rate-limit headers" : learnedWords(c, now)})`;
      /** A learned ceiling's part: when a 429 taught it and when it lifts; one its provider confirmed, how many it takes and when one more is tried. @param {any} c @param {number} now */
      const learnedWords = (c, now) => {
        const sure = confirmedWords(c, now);
        if (!sure) return `learned from a 429 ${durationWords(now - c.at)} ago; it lifts in ${durationWords(c.liftsAt - now)}`;
        return `${sure}; ${c.probing ? "another is tried" : "one more is tried"} in ${durationWords(Math.max(0, c.liftsAt - now))}${c.probing ? " with no refusal" : ""}`;
      };
      // Every call holds its lane while it runs, by name, and waits for it without a deadline: the client's hang-up or
      // a Stop ends the wait (HarnessV3-FailurePoints §4 A). A sub-agent's work waits behind the rest, and a call that
      // names itself hears of its wait (HarnessV3-AtHome AH-F5).
      const callId = String(inboundHeaders["x-filament-call"] || "");
      const background = inboundHeaders["x-filament-background"] === "1";
      slot = await concurrency.acquire(
        upstream.id,
        model,
        () => {
          const c = inForce();
          return { cap: c?.cap ?? null, liftsAt: c?.from === "429" ? c.liftsAt : null };
        },
        {
          signal: ctx.client.abort.signal,
          background,
          holder: holderOf(rec, background),
          onQueued: (holders) => {
            const now = Date.now();
            const c = inForce(now);
            cause = `${c ? ceilingWords(c, now) : `${model} at ${upstream.id} has calls waiting ahead of it`}, held by ${holdersWords(holders)}`;
            log("info", `${rec.id} waiting for a slot: ${cause}`);
            callWaits.queued(callId, { words: `waiting for a slot: ${cause}`, upstream: upstream.id, model, cap: c?.cap ?? 0, holders });
          },
        },
      );
      if (slot.queued) {
        callWaits.slot(callId);
        // A wait is the request's own history: said on its record whatever attempt comes after — a memory follow-up, a
        // detour, another candidate — each opening its changes with the notes gathered so far. The ceiling in force is the
        // attempt's own, said again by each attempt that meets it.
        const waited = `concurrency: waited ${durationWords(slot.waitedMs)} for a slot: ${cause}`;
        (rec.priorChanges ||= []).push(waited);
        (rec.changes ||= []).push(waited);
      } else {
        const c = inForce();
        if (c) (rec.changes ||= []).push(`concurrency: ${ceilingWords(c, Date.now())}`);
      }
      bodyString = JSON.stringify(shaped.body);
      const store = cfg.observability.storeBodies;
      if (store !== "none") {
        rec.url = url;
        rec.shapedHeaders = redactHeaders(headers);
        rec.translation = {
          received: summarizeBody(body, format, raw.length),
          sent: summarizeBody(shaped.body, format, bodyString.length),
        };
      }
      if (ctx.flags.bodiesAllowed && (store === "shaped" || store === "full"))
        rec.shapedBody = redactAndCap(bodyString, cfg.observability.maxStoredBodyBytes);
      log(
        "debug",
        `${rec.id} ${format} ${body.model} -> ${upstream.id}/${shaped.body.model} ${shaped.changes.length ? "| " + shaped.changes.join("; ") : ""}`,
      );
      const attach = (fw) => {
        const orig = fw.cleanup;
        fw.cleanup = () => {
          try {
            orig?.();
          } catch {}
          try {
            slot.release();
          } catch {}
        };
        return fw;
      };
      const answers = destination(upstream)?.answers;
      if (!answers) throw new Error(`${upstream.id} does not answer requests`);
      const opened = await answers.open({
        url,
        headers,
        bodyString,
        body: shaped.body,
        modelId: shaped.body.model,
        format: p.upstreamFormat,
        signal: ctx.client.abort.signal,
      });
      if (opened.url) rec.url = opened.url;
      if (opened.notes?.length) rec.changes = [...(rec.changes || []), ...opened.notes];
      return { p, fw: attach(opened) };
    } catch (/** @type {any} */ e) {
      try {
        slot.release();
      } catch {}
      return { p, thrown: e };
    }
  };
}

/**
 * A provider Filament could not reach, judged as such — a request's first attempt and its memory follow-up alike: what
 * its adapter says of it (its words, and whether another try is worth it) goes on the provider's health, which the
 * record's close counts no more (`healthRecordedFor`). → the failure as the client is told it, and the note its cooldown
 * is said in, or null.
 * @param {Pick<AppDeps, "health" | "destination">} deps
 * @param {any} rec @param {any} e @param {any} upstream
 * @returns {{ failure: { status: number, message: string, upstream: string, retryable: boolean }, note: string | null }}
 */
export function judgeUnreachable({ health, destination }, rec, e, upstream) {
  const answers = destination(upstream)?.answers;
  const said = answers
    ? answers.unreachable(e)
    : { message: `upstream ${upstream.id} unreachable: ${e.cause?.code || e.message}`, retryable: true };
  const failure = { status: 502, message: said.message, upstream: upstream.id, retryable: said.retryable };
  const r = health.recordFailure(upstream.id, { message: failure.message, retryable: failure.retryable });
  rec.healthRecordedFor = upstream.id;
  return { failure, note: r.cooledDown ? `health: ${upstream.id} cooling down ${Math.round(r.waitMs / 1000)} s (unreachable)` : null };
}

/**
 * What a failure no provider answered says in its head beside its words (HarnessV3-AtHome AH-F4): the provider it met,
 * and `x-should-retry: false` where its adapter judged another try pointless.
 * @param {{ upstream?: string, retryable?: boolean } | null | undefined} lastError
 * @returns {Record<string, string>}
 */
export const failureHead = (lastError) =>
  lastError?.upstream ? { "x-filament-upstream": lastError.upstream, ...(lastError.retryable === false ? { "x-should-retry": "false" } : {}) } : {};

/**
 * A failed connection: the client left (the response is closed and the record finished), or this upstream is
 * unreachable and the next candidate gets its turn.
 * @param {RequestContext} ctx
 * @param {AppDeps} deps
 * @param {FailoverTrail} trail
 * @param {any} e
 * @param {any} upstream
 * @returns {"return" | "continue"}
 */
export function unreachable(ctx, deps, trail, e, upstream) {
  const { log, finish } = deps;
  const { res, format, rec } = ctx;
  if (requestWasAborted(e, ctx.client.abort)) {
    // Close the client socket: finishing the record alone left the original fetch hanging until process teardown
    // (the cancel-classification test waited five minutes for that).
    if (!res.headersSent) sendJson(res, 502, errorBody(format, 502, "client disconnected"));
    else
      try {
        res.end();
      } catch {}
    finish(rec, { status: "aborted", error: "client disconnected" });
    return "return";
  }
  const { failure, note } = judgeUnreachable(deps, rec, e, upstream);
  trail.lastError = failure;
  log("warn", failure.message);
  trail.note(upstream.id, null, e.cause?.code || e.message);
  // The cooldown is said on the record whichever candidate answers next, the last one's too: a later attempt opens its
  // record's changes with the notes gathered so far, this one among them.
  if (note) {
    (rec.priorChanges ||= []).push(note);
    (rec.changes ||= []).push(note);
  }
  return "continue";
}
