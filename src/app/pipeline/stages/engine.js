// @ts-check
// The session's engine (HarnessV3 §11, Step 5 D1): the parse stage resolved the name the request carries; this stage
// re-resolves `ctx.agent` and `ctx.route` from the session's document (app/engine.js says what the engine makes of the
// request — the loop, or a team's lead on it, or on the coding agent the name reaches: `ctx.lead`, HarnessV3-ACP AC6-3)
// before the route stage builds the candidates and opens the record, which carries the note saying why.
// Only a turn on the chat's turns route is — the person's, or one Filament sends the chat for them (a wake, a routine,
// a team's result): an outside client's request goes to the model it names (the owner's rule of 10-31: a plain proxy
// plus memory), as do Filament's calls with the house key — a loop's tick, a sub-agent's run, memory's calls, and a
// coding agent's own cycle, which Filament sends on the sessions API. A turn memory leaves out is led all the same, by
// the document situate read for it (`settingsOnly`): by the loop, or by the coding agent its route goes to first.
// An own cycle of a coding agent that leads the chat's team itself is its lead's all the same (`ctx.lead`, the owner's
// of 11-09): never sent elsewhere and nothing said of it here, its team's tools reach their door (acp-turn.js).
import { agentRoute, engineFor, isTeamChat } from "../../engine.js";
import { sessionEngineOf } from "../../../services/session-settings.js";

/** @type {import("../context.js").Stage} */
export async function engine(ctx, { config, memory, teams = null }) {
  const sit = ctx.memory?.sit;
  const settings = sit ? sit.settings : ctx.memory?.settingsOnly?.settings;
  const own = !!ctx.pre?.ownCycle;
  if (!settings || (ctx.house && !own) || ctx.pre?.api !== "session" || ctx.memory.housekeeping) return "continue";
  const chosen = sessionEngineOf(settings);
  if (chosen.mode === "model") return "continue";
  // A client's compaction request is memory's to tell: a turn memory leaves out is none.
  if (sit && memory.turnIntent?.(sit) === "compaction") return "continue";
  const r = engineFor(chosen, config(), { model: ctx.body.model, agent: ctx.agent }, teams, isTeamChat(memory.archive, ctx.memory?.session?.chain));
  if (own) {
    if (r.lead) ctx.lead = r.lead;
    return "continue";
  }
  if (r.agent) {
    ctx.agent = r.agent;
    ctx.route = agentRoute(r.agent);
  }
  if (r.lead) ctx.lead = r.lead;
  if (r.note) (ctx.notes ||= []).push(r.note);
  return "continue";
}
