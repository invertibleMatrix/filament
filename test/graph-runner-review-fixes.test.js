// @ts-check
// The runner's half of the fixes from the reviews of g1 and g3 (app/agent/graph-runner.js): the session's sharing kept
// with its graph, so every reader — the Plan, a compaction's text, /graph — says where tasks meet by it, the registry
// reading the chat's setting as a launch does; a span's close read after a start reopened its task kept to its round;
// what a merge brought in while a span was opening; reads of what is uncommitted taken in the order they were asked; the
// developer's apply read where it went in, with no turn since a restart; a checklist's task keeping its turn; and a
// steer fork's proposal read as meant.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { graphCommandReply } from "../src/app/commands/graph.js";

const TURN = { runId: "turn-1", cwd: "/p", mode: null, model: "m", thinking: null, team: null };
/** @type {{ crew: import("../src/core/task-graph.js").Crew }} */
const AGENT = { crew: "agent" };
const BRIEF = { goal: "It is done", steps: ["Do it"], acceptance: "the check passes" };
const FIX = [{ path: "src/parse.js", added: 12, removed: 3 }];
/** A graph task's end as the registry tells it. @param {string} id @param {string} agent @param {Record<string, any>} [more] @returns {any} */
const END = (id, agent, more = {}) => ({ id, exchange: 0, toolCalls: 3, roundIds: [`r-${agent}`], launchedBy: "turn-1", agent, status: "done", stoppedBy: null, error: null, report: { status: "done", did: "Fixed parse().", met: true, evidence: "npm test passed", left: "" }, words: "Finished.", files: [], shared: false, wrote: false, workError: null, ran: [], calls: [], written: [], spentUsd: 0.25, ms: 60_000, cut: false, ...more });
/** Let the awaits queued so far, and what follows them, run. */
const tick = async () => {
  for (let k = 0; k < 5; k++) await new Promise((r) => setImmediate(r));
};
/** @param {any} r @returns {any} */
const ok = (r) => (assert.ok(r.ok, JSON.stringify(r)), r);
const FOLDER = "t1 and t2 both write src/a.js, in your folder at once: one may write over the other's edits — have one need the other, or work one in its own copy.";

/**
 * A session kept in memory; a registry whose `room` says where its sub-agents work (`state.worktree`) and whose merges
 * the test resolves; git's reads of the folder held until the test answers them — each snapshot (`snaps`), each read of
 * what is uncommitted (`reads`) — and what changed between two snapshots (`state.diff`, by "from..to").
 * @param {Map<string, any>} [chains]
 */
function rig(chains = new Map([["c1", { id: "c1", meta: {} }]])) {
  /** @type {{ id: string, resolve: (v: any) => void }[]} */
  const applies = [];
  /** @type {((v: any) => void)[]} */
  const snaps = [];
  /** @type {{ folder: string, resolve: (v: any) => void }[]} */
  const reads = [];
  /** @type {any[]} */
  const views = [];
  const state = { turn: 3, worktree: true, diff: /** @type {Record<string, string[]>} */ ({}), n: 0, t: 1000 };
  const registry = {
    launch: () => ({ ok: true, id: `sa-${++state.n}`, done: new Promise(() => {}) }),
    slots: () => 4,
    resumable: () => null,
    tell: () => {},
    message: () => ({ ok: true }),
    stop: () => ({ ok: true }),
    guard: () => {},
    room: () => ({ running: 0, cwd: "/p", worktree: state.worktree }),
    /** @param {string} id */
    mergeTask: (id) => new Promise((resolve) => applies.push({ id, resolve })),
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
      c.meta = structuredClone({ ...c.meta, ...patch });
      return c.meta;
    },
    openGraphs: () => [],
    newestTurnN: () => state.turn,
  };
  const folders = {
    snapshot: () => new Promise((resolve) => snaps.push(resolve)),
    /** @param {string} repo @param {string} from @param {string} to */
    between: async (repo, from, to) => ({ ok: /** @type {const} */ (true), files: state.diff[`${from}..${to}`] || [] }),
    /** @param {string} folder */
    uncommitted: (folder) => new Promise((resolve) => reads.push({ folder, resolve })),
  };
  const runner = createGraphRunner({ archive, registry: /** @type {any} */ (registry), events: { publish: (/** @type {string} */ _t, /** @type {any} */ e) => views.push(e) }, crew: () => "agent", log: () => {}, now: () => state.t++, folders: /** @type {any} */ (folders) });
  /** @param {string} id @returns {any} */
  const task = (id) => chains.get("c1").meta.graph?.tasks.find((/** @type {any} */ t) => t.id === id);
  /** The next snapshot asked answered, at `commit`. @param {string} commit */
  const snap = async (commit) => {
    await tick();
    const next = snaps.shift();
    assert.ok(next, `a snapshot was asked for ${commit}`);
    next({ ok: true, repo: "/p", commit });
    await tick();
  };
  return { runner, state, applies, snaps, reads, views, chains, task, snap };
}

// (fails before: yes — the graph kept nothing of where its sub-agents work: the Plan, the compaction's text and /graph said a merge)
test("the session's sub-agents sharing its folder: the graph is kept with it, and the Plan, a compaction's text and /graph say the two write there at once", () => {
  const r = rig();
  r.state.worktree = false;
  const added = ok(r.runner.apply("c1", { action: "add", goal: "g", tasks: [{ id: "t1", name: "A", by: "sub-agent", writes: ["src/a.js"], ...BRIEF }, { id: "t2", name: "B", by: "sub-agent", writes: ["src/a.js"], ...BRIEF }] }, AGENT));
  assert.ok(added.text.endsWith(`\n${FOLDER}`), added.text);
  assert.equal(r.chains.get("c1").meta.graph.shared, true);
  const view = r.views.at(-1).graph;
  assert.deepEqual(view.tasks.map((/** @type {any} */ t) => t.mergesWith), [[{ task: "t2", files: ["src/a.js"], folder: true }], [{ task: "t1", files: ["src/a.js"], folder: true }]]);
  assert.ok(String(r.runner.open("c1", "agent")).includes(`\n${FOLDER}\n`));
  const memory = { archive: { getChain: (/** @type {string} */ id) => r.chains.get(id) }, docFor: () => ({ effective: {} }), archiveWhy: () => "" };
  assert.ok(graphCommandReply(memory, "c1", { arg: "" }).text.includes(`\n${FOLDER}\n`));
  // The setting turned back: the next keep of the graph takes it away.
  r.state.worktree = true;
  ok(r.runner.apply("c1", { action: "change", tasks: [{ id: "t1", name: "A, again" }] }, AGENT));
  assert.equal(r.chains.get("c1").meta.graph.shared, undefined);
  assert.match(String(r.runner.open("c1", "agent")), /\nt1 and t2 both write src\/a\.js: whichever lands second merges three-way at its apply\.\n/);
});

// (fails before: yes — the registry read subagents.worktree alone: a chat whose workspace is its folder read as in worktrees)
test("the registry says where a chat's sub-agents work as a launch reads its setting: the workspace, else the older worktree", () => {
  /** @param {any} sub */
  const roomOf = (sub) => {
    const registry = createSubagentRegistry({
      config: () => ({ agentLoop: {} }),
      log: () => {},
      events: { publish: () => {} },
      runs: null,
      context: /** @type {any} */ ({ settings: () => ({ subagents: sub }), session: () => ({ cwd: "/p", model: "m", projectId: null, client: "harness" }) }),
      call: async () => ({ ok: false, status: 500, json: null, id: "", upstream: "m", retryAfter: null, shouldRetry: null }),
    });
    return registry.room("c1").worktree;
  };
  assert.deepEqual([roomOf({ workspace: "folder" }), roomOf({ worktree: false }), roomOf({ workspace: "auto", worktree: false }), roomOf({ workspace: "patch" }), roomOf({})], [false, false, true, true, true]);
});

// (fails before: yes — the late close found the task running again: round 1's files joined round 2's, and its base moved on)
test("a done's span read after a start reopened the task: its files stay with round 1, and round 2's done says only its own", async () => {
  const r = rig();
  ok(r.runner.apply("c1", { action: "add", goal: "g", tasks: [{ id: "t9", name: "Own", writes: ["src/a.js"] }] }, AGENT));
  r.runner.attach("c1", TURN);
  ok(r.runner.apply("c1", { action: "start", id: "t9" }, AGENT));
  await r.snap("c0");
  assert.equal(r.task("t9").base.commit, "c0");
  const done = ok(r.runner.apply("c1", { action: "done", id: "t9", summary: "Round one." }, AGENT));
  // Its close's snapshot is under way as the planner starts it again — a call that waits for no done's words.
  await tick();
  ok(r.runner.apply("c1", { action: "start", id: "t9" }, AGENT));
  r.state.diff["c0..c1"] = ["src/a.js", "src/old.js"];
  await r.snap("c1");
  assert.equal(await done.more, "While t9 ran, the folder changed src/a.js, and src/old.js changed too, beyond its writes — if that was other work, nothing to do.", "the done's words are of the round it ended");
  assert.deepEqual([r.task("t9").round, r.task("t9").changed, r.task("t9").earlier.done.changed], [2, undefined, ["src/a.js", "src/old.js"]]);
  await r.snap("c1");
  assert.equal(r.task("t9").base.commit, "c1", "round 2 opened a span of its own");
  r.state.diff["c1..c2"] = ["src/a.js"];
  const two = ok(r.runner.apply("c1", { action: "done", id: "t9", summary: "Round two." }, AGENT));
  await r.snap("c2");
  assert.equal(await two.more, "While t9 ran, the folder changed src/a.js.");
});

// (fails before: yes — a merge that came while the span's snapshot was read was named beyond its writes)
test("a merge that lands while the agent's own task's span is opening is never named beyond its writes", async () => {
  const r = rig();
  ok(r.runner.apply("c1", { action: "add", goal: "g", tasks: [{ id: "t9", name: "Own", writes: ["src/a.js"] }, { id: "t1", name: "Fix", by: "sub-agent", writes: ["src/parse.js"], ...BRIEF }] }, AGENT));
  r.runner.attach("c1", TURN);
  r.runner.ended({ chainId: "c1", task: END("t1", "sa-1", { files: FIX }) });
  ok(r.runner.applyAsked({ chainId: "c1", agentId: "sa-1" }));
  ok(r.runner.apply("c1", { action: "start", id: "t9" }, AGENT));
  // The snapshot reads the folder as the merge lands, before its keep.
  r.applies[0].resolve({ ok: true, repo: "/p", files: FIX.map((f) => ({ ...f, status: "M", binary: false })) });
  await tick();
  assert.equal(r.task("t1").state, "done");
  await r.snap("c0");
  r.state.diff["c0..c1"] = ["src/a.js", "src/parse.js"];
  const done = ok(r.runner.apply("c1", { action: "done", id: "t9", summary: "Own done." }, AGENT));
  await r.snap("c1");
  assert.equal(await done.more, "While t9 ran, the folder changed src/a.js.");
});

// (fails before: yes — the older read came back last and put the mark back the newer one had cleared)
test("reads of what is uncommitted are taken in the order they were asked: one older than a read that came back is dropped", async () => {
  const r = rig();
  ok(r.runner.apply("c1", { action: "add", goal: "g", tasks: [{ id: "t1", name: "Fix", by: "sub-agent", writes: ["src/parse.js"], ...BRIEF }] }, AGENT));
  r.runner.attach("c1", TURN);
  r.runner.ended({ chainId: "c1", task: END("t1", "sa-1", { files: FIX }) });
  ok(r.runner.applyAsked({ chainId: "c1", agentId: "sa-1" }));
  r.applies[0].resolve({ ok: true, repo: "/repo", files: FIX.map((f) => ({ ...f, status: "M", binary: false })) });
  await tick();
  r.reads.shift()?.resolve({ ok: true, repo: "/repo", files: ["src/parse.js"] });
  await tick();
  assert.deepEqual(r.task("t1").uncommitted, ["src/parse.js"]);
  // Two turns begin; the first's read is slow, and the folder is committed between them.
  r.runner.begin("c1", "agent");
  r.runner.begin("c1", "agent");
  const [older, newer] = [r.reads.shift(), r.reads.shift()];
  newer?.resolve({ ok: true, repo: "/p", files: [] });
  await tick();
  assert.equal(r.task("t1").uncommitted, undefined);
  older?.resolve({ ok: true, repo: "/p", files: ["src/parse.js"] });
  await tick();
  assert.equal(r.task("t1").uncommitted, undefined, "the older read tells nothing the newer did not");
});

// (fails before: yes — with no turn since Filament started, the apply's read had no folder, and nothing was marked)
test("the developer's apply after a restart, no turn since: what is uncommitted is read where it went in", async () => {
  const before = rig();
  ok(before.runner.apply("c1", { action: "add", goal: "g", tasks: [{ id: "t1", name: "Fix", by: "sub-agent", writes: ["src/parse.js"], ...BRIEF }] }, AGENT));
  before.runner.attach("c1", TURN);
  before.runner.ended({ chainId: "c1", task: END("t1", "sa-1", { files: FIX }) });
  assert.equal(before.task("t1").step, "yours");
  const after = rig(before.chains);
  after.runner.applied({ chainId: "c1", agentId: "sa-1", files: FIX, repo: "/repo" });
  await tick();
  assert.deepEqual(after.reads.map((x) => x.folder), ["/repo"]);
  after.reads[0].resolve({ ok: true, repo: "/repo", files: ["src/parse.js"] });
  await tick();
  assert.deepEqual([after.task("t1").state, after.task("t1").uncommitted], ["done", ["src/parse.js"]]);
});

// (fails before: yes — the checklist's call kept no turn on its tasks)
test("a checklist's task keeps the chat's turn it was added in", () => {
  const r = rig();
  r.state.turn = 9;
  r.runner.plan("c1", [{ text: "Map it", status: "doing" }]);
  assert.deepEqual([r.task("p1").addedTurn, r.task("p1").changedTurn], [9, 9]);
});

// (fails before: yes — a fork's plan whose task named itself past 120 characters was refused whole)
test("a steer fork's proposal is read as a tasks call is: a long name cut, the tasks added", () => {
  const r = rig();
  const long = `Fix ${"the parser ".repeat(14)}`.trim();
  const p = r.runner.propose("c1", { goal: "g", tasks: [{ id: "t1", name: long }] });
  assert.deepEqual(p, { ok: true, ids: ["t1"] });
  assert.equal(r.task("t1").name.length, 120);
});
