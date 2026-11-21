// @ts-check
// HarnessV3-TaskGraph G3: a team's lead plans on the task graph. In the core (core/task-graph.js — pure, nothing runs):
// the lead's tasks name a worker's role, and a writer's may ask for a review; whoever leads starts a task by what it
// does; a lead does no work itself; a reviewer reads a change before it merges, the changes it asks go back to the same
// worker, two rounds at most, and then the lead decides — merge takes a change as it stands, or the task goes back with
// its reviews in the next worker's brief. Around it, what holds no state: the lead's tasks tool and prompt, a graph
// task's worker's and reviewer's report lines, the team's tools' apply, and /graph
// and the summary's reattach under a team. The core is read through its namespace, so each test of what G3 added fails
// on its own before G3.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as tg from "../src/core/task-graph.js";
import { PROMPT, PROMPT_VERSION, TOOL_TEXT, readAlongReport, systemPromptFor } from "../src/app/agent/prompt.js";
import { SHIPPED_CARDS } from "../src/services/agent-cards.js";
import { LEAD_TASKS_TOOL, REPORT_TOOL, SUBAGENT_OFF, TASKS_TOOL } from "../src/app/agent/tools.js";
import { loopSystem } from "../src/app/agent/system.js";
import { createTeamTools } from "../src/app/agent/team-tools.js";
import { graphCommandReply } from "../src/app/commands/graph.js";
import { backAfterSummary } from "../src/app/sessions/reattach.js";
import { MEMBERS as LED } from "./helpers/roster.js";
import { asV117Prompt, asV116Prompt, asV96Prompt, asV97Prompt, asV98Prompt, asV101Prompt, asV101Tools, asV102Prompt, asV102Tools, asV103Tools, asV110Tools, asV111Tools, asOldRoster, asV68Prompt, asV68Tools, asV74Tools, asV90Tools, asV93Tools, asV75Prompt, asV84Prompt, asV86Prompt, asV90Prompt, teamStore, asV111Prompt } from "./helpers/team.js";

/** @typedef {import("../src/core/task-graph.js").Crew} Crew */
const AT = 1_000;
const sha = (/** @type {string} */ s) => createHash("sha256").update(s).digest("hex");
/** One call that must go through, as `crew` plans — a team's lead unless named. @param {any} g @param {any} input @param {Crew} [crew] @returns {any} */
const ok = (g, input, crew = LED) => {
  const r = tg.applyTasks(g, input, { at: AT, crew });
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r;
};
/** One call that must be refused: its words, the graph left as it was. @param {any} g @param {any} input @param {Crew} [crew] */
const no = (g, input, crew = LED) => {
  const before = JSON.stringify(g);
  const r = tg.applyTasks(g, input, { at: AT, crew });
  assert.equal(r.ok, false, "refused");
  assert.equal(JSON.stringify(g), before, "the graph is left as it was");
  return r.ok ? "" : r.error;
};
/** A value a transition must give. @template T @param {T | null | undefined} v @param {string} what @returns {T} */
const some = (v, what) => {
  assert.ok(v, what);
  return /** @type {T} */ (v);
};
/** @param {string} id @param {string} name @param {string[]} [needs] @param {Record<string, any>} [more] */
const T = (id, name, needs = [], more = {}) => ({ id, name, needs, ...more });
const BRIEF = { goal: "It is done", steps: ["Do it"], acceptance: "the check passes" };
const MAP = T("t1", "Map the parser", [], { by: "scout", goal: "Every caller of parse() is known", steps: ["Search for parse("], acceptance: "each caller is listed" });
const FIX_TASK = T("t2", "Fix the parser", ["t1"], { by: "builder", writes: ["src/parse.js"], review: true, goal: "parse() takes every caller's input", steps: ["Fix parse()", "Run npm test"], acceptance: "npm test passes" });
const TEST_TASK = T("t3", "Test the parser", ["t1"], { by: "tester", writes: ["test/parse.test.js"], goal: "Tests cover each caller's input", steps: ["Write the tests"], acceptance: "the new tests pass" });
/** The parser's graph, a team's way: a scout maps it, a builder fixes it — a reviewer reads its change before it
 *  merges — and a tester tests it. */
const team = () => ok(null, { action: "add", goal: "Ship the parser", tasks: [MAP, FIX_TASK, TEST_TASK] }).graph;
/** A worker's end as the registry hands it over: its run done, its report done with the check passed, nothing
 *  changed. @param {string} agent @param {Record<string, any>} [more] @returns {any} */
const END = (agent, more = {}) => ({ agent, status: "done", stoppedBy: null, error: null, report: { status: "done", did: "Did it.", met: true, evidence: "the check passed", left: "" }, words: "Finished.", files: [], shared: false, wrote: false, workError: null, ran: [], calls: [], written: [], spentUsd: 0.25, ms: 60_000, cut: false, ...more });
const FIX = [{ path: "src/parse.js", added: 12, removed: 3 }];
const FIX_REPORT = { status: "done", did: "parse() takes trailing commas.", met: true, evidence: "npm test: 41 passed", left: "" };
const ASKS = { status: "done", did: "Read src/parse.js against the task.", met: false, evidence: "npm test passes, but an empty input throws", left: "Return [] for an empty input" };
const MET = { status: "done", did: "Read the change again.", met: true, evidence: "npm test: 42 passed; an empty input gives []", left: "" };
const REPORTED = "What sa-2 reported:\nDid: parse() takes trailing commas.\nAcceptance: met — npm test: 41 passed\nFiles: 1 file (+12 −3): src/parse.js";
/** @param {any} g @param {string} id @returns {any} */
const task = (g, id) => g.tasks.find((/** @type {any} */ t) => t.id === id);
/** A task's line in the graph as `crew` reads it. @param {any} g @param {string} id @param {Crew} [crew] */
const lineOf = (g, id, crew = LED) => tg.showText(g, crew).split("\n").find((l) => l.startsWith(`- ${id} `));
/** One task whole, as `crew` reads it. @param {any} g @param {string} id @param {Crew} [crew] @returns {string} */
const shown = (g, id, crew = LED) => ok(g, { action: "show", id }, crew).text;

/** The scout mapped the parser: t2 and t3 are ready. */
const mapped = () => some(tg.taskEnded(some(tg.launched(team(), "t1", "sa-1", 2_000, "scout"), "t1 launches"), "t1", END("sa-1"), 3_000), "t1 ends").graph;
/** t2's builder runs. */
const building = () => some(tg.launched(mapped(), "t2", "sa-2", 4_000, "builder"), "t2 launches");
/** t2's builder reported its fix: its change waits for its reviewer. */
const fixed = () => some(tg.taskEnded(building(), "t2", END("sa-2", { report: FIX_REPORT, files: FIX }), 5_000), "t2 ends").graph;
/** Its reviewer reads round 1. */
const reading = () => some(tg.reviewLaunched(fixed(), "t2", "sa-4"), "the review launches");
/** Round 1 asked for changes, the builder made them and reported again, and its reviewer reads round 2. */
const round2 = () => {
  const asked = some(tg.reviewEnded(reading(), "t2", END("sa-4", { report: ASKS, spentUsd: 0.1 }), 6_000), "round 1 ends").graph;
  const again = some(tg.taskEnded(some(tg.fixLaunched(asked, "t2"), "the fix launches"), "t2", END("sa-2", { report: FIX_REPORT, files: FIX }), 7_000), "the fix ends").graph;
  return some(tg.reviewLaunched(again, "t2", "sa-4"), "round 2 launches");
};
/** The words a reviewer reports by, its last round's or not. @param {string} after */
const reviewAsk = (after) =>
  `When you have read it — or cannot — call report once, then end: status done when you could review it, blocked or failed when you could not (say why in left); did: what you checked; met: true when the change does what the task asks and its check holds, false when it needs changes; evidence: what you read and ran, and what it showed; left: when met is false, each change it needs, one per line — ${after}.`;
const LEAD_CHOICES = "Your choices: send it back — tasks start with its id and a note: its worker goes on where it stopped, in its own conversation, or with fresh: true a new one starts from the folder as it stands; merge its change as it stands — tasks merge with its id and your reason; re-plan around it — change, add or drop tasks; or drop it.";

describe("the core", () => {
  // (fails before: yes — HarnessV3-TaskGraph G3-1: a lead's tasks were its own tracker, every one by you, with no role
  // and no review)
  test("a lead's tasks name a role — required, a writer's with its files, a reader's with none — and review is a writer's alone; the agent's words stay its own", () => {
    /** @param {any} t @param {Crew} [crew] */
    const add = (t, crew = LED) => no(null, { action: "add", goal: "g", tasks: [t] }, crew);
    assert.equal(add(T("t1", "Map it", [], BRIEF)), "t1: by is required: the role of the worker that does the task — scout, builder, tester, reviewer — or command, for a task Filament runs itself");
    assert.equal(add(T("t1", "Map it", [], { by: "explorer", ...BRIEF })), "t1: by is who does the task — scout, builder, tester, reviewer — or command, for a task Filament runs itself");
    assert.equal(add(T("t1", "Map it", [], { by: "you" })), "t1: by is who does the task — scout, builder, tester, reviewer — or command, for a task Filament runs itself", "a lead does no work itself");
    assert.equal(add(T("t1", "Fix it", [], { by: "builder", ...BRIEF })), "t1: a builder's task needs writes: the files it changes, so tasks that run at once stay apart");
    assert.equal(add(T("t1", "Test it", [], { by: "tester", writes: ["test/a.test.js"], goal: "It is done", steps: ["Do it"] })), "t1: a tester's task needs acceptance: the check that proves it done");
    assert.equal(add(T("t1", "Map it", [], { by: "scout", writes: ["a.js"], ...BRIEF })), "t1: a scout changes nothing, so it names no writes — give the task to a builder to change files");
    assert.equal(add(T("t1", "Judge it", [], { by: "reviewer", writes: ["a.js"], ...BRIEF })), "t1: a reviewer changes nothing, so it names no writes — give the task to a builder to change files");
    assert.equal(add(T("t1", "Fix it", [], { by: "builder", writes: ["a.js"], review: "yes", ...BRIEF })), "t1: review is true or false: whether a reviewer reads its change before it merges");
    assert.equal(add(T("t1", "Map it", [], { by: "scout", review: true, ...BRIEF })), "t1: review is a builder's or a tester's: a reviewer reads the change it makes before it merges");
    assert.equal(add(T("t1", "Map it", [], { by: "scout", owner: "me", ...BRIEF })), `t1: owner is no field of a task — its fields are id, name, needs, writes, acceptance, check, by, goal, steps, review, run, items, thread, found_by\nThe call: ${tg.TASK_CALLS.add}`);
    assert.equal(no(team(), { action: "push" }), `action must be one of add, start, done, change, drop, close, show, keep, read, find, merge\n${tg.TASK_CALLS.show} reads the graph; ${tg.TASK_CALLS.add} starts one.`);
    // The agent's words: no role, no review, no merge.
    assert.equal(add(T("t1", "Fix it", [], { by: "builder", writes: ["a.js"], ...BRIEF }), "agent"), "t1: by is who does the task — you, sub-agent, explorer — or command, for a task Filament runs itself");
    assert.equal(add(T("t1", "Fix it", [], { by: "sub-agent", writes: ["a.js"], review: true, ...BRIEF }), "agent"), `t1: review is no field of a task — its fields are id, name, needs, writes, acceptance, check, by, goal, steps, run, items, thread, found_by, under\nThe call: ${tg.TASK_CALLS.add}`);
    assert.equal(no(team(), { action: "merge", id: "t2", reason: "r" }, "agent"), `action must be one of add, start, pause, done, change, drop, close, show, keep, read, find, offer, parallel\n${tg.TASK_CALLS.show} reads the graph; ${tg.TASK_CALLS.add} starts one.`);
    const g = team();
    assert.deepEqual(
      g.tasks.map((/** @type {any} */ t) => [t.id, t.by, t.review, t.ranAs, t.reviews, t.reviewer, t.step, t.overruled]),
      [
        ["t1", "scout", false, null, [], null, null, ""],
        ["t2", "builder", true, null, [], null, null, ""],
        ["t3", "tester", false, null, [], null, null, ""],
      ],
    );
    // A writer keeps its review through a change; given to a reader, the task leaves it behind.
    assert.equal(task(ok(g, { action: "change", tasks: [{ id: "t2", writes: ["src/parse.js", "src/lex.js"] }] }).graph, "t2").review, true);
    const read = task(ok(g, { action: "change", tasks: [{ id: "t2", by: "scout", writes: [] }] }).graph, "t2");
    assert.deepEqual([read.by, read.review], ["scout", false]);
    assert.equal(no(g, { action: "change", tasks: [{ id: "t2", by: "scout", writes: [], review: true }] }), "t2: review is a builder's or a tester's: a reviewer reads the change it makes before it merges");
  });

  // (fails before: yes — HarnessV3-TaskGraph G3-2: nothing named what ran a task, and a graph read one way only)
  test("whoever leads starts a task by what it does — the agent's sub-agent and explorer are a team's builder and scout, and back — and reads who does it in its own words", () => {
    const BY = /** @type {const} */ (["you", "sub-agent", "explorer", "scout", "builder", "tester", "reviewer"]);
    // A task that changes files names them (`writes`), and one that reads names none: what it does is read there.
    const WRITES = ["sub-agent", "builder", "tester"];
    const taskBy = (/** @type {string} */ by) => ({ by, writes: WRITES.includes(by) ? ["src/parse.js"] : [] });
    assert.deepEqual(BY.map((by) => tg.runsAs(taskBy(by), LED)), ["you", "builder", "scout", "scout", "builder", "tester", "reviewer"]);
    assert.deepEqual(BY.map((by) => tg.runsAs(taskBy(by), "agent")), ["you", "sub-agent", "explorer", "explorer", "sub-agent", "sub-agent", "explorer"]);
    /** Who does a task, as `crew` reads it. @param {any} g @param {string} id @param {Crew} crew */
    const byLine = (g, id, crew) => shown(g, id, crew).split("\n")[1];
    const planned = ok(null, { action: "add", goal: "Ship the parser", tasks: [T("t1", "Map the parser", [], { by: "explorer", ...BRIEF }), T("t2", "Fix the parser", ["t1"], { by: "sub-agent", writes: ["src/parse.js"], ...BRIEF })] }, "agent").graph;
    assert.equal(byLine(planned, "t1", LED), "By: an explorer as the agent planned it (a scout of your team does it under you) — Filament starts it once its needs are done");
    assert.equal(byLine(planned, "t2", LED), "By: a sub-agent as the agent planned it (a builder of your team does it under you) — Filament starts it once its needs are done");
    assert.equal(byLine(planned, "t1", "agent"), "By: an explorer, a sub-agent that changes nothing — Filament starts it once its needs are done");
    assert.equal(byLine(planned, "t2", "agent"), "By: a sub-agent — Filament starts it once its needs are done");
    const g = team();
    assert.equal(byLine(g, "t1", LED), "By: a scout of your team, which changes nothing — Filament starts it once its needs are done");
    assert.equal(byLine(g, "t2", LED), "By: a builder of your team — Filament starts it once its needs are done");
    assert.equal(byLine(g, "t1", "agent"), "By: a scout as a team's lead planned it (an explorer does it under you) — Filament starts it once its needs are done");
    assert.equal(byLine(g, "t3", "agent"), "By: a tester as a team's lead planned it (a sub-agent does it under you) — Filament starts it once its needs are done");
    // What ran a task stays with it: the agent's explorer ran under a lead as its scout.
    const ran = some(tg.launched(planned, "t1", "sa-1", 2_000, "scout"), "t1 launches");
    assert.deepEqual([task(ran, "t1").ranAs, task(ran, "t1").tries], ["scout", 1]);
    assert.equal(tg.startedText(ran, ["t1"]), "Filament started t1 on a scout (sa-1). Now: 0 of 2 done · running: t1.");
  });

  // (fails before: yes — HarnessV3-TaskGraph G3-1, G3-2: a lead started and ended its own tasks, as the agent does)
  test("a lead does no work itself: it starts none of the agent's own tasks and ends no worker's; given a role, the agent's own — even one it left running — waits for its worker", () => {
    const planned = ok(null, { action: "add", goal: "Ship the parser", tasks: [T("t1", "Read the issue"), T("t2", "Update the docs", ["t1"], { writes: ["docs/"] }), T("t3", "Fix the parser", [], { by: "sub-agent", writes: ["src/parse.js"], ...BRIEF })] }, "agent").graph;
    const running = ok(planned, { action: "start", ids: ["t1"] }, "agent").graph;
    assert.equal(no(running, { action: "start", ids: ["t2"] }), "t2 is the agent's own task, and a lead does no work itself — give it a role (tasks change with by), and Filament starts its worker");
    assert.equal(no(running, { action: "done", id: "t3", summary: "x" }), "t3 is a sub-agent's task: its worker's report ends it");
    assert.equal(lineOf(running, "t2"), `- t2 "Update the docs" — waiting · the agent's own: give it a role, or drop it · needs t1 · writes docs/`);
    assert.equal(lineOf(running, "t2", "agent"), `- t2 "Update the docs" — waiting · needs t1 · writes docs/`);
    // One the agent found done, the lead may mark so.
    assert.equal(ok(running, { action: "done", id: "t1", summary: "Read it." }).text, "Done: t1. Ready now: t2. 1 of 3 done · ready: t3.");
    // Given a role, the agent's running task waits for its worker — its needs may change too; under the agent both may
    // change as well since g1 (the owner's of 11-09), the answer saying which.
    const given = ok(running, { action: "change", tasks: [{ id: "t1", by: "scout", ...BRIEF }] });
    const waits = "t1 was running, and is a scout's task now: it waits, and Filament starts it once its needs are done.";
    assert.deepEqual([task(given.graph, "t1").state, task(given.graph, "t1").startedAt, given.text], ["waiting", null, `Changed t1. ${waits} 0 of 3 done · ready: t1, t3.`]);
    assert.equal(ok(running, { action: "change", tasks: [{ id: "t1", needs: ["t3"], by: "scout", ...BRIEF }] }).text, `Changed t1. ${waits} 0 of 3 done · ready: t3.`);
    assert.match(ok(running, { action: "change", tasks: [{ id: "t1", by: "explorer", ...BRIEF }] }, "agent").text, /^Changed t1\. t1 was running, and is an explorer's task now: it waits/);
    assert.match(ok(running, { action: "change", tasks: [{ id: "t1", needs: ["t3"] }] }, "agent").text, /^Changed t1\. t1 runs on, needing t3 now: t3 is not done, and a need holds back a start, not work begun\. /);
  });

  // (fails before: yes — HarnessV3-TaskGraph G3-3: a writer's change merged as its worker reported, read by nobody)
  test("a writer's change goes to a reviewer before it merges; the changes it asks go back to the same worker, the next round reads the change again — then it is ready, and merges once the lead applies it", () => {
    assert.deepEqual(tg.jobs(mapped()), [{ id: "t2", kind: "start" }, { id: "t3", kind: "start" }]);
    assert.equal(tg.startedText(building(), ["t2"]), "Filament started t2 on a builder (sa-2). Now: 1 of 3 done · running: t2 · ready: t3.");
    const ended = some(tg.taskEnded(building(), "t2", END("sa-2", { report: FIX_REPORT, files: FIX }), 5_000), "t2 ends");
    assert.equal(ended.state, "review");
    let g = ended.graph;
    assert.deepEqual([task(g, "t2").state, task(g, "t2").step, task(g, "t2").reviewer, task(g, "t2").reviews], ["review", "queued", null, []]);
    assert.deepEqual(tg.jobs(g), [{ id: "t2", kind: "review" }, { id: "t3", kind: "start" }], "a review that waits comes before new work");
    assert.deepEqual([tg.busy(g), tg.graphView(g)?.counts.review], [false, 1], "nothing holds the review until its reviewer starts");
    assert.equal(lineOf(g, "t2"), `- t2 "Fix the parser" — in review (round 1 of 2): its reviewer starts next · by builder, with review · needs t1 · writes src/parse.js`);
    assert.equal(
      tg.reviewBrief(g, "t2", LED),
      [
        "You review one task's change, in a larger piece of work which your team's lead planned as a task graph: its builder, sa-2, made the change above in its own worktree and reported the task done. Read the change against the task, and judge whether it does what the task asks. You change nothing: read, search, and run only what reads.",
        "The work: Ship the parser",
        "The task: t2 — Fix the parser",
        "Goal: parse() takes every caller's input",
        "Files it may change:\n- src/parse.js",
        "Steps:\n1. Fix parse()\n2. Run npm test",
        "Acceptance check: npm test passes",
        REPORTED,
        reviewAsk("its builder makes them, and you read the change again"),
      ].join("\n\n"),
    );
    assert.match(tg.reviewBrief(g, "t2", "agent"), /^You review one task's change, in a larger piece of work which the agent you work for planned as a task graph: its builder, sa-2, /);
    g = some(tg.reviewLaunched(g, "t2", "sa-4"), "the review launches");
    assert.equal(tg.reviewLaunched(g, "t2", "sa-5"), null, "one reviewer reads at a time");
    assert.deepEqual([task(g, "t2").step, task(g, "t2").reviewer, tg.busy(g), tg.agentsAtWork(g)], ["reading", "sa-4", true, ["sa-4"]]);
    assert.equal(lineOf(g, "t2"), `- t2 "Fix the parser" — in review (round 1 of 2) by sa-4 · by builder, with review · needs t1 · writes src/parse.js`);
    // Round 1 asks for changes: they go back to sa-2, in the conversation it has.
    const asked = some(tg.reviewEnded(g, "t2", END("sa-4", { report: ASKS, spentUsd: 0.1 }), 6_000), "round 1 ends");
    assert.equal(asked.state, "review");
    g = asked.graph;
    assert.deepEqual(task(g, "t2").reviews, [{ round: 1, agent: "sa-4", status: "done", met: false, did: ASKS.did, evidence: ASKS.evidence, left: ASKS.left, words: "", spentUsd: 0.1, endedAt: 6_000 }]);
    assert.deepEqual([task(g, "t2").step, task(g, "t2").spentUsd, tg.jobs(g)], ["asked", 0.35, [{ id: "t2", kind: "fix" }, { id: "t3", kind: "start" }]]);
    assert.equal(lineOf(g, "t2"), `- t2 "Fix the parser" — its review asked for changes (round 1 of 2): they go to sa-2 next · by builder, with review · needs t1 · writes src/parse.js`);
    assert.equal(
      tg.fixText(g, "t2"),
      [
        "[Filament: a reviewer read your change for task t2 — round 1 of 2 — and asks for changes:",
        "Return [] for an empty input",
        "What it checked: Read src/parse.js against the task.",
        "What it found: npm test passes, but an empty input throws",
        "Make them in your task's files alone — your worktree holds your change as you left it — run the acceptance check again, then call report once more: your change is read again before it goes into the project.]",
      ].join("\n\n"),
    );
    g = some(tg.fixLaunched(g, "t2"), "the fix launches");
    assert.equal(tg.fixLaunched(g, "t2"), null);
    assert.deepEqual([task(g, "t2").state, task(g, "t2").step, task(g, "t2").agent, task(g, "t2").tries], ["running", null, "sa-2", 1], "the same worker, on the same try");
    assert.equal(lineOf(g, "t2"), `- t2 "Fix the parser" — fixing its review (round 1 of 2) on sa-2 · by builder, with review · needs t1 · writes src/parse.js`);
    // The worker reports again: round 2 reads its change whole, in the reviewer's conversation.
    g = some(tg.taskEnded(g, "t2", END("sa-2", { report: FIX_REPORT, files: FIX }), 7_000), "the fix ends").graph;
    assert.deepEqual([task(g, "t2").state, task(g, "t2").step, task(g, "t2").reviews.length], ["review", "queued", 1]);
    assert.equal(lineOf(g, "t2"), `- t2 "Fix the parser" — in review (round 2 of 2): its reviewer starts next · by builder, with review · needs t1 · writes src/parse.js`);
    g = some(tg.reviewLaunched(g, "t2", "sa-4"), "round 2 launches");
    const change = '<change of="sa-2" files="1">\nthe diff\n</change>';
    assert.equal(
      tg.reviewAgainText(g, "t2", change, LED),
      [
        "[Filament: sa-2 made the changes you asked for task t2 and reported it done again — round 2 of 2. Its change, whole as it stands now:",
        change,
        REPORTED,
        `${reviewAsk("this is the last round: what you ask goes to your lead, who decides")}]`,
      ].join("\n\n"),
    );
    assert.match(tg.reviewAgainText(g, "t2", change, "agent"), /this is the last round: what you ask goes to the agent, who decides\.\]$/);
    // Met: its change is ready, waiting for the lead's apply (the owner's of 11-02); applied, it merges.
    const met = some(tg.reviewEnded(g, "t2", END("sa-4", { report: MET, spentUsd: 0.1 }), 8_000), "round 2 ends");
    assert.equal(met.state, "yours");
    assert.deepEqual([tg.mergeNext(met.graph), task(met.graph, "t2").step, tg.busy(met.graph)], [null, "yours", false]);
    assert.match(tg.endText(met.graph, "t2", { crew: LED }), /^\[Filament: task t2 "Fix the parser" is ready: builder sa-2 .* its reviewer found the change does what the task asks\. Its change waits in sa-2's own copy, not in the folder yet: apply it when you choose — worker with agent_id "sa-2" and apply_changes: true\./);
    const applying = /** @type {any} */ (some(tg.applyAsked(met.graph, "sa-2"), "the lead applies it"));
    assert.deepEqual([tg.mergeNext(applying.graph), task(applying.graph, "t2").step], ["t2", null]);
    const done = some(tg.taskMerged(applying.graph, "t2", FIX, 9_000), "t2 merges");
    assert.deepEqual([task(done, "t2").state, task(done, "t2").summary, task(done, "t2").spentUsd, task(done, "t2").merged], ["done", FIX_REPORT.did, 0.7, { files: 1, added: 12, removed: 3 }]);
    assert.equal(
      tg.endText(done, "t2", { crew: LED }),
      [
        `[Filament: task t2 "Fix the parser" is done: builder sa-2 reported it done with its acceptance check passed — unchecked: the task has no check, and its report named none — its reviewer found the change does what the task asks, and its change is merged into the folder.`,
        "Did: parse() takes trailing commas.",
        "Acceptance: met — npm test: 41 passed",
        "Files: 1 file (+12 −3): src/parse.js",
        "Review, round 1 of 2, by sa-4: it asks for changes",
        "Checked: Read src/parse.js against the task.",
        "Found: npm test passes, but an empty input throws",
        "Asked: Return [] for an empty input",
        "Review, round 2 of 2, by sa-4: the change does what the task asks",
        "Checked: Read the change again.",
        "Found: npm test: 42 passed; an empty input gives []",
        "Now: 2 of 3 done · ready: t3.]",
      ].join("\n"),
    );
  });

  // (fails before: yes — HarnessV3-TaskGraph G3-3, G3-4: no review, no last round, no merge of a change as it stood)
  test("at the last round a review that still asks fails the task, and the lead decides: merge takes the change as it stands, on its word — or it goes back, its reviews in the next worker's brief", () => {
    const LAST = { ...ASKS, did: "Read it again.", left: "Return [] for whitespace too" };
    const r = some(tg.reviewEnded(round2(), "t2", END("sa-4", { report: LAST, spentUsd: 0.1 }), 8_000), "round 2 ends");
    assert.equal(r.state, "failed");
    const failed = r.graph;
    assert.deepEqual([task(failed, "t2").why, task(failed, "t2").step, task(failed, "t2").reviews.map((/** @type {any} */ x) => x.met)], ["its review still asked for changes at round 2 of 2: Return [] for whitespace too", null, [false, false]]);
    assert.equal(
      tg.endText(failed, "t2", { crew: LED }),
      [
        `[Filament: task t2 "Fix the parser" failed: its review still asked for changes at round 2 of 2: Return [] for whitespace too.`,
        "Did: parse() takes trailing commas.",
        "Acceptance: met — npm test: 41 passed",
        "Files: 1 file (+12 −3): src/parse.js",
        "Review, round 1 of 2, by sa-4: it asks for changes",
        "Checked: Read src/parse.js against the task.",
        "Found: npm test passes, but an empty input throws",
        "Asked: Return [] for an empty input",
        "Review, round 2 of 2, by sa-4: it asks for changes",
        "Checked: Read it again.",
        "Found: npm test passes, but an empty input throws",
        "Asked: Return [] for whitespace too",
        "Its change is not in the folder: it waits in builder sa-2's own worktree — tasks merge takes it as it stands.",
        LEAD_CHOICES,
        "Now: 1 of 3 done · failed: t2 · ready: t3.]",
      ].join("\n"),
    );
    // The lead's word: the change merges as it stands.
    const m = ok(failed, { action: "merge", id: "t2", reason: "The whitespace case is out of scope" });
    assert.equal(m.text, "Merging t2's change as it stands, on your word. 1 of 3 done · merging: t2 · ready: t3.");
    assert.deepEqual([task(m.graph, "t2").state, task(m.graph, "t2").why, task(m.graph, "t2").overruled, tg.mergeNext(m.graph)], ["merging", "", "The whitespace case is out of scope", "t2"]);
    const merged = some(tg.taskMerged(m.graph, "t2", FIX, 9_000), "t2 merges");
    assert.equal(task(merged, "t2").summary, "parse() takes trailing commas.\nMerged as it stood, on the lead's word: The whitespace case is out of scope");
    assert.equal(tg.endText(merged, "t2", { crew: LED }).split("\n")[0], `[Filament: task t2 "Fix the parser" is done: builder sa-2's change is merged into the folder as it stood, on your word.`);
    assert.deepEqual(shown(merged, "t2").split("\n").filter((l) => l.startsWith("Merged")), ["Merged: 1 file (+12 −3)", "Merged as it stood, on the lead's word: The whitespace case is out of scope"]);
    // Or it goes back to its worker, which goes on in its own conversation and reads what its reviewer asked, round by
    // round (HarnessV3-FailurePoints §6 item 2).
    const goesOn = ok(failed, { action: "start", ids: ["t2"], note: "Treat whitespace as empty" });
    assert.equal(goesOn.text, "Sent t2 back: builder sa-2 goes on with it once its needs are done and a slot is free, in its own conversation — what it did is there, and it reads what failed and your note. 1 of 3 done · ready: t2, t3.");
    assert.deepEqual(tg.resumeText(goesOn.graph, "t2", LED).split("\n\n").slice(0, 5), [
      "[Filament: your try at task t2 ended: its review still asked for changes at round 2 of 2: Return [] for whitespace too. Your lead sent the task back to you: go on from where you stopped — your work so far is above. Your worktree holds your change as you left it.",
      "Your reviewer asked for changes:\n- round 1: Return [] for an empty input\n- round 2: Return [] for whitespace too",
      "Your lead's note for you: Treat whitespace as empty",
      "Your task as it stands now: t2 — Fix the parser",
      `Goal: ${task(failed, "t2").goal}`,
    ]);
    // Or, fresh, to a new worker: its brief carries the try and what its reviewer asked, round by round.
    const back = ok(failed, { action: "start", ids: ["t2"], note: "Treat whitespace as empty", fresh: true });
    assert.equal(back.text, "Sent t2 back: a new worker takes it once its needs are done and a slot is free, with the earlier try and your note in its brief. 1 of 3 done · ready: t2, t3.");
    const t2 = task(back.graph, "t2");
    assert.deepEqual([t2.state, t2.reviews, t2.reviewer, t2.step, t2.earlier.agent, t2.earlier.ranAs, t2.earlier.reviews.length], ["waiting", [], null, null, "sa-2", "builder", 2]);
    const brief = tg.briefText(back.graph, "t2", LED);
    assert.ok(brief.startsWith("You do one task of a larger piece of work, which your team's lead planned as a task graph. Work on this task alone.\n\n"), brief);
    assert.ok(
      brief.includes(
        [
          "An earlier try at this task ended: its review still asked for changes at round 2 of 2: Return [] for whitespace too.",
          "Did: parse() takes trailing commas.",
          "Acceptance: met — npm test: 41 passed",
          "Files: 1 file (+12 −3): src/parse.js",
          "Its reviewer asked for changes:",
          "- round 1: Return [] for an empty input",
          "- round 2: Return [] for whitespace too",
          "You start from the project as it stands now, without that try's change: build on what it learned, and avoid what went wrong.",
        ].join("\n"),
      ),
      brief,
    );
    assert.ok(brief.includes("\n\nYour lead's note for you: Treat whitespace as empty\n\n"), brief);
    assert.ok(brief.endsWith("when you report done with the check passed, a reviewer reads your change, and it goes into the project once it does what the task asks. Your task has no check: in checked, name the commands that prove it done — the tests you ran, each exactly as you ran it. Filament runs them again in your worktree before your lead hears your report, sends the task back to you if one fails, and keeps them as your task's check, guarding the project after your change goes in. Leave checked out only where no command can check your change."), brief);
    const whole = shown(back.graph, "t2");
    assert.ok(whole.includes("\nYour note for its worker: Treat whitespace as empty\n"), whole);
    assert.ok(whole.includes("\nBefore that, builder sa-2 ended: its review still asked for changes at round 2 of 2: Return [] for whitespace too\nReview, round 1 of 2, by sa-4: it asks for changes\n"), whole);
    const again = some(tg.launched(back.graph, "t2", "sa-5", 10_000, "builder"), "t2 launches again");
    assert.deepEqual([task(again, "t2").tries, task(again, "t2").agent, task(again, "t2").reviews], [2, "sa-5", []]);
  });

  // (fails before: yes — HarnessV3-TaskGraph G3-4: there was no merge)
  test("merge takes one failed task whose change waits, with the lead's reason — refused in words otherwise; a merge that fails keeps no word of the lead's", () => {
    const g = mapped();
    // Each refusal of its shape ends with the call to copy (the Hunter on E40).
    const call = '\nThe call: {"action":"merge","id":"t2","reason":"why it goes in as it stands"}';
    assert.equal(no(g, { action: "merge" }), `merge needs id: the failed task whose change goes into the folder as it stands, with your reason${call}`);
    assert.equal(no(g, { action: "merge", ids: ["t2", "t3"], reason: "r" }), `merge takes one task at a time, each with its own reason — call it once a task${call}`);
    assert.equal(no(g, { action: "merge", id: "t2" }), `merge needs reason: why its change goes in as it stands${call}`);
    assert.equal(no(g, { action: "merge", id: "t9", reason: "r" }), "t9 is no task in the graph");
    assert.equal(no(g, { action: "merge", id: "t3", reason: "r" }), "t3 is waiting — merge takes a failed task whose change waits in its worker's worktree");
    assert.equal(no(g, { action: "merge", id: "t1", reason: "r" }), "t1 is done — merge takes a failed task whose change waits in its worker's worktree");
    assert.equal(no(fixed(), { action: "merge", id: "t2", reason: "r" }), "t2 is in review — merge takes a failed task whose change waits in its worker's worktree");
    assert.equal(no({ ...g, closed: { at: 1, reason: "Shipped" } }, { action: "merge", id: "t2", reason: "r" }), "the graph is closed (Shipped) — tasks add starts a new one, with its goal");
    // A reader's failure, and a writer's that never ran, leave no change to merge.
    const scout = some(tg.taskEnded(some(tg.launched(team(), "t1", "sa-1", 2_000, "scout"), "t1 launches"), "t1", END("sa-1", { report: { ...FIX_REPORT, status: "blocked", left: "No access" } }), 3_000), "t1 ends").graph;
    assert.equal(no(scout, { action: "merge", id: "t1", reason: "r" }), "t1 left no change waiting to merge — send it back, re-plan around it, or drop it");
    const refused = some(tg.launchRefused(g, "t3", "no route serves the tester", 4_000, "tester"), "t3 is refused");
    assert.equal(task(refused, "t3").why, "Filament could not start its tester: no route serves the tester");
    assert.equal(no(refused, { action: "merge", id: "t3", reason: "r" }), "t3 left no change waiting to merge — send it back, re-plan around it, or drop it");
    // A merge that fails: the task fails in the apply's words, and says no more that the lead overruled anything.
    const failed = some(tg.reviewEnded(round2(), "t2", END("sa-4", { report: ASKS }), 8_000), "round 2 ends").graph;
    const merging = ok(failed, { action: "merge", id: "t2", reason: "Good enough" }).graph;
    const conflict = some(tg.taskMergeFailed(merging, "t2", "1 file does not come through cleanly", 9_000), "the merge fails");
    assert.deepEqual([task(conflict, "t2").state, task(conflict, "t2").why, task(conflict, "t2").overruled], ["failed", "its change did not merge: 1 file does not come through cleanly", ""]);
    assert.equal(shown(conflict, "t2").includes("on the lead's word"), false);
  });

  // (fails before: yes — HarnessV3-TaskGraph G3-3: there was no review to fail, stop, cut, drop or wait for)
  test("a review that could not be made fails its task in words; the developer's stop puts it back until the next tasks call; a restart, a drop and a change find it", () => {
    // A step Filament could not start.
    const notStarted = some(tg.reviewStepRefused(fixed(), "t2", "the session runs 4 sub-agents already", 6_000), "refused");
    assert.deepEqual([task(notStarted, "t2").state, task(notStarted, "t2").step, task(notStarted, "t2").why], ["failed", null, "its review could not start: the session runs 4 sub-agents already"]);
    const asked = some(tg.reviewEnded(reading(), "t2", END("sa-4", { report: ASKS }), 6_000), "round 1 ends").graph;
    assert.equal(task(some(tg.reviewStepRefused(asked, "t2", "sub-agent sa-2 is still working", 7_000), "refused"), "t2").why, "the changes its review asked for could not reach its builder: sub-agent sa-2 is still working");
    assert.equal(tg.reviewStepRefused(reading(), "t2", "x", 7_000), null, "its reviewer started");
    // A review that could not be made: its round is kept, and the task fails.
    /** @param {Record<string, any>} more */
    const unmade = (more) => some(tg.reviewEnded(reading(), "t2", END("sa-4", more), 6_000), "the review ends");
    const blocked = unmade({ report: { ...ASKS, status: "blocked", left: "The diff is empty" } });
    assert.deepEqual([blocked.state, task(blocked.graph, "t2").why], ["failed", "its review could not be made: its reviewer reported blocked: The diff is empty"]);
    assert.ok(shown(blocked.graph, "t2").includes("\nReview, round 1 of 2, by sa-4: it reported blocked\nChecked: Read src/parse.js against the task.\n"));
    const silent = unmade({ report: null, words: "I read it." });
    assert.equal(task(silent.graph, "t2").why, "its review could not be made: its reviewer ended without its report");
    assert.ok(shown(silent.graph, "t2").includes("\nReview, round 1 of 2, by sa-4: it gave no report\nIts last words: I read it.\n"));
    assert.equal(task(unmade({ status: "failed", error: "upstream 500", report: null }).graph, "t2").why, "its review could not be made: its reviewer's run failed (upstream 500)");
    assert.equal(task(unmade({ status: "aborted", cut: true, report: null }).graph, "t2").why, "its review was cut by a Filament restart");
    assert.equal(tg.reviewEnded(reading(), "t2", END("sa-9"), 6_000), null, "not its reviewer's end");
    assert.equal(tg.reviewEnded(fixed(), "t2", END("sa-4"), 6_000), null, "no reviewer reads it yet");
    // The developer's stop: the review waits, held until the next tasks call, and nothing is kept of the round.
    const stopped = unmade({ status: "stopped", stoppedBy: "harness", report: null, spentUsd: 0.05 });
    assert.equal(stopped.state, "review");
    const s = task(stopped.graph, "t2");
    assert.deepEqual([s.step, s.stopped, s.reviews, s.reviewer, s.spentUsd], ["queued", "developer", [], "sa-4", 0.3]);
    assert.deepEqual(tg.jobs(stopped.graph), [{ id: "t3", kind: "start" }]);
    assert.equal(lineOf(stopped.graph, "t2"), `- t2 "Fix the parser" — in review (round 1 of 2), stopped by the developer · by builder, with review · needs t1 · writes src/parse.js`);
    assert.equal(
      tg.endText(stopped.graph, "t2", { crew: LED }),
      [
        `[Filament: the developer stopped the review of task t2 "Fix the parser", round 1 of 2. The review waits: Filament starts it again after your next tasks call.`,
        "Did: parse() takes trailing commas.",
        "Acceptance: met — npm test: 41 passed",
        "Files: 1 file (+12 −3): src/parse.js",
        "Now: 1 of 3 done · in review: t2 · ready: t3.]",
      ].join("\n"),
    );
    assert.deepEqual(tg.jobs(tg.release(stopped.graph, { crew: LED, resumable: () => null })), [{ id: "t2", kind: "review" }, { id: "t3", kind: "start" }], "the next tasks call lets it go");
    // A restart fails a review it cut, read or not; a drop stops the reviewer that reads; a change waits for its end.
    for (const g of [fixed(), reading()]) {
      const cut = some(tg.restartCut(g, 9_000), "the restart cut it");
      assert.deepEqual([cut.ids, task(cut.graph, "t2").state, task(cut.graph, "t2").why], [["t2"], "failed", "cut by a Filament restart in its review — its change waits in its builder's worktree"]);
    }
    assert.deepEqual(tg.agentsToStop(reading(), ok(reading(), { action: "drop", ids: ["t2"], reason: "Not needed" }).graph), ["sa-4"]);
    assert.deepEqual(tg.agentsToStop(fixed(), ok(fixed(), { action: "drop", ids: ["t2"], reason: "Not needed" }).graph), []);
    assert.equal(no(fixed(), { action: "change", tasks: [{ id: "t2", name: "Fix it" }] }), "t2 is in review — wait for its end, or drop it");
    assert.equal(no(building(), { action: "change", tasks: [{ id: "t2", name: "Fix it" }] }), "t2 is with its builder now — wait for its end, or drop it");
  });

  // (fails before: no — a guard the mutation pass asked for: no test stopped a worker that made the changes its review
  // asked, so nothing showed that review kept with the stopped try)
  test("the developer's stop of a worker making the changes its review asked keeps the review with that try: the lead's words and the next worker's brief carry it", () => {
    const asked = some(tg.reviewEnded(reading(), "t2", END("sa-4", { report: ASKS, spentUsd: 0.1 }), 6_000), "round 1 ends").graph;
    const fixing = some(tg.fixLaunched(asked, "t2"), "the fix launches");
    const stopped = some(tg.taskEnded(fixing, "t2", END("sa-2", { status: "stopped", stoppedBy: "harness", report: null }), 7_000), "the stop ends it").graph;
    const t2 = task(stopped, "t2");
    assert.deepEqual([t2.state, t2.reviews, t2.earlier.reviews.map((/** @type {any} */ r) => [r.round, r.left])], ["waiting", [], [[1, ASKS.left]]]);
    assert.ok(tg.endText(stopped, "t2", { crew: LED }).includes("\nReview, round 1 of 2, by sa-4: it asks for changes\n"));
    assert.ok(tg.briefText(stopped, "t2", LED).includes("\nIts reviewer asked for changes:\n- round 1: Return [] for an empty input\n"));
  });

  // (fails before: yes — HarnessV4_Tasks B11: a lead's own stop of a task's worker failed the task — counted as a
  // failure, with a failed task's choices — where the developer's Stop made it wait)
  test("a lead's own stop of a task's worker sets the task aside: it waits, its try kept, and the worker goes on with it after the lead's next tasks call; a stopped review waits the same way", () => {
    const r = some(tg.taskEnded(building(), "t2", END("sa-2", { status: "stopped", stoppedBy: "lead", report: null, words: "I was fixing parse().", files: FIX }), 5_000), "t2 ends");
    const t2 = task(r.graph, "t2");
    assert.deepEqual([r.state, t2.state, t2.stopped, t2.why, t2.failures, t2.earlier.agent, t2.earlier.why, t2.earlier.stopped], ["stopped", "waiting", "lead", "", null, "sa-2", "stopped by its lead", "lead"]);
    assert.ok(!tg.jobs(r.graph).some((/** @type {any} */ j) => j.id === "t2"), "set aside: Filament starts it by itself no more");
    const said = tg.endText(r.graph, "t2", { crew: LED }).split("\n");
    assert.equal(said[0], `[Filament: you stopped builder sa-2 on task t2 "Fix the parser". The task waits again: after your next tasks call sa-2 goes on with it where it stopped, in its own conversation — or a new worker takes it, with what this one did in its brief: tasks start with its id and fresh: true.`);
    assert.ok(!said.some((l) => l.startsWith("Your choices:")), "no failed task's choices");
    assert.match(said.at(-1) || "", /stopped: t2/);
    assert.ok(tg.openGraphText(r.graph, LED)?.includes("stopped by its lead"), "the graph's own words say whose stop");
    const let_go = /** @type {any} */ (tg.release(r.graph, { crew: LED, resumable: () => null }));
    assert.deepEqual([task(let_go, "t2").stopped, task(let_go, "t2").resume], [false, "sa-2"]);
    assert.match(tg.resumeText(let_go, "t2", LED), /^\[Filament: your lead stopped you on task t2\. The task is yours again: go on from where you stopped/);
    // Its review, stopped by the lead: it waits for the next tasks call, as one the developer stopped does.
    const review = some(tg.reviewEnded(reading(), "t2", END("sa-4", { status: "stopped", stoppedBy: "lead", report: null }), 6_000), "the review ends");
    assert.deepEqual([review.state, task(review.graph, "t2").step, task(review.graph, "t2").stopped], ["review", "queued", "lead"]);
    assert.match(tg.endText(review.graph, "t2", { crew: LED }), /^\[Filament: you stopped the review of task t2 /);
  });

  // (fails before: yes — ag-stop, the owner's of 11-11: a stop in the agent's name of a review's reader failed its task,
  // "its review could not be made: its reviewer's run was stopped")
  test("the agent's own stop of a review's reader puts the review back, as the developer's and a lead's do, said as the agent's", () => {
    const review = some(tg.reviewEnded(reading(), "t2", END("sa-4", { status: "stopped", stoppedBy: "agent", report: null }), 6_000), "the review ends");
    assert.deepEqual([review.state, task(review.graph, "t2").step, task(review.graph, "t2").stopped, task(review.graph, "t2").reviews], ["review", "queued", "agent", []]);
    assert.match(tg.endText(review.graph, "t2", { crew: "agent" }), /^\[Filament: you stopped the review of task t2 "Fix the parser", round 1 of 2\. The review waits: Filament starts it again after your next tasks call\./);
    assert.equal(lineOf(review.graph, "t2"), `- t2 "Fix the parser" — in review (round 1 of 2), stopped by the agent · by builder, with review · needs t1 · writes src/parse.js`);
    assert.deepEqual(tg.jobs(tg.release(review.graph, { crew: "agent", resumable: () => null })).map((j) => j.id), ["t2", "t3"], "the next tasks call lets it go");
  });

  // (fails before: no — a guard the mutation pass asked for: a new try's rounds start empty; the agent's own task, one
  // it took on after its sub-agent's review fell short, keeps that try's rounds until a lead gives it to a worker)
  test("a new try's review starts at round one: the agent took on a task whose review fell short, and a lead gives it to a builder", () => {
    const failed = some(tg.reviewEnded(round2(), "t2", END("sa-4", { report: ASKS }), 8_000), "round 2 ends").graph;
    const own = ok(ok(failed, { action: "change", tasks: [{ id: "t2", by: "you" }] }, "agent").graph, { action: "start", ids: ["t2"] }, "agent").graph;
    assert.deepEqual([task(own, "t2").state, task(own, "t2").reviews.length], ["running", 2], "the agent works on it, its sub-agent's rounds kept");
    const given = ok(own, { action: "change", tasks: [{ id: "t2", by: "builder", review: true }] }).graph;
    const again = some(tg.launched(given, "t2", "sa-7", 9_000, "builder"), "t2 launches");
    assert.deepEqual([task(again, "t2").reviews, task(again, "t2").tries], [[], 2]);
    assert.equal(lineOf(again, "t2"), `- t2 "Fix the parser" — running on sa-7 · by builder, with review · needs t1 · writes src/parse.js`);
  });

  // (fails before: yes — HarnessV3-TaskGraph G3-6: every word was the agent's: its sub-agents, its folder, its choices)
  test("the lead's words: a hold and the spend, a failure's choices with a change to merge and without, a stop, work in the folder itself", () => {
    const g = fixed();
    const held = tg.showText(tg.hold(g, 9_000), LED).split("\n");
    assert.ok(held.includes("Held since the developer's stop: Filament starts no worker's task until your next tasks call."), held.join("\n"));
    assert.ok(held.includes("Its workers spent $0.50."), held.join("\n"));
    assert.ok(tg.showText(g, "agent").split("\n").includes("Its sub-agents spent $0.50."));
    // A builder's failure: its change waits, and merging it is among the choices; a scout's leaves nothing to merge.
    const notMet = some(tg.taskEnded(building(), "t2", END("sa-2", { report: { ...FIX_REPORT, met: false, evidence: "npm test: 2 failed" }, files: FIX }), 5_000), "t2 ends").graph;
    assert.deepEqual(tg.endText(notMet, "t2", { crew: LED }).split("\n").slice(-3), ["Its change is not in the folder: it waits in builder sa-2's own worktree — tasks merge takes it as it stands.", LEAD_CHOICES, "Now: 1 of 3 done · failed: t2 · ready: t3.]"]);
    const scout = some(tg.taskEnded(some(tg.launched(team(), "t1", "sa-1", 2_000, "scout"), "t1 launches"), "t1", END("sa-1", { report: { ...FIX_REPORT, status: "failed" } }), 3_000), "t1 ends").graph;
    assert.equal(tg.endText(scout, "t1", { crew: LED }).split("\n").at(-2), "Your choices: send it back — tasks start with its id and a note: its worker goes on where it stopped, in its own conversation, or with fresh: true a new one starts from the folder as it stands; re-plan around it — change, add or drop tasks; or drop it.");
    // The developer stopped a builder: its change waits where it goes on with it; a new worker would start without it.
    const stopped = some(tg.taskEnded(building(), "t2", END("sa-2", { status: "stopped", stoppedBy: "harness", report: null, words: "", files: FIX }), 5_000), "t2 ends").graph;
    const stop = tg.endText(stopped, "t2", { crew: LED }).split("\n");
    assert.equal(stop[0], `[Filament: the developer stopped builder sa-2 on task t2 "Fix the parser". The task waits again: after your next tasks call sa-2 goes on with it where it stopped, in its own conversation — or a new worker takes it, with what this one did in its brief: tasks start with its id and fresh: true.`);
    assert.ok(stop.includes("Its change waits in builder sa-2's own worktree, where it goes on with it: a new worker would start from the folder as it stands, without it."), stop.join("\n"));
    // A writer with no worktree worked in the folder itself.
    const inFolder = some(tg.taskEnded(building(), "t2", END("sa-2", { report: { ...FIX_REPORT, met: false, evidence: "npm test: 2 failed" }, shared: true, wrote: true }), 5_000), "t2 ends").graph;
    assert.ok(tg.endText(inFolder, "t2", { crew: LED }).includes("\nIt worked in the folder itself, so what it changed is there already — have it checked before you go on.\n"));
    // A scout done says nothing of a change; a review's reader is the team's reviewer, or the agent's explorer.
    assert.equal(tg.endText(mapped(), "t1", { crew: LED }).split("\n")[0], `[Filament: task t1 "Map the parser" is done: scout sa-1 reported it done with its acceptance check passed.`);
    assert.ok(shown(g, "t2").includes("\nReview: a reviewer of your team reads its change before it merges, 2 rounds at most\n"));
    assert.ok(shown(g, "t2", "agent").includes("\nReview: an explorer reads its change before it merges, 2 rounds at most\n"));
  });
});

describe("the lead's tool and prompts", () => {
  // (fails before: yes — HarnessV3-TaskGraph G3-1, G3-4: the lead's tasks tool was G1's tracker: no role, no review, no
  // merge)
  test("a lead's tasks tool: merge among its actions, a role for each task and a writer's review", () => {
    const schema = /** @type {any} */ (LEAD_TASKS_TOOL).input_schema;
    assert.equal(LEAD_TASKS_TOOL.description, TOOL_TEXT.leadTasks);
    assert.deepEqual(schema.properties.action.enum, ["add", "start", "done", "change", "drop", "close", "show", "keep", "read", "find", "merge"]);
    const item = schema.properties.tasks.items.properties;
    assert.deepEqual(Object.keys(item), ["id", "name", "needs", "writes", "needed_by", "acceptance", "check", "by", "goal", "steps", "review", "run", "items", "thread", "found_by"]);
    assert.deepEqual([item.by.enum, item.review.type], [["scout", "builder", "tester", "reviewer", "command"], "boolean"]);
    assert.match(schema.properties.id.description, /^merge: the failed task whose change goes in as it stands\./);
    assert.match(schema.properties.reason.description, / merge: why its change goes in as it stands\.$/);
    assert.match(TOOL_TEXT.leadTasks, /\. merge: id and reason, a failed task's change into the folder as it stands\./);
    assert.match(TOOL_TEXT.leadTasks, /\. change: tasks, each an id and the fields that change, or goal; a task with its worker or in review changes once that ends\./);
  });

  // (fails before: yes — HarnessV3-TaskGraph G3-6: a lead read the agent's graph section, and every graph task's
  // sub-agent the agent's report line)
  test("a lead's prompt carries its own graph section, and a graph task's worker and reviewer their report lines; version 17, 18 since FailurePoints step 5, 24 since the lead reads along, 25 since it answers a worker's call, 27 since a worker asks it, 29 since every worker of a team asks it, 30 since a lead reads what its workers say and do, 31 since it may launch a brief as attempts, 32 since a model that takes no tools told why it has none (HarnessV4_Tasks E4), 33 since a task's check Filament runs itself (V2-1)", () => {
    assert.equal(PROMPT_VERSION, 129);
    const lead = { name: "Architect", persona: "You lead." };
    const on = systemPromptFor({ root: "/p", delegateRead: false, lead, graph: true });
    assert.ok(on.includes(`\n\n${PROMPT.headGraph}\n${PROMPT.leadGraph}\n\n`), on);
    assert.equal([PROMPT.graph, PROMPT.graphSubagents].some((s) => on.includes(s)), false, "none of the agent's lines");
    assert.equal(on.replace(`\n\n${PROMPT.headGraph}\n${PROMPT.leadGraph}`, "").replace(PROMPT.planOrGraph, PROMPT.plan), systemPromptFor({ root: "/p", delegateRead: false, lead }), "nothing else moves");
    /** @param {Record<string, any>} more */
    const sub = (more) => systemPromptFor(/** @type {any} */ ({ root: "/p", delegateRead: false, toolsOff: SUBAGENT_OFF, ...more }));
    // Since version 29 every worker of a team may ask its lead (TG2-D58): each report line ends on asking it.
    const asking = (/** @type {string} */ line) => readAlongReport(line, PROMPT.workerAsksLead);
    const builder = { subagent: true, card: SHIPPED_CARDS.builder, worker: { team: "Architect", words: "" } };
    assert.equal(sub({ ...builder, task: "work" }), sub(builder).replace(asking(PROMPT.workerReport), asking(PROMPT.workerTaskReport)));
    const reviewer = { subagent: true, card: SHIPPED_CARDS.reviewer, worker: { team: "Architect", words: "" } };
    assert.equal(sub({ ...reviewer, task: "review" }), sub(reviewer).replace(asking(PROMPT.workerReport), asking(PROMPT.reviewReport)));
    assert.ok(sub(builder).includes(asking(PROMPT.workerReport)) && sub(reviewer).includes(asking(PROMPT.workerReport)), "the replaced line is there to replace");
    const own = { subagent: true, card: SHIPPED_CARDS.reviewer };
    assert.equal(sub({ ...own, task: "review" }), sub(own).replace(PROMPT.subagentReport, PROMPT.reviewReport), "the agent's reviewer runs as Reviewer");
    assert.match(PROMPT.workerTaskReport, /your report is what your lead reads, never your final message/);
    assert.match(PROMPT.reviewReport, /decides whether the change goes into the project or back to whoever made it/);
    // The loop's system prompt maps its host's task: its work, or the review of its change.
    /** @param {{ id: string, review: boolean } | null} t */
    const host = (t) => loopSystem({ cfg: {}, doc: null, root: "/p", off: SUBAGENT_OFF, host: { readOnly: false, card: SHIPPED_CARDS.reviewer, team: { name: "Architect", role: "reviewer", words: "" }, task: t } }).prompt;
    assert.ok(host({ id: "t2", review: true }).includes(asking(PROMPT.reviewReport)));
    assert.ok(host({ id: "t2", review: false }).includes(asking(PROMPT.workerTaskReport)));
    assert.ok(host(null).includes(asking(PROMPT.workerReport)));
  });

  // (fails before: yes — HarnessV3-TaskGraph G3-6: the report's words named the agent as its only reader)
  test("a report names no reader it may lack: the words that answer it, and the tool's", () => {
    assert.equal(tg.REPORT_IN, "Your report is in: Filament passes it on as you end. End your turn now — a last word is enough.");
    // Its words say whom it is for since version 49: the session's agent carries it while its graph is on. Since version
    // 94 (the owner's tool plan of 11-08) they open on the task it ends and close on the planner's own tasks.
    assert.ok(REPORT_TOOL.description.startsWith("End the task of a task graph you were briefed on with this report, once, then end your turn: Filament passes the report on, never your final message, "), REPORT_TOOL.description);
    assert.ok(REPORT_TOOL.description.endsWith(" Your own planned tasks are done with tasks, never with this."), REPORT_TOOL.description);
    assert.equal(/the agent/.test(`${tg.REPORT_IN} ${JSON.stringify(REPORT_TOOL)}`), false);
  });

  // (fails before: no — a guard the plan asked for: G3 is the lead's, so the agent's tasks tool, its graph prompt and
  // its sub-agents' task prompts are byte for byte what they were — pinned as they stood at G3's start, and pinned
  // again as HarnessV3-FailurePoints step 5 changed the tool and the graph prompt on purpose: fresh, and a send-back's
  // words; and the tool once more as HarnessV4_Tasks B4 let its note and fresh name a task the developer stopped; and
  // the agent's two graph prompts as HarnessV4_Tasks E15 step 3 changed the agent tool's line on purpose, and again as
  // step 4 added the three recipes after it; and the tool once more as HarnessV3-TaskGraph-v2 V2-1 gave a task its check,
  // and as V2-3 gave it command tasks: by's command, run and items, the tool's words of them and the graph section's
  // line on when to make one (TG2-D72), and a done that takes a failed one as done (TG2-D73); and the agent's two graph
  // prompts once more as V2-5 put its checklist on the graph: its graph section and its plan line; and the tool once more
  // as HarnessV4_GraphThreads E28 gave a task the thread of memory it finishes; and the tool once more as
  // HarnessV4_TaskNotes_Plan E33 gave it keep and read, the notes and files behind each task — the prompts unmoved; and
  // the tool and the agent's two graph prompts once more as HarnessV4_TaskGraphPlus_Plan E41 P1 gave it pause and its
  // checkpoint, and the graph section its line on when to pause and on where you stand; and once more as E41 P2 gave done its
  // evidence, in the tool and the graph section's line — the sub-agents' prompts unmoved; and the agent's two graph
  // prompts once more as the owner's word of 10-27 ran the agent tool's launches in the background by default, its line
  // saying so — the tool and the sub-agents' prompts unmoved; and every prompt once more as the owner's word of 10-27 ran a
  // reply's reads side by side, the craft's line on calls made together saying so — the tool unmoved; the tool and the
  // agent's two graph prompts weighed as version 68 had them, before the owner's word of 10-29 made the graph always on
  // and took the switch's words out: asV68Tools, asV68Prompt; and the prompt that carried the digest instruction weighed
  // without it, which version 74 took out with the digests, 10-31 — without it, HEAD's prompt byte for byte; and the
  // tool weighed without the found_by version 75 gave a task, the owner's of 11-02: asV74Tools; and the agent's graph
  // prompts weighed as version 75 had them, before a graph task's work waited for its apply, 11-02: asV75Prompt; and
  // without the line version 85 gave the graph's section, a plan asked for alone, 11-05: asV84Prompt; and without the
  // offer's line and the tool's offer version 91 gave them, the owner's plan mode of 11-06: asV90Prompt, asV90Tools; and
  // the tool's words as version 93 had them, before the owner's tool plan of 11-08 took their em dashes out: asV93Tools; and the agent's line on its reports as version 96 had it, before
  // the owner's prompt pass of 11-08: asV96Prompt; and the agent's two graph prompts as version 98 had them, before their
  // line on the agent tool named what a sub-agent goes without, 11-08: asV98Prompt; and the tool and the agent's two graph
  // prompts as version 101 had them, before writes became a forecast, 11-09: asV101Tools, asV101Prompt; and the tool and
  // the agent's two graph prompts as version 102 had them, before the graph's words were given their freedom, 11-09:
  // asV102Tools, asV102Prompt; and the tool as version 110 had it, before the agent's parallel, 11-10: asV110Tools; and
  // as version 111 had it, before its start took one task of the agent's own at a time, 11-10: asV111Tools)
  test("the agent's side of the graph is byte for byte as pinned: the lead's work leaves it alone", () => {
    assert.equal(sha(JSON.stringify(asV68Tools(asV74Tools(asV90Tools(asV93Tools(asV101Tools(asV102Tools(asV103Tools(asV110Tools(asV111Tools([TASKS_TOOL])))))))))[0])), "1c67811c15a0fd68eaa0ba41d2e34101a49e937fb37f7ee472ba899e4d3c86c3");
    const prompts = [
      [{ root: "/p", delegateRead: false, graph: true }, "f3737e9dc85b82ef04114c35e0bbd450e4b15e14bf25f891142a33d207e74682"],
      [{ root: "/p", delegateRead: true, web: { fetch: true, search: true }, mcp: [{ name: "docs", tools: 2 }], environment: "# Environment\nx", graph: true }, "1ed46b5bf55a43c202393da80dd778700febc20c793e7ef63a17f69fe2b66869"],
      [{ root: "/p", delegateRead: false, subagent: true, toolsOff: SUBAGENT_OFF, task: "work" }, "e99bcfb557391214220270df2b65b2533b1eb17eca3b8a710e1f015d649f8053"],
      [{ root: "/p", delegateRead: false, subagent: true, readOnly: true, toolsOff: SUBAGENT_OFF, task: "work" }, "9058a3028bfb74cabe9ae910d24e8da68600f52847c2d94cf3b12736bcd65c77"],
    ];
    for (const [args, hash] of prompts) {
      const s = systemPromptFor(/** @type {any} */ (args));
      // The agent's graph prompts weighed too with its three ways its sub-agents pay naming the cards that shipped before
      // the roster shrink of 11-03 (asOldRoster), and with the session's count version 87 took from its agent line
      // (asV86Prompt).
      assert.equal(sha(/** @type {any} */ (args).graph ? asV68Prompt(asV75Prompt(asOldRoster(asV84Prompt(asV86Prompt(asV90Prompt(asV96Prompt(asV97Prompt(asV98Prompt(asV101Prompt(asV102Prompt(asV111Prompt(asV116Prompt(asV117Prompt(s)))))))))))))) : s), hash, JSON.stringify(args));
    }
  });
});

describe("the team's tools", () => {
  // (fails before: yes — the owner's of 11-02: a lead's apply of a graph worker's change was refused, Filament merging
  // it itself; the registry's apply takes it the graph's way, so it is an apply as any other)
  test("a lead's apply of a graph task's worker's change reaches the registry's apply, which takes it the graph's way — refused by no team tool", async () => {
    /** @type {string[]} */
    const applied = [];
    const team = { key: "architect", name: "Architect" };
    /** @type {Record<string, any>} */
    const workers = {
      "sa-2": { id: "sa-2", chainId: "c1", origin: "agent", status: "done", task: "t2", review: false, team: { ...team, role: "builder" } },
      "sa-4": { id: "sa-4", chainId: "c1", origin: "agent", status: "done", task: "t2", review: true, team: { ...team, role: "reviewer" } },
      "sa-7": { id: "sa-7", chainId: "c1", origin: "agent", status: "done", task: null, review: false, team: { ...team, role: "builder" } },
    };
    const registry = /** @type {any} */ ({ recall: () => {}, get: (/** @type {string} */ id) => workers[id] || null, apply: async (/** @type {string} */ id) => (applied.push(id), { ok: true, files: [{ path: "src/a.js", added: 1, removed: 0, status: "M", binary: false }], repo: "/p" }) });
    const tools = createTeamTools({ registry });
    /** @param {any} input */
    const call = (input) => ({ chainId: "c1", lead: { runId: "lead-1", callId: "toolu_1" }, cwd: "/p", mode: null, model: "m", thinking: null, team: { ...team, members: LED }, input });
    const r = await tools.worker(call({ agent_id: "sa-2", apply_changes: true }));
    assert.deepEqual([r.ok, r.text, r.note], [true, "Applied the changes of sub-agent sa-2 to your folder: 1 file (+1 −0) — src/a.js.", "agent: applied sub-agent sa-2's changes (1 file)"]);
    assert.deepEqual(applied, ["sa-2"], "it reached the registry");
    await tools.worker(call({ agent_id: "sa-7", apply_changes: true }));
    assert.deepEqual(applied, ["sa-2", "sa-7"]);
  });
});

describe("/graph and the reattach under a team", () => {
  // (fails before: yes — HarnessV3-TaskGraph G3-1: /graph and the reattach read every graph in the agent's words)
  test("under a team, /graph and the summary's reattach read the graph in its lead's words", () => {
    /** A session a team answers, as /graph reads it. @param {any} graph */
    const memoryOf = (graph) => ({
      docFor: () => ({ effective: { engine: { mode: "team", team: "builders" } }, sources: {} }),
      archive: { getChain: () => ({ id: "c1", meta: { graph } }) },
      archiveWhy: () => "",
      getConfig: () => ({ experimental: { teams: true } }),
    });
    const teams = teamStore();
    /** @param {any} memory @param {string} arg */
    const say = (memory, arg) => graphCommandReply(memory, "c1", { arg }, { teams }).text;
    const g = fixed();
    assert.ok(
      say(memoryOf(g), "").startsWith(`**Task graph** — the team's lead has the tasks tool beside its checklist, and puts each piece of work on whichever fits.\nThe graph, as the team's lead reads it:\n\`\`\`text\n${tg.showText(g, LED)}\n\`\`\``),
      say(memoryOf(g), ""),
    );
    assert.equal(say(memoryOf(null), "").split("\n")[1], "No graph yet: the team's lead starts one when the work has pieces that depend on each other or could run in parallel.");
    // After a summary the graph comes back in its planner's words.
    /** @param {any} engine */
    const back = (engine) => backAfterSummary({ doc: { engine }, turns: [], toTurn: 0, root: "", window: 200_000, graph: g, teams }).text.split("\n\n").at(-1);
    assert.equal(back({ mode: "team", team: "builders" }), `<tasks>\n${tg.showText(g, LED)}\n</tasks>`);
    assert.ok(String(back({ mode: "team", team: "builders" })).includes("\nIts workers spent $0.50.\n"));
    assert.equal(back({}), `<tasks>\n${tg.showText(g, "agent")}\n</tasks>`);
  });
});
