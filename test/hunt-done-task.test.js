// @ts-check
// A Bug Hunter on a done task (HarnessV4_DesignPass_Plan UX9): a done task's detail in the Plan tab's graph holds Hunt
// for bugs — the model chip and Hunt bugs — which starts the Hunter, briefed on what the task did, on the model picked;
// its report takes the road any delivered report takes to the chat's agent — sealed while it works, whole with its next
// turn while it is stopped. No card on a task not done or a command task; a closed graph or one switched off keeps it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { applyTasks, graphView } from "../src/core/task-graph.js";
import { drawGraph, huntBrief } from "../src/ui/harness/views/task-graph.js";
import { renderPlan, chooseTask } from "../src/ui/harness/views/plan.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { createAgentCardStore } from "../src/services/agent-cards.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";

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
/** The graph after these calls, as the view draws it. @param {[any, number][]} calls */
function viewAfter(calls) {
  /** @type {any} */
  let g = null;
  for (const [input, at] of calls) {
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
/** The Hunt for bugs card under a node, or undefined. @param {any} n */
const huntOf = (n) => byClass(n, "tg-hunt")[0];
/** A button by its words. @param {any} n @param {string} words */
const press = (n, words) => buttonsOf(n).find((b) => textOf(b) === words);
const settle = () => new Promise((r) => setImmediate(r));

/** A hunt pane of the test's: a chip of its own, the tasks starting, the Hunters started, and the presses heard. */
function pane({ busy = /** @type {string[]} */ ([]), started = /** @type {Record<string, any[]>} */ ({}) } = {}) {
  /** @type {any[]} */
  const pressed = [];
  const picker = fakeH("button", { class: "model-chip" }, "The Hunter's model");
  return { pressed, picker, busy: (/** @type {string} */ id) => busy.includes(id), started: (/** @type {string} */ id) => started[id] || [], onHunt: (/** @type {any} */ t) => void pressed.push(t.id) };
}

describe("the card", () => {
  // (fails before: yes — a done task's detail ended with what it did: nothing more could be done with it there)
  test("a done task: what the Hunter does and where its findings go, the model chip and Hunt bugs; a press names the task", () => {
    const p = pane();
    const el = drawGraph(viewAfter(RUN), { h: fakeH, now: NOW, chosen: "t1", hunt: p }).el;
    const card = huntOf(el);
    assert.ok(card, "the card is there");
    // (E41 P4: a part of the task's one card) (fails before: yes — the redesign of 11-10: its name sat in the row with
    // the chip and the button, and in the inspector's 380 px broke over two lines) Its name heads it as every part's
    // does; the chip and Hunt bugs a row under it.
    assert.equal(textOf(byClass(card, "tg-hunt-t")[0]), "Hunt for bugs");
    assert.equal(byClass(card, "tg-sec-h")[0]?.kids.filter(Boolean)[0], byClass(card, "tg-hunt-t")[0], "its name, its head");
    assert.deepEqual(byClass(card, "tg-hunt-acts")[0].kids.filter(Boolean).map((/** @type {any} */ k) => (k === p.picker ? "chip" : textOf(k))), ["chip", "Hunt bugs"]);
    assert.equal(textOf(byClass(card, "tg-card-quiet")[0]), "A Reviewer reads what t1 did and reports the bugs it can show, each with its file and line; it changes nothing. Its findings go to the agent: sealed while it works, with its next turn while it is stopped.");
    assert.ok(all(card, (x) => x === p.picker).length === 1, "the view's own chip, in the card");
    const go = press(card, "Hunt bugs");
    assert.ok(go && !("disabled" in go.attrs));
    go.dispatch("click");
    assert.deepEqual(p.pressed, ["t1"]);
    // Under a lead, its words are the lead's.
    assert.match(textOf(byClass(huntOf(drawGraph(viewAfter(RUN), { h: fakeH, now: NOW, chosen: "t1", hunt: pane(), crew: "team" }).el), "tg-card-quiet")[0]), /Its findings go to the lead:/);
  });

  test("no card on a task not done, nor without the page's hunt; a closed graph keeps it", () => {
    assert.equal(huntOf(drawGraph(viewAfter(RUN), { h: fakeH, now: NOW, chosen: "t2", hunt: pane() }).el), undefined, "running");
    assert.equal(huntOf(drawGraph(viewAfter(RUN), { h: fakeH, now: NOW, chosen: "t1" }).el), undefined, "no hunt handed in");
    const dropped = viewAfter([...RUN, [{ action: "drop", ids: ["t2"], reason: "later" }, T0 + 250_000]]);
    assert.equal(huntOf(drawGraph(dropped, { h: fakeH, now: NOW, chosen: "t2", hunt: pane() }).el), undefined, "dropped");
    const closed = viewAfter([...RUN, [{ action: "close", reason: "Shipped" }, T0 + 300_000]]);
    assert.ok(huntOf(drawGraph(closed, { h: fakeH, now: NOW, chosen: "t1", hunt: pane() }).el), "closed: a hunt changes no graph");
    // A command task (V2-3): Filament ran its commands, and it wrote nothing to hunt in.
    const v = viewAfter(RUN);
    const command = { ...v, tasks: v.tasks.map((/** @type {any} */ t) => (t.id === "t1" ? { ...t, by: "command", run: ["npm test"], items: [] } : t)) };
    assert.equal(huntOf(drawGraph(command, { h: fakeH, now: NOW, chosen: "t1", hunt: pane() }).el), undefined, "a command task");
  });

  test("starting: the button held and saying so; each Hunter started on it, with Open", () => {
    /** @type {string[]} */
    const opened = [];
    const p = pane({ busy: ["t1"], started: { t1: [{ agent: "sa_1", name: "Hunter", model: "glm-5.3", at: NOW - 120_000 }] } });
    const card = huntOf(drawGraph(viewAfter(RUN), { h: fakeH, now: NOW, chosen: "t1", hunt: p, onOpenAgent: (id) => void opened.push(id) }).el);
    const busy = press(card, "Starting…");
    assert.ok(busy && "disabled" in busy.attrs, "held while it starts");
    const line = byClass(card, "tg-hunt-line")[0];
    assert.match(textOf(line), /^Hunter on GLM.?5\.3 started 2 min ago\| · \|Open/);
    press(line, "Open")?.dispatch("click");
    assert.deepEqual(opened, ["sa_1"]);
  });
});

describe("the brief", () => {
  // (fails before: yes — there was no brief: the developer wrote one themselves)
  test("what the task was and did, as the graph keeps it; what to report, its subject line first", () => {
    const t1 = viewAfter(RUN).tasks.find((/** @type {any} */ t) => t.id === "t1");
    const b = huntBrief(t1);
    assert.equal(b.description, "Bug hunt: t1 · Lexer");
    assert.equal(b.prompt.split("\n").slice(0, 5).join("\n"), [
      'Hunt for bugs in what task t1 of this chat\'s task graph did — "Lexer". Change nothing.',
      "",
      "What was done: Lexer with 40 tests",
      "Its acceptance: the lexer's tests pass",
      "The files it named: src/lex.js",
    ].join("\n"));
    assert.match(b.prompt, /Read the code as it is now — those files, and what calls them/);
    assert.match(b.prompt, /\nStart your report with one line, "Subject: " and what you found in under 20 words/);
    // A worker's task: its report's words and the files it changed; a long name cut in the description alone.
    const w = huntBrief({ id: "t5", name: "Cache", goal: "Expire old keys", writes: ["src/cache.js"], check: ["npm test", "npm run lint"], report: { did: "Moved the expiry into get()", files: [{ path: "src/cache.js" }, { path: "test/cache.test.js" }] } });
    assert.match(w.prompt, /Its goal: Expire old keys\nWhat was done: Moved the expiry into get\(\)\nThe files it named: src\/cache\.js\nThe files it changed: src\/cache\.js, test\/cache\.test\.js\nIts check: npm test, then npm run lint\n/);
    // (fails before: yes — x20: a hunt could not run its task's check, and its brief did not say how) run_check runs it.
    assert.match(w.prompt, /\nRun its check with run_check where you have it: Filament runs it in a copy of the folder as it stands/);
    assert.ok(!huntBrief({ id: "t7", name: "No check" }).prompt.includes("run_check"), "no check, no such line");
    const long = huntBrief({ id: "t6", name: "x".repeat(90), summary: "y".repeat(3000) });
    assert.ok(long.prompt.includes(`What was done: ${"y".repeat(3000)}\n`), "the agent's own words, whole");
    assert.equal(long.description, `Bug hunt: t6 · ${"x".repeat(59)}…`);
  });
});

describe("the Plan view", () => {
  // (fails before: yes — the Plan view started nothing on a done task)
  test("the chip keeps the chat's pick; Hunt bugs starts the Hunter on it once at a time; who started is listed, a refusal lists none", async () => {
    const chat = { id: "hunt", chainId: "chain-hunt", title: "Hunt", turns: [], live: null, view: { settings: {} } };
    /** @type {any} */
    let cb = null;
    let shown = "";
    const chip = fakeH("button", { class: "model-chip" });
    const modelSelect = /** @type {any} */ ((/** @type {any} */ given) => {
      cb = given;
      return { el: chip, setModels() {}, setFamilies() {}, setAccounts() {}, set: (/** @type {string} */ n) => void (shown = n), name: () => shown };
    });
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
    };
    chooseTask(chat, "t1");
    const body = fakeH("div");
    const view = renderPlan(body, { chat, hunt }, { h: fakeH, api: async () => ({ inForce: { graph: viewAfter(RUN), goal: null } }), now: () => NOW, modelSelect });
    await settle();
    view.paint();
    assert.equal(cb.blank, "The Reviewer's model", "the chip says whose model until one is picked");
    assert.ok(all(huntOf(body), (x) => x === chip).length === 1);
    cb.onChange("glm-5.3");
    assert.equal(shown, "glm-5.3", "the pick stays on the chip through the draw");
    press(huntOf(body), "Hunt bugs").dispatch("click");
    press(huntOf(body), "Starting…")?.dispatch("click");
    assert.deepEqual(started, [["t1", "glm-5.3"]], "once at a time");
    answers[0]({ agent: "sa_9", name: "Hunter", model: "glm-5.3" });
    await settle();
    assert.match(textOf(byClass(huntOf(body), "tg-hunt-line")[0]), /^Hunter on GLM.?5\.3 started just now/);
    // Refused: the page said why; nothing listed, the button back.
    press(huntOf(body), "Hunt bugs").dispatch("click");
    answers[1](null);
    await settle();
    assert.equal(byClass(huntOf(body), "tg-hunt-line").length, 1);
    assert.ok(press(huntOf(body), "Hunt bugs"));
    // Use the default: the Hunter's own model again.
    cb.onUseDefault();
    press(huntOf(body), "Hunt bugs").dispatch("click");
    assert.deepEqual(started.at(-1), ["t1", ""]);
    answers[2](null);
    await settle();
  });
});

describe("the launch", () => {
  /** A registry over the real card store, served as a turn serves a launch. */
  function scripted() {
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
        view: async () => ({ text: "User: ship it\nAssistant: Shipped.", turns: 1 }),
        brief: async () => null,
        modelProblem: () => null,
        mark: (/** @type {string} */ _c, /** @type {any} */ m) => ({ ...m, afterTurn: 1 }),
      },
      call: async ({ body, headers = {} }) => {
        const id = headers["x-filament-subagent"];
        const runId = `run-${++n}`;
        registry.attach(id, runId);
        const report = "Subject: One off-by-one in lex.js\n\nsrc/lex.js:12 reads one past the end.";
        registry.finish(id, { status: "done", error: null, report, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: report }] }], rounds: 1, toolCalls: 1, tokensIn: 10, tokensOut: 5, spentUsd: 0, roundIds: [runId] });
        return { ok: true, status: 200, json: { content: [{ type: "text", text: report }], usage: { input_tokens: 10, output_tokens: 5 } }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
      },
    });
    return registry;
  }
  const HUNT = { origin: /** @type {const} */ ("owner"), chainId: "c1", prompt: huntBrief({ id: "t1", name: "Lexer", summary: "Lexer with 40 tests" }).prompt, description: "Bug hunt: t1 · Lexer", as: "reviewer", deliver: true, model: "m-other" };

  // (fails before: no — a guard: the hunt's launch takes the road any delivered report takes, UX-D8)
  test("the agent at work: the Hunter's report reaches it sealed, in its subject; it ran on the model picked and read only", async () => {
    const registry = scripted();
    const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: tmpdir(), mode: "edit", model: "m", thinking: null, fork: null });
    const r = registry.launch(HUNT);
    assert.equal(r.ok, true, String(/** @type {any} */ (r).error || ""));
    await /** @type {any} */ (r).done;
    const sa = registry.get(/** @type {any} */ (r).id);
    assert.deepEqual([sa?.card?.tag, sa?.model, sa?.may, sa?.aside], ["reviewer", "m-other", "read", false]);
    const [t] = door.inbox.take({ seal: true });
    assert.equal(t.kind, "envelope");
    assert.match(t.text, /^\[Filament: envelope 1, sealed — from .*: One off-by-one in lex\.js\. /);
    door.close();
  });

  test("the agent stopped: the report waits whole for its next turn", async () => {
    const registry = scripted();
    const r = registry.launch(HUNT);
    await /** @type {any} */ (r).done;
    const queued = registry.peekQueued("c1");
    assert.equal(queued.length, 1);
    assert.equal(queued[0].kind, "report");
    assert.match(queued[0].text, /src\/lex\.js:12 reads one past the end\./);
  });
});

describe("the page's wiring", () => {
  test("the page starts the Hunter by its tag with the brief, the model picked and its report delivered; a tab that only reads is refused", () => {
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    const at = app.indexOf("async function huntTask(t, model) {");
    assert.ok(at > 0);
    const fn = app.slice(at, app.indexOf("\n}\n", at));
    assert.match(fn, /if \(followsStill\(\)\) \{\n\s+toast\(readOnlyWords\(\), "err"\);\n\s+return null;/);
    // The task it hunts goes with it (the owner's of 10-29): the task's box counts the Hunters fired from it.
    // (the plan's p6) …and its range, its task's files.
    assert.match(fn, /\.spawn\(\{ prompt: brief\.prompt, description: brief\.description, as: "reviewer", deliver: true, hunts: String\(t\.id\), \.\.\.\(brief\.range\.length \? \{ range: brief\.range \} : \{\}\), \.\.\.\(model \? \{ model \} : \{\}\) \}\)/);
    assert.match(app, /hunt: \{\n\s+start: \(t, model\) => huntTask\(t, model\),/);
    const host = readFileSync(new URL("../src/ui/harness/views/host.js", import.meta.url), "utf8");
    assert.match(host, /hunt: o\.hunt \|\| null,/);
  });
});
