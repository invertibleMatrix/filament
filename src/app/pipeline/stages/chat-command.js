// @ts-check
// A chat command typed as the newest message is answered by Filament on a record of its own, and the request stops
// here: `@mem …` in any chat memory situated, memory on or off, and in a chat Filament composes that Memory settings
// leave out, in their words; `/goal …` in any chat; and in a chat Filament runs,
// `/subagent …`, `/set …`, `/team …`, `/graph`, `/autofit …`, `/compact`, and for API models `/status`,
// `/cost`, `/help` — on the session situate found, memory situating the turn or leaving it out (commands/answer.js
// `commandChain`). An outside client's chat is a plain proxy with memory: its other commands go on as typed, to its
// model or its coding agent. In a harness chat with a coding agent, the agent's turn answers `/status`, `/sessions`,
// `/compact` and the rest of commands/acp.js. Which command a message is, is read by commands/recognize.js — the
// reading the sessions service makes of a harness turn.
import { findRoute, findUpstream } from "../../../core/routing.js";
import { parseModelSuffix } from "../../../core/shaping.js";
import { newestUserText } from "../../../adapters/agents/client-bridge.js";
import { chatCommandOf } from "../../commands/recognize.js";
import { answerMemCommand, answerMemHead, answerMemLeftOut } from "../../commands/mem.js";
import { answerCompactCommand, answersCompact } from "../../commands/compact.js";
import { answerAutofitCommand } from "../../commands/autofit.js";
import { answerGoalCommand } from "../../commands/goal.js";
import { answerSubagentCommand } from "../../commands/subagent.js";
import { answerSettingsCommand } from "../../commands/settings.js";
import { answerTeamCommand } from "../../commands/team.js";
import { answerGraphCommand } from "../../commands/graph.js";
import { answerStatusCommand, parseStatusCommand } from "../../commands/status.js";
import { filamentRuns } from "../../engine.js";
import { isMachineryRequest } from "../../../services/house.js";
import { addsNothing } from "../../../core/conversation.js";
import { modelsLentTo } from "../../../services/devices.js";

/**
 * The upstream a request's rounds call. A loop turn's route is the loop's stub, so for it the primary upstream is the
 * plain route its rounds would call — the loop's own model names it: an explicit `agent/<model>` is still `agent/…` in
 * the requested name and the body (HarnessV3-FixRound decision 2), so it is looked up by its base, then whole, as
 * `windowForModel` does.
 * @param {import("../context.js").RequestContext} ctx @param {any} cfg
 */
function primaryOf(ctx, cfg) {
  const loopModel = ctx.agent ? String(ctx.agent.model || "") : "";
  const plainRoute = ctx.agent
    ? (loopModel && (findRoute(cfg, parseModelSuffix(loopModel, cfg.rules).base) || findRoute(cfg, loopModel))) ||
      findRoute(cfg, ctx.requested.base) ||
      findRoute(cfg, ctx.body.model)
    : ctx.route;
  return findUpstream(cfg, plainRoute?.upstream);
}

/** @type {import("../context.js").Stage} */
export async function chatCommand(ctx, deps) {
  const { config, memory, destination } = deps;
  const { format, body } = ctx;
  // Filament's own machinery never carries a command for Filament: a sub-agent's task or a tick's newest message that
  // happens to start with one is work for the model. Nor does another machine's chat on this machine's models
  // (services/devices.js `modelsLentTo`): its commands are its own machine's, and none acts on a chat here. Nor a coding
  // agent's call that asked Filament to add nothing (core/conversation.js `addsNothing`): its chat's commands were Filament's already.
  if (isMachineryRequest(ctx.headers) || modelsLentTo(ctx.req) || addsNothing(ctx.headers)) return "continue";
  const sit = ctx.memory.sit;
  // A session turn Memory settings leave out (situate's `kept`): `@mem` is Filament's there too, answered in their words.
  const kept = ctx.memory.kept || null;
  const newestForCmd = sit?.newest ?? (Array.isArray(body.messages) ? newestUserText(format, body) : "");
  const own = chatCommandOf(newestForCmd, { memory, situated: !!sit || !!kept });
  // A chat Filament runs: a harness turn — memory may leave it out, so it is known by its API — or one Filament
  // composes or its loop answers (app/engine.js).
  const runs = ctx.pre?.api === "session" || filamentRuns(sit, { model: body.model, agent: ctx.agent });
  switch (own?.kind) {
    // `@mem …` typed in any chat (API model or agent): answered by Filament, the upstream is not called — in a chat
    // Filament composes that Memory settings leave out, in their words, memory doing nothing there.
    case "mem":
      if (sit) answerMemCommand(ctx, deps, await answerMemHead(memory, own.cmd, sit));
      else answerMemLeftOut(ctx, deps, own.cmd);
      return "replied";
    // `/goal …`: this session's objective (WP-I). Setting one spends the intake estimate call; the rest is local.
    case "goal":
      await answerGoalCommand(ctx, deps, own.cmd);
      return "replied";
    // `/compact`: Compact now, by the session's own way. A coding agent's chat has its own (commands/acp.js): it goes on.
    case "compact":
    {
      const up = primaryOf(ctx, config());
      if (!runs || !answersCompact(ctx, deps, !!(up && destination(up)?.agent))) break;
    }
      await answerCompactCommand(ctx, deps, own.cmd);
      return "replied";
    // `/autofit …`: the context-fit the person asks for (nothing fits a request on its way out). Instant verbs —
    // status says the numbers; the fit itself spends one compaction-model call.
    case "autofit":
      if (!runs) break;
      await answerAutofitCommand(ctx, deps, own.cmd);
      return "replied";
    // `/subagent …`: launch a sub-agent from this chat and follow it (commands/subagent.js).
    case "subagent":
      if (!runs) break;
      await answerSubagentCommand(ctx, deps, own.cmd);
      return "replied";
    // /set, /unset and /settings (HarnessV3 Step 2): every setting in the registry.
    case "settings":
      if (!runs) break;
      answerSettingsCommand(ctx, deps, own.cmd);
      return "replied";
    // `/team …`: which team answers this session (HarnessV3-AtHome P2).
    case "team":
      if (!runs) break;
      answerTeamCommand(ctx, deps, own.cmd);
      return "replied";
    // `/graph`: this session's task graph, shown (HarnessV3-TaskGraph).
    case "graph":
      if (!runs) break;
      answerGraphCommand(ctx, deps, own.cmd);
      return "replied";
  }
  if (!runs) return "continue";
  // /status, /cost and /help typed in a chat that talks to an API model (agent chats have more, see commands/acp.js),
  // answered here, before the loop runs, on the command's own turn.
  const primaryUp = primaryOf(ctx, config());
  if (primaryUp && !destination(primaryUp)?.agent) {
    // A backward walk of the newest message, not a flatten of the whole conversation: this runs on EVERY API-model
    // request just to test for three commands, and `flattenMessages` builds a text string for every message in a
    // history that can be megabytes. (It is also stricter — a command must be the newest message, not merely the
    // newest user message somewhere under later assistant turns.)
    const cm = parseStatusCommand(newestUserText(format, body).trim());
    if (cm) {
      answerStatusCommand(ctx, deps, { verb: cm[1].toLowerCase(), primaryUp });
      return "replied";
    }
  }
  return "continue";
}
