// @ts-check
// HarnessV3-FailurePoints step 5 (§6, §8 items 2–3), in the core alone (core/task-graph.js — pure, nothing runs). A
// failed task sent back goes on with its last worker, in its own conversation — or, with fresh or when that worker
// can't, a new one takes it, the words saying why; the try a new worker builds on is the last that ran, its tool calls
// in its brief; a change made in the folder itself is reviewed there, met is done, and one whose files can't be named
// says it went unreviewed; a task that fails the same way again says so.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTasks, briefText, endText, fixLaunched, fixText, jobs, launched, launchRefused, resumed, resumeRefused, resumeText, reviewBrief, reviewEnded, reviewLaunched, runsAs, taskEnded } from "../src/core/task-graph.js";
import { MEMBERS as LED } from "./helpers/roster.js";

const AT = 1_000;
/** @typedef {{ at?: number, crew?: import("../src/core/task-graph.js").Crew, resumable?: import("../src/core/task-graph.js").Resumable }} Opts */
/** One call that must go through. @param {any} g @param {any} input @param {Opts} [o] @returns {{ ok: true, graph: any, text: string, changed: boolean }} */
const ok = (g, input, o = {}) => {
  const r = applyTasks(g, input, { at: AT, crew: "agent", ...o });
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r;
};
/** One call that must be refused: its words, the graph left as it was. @param {any} g @param {any} input @param {Opts} [o] */
const no = (g, input, o = {}) => {
  const before = JSON.stringify(g);
  const r = applyTasks(g, input, { at: AT, crew: "agent", ...o });
  assert.equal(r.ok, false, "refused");
  assert.equal(JSON.stringify(g), before, "the graph is left as it was");
  return r.ok ? "" : r.error;
};
/** @param {any} g @param {string} id @returns {any} */
const task = (g, id) => g.tasks.find((/** @type {any} */ t) => t.id === id);
/** A sub-agent's end as the registry hands it over: done, its check passed, nothing changed. @param {string} agent @param {Record<string, any>} [more] @returns {any} */
const END = (agent, more = {}) => ({ agent, status: "done", stoppedBy: null, error: null, report: { status: "done", did: "Did it.", met: true, evidence: "the check passed", left: "" }, words: "Finished.", files: [], shared: false, wrote: false, workError: null, ran: [], calls: [], written: [], spentUsd: 0.25, ms: 60_000, cut: false, ...more });
/** A task launched as `crew` runs it. @param {any} g @param {string} id @param {string} agent @param {import("../src/core/task-graph.js").Crew} [crew] @returns {any} */
const launch = (g, id, agent, crew = "agent") => {
  const r = launched(g, id, agent, AT, String(runsAs(task(g, id), crew)));
  assert.ok(r, `${id} launches`);
  return r;
};
/** @param {any} g @param {string} id @param {any} end @param {number} [at] @returns {any} */
const ended = (g, id, end, at = 2_000) => {
  const r = taskEnded(g, id, end, at);
  assert.ok(r, `${id} ends`);
  return r.graph;
};
/** The words the planner hears as the task ends. @param {any} g @param {import("../src/core/task-graph.js").Crew} [crew] */
const told = (g, crew = "agent") => endText(g, "t1", { crew }).split("\n");

const FIX = { id: "t1", name: "Fix the parser", by: "sub-agent", writes: ["src/parse.js"], goal: "parse() takes trailing commas", steps: ["Fix parse()", "Run npm test"], acceptance: "npm test passes" };
const graphOf = () => ok(null, { action: "add", goal: "Ship the parser", tasks: [FIX] }).graph;
const NOT_MET = { status: "done", did: "Fixed it.", met: false, evidence: "npm test: 2 failed.", left: "" };
const FILES = [{ path: "src/parse.js", added: 12, removed: 3 }];
/** t1 failed: sa-1's check not met, its change in its worktree. @param {Record<string, any>} [more] */
const failed = (more = {}) => ended(launch(graphOf(), "t1", "sa-1"), "t1", END("sa-1", { report: NOT_MET, files: FILES, ...more }));
/** A registry's word on a resume, each agent it was asked of kept in `asked`. @param {string | null} why @param {string[]} asked @returns {import("../src/core/task-graph.js").Resumable} */
const says = (why, asked) => (agent) => (asked.push(agent), why);
const READY = "0 of 1 done · ready: t1.";

// (fails before: yes — HarnessV3-FailurePoints §6 items 2–4: a send-back always went to a new sub-agent, and nothing
// asked whether the last one could go on, nor took a fresh)
test("sent back, a failed task's last sub-agent goes on with it — unless fresh asks for a new one, or Filament says it can't, and the words say why", () => {
  /** @type {string[]} */
  const asked = [];
  const on = ok(failed(), { action: "start", ids: ["t1"] }, { resumable: says(null, asked) });
  assert.deepEqual([asked, task(on.graph, "t1").resume, jobs(on.graph)], [["sa-1"], "sa-1", [{ id: "t1", kind: "resume" }]]);
  assert.equal(on.text, `Sent t1 back: sub-agent sa-1 goes on with it once its needs are done and a slot is free, in its own conversation — what it did is there, and it reads what failed. ${READY}`);
  assert.equal(ok(on.graph, { action: "show", id: "t1" }).text.split("\n")[0], `t1 "Fix the parser" — ready — sa-1 goes on with it · by sub-agent · writes src/parse.js`);
  // It goes on: the same sub-agent runs it again, a try more; nothing else may resume it.
  const again = /** @type {any} */ (resumed(on.graph, "t1", 3_000));
  assert.deepEqual([task(again, "t1").state, task(again, "t1").agent, task(again, "t1").tries, task(again, "t1").resume, task(again, "t1").startedAt], ["running", "sa-1", 2, null, 3_000]);
  assert.deepEqual([resumed(again, "t1", 4_000), resumed(failed(), "t1", 4_000)], [null, null]);
  // Filament says it can't: a new one takes it, told why.
  asked.length = 0;
  const restarted = ok(failed(), { action: "start", ids: ["t1"], note: "Run the whole suite" }, { resumable: says("Filament restarted since it ran, and its conversation went with it", asked) });
  assert.equal(restarted.text, `Sent t1 back: sa-1 can't go on with it — Filament restarted since it ran, and its conversation went with it — so a new sub-agent takes it once its needs are done and a slot is free, with the earlier try and your note in its brief. ${READY}`);
  assert.deepEqual([asked, task(restarted.graph, "t1").resume, jobs(restarted.graph)], [["sa-1"], null, [{ id: "t1", kind: "start" }]]);
  // fresh: a new one, and nothing is asked; false is the default.
  asked.length = 0;
  const anew = ok(failed(), { action: "start", ids: ["t1"], fresh: true }, { resumable: says(null, asked) });
  assert.deepEqual([asked, task(anew.graph, "t1").resume, anew.text], [[], null, `Sent t1 back: a new sub-agent takes it once its needs are done and a slot is free, with the earlier try in its brief. ${READY}`]);
  assert.equal(task(ok(failed(), { action: "start", ids: ["t1"], fresh: false }, { resumable: says(null, asked) }).graph, "t1").resume, "sa-1");
  // Anything but true or false is refused, beside every other problem of the call.
  assert.equal(no(failed(), { action: "start", ids: ["t1", "t9"], fresh: "yes" }), "2 problems, so nothing of this call changed — one call can fix them all:\n- t9 is no task in the graph\n- fresh is true or false: true gives a failed or a stopped task to a new worker instead of its last one");
  // (fails before: yes — B4: a task that waited for its last worker was no one's to start, so nothing gave it to a new
  // one before it began)
  const turned = ok(on.graph, { action: "start", ids: ["t1"], fresh: true }, { resumable: says(null, asked) });
  assert.deepEqual([task(turned.graph, "t1").resume, task(turned.graph, "t1").earlier.agent, turned.text], [null, "sa-1", `Started t1 again: a new sub-agent takes it once its needs are done and a slot is free, with the earlier try in its brief. ${READY}`]);
  assert.equal(no(turned.graph, { action: "start", ids: ["t1"] }), "t1 is a sub-agent's task: Filament starts it by itself once its needs are done", "a new one takes it: nothing more to say");
});

// (fails before: yes — HarnessV3-FailurePoints §6 item 4: a send-back had no last worker to keep, nor a role to check)
test("a task given to another role can't go on with its last worker: at the send-back, or changed after it — a change that keeps its role keeps it", () => {
  // Planned by the agent, sent back under a team's lead: a builder takes a sub-agent's task now.
  const led = ok(failed(), { action: "start", ids: ["t1"] }, { crew: LED, resumable: () => null });
  assert.equal(led.text, `Sent t1 back: sa-1 can't go on with it — the task goes to a builder now, and sa-1 is a sub-agent — so a new worker takes it once its needs are done and a slot is free, with the earlier try in its brief. ${READY}`);
  assert.equal(task(led.graph, "t1").resume, null);
  // Sent back to it, then given to an explorer: the change says a new one takes it.
  const back = ok(failed(), { action: "start", ids: ["t1"] }, { resumable: () => null }).graph;
  const changed = ok(back, { action: "change", tasks: [{ id: "t1", by: "explorer", writes: [] }] });
  assert.equal(changed.text, `Changed t1. t1 goes to a new sub-agent now, of the role it names: the last one can't go on with it. ${READY}`);
  assert.deepEqual([task(changed.graph, "t1").resume, jobs(changed.graph)], [null, [{ id: "t1", kind: "start" }]]);
  const kept = ok(back, { action: "change", tasks: [{ id: "t1", acceptance: "npm test passes, the whole suite" }] });
  assert.deepEqual([task(kept.graph, "t1").resume, kept.text], ["sa-1", `Changed t1. ${READY}`]);
});

// (fails before: yes — HarnessV3-FailurePoints §6 item 4: no resume could be refused; and a send-back after a launch
// Filament could not make put that empty try in the next brief, the try that ran lost)
test("a try that left no record goes to a new worker plainly, and the next brief builds on the try before it, which ran", () => {
  /** @type {string[]} */
  const asked = [];
  // Filament could not start its first: no worker to go on, nothing asked.
  const never = /** @type {any} */ (launchRefused(graphOf(), "t1", "the session's sub-agents are at their ceiling", 2_000, "sub-agent"));
  const plain = ok(never, { action: "start", ids: ["t1"] }, { resumable: says(null, asked) });
  assert.deepEqual([asked, plain.text], [[], `Sent t1 back: a new sub-agent takes it once its needs are done and a slot is free, with the earlier try in its brief. ${READY}`]);
  assert.ok(briefText(plain.graph, "t1", "agent").includes("\n\nAn earlier try at this task ended: Filament could not start its sub-agent: the session's sub-agents are at their ceiling.\nYou start from"));
  // Its worker could not go on as it started: the task fails in those words.
  const back = ok(failed(), { action: "start", ids: ["t1"] }, { resumable: () => null }).graph;
  assert.equal(resumeRefused(failed(), "t1", "x", 3_000), null, "no resume to refuse");
  const refused = /** @type {any} */ (resumeRefused(back, "t1", "sub-agent sa-1 is still working", 3_000));
  assert.deepEqual([task(refused, "t1").state, task(refused, "t1").why, task(refused, "t1").resume, task(refused, "t1").endedAt], ["failed", "its sub-agent sa-1 could not go on with it: sub-agent sa-1 is still working", null, 3_000]);
  assert.equal(told(refused)[0], `[Filament: task t1 "Fix the parser" failed: its sub-agent sa-1 could not go on with it: sub-agent sa-1 is still working.`);
  assert.deepEqual(task(refused, "t1").failures, { cause: "resume sub-agent # is still working", times: 1 });
  // Sent back again: a new one, whose brief builds on sa-1's try — the one that ran.
  const again = ok(refused, { action: "start", ids: ["t1"], note: "Start over" }, { resumable: says(null, asked) });
  assert.deepEqual([asked, task(again.graph, "t1").resume, task(again.graph, "t1").earlier.agent, task(again.graph, "t1").earlier.why], [[], null, "sa-1", "its acceptance check did not pass: npm test: 2 failed."]);
  const brief = briefText(again.graph, "t1", "agent");
  assert.ok(brief.includes("\n\nAn earlier try at this task ended: its acceptance check did not pass: npm test: 2 failed.\nDid: Fixed it.\n"), brief);
  // So after a launch Filament could not make for it.
  const fresh = ok(failed(), { action: "start", ids: ["t1"], fresh: true }).graph;
  const noLaunch = /** @type {any} */ (launchRefused(fresh, "t1", "no slot", 3_000, "sub-agent"));
  assert.equal(task(ok(noLaunch, { action: "start", ids: ["t1"] }).graph, "t1").earlier.why, "its acceptance check did not pass: npm test: 2 failed.");
});

// (fails before: yes — HarnessV3-FailurePoints §8 item 3: each failure was told as if it were the first)
test("a task that fails the same way again says so — tries whose words differ only in their numbers count as one way; another way starts over", () => {
  /** A run the API failed. @param {string} agent @param {string} request */
  const overloaded = (agent, request) => END(agent, { status: "failed", error: `HTTP 529: overloaded (request ${request}), retried 3 times`, report: null });
  let g = ended(launch(graphOf(), "t1", "sa-1"), "t1", overloaded("sa-1", "req_01ab"));
  assert.deepEqual(task(g, "t1").failures, { cause: "run failed http # overloaded (request # retried # times", times: 1 });
  assert.equal(told(g).some((l) => l.includes("the same way")), false, "the first time, nothing to say");
  g = ended(launch(ok(g, { action: "start", ids: ["t1"], fresh: true }).graph, "t1", "sa-2"), "t1", overloaded("sa-2", "req_99zz"));
  assert.deepEqual(task(g, "t1").failures, { cause: "run failed http # overloaded (request # retried # times", times: 2 });
  assert.deepEqual(told(g).slice(0, 2), [`[Filament: task t1 "Fix the parser" failed: its run failed (HTTP 529: overloaded (request req_99zz), retried 3 times).`, "t1 failed the same way 2 times in a row."]);
  assert.ok(ok(g, { action: "show", id: "t1" }).text.includes("\nFailed: its run failed (HTTP 529: overloaded (request req_99zz), retried 3 times) — the same way 2 times in a row\n"));
  // Another way: the count starts over.
  g = ended(launch(ok(g, { action: "start", ids: ["t1"], fresh: true }).graph, "t1", "sa-3"), "t1", END("sa-3", { report: null }));
  assert.deepEqual(task(g, "t1").failures, { cause: "no report", times: 1 });
  assert.equal(told(g).some((l) => l.includes("the same way")), false);
});

// (fails before: yes — HarnessV3-FailurePoints §6 items 2–3: a new worker's brief had no tool calls of the try before,
// and no worker went on with its task, sent back)
test("the try a new worker reads carries its tool calls, the newest 30; the worker that goes on reads what failed, the note and its task as it stands", () => {
  const calls = Array.from({ length: 35 }, (_, i) => `Run npm test -- --shard ${i + 1}`);
  const g = failed({ calls: [...calls.slice(0, 34), `Run ${"x".repeat(300)}`] });
  const tried = task(g, "t1").report;
  assert.deepEqual([tried.calls.length, tried.callsMade, tried.calls[0], tried.calls.at(-1).length <= 160], [30, 35, "Run npm test -- --shard 6", true]);
  const brief = briefText(ok(g, { action: "start", ids: ["t1"], fresh: true }).graph, "t1", "agent");
  assert.ok(brief.includes("\nIts tool calls, the newest 30 of 35:\n- Run npm test -- --shard 6\n- Run npm test -- --shard 7\n"), brief);
  assert.ok(brief.includes("\n- Run npm test -- --shard 34\n- Run xxx"), brief);
  // A few calls: all of them, no count.
  const few = briefText(ok(failed({ calls: ["Read src/parse.js", "Run npm test (failed)"] }), { action: "start", ids: ["t1"], fresh: true }).graph, "t1", "agent");
  assert.ok(few.includes("\nIts tool calls:\n- Read src/parse.js\n- Run npm test (failed)\nYou start from the project as it stands now, without that try's change"), few);
  // The worker that goes on, in its own conversation.
  const back = ok(g, { action: "start", ids: ["t1"], note: "Run the whole suite" }, { resumable: () => null }).graph;
  const words = resumeText(back, "t1", "agent").split("\n\n");
  assert.deepEqual(words.slice(0, -1), [
    "[Filament: your try at task t1 ended: its acceptance check did not pass: npm test: 2 failed. The agent sent the task back to you: go on from where you stopped — your work so far is above. Your worktree holds your change as you left it.",
    "The agent's note for you: Run the whole suite",
    "Your task as it stands now: t1 — Fix the parser",
    "Goal: parse() takes trailing commas",
    "Files — change these alone:\n- src/parse.js",
    "Steps:\n1. Fix parse()\n2. Run npm test",
    "Acceptance check: npm test passes",
  ]);
  assert.ok(words.at(-1)?.startsWith("When the task is done — or you cannot finish it — call report once, then end:") && words.at(-1)?.endsWith("your change goes into the project. Your task has no check: in checked, name the commands that prove it done — the tests you ran, each exactly as you ran it. Filament runs them again in your worktree before the agent hears your report, sends the task back to you if one fails, and keeps them as your task's check, guarding the project after your change goes in. Leave checked out only where no command can check your change.]"), words.at(-1));
  // One that worked in the folder itself finds its change there.
  const inFolder = ok(failed({ files: [], shared: true, wrote: true, written: ["src/parse.js"] }), { action: "start", ids: ["t1"] }, { resumable: () => null }).graph;
  assert.ok(resumeText(inFolder, "t1", "agent").split("\n\n")[0].endsWith("your work so far is above. What you changed in the folder is there as you left it."));
});

const BUILD = { id: "t1", name: "Fix the parser", by: "builder", writes: ["src/parse.js"], review: true, goal: "parse() takes trailing commas", steps: ["Fix parse()", "Run npm test"], acceptance: "npm test passes" };
const DONE = { status: "done", did: "parse() takes trailing commas.", met: true, evidence: "npm test: 41 passed", left: "" };
/** A builder's end in the folder itself — no git: the files its calls wrote. @param {string} agent @param {Record<string, any>} [more] */
const IN_FOLDER = (agent, more = {}) => END(agent, { report: DONE, shared: true, wrote: true, written: ["src/parse.js"], ...more });
/** A reviewer's end: met, or the changes it asks. @param {string} agent @param {string} left */
const REVIEWED = (agent, left) => END(agent, { report: { status: "done", did: "Read src/parse.js.", met: !left, evidence: left ? "an empty input throws" : "npm test passes", left } });

// (fails before: yes — HarnessV3-FailurePoints §8 item 2: a change made in the folder itself skipped the review it asked
// for, told as done)
test("a change made in the folder itself is reviewed there: its files named by its calls, the changes asked made in the folder, met is done with nothing to merge", () => {
  const g0 = ok(null, { action: "add", goal: "Ship the parser", tasks: [BUILD] }, { crew: LED }).graph;
  let g = ended(launch(g0, "t1", "sa-1", LED), "t1", IN_FOLDER("sa-1"));
  assert.deepEqual([task(g, "t1").state, task(g, "t1").step, jobs(g)], ["review", "queued", [{ id: "t1", kind: "review" }]]);
  const brief = reviewBrief(g, "t1", LED);
  assert.ok(brief.startsWith("You review one task's change, in a larger piece of work which your team's lead planned as a task graph: its builder, sa-1, made the change above in the folder you work in and reported the task done."), brief);
  assert.ok(brief.includes("\nWrote, in the folder: src/parse.js\n"), brief);
  // It asks for changes: the builder makes them in the folder, and its change is read again.
  g = /** @type {any} */ (reviewLaunched(g, "t1", "sa-2"));
  const asked = /** @type {any} */ (reviewEnded(g, "t1", REVIEWED("sa-2", "Return [] for an empty input"), 3_000));
  assert.equal(asked.state, "review");
  assert.equal(fixText(asked.graph, "t1").split("\n\n").at(-1), "Make them in your task's files alone — the folder holds your change as you left it — run the acceptance check again, then call report once more: your change is read again.]");
  g = ended(/** @type {any} */ (fixLaunched(asked.graph, "t1")), "t1", IN_FOLDER("sa-1"), 4_000);
  assert.deepEqual([task(g, "t1").state, task(g, "t1").step], ["review", "queued"]);
  // Met: done — there is nothing to merge.
  const met = /** @type {any} */ (reviewEnded(/** @type {any} */ (reviewLaunched(g, "t1", "sa-2")), "t1", REVIEWED("sa-2", ""), 5_000));
  assert.deepEqual([met.state, task(met.graph, "t1").summary, task(met.graph, "t1").merged, task(met.graph, "t1").endedAt], ["done", "parse() takes trailing commas.", null, 5_000]);
  assert.equal(told(met.graph, LED)[0], `[Filament: task t1 "Fix the parser" is done: builder sa-1 reported it done with its acceptance check passed — unchecked: the task has no check, and its report named none — its reviewer found the change does what the task asks; it worked in the folder, so what it changed is there already.`);
});

// (fails before: yes — HarnessV3-FailurePoints §8 item 2: a review asked for and not run went unsaid)
test("a change in the folder whose files no call named is done unreviewed, and says so", () => {
  const g0 = ok(null, { action: "add", goal: "Ship the parser", tasks: [BUILD] }, { crew: LED }).graph;
  const r = taskEnded(launch(g0, "t1", "sa-1", LED), "t1", IN_FOLDER("sa-1", { written: [] }), 2_000);
  assert.equal(r?.state, "done");
  const g = r?.graph;
  const why = "it worked in the folder itself, and none of its calls wrote or edited a file by name, so Filament can't tell a reviewer which files it changed";
  assert.equal(task(g, "t1").unreviewed, why);
  assert.ok(told(g, LED).includes(`Its review did not run: ${why} — check its change in the folder before you go on.`), told(g, LED).join("\n"));
  assert.ok(ok(g, { action: "show", id: "t1" }, { crew: LED }).text.includes(`\nNot reviewed: ${why}`));
  // Reviewed — or none asked for — nothing is said.
  const plain = ok(null, { action: "add", goal: "Ship the parser", tasks: [{ ...BUILD, review: false }] }, { crew: LED }).graph;
  const done = ended(launch(plain, "t1", "sa-1", LED), "t1", IN_FOLDER("sa-1", { written: [] }));
  assert.deepEqual([task(done, "t1").state, task(done, "t1").unreviewed], ["done", ""]);
  // Its files named, with no review asked for: done — there is nothing to merge.
  const named = ended(launch(plain, "t1", "sa-1", LED), "t1", IN_FOLDER("sa-1"));
  assert.deepEqual([task(named, "t1").state, task(named, "t1").merged, task(named, "t1").unreviewed], ["done", null, ""]);
});
