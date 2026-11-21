// @ts-check
// The goal layer v1 (plan WP-I): a session can own one objective. `/goal <text>` proposes it; ONE intake estimate
// (a model call the goal cannot skip) says how big it is and which slice is achievable; the goal becomes active only
// when the developer accepts that slice. While active, a byte-stable block carrying the accepted slice rides the end
// of the system prompt on every request of the chain from its next compaction on — said until then on the person's
// next message, so no byte the provider cached changes (brain.js `applyGoal`) — and Filament drives it round by round
// (core/goal-drive.js). It
// counts no money (the owner's of 11-05: "drop the whole spend tracking"): nothing of a goal stops for what it spent.
// This module is the pure half: the shapes, the prompt, the reply parser, the block and the status text. The chain meta
// stores it; `commands/goal.js` answers the command.

import { driveOf, driveWords } from "../../core/goal-drive.js";

/** @typedef {"proposed" | "active" | "done" | "abandoned"} GoalStatus */
/** @typedef {"hours" | "days" | "weeks" | "months" | "team-years"} SizeClass */
/**
 * @typedef {object} GoalEstimate
 * @property {SizeClass} sizeClass
 * @property {string} achievableSlice  what one person with this assistant can plausibly finish, in one sentence or two
 * @property {string[]} assumptions
 * @property {string} firstStep
 * @property {number} at
 * @property {string} model  the model that estimated
 * @property {string | null} requestId
 */
/**
 * @typedef {object} Goal
 * @property {string} text  the wish as typed
 * @property {number} createdAt
 * @property {GoalStatus} status
 * @property {GoalEstimate | null} estimate
 * @property {string} slice  the accepted (or edited) slice; empty until accepted
 * @property {number | null} acceptedAt
 * @property {number | null} closedAt
 * @property {import("../../core/goal-drive.js").Drive} [drive]  its drive, once accepted (core/goal-drive.js)
 */

export const GOAL_STATUSES = /** @type {const} */ (["proposed", "active", "done", "abandoned"]);
export const SIZE_CLASSES = /** @type {const} */ (["hours", "days", "weeks", "months", "team-years"]);
export const GOAL_BLOCK_KIND = "goal";

/** What each size class means for the status card — words, not invented dollars. @type {Record<SizeClass, string>} */
export const SIZE_CLASS_HINT = {
  hours: "a sitting: a handful of turns in one session",
  days: "several sessions: tens of turns, a few checkpoints",
  weeks: "many sessions: the slice matters more than the wish; expect re-estimates",
  months: "a programme: only the accepted slice is a goal, the rest is a wish",
  "team-years": "beyond one person and one assistant: the slice is all that can be owned here",
};

export const ESTIMATE_PROMPT = [
  "You size a software goal for one developer working with an AI coding assistant, before any work starts. You will be given the goal as they typed it and the project it belongs to.",
  "Answer with one JSON object and nothing else:",
  '{"sizeClass": "hours"|"days"|"weeks"|"months"|"team-years", "achievableSlice": "<the part of the goal one developer with this assistant can plausibly finish and verify, as a bounded objective in one or two sentences>", "assumptions": ["<what you had to assume about the codebase, the tools or the acceptance criteria>", ...], "firstStep": "<the first concrete thing to do, one sentence>"}',
  "Size the WHOLE goal honestly — 'weeks' or 'months' is a normal answer, not a failure. The slice is what turns a wish into a goal: pick the largest piece that is still finishable and checkable, not the whole wish restated. Keep every field short; no preamble.",
].join("\n");

/**
 * The user turn of the estimate call.
 * @param {string} goalText @param {{ name?: string, cwd?: string } | null} project
 */
export function estimateUser(goalText, project) {
  const where = project?.name ? `Project: ${project.name}${project.cwd ? ` (${project.cwd})` : ""}` : "Project: unknown";
  return `${where}\n\nGoal, as typed:\n${goalText}`;
}

/**
 * The estimate from the model's reply — the first JSON object in it with a legal size class and a real slice; null
 * when there is none. Assumptions are clipped to six lines.
 * @param {string} raw
 * @returns {Omit<GoalEstimate, "at" | "model" | "requestId"> | null}
 */
export function parseEstimateReply(raw) {
  const m = /\{[\s\S]*\}/.exec(String(raw || ""));
  if (!m) return null;
  let j;
  try {
    j = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const sizeClass = String(j?.sizeClass || "").toLowerCase();
  if (!SIZE_CLASSES.includes(/** @type {any} */ (sizeClass))) return null;
  const achievableSlice = String(j?.achievableSlice || "").trim();
  if (achievableSlice.length < 8) return null;
  const assumptions = (Array.isArray(j?.assumptions) ? j.assumptions : [])
    .map((a) => String(a || "").trim())
    .filter(Boolean)
    .slice(0, 6);
  return { sizeClass: /** @type {SizeClass} */ (sizeClass), achievableSlice: achievableSlice.slice(0, 600), assumptions, firstStep: String(j?.firstStep || "").trim().slice(0, 400) };
}

/** A fresh, proposed goal. @param {string} text @param {{ now: number }} o @returns {Goal} */
export function newGoal(text, { now }) {
  return {
    text: String(text).trim().slice(0, 2000),
    createdAt: now,
    status: "proposed",
    estimate: null,
    slice: "",
    acceptedAt: null,
    closedAt: null,
  };
}

// The goal block's first line: what a note stands for begins with it (`goalOfNote`).
const GOAL_LEAD = "Goal for this session (set by the developer through Filament; work against this slice, not the wider wish):";

/**
 * The block that rides the end of the system prompt while the goal is active: the accepted slice, the size and the
 * first step — fields only, nothing that changes from request to request, so the provider's cache keeps it.
 * @param {Goal} goal
 */
export function goalBlockText(goal) {
  const lines = [GOAL_LEAD, goal.slice || goal.text];
  if (goal.estimate) lines.push(`Sized ${goal.estimate.sizeClass}. First step: ${goal.estimate.firstStep || "(none named)"}`);
  return lines.join("\n");
}

/** The goal's block while it is active, "" while it is not. @param {Goal | null | undefined} goal */
export const goalNow = (goal) => (goal?.status === "active" ? goalBlockText(goal) : "");

/**
 * What the person's message says of a goal that changed after the system prompt went out (brain.js `applyGoal`): the
 * goal accepted, its slice rewritten, or the goal closed. `told`: the goal's block the model was last given, "" for none.
 * @param {Goal | null | undefined} goal @param {string} told
 */
export function goalNoteText(goal, told) {
  const now = goalNow(goal);
  if (now) return told ? `The session's goal changed: the one below stands in place of the goal given earlier.\n${now}` : now;
  const how = goal?.status === "done" ? "is done" : goal?.status === "abandoned" ? "was abandoned" : "no longer stands";
  return `The session's goal ${how} (closed by the developer through Filament): the goal given earlier, in the system prompt or on an earlier message, no longer stands.`;
}

/** The goal's block a note stands for (`goalNoteText`): the block it ends with, "" for a note that closes the goal. @param {string} note */
export function goalOfNote(note) {
  const at = String(note).indexOf(GOAL_LEAD);
  return at < 0 ? "" : String(note).slice(at);
}

/**
 * Memory leaving a chat out, as a sentence starts it: the Memory setting that does, in its words (brain.js
 * `capturedOut`), where one does — none is blamed where memory left the chat out for a reason of its own; a read of the
 * chat that failed (`missed`) leaves out this message alone, and says so.
 * @param {true | string} out @param {boolean} [missed]
 */
export const leftOutWords = (out, missed = false) =>
  missed ? "Memory could not read this chat for this message" : `Memory leaves this chat out${typeof out === "string" ? ` (${out})` : ""}`;

/**
 * The `/goal status` card and the reply after an estimate — words, with its drive (core/goal-drive.js), never money. In
 * a chat memory leaves out (`leftOut`: the Memory setting that does, in its words, or true) the goal rides none of the
 * requests memory leaves out, as it is memory's work — every call of the chat where its client or folder is why, every
 * call on the model where its model is — and only closing it works there: the words say so, and offer nothing else.
 * @param {Goal} goal @param {{ chainId?: string | null, leftOut?: boolean | string, missed?: boolean }} [o]  `missed`: memory left
 *   it out as its read of the chat failed (`leftOutWords`)
 */
export function goalStatusText(goal, { chainId = null, leftOut = false, missed = false } = {}) {
  const when = goal.closedAt ? ` (closed ${iso(goal.closedAt)}${goal.acceptedAt ? `, accepted ${iso(goal.acceptedAt)}` : ""})` : goal.acceptedAt ? ` (accepted ${iso(goal.acceptedAt)})` : "";
  const lines = [`**/goal — this session${chainId ? ` (${chainId})` : ""}**`, `- goal: “${goal.text}”`, `- status: **${goal.status}**${when}`];
  if (goal.estimate) {
    const e = goal.estimate;
    lines.push(`- estimate (${e.model}, ${iso(e.at)}): **${e.sizeClass}** — ${SIZE_CLASS_HINT[e.sizeClass]}`);
    lines.push(`- ${goal.status === "proposed" ? "proposed slice" : "slice"}: ${goal.slice || e.achievableSlice}`);
    if (e.assumptions.length) lines.push(`- assumptions: ${e.assumptions.join("; ")}`);
    if (e.firstStep) lines.push(`- first step: ${e.firstStep}`);
  } else lines.push(`- estimate: none yet`);
  const drive = driveWords(driveOf(goal));
  if (drive) lines.push(`- drive: ${drive}`);
  const out = leftOut ? leftOutWords(leftOut, missed) : "";
  if (goal.status === "proposed")
    lines.push(``, out ? `${out}, so the goal cannot be accepted here. \`/goal abandon\` drops it.` : `\`/goal accept\` activates this slice; \`/goal slice <text>\` rewrites it first; \`/goal abandon\` drops the goal.`);
  else if (goal.status === "active")
    lines.push(``, out ? `${out}: the slice rides none of the requests it leaves out. \`/goal done\` or \`/goal abandon\` closes it.` : `The slice rides every request of this session: said on your next message, and at the end of the system prompt from the next compaction on. \`/goal done\` or \`/goal abandon\` closes it.`);
  return lines.join("\n");
}

const iso = (t) => new Date(t).toISOString().slice(0, 16).replace("T", " ");
