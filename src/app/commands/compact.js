// @ts-check
// `/compact` typed in a chat Filament runs: Compact now, by the session's own way, inside the command's own turn,
// which is no reason to refuse it (HarnessV3-Launch RD-D4). Answered before any candidate is chosen, so it never
// reaches a model. A coding agent's chat has its own `/compact` (commands/acp.js); an outside client's goes to its
// model as typed.
import { localReply } from "../../core/wire/local-reply.js";
import { jsonToSse } from "../../core/wire/sse.js";
import { sendJson, sseHead } from "../pipeline/respond.js";
import { commandSit, openCommandRecord } from "./answer.js";

/**
 * Whether the chat-command stage answers `/compact` for this request: its session, as situate found it — memory
 * situating the turn or leaving it out — is one Filament composes, and its primary is no coding agent.
 * @param {import("../pipeline/context.js").RequestContext} ctx @param {import("../deps.js").AppDeps} deps
 * @param {boolean} agentPrimary  the request's primary upstream is a coding agent
 */
export const answersCompact = (ctx, deps, agentPrimary) => !!(ctx.memory?.session?.composed && deps.sessions && !agentPrimary);

/**
 * @param {import("../pipeline/context.js").RequestContext} ctx
 * @param {import("../deps.js").AppDeps} deps
 * @param {{ raw: string, rest: string }} cmd  from `parseCompactCommand`
 */
export async function answerCompactCommand(ctx, deps, cmd) {
  const { usage, memory, finish, sessions } = deps;
  const { res, format, body } = ctx;
  const sit = ctx.memory.sit;
  // The session `answersCompact` found Filament composes.
  const chainId = /** @type {{ chain: string }} */ (ctx.memory.session).chain;
  const rec = openCommandRecord(ctx, deps, { upstream: ctx.route.upstream, cwd: true });
  // A summary takes a model call, or slices of them: a streaming caller gets the head first and a heartbeat, so it and
  // any proxy in between do not idle out.
  /** @type {NodeJS.Timeout | null} */
  let ping = null;
  if (body.stream === true && !res.headersSent) {
    try {
      res.writeHead(200, sseHead({ "x-filament-request-id": rec.id }));
      ping = setInterval(() => {
        try {
          if (!res.writableEnded) res.write(": compacting\n\n");
        } catch {}
      }, 15000);
      ping.unref?.();
    } catch {}
  }
  let text;
  try {
    const r = await /** @type {any} */ (sessions).compact(chainId, { within: res });
    const untold = cmd.rest ? " Filament's compaction takes no instructions: what you asked it to keep was not passed on." : "";
    text = `/compact — ${r.note}. Undo is on its row until you send.${untold}`;
  } catch (/** @type {any} */ e) {
    text = `/compact did not compact the session — ${e?.message || e}.`;
  }
  if (ping) clearInterval(ping);
  rec.memory = { chain: chainId, command: true, client: sit?.client };
  const msg = localReply(format, { model: body.model, text, now: Date.now() });
  usage.firstByte(rec);
  if (body.stream === true) {
    if (!res.writableEnded) res.end(jsonToSse(format, msg));
    else if (!res.headersSent) sendJson(res, 200, msg, { "x-filament-request-id": rec.id });
  } else sendJson(res, 200, msg, { "x-filament-request-id": rec.id });
  // The exchange is a turn of the transcript, as every other command answer is — a chat Memory settings leave out
  // keeping its turns too (`commandSit`).
  const kept = commandSit(ctx);
  const t = kept ? memory?.recordCommandTurn?.(kept, { requestId: rec.id, model: body.model, userText: kept.newest || cmd.raw, answerText: text, card: null }) : null;
  if (t) rec.memory = { ...rec.memory, turn: t.n, turnId: t.turnId };
  // The compaction's own calls are billed on their own records, so this one carries no cost.
  finish(rec, { status: "ok", httpStatus: 200, tokens: { ...rec.tokens, output: 0 }, cost: 0, local: true, changes: ["/compact answered by Filament; no model was called for the command itself"] });
}
