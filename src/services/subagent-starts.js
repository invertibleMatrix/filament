// @ts-check
// The starts of a side agent (HarnessV4_Tasks E13, BW-4): the ways the developer begins one, each a row of the
// launch's own fields. One table, here, so the harness page, the launch route and `/subagent start=` read the same
// one. A start is a shortcut over a card (HarnessV4_Tasks E15 step 4, AG-8): the worker it runs as, a lower "may do"
// where the start needs one, and what it sees. A start only sets the row: whatever the launch names itself wins. It
// changes no session default — what the main agent's own sub-agents get stays their launch's, `subagents.worktree`
// and their kin. Catch me up (HarnessV4_Tasks E15 step 7, AG-206) is the one start that brings its own question.

/**
 * @typedef {object} SubagentStart
 * @property {string} id
 * @property {string} name  as the page says it
 * @property {string} view  a SUBAGENT_VIEWS name: what it sees of the session's finished turns
 * @property {boolean} running  it also sees the turn running at its launch, from that turn's run log
 * @property {"turn" | "uncommitted" | null} changes  it also sees a change as a patch: the last finished turn's, or
 *   everything uncommitted in the session's folder
 * @property {string} worker  the worker card it runs as (services/agent-cards.js)
 * @property {"read" | "copy" | "edit"} may  what it may do in this start: the card's own level, or a lower one
 * @property {boolean} worktree  a writing one works in its own git worktree
 * @property {boolean} deliver  false: its report stays with the developer until they send it on
 * @property {string} [task]  its own question: what it is asked where the launch brings no words
 * @property {"message"} [since]  of the session's finished turns it is shown only those since the developer's last
 *   message — the turn that message began, and what came after
 * @property {boolean} [asks]  the launch asks the card by its tag, so its answer stands in the chat as that card's
 * @property {"warm"} [fork]  where the launch names no view, model or effort, it starts as a live copy of the main agent
 *   while its cache is warm and a fork pays — the conversation read at the cache's price, on the main agent's model and
 *   effort — else as `view` says (the owner's of 11-05)
 */

/** What Catch me up asks. */
export const CATCH_UP_TASK =
  "Catch me up. In five lines, what happened in this session since my last message: what was done, what changed, what failed or waits for me, and what comes next. Plain words; name a file or a command only where it matters.";

/** @type {Readonly<Record<string, Readonly<SubagentStart>>>} */
export const SUBAGENT_STARTS = Object.freeze({
  // "What is it doing?": the session folded, and the running turn; Reviewer reads, never writes.
  ask: Object.freeze({ id: "ask", name: "Ask", view: "folded", running: true, changes: null, worker: "reviewer", may: "read", worktree: false, deliver: false }),
  // "Fix that typo meanwhile": Builder writes, in its own worktree, and what it changed waits for Apply.
  job: Object.freeze({ id: "job", name: "Try it in a copy", view: "folded", running: true, changes: null, worker: "builder", may: "edit", worktree: true, deliver: false }),
  // "Did it really do what it says?": what the last turn changed, as a patch, and nothing of the conversation — a
  // reviewer handed the reasoning behind a change takes it on, and one handed the change alone judges it apart.
  review: Object.freeze({ id: "review", name: "Review my last change", view: "none", running: false, changes: "turn", worker: "reviewer", may: "read", worktree: false, deliver: false }),
  // "What happened while I was away?": a live copy of the main agent while its cache is warm, else the session since
  // your last message, folded, and the turn running now; Reviewer reads, never writes, and its five lines stand in the chat.
  catchup: Object.freeze({ id: "catchup", name: "Catch me up", view: "folded", running: true, changes: null, worker: "reviewer", may: "read", worktree: false, deliver: false, task: CATCH_UP_TASK, since: "message", asks: true, fork: "warm" }),
});

/** The fields of a launch a start sets. */
const START_FIELDS = Object.freeze(/** @type {const} */ (["view", "running", "changes", "worker", "may", "worktree", "deliver"]));

/**
 * A launch's fields under a start: the start's row, each field the launch names itself winning (one left undefined is
 * not named). No start: nothing is set. An unknown start is refused in words. `row`: the start itself, for what no
 * launch names — its own question, since when it sees the session, whether it asks its card.
 * @param {unknown} start @param {Record<string, any>} [given]
 * @returns {{ ok: true, start: string | null, fields: Record<string, any>, row: Readonly<SubagentStart> | null } | { ok: false, error: string }}
 */
export function startFields(start, given = {}) {
  const id = String(start ?? "").trim().toLowerCase();
  if (!id) return { ok: true, start: null, fields: {}, row: null };
  const row = Object.hasOwn(SUBAGENT_STARTS, id) ? SUBAGENT_STARTS[id] : null;
  if (!row) return { ok: false, error: `start must be one of ${Object.keys(SUBAGENT_STARTS).join(", ")}` };
  /** @type {Record<string, any>} */
  const fields = {};
  for (const k of START_FIELDS) fields[k] = given[k] === undefined ? row[k] : given[k];
  return { ok: true, start: id, fields, row };
}
