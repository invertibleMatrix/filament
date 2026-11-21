// @ts-check
// What an outside client's request carries, stamped on its record as the client sent it: the history's weight, its
// turns and its composition — characters by class — measured where the body is final, after memory's prepare pass
// (which archived the raw turn and attached its blocks) and before the context stamp. Filament sends a client's history
// as it came. A native session's turn is stamped by the `composed` stage with the composer's own report. Agents keep
// their own history, and /v1/responses bodies are rebuilt from `pre.responsesBody`, so neither is measured here.
// Filament's own calls (a summary's slice, the learner, the assistant) are one-turn prompts, not conversations: never
// stamped.
import { composition } from "../../../core/fold.js";
import { segmentTurns } from "../../../core/turns.js";

/** @type {import("../context.js").Stage} */
export async function view(ctx, { log }) {
  const { format, body, pre, rec } = ctx;
  if (
    ctx.flags.memAgent ||
    ctx.flags.internalCall ||
    pre?.responsesBody ||
    pre?.api === "session" ||
    !Array.isArray(body.messages) ||
    !body.messages.length
  )
    return "continue";
  try {
    const historyChars = JSON.stringify(body.messages).length;
    const tokens = Math.ceil(historyChars / 4);
    const turns = segmentTurns(body.messages, format).groups.filter((g) => !g.prologue).length;
    rec.view = {
      historyChars,
      historyTokens: tokens,
      sentTokens: tokens,
      totalTurns: turns,
      rawTurns: turns,
      composition: composition(body.messages, format, { system: body.system, tools: body.tools }),
    };
  } catch (/** @type {any} */ e) {
    log("warn", `${rec.id} view: ${e.message.slice(0, 160)}`);
  }
  return "continue";
}
