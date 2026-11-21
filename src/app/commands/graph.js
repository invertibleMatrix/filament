// @ts-check
// `/graph` (HarnessV3-TaskGraph): this session's task graph, from a chat Filament runs, as its planner reads it — the
// agent, or a team's lead (G3-1). The graph is always on (the owner's word of 10-29), so the command only shows it.
import { answerWith, commandChain, openCommandRecord } from "./answer.js";
import { showText } from "../../core/task-graph.js";
import { graphCrew } from "../../services/session-settings.js";
import { leadingTeams } from "../../core/teams-on.js";
import { isTeamChat } from "../engine.js";

/**
 * The whole `/graph` surface as one reply: the graph as its planner reads it. Words after the command are no form of it.
 * @param {any} memory @param {string | null} chainId  the session whose graph it shows (answer.js `commandChain`)
 * @param {{ arg: string }} cmd
 * @param {{ teams?: import("../../services/teams.js").TeamStore | null }} [o]  `teams`: where the team that answers the
 *   session is found — its lead plans the graph, its tasks naming the team's members
 * @returns {{ text: string, chainId: string | null }}
 */
export function graphCommandReply(memory, chainId, { arg }, { teams = null } = {}) {
  if (!chainId) return { text: `No archive, so this chat has no session to keep a task graph for. ${memory.archiveWhy()}`, chainId: null };
  const words = String(arg || "").trim();
  if (words) return { text: `\`/graph ${words}\` is no form of the command — \`/graph\` alone shows this session's task graph.`, chainId };
  const crew = graphCrew(memory.docFor(chainId).effective, leadingTeams(memory.getConfig?.(), isTeamChat(memory.archive, chainId), teams));
  const planner = crew !== "agent" ? "the team's lead" : "the agent";
  const graph = memory.archive?.getChain?.(chainId)?.meta?.graph || null;
  return {
    text: [
      `**Task graph** — ${planner} has the tasks tool beside its checklist, and puts each piece of work on whichever fits.`,
      ...(graph ? [`The graph, as ${planner} reads it:`, "```text", showText(graph, crew), "```"] : [`No graph yet: ${planner} starts one when the work has pieces that depend on each other or could run in parallel.`]),
    ].join("\n"),
    chainId,
  };
}

/**
 * The stage's entry: answer the parsed command on a record of its own.
 * @param {import("../pipeline/context.js").RequestContext} ctx
 * @param {import("../deps.js").AppDeps} deps
 * @param {{ arg: string }} cmd
 */
export function answerGraphCommand(ctx, deps, cmd) {
  const rec = openCommandRecord(ctx, deps, { upstream: ctx.route.upstream });
  const r = graphCommandReply(deps.memory, commandChain(ctx, deps), cmd, { teams: deps.teams || null });
  // The record names its session before it is written, so the log's line and the live feed carry it.
  if (r.chainId) rec.memory = { ...(rec.memory || {}), chain: r.chainId };
  answerWith(ctx, deps, rec, r.text, {
    changes: ["graph command answered by Filament, upstream not called"],
    local: true,
  });
}
