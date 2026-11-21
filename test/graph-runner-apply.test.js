// @ts-check
// The owner's of 11-02 (efficiency plan, step 3): a finished graph worker's change is the main agent's to apply. The
// runner never merges it by itself — it is ready, and waits in the worker's copy — the tasks that need it wait for its
// apply, the planner's apply merges it the graph's way (`applyAsked`), its ends wake the planner once for all of the
// graph's workers, a restart keeps it waiting, and the side run's old "apply on check pass" setting is read no more.
// Against a session kept in memory and a registry that records what it is asked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";
import * as tg from "../src/core/task-graph.js";
import { sideBody } from "../src/ui/harness/views/side-run-sheet.js";
import { PROMPT, PROMPT_VERSION } from "../src/app/agent/prompt.js";
import { membersOf } from "./helpers/roster.js";

const TURN = { runId: "turn-1", cwd: "/p", mode: null, model: "m", thinking: null, team: null };
/** @type {{ crew: import("../src/core/task-graph.js").Crew }} */
const AGENT = { crew: "agent" };
/** Two writers side by side, and a third that needs the first. */
const ADD = {
  action: "add",
  goal: "Ship the parser",
  tasks: [
    { id: "t1", name: "Fix the parser", by: "sub-agent", writes: ["src/parse.js"], goal: "parse() takes empty input", steps: ["Fix it"], acceptance: "npm test passes", check: ["npm test"] },
    { id: "t2", name: "Write the tests", by: "sub-agent", writes: ["test/parse.test.js"], goal: "Tests for empty input", steps: ["Write them"], acceptance: "they fail first", check: ["npm test"] },
    { id: "t3", name: "Use the parser", needs: ["t1"], by: "sub-agent", writes: ["src/main.js"], goal: "main uses it", steps: ["Use it"], acceptance: "npm start runs", check: ["npm start"] },
  ],
};
const FIX = [{ path: "src/parse.js", added: 12, removed: 3 }];
const TESTS = [{ path: "test/parse.test.js", added: 30, removed: 0 }];
const PASSED = (/** @type {string} */ command) => ({ ran: true, commands: [command], runs: [{ command, exit: 0, ms: 9, output: "ok", stopped: false, first: null }], bounces: 0, stopped: false });
/**
 * A graph task's end as the registry tells it: done, its check passed in its copy.
 * @param {string} id @param {string} agent @param {any[]} files @returns {any}
 */
const END = (id, agent, files) => ({ id, exchange: 0, toolCalls: 3, roundIds: [`r-${agent}`], launchedBy: "turn-1", agent, status: "done", stoppedBy: null, error: null, report: { status: "done", did: "Did it.", met: true, evidence: "npm test passed", left: "" }, words: "Finished.", files, shared: false, wrote: false, workError: null, ran: [], calls: [], written: [], spentUsd: 0.25, ms: 60_000, cut: false, check: PASSED("npm test") });
/** @param {{ ok: boolean }} r @returns {any} */
const ok = (r) => (assert.ok(r.ok, JSON.stringify(r)), r);
const tick = () => new Promise((r) => setImmediate(r));

/**
 * A session kept in memory and a registry that records launches, goings-on, tells, merges, wakes and cuts. `crew`: who
 * plans; `refuseKeeps`: how many of the session's next writes fail; `cannotResume`: why no worker can go on, or null;
 * `mergeRetryMs`: the runner's.
 * @param {{ crew?: any, mergeRetryMs?: number }} [o]
 */
function rig({ crew = "agent", mergeRetryMs = 2000 } = {}) {
  /** @type {Map<string, any>} */
  const chains = new Map([["c1", { id: "c1", meta: {} }]]);
  /** @type {any[]} */
  const launches = [];
  /** @type {any[]} */
  const resumes = [];
  /** @type {any[]} */
  const told = [];
  /** @type {{ id: string, o: any, done: (v: any) => void }[]} */
  const merges = [];
  /** @type {string[]} */
  const wakes = [];
  /** @type {string[]} */
  const kept = [];
  /** @type {string[]} */
  const cuts = [];
  const state = { refuseKeeps: 0, cannotResume: /** @type {string | null} */ (null) };
  let n = 0;
  const registry = {
    /** @param {any} spec */
    launch: (spec) => (launches.push(spec), { ok: true, id: `sa-${++n}`, done: new Promise(() => {}) }),
    /** @param {string} id @param {any} o */
    resumeTask: (id, o) => (resumes.push({ id, ...o }), { ok: true, id, done: new Promise(() => {}) }),
    /** @param {string} chainId */
    cutMerges: (chainId) => void cuts.push(chainId),
    slots: () => 4,
    /** @param {string} chainId @param {any} d */
    tell: (chainId, d) => void told.push(d),
    stop: () => ({ ok: true }),
    resumable: () => state.cannotResume,
    guard: () => {},
    checkProblem: () => null,
    runProblem: () => null,
    /** @param {string} id @param {string} chainId @param {any} o */
    mergeTask: (id, chainId, o) => new Promise((done) => merges.push({ id, o, done })),
    /** @param {string} chainId */
    wake: (chainId) => void wakes.push(chainId),
    /** @param {string} id */
    keepWork: (id) => void kept.push(id),
  };
  const archive = {
    /** @param {string} id @param {readonly string[]} keys */
    metaOf: (id, keys) => {
      const c = chains.get(id);
      return c ? Object.fromEntries(keys.filter((k) => c.meta?.[k] !== undefined).map((k) => [k, c.meta[k]])) : null;
    },
    /** @param {string} id @param {Record<string, any>} patch */
    mergeMeta: (id, patch) => {
      const c = chains.get(id);
      if (!c) return null;
      if (state.refuseKeeps > 0) {
        state.refuseKeeps -= 1;
        throw new Error("database is locked");
      }
      c.meta = structuredClone({ ...c.meta, ...patch });
      return c.meta;
    },
    openGraphs: () => [...chains.values()].filter((c) => c.meta.graph && !c.meta.graph.closed).map((c) => ({ id: c.id, graph: structuredClone(c.meta.graph) })),
  };
  let t = 1000;
  const make = () => createGraphRunner({ archive, registry: /** @type {any} */ (registry), events: { publish: () => {} }, crew: () => crew, log: () => {}, now: () => t++, mergeRetryMs });
  const runner = make();
  /** @param {string} id @returns {any} */
  const task = (id) => chains.get("c1").meta.graph.tasks.find((/** @type {any} */ x) => x.id === id);
  return { runner, make, chains, launches, resumes, told, merges, wakes, kept, cuts, state, task };
}

// (fails before: yes — the runner merged a finished worker's change into the folder by itself as it ended)
test("a finished worker's change is ready, never merged by the runner: it waits in its copy, holding no turn, until the planner applies it", async () => {
  const r = rig();
  ok(r.runner.apply("c1", ADD, AGENT));
  r.runner.attach("c1", TURN);
  assert.deepEqual(r.launches.map((l) => l.task.id), ["t1", "t2"]);
  r.runner.ended({ chainId: "c1", task: END("t1", "sa-1", FIX) });
  await tick();
  assert.deepEqual([r.task("t1").state, r.task("t1").step, r.merges.length], ["merging", "yours", 0], "nothing merges it");
  assert.deepEqual(r.kept, ["sa-1"], "its worker's thread is kept, so its work outlives a restart");
  const ready = r.told.at(-1);
  assert.match(ready.text, /^\[Filament: task t1 "Fix the parser" is ready: sub-agent sa-1 reported it done, and Filament's check passed \(`npm test`, 1 s\)\. Its change waits in sa-1's own copy, not in your folder yet: apply it when you choose — agent with agent_id "sa-1" and apply_changes: true\. The call answers once the change is in your folder; Filament then checks your folder with it, undoes it if it breaks the check, and its verdict reaches you as a message\. t3 needs it, and waits for its apply\. To have its sub-agent change it first, send it back with a note: tasks start with its id and note\. The developer may apply it themselves instead\.\n/);
  // The planner applies it: its merge starts, the graph's checked one, and the turn owes it while it runs.
  assert.deepEqual(r.runner.applyAsked({ chainId: "c1", agentId: "sa-1" }), { ok: true, id: "t1", stands: false });
  assert.deepEqual([r.task("t1").step, r.merges.map((m) => [m.id, m.o.reason])], [null, [["sa-1", null]]]);
  assert.deepEqual(r.runner.applyAsked({ chainId: "c1", agentId: "sa-1" }), { ok: true, id: "t1", stands: false }, "asked again: the same merge");
  assert.equal(r.merges.length, 1);
  r.merges[0].done({ ok: true, files: FIX, repo: "/p", check: { kind: "passed", runs: [], ruled: [] } });
  await tick();
  assert.deepEqual([r.task("t1").state, r.task("t1").merged], ["done", { files: 1, added: 12, removed: 3 }]);
  assert.match(r.told.at(-1).text, /^\[Filament: task t1 "Fix the parser" is done: .* and its change is merged into your folder\./);
  assert.equal(r.told.at(-1).wakes, true, "the verdict of what the planner asked wakes it");
  // A worker still at work, or one no task of the graph's waits on: refused in words, or no graph's.
  assert.deepEqual(r.runner.applyAsked({ chainId: "c1", agentId: "sa-2" }), { ok: false, error: "its worker is still at work on task t2: its change waits for its report" });
  assert.equal(r.runner.applyAsked({ chainId: "c1", agentId: "sa-9" }), null);
  assert.equal(r.runner.applyAsked({ chainId: "c9", agentId: "sa-1" }), null);
});

// (fails before: yes — the same: what needed a task started as soon as its merge, Filament's own, was in)
test("the tasks that need a ready change wait for its apply, and say so; they start once it is applied and merged", async () => {
  const r = rig();
  ok(r.runner.apply("c1", ADD, AGENT));
  r.runner.attach("c1", TURN);
  r.runner.ended({ chainId: "c1", task: END("t1", "sa-1", FIX) });
  await tick();
  assert.deepEqual([r.task("t3").state, r.launches.map((l) => l.task.id)], ["waiting", ["t1", "t2"]], "t3 waits");
  assert.match(tg.showText(r.chains.get("c1").meta.graph, "agent"), /\n- t3 "Use the parser" — waiting for the apply of t1 · by sub-agent · needs t1 · writes src\/main\.js\n/);
  assert.match(tg.showText(r.chains.get("c1").meta.graph, "agent"), /\nWaiting on others: t3 on t1 \(ready to apply\)\.\n/);
  assert.deepEqual(r.runner.applyAsked({ chainId: "c1", agentId: "sa-1" }), { ok: true, id: "t1", stands: false });
  assert.equal(r.launches.length, 2, "applying is not applied: it waits for the merge");
  r.merges[0].done({ ok: true, files: FIX, repo: "/p", check: { kind: "passed", runs: [], ruled: [] } });
  await tick();
  assert.deepEqual(r.launches.map((l) => l.task.id), ["t1", "t2", "t3"], "merged: t3 starts");
  // The developer's own Apply frees it too, and wakes the planner, whose turn starts what it freed.
  const d = rig();
  ok(d.runner.apply("c1", ADD, AGENT));
  d.runner.attach("c1", TURN);
  d.runner.ended({ chainId: "c1", task: END("t1", "sa-1", FIX) });
  d.runner.detach("c1", "turn-1");
  d.runner.applied({ chainId: "c1", agentId: "sa-1", files: FIX });
  assert.deepEqual([d.task("t1").state, d.told.at(-1).task, d.told.at(-1).wakes], ["done", "t1", true]);
  d.runner.attach("c1", { ...TURN, runId: "turn-2" });
  assert.deepEqual(d.launches.map((l) => l.task.id), ["t1", "t2", "t3"]);
});

// (fails before: yes — every worker's end woke the planner's wait, one model round each)
test("one wake for the graph's workers: an end nothing waits on is held while others still work, and the next end that wakes the planner takes it along", async () => {
  const r = rig();
  ok(r.runner.apply("c1", ADD, AGENT));
  r.runner.attach("c1", TURN);
  r.runner.ended({ chainId: "c1", task: END("t2", "sa-2", TESTS) });
  assert.deepEqual([r.told.at(-1).task, r.told.at(-1).held, r.told.at(-1).wakes], ["t2", true, undefined], "nothing needs t2, and t1 still works: held");
  r.runner.ended({ chainId: "c1", task: END("t1", "sa-1", FIX) });
  assert.deepEqual([r.told.at(-1).task, r.told.at(-1).held, r.told.at(-1).wakes], ["t1", undefined, true], "the last: it wakes the planner, the held one with it");
  assert.deepEqual(r.wakes, [], "no wake of the runner's own: the last end carried it");
  // With no turn of the graph's running — the developer's side run in a coding agent's chat — the graph going quiet with
  // no end of its own to carry it wakes the chat for the held ones.
  const q = rig();
  ok(q.runner.apply("c1", ADD, AGENT));
  q.runner.attach("c1", TURN);
  q.runner.ended({ chainId: "c1", task: END("t2", "sa-2", TESTS) });
  assert.equal(q.told.at(-1).held, true);
  q.runner.detach("c1", "turn-1");
  q.runner.apply("c1", { action: "drop", ids: ["t1", "t3"], reason: "not needed" }, AGENT);
  assert.deepEqual(q.wakes, ["c1"], "quiet now: the held end wakes the chat");
});

/** A writer nothing needs, beside the graph's others. */
const T4 = { id: "t4", name: "Write the docs", by: "sub-agent", writes: ["docs/parse.md"], goal: "Docs for empty input", steps: ["Write them"], acceptance: "they say it", check: ["npm run docs"] };
const DOCS = [{ path: "docs/parse.md", added: 8, removed: 0 }];

// (fails before: yes — t1's end was held while t2 worked, though t3 waited on it: t3's wait ran to t2's end)
test("an end an open task needs wakes the planner at once, while the graph's others still work; one nothing needs is held", async () => {
  const r = rig();
  ok(r.runner.apply("c1", { ...ADD, tasks: [...ADD.tasks, T4] }, AGENT));
  r.runner.attach("c1", TURN);
  assert.deepEqual(r.launches.map((l) => l.task.id), ["t1", "t2", "t4"]);
  r.runner.ended({ chainId: "c1", task: END("t4", "sa-3", DOCS) });
  const four = r.told.at(-1);
  assert.deepEqual([four.task, four.held, four.wakes], ["t4", true, undefined], "nothing needs t4, and t1 and t2 still work: held");
  // t1 is short, t2 long: t3 needs t1, so t1's end wakes the planner — t4's held end with it — while t2 still works.
  r.runner.ended({ chainId: "c1", task: END("t1", "sa-1", FIX) });
  const one = r.told.at(-1);
  assert.deepEqual([one.task, one.held, one.wakes], ["t1", undefined, true], "t3 needs t1: it wakes the planner now");
  assert.equal(r.task("t2").state, "running", "t2 still works");
  assert.deepEqual(r.runner.applyAsked({ chainId: "c1", agentId: "sa-1" }), { ok: true, id: "t1", stands: false });
  r.merges[0].done({ ok: true, files: FIX, repo: "/p", check: { kind: "passed", runs: [], ruled: [] } });
  await tick();
  assert.deepEqual(r.launches.map((l) => l.task.id), ["t1", "t2", "t4", "t3"], "t3 starts while t2 still works");
  // A failed end an open task needs wakes the planner as well.
  const f = rig();
  ok(f.runner.apply("c1", ADD, AGENT));
  f.runner.attach("c1", TURN);
  f.runner.ended({ chainId: "c1", task: { ...END("t1", "sa-1", FIX), status: "failed", error: "the model's provider refused it", report: null } });
  assert.deepEqual([f.task("t1").state, f.told.at(-1).task, f.told.at(-1).held, f.told.at(-1).wakes], ["failed", "t1", undefined, true]);
});

// (fails before: yes — a held end said how the graph stood as it was told, stale by the time it was read beside a fresh one)
test("a held end says nothing of how the graph stands; the end that wakes the planner says it", () => {
  const r = rig();
  ok(r.runner.apply("c1", { ...ADD, tasks: [...ADD.tasks, T4] }, AGENT));
  r.runner.attach("c1", TURN);
  r.runner.ended({ chainId: "c1", task: END("t4", "sa-3", DOCS) });
  assert.equal(r.told.at(-1).held, true);
  assert.doesNotMatch(r.told.at(-1).text, /\nNow: /);
  r.runner.ended({ chainId: "c1", task: END("t1", "sa-1", FIX) });
  assert.match(r.told.at(-1).text, /\nNow: .*\.\]$/);
});

// (fails before: yes — close said a ready change "is merging into the folder — close the graph once it is done", which it
// never is without its apply)
test("close with a change ready names it as ready and gives both ways out; a merge that runs keeps its words", async () => {
  const r = rig();
  ok(r.runner.apply("c1", ADD, AGENT));
  r.runner.attach("c1", TURN);
  r.runner.ended({ chainId: "c1", task: END("t1", "sa-1", FIX) });
  const ready = r.runner.apply("c1", { action: "close", reason: "Shipped" }, AGENT);
  assert.deepEqual(ready, { ok: false, error: `t1's change is ready and waits for its apply — apply it (agent with agent_id "sa-1" and apply_changes: true), or drop it, then close the graph` });
  r.runner.applyAsked({ chainId: "c1", agentId: "sa-1" });
  assert.deepEqual(r.runner.apply("c1", { action: "close", reason: "Shipped" }, AGENT), { ok: false, error: "t1 is merging into the folder — close the graph once it is done" });
});

// (fails before: yes — `tasks start` on a ready task was refused as "ready, its change waiting for its apply already",
// while the planner's follow-up to its worker was told to do just that; and the words around a ready task named no way
// back to its worker)
test("tasks start on a ready task sends it back to its worker with the note; its next end is ready again, and its apply then goes", async () => {
  const r = rig();
  ok(r.runner.apply("c1", ADD, AGENT));
  r.runner.attach("c1", TURN);
  r.runner.ended({ chainId: "c1", task: END("t1", "sa-1", FIX) });
  assert.match(r.told.at(-1).text, / To have its sub-agent change it first, send it back with a note: tasks start with its id and note\. The developer may apply it themselves instead\./);
  // What a ready task's planner may not do says what it may.
  assert.match(String(/** @type {any} */ (r.runner.apply("c1", { action: "change", tasks: [{ id: "t1", goal: "parse() takes null too" }] }, AGENT)).error), /t1's change is ready and waits for its apply — it can't change now: apply it, send it back with a note \(tasks start with its id and note\), or drop it/);
  // A lead's merge, and the note of an agent that reads along with its sub-agents, of the same graph's ready task.
  const lead = { at: 5000, crew: membersOf({ scout: "", builder: "", tester: "", reviewer: "" }) };
  const g = r.chains.get("c1").meta.graph;
  assert.match(String(/** @type {any} */ (tg.applyTasks(g, { action: "merge", id: "t1", reason: "fine" }, lead)).error), /^t1's change is ready and waits for its apply — merge takes a failed task's change; apply this one: worker with agent_id "sa-1" and apply_changes: true/);
  assert.match(String(/** @type {any} */ (tg.applyTasks(g, { action: "note", id: "t1", note: "null too" }, { at: 5000, crew: "agent", reads: true })).error), /its change is ready and waits for its apply — apply it \(agent with agent_id "sa-1" and apply_changes: true\), or send it back with a note: tasks start with its id and note/);
  const back = ok(r.runner.apply("c1", { action: "start", ids: ["t1"], note: "Take null as empty too" }, AGENT));
  assert.match(back.text, /^Sent t1 back: sub-agent sa-1 goes on with it once its needs are done and a slot is free, in its own conversation — what it did is there, and it reads why it came back and your note\./);
  assert.deepEqual(r.resumes.map((x) => x.id), ["sa-1"], "its worker goes on with it, in its own conversation");
  assert.match(r.resumes[0].prompt, /^\[Filament: your try at task t1 ended: its change was ready, and its planner sent it back before applying it\. The agent sent the task back to you: go on from where you stopped/);
  assert.match(r.resumes[0].prompt, /The agent's note for you: Take null as empty too/);
  assert.deepEqual([r.task("t1").state, r.task("t1").agent, r.merges.length], ["running", "sa-1", 0], "nothing applied");
  r.runner.ended({ chainId: "c1", task: { ...END("t1", "sa-1", [{ path: "src/parse.js", added: 15, removed: 3 }]), exchange: 1 } });
  await tick();
  assert.deepEqual([r.task("t1").state, r.task("t1").step], ["merging", "yours"], "ready again");
  assert.deepEqual(r.runner.applyAsked({ chainId: "c1", agentId: "sa-1" }), { ok: true, id: "t1", stands: false });
  r.merges[0].done({ ok: true, files: [{ path: "src/parse.js", added: 15, removed: 3 }], repo: "/p", check: { kind: "passed", runs: [], ruled: [] } });
  await tick();
  assert.deepEqual([r.task("t1").state, r.launches.at(-1).task.id], ["done", "t3"]);
});

/** A graph task's end whose check failed in its copy: its change waits there, the task failed. @param {string} id @param {string} agent @param {any[]} files @returns {any} */
const RED = (id, agent, files) => ({ ...END(id, agent, files), report: { status: "done", did: "Did it.", met: false, evidence: "npm test fails", left: "" }, check: { ran: true, commands: ["npm test"], runs: [{ command: "npm test", exit: 1, ms: 9, output: "1 failing", stopped: false, first: null }], bounces: 2, stopped: false } });
/** The folder's check, red with a change that went in as it stood. */
const STOOD = { kind: "reason", runs: [{ command: "npm test", after: { command: "npm test", exit: 1, ms: 9_000, output: "1 failing", stopped: false }, before: null, own: false }], ruled: [] };

// (fails before: yes — the planner's apply of a failed task went in on "the lead's word", the default words passed as a
// reason, and its verdict said it stood "for your reason")
test("the planner's apply of a failed task goes in as it stood, on the agent's word: its check runs, its verdict says the check is red and the change stands, and what starts on it", async () => {
  const r = rig();
  ok(r.runner.apply("c1", ADD, AGENT));
  r.runner.attach("c1", TURN);
  r.runner.ended({ chainId: "c1", task: RED("t1", "sa-1", FIX) });
  assert.equal(r.task("t1").state, "failed");
  assert.deepEqual(r.runner.applyAsked({ chainId: "c1", agentId: "sa-1" }), { ok: true, id: "t1", stands: true });
  assert.deepEqual([r.merges[0].o.reason, r.merges[0].o.stands], [null, true], "no reason given, none made up: it stands, said so");
  assert.match(ok(r.runner.apply("c1", { action: "show", id: "t1" }, AGENT)).text, /\nMerging as it stood, on the agent's word\n/);
  r.merges[0].done({ ok: true, files: FIX, repo: "/p", check: STOOD });
  await tick();
  assert.equal(r.task("t1").summary, "Did it.\nMerged as it stood, on the agent's word");
  const end = r.told.at(-1).text;
  assert.match(end, /^\[Filament: task t1 "Fix the parser" is done: sub-agent sa-1's change is merged into your folder as it stood, on your word\. t3 starts on it as it stands\. Filament's check of the folder fails with it — `npm test` failed \(exit 1, 9 s\) — and it stands, red, as you asked for it as it stood\.\n/);
  assert.equal(r.launches.at(-1).task.id, "t3");
  // A lead's apply of one goes in on its word and reason.
  const lead = rig();
  ok(lead.runner.apply("c1", ADD, AGENT));
  lead.runner.attach("c1", TURN);
  lead.runner.ended({ chainId: "c1", task: RED("t1", "sa-1", FIX) });
  const asked = /** @type {any} */ (tg.applyAsked(lead.chains.get("c1").meta.graph, "sa-1", { reason: "the test is flaky", by: "lead" }));
  const merged = /** @type {any} */ (tg.taskMerged(asked.graph, "t1", FIX, 9000, null));
  assert.equal(merged.tasks.find((/** @type {any} */ x) => x.id === "t1").summary, "Did it.\nMerged as it stood, on the lead's word: the test is flaky");
});

// (fails before: yes — a merge pass whose end the session could not keep left its task merging, its verdict in hand, and
// the turn owing it, until some other call came)
test("a merge pass whose end the session could not keep is tried again by itself: its task is done, told, and the turn let go", async () => {
  const r = rig({ mergeRetryMs: 5 });
  ok(r.runner.apply("c1", { ...ADD, tasks: [ADD.tasks[0]] }, AGENT));
  r.runner.attach("c1", TURN);
  r.runner.ended({ chainId: "c1", task: END("t1", "sa-1", FIX) });
  ok(/** @type {any} */ (r.runner.applyAsked({ chainId: "c1", agentId: "sa-1" })));
  const owed = r.runner.owes("c1");
  assert.ok(owed, "the turn owes the merge");
  r.state.refuseKeeps = 1;
  r.merges[0].done({ ok: true, files: FIX, repo: "/p", check: { kind: "passed", runs: [], ruled: [] } });
  await tick();
  assert.equal(r.task("t1").state, "merging", "not kept: it waits");
  await owed;
  assert.deepEqual([r.task("t1").state, r.merges.length], ["done", 1], "its verdict in hand: taken, not merged again");
  assert.match(r.told.at(-1).text, /^\[Filament: task t1 "Fix the parser" is done:/);
  assert.equal(r.runner.owes("c1"), null);
  // Never kept: the turn's waits go after the tries, the merge waiting for the session's next move.
  const n = rig({ mergeRetryMs: 1 });
  ok(n.runner.apply("c1", { ...ADD, tasks: [ADD.tasks[0]] }, AGENT));
  n.runner.attach("c1", TURN);
  n.runner.ended({ chainId: "c1", task: END("t1", "sa-1", FIX) });
  ok(/** @type {any} */ (n.runner.applyAsked({ chainId: "c1", agentId: "sa-1" })));
  const never = n.runner.owes("c1");
  n.state.refuseKeeps = 1000;
  n.merges[0].done({ ok: true, files: FIX, repo: "/p", check: { kind: "passed", runs: [], ruled: [] } });
  await never;
  assert.equal(n.task("t1").state, "merging");
});

// (fails before: yes — both graph sections said every end waited for the graph's workers to be done)
test("the prompts say it: a lead applies a ready change when it chooses, and an end another task waits on comes at once — static words, version 77", () => {
  assert.equal(PROMPT_VERSION, 129);
  assert.match(PROMPT.leadGraph, / Apply it when you choose — worker with its agent_id and apply_changes: true\. The call answers once the change is in the folder;/);
  assert.ok(!String(PROMPT.leadGraph).includes("Validate"), "no mode holds the apply");
  for (const [section, who] of [[PROMPT.leadGraph, "workers"], [[PROMPT.graphSubagents].flat().join("\n"), "sub-agents"]])
    assert.ok(section.includes(`reaches you as a message from Filament — at once where another task waits on it, the rest once for all of them when the graph's ${who} are done — and your turn`), who);
});

// (fails before: yes — the developer's Stop cut the check of the merge running alone; those its planner applied that
// waited their turn ran theirs after it)
test("the developer's stop cuts the folder's check of each merge the planner applied", () => {
  const r = rig();
  ok(r.runner.apply("c1", ADD, AGENT));
  r.runner.attach("c1", TURN);
  r.runner.stop("c1");
  assert.deepEqual(r.cuts, ["c1"]);
});

// (fails before: yes — a restart came as the runner merged, and failed the task; a ready change had no such state)
test("a restart while a change waits for its apply keeps it waiting, in its copy, and the planner can still apply it", async () => {
  const r = rig();
  ok(r.runner.apply("c1", ADD, AGENT));
  r.runner.attach("c1", TURN);
  r.runner.ended({ chainId: "c1", task: END("t1", "sa-1", FIX) });
  const later = r.make();
  r.told.length = 0;
  later.reconcile();
  assert.deepEqual([r.task("t1").state, r.task("t1").step], ["merging", "yours"], "not cut: nothing ran");
  assert.equal(r.told.some((d) => d.task === "t1"), false, "nothing to tell of it");
  assert.equal(later.waitsForYou("c1", "sa-1"), true, "its worker's thread stays kept");
  assert.deepEqual(later.applyAsked({ chainId: "c1", agentId: "sa-1" }), { ok: true, id: "t1", stands: false });
  assert.equal(r.merges.at(-1)?.id, "sa-1");
});

// (fails before: yes — the side run's sheet sent `wait`, the route kept it, and a side run's change with a check was
// merged once it passed, unless that switch was on)
test("the side run's old 'apply on check pass or wait for Apply' choice is gone: the sheet sends none, the graph keeps none, and a claim saved with it waits for its apply all the same", () => {
  const t = { id: "t1", name: "Fix", writes: ["src/parse.js"], check: ["npm test"] };
  assert.deepEqual(sideBody([{ t, on: true, model: "m", folder: "copy", brief: null, editing: false }], { starts: "now" }), { starts: "now", tasks: [{ id: "t1", model: "m", folder: "copy" }] });
  const own = ok(tg.applyTasks(null, { action: "add", goal: "g", tasks: [{ id: "t1", name: "Fix", writes: ["src/parse.js"], check: ["npm test"] }] }, { at: 1, crew: "agent" })).graph;
  const claimed = ok(tg.sideRun(own, [/** @type {any} */ ({ id: "t1", model: "m", folder: "copy", wait: true })], { at: 2, crew: "agent", starts: "now" })).graph;
  assert.equal("wait" in claimed.tasks[0].side, false, "a pick's wait is read no more");
  // A claim an older Filament kept with "apply on check pass": its change waits for its apply as every one does.
  const old = structuredClone(claimed);
  old.tasks[0].side.wait = false;
  const running = /** @type {any} */ (tg.launched(old, "t1", "sa-1", 3, "sub-agent"));
  const ended = /** @type {any} */ (tg.taskEnded(running, "t1", { ...END("t1", "sa-1", FIX), check: PASSED("npm test") }, 4));
  assert.deepEqual([ended.state, tg.mergeNext(ended.graph)], ["yours", null]);
});

// (fails before: yes — past the last try the turn's waits went once, its verdict untold, and the task stayed merging and
// owed: the next turn's end waited on it with no limit)
test("a merge's end the session's record never takes is told as it came after the last try, and no turn waits on it; the graph's next change keeps it", async () => {
  const r = rig({ mergeRetryMs: 1 });
  ok(r.runner.apply("c1", { ...ADD, tasks: [ADD.tasks[0], ADD.tasks[2]] }, AGENT));
  r.runner.attach("c1", TURN);
  r.runner.ended({ chainId: "c1", task: END("t1", "sa-1", FIX) });
  ok(/** @type {any} */ (r.runner.applyAsked({ chainId: "c1", agentId: "sa-1" })));
  const owed = r.runner.owes("c1");
  r.state.refuseKeeps = 1000;
  r.merges[0].done({ ok: true, files: FIX, repo: "/p", check: { kind: "passed", runs: [], ruled: [] } });
  await owed;
  assert.deepEqual([r.task("t1").state, r.task("t1").step], ["merging", null], "the record still shows it merging");
  const end = r.told.at(-1);
  assert.deepEqual([end.task, end.wakes, end.wrote], ["t1", true, true]);
  assert.match(end.text, /^\[Filament: task t1 "Fix the parser" is done: .* and its change is merged into your folder\./);
  assert.match(end.text, /\nFilament could not write this into the session's record after 6 tries, so the graph still shows t1 merging, and what needs it waits: no turn waits on it, and Filament writes it with the graph's next change — a tasks call of yours that changes the graph, or an apply\. A Filament restart before then fails t1 as cut\.\]$/);
  // The turn after it is not held by it.
  r.runner.detach("c1", "turn-1");
  r.runner.attach("c1", { ...TURN, runId: "turn-2" });
  assert.equal(r.runner.owes("c1"), null);
  // The record takes writes again: the graph's next change keeps that end — told once — and what needs it starts.
  r.state.refuseKeeps = 0;
  ok(r.runner.apply("c1", { action: "change", goal: "Ship the parser for empty input" }, AGENT));
  await tick();
  assert.deepEqual([r.task("t1").state, r.launches.map((l) => l.task.id), r.merges.length], ["done", ["t1", "t3"], 1], "kept as it came, never merged again");
  assert.equal(r.told.filter((d) => d.task === "t1").length, 2, "its ready end and its verdict");
});

// (fails before: yes — a restart that cut the agent's apply of a failed task left the task failed and "Merged as it
// stood, on the agent's word", and a lead's merge of it after went in on the agent's word, standing whatever its check)
test("a merge as it stood a restart cut goes in on nobody's word; a lead's merge of it after is on the lead's", () => {
  const r = rig();
  ok(r.runner.apply("c1", ADD, AGENT));
  r.runner.attach("c1", TURN);
  r.runner.ended({ chainId: "c1", task: RED("t1", "sa-1", FIX) });
  assert.deepEqual(r.runner.applyAsked({ chainId: "c1", agentId: "sa-1" }), { ok: true, id: "t1", stands: true });
  const later = r.make();
  later.reconcile();
  assert.deepEqual([r.task("t1").state, r.task("t1").overruled, "overruledBy" in r.task("t1")], ["failed", "", false]);
  assert.doesNotMatch(ok(later.apply("c1", { action: "show", id: "t1" }, AGENT)).text, /as it stood/);
  const lead = { crew: membersOf({ scout: "", builder: "", tester: "", reviewer: "" }) };
  ok(later.apply("c1", { action: "merge", id: "t1", reason: "the test is flaky" }, lead));
  assert.deepEqual([r.task("t1").overruledBy, r.merges.length, r.merges.at(-1)?.o.stands, r.merges.at(-1)?.o.reason], ["lead", 2, false, "the test is flaky"]);
});

// (fails before: yes — its worker unable to go on, the ready task went to a new worker from the folder, and its change
// stayed in the old copy, which the graph named no more)
test("a ready task whose worker can't take it back is not sent back: the call says so and how to go on, and its change stays ready", () => {
  const r = rig();
  ok(r.runner.apply("c1", ADD, AGENT));
  r.runner.attach("c1", TURN);
  r.runner.ended({ chainId: "c1", task: END("t1", "sa-1", FIX) });
  r.state.cannotResume = "Filament restarted since it ran, and its conversation went with it";
  assert.deepEqual(r.runner.apply("c1", { action: "start", ids: ["t1"], note: "null too" }, AGENT), { ok: false, error: `t1's change is ready in sa-1's copy, and its sub-agent sa-1 can't take it back — Filament restarted since it ran, and its conversation went with it: apply it (agent with agent_id "sa-1" and apply_changes: true), or drop it and add the task again` });
  // Asked fresh, the same: a new worker would start without the change.
  r.state.cannotResume = null;
  assert.match(String(/** @type {any} */ (r.runner.apply("c1", { action: "start", ids: ["t1"], fresh: true }, AGENT)).error), /^t1's change is ready in sa-1's copy, and fresh would give the task to a new sub-agent from the folder as it stands, without it: apply it \(agent with agent_id "sa-1" and apply_changes: true\), or drop it and add the task again$/);
  assert.deepEqual([r.task("t1").state, r.task("t1").step, r.task("t1").agent, r.launches.length], ["merging", "yours", "sa-1", 2]);
  assert.deepEqual(r.runner.applyAsked({ chainId: "c1", agentId: "sa-1" }), { ok: true, id: "t1", stands: false });
});

// (fails before: yes — the review of a8e034ded: a side run's task sent back to a new worker ran at the main agent's
// effort, its pick dropped)
test("a side run's task sent back to a new worker runs on its model at the effort picked for it, as its first worker did", () => {
  const r = rig();
  ok(r.runner.apply("c1", { ...ADD, tasks: [{ ...ADD.tasks[0], by: "you" }] }, AGENT));
  ok(r.runner.sideRun("c1", [{ id: "t1", model: "m2", effort: "high", folder: "copy" }], { starts: "now" }));
  r.runner.attach("c1", TURN);
  r.runner.ended({ chainId: "c1", task: { ...END("t1", "sa-1", FIX), status: "failed", error: "the model's provider refused it", report: null } });
  ok(r.runner.sendBack("c1", "t1", { fresh: true }));
  assert.deepEqual(r.launches.map((l) => [l.task.id, l.parentModel, l.effort]), [["t1", "m2", "high"], ["t1", "m2", "high"]]);
});

// (fails before: yes — the review of 5b35e53aa: where a fork paid, a side run's task sent back to a new worker was tried
// as a fork naming no model of its own, which the registry takes on the planner's)
test("a side run's task sent back to a new worker where a fork pays names its own model, so a fork on the planner's is refused it", () => {
  const r = rig();
  ok(r.runner.apply("c1", { ...ADD, tasks: [{ ...ADD.tasks[0], by: "you" }] }, AGENT));
  ok(r.runner.sideRun("c1", [{ id: "t1", model: "m2", folder: "copy" }], { starts: "now" }));
  r.runner.attach("c1", { ...TURN, forkable: () => true });
  r.runner.ended({ chainId: "c1", task: { ...END("t1", "sa-1", FIX), status: "failed", error: "the model's provider refused it", report: null } });
  ok(r.runner.sendBack("c1", "t1", { fresh: true }));
  assert.deepEqual(r.launches.map((l) => [l.view ?? null, l.model, l.parentModel]), [[null, "m2", "m2"], ["fork", "m2", "m2"]]);
});
