// @ts-check
// What every locally answered chat command shares: a record of its own (opened like a model request, closed with no
// tokens and no cost) and the reply written whole in the client's format.
import { localReply } from "../../core/wire/local-reply.js";
import { clientConversationId } from "../../core/conversation.js";
import { cardProblem } from "../../core/cards.js";
import { replyLocally } from "../pipeline/respond.js";
import { newestUserText } from "../../adapters/agents/client-bridge.js";
import { createAgentReply } from "../acp-wire.js";

/** @typedef {import("../deps.js").AppDeps} AppDeps */
/** @typedef {import("../pipeline/context.js").RequestContext} RequestContext */

/**
 * Opens the record a command's answer is billed on (as a request, not as tokens).
 * @param {RequestContext} ctx
 * @param {AppDeps} deps
 * @param {{ upstream: string, trace?: boolean, cwd?: boolean }} opts
 *   `trace`: attach memory's trace to the record · `cwd`: copy the client's folder header onto it
 */
export function openCommandRecord(ctx, { usage }, { upstream, trace = true, cwd = false }) {
  const { req, format, body, route, headers } = ctx;
  const rec = usage.start({
    format,
    model: body.model,
    route: route.match,
    upstream,
    upstreamModel: null,
    stream: body.stream === true,
    clientIp: req.socket.remoteAddress,
    ua: headers["user-agent"] || "",
  });
  if (trace) ctx.memory.traceOn(rec);
  rec.clientSession = clientConversationId(headers) || undefined;
  if (cwd && headers["x-filament-cwd"]) rec.cwd = String(headers["x-filament-cwd"]).slice(0, 400);
  return rec;
}

/**
 * The session a chat command acts on: the one situate found for the request (`ctx.memory.session`) — a harness turn's
 * own, memory situating the turn or leaving it out — else, for a conversation memory situated that has no session yet,
 * the one the creator makes now (D6), born as any other. Null where there is none: no archive, or no session to name.
 * @param {RequestContext} ctx
 * @param {AppDeps} deps
 * @returns {string | null}
 */
export function commandChain(ctx, { memory }) {
  const { session, sit } = ctx.memory;
  return session?.chain || (sit ? memory.chainFor?.(sit)?.id || null : null);
}

/**
 * The card attach rule (Facade D4), one owner for every local answer: a validated card goes on the record and is
 * named by the `x-filament-card` header; a card the validator refuses is logged and dropped — the answer goes out
 * as text alone. Returns the validated card, or null.
 * @param {AppDeps} deps
 * @param {any} rec
 * @param {any} res
 * @param {any} card
 * @returns {any | null}
 */
export function attachCard(deps, rec, res, card) {
  if (!card) return null;
  const problem = cardProblem(card);
  if (problem) {
    deps?.log?.("warn", `${rec.id}: a ${card.kind || "card"} was refused by the validator (${problem}); the answer goes out as text`);
    return null;
  }
  rec.card = card;
  try {
    res.setHeader("x-filament-card", String(card.kind));
  } catch {}
  return card;
}

/**
 * The answer, delivered and recorded: streamed or JSON as the client asked, output tokens 0, cost 0. A validated
 * card rides beside the text (Facade D4): on the record, on the command turn, and named by the `x-filament-card`
 * header the harness reads. A card the validator refuses is logged and never attached — the answer goes out as
 * text alone. Outside clients get exactly the text; they ignore the header.
 * @param {RequestContext} ctx
 * @param {AppDeps} deps
 * @param {any} rec
 * @param {string} text
 * @param {{ changes?: string[], local?: boolean, card?: any }} [opts]  `local` marks the record as answered by Filament
 */
export function answerWith(ctx, deps, rec, text, { changes = [], local = false, card = null } = {}) {
  const { res, format, body } = ctx;
  card = attachCard(deps, rec, res, card);
  const msg = localReply(format, { model: body.model, text, now: Date.now() });
  deps.usage.firstByte(rec);
  recordLocalText(ctx, deps, text);
  replyLocally(res, { format, stream: body.stream === true, requestId: rec.id, msg });
  closeAnswer(ctx, deps, rec, text, { changes, local, card });
}

/**
 * An answer that takes a while — a command that waits on work (`/subagent wait`): a streaming client's reply opens at
 * once and carries heartbeats until the text is ready, so the client's socket never idles out; a JSON client gets the
 * whole reply at the end. Recorded as `answerWith` records, with no card.
 * @param {RequestContext} ctx
 * @param {AppDeps} deps
 * @param {any} rec
 * @param {() => Promise<string>} work  the text, when it is ready (a failure is said as the answer)
 * @param {{ changes?: string[], local?: boolean, noLocalText?: boolean }} [opts]
 */
export async function answerAfter(ctx, deps, rec, work, { changes = [], local = false, noLocalText = false } = {}) {
  const { res, format, body } = ctx;
  const stream = body.stream === true;
  const reply = createAgentReply({ res, format, model: body.model, requestId: rec.id, upstreamId: "filament", stream, heartbeatMs: deps.agentHeartbeatMs, pacingMs: 0, onFirstByte: () => deps.usage.firstByte(rec), idPrefix: "filament" });
  let text;
  try {
    text = await work();
  } catch (/** @type {any} */ e) {
    text = `(Filament: this failed — ${String(e?.message || e).slice(0, 300)})`;
  }
  if (!noLocalText) recordLocalText(ctx, deps, text);
  const usageObj = { input_tokens: 0, output_tokens: 0 };
  const stop = format === "anthropic" ? "end_turn" : "stop";
  if (stream) {
    reply.streamText(text);
    await reply.flushPaced();
    reply.endStream(stop, usageObj);
  } else reply.sendBlocks([{ type: "text", text }], stop, usageObj);
  closeAnswer(ctx, deps, rec, text, { changes, local, card: null });
}

/**
 * Filament's own text (D11): recorded for the session, so the next request of an outside client leaves the whole
 * exchange out of what the model sees. The client keeps showing it; the archive stays clean (the turn, if any,
 * records the same text once). A sub-agent's report a client waited for opts out (`answerAfter`'s `noLocalText`): it
 * stays in the conversation.
 * @param {RequestContext} ctx @param {AppDeps} deps @param {string} text
 */
function recordLocalText(ctx, { memory }, text) {
  const sit = ctx.memory?.sit;
  const chainId = sit?.chainRef || (sit ? memory?.lookupChainId?.(sit) : null);
  if (chainId) memory?.recordLocalText?.(chainId, "reply", text);
}

/**
 * The situation a command's turn is recorded by (memory's `recordCommandTurn`): memory's, or the session turn's of a
 * chat Memory settings leave out (`kept`), which keeps its turns all the same. Null where neither is.
 * @param {RequestContext} ctx
 */
export const commandSit = (ctx) => ctx.memory?.sit || ctx.memory?.kept || null;

/**
 * After the reply went out: in a native session the exchange is a turn of the transcript too (the reload would
 * otherwise lose it), the card on the turn's meta (Facade D4) so a reloaded harness draws it again; then the record
 * closes with no tokens and no cost.
 * @param {RequestContext} ctx @param {AppDeps} deps @param {any} rec @param {string} text
 * @param {{ changes: string[], local: boolean, card: any }} o
 */
function closeAnswer(ctx, { memory, finish, config }, rec, text, { changes, local, card }) {
  const { format, body } = ctx;
  const sit = commandSit(ctx);
  if (sit?.chainRef && memory?.recordCommandTurn) {
    const userText = sit.newest || newestUserText(format, body);
    const t = memory.recordCommandTurn(sit, { requestId: rec.id, model: body.model, userText, answerText: text, card });
    if (t) rec.memory = { ...(rec.memory || {}), chain: sit.chainRef, turn: t.n, turnId: t.turnId, command: true };
  }
  finish(
    rec,
    {
      status: "ok",
      httpStatus: 200,
      tokens: { ...rec.tokens, output: 0 },
      cost: 0,
      ...(local ? { local: true } : {}),
      changes,
    },
  );
}
