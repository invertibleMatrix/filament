// @ts-check
// Plan mode (the owner's plan mode of 11-06): the agent offers to plan complex work nobody asked it to plan — a card
// under its reply, Light, Standard or Deep and Parallelize tasks, Plan or Just do it. A /plan's turn, and an answer to a
// question it asked, is read-only, starts no task, and what it changes on the graph waits for the person's Approve —
// Filament starts none of its sub-agents' tasks until then, or until the person says go in a message of their own and
// the agent starts a task; the work under way goes on. The offer's card, and the plan's card's Approve and Amend, stand
// until the person's next message of their own — a wake, Claude Code's own cycle, a goal's round or a resume leaves them,
// and the agent woken meanwhile is told the offer waits; the offer is written as it is made, so a failure or a restart
// after it keeps it. The Plan view has Approve while the plan waits; both ask in the message's own words, so a queued one
// asks the same.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tg from "../src/core/task-graph.js";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";
import { CODER_TASKS_TOOL, LEAD_TASKS_TOOL, TASKS_READS_TOOL, TASKS_TOOL } from "../src/app/agent/tools.js";
import { PROMPT, TOOL_TEXT } from "../src/app/agent/prompt.js";
import { CODER_GRAPH_TEXT } from "../src/app/agent-context.js";
import { JUST_DO_TEXT, PLAN_GO_TEXT, planSendText } from "../src/ui/harness/lib/plan-ask.js";
import { planOfferEl, planReadyEl } from "../src/ui/harness/conversation/turn.js";
import { transcriptTurns } from "../src/ui/harness/conversation/history.js";
import { drawGraph } from "../src/ui/harness/views/task-graph.js";
import { LETTER_WAKE_LINE, WAKE_LINE } from "../src/app/sessions/wake.js";
import { RESUME_LINE } from "../src/app/sessions/resume-cut.js";
import { goalRoundLine } from "../src/core/goal-drive.js";
import { PLAN_OFFER_WAITS } from "../src/app/sessions/service.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { startApp, fakeUpstream, anthropicReply, FAKE_ACP_AGENT } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const T0 = Date.UTC(2026, 10, 6, 12, 0);
/** @param {any} r @returns {any} */
const ok = (r) => (assert.ok(r.ok, JSON.stringify(r)), r);
/** @param {any} r @returns {string} */
const no = (r) => (assert.equal(r.ok, false, JSON.stringify(r)), r.error);
/** @param {any} g @param {string} id @returns {any} */
const task = (g, id) => g.tasks.find((/** @type {any} */ t) => t.id === id);
const AGENT = /** @type {const} */ ("agent");
/** One tasks call, a minute after the last; `planning`: a planning turn runs. @param {any} g @param {any} input @param {boolean} [planning] @param {number} [dt] */
const call = (g, input, planning = false, dt = 60_000) => tg.applyTasks(g, input, { at: T0 + dt, crew: AGENT, planning });
const WORKER = { by: "sub-agent", goal: "it works", steps: ["do it"], acceptance: "it works" };
/** A transcript's row of turn `n`: its message's words, its reply, and what else it says. @param {number} n @param {string} words @param {Record<string, any>} [more] */
const row = (n, words, more = {}) => ({ n, turnId: `t${n}`, requestIds: [`r${n}`], user: { role: "user", content: words ? [{ type: "text", text: words }] : [] }, final: { role: "assistant", content: [{ type: "text", text: `Reply ${n}.` }] }, ...more });
/**
 * The page's timeline (conversation/timeline.js) with a chat's transcript drawn in it, as a reload draws it: its host.
 * @param {any[]} rows  the transcript's turns
 */
async function drawnTimeline(rows) {
  const dom = stubDocument();
  const g = /** @type {any} */ (globalThis);
  const added = ["requestAnimationFrame", "cancelAnimationFrame", "IntersectionObserver", "ResizeObserver", "getComputedStyle", "localStorage", "sessionStorage"].filter((k) => !(k in g));
  try {
    g.requestAnimationFrame ||= () => 0;
    g.cancelAnimationFrame ||= () => {};
    g.IntersectionObserver ||= class { observe() {} unobserve() {} disconnect() {} };
    g.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
    g.getComputedStyle ||= () => ({});
    g.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
    g.sessionStorage ||= g.localStorage;
    Object.assign(g.window, { setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, getSelection: () => ({ toString: () => "", removeAllRanges() {}, rangeCount: 0 }) });
    const { createTimeline } = await import("../src/ui/harness/conversation/timeline.js");
    const host = /** @type {any} */ (document.createElement("div"));
    const tl = createTimeline(host, /** @type {any} */ ({ onPauseChange() {}, onOpenPlan() {} }));
    tl.render({ chainId: "c1", turns: transcriptTurns({ turns: rows }), live: null });
    return host;
  } finally {
    for (const k of added) delete g[k];
    dom.restore();
  }
}
/** The plan offers' cards the page draws for a chat's transcript. @param {any[]} rows @returns {Promise<any[]>} */
const offerCards = async (rows) => (await drawnTimeline(rows)).querySelectorAll(".turn-plan-offer");
/** The number of the turn a card stands under. @param {any} el @returns {string | null} */
const turnOf = (el) => {
  for (let n = el; n; n = n.parentNode) if (n.getAttribute?.("data-turn")) return String(n.getAttribute("data-turn"));
  return null;
};
const PLAN = { action: "add", goal: "Ship the parser", tasks: [{ id: "lexer", name: "Write the lexer", ...WORKER, writes: ["src/lexer.js"] }, { id: "parser", name: "Write the parser", needs: ["lexer"], writes: ["src/parser.js"] }] };

describe("the offer", () => {
  // (fails before: yes — "action must be one of add, start, …, find")
  test("depth light, standard or deep — standard where none is given — and side_by_side; any other depth refused with the call", () => {
    assert.deepEqual(ok(call(null, { action: "offer", depth: "deep", side_by_side: true })).offer, { depth: "deep", side: true });
    assert.deepEqual(ok(call(null, { action: "offer" })).offer, { depth: "standard", side: false });
    assert.equal(no(call(null, { action: "offer", depth: "huge" })), 'depth is light, standard, deep — the plan you suggest\nThe call: {"action":"offer","depth":"standard","side_by_side":false}');
    assert.match(no(call(null, { action: "offer" }, true)), /^you are planning already/);
    assert.ok(!tg.LEAD_ACTIONS.includes("offer"), "a lead plans as its team does");
  });
});

describe("a planning turn and the hold", () => {
  // (fails before: yes — the start went, and the sub-agent's task was a job at once)
  test("starts nothing; what it changes waits for the person's Approve, and Filament starts no sub-agent's task meanwhile", () => {
    assert.match(no(call(null, { action: "start", ids: ["lexer"] }, true)), /^the plan waits for the person's Approve: start none of it in this turn — they approve it, or say go in a message of their own\. Plan, and end your reply/);
    const g = ok(call(null, PLAN, true, 0)).graph;
    assert.deepEqual(g.planning, { at: T0 });
    assert.deepEqual(tg.jobs(g), [], "lexer is ready, and held");
    assert.deepEqual(tg.jobs({ ...g, planning: null }), [{ id: "lexer", kind: "start" }]);
    // (fails before: yes — the hold froze the reviews of work already under way too)
    const reviewing = structuredClone(g);
    Object.assign(task(reviewing, "lexer"), { state: "review", step: "queued", agent: "sa-1" });
    assert.deepEqual(tg.jobs(reviewing), [{ id: "lexer", kind: "review" }], "the work under way goes on");
    assert.match(no(call(g, { action: "parallel", ids: ["lexer", "parser"] })), /^the plan waits for the person's Approve: suggest nothing to start until it goes/, "no side-by-side card on a plan that waits");
    assert.deepEqual(/** @type {any} */ (tg.graphView(g)).planning, { at: T0 });
    assert.match(tg.showText(g, AGENT), /\nThe plan waits for the developer's go: Filament starts none of its sub-agents' tasks until they approve it, in their own words, and you then start a task — one of theirs too, which Filament starts\.\n/);
    const where = String(tg.whereText(g, { crew: AGENT }));
    assert.match(where, /\n- The plan waits for the developer's go: /);
    assert.doesNotMatch(where, /Nothing is running/, "never told to start what waits");
    assert.equal(ok(call(g, { action: "show" }, false)).graph.planning?.at, T0, "a look lets nothing go");
  });

  // (fails before: yes — nothing held the plan, so nothing let it go)
  test("the person's Approve lets it go; so does a start in a later turn — the agent's own task, or a sub-agent's, which Filament then starts", () => {
    const g = ok(call(null, { ...PLAN, tasks: [...PLAN.tasks, { id: "docs", name: "The docs" }] }, true, 0)).graph;
    assert.equal(tg.planGo(g)?.planning, null);
    assert.equal(tg.planGo(tg.planGo(g)), null, "none held: nothing to let go");
    const mine = ok(call(g, { action: "start", ids: ["docs"] }));
    assert.equal(mine.graph.planning, null);
    assert.match(mine.text, /^The plan no longer waits for the person's Approve: Filament starts its sub-agents' tasks and its commands as their needs are done\. Started docs/);
    const theirs = ok(call(g, { action: "start", ids: ["lexer"] }));
    assert.equal(theirs.graph.planning, null);
    assert.match(theirs.text, /^The plan no longer waits for the person's Approve: Filament starts its sub-agents' tasks and its commands as their needs are done, lexer among them\. /);
    assert.deepEqual(tg.jobs(theirs.graph), [{ id: "lexer", kind: "start" }]);
    assert.match(no(call(tg.planGo(g), { action: "start", ids: ["x"] })), /x is no task/, "no plan held: a start as before");
    // (fails before: yes — a coding agent, whose tasks are all its own, heard of sub-agents' tasks and commands Filament starts)
    const own = ok(tg.applyTasks(null, { action: "add", goal: "Ship it", tasks: [{ id: "docs", name: "The docs" }] }, { at: T0, crew: AGENT, solo: true, planning: true })).graph;
    assert.match(ok(tg.applyTasks(own, { action: "start", ids: ["docs"] }, { at: T0 + 1, crew: AGENT, solo: true })).text, /^The plan no longer waits for the person's Approve\. Started docs/);
  });

  // (fails before: yes — a planning turn heard its tasks could run side by side, and the set counted as said, so the
  // hint never came once the plan went)
  test("a planning turn hears nothing of side by side; the set is said once the plan goes", () => {
    const two = { action: "add", goal: "Two", tasks: [{ id: "a", name: "A", writes: ["a.js"] }, { id: "b", name: "B", writes: ["b.js"] }] };
    const planned = ok(call(null, two, true, 0));
    assert.doesNotMatch(planned.text, /side by side/);
    assert.equal((planned.graph.told || []).some((/** @type {string} */ m) => m.startsWith("side:")), false);
    const later = ok(call(tg.planGo(planned.graph), { action: "add", tasks: [{ id: "c", name: "C", needs: ["a"], writes: ["c.js"] }] }));
    assert.match(later.text, /side by side/);
  });

  // (fails before: yes — a planning turn's checklist started its item ticked as doing, and held nothing)
  test("a planning turn's checklist: an item ticked as doing waits, and what it changed waits for the Approve", () => {
    const items = [{ text: "Write the lexer", status: "doing" }, { text: "The docs", status: "pending" }];
    const planned = /** @type {any} */ (tg.applyPlan(null, items, { at: T0, crew: AGENT, planning: true }));
    assert.deepEqual([task(planned.graph, "p1").state, planned.graph.planning], ["waiting", { at: T0 }]);
    assert.match(planned.text, /p1 waits: the plan waits for the person's Approve: start none of it in this turn/);
    const again = tg.applyPlan(planned.graph, items, { at: T0 + 1, crew: AGENT, planning: true });
    assert.equal(task(again.graph || planned.graph, "p1").state, "waiting");
    const free = /** @type {any} */ (tg.applyPlan(null, items, { at: T0, crew: AGENT }));
    assert.deepEqual([task(free.graph, "p1").state, free.graph.planning ?? null], ["running", null]);
    const pending = items.map((x) => ({ ...x, status: "pending" }));
    assert.equal(tg.applyPlan(planned.graph, [...pending, { text: "The tests", status: "pending" }], { at: T0 + 2, crew: AGENT }).graph?.planning?.at, T0, "a checklist in a later turn that starts nothing lets nothing go");
    // (fails before: yes — the review of the words rework: once nothing read the Approve's words, a plan kept on the
    // checklist was held for good — its item ticked as doing in a later turn started it, and the hold stayed)
    const go = /** @type {any} */ (tg.applyPlan(planned.graph, items, { at: T0 + 3, crew: AGENT }));
    assert.deepEqual([task(go.graph, "p1").state, go.graph.planning], ["running", null]);
    assert.match(go.text, /The plan no longer waits for the person's Approve: Filament starts its sub-agents' tasks and its commands as their needs are done\./);
    assert.match(/** @type {any} */ (tg.applyPlan(planned.graph, items, { at: T0 + 3, crew: AGENT, solo: true })).text, /The plan no longer waits for the person's Approve\.(?! Filament)/, "a coding agent's: Filament starts none of its tasks");
  });

  // (fails before: yes — the review of the words rework: a start the graph refused kept the hold, and a command task
  // first in the plan could never be started, so nothing ever ran)
  test("a start in a later turn lets the plan go though the start itself is refused; a command task is Filament's to start", () => {
    const withCmd = { action: "add", goal: "Ship it", tasks: [{ id: "baseline", name: "Baseline", by: "command", run: ["npm test"] }, { id: "lexer", name: "Write the lexer", needs: ["baseline"], writes: ["src/lexer.js"] }] };
    const held = ok(call(null, withCmd, true)).graph;
    assert.ok(held.planning);
    const refusedStart = ok(call(held, { action: "start", ids: ["lexer"] }));
    assert.equal(refusedStart.graph.planning, null);
    assert.match(refusedStart.text, /The plan no longer waits for the person's Approve: .* The start itself was refused: /);
    const cmd = ok(call(held, { action: "start", ids: ["baseline"] }));
    assert.deepEqual([cmd.graph.planning, tg.jobs(cmd.graph).map((/** @type {any} */ j) => [j.id, j.kind])], [null, [["baseline", "command"]]]);
    assert.match(cmd.text, /baseline among them/);
  });

  // (fails before: yes — the review of the words rework: a plan closed while it waited kept its hold)
  test("a closed plan holds nothing", () => {
    const held = ok(call(null, PLAN, true)).graph;
    assert.equal(ok(call(held, { action: "close", reason: "not needed" })).graph.planning, null);
  });
});

describe("the /plan line", () => {
  // (fails before: yes — /plan had one depth, and its turn was the chat's own mode)
  // (fails before: yes — the owner's of 11-06, "not everyone speaks English": Filament read a depth out of the words, and
  // the line said only the one it read)
  test("every /plan's line says what a light and a deep plan are, for the agent to weigh the person's words; side by side, the switch's, its own; every one says the turn is read-only", () => {
    const std = tg.planAskLine();
    assert.match(std, /a big part as a step, its pieces sub-tasks under it/);
    assert.match(std, /\nThis turn is read-only: read and search all you need, but change no file and start no task — the person approves the plan first\. .* Filament shows them a card that opens the Plan, with Approve and Amend\./);
    assert.match(std, /\n- Where their words ask for a light plan: a few tasks, a line each, no notes behind them\. For a deep one: map the code widely first — .* Weigh what they ask against the work\.\n/);
    assert.doesNotMatch(std, /Parallelize tasks/);
    assert.match(tg.planAskLine({ side: true }), /\n- Parallelize tasks is on, which is their consent: give each task only the needs it truly waits on and the files it writes/);
  });

  // (fails before: yes — the card wrote "/plan standard, side by side: …", which the session parsed back; then "/plan
  // deep: <the whole message>", the owner's message twice in the transcript)
  test("the card's Plan sends /plan with how deep alone, never the message again; the line says a /plan without its work plans the message before it", () => {
    assert.deepEqual([planSendText("deep"), planSendText("standard"), planSendText("light"), planSendText("")], ["/plan deep", "/plan", "/plan light", "/plan"]);
    for (const line of [tg.planAskLine(), tg.planAskLine({ side: true }), tg.planAskLine({ off: "words" })])
      assert.match(line, /Their words, if any, follow \/plan in their message below; where those say only how deep, or nothing, plan the work their message before it asks for\.\]$/);
    assert.equal("planAskOf" in tg, false, "nothing reads them back");
    assert.equal("PLAN_GO_TEXT" in tg, false, "nor an Approve's words");
  });
});

describe("the tools' and the prompt's words", () => {
  // (fails before: yes — no offer, no depth)
  test("the agent and a coding agent offer; a lead never; the coding agent's text stays under Claude Code's 2,048", () => {
    for (const t of [TASKS_TOOL, TASKS_READS_TOOL, CODER_TASKS_TOOL]) {
      const p = /** @type {any} */ (t.input_schema.properties);
      assert.ok(p.action.enum.includes("offer"), t.description.slice(0, 40));
      assert.deepEqual(p.depth.enum, ["light", "standard", "deep"]);
      assert.equal(p.side_by_side.type, "boolean");
      // A coding agent's says each action at action (the owner's tool plan of 11-08); the loop's say it in their text.
      if (t === CODER_TASKS_TOOL) assert.match(p.action.description, /offer: a card asking the person whether to plan first; then end your reply\./);
      else assert.match(t.description, /offer — /);
    }
    const lead = /** @type {any} */ (LEAD_TASKS_TOOL.input_schema.properties);
    assert.deepEqual([lead.action.enum.includes("offer"), "depth" in lead, /offer — /.test(LEAD_TASKS_TOOL.description)], [false, false, false]);
    assert.ok(TOOL_TEXT.coderTasks.length < 2048, String(TOOL_TEXT.coderTasks.length));
    assert.match(PROMPT.graph, /\n- Complex work nobody asked you to plan .* you offer to plan first, before you change anything: tasks offer, .* Just do it skips planning first, never the checklist or the graph: the work goes on them as you do it\. Small work you just do, on the checklist where it takes more than one step\. While you plan, the turn is read-only/);
    assert.match(CODER_GRAPH_TEXT, /\n- Complex work nobody asked you to plan: offer to plan it first, .* Plan with Filament's tasks tool, never a plan mode of your own\./);
  });
});

describe("the runner", () => {
  const rig = () => {
    /** @type {Map<string, any>} */
    const chains = new Map([["c1", { id: "c1", meta: {} }]]);
    /** @type {any[]} */
    const launched = [];
    /** @type {any[]} */
    const modes = [];
    /** @type {any[]} */
    const offered = [];
    const registry = {
      launch: (/** @type {any} */ spec) => (launched.push(spec.task?.id), modes.push(`launch:${spec.mode ?? null}`), { ok: false, error: "no launches here" }),
      slots: () => 4,
      tell: () => {},
      stop: () => ({ ok: true }),
      resumable: () => null,
      checkProblem: (/** @type {string} */ _c, /** @type {string[]} */ _cmds, /** @type {any} */ o) => (modes.push(o?.mode ?? null), o?.mode === "read-only" ? "this session is read-only, so Filament runs no check in it: leave check out" : null),
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
    let refuse = "";
    const runner = createGraphRunner({
      archive,
      registry: /** @type {any} */ (registry),
      events: { publish: () => {} },
      crew: () => AGENT,
      log: () => {},
      now: () => T0,
      offerPlan: (chainId, o) => {
        if (refuse) throw new Error(refuse);
        offered.push({ chainId, ...o });
      },
    });
    runner.attach("c1", { runId: "turn-1", cwd: "/p", mode: "read-only", model: "m", thinking: null, team: null });
    return { runner, launched, modes, offered, graph: () => chains.get("c1").meta.graph, seed: (/** @type {any} */ g) => void (chains.get("c1").meta.graph = g), refuse: (/** @type {string} */ w) => void (refuse = w) };
  };
  const O = { crew: AGENT };

  // (fails before: yes — offer was no action, a planning turn started the sub-agent's task, and its check was refused)
  test("an offer marks the person's turn; a planning turn holds its plan, weighs checks against the session's own mode, and the Approve starts what is ready", () => {
    const r = rig();
    const said = ok(r.runner.apply("c1", { action: "offer", depth: "deep", side_by_side: true }, O));
    assert.deepEqual(r.offered, [{ chainId: "c1", depth: "deep", side: true }]);
    assert.equal(said.text, "Offered: under your reply, Filament shows the person a card — Plan first (deep suggested, its tasks parallelized, theirs to change) or Just do it. End your reply now, with a line on why you would plan first; change nothing until they choose.");
    r.refuse("this reply offers it already: one a reply");
    assert.equal(no(r.runner.apply("c1", { action: "offer" }, O)), "this reply offers it already: one a reply");
    r.runner.planTurn("c1", true);
    ok(r.runner.apply("c1", { ...PLAN, tasks: [{ ...PLAN.tasks[0], check: ["npm test"] }, PLAN.tasks[1]] }, O));
    assert.deepEqual(r.modes, [null], "the chat's own mode, not the turn's read-only one");
    assert.deepEqual([r.graph().planning, r.launched], [{ at: T0 }, []]);
    r.runner.planTurn("c1", false);
    // The person's go, in their words: their agent starts a task — its sub-agent's one too —, and the plan goes.
    ok(r.runner.apply("c1", { action: "start", ids: ["lexer"] }, O));
    assert.equal(r.graph().planning, null);
    assert.deepEqual(r.launched, ["lexer"], "Filament started what was ready");
  });

  // (fails before: yes — a coding agent's helper launched for a task of the plan started it in the planning turn, and
  // in a later turn left the plan held)
  test("a coding agent's helper: no task of a waiting plan in a planning turn; in a later turn, its launch lets the plan go", () => {
    const r = rig();
    r.runner.planTurn("c1", true);
    ok(r.runner.apply("c1", { ...PLAN, tasks: [...PLAN.tasks, { id: "docs", name: "The docs" }] }, O));
    assert.match(String(r.runner.helperRefusal("c1", "docs")), /^docs is a task of the plan, which waits for the person's Approve: start none of it in this turn/);
    r.runner.planTurn("c1", false);
    assert.equal(r.runner.helperRefusal("c1", "docs"), null);
    r.runner.helperTook("c1", "docs", { agent: "sa-1", model: "m", copy: false, at: T0 });
    assert.deepEqual([r.graph().planning, task(r.graph(), "docs").state], [null, "running"]);
  });

  // (fails before: yes — a look in the planning turn let the stop go and started the stopped work, under the turn's
  // read-only mode)
  test("a planning turn lets go of no stop; what Filament starts meanwhile runs under the session's mode, not the turn's", () => {
    const r = rig();
    const g = ok(call(null, PLAN, false, 0)).graph;
    r.seed(tg.hold(g, T0));
    r.runner.planTurn("c1", true);
    ok(r.runner.apply("c1", { action: "show" }, O));
    assert.deepEqual([r.launched, !!r.graph().held], [[], true], "the stop holds until a tasks call of a later turn");
    r.seed(g);
    ok(r.runner.apply("c1", { action: "show" }, O));
    assert.deepEqual([r.launched, r.modes], [["lexer"], ["launch:null"]], "work the person let go before runs on, in the chat's own mode");
  });
});

describe("the cards", () => {
  // (fails before: yes — there was no offer card, and the plan's card had View the plan alone)
  test("the offer: the agent's depth chosen, the person's to change; Plan sends it with the words; Just do it; the newest turn alone", () => {
    const doc = stubDocument();
    try {
      /** @type {any[]} */
      const sent = [];
      let just = 0;
      const turn = { planOffer: { depth: "deep", side: true }, status: "done", userText: "Add OAuth to the login" };
      const on = { onPlan: (/** @type {any} */ o) => sent.push(o), onJustDo: () => just++ };
      const card = /** @type {any} */ (planOfferEl(turn, true, on));
      assert.match(card.textContent, /Your agent offers to plan this first/);
      const buttons = card.querySelectorAll("button");
      const labels = buttons.map((/** @type {any} */ b) => b.textContent);
      // Parallelize tasks is no switch of the card's: Settings › Experimental's holds for every chat (the owner's of 11-08).
      assert.deepEqual(labels, ["Light", "Standard", "Deep", "Plan", "Just do it"]);
      assert.deepEqual(buttons.slice(0, 3).map((/** @type {any} */ b) => b.getAttribute("aria-checked")), ["false", "false", "true"]);
      buttons[3].dispatch("click");
      buttons[0].dispatch("click");
      assert.deepEqual(buttons.slice(0, 3).map((/** @type {any} */ b) => b.getAttribute("aria-checked")), ["true", "false", "false"]);
      buttons[3].dispatch("click");
      buttons[4].dispatch("click");
      assert.deepEqual(sent, [{ words: "Add OAuth to the login", depth: "deep" }, { words: "Add OAuth to the login", depth: "light" }]);
      assert.equal(just, 1);
      assert.equal(planOfferEl(turn, false, on), null, "a message of the person's own came after it: its moment has passed");
      assert.equal(planOfferEl({ ...turn, status: "stopped" }, true, on), null);
      assert.equal(planOfferEl({ ...turn, stopped: { by: "harness" } }, true, on), null);
      assert.equal(planOfferEl({ ...turn, userText: "(attachments)" }, true, on), null);
      assert.equal(planOfferEl({ status: "done", userText: "x" }, true, on), null);
      // (fails before: yes — the offer is written as it is made, but a turn that failed after it, or that a restart cut
      // off, drew no card)
      assert.ok(planOfferEl({ ...turn, status: "error" }, true, on), "a failure after the offer keeps it");
      assert.ok(planOfferEl({ ...turn, status: "open", cutOff: true }, true, on), "so does a restart");
      assert.equal(planOfferEl({ ...turn, status: "open" }, true, on), null, "a turn still running elsewhere: not yet");
      assert.equal(planOfferEl({ ...turn, status: "streaming" }, true, on), null);
    } finally {
      doc.restore();
    }
  });

  // (fails before: yes — the card stood on the chat's newest turn alone, so a letter's wake, a report's, Claude Code's own
  // cycle, a goal's round or a resume after it hid it before the person ever saw it)
  test("the offer's card stands until the person's next own message: a turn they did not send leaves it drawn", async () => {
    const offered = row(1, "Add OAuth to the login", { planOffer: { depth: "deep", side: false } });
    const woken = row(2, LETTER_WAKE_LINE, { by: "wake", woke: true });
    assert.equal((await offerCards([offered, woken])).length, 1, "a letter's wake");
    const others = [
      row(3, WAKE_LINE, { by: "wake", woke: true }),
      row(4, "", { by: "agent", own: { agent: "Claude Code", tasks: [] } }),
      row(5, goalRoundLine(2, 20), { by: "goal", goalRound: { round: 2, cap: 20 } }),
      row(6, RESUME_LINE, { by: "resume", resumed: true }),
    ];
    const cards = await offerCards([offered, woken, ...others]);
    assert.deepEqual(cards.map(turnOf), ["1"], "under the turn that offered it, through every one of them");
    assert.deepEqual(await offerCards([offered, woken, ...others, row(7, "Just tweak the readme instead")]), [], "the person's own message ends it");
    // A /plan's Approve stands the same way: a wake leaves it on the plan's card.
    const planned = row(1, "/plan the parser", { plan: true, planReady: { tasks: 2, steps: 0, goal: "Ship it" } });
    const approve = async (/** @type {any[]} */ rows) => (await drawnTimeline(rows)).querySelectorAll(".turn-plan-ready button").map((/** @type {any} */ b) => b.textContent);
    assert.deepEqual(await approve([planned, woken]), ["View the plan", "Approve", "Amend"]);
    assert.deepEqual(await approve([planned, woken, row(3, "Go on")]), ["View the plan"]);
  });

  test("the plan's card: Approve and Amend on the newest turn; the Approve's message says so on its row", () => {
    const doc = stubDocument();
    try {
      const acts = { approve: 0, amend: 0 };
      const turn = { planReady: { tasks: 3, steps: 0, goal: "Ship it" }, status: "done" };
      const card = /** @type {any} */ (planReadyEl(turn, () => {}, { onApprove: () => acts.approve++, onAmend: () => acts.amend++ }));
      const buttons = card.querySelectorAll("button");
      assert.deepEqual(buttons.map((/** @type {any} */ b) => b.textContent), ["View the plan", "Approve", "Amend"]);
      buttons[1].dispatch("click");
      buttons[2].dispatch("click");
      assert.deepEqual(acts, { approve: 1, amend: 1 });
      assert.deepEqual(/** @type {any} */ (planReadyEl(turn, () => {})).querySelectorAll("button").map((/** @type {any} */ b) => b.textContent), ["View the plan"]);
      assert.deepEqual([PLAN_GO_TEXT, JUST_DO_TEXT], ["Go — the plan is approved.", "Just do it, no planning first."], "words for the agent to read");
    } finally {
      doc.restore();
    }
  });

  // (fails before: yes — the Plan view said nothing of a plan that waits, and a woken turn hid the card's Approve)
  test("the Plan view: a plan that waits says so, with Approve; its ready task says what it waits for", () => {
    const g = ok(call(null, PLAN, true, 0)).graph;
    let approved = 0;
    const el = drawGraph(tg.graphView(g), { h: fakeH, now: T0, onApprove: () => approved++ }).el;
    /** @param {any} n @returns {any[]} */
    const all = (n) => (n && typeof n === "object" ? [n, ...(n.kids || []).flatMap(all)] : []);
    const callout = all(el).find((n) => String(n.attrs?.class || "").includes("tg-plan-wait"));
    assert.equal(textOf(callout), "Waits for your approval| — Filament starts no agent's task until you approve the plan. To change it, send /plan with what to change.|Approve");
    buttonsOf(callout)[0].attrs.onclick();
    assert.equal(approved, 1);
    const tips = all(el).filter((n) => String(n.attrs?.class || "").split(/\s+/).includes("tg-node") && String(n.attrs["aria-label"]).startsWith("lexer "));
    assert.match(String(tips[0].attrs.title), /waits for your Approve/);
    // (fails before: yes — while the agent's turn ran, the Approve went into it as a note, and the plan stayed held)
    const busy = drawGraph(tg.graphView(g), { h: fakeH, now: T0, onApprove: null, approveLater: true }).el;
    const later = all(busy).find((n) => String(n.attrs?.class || "").includes("tg-plan-wait"));
    assert.deepEqual([buttonsOf(later).length, textOf(later).endsWith("|Approve once your agent's turn ends")], [0, true]);
    const free = drawGraph(tg.graphView({ ...g, planning: null }), { h: fakeH, now: T0, onApprove: () => approved++ }).el;
    assert.equal(all(free).find((n) => String(n.attrs?.class || "").includes("tg-plan-wait")), undefined);
  });
});

describe("end to end: plan mode through a real Filament", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** The newest user message's text blocks. @param {any} body @returns {string[]} */
  const lastTexts = (body) => {
    const last = [...(body?.messages || [])].reverse().find((/** @type {any} */ m) => m.role === "user");
    return Array.isArray(last?.content) ? last.content.filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => String(b.text)) : [String(last?.content ?? "")];
  };
  /** A request's newest tool result's text, by its call's id. @param {any} body @param {string} id */
  const resultOf = (body, id) => {
    const b = (body?.messages?.at(-1)?.content || []).find?.((/** @type {any} */ x) => x?.type === "tool_result" && x.tool_use_id === id);
    if (!b) return null;
    return typeof b.content === "string" ? b.content : (b.content || []).map((/** @type {any} */ x) => x.text || "").join("");
  };
  /** @param {any[]} blocks @param {string} [stop] */
  const reply = (blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks });
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-plan-mode-"));
    up = await fakeUpstream(async (c) => {
      if (c.kind !== "anthropic") return undefined;
      const body = c.body || {};
      if (!(body.tools || []).length) return anthropicReply("A title", { model: "brain-model" });
      const texts = lastTexts(body);
      // The model's call after the offer fails, and the turn with it.
      if (resultOf(body, "offer-fails") !== null) return { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "the call after the offer failed" } } };
      if (texts.some((t) => t.includes("Move the store to SQLite"))) return reply([{ type: "tool_use", id: "offer-fails", name: "tasks", input: { action: "offer", depth: "light" } }], "tool_use");
      if (resultOf(body, "offer") !== null || resultOf(body, "plan") !== null || resultOf(body, "write3") !== null) return reply([{ type: "text", text: "Done for now." }]);
      // The /plan's agent writes, is refused, asks; the answer's turn writes again, is refused, and plans.
      if (resultOf(body, "write2") !== null) return reply([{ type: "tool_use", id: "plan", name: "tasks", input: PLAN }], "tool_use");
      if (resultOf(body, "ask") !== null) return reply([{ type: "tool_use", id: "write2", name: "write", input: { path: "src/grammar.js", content: "x" } }], "tool_use");
      if (resultOf(body, "write") !== null) return reply([{ type: "tool_use", id: "ask", name: "ask", input: { question: "PEG or LR?" } }], "tool_use");
      // The person's own message while the plan waits: their turn, in the chat's own mode — its question's answer too.
      if (resultOf(body, "ask2") !== null) return reply([{ type: "tool_use", id: "write3", name: "write", input: { path: "README.md", content: "x" } }], "tool_use");
      if (texts.some((t) => t.includes("Tweak the readme"))) return reply([{ type: "tool_use", id: "ask2", name: "ask", input: { question: "Which section?" } }], "tool_use");
      // The card's Approve's words reach the agent as words: this one answers, and starts nothing. A go in the person's
      // own words, not English: their agent reads it, and starts the plan.
      if (texts.includes(PLAN_GO_TEXT)) return reply([{ type: "text", text: "Noted." }]);
      if (resultOf(body, "go") !== null) return reply([{ type: "text", text: "Started." }]);
      if (texts.some((t) => t.includes("Adelante"))) return reply([{ type: "tool_use", id: "go", name: "tasks", input: { action: "start", ids: ["lexer"] } }], "tool_use");
      if (texts.some((t) => t.includes("Add OAuth"))) return reply([{ type: "tool_use", id: "offer", name: "tasks", input: { action: "offer", depth: "deep", side_by_side: true } }], "tool_use");
      if (texts.some((t) => t.includes("the parser"))) return reply([{ type: "tool_use", id: "write", name: "write", input: { path: "src/lexer.js", content: "x" } }], "tool_use");
      return reply([{ type: "text", text: "ok" }]);
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
        cfg.experimental = { ...cfg.experimental, parallelizeTasks: true };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    await removeDirs(shim?.dataDir, root);
  });
  const chat = async () => {
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { loop: { permissions: "auto" } } } });
    assert.equal(created.status, 200, await created.clone().text());
    return `/api/sessions/${encodeURIComponent(String((await created.json()).id))}`;
  };
  /** @param {string} path @param {Record<string, any>} body */
  const send = async (path, body) => {
    const r = await shim.api(`${path}/turns`, { method: "POST", body: { stream: false, ...body } });
    assert.equal(r.status, 200, await r.clone().text());
    return r;
  };
  /** @param {string} path */
  const turns = async (path) => /** @type {any[]} */ ((await (await shim.api(`${path}/transcript`)).json()).turns || []);
  /** @param {string} path */
  const graphOf = async (path) => /** @type {any} */ ((await (await shim.api(path)).json()).inForce?.graph ?? null);

  // (fails before: yes — the agent's offer was refused, and no card followed its reply)
  test("the agent's offer is stamped on its reply for the card", async () => {
    const path = await chat();
    await send(path, { content: "Add OAuth to the login" });
    const t = (await turns(path)).at(-1);
    assert.deepEqual(t.planOffer, { depth: "deep", side: true });
  });

  // (fails before: yes — the offer was stamped only on a turn that ended with its reply, so a failure after it lost it)
  test("the offer is written to the turn's row as it is made: a failure after it keeps the card", async () => {
    const path = await chat();
    const r = await shim.api(`${path}/turns`, { method: "POST", body: { stream: false, content: "Move the store to SQLite" } });
    assert.notEqual(r.status, 200, "the turn failed after the offer");
    const rows = await turns(path);
    assert.deepEqual([rows.length, rows[0].planOffer, !!rows[0].final], [1, { depth: "light", side: false }, false]);
    assert.deepEqual((await offerCards(rows)).map(turnOf), ["1"], "the page draws the card under the failed turn");
  });

  // (fails before: yes — the /plan's turn wrote src/lexer.js in the chat's auto mode, and the sub-agent's task started)
  test("a /plan's turn, and its question's answer, is read-only, its plan held; the person's own turn is theirs; their go, in any words, goes to their agent, whose start lets it go", async () => {
    const path = await chat();
    up.reset();
    await send(path, { content: "/plan deep: the parser", plan: true, side: true });
    const asked = up.received.find((c) => lastTexts(c.body)[0]?.startsWith("[Filament: the person typed /plan."));
    assert.ok(asked, "the line reached the agent");
    assert.match(lastTexts(asked.body)[0], /\n- Where their words ask for a light plan: .*\n- Parallelize tasks is on, which is their consent: /);
    assert.equal(lastTexts(asked.body).at(-1), "/plan deep: the parser", "the depth is the agent's to read, in the words");
    const wrote = up.received.map((c) => resultOf(c.body, "write")).find((x) => x !== null);
    assert.match(String(wrote), /read-only/i, "the write was refused");
    assert.equal(existsSync(join(root, "src", "lexer.js")), false);
    // (fails before: yes — the answer's turn was the chat's own mode, and it wrote src/grammar.js; with a command sent
    // between, the answer read the command's row and was the chat's own mode again)
    // The question the /plan's agent asked: its answer's turn plans on, read-only — a command sent meanwhile aside.
    await send(path, { content: "/status" });
    await send(path, { content: "PEG" });
    const answered = up.received.map((c) => resultOf(c.body, "write2")).find((x) => x !== null);
    assert.match(String(answered), /read-only/i, "the answer's write was refused");
    assert.equal(existsSync(join(root, "src", "grammar.js")), false);
    const held = await graphOf(path);
    assert.ok(held?.planning, "the plan waits for the Approve");
    assert.equal(held.tasks.find((/** @type {any} */ x) => x.id === "lexer").state, "waiting", "its sub-agent's task did not start");
    // (fails before: yes — the answer to a question in the person's own turn, while the plan waited, was read-only)
    await send(path, { content: "Tweak the readme" });
    await send(path, { content: "the top" });
    assert.equal(existsSync(join(root, "README.md")), true, "their own turn, and its answer, is the chat's own mode");
    assert.ok((await graphOf(path))?.planning, "still held: the agent started nothing");
    // (fails before: yes — the session read the Approve by its English words and let the plan go itself)
    const go = await send(path, { content: PLAN_GO_TEXT });
    assert.equal(go.headers.get("x-filament-plan-go"), null);
    assert.ok((await graphOf(path))?.planning, "words alone let nothing go: their agent answered, and started nothing");
    await send(path, { content: "Adelante, empieza" });
    const went = await graphOf(path);
    assert.equal(went?.planning, null, "their agent read the go and started a task");
    assert.notEqual(went.tasks.find((/** @type {any} */ x) => x.id === "lexer").state, "waiting", "Filament started the sub-agent's task");
  });
});

describe("end to end: a coding agent's offer, then a letter wakes its chat", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-plan-offer-acp-"));
    shim = await startApp({
      memory: true,
      configure: (cfg, { dataDir }) => {
        cfg.upstreams = [{ id: "coder", name: "coder", type: "acp", enabled: true, acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_MCP_CAPS: "http" }, cwdDefault: dataDir, permissions: "allow-all", clientBridge: "full" } }];
        cfg.routes = [{ match: "coder-*", upstream: "coder", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.engine = { ...(cfg.memory.engine || {}), autoInstall: false };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await removeDirs(root);
  });
  const chat = async () => {
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "coder-1", preset: "plain", settings: {} } });
    assert.equal(made.status, 200, await made.clone().text());
    return String((await made.json()).id);
  };
  /** The words of the agent's reply. @param {string} id @param {string} content */
  const say = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    const json = await r.json();
    assert.equal(r.status, 200, JSON.stringify(json));
    return (json.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("");
  };
  /** @param {string} id */
  const transcript = async (id) => /** @type {any} */ (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json());

  // (fails before: yes — the letter's wake was the chat's newest turn, so the page drew no card; and the woken agent was
  // told nothing of the offer)
  test("the fake Claude offers through MCP; a letter from another chat wakes it: the transcript still draws the card, and the woken agent is told it waits", async () => {
    const offering = await chat();
    assert.match(await say(offering, `Add OAuth to the login ~mcpcall tasks ${JSON.stringify({ action: "offer", depth: "deep" })}`), /mcp:Offered/);
    assert.deepEqual((await transcript(offering)).turns[0].planOffer, { depth: "deep", side: false });
    const writer = await chat();
    const letter = { to: offering, subject: "Login page", text: "I'm changing the login page too." };
    assert.match(await say(writer, `[OAuth](chat:${offering}) ~mcpcall envelope ${JSON.stringify(letter)}`), /mcp:Sent: letter/);
    const tr = await until(async () => {
      const t = await transcript(offering);
      return (t.turns || []).length >= 2 && t.turns[1].final && !t.live ? t : null;
    }, "the chat woken by the letter, its turn ended", { timeoutMs: 30_000 });
    const woken = tr.turns[1];
    assert.equal(woken.woke, true, "Filament's own turn");
    assert.equal(tr.turns[0].planOffer?.depth, "deep");
    assert.deepEqual((await offerCards(tr.turns)).map(turnOf), ["1"], "the card stands under the turn that offered it");
    const told = (woken.user?.content || []).map((/** @type {any} */ b) => String(b?.text || ""));
    assert.ok(told.includes(PLAN_OFFER_WAITS), JSON.stringify(told));
    assert.equal(told.at(-1), LETTER_WAKE_LINE, "Filament's line for a letter ends it, as ever");
    // The person's own message ends the offer: its turn hears nothing of it, and the card goes.
    await say(offering, "Just tweak the readme");
    const after = await transcript(offering);
    assert.ok(!JSON.stringify(after.turns.at(-1).user).includes(PLAN_OFFER_WAITS));
    assert.deepEqual(await offerCards(after.turns), []);
  });
});
