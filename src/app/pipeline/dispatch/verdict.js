// @ts-check
// What to do with the upstream's reply before a byte reaches the client: send the same request to /v1/responses
// when the server has no /v1/chat/completions, send the client's request again without memory's tools when its model
// takes none, send a call of Filament's own again within the output its provider says the model may write, hand a
// retryable or unserviceable status to the next candidate, and catch an error hidden inside a 200 stream. A refusal for
// size is an ordinary client error: it reaches the client whole. A 429 teaches a ceiling only
// when it is about this account's rate, never when the provider says it is overloaded (HarnessV3-AtHome AH-F5). A
// provider that says it cannot serve this account — its allowance spent, or the account or its key refused — is held
// as such for every caller (HarnessV3-TaskGraph-v2 TG2-D54): the pool skips it, and the failover order puts it last.
import { providerMeta } from "../../../core/wire/upstream-headers.js";
import { gateSseFirstEvent, reattachSseBody } from "../../../adapters/providers/http.js";
import { isWall, providerCause, wallWords } from "../../../core/provider-cause.js";
import { ordinal } from "../../../core/slots.js";
import { retryAfterSeconds } from "../../../core/retry.js";
import { toolsRefusalKey } from "../../memory-tools.js";
import { lowerOutputTo, outputAsked, statedOutputCeiling } from "../../../core/tokens.js";

/**
 * An error body's type and words, in whichever shape its provider wrote it: Anthropic's `{ error: { type, message } }`,
 * OpenAI's and Moonshot's `{ error: { message, type, code } }`, zai's `{ error: { code, message } }`, a bare
 * `{ message }`, or text.
 * @param {string} text @returns {{ type: string | null, said: string }}
 */
export function errorWordsOf(text) {
  /** @type {any} */
  let j = null;
  try {
    j = JSON.parse(text);
  } catch {}
  const e = j && typeof j === "object" ? (j.error && typeof j.error === "object" ? j.error : j) : null;
  const type = typeof e?.type === "string" && e.type !== "error" ? e.type : typeof e?.code === "string" && /^[a-z_]+$/i.test(e.code) ? e.code : null;
  const said = typeof e?.message === "string" ? e.message : typeof j?.error === "string" ? j.error : String(text || "");
  return { type, said: said.slice(0, 600) };
}

/** @typedef {import("../context.js").RequestContext} RequestContext */
/** @typedef {import("../../deps.js").AppDeps} AppDeps */
/** @typedef {import("./attempt.js").FailoverTrail} FailoverTrail */

/** The statuses that are the provider's failure, never the request's: another try, or another candidate, may serve it. */
const RETRYABLE = [408, 409, 425, 429, 500, 502, 503, 504, 529];

/**
 * A provider's refusal judged on its health — a request's first attempt and its memory follow-up alike. A provider that
 * says it cannot serve this account is held as such (TG2-D54), whichever way the reply goes on, with a `health:` line on
 * the record. A 429 about this account's rate teaches the refused model its ceiling from the calls of it in flight there,
 * the refused one among them (AH-F5); one that says the provider is overloaded, that it cannot serve this account, or that
 * this account may not use the model teaches none. A retryable status is the provider's failure, which the record's close
 * counts no more (`healthRecordedFor`) — save a model refused this account: the request's to change, never the provider's
 * fault, so nothing cools down for it. → whether the status is retryable.
 * @param {RequestContext} ctx
 * @param {Pick<AppDeps, "log" | "health" | "concurrency">} deps
 * @param {{ p: any, ures: Response, text: string }} r  the plan, the refusal, and the words it said
 * @returns {{ retryable: boolean }}
 */
export function judgeRefusal(ctx, { log, health, concurrency }, { p, ures, text }) {
  const { rec } = ctx;
  const { upstream } = p;
  let walled = false;
  let refusedModel = false;
  if (ures.status >= 400) {
    const { type, said: words } = errorWordsOf(text);
    const cause = providerCause({ status: ures.status, type, said: words, retryAfter: retryAfterSeconds(ures.headers) });
    if (cause && isWall(cause)) {
      walled = true;
      const w = health.noteWall(upstream.id, { kind: cause.kind === "out" ? "out" : "account", said: words, status: ures.status, resets: cause.resets });
      const note = `health: ${wallWords(w, upstream.id)}`;
      (rec.priorChanges ||= []).push(note);
      (rec.changes ||= []).push(note);
      log("warn", `${rec.id} ${note}`);
    }
    refusedModel = cause?.kind === "model";
  }
  const retryable = RETRYABLE.includes(ures.status);
  if (!retryable) return { retryable };
  const meta = providerMeta(ures);
  if (meta) health.recordMeta(upstream.id, meta);
  if (ures.status === 429) {
    // A provider overloaded is busy for everyone, and Filament's own loops try the call again (AH-F4); one whose
    // allowance is used up has its hold say the rest (TG2-D54). A model's lane is its own (AG-261).
    let note;
    if (/overloaded/i.test(text)) note = `concurrency: ${upstream.id} is overloaded (HTTP 429) — busy for everyone, so it teaches no ceiling`;
    else if (walled) note = `concurrency: ${upstream.id} says it cannot serve this account (HTTP 429) — not its rate, so it teaches no ceiling`;
    else if (refusedModel) note = `concurrency: ${upstream.id} says this account may not use ${String(p.upstreamModel || "this model")} (HTTP 429) — not its rate, so it teaches no ceiling`;
    else {
      const lane = String(p.upstreamModel || "");
      const n = concurrency.inflightAt(upstream.id, lane);
      const seen = health.note429(upstream.id, lane, n);
      // Refused at the same number again (the owner's word of 10-23), it holds longer, and one more is tried after.
      const c = /** @type {any} */ (health.observedCeiling(upstream.id, lane));
      const again = c?.from === "429" && Number(c.times) >= 2
        ? `, until ${Math.round((c.liftsAt - c.at) / 60_000)} minutes after this 429: it refused the ${ordinal(seen + 1)} ${c.times} times in a row, so then one more is tried, not the number set`
        : "";
      note = `concurrency: ${upstream.id} answered 429 with ${n} call${n === 1 ? "" : "s"} of ${lane} in flight — ${lane} runs at most ${seen} at a time there now${again || ", until ten minutes after its last 429"}`;
    }
    (rec.priorChanges ||= []).push(note);
    (rec.changes ||= []).push(note);
  }
  const r = health.recordFailure(upstream.id, { status: ures.status, message: `HTTP ${ures.status}`, ...(refusedModel ? { retryable: false } : {}) });
  rec.healthRecordedFor = upstream.id; // finish() must not count this upstream's failure again (a later candidate's failure still counts)
  if (r.cooledDown) {
    // visible on the record even when this was the last candidate
    const note = `health: ${upstream.id} cooling down ${Math.round(r.waitMs / 1000)} s after HTTP ${ures.status}`;
    (rec.priorChanges ||= []).push(note);
    (rec.changes ||= []).push(note);
  }
  return { retryable };
}
/**
 * @typedef {object} Accepted  the reply the client will get
 * @property {any} p  the plan
 * @property {{ res: Response, cleanup: () => void }} fw
 * @property {Response} ures  the upstream reply (its body possibly re-attached after the gate read its first event)
 * @property {string | null} preText  an error body already read; the reply path must not read the stream again
 */
/** @typedef {"next" | "done" | Accepted} Verdict  next candidate · the response is finished */

/**
 * The loop's view of one candidate: its upstream, its position, how to ask it again, how to give up on it.
 * @typedef {object} Candidate
 * @property {any} candUp
 * @property {number} index
 * @property {(wire: string | null) => Promise<any>} attempt
 * @property {(e: any, upstream: any) => "return" | "continue"} unreachable
 * @property {FailoverTrail} trail
 */

/**
 * @param {RequestContext} ctx
 * @param {AppDeps} deps
 * @param {Candidate} loop
 * @param {any} first  the first attempt's result
 * @returns {Promise<Verdict>}
 */
export async function judgeReply(ctx, deps, { candUp, index: i, attempt, unreachable, trail }, first) {
  const { log, health, wireApiDetected, toolsRefused } = deps;
  const { res, format, rec, candidates, failover } = ctx;
  let a = first;
  if (a.error) {
    trail.lastError = a.error;
    log("warn", a.error.message);
    return "next";
  }
  if (a.thrown) return unreachable(a.thrown, a.p.upstream) === "return" ? "done" : "next";
  let { p, fw } = a;
  let ures = fw.res;
  /** @type {string | null} */
  let preText = null;
  // wireApi = auto: a server that answers 404 or 405 on Chat Completions gets the same request on Responses. Only a
  // Responses attempt that SUCCEEDS proves the server is Responses-only and is remembered (BUG-02, 2026-09-30): a 404
  // is just as often a wrong base URL or path — the GLM incident latched an upstream on a doubled `/v4/v1/` path and
  // kept every later request on /responses until a restart. What is remembered is forgotten when the upstream's
  // address, type or wire API changes (server.js), so a corrected URL gets its Chat Completions tried again.
  const noChat = () =>
    p.wireApi === "chat-completions" && (candUp.wireApi || "auto") === "auto" && (ures.status === 404 || ures.status === 405);
  /** The same request on Responses, its body already read. @returns {Promise<"next" | "done" | null>} null: go on */
  const toResponses = async () => {
    fw.cleanup();
    const chatStatus = ures.status;
    (rec.priorChanges ||= []).push(
      `wire API: ${candUp.id} answered HTTP ${chatStatus} on Chat Completions${p.url ? ` (${p.url})` : ""}; the same request was sent to Responses`,
    );
    a = await attempt("responses");
    if (a.error) {
      trail.lastError = a.error;
      log("warn", a.error.message);
      return "next";
    }
    if (a.thrown) return unreachable(a.thrown, a.p.upstream) === "return" ? "done" : "next";
    ({ p, fw } = a);
    ures = fw.res;
    const outcome = ures.ok
      ? `wire API: ${candUp.id} has no Chat Completions — Responses served the request; Filament remembers that until this upstream's address, type or wire API changes (or a restart). Set wireApi = responses on this upstream to skip the detour`
      : `wire API: ${candUp.id} answered HTTP ${ures.status} on Responses too — probably a wrong base URL or path rather than a Responses-only server; nothing was remembered, so the next request tries Chat Completions again`;
    if (ures.ok) wireApiDetected.set(candUp.id, "responses");
    // The retry's record opened with the notes gathered so far; the outcome joins it and rides on to a later candidate.
    rec.priorChanges.push(outcome);
    (rec.changes ||= []).push(outcome);
    return null;
  };
  /**
   * A refusal of tools themselves, the model or its provider taking none: Ollama's "does not support tools",
   * OpenRouter's "No endpoints found that support tool use", vLLM's "tool choice requires --enable-auto-tool-choice",
   * "Function calling is not enabled for this model". Not one that names a tool or a function in passing — a tool
   * message out of place, a context length counted "in the functions", a server's "no such function": sent again
   * without memory's tools, it meets the same refusal, and the second call is paid for.
   * @param {string} text
   */
  const refusesTools = (text) =>
    /\b(?:tools?|functions?)(?:[ _-](?:use|calls?|calling|choice))?\b/i.test(text) &&
    /\b(?:supports?|supported|unsupported|(?:un)?available|enabled|disabled|allowed|accepts?|requires?)\b/i.test(text);
  // A refusal's words, read here once. A 404 that refuses tools is the model refusing memory's (OpenRouter's "No
  // endpoints found that support tool use"), not a server without Chat Completions: it is answered below, as sent.
  /** @type {string | null} */
  let said = null;
  if (noChat()) {
    const words = String(await ures.text().catch(() => ""));
    if (ctx.memory?.toolsAdded && refusesTools(words)) said = words;
    else {
      const end = await toResponses();
      if (end) return end;
    }
  }
  // What memory adds never makes a request fail (HarnessV3-AtHome AH-D1). A request that carried no tools of its own was
  // given memory's — or filament_recall alone (`toolsAddedAre`) — and a model that takes none refuses the whole request
  // for them: Ollama's "does not support tools", OpenRouter's "No endpoints found that support tool use". It goes again
  // as the client sent it. Only a retry that succeeds proves the model takes none, and that is remembered: its later
  // requests that carry no tools of their own are offered none (memory-prepare.js), until this upstream's address or
  // type changes, or a restart.
  const asSent = ctx.memory?.toolsAdded;
  if (asSent && [400, 404, 422].includes(ures.status)) {
    const text = said ?? (await ures.text().catch(() => ""));
    if (!refusesTools(text)) preText = text;
    else {
      fw.cleanup();
      asSent();
      const recallAlone = ctx.memory.toolsAddedAre === "recall";
      ctx.memory.toolsAdded = null;
      if (rec.memory) rec.memory.tools = false;
      const model = p.upstreamModel || ctx.requested.base;
      (rec.priorChanges ||= []).push(
        recallAlone
          ? `memory: ${model} at ${candUp.id} refused the request for filament_recall (HTTP ${ures.status}: ${text.slice(0, 160)}); it was sent again without it`
          : `memory: ${model} at ${candUp.id} refused the request for Filament's memory tools (HTTP ${ures.status}: ${text.slice(0, 160)}); it was sent again without them`,
      );
      const refusedWith = ures.status;
      a = await attempt(p.wireApi);
      if (a.error) {
        trail.lastError = a.error;
        log("warn", a.error.message);
        return "next";
      }
      if (a.thrown) return unreachable(a.thrown, a.p.upstream) === "return" ? "done" : "next";
      ({ p, fw } = a);
      ures = fw.res;
      const outcome = ures.ok
        ? recallAlone
          ? `memory: ${model} at ${candUp.id} answered without it — it takes no tools; Filament offers it none of its tools until this upstream's address or type changes, or a restart`
          : `memory: ${model} at ${candUp.id} answered without them — it takes no tools; Filament offers it none of memory's until this upstream's address or type changes, or a restart`
        : recallAlone
          ? `memory: ${model} at ${candUp.id} answered HTTP ${ures.status} without it too — the tool was not the cause; nothing was remembered`
          : `memory: ${model} at ${candUp.id} answered HTTP ${ures.status} without them too — the tools were not the cause; nothing was remembered`;
      if (ures.ok) toolsRefused.set(toolsRefusalKey(candUp.id, model), { status: refusedWith, at: new Date().toISOString() });
      rec.priorChanges.push(outcome);
      (rec.changes ||= []).push(outcome);
      // Still no answer on Chat Completions, as the client sent it: now it is the server's, and Responses is asked.
      if (noChat()) {
        await ures.text().catch(() => "");
        const end = await toResponses();
        if (end) return end;
      }
    }
  }
  // How much a model may write is the provider's to say, and a model nobody has told Filament about (one typed by name)
  // is asked for DEFAULT_OUTPUT_TOKENS. A refusal that states the model's ceiling is remembered for it at this upstream
  // (the model cache, until the upstream's address, type or models path changes), so every later call asks within it.
  // A call of Filament's own — a Ping, an agent's round, memory, a compaction, a harness chat's turn, whose reply room
  // Filament chose — goes again at once within it; a client's request reaches the client as it was refused.
  if (ures.status === 400 || ures.status === 422) {
    const text = (preText ??= await ures.text().catch(() => ""));
    const asked = outputAsked(p.shaped.body);
    const most = asked ? statedOutputCeiling(errorWordsOf(text).said, asked) : null;
    if (most) {
      const model = String(p.upstreamModel || ctx.requested.base);
      deps.noteOutputCeiling?.(candUp.id, model, most);
      const learned = `output: ${model} at ${candUp.id} writes at most ${most.toLocaleString("en-US")} tokens, it said refusing ${asked.toLocaleString("en-US")}; Filament asks within that from now on`;
      (rec.priorChanges ||= []).push(learned);
      log("info", `${rec.id} ${learned}`);
      if (ctx.house || ctx.pre?.api === "session") {
        fw.cleanup();
        lowerOutputTo(ctx.body, most);
        lowerOutputTo(ctx.pre?.responsesBody, most);
        a = await attempt(p.wireApi);
        if (a.error) {
          trail.lastError = a.error;
          log("warn", a.error.message);
          return "next";
        }
        if (a.thrown) return unreachable(a.thrown, a.p.upstream) === "return" ? "done" : "next";
        ({ p, fw } = a);
        ures = fw.res;
        preText = null;
        const outcome = ures.ok
          ? `output: Filament's own call went again asking ${outputAsked(p.shaped.body).toLocaleString("en-US")} tokens, and ${candUp.id} answered`
          : `output: Filament's own call went again within ${most.toLocaleString("en-US")} tokens; ${candUp.id} answered HTTP ${ures.status} to it too`;
        rec.priorChanges.push(outcome);
        (rec.changes ||= []).push(outcome);
      } else (rec.changes ||= []).push(learned);
    }
  }
  // A provider's "prompt is too long" refusal reaches the client untouched: nothing between the client and its
  // provider rewrites a request on its behalf. The person drives the fix, with `/autofit`, when they want it.
  const { upstream } = p;
  // The words a refusal said, read here once: the body read here is the one the client gets.
  if (ures.status >= 400) preText ??= await ures.text().catch(() => "");
  res.rawMode?.(!!p.passthrough); // a Responses client's proxy steps aside when the reply is already in its shape
  const { retryable } = judgeRefusal(ctx, deps, { p, ures, text: preText ?? "" });
  if (retryable && i < candidates.length - 1) {
    const text = preText ?? (await ures.text().catch(() => ""));
    fw.cleanup();
    trail.lastError = {
      status: ures.status,
      message: `upstream ${upstream.id} returned ${ures.status}: ${text.slice(0, 300)}`,
    };
    log("warn", trail.lastError.message + " -> trying next");
    trail.note(upstream.id, ures.status, text);
    return "next";
  }
  // A provider that cannot serve this entry at all (no such model here, or a refused key) is not unhealthy, but the
  // next entry in the failover order deserves its turn. Only when there is a next entry; the last one's error goes to the client.
  if (!retryable && i < candidates.length - 1 && [400, 401, 403, 404, 422].includes(ures.status)) {
    const text = preText ?? (await ures.text().catch(() => ""));
    const modelProblem =
      [401, 403, 404].includes(ures.status) ||
      /model|not[_ ]found|does not exist|unknown|unsupported|invalid[_ ](model|api[_ ]key)|deprecated/i.test(
        text,
      );
    if (modelProblem) {
      fw.cleanup();
      const why =
        ures.status === 401 || ures.status === 403
          ? "the key was refused"
          : `no such model here (HTTP ${ures.status})`;
      trail.lastError = {
        status: ures.status,
        message: `upstream ${upstream.id}: ${why}: ${text.slice(0, 300)}`,
      };
      log("warn", `${rec.id} ${trail.lastError.message} -> trying the next entry in the failover order`);
      trail.note(upstream.id, ures.status, text);
      (rec.priorChanges ||= []).push(
        `failover: ${upstream.id} cannot serve this entry (${why}); trying the next one in order`,
      );
      return "next";
    }
    preText = text; // an ordinary client error: handed to the client below, unchanged
  }
  // First-event gate: an SSE reply that says 200 but opens with an error event is a failed candidate, not a
  // reply (OpenAI-compat streams put errors inside the body — quota walls arrive this way). Catch it before
  // any byte reaches the client, hand the failure to the ordinary failover machinery, and let the cooldown
  // remember it. Applies to every SSE-speaking upstream; reads only the scanner's format knowledge.
  if (
    failover &&
    i < candidates.length - 1 &&
    ures.status === 200 &&
    ures.body &&
    (ures.headers.get("content-type") || "").includes("text/event-stream")
  ) {
    const gate = await gateSseFirstEvent(ures.body, p.passthrough ? "responses" : p.upstreamFormat || format);
    if (gate.verdict === "error") {
      const quota = /quota|credit|billing|insufficient|exhaust|112|10605/i.test(gate.error);
      const status = quota ? 429 : 502;
      // A wall said inside the stream is held as one said in its status (TG2-D54), and a model refused this account cools
      // nothing down, as one said in its status does not.
      const { type, said: words } = errorWordsOf(String(gate.error));
      const cause = providerCause({ status: null, type, said: words });
      if (cause && isWall(cause)) {
        const w = health.noteWall(upstream.id, { kind: cause.kind === "out" ? "out" : "account", said: words, status: null, resets: cause.resets });
        (rec.priorChanges ||= []).push(`health: ${wallWords(w, upstream.id)}`);
      }
      const r = health.recordFailure(upstream.id, {
        status,
        message: `error inside a 200 stream: ${gate.error}`,
        ...(cause?.kind === "model" ? { retryable: false } : {}),
      });
      rec.healthRecordedFor = upstream.id;
      if (r.cooledDown) {
        const note = `health: ${upstream.id} cooling down ${Math.round(r.waitMs / 1000)} s after an error inside its 200 stream`;
        (rec.priorChanges ||= []).push(note);
        (rec.changes ||= []).push(note);
      }
      fw.cleanup();
      trail.lastError = {
        status,
        message: `upstream ${upstream.id} opened its reply with an error: ${String(gate.error).slice(0, 300)}`,
      };
      log("warn", `${rec.id} ${trail.lastError.message} -> trying the next entry in the failover order`);
      trail.note(upstream.id, status, String(gate.error));
      return "next";
    }
    // The gate holds the reply's body whatever it kept back: a verdict that came before any byte (a provider that took
    // longer than the gate to start) left nothing kept and its read still out, and the reply is read through it all the same.
    ures = new Response(reattachSseBody(gate), {
      status: ures.status,
      headers: ures.headers,
    });
  }
  trail.servedBy(upstream.id, i);
  return { p, fw, ures, preText };
}
