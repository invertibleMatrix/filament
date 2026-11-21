// @ts-check
// The sentences of a lead's prompt and tools that name its team's members (HarnessV4_Tasks E15 step 6, AG-171). A team
// is a lead card and the worker cards it hands work to; the four members every shipped team has are a scout, a builder,
// a tester and a reviewer — Reviewer seated as the scout, Builder as the tester — and the words written for those four
// stand here (`SHIPPED_ROSTER_WORDS`). Any other list of members reads words written from its cards: one line per member —
// its tag, what its card is good for (the team's own line for it, where its card sits in the team twice, each seat
// under a name of its own), and what its work does to the project's files — and the sentences that named "a
// builder and a tester" name the members that change files. prompt.js and tools.js put each part where its sentence
// stands; both versions of a text therefore differ in these parts alone. Frozen per list of members, like every word
// a request carries.
import { doesWords, isShippedRoster, memberCard, reviewersOf, writes } from "../../core/roster.js";
import { listed } from "../../core/text.js";

/** @typedef {import("../../core/roster.js").Member} Member */

/**
 * The lead's line on the commands that prove a task done (TG2-D44, D45, D46), for a team where a member changes files.
 */
const CHECK_LINE =
  "- Put the commands that prove a task done in check, and the others it needs in may_run: in the worker's own worktree they run without anyone's answer, and Filament runs the check itself once the worker reports — a failing one goes back to the worker, twice at most, before you hear. Where you can, have a failing test written first, and make it the check of the work that makes it pass.";
/** How a claim line of a team whose work Filament may check begins: a check it ran is no claim, and a change is read. */
const CLAIM = "- A report is a claim; a check Filament ran is not. Read every change before you apply it";

/**
 * @typedef {object} RosterWords
 * @property {string} roles  the lead's first line, after "launched with the agent tool": who its workers are
 * @property {string} worktree  the lead's line on where a change is made and when it is applied
 * @property {string | null} check  the lead's line on a brief's check and may_run (HarnessV3-TaskGraph-v2 TG2-D46) — null
 *   where no member changes the project's files: none has a worktree to run them in
 * @property {string} claim  the lead's line on checking a report
 * @property {string} graphBy  the lead's graph: what a task names of who does it
 * @property {string} graphTask  the lead's graph: what a task is given, and what Filament does with it
 * @property {string} toolRoles  the agent tool's text, after "a sub-agent of Filament's": who its workers are
 * @property {string} toolWorktree  the agent tool's text: where a change is made, and whose change a review names
 * @property {string} applies  the worker tool's text: whose change apply_changes applies
 * @property {string} tasksBy  the tasks tool's text: what `by` is
 * @property {string} tasksWho  the tasks tool's text: who names writes, and who reviews
 * @property {string} tasksBrief  the tasks tool's text: whose words a task's worker is briefed in
 * @property {string} roleField  the agent tool's `role` field
 * @property {string | null} reviewField  the agent tool's `review` field — null where no member reviews: no such field
 * @property {string} byField  a task's `by` field
 * @property {string | null} reviewTaskField  a task's `review` field — null where no review can be: no such field
 */

/** The words for the four members every shipped team has. @type {Readonly<RosterWords>} */
export const SHIPPED_ROSTER_WORDS = Object.freeze({
  roles: "in one role: a scout reads and searches to answer a question; a builder changes code; a tester writes and runs tests; a reviewer reads a change or files and judges them. A scout and a reviewer change nothing.",
  worktree:
    "- A builder and a tester work in their own git worktree when the folder is a repository: their changes reach the folder only when you apply them — worker with their agent_id and apply_changes: true. Apply only work whose report shows its acceptance check passed, or that a reviewer or a tester confirmed.",
  check: CHECK_LINE,
  claim: `${CLAIM}, and check what the report says beyond its check: have a reviewer read the diff, or a tester run more.`,
  graphBy: "the role of the worker that does it",
  graphTask:
    "- Give every task its worker's role, a goal, its steps in order and its acceptance check, and a builder's or a tester's the files it writes. Filament starts its worker by itself once its needs are done and a slot is free, briefs it from these fields, your team's words for its role and what the tasks it needs reported; a builder's or a tester's change that reports done with its check passed waits in its worktree until you apply it. With review: true a reviewer reads that change first, and the changes it asks go back to the same worker, two rounds at most. You do not start or finish a task yourself.",
  toolRoles:
    "in one role, with the session's hands and MCP servers: scout (reads and searches, changes nothing), builder (changes code), tester (writes and runs tests) or reviewer (reads a change or files and judges them, changes nothing).",
  toolWorktree:
    "A builder and a tester work in their own git worktree when the folder is a repository: their changes reach your folder only when you apply them (worker with apply_changes: true). A reviewer's review names the builder or tester whose change, not applied yet, it reads ahead of its brief.",
  applies: "applies the changes a builder or a tester made in its own git worktree to your folder",
  tasksBy: "by (the role of the worker that does it),",
  tasksWho:
    "A scout reads and searches and a reviewer reads and judges: neither changes anything, so neither names writes. A builder changes code and a tester writes and runs tests, each in the files its writes name; with review: true, a reviewer reads its change before it merges, and the changes it asks go back to the same worker, two rounds at most.",
  tasksBrief: "in your team's words for its role",
  roleField: "scout: reads and searches to answer a question. builder: changes code. tester: writes and runs tests. reviewer: reads a change or files and judges them. A scout and a reviewer change nothing.",
  reviewField: "A reviewer's only: the agent_id of the builder or tester whose change, made in its own worktree and not applied yet, the reviewer reads ahead of its brief.",
  byField:
    "The role of its worker, required: a scout (it reads and reports, and names no writes), a builder (it changes the files in writes), a tester (it writes and runs tests, in the files in writes) or a reviewer (it reads and judges, and names no writes).",
  reviewTaskField: "A builder's or a tester's task: true, and a reviewer reads its change before it merges; the changes it asks go back to the same worker, two rounds at most.",
});

/** Members by their tags, as a sentence lists them: `a`, `b` and `c`. @param {readonly Member[]} ms @param {string} [last] */
const named = (ms, last = "and") => listed(ms.map((m) => `\`${m.tag}\``), last);
/** Whether a member's card sits in the team more than once: its members then tell themselves apart by their own lines. @param {readonly Member[]} ms @param {Member} m */
const twice = (ms, m) => ms.filter((x) => memberCard(x) === memberCard(m)).length > 1;
/**
 * A member's line: its tag, its name and what it is good for — its card's line, or the team's own for it where its card
 * sits in the team more than once and the team gives that seat one — and what its work does to the files.
 * @param {Member} m @param {boolean} own
 */
const memberLine = (m, own) => {
  const line = own ? m.line.replace(/\s+/g, " ").trim() : "";
  const good = (line || m.goodFor).replace(/[.\s]+$/, "");
  return `\`${m.tag}\` (${m.name})${good ? `: ${good}` : ""}. It ${doesWords(m)}.`;
};

/**
 * The same sentences for any other list of members, written from their cards.
 * @param {readonly Member[]} ms
 * @returns {Readonly<RosterWords>}
 */
function written(ms) {
  const line = (/** @type {Member} */ m) => memberLine(m, twice(ms, m));
  const ws = ms.filter(writes);
  const rest = ms.filter((m) => !writes(m));
  const rv = reviewersOf(ms);
  const one = ws.length === 1;
  const their = one ? "its" : "their";
  const reviewed = rv.length > 0 && ws.length > 0;
  return Object.freeze({
    roles: `as one of your team's workers, named by its tag:\n${ms.map((m) => `  - ${line(m)}`).join("\n")}`,
    worktree: ws.length
      ? `- ${named(ws)} work${one ? "s" : ""} in ${their} own git worktree when the folder is a repository: ${their} changes reach the folder only when you apply them — worker with ${their} agent_id and apply_changes: true. Apply only work whose report shows its acceptance check passed, or that another worker confirmed.`
      : "- No worker of your team changes the project's files: there is nothing to apply, and what a worker reports is what its task yields.",
    // A team whose members change no file gives no check, and Filament runs none: its claim line is as it was.
    check: ws.length ? CHECK_LINE : null,
    claim: !ws.length
      ? ms.length > 1
        ? "- A report is a claim. Check it before anything builds on it: read what changed, or have another worker read the diff or run the check."
        : "- A report is a claim. Check it before anything builds on it: read what changed."
      : ms.length > 1
        ? `${CLAIM}, and check what the report says beyond its check: read what changed, or have another worker read the diff or run the check.`
        : `${CLAIM}.`,
    graphBy: "the worker of your team that does it, by its tag",
    graphTask: [
      `- Give every task its worker, a goal, its steps in order and its acceptance check${ws.length ? `, and a task of ${named(ws, "or")} the files it writes` : ""}.`,
      `Filament starts its worker by itself once its needs are done and a slot is free, briefs it from these fields, your team's words for that worker and what the tasks it needs reported${ws.length ? "; a change that reports done with its check passed waits in its worktree until you apply it" : ""}.`,
      reviewed ? `With review: true ${named(rv.slice(0, 1))} reads that change first, and the changes it asks go back to the same worker, two rounds at most.` : ws.length ? "No worker of your team reviews, so no task takes a review." : "",
      "You do not start or finish a task yourself.",
    ]
      .filter(Boolean)
      .join(" "),
    toolRoles: `as one of your team's workers, with the session's hands and MCP servers: ${ms.map((m) => `${m.tag} (${doesWords(m)})`).join(", ")}.`,
    toolWorktree: [
      ws.length
        ? `${named(ws)} work${one ? "s" : ""} in ${their} own git worktree when the folder is a repository: ${their} changes reach your folder only when you apply them (worker with apply_changes: true).`
        : "No worker of your team changes the project's files.",
      reviewed ? `A review, for ${named(rv, "or")}, names the worker whose change, not applied yet, it reads ahead of its brief.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    applies: "applies the changes a worker made in its own git worktree to your folder",
    tasksBy: "by (the tag of the worker that does it),",
    tasksWho: [
      rest.length ? `${named(rest)} change${rest.length === 1 ? "s" : ""} nothing that is kept, and name${rest.length === 1 ? "s" : ""} no writes.` : "",
      ws.length
        ? `${named(ws)} change${one ? "s" : ""} the files ${their} writes name${reviewed ? `; with review: true, ${named(rv.slice(0, 1))} reads the change before it merges, and the changes it asks go back to the same worker, two rounds at most` : ""}.`
        : "",
    ]
      .filter(Boolean)
      .join(" "),
    tasksBrief: "in your team's words for that worker",
    roleField: `One of your team's workers, by its tag. ${ms.map(line).join(" ")}`,
    reviewField: reviewed ? `For ${named(rv, "or")} only: the agent_id of the worker whose change, made in its own worktree and not applied yet, it reads ahead of its brief.` : null,
    byField: `The worker that does it, by its tag, required: ${ms.map((m) => `${m.tag} (${writes(m) ? "it changes the files in writes" : "it names no writes"})`).join(", ")}.`,
    reviewTaskField: reviewed ? `A task of ${named(ws, "or")}: true, and ${named(rv.slice(0, 1))} reads its change before it merges; the changes it asks go back to the same worker, two rounds at most.` : null,
  });
}

/** @type {Map<string, Readonly<RosterWords>>} */
const WRITTEN = new Map();
/**
 * A list of members as one word — "" for the four that ship alone: what a frozen set of tools or words is kept under.
 * @param {readonly Member[]} members
 */
export const rosterKey = (members) =>
  isShippedRoster(members) ? "" : `\u0002${members.map((m) => `${m.tag}\u0001${m.name}\u0001${m.goodFor}\u0001${m.may}\u0001${m.place ?? ""}${twice(members, m) ? `\u0001${m.line}` : ""}`).join("\u0002")}`;
/**
 * The sentences that name a team's members: the shipped four's, or the ones written from the cards of any other list.
 * @param {readonly Member[]} members
 * @returns {Readonly<RosterWords>}
 */
export function rosterWords(members) {
  const key = rosterKey(members);
  if (!key) return SHIPPED_ROSTER_WORDS;
  let w = WRITTEN.get(key);
  if (!w) {
    w = written(members);
    WRITTEN.set(key, w);
  }
  return w;
}
