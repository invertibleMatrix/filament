// @ts-check
// HarnessV4_TaskGraphEasy_Plan (E40): the task graph made easy for a weaker model, none of its power taken. TG1: a
// call's common slips read the one way they can be read (`asMeant`, core/task-graph.js), what was read loosely said
// after the answer, through the runner (app/agent/graph-runner.js) as an agent's call goes. TG2: a refusal of a call's
// shape ends with that action's call to copy — and every call it offers is one the graph takes. TG3: a tasks call in
// the chat is a row of its own — what it did and to which tasks (core/tool-vocab.js's card), the tasks it named,
// Filament's answer — never folded into a work row with an MCP server's calls.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";
import { ACTION_WORDS, TASK_ACTIONS, TASK_CALLS, applyTasks, asMeant, callFor, meantWords } from "../src/core/task-graph.js";
import { cardOf } from "../src/core/tool-vocab.js";
import { MEMBERS } from "./helpers/roster.js";
import { argSummary } from "../src/app/agent/tools.js";
import { archivedRows, groupRuns } from "../src/ui/harness/conversation/tools/render.js";
import { stubDocument } from "./helpers/dom-stub.js";

const AGENT = /** @type {const} */ ({ crew: "agent" });
/** The call as it was meant, and what was read loosely. @param {any} input @param {any} [o] */
const meant = (input, o = AGENT) => /** @type {{ input: any, said: string[] }} */ (asMeant(input, o));
/** @param {{ ok: boolean }} r @returns {any} */
const ok = (r) => (assert.ok(r.ok, JSON.stringify(r)), r);
/** @param {any} r @returns {string} */
const no = (r) => (assert.ok(!r.ok, JSON.stringify(r)), r.error);

describe("a call as it was meant (TG1)", () => {
  // (fails before: yes — there was no asMeant: "Add", "complete", tasks as text were each refused)
  test("an action in another case, spaced, or said another way is the action; one this planner has not stays as it came", () => {
    assert.deepEqual(meant({ action: "Add" }), { input: { action: "add" }, said: [] }, "a case is no slip worth a word");
    assert.deepEqual(meant({ action: " done " }).input.action, "done");
    assert.deepEqual(meant({ action: "complete" }), { input: { action: "done" }, said: ['"complete" as done'] });
    for (const [word, action] of Object.entries(ACTION_WORDS)) assert.equal(meant({ action: word }).input.action, action, word);
    assert.deepEqual(meant({ action: "merge" }), { input: { action: "merge" }, said: [] }, "the agent has no merge: its refusal says which actions there are");
    assert.equal(meant({ action: "Merge" }, { crew: "lead" }).input.action, "Merge", "a lead's own words read only as its own list holds them");
    assert.equal(meant({ action: "frob" }).input.action, "frob");
  });

  // (fails before: yes — tasks as text, one task alone, ids as text were refused)
  test("tasks as JSON text or one task alone are the list; ids as text, an id list, task_id are what they name", () => {
    const list = [{ id: "t1", name: "Find it" }];
    assert.deepEqual(meant({ action: "add", tasks: JSON.stringify(list) }), { input: { action: "add", tasks: list }, said: ["tasks was text, read as its list"] });
    assert.deepEqual(meant({ action: "add", tasks: JSON.stringify(list[0]) }).input.tasks, list, "JSON text of one task");
    assert.deepEqual(meant({ action: "add", tasks: list[0] }), { input: { action: "add", tasks: list }, said: ["one task as a list of one"] });
    assert.deepEqual(meant({ action: "add", tasks: "find it, then fix it" }), { input: { action: "add", tasks: "find it, then fix it" }, said: [] }, "text that holds no list: add says what it takes");
    assert.deepEqual(meant({ action: "start", ids: "t1, t2 t3" }), { input: { action: "start", ids: ["t1", "t2", "t3"] }, said: ["ids as a list"] });
    assert.deepEqual(meant({ action: "drop", id: ["t1", "t2"], reason: "r" }), { input: { action: "drop", ids: ["t1", "t2"], reason: "r" }, said: ["id as ids"] });
    assert.deepEqual(meant({ action: "done", task_id: "t1", summary: "s" }), { input: { action: "done", id: "t1", summary: "s" }, said: ["task_id as id"] });
    assert.deepEqual(meant({ action: "show", taskId: "t1" }).input, { action: "show", id: "t1" });
    assert.deepEqual(meant({ action: "done", ids: ["t1"], summary: "s" }), { input: { action: "done", id: "t1", summary: "s" }, said: ["ids of one as id"] });
    assert.deepEqual(meant({ action: "done", ids: ["t1", "t2"], summary: "s" }).input.ids, ["t1", "t2"], "two can't be one: done says it takes one at a time");
    assert.deepEqual(meant({ action: "done", id: "t1", task_id: "t2", summary: "s" }).input, { action: "done", id: "t1", task_id: "t2", summary: "s" }, "an id given beside it stands");
  });

  // (fails before: yes — a task's needs as text, its title, its depends_on were refused)
  test("a task's lists said as one string are lists, its name as title and its needs by another word are the fields — where it gives no field itself", () => {
    const { input, said } = meant({ action: "add", tasks: [{ id: "t2", title: "Fix it", deps: "t1, t0", writes: "src/a.js", check: "npm test", steps: "Fix it" }] });
    assert.deepEqual(input.tasks, [{ id: "t2", name: "Fix it", needs: ["t1", "t0"], writes: ["src/a.js"], check: ["npm test"], steps: ["Fix it"] }]);
    assert.deepEqual(said, ["t2's title as its name", "t2's deps as its needs", "t2's needs as a list", "t2's writes as a list", "t2's check as a list", "t2's steps as a list"]);
    for (const k of ["depends_on", "dependencies", "after", "blocked_by"]) assert.deepEqual(meant({ action: "add", tasks: [{ id: "t2", name: "N", [k]: ["t1"] }] }).input.tasks[0].needs, ["t1"], k);
    // Both given: it could mean two things, so it stays as it came, for the action to refuse in words (TG-D1).
    assert.deepEqual(meant({ action: "add", tasks: [{ id: "t2", name: "Fix it", title: "Fix the router" }] }), { input: { action: "add", tasks: [{ id: "t2", name: "Fix it", title: "Fix the router" }] }, said: [] });
    assert.deepEqual(meant({ action: "change", tasks: [{ name: "No id" }] }).said, [], "nothing loose to say");
    assert.deepEqual(meant({ action: "change", tasks: [{ title: "No id" }] }).said, ["a task's title as its name"]);
  });

  // (fails before: yes — a done with result, a drop with summary, keep's file as text were refused)
  test("done's summary, drop's and close's reason, keep's files under another word are the field", () => {
    assert.deepEqual(meant({ action: "done", id: "t1", result: "Found it." }), { input: { action: "done", id: "t1", summary: "Found it." }, said: ["result as summary"] });
    assert.deepEqual(meant({ action: "done", id: "t1", text: "Found it." }).input.summary, "Found it.");
    assert.deepEqual(meant({ action: "done", id: "t1", summary: "S", result: "R" }).input, { action: "done", id: "t1", summary: "S", result: "R" }, "a summary given stands");
    assert.deepEqual(meant({ action: "drop", ids: ["t3"], summary: "not needed" }), { input: { action: "drop", ids: ["t3"], reason: "not needed" }, said: ["summary as reason"] });
    assert.deepEqual(meant({ action: "close", summary: "Shipped." }).input, { action: "close", reason: "Shipped." });
    assert.deepEqual(meant({ action: "keep", id: "t1", files: "src/a.js", forget: "Old" }), { input: { action: "keep", id: "t1", files: ["src/a.js"], forget: ["Old"] }, said: ["files as a list", "forget as a list"] });
    assert.deepEqual(meant({ action: "show", result: "x" }).input, { action: "show", result: "x" }, "each word only where its action reads it");
  });

  test("what is no call stays as it came; the line says each loose reading, or nothing", () => {
    for (const x of [null, "add", ["add"], 5]) assert.deepEqual(meant(x), { input: x, said: [] });
    assert.equal(meantWords([]), "");
    assert.equal(meantWords(['"complete" as done', "ids of one as id"]), 'Read as meant: "complete" as done; ids of one as id.');
  });
});

describe("through the runner, as an agent's call goes (TG1)", () => {
  /** The runner of one session kept in memory; the agent's own tasks start no sub-agent. */
  const rig = () => {
    /** @type {Map<string, any>} */
    const chains = new Map([["c1", { id: "c1", meta: {} }]]);
    const registry = { launch: () => ({ ok: false, error: "no sub-agents here" }), slots: () => 0, tell: () => {}, guard: () => {}, stop: () => ({ ok: true }), resumable: () => null };
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
    let t = 1000;
    const runner = createGraphRunner({ archive: /** @type {any} */ (archive), registry: /** @type {any} */ (registry), events: { publish: () => {} }, crew: () => "agent", log: () => {}, now: () => t++ });
    return { runner, graph: () => chains.get("c1").meta.graph };
  };

  // (fails before: yes — the G2-era runner refused each of these calls)
  test("a weaker model's calls run, and each answer ends naming what was read loosely; a refusal says it too", () => {
    const { runner, graph } = rig();
    const added = ok(runner.apply("c1", { action: "create", goal: "Fix the login redirect", tasks: '[{"id":"t1","title":"Find the cause"},{"id":"t2","name":"Fix it","depends_on":"t1"}]' }, AGENT));
    assert.deepEqual(graph().tasks.map((/** @type {any} */ x) => [x.id, x.name, x.needs]), [["t1", "Find the cause", []], ["t2", "Fix it", ["t1"]]]);
    assert.equal(added.text.split("\n").at(-1), `Read as meant: "create" as add; tasks was text, read as its list; t1's title as its name; t2's depends_on as its needs; t2's needs as a list.`);
    assert.equal(ok(runner.apply("c1", { action: "Begin", ids: "t1" }, AGENT)).text.split("\n").at(-1), 'Read as meant: "Begin" as start; ids as a list.');
    const done = ok(runner.apply("c1", { action: "complete", task_id: "t1", result: "The guard reads the old cookie." }, AGENT));
    assert.deepEqual([graph().tasks[0].state, graph().tasks[0].summary], ["done", "The guard reads the old cookie."]);
    assert.equal(done.text.split("\n").at(-1), 'Read as meant: "complete" as done; task_id as id; result as summary.');
    // A refusal: its words, the call to copy, and what was read on the way.
    assert.equal(no(runner.apply("c1", { action: "done", ids: ["t2"] }, AGENT)), `done needs summary: what was done, in a line or two\nThe call: ${TASK_CALLS.done}\nRead as meant: ids of one as id.`);
    assert.equal(graph().tasks[1].state, "waiting", "the graph left as it was");
    // A call read as it came says nothing more.
    assert.ok(!ok(runner.apply("c1", { action: "show" }, AGENT)).text.includes("Read as meant"));
  });
});

describe("refusals that teach (TG2)", () => {
  // (fails before: yes — a refusal named what was wrong, never the call that is right)
  test("every call a refusal offers is one the graph takes, in the order work goes", () => {
    for (const [action, call] of Object.entries(TASK_CALLS)) assert.equal(JSON.parse(call).action, action, call);
    const o = { at: 1000, crew: /** @type {const} */ ("agent") };
    const call = (/** @type {string} */ a) => JSON.parse(TASK_CALLS[a]);
    let g = ok(applyTasks(null, call("add"), o)).graph;
    g = ok(applyTasks(g, call("change"), o)).graph;
    g = ok(applyTasks(g, { action: "start", ids: ["t1"] }, o)).graph;
    g = ok(applyTasks(g, { action: "done", id: "t1", summary: "Found." }, o)).graph;
    g = ok(applyTasks(g, call("start"), o)).graph;
    ok(applyTasks(g, call("keep"), o));
    ok(applyTasks(g, call("read"), o));
    ok(applyTasks(g, call("show"), o));
    g = ok(applyTasks(g, call("pause"), o)).graph;
    g = ok(applyTasks(g, call("start"), o)).graph;
    assert.match(no(applyTasks(g, call("note"), { ...o, reads: true })), /^nobody works on t2 now/, "a note's shape is right; only nobody reads it here");
    g = ok(applyTasks(g, call("done"), o)).graph;
    g = ok(applyTasks(g, { action: "add", tasks: [{ id: "t3", name: "Docs" }] }, o)).graph;
    g = ok(applyTasks(g, call("drop"), o)).graph;
    g = ok(applyTasks(g, call("close"), o)).graph;
    assert.ok(g.closed);
    assert.deepEqual(Object.keys(TASK_CALLS).filter((a) => !TASK_ACTIONS.includes(a)), ["note", "merge"], "the reader's and the lead's own calls beside the agent's");
  });

  // (fails before: yes — status was refused as any field, with no word on how a task's state moves)
  test("a task given a status is told its state moves by its own actions, with the call", () => {
    const o = { at: 1000, crew: /** @type {const} */ ("agent") };
    const g = ok(applyTasks(null, JSON.parse(TASK_CALLS.add), o)).graph;
    const words = no(applyTasks(g, { action: "change", tasks: [{ id: "t1", status: "done" }] }, o));
    assert.equal(words, `t1: status is no field of a task — its fields are id, name, needs, writes, acceptance, check, by, goal, steps, run, items, thread, found_by, under — a task's state moves by its own actions: done ends it ({"action":"done","id":"t1","summary":"what was done, in a line or two"}), start starts it, drop drops it\nThe call: ${TASK_CALLS.change}`);
    assert.ok(no(applyTasks(g, { action: "change", tasks: [{ id: "t1", state: "done" }] }, o)).includes("a task's state moves by its own actions"));
    assert.ok(!no(applyTasks(g, { action: "change", tasks: [{ id: "t1", owner: "me" }] }, o)).includes("a task's state"), "only a state's own words");
  });

  // (fails before: yes — the first cut offered the example's own task: a done for t1 was told to copy a done of t2)
  test("the call it offers names the task the refused call named; a keep that named none stays the graph's", () => {
    assert.equal(callFor("done", { id: "t7" }), '{"action":"done","id":"t7","summary":"what was done, in a line or two"}');
    assert.equal(callFor("done", { ids: ["t7", "t8"] }), '{"action":"done","id":"t7","summary":"what was done, in a line or two"}');
    assert.equal(callFor("drop", { ids: ["t4", "t5"] }), '{"action":"drop","ids":["t4","t5"],"reason":"why it goes"}');
    assert.equal(callFor("drop", { id: "t4" }), '{"action":"drop","ids":["t4"],"reason":"why it goes"}');
    assert.equal(callFor("keep", { id: "t1" }), '{"action":"keep","id":"t1","title":"Checkpoint","text":"where it stands, what is next"}');
    assert.equal(callFor("keep", {}), '{"action":"keep","title":"Checkpoint","text":"where it stands, what is next"}');
    assert.equal(callFor("done", {}), TASK_CALLS.done, "no task named: the example's");
    assert.equal(callFor("done"), TASK_CALLS.done);
    assert.equal(callFor("show", { id: "t1" }), TASK_CALLS.show, "a call with no task in it");
    assert.equal(callFor("frob", { id: "t1" }), undefined);
  });

  test("a refusal of the graph's state, not the call's shape, offers no call", () => {
    const o = { at: 1000, crew: /** @type {const} */ ("agent") };
    const g = ok(applyTasks(null, JSON.parse(TASK_CALLS.add), o)).graph;
    assert.ok(!no(applyTasks(g, { action: "start", ids: ["t2"] }, o)).includes("The call:"), "t2 waits on t1: the call was right");
    assert.ok(!no(applyTasks(g, { action: "add", tasks: [{ id: "t1", name: "Again" }] }, o)).includes("The call:"), "an id the graph has");
  });
});

describe("a tasks call in the chat (TG3)", () => {
  // (fails before: yes — every tasks call's card was { kind: "other", title: "tasks" })
  test("its card says what it did and to which tasks, read as Filament reads it", () => {
    const card = (/** @type {any} */ input) => cardOf("tasks", input);
    assert.deepEqual(card(JSON.parse(TASK_CALLS.add)), { kind: "tasks", title: "Add tasks", subject: "t1 Find the cause · t2 Fix it" });
    assert.deepEqual(card({ action: "add", tasks: { id: "t3", title: "Write the docs" } }), { kind: "tasks", title: "Add a task", subject: "t3 Write the docs" });
    assert.deepEqual(card({ action: "create", tasks: '[{"id":"t1","name":"A"},{"id":"t2","name":"B"}]' }), { kind: "tasks", title: "Add tasks", subject: "t1 A · t2 B" });
    assert.deepEqual(card({ action: "start", ids: ["t1", "t2"] }), { kind: "tasks", title: "Start tasks", subject: "t1, t2" });
    assert.deepEqual(card({ action: "start", ids: "t1" }), { kind: "tasks", title: "Start a task", subject: "t1" });
    assert.deepEqual(card({ action: "complete", task_id: "t1", result: "Found it." }), { kind: "tasks", title: "Mark a task done", subject: "t1: Found it." });
    assert.deepEqual(card({ action: "change", goal: "Ship it" }), { kind: "tasks", title: "Change a task", subject: "the goal" });
    assert.deepEqual(card({ action: "drop", ids: ["t3", "t4"], summary: "not needed" }), { kind: "tasks", title: "Drop tasks", subject: "t3, t4: not needed" });
    assert.deepEqual(card({ action: "close", reason: "Shipped." }), { kind: "tasks", title: "Close the task graph", subject: "Shipped." });
    assert.deepEqual(card({ action: "show" }), { kind: "tasks", title: "Read the task graph", subject: "" });
    assert.deepEqual(card({ action: "show", id: "t2" }), { kind: "tasks", title: "Read the task graph", subject: "t2" });
    assert.deepEqual(card({ action: "keep", id: "t2", title: "Checkpoint", files: ["a.js", "b.js"] }), { kind: "tasks", title: "Keep it with the graph", subject: "“Checkpoint”, 2 files behind t2" });
    assert.deepEqual(card({ action: "read" }), { kind: "tasks", title: "Read what the graph keeps", subject: "behind the graph" });
    assert.deepEqual(card({ action: "note", id: "t2", note: "Use the router's guard." }), { kind: "tasks", title: "Send a note to a task's agent", subject: "t2: Use the router's guard." });
    assert.deepEqual(card({ action: "merge", id: "t2", reason: "As it stands." }), { kind: "tasks", title: "Merge a task as it stands", subject: "t2" });
    assert.deepEqual(card({ action: "frob", ids: ["t1"] }), { kind: "tasks", title: "Task graph", subject: "t1" }, "an action made up: no title of its own");
    assert.deepEqual(card(null), { kind: "tasks", title: "Task graph", subject: "" });
  });

  describe("its row", () => {
    /** @type {ReturnType<typeof stubDocument>} */
    let doc;
    before(() => {
      doc = stubDocument();
    });
    after(() => doc.restore());
    const ADD = { action: "add", goal: "Fix the login redirect", tasks: [{ id: "t1", name: "Find the cause" }, { id: "t2", name: "Fix it", depends_on: ["t1"], writes: ["src/auth.js"], acceptance: "the redirect test passes" }] };
    /** A transcript's call drawn, its card the server's, as agent-run gives a coding agent's. @param {string} name @param {any} input @param {string} result */
    const row = (name, input, result, more = {}) => archivedRows([{ id: "m1", name, input, result, card: cardOf("tasks", typeof input === "object" ? input : null), ...more }])[0];
    /** @param {any} el @param {string} sel */
    const texts = (el, sel) => el.querySelectorAll(sel).map((/** @type {any} */ n) => n.textContent);

    // (fails before: yes — a coding agent's mcp__filament__tasks drew as the generic card, its JSON whole)
    test("a call reopened from the transcript, a coding agent's here: what it did, the tasks it named in words, Filament's answer", () => {
      const el = row("mcp__filament__tasks", ADD, "Added t1, t2. Next: start t1.");
      assert.ok(el.textContent.includes("Add tasks"), el.textContent);
      assert.ok(el.textContent.includes("t1 Find the cause · t2 Fix it"));
      assert.deepEqual(texts(el, ".sub-label"), ["The 2 tasks", "Filament's answer"]);
      assert.deepEqual(texts(el, ".tg-row-id"), ["t1", "t2"]);
      assert.deepEqual(texts(el, ".plan-item"), ["t1Find the cause", "t2Fix it — needs t1 · writes src/auth.js · done when the redirect test passes"]);
      assert.ok(el.textContent.includes("Added t1, t2. Next: start t1."));
      assert.ok(!el.textContent.includes('"action"'), "no JSON");
    });

    test("a call that carries its one line, as a running turn's does: the card names the tasks, the answer follows", () => {
      const el = archivedRows([{ id: "m2", name: "tasks", input: "add 2 tasks", result: "Added t1, t2.", card: cardOf("tasks", ADD) }])[0];
      assert.ok(el.textContent.includes("Add tasks") && el.textContent.includes("t1 Find the cause · t2 Fix it"), el.textContent);
      assert.deepEqual(texts(el, ".sub-label"), ["Filament's answer"]);
    });

    test("tasks given as text or one alone are listed alike; a refused call shows its refusal's words", () => {
      assert.deepEqual(texts(row("mcp__filament__tasks", { action: "add", tasks: JSON.stringify(ADD.tasks) }, "Added t1, t2."), ".tg-row-id"), ["t1", "t2"]);
      assert.deepEqual(texts(row("mcp__filament__tasks", { action: "add", tasks: ADD.tasks[0] }, "Added t1."), ".sub-label"), ["The task", "Filament's answer"]);
      const refused = `done needs summary: what was done, in a line or two\nThe call: ${TASK_CALLS.done}`;
      const el = row("mcp__filament__tasks", { action: "done", id: "t2" }, refused, { isError: true });
      assert.ok(el.textContent.includes("Mark a task done") && el.textContent.includes("done needs summary"), el.textContent);
    });

    // (fails before: yes — its card was "other", so a coding agent's tasks call joined the MCP servers' work row)
    test("it never folds into a work row with an MCP server's calls", () => {
      const mcp = (/** @type {string} */ name) => ({ name, state: "done", card: { kind: "mcp", title: name, subject: name } });
      const tasks = { name: "mcp__filament__tasks", state: "done", card: cardOf("tasks", ADD) };
      assert.deepEqual(groupRuns([mcp("mcp__github__a"), mcp("mcp__github__b"), tasks, mcp("mcp__github__c")]), [{ start: 0, length: 2, family: "work" }]);
      assert.deepEqual(groupRuns([mcp("mcp__github__a"), { ...tasks, card: { kind: "other", title: "tasks", subject: "" } }]), [{ start: 0, length: 2, family: "work" }], "the old card: folded");
    });

    // (fails before: yes — a turn redrawn from its messages carried the name as the coding agent called it, and its
    // card was kind "mcp", folded with the MCP servers' calls)
    test("a coding agent's call by Filament's MCP name cards as Filament's own tool, as a running turn's does", () => {
      assert.deepEqual(cardOf("mcp__filament__tasks", ADD), cardOf("tasks", ADD));
      assert.deepEqual(cardOf("mcp__filament__space", { action: "log", text: "a line" }), { kind: "space", title: "Write in the logbook", subject: "a line" });
      const tasks = { name: "mcp__filament__tasks", state: "done", card: cardOf("mcp__filament__tasks", ADD) };
      const mcp = (/** @type {string} */ name) => ({ name, state: "done", card: cardOf(name, {}) });
      assert.equal(mcp("mcp__github__a").card.kind, "mcp", "another server's call stays its server's");
      assert.deepEqual(groupRuns([mcp("mcp__github__a"), mcp("mcp__github__b"), tasks, mcp("mcp__github__c")]), [{ start: 0, length: 2, family: "work" }]);
    });

    // (fails before: yes — a running turn's line said "create" with no count, and "start" with no task)
    test("a running turn's line for it reads the call as the card does", () => {
      assert.equal(argSummary("tasks", { action: "create", tasks: '[{"id":"t1","name":"A"},{"id":"t2","name":"B"}]' }), "add 2 tasks");
      assert.equal(argSummary("tasks", { action: "start", ids: "t1, t2" }), "start t1, t2");
      assert.equal(argSummary("tasks", { action: "keep", ids: ["t2"], title: "Checkpoint", text: "x" }), 'keep t2 "Checkpoint"');
    });
  });
});

describe("every reader reads a call as it runs (the Hunter on E40)", () => {
  const LEAD = { at: 1000, crew: MEMBERS };

  // (fails before: yes — "end" with a task was a close: the whole graph closed, its open tasks dropped)
  test("end with a task is that task's done; end alone is the close; a close that names a task is refused", () => {
    assert.deepEqual(meant({ action: "end", id: "t1", summary: "Found it." }), { input: { action: "done", id: "t1", summary: "Found it." }, said: ['"end" as done'] });
    assert.deepEqual(meant({ action: "End", ids: ["t1"], result: "Found it." }).input, { action: "done", id: "t1", summary: "Found it." });
    assert.deepEqual(meant({ action: "end", task_id: "t1", summary: "s" }).input.action, "done");
    assert.deepEqual(meant({ action: "end", summary: "Shipped." }), { input: { action: "close", reason: "Shipped." }, said: ['"end" as close', "summary as reason"] });
    assert.deepEqual(meant({ action: "end", id: "", reason: "Shipped." }).input.action, "close", "an empty id names no task");
    const o = { at: 1000, crew: /** @type {const} */ ("agent") };
    const g = ok(applyTasks(null, JSON.parse(TASK_CALLS.add), o)).graph;
    const r = no(applyTasks(g, { action: "close", id: "t1", reason: "t1 is finished" }, o));
    assert.equal(r, `close names no task: it ends the whole graph and drops what is still open. To end t1 alone: {"action":"done","id":"t1","summary":"what was done, in a line or two"}\nThe call: ${TASK_CALLS.close}`);
    assert.equal(no(applyTasks(g, { action: "close", ids: ["t1", "t2"], reason: "x" }, o)).split("\n")[0], 'close names no task: it ends the whole graph and drops what is still open. To end t1 alone: {"action":"done","id":"t1","summary":"what was done, in a line or two"}');
    assert.ok(ok(applyTasks(g, { action: "close", reason: "Shipped." }, o)).graph.closed, "a close as it should be");
  });

  // (fails before: yes — a show of ids of one showed the whole graph, a keep kept behind the graph, not the task)
  test("ids of one, or an id in a list, are the id for show, keep and read as for done and pause", () => {
    for (const action of ["show", "keep", "read", "done", "pause"]) assert.equal(meant({ action, ids: ["t1"] }).input.id, "t1", action);
    assert.deepEqual(meant({ action: "show", id: ["t1"] }), { input: { action: "show", id: "t1" }, said: ["id as ids", "ids of one as id"] });
    assert.deepEqual(meant({ action: "show", ids: ["t1", "t2"] }).input.ids, ["t1", "t2"], "two are no one task");
    const o = { at: 1000, crew: /** @type {const} */ ("agent") };
    const g = ok(applyTasks(null, JSON.parse(TASK_CALLS.add), o)).graph;
    assert.equal(ok(applyTasks(g, meant({ action: "show", ids: ["t2"] }).input, o)).text, ok(applyTasks(g, { action: "show", id: "t2" }, o)).text);
    const kept = ok(applyTasks(g, meant({ action: "keep", ids: ["t2"], title: "Checkpoint", text: "where it stands" }).input, o));
    assert.equal(/** @type {any} */ (kept).notes.task, "t2");
  });

  // (fails before: yes — note's and merge's refusals of their shape named no call to copy)
  test("note's and merge's refusals of their shape end with the call to copy, naming the task", () => {
    const g = ok(applyTasks(null, { action: "add", goal: "Ship", tasks: [{ id: "t1", name: "Map", by: "scout", goal: "Every caller is known", steps: ["Search"], acceptance: "each caller listed" }] }, LEAD)).graph;
    assert.equal(no(applyTasks(g, { action: "merge" }, LEAD)), `merge needs id: the failed task whose change goes into the folder as it stands, with your reason\nThe call: ${TASK_CALLS.merge}`);
    assert.equal(no(applyTasks(g, { action: "merge", ids: ["t1", "t2"], reason: "r" }, LEAD)), `merge takes one task at a time, each with its own reason — call it once a task\nThe call: ${callFor("merge", { ids: ["t1"] })}`);
    assert.equal(no(applyTasks(g, { action: "merge", id: "t1" }, LEAD)), `merge needs reason: why its change goes in as it stands\nThe call: ${callFor("merge", { id: "t1" })}`);
    const reads = { at: 1000, crew: /** @type {const} */ ("agent"), reads: true };
    const a = ok(applyTasks(null, JSON.parse(TASK_CALLS.add), reads)).graph;
    assert.equal(no(applyTasks(a, { action: "note" }, reads)), `note needs id: the one task whose sub-agent reads your note\nThe call: ${TASK_CALLS.note}`);
    assert.equal(no(applyTasks(a, { action: "note", id: "t2" }, reads)), `note needs note: your line to the sub-agent working on the task — what to do instead, and why\nThe call: ${TASK_CALLS.note}`);
  });
});
