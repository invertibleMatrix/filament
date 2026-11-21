// @ts-check
// Filament's run of a worker's check (HarnessV3-TaskGraph-v2 TG2-D45, §13): the words its end is said in — to the
// worker it goes back to, red; to its lead in the report, green, red after two returns, stopped, or not run — and to
// the watch while it runs, or once it sent the worker back. Pure: the registry runs the commands (subagents.js).
import { durationWords, listed } from "../../core/text.js";
import { asksFirst, describeRule, ruleFor } from "./rules.js";

/** How often a red check goes back to its worker before its lead hears (TG2-D45). */
export const CHECK_RETURNS = 2;
/** The lines of a check's output a report quotes: of a green one, and of a red one. */
const GREEN_LINES = 3;
const RED_LINES = 40;

/**
 * @typedef {object} CheckRun  one command of a check, as Filament ran it
 * @property {string} command
 * @property {number | null} exit  null: it ended without one — a stop, a shell that could not start
 * @property {number} ms
 * @property {string} output  the end of what it printed
 * @property {boolean} stopped  a stop ended it before it exited
 * @property {{ exit: number | null, ms: number, output?: string } | null} [first]  a graph task's command that failed ran
 *   once more (V2-1): its first run, this being its second — the end of what it printed too, which says what failed
 *   where the second passed (flaky); null for a graph task's that passed at once, or a stop ended
 */
/**
 * @typedef {{ ran: true, commands: string[], runs: CheckRun[], bounces: number, stopped: boolean } | { ran: false, words: string }} CheckOutcome
 *   how Filament's check of an exchange's end went: the brief's commands, those it ran — in order, up to the first that
 *   failed — how often it had sent the worker back before, and whether a stop ended it; or why it did not run, in the
 *   report's words
 */

/** A command as the words quote it. @param {string} c */
const q = (c) => `\`${c}\``;

/** The end of an output: its last `n` lines, blank ones at its end aside. @param {string} text @param {number} n */
const lastLines = (text, n) => String(text || "").replace(/\s+$/, "").split(/\r?\n/).slice(-n).join("\n");

/** Whether a check passed: each command ran, to exit 0, and no stop cut it. @param {CheckOutcome} c */
const checkPassed = (c) => c.ran && !c.stopped && c.runs.length === c.commands.length && c.runs.every((r) => r.exit === 0);
/** The command a check failed on — none where it passed or a stop ended it. @param {CheckOutcome} c */
export const failedRun = (c) => (c.ran && !c.stopped ? c.runs.find((r) => r.exit !== 0) || null : null);

/** How one command ended, in a report's words. @param {CheckRun} r */
const endWords = (r) =>
  r.stopped ? `did not finish (after ${durationWords(r.ms)})` : r.exit === 0 ? `passed (exit 0, ${durationWords(r.ms)})` : `failed (${r.exit === null ? "no exit code" : `exit ${r.exit}`}, ${durationWords(r.ms)})`;
/**
 * The check's commands in a report's words: each that ran, with how it ended, and those after it "not run".
 * @param {Extract<CheckOutcome, { ran: true }>} c
 */
const runsWords = (c) => listed([...c.runs.map((r) => `${q(r.command)} ${endWords(r)}`), ...c.commands.slice(c.runs.length).map((command) => `${q(command)} not run`)]);
/** An output's end, after the words that name it — none where it printed nothing. @param {string} text @param {number} n */
const endOf = (text, n) => {
  const end = lastLines(text, n);
  return end ? ` The end of its output:\n${end}` : "";
};

/**
 * What the lead's report says of Filament's check, after the worker's words: it passed, with the end of its output and
 * how often it went back first; it failed after going back, with the output and what an apply needs; a stop cut it;
 * or why it did not run.
 * @param {CheckOutcome} c
 */
export function checkWords(c) {
  if (!c.ran) return c.words;
  const runs = runsWords(c);
  if (c.stopped) return `Filament was running its check when it was stopped: ${runs}, so its change is unchecked.`;
  if (checkPassed(c)) {
    const back = c.bounces === 1 ? ", after going back to the worker once with a failing run's output" : c.bounces > 1 ? ", after going back to the worker twice with a failing run's output each time" : "";
    return `Filament ran its check after it reported: ${runs}${back}.${endOf(String(c.runs.at(-1)?.output), GREEN_LINES)}`;
  }
  const back = c.bounces === 1 ? ", the second run — it went back to the worker once, with the output" : c.bounces > 1 ? ", the third run — it went back to the worker twice, with the output each time" : "";
  return `Filament ran its check after it reported: ${runs}${back}.${endOf(String(failedRun(c)?.output), RED_LINES)}\n\nApply it only with a reason (worker with apply_changes and reason), or follow up on it.`;
}

/**
 * What a worker reads when Filament sends it back (TG2-D45): its check failed — the commands that passed before it, and
 * the one that failed with the end of its output — its lead hears once the check passes or after the second time, and
 * it fixes the cause, never the check. A graph task's worker (V2-1) reads of its task's check, and — under the
 * session's agent, no lead's — of the agent (`agent`). One whose check its report named (`named`, TG2-D63) reads that
 * those commands are its task's check now, and stay it.
 * @param {Extract<CheckOutcome, { ran: true }>} c @param {number} n  this return: 1 or 2
 * @param {{ task?: boolean, agent?: boolean, named?: boolean }} [o]
 */
export function bounceText(c, n, { task = false, agent = false, named = false } = {}) {
  const blocks = c.runs.map((r) =>
    r.exit === 0
      ? `$ ${r.command}\npassed (exit 0, ${durationWords(r.ms)})`
      : `$ ${r.command}\n${r.exit === null ? "it ended without an exit code" : `exit ${r.exit}`} after ${durationWords(r.ms)} — the end of its output:\n${lastLines(r.output, RED_LINES) || "(no output)"}`,
  );
  const who = agent ? "the agent" : "your lead";
  const Who = agent ? "The agent" : "Your lead";
  const ran = named ? "the commands your report named in checked — your task's check now —" : `your ${task ? "task's" : "brief's"} check`;
  return `[Filament: you reported, and Filament ran ${ran} in your worktree before ${who} heard of it. It failed:\n\n${blocks.join("\n\n")}\n\n${Who} hears your report once the check passes, or after Filament has sent it back to you twice — this is the ${n === 1 ? "first" : "second"} time. Fix the cause the output shows, never the check: a test weakened or skipped to get green is still a failure. Run the check yourself, then report again.${named ? " They stay your task's check whatever a later report names." : ""}]`;
}

/** Why Filament did not run a worker's check, as its report says it. */
export const CHECK_NOT_RUN = Object.freeze({
  shared: "Filament did not run its check: the worker shared your folder, so there was no worktree of its own to run it in.",
  readOnly: "Filament did not run its check: the session is read-only.",
  uncaptured: "Filament did not run its check: its work could not be captured.",
  agents: "Filament did not run its check: another machine's agents started this chat, and their device may not run without asking here.",
});
/**
 * Why a rule of the session's keeps Filament from running a command of a check, as the report says it — or null. A deny
 * rule refuses it; an ask rule's yes is the developer's, which Filament's own run never takes for them.
 * @param {readonly string[]} commands @param {readonly import("./rules.js").Rule[]} rules
 */
export function checkRuled(commands, rules) {
  for (const command of commands) {
    const hit = ruleFor(rules, "bash", { command });
    if (hit?.verdict === "deny") return `Filament did not run its check ${q(command)}: this session's rule ${describeRule(hit.rule)} refuses it.`;
    if (asksFirst(hit)) return `Filament did not run its check ${q(command)}: this session's rule ${describeRule(/** @type {any} */ (hit).rule)} asks first.`;
  }
  return null;
}

/**
 * Why Filament did not run a graph task's check (V2-1), as the task's end says it after "unchecked:" or "Filament did not
 * check task …:" — a worker's in its worktree once it reported, the agent's own and the close's in a copy of the folder.
 */
export const TASK_NOT_CHECKED = Object.freeze({
  readOnly: "the session is read-only, so Filament runs no check in it",
  git: "this folder is not in git, so Filament has no copy of it to run the check in",
  shared: "its worker worked in the folder itself, so there was no worktree to run it in",
  uncaptured: "its work could not be captured, so Filament had nothing to run the check on",
  agents: "another machine's agents started this chat, and their device may not run without asking here, so Filament runs no check of theirs on its own",
  /** @param {string} error */
  failed: (error) => `Filament could not make a copy of the folder to run it in (${error})`,
});
/** Why Filament did not run a command task (HarnessV3-TaskGraph-v2 V2-3), in the words its end says after "Filament could not run it:". */
export const TASK_NOT_RUN = Object.freeze({
  readOnly: "the session is read-only, so Filament runs no command in it",
  agents: "another machine's agents started this chat, and their device may not run without asking here, so Filament runs no command of theirs on its own",
  git: "this folder is not in git, so Filament has no copy of it to run the commands in",
  /** @param {string} error */
  failed: (error) => `no copy of the folder could be made to run them in (${error})`,
});
/**
 * Why a rule of the session's keeps Filament from running a graph task's check (V2-1), in `TASK_NOT_CHECKED`'s words —
 * or null: a rule that came since the task was given its check. A deny refuses a command; an ask's yes is the
 * developer's, which Filament's own run never takes for them.
 * @param {readonly string[]} commands @param {readonly import("./rules.js").Rule[]} rules
 */
export function taskRuled(commands, rules) {
  for (const command of commands) {
    const hit = ruleFor(rules, "bash", { command });
    if (hit?.verdict === "deny") return `this session's rule ${describeRule(hit.rule)} refuses ${q(command)}`;
    if (asksFirst(hit)) return `this session's rule ${describeRule(/** @type {any} */ (hit).rule)} asks first for ${q(command)}`;
  }
  return null;
}

/** A running check in the watch's words. @param {{ command: string, began: number }} c @param {number} at  now */
export const checkingWords = (c, at) => `Filament runs its check ${q(c.command)} · ${durationWords(at - c.began)} so far`;
/**
 * A worker Filament sent back, in the watch's words: its own check failed (TG2-D45), or — `folder` — its change failed
 * the folder's check once its lead applied it (TG2-D55). @param {{ command: string, n: number, folder?: boolean }} b
 */
export const sentBackWords = (b) =>
  b.folder ? `sent back by Filament: the folder's check ${q(b.command)} failed with its change (${b.n === 1 ? "first" : "second"} time)` : `sent back by Filament: its check ${q(b.command)} failed (${b.n === 1 ? "first" : "second"} time)`;

// ---- the folder's check after a lead's apply (HarnessV3-TaskGraph-v2 TG2-D55) -----------------------------------------

/** The lines of a red command's output the lead reads where the folder was red on it already: no fix waits on them. */
const RED_ALREADY_LINES = 10;
/**
 * @typedef {object} FolderRun  one command of Filament's check of the folder after an apply: how it ran with the change,
 *   and — where it failed — on the folder from before the apply
 * @property {string} command
 * @property {CheckRun} after
 * @property {CheckRun | null} before  null where it passed, or a lead's reason let the apply stand
 * @property {boolean} own  the change's own check alone — it passed in its worktree — and no check that guarded the folder
 */
/**
 * @typedef {{ kind: "passed" | "red" | "reason", runs: FolderRun[], ruled: string[] }
 *   | { kind: "undone", runs: FolderRun[], ruled: string[], broke: FolderRun, back: { n: number } | { twice: true } | { why: string } }
 *   | { kind: "stuck", runs: FolderRun[], ruled: string[], broke: FolderRun, conflicts: { path: string, why: string }[], stuck?: string[] }
 *   | { kind: "not", words: string }
 *   | { kind: "late", command: string, ms: number }
 *   | { kind: "waiting", behind: string | null, writing?: boolean }} FolderCheck
 *   what came of Filament's check of the folder after a lead's apply: each command passed; one failed with the change and
 *   before it too, so the apply stands (`red`), or failed and stands for the lead's reason; the apply broke one and was
 *   undone, the change sent back to its worker (`back.n`), or not — twice already, or why it could not go; the undo
 *   would not come through cleanly, so the apply stands red (`stuck`); no check ran, and why; the check still runs as
 *   the call answers (`late`); or the apply waits behind the one before it (`waiting`), which still goes into the folder
 *   (`writing`) or is checked there. `ruled`: the
 *   sentences of the commands a rule of the session's kept from running
 */

/** How one command ended, with its name: "`npm test` failed (exit 1, 2 s)". @param {CheckRun} r */
const ranWords = (r) => `${q(r.command)} ${endWords(r)}`;
/** An exit in words. @param {CheckRun} r */
const exitWords = (r) => (r.exit === null ? "no exit code" : `exit ${r.exit}`);
/** The commands of a check that failed with the change. @param {readonly FolderRun[]} runs */
const redOf = (runs) => runs.filter((r) => r.after.exit !== 0);
/** What the lead can do with a change that waits after an undo. */
const AFTER_UNDO = "Follow it up with worker; apply it anyway with reason, why it goes in though the folder's check fails; or leave it, and tell the developer.";

/**
 * The commands of the folder's check a rule of the session's keeps Filament from running — a deny refuses one, and an
 * ask's yes is the developer's, which Filament's own run never takes for them — each in a sentence, and the words where
 * every one is kept from running — of a lead's apply's changes ("them"), or of a graph's merge of one ("it", V2-2).
 * @param {readonly string[]} commands @param {readonly import("./rules.js").Rule[]} rules @param {{ merge?: boolean }} [o]
 * @returns {{ run: string[], ruled: string[], none: string | null }}
 */
export function folderRuled(commands, rules, { merge = false } = {}) {
  /** @type {string[]} */
  const run = [];
  /** @type {string[]} */
  const ruled = [];
  /** @type {string | null} */
  let first = null;
  for (const command of commands) {
    const hit = ruleFor(rules, "bash", { command });
    if (!hit || (hit.verdict !== "deny" && !asksFirst(hit))) {
      run.push(command);
      continue;
    }
    const rule = `this session's rule ${describeRule(hit.rule)}`;
    ruled.push(`It did not run ${q(command)}: ${rule} ${hit.verdict === "deny" ? "refuses it" : "asks first"}.`);
    first ??= `Filament did not check the folder with ${merge ? "it" : "them"}: ${rule} ${hit.verdict === "deny" ? "refuses" : "asks first for"} ${q(command)}.`;
  }
  return { run, ruled, none: run.length ? null : first };
}

/** A copy's path, any slash, any case, for `failedAlike`. @param {string} top */
const copyPath = (top) => new RegExp(String(top).replace(/[\\/]+$/, "").replace(/[.*+?^${}()|[\]]/g, "\\$&").replace(/[\\/]+/g, "[\\\\/]+"), "gi");
/** An output as `failedAlike` compares it: its copy's path named alike, digits and spacing left out. @param {string} text @param {string} top */
const failureShape = (text, top) => String(text || "").replace(copyPath(top), "<copy>").replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
/**
 * Whether one command failed the same way in two copies of the folder (the owner's of 11-10): the same exit, and the
 * same output once the copy each ran in is named alike and what tells one run from another — durations, counts,
 * anything with a digit — is left out, as two failures' cause is read (task-graph.js `causeOf`). The change's own
 * check that fails so without the change too fails on the folder or its environment, not on the change — a copy of a
 * folder with no node_modules linked into it failed every check that needed one —; one that fails another way there
 * (its own test file not there yet) still broke with the change.
 * @param {CheckRun} a @param {string} aTop  the copy `a` ran in @param {CheckRun} b @param {string} bTop
 */
export function failedAlike(a, aTop, b, bTop) {
  return a.exit !== 0 && b.exit === a.exit && failureShape(a.output, aTop) === failureShape(b.output, bTop);
}

/**
 * What the lead reads of the change's own checks that failed the same way with its changes and without them
 * (`failedAlike`) — in a verdict that stands red, the only own ones red before too: the environment's failure, not the
 * change's, so the apply stands and nothing went back. "" for none. @param {readonly FolderRun[]} runs
 */
const alikeWords = (runs) => {
  const own = runs.filter((r) => r.own && r.after.exit !== 0 && r.before && r.before.exit !== 0).map((r) => q(r.command));
  if (!own.length) return "";
  const one = own.length === 1;
  return ` Its own check${one ? "" : "s"} ${listed(own)} passed in its worktree, and fail${one ? "s" : ""} the same way with them and without them: the failure is the environment's — your folder's, or what its checks run with, a missing dependency folder say — not the change's, so it did not go back to its worker.`;
};

/** What a red command of the change's own, or one the apply broke, says of it. @param {FolderRun} b @param {string} target */
const brokeWords = (b, target) =>
  b.own
    ? `sub-agent ${target}'s change does not pass its own check in your folder — ${q(b.command)} passed in its worktree, and fails with the rest of your folder (${exitWords(b.after)}, ${durationWords(b.after.ms)})${b.before && b.before.exit !== 0 ? ", and without the change too" : ""}.`
    : `with sub-agent ${target}'s change your folder's check fails, and without it the check passes — ${ranWords(b.after)}.`;

/**
 * What the lead reads after "Applied the changes of …: files." of Filament's check of the folder with them: they passed;
 * the folder was red on them already, or they stand red for its reason; no check ran, and why; or the check runs still.
 * @param {Extract<FolderCheck, { kind: "passed" | "red" | "reason" | "not" | "late" }>} c
 */
export function folderTail(c) {
  if (c.kind === "not") return c.words;
  if (c.kind === "late") return `Filament checks the folder with them now (${q(c.command)}, ${durationWords(c.ms)} so far), and undoes the apply if they break it: what comes of it reaches you as a message.`;
  const ruled = c.ruled.map((s) => ` ${s}`).join("");
  if (c.kind === "passed") return `Filament's check of the folder with them passed: ${listed(c.runs.map((r) => ranWords(r.after)))}.${ruled}`;
  const reds = redOf(c.runs);
  const failed = listed(reds.map((r) => ranWords(r.after)));
  if (c.kind === "reason") return `Filament's check of the folder fails with them — ${failed} — and they stand, for your reason.${ruled}${endOf(String(reds[0]?.after.output), RED_LINES)}`;
  return `Filament's check of the folder fails with them, and failed before them too: ${failed}. Your folder was red on ${reds.length === 1 ? "it" : "them"} already, so the apply stands.${alikeWords(c.runs)}${ruled}${endOf(String(reds[0]?.after.output), RED_ALREADY_LINES)}`;
}

/**
 * What the lead reads of an apply Filament undid: the command it broke, that the folder is as it was, and where the
 * change is now — back with its worker, or waiting, and why.
 * @param {string} target @param {Extract<FolderCheck, { kind: "undone" }>} c
 */
export function undoneText(target, c) {
  const back = c.back;
  const where =
    "n" in back
      ? `The change went back to its worker with the output (the ${back.n === 1 ? "first" : "second"} time), its worktree rebased onto your folder; its report comes again as a message. If it is the check that is wrong — flaky, say — apply the change with reason once it reports.`
      : "twice" in back
        ? `The change went back to its worker twice already, so it waits now, rebased onto your folder. ${AFTER_UNDO}`
        : `The change could not go back to its worker (${back.why}), so it waits, rebased onto your folder. ${AFTER_UNDO}`;
  const said = brokeWords(c.broke, target);
  return `Not kept: ${said} Filament undid the apply: your folder is as it was before it. ${where}${endOf(String(c.broke.after.output), RED_LINES)}`;
}

/** What the lead reads of an apply the undo would not take back cleanly: it stands, red. @param {string} target @param {Extract<FolderCheck, { kind: "stuck" }>} c */
export function stuckText(target, c) {
  const n = c.stuck?.length || 0;
  const stuck = n ? ` ${n === 1 ? "1 file" : `${n} files`} could not be put back as ${n === 1 ? "it was" : "they were"} — ${(c.stuck || []).join(", ")}: check ${n === 1 ? "it" : "them"} by hand.` : "";
  return `Applied, and not undone: ${brokeWords(c.broke, target)} Filament could not undo the apply cleanly, since your folder changed there after it: ${c.conflicts.map((x) => `${x.path}: ${x.why}`).join("; ")}.${stuck} It stands, red.${endOf(String(c.broke.after.output), RED_LINES)}`;
}

/**
 * What the lead reads of an apply that waits behind the one before it: that one still going into the folder
 * (`writing`), or in and being checked — or the folder busy with no other apply of a sub-agent's in it.
 * @param {string} target @param {string | null} behind @param {boolean} [writing]
 */
export const waitingText = (target, behind, writing = false) =>
  behind && writing
    ? `Not applied yet: sub-agent ${behind}'s change, applied before this one, is going into your folder now. Sub-agent ${target}'s goes in once that apply — and Filament's check of your folder with it, where there is one — has ended, and what comes of it reaches you as a message.`
    : behind
      ? `Not applied yet: Filament is still checking your folder with sub-agent ${behind}'s change, applied before this one. Sub-agent ${target}'s goes in once that check has its verdict, and what comes of it reaches you as a message.`
      : `Not applied yet: Filament applies it once your folder is free, and what comes of it reaches you as a message.`;

/**
 * The record's words of what came of the folder's check, after "applied sub-agent …'s changes (n files)" — none after
 * a lead's reason, whose words end the line. @param {FolderCheck} c
 */
export function folderCheckNote(c) {
  if (c.kind === "passed") return " — the folder's check passed";
  if (c.kind === "red") return ` — the folder was red on ${listed(redOf(c.runs).map((r) => q(r.command)))} already: it stands`;
  if (c.kind === "reason") return ` — the folder's check failed: it stands, for the lead's reason`;
  if (c.kind === "stuck") return ` — ${q(c.broke.command)} failed with them, and the undo did not come through cleanly: it stands`;
  if (c.kind === "late") return " — the folder's check still runs";
  if (c.kind === "not") return " — the folder not checked";
  return "";
}

/** The record's words of an apply Filament undid. @param {string} target @param {Extract<FolderCheck, { kind: "undone" }>} c */
export function undoneNote(target, c) {
  const b = c.broke;
  const back = c.back;
  const how = "n" in back ? `sent back, ${back.n} of ${CHECK_RETURNS}` : "twice" in back ? "not sent back: it went back twice already" : `not sent back: ${back.why}`;
  return `agent: sub-agent ${target}'s changes undone — ${b.own ? `its own check ${q(b.command)} failed in the folder` : `${q(b.command)} failed with them and passed without`} (${how})`;
}

/**
 * What a worker reads when the folder's check sends its change back (TG2-D55): the command, why it is its change's,
 * that the apply was undone and its worktree now holds the folder with its change in it, what to do, and the output.
 * @param {FolderRun} b @param {number} n  this return: 1 or 2
 */
export function folderBackText(b, n) {
  const what = b.own
    ? `your brief's check ${q(b.command)} passed in your worktree, and fails with the rest of the folder${b.before && b.before.exit !== 0 ? ", and without your change too" : ""}`
    : `${q(b.command)} passes without your change and fails with it`;
  const r = b.after;
  return `[Filament: your lead applied your change to the developer's folder, and the folder's check failed with it: ${what}. The apply was undone. Your worktree now holds the developer's folder with your change in it, so the command fails here as it did there; Filament runs it again when you report. Make your change pass with the rest of the folder, never by weakening the check, run it yourself, and report again. This is the ${n === 1 ? "first" : "second"} time Filament sent your change back for the folder's check; after the second, your lead decides.\n\n$ ${r.command}\n${r.exit === null ? "it ended without an exit code" : `exit ${r.exit}`} after ${durationWords(r.ms)} — the end of its output:\n${lastLines(r.output, RED_LINES) || "(no output)"}]`;
}

/** Why Filament did not check the folder after an apply, where it meant to. */
export const FOLDER_NOT_CHECKED = Object.freeze({
  cut: "Filament's check of the folder with them was cut before it finished: the apply stands, unchecked.",
  /** @param {string} error */
  failed: (error) => `Filament could not check the folder with them (${error}).`,
});
/** Why Filament did not check the folder after a graph's merge (HarnessV3-TaskGraph-v2 V2-2), where it meant to. */
export const MERGE_NOT_CHECKED = Object.freeze({
  cut: "Filament's check of the folder with it was cut before it finished: the merge stands, unchecked.",
  /** @param {string} error */
  failed: (error) => `Filament could not check the folder with it (${error}).`,
});
