// @ts-check
// HarnessV3-TaskGraph-v2 V2-2 (§14.2; TG2-D2): the gate. When the task graph merges a worker's change into the folder,
// Filament checks the folder with it as it checks a lead's apply (TG2-D55): the change's own check where it passed on this
// very work, every command that passed in the folder after an earlier apply or merge — and the planner's own tasks'
// checks once they passed — and the session's loop.verify.afterEdits, in a worktree of a snapshot of the folder after
// the merge, a red one on the snapshot from before it too. A merge that broke one is undone, and the task goes back to
// its worker — by the runner, as a review's asked changes do — twice at most; a folder red already keeps the merge. The
// cases of §14.2, in order.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tg from "../src/core/task-graph.js";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { PROMPT_VERSION } from "../src/app/agent/prompt.js";
import { drawGraph } from "../src/ui/harness/views/task-graph.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";
import { membersOf } from "./helpers/roster.js";
import { until } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});

/** @type {{ crew: import("../src/core/task-graph.js").Crew }} */
const AGENT = { crew: "agent" };
const LED = membersOf({ scout: "Map what exists.", builder: "Build against the contract.", tester: "", reviewer: "Review against the contract." });
/** @param {any} r @returns {any} */
const ok = (r) => (assert.ok(r.ok, JSON.stringify(r)), r);
const tick = () => new Promise((r) => setImmediate(r));
const T1 = 1000;
/** @param {any} graph @param {string} id @returns {any} */
const task = (graph, id) => graph.tasks.find((/** @type {any} */ t) => t.id === id);

// ---- the core: the verdict a task keeps, its words, and the step back ------------------------------------------------

/** A sub-agent's t3 with a check, and t4 after it: t3 runs on sa-1. */
const running = () => {
  const g = ok(tg.applyTasks(null, { action: "add", goal: "Ship", tasks: [{ id: "t3", name: "Write more tests", by: "sub-agent", writes: ["test/more.test.js"], goal: "More tests", steps: ["Write them"], acceptance: "they pass", check: ["node --test test/more.test.js"] }, { id: "t4", name: "Ship it", needs: ["t3"] }] }, { at: T1, ...AGENT })).graph;
  return /** @type {any} */ (tg.launched(g, "t3", "sa-1", T1 + 1, "sub-agent"));
};
/** t3's end: it reported done, and its check passed in its worktree. */
const END = {
  agent: "sa-1",
  status: "done",
  stoppedBy: null,
  error: null,
  report: { status: "done", did: "Wrote the tests.", met: true, evidence: "they pass", left: "" },
  words: "",
  files: [{ path: "test/more.test.js", added: 20, removed: 0 }],
  shared: false,
  wrote: true,
  workError: null,
  ran: [],
  calls: [],
  written: [],
  spentUsd: 0.1,
  ms: 60_000,
  cut: false,
  check: { ran: true, commands: ["node --test test/more.test.js"], runs: [{ command: "node --test test/more.test.js", exit: 0, ms: 2000, output: "ok", stopped: false, first: null }], bounces: 0, stopped: false },
  provider: null,
};
/** The graph with t3's change merging: ready in its copy, then applied by its planner (the owner's of 11-02). */
const merging = () => {
  const r = /** @type {any} */ (tg.taskEnded(running(), "t3", /** @type {any} */ (END), T1 + 2));
  assert.equal(r.state, "yours");
  const a = /** @type {any} */ (tg.applyAsked(r.graph, "sa-1"));
  assert.ok(a?.ok, JSON.stringify(a));
  return a.graph;
};
/** One command of the folder's check as the registry hands it: its run after the merge, and before it where it ran there. */
const FR = (/** @type {string} */ command, /** @type {number | null} */ after, /** @type {number | null} */ before = null, own = false) => ({
  command,
  after: { command, exit: after, ms: 6000, output: after === 0 ? "ok" : "FAIL a.test.js\n  expected 2 to equal 3", stopped: false },
  before: before === null ? null : { command, exit: before, ms: 5000, output: before === 0 ? "ok" : "FAIL before", stopped: false },
  own,
});
const FILES = [{ path: "test/more.test.js", added: 20, removed: 0 }];

// (fails before: yes — a merge kept nothing of a check, and said none)
test("passed: the task is done, keeps the verdict, and its end and show name each command", () => {
  const gate = tg.gateOf({ kind: "passed", runs: [FR("node --test test/more.test.js", 0), FR("npm test", 0)], ruled: [] }, T1 + 3);
  assert.deepEqual(gate, { kind: "passed", runs: [{ command: "node --test test/more.test.js", exit: 0, ms: 6000, before: null }, { command: "npm test", exit: 0, ms: 6000, before: null }], broke: null, output: "", words: "", ruled: [], back: null, conflicts: [], stuck: [], at: T1 + 3 });
  const done = /** @type {any} */ (tg.taskMerged(merging(), "t3", FILES, T1 + 3, gate));
  assert.deepEqual([task(done, "t3").state, task(done, "t3").gate.kind], ["done", "passed"]);
  assert.match(tg.endText(done, "t3", { crew: "agent" }), /^\[Filament: task t3 "Write more tests" is done: sub-agent sa-1 reported it done, and Filament's check passed \(`node --test test\/more\.test\.js`, 2 s\), and its change is merged into your folder\. Filament's check of the folder with it passed: `node --test test\/more\.test\.js` passed \(exit 0, 6 s\), and `npm test` passed \(exit 0, 6 s\)\.\n/);
  const shown = /** @type {any} */ (tg.applyTasks(done, { action: "show", id: "t3" }, { at: T1 + 4, ...AGENT })).text;
  assert.match(shown, /\nFolder: Filament's check of the folder with its change passed: `node --test test\/more\.test\.js` passed \(exit 0, 6 s\), and `npm test` passed \(exit 0, 6 s\)\n/);
  // A merge with no command to run keeps no verdict, and says none, as before.
  const plain = /** @type {any} */ (tg.taskMerged(merging(), "t3", FILES, T1 + 3, null));
  assert.equal(task(plain, "t3").gate, null);
  assert.doesNotMatch(tg.endText(plain, "t3", { crew: "agent" }), /check of the folder/);
});

// (fails before: yes — nothing undid a merge, so nothing went back)
test("undone, sent back: the task waits on its worker, step back; the job gate comes first and its worker reads the note; the planner hears it once", () => {
  const broke = FR("npm test", 1, 0);
  const gate = tg.gateOf({ kind: "undone", runs: [FR("node --test test/more.test.js", 0), broke], ruled: [], broke, back: { n: 1 } }, T1 + 3);
  assert.deepEqual([gate.broke, gate.back, gate.output], [{ command: "npm test", exit: 1, ms: 6000, own: false, before: 0 }, { n: 1 }, "FAIL a.test.js\n  expected 2 to equal 3"]);
  const r = /** @type {any} */ (tg.gateUndone(merging(), "t3", gate, T1 + 3));
  assert.equal(r.state, "back");
  const t = task(r.graph, "t3");
  assert.deepEqual([t.state, t.step, t.merged, t.gate.kind], ["merging", "back", null, "undone"]);
  assert.equal(tg.mergeNext(r.graph), null, "a change undone does not merge again before its worker reports");
  assert.deepEqual(tg.jobs(r.graph), [{ id: "t3", kind: "gate" }]);
  assert.equal(
    tg.endText(r.graph, "t3", { crew: "agent" }),
    [
      '[Filament: task t3 "Write more tests": its change went into your folder and broke it — `npm test` passes without it and fails with it (exit 1, 6 s). Filament undid the merge, so your folder is as it was before it, and sends the task back to its sub-agent sa-1 with the output (the first time of two); its worktree holds your folder with its change in it. Leave the fix to it until it reports: an edit of yours to a file it fixes meanwhile collides with its fix, and then its change cannot merge. Its end reaches you as a message.',
      "The end of the output:\nFAIL a.test.js\n  expected 2 to equal 3",
      "Now: 0 of 2 done · merging: t3.]",
    ].join("\n"),
  );
  assert.equal(
    tg.gateBackText(r.graph, "t3", "agent"),
    "[Filament: your change for task t3 went into the developer's folder, and the folder's check failed with it: `npm test` passes without your change and fails with it. The merge was undone. Your worktree now holds the developer's folder with your change in it, so the command fails here as it did there; Filament runs it with your task's check when you report. Make your change pass with the rest of the folder, never by weakening the check, run it yourself, and call report again. This is the first time Filament sent your task back for the folder's check; after the second, the agent decides.\n\n$ npm test\nexit 1 after 6 s — the end of its output:\nFAIL a.test.js\n  expected 2 to equal 3]",
  );
  const going = /** @type {any} */ (tg.gateLaunched(r.graph, "t3"));
  assert.deepEqual([task(going, "t3").state, task(going, "t3").step, task(going, "t3").gate.kind], ["running", null, "undone"]);
  assert.deepEqual(tg.jobs(going), []);
  assert.equal(tg.gateLaunched(going, "t3"), null, "only a task sent back goes back");
  // Its worker could not take it: the task fails, in those words.
  const refused = /** @type {any} */ (tg.gateStepRefused(r.graph, "t3", "sub-agent sa-1 is still working", T1 + 4));
  assert.deepEqual([task(refused, "t3").state, task(refused, "t3").failures.cause], ["failed", "gate"]);
  assert.equal(task(refused, "t3").why, "its change broke your folder's check, and Filament undid the merge, but the change could not go back to its sub-agent: sub-agent sa-1 is still working");
});

// (fails before: yes — the same)
test("undone, not sent back: twice already, or it cannot go — the task fails with cause gate, the output and the choices", () => {
  const broke = FR("npm test", 1, 0);
  const twice = /** @type {any} */ (tg.gateUndone(merging(), "t3", tg.gateOf({ kind: "undone", runs: [broke], ruled: [], broke, back: { twice: true } }, T1 + 3), T1 + 3));
  assert.equal(twice.state, "failed");
  const t = task(twice.graph, "t3");
  assert.deepEqual([t.failures.cause, t.why], ["gate", "its change broke your folder's check: `npm test` passes without it and fails with it (exit 1, 6 s); Filament undid the merge, and it went back to its sub-agent twice already"]);
  const told = tg.endText(twice.graph, "t3", { crew: "agent" });
  assert.match(told, /^\[Filament: task t3 "Write more tests" failed: its change broke your folder's check: `npm test` passes without it and fails with it \(exit 1, 6 s\); Filament undid the merge, and it went back to its sub-agent twice already\.\n/);
  assert.match(told, /\nThe end of the output:\nFAIL a\.test\.js\n {2}expected 2 to equal 3\n/);
  assert.match(told, /\nIts change is not in your folder: it waits in sub-agent sa-1's own worktree/);
  const gone = /** @type {any} */ (tg.gateUndone(merging(), "t3", tg.gateOf({ kind: "undone", runs: [broke], ruled: [], broke, back: { why: "Filament is stopping" } }, T1 + 3), T1 + 3));
  assert.equal(task(gone.graph, "t3").why, "its change broke your folder's check: `npm test` passes without it and fails with it (exit 1, 6 s); Filament undid the merge, and it could not go back to its sub-agent (Filament is stopping)");
  // Under a lead: the folder, its worker, and the lead's merge as it stands among its choices.
  const lg = ok(tg.applyTasks(null, { action: "add", goal: "Ship", tasks: [{ id: "b1", name: "Build", by: "builder", writes: ["a.js"], goal: "g", steps: ["s"], acceptance: "a" }] }, { at: T1, crew: LED })).graph;
  const lr = /** @type {any} */ (tg.taskEnded(/** @type {any} */ (tg.launched(lg, "b1", "sa-9", T1, "builder")), "b1", { agent: "sa-9", status: "done", stoppedBy: null, error: null, report: { status: "done", did: "Built.", met: true, evidence: "ok", left: "" }, words: "", files: [{ path: "a.js", added: 1, removed: 0 }], shared: false, wrote: true, workError: null, ran: [], calls: [], written: [], spentUsd: 0, ms: 1, cut: false, check: null, provider: null }, T1 + 1));
  const lf = /** @type {any} */ (tg.gateUndone(lr.graph, "b1", tg.gateOf({ kind: "undone", runs: [broke], ruled: [], broke, back: { twice: true } }, T1 + 3), T1 + 3));
  assert.match(tg.endText(lf.graph, "b1", { crew: LED }), /failed: its change broke the folder's check: `npm test` passes without it and fails with it \(exit 1, 6 s\); Filament undid the merge, and it went back to its builder twice already\.\n[\s\S]*tasks merge takes it as it stands/);
});

// (fails before: yes — the same)
test("its own check red in the folder: undone though it fails before too, the words say so", () => {
  const broke = FR("node --test test/more.test.js", 1, 1, true);
  const r = /** @type {any} */ (tg.gateUndone(merging(), "t3", tg.gateOf({ kind: "undone", runs: [broke], ruled: [], broke, back: { n: 2 } }, T1 + 3), T1 + 3));
  assert.match(tg.endText(r.graph, "t3", { crew: "agent" }), /its change went into your folder and broke it — its own check `node --test test\/more\.test\.js` passed in its worktree, and fails with the rest of your folder \(exit 1, 6 s\), and without the change too\. Filament undid the merge, so your folder is as it was before it, and sends the task back to its sub-agent sa-1 with the output \(the second time of two\);/);
  assert.match(tg.gateBackText(r.graph, "t3", "agent"), /the folder's check failed with it: your task's check `node --test test\/more\.test\.js` passed in your worktree, and fails with the rest of the folder, and without your change too\. [\s\S]*This is the second time Filament sent your task back for the folder's check; after the second, the agent decides\./);
});

// (fails before: yes — the same)
test("red already, an unclean undo, a lead's reason, not checked: the merge stands, done, each said", () => {
  /** @param {any} check */
  const doneWith = (check) => {
    const g = /** @type {any} */ (tg.taskMerged(merging(), "t3", FILES, T1 + 3, tg.gateOf(check, T1 + 3)));
    return { g, text: tg.endText(g, "t3", { crew: "agent" }) };
  };
  const red = doneWith({ kind: "red", runs: [FR("node --test test/more.test.js", 0), FR("npm test", 1, 1)], ruled: [] });
  assert.equal(task(red.g, "t3").state, "done");
  assert.match(red.text, /and its change is merged into your folder\. Filament's check of the folder fails with it, and failed before it too: `npm test` failed \(exit 1, 6 s\)\. Your folder was red on it already, so the merge stands\.\nThe end of its output:\nFAIL a\.test\.js/);
  const stuck = doneWith({ kind: "stuck", runs: [FR("npm test", 1, 0)], ruled: [], broke: FR("npm test", 1, 0), conflicts: [{ path: "a.js", why: "1 change overlaps yours" }], stuck: ["b.js"] });
  assert.match(stuck.text, /and its change is merged into your folder\. With it your folder's check fails, and without it the check passes — `npm test` failed \(exit 1, 6 s\) — and Filament could not undo the merge cleanly, since your folder changed there after it: a\.js: 1 change overlaps yours\. 1 file could not be put back as it was — b\.js: check it by hand\. It stands, red\.\nThe end of its output:\nFAIL a\.test\.js/);
  const reason = doneWith({ kind: "reason", runs: [FR("npm test", 1)], ruled: [] });
  assert.match(reason.text, /Filament's check of the folder fails with it — `npm test` failed \(exit 1, 6 s\) — and it stands, for your reason\./);
  const not = doneWith({ kind: "not", words: "Filament did not check the folder with it: this session's rule bash(npm test) deny refuses `npm test`." });
  assert.match(not.text, /and its change is merged into your folder\. Filament did not check the folder with it: this session's rule bash\(npm test\) deny refuses `npm test`\.\n/);
  const ruled = doneWith({ kind: "passed", runs: [FR("npm test", 0)], ruled: ["It did not run `npm run lint`: this session's rule bash(npm run lint) ask asks first."] });
  assert.match(ruled.text, /Filament's check of the folder with it passed: `npm test` passed \(exit 0, 6 s\)\. It did not run `npm run lint`: this session's rule bash\(npm run lint\) ask asks first\.\n/);
});

// (fails before: yes — the gate's verdict did not outlive a new try)
test("a new try of the task starts with no verdict of the folder's: launched again, or sent back by the planner", () => {
  const broke = FR("npm test", 1, 0);
  const failed = /** @type {any} */ (tg.gateUndone(merging(), "t3", tg.gateOf({ kind: "undone", runs: [broke], ruled: [], broke, back: { twice: true } }, T1 + 3), T1 + 3)).graph;
  const sent = ok(tg.applyTasks(failed, { action: "start", id: "t3", note: "Keep the default at 2." }, { at: T1 + 5, ...AGENT, resumable: () => null }));
  const again = /** @type {any} */ (tg.resumed(sent.graph, "t3", T1 + 6));
  assert.equal(task(again, "t3").gate, null);
  const fresh = ok(tg.applyTasks(failed, { action: "start", id: "t3", fresh: true }, { at: T1 + 5, ...AGENT, resumable: () => null }));
  assert.equal(task(/** @type {any} */ (tg.launched(fresh.graph, "t3", "sa-2", T1 + 6, "sub-agent")), "t3").gate, null);
});

// (fails before: yes — a task merging could not be dropped, nor the graph closed, and a restart left nothing waiting to go back)
test("a task sent back holds nothing in the folder: it may be dropped, the graph closed over it; a restart fails it, said", () => {
  const broke = FR("npm test", 1, 0);
  const back = /** @type {any} */ (tg.gateUndone(merging(), "t3", tg.gateOf({ kind: "undone", runs: [broke], ruled: [], broke, back: { n: 1 } }, T1 + 3), T1 + 3)).graph;
  assert.equal(tg.busy(back), false, "nobody works on it until its worker takes it back");
  const dropped = ok(tg.applyTasks(back, { action: "drop", ids: ["t3", "t4"], reason: "done another way" }, { at: T1 + 4, ...AGENT }));
  assert.deepEqual([task(dropped.graph, "t3").state, task(dropped.graph, "t3").step], ["dropped", null]);
  const closed = ok(tg.applyTasks(back, { action: "close", reason: "enough" }, { at: T1 + 4, ...AGENT }));
  assert.equal(task(closed.graph, "t3").state, "dropped");
  const cut = /** @type {any} */ (tg.restartCut(back, T1 + 5));
  assert.deepEqual(cut.ids, ["t3"]);
  assert.equal(task(cut.graph, "t3").why, "cut by a Filament restart as its change went back to its sub-agent for the folder's check — the merge was undone, and its change waits in its worktree");
});

// ---- the runner -------------------------------------------------------------------------------------------------------

/**
 * A session kept in memory and a registry whose merges answer as the test says (`mergeTask` resolves on `done`, or as
 * cut on its signal's abort), whose resumes and guards are recorded.
 */
function rig() {
  /** @type {Map<string, any>} */
  const chains = new Map([["c1", { id: "c1", meta: {} }]]);
  /** @type {any[]} */
  const told = [];
  /** @type {any[]} */
  const launches = [];
  /** @type {{ id: string, o: any, done: (v: any) => void }[]} */
  const merges = [];
  /** @type {{ id: string, o: any }[]} */
  const resumes = [];
  /** @type {{ chainId: string, commands: string[] }[]} */
  const guards = [];
  /** @type {{ commands: string[], o: any, done: (v: any) => void }[]} */
  const folderChecks = [];
  const state = { t: 2000, n: 0, resume: /** @type {string | null} */ (null) };
  const registry = {
    /** @param {any} spec */
    launch: (spec) => (launches.push(spec), { ok: true, id: `sa-${++state.n}`, done: new Promise(() => {}) }),
    slots: () => 4,
    /** @param {string} chainId @param {any} d */
    tell: (chainId, d) => told.push({ chainId, ...d }),
    stop: () => ({ ok: true }),
    resumable: () => null,
    /** @param {string} id @param {any} o */
    resumeTask: (id, o) => (state.resume ? { ok: false, error: state.resume } : (resumes.push({ id, o }), { ok: true, id, done: new Promise(() => {}) })),
    /** @param {string} id @param {string} chainId @param {any} o */
    mergeTask: (id, chainId, o) =>
      new Promise((done) => {
        merges.push({ id, o, done });
        o.signal?.addEventListener("abort", () => done({ ok: true, files: FILES, repo: "/p", check: { kind: "not", words: "Filament's check of the folder with it was cut before it finished: the merge stands, unchecked." } }), { once: true });
      }),
    /** @param {string} chainId @param {string[]} commands */
    guard: (chainId, commands) => guards.push({ chainId, commands }),
    /** @param {string} chainId @param {string[]} commands @param {any} o */
    checkFolder: (chainId, commands, o) => new Promise((done) => folderChecks.push({ commands, o, done })),
    checkProblem: () => null,
  };
  const archive = {
    /** The meta's named keys, as the archive's `metaOf` reads them. @param {string} id @param {readonly string[]} keys */
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
    openGraphs: () => [...chains.values()].filter((c) => c.meta.graph && !c.meta.graph.closed).map((c) => ({ id: c.id, graph: structuredClone(c.meta.graph) })),
  };
  const runner = createGraphRunner({ archive, registry: /** @type {any} */ (registry), events: { publish: () => {} }, crew: () => "agent", log: () => {}, now: () => state.t++ });
  return { runner, chains, told, launches, merges, resumes, guards, folderChecks, state, graph: () => chains.get("c1").meta.graph };
}
const TURN = { runId: "turn-1", cwd: "/p", mode: null, model: "m", thinking: null, team: null };
/** t3's end as the registry hands it to the runner. */
const ENDED = { ...END, id: "t3", review: false, exchange: 0, toolCalls: 1, roundIds: ["r1"], launchedBy: "turn-1", unread: [] };
/**
 * A rig whose t3 ran and ended, ready, and whose planner applied it (the owner's of 11-02): its merge has begun.
 * @param {(r: ReturnType<typeof rig>) => void} [before]
 */
const merged = async (before) => {
  const r = rig();
  before?.(r);
  r.chains.get("c1").meta.graph = running();
  r.runner.attach("c1", TURN);
  r.runner.ended({ chainId: "c1", task: /** @type {any} */ (ENDED) });
  assert.deepEqual([task(r.graph(), "t3").step, r.merges.length], ["yours", 0], "nothing merges it before its apply");
  assert.deepEqual(r.runner.applyAsked({ chainId: "c1", agentId: "sa-1" }), { ok: true, id: "t3", stands: false });
  await until(() => r.merges.length === 1, "the merge to start");
  return r;
};

// (fails before: yes — the runner applied with the plain apply, and nothing came of a check)
test("the runner merges through the registry's checked merge, waits for its verdict, and tells it — the turn owes it meanwhile", async () => {
  const r = await merged();
  assert.deepEqual([r.merges[0].id, r.merges[0].o.reason], ["sa-1", null]);
  assert.ok(r.runner.owes("c1"), "the turn waits for the merge's verdict");
  r.merges[0].done({ ok: true, files: FILES, repo: "/p", check: { kind: "passed", runs: [FR("npm test", 0)], ruled: [] } });
  await until(() => task(r.graph(), "t3").state === "done", "t3 done");
  assert.equal(task(r.graph(), "t3").gate.kind, "passed");
  assert.match(r.told.at(-1).text, /its change is merged into your folder\. Filament's check of the folder with it passed: `npm test` passed \(exit 0, 6 s\)\./);
});

// (fails before: yes — the same)
test("undone with a return: the planner hears it, the task's worker takes the note in its own conversation; twice, then it fails", async () => {
  const r = await merged();
  const broke = FR("npm test", 1, 0);
  r.merges[0].done({ ok: false, error: "the folder's check failed with it, and the apply was undone", check: { kind: "undone", runs: [broke], ruled: [], broke, back: { n: 1 } } });
  await until(() => r.resumes.length === 1, "its worker to take it back");
  assert.match(r.told.at(-1).text, /^\[Filament: task t3 "Write more tests": its change went into your folder and broke it — /);
  assert.deepEqual([r.resumes[0].id, r.resumes[0].o.requestId], ["sa-1", "turn-1"]);
  assert.equal(r.resumes[0].o.prompt, tg.gateBackText(r.graph(), "t3", "agent"));
  assert.deepEqual([task(r.graph(), "t3").state, task(r.graph(), "t3").step], ["running", null]);
  // Its worker could not take it: the task fails, told.
  const r2 = await merged((x) => (x.state.resume = "sub-agent sa-1 is still working"));
  r2.merges[0].done({ ok: false, error: "undone", check: { kind: "undone", runs: [broke], ruled: [], broke, back: { n: 1 } } });
  await until(() => task(r2.graph(), "t3").state === "failed", "t3 failed");
  assert.match(r2.told.at(-1).text, /failed: its change broke your folder's check, and Filament undid the merge, but the change could not go back to its sub-agent: sub-agent sa-1 is still working\./);
  // Twice already: it fails at once.
  const r3 = await merged();
  r3.merges[0].done({ ok: false, error: "undone", check: { kind: "undone", runs: [broke], ruled: [], broke, back: { twice: true } } });
  await until(() => task(r3.graph(), "t3").state === "failed", "t3 failed");
  assert.equal(r3.resumes.length, 0);
  assert.equal(task(r3.graph(), "t3").failures.cause, "gate");
});

/**
 * t3's worker reports in a chat no turn of Filament's runs in — a coding agent's — its planner applies it, and the
 * folder's check undoes the merge, `back` saying whether it goes back: the `n`th merge of the rig.
 * @param {ReturnType<typeof rig>} r @param {number} n @param {any} back
 */
const undoneAlone = async (r, n, back) => {
  r.runner.ended({ chainId: "c1", task: /** @type {any} */ ({ ...ENDED, exchange: n }) });
  assert.equal(task(r.graph(), "t3").step, "yours");
  assert.deepEqual(r.runner.applyAsked({ chainId: "c1", agentId: "sa-1" }), { ok: true, id: "t3", stands: false });
  await until(() => r.merges.length === n + 1, `merge ${n + 1} to start`);
  const broke = FR("npm run typecheck", 1, 1, true);
  r.merges[n].done({ ok: false, error: "the folder's check failed with it, and the merge was undone", check: { kind: "undone", runs: [broke], ruled: [], broke, back } });
};

// (fails before: yes — with no turn of the planner's running, the step back waited for one for good: the task stayed
// merging, step back, its worker never took the note, and its apply, a mark of it, its start and its done were each
// refused — the bug report of 11-10)
test("a chat no turn of Filament's runs in — a coding agent's: the change its folder's check undid goes back to its worker all the same; twice, then the task fails, its change applied as it stood or marked applied", async () => {
  const r = rig();
  r.chains.get("c1").meta.graph = running();
  await undoneAlone(r, 0, { n: 1 });
  await until(() => r.resumes.length === 1, "its worker to take it back, no turn running");
  assert.deepEqual([task(r.graph(), "t3").state, task(r.graph(), "t3").step], ["running", null]);
  assert.deepEqual([r.resumes[0].id, r.resumes[0].o.requestId], ["sa-1", null], "no turn's spend: none runs");
  assert.equal(r.resumes[0].o.prompt, tg.gateBackText(r.graph(), "t3", "agent"));
  assert.match(r.told.find((d) => /broke it/.test(d.text))?.text || "", /sends the task back to its sub-agent sa-1 with the output \(the first time of two\)/);
  assert.equal(r.runner.markRefusal("c1", "sa-1"), "its worker is still at work on task t3: its change waits for its report");
  await undoneAlone(r, 1, { n: 2 });
  await until(() => r.resumes.length === 2, "its worker to take it back the second time");
  await undoneAlone(r, 2, { twice: true });
  await until(() => task(r.graph(), "t3").state === "failed", "t3 to leave merging");
  assert.deepEqual([task(r.graph(), "t3").failures.cause, r.resumes.length], ["gate", 2]);
  // Its change waits in its copy still: its apply takes it in as it stood, and its mark — the planner brought it in
  // itself — makes it done, the task after it free to start.
  const asked = /** @type {any} */ (tg.applyAsked(r.graph(), "sa-1"));
  assert.deepEqual([asked.ok, task(asked.graph, "t3").state, task(asked.graph, "t3").overruledBy], [true, "merging", "planner"]);
  assert.equal(r.runner.markRefusal("c1", "sa-1"), null);
  r.runner.applied({ chainId: "c1", agentId: "sa-1", files: FILES });
  assert.equal(task(r.graph(), "t3").state, "done");
  assert.match(r.told.at(-1).text, /^\[Filament: task t3 "Write more tests" is done: /);
  assert.deepEqual([task(r.graph(), "t4").state, tg.jobs(r.graph())], ["waiting", []], "t4 is the planner's own, ready");

  // Its worker can't take it — gone, at work, or past its room: the task fails at once, told, its change markable.
  const r2 = rig();
  r2.state.resume = "sub-agent sa-1 is still working";
  r2.chains.get("c1").meta.graph = running();
  await undoneAlone(r2, 0, { n: 1 });
  await until(() => task(r2.graph(), "t3").state === "failed", "t3 to fail");
  assert.match(r2.told.at(-1).text, /failed: its change broke your folder's check, and Filament undid the merge, but the change could not go back to its sub-agent: sub-agent sa-1 is still working\./);
  assert.equal(r2.runner.markRefusal("c1", "sa-1"), null);
});

// (fails before: yes — f5's follow-up of 11-10: no turn of Filament's runs in a coding agent's chat, and its `tasks start`
// of a failed task with a note queued the send-back for a turn that never came)
test("a coding agent sends a failed task back: its sub-agent goes on at once, no turn running — under Filament's own loop it waits for the next turn, as before", () => {
  for (const solo of [true, false]) {
    const r = rig();
    r.chains.get("c1").meta.graph = running();
    r.runner.ended({ chainId: "c1", task: /** @type {any} */ ({ ...ENDED, status: "failed", error: "the model call failed", report: null, files: [], check: null }) });
    assert.equal(task(r.graph(), "t3").state, "failed");
    const a = /** @type {any} */ (r.runner.apply("c1", { action: "start", ids: ["t3"], note: "the parser too" }, { crew: "agent", solo }));
    assert.ok(a.ok, a.error);
    if (solo) {
      assert.deepEqual([r.resumes.length, r.resumes[0]?.id, r.resumes[0]?.o.requestId, task(r.graph(), "t3").state], [1, "sa-1", null, "running"], "its own sub-agent, now, on no turn's spend");
      assert.match(r.resumes[0].o.prompt, /the parser too/);
      assert.match(a.text, /t3/);
    } else assert.deepEqual([r.resumes.length, task(r.graph(), "t3").state], [0, "waiting"], "Filament's own loop: with its next turn");
  }
});

// (fails before: yes, at the registry — a sub-agent whose task was dropped was refused its mark with "apply it, or drop
// the task", its task dropped already: c1's of 11-10, its change brought in by hand)
test("a dropped task's worker: its change is the planner's to mark applied, no graph's word against it", () => {
  const g = ok(tg.applyTasks(running(), { action: "drop", ids: ["t3"], reason: "brought in by hand" }, { at: T1 + 2, ...AGENT })).graph;
  assert.equal(task(g, "t3").state, "dropped");
  assert.equal(tg.markRefusal(g, "sa-1"), null);
});

// (fails before: yes — a stop had no gate to cut)
test("the developer's stop cuts a running gate: the merge stands unchecked, said", async () => {
  const r = await merged();
  // A tasks call of the planner's meanwhile cuts nothing of it.
  ok(r.runner.apply("c1", { action: "show" }, AGENT));
  assert.equal(r.merges[0].o.signal.aborted, false);
  r.runner.stop("c1");
  assert.equal(r.merges[0].o.signal.aborted, true);
  await until(() => task(r.graph(), "t3").state === "done", "t3 done");
  assert.equal(task(r.graph(), "t3").gate.kind, "not");
  assert.match(r.told.at(-1).text, /merged into your folder\. Filament's check of the folder with it was cut before it finished: the merge stands, unchecked\./);
});

// (fails before: yes — a lead's word reached the plain apply, and no check could stand red for it)
test("a lead's merge as it stands passes its reason to the merge", async () => {
  const r = rig();
  // One its check failed: a change that met the folder and did not merge is no merge's as it stands (the Hunter's of
  // 10-28, test/side-run.test.js).
  const g = /** @type {any} */ (tg.taskMergeFailed(merging(), "t3", "its check failed", T1 + 3));
  g.tasks.find((/** @type {any} */ t) => t.id === "t3").failures = { cause: "check", times: 1 };
  r.chains.get("c1").meta.graph = g;
  r.runner.attach("c1", TURN);
  ok(r.runner.apply("c1", { action: "merge", id: "t3", reason: "the flaky timing test" }, { crew: LED }));
  await until(() => r.merges.length === 1, "the merge to start");
  assert.equal(r.merges[0].o.reason, "the flaky timing test");
});

// (fails before: yes — case 7: the planner's own passing check guarded nothing)
test("a task of the planner's own whose check passed adds its commands to the folder's list; a red one adds none", async () => {
  const r = rig();
  ok(r.runner.apply("c1", { action: "add", goal: "g", tasks: [{ id: "t1", name: "Fix the parser", writes: ["src/parse.js"], check: ["npm test", "node --test test/parse.test.js"] }] }, AGENT));
  r.runner.attach("c1", TURN);
  ok(r.runner.apply("c1", { action: "done", id: "t1", summary: "Fixed" }, AGENT));
  const run = (/** @type {number} */ exit) => ({ ran: true, commands: ["npm test"], runs: [{ command: "npm test", exit, ms: 1000, output: "", stopped: false, first: exit ? { exit, ms: 1000 } : null }], bounces: 0, stopped: false });
  r.folderChecks[0].done(run(1));
  await tick();
  assert.deepEqual(r.guards, []);
  ok(r.runner.apply("c1", { action: "done", id: "t1", summary: "Fixed again" }, AGENT));
  r.folderChecks[1].done({ ran: true, commands: ["npm test", "node --test test/parse.test.js"], runs: [run(0).runs[0], { command: "node --test test/parse.test.js", exit: 0, ms: 1000, output: "", stopped: false, first: null }], bounces: 0, stopped: false });
  await tick();
  assert.deepEqual(r.guards, [{ chainId: "c1", commands: ["npm test", "node --test test/parse.test.js"] }]);
});

// ---- the registry: a merge checked, for real ---------------------------------------------------------------------------

/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
const SHARED = "line 1\nline 2\nline 3\n";
const BROKEN_SHARED = "line 1\nline 2 BREAK\nline 3\n";
/** A repository with a shared file committed, and `more` in its folder, uncommitted. @param {Record<string, string>} [more] */
const repo = (more = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-gate-"));
  made.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, "shared.txt"), SHARED);
  writeFileSync(join(dir, "api.txt"), "v1\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  for (const [f, s] of Object.entries(more)) writeFileSync(join(dir, f), s);
  return dir;
};
/** @param {string} root @param {string} f */
const read = (root, f) => {
  try {
    return readFileSync(join(root, f), "utf8");
  } catch {
    return null;
  }
};
const pass = (/** @type {string} */ output) => ({ exit: 0, output, stopped: false });
const fail = (/** @type {string} */ output) => ({ exit: 1, output, stopped: false });
/** The commands, as the test scripts them: each reads the folder it runs in. @type {Record<string, (root: string) => any>} */
const JUDGES = {
  "check a": (root) => (read(root, "a.txt") === "A\n" && !String(read(root, "shared.txt")).includes("BREAK") ? pass("PASS a") : fail("FAIL a: shared.txt line 2 changed")),
  "check b": (root) => (read(root, "b.txt") === "B\n" ? pass("PASS b") : fail("FAIL b")),
  "check own": (root) => (read(root, "own.txt") === "OWN\n" && !String(read(root, "shared.txt")).includes("BREAK") ? pass("PASS own") : fail("FAIL own")),
  "check all": (root) => (read(root, "broken.txt") == null ? pass("all pass") : fail("FAIL broken.txt")),
  // What a check whose tools are in no copy of the folder prints (the owner's of 11-10): node_modules was linked into
  // none, so `npm run typecheck` failed in each, the copy's own path in its words.
  "check env": (root) => (where(root) === "worktree" ? pass("PASS env") : fail(`Error: Cannot find module '${join(root, "node_modules", "typescript", "bin", "tsc")}'\n    at Module._resolveFilename (node:internal/modules/cjs/loader:1225:15)`)),
};
/**
 * A registry over `dir` whose graph workers run as `runs` script them and report done, whose checks run as `JUDGES`
 * reads the folder each runs in — `gates`, by command, hold a run in a folder's check worktree until the test lets it go
 * — and whose graph task ends are kept.
 * @param {string} dir
 */
const registryOver = (dir) => {
  /** @type {any[]} */
  const ends = [];
  /** @type {{ command: string, root: string }[]} */
  const ran = [];
  /** @type {((o: { host: any, body: any }) => any)[]} */
  const runs = [];
  /** @type {any[]} */
  const posts = [];
  /** @type {Map<string, (root: string, signal: AbortSignal) => Promise<any>>} */
  const gates = new Map();
  /** @type {{ subagents: any, loop: { permissions: string, rules: any[], verify: Record<string, any> } }} */
  const doc = { subagents: { pool: [{ model: "", seats: 8 }] }, loop: { permissions: "edit", rules: [], verify: {} } };
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    runCheck: async (/** @type {string} */ command, /** @type {{ root: string, signal: AbortSignal }} */ { root, signal }) => {
      ran.push({ command, root });
      const gate = /-check$/.test(root) ? gates.get(command) : null;
      if (gate) return gate(root, signal);
      const judge = JUDGES[command];
      return judge ? judge(root) : pass("ok");
    },
    context: {
      settings: () => structuredClone(doc),
      session: () => ({ cwd: dir, model: "m-session", projectId: null, client: "harness" }),
      view: async () => null,
      brief: async () => null,
      modelProblem: () => null,
      mark: () => null,
      folderProblem: () => null,
      exchangeEnded: (/** @type {any} */ e) => ends.push(e),
    },
    call: async ({ body, headers = {} }) => {
      const id = String(headers["x-filament-subagent"]);
      const host = registry.hostOf(id);
      posts.push({ body, host });
      const runId = `run-${posts.length}`;
      registry.attach(id, runId);
      const script = runs.shift() || (() => ({}));
      await script({ host, body });
      registry.finish(id, { status: "done", error: null, report: "Reported.", stoppedBy: null, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: "Reported." }] }], rounds: 1, toolCalls: 1, tokensIn: 1, tokensOut: 1, spentUsd: 0.01, roundIds: [runId], taskReport: { status: "done", did: "Did it.", met: true, evidence: "it passed", left: "" } });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: "Reported." }] }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  return { registry, ends, ran, runs, posts, gates, doc };
};
/** A run that writes these files in its worktree. @param {Record<string, string>} files */
const writes = (files) => (/** @type {{ host: any }} */ { host }) => {
  for (const [f, s] of Object.entries(files)) writeFileSync(join(host.workdir, f), s);
};
/**
 * A graph task's worker launched as the runner launches one, its run scripted, waited to its end. @param {ReturnType<typeof registryOver>} r
 * @param {string} dir @param {string} id @param {string[]} check @param {(o: any) => any} run
 */
const worker = async (r, dir, id, check, run) => {
  r.runs.push(run);
  const before = r.ends.length;
  const l = r.registry.launch({ origin: "agent", chainId: "c1", prompt: `THE BRIEF OF ${id}`, description: `${id}: work`, worker: "builder", background: true, cwd: dir, mode: null, parentModel: "m", thinking: null, task: { id, review: false }, requestId: "turn-1", files: { writes: ["*.txt"] }, ...(check.length ? { grants: { check, mayRun: [] } } : {}) });
  assert.equal(l.ok, true, l.ok ? "" : l.error);
  await until(() => r.ends.length > before, `${id}'s end`, { timeoutMs: 60_000 });
  return /** @type {string} */ (l.ok ? l.id : "");
};
/** Where a check ran: the folder's check worktree, the one of the folder before the merge, or a worker's own. @param {string} root */
const where = (root) => (/-check$/.test(root) ? "after" : /-before$/.test(root) ? "before" : "worktree");
/** The folder's runs since the nth run of any check: each command with where it ran. @param {ReturnType<typeof registryOver>} r @param {number} from */
const folderRuns = (r, from) => r.ran.slice(from).filter((c) => where(c.root) !== "worktree").map((c) => [c.command, where(c.root)]);

// (fails before: yes — case 1: the registry had no checked merge)
test("a graph's merge: Filament checks the folder after it, says each command, and the change's own joins the folder's — the next merge runs it too", async () => {
  const dir = repo();
  const r = registryOver(dir);
  const a = await worker(r, dir, "t1", ["check a"], writes({ "a.txt": "A\n" }));
  const n = r.ran.length;
  const m = /** @type {any} */ (await r.registry.mergeTask(a, "c1"));
  assert.equal(m.ok, true, m.error);
  assert.deepEqual([m.files.map((/** @type {any} */ f) => f.path), m.check.kind, m.check.runs.map((/** @type {any} */ x) => [x.command, x.after.exit])], [["a.txt"], "passed", [["check a", 0]]]);
  assert.deepEqual(folderRuns(r, n), [["check a", "after"]]);
  assert.equal(read(dir, "a.txt"), "A\n", "the change is in the folder");
  assert.equal(r.posts.length, 1, "nothing went back");
  const b = await worker(r, dir, "t2", ["check b"], writes({ "b.txt": "B\n" }));
  const n2 = r.ran.length;
  const mb = /** @type {any} */ (await r.registry.mergeTask(b, "c1"));
  assert.equal(mb.check.kind, "passed");
  assert.deepEqual(folderRuns(r, n2), [["check b", "after"], ["check a", "after"]], "its own first, then the folder's, each once");
  // With no command at all, a merge answers as an apply does.
  const dir2 = repo();
  const r2 = registryOver(dir2);
  const c = await worker(r2, dir2, "t3", [], writes({ "c.txt": "C\n" }));
  const mc = /** @type {any} */ (await r2.registry.mergeTask(c, "c1"));
  assert.deepEqual([mc.ok, "check" in mc, mc.files.map((/** @type {any} */ f) => [f.path, f.added, f.removed])], [true, false, [["c.txt", 1, 0]]]);
});

// (fails before: yes — `stands` was read nowhere: the merge's check undid a change its planner asked in as it stood, unless
// the default words came along as a reason)
test("a merge its planner asked in as it stood stands though it breaks the folder's check: red, said, never undone", async () => {
  const dir = repo();
  const r = registryOver(dir);
  const a = await worker(r, dir, "t1", ["check a"], writes({ "a.txt": "A\n" }));
  await r.registry.mergeTask(a, "c1");
  const b = await worker(r, dir, "t2", [], writes({ "b.txt": "B\n", "shared.txt": BROKEN_SHARED }));
  const n = r.ran.length;
  const m = /** @type {any} */ (await r.registry.mergeTask(b, "c1", { stands: true }));
  assert.equal(m.ok, true, m.error);
  assert.deepEqual([m.check.kind, m.check.runs.map((/** @type {any} */ x) => [x.command, x.after.exit])], ["reason", [["check a", 1]]]);
  assert.deepEqual(folderRuns(r, n), [["check a", "after"]], "red, it is not run without the change: it stands either way");
  assert.deepEqual([read(dir, "b.txt"), read(dir, "shared.txt")], ["B\n", BROKEN_SHARED], "the change stays in the folder");
});

// (fails before: yes — case 2: nothing undid a merge)
test("a merge that breaks a command of the folder's is undone: the folder as before, the change waiting rebased, its command joined to the worker's check — and the registry sends nothing itself; twice, then no more", async () => {
  const dir = repo();
  const r = registryOver(dir);
  const a = await worker(r, dir, "t1", ["check a"], writes({ "a.txt": "A\n" }));
  await r.registry.mergeTask(a, "c1");
  const b = await worker(r, dir, "t2", ["check b"], writes({ "b.txt": "B\n", "shared.txt": BROKEN_SHARED }));
  const n = r.ran.length;
  const m = /** @type {any} */ (await r.registry.mergeTask(b, "c1"));
  assert.equal(m.ok, false);
  assert.deepEqual([m.check.kind, m.check.broke.command, m.check.broke.after.exit, m.check.broke.before.exit, m.check.broke.own, m.check.back], ["undone", "check a", 1, 0, false, { n: 1 }]);
  assert.deepEqual(folderRuns(r, n), [["check b", "after"], ["check a", "after"], ["check a", "before"]]);
  assert.deepEqual([read(dir, "b.txt"), read(dir, "shared.txt"), read(dir, "a.txt")], [null, SHARED, "A\n"], "the folder is as it was before the merge");
  assert.equal(r.posts.length, 2, "the registry sent nothing back: the runner does");
  const changes = /** @type {any} */ (await r.registry.changes(b, "c1"));
  assert.deepEqual(changes.files.map((/** @type {any} */ f) => f.path).sort(), ["b.txt", "shared.txt"], "the change waits, rebased onto the folder");
  // The runner sends it back: its worktree holds the folder with its change in it.
  r.runs.push(({ host }) => {
    assert.deepEqual([read(host.workdir, "a.txt"), read(host.workdir, "b.txt"), read(host.workdir, "shared.txt")], ["A\n", "B\n", BROKEN_SHARED]);
  });
  const back = r.registry.resumeTask(b, { chainId: "c1", prompt: "THE NOTE", requestId: "turn-1" });
  assert.equal(back.ok, true);
  await until(() => r.ends.length === 3, "its second end", { timeoutMs: 60_000 });
  assert.equal(r.ends[2].task.check.runs.at(-1).command, "check a", "its next report is held to the command it broke");
  // It did not fix it: its own check is red now, so the merge never comes; the test merges the change as it waits.
  const m2 = /** @type {any} */ (await r.registry.mergeTask(b, "c1"));
  assert.deepEqual([m2.check.kind, m2.check.back], ["undone", { n: 2 }]);
  r.runs.push(() => {});
  r.registry.resumeTask(b, { chainId: "c1", prompt: "THE NOTE AGAIN", requestId: "turn-1" });
  await until(() => r.ends.length === 4, "its third end", { timeoutMs: 60_000 });
  const m3 = /** @type {any} */ (await r.registry.mergeTask(b, "c1"));
  assert.deepEqual([m3.check.kind, m3.check.back], ["undone", { twice: true }]);
  assert.equal(read(dir, "shared.txt"), SHARED);
});

// (fails before: yes — cases 4 and 6: the same)
test("a folder red already keeps the merge and the command leaves the list; afterEdits runs; a rule leaves a command out, said", async () => {
  const dir = repo({ "broken.txt": "x\n" });
  const r = registryOver(dir);
  r.doc.loop.verify = { afterEdits: "check all" };
  const a = await worker(r, dir, "t1", ["check a"], writes({ "a.txt": "A\n" }));
  const n = r.ran.length;
  const m = /** @type {any} */ (await r.registry.mergeTask(a, "c1"));
  assert.deepEqual([m.ok, m.check.kind], [true, "red"]);
  assert.deepEqual(folderRuns(r, n), [["check a", "after"], ["check all", "after"], ["check all", "before"]]);
  assert.equal(read(dir, "a.txt"), "A\n", "it stands");
  r.doc.loop.rules = [{ tool: "bash", pattern: "check a", verdict: "deny" }];
  const b = await worker(r, dir, "t2", ["check b"], writes({ "b.txt": "B\n" }));
  const mb = /** @type {any} */ (await r.registry.mergeTask(b, "c1"));
  assert.match(mb.check.ruled.join(" "), /It did not run `check a`: this session's rule .+ refuses it\./);
  r.doc.loop.rules = [
    { tool: "bash", pattern: "check a", verdict: "deny" },
    { tool: "bash", pattern: "check b", verdict: "deny" },
  ];
  r.doc.loop.verify = {};
  const c = await worker(r, dir, "t3", [], writes({ "c.txt": "C\n" }));
  const mc = /** @type {any} */ (await r.registry.mergeTask(c, "c1"));
  assert.equal(mc.check.kind, "not");
  assert.match(mc.check.words, /^Filament did not check the folder with it: this session's rule .+ refuses `check a`\.$/);
});

// (fails before: yes — case 3: the same)
test("the change's own check red in the folder: undone though it fails before too, where it fails another way there", async () => {
  const dir = repo();
  const r = registryOver(dir);
  const o = await worker(r, dir, "t1", ["check own"], writes({ "own.txt": "OWN\n" }));
  // Its own check passed in its worktree; the developer broke the folder since, and without the change its file is not
  // there either.
  writeFileSync(join(dir, "shared.txt"), BROKEN_SHARED);
  r.gates.set("check own", async () => fail("FAIL own: shared.txt line 2 changed"));
  const m = /** @type {any} */ (await r.registry.mergeTask(o, "c1"));
  assert.deepEqual([m.check.kind, m.check.broke.command, m.check.broke.own, m.check.broke.before.exit], ["undone", "check own", true, 1]);
  assert.equal(read(dir, "own.txt"), null);
});

// (fails before: yes — the owner's of 11-10: a check that failed in every copy of the folder, its node_modules linked into
// none, failed with the change and without it alike; the merge was undone and the task sent back to its sub-agent, twice)
test("the change's own check fails the same way with it and without it: the merge stands, nothing goes back, and the planner hears it is the environment's, with the output and that no dependency folder was linked", async () => {
  const dir = repo();
  const r = registryOver(dir);
  const o = await worker(r, dir, "t1", ["check env"], writes({ "own.txt": "OWN\n" }));
  const n = r.ran.length;
  const m = /** @type {any} */ (await r.registry.mergeTask(o, "c1"));
  assert.equal(m.ok, true, m.error);
  assert.deepEqual([m.check.kind, m.check.runs.map((/** @type {any} */ x) => [x.command, x.after.exit, x.before?.exit, x.own])], ["red", [["check env", 1, 1, true]]]);
  assert.deepEqual(folderRuns(r, n), [["check env", "after"], ["check env", "before"]]);
  assert.equal(read(dir, "own.txt"), "OWN\n", "the change stays in the folder");
  await tick();
  assert.equal(r.posts.length, 1, "nothing went back to its worker");
  assert.match(m.check.runs[0].after.output, /\n\[Filament: no dependency folder is linked into this copy of your folder: neither it nor its repository's main checkout has a node_modules or virtualenv that git ignores\.\]$/, "the check's output says the copy has none");
  // The runner keeps the task done on that verdict, sends nothing back, and tells its planner.
  const rr = await merged();
  rr.merges[0].done({ ok: true, files: FILES, repo: dir, check: m.check });
  await until(() => task(rr.graph(), "t3").state === "done", "t3 done");
  assert.deepEqual([rr.resumes.length, task(rr.graph(), "t3").gate.kind], [0, "red"]);
  const told = String(rr.told.at(-1).text);
  assert.match(told, /its change is merged into your folder\. Filament's check of the folder fails with it, and failed before it too: `check env` failed \(exit 1, \d+ m?s\)\. Your folder was red on it already, so the merge stands\. Its own check `check env` passed in its worktree, and fails the same way with it and without it: the failure is the environment's — your folder's, or what its checks run with, a missing dependency folder say — not the change's, so the task was not sent back\.\nThe end of its output:\nError: Cannot find module '.*tsc'\n/);
  assert.match(told, /\[Filament: no dependency folder is linked into this copy of your folder/);
});

// (fails before: yes — case 7: the same)
test("the folder's list takes a check of the planner's own: the next merge runs it, and one that breaks it is undone", async () => {
  const dir = repo({ "own.txt": "OWN\n" });
  const r = registryOver(dir);
  r.registry.guard("c1", ["check own"]);
  const b = await worker(r, dir, "t2", ["check b"], writes({ "b.txt": "B\n", "shared.txt": BROKEN_SHARED }));
  const m = /** @type {any} */ (await r.registry.mergeTask(b, "c1"));
  assert.deepEqual([m.check.kind, m.check.broke.command], ["undone", "check own"]);
});

// (fails before: yes — case 8: the same)
test("merges into one repository go one at a time: the second applies once the first has its verdict", async () => {
  const dir = repo();
  const r = registryOver(dir);
  const a = await worker(r, dir, "t1", ["check a"], writes({ "a.txt": "A\n" }));
  const b = await worker(r, dir, "t2", ["check b"], writes({ "b.txt": "B\n" }));
  /** @type {() => void} */
  let free = () => {};
  r.gates.set("check a", (root) => new Promise((go) => (free = () => go(JUDGES["check a"](root)))));
  const first = r.registry.mergeTask(a, "c1");
  await until(() => r.ran.some((c) => c.command === "check a" && where(c.root) === "after"), "the first's check to run");
  const second = r.registry.mergeTask(b, "c1");
  // Long enough for a merge that did not wait to snapshot, apply and run its own check here.
  await new Promise((go) => setTimeout(go, 3000));
  assert.equal(read(dir, "b.txt"), null, "the second waits for the first's verdict");
  assert.equal(r.ran.some((c) => c.command === "check b" && where(c.root) === "after"), false, "its check has not run");
  free();
  r.gates.delete("check a");
  assert.equal(/** @type {any} */ (await first).check.kind, "passed");
  assert.equal(/** @type {any} */ (await second).check.kind, "passed");
  assert.equal(read(dir, "b.txt"), "B\n");
});

// (fails before: yes — case 9: the same)
test("a signal's abort cuts a running gate: the merge stands unchecked, in a merge's words", async () => {
  const dir = repo();
  const r = registryOver(dir);
  const a = await worker(r, dir, "t1", ["check a"], writes({ "a.txt": "A\n" }));
  r.gates.set("check a", (root, signal) => new Promise((go) => signal.addEventListener("abort", () => go({ exit: null, output: "", stopped: true }), { once: true })));
  const abort = new AbortController();
  const m = r.registry.mergeTask(a, "c1", { signal: abort.signal });
  await until(() => r.ran.some((c) => c.command === "check a" && where(c.root) === "after"), "its check to run");
  abort.abort();
  const v = /** @type {any} */ (await m);
  assert.deepEqual([v.ok, v.check], [true, { kind: "not", words: "Filament's check of the folder with it was cut before it finished: the merge stands, unchecked." }]);
  assert.equal(read(dir, "a.txt"), "A\n");
});

// (fails before: yes — case 10: the same)
test("a lead's reason after a gate's undo: the merge stands red, for its reason", async () => {
  const dir = repo();
  const r = registryOver(dir);
  const a = await worker(r, dir, "t1", ["check a"], writes({ "a.txt": "A\n" }));
  await r.registry.mergeTask(a, "c1");
  const b = await worker(r, dir, "t2", ["check b"], writes({ "b.txt": "B\n", "shared.txt": BROKEN_SHARED }));
  // Undone twice already, its returns spent: a third red waits for the planner.
  for (let i = 0; i < 2; i++) {
    const m = /** @type {any} */ (await r.registry.mergeTask(b, "c1"));
    assert.equal(m.check.kind, "undone");
    r.runs.push(() => {});
    r.registry.resumeTask(b, { chainId: "c1", prompt: "THE NOTE", requestId: "turn-1" });
    await until(() => r.ends.length === 3 + i, "its end", { timeoutMs: 60_000 });
  }
  assert.deepEqual(/** @type {any} */ (await r.registry.mergeTask(b, "c1")).check.back, { twice: true });
  const m = /** @type {any} */ (await r.registry.mergeTask(b, "c1", { reason: "the shared file's new line is wanted" }));
  assert.deepEqual([m.ok, m.check.kind], [true, "reason"]);
  assert.equal(read(dir, "shared.txt"), BROKEN_SHARED);
});

// (fails before: yes — case 11: the same)
test("a worker that cannot go back — Filament restarted since it ran — is said so in the verdict", async () => {
  const dir = repo({ "a.txt": "A\n" });
  const r = registryOver(dir);
  const b = await worker(r, dir, "t2", ["check b"], writes({ "b.txt": "B\n", "shared.txt": BROKEN_SHARED }));
  // Filament after a restart: the change waits in the repository's refs, its worker gone with the process.
  const again = registryOver(dir);
  again.doc.loop.verify = { afterEdits: "check a" };
  const m = /** @type {any} */ (await again.registry.mergeTask(b, "c1"));
  assert.deepEqual([m.check.kind, m.check.broke.command, m.check.back], ["undone", "check a", { why: "Filament restarted since it ran, and its conversation went with it" }]);
  assert.equal(read(dir, "b.txt"), null);
});

// ---- the page ---------------------------------------------------------------------------------------------------------

// (fails before: yes — case 12: the card said nothing of the folder's check)
test("the card: the Folder row says the newest verdict, and a task sent back by Filament says so on its line", () => {
  const broke = FR("npm test", 1, 0);
  const back = /** @type {any} */ (tg.gateUndone(merging(), "t3", tg.gateOf({ kind: "undone", runs: [broke], ruled: [], broke, back: { n: 1 } }, T1 + 3), T1 + 3)).graph;
  const el = drawGraph(tg.graphView(back), { h: fakeH, now: T1 + 60_000, chosen: "t3" }).el;
  const text = textOf(el);
  assert.match(text, /\|Folder\|undone, sent back \(1 of 2\): `npm test` failed with its change and passed without\|/);
  assert.match(text, /sent back by Filament: the folder's check/);
  const done = /** @type {any} */ (tg.taskMerged(merging(), "t3", FILES, T1 + 3, tg.gateOf({ kind: "passed", runs: [FR("npm test", 0)], ruled: [] }, T1 + 3)));
  assert.match(textOf(drawGraph(tg.graphView(done), { h: fakeH, now: T1 + 60_000, chosen: "t3" }).el), /\|Folder\|passed: `npm test` \(exit 0, 6 s\)/);
});

// (fails before: yes — the card said a change the agent applied as it stood went in "on the lead's word")
test("the card: a failed task's change the agent applied as it stood is on the agent's word, merging and merged — a lead's on the lead's", () => {
  const failed = /** @type {any} */ (tg.taskMergeFailed(merging(), "t3", "its check failed", T1 + 3));
  failed.tasks.find((/** @type {any} */ t) => t.id === "t3").failures = { cause: "check", times: 1 };
  /** @param {any} g */
  const card = (g) => textOf(drawGraph(tg.graphView(g), { h: fakeH, now: T1 + 60_000, chosen: "t3" }).el);
  const asked = /** @type {any} */ (tg.applyAsked(structuredClone(failed), "sa-1", { by: "planner" })).graph;
  assert.match(card(asked), /3-way apply · on the agent's word/);
  const stood = /** @type {any} */ (tg.taskMerged(asked, "t3", FILES, T1 + 4, tg.gateOf({ kind: "reason", runs: [FR("npm test", 1)], ruled: [] }, T1 + 4)));
  assert.match(card(stood), /\|Folder\|red, on the agent's word: `npm test` \(exit 1, 6 s\)/);
  assert.match(card(stood), /\|Merge\|as it stands, on the agent's word$/);
  const lead = /** @type {any} */ (tg.applyAsked(structuredClone(failed), "sa-1", { reason: "the flaky timing test", by: "lead" })).graph;
  assert.match(card(lead), /3-way apply · on the lead's word/);
  const led = /** @type {any} */ (tg.taskMerged(lead, "t3", FILES, T1 + 4, tg.gateOf({ kind: "reason", runs: [FR("npm test", 1)], ruled: [] }, T1 + 4)));
  assert.match(card(led), /\|Folder\|red, on the lead's word: `npm test` \(exit 1, 6 s\)/);
  assert.match(card(led), /\|Merge\|as it stands, on the lead's word: the flaky timing test$/);
});

// (kept — case 13: no prompt or tool changed)
test("the gate changes no prompt: version 33 stayed (34 came with TG2-D63, 35 with V2-3)", () => {
  assert.equal(PROMPT_VERSION, 129);
});
