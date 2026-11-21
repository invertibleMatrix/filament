// @ts-check
// The runner's half of the flexible graph's second round (g3a, the owner's of 11-09): what the graph's core keeps it is
// handed by the runner (app/agent/graph-runner.js) — the chat's turn a task is added and changed in, from the archive;
// where a worker works, from the registry's launch; what of a merged change is still uncommitted, from one git read of
// the folder after a merge and at a turn's start; what is kept behind the graph, for the word to keep its design; and
// a name past its limit cut, said as read as meant.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";

const TURN = { runId: "turn-1", cwd: "/p", mode: null, model: "m", thinking: null, team: null };
/** @type {{ crew: import("../src/core/task-graph.js").Crew }} */
const AGENT = { crew: "agent" };
const BRIEF = { goal: "parse() takes trailing commas", steps: ["Fix parse()"], acceptance: "npm test passes" };
const FIX = [{ path: "src/parse.js", added: 12, removed: 3 }];
/** A graph task's end as the registry tells it. @param {string} id @param {string} agent @param {Record<string, any>} [more] @returns {any} */
const END = (id, agent, more = {}) => ({ id, exchange: 0, toolCalls: 3, roundIds: [`r-${agent}`], launchedBy: "turn-1", agent, status: "done", stoppedBy: null, error: null, report: { status: "done", did: "Fixed parse().", met: true, evidence: "npm test passed", left: "" }, words: "Finished.", files: [], shared: false, wrote: false, workError: null, ran: [], calls: [], written: [], spentUsd: 0.25, ms: 60_000, cut: false, ...more });
/** Let a merge's await, and a git read's, and what follows them run. */
const tick = () => new Promise((r) => setImmediate(r));
/** @param {any} r @returns {any} */
const ok = (r) => (assert.ok(r.ok, JSON.stringify(r)), r);

/**
 * A session kept in memory, its archive numbering its turns (`state.turn`); a registry whose launches answer where the
 * worker works (`state.workspace`) and whose merges the test resolves; the folder's uncommitted files (`state.open`) for
 * git's read, each read counted; and the notes behind the graph (`state.notes`: on, and what is kept).
 */
function rig() {
  /** @type {Map<string, any>} */
  const chains = new Map([["c1", { id: "c1", meta: {} }]]);
  /** @type {{ id: string, resolve: (v: any) => void }[]} */
  const applies = [];
  /** @type {string[]} */
  const gitReads = [];
  const state = { turn: 0, workspace: /** @type {string | undefined} */ ("patch"), open: /** @type {string[]} */ ([]), notes: { on: true, kept: /** @type {any} */ (null) }, n: 0, t: 1000 };
  const registry = {
    launch: () => ({ ok: true, id: `sa-${++state.n}`, done: new Promise(() => {}), ...(state.workspace ? { workspace: state.workspace } : {}) }),
    slots: () => 4,
    resumable: () => null,
    tell: () => {},
    message: () => ({ ok: true }),
    stop: () => ({ ok: true }),
    guard: () => {},
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
    snapshot: async () => ({ ok: /** @type {const} */ (false), error: "no repository" }),
    between: async () => ({ ok: /** @type {const} */ (true), files: [] }),
    /** @param {string} folder */
    uncommitted: async (folder) => (gitReads.push(folder), { ok: /** @type {const} */ (true), repo: folder, files: [...state.open] }),
  };
  const notes = /** @type {any} */ ({ get on() { return state.notes.on; }, kept: () => (state.notes.on ? state.notes.kept : null) });
  const runner = createGraphRunner({ archive, registry: /** @type {any} */ (registry), events: { publish: () => {} }, crew: () => "agent", log: () => {}, now: () => state.t++, notes, folders });
  /** @param {string} id @returns {any} */
  const task = (id) => chains.get("c1").meta.graph?.tasks.find((/** @type {any} */ t) => t.id === id);
  return { runner, state, applies, gitReads, task };
}

// (fails before: yes — no task kept a turn, the runner read none, and a launch's workspace was dropped)
test("a task added and changed keeps the archive's turn, said after a compaction; a worker keeps where its launch put it", () => {
  const r = rig();
  r.state.turn = 12;
  ok(r.runner.apply("c1", { action: "add", goal: "g", tasks: [{ id: "t1", name: "Fix", by: "sub-agent", writes: ["src/parse.js"], ...BRIEF }, { id: "t2", name: "Docs" }] }, AGENT));
  assert.deepEqual([r.task("t2").addedTurn, r.task("t2").changedTurn], [12, 12]);
  r.state.turn = 15;
  ok(r.runner.apply("c1", { action: "change", tasks: [{ id: "t2", name: "Docs, whole" }] }, AGENT));
  assert.deepEqual([r.task("t2").addedTurn, r.task("t2").changedTurn], [12, 15]);
  assert.match(String(r.runner.open("c1", "agent")), /\n- t2 "Docs, whole" — ready · added turn 12, changed turn 15\n/);
  r.runner.attach("c1", TURN);
  assert.deepEqual([r.task("t1").state, r.task("t1").workspace], ["running", "patch"]);
  assert.match(String(r.runner.open("c1", "agent")), /\n- t1 "Fix" — running on sa-1, in a patch of its own · by sub-agent/);
});

// (fails before: yes — a merged change read as finished whether or not it was committed)
test("after a merge, one git read marks the task applied, not committed; at a turn's start a read clears it once committed", async () => {
  const r = rig();
  ok(r.runner.apply("c1", { action: "add", goal: "g", tasks: [{ id: "t1", name: "Fix", by: "sub-agent", writes: ["src/parse.js"], ...BRIEF }] }, AGENT));
  r.runner.attach("c1", TURN);
  r.runner.ended({ chainId: "c1", task: END("t1", "sa-1", { files: FIX }) });
  assert.equal(r.task("t1").step, "yours");
  ok(r.runner.applyAsked({ chainId: "c1", agentId: "sa-1" }));
  r.state.open = ["src/parse.js", "notes.txt"];
  r.applies[0].resolve({ ok: true, repo: "/repo", files: FIX.map((f) => ({ ...f, status: "M", binary: false })) });
  await tick();
  await tick();
  assert.deepEqual([r.task("t1").state, r.task("t1").uncommitted, r.gitReads], ["done", ["src/parse.js"], ["/repo"]]);
  assert.match(ok(r.runner.apply("c1", { action: "show", id: "t1" }, AGENT)).text, /\nApplied, not committed: src\/parse\.js is uncommitted in the folder\./);
  // Committed: the next turn's read clears it; a turn with nothing marked reads nothing.
  r.state.open = [];
  r.runner.begin("c1", "agent");
  await tick();
  assert.deepEqual([r.task("t1").uncommitted, r.gitReads.length], [undefined, 2]);
  r.runner.begin("c1", "agent");
  await tick();
  assert.equal(r.gitReads.length, 2, "nothing marked: no read");
});

// (fails before: yes — nothing asked for the design behind a plan; a long name was refused)
test("an add of three with nothing kept behind the graph asks once to keep the design, notes on; a long name is cut and said", () => {
  const three = [{ id: "t1", name: "A" }, { id: "t2", name: "B" }, { id: "t3", name: "C" }];
  const r = rig();
  const added = ok(r.runner.apply("c1", { action: "add", goal: "g", tasks: three }, AGENT));
  assert.ok(added.text.endsWith(" Keep the design behind it: tasks keep with no id, titled Design."), added.text);
  const off = rig();
  off.state.notes.on = false;
  assert.ok(!ok(off.runner.apply("c1", { action: "add", goal: "g", tasks: three }, AGENT)).text.includes("Keep the design"), "no notes kept: nothing asked");
  // A graph whose design is kept already, added three more: nothing asked.
  const kept = rig();
  ok(kept.runner.apply("c1", { action: "add", goal: "g", tasks: [{ id: "t0", name: "Map it" }] }, AGENT));
  kept.state.notes.kept = { "": { notes: 1, files: 0, bytes: 9, titles: ["Design"] } };
  assert.ok(!ok(kept.runner.apply("c1", { action: "add", tasks: three }, AGENT)).text.includes("Keep the design"), "kept already");
  const long = `Fix ${"the parser ".repeat(14)}`.trim();
  const cut = ok(rig().runner.apply("c1", { action: "add", goal: "g", tasks: [{ id: "t1", name: long }] }, AGENT));
  assert.match(cut.text, /\nRead as meant: t1's name cut to 120 characters\.$/);
});
