// @ts-check
// The signs that an agent drifts from its work, said to it as it works (the owner's of 11-10: state signals only, no
// step counter; FabeleHelper's ranked list of 11-10): read off what its calls did, never off its words, and each said
// once. The same for Filament's loop and a coding agent (checkpoint.js "action"), in each one's brackets. Pure.

/** How many failed runs of the same command in a row, with nothing changed between, make it a sign. */
export const FAILS_AGAIN = 3;

/**
 * What a turn's drift watch remembers.
 * @typedef {object} DriftState
 * @property {string} command  the command that failed last, as it is counted (`runKey`); "" once anything changed since
 * @property {number} fails  its failed runs in a row
 * @property {Set<string>} said  the commands it was told of, each once a turn
 */

/** @returns {DriftState} */
export const newDriftState = () => ({ command: "", fails: 0, said: new Set() });

/** A command as it is counted: its words, their blanks as one. @param {unknown} command */
const commandKey = (command) => String(command ?? "").trim().replace(/\s+/g, " ");

/**
 * A run as it is counted: its command, and where it ran, as its call says it — Codex names the folder of each command,
 * and `npm test` failing in three packages is three commands, not one that failed three times (the review of 11-11).
 * "" for no command. @param {unknown} command @param {unknown} where
 */
const runKey = (command, where) => {
  const c = commandKey(command);
  const at = String(where ?? "").trim();
  return c && at ? `${at}\n${c}` : c;
};

/**
 * Something that may change a file ran: a write, an edit, another command — whatever failed may pass now, and the count
 * starts again. Only reads between keep it.
 * @param {DriftState} state
 */
export const driftChanged = (state) => {
  state.command = "";
  state.fails = 0;
};

/**
 * A command ran to its end (d-fails): whether it failed a third time in a row with nothing changed between — true once a
 * turn for each command. One that passed, another command, or the same one somewhere else (`where`: the folder, or the
 * machine and folder, its call names; "" where it names none) starts the count again: each may have changed a file.
 * @param {DriftState} state @param {unknown} command @param {boolean} failed @param {unknown} [where]
 */
export function failedAgain(state, command, failed, where = "") {
  const key = runKey(command, where);
  if (!key || !failed) {
    driftChanged(state);
    return false;
  }
  state.fails = state.command === key ? state.fails + 1 : 1;
  state.command = key;
  if (state.fails < FAILS_AGAIN || state.said.has(key)) return false;
  state.said.add(key);
  return true;
}

/** A command as a line names it: its first 200 characters. @param {unknown} command */
const shown = (command) => {
  const c = commandKey(command);
  return c.length > 200 ? `${c.slice(0, 200)}…` : c;
};

/**
 * The line for a command that failed again with nothing changed (`failedAgain`), in the reader's brackets: the loop's
 * on a call's result, a coding agent's as Filament's words to it. It says what Filament saw, and no more: a change it
 * has no sight of — a service that came up, a file another program wrote — may let the next run pass, so the words
 * promise no outcome (the review of 11-11).
 * @param {unknown} command @param {"loop" | "coding"} kind
 */
export const failingLine = (command, kind) => {
  const words = `Filament: \`${shown(command)}\` failed a third time in a row, and nothing Filament saw changed between them. Before you run it again, find the cause — read what it said, and the code it names — and where you cannot, say so to the person.`;
  return kind === "loop" ? `(${words})` : `[${words}]`;
};

/**
 * Whether a change of the file `key` names is the turn's second: the moment the unplanned line is judged at, once a
 * turn (app/agent/tools.js `UNPLANNED_LINE`, the owner's of 11-09). `changed`: the files the agent's own edits changed
 * in the turn so far, by key, which this one joins — the loop's and a coding agent's turn each keep their own, and ask
 * here (the review of 11-11: the count was written twice). A file changed again is no second one, and past the second
 * none is asked. @param {Set<string>} changed @param {string} key  one key a file, however its call spelled it
 */
export const changedSecond = (changed, key) => {
  if (!key || changed.size >= 2) return false;
  const had = changed.size;
  changed.add(key);
  return changed.size > had && changed.size === 2;
};

/** A task's name as a line names it: its first 80 characters. @param {string} name */
const named = (name) => (name.length > 80 ? `${name.slice(0, 80)}…` : name);

/**
 * The line for a file the agent changed outside every open task's writes, while tasks of its own that named writes run
 * (d-writes; graph-runner `outside`), in the reader's brackets: said once a task.
 * @param {{ path: string, tasks: readonly { id: string, name: string, writes: readonly string[] }[] }} o @param {"loop" | "coding"} kind
 */
export const outsideLine = ({ path, tasks }, kind) => {
  const one = tasks.length === 1;
  const on = tasks.map((t) => `${t.id} "${named(t.name)}", whose writes are ${t.writes.slice(0, 3).join(", ")}${t.writes.length > 3 ? ` and ${t.writes.length - 3} more` : ""}`).join("; ");
  const words = `Filament: you changed ${path}, which no open task's writes name, while you are on ${on}. Where the work grew, name it in a task's writes or add a task for it (tasks change, tasks add); where it did not, go back to ${one ? `${tasks[0].id}'s` : "their"} own files.`;
  return kind === "loop" ? `(${words})` : `[${words}]`;
};
