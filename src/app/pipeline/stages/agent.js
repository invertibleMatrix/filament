// @ts-check
// The model name is `agent/<model>`: the request is one turn of the agent loop (the hands, ask, plan, delegated reads;
// pause-and-resume) — every turn of the harness's, the pipeline wrapping the plain route a session names, and a call of
// Filament's own that names the loop (a sub-agent's).
import { recordCueOf } from "../dispatch/memory-loop.js";
import { compactionStamp } from "./composed.js";
import { turnMemState } from "./situate.js";

/**
 * The sessions service's hand for room in the whole chat (HarnessV4_Tasks C33), as the loop's turn takes it: the
 * compaction it makes joins the turn's record (`view.compactions`) after the one made at the turn's line, so the page
 * finds both rows as the turn ends.
 * @param {NonNullable<import("../context.js").PreParsed["earlier"]>} asked @param {any} rec
 * @returns {NonNullable<import("../context.js").PreParsed["earlier"]>}
 */
const earlierOn = (asked, rec) => async () => {
  const r = await asked();
  if ("history" in r) rec.view = { ...(rec.view || {}), compactions: [...(rec.view?.compactions || []), compactionStamp(r)] };
  return r;
};

/**
 * @param {{ turn: (args: any) => Promise<void> }} agentLoop  the agent loop's turn handler
 * @returns {import("../context.js").Stage}
 */
export const agent =
  (agentLoop) =>
  async (ctx, { config }) => {
    const { res, format, body, rec, headers } = ctx;
    if (!ctx.agent) return "continue";
    // The cue rides the record as data (Facade D5) wherever the turn ends up: the dispatched legs stamp it in their
    // memory loop, the loop's turn here — a composed request never gets the sentence, but the data rides all the same.
    const cue = recordCueOf(ctx.memory, config());
    if (cue) rec.memory = { ...(rec.memory || {}), cue };
    // What the stages before noted open the turn's record, as they open a dispatched request's (attempt.js).
    if (rec.priorChanges?.length) rec.changes = [...rec.priorChanges, ...(rec.changes || [])];
    await agentLoop.turn({
      agent: ctx.agent,
      format,
      body,
      rec,
      res,
      inboundHeaders: headers,
      clientAbort: ctx.client.abort,
      // Memory left the request out or did not prepare it: no memory state, but the session's settings all the same,
      // and the session its own tools ride — with whether memory keeps no row of the turn.
      memState: turnMemState(ctx.memory),
      // Only a harness session's own turn, asked for by its page (R3): a front-door reply stays byte for byte.
      runEvents: ctx.pre?.api === "session" && ctx.pre?.runEvents === true,
      // A session's own turn can make room in the whole chat while it runs (HarnessV4_Tasks C33).
      earlier: ctx.pre?.api === "session" && ctx.pre.earlier ? earlierOn(ctx.pre.earlier, rec) : null,
      // …and weighs its conversation by what the composition weighed of it.
      weights: ctx.pre?.api === "session" ? ctx.pre.weights ?? null : null,
      // What the loop is handed as the session moved to it from a coding agent (sessions/reattach.js `handoverFor`).
      handover: ctx.pre?.api === "session" ? ctx.pre.handover ?? null : null,
    });
    return "replied";
  };
