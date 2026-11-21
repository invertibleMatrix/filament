// @ts-check
// HarnessV4_TaskGraphPlus_Plan E41 P3, the owner's words of 10-25: "Run tasks in parallel where the DAG says it's safe …
// offered, not automatic". Decided (GX-D5, GX-D6): the chance is said only for ready tasks of the planner's own whose
// writes are named and apart — once in a call's answer until that set changes (case 16), whenever it holds in "Where you
// are" (case 17), never for a task that names no writes (case 18) — and nothing launches without the planner. Since the
// owner's of 11-10 the answer says to suggest them to the person on a card (`parallel`), and only the agent puts one. Ready
// tasks may sit in different steps: nothing promises "the same step" (D1-5).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { applyTasks, graphView, sideBySide, whereText } from "../src/core/task-graph.js";
import { MEMBERS as LED } from "./helpers/roster.js";

const T0 = Date.UTC(2026, 9, 25, 15, 0);
const AGENT = /** @type {const} */ ("agent");
/** @param {any} r @returns {any} */
const ok = (r) => (assert.ok(r.ok, JSON.stringify(r)), r);
/** @param {any} g @param {any} call @param {{ crew?: any, solo?: boolean }} [o] */
const call = (g, call, { crew = AGENT, solo = false } = {}) => ok(applyTasks(g, call, { at: T0, crew, solo }));
/**
 * What the answer says, the loop's and a coding agent's alike (the owner's of 11-10): suggest them on a card, which
 * answers itself in 60 seconds; else do them yourself (the owner's of 11-14). @param {string[]} ids
 */
const SUGGEST = (ids) => `The graph lets ${ids.length > 1 ? `${ids.slice(0, -1).join(", ")} and ${ids.at(-1)}` : ids[0]} run side by side: none needs another's work. Whether they should is your call — truly independent, each worth a sub-agent of its own, none you are working on yourself. If so, suggest them to the person: ${JSON.stringify({ action: "parallel", ids })} puts a card in the chat that starts each on a sub-agent on their Accept, or by itself after 60 seconds; a builder you launch for one yourself is held on a card the same way. If not, do them yourself, in order.`;
const NATIVE = SUGGEST(["t2", "t3"]);
const CODER = NATIVE;
/** t1 maps; t2 and t3 build on it, each writing its own file, with the steps a card's sub-agent is briefed with; t4 brings them together. */
const ADD = {
  action: "add",
  goal: "Ship the parser",
  tasks: [
    { id: "t1", name: "Map the parser", acceptance: "each caller listed" },
    { id: "t2", name: "Write the tests", needs: ["t1"], writes: ["test/parse.test.js"], acceptance: "they fail on main", steps: ["Write them"] },
    { id: "t3", name: "Fix the parser", needs: ["t1"], writes: ["src/parse.js"], check: ["npm test"], steps: ["Fix it"] },
    { id: "t4", name: "Update the docs", needs: ["t2", "t3"], writes: ["docs/"], acceptance: "the docs say it" },
  ],
};
const MAPPED = [{ action: "start", ids: ["t1"] }, { action: "done", id: "t1", summary: "Three callers.", evidence: "grep parse( found 3" }];

describe("a call's answer says the safe chance once (case 16)", () => {
  // (fails before: yes — two ready tasks whose writes were apart were said as ready alone)
  // (fails before: yes, for its end — FabeleHelper's of 11-10: a set forgotten as it ended was said again as each start or
  // end changed it; each task is said once in the graph's life)
  test("the done that makes two writers ready says it, with how; a call that leaves the set says nothing more; a start that ends it keeps what was said; a new task says the set", () => {
    const added = call(null, ADD);
    assert.ok(!added.text.includes("side by side:"), "nothing ready but t1");
    const started = call(added.graph, MAPPED[0]);
    const done = call(started.graph, MAPPED[1]);
    // The two it made ready are named in that line, and in no other place of the answer (the review of 67038d835).
    assert.equal(done.text, `Done: t1. 1 of 4 done.\n${NATIVE}`);
    assert.deepEqual(done.graph.told, ["side:t2,t3"]);
    const renamed = call(done.graph, { action: "change", tasks: [{ id: "t4", name: "Update the guide" }] });
    assert.ok(!renamed.text.includes("side by side"), `once until the set changes: ${renamed.text}`);
    const one = call(renamed.graph, { action: "start", ids: ["t2"] });
    assert.ok(!one.text.includes("side by side"), "one ready: none");
    assert.deepEqual(one.graph.told, ["side:t2,t3"], "what was said is kept");
    const paused = call(one.graph, { action: "pause", id: "t2", checkpoint: "two tests written; the third next" });
    assert.ok(!paused.text.includes("side by side"), "a paused task is not ready");
    const more = call(paused.graph, { action: "add", tasks: [{ id: "t5", name: "Bench it", needs: ["t1"], writes: ["bench/"], acceptance: "a number", steps: ["Run it"] }] });
    assert.ok(more.text.endsWith(`\n${SUGGEST(["t3", "t5"])}`), `a new task in it: said — ${more.text}`);
    assert.deepEqual(more.graph.told, ["side:t2,t3,t5"]);
  });

  // (fails before: yes — the review of d81fdac5e: a plan's go marked what can run side by side said, and dropped its words)
  test("a plan's go says what can run side by side, as any start does — once", () => {
    const three = { action: "add", goal: "G", tasks: ["a", "b", "c"].map((id) => ({ id, name: id.toUpperCase(), writes: [`${id}.js`], acceptance: "it loads" })) };
    const planned = ok(applyTasks(null, three, { at: T0, crew: AGENT, planning: true }));
    assert.ok(!planned.text.includes("side by side"), "a plan waits for its Approve: nothing to start");
    const go = call(planned.graph, { action: "start", ids: ["a"] });
    assert.match(go.text, /\nThe graph lets b and c run side by side: /, go.text);
    assert.ok(!call(go.graph, { action: "start", ids: ["b"] }).text.includes("side by side"), "said once");
  });

  // (fails before: yes — the answer named no way to run them at once)
  test("a coding agent hears the same suggestion; three ready say all three; a lead hears nothing", () => {
    const coder = [ADD, ...MAPPED].reduce((/** @type {any} */ g, c) => call(g, c, { solo: true }).graph, null);
    assert.deepEqual(coder.told, ["side:t2,t3"]);
    const said = call(null, ADD, { solo: true });
    const solo = call(call(said.graph, MAPPED[0], { solo: true }).graph, MAPPED[1], { solo: true });
    assert.ok(solo.text.endsWith(`\n${CODER}`), solo.text);
    const three = call(solo.graph, { action: "add", tasks: [{ id: "t5", name: "Bench it", needs: ["t1"], writes: ["bench/"], acceptance: "a number", steps: ["Run it"] }] });
    assert.ok(three.text.endsWith(`\n${SUGGEST(["t2", "t3", "t5"])}`), three.text);
    const two = call(three.graph, { action: "start", ids: ["t2"] }, { solo: true });
    assert.ok(!two.text.includes("side by side"), `one of three started: the two left were said — ${two.text}`);
    const BRIEF = { goal: "Done", steps: ["Do it"], acceptance: "it passes" };
    const lead = call(null, { action: "add", goal: "G", tasks: [{ id: "a", name: "A", by: "builder", writes: ["a.js"], ...BRIEF }, { id: "b", name: "B", by: "builder", writes: ["b.js"], ...BRIEF }] }, { crew: LED });
    assert.ok(!lead.text.includes("side by side:") && !lead.graph.told, "its workers' tasks are Filament's to start");
  });

  // (fails before: no — held: what may not run at once is never offered)
  test("never a task that names no writes, a sub-agent's, one running, or one alone; ready in different steps still counts", () => {
    const g = call(null, { action: "add", goal: "G", tasks: [{ id: "a", name: "A", writes: ["a.js"] }, { id: "b", name: "B" }, { id: "s", name: "S", by: "sub-agent", writes: ["s.js"], goal: "g", steps: ["x"], acceptance: "y" }] });
    assert.ok(!g.text.includes("side by side:"), "b names no writes (case 18), s is a sub-agent's");
    assert.deepEqual(sideBySide(g.graph), []);
    const steps = call(null, { action: "add", goal: "G", tasks: [{ id: "x", name: "X" }, { id: "y", name: "Y", needs: ["x"], writes: ["y.js"] }, { id: "z", name: "Z", writes: ["z.js"] }] });
    const later = call(call(steps.graph, { action: "start", ids: ["x"] }).graph, { action: "done", id: "x", summary: "x" });
    assert.ok(later.text.includes("\nThe graph lets z and y run side by side"), `different steps (D1-5), in the order they may start: ${later.text}`);
    assert.ok(!later.text.includes("same step"));
    assert.deepEqual(sideBySide({ ...later.graph, closed: { at: T0, reason: "stopped" } }), [], "a closed graph offers nothing");
  });

  // (g1, the owner's of 11-09: two of the planner's own that write one file go into the graph now, where they were
  // refused. g3b, the same day: the offer gives them to sub-agents, each in its own worktree, so a shared file keeps
  // none out — fails before: yes, the offer left b out, ["a", "c"])
  test("two ready tasks of the planner's own that write one file go in, and are offered side by side with the rest", () => {
    const g = call(null, { action: "add", goal: "G", tasks: [{ id: "a", name: "A", writes: ["src/x.js"], steps: ["Do it"] }, { id: "b", name: "B", writes: ["src/x.js", "src/y.js"], steps: ["Do it"] }, { id: "c", name: "C", writes: ["src/z.js"], steps: ["Do it"] }] });
    assert.deepEqual(sideBySide(g.graph), ["a", "b", "c"]);
    assert.ok(g.text.endsWith(`\n${SUGGEST(["a", "b", "c"])}`), g.text);
    // Given to sub-agents, the answer says where they meet, as any change's does.
    const BRIEF = { by: "sub-agent", goal: "Done", steps: ["Do it"], acceptance: "it passes" };
    const given = call(g.graph, { action: "change", tasks: [{ id: "a", ...BRIEF }, { id: "b", ...BRIEF }] });
    assert.match(given.text, /a and b both write src\/x\.js: whichever lands second merges three-way at its apply/);
  });
});

describe("where you are and the page (cases 17, 19)", () => {
  // (fails before: yes — the block named them as ready alone)
  // (fails before: yes — the owner's of 11-10: the view carried the set, and the Plan offered it by itself)
  test("the block's line, whenever it holds — a lead's never; the graph's view carries no set of Filament's own for the page", () => {
    const g = [ADD, ...MAPPED].reduce((/** @type {any} */ x, c) => call(x, c).graph, null);
    const where = String(whereText(g, { crew: AGENT }));
    assert.ok(where.includes('- Ready next: t2 "Write the tests", t3 "Fix the parser"\n- Side by side now: t2, t3\n- Waiting: t4 on t2, t3'), where);
    assert.ok(!String(whereText(g, { crew: LED })).includes("Side by side"), "a lead's tasks are Filament's to start");
    assert.equal("side" in /** @type {any} */ (graphView(g)), false, "the Plan draws the agent's card alone");
  });
});
