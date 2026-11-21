// @ts-check
// The owner's plan mode of 11-06: "agents can create initial nodes that are like high level nodes … once the work on
// those tasks starts then agent can create as many sub nodes". A task may be under a step of the planner's own
// (`under`): it starts after the step's needs; the step does no work of its own then — it runs as its sub-tasks begin
// and is done once they all are, in the call that ends the last one or in the runner's keep after a check or a worker
// ends it — and what needs it waits for them all. One level; a step keeps no check and stays the planner's own. The
// graph's words fold a step's done sub-tasks into a line, so a graph of 400 tasks still reads in a page. `find` looks
// through the tasks' own words and what is kept behind them for the lines that hold every word given.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tg from "../src/core/task-graph.js";
import { createTaskNotes } from "../src/services/task-notes.js";
import { createGraphNotes } from "../src/app/agent/graph-notes.js";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";
import { CODER_TASKS_TOOL, LEAD_TASKS_TOOL, TASKS_READS_TOOL, TASKS_TOOL } from "../src/app/agent/tools.js";
import { cardOf } from "../src/core/tool-vocab.js";

const T0 = Date.UTC(2026, 10, 6, 9, 0);
/** @param {any} r @returns {any} */
const ok = (r) => (assert.ok(r.ok, JSON.stringify(r)), r);
/** @param {any} r @returns {string} */
const no = (r) => (assert.equal(r.ok, false, JSON.stringify(r)), r.error);
/** @param {any} g @param {string} id @returns {any} */
const task = (g, id) => g.tasks.find((/** @type {any} */ t) => t.id === id);
/** One tasks call of the agent's, a minute after the last. @param {any} g @param {any} input @param {number} [dt] */
const call = (g, input, dt = 60_000) => tg.applyTasks(g, input, { at: T0 + dt, crew: "agent" });
/** @param {any} g */
const readyOf = (g) => /** @type {any} */ (tg.graphView(g)).tasks.filter((/** @type {any} */ t) => t.ready).map((/** @type {any} */ t) => t.id);

const PLAN = {
  action: "add",
  goal: "Ship plan mode",
  tasks: [
    { id: "map", name: "Map the code" },
    { id: "s1", name: "Sub-tasks in the core", needs: ["map"] },
    { id: "s2", name: "The Plan view", needs: ["s1"] },
    { id: "c1", name: "The under field", under: "s1", writes: ["src/core/task-graph.js"] },
    { id: "c2", name: "The roll-up", under: "s1", needs: ["c1"], writes: ["src/core/task-graph.js"] },
    { id: "c3", name: "The tool words", under: "s1", writes: ["src/app/agent/prompt.js"] },
  ],
};
const planned = () => ok(call(null, PLAN, 0)).graph;
/** The plan with map done, its sub-tasks free to start. */
const mapped = () => ok(call(ok(call(planned(), { action: "start", ids: ["map"] })).graph, { action: "done", id: "map", summary: "Mapped" })).graph;

describe("a step and its sub-tasks", () => {
  // (fails before: yes — under was no field of a task: "c1: under is no field of a task")
  test("added in one call, the sub-tasks wait on their step's needs, the step is never ready itself, and the rule is said once", () => {
    const r = ok(call(null, PLAN, 0));
    assert.match(r.text, /^Added map, s1, s2, c1, c2, c3\. Sub-tasks: c1, c2 and c3 under s1 — each starts after its step's needs, and the step is done once its sub-tasks are: what needs it waits for them all\./);
    assert.deepEqual(readyOf(r.graph), ["map"], "c1 and c3 wait on map, as s1 does");
    assert.deepEqual(task(r.graph, "c1").needs, [], "the step's needs are not copied onto its sub-tasks");
    assert.equal(task(r.graph, "c1").under, "s1");
    const more = ok(call(r.graph, { action: "add", tasks: [{ id: "c4", name: "More words", under: "s1" }] }));
    assert.match(more.text, /^Added c4\. Sub-tasks: c4 under s1\. /, "said once a graph");
    assert.match(no(call(r.graph, { action: "start", ids: ["c1"] })), /^c1 can't start yet: it needs map \(waiting\) done first$/);
    assert.deepEqual(readyOf(mapped()), ["c1", "c3"]);
  });

  // (fails before: yes — no task rolled up from others)
  test("a sub-task begun sets its step under way; the last one done ends the step, and what needs it is ready in the same answer", () => {
    let g = ok(call(mapped(), { action: "start", ids: ["c1", "c3"] })).graph;
    assert.equal(task(g, "s1").state, "running");
    assert.match(tg.showText(g, "agent"), /\n- s1 "Sub-tasks in the core" — under way — 0 of 3 sub-tasks done · needs map\n {2}- c1 "The under field" — running · writes src\/core\/task-graph\.js\n {2}- c2 "The roll-up" — waiting · needs c1 · writes src\/core\/task-graph\.js\n {2}- c3 "The tool words" — running · writes src\/app\/agent\/prompt\.js\n- s2 "The Plan view" — waiting · needs s1\n/);
    g = ok(call(g, { action: "done", id: "c1", summary: "Field in" })).graph;
    g = ok(call(g, { action: "done", id: "c3", summary: "Words in" })).graph;
    assert.match(tg.showText(g, "agent"), /\n- s1 "Sub-tasks in the core" — under way — 2 of 3 sub-tasks done · needs map\n {2}- done: c1, c3\n {2}- c2 "The roll-up" — ready · needs c1 · writes src\/core\/task-graph\.js\n/);
    g = ok(call(g, { action: "start", ids: ["c2"] })).graph;
    const d = ok(call(g, { action: "done", id: "c2", summary: "Rolls up" }));
    // What needs the step is ready in the same answer, named once: it comes next of the agent's own.
    assert.equal(d.text, 'Done: c2. s1 is done with it: every sub-task of it is. Next of yours: s2 "The Plan view" — start it as you take it up. 4 of 5 done.');
    assert.deepEqual([task(d.graph, "s1").state, task(d.graph, "s1").summary], ["done", "Its 3 sub-tasks are done: c1, c2, c3."]);
    assert.deepEqual(readyOf(d.graph), ["s2"]);
  });

  test("a step's work is its sub-tasks: its start, done and pause are refused in words; a done waits on the step's needs too", () => {
    const g = mapped();
    assert.equal(no(call(g, { action: "start", ids: ["s1"] })), "s1 is a step: its work is its sub-tasks — start c1, c2, c3 as their needs allow, and s1 runs as they do");
    assert.equal(no(call(g, { action: "done", id: "s1", summary: "x" })), "s1 is a step whose sub-tasks are still open — c1 (waiting), c2 (waiting), c3 (waiting): it is done once they are. Mark each done, or drop those that go");
    const on = ok(call(g, { action: "start", ids: ["c1"] })).graph;
    assert.equal(no(call(on, { action: "pause", id: "s1", checkpoint: "where it stands" })), "s1 is a step: its work is its sub-tasks — pause the one you are on (c1)");
    assert.match(no(call(planned(), { action: "done", id: "c3", summary: "x" })), /^c3 can't be done yet: it needs map \(waiting\) done first$/);
    // A step of the planner's own with no sub-tasks yet is a task as any: started, then its sub-tasks added as it is reached.
    const solo = ok(call(null, { action: "add", goal: "g", tasks: [{ id: "a", name: "A step" }] }, 0)).graph;
    const begun = ok(call(solo, { action: "start", ids: ["a"] })).graph;
    const grown = ok(call(begun, { action: "add", tasks: [{ id: "a1", name: "First part", under: "a" }, { id: "a2", name: "Second part", under: "a" }] })).graph;
    assert.deepEqual([task(grown, "a").state, readyOf(grown)], ["running", ["a1", "a2"]]);
  });

  test("what a step and a sub-task cannot be, each said in words, and the graph left as it was", () => {
    const g = planned();
    const add = (/** @type {any} */ t) => no(call(g, { action: "add", tasks: [{ id: "x", name: "X", ...t }] }));
    assert.equal(add({ under: "nope" }), "x is under nope, which is no task in the graph — add the step first, or in the same call");
    assert.equal(add({ under: "c1" }), "x is under c1, a sub-task of s1 itself: one level only — put x under s1");
    assert.equal(add({ under: "x" }), "x is under itself — under names the step it is a sub-task of");
    assert.equal(add({ under: "s1", needs: ["s1"] }), "x is under s1, so it needs no s1: a sub-task starts after its step's needs, and s1 is done once its sub-tasks are");
    assert.equal(add({ under: 7 }), 'x: under is a step\'s id — the task of yours it is a sub-task of — or "" to take it out of its step');
    assert.equal(no(call(mapped(), { action: "add", tasks: [{ id: "x", name: "X", under: "map" }] })), "x is under map, which is done — add the work under an open step, or as a task of its own");
    const worker = ok(call(g, { action: "add", tasks: [{ id: "w", name: "W", by: "sub-agent", goal: "g", steps: ["s"], acceptance: "a", writes: ["w.js"], needs: ["map"] }] })).graph;
    assert.equal(no(call(worker, { action: "add", tasks: [{ id: "x", name: "X", under: "w" }] })), "x is under w, which is a sub-agent's task: a step is your own — each sub-task names who does it");
    const checked = ok(call(g, { action: "add", tasks: [{ id: "k", name: "K", check: ["npm test"] }] })).graph;
    assert.equal(no(call(checked, { action: "add", tasks: [{ id: "x", name: "X", under: "k" }] })), "x is under k, which has a check: a step's sub-tasks carry the checks — give k's to the sub-task that proves it (tasks change k with check: [])");
    assert.equal(no(call(g, { action: "change", tasks: [{ id: "s1", needs: ["map", "c1"] }] })), "s1 needs c1, its own sub-task: a step is done once its sub-tasks are — take c1 out of its needs");
    assert.equal(no(call(g, { action: "change", tasks: [{ id: "s1", check: ["npm test"] }] })), "s1 has sub-tasks, so it takes no check of its own: give it to the sub-task that proves it");
    assert.equal(no(call(g, { action: "change", tasks: [{ id: "s1", by: "sub-agent", goal: "g", steps: ["s"], acceptance: "a", writes: ["x.js"] }] })), "s1 has sub-tasks (c1, c2, c3), so it stays your own: each sub-task names who does it");
    assert.equal(no(call(g, { action: "change", tasks: [{ id: "s1", under: "s2" }] })), "s1 has sub-tasks of its own, so it can't be under s2: one level only");
    // A sub-task moved, and taken out of its step.
    const moved = ok(call(g, { action: "change", tasks: [{ id: "c3", under: "s2" }] })).graph;
    assert.deepEqual([task(moved, "c3").under, readyOf(moved)], ["s2", ["map"]]);
    const out = ok(call(g, { action: "change", tasks: [{ id: "c3", under: "" }] })).graph;
    assert.deepEqual([task(out, "c3").under, readyOf(out)], [undefined, ["map", "c3"]]);
  });

  // (fails before: yes — a drop of a task that others are under left them behind)
  test("a step dropped takes its open sub-tasks with it; a sub-task dropped can end its step", () => {
    const g = planned();
    // What needs the step loses that need (11-09, task-graph-rounds.test.js).
    const alone = ok(call(g, { action: "drop", ids: ["s1"], reason: "not now" }));
    assert.match(alone.text, /^Dropped s1, and with it the open sub-tasks c1, c2, c3\. s2 needed s1: that need is cut\. /);
    assert.deepEqual(task(alone.graph, "s2").needs, []);
    const d = ok(call(g, { action: "drop", ids: ["s1", "s2"], reason: "not now" }));
    assert.match(d.text, /^Dropped s1, s2, and with them the open sub-tasks c1, c2, c3\. /);
    assert.deepEqual(d.graph.tasks.map((/** @type {any} */ t) => t.state), ["waiting", "dropped", "dropped", "dropped", "dropped", "dropped"]);
    let h = ok(call(mapped(), { action: "start", ids: ["c1", "c3"] })).graph;
    h = ok(call(h, { action: "done", id: "c1", summary: "in" })).graph;
    h = ok(call(h, { action: "done", id: "c3", summary: "in" })).graph;
    const left = ok(call(h, { action: "drop", ids: ["c2"], reason: "folded into c1" }));
    assert.match(left.text, /^Dropped c2\. s1 is done with it: every sub-task of it is\. /);
    assert.equal(task(left.graph, "s1").summary, "Its 2 sub-tasks are done: c1, c3.");
    assert.match(tg.showText(left.graph, "agent"), /\n {2}- done: c1, c3\n {2}- dropped: c2\n/);
  });

  test("the loops a step makes are refused in words: what needs a step waits on its sub-tasks, and a sub-task on its step's needs", () => {
    const g = ok(call(null, { action: "add", goal: "g", tasks: [{ id: "x", name: "X" }, { id: "s", name: "S" }, { id: "k", name: "K", under: "s", needs: ["x"] }] }, 0)).graph;
    assert.equal(no(call(g, { action: "change", tasks: [{ id: "x", needs: ["s"] }] })), "the needs go round in a loop: x needs s, s ends with its sub-task k, and k needs x — one of these needs must go");
    const h = ok(call(null, { action: "add", goal: "g", tasks: [{ id: "x", name: "X" }, { id: "s", name: "S", needs: ["x"] }, { id: "k", name: "K", under: "s" }] }, 0)).graph;
    assert.equal(no(call(h, { action: "change", tasks: [{ id: "x", needs: ["k"] }] })), "the needs go round in a loop: x needs k, and k waits on x as its step s needs it — one of these needs must go");
  });

  // (g1, the owner's of 11-09: writes are a forecast — the sub-tasks of different steps that could run at once meet where
  // they were refused)
  test("files: sub-tasks of different steps that could run at once meet; a step's own writes claim nothing beside its sub-tasks", () => {
    const g = planned();
    assert.doesNotMatch(ok(call(g, { action: "add", tasks: [{ id: "z", name: "Z", writes: ["src/core/task-graph.js"] }] })).text, /merges three-way/, "the planner's own, done one at a time");
    const sub = ok(call(g, { action: "add", tasks: [{ id: "z", name: "Z", writes: ["src/core/task-graph.js"], by: "sub-agent", goal: "g", steps: ["s"], acceptance: "a" }] }));
    assert.match(sub.text, /\nc1 and z both write src\/core\/task-graph\.js; c2 and z both write src\/core\/task-graph\.js: whichever of each two lands second merges three-way at its apply\./);
    ok(call(g, { action: "add", tasks: [{ id: "z", name: "Z", writes: ["src/core/task-graph.js"], needs: ["s1"] }] }));
    const scoped = ok(call(null, { action: "add", goal: "g", tasks: [{ id: "s", name: "S", writes: ["src/**"] }, { id: "k", name: "K", under: "s", writes: ["src/a.js"] }, { id: "j", name: "J", under: "s", writes: ["src/b.js"] }] }, 0));
    assert.deepEqual(readyOf(scoped.graph), ["k", "j"]);
  });

  test("where you are names the sub-task at work and its step, counts the work by sub-tasks, and a step under way is no work of the planner's own", () => {
    const g = ok(call(mapped(), { action: "start", ids: ["c1"] }, 120_000)).graph;
    const w = /** @type {string} */ (tg.whereText(g, { crew: "agent" }));
    assert.match(w, /: 1 of 5 done\.\n- On it: c1 "The under field" — running, since \d\d:\d\d · part of s1 "Sub-tasks in the core" \(0 of 3 done\)\n- Ready next: c3 "The tool words"\n/);
    assert.ok(!w.includes("On it: s1"), w);
    assert.match(/** @type {string} */ (tg.onTaskText(g)), /^\[Filament: this came while you are on c1 "The under field"\. /);
    assert.equal(tg.turnBegun(g)?.tasks.filter((/** @type {any} */ t) => t.quiet).map((/** @type {any} */ t) => t.id).join(), "c1", "a step's turns are its sub-tasks'");
  });

  test("rollUp moves a step as its sub-tasks stand, and is null where nothing moves", () => {
    let g = ok(call(mapped(), { action: "start", ids: ["c1", "c3"] })).graph;
    g = ok(call(g, { action: "done", id: "c1", summary: "in" })).graph;
    g = ok(call(g, { action: "done", id: "c3", summary: "in" })).graph;
    assert.equal(tg.rollUp(g, T0), null);
    const ended = structuredClone(g);
    Object.assign(task(ended, "c2"), { state: "done", summary: "its worker's", startedAt: T0, endedAt: T0 });
    const r = /** @type {any} */ (tg.rollUp(ended, T0 + 9));
    assert.deepEqual([task(r, "s1").state, task(r, "s1").endedAt, task(ended, "s1").state], ["done", T0 + 9, "running"], "a copy; the graph given stays");
  });
});

describe("a graph of hundreds of tasks", () => {
  test("holds 400 tasks, refuses the 401st in words, and its show folds each step's done sub-tasks into a line", () => {
    /** @type {any[]} */
    const tasks = [];
    for (let s = 1; s <= 20; s++) {
      tasks.push({ id: `s${s}`, name: `Step ${s}` });
      for (let k = 1; k <= 19; k++) tasks.push({ id: `s${s}k${k}`, name: `Part ${k} of step ${s}`, under: `s${s}` });
    }
    assert.equal(tasks.length, tg.MAX_TASKS);
    let g = ok(call(null, { action: "add", goal: "A big plan", tasks }, 0)).graph;
    assert.match(no(call(g, { action: "add", tasks: [{ id: "one", name: "One more" }] })), /^a graph holds at most 400 tasks, and this would make 401/);
    for (let s = 1; s <= 19; s++) {
      const ids = tasks.filter((t) => t.under === `s${s}`).map((t) => t.id);
      g = ok(call(g, { action: "start", ids })).graph;
      for (const id of ids) g = ok(call(g, { action: "done", id, summary: "done" })).graph;
    }
    const show = tg.showText(g, "agent");
    assert.match(show, /\n- s1 "Step 1" — done: Its 19 sub-tasks are done: s1k1, s1k2, s1k3, s1k4, s1k5, s1k6, s1k7, s1k8, s1k9, s1k10 and 9 more\.\n {2}- done: s1k1, s1k2, s1k3, s1k4, s1k5, s1k6, s1k7, s1k8, s1k9, s1k10 and 9 more\n- s2 /);
    assert.ok(show.length < 12_000, `the whole graph in ${show.length} characters`);
    assert.match(show, /\n- s20 "Step 20" — waiting — 0 of 19 sub-tasks done\n {2}- s20k1 /);
    assert.match(/** @type {string} */ (tg.whereText(g, { crew: "agent" })), /: 361 of 380 done\.\n- Ready next: s20k1 "Part 1 of step 20", s20k2 "Part 2 of step 20", s20k3 "Part 3 of step 20", s20k4 "Part 4 of step 20", s20k5 "Part 5 of step 20", and 14 more\n/);
  });
});

describe("find", () => {
  test("the lines of the tasks' own words that hold every word, case aside, in one task or all; none said; the call read as meant", () => {
    const g = planned();
    assert.equal(tg.findText(g, ask(g, "ROLL-UP"), null), '1 line that hold "roll-up":\n- c2 "The roll-up", its name: The roll-up');
    assert.equal(tg.findText(g, ask(g, "the", "c3"), null), '1 line in c3 that hold "the":\n- c3 "The tool words", its name: The tool words');
    assert.equal(tg.findText(g, ask(g, "parser nope"), null), 'No line holds "parser nope": not in the tasks\' own words — and this Filament keeps no notes behind them.');
    assert.equal(tg.findText(g, ask(g, "parser"), { hits: [], more: false }), 'No line holds "parser": not in the tasks\' own words, nor in what is kept behind them.');
    const meant = tg.asMeant({ action: "search", query: "roll", ids: ["c2"] }, { crew: "agent" });
    assert.deepEqual([meant.input, meant.said], [{ action: "find", words: "roll", id: "c2" }, ['"search" as find', "ids of one as id", "query as words"]]);
    assert.match(no(call(g, { action: "find" })), /^find needs words: what to look for — each line found holds every one of them\nThe call: \{"action":"find","words":"retry backoff"\}$/);
    assert.equal(no(call(g, { action: "find", words: "x", title: "Plan" })), "find takes words, and id alone: title is read's");
    assert.deepEqual(cardOf("tasks", { action: "search", query: "roll up", ids: ["c2"] }), { kind: "tasks", title: "Find in the task graph", subject: "“roll up” in c2" }, "its card in the chat");
    assert.equal(no(call(g, { action: "find", words: "x", id: "nope" })), "nope is no task in the graph: keep and read name a task by its id, or none for the graph itself");
  });

  test("what is kept follows the tasks' own lines, each with where a read goes on; past 40, the first 40 and how to narrow it", () => {
    const g = planned();
    const kept = { hits: [{ task: "", kind: /** @type {const} */ ("note"), title: "Plan", line: 3, from: 40, text: "the roll-up rule" }, { task: "c2", kind: /** @type {const} */ ("file"), title: "notes.md", line: 1, from: 0, text: "roll-up: done once all are" }], more: false };
    assert.equal(
      tg.findText(g, ask(g, "roll-up"), kept),
      '3 lines that hold "roll-up":\n- c2 "The roll-up", its name: The roll-up\n- the graph itself, the note "Plan", line 3 (from 40): the roll-up rule\n- c2, the file notes.md, line 1 (from 0): roll-up: done once all are\nRead on from one: tasks read with its task\'s id (none for the graph\'s own), its title and from.',
    );
    const many = { hits: Array.from({ length: 40 }, (_, n) => ({ task: "c1", kind: /** @type {const} */ ("note"), title: "Log", line: n + 1, from: n * 10, text: `roll-up ${n}` })), more: true };
    const t = tg.findText(g, ask(g, "roll-up"), many);
    assert.match(t, /^The first 40 lines that hold "roll-up":\n- c2 "The roll-up", its name: The roll-up\n/);
    assert.match(t, /\nThere are more: give more words, or id to look in one task\.$/);
    assert.equal(t.split("\n").filter((l) => l.startsWith("- ")).length, tg.FIND_HITS);
  });
});

/** A find of the agent's, as the core reads it. @param {any} g @param {string} words @param {string} [id] @returns {any} */
const ask = (g, words, id) => ok(call(g, { action: "find", words, ...(id ? { id } : {}) })).notes;

describe("the runner", () => {
  /** @type {string[]} */
  const made = [];
  after(() => {
    for (const d of made) rmSync(d, { recursive: true, force: true });
  });
  const rig = () => {
    /** @type {Map<string, any>} */
    const chains = new Map([["c1", { id: "c1", meta: {} }]]);
    /** @type {{ commands: string[], done: (v: any) => void }[]} */
    const checks = [];
    const registry = {
      launch: () => ({ ok: false, error: "no launches here" }),
      slots: () => 4,
      tell: () => {},
      stop: () => ({ ok: true }),
      resumable: () => null,
      /** @param {string} chainId @param {string[]} commands */
      checkFolder: (chainId, commands) => new Promise((done) => checks.push({ commands, done })),
      checkProblem: () => null,
      guard: () => {},
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
    };
    const dir = mkdtempSync(join(tmpdir(), "filament-steps-"));
    made.push(dir);
    let t = T0;
    const runner = createGraphRunner({ archive, registry: /** @type {any} */ (registry), events: { publish: () => {} }, crew: () => "agent", log: () => {}, now: () => t++, notes: createGraphNotes({ notes: createTaskNotes({ dir }) }) });
    return { runner, checks, graph: () => chains.get("c1").meta.graph };
  };
  const AGENT = { crew: /** @type {const} */ ("agent") };

  // (fails before: yes — a step stayed open while its last sub-task's check passed)
  test("a sub-task's check that passes ends its step in the runner's keep, and what needs the step is ready", async () => {
    const r = rig();
    ok(r.runner.apply("c1", { action: "add", goal: "g", tasks: [{ id: "s", name: "S" }, { id: "k1", name: "K1", under: "s", check: ["npm test"] }, { id: "k2", name: "K2", under: "s" }, { id: "after", name: "After", needs: ["s"] }] }, AGENT));
    ok(r.runner.apply("c1", { action: "start", ids: ["k1", "k2"] }, AGENT));
    ok(r.runner.apply("c1", { action: "done", id: "k2", summary: "in" }, AGENT));
    assert.match(ok(r.runner.apply("c1", { action: "done", id: "k1", summary: "in" }, AGENT)).text, /^Checking k1: /);
    assert.equal(task(r.graph(), "s").state, "running");
    r.checks[0].done({ ran: true, commands: ["npm test"], runs: [{ command: "npm test", exit: 0, ms: 9, output: "ok", stopped: false }], bounces: 0, stopped: false });
    await new Promise((d) => setImmediate(d));
    assert.deepEqual([task(r.graph(), "k1").state, task(r.graph(), "s").state], ["done", "done"]);
    assert.deepEqual(readyOf(r.graph()), ["after"]);
  });

  test("find reads what is kept behind the graph and its tasks: each line, its number and where a read goes on from it", () => {
    const r = rig();
    ok(r.runner.apply("c1", PLAN, AGENT));
    ok(r.runner.apply("c1", { action: "keep", title: "Plan", text: "# Plan\n\nA. the under field\nB. the roll-up rule: a step ends with its last sub-task\nC. find" }, AGENT));
    ok(r.runner.apply("c1", { action: "keep", id: "c2", title: "Notes", text: "nothing here\nRoll-up in keep, too" }, AGENT));
    const f = ok(r.runner.apply("c1", { action: "find", words: "roll-up" }, AGENT));
    assert.equal(f.text, '3 lines that hold "roll-up":\n- c2 "The roll-up", its name: The roll-up\n- the graph itself, the note "Plan", line 4 (from 27): B. the roll-up rule: a step ends with its last sub-task\n- c2, the note "Notes", line 2 (from 13): Roll-up in keep, too\nRead on from one: tasks read with its task\'s id (none for the graph\'s own), its title and from.');
    assert.equal(f.changed, false);
    const read = ok(r.runner.apply("c1", { action: "read", title: "Plan", from: 27 }, AGENT));
    assert.match(read.text, /:\n\nB\. the roll-up rule/);
    assert.match(ok(r.runner.apply("c1", { action: "grep", query: "keep", id: "c2" }, AGENT)).text, /^1 line in c2 that hold "keep":\n- c2, the note "Notes", line 2 \(from 13\): Roll-up in keep, too\n/);
  });
});

describe("the review of 1d7591aa8", () => {
  // (fails before: yes — the runner held such an end while another worker worked: nothing needs a sub-task itself)
  test("an end that may finish a step is waited on: what needs the step waits on each of its sub-tasks", () => {
    assert.equal(tg.waitedOn(planned(), "c3"), true, "s2 needs s1");
    const alone = ok(call(null, { action: "add", goal: "g", tasks: [{ id: "s", name: "S" }, { id: "k", name: "K", under: "s" }, { id: "x", name: "X" }, { id: "y", name: "Y", needs: ["x"] }] }, 0)).graph;
    assert.deepEqual(["k", "x", "y"].map((id) => tg.waitedOn(alone, id)), [false, true, false], "nothing needs s");
  });

  // (fails before: yes — t3, running, went under s2 while s1 waited, and its done made s2 done: what needs s2 was ready)
  test("a task begun goes under a step only once the step's needs are done", () => {
    let g = ok(call(null, { action: "add", goal: "g", tasks: [{ id: "s1", name: "S1" }, { id: "s2", name: "S2", needs: ["s1"] }, { id: "t3", name: "T3" }] }, 0)).graph;
    g = ok(call(g, { action: "start", ids: ["t3"] })).graph;
    assert.equal(no(call(g, { action: "change", tasks: [{ id: "t3", under: "s2" }] })), "t3 is running, and s2 still needs s1 done: a task begun goes under a step only once the step's needs are done — keep it a task of its own");
    const moved = ok(call(g, { action: "change", tasks: [{ id: "t3", under: "s1" }] })).graph;
    assert.equal(task(moved, "s1").state, "running", "s1 needs nothing: t3 begun runs it");
  });

  // (fails before: yes — p2 was dropped with the checklist's item, and k1 stayed open under a dropped step)
  test("a checklist step whose sub-task is open stays when its item leaves the checklist", () => {
    let g = /** @type {any} */ (tg.applyPlan(null, [{ text: "Plan it", status: "pending" }, { text: "Build it", status: "pending" }], { at: T0, crew: "agent" })).graph;
    const p2 = g.tasks[1].id;
    g = ok(call(g, { action: "add", tasks: [{ id: "k1", name: "Part of it", under: p2 }] })).graph;
    const r = /** @type {any} */ (tg.applyPlan(g, [{ text: "Plan it", status: "pending" }], { at: T0 + 120_000, crew: "agent" }));
    assert.equal(task(r.graph, p2).state, "waiting");
    assert.match(r.text, new RegExp(`${p2} left your checklist, but k1 is a sub-task of it: it stays\\.`));
  });

  // (fails before: yes — the drop went, and c4's check, had it failed, opened it again under a dropped step)
  test("a step whose sub-task is being checked is not dropped: the drop waits for the verdict", () => {
    let g = ok(call(mapped(), { action: "add", tasks: [{ id: "c4", name: "Checked", under: "s1", check: ["npm test"] }] })).graph;
    g = ok(call(g, { action: "start", ids: ["c4"] })).graph;
    g = ok(call(g, { action: "done", id: "c4", summary: "in" })).graph;
    assert.equal(task(g, "c4").state, "checking");
    assert.match(no(call(g, { action: "drop", ids: ["s1", "s2"], reason: "later" })), /c4 is being checked now — wait for its verdict/);
  });

  // (fails before: yes — the helper took s1, which ran while its sub-tasks waited)
  test("a coding agent's helper takes a sub-task, never its step", () => {
    assert.equal(tg.helperRefusal(mapped(), "s1"), "s1 is a step with sub-tasks (c1, c2, c3), which do its work — task names the one the helper takes");
    assert.equal(tg.helperRefusal(mapped(), "c1"), null);
  });

  // (fails before: yes — "Dropped c1, c2, c3." and nothing more: s1, under way, read as the agent's own work from then on)
  test("a step left with no sub-task says it is the planner's own task again", () => {
    const g = ok(call(mapped(), { action: "start", ids: ["c1"] })).graph;
    assert.equal(task(g, "s1").state, "running");
    assert.match(ok(call(g, { action: "drop", ids: ["c1", "c2", "c3"], reason: "another way" })).text, /^Dropped c1, c2, c3\. s1 has no sub-task left, so it is your own task again: do it, put sub-tasks under it, or drop it\. /);
    const out = ok(call(mapped(), { action: "change", tasks: [{ id: "c1", under: "" }, { id: "c2", under: "" }, { id: "c3", under: "" }] }));
    assert.match(out.text, / s1 has no sub-task left, so it is your own task again: do it, put sub-tasks under it, or drop it\./);
    assert.doesNotMatch(ok(call(mapped(), { action: "drop", ids: ["c2"], reason: "no" })).text, /no sub-task left/);
  });

  // (fails before: yes — "s1 writes files and says no done-when", and a line of steps was told to be a checklist)
  test("a plan's steps are neither nudged to a done-when nor told the checklist keeps them", () => {
    const r = ok(call(null, { action: "add", goal: "g", tasks: [
      { id: "a", name: "A", writes: ["x.js"] }, { id: "b", name: "B", needs: ["a"] }, { id: "c", name: "C", needs: ["b"] },
      { id: "k", name: "K", under: "a", writes: ["x.js"], acceptance: "it works" },
    ] }, 0));
    assert.doesNotMatch(r.text, /no done-when/);
    assert.match(r.text, /a → b → c is one straight line\. Give a task only the needs it truly waits on: tasks that don't wait on each other can then run side by side\.$/);
  });

  // (fails before: yes — the error said "null")
  test("a side run of a step says why it can't: its sub-tasks do its work", () => {
    const r = /** @type {any} */ (tg.sideRun(mapped(), [{ id: "s1", model: "GLM 5.3", folder: "copy" }], { at: T0, crew: "agent", starts: "now" }));
    assert.deepEqual(r, { ok: false, error: "s1 is a step with sub-tasks (c1, c2, c3), which do its work — run one of them" });
  });

  // (fails before: yes — the end of the last said nothing of its step)
  test("the end of a step's last sub-task says the step is done with it", () => {
    let g = ok(call(mapped(), { action: "add", tasks: [{ id: "c4", name: "Checked", under: "s1", check: ["npm test"] }] })).graph;
    for (const id of ["c1", "c3", "c2"]) g = ok(call(ok(call(g, { action: "start", ids: [id] })).graph, { action: "done", id, summary: id })).graph;
    g = ok(call(ok(call(g, { action: "start", ids: ["c4"] })).graph, { action: "done", id: "c4", summary: "in" })).graph;
    const ran = { ran: true, commands: ["npm test"], runs: [{ command: "npm test", exit: 0, ms: 9, output: "ok", stopped: false }], bounces: 0, stopped: false };
    const after = /** @type {any} */ (tg.checked(g, "c4", /** @type {any} */ (ran), T0 + 600_000)).graph;
    const passed = tg.rollUp(after, T0 + 600_000) || after;
    assert.equal(task(passed, "s1").state, "done");
    assert.match(tg.endText(passed, "c4", { crew: "agent" }), /It is done\. s1 is done with it: every sub-task of it is\.\nNow: /);
  });
});

describe("the review of 7d8059000", () => {
  /** The plan with c1 and c3 done, c2 left. */
  const twoDone = () => {
    let g = mapped();
    for (const id of ["c1", "c3"]) g = ok(call(g, { action: "start", ids: [id] })).graph;
    for (const id of ["c1", "c3"]) g = ok(call(g, { action: "done", id, summary: id })).graph;
    return g;
  };

  // (fails before: yes — "task c2 ... is done: Filament ran it, and it passed" and nothing of s1)
  test("a command sub-task's end says its step is done with it", () => {
    let g = ok(call(twoDone(), { action: "change", tasks: [{ id: "c2", by: "command", run: ["npm test"] }] })).graph;
    g = /** @type {any} */ (tg.commandStarted(g, "c2", T0 + 300_000, 1));
    const ended = /** @type {any} */ (tg.commandEnded(g, "c2", { ran: true, runs: [{ item: null, command: "npm test", invert: false, exit: 0, ms: 900, passed: true, output: "", stopped: false }], of: 1, lanes: 1, ms: 900, cut: null }, T0 + 360_000));
    const after = tg.rollUp(ended.graph, T0 + 360_000) || ended.graph;
    assert.equal(task(after, "s1").state, "done");
    assert.match(tg.endText(after, "c2", { crew: "agent" }), /^\[Filament: task c2 "The roll-up" is done: Filament ran it, and it passed: `npm test` \(1 s\)\. s1 is done with it: every sub-task of it is\.\nNow: /);
  });

  // (fails before: yes — both ends said "s1 is done with it")
  test("of sub-tasks that ended at once, as a restart ends the checks it cut, only the last in order says its step is done", () => {
    let g = twoDone();
    g = ok(call(g, { action: "start", ids: ["c2"] })).graph;
    g = ok(call(g, { action: "done", id: "c2", summary: "c2" })).graph;
    const same = structuredClone(g);
    for (const id of ["c1", "c2", "c3"]) task(same, id).endedAt = T0 + 900_000;
    const said = ["c1", "c2", "c3"].map((id) => /s1 is done with it/.test(tg.endText(same, id, { crew: "agent" })));
    assert.deepEqual(said, [false, false, true], "c3 is the last of them in the graph's order");
  });

  // (fails before: yes — the ready sub-task's words said nothing of s2, which waits for the apply too)
  test("a ready sub-task's words name what needs its step, which waits for its apply too", () => {
    const g = structuredClone(twoDone());
    Object.assign(task(g, "c2"), { by: "sub-agent", state: "merging", step: "yours", agent: "sa-1", ranAs: null, goal: "g", steps: ["s"] });
    assert.match(tg.endText(g, "c2", { crew: "agent" }), / s2 needs its step s1, which waits for its apply too\. To have its /);
  });

  // (fails before: yes — the checklist dropped k1, s1's last open sub-task, and said nothing of s1)
  test("a checklist that drops a step's last open sub-task says the step is its planner's own again", () => {
    let g = /** @type {any} */ (tg.applyPlan(null, [{ text: "Plan it", status: "pending" }, { text: "Part of it", status: "pending" }], { at: T0, crew: "agent" })).graph;
    const [p1, p2] = g.tasks.map((/** @type {any} */ t) => t.id);
    g = ok(call(g, { action: "change", tasks: [{ id: p2, under: p1 }] })).graph;
    const r = /** @type {any} */ (tg.applyPlan(g, [{ text: "Plan it", status: "pending" }], { at: T0 + 120_000, crew: "agent" }));
    assert.equal(task(r.graph, p2).state, "dropped");
    assert.match(r.text, new RegExp(`${p1} has no sub-task left, so it is your own task again: do it, put sub-tasks under it, or drop it\\.`));
  });

  // (fails before: yes — the item ticked as doing started p1 itself, a step whose sub-tasks waited)
  test("a step's item ticked as doing starts no step: it runs as its sub-tasks begin", () => {
    let g = /** @type {any} */ (tg.applyPlan(null, [{ text: "Plan it", status: "pending" }, { text: "Part of it", status: "pending" }], { at: T0, crew: "agent" })).graph;
    const [p1, p2] = g.tasks.map((/** @type {any} */ t) => t.id);
    g = ok(call(g, { action: "change", tasks: [{ id: p2, under: p1 }] })).graph;
    const r = /** @type {any} */ (tg.applyPlan(g, [{ text: "Plan it", status: "doing" }, { text: "Part of it", status: "pending" }], { at: T0 + 120_000, crew: "agent" }));
    assert.equal(task(r.graph, p1).state, "waiting");
    assert.match(r.text, new RegExp(`${p1} is a step: its work is its sub-tasks \\(${p2}\\), and it runs as they begin, not by its item\\.`));
  });

  // (fails before: yes — c9 went under t1, which ran on sa-7, and t1 was done once c9 was, whatever sa-7 still did)
  test("a task a coding agent's helper works on takes no sub-tasks", () => {
    let g = ok(call(null, { action: "add", goal: "g", tasks: [{ id: "t1", name: "T1" }] }, 0)).graph;
    g = /** @type {any} */ (tg.helperTook(g, "t1", { agent: "sa-7", model: "GLM 5.3", copy: true, at: T0 }));
    assert.equal(task(g, "t1").state, "running");
    assert.equal(no(call(g, { action: "add", tasks: [{ id: "c9", name: "C9", under: "t1" }] })), "c9 is under t1, which is under way with sa-7, the sub-agent you launched for it: a step's work is its sub-tasks — add c9 as a task of its own");
  });
});

describe("the tool", () => {
  // (fails before: yes — the coding agent's text ran to 2,281 characters, and Claude Code cuts a tool's at 2,048: its
  // read's end and what is refused were lost)
  test("every planner but a lead puts a task under a step; every one finds; a coding agent's text stays under Claude Code's 2,048", () => {
    for (const tool of [TASKS_TOOL, TASKS_READS_TOOL, CODER_TASKS_TOOL]) {
      const p = /** @type {any} */ (tool.input_schema.properties);
      assert.ok(p.tasks.items.properties.under, tool.description.slice(0, 40));
      assert.ok(p.action.enum.includes("find") && p.words);
      assert.match(tool.description, /under/);
      // A coding agent's actions are said at its action field (the owner's tool plan of 11-08).
      assert.match(tool === CODER_TASKS_TOOL ? p.action.description : tool.description, tool === CODER_TASKS_TOOL ? /find: the lines of the tasks and of what is kept behind them that hold every word\./ : /find: words, and id to look in one task/);
    }
    const lead = /** @type {any} */ (LEAD_TASKS_TOOL.input_schema.properties);
    assert.deepEqual([!!lead.tasks.items.properties.under, lead.action.enum.includes("find")], [false, true]);
    assert.ok(CODER_TASKS_TOOL.description.length < 2048, `${CODER_TASKS_TOOL.description.length} characters`);
    // Its refusals left the tool's text for the session's graph section (the owner's tool plan of 11-08): its end is whole.
    assert.match(CODER_TASKS_TOOL.description, /Steps you take yourself one after another go on checklist instead\.$/);
    assert.doesNotMatch(CODER_TASKS_TOOL.description, /Refused in words/);
  });
});
