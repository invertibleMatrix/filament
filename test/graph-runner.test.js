// @ts-check
// HarnessV3-TaskGraph G2: the graph's runner (app/agent/graph-runner.js), against a session kept in memory and a
// registry that records what it is asked. It starts the sub-agents' tasks only while a turn runs,
// as slots allow, each with its brief; moves a task on as its sub-agent ends — done, merged one at a time, failed,
// stopped — and tells the agent once what may start next has started; holds the turn while the graph works; holds the
// graph at the developer's Stop until the agent's next tasks call; stops the sub-agent of a task the agent drops; and
// fails, as Filament starts, what a restart cut. G3: under a team's lead the tasks start as its workers, and a writer's
// change goes to a reviewer before it merges — the changes asked back to the same worker, the next round read by the
// same reviewer. HarnessV3-TaskGraph-v2 V2-0c: the note of an agent that reads along goes to whoever works on a task
// now, a show of a task reads its sub-agent's change so far, and a task's end names the note its sub-agent never read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";
import * as tg from "../src/core/task-graph.js";
import * as subagents from "../src/app/agent/subagents.js";
import { sessionRoutes } from "../src/http/admin/sessions.js";
import { createRouter } from "../src/http/router.js";
import { membersOf } from "./helpers/roster.js";

/** A promise and the hand that settles it. */
const deferred = () => {
  /** @type {(v?: any) => void} */
  let resolve = () => {};
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const TURN = { runId: "turn-1", cwd: "/p", mode: null, model: "m", thinking: null, team: null };
/** @type {{ crew: import("../src/core/task-graph.js").Crew }} */
const AGENT = { crew: "agent" };
const ADD = {
  action: "add",
  goal: "Ship the parser",
  tasks: [
    { id: "t1", name: "Map the parser", by: "explorer", goal: "Know every caller of parse()", steps: ["Search for parse("], acceptance: "every caller listed" },
    { id: "t2", name: "Fix the parser", needs: ["t1"], by: "sub-agent", writes: ["src/parse.js"], goal: "parse() takes empty input", steps: ["Fix it", "Run the tests"], acceptance: "npm test passes" },
    { id: "t3", name: "Write the tests", by: "sub-agent", writes: ["test/parse.test.js"], goal: "Tests for empty input", steps: ["Write them"], acceptance: "they fail first" },
    { id: "t4", name: "Update the docs", needs: ["t2", "t3"] },
  ],
};
/**
 * A graph task's end as the registry tells it.
 * @param {string} id @param {string} agent @param {Record<string, any>} [more] @returns {any}
 */
const END = (id, agent, more = {}) => ({ id, exchange: 0, toolCalls: 3, roundIds: [`r-${agent}`], launchedBy: "turn-1", agent, status: "done", stoppedBy: null, error: null, report: { status: "done", did: "Did it.", met: true, evidence: "the check passed", left: "" }, words: "Finished.", files: [], shared: false, wrote: false, workError: null, ran: [], calls: [], written: [], spentUsd: 0.25, ms: 60_000, cut: false, ...more });
const FIX = [{ path: "src/parse.js", added: 12, removed: 3 }];
const TESTS = [{ path: "test/parse.test.js", added: 30, removed: 0 }];
/**
 * A merge that went in, as the apply answers it: the repository it went into, and its files.
 * @param {{ path: string, added: number, removed: number }[]} files @param {string} status
 */
const mergedIn = (files, status) => ({ ok: true, repo: TURN.cwd, files: files.map((f) => ({ ...f, status, binary: false })) });
/** The team's own words for its members: none for its tester. */
const WORDS = { scout: "Map what exists.", builder: "Build against the contract.", tester: "", reviewer: "Review against the contract." };
const LED = membersOf(WORDS);
const TEAM = { key: "architect", name: "Architect", members: LED };
/** A turn a team's lead runs. */
const LEAD_TURN = { ...TURN, team: TEAM };
/** @type {{ crew: import("../src/core/task-graph.js").Crew }} */
const LEAD = { crew: LED };
/** The parser's graph as a team's lead plans it: t2's change is read by a reviewer before it merges. */
const TEAM_ADD = {
  action: "add",
  goal: "Ship the parser",
  tasks: [
    { id: "t1", name: "Map the parser", by: "scout", goal: "Know every caller of parse()", steps: ["Search for parse("], acceptance: "every caller listed" },
    { id: "t2", name: "Fix the parser", needs: ["t1"], by: "builder", writes: ["src/parse.js"], review: true, goal: "parse() takes empty input", steps: ["Fix it", "Run the tests"], acceptance: "npm test passes" },
    { id: "t3", name: "Write the tests", by: "tester", writes: ["test/parse.test.js"], goal: "Tests for empty input", steps: ["Write them"], acceptance: "they fail first" },
  ],
};
/** A reviewer's report: the change does what the task asks, or the changes it needs. @param {string} left */
const REVIEW = (left) => ({ status: "done", did: "Read the change.", met: !left, evidence: left ? "an empty input throws" : "npm test passes", left });

/**
 * A session's chain kept in memory, a registry that records launches, stops, tells and applies — its slots the
 * ceiling less what runs, a launch refused in `state.refuse`'s words (every launch's, or those a function of the launch
 * names) — and reads a sub-agent's change and goes on with one (`state.change`, `state.resumeRefuse`), says whether
 * one can (`state.unresumable`), and the bus.
 * `state.crew` is who leads the session while no turn runs.
 * @param {{ slots?: number }} [o]
 */
function rig({ slots = 4 } = {}) {
  /** @type {Map<string, any>} */
  const chains = new Map([["c1", { id: "c1", meta: {} }]]);
  /** @type {any[]} */
  const launches = [];
  /** @type {any[]} */
  const stops = [];
  /** @type {any[]} */
  const told = [];
  /** @type {{ id: string, o: any, done: ReturnType<typeof deferred> }[]} */
  const applies = [];
  /** @type {any[]} */
  const published = [];
  /** @type {any[]} */
  const resumes = [];
  /** @type {string[]} */
  const read = [];
  /** What the registry was asked of a resume: the agent, the session and the running turn's model. @type {any[][]} */
  const resumables = [];
  /** The messages sent to a running sub-agent, and whose change so far was asked for. @type {any[][]} */
  const messages = [];
  /** @type {string[][]} */
  const asked = [];
  const state = {
    slots,
    running: 0,
    refuse: /** @type {string | ((spec: any) => string | null) | null} */ (null),
    n: 0,
    t: 1000,
    crew: /** @type {import("../src/core/task-graph.js").Crew} */ ("agent"),
    change: /** @type {any} */ ({ ok: true, files: FIX.map((f) => ({ ...f, status: "M", binary: false })), diff: "THE DIFF" }),
    resumeRefuse: /** @type {string | null} */ (null),
    unresumable: /** @type {string | null} */ (null),
    messageRefuse: /** @type {string | null} */ (null),
    messageAsking: /** @type {string | null} */ (null),
    soFar: /** @type {any} */ ({ ok: true, text: "THE CHANGE SO FAR", note: "1 file" }),
    /** No slot free: a launch or a going on that may wait (`waits`) waits, in these words; any other is refused in them. */
    full: /** @type {string | null} */ (null),
  };
  /** The waits for a slot, by the sub-agent that waits: the test settles each. @type {{ id: string, room: ReturnType<typeof deferred> }[]} */
  const rooms = [];
  /** A wait for a slot, where none is free. @param {string} id */
  const waitIn = (id) => {
    if (!state.full) return {};
    const room = deferred();
    rooms.push({ id, room });
    return { waiting: state.full, room: room.promise };
  };
  const registry = {
    /** @param {any} spec */
    launch: (spec) => {
      const no = typeof state.refuse === "function" ? state.refuse(spec) : state.refuse;
      if (no) return { ok: false, error: no };
      if (state.full && !spec.waits) return { ok: false, error: state.full };
      launches.push(spec);
      state.running += 1;
      const id = `sa-${++state.n}`;
      return { ok: true, id, done: new Promise(() => {}), ...waitIn(id) };
    },
    slots: () => Math.max(0, state.slots - state.running),
    /** @param {string} id */
    changes: async (id) => (read.push(id), state.change),
    /** @param {string} id @param {{ chainId: string, prompt: string, requestId: string, waits?: boolean }} o */
    resumeTask: (id, o) => {
      if (state.resumeRefuse) return { ok: false, error: state.resumeRefuse };
      if (state.full && !o.waits) return { ok: false, error: state.full };
      resumes.push({ id, ...o });
      state.running += 1;
      return { ok: true, id, done: new Promise(() => {}), ...waitIn(id) };
    },
    /** Whether a task's last worker can go on with it: `state.unresumable` says why not. @param {string} id @param {string} chainId */
    resumable: (id, chainId) => (resumables.push([id, chainId]), state.unresumable),
    /** @param {string} chainId @param {any} d */
    tell: (chainId, d) => told.push({ chainId, ...d }),
    /** @param {string} id @param {any} m */
    message: (id, m) => (state.messageRefuse ? { ok: false, error: state.messageRefuse } : (messages.push([id, m]), { ok: true, asking: state.messageAsking || null })),
    /** @param {string} id @param {string} chainId */
    changesSoFar: async (id, chainId) => (asked.push([id, chainId]), state.soFar),
    /** @param {string} id @param {{ from?: string }} [o] */
    stop: (id, o) => (stops.push([id, o?.from]), { ok: true }),
    /** The graph's merge (V2-2's checked one): it answers as the test resolves it. @param {string} id @param {string} chainId @param {any} o */
    mergeTask: (id, chainId, o) => {
      const done = deferred();
      applies.push({ id, o, done });
      return done.promise;
    },
    guard: () => {},
  };
  /** How often the graph was read out of the chain's meta. */
  const reads = { metaOf: 0 };
  const archive = {
    /** The meta's named keys, as the archive's `metaOf` reads them. @param {string} id @param {readonly string[]} keys */
    metaOf: (id, keys) => {
      reads.metaOf += 1;
      const c = chains.get(id);
      return c ? Object.fromEntries(keys.filter((k) => c.meta?.[k] !== undefined).map((k) => [k, c.meta[k]])) : null;
    },
    /** @param {string} id @param {Record<string, any>} patch */
    mergeMeta: (id, patch) => {
      const c = chains.get(id);
      if (!c) return null;
      c.meta = structuredClone({ ...c.meta, ...patch });
      return c.meta;
    },
    openGraphs: () => [...chains.values()].filter((c) => c.meta.graph && !c.meta.graph.closed).map((c) => ({ id: c.id, graph: structuredClone(c.meta.graph) })),
  };
  const make = () => createGraphRunner({ archive, registry: /** @type {any} */ (registry), events: { publish: (topic, e) => published.push({ topic, e }) }, crew: () => state.crew, log: () => {}, now: () => state.t++ });
  const runner = make();
  /** An exchange ends: its slot frees, and the runner hears it. @param {any} task */
  const end = (task) => {
    state.running -= 1;
    runner.ended({ chainId: "c1", task });
  };
  /** @returns {any} */
  const graph = () => chains.get("c1").meta.graph;
  /** @param {string} id */
  const task = (id) => graph().tasks.find((/** @type {any} */ t) => t.id === id);
  return { runner, make, chains, launches, stops, told, applies, published, resumes, resumables, read, messages, asked, state, rooms, end, graph, task, reads };
}
/** @param {{ ok: boolean }} r @returns {any} */
const ok = (r) => (assert.ok(r.ok, JSON.stringify(r)), r);
/** Let a merge's await and what follows it run. */
const tick = () => new Promise((r) => setImmediate(r));
/** The graph as an end was told from: before the mark its words of all done leave (the owner's of 11-10). @param {any} g */
const unsaid = (g) => ({ ...g, told: (g.told || []).filter((/** @type {string} */ m) => m !== "end") });

// (fails before: yes — there was no runner: nothing started a sub-agent's task)
test("tasks start only while a turn runs, as slots allow, each with its brief in the turn's folder — said, and drawn", () => {
  const r = rig({ slots: 1 });
  const added = ok(r.runner.apply("c1", ADD, AGENT));
  assert.equal(added.text, "Added t1, t2, t3, t4. t2, t3 have no check: their sub-agents name the commands that prove them done in their reports, and Filament runs them as their check. 0 of 4 done · ready: t1, t3. Critical path still to go: t1 → t2 → t4.", "no turn runs: nothing starts");
  assert.deepEqual([r.launches.length, r.runner.owes("c1")], [0, null]);
  r.runner.attach("c1", TURN);
  assert.equal(r.launches.length, 1, "the ceiling: one slot");
  assert.deepEqual(r.launches[0], { origin: "agent", chainId: "c1", prompt: tg.briefText(r.graph(), "t1", "agent"), description: "t1: Map the parser", worker: "reviewer", background: true, cwd: "/p", mode: null, parentModel: "m", thinking: null, task: { id: "t1", review: false }, requestId: "turn-1", waits: true });
  assert.deepEqual([r.task("t1").state, r.task("t1").agent, r.task("t1").tries], ["running", "sa-1", 1]);
  assert.deepEqual(r.told, [{ chainId: "c1", text: "[Filament started t1 on an explorer (sa-1). Now: 0 of 4 done · running: t1 · ready: t3.]", from: "", description: "the task graph", spends: [], wrote: false }]);
  assert.ok(r.runner.owes("c1"), "the turn may not end while the graph works");
  // A call's words say what started with it; every change reaches the bus with its rev.
  r.state.slots = 2;
  const shown = ok(r.runner.apply("c1", { action: "show", id: "t3" }, AGENT));
  assert.equal(shown.text.split("\n").at(-1), "Filament started t3 on a sub-agent (sa-2). Now: 0 of 4 done · running: t1, t3.");
  assert.deepEqual([shown.changed, shown.view], [true, tg.graphView(r.graph())]);
  assert.equal(r.launches[1].worker, "builder");
  assert.deepEqual(r.published.map((p) => [p.topic, p.e.type, p.e.chainId, p.e.rev]), [["graph", "graph", "c1", 1], ["graph", "graph", "c1", 2], ["graph", "graph", "c1", 3]]);
  assert.deepEqual(r.published.at(-1)?.e.graph, tg.graphView(r.graph()));
});

// (fails before: yes — there was no runner: a sub-agent's end moved no task on, and nobody told the agent)
test("each end moves its task on and is told once what may start next has started: done, ready for its apply, merged one at a time once applied, failed — its spend on the turn that launched it", async () => {
  const r = rig({ slots: 2 });
  r.runner.apply("c1", ADD, AGENT);
  r.runner.attach("c1", TURN);
  assert.deepEqual(r.launches.map((l) => l.task.id), ["t1", "t3"]);
  const owed = r.runner.owes("c1");
  let settled = false;
  owed?.then(() => (settled = true));
  // The explorer's end: done, and t2 — its needs done now — starts before the agent hears it; t2 needs it, so it wakes
  // the planner at once.
  r.end(END("t1", "sa-1", { report: { status: "done", did: "Three callers: a.js, b.js, c.js", met: true, evidence: "rg lists three", left: "" } }));
  assert.equal(r.task("t1").state, "done");
  assert.deepEqual(r.launches.map((l) => l.task.id), ["t1", "t3", "t2"]);
  assert.equal(r.launches[2].prompt, tg.briefText(r.graph(), "t2", "agent"));
  assert.match(r.launches[2].prompt, /What the tasks yours builds on reported:\n- t1 "Map the parser": Three callers: a\.js, b\.js, c\.js/);
  assert.deepEqual(r.told.at(-1), { chainId: "c1", wakes: true, text: tg.endText(r.graph(), "t1", { crew: "agent" }), from: "sa-1", description: "t1: Map the parser", task: "t1", state: "done", exchange: 0, spends: [{ launchedBy: "turn-1", spentUsd: 0.25, toolCalls: 3, roundIds: ["r-sa-1"] }], wrote: false });
  assert.match(r.told.at(-1).text, /\nNow: 1 of 4 done · running: t2, t3\.\]$/);
  // Two writers' changes: ready, each told, and nothing written into the folder (the owner's of 11-02).
  r.end(END("t3", "sa-2", { files: TESTS }));
  r.end(END("t2", "sa-3", { files: FIX }));
  assert.deepEqual([r.task("t3").state, r.task("t3").step, r.task("t2").step, r.applies.length], ["merging", "yours", "yours", 0]);
  assert.deepEqual(r.told.slice(-2).map((d) => [d.task, d.state, !!d.held, !!d.wakes]), [["t3", "merging", false, true], ["t2", "merging", false, true]], "t4 needs each: each wakes the planner");
  await tick();
  assert.equal(settled, true, "ready changes hold no turn");
  // The planner applies both: merged one at a time.
  assert.deepEqual(r.runner.applyAsked({ chainId: "c1", agentId: "sa-2" }), { ok: true, id: "t3", stands: false });
  assert.deepEqual(r.runner.applyAsked({ chainId: "c1", agentId: "sa-3" }), { ok: true, id: "t2", stands: false });
  assert.deepEqual([r.task("t3").step, r.task("t2").step, r.applies.map((a) => a.id)], [null, null, ["sa-2"]]);
  const owedAgain = r.runner.owes("c1");
  let settledAgain = false;
  owedAgain?.then(() => (settledAgain = true));
  r.applies[0].done.resolve(mergedIn(TESTS, "A"));
  await tick();
  assert.deepEqual([r.task("t3").state, r.task("t3").merged], ["done", { files: 1, added: 30, removed: 0 }]);
  // (fails before: yes — HarnessV4_Git_Plan GWC-16: the merge's files reached the turn's round with no name on them)
  const writes = { by: "sa-2", paths: [resolve(TURN.cwd, "test/parse.test.js")] };
  assert.deepEqual(r.told.at(-1), { chainId: "c1", wakes: true, about: "merge", text: tg.endText(r.graph(), "t3", { crew: "agent" }), from: "sa-2", description: "t3: Write the tests", task: "t3", state: "done", spends: [], wrote: true, writes });
  assert.match(r.told.at(-1).text, / and its change is merged into your folder\./);
  assert.deepEqual(r.applies.map((a) => a.id), ["sa-2", "sa-3"], "the next merge starts once the first is in");
  assert.equal(settledAgain, false, "a merge holds the turn");
  // A conflict fails the task: its change waits in the sub-agent's worktree, and the agent has its choices.
  r.applies[1].done.resolve({ ok: false, error: "1 file does not come through cleanly — src/parse.js: changed in the folder too", conflicts: [{ path: "src/parse.js", why: "changed in the folder too" }] });
  await tick();
  assert.deepEqual([r.task("t2").state, r.task("t2").why], ["failed", "its change did not merge: 1 file does not come through cleanly — src/parse.js: changed in the folder too"]);
  assert.deepEqual([r.told.at(-1).text, r.told.at(-1).state], [tg.endText(r.graph(), "t2", { crew: "agent" }), "failed"]);
  // Applied again once the overlap is settled, or the developer's to resolve, from Changes.
  assert.match(r.told.at(-1).text, /It waits in its worker's copy: apply it again once the files it overlaps in the folder are as its change needs them, or the developer resolves it from Changes/);
  assert.equal(r.told.at(-1).wrote, false);
  await tick();
  assert.equal(settledAgain, true, "nothing runs or merges: the turn may end");
  assert.equal(r.runner.owes("c1"), null);
});

// (fails before: yes — the bug hunt of 10-30, SUB-8: the change went into the folder, the graph's write after it failed,
// and the next pass merged it again: nothing waited, and the task read merge-failed over a change that was in the folder)
test("a merge whose end could not be kept is kept as that end on the next pass, never merged again", async () => {
  const r = rig({ slots: 2 });
  r.runner.apply("c1", ADD, AGENT);
  r.runner.attach("c1", TURN);
  r.end(END("t3", "sa-2", { files: TESTS }));
  assert.deepEqual(r.runner.applyAsked({ chainId: "c1", agentId: "sa-2" }), { ok: true, id: "t3", stands: false });
  assert.deepEqual([r.task("t3").state, r.applies.map((a) => a.id)], ["merging", ["sa-2"]]);
  // The session's next write fails — the one that keeps the merge's end — and the ones after it go through.
  const c = r.chains.get("c1");
  let meta = c.meta;
  let refuse = true;
  Object.defineProperty(c, "meta", {
    configurable: true,
    get: () => meta,
    set: (v) => {
      if (refuse) {
        refuse = false;
        throw new Error("database is locked");
      }
      meta = v;
    },
  });
  r.applies[0].done.resolve(mergedIn(TESTS, "A"));
  await tick();
  assert.equal(r.task("t3").state, "merging", "its end was not kept");
  // The planner's next call takes the merges that wait in turn.
  ok(r.runner.apply("c1", { action: "show" }, AGENT));
  await tick();
  r.applies[1]?.done.resolve({ ok: false, error: "sub-agent sa-2 has no changes waiting to be applied" });
  await tick();
  assert.deepEqual([r.applies.length, r.task("t3").state, r.task("t3").merged], [1, "done", { files: 1, added: 30, removed: 0 }]);
  assert.deepEqual([r.told.at(-1).task, r.told.at(-1).state, r.told.at(-1).wrote], ["t3", "done", true]);
});

// (fails before: no — a guard the mutation pass asked for: no end in the session's folder said it wrote, so the turn
// would take no snapshot of what its sub-agent changed there)
test("a sub-agent that worked in the session's folder — no repository, so no worktree — is done with no merge, and its end says it wrote", () => {
  const r = rig({ slots: 2 });
  r.runner.apply("c1", ADD, AGENT);
  r.runner.attach("c1", TURN);
  const writes = { by: "sa-2", paths: [resolve(TURN.cwd, "test/parse.test.js")] };
  r.end(END("t3", "sa-2", { shared: true, wrote: true, writes }));
  assert.deepEqual([r.task("t3").state, r.applies.length, r.told.at(-1).task, r.told.at(-1).wrote], ["done", 0, "t3", true]);
  // (fails before: yes — HarnessV4_Git_Plan GWC-16: what it wrote reached the turn's round with no name on it)
  assert.deepEqual(r.told.at(-1).writes, writes, "its own files, for the round that hears of it");
  r.end(END("t1", "sa-1"));
  r.end(END("t2", "sa-3", { status: "failed", report: null, wrote: true }));
  assert.deepEqual([r.task("t2").state, r.told.at(-1).task, r.told.at(-1).wrote], ["failed", "t2", false], "what a worktree's sub-agent wrote is not in the folder");
});

// (fails before: yes — there was no runner: a Stop left the graph's sub-agents running, and the next turn started more)
test("the developer's Stop holds the graph and stops its sub-agents; each task waits again, told; the agent's next tasks call lets go", () => {
  const r = rig({ slots: 2 });
  r.runner.apply("c1", ADD, AGENT);
  r.runner.attach("c1", TURN);
  r.runner.stop("c1");
  assert.deepEqual(r.stops, [["sa-1", "harness"], ["sa-2", "harness"]]);
  assert.ok(r.graph().held);
  r.end(END("t1", "sa-1", { status: "stopped", stoppedBy: "harness", report: null, words: "I was reading parse.js." }));
  assert.deepEqual([r.told.at(-1).text, r.told.at(-1).state], [tg.endText(r.graph(), "t1", { crew: "agent" }), "waiting"]);
  assert.match(r.told.at(-1).text, /^\[Filament: the developer stopped sub-agent sa-1 on task t1 "Map the parser"\. The task waits again/);
  r.end(END("t3", "sa-2", { status: "stopped", stoppedBy: "harness", report: null, words: "" }));
  assert.deepEqual([r.task("t1").state, r.task("t1").stopped, r.task("t3").state], ["waiting", "developer", "waiting"]);
  assert.deepEqual([r.launches.length, r.runner.owes("c1")], [2, null], "held: nothing starts, and nothing holds the turn");
  r.runner.detach("c1", "turn-1");
  r.runner.attach("c1", { ...TURN, runId: "turn-2" });
  assert.equal(r.launches.length, 2, "a new turn starts nothing while the graph is held");
  const shown = ok(r.runner.apply("c1", { action: "show" }, AGENT));
  assert.ok(shown.text.startsWith(tg.showText(r.graph(), "agent").split("\n")[0]));
  // (fails before: yes — B4, decision 4: each stopped task went to a new sub-agent, briefed on the try)
  assert.match(shown.text, /Filament started t1 again on its sub-agent sa-1, in its own conversation, t3 again on its sub-agent sa-2, in its own conversation\. Now: 0 of 4 done · running: t1, t3\.$/);
  assert.equal(r.graph().held, null);
  assert.deepEqual([r.launches.length, r.resumes.map((x) => [x.id, x.requestId]), r.task("t1").agent, r.task("t1").tries], [2, [["sa-1", "turn-2"], ["sa-2", "turn-2"]], "sa-1", 2], "each stopped task's own sub-agent goes on with it");
  assert.match(r.resumes[0].prompt, /^\[Filament: the developer stopped you on task t1\. The task is yours again: go on from where you stopped — your work so far is above\.\n\nYour task as it stands now: t1 — Map the parser\n/);
});

// (fails before: yes — B4, decision 4: a stopped task had no start of the developer's own, and none that asked for a
// new sub-agent; one whose sub-agent could not go on was not asked about)
test("a stopped task started again: by the developer, from the page — its sub-agent goes on, or with fresh a new one — and by a tasks start; one whose sub-agent can't go on goes to a new one", () => {
  const stopped = () => {
    const r = rig({ slots: 2 });
    r.runner.apply("c1", ADD, AGENT);
    r.runner.attach("c1", TURN);
    // The developer stops one sub-agent from its row: its task waits, and nothing holds the graph.
    r.end(END("t3", "sa-2", { status: "stopped", stoppedBy: "harness", report: null, words: "I was writing the tests." }));
    assert.deepEqual([r.task("t3").state, r.task("t3").stopped, r.task("t3").resume, r.graph().held, r.launches.length], ["waiting", "developer", null, null, 2]);
    return r;
  };
  // Start again, from the page: sa-2 goes on at once, the planner told.
  const a = stopped();
  const back = ok(a.runner.sendBack("c1", "t3"));
  assert.deepEqual([back.waits, back.resumes, a.resumes.map((x) => x.id), a.task("t3").state, a.task("t3").stopped, a.task("t3").tries, a.launches.length], [null, "sa-2", ["sa-2"], "running", false, 2, 2]);
  assert.equal(a.told.at(-1).text, "[Filament: the developer did this themselves, from the page — Started t3 again: sub-agent sa-2 goes on with it once its needs are done and a slot is free, in its own conversation — what it did is there. 0 of 4 done · running: t1 · ready: t3. Filament started t3 again on its sub-agent sa-2, in its own conversation. Now: 0 of 4 done · running: t1, t3.]");
  assert.match(a.resumes[0].prompt, /^\[Filament: the developer stopped you on task t3\. The task is yours again: go on from where you stopped/);
  // Start fresh: a new sub-agent takes it, the stopped try in its brief.
  const b = stopped();
  const fresh = ok(b.runner.sendBack("c1", "t3", { fresh: true }));
  assert.deepEqual([fresh.waits, fresh.resumes, b.resumes.length, b.launches.length, b.task("t3").agent, b.task("t3").stopped], [null, null, 0, 3, "sa-3", false]);
  assert.match(b.told.at(-1).text, /^\[Filament: the developer did this themselves, from the page — Started t3 again: a new sub-agent takes it once its needs are done and a slot is free, with the earlier try in its brief\. /);
  assert.ok(b.launches[2].prompt.includes("An earlier try at this task ended: stopped by the developer.\nIts last words: I was writing the tests."), b.launches[2].prompt);
  // The planner's own start of it, with a note; with fresh, a new one.
  const c = stopped();
  const mine = ok(c.runner.apply("c1", { action: "start", ids: ["t3"], note: "Make them fail first" }, AGENT));
  assert.match(mine.text, /^Started t3 again: sub-agent sa-2 goes on with it once its needs are done and a slot is free, in its own conversation — what it did is there, and it reads your note\. /);
  assert.deepEqual([c.resumes.map((x) => x.id), c.launches.length], [["sa-2"], 2]);
  assert.ok(c.resumes[0].prompt.includes("\n\nThe agent's note for you: Make them fail first\n\n"), c.resumes[0].prompt);
  const d = stopped();
  ok(d.runner.apply("c1", { action: "start", ids: ["t3"], fresh: true }, AGENT));
  assert.deepEqual([d.resumes.length, d.launches.length, d.task("t3").agent], [0, 3, "sa-3"]);
  // Its sub-agent can't go on (a restart since): the planner's next tasks call gives it to a new one, as before.
  const e = stopped();
  e.state.unresumable = "Filament restarted since it ran, and its conversation went with it";
  ok(e.runner.apply("c1", { action: "show" }, AGENT));
  assert.deepEqual([e.resumables.map((x) => x[0]), e.resumes.length, e.launches.length, e.task("t3").agent], [["sa-2"], 0, 3, "sa-3"]);
  // …and the developer's own Start again says so.
  const f = stopped();
  f.state.unresumable = "Filament restarted since it ran, and its conversation went with it";
  const cant = ok(f.runner.sendBack("c1", "t3"));
  assert.deepEqual([cant.resumes, f.launches.length], [null, 3]);
  assert.match(f.told.at(-1).text, /Started t3 again: sa-2 can't go on with it — Filament restarted since it ran, and its conversation went with it — so a new sub-agent takes it /);
  // A task that merely waits is no one's to start.
  assert.deepEqual(stopped().runner.sendBack("c1", "t2"), { ok: false, error: "t2 is waiting: only a failed task is sent back, and only a stopped one is started again" });
});

// (fails before: yes — there was no runner: a dropped task's sub-agent ran on)
test("a drop stops the sub-agent of a task it drops, in the agent's name; that end is no longer the task's", () => {
  const r = rig({ slots: 2 });
  r.runner.apply("c1", ADD, AGENT);
  r.runner.attach("c1", TURN);
  ok(r.runner.apply("c1", { action: "drop", ids: ["t3", "t4"], reason: "the tests exist already" }, AGENT));
  assert.deepEqual(r.stops, [["sa-2", "agent"]]);
  const before = r.told.length;
  r.end(END("t3", "sa-2", { status: "stopped", stoppedBy: "agent" }));
  assert.deepEqual([r.task("t3").state, r.told.length], ["dropped", before]);
});

// (fails before: yes — there was no runner: a restart left a graph's tasks running for ever, and a launch that failed was lost)
test("a restart fails what it cut, told with the next turn; a launch Filament could not make fails its task", async () => {
  const r = rig({ slots: 2 });
  r.runner.apply("c1", ADD, AGENT);
  r.runner.attach("c1", TURN);
  r.end(END("t3", "sa-2", { files: TESTS }));
  assert.deepEqual(r.runner.applyAsked({ chainId: "c1", agentId: "sa-2" }), { ok: true, id: "t3", stands: false });
  assert.deepEqual([r.task("t3").state, r.task("t3").step], ["merging", null]);
  // Filament stops as the change merges: the next start finds t1 running and t3 merging — and its registry holds
  // neither worker, so a send-back goes to a new one.
  const later = r.make();
  r.state.unresumable = "Filament restarted since it ran, and its conversation went with it";
  r.told.length = 0;
  assert.equal(later.reconcile(), 1);
  assert.deepEqual([r.task("t1").state, r.task("t1").why, r.task("t3").state, r.task("t3").why], ["failed", "cut by a Filament restart", "failed", "cut by a Filament restart as its change merged — check its files in the folder before you go on"]);
  assert.deepEqual(r.told.map((d) => [d.task, d.from, d.text]), [["t1", "sa-1", tg.endText(r.graph(), "t1", { crew: "agent" })], ["t3", "sa-2", tg.endText(r.graph(), "t3", { crew: "agent" })]]);
  assert.equal(later.reconcile(), 0, "told once");
  later.attach("c1", TURN);
  r.state.refuse = 'the sub-agent cannot run on "m": no route serves it';
  ok(later.apply("c1", { action: "start", ids: ["t1"], note: "Use rg, not grep." }, AGENT));
  assert.equal(r.task("t1").why, 'Filament could not start its sub-agent: the sub-agent cannot run on "m": no route serves it');
  assert.deepEqual([r.told.at(-1).from, r.told.at(-1).task, r.told.at(-1).text], ["sa-1", "t1", tg.endText(r.graph(), "t1", { crew: "agent" })]);
});

// (fails before: yes — there was no runner: nothing held a turn)
test("the turn: what may start starts as it opens; its end lets go of what it waits on, and an end after it counts no spend", async () => {
  const r = rig({ slots: 2 });
  r.runner.apply("c1", ADD, AGENT);
  r.runner.attach("c1", TURN);
  assert.deepEqual(r.launches.map((l) => l.task.id), ["t1", "t3"], "what may start starts as the turn opens");
  const owed = r.runner.owes("c1");
  let settled = false;
  owed?.then(() => (settled = true));
  r.runner.detach("c1", "turn-0");
  await tick();
  assert.equal(settled, false, "another turn's end lets go of nothing");
  r.runner.detach("c1", "turn-1");
  await tick();
  assert.equal(settled, true, "the turn is over: nothing holds it");
  r.end(END("t1", "sa-1"));
  assert.deepEqual([r.told.at(-1).task, r.told.at(-1).spends], ["t1", [{ launchedBy: "turn-1", spentUsd: 0.25, toolCalls: 3, roundIds: ["r-sa-1"] }]], "told with the next turn: its spend goes with the turn that launched it");
  assert.equal(r.launches.length, 2, "no turn runs: t2 waits");
  // The next turn opens: t2, its need done, starts with it.
  r.runner.attach("c1", { ...TURN, runId: "turn-2" });
  assert.deepEqual(r.launches.map((l) => l.task.id), ["t1", "t3", "t2"], "what may start starts as the next turn opens");
});

// (fails before: yes — as Filament stopped, each cut task's end started the next ready one, whose calls the draining
// Filament refused, so every task that waited failed in turn; and the turn waited on the graph through the drain)
test("Filament stopping: no turn waits on the graph, nothing new starts, and what the stop cuts fails, told", async () => {
  const r = rig({ slots: 1 });
  r.runner.apply("c1", ADD, AGENT);
  r.runner.attach("c1", TURN);
  let settled = false;
  r.runner.owes("c1")?.then(() => (settled = true));
  r.runner.shutdown();
  await tick();
  assert.deepEqual([settled, r.runner.owes("c1")], [true, null], "the turn waits on nothing");
  r.end(END("t1", "sa-1", { status: "aborted", report: null, cut: true }));
  assert.deepEqual([r.task("t1").state, r.task("t1").why, r.task("t3").state, r.launches.length], ["failed", "cut by a Filament restart", "waiting", 1], "t3 is not started");
  assert.deepEqual([r.told.at(-1).task, r.told.at(-1).state], ["t1", "failed"]);
});

// (fails before: yes — there was no runner: a task that waited for a slot let the turn end, and nothing started it)
// (fails before: no — a guard the mutation pass asked for: the stop's order — the graphs stop first, so the ends the
// sub-agents' cut makes start nothing)
test("the server stops the task graphs as it starts to stop, before it cuts the sub-agents", () => {
  const src = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  const stop = src.slice(src.indexOf("stop({ drainMs"), src.indexOf("const finish = async"));
  assert.match(stop, /draining = true;[\s\S]*graphs\.shutdown\(\);[\s\S]*subagents\.shutdown\(\);/);
});

test("a slot held by something else holds the turn while a task waits for it, and its end lets the task start", async () => {
  const r = rig({ slots: 1 });
  r.state.running = 1; // the developer's own sub-agent holds the only slot
  r.runner.apply("c1", ADD, AGENT);
  r.runner.attach("c1", TURN);
  assert.equal(r.launches.length, 0);
  const owed = r.runner.owes("c1");
  assert.ok(owed, "t1 and t3 wait for the slot");
  let settled = false;
  owed?.then(() => (settled = true));
  r.end(null);
  assert.deepEqual(r.launches.map((l) => l.task.id), ["t1"], "its end frees the slot");
  r.end(END("t1", "sa-1"));
  assert.deepEqual(r.launches.map((l) => l.task.id), ["t1", "t3"]);
  await tick();
  assert.equal(settled, false, "t3 runs, and t2 waits for its slot");
  r.end(END("t3", "sa-2"));
  r.end(END("t2", "sa-3"));
  await tick();
  assert.deepEqual([r.task("t2").state, r.task("t3").state, settled], ["done", "done", true], "t4 is the agent's: nothing holds the turn");
});

// (fails before: no — a guard the mutation pass asked for: what `owes` promised settles at whichever change leaves the
// session owing nothing — a tasks call's too, though the loop runs a reply's tools in order and waits beside none)
test("a tasks call that leaves the session owing nothing lets the turn's wait go", async () => {
  const r = rig({ slots: 1 });
  r.state.running = 1; // the developer's own sub-agent holds the only slot
  r.runner.apply("c1", ADD, AGENT);
  r.runner.attach("c1", TURN);
  const owed = r.runner.owes("c1");
  let settled = false;
  owed?.then(() => (settled = true));
  assert.equal(r.runner.apply("c1", { action: "drop", ids: ["t1", "t2", "t3", "t4"], reason: "the developer's own sub-agent does it" }, AGENT).ok, true);
  await tick();
  assert.deepEqual([r.launches.length, settled], [0, true]);
});

/**
 * A team's lead's graph in a turn of its own, slots for all: its scout's end starts t2's builder, whose end with a
 * change queues t2's review.
 * @param {ReturnType<typeof rig>} r
 */
const toReview = (r) => {
  r.state.crew = LED;
  ok(r.runner.apply("c1", TEAM_ADD, LEAD));
  r.runner.attach("c1", LEAD_TURN);
  r.end(END("t1", "sa-1"));
  r.end(END("t2", "sa-3", { files: FIX }));
};
/** The builder's task and the tester's, side by side, the builder's first: one slot takes the builder, whose change a
 *  reviewer reads, and the tester waits. */
const PAIR = { ...TEAM_ADD, tasks: [{ ...TEAM_ADD.tasks[1], needs: [] }, TEAM_ADD.tasks[2]] };

// (fails before: yes — HarnessV3-TaskGraph G3-2: the runner launched every task as the agent's sub-agent or explorer)
test("under a team's lead each task starts as the team's worker of its role, briefed in the lead's words — a task the agent planned as the role that does its work", () => {
  const r = rig({ slots: 2 });
  r.state.crew = LED;
  ok(r.runner.apply("c1", TEAM_ADD, LEAD));
  r.runner.attach("c1", LEAD_TURN);
  assert.deepEqual(r.launches[0], { origin: "agent", chainId: "c1", prompt: tg.briefText(r.graph(), "t1", LED), description: "t1: Map the parser", team: { key: "architect", name: "Architect", role: "scout", card: "reviewer", seat: "Scout", place: "reviewer", words: "Map what exists." }, background: true, cwd: "/p", mode: null, parentModel: "m", thinking: null, task: { id: "t1", review: false }, requestId: "turn-1", waits: true });
  assert.deepEqual([r.launches[1].team, r.task("t3").ranAs], [{ key: "architect", name: "Architect", role: "tester", card: "builder", seat: "Tester", place: "builder", words: "" }, "tester"]);
  assert.equal(r.told[0].text, "[Filament started t1 on a scout (sa-1), t3 on a tester (sa-2). Now: 0 of 3 done · running: t1, t3.]");
  // A graph the agent planned, led by a team now: its sub-agent's task starts as a builder, its explorer's as a scout.
  const s = rig();
  ok(s.runner.apply("c1", ADD, AGENT));
  s.runner.attach("c1", LEAD_TURN);
  assert.deepEqual(s.launches.map((l) => [l.task.id, l.team?.role, l.worker]), [["t1", "scout", undefined], ["t3", "builder", undefined]]);
  assert.equal(s.launches[1].prompt, tg.briefText(s.graph(), "t3", LED));
  // A launch Filament could not make fails its task in the role's words, told in the lead's.
  const u = rig({ slots: 2 });
  u.state.refuse = "no route serves the team's model";
  ok(u.runner.apply("c1", TEAM_ADD, LEAD));
  u.runner.attach("c1", LEAD_TURN);
  assert.equal(u.task("t1").why, "Filament could not start its scout: no route serves the team's model");
  assert.deepEqual([u.told.at(-1).task, u.told.at(-1).text], ["t3", tg.endText(u.graph(), "t3", { crew: LED })]);
});

// (fails before: yes — HarnessV3-TaskGraph G3-3: a writer's change merged as its worker reported it, read by nobody)
test("a writer's change goes to a reviewer of the lead's team, read first, and the changes it asks back to the same worker; the same reviewer reads it again, it is ready, the lead hears it once with every step's spend, and it merges once the lead applies it", async () => {
  const r = rig();
  r.state.crew = LED;
  ok(r.runner.apply("c1", TEAM_ADD, LEAD));
  r.runner.attach("c1", LEAD_TURN);
  r.end(END("t3", "sa-2"));
  r.end(END("t1", "sa-1"));
  assert.deepEqual(r.launches.map((l) => l.task.id), ["t1", "t3", "t2"]);
  let settled = false;
  r.runner.owes("c1")?.then(() => (settled = true));
  // The builder reports: its change is read, and its reviewer starts with it — the turn held meanwhile.
  r.end(END("t2", "sa-3", { files: FIX }));
  assert.deepEqual([r.task("t2").state, r.task("t2").step, tg.busy(r.graph())], ["review", "queued", false]);
  assert.ok(r.runner.owes("c1"), "a review being started holds the turn");
  await tick();
  assert.deepEqual(r.read, ["sa-3"]);
  assert.deepEqual(r.launches[3], { origin: "agent", chainId: "c1", prompt: tg.reviewBrief(r.graph(), "t2", LED), description: "t2: review of Fix the parser", team: { key: "architect", name: "Architect", role: "reviewer", place: "reviewer", words: "Review against the contract." }, background: true, cwd: "/p", mode: null, parentModel: "m", thinking: null, task: { id: "t2", review: true }, review: { of: "sa-3", files: 1, diff: "THE DIFF", inFolder: false }, requestId: "turn-1", waits: true });
  assert.deepEqual([r.task("t2").step, r.task("t2").reviewer], ["reading", "sa-4"]);
  // It asks for changes: they go back to sa-3, in the conversation it has; the lead hears nothing of the step.
  const heard = r.told.length;
  r.end(END("t2", "sa-4", { review: true, report: REVIEW("Return [] for an empty input"), spentUsd: 0.1 }));
  assert.deepEqual(r.resumes.map((x) => [x.id, x.chainId, x.requestId]), [["sa-3", "c1", "turn-1"]]);
  assert.equal(r.resumes[0].prompt, tg.fixText(r.graph(), "t2"));
  assert.deepEqual([r.task("t2").state, r.task("t2").agent, r.told.length], ["running", "sa-3", heard]);
  // It reports again: the same reviewer reads the change again, whole.
  r.end(END("t2", "sa-3", { files: FIX, exchange: 1 }));
  await tick();
  assert.deepEqual([r.read, r.launches.length], [["sa-3", "sa-3"], 4], "no new reviewer");
  assert.deepEqual([r.resumes[1].id, r.resumes[1].prompt], ["sa-4", tg.reviewAgainText(r.graph(), "t2", subagents.changeBlock({ of: "sa-3", files: 1, diff: "THE DIFF" }, subagents.changeNote("sa-3")), LED)]);
  r.end(END("t2", "sa-4", { review: true, report: REVIEW(""), spentUsd: 0.1, exchange: 1 }));
  assert.deepEqual([r.task("t2").state, r.task("t2").step, r.applies.length, r.told.length], ["merging", "yours", 0, heard + 1], "ready: nothing merges it before the lead's apply");
  assert.deepEqual(r.told.at(-1), { chainId: "c1", wakes: true, text: tg.endText(r.graph(), "t2", { crew: LED }), from: "sa-3", description: "t2: Fix the parser", task: "t2", state: "merging", exchange: 1, spends: [{ launchedBy: "turn-1", spentUsd: 0.25, toolCalls: 3, roundIds: ["r-sa-3"] }, { launchedBy: "turn-1", spentUsd: 0.1, toolCalls: 3, roundIds: ["r-sa-4"] }, { launchedBy: "turn-1", spentUsd: 0.25, toolCalls: 3, roundIds: ["r-sa-3"] }, { launchedBy: "turn-1", spentUsd: 0.1, toolCalls: 3, roundIds: ["r-sa-4"] }], wrote: false });
  assert.match(r.told.at(-1).text, /is ready: builder sa-3 .*its reviewer found the change does what the task asks\. Its change waits in sa-3's own copy, not in the folder yet: apply it when you choose — worker with agent_id "sa-3" and apply_changes: true\./);
  await tick();
  assert.equal(settled, true, "a ready change holds no turn");
  assert.deepEqual(r.runner.applyAsked({ chainId: "c1", agentId: "sa-3" }), { ok: true, id: "t2", stands: false });
  assert.deepEqual([r.task("t2").state, r.applies.map((a) => a.id)], ["merging", ["sa-3"]]);
  r.applies[0].done.resolve(mergedIn(FIX, "M"));
  await tick();
  assert.equal(r.task("t2").state, "done");
  assert.deepEqual(r.told.at(-1), { chainId: "c1", wakes: true, about: "merge", text: tg.endText(unsaid(r.graph()), "t2", { crew: LED }), from: "sa-3", description: "t2: Fix the parser", task: "t2", state: "done", spends: [], wrote: true, writes: { by: "sa-3", paths: [resolve(TURN.cwd, "src/parse.js")] } });
  assert.match(r.told.at(-1).text, /its reviewer found the change does what the task asks, and its change is merged into the folder\.\n/);
  assert.equal(r.runner.owes("c1"), null, "nothing runs, reads or merges: the turn may end");
});

// (fails before: yes — the lead's merge moved its task to merging and nothing merged it: the lead's turn, and every
// turn after it with the graph on, waited for ever)
test("a lead's merge of a failed task's change goes into the folder with the call: the task is done, told, and the turn's wait goes", async () => {
  const r = rig();
  r.state.crew = LED;
  ok(r.runner.apply("c1", { ...TEAM_ADD, tasks: [TEAM_ADD.tasks[2]] }, LEAD));
  r.runner.attach("c1", LEAD_TURN);
  r.end(END("t3", "sa-1", { files: TESTS, report: { status: "done", did: "Wrote the tests.", met: false, evidence: "the whitespace case fails", left: "" } }));
  assert.equal(r.task("t3").state, "failed");
  const merged = ok(r.runner.apply("c1", { action: "merge", id: "t3", reason: "The whitespace case is out of scope" }, LEAD));
  assert.match(merged.text, /^Merging t3's change as it stands, on your word\./);
  assert.deepEqual([r.task("t3").state, r.applies.map((a) => a.id)], ["merging", ["sa-1"]], "its merge starts with the call");
  let settled = false;
  r.runner.owes("c1")?.then(() => (settled = true));
  r.applies[0].done.resolve(mergedIn(TESTS, "A"));
  await tick();
  assert.equal(r.task("t3").state, "done");
  assert.deepEqual([r.told.at(-1).task, r.told.at(-1).state, r.told.at(-1).text], ["t3", "done", tg.endText(unsaid(r.graph()), "t3", { crew: LED })]);
  assert.match(r.told.at(-1).text, /change is merged into .* as it stood, on your word\./);
  await tick();
  assert.equal(settled, true, "nothing merges any more: the turn may end");
});

// (fails before: yes — the same: there was no review, so nothing read a change under the agent either)
test("under the agent a review's reader is an explorer, briefed in the agent's words", async () => {
  const r = rig();
  ok(r.runner.apply("c1", TEAM_ADD, LEAD));
  r.runner.attach("c1", TURN);
  assert.deepEqual(r.launches.map((l) => [l.task.id, l.worker]), [["t1", "reviewer"], ["t3", "builder"]]);
  r.end(END("t1", "sa-1"));
  r.end(END("t2", "sa-3", { files: FIX }));
  await tick();
  const reviewer = r.launches.at(-1);
  assert.deepEqual([reviewer.worker, reviewer.team, reviewer.task, reviewer.prompt], ["reviewer", undefined, { id: "t2", review: true }, tg.reviewBrief(r.graph(), "t2", "agent")]);
});

// (fails before: yes — the same: no review step could fail)
test("a review step Filament could not start fails its task, told in the lead's words: the change unread, none to read, a reviewer refused, a fix that could not reach its worker; a restart cuts a review", async () => {
  /** @param {(r: ReturnType<typeof rig>) => void} set */
  const failing = async (set) => {
    const r = rig();
    set(r);
    toReview(r);
    await tick();
    return r;
  };
  for (const [set, why] of /** @type {[(r: ReturnType<typeof rig>) => void, string][]} */ ([
    [(r) => (r.state.change = { ok: false, error: "its changes could not be read (git failed)" }), "its review could not start: its changes could not be read (git failed)"],
    [(r) => (r.state.change = { ok: true, files: [], diff: "" }), "its review could not start: sa-3 has no change waiting to be read"],
  ])) {
    const r = await failing(set);
    assert.deepEqual([r.task("t2").state, r.task("t2").why], ["failed", why]);
    assert.deepEqual([r.told.at(-1).task, r.told.at(-1).state, r.told.at(-1).text], ["t2", "failed", tg.endText(r.graph(), "t2", { crew: LED })]);
  }
  const refused = rig();
  refused.state.crew = LED;
  ok(refused.runner.apply("c1", TEAM_ADD, LEAD));
  refused.runner.attach("c1", LEAD_TURN);
  refused.end(END("t1", "sa-1"));
  refused.state.refuse = "the session runs 4 sub-agents already";
  refused.end(END("t2", "sa-3", { files: FIX }));
  await tick();
  assert.equal(refused.task("t2").why, "its review could not start: the session runs 4 sub-agents already");
  // The changes asked could not reach the builder.
  const r = rig();
  toReview(r);
  await tick();
  r.state.resumeRefuse = "sub-agent sa-3 is still working";
  r.end(END("t2", "sa-4", { review: true, report: REVIEW("Return [] for an empty input") }));
  assert.deepEqual([r.task("t2").state, r.task("t2").why], ["failed", "the changes its review asked for could not reach its builder: sub-agent sa-3 is still working"]);
  assert.deepEqual([r.told.at(-1).task, r.told.at(-1).text], ["t2", tg.endText(unsaid(r.graph()), "t2", { crew: LED })]);
  // Filament restarts as a reviewer reads: the review fails, told with the session's next turn in its lead's words.
  const cut = rig();
  toReview(cut);
  await tick();
  cut.runner.detach("c1", "turn-1");
  cut.told.length = 0;
  assert.equal(cut.make().reconcile(), 1);
  assert.deepEqual([cut.task("t2").state, cut.task("t2").why], ["failed", "cut by a Filament restart in its review — its change waits in its builder's worktree"]);
  assert.deepEqual(cut.told.filter((d) => d.task === "t2").map((d) => d.text), [tg.endText(cut.graph(), "t2", { crew: LED })]);
});

// (fails before: yes — the review of 1d7591aa8: the end that finished s was held while x's worker worked, though
// "after" waited on it)
test("a sub-task's end that finishes its step wakes the planner at once, though another worker still works", () => {
  const r = rig();
  const explore = (/** @type {string} */ id, /** @type {Record<string, any>} */ more = {}) => ({ id, name: id.toUpperCase(), by: "explorer", goal: `Read ${id}`, steps: ["Read it"], acceptance: "it is read", ...more });
  r.runner.apply("c1", { action: "add", goal: "g", tasks: [{ id: "s", name: "Step" }, explore("k1", { under: "s" }), explore("k2", { under: "s" }), explore("x"), { id: "after", name: "After", needs: ["s"] }] }, AGENT);
  r.runner.attach("c1", TURN);
  const agentOf = (/** @type {string} */ id) => `sa-${r.launches.findIndex((l) => l.task.id === id) + 1}`;
  assert.deepEqual(r.launches.map((l) => l.task.id).sort(), ["k1", "k2", "x"]);
  r.end(END("k1", agentOf("k1")));
  assert.equal(r.task("s").state, "running");
  r.end(END("k2", agentOf("k2")));
  assert.deepEqual([r.task("k2").state, r.task("s").state, r.task("x").state], ["done", "done", "running"]);
  assert.deepEqual([r.told.at(-1).task, !!r.told.at(-1).held, !!r.told.at(-1).wakes], ["k2", false, true]);
  assert.match(r.told.at(-1).text, /\ns is done with it: every sub-task of it is\.\nNow: /);
});

// (fails before: yes — the same: the developer's Stop found no reviewer to stop)
test("the developer's Stop stops a reviewer that reads: the review waits, told, until the lead's next tasks call — and a new reviewer reads round one again, the stopped worker going on", async () => {
  const r = rig();
  toReview(r);
  await tick();
  assert.equal(r.task("t2").reviewer, "sa-4");
  r.runner.stop("c1");
  assert.deepEqual(r.stops, [["sa-4", "harness"], ["sa-2", "harness"]]);
  r.end(END("t2", "sa-4", { review: true, status: "stopped", stoppedBy: "harness", report: null }));
  assert.deepEqual([r.task("t2").state, r.task("t2").step, r.task("t2").stopped], ["review", "queued", "developer"]);
  // Nothing needs t2, and t3's worker still works: its end is held, and says nothing of how the graph stands.
  assert.deepEqual([r.told.at(-1).task, r.told.at(-1).state, r.told.at(-1).held, r.told.at(-1).text], ["t2", "review", true, tg.endText(r.graph(), "t2", { crew: LED, now: false })]);
  assert.match(r.told.at(-1).text, /^\[Filament: the developer stopped the review of task t2 "Fix the parser", round 1 of 2\. The review waits/);
  r.end(END("t3", "sa-2", { status: "stopped", stoppedBy: "harness", report: null }));
  const launched = r.launches.length;
  ok(r.runner.apply("c1", { action: "show" }, LEAD));
  await tick();
  assert.deepEqual(r.launches.slice(launched).map((l) => [l.task.id, l.task.review, l.team.role]), [["t2", true, "reviewer"]], "a new reviewer for round one");
  assert.deepEqual([r.resumes.map((x) => x.id), r.task("t3").agent, r.task("t2").reviewer], [["sa-2"], "sa-2", "sa-5"], "and t3's tester goes on with it");
});

// (fails before: no — a guard the mutation pass asked for: a review being started holds its slot while it reads the
// change, though the registry counts no reviewer yet)
test("a review being started holds its slot while it reads the change: a tasks call meanwhile starts nothing in its place", async () => {
  const r = rig({ slots: 1 });
  r.state.crew = LED;
  ok(r.runner.apply("c1", PAIR, LEAD));
  r.runner.attach("c1", LEAD_TURN);
  r.end(END("t2", "sa-1", { files: FIX }));
  assert.deepEqual([r.task("t2").step, r.task("t3").state], ["queued", "waiting"]);
  assert.ok(!ok(r.runner.apply("c1", { action: "show" }, LEAD)).text.includes("Filament started"));
  await tick();
  assert.deepEqual(r.launches.map((l) => [l.task.id, l.team.role]), [["t2", "builder"], ["t2", "reviewer"]]);
  assert.deepEqual([r.task("t2").step, r.task("t3").state], ["reading", "waiting"], "t3 waits for the reviewer's slot");
});

// (fails before: no — a guard the mutation pass asked for: the changes a review asked go back to their worker in the
// slot its reviewer left, which no test held one slot for)
test("a fix takes the slot its reviewer left: a task that waits for a slot waits on", async () => {
  const r = rig({ slots: 1 });
  r.state.crew = LED;
  ok(r.runner.apply("c1", PAIR, LEAD));
  r.runner.attach("c1", LEAD_TURN);
  r.end(END("t2", "sa-1", { files: FIX }));
  await tick();
  r.end(END("t2", "sa-2", { review: true, report: REVIEW("Return [] for an empty input") }));
  assert.deepEqual(r.resumes.map((x) => x.id), ["sa-1"]);
  assert.deepEqual(r.launches.map((l) => [l.task.id, l.team.role]), [["t2", "builder"], ["t2", "reviewer"]]);
  assert.deepEqual([r.task("t2").state, r.task("t3").state], ["running", "waiting"], "t3 waits for the builder's slot");
});

// (fails before: no — a guard the mutation pass asked for: the developer's Stop while a review reads its change first
// finds no reviewer to stop, so the hold alone keeps one from starting)
test("the developer's Stop while a review reads its change first: no reviewer starts until the lead's next tasks call", async () => {
  const r = rig();
  toReview(r);
  r.runner.stop("c1");
  assert.deepEqual(r.stops, [["sa-2", "harness"]], "its tester at work, and no reviewer yet");
  await tick();
  assert.deepEqual([r.launches.length, r.task("t2").step, r.task("t2").stopped, !!r.graph().held], [3, "queued", false, true], "the review waits, held");
  ok(r.runner.apply("c1", { action: "show" }, LEAD));
  await tick();
  assert.deepEqual([r.launches.length, r.launches[3].task, r.launches[3].team.role, r.task("t2").step], [4, { id: "t2", review: true }, "reviewer", "reading"]);
});

// (fails before: yes — a review step that could not start was told before what may start next had started: its words
// said t3 was ready, and t3 started after them)
test("a review that could not start leaves its slot to the next task, and its end is told once that task has started", async () => {
  const r = rig({ slots: 1 });
  r.state.crew = LED;
  r.state.change = { ok: false, error: "its changes could not be read (git failed)" };
  ok(r.runner.apply("c1", PAIR, LEAD));
  r.runner.attach("c1", LEAD_TURN);
  r.end(END("t2", "sa-1", { files: FIX }));
  await tick();
  assert.deepEqual([r.task("t2").state, r.task("t3").state, r.launches.map((l) => l.task.id)], ["failed", "running", ["t2", "t3"]]);
  assert.deepEqual([r.told.at(-1).task, r.told.at(-1).text], ["t2", tg.endText(unsaid(r.graph()), "t2", { crew: LED })]);
  assert.match(r.told.at(-1).text, /\nNow: 0 of 2 done · running: t3 · failed: t2\.\]$/);
});

// (fails before: yes — a start Filament could not make kept the slot it never took: the next ready task waited with the
// slot free until the planner's next tasks call, and the turn could end without it)
test("a start Filament could not make leaves its slot to the next task: it starts at once, and the failure's words say so", () => {
  const r = rig({ slots: 1 });
  r.state.refuse = (spec) => (spec.task.id === "t1" ? "no route serves the explorer's model" : null);
  ok(r.runner.apply("c1", ADD, AGENT));
  r.runner.attach("c1", TURN);
  assert.deepEqual([r.task("t1").state, r.task("t3").state, r.launches.map((l) => l.task.id)], ["failed", "running", ["t3"]]);
  assert.deepEqual(r.told.map((d) => d.task ?? "started"), ["t1", "started"]);
  assert.equal(r.told[0].text, tg.endText(r.graph(), "t1", { crew: "agent" }));
  assert.match(r.told[0].text, /\nNow: 0 of 4 done · running: t3 · failed: t1\.\]$/);
});

// (fails before: yes — the bug hunt of 10-30, SUB-3: a launch that found no free slot failed its task for good)
test("a start that finds no free slot waits for one: its task runs, says in words that its sub-agent waits, and says so no more once it has its slot; the developer's Stop stops it as it waits", async () => {
  const r = rig({ slots: 2 });
  r.state.full = "m, 4 of 4 busy";
  ok(r.runner.apply("c1", ADD, AGENT));
  r.runner.attach("c1", TURN);
  assert.deepEqual(r.launches.map((l) => [l.task.id, l.waits]), [["t1", true], ["t3", true]], "each launch may wait");
  assert.deepEqual([r.task("t1").state, r.task("t1").slot?.agent, r.task("t1").slot?.why, r.task("t3").state, r.task("t3").slot?.agent], ["running", "sa-1", "m, 4 of 4 busy", "running", "sa-2"]);
  assert.equal(r.told[0].text, `[${tg.startedText(r.graph(), ["t1", "t3"])}]`);
  assert.match(r.told[0].text, /^\[Filament started t1 on an explorer \(sa-1\), which waits for a slot \(m, 4 of 4 busy\) and starts by itself once one is free, t3 on a sub-agent \(sa-2\), which waits for a slot/);
  const drawn = () => r.published.filter((p) => p.topic === "graph").at(-1)?.e.graph.tasks.find((/** @type {any} */ t) => t.id === "t1");
  assert.deepEqual(drawn().slot, r.task("t1").slot, "the page draws it");
  // t1's sub-agent has its slot: its task says so no more, and t3's still waits.
  r.rooms[0].room.resolve(true);
  await tick();
  assert.deepEqual([r.task("t1").slot, drawn().slot, r.task("t3").slot?.agent], [null, null, "sa-2"]);
  // The developer's Stop stops the one that waits, as it stops the one at work.
  r.runner.stop("c1");
  assert.deepEqual(r.stops, [["sa-1", "harness"], ["sa-2", "harness"]]);
});

// (fails before: yes — the same: a going on that found no free slot failed its task — a sent-back task's sub-agent, a
// review's reader, the changes it asked)
test("a going on that finds no free slot waits too: a sent-back task's sub-agent, a review's reader, and the changes its review asked", async () => {
  const r = rig({ slots: 2 });
  ok(r.runner.apply("c1", ADD, AGENT));
  r.runner.attach("c1", TURN);
  r.end(END("t3", "sa-2", { report: { status: "done", did: "Wrote them.", met: false, evidence: "they pass on the old parser", left: "" }, files: TESTS }));
  r.state.full = "m, 4 of 4 busy";
  ok(r.runner.apply("c1", { action: "start", ids: ["t3"], note: "Make them fail first" }, AGENT));
  assert.deepEqual([r.task("t3").state, r.task("t3").agent, r.task("t3").slot?.agent, r.resumes.at(-1).waits], ["running", "sa-2", "sa-2", true], "its last sub-agent goes on with it once a slot is free");
  const v = rig();
  toReview(v);
  v.state.full = "m, 4 of 4 busy";
  await tick();
  assert.deepEqual([v.task("t2").state, v.task("t2").step, v.task("t2").reviewer, v.task("t2").slot?.agent], ["review", "reading", "sa-4", "sa-4"], "its reader waits for a slot");
  v.rooms.at(-1)?.room.resolve(true);
  await tick();
  assert.equal(v.task("t2").slot, null);
  v.end(END("t2", "sa-4", { review: true, report: REVIEW("Return [] for an empty input") }));
  assert.deepEqual([v.task("t2").state, v.task("t2").agent, v.task("t2").slot?.agent], ["running", "sa-3", "sa-3"], "the changes it asked wait with their worker");
});

// (fails before: yes — HarnessV3-FailurePoints §6 items 2–4: a failed task sent back always went to a new sub-agent,
// the one that tried it let go)
test("sent back, a failed task's last sub-agent goes on in the conversation it has, in the graph's words — asked of the registry first; refused as it starts, the task fails, told; one that can't go on gives way to a new one, briefed", () => {
  const r = rig({ slots: 2 });
  ok(r.runner.apply("c1", ADD, AGENT));
  r.runner.attach("c1", TURN);
  const NOT_MET = { status: "done", did: "Wrote them.", met: false, evidence: "they pass on the old parser", left: "" };
  r.end(END("t3", "sa-2", { report: NOT_MET, files: TESTS }));
  assert.equal(r.task("t3").state, "failed");
  // Sent back: the registry is asked of sa-2, on the running turn's model, and sa-2 goes on — nothing launches.
  const back = ok(r.runner.apply("c1", { action: "start", ids: ["t3"], note: "Make them fail first" }, AGENT));
  assert.deepEqual(r.resumables, [["sa-2", "c1"]]);
  assert.deepEqual(r.resumes, [{ id: "sa-2", chainId: "c1", prompt: tg.resumeText(r.graph(), "t3", "agent"), requestId: "turn-1", check: [], waits: true }], "with its task's check as it stands: none (TG2-D63)");
  assert.ok(r.resumes[0].prompt.includes("\n\nThe agent's note for you: Make them fail first\n\n"), r.resumes[0].prompt);
  assert.deepEqual([r.task("t3").state, r.task("t3").agent, r.task("t3").tries, r.task("t3").resume, r.launches.length], ["running", "sa-2", 2, null, 2]);
  assert.equal(back.text.split("\n").at(-1), "Filament started t3 again on its sub-agent sa-2, in its own conversation. Now: 0 of 4 done · running: t1, t3.");
  // It fails the same way again, said; and as it is sent back once more, the registry refuses it: the task fails, told.
  r.end(END("t3", "sa-2", { report: NOT_MET, files: TESTS, exchange: 1 }));
  assert.match(r.told.at(-1).text, /\nt3 failed the same way 2 times in a row\.\n/);
  r.state.resumeRefuse = "sub-agent sa-2 is still working";
  ok(r.runner.apply("c1", { action: "start", ids: ["t3"] }, AGENT));
  assert.deepEqual([r.task("t3").state, r.task("t3").why, r.resumes.length], ["failed", "its sub-agent sa-2 could not go on with it: sub-agent sa-2 is still working", 1]);
  assert.deepEqual([r.told.at(-1).task, r.told.at(-1).text], ["t3", tg.endText(r.graph(), "t3", { crew: "agent" })]);
  // Sent back again, it left no try of its own: a new sub-agent takes it, briefed on sa-2's try — and nothing is asked.
  r.state.resumeRefuse = null;
  ok(r.runner.apply("c1", { action: "start", ids: ["t3"] }, AGENT));
  assert.deepEqual([r.resumables.length, r.launches.length, r.launches[2].task.id, r.task("t3").agent], [2, 3, "t3", "sa-3"]);
  assert.equal(r.launches[2].prompt, tg.briefText(r.graph(), "t3", "agent"));
  assert.ok(r.launches[2].prompt.includes("\n\nAn earlier try at this task ended: its acceptance check did not pass: they pass on the old parser.\nDid: Wrote them.\n"), r.launches[2].prompt);
  // The registry says sa-3 can't go on: a new one, told why.
  r.end(END("t3", "sa-3", { report: NOT_MET, files: TESTS }));
  r.state.unresumable = "it ran on m, and a new worker runs on glm-5.3 now";
  const anew = ok(r.runner.apply("c1", { action: "start", ids: ["t3"] }, AGENT));
  assert.match(anew.text, /^Sent t3 back: sa-3 can't go on with it — it ran on m, and a new worker runs on glm-5\.3 now — so a new sub-agent takes it /);
  assert.deepEqual([r.launches.length, r.task("t3").agent, r.resumes.length], [4, "sa-4", 1]);
});

// (fails before: yes — the same: and a task sent back under the agent and started under a lead went on with a worker
// that is none of the lead's team)
test("sent back while no turn runs, and started under a lead: its last sub-agent is no worker of the team, so a builder takes it, briefed on its try", () => {
  const r = rig({ slots: 2 });
  ok(r.runner.apply("c1", ADD, AGENT));
  r.runner.attach("c1", TURN);
  r.end(END("t3", "sa-2", { report: { status: "done", did: "Wrote them.", met: false, evidence: "they pass", left: "" }, files: TESTS }));
  r.runner.detach("c1", "turn-1");
  ok(r.runner.apply("c1", { action: "start", ids: ["t3"] }, AGENT));
  assert.deepEqual([r.task("t3").resume, r.resumes.length, r.launches.length], ["sa-2", 0, 2], "nothing starts while no turn runs");
  r.state.crew = LED;
  r.runner.attach("c1", LEAD_TURN);
  assert.deepEqual([r.resumes.length, r.launches.length, r.launches[2].team?.role, r.task("t3").agent, r.task("t3").ranAs, r.task("t3").resume], [0, 3, "builder", "sa-3", "builder", null]);
  assert.equal(r.launches[2].prompt, tg.briefText(r.graph(), "t3", LED));
  assert.ok(r.launches[2].prompt.includes("An earlier try at this task ended: its acceptance check did not pass: they pass."), r.launches[2].prompt);
});

// (fails before: yes — only the planner's own tasks call sent a failed task back: a developer who watched a lead give
// a failed task to one new worker after another had words for it, and no way to do it)
test("the developer's own send-back, from the page: its last sub-agent goes on, or with fresh a new one; the planner is told; what it waits on is said; refused in words", () => {
  const r = rig({ slots: 2 });
  ok(r.runner.apply("c1", ADD, AGENT));
  r.runner.attach("c1", TURN);
  const NOT_MET = { status: "done", did: "Wrote them.", met: false, evidence: "they pass on the old parser", left: "" };
  r.end(END("t3", "sa-2", { report: NOT_MET, files: TESTS }));
  assert.deepEqual(r.runner.sendBack("c1", "t1"), { ok: false, error: "t1 is running: only a failed task is sent back, and only a stopped one is started again" });
  assert.deepEqual(r.runner.sendBack("c1", "t4"), { ok: false, error: "t4 is the agent's own task: no sub-agent has it to go on with" });
  assert.deepEqual(r.runner.sendBack("c1", "t9"), { ok: false, error: "t9 is no task in the graph" });
  assert.deepEqual(r.runner.sendBack("c2", "t3"), { ok: false, error: "this session has no open task graph" });
  // Send back, while a turn runs: sa-2 goes on at once, and the planner hears what the developer did.
  const before = r.told.length;
  const back = ok(r.runner.sendBack("c1", "t3"));
  assert.deepEqual([back.waits, back.resumes, r.resumes.map((x) => x.id), r.task("t3").state, r.task("t3").tries, r.launches.length], [null, "sa-2", ["sa-2"], "running", 2, 2]);
  assert.deepEqual(back.view, tg.graphView(r.graph()));
  assert.deepEqual(r.told.slice(before), [{
    chainId: "c1",
    text: "[Filament: the developer did this themselves, from the page — Sent t3 back: sub-agent sa-2 goes on with it once its needs are done and a slot is free, in its own conversation — what it did is there, and it reads what failed. 0 of 4 done · running: t1 · ready: t3. Filament started t3 again on its sub-agent sa-2, in its own conversation. Now: 0 of 4 done · running: t1, t3.]",
    from: "",
    description: "the task graph",
    spends: [],
    wrote: false,
  }]);
  // Start fresh: a new sub-agent takes it, briefed on the try before.
  r.end(END("t3", "sa-2", { report: NOT_MET, files: TESTS, exchange: 1 }));
  const fresh = ok(r.runner.sendBack("c1", "t3", { fresh: true }));
  assert.deepEqual([fresh.waits, fresh.resumes, r.resumes.length, r.launches.length, r.launches[2].task.id, r.task("t3").agent, r.task("t3").earlier.agent], [null, null, 1, 3, "t3", "sa-3", "sa-2"]);
  assert.match(r.told.at(-1).text, /^\[Filament: the developer did this themselves, from the page — Sent t3 back: a new sub-agent takes it /);
  // No slot is free: it waits for one.
  r.end(END("t3", "sa-3", { report: NOT_MET, files: TESTS }));
  r.state.slots = 1;
  const waits = ok(r.runner.sendBack("c1", "t3"));
  assert.deepEqual([waits.waits, waits.resumes, r.task("t3").state, r.task("t3").resume, r.resumes.length], ["slot", "sa-3", "waiting", "sa-3", 1]);
  // Its last one can't go on: asked to send back, a new one takes it all the same, and the answer says so.
  r.state.slots = 2;
  r.end(END("t1", "sa-1"));
  r.end(END("t3", "sa-3", { report: NOT_MET, files: TESTS, exchange: 1 }));
  r.state.unresumable = "it ran on m, and a new worker runs on glm-5.3 now";
  const cant = ok(r.runner.sendBack("c1", "t3"));
  assert.deepEqual([cant.waits, cant.resumes, r.task("t3").agent === "sa-3"], [null, null, false]);
});

// (fails before: yes — the same door: with no turn to start the work in, or a held graph, it said nothing)
test("the developer's send-back while nothing can start it: no turn runs, or the graph is held since their Stop — the hold stays", () => {
  const NOT_MET = { status: "done", did: "Wrote them.", met: false, evidence: "they pass", left: "" };
  /** A graph whose t3 failed under a running turn. */
  const failed = () => {
    const r = rig({ slots: 2 });
    ok(r.runner.apply("c1", ADD, AGENT));
    r.runner.attach("c1", TURN);
    r.end(END("t3", "sa-2", { report: NOT_MET, files: TESTS }));
    return r;
  };
  const none = failed();
  none.runner.detach("c1", "turn-1");
  assert.deepEqual([ok(none.runner.sendBack("c1", "t3")).waits, none.task("t3").state, none.task("t3").resume, none.resumes.length], ["turn", "waiting", "sa-2", 0]);
  assert.match(none.told.at(-1).text, /^\[Filament: the developer did this themselves, from the page — Sent t3 back: sub-agent sa-2 goes on with it /, "the planner hears it with its next turn");
  none.runner.attach("c1", TURN);
  assert.deepEqual(none.resumes.map((x) => x.id), ["sa-2"], "the next turn starts it");
  const held = failed();
  held.runner.stop("c1");
  assert.deepEqual([ok(held.runner.sendBack("c1", "t3")).waits, !!held.graph().held, held.resumes.length], ["held", true, 0]);
});

// (fails before: yes — there was no route)
test("the send-back's route: the task by its id, fresh as true alone, a refusal as a 409, nothing wired as a 503", async () => {
  /** @type {any[][]} */
  const asked = [];
  const graphs = { sendBack: (/** @type {string} */ chainId, /** @type {string} */ id, /** @type {any} */ o) => (asked.push([chainId, id, o]), id === "t9" ? { ok: false, error: "t9 is no task in the graph" } : { ok: true, text: "Sent t3 back.", view: { rev: 7 }, waits: "turn", resumes: "sa-2" }) };
  /** @param {any} a @param {string} path @param {any} [body] */
  const call = async (a, path, body = undefined) => {
    const m = createRouter(sessionRoutes(a))("POST", path);
    assert.ok(m, `POST ${path} has a row`);
    const res = { status: 0, body: "", headersSent: false, setHeader() {}, getHeader() {}, writeHead(/** @type {number} */ s) { this.status = s; this.headersSent = true; return this; }, write(/** @type {string} */ c) { this.body += c; }, end(/** @type {string} */ c = "") { this.body += c; }, on() {} };
    await m.handler({ req: { headers: {}, method: "POST", socket: { remoteAddress: "127.0.0.1" }, on() {} }, res, path, method: "POST", params: m.params, json: async () => body }, a);
    return { status: res.status, json: JSON.parse(res.body) };
  };
  const a = { memory: { archive: { hasChain: (/** @type {string} */ id) => id === "c1" } }, usage: {}, ops: {}, sessions: {}, config: { get: () => ({}) }, graphs };
  assert.deepEqual(await call(a, "/sessions/c1/graph/tasks/T3/start"), { status: 200, json: { ok: true, text: "Sent t3 back.", waits: "turn", resumes: "sa-2", graph: { rev: 7 } } });
  assert.deepEqual(await call(a, "/sessions/c1/graph/tasks/t3/start", { fresh: true }), { status: 200, json: { ok: true, text: "Sent t3 back.", waits: "turn", resumes: "sa-2", graph: { rev: 7 } } });
  assert.deepEqual(await call(a, "/sessions/c1/graph/tasks/t3/start", { fresh: "yes" }), { status: 200, json: { ok: true, text: "Sent t3 back.", waits: "turn", resumes: "sa-2", graph: { rev: 7 } } });
  assert.deepEqual(asked, [["c1", "t3", { fresh: false }], ["c1", "t3", { fresh: true }], ["c1", "t3", { fresh: false }]], "ids are lower-cased as the graph keeps them; only true is fresh");
  assert.deepEqual(await call(a, "/sessions/c1/graph/tasks/t9/start"), { status: 409, json: { error: "t9 is no task in the graph" } });
  assert.deepEqual(await call(a, "/sessions/nope/graph/tasks/t3/start"), { status: 404, json: { error: "no such session" } });
  assert.deepEqual(await call({ ...a, graphs: null }, "/sessions/c1/graph/tasks/t3/start"), { status: 503, json: { error: "the task graph is not wired in this Filament" } });
});

// (fails before: yes — HarnessV3-FailurePoints §8 item 2: a change made in the folder itself was done as it ended,
// the review it asked for skipped)
test("a change made in the folder itself goes to a reviewer as the files its calls wrote, with no diff to read; the changes asked go back to its worker; met, it is done with nothing to merge", async () => {
  const r = rig();
  r.state.crew = LED;
  ok(r.runner.apply("c1", TEAM_ADD, LEAD));
  r.runner.attach("c1", LEAD_TURN);
  r.end(END("t3", "sa-2"));
  r.end(END("t1", "sa-1"));
  const IN_FOLDER = { files: [], shared: true, wrote: true, written: ["src/parse.js"] };
  // No git to ask: its reviewer starts at once.
  r.end(END("t2", "sa-3", IN_FOLDER));
  assert.deepEqual([r.task("t2").state, r.task("t2").step, r.task("t2").reviewer, r.read], ["review", "reading", "sa-4", []]);
  assert.deepEqual([r.launches[3].review, r.launches[3].prompt], [{ of: "sa-3", files: 1, diff: subagents.folderList(["src/parse.js"]), inFolder: true }, tg.reviewBrief(r.graph(), "t2", LED)]);
  assert.equal(subagents.folderList(["src/parse.js", "src/lex.js"]), "- src/parse.js\n- src/lex.js");
  await tick();
  r.end(END("t2", "sa-4", { review: true, report: REVIEW("Return [] for an empty input") }));
  assert.deepEqual([r.resumes[0].id, r.resumes[0].prompt], ["sa-3", tg.fixText(r.graph(), "t2")]);
  assert.match(r.resumes[0].prompt, /the folder holds your change as you left it/);
  // Read again, its files as they stand, by the same reviewer.
  r.end(END("t2", "sa-3", { ...IN_FOLDER, exchange: 1 }));
  await tick();
  assert.deepEqual([r.read, r.launches.length], [[], 4]);
  assert.deepEqual([r.resumes[1].id, r.resumes[1].prompt], ["sa-4", tg.reviewAgainText(r.graph(), "t2", subagents.changeBlock({ of: "sa-3", files: 1, diff: "- src/parse.js" }, subagents.folderNote("sa-3")), LED)]);
  r.end(END("t2", "sa-4", { review: true, report: REVIEW(""), exchange: 1 }));
  assert.deepEqual([r.task("t2").state, r.applies.length], ["done", 0]);
  assert.deepEqual([r.told.at(-1).task, r.told.at(-1).text], ["t2", tg.endText(unsaid(r.graph()), "t2", { crew: LED })]);
  assert.match(r.told.at(-1).text, /its reviewer found the change does what the task asks; it worked in the folder, so what it changed is there already\.\n/);
});

// (fails before: no — a guard the mutation pass asked for: no test of the runner read the graph that comes back after
// a summary, which is in the words of whoever plans it)
test("holds: the graph keeps each sub-agent it will still ask for — a task's worker, its reviewer while it reviews, a failed task's, the try a send-back set aside — and lets go as its task closes", async () => {
  const r = rig();
  r.state.crew = LED;
  ok(r.runner.apply("c1", TEAM_ADD, LEAD));
  r.runner.attach("c1", LEAD_TURN);
  /** @param {string[]} ids */
  const held = (...ids) => ids.map((id) => r.runner.holds("c1")(id));
  assert.deepEqual([held("sa-1", "sa-2", "sa-3"), r.runner.holds("c2")("sa-1")], [[true, true, false], false], "t1's and t3's workers run; no other session's graph holds them");
  r.end(END("t1", "sa-1"));
  r.end(END("t3", "sa-2", { files: TESTS, report: { status: "done", did: "Wrote the tests.", met: false, evidence: "the whitespace case fails", left: "" } }));
  assert.deepEqual([r.task("t1").state, r.task("t3").state, r.task("t2").agent], ["done", "failed", "sa-3"]);
  assert.deepEqual(held("sa-1", "sa-2", "sa-3"), [false, true, true], "a done task's worker goes; a failed one's change waits to be applied by its id");
  r.end(END("t2", "sa-3", { files: FIX }));
  await tick();
  assert.deepEqual([r.task("t2").step, held("sa-3", "sa-4")], ["reading", [true, true]], "its worker waits, ended, while the reviewer reads");
  r.end(END("t2", "sa-4", { review: true, report: REVIEW("Return [] for an empty input"), spentUsd: 0.1 }));
  r.end(END("t2", "sa-3", { files: FIX, exchange: 1 }));
  await tick();
  r.end(END("t2", "sa-4", { review: true, report: REVIEW(""), spentUsd: 0.1, exchange: 1 }));
  assert.deepEqual([r.task("t2").state, r.task("t2").step, held("sa-3", "sa-4")], ["merging", "yours", [true, true]], "ready: its change waits for the lead's apply by its worker's id");
  assert.deepEqual(r.runner.applyAsked({ chainId: "c1", agentId: "sa-3" }), { ok: true, id: "t2", stands: false });
  r.applies[0].done.resolve(mergedIn(FIX, "M"));
  await tick();
  assert.deepEqual([r.task("t2").state, held("sa-3", "sa-4")], ["done", [false, false]], "merged: the graph asks neither again");
  ok(r.runner.apply("c1", { action: "start", ids: ["t3"], fresh: true }, LEAD));
  assert.deepEqual([r.task("t3").agent, r.task("t3").earlier.agent, held("sa-2", "sa-5")], ["sa-5", "sa-2", [true, true]], "sent back: the try it set aside stays beside the new worker");
  ok(r.runner.apply("c1", { action: "drop", ids: ["t3"], reason: "The tests exist already" }, LEAD));
  assert.deepEqual(held("sa-2", "sa-5"), [false, false]);
});

// (fails before: yes — a task's end, and the developer's stop, read the graph again to keep it, the one they had read a
// moment before and changed nothing of since)
test("a task's end and a stop keep the graph they read, without reading it again to keep it", () => {
  const r = rig({ slots: 1 });
  ok(r.runner.apply("c1", ADD, AGENT));
  r.runner.attach("c1", TURN);
  r.reads.metaOf = 0;
  r.end(END("t1", "sa-1"));
  assert.deepEqual([r.task("t1").state, r.launches.map((l) => l.task.id)], ["done", ["t1", "t3"]], "its end moves the graph on, as ever");
  assert.equal(r.reads.metaOf, 4, "read for its end, for the work that may start (and kept as it starts), and for the words that tell it");
  r.reads.metaOf = 0;
  r.runner.stop("c1");
  assert.ok(r.graph().held);
  assert.equal(r.reads.metaOf, 1, "the stop: read once, held, kept");
});

// (fails before: no — a guard the mutation pass asked for: the server hands the registry the graphs' holds, so its
// prune keeps what a graph will still ask for)
test("the server's sub-agent registry asks the task graphs which sub-agents they hold", () => {
  const src = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  const context = src.slice(src.indexOf("subagents.setContext({"), src.indexOf("// BUG-26's crash case"));
  assert.match(context, /\n    holds: \(chainId\) => graphs\.holds\(chainId\),\n/);
});

// (fails before: yes — the runner knew no note: tasks refused the action by name, a show read nobody's change, and a
// task's end said nothing of a message its sub-agent never read)
test("an agent that reads along: its note goes to whoever works on the task now and changes nothing in the graph; a show of a task reads its sub-agent's change so far; a note never read is named in the task's end", async () => {
  const r = rig({ slots: 1 });
  /** @type {{ crew: import("../src/core/task-graph.js").Crew, reads: boolean }} */
  const READS = { crew: "agent", reads: true };
  ok(r.runner.apply("c1", ADD, READS));
  r.runner.attach("c1", TURN);
  assert.deepEqual([r.task("t1").state, r.task("t1").agent], ["running", "sa-1"]);
  const before = structuredClone(r.graph());
  const drawn = r.published.length;
  assert.deepEqual(r.runner.apply("c1", { action: "note", id: "t1", note: "  Count the tests too.  " }, READS), {
    ok: true,
    text: "Sent to sub-agent sa-1, at work on t1: it reads your note at its next step. Your next look shows whether it has.",
    view: null,
    changed: false,
  });
  assert.deepEqual(r.messages, [["sa-1", { chainId: "c1", text: "Count the tests too.", from: "agent" }]]);
  assert.deepEqual([r.graph(), r.published.length, r.launches.length], [before, drawn, 1], "the graph as it was: nothing kept, drawn or started");
  // One that waits for the developer's answer takes no step until it comes, and the agent is told so (TG2-D36).
  r.state.messageAsking = "bash";
  assert.equal(
    /** @type {any} */ (r.runner.apply("c1", { action: "note", id: "t1", note: "Skip that check." }, READS)).text,
    "Sent to sub-agent sa-1, at work on t1: it waits for the developer's answer on a bash call now, and reads your note at its next step after that answer. Your next look shows whether it has.",
  );
  r.state.messageAsking = null;
  r.messages.length = 1;
  // Refused in the graph's words, in the registry's, and by name for an agent that does not read along.
  assert.deepEqual(r.runner.apply("c1", { action: "note", id: "t2", note: "x" }, READS), { ok: false, error: "nobody works on t2 now: it has not started — put what you want into the task itself with tasks change, and its sub-agent starts with it" });
  assert.deepEqual(r.runner.apply("c1", { action: "note", id: "t4", note: "x" }, READS), { ok: false, error: "nobody works on t4 now: it is your own task" });
  assert.deepEqual(r.runner.apply("c1", { action: "note", id: "t1", note: "x" }, AGENT), { ok: false, error: `action must be one of ${tg.TASK_ACTIONS.join(", ")}\n${tg.TASK_CALLS.show} reads the graph; ${tg.TASK_CALLS.add} starts one.` });
  r.state.messageRefuse = "sub-agent sa-1 is not running";
  assert.deepEqual(r.runner.apply("c1", { action: "note", id: "t1", note: "x" }, READS), { ok: false, error: "the note did not reach sa-1: sub-agent sa-1 is not running" });
  assert.equal(r.messages.length, 1);
  // A show of the task it works on reads its change so far; any other call reads none.
  assert.equal(await r.runner.soFar("c1", { action: "show", id: "t1" }), "THE CHANGE SO FAR");
  for (const input of [{ action: "show" }, { action: "show", id: "" }, { action: "show", id: "t2" }, { action: "show", id: "t4" }, { action: "start", id: "t1" }, null]) assert.equal(await r.runner.soFar("c1", input), null, JSON.stringify(input));
  assert.deepEqual(r.asked, [["sa-1", "c1"]]);
  // The task named as ids of one, or an id in a list, is the task as the show reads it (the Hunter on E40).
  // (fails before: yes — both read no change so far, the show the whole graph)
  assert.equal(await r.runner.soFar("c1", { action: "show", ids: ["t1"] }), "THE CHANGE SO FAR");
  assert.equal(await r.runner.soFar("c1", { action: "show", id: ["t1"] }), "THE CHANGE SO FAR");
  r.state.soFar = { ok: false, error: "its change could not be read just now (git is busy) — ask again" };
  assert.equal(await r.runner.soFar("c1", { action: "show", id: "t1" }), "What sa-1 has changed could not be read: its change could not be read just now (git is busy) — ask again.");
  // Its sub-agent ended without reading the note: the end the agent is told says so, once.
  r.told.length = 0;
  r.end(END("t1", "sa-1", { unread: ["Count the tests too."] }));
  const end = r.told.find((t) => t.task === "t1");
  assert.ok(end.text.startsWith('[Filament: task t1 "Map the parser" is done') && end.text.endsWith(subagents.unreadWords(["Count the tests too."])), end.text);
  assert.ok(end.text.endsWith("\n\nIt ended without reading your message, so neither its work nor this report takes it into account:\n- Count the tests too."), end.text);
  // The end of the task that started next carries none of it.
  const going = r.graph().tasks.find((/** @type {any} */ t) => t.state === "running");
  assert.ok(going && going.id !== "t1", JSON.stringify(r.graph().tasks.map((/** @type {any} */ t) => [t.id, t.state])));
  const files = going.id === "t2" ? FIX : TESTS;
  r.told.length = 0;
  r.end(END(going.id, going.agent, { files }));
  await tick();
  const next = r.told.find((t) => t.task === going.id);
  assert.ok(next && !next.text.includes("It ended without reading"), JSON.stringify(r.told));
});

test("the graph that comes back after a summary is in its planner's words, where it stands after it", () => {
  const r = rig();
  ok(r.runner.apply("c1", ADD, AGENT));
  assert.equal(r.runner.open("c1", LED), tg.openGraphText(r.graph(), LED, null, tg.whereText(r.graph(), { crew: LED, room: tg.WHERE_ROOM.back })));
  assert.match(String(r.runner.open("c1", LED)), /\n\n\[Filament: where you are — your task graph "Ship the parser": 0 of 4 done\.\n/);
  assert.match(String(r.runner.open("c1", LED)), /\n- t4 "Update the docs" — waiting · the agent's own: give it a role, or drop it · needs t2, t3\n/);
  assert.equal(r.runner.open("c1", "agent"), tg.openGraphText(r.graph(), "agent", null, tg.whereText(r.graph(), { crew: "agent", room: tg.WHERE_ROOM.back })));
});

// (fails before: yes — the owner's words of 10-26: a task under the session's agent always started from its brief, on a
// fresh conversation, and none of its work read the planner's prefix from the provider's cache)
test("under the session's agent a task starts as a fork of the turn while that pays, else — and where its fork is refused — from its brief; under a lead, never", () => {
  /** The first launch of a rig whose turn says whether a fork pays now. @param {boolean} pays @param {(spec: any) => string | null} [refuse] */
  const first = (pays, refuse) => {
    const r = rig({ slots: 1 });
    if (refuse) r.state.refuse = refuse;
    r.runner.apply("c1", ADD, AGENT);
    r.runner.attach("c1", { ...TURN, forkable: () => pays });
    return r;
  };
  const brief = (/** @type {any} */ r) => ({ origin: "agent", chainId: "c1", prompt: tg.briefText(r.graph(), "t1", "agent"), description: "t1: Map the parser", worker: "reviewer", background: true, cwd: "/p", mode: null, parentModel: "m", thinking: null, task: { id: "t1", review: false }, requestId: "turn-1", waits: true });
  const warm = first(true);
  assert.deepEqual(warm.launches, [{ ...brief(warm), view: "fork" }], "a fork, its brief the same");
  const cold = first(false);
  assert.deepEqual(cold.launches, [brief(cold)], "from its brief");
  // The request gone between the turn's word and the launch: the registry refuses the fork, and the task starts anyway.
  const gone = first(true, (spec) => (spec.view === "fork" ? "a fork copies the main agent's newest request, which Filament holds only while a turn runs" : null));
  assert.deepEqual(gone.launches, [brief(gone)]);
  assert.deepEqual([gone.task("t1").state, gone.task("t1").agent], ["running", "sa-1"]);
  // A lead's worker starts from its brief, whatever its turn says.
  const led = rig({ slots: 1 });
  led.state.crew = LED;
  ok(led.runner.apply("c1", TEAM_ADD, LEAD));
  led.runner.attach("c1", { ...LEAD_TURN, forkable: () => true });
  assert.equal(led.launches.length, 1);
  assert.ok(!("view" in led.launches[0]), JSON.stringify(led.launches[0]));
});
