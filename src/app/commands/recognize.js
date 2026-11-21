// @ts-check
// Which of Filament's chat commands a message is, read the way the chat-command stage reads it and in its order — one
// reading for the stage that answers the command (pipeline/stages/chat-command.js) and for the sessions service, which
// asks before it composes a harness turn: a turn Filament answers itself reaches no model, so it is neither compacted at
// its start nor stopped for size (HarnessV3-Launch LD-D6), and what waits for the session's next turn waits for one a
// model reads. `/status`, `/cost` and `/help` are not here: which chat answers them hangs on the route, so each caller
// reads them as it can (parseStatusCommand).
import { parseCompactCommand, parseGoalCommand, parseSettingsCommand, parseTeamCommand, parseGraphCommand, parseAutofitCommand, parseSubagentCommand } from "./parse.js";
import { memCommandHead } from "./mem.js";

/**
 * @typedef {{ kind: "mem", cmd: { prefix: string, verb: string, arg: string } }
 *   | { kind: "compact", cmd: NonNullable<ReturnType<typeof parseCompactCommand>> }
 *   | { kind: "autofit", cmd: NonNullable<ReturnType<typeof parseAutofitCommand>> }
 *   | { kind: "goal", cmd: NonNullable<ReturnType<typeof parseGoalCommand>> }
 *   | { kind: "subagent", cmd: NonNullable<ReturnType<typeof parseSubagentCommand>> }
 *   | { kind: "settings", cmd: NonNullable<ReturnType<typeof parseSettingsCommand>> }
 *   | { kind: "team", cmd: NonNullable<ReturnType<typeof parseTeamCommand>> }
 *   | { kind: "graph", cmd: NonNullable<ReturnType<typeof parseGraphCommand>> }} ChatCommand
 */

/**
 * The command `text` is, or null.
 * @param {string} text  the newest message, as memory reads the person's words
 * @param {{ memory: any, situated: boolean }} o  `situated`: memory situated the request — `@mem` is answered from its
 *   reading — or it is a turn of a chat Filament composes that Memory settings leave out, where `@mem` is answered in
 *   their words; without either it is no command
 * @returns {ChatCommand | null}
 */
export function chatCommandOf(text, { memory, situated }) {
  if (!text) return null;
  if (situated) {
    const mem = memCommandHead(memory, text);
    if (mem) return { kind: "mem", cmd: mem };
  }
  const compact = parseCompactCommand(text);
  if (compact) return { kind: "compact", cmd: compact };
  const autofit = parseAutofitCommand(text);
  if (autofit) return { kind: "autofit", cmd: autofit };
  const goal = parseGoalCommand(text, "/goal");
  if (goal) return { kind: "goal", cmd: goal };
  const subagent = parseSubagentCommand(text);
  if (subagent) return { kind: "subagent", cmd: subagent };
  const settings = parseSettingsCommand(text);
  if (settings) return { kind: "settings", cmd: settings };
  const team = parseTeamCommand(text);
  if (team) return { kind: "team", cmd: team };
  const graph = parseGraphCommand(text);
  if (graph) return { kind: "graph", cmd: graph };
  return null;
}
