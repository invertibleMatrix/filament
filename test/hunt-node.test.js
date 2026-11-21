// @ts-check
// A Bug Hunter's task, kept and shown (the owner's words of 10-29: "the node itself should show that a hunter has been
// fired from this node … one might end up firing more hunters on same node", and the hunt "hidden under a collapsed
// text" in the inspector of a narrow graph, "maybe you can add a right click on a node"). The Hunter's launch names the
// task it hunts, its row says it, and its thread keeps it across a restart; a done task's box holds the Hunters fired
// from it, a strip each, blue while one still runs (the redesign of 11-05); its card lists them from the chat's list and says Hunt again while one runs; the
// hunt sits after what was done and never folds; a right-click on a done task's box opens the hunt in a popup there.
// Hunts stay on done tasks alone (the owner's choice of 10-29).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { applyTasks, graphView } from "../src/core/task-graph.js";
import { drawGraph, huntBrief } from "../src/ui/harness/views/task-graph.js";
import { renderPlan, chooseTask } from "../src/ui/harness/views/plan.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { createAgentCardStore } from "../src/services/agent-cards.js";
import { fakeH, textOf, buttonsOf, recordingPopover } from "./helpers/fake-dom.js";

const T0 = 1_000_000;
const NOW = T0 + 320_700;
const ADD = {
  action: "add",
  goal: "Ship the parser",
  tasks: [
    { id: "t1", name: "Lexer", needs: [], writes: ["src/lex.js"], acceptance: "the lexer's tests pass" },
    { id: "t2", name: "Parser", needs: ["t1"], writes: ["src/parse.js"] },
  ],
};
/** t1 done, t2 running. */
const RUN = [
  /** @type {[any, number]} */ ([ADD, T0]),
  /** @type {[any, number]} */ ([{ action: "start", id: "t1" }, T0 + 60_000]),
  /** @type {[any, number]} */ ([{ action: "done", id: "t1", summary: "Lexer with 40 tests", evidence: "npm test: 40 passed" }, T0 + 180_000]),
  /** @type {[any, number]} */ ([{ action: "start", id: "t2" }, T0 + 200_700]),
];
/** The graph after these calls, as the view draws it. */
function view() {
  /** @type {any} */
  let g = null;
  for (const [input, at] of RUN) {
    const r = /** @type {any} */ (applyTasks(g, input, /** @type {any} */ ({ at })));
    assert.ok(r.ok, r.error);
    g = r.graph;
  }
  return /** @type {any} */ (graphView(g));
}
/** Every node under `n` that `pred` picks. @param {any} n @param {(x: any) => boolean} pred @param {any[]} [out] @returns {any[]} */
const all = (n, pred, out = []) => {
  if (n && typeof n === "object") {
    if (pred(n)) out.push(n);
    for (const k of n.kids || []) all(k, pred, out);
  }
  return out;
};
/** @param {any} n @param {string} cls */
const byClass = (n, cls) => all(n, (x) => String(x.attrs?.class || "").split(/\s+/).includes(cls));
/** A task's box — wide or narrow — by its id. @param {any} n @param {string} id */
const boxOf = (n, id) => all(n, (x) => x.attrs?.["data-id"] === id)[0];
/** @param {any} n */
const huntOf = (n) => byClass(n, "tg-hunt")[0];
/** A button by its words. @param {any} n @param {string} words */
const press = (n, words) => buttonsOf(n).find((b) => textOf(b) === words);
const settle = () => new Promise((r) => setImmediate(r));
/** A room narrower than one box: the graph's boxes still, the island scrolling sideways. */
const NARROW = 100;

/** A Hunter as the hunt pane hands it on. @param {Record<string, any>} [more] */
const hunter = (more = {}) => ({ agent: "sa_1", name: "Hunter", model: "glm-5.3", at: NOW - 120_000, ...more });
/** A hunt pane of the test's, its Hunters by task. @param {Record<string, any[]>} [fired] */
function pane(fired = {}) {
  /** @type {any[]} */
  const menus = [];
  return { menus, picker: fakeH("button", { class: "model-chip" }, "The Hunter's model"), busy: () => false, started: (/** @type {string} */ id) => fired[id] || [], onHunt: () => {}, onMenu: (/** @type {any} */ t, /** @type {any} */ el) => void menus.push([t.id, el]) };
}

describe("the box", () => {
  /** A hunt box's strips: each one's class and words, the model's name aside. @param {any} el */
  const strips = (el) => byClass(el, "tg-hunt-strip").map((s) => [s.attrs.class, textOf(s).replace(/ · GLM.?5\.3 · /, " · GLM 5.3 · ")]);

  // (fails before: yes — the box knew nothing of the Hunters fired from it: a second press was a guess; the redesign of
  // 11-05, the owner's yes: the box holds its hunts, a strip each, where a count on it said how many)
  test("a task with Hunters fired from it holds them in its box, a strip each, blue while one still runs, and says so in words", () => {
    const quiet = drawGraph(view(), { h: fakeH, now: NOW, hunt: pane({ t1: [hunter({ ended: "finished" })] }) }).el;
    const box = byClass(quiet, "tg-hunt-box")[0];
    assert.ok(box, "t1's hunt box");
    assert.equal(boxOf(box, "t1")?.tag, "button", "its own line first");
    assert.deepEqual(strips(box), [["tg-hunt-strip is-folded", "Hunted · report sent"]], "nothing in it open: one strip");
    assert.match(boxOf(quiet, "t1").attrs.title, /\n1 Reviewer sent to hunt bugs in t1(\n|$)/);
    const busy = drawGraph(view(), { h: fakeH, now: NOW, hunt: pane({ t1: [hunter({ ended: "finished" }), hunter({ agent: "sa_2", running: true })] }) }).el;
    assert.deepEqual(strips(busy), [["tg-hunt-strip", "Hunter's hunt · report sent to the agent"], ["tg-hunt-strip is-running", "Hunter hunting · GLM 5.3 · 2 min ago"]]);
    assert.match(boxOf(busy, "t1").attrs["aria-label"], /; 2 Reviewers sent to hunt bugs in t1, 1 still running$/, "a screen reader hears it in the box's name");
    assert.equal(byClass(busy, "tg-hunt-box").length, 1, "a task none was fired from has none");
    // In a room narrower than a box, the same box.
    const narrow = drawGraph(view(), { h: fakeH, now: NOW, width: NARROW, hunt: pane({ t1: [hunter({ running: true })] }) });
    assert.equal(boxOf(narrow.el, "t1").tag, "button");
    assert.deepEqual(strips(narrow.el), [["tg-hunt-strip is-running", "Hunter hunting · GLM 5.3 · 2 min ago"]]);
  });

  // (fails before: yes — the review of 11-05: a Reviewer still hunting in a finished step folded away with it, its strip
  // drawn nowhere)
  test("a box whose Reviewer still hunts keeps its step out of the fold; its hunt ended, the step folds with the rest", () => {
    /** @type {any} */
    let g = null;
    /** @type {[any, number][]} */
    const calls = [[{ action: "add", goal: "Chain", tasks: [{ id: "a", name: "A" }, { id: "b", name: "B", needs: ["a"] }, { id: "c", name: "C", needs: ["b"] }, { id: "d", name: "D", needs: ["c"] }] }, T0]];
    for (const [i, id] of ["a", "b", "c"].entries()) calls.push([{ action: "start", id }, T0 + 1000 * i + 100], [{ action: "done", id, summary: id.toUpperCase() }, T0 + 1000 * i + 500]);
    calls.push([{ action: "start", id: "d" }, T0 + 5000]);
    for (const [input, at] of calls) {
      const r = /** @type {any} */ (applyTasks(g, input, /** @type {any} */ ({ at })));
      assert.ok(r.ok, r.error);
      g = r.graph;
    }
    const v = graphView(g);
    /** What the fold row says, and the hunt boxes drawn. @param {any} el */
    const seen = (el) => [textOf(byClass(el, "tg-fold-t")[0] || "").replace(/ · took .*$/, ""), byClass(el, "tg-hunt-box").length];
    for (const inPane of [false, true]) {
      assert.deepEqual(seen(drawGraph(v, { h: fakeH, now: NOW, pane: inPane }).el), ["2 finished steps · 2 tasks done", 0], "three steps done: the top two fold");
      const hunting = drawGraph(v, { h: fakeH, now: NOW, pane: inPane, hunt: pane({ a: [hunter({ running: true })] }) }).el;
      assert.deepEqual(seen(hunting), ["", 1], "a's step holds a hunt at work: nothing above it folds");
      assert.deepEqual(strips(hunting), [["tg-hunt-strip is-running", "Hunter hunting · GLM 5.3 · 2 min ago"]]);
      const ended = drawGraph(v, { h: fakeH, now: NOW, pane: inPane, hunt: pane({ a: [hunter({ ended: "finished" })] }) }).el;
      assert.deepEqual(seen(ended), ["2 finished steps · 2 tasks done", 0], "its hunt ended: folded with the rest");
    }
  });

  // (fails before: yes — the review of 11-05: a hunt fired from a fix inside its box was drawn nowhere)
  test("a fix hunted in its turn stands apart, a box of its own holding its hunt; the box it came from keeps the rest", () => {
    /** @type {any} */
    let g = null;
    for (const [input, at] of [...RUN, /** @type {[any, number]} */ ([{ action: "add", tasks: [{ id: "f", name: "Fix it", needs: ["t1"] }, { id: "e", name: "Fix that too", needs: ["t1"] }] }, T0 + 210_000])]) {
      const r = /** @type {any} */ (applyTasks(g, input, /** @type {any} */ ({ at })));
      assert.ok(r.ok, r.error);
      g = r.graph;
    }
    const plain = /** @type {any} */ (graphView(g));
    const v = { ...plain, tasks: plain.tasks.map((/** @type {any} */ t) => (t.id === "f" || t.id === "e" ? { ...t, foundBy: { agent: "sa_1", name: "Hunter", task: "t1" } } : t)) };
    const fired = { t1: [hunter({ ended: "finished" })], f: [hunter({ agent: "sa_2", running: true })] };
    for (const inPane of [false, true]) {
      const boxes = byClass(drawGraph(v, { h: fakeH, now: NOW, pane: inPane, hunt: pane(fired) }).el, "tg-hunt-box");
      assert.deepEqual(boxes.map((b) => byClass(b, "tg-node").map((n) => n.attrs["data-id"])), [["t1", "e"], ["f"]]);
      assert.deepEqual(strips(boxes[1]), [["tg-hunt-strip is-running", "Hunter hunting · GLM 5.3 · 2 min ago"]], "its own hunt, in its own box");
    }
  });

  // (fails before: yes — nothing answered a right-click: the hunt was in the card alone, folded away when narrow)
  test("a right-click on a done task's box opens its hunt, wide or narrow; on a task not done the page's own menu stays", () => {
    for (const width of [null, NARROW]) {
      const p = pane();
      const el = drawGraph(view(), { h: fakeH, now: NOW, width, hunt: p }).el;
      /** @type {boolean[]} */
      const stopped = [];
      boxOf(el, "t1").dispatch("contextmenu", { preventDefault: () => void stopped.push(true) });
      assert.deepEqual(p.menus.map(([id, box]) => [id, box === boxOf(el, "t1")]), [["t1", true]], "its task and its box");
      assert.deepEqual(stopped, [true], "the browser's menu gives way");
      // The keyboard on a focused box: its menu key, Shift+F10; any other key is the box's as ever.
      boxOf(el, "t1").dispatch("keydown", { key: "Enter" });
      boxOf(el, "t1").dispatch("keydown", { key: "F10", shiftKey: true });
      boxOf(el, "t1").dispatch("keydown", { key: "ContextMenu" });
      assert.equal(p.menus.length, 3);
      boxOf(el, "t2").dispatch("contextmenu");
      boxOf(el, "t2").dispatch("keydown", { key: "ContextMenu" });
      assert.equal(p.menus.length, 3, "running: nothing of the hunt's");
    }
    // A command task wrote nothing to hunt in.
    const v = view();
    const command = { ...v, tasks: v.tasks.map((/** @type {any} */ t) => (t.id === "t1" ? { ...t, by: "command", run: ["npm test"], items: [] } : t)) };
    const p = pane();
    boxOf(drawGraph(command, { h: fakeH, now: NOW, hunt: p }).el, "t1").dispatch("contextmenu");
    assert.equal(p.menus.length, 0);
  });
});

describe("the card", () => {
  // (fails before: yes — the card listed the Hunters started while the page was open, and a second press read as the first)
  test("it lists every Hunter fired from the task and how each stands; while one runs it says so and the button reads Hunt again", () => {
    /** @type {string[]} */
    const opened = [];
    const fired = { t1: [hunter({ ended: "finished" }), hunter({ agent: "sa_2", model: "m-other", at: NOW - 30_000, running: true })] };
    const card = huntOf(drawGraph(view(), { h: fakeH, now: NOW, chosen: "t1", hunt: pane(fired), onOpenAgent: (id) => void opened.push(id) }).el);
    assert.equal(textOf(byClass(card, "tg-hunt-busy")[0]), "A Reviewer is still hunting bugs in what t1 did — Hunt again starts another beside it.");
    assert.ok(press(card, "Hunt again"), "a second Hunter is a choice");
    const lines = byClass(card, "tg-hunt-line");
    assert.match(textOf(lines[0]), /^Hunter on GLM.?5\.3 started 2 min ago — finished\| · \|Open$/);
    assert.match(textOf(lines[1]), /started just now — still running\| · \|Open$/);
    press(lines[1], "Open")?.dispatch("click");
    assert.deepEqual(opened, ["sa_2"]);
    // None running: the words go and the button is Hunt bugs again.
    const done = huntOf(drawGraph(view(), { h: fakeH, now: NOW, chosen: "t1", hunt: pane({ t1: [hunter({ ended: "failed" })] }) }).el);
    assert.equal(byClass(done, "tg-hunt-busy").length, 0);
    assert.ok(press(done, "Hunt bugs"));
    assert.match(textOf(byClass(done, "tg-hunt-line")[0]), /— failed/);
  });

  // (fails before: yes — the hunt was the card's last part, folded under More beside the chat; then (the redesign of
  // 11-10) it sat between What was done and Done when, breaking the card's reading)
  test("the hunt is the card's foot, after its More line beside the chat, never folded", () => {
    // A task of four parts: beside the chat its fourth folds.
    const v = view();
    const four = { ...v, tasks: v.tasks.map((/** @type {any} */ t) => (t.id === "t1" ? { ...t, goal: "A lexer the parser reads" } : t)) };
    for (const [beside, width] of /** @type {[boolean, number | null][]} */ ([[true, null], [true, NARROW], [false, null]])) {
      const card = byClass(drawGraph(four, { h: fakeH, now: NOW, chosen: "t1", hunt: pane(), more: { open: () => false, toggle: () => {} }, pane: beside, width }).el, "tg-card")[0];
      const more = byClass(card, "tg-more")[0];
      if (beside) assert.ok(more, "the card folds its rest beside the chat");
      if (more) assert.doesNotMatch(textOf(more), /hunt/i, "the hunt is never folded");
      assert.ok(huntOf(card), "it is drawn");
      const last = card.kids.filter(Boolean).at(-1);
      assert.equal(String(last?.attrs?.class), "tg-card-foot", "the card's last");
      assert.ok(byClass(last, "tg-hunt").length === 1, "the foot is the hunt");
      if (more) assert.ok(card.kids.indexOf(more) < card.kids.indexOf(last), "after the More line");
    }
  });
});

describe("the Plan view", () => {
  /** A chat of the Plan view's, its graph t1 done and t2 running. */
  const chatOf = (/** @type {string} */ id) => ({ id, chainId: `chain-${id}`, title: "Hunt", turns: [], live: null, view: { settings: {} } });
  /** The view drawn with the test's model chip, popover and the chat's Hunters. @param {any} chat @param {any} hunt */
  async function drawn(chat, hunt) {
    /** @type {any[]} */
    const chips = [];
    const modelSelect = /** @type {any} */ ((/** @type {any} */ given) => {
      let shown = "";
      const chip = { el: fakeH("button", { class: "model-chip" }), given, setModels() {}, setFamilies() {}, setAccounts() {}, set: (/** @type {string} */ n) => void (shown = n), name: () => shown };
      chips.push(chip);
      return chip;
    });
    const rec = recordingPopover();
    const body = fakeH("div");
    const v = renderPlan(body, { chat, hunt, openAgent: () => {} }, { h: fakeH, api: async () => ({ inForce: { graph: view(), goal: null } }), now: () => NOW, modelSelect, popover: rec.popover });
    await settle();
    v.paint();
    return { body, chips, pops: rec.pops, view: v };
  }
  /** The chat's list as the page's store holds it: a Hunter of t1 that runs, one that finished, and a helper. */
  const ROWS = [
    { id: "sa_3", hunts: "t1", card: { tag: "hunter", name: "Hunter" }, model: "glm-5.3", status: "running", startedAt: NOW - 60_000 },
    { id: "sa_2", hunts: "t1", card: { tag: "hunter", name: "Hunter" }, model: "m-other", status: "done", startedAt: NOW - 600_000 },
    { id: "sa_9", card: { tag: "helper", name: "Helper" }, model: "m", status: "done", startedAt: NOW - 30_000 },
  ];

  // (fails before: yes — the Hunters were the page's memory alone: a reload, a restart or the pane beside the chat lost them)
  test("the box and the card read the chat's list: a fresh page draws the Hunters fired before it", async () => {
    const chat = chatOf("rows");
    chooseTask(chat, "t1");
    const { body } = await drawn(chat, { start: async () => null, models: () => [], hunters: (/** @type {string} */ chain) => (chain === "chain-rows" ? ROWS : []) });
    assert.deepEqual(byClass(body, "tg-hunt-strip").map((s) => s.attrs.class), ["tg-hunt-strip", "tg-hunt-strip is-running"], "its box: the one that finished, the one that runs");
    const lines = byClass(huntOf(body), "tg-hunt-line").map(textOf);
    assert.equal(lines.length, 2, "the helper is no Hunter");
    assert.match(lines[0], /^Hunter on M Other started 10 min ago — finished/);
    assert.match(lines[1], /^Hunter on GLM.?5\.3 started 1 min ago — still running/);
    assert.ok(press(huntOf(body), "Hunt again"));
  });

  // (fails before: yes — the review of 11-03: one whose card the list does not say was called Hunter, a card that does
  // not ship; a hunt is the Reviewer's)
  test("a hunt the chat's list gives no card is the Reviewer's", async () => {
    const chat = chatOf("nameless");
    chooseTask(chat, "t1");
    const { body } = await drawn(chat, { start: async () => null, models: () => [], hunters: () => [{ id: "sa_4", hunts: "t1", model: "glm-5.3", status: "done", startedAt: NOW - 60_000 }] });
    assert.match(textOf(byClass(huntOf(body), "tg-hunt-line")[0]), /^Reviewer on GLM.?5\.3 started 1 min ago — finished/);
  });

  // (fails before: yes — no right-click popup: the hunt was only in the card)
  test("a right-click on a done box opens the popup there: its title, its own chip on the chat's pick, the Hunters, Hunt bugs; a start that went through closes it", async () => {
    const chat = chatOf("pop");
    /** @type {[string, string][]} */
    const started = [];
    /** @type {((r: any) => void)[]} */
    const answers = [];
    const hunt = {
      start: (/** @type {any} */ t, /** @type {string} */ model) => {
        started.push([t.id, model]);
        return new Promise((r) => answers.push(r));
      },
      models: () => [],
      hunters: () => ROWS.slice(1),
    };
    const { body, chips, pops } = await drawn(chat, hunt);
    boxOf(body, "t2").dispatch("contextmenu");
    assert.equal(pops.length, 0, "a task not done opens none");
    boxOf(body, "t1").dispatch("contextmenu");
    assert.equal(pops.length, 1);
    const pop = pops[0];
    assert.equal(pop.o.label, "Hunt for bugs in t1");
    assert.equal(textOf(byClass(pop.body, "tg-hunt-pop-t")[0]), "Hunt for bugs in t1");
    assert.equal(textOf(byClass(pop.body, "tg-hunt-pop-name")[0]), "Lexer");
    assert.match(textOf(byClass(pop.body, "tg-hunt-line")[0]), /^Hunter on M Other started 10 min ago — finished/);
    // Its own chip, beside the card's: a pick in it is the chat's, on both.
    const popChip = chips.find((x) => all(pop.body, (n) => n === x.el).length === 1);
    assert.ok(popChip, "a chip in the popup");
    popChip.given.onChange("glm-5.3");
    assert.equal(popChip.name(), "glm-5.3");
    const go = press(pop.body, "Hunt bugs");
    assert.ok(go && go.focused, "Hunt bugs, the keyboard on it");
    go.dispatch("click");
    assert.ok(press(pop.body, "Starting…") && "disabled" in press(pop.body, "Starting…").attrs);
    go.dispatch("click");
    assert.deepEqual(started, [["t1", "glm-5.3"]], "once at a time, on the pick");
    // Refused: the page said why; the popup stays, its button back.
    answers[0](null);
    await settle();
    assert.equal(pop.closed, false);
    assert.ok(press(pop.body, "Hunt bugs"));
    // Went through: it closes.
    press(pop.body, "Hunt bugs").dispatch("click");
    answers[1]({ agent: "sa_7", name: "Hunter", model: "glm-5.3" });
    await settle();
    assert.equal(pop.closed, true);
  });
});

describe("the launch", () => {
  /** A registry over the real card store, its threads kept in `threads` as a session keeps them. @param {Map<string, any[]>} threads */
  function registryOver(threads) {
    const cards = createAgentCardStore({ dataDir: null });
    let n = 0;
    /** @type {ReturnType<typeof createSubagentRegistry>} */
    const registry = createSubagentRegistry({
      config: () => ({ agentLoop: {} }),
      log: () => {},
      events: { publish: () => {} },
      runs: null,
      context: {
        card: (tag) => cards.find(tag),
        settings: () => ({ subagents: { pool: [{ model: "m-sub", seats: 4 }], view: "none" }, loop: { permissions: "edit" } }),
        session: () => ({ cwd: tmpdir(), model: "m", projectId: "p1" }),
        view: async () => ({ text: "User: ship it", turns: 1 }),
        brief: async () => null,
        modelProblem: () => null,
        mark: (/** @type {string} */ _c, /** @type {any} */ m) => ({ ...m, afterTurn: 1 }),
        saveThread: (/** @type {string} */ c, /** @type {any} */ t) => threads.set(c, [...(threads.get(c) || []).filter((x) => x.id !== t.id), structuredClone(t)]),
        loadThreads: (/** @type {string} */ c) => structuredClone(threads.get(c) || []),
      },
      call: async ({ body, headers = {} }) => {
        const id = headers["x-filament-subagent"];
        const runId = `run-${++n}`;
        registry.attach(id, runId);
        registry.finish(id, { status: "done", error: null, report: "Subject: none found", convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: "Subject: none found" }] }], rounds: 1, toolCalls: 0, tokensIn: 1, tokensOut: 1, spentUsd: 0, roundIds: [runId] });
        return { ok: true, status: 200, json: { content: [{ type: "text", text: "Subject: none found" }] }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
      },
    });
    return registry;
  }
  const HUNT = { origin: /** @type {const} */ ("owner"), chainId: "c1", prompt: huntBrief({ id: "t1", name: "Lexer", summary: "Lexer with 40 tests" }).prompt, description: "Bug hunt: t1 · Lexer", as: "reviewer", deliver: true, model: "m-other" };

  // (fails before: yes — the launch kept nothing of the task it hunted)
  test("the Hunter's launch keeps its task: its row says it, and so does its thread after a restart; a launch with none says none", async () => {
    /** @type {Map<string, any[]>} */
    const threads = new Map();
    const registry = registryOver(threads);
    const r = /** @type {any} */ (registry.launch({ ...HUNT, hunts: "t1" }));
    assert.equal(r.ok, true, String(r.error || ""));
    await r.done;
    const plain = /** @type {any} */ (registry.launch({ ...HUNT, description: "Look" }));
    await plain.done;
    const rows = registry.list("c1");
    assert.equal(rows.find((x) => x.id === r.id)?.hunts, "t1");
    assert.equal("hunts" in /** @type {any} */ (rows.find((x) => x.id === plain.id)), false, "a launch that names no task: its row is as ever");
    // Filament restarts: the session's kept threads give the Hunter back, its task with it.
    const again = registryOver(threads);
    assert.equal(again.list("c1").find((x) => x.id === r.id)?.hunts, "t1");
  });

  test("a task's id is all it takes", () => {
    const registry = registryOver(new Map());
    assert.deepEqual(registry.launch({ ...HUNT, hunts: "t 1; rm" }), { ok: false, error: 'hunts names the graph task a bug hunt looks in, by its id like t1 — not "t 1; rm"' });
  });
});
