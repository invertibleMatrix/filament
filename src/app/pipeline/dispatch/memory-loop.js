// @ts-check
// Memory around one upstream reply: the tool loop (the model asked memory → Filament answers and asks the same
// upstream again, withheld from the client), the cue placed in front of the reply, the after-reply bookkeeping that
// archives the turn, and the warning when a compaction summary was cut at the output cap.
import { appendFollowUp, ourCalls, memoryToolCtx, runMemoryTools, deferMemoryResults, shortToolName, isMemoryTool, isRecallTool, MEMORY_TOOLS_OFF, memoryUnavailable } from "../../memory-tools.js";
import { cueText } from "../../../services/memory/brain.js";
import { withheldStoreFor } from "../../../services/memory/withheld-store.js";
import { callWaits } from "../../../services/call-waits.js";
import { judgeUnreachable } from "./attempt.js";
import { requestWasAborted } from "../../../services/health.js";
import { judgeRefusal } from "./verdict.js";
import { providerMeta } from "../../../core/wire/upstream-headers.js";

/** @typedef {import("../context.js").RequestContext} RequestContext */
/** @typedef {import("../../deps.js").AppDeps} AppDeps */
/** @typedef {import("./reply.js").ReplyContext} ReplyContext */
/**
 * How a memory follow-up came back: its reply (`res`); or none — the client gone (it hung up, or a stop ended its
 * request, `ctx.client.abort`) or the call aborted on its way, which the reply paths end aborted, never as a failure, as
 * a first attempt so aborted is (attempt.js `unreachable`); the provider's refusal, its
 * status, its words and its reply for the head; or a failure no provider answered, said as a first attempt's is (the
 * failover trail's `lastError`): the provider out of reach, or Filament unable to make the request at all.
 * @typedef {{ res: Response } | { gone: true } | { refused: { status: number, text: string, res: Response } }
 *   | { failed: { status: number, message: string, upstream?: string, retryable?: boolean } }} FollowUp
 */

/**
 * The cue that rides a record as data (Facade D5) — one rule for the dispatched legs and the agent loop's turn,
 * which never builds a memory loop of its own: memory on (not muted, not quiet), the brain returned a cue, and the
 * autopilot's switch on. @param {any} memState @param {any} cfg
 */
export const recordCueOf = (memState, cfg) =>
  !!memState?.prep && !memState.prep.muted && !memState.prep.quiet && !!memState.prep.cue && cfg.memory?.autopilot?.cue !== false
    ? memState.prep.cue
    : null;

/**
 * Whether the client asked for a structured reply — JSON mode or a JSON schema, in Chat Completions' `response_format`,
 * the Responses API's `text.format` (its own body, kept beside the translated one) or Anthropic's `output_config.format`:
 * a reply that must parse, which Filament never puts a line in front of (HarnessV3-AtHome AH-D1).
 * @param {any} body @param {any} [responsesBody]
 */
export const asksForStructuredReply = (body, responsesBody = null) =>
  [body?.response_format?.type, body?.text?.format?.type, responsesBody?.text?.format?.type, body?.output_config?.format?.type].some(
    (t) => t === "json_object" || t === "json_schema",
  );

/**
 * @param {RequestContext} ctx
 * @param {AppDeps} deps
 * @param {ReplyContext} rc
 */
export function createMemoryLoop(ctx, deps, rc) {
  const { config, log, ops, memory } = deps;
  const cfg = config();
  const { format, body, pre, rec } = ctx;
  const { trace } = ctx.memory;
  const { p, memState, upFmt, wireResp } = rc;
  // Tools and capture are gated separately (2026-09-19 cache audit): muted and client-muted (quiet) requests still
  // carry the five tools so the prompt's tools section stays byte-stable, so the interceptor must run for them — but
  // nothing is learned or recorded for those requests. The recall tool (HarnessV2 §6.4), on every request of a chat
  // Filament runs, goes through the same loop whether or not memory's own tools ride. So does a request memory could not
  // read that carries memory's tools as every request of its chat does (`down`, memory-prepare.js, t420): a call of
  // theirs is answered that memory is unavailable.
  const down = ctx.memory?.down || null;
  // A missed request whose filament_recall rides on the chat it names (`standIn`, memory-prepare.js) stands in that chat:
  // its calls read that chat's record, and what a reply cannot carry waits where a working request's would.
  const standIn = ctx.memory?.standIn ? { ...(memState?.prep || {}), ...ctx.memory.standIn } : memState?.prep ?? null;
  const memTools = !!memState?.prep?.tools || (!!ctx.flags.recallTool && !!standIn) || !!down;
  const memOn = !!memState?.prep && !memState.prep.muted && !memState.prep.quiet;
  // The reply is archived on its turn (`memAfter`) wherever memory's prepare opened one — a muted chat's too, whose turns
  // are recorded all the same — whatever memory does besides (`memOn`).
  const keepsTurn = memOn || !!memState?.prep?.turn;
  const memCtx = memTools ? memoryToolCtx(memory, memState?.sit ?? null, standIn) : null;
  const maxRounds = Math.max(0, Number(cfg.memory?.autopilot?.toolIterations ?? 4));
  let memRounds = 0;
  /** @type {string[]} */
  const memCallNames = [];
  // BUG-11: what the client is not shown — the messages each follow-up appended (the model's memory call, Filament's
  // results), and the visible blocks of the rounds before the last — recorded when the reply ends, so the merged
  // message the client sends back goes upstream as the model's true sequence (see core/withheld.js).
  // `last`: where the newest round's own part starts — a follow-up that never came back leaves that round answered
  // but unanswered by the model, and the exchange is put back up to it (BUG-11b).
  const withheld = { prefix: /** @type {any[]} */ ([]), head: /** @type {any[]} */ ([]), off: false, last: /** @type {{ prefix: number, head: number } | null} */ (null) };
  /** The blocks the client is shown of one round: everything but memory's own calls. @param {any} g */
  const visibleOf = (g) => (Array.isArray(g?.blocks) ? g.blocks : []).filter((/** @type {any} */ b) => !(b?.type === "tool_use" && isMemoryTool(b.name)));
  // The cue is DATA (Facade D5): the brain returns { items, sessions }, `rec.memory.cue` keeps it (the turn's
  // facts carry it — the harness draws the memory note from there), and the SENTENCE any client sees is
  // `cueText`'s, computed once here. A composed request (the harness's own) never gets the sentence placed in
  // front of the reply and never records it — the note is drawn from the facts instead — but it still carries the
  // data on its record. Memory is on for everyone (HarnessV3-AtHome AH-D1), so the sentence goes only where it means
  // something and breaks nothing: a request working in a folder (without one, "earlier sessions here" has no here, and
  // that is the shape an app's request takes) that asked for no structured reply.
  const composed = pre?.api === "session";
  const structured = asksForStructuredReply(body, pre?.responsesBody);
  const memCue = recordCueOf(memState, cfg);
  const memCueSentence = memCue && !composed && !!memState?.sit?.project?.cwd && !structured ? cueText(memCue) || null : null;
  // The data rides the record whatever the client is (the turn's facts carry `related` from it); the sentence's
  // placement bookkeeping is `noteCue`'s, called by the reply paths when the sentence actually went in front.
  if (memCue) rec.memory = { ...(rec.memory || {}), cue: memCue };
  const noteCue = () => {
    if (!memCueSentence) return;
    // The cue is Filament's own text placed in front of the reply (Step 2 D11): recorded as a prefix, so the next
    // request strips it from the history instead of feeding it back to the model forever.
    {
      const chainId = memState?.sit?.chainRef || (memState?.sit ? memory.lookupChainId?.(memState.sit) : null);
      if (chainId) memory.recordLocalText?.(chainId, "prefix", memCueSentence);
    }
    (rec.changes ||= []).push(
      "memory: a one-line cue about related sessions was put in front of the reply",
    );
    rec.memory.cuePlaced = true; // the explain pane reads the flag — the page never parses change strings
    trace?.step("cue placed", { note: "one line about related sessions in front of the reply" });
  };
  const finalMessageOf = (fmt, j) => {
    if (!j) return null;
    if (fmt === "anthropic") return j.content ? { role: "assistant", content: j.content } : null;
    if (fmt === "responses") return j.output ? { role: "assistant", content: j.output } : null;
    return j.choices?.[0]?.message ? { role: "assistant", ...j.choices[0].message } : null;
  };
  const replyTextOf = (fmt, j) => {
    if (!j) return "";
    if (fmt === "anthropic")
      return (j.content || [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
    if (fmt === "responses")
      return (j.output || [])
        .flatMap((it) =>
          it.type === "message"
            ? (it.content || []).filter((c) => c.type === "output_text").map((c) => c.text)
            : [],
        )
        .join("");
    return typeof j.choices?.[0]?.message?.content === "string" ? j.choices[0].message.content : "";
  };
  /** Archives the turn and scores what was injected; says on the record when the model used the memory tools. */
  const memAfter = (fmt, j) => {
    // A request memory could not read that answered memory's calls says its rounds all the same (`down`).
    if (!memState?.prep) return noteToolRounds();
    try {
      memory.afterReply({
        chainId: memState.prep.chain,
        turnId: memState.prep.turn,
        requestId: rec.id,
        finalMessage: finalMessageOf(fmt, j),
        // A tool-loop leg carries the loop so far (HarnessV2 F6): it becomes the turn's work, the reply its final.
        workMessages: Array.isArray(memState.prep.legWork) ? memState.prep.legWork : [],
        replyText: replyTextOf(fmt, j),
        outputChars: replyTextOf(fmt, j).length,
        injectedIds: memState.prep.ids || [],
        compaction: memState.prep.compaction || null,
        trace,
      });
    } catch (/** @type {any} */ e) {
      log("warn", `${rec.id} memory bookkeeping failed: ${e.message}`);
    }
    noteToolRounds();
  };
  /** The tool rounds on the record — also for a quiet request (a loop's tick), whose reply is not archived here. */
  let noted = false;
  const noteToolRounds = () => {
    if (!memRounds || noted) return;
    noted = true;
    const recalls = memCallNames.filter((n) => n === "recall").length;
    rec.memory = { ...(rec.memory || {}), toolRounds: memRounds, toolCalls: memCallNames.length, ...(recalls ? { recalls } : {}) };
    (rec.changes ||= []).push(
      recalls === memCallNames.length
        ? `context: the model brought ${recalls} archived turn${recalls === 1 ? "" : "s"} or result${recalls === 1 ? "" : "s"} back through filament_recall in ${memRounds} extra round${memRounds === 1 ? "" : "s"} before answering`
        : `memory: the model used memory tools (${[...new Set(memCallNames)].join(", ")}) in ${memRounds} extra round${memRounds === 1 ? "" : "s"} before answering`,
    );
  };
  // A compaction reply that stopped at the output cap is a summary cut mid-sentence, and the client adopts it as
  // its whole context (seen 2026-09-19: 20,000 output tokens, the resumed session's summary ended mid-word, nothing
  // said so). Named on the record and as a warning operation.
  const noteCompactionCut = (stop, usage) => {
    const { askedToCompact } = ctx.flags;
    // Memory's prepare pass names the chain; one that stopped early (a muted chain, the client's summary probe) did not.
    const sit = ctx.memory?.sit || null;
    const chain = ctx.memory?.prep?.chain || (sit ? sit.chainRef || memory.lookupChainId?.(sit) || null : null);
    if (!askedToCompact || !/^(max_tokens|length|max_output_tokens|incomplete)$/.test(String(stop || "")))
      return;
    const out = Number(usage?.output) || 0;
    rec.compactionCut = { stop: String(stop), outputTokens: out };
    (rec.changes ||= []).push(
      `compaction: the model's summary stopped at the output cap (${stop}${out ? `, ${out.toLocaleString()} tokens` : ""}) — the client adopted a summary cut mid-sentence; raise the client's max_tokens for compaction`,
    );
    try {
      ops.record(
        "compaction",
        `the client's compaction summary was cut at the output cap (${out ? `${out.toLocaleString()} tokens` : stop})`,
        {
          sub: "client-cut",
          level: "warn",
          detail: {
            stop: String(stop),
            outputTokens: out,
            model: body.model,
            chain,
          },
          ref: { requestId: rec.id, chainId: chain },
        },
      );
    } catch {}
  };
  // The calls Filament ran, told to the code that made the request where it is Filament's own (`x-filament-call`): an
  // agent loop's tick, whose chat shows each as its call (the owner's of 10-29). The client is never handed them.
  const callId = String(ctx.headers?.["x-filament-call"] || "");
  /** @param {any[]} calls @param {any[] | null} results  `runMemoryTools`' */
  const tellCalls = (calls, results) => {
    if (!callId || !results) return;
    for (const r of results) {
      const c = calls.find((x) => x.id === r.id);
      const output = String(r.output ?? "");
      callWaits.memory(callId, { id: String(r.id ?? ""), name: String(r.name || ""), input: c?.input ?? {}, output, ok: !/^\{"error":/.test(output), ms: Number(r.ms) || 0 });
    }
  };
  // Memory's own tools run only where they were offered: a request that carries the recall tool alone answers a call of
  // theirs as not run, as the agent loop answers one where none of memory's tools ride (the owner's of 10-28) — the
  // recall tool's presence never switches them on. On a request memory could not read (`down`) they are said unavailable.
  const toolsOn = !!memState?.prep?.tools;
  const notRun = down ? memoryUnavailable() : MEMORY_TOOLS_OFF;
  /** @param {any[]} calls */
  const runOurs = async (calls) => {
    const ran = await runMemoryTools(calls.filter((c) => toolsOn || isRecallTool(c.name)), memCtx);
    return calls.map((c) => ran.find((r) => r.id === c.id) || { id: c.id, callId: c.callId, name: c.name, output: JSON.stringify({ error: notRun }), ms: 0 });
  };
  /**
   * A reply's memory calls run now, their results riding the session's next request (`deferMemoryResults`): beside the
   * client's tools (`mixed`), or past the round limit (`limit`).
   * @param {any[]} calls @param {"mixed" | "limit"} because
   */
  const deferRun = async (calls, because) => tellCalls(calls, await deferMemoryResults(calls, memCtx, { run: runOurs, because }));
  /** Every round's calls and what they returned (`runRound`), in their order. @type {{ calls: any[], results: any[] }[]} */
  const answered = [];
  /**
   * Every round's results riding the session's next request (`deferMemoryResults`), as each round got them: a reply that
   * failed after them, or ended with its client gone (`because`), handed the model's answer to none of them, its calls ran
   * and are told then, and a call already run — a writer among them — is never run, nor told, again.
   * @param {"failed" | "gone"} [because]
   */
  const deferAnswered = async (because = "failed") => {
    if (!answered.length) return;
    // Each round's own, under its round: a provider that names each reply's calls afresh (`call_0`) names a later round's
    // as an earlier one's.
    const calls = answered.flatMap((a, k) => a.calls.map((c) => ({ ...c, round: k + 1 })));
    const results = answered.flatMap((a, k) => a.results.map((r) => ({ ...r, round: k + 1 })));
    await deferMemoryResults(calls, memCtx, { run: async () => results, because });
  };
  // The model asked memory: run the calls, append the exchange to the outbound body, ask the same upstream again.
  const runRound = async (generic, responseId) => {
    const t = performance.now();
    const calls = ourCalls(generic);
    trace?.step("the model asked memory", {
      round: memRounds + 1,
      calls: calls.map((c) => shortToolName(c.name)).join(", "),
      note: "withheld from the client; Filament answers and asks the upstream again",
    });
    const results = await runOurs(calls);
    answered.push({ calls, results });
    trace?.toolRound(calls.length, performance.now() - t);
    tellCalls(calls, results);
    memCallNames.push(...calls.map((c) => shortToolName(c.name)));
    const before = Array.isArray(body?.messages) ? body.messages.length : -1;
    withheld.last = { prefix: withheld.prefix.length, head: withheld.head.length };
    appendFollowUp({
      format: p.passthrough ? "responses" : format,
      body,
      responsesBody: pre?.responsesBody || null,
      passthrough: p.passthrough,
      generic,
      results,
      sameFormat: upFmt === format && !wireResp,
      responseId,
    });
    // A Responses passthrough continues by previous_response_id (the provider keeps the exchange): nothing to record.
    if (p.passthrough || before < 0 || !Array.isArray(body?.messages)) withheld.off = true;
    else withheld.prefix.push(...structuredClone(body.messages.slice(before)));
    withheld.head.push(...visibleOf(generic));
    memRounds++;
  };
  /**
   * The reply ended after memory rounds: record the withheld exchange (BUG-11) — when the last round came back whole,
   * and also when it stopped at the round limit or a follow-up failed (BUG-11b): the client was shown a merged
   * message all the same. `answered`: the last round's memory calls were answered and its follow-up never came back,
   * so the true sequence ends at the round before it, and the last round goes back as the client saw it. Never fails
   * the reply — an exchange that cannot be recorded goes back merged.
   * @param {any} finalGeneric  the last round's reply, parseReply-shaped @param {{ answered?: boolean }} [o]
   */
  const finishWithheld = (finalGeneric, { answered = false } = {}) => {
    if (!memRounds || withheld.off) return;
    if (format !== "anthropic" && format !== "openai") return;
    const cut = answered && withheld.last ? withheld.last : null;
    const prefix = cut ? withheld.prefix.slice(0, cut.prefix) : withheld.prefix;
    const head = cut ? withheld.head.slice(0, cut.head) : withheld.head;
    if (!prefix.length) return;
    try {
      const store = withheldStoreFor(/** @type {any} */ (memory).archive);
      if (!store) return;
      // The line Filament may place in front of the reply: the match takes it off the client's copy (BUG-11a).
      const lead = memCueSentence ? [memCueSentence] : [];
      const ok = store.put({ format, prefix, head, final: visibleOf(finalGeneric), rounds: cut ? memRounds - 1 : memRounds, lead });
      trace?.step(ok ? "memory exchange recorded" : "memory exchange not recorded", {
        rounds: memRounds,
        note: ok
          ? "the client's next request carries the model's true sequence upstream"
          : "nothing to find it by (no tool call, no signed thinking), or a message too large to keep whole",
      });
    } catch (/** @type {any} */ e) {
      log("warn", `${rec.id} memory exchange not recorded: ${e.message}`);
    }
  };
  /**
   * The same upstream asked again with the tool results appended. A provider out of reach is judged as for a first attempt
   * (attempt.js `judgeUnreachable`), and one that refused goes through a first attempt's verdict (verdict.js
   * `judgeRefusal`), the status it refused with left to the record's close, which judges a status no retry serves as it
   * judges a first attempt's (finish.js).
   * @returns {Promise<FollowUp>}
   */
  const followUp = async () => {
    const t = performance.now();
    // Release this round's concurrency slot BEFORE acquiring the next, or a lane of one slot queues behind
    // itself for 120 s on every memory-tool follow-up (W7 P1).
    rc.fw.cleanup();
    const a2 = await rc.attempt(p.wireApi);
    if (!("fw" in a2)) {
      // A client gone — it hung up, or a stop ended its request — or a call aborted on its way is read as a first attempt's
      // is (attempt.js `unreachable`, health.js `requestWasAborted`): Filament's own end of the request, never the
      // provider's failure.
      const gone = requestWasAborted("thrown" in a2 ? a2.thrown : null, ctx.client.abort);
      const why = gone ? "client disconnected" : "error" in a2 ? a2.error.message : a2.thrown?.message;
      if (gone) log("info", `${rec.id} client disconnected during the memory follow-up`);
      else log("warn", `${rec.id} memory follow-up failed: ${why}`);
      trace?.step("follow-up request failed", {
        ms: Math.round(performance.now() - t),
        error: String(why || "").slice(0, 160),
      });
      if (gone) return { gone: true };
      if ("error" in a2) {
        // Filament could not make the request (its plan failed: the upstream gone from the config, say). It reached no
        // provider, and says nothing of one's health, as a first attempt that never went judges none.
        rec.healthRecordedFor = rec.upstream;
        return { failed: a2.error };
      }
      const { failure, note } = judgeUnreachable(deps, rec, a2.thrown, a2.p.upstream);
      if (note) (rec.changes ||= []).push(note);
      return { failed: failure };
    }
    if (a2.fw.res.status !== 200) {
      const refused = { status: a2.fw.res.status, text: await a2.fw.res.text().catch(() => ""), res: a2.fw.res };
      // Judged as a first attempt's refusal is (verdict.js), its slot still held — a 429 counts it among the model's
      // calls in flight — and its record keeps what the refusal's head said of the provider, as a first attempt's does.
      judgeRefusal(ctx, deps, { p: a2.p, ures: a2.fw.res, text: refused.text });
      rec.providerMeta = providerMeta(a2.fw.res);
      a2.fw.cleanup();
      log("warn", `${rec.id} memory follow-up got HTTP ${a2.fw.res.status}`);
      trace?.step("follow-up request failed", {
        ms: Math.round(performance.now() - t),
        status: a2.fw.res.status,
      });
      return { refused };
    }
    rc.fw = a2.fw;
    trace?.step("upstream asked again with the results", {
      ms: Math.round(performance.now() - t),
      note: "time until the follow-up reply started",
    });
    return { res: a2.fw.res };
  };
  return {
    memTools,
    keepsTurn,
    memCtx,
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
  };
}
