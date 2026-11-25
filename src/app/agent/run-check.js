// @ts-check
// run_check (x20): a sub-agent that only reads runs the check of the graph task it looks at — the task a hunt is fired
// from, the one it explores, the one a coding agent's helper is launched for — as Filament runs a check: in a copy of
// the folder as it stands, its uncommitted work in it, its dependency folders linked (subagents.js `checkFolder`).
// Two hunts of 11-23 could not run their task's check, and every finding was by reading alone. A tool of Filament's,
// not a bash command let through: what the shell would run after the check is never read, and a check that writes (a
// snapshot updated, a build's output) writes in the copy. Offered only to one that holds a check; the task's check, the
// session's mode and its rules are read at each call, so a check changed since, a switch to read-only or a rule that
// speaks for one of its commands reaches its next run.
import { durationWords } from "../../core/text.js";

export const RUN_CHECK = "run_check";
/** The lines of each command's output the answer quotes. */
const OUTPUT_LINES = 60;

export const RUN_CHECK_TOOL = Object.freeze({
  name: RUN_CHECK,
  description:
    "Run the check of the graph task you look at (its commands, as the task names them now) the way Filament runs a check: in a copy of the folder as it stands, its uncommitted work in it, so what the check writes stays in the copy, but for the dependency folders (node_modules and the like) the copy shares with the folder. It answers how each command ended and the end of what it printed; one that failed runs once more, and both runs are said. Not run where the chat is read-only, or a rule of the session's speaks for one of its commands. Your shell runs no check of its own here: use this.",
  input_schema: Object.freeze({ type: "object", properties: Object.freeze({}) }),
});

/** A call where the agent holds no check. */
export const RUN_CHECK_OFF = "Not run: only a sub-agent that reads and looks at a graph task with a check runs it — carry on by reading.";

/** The end of an output: its last `n` lines, blank ones at its end aside. @param {string} text @param {number} n */
const lastLines = (text, n) => String(text || "").replace(/\s+$/, "").split(/\r?\n/).slice(-n).join("\n");

/** How one run ended. @param {{ exit: number | null, ms: number, stopped?: boolean }} r */
const ended = (r) => (r.stopped ? `did not finish (after ${durationWords(r.ms)})` : r.exit === 0 ? `passed (exit 0, ${durationWords(r.ms)})` : `failed (${r.exit === null ? "no exit code" : `exit ${r.exit}`}, ${durationWords(r.ms)})`);

/**
 * What the agent reads of the check's run: each command with how it ended and the end of its output — a red one's first
 * run beside its second, which makes red then green flaky — those after a stop "not run"; or why none ran.
 * @param {import("./check.js").CheckOutcome} c
 * @returns {{ ok: true, text: string } | { ok: false, error: string }}
 */
export function runCheckAnswer(c) {
  if (!c.ran) return { ok: false, error: `Not run: ${c.words}.` };
  const blocks = c.runs.map((r) => {
    const first = r.first ? `\nIts first run ${ended({ exit: r.first.exit, ms: r.first.ms })}${r.first.output ? ` — the end of its output:\n${lastLines(r.first.output, OUTPUT_LINES)}` : ""}\nIts second run:` : "";
    const out = lastLines(r.output, OUTPUT_LINES);
    return `$ ${r.command}${first}\n${ended(r)}${out ? ` — the end of its output:\n${out}` : " — no output"}`;
  });
  const left = c.commands.slice(c.runs.length).map((command) => `$ ${command}\nnot run`);
  const head = c.stopped ? "Filament's run of the check was stopped" : "Filament ran the check in a copy of the folder as it stands";
  return { ok: true, text: `${head}:\n\n${[...blocks, ...left].join("\n\n")}` };
}
