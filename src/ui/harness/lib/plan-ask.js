// @ts-check
// `/plan [words]` (the owner's of 11-05: "have this slash plan command and this is only gonna ask the agent to plan out
// the whole thing in todo or task graph based on the complexity... maybe show a card asking that graph is ready to view
// which just opens the Plan tab"): the word the box reads, and what the card after the plan's reply says. Pure: the
// card is drawn by conversation/turn.js `planReadyEl`, the line the agent reads is the server's (core/task-graph.js
// `planAskLine`).

/** The command that asks your main agent to plan the work whole before any of it starts. */
export const PLAN_WORD = "/plan";
/** What `/plan` in a team's own chat says: its lead plans there, the team's way. */
export const PLAN_TEAM_CHAT = "A team's own chat runs its lead's plan: type /plan in its main chat";

/**
 * A message's `/plan` words — "" for the word alone — or null for a message that is no `/plan`.
 * @param {string} text
 */
export function planWordsOf(text) {
  const m = /^\/plan(?:\s+([\s\S]*))?$/i.exec(String(text || "").trim());
  return m ? String(m[1] || "").trim() : null;
}

/**
 * How deep a plan goes (the owner's plan mode of 11-06), as the offer's card says each: the server's line ahead of the
 * message says it to the agent (core/task-graph.js `planAskLine`).
 */
export const PLAN_DEPTH_CHOICES = Object.freeze([
  { key: "light", label: "Light", what: "A few tasks, a line each: enough to agree on the order" },
  { key: "standard", label: "Standard", what: "Each task with what it needs, the files it writes and the check that proves it, the plan's summary kept" },
  { key: "deep", label: "Deep", what: "The code mapped widely first, the ways to do it weighed, each task's risks and tests" },
]);

/**
 * What the offer card's Plan sends (11-06): `/plan`, a light or deep plan said after it — `/plan deep` — for the agent
 * to read, as it reads words the person types: nothing reads them back (the owner's of 11-06: not everyone speaks
 * English). Never the message again (the owner's of 11-06: "my whole message got dumped with plan command"): the agent
 * has it right above, and the plan line says a `/plan` with no words of the work plans what their message before it
 * asks. Parallelize tasks goes with it where Settings › Experimental has it on, as with any /plan.
 * @param {string} depth
 */
export function planSendText(depth) {
  return depth === "light" || depth === "deep" ? `${PLAN_WORD} ${depth}` : PLAN_WORD;
}

/** What the offer card's Just do it sends (11-06): a plain go, no planning first — words for the agent, which nothing
 * reads. Its checklist or graph still keeps the work as it goes (the owner's of 11-08), which "no plan" read as none. */
export const JUST_DO_TEXT = "Just do it, no planning first.";
/** What the plan card's Approve sends (11-06): the go the agent reads, and it starts a task — which lets the plan go, as
 * a go in the person's own words, in any language, does. Nothing reads these words. */
export const PLAN_GO_TEXT = "Go — the plan is approved.";

/**
 * What the card says of the plan a `/plan` left (core/task-graph.js `planReadyOf`): its tasks on the graph, else its
 * steps on the checklist, else that it is ready.
 * @param {{ tasks?: number, steps?: number }} ready
 */
export function planReadyWords(ready) {
  const tasks = Number(ready?.tasks) || 0;
  const steps = Number(ready?.steps) || 0;
  if (tasks) return `Your plan is ready: ${tasks} task${tasks === 1 ? "" : "s"} on the task graph`;
  if (steps) return `Your plan is ready: ${steps} step${steps === 1 ? "" : "s"} on the checklist`;
  return "Your plan is ready";
}
