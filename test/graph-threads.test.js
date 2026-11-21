// @ts-check
// HarnessV4_GraphThreads E28: a task on the graph names the open thread of memory it finishes, and its done closes it —
// the core's field, its checks and its words; the runner's close at each keep; memory's word through the port; the
// tasks tools' field; the Plan tab's tag and line.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as tg from "../src/core/task-graph.js";
import { createGraphRunner, memoryThreads } from "../src/app/agent/graph-runner.js";
import { CODER_TASKS_TOOL, LEAD_TASKS_TOOL, TASKS_TOOL } from "../src/app/agent/tools.js";
import { drawGraph, threadLine } from "../src/ui/harness/views/task-graph.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";
import { world } from "./fixtures/memory-world.mjs";

const T = 1000;
/** @param {any} r */
const ok = (r) => (assert.ok(r.ok, JSON.stringify(r)), r);
/** @param {any} r @param {RegExp} re */
const no = (r, re) => (assert.equal(r.ok, false, JSON.stringify(r)), assert.match(r.error, re));
/** @type {Record<string, { id: string, text: string, own: boolean }>} */
const THREADS = {
  i5: { id: "i5", text: "Check Filament's logs for the cause of the 10-08 crash", own: false },
  i7: { id: "i7", text: "Pick the release date for v2", own: true },
};
/** Memory's word, as the runner hands it: the two threads above; i12 a fact. @type {tg.ThreadOf} */
const threadOf = (id) => THREADS[id] || (id === "i12" ? { error: "i12 is a fact, not an open thread" } : { error: `no memory ${id}` });
/** A tasks call with memory's word. @param {any} graph @param {any} input @param {any} [o] @returns {any} */
const apply = (graph, input, o = {}) => tg.applyTasks(graph, input, { at: T, crew: "agent", threadOf, ...o });
/** @param {any} graph @param {string} id @returns {any} */
const task = (graph, id) => graph.tasks.find((/** @type {any} */ t) => t.id === id);

// (fails before: yes — a task had no thread: `thread` was no field of a task)
test("a task names the open thread it finishes: kept with its words and whose it is, said; a fact, a closed one, a second task on one thread and no memory are refused in words", () => {
  const added = ok(apply(null, { action: "add", goal: "Look into the crash", tasks: [{ id: "t1", name: "Read the logs", thread: "i5" }, { id: "t2", name: "Settle the date", thread: "i7" }, { id: "t3", name: "Write it up", needs: ["t1"] }] }));
  assert.deepEqual(task(added.graph, "t1").thread, { id: "i5", text: THREADS.i5.text, own: false, end: null });
  assert.equal(task(added.graph, "t2").thread.own, true);
  assert.equal("thread" in task(added.graph, "t3"), false, "a task that names none has no field");
  assert.match(added.text, /t1 finishes memory's thread i5: once it is done, Filament closes the thread with its summary\./);
  assert.match(added.text, /t2 finishes memory's thread i7, which is the user's own: once it is done, memory asks them to close it\./);
  const g = added.graph;
  no(apply(g, { action: "add", tasks: [{ id: "t4", name: "Again", thread: "i5" }] }), /t4: memory's thread i5 is t1's already — one task finishes a thread/);
  no(apply(g, { action: "add", tasks: [{ id: "t4", name: "A fact", thread: "i12" }] }), /t4: i12 is a fact, not an open thread/);
  no(apply(g, { action: "add", tasks: [{ id: "t4", name: "A number", thread: 5 }] }), /t4: thread is the id of an open thread of memory, as its line shows it — like i98/);
  no(tg.applyTasks(g, { action: "add", tasks: [{ id: "t4", name: "No memory", thread: "i5" }] }, { at: T, crew: "agent" }), /memory is off for this session, so no thread of it can go on the graph/);
  // A coding agent's tasks take it too.
  ok(apply(null, { action: "add", goal: "Solo", tasks: [{ id: "s1", name: "Its own", thread: "i5" }] }, { solo: true }));
  // change: given to another task once the first lets go of it; "" takes it away.
  no(apply(g, { action: "change", tasks: [{ id: "t3", thread: "i5" }] }), /t3: memory's thread i5 is t1's already/);
  const freed = ok(apply(g, { action: "change", tasks: [{ id: "t1", thread: "" }] })).graph;
  assert.equal("thread" in task(freed, "t1"), false);
  const moved = ok(apply(freed, { action: "change", tasks: [{ id: "t3", thread: "i5" }] }));
  assert.match(moved.text, /^Changed t3\. t3 finishes memory's thread i5: once it is done/);
  // Changing another field keeps the thread, and says nothing of it again.
  const renamed = ok(apply(moved.graph, { action: "change", tasks: [{ id: "t3", name: "Write it up well" }] }));
  assert.equal(task(renamed.graph, "t3").thread.id, "i5");
  assert.doesNotMatch(renamed.text, /finishes memory's thread/);
  // Show: the task's line, and the task whole.
  assert.match(tg.showText(g, "agent"), /- t1 "Read the logs" — .* · finishes memory's thread i5/);
  assert.match(ok(apply(g, { action: "show", id: "t2" })).text, /Memory's thread: i7 "Pick the release date for v2" — the user's own: once the task is done, memory asks them to close it/);
});

// (fails before: yes — nothing named the threads a done task closes)
test("the threads to close: a task that became done — the agent's own, or once its check passed — never a drop; what came of the close is kept once", () => {
  const g = ok(apply(null, { action: "add", goal: "Crash", tasks: [{ id: "t1", name: "Read the logs", thread: "i5" }, { id: "t2", name: "Settle the date", thread: "i7", check: ["npm test"] }, { id: "t3", name: "Unrelated" }] })).graph;
  const s1 = ok(apply(g, { action: "start", ids: ["t1", "t2", "t3"] })).graph;
  const d1 = ok(apply(s1, { action: "done", id: "t1", summary: "The crash was 19 agents on one provider." })).graph;
  assert.deepEqual(tg.threadsToClose(s1, d1), [{ task: "t1", thread: "i5", because: "The crash was 19 agents on one provider." }]);
  assert.deepEqual(tg.threadsToClose(d1, d1), [], "done before: nothing new");
  // A task with a check is checked first: done, and its thread closed, once the check passes.
  const checking = ok(apply(d1, { action: "done", id: "t2", summary: "v2 ships on the 1st." })).graph;
  assert.equal(task(checking, "t2").state, "checking");
  assert.deepEqual(tg.threadsToClose(d1, checking), []);
  const passed = /** @type {any} */ (tg.checked(checking, "t2", { ran: true, commands: ["npm test"], runs: [{ command: "npm test", exit: 0, ms: 10, output: "ok", stopped: false }], bounces: 0, stopped: false }, T + 5)).graph;
  assert.deepEqual(tg.threadsToClose(checking, passed).map((x) => x.task), ["t2"]);
  // A drop leaves the thread open.
  const dropped = ok(apply(g, { action: "drop", ids: ["t1"], reason: "not needed" })).graph;
  assert.deepEqual(tg.threadsToClose(g, dropped), []);
  // What came of the close, kept once.
  const ended = /** @type {any} */ (tg.threadEnded(d1, "t1", "i5", { how: "closed", words: "", at: T + 9 }));
  assert.deepEqual(task(ended, "t1").thread.end, { how: "closed", words: "", at: T + 9 });
  assert.equal(tg.threadEnded(ended, "t1", "i5", { how: "not", words: "x", at: T + 10 }), null, "ended already");
  assert.equal(tg.threadEnded(ended, "t3", "i5", { how: "closed", words: "", at: T + 10 }), null, "t3 names no thread");
  assert.deepEqual(tg.threadsToClose(d1, ended), [], "a close that ended is not made again");
  assert.match(ok(apply(ended, { action: "show", id: "t1" })).text, /Memory's thread: i5 ".*" — closed when the task was done/);
});

/** A session kept in memory and a registry that launches nothing; `threads` as the test gives it. @param {any} threads */
function rig(threads) {
  /** @type {Map<string, any>} */
  const chains = new Map([["c1", { id: "c1", meta: {} }]]);
  /** @type {any[]} */
  const published = [];
  /** @type {string[]} */
  const logged = [];
  const registry = { launch: () => ({ ok: true, id: "sa-1", done: new Promise(() => {}) }), slots: () => 4, tell: () => {}, stop: () => ({ ok: true }), resumable: () => null, checkFolder: () => new Promise(() => {}), checkProblem: () => null, runProblem: () => null, guard: () => {} };
  const archive = {
    /** The meta's named keys, as the archive's `metaOf` reads them. @param {string} id @param {readonly string[]} keys */
    metaOf: (id, keys) => {
      const c = chains.get(id);
      return c ? Object.fromEntries(keys.filter((k) => c.meta?.[k] !== undefined).map((k) => [k, c.meta[k]])) : null;
    },
    /** @param {string} id @param {Record<string, any>} patch */
    mergeMeta: (id, patch) => {
      const c = chains.get(id);
      c.meta = structuredClone({ ...c.meta, ...patch });
      return c.meta;
    },
    openGraphs: () => [],
  };
  let t = 2000;
  const runner = createGraphRunner({ archive, registry: /** @type {any} */ (registry), events: { publish: (topic, e) => published.push({ topic, e }) }, crew: () => "agent", log: (_l, m) => logged.push(m), now: () => t++, threads });
  return { runner, published, logged, graph: () => chains.get("c1").meta.graph };
}
const tick = () => new Promise((r) => setImmediate(r));

// (fails before: yes — the runner closed nothing)
test("the runner: a task's done closes its thread with its summary, kept on the task and drawn; a close that fails says why; a drop closes none; without memory a thread is refused", async () => {
  /** @type {any[]} */
  const closes = [];
  const r = rig({ of: (/** @type {string} */ _c, /** @type {string} */ id) => threadOf(id), close: async (/** @type {string} */ c, /** @type {string} */ id, /** @type {string} */ because) => (closes.push([c, id, because]), id === "i7" ? { how: "asked", words: "q3" } : { how: "closed", words: "" }) });
  // i9 is no thread: the add is refused whole, in memory's words.
  no(r.runner.apply("c1", { action: "add", goal: "Crash", tasks: [{ id: "t1", name: "Read the logs", thread: "i5" }, { id: "t3", name: "Drop me", thread: "i9" }] }, { crew: "agent" }), /t3: no memory i9/);
  assert.equal(r.graph(), undefined);
  ok(r.runner.apply("c1", { action: "add", goal: "Crash", tasks: [{ id: "t1", name: "Read the logs", thread: "i5" }, { id: "t2", name: "Settle", thread: "i7" }] }, { crew: "agent" }));
  ok(r.runner.apply("c1", { action: "start", ids: ["t1", "t2"] }, { crew: "agent" }));
  ok(r.runner.apply("c1", { action: "done", id: "t1", summary: "19 agents on one provider." }, { crew: "agent" }));
  ok(r.runner.apply("c1", { action: "done", id: "t2", summary: "The 1st." }, { crew: "agent" }));
  await tick();
  await tick();
  assert.deepEqual(closes, [["c1", "i5", "19 agents on one provider."], ["c1", "i7", "The 1st."]]);
  assert.deepEqual([task(r.graph(), "t1").thread.end.how, task(r.graph(), "t2").thread.end.how, task(r.graph(), "t2").thread.end.words], ["closed", "asked", "q3"]);
  assert.ok(r.published.some((p) => p.topic === "graph" && p.e.graph.tasks.find((/** @type {any} */ x) => x.id === "t1")?.thread?.end?.how === "closed"), "the page hears it");
  assert.equal(closes.length, 2, "the keep of the end closes nothing again");

  // A close that fails: kept on the task, with why; the thread stays open.
  const f = rig({ of: (/** @type {string} */ _c, /** @type {string} */ id) => threadOf(id), close: async () => { throw new Error("no archive: memory is closed"); } });
  ok(f.runner.apply("c1", { action: "add", goal: "Crash", tasks: [{ id: "t1", name: "Read the logs", thread: "i5" }, { id: "t2", name: "Drop me", thread: "i7" }] }, { crew: "agent" }));
  ok(f.runner.apply("c1", { action: "drop", ids: ["t2"], reason: "not now" }, { crew: "agent" }));
  ok(f.runner.apply("c1", { action: "start", ids: ["t1"] }, { crew: "agent" }));
  ok(f.runner.apply("c1", { action: "done", id: "t1", summary: "Found." }, { crew: "agent" }));
  await tick();
  await tick();
  assert.deepEqual(task(f.graph(), "t1").thread.end && { how: task(f.graph(), "t1").thread.end.how, words: task(f.graph(), "t1").thread.end.words }, { how: "not", words: "no archive: memory is closed" });
  assert.equal(task(f.graph(), "t2").thread.end, null, "a dropped task's thread stays open, unclosed");
  assert.ok(f.logged.some((m) => /t1 done, memory's thread i5 not closed \(no archive: memory is closed\)/.test(m)));

  // No memory: a thread is refused in words.
  const none = rig(null);
  no(none.runner.apply("c1", { action: "add", goal: "Crash", tasks: [{ id: "t1", name: "Read", thread: "i5" }] }, { crew: "agent" }), /memory is off for this session/);
});

// (fails before: yes — memory had no word on a thread a task names)
test("memory's word through the port: a learned thread, the user's own, a fact, a closed one, another project's; the close as the model's, the user's own asked", () =>
  world({}, async (w) => {
    const { prep, sit } = await w.session("a").send("look into the crash");
    const projectId = sit.project.id;
    const learned = (await w.svc.brain.fileLearned({ projectId, chainId: prep.chain, kind: "thread", text: "Check the logs for the crash cause", importance: 0.6 })).id;
    const users = (await w.svc.brain.remember("Open: pick the release date for v2.", { kind: "thread", projectId, by: "person" })).itemId;
    const fact = (await w.svc.brain.remember("The logs live in data/logs.", { kind: "fact", projectId, by: "person" })).itemId;
    const threads = memoryThreads(w.svc);
    assert.deepEqual(threads.of(prep.chain, `i${learned}`), { id: `i${learned}`, text: "Check the logs for the crash cause", own: false });
    assert.equal(/** @type {any} */ (threads.of(prep.chain, `i${users}`)).own, true);
    assert.match(/** @type {any} */ (threads.of(prep.chain, `i${fact}`)).error, new RegExp(`i${fact} is a fact, not an open thread`));
    assert.match(/** @type {any} */ (threads.of(prep.chain, "i999999")).error, /no memory i999999/);
    // Another project's session: the thread is that project's.
    const { prep: away } = await w.session("b", { cwd: "C:\\elsewhere" }).send("something else");
    assert.match(/** @type {any} */ (threads.of(away.chain, `i${learned}`)).error, /is another project's/);
    // The close: retired as done with the summary, in this session; then it is closed already.
    assert.deepEqual(await threads.close(prep.chain, `i${learned}`, "the cause was 19 agents on one provider"), { how: "closed", words: "" });
    const it = w.svc.archive.items.get(learned);
    assert.equal(it.status, "dismissed");
    assert.match(JSON.stringify(w.svc.archive.items.events(learned)), /done: the cause was 19 agents on one provider \(session /);
    assert.match(/** @type {any} */ (threads.of(prep.chain, `i${learned}`)).error, /closed already/);
    assert.deepEqual(await threads.close(prep.chain, `i${learned}`, "again"), { how: "already", words: "" });
    // The user's own is asked about, and stays open.
    const asked = await threads.close(prep.chain, `i${users}`, "settled on the 1st");
    assert.equal(asked.how, "asked");
    assert.equal(w.svc.archive.items.get(users).status === "dismissed", false);
  }));

// (fails before: yes — memoryThreads did not exist)
test("memory off: a thread is refused in words, and a close says why", async () => {
  const off = memoryThreads({ archive: null, scope: () => ({ thread: () => { throw new Error("no archive: memory is off"); }, close: async () => ({ ok: false, error: "no archive: memory is off" }) }) });
  assert.deepEqual(off.of("c1", "i5"), { error: "memory is off for this session, so no thread of it can go on the graph" });
  assert.deepEqual(await off.close("c1", "i5", "x"), { how: "not", words: "no archive: memory is off" });
});

// (fails before: yes — the tools had no thread field)
test("every planner's tasks tool has the thread field", () => {
  for (const tool of [TASKS_TOOL, LEAD_TASKS_TOOL, CODER_TASKS_TOOL]) {
    const p = /** @type {any} */ (tool.input_schema.properties.tasks).items.properties.thread;
    assert.equal(p.type, "string");
    assert.match(p.description, /^The open memory thread this task finishes, by its id \(i98\): once the task is done, Filament closes the thread with the task's summary\./);
  }
});

// (fails before: yes — the Plan tab drew no thread)
test("the Plan tab: the task's tag, and its card's line as the thread stands", () => {
  const g = ok(apply(null, { action: "add", goal: "Crash", tasks: [{ id: "t1", name: "Read the logs", thread: "i5" }, { id: "t2", name: "Settle", thread: "i7" }] })).graph;
  const drawn = textOf(drawGraph(tg.graphView(g), { h: fakeH, now: T + 10, chosen: "t1" }).el);
  assert.match(drawn, /i5/);
  assert.match(drawn, /\|Memory\|i5 · “Check Filament's logs for the cause of the 10-08 crash” — Filament closes it with the task's summary once it is done(\||$)/);
  const w = { planner: "the agent" };
  const t = (/** @type {any} */ end, own = false) => ({ thread: { id: "i5", text: "x", own, end } });
  assert.equal(threadLine(t({ how: "closed", words: "", at: 1 }), /** @type {any} */ (w)), "i5 · “x” — closed when it was done");
  assert.equal(threadLine(t(null, true), /** @type {any} */ (w)), "i5 · “x” — yours: once it is done, memory asks you to close it");
  assert.equal(threadLine(t({ how: "asked", words: "q3", at: 1 }, true), /** @type {any} */ (w)), "i5 · “x” — yours: memory asks you to close it, on the Memory page");
  assert.equal(threadLine(t({ how: "already", words: "", at: 1 }), /** @type {any} */ (w)), "i5 · “x” — it was closed already when the task was done");
  assert.equal(threadLine(t({ how: "not", words: "memory is off", at: 1 }), /** @type {any} */ (w)), "i5 · “x” — not closed: memory is off");
  assert.equal(threadLine(t(null, true), /** @type {any} */ ({ planner: "the lead" })), "i5 · “x” — the developer's own: once it is done, memory asks you to close it");
  assert.equal(threadLine({}, /** @type {any} */ (w)), null);
});
