// @ts-check
// The commands a chat's agents run in the background while they run (HarnessV4_Background_Plan E38): Filament's own
// agent's bash_background, a coding agent's background_command, a sub-agent's. The server says a chat's whole list at
// each start and end (`commands` on the events feed's `turns` topic), with the transcript, and in the five-second
// holders read (`state.commands`); the status capsule lists them with Stop (conversation/status-panel.js), and Now keeps
// their chat under Working (lib/now.js), saying what its agent waits for between the turns of its work stretch. Pure:
// the rows' words.

/**
 * A running command as the server says it (app/agent/commands.js `CommandRow`): `machine`, the machine it runs on where
 * that is another (the remote-agents plan's c-tools).
 * @typedef {{ id: string, command: string, cwd: string, startedAt: number, agent: string | null, line: string,
 *   logPath: string | null, machine?: string }} CommandRow
 */

/** How long a command is shown in a row: its one line, cut here; its whole on hover. */
const COMMAND_CHARS = 80;

/** @param {number} n */
const counted = (n) => `${n} command${n === 1 ? "" : "s"}`;

/** A command cut to a row's room. @param {string} c */
export const commandShort = (c) => {
  const one = String(c || "").replace(/\s+/g, " ").trim();
  return one.length > COMMAND_CHARS ? `${one.slice(0, COMMAND_CHARS - 1)}…` : one;
};

/** How long it has run, short: "12s", "4m", "1h 05m". @param {number} ms */
export const ranWords = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  // Minutes rounded as Now's ages are (labels.js `sessionAge`): the same command reads the same in both, 7m 40s "8m"
  // (E38's live look found Now saying 8m beside "running 7m").
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
};

/** The capsule's and the floating panel's word: "1 command running"; "" for none. @param {readonly CommandRow[] | null | undefined} list */
export const commandsWord = (list) => (list?.length ? `${counted(list.length)} running` : "");

/** A folder's last part, as a row names one that is not the chat's. @param {string} p */
const folderName = (p) => String(p || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || String(p || "");
/** Two folders as one, whatever their slashes and case on Windows. @param {string} a @param {string} b */
const sameFolder = (a, b) => !!a && !!b && a.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase() === b.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();

/**
 * The rows the status lists, the oldest first (E38-D2): the command cut to its room, the whole on hover; who started it
 * where that is not the chat's own agent (`nameOf` names a sub-agent, else "a sub-agent"); its folder where it is not
 * the chat's; how long it has run, and on which machine where that is another; its newest line, "no output yet" for
 * none; the file with all of its output.
 * @param {readonly CommandRow[] | null | undefined} list @param {{ cwd?: string, now: number, nameOf?: (agent: string) => string }} o
 * @returns {{ id: string, command: string, title: string, facts: string, line: string, quiet: boolean, logPath: string | null, machine: string | null }[]}
 */
export function commandRows(list, o) {
  return [...(list || [])]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((c) => {
      const who = c.agent ? `by ${(o.nameOf && o.nameOf(c.agent)) || "a sub-agent"}` : "";
      const where = c.cwd && o.cwd && !sameFolder(c.cwd, o.cwd) ? `in ${folderName(c.cwd)}` : "";
      const on = c.machine ? `on ${c.machine}` : "";
      return {
        id: c.id,
        command: commandShort(c.command),
        title: [c.command, c.machine ? `on ${c.machine}, in ${c.cwd}` : c.cwd].filter(Boolean).join("\n"),
        facts: [`running ${ranWords(o.now - c.startedAt)}`, on, who, where].filter(Boolean).join(" · "),
        line: c.line || "no output yet",
        quiet: !c.line,
        logPath: c.logPath || null,
        machine: c.machine || null,
      };
    });
}

/**
 * Now's words for a chat's commands (E38-D1): "1 command running: npm test"; "3 commands running" — the oldest named
 * where it is alone. "" for none. @param {readonly CommandRow[] | null | undefined} list
 */
export function commandsFact(list) {
  if (!list?.length) return "";
  return list.length === 1 ? `1 command running: ${commandShort(list[0].command)}` : `${counted(list.length)} running`;
}

/** A running turn's row in Now adds them as it counts its agents: "1 command". @param {readonly CommandRow[] | null | undefined} list */
export const commandsCount = (list) => (list?.length ? counted(list.length) : "");

/**
 * What a chat's agent waits for of them between the turns of its work stretch, as Now's row says it after "waiting
 * for": "1 command: npm test"; "3 commands". "" for none. @param {readonly CommandRow[] | null | undefined} list
 */
export const commandsWaited = (list) => (!list?.length ? "" : list.length === 1 ? `1 command: ${commandShort(list[0].command)}` : counted(list.length));
