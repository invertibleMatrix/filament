// @ts-check
// A turn the loop paused on — a question, a permission — keeps a line pointing to the dock. While a coding agent is the
// chat's model, the dock offers no answer: the loop's pause waits for Filament's agent (loop-pause-coder.test.js). The
// line said "Waiting for your answer, below" all the same, an answer the person could not give there. It says what the
// dock says, and follows the chat's model as it changes, both ways. A coding agent's own questions on its run — its plan
// among them — are the person's to answer: their lines keep their words. The real timeline is drawn here, on the stub
// document.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";
import { lift } from "./helpers/app-lift.js";
import { createDecisions } from "../src/ui/harness/conversation/decisions.js";

/** @type {ReturnType<typeof stubDocument>} */
let dom;
/** @type {any} */
let tl;
/** @type {any} */
let host;
/** The coding agent that is the chat's model, by name; "" for Filament's agent. */
let coder = "";
const g = /** @type {any} */ (globalThis);
const ADDED = ["requestAnimationFrame", "cancelAnimationFrame", "IntersectionObserver", "ResizeObserver", "getComputedStyle", "localStorage", "sessionStorage"].filter((k) => !(k in g));
const fetchWas = g.fetch;

before(async () => {
  dom = stubDocument();
  g.requestAnimationFrame ||= () => 0;
  g.cancelAnimationFrame ||= () => {};
  g.IntersectionObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  g.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  g.getComputedStyle ||= () => ({});
  g.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
  g.sessionStorage ||= g.localStorage;
  Object.assign(g.window, { setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, getSelection: () => ({ toString: () => "", removeAllRanges() {}, rangeCount: 0 }) });
  const d = /** @type {any} */ (dom.document);
  d.addEventListener ||= () => {};
  d.removeEventListener ||= () => {};
  g.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  const { createTimeline } = await import("../src/ui/harness/conversation/timeline.js");
  host = document.createElement("div");
  tl = createTimeline(host, /** @type {any} */ ({ onPauseChange() {}, onToDecision() {}, coderName: () => coder }));
});
after(() => {
  g.fetch = fetchWas;
  for (const k of ADDED) delete g[k];
  dom.restore();
});

const PAUSES = [
  { kind: "ask", question: "Which grammar?" },
  { kind: "permission", tool: "bash", question: "May I run this command?", command: "npm publish" },
];
/** Each pause's line: under a coding agent, then under Filament's agent. @type {Record<string, [string, string]>} */
const WORDS = {
  ask: ["Its question waits for Filament's agent, below", "Waiting for your answer, below"],
  permission: ["Its permission waits for Filament's agent, below", "Waiting for your permission, below"],
};

/** A chat whose one turn is settled and waits: on the loop's `paused`, or on its run's `waiting`. @param {any} waits */
const chatWith = (waits) => {
  const turn = { n: 1, history: true, past: true, status: "done", requestId: "rq1", userText: "go on", blocks: [{ type: "text", text: "Before I go on:" }], steers: [], segments: [], ...waits };
  return { chat: { chainId: "c1", turns: [turn] }, turn };
};
/** The lines on screen pointing to the dock. */
const pointers = () => [...host.querySelectorAll(".pp-pointer")].map((/** @type {any} */ p) => p.textContent);
/** @param {any} p @param {any[]} k */
const place = (p, k) => p.replaceChildren(...k);
const io = { answer() {}, always() {}, workerAnswer: async () => true, workerAlways: async () => true, reveal() {}, agentAnswer: async () => "", agentPlan: async () => "", agentPermission() {}, open() {} };

// (fails before: yes — under Claude Code the loop's question's line read "Waiting for your answer, below", over a dock
// that offers no answer)
test("the loop's pause while a coding agent is the chat's model: its line says it waits for Filament's agent, as the dock's head does", () => {
  for (const paused of PAUSES) {
    coder = "Claude Code";
    const { chat, turn } = chatWith({ paused });
    tl.render(chat);
    assert.deepEqual(pointers(), [WORDS[paused.kind][0]], `${paused.kind}: drawn with the chat`);
    const dock = createDecisions(/** @type {any} */ (io), { h: fakeH, place, later: () => {} });
    dock.paint(/** @type {any} */ ({ chat, rows: [], view: "chat", team: null, coder }));
    assert.equal(`${textOf(dock.el.querySelector("dlw-head"))}, below`, pointers()[0], `${paused.kind}: the dock's words`);
    // A pause that lands while the agent is the chat's model says the same.
    const { chat: live, turn: next } = chatWith({});
    tl.render(live);
    assert.deepEqual(pointers(), []);
    tl.setPaused(next, paused);
    assert.deepEqual(pointers(), [WORDS[paused.kind][0]], `${paused.kind}: as it pauses`);
    // Filament's agent the chat's model: as ever.
    coder = "";
    tl.render(chat);
    assert.deepEqual(pointers(), [WORDS[paused.kind][1]], `${paused.kind}: under Filament's agent`);
    assert.equal(turn.paused, paused);
  }
});

// (fails before: yes — the timeline had no way to draw the line again on a change of model: `tl.paintPointers` not a
// function, the line kept the words it was drawn with)
test("the chat's model changes while the loop's question waits: its line is drawn anew, to a coding agent and back; kept while its words hold", () => {
  coder = "";
  const { chat } = chatWith({ paused: PAUSES[0] });
  tl.render(chat);
  assert.deepEqual(pointers(), ["Waiting for your answer, below"]);
  const first = host.querySelector(".pp-pointer");
  tl.paintPointers();
  assert.equal(host.querySelector(".pp-pointer"), first, "nothing changed: the same line");
  coder = "Codex";
  tl.paintPointers();
  assert.deepEqual(pointers(), ["Its question waits for Filament's agent, below"], "to a coding agent");
  const second = host.querySelector(".pp-pointer");
  coder = "Claude Code";
  tl.paintPointers();
  assert.equal(host.querySelector(".pp-pointer"), second, "another coding agent: the same words, the same line");
  coder = "";
  tl.paintPointers();
  assert.deepEqual(pointers(), ["Waiting for your answer, below"], "back to Filament's agent");
});

// (fails before: yes — the dock's paint never asked the timeline to draw the line again: painted 0)
test("the page's side: the dock's paint, run as the chat's model changes and as a pause does, draws the turn's line again with it", () => {
  let painted = 0;
  const fns = lift(["paintDock"], {
    chatOf: () => ({ id: "c1", chainId: "s1", turns: [], view: { settings: { engine: { coder: "claude" } } } }),
    state: { currentId: "c1" },
    coderNameOf: () => "Claude Code",
    decisions: { paint() {} },
    transcript: { paintPointers: () => void painted++ },
  });
  fns.paintDock();
  assert.equal(painted, 1, "the dock's paint draws the line again");
});

// (fails before: no — a guard: these lines read as they did before the fix; it fails against a line that says the loop's
// words for whatever waits while a coding agent is the chat's model)
test("a coding agent's own questions on its run, its plan among them, keep their words under the agent: the person answers them", () => {
  const ask = (/** @type {string} */ kind, /** @type {any} */ more = {}) => ({ type: "ask", kind, id: `${kind}:run_1:1`, runId: "run_1", waits: true, form: { kind }, ...more });
  const cases = [
    [[ask("question")], "Waiting for your answer, below"],
    [[ask("permission")], "Waiting for your permission, below"],
    [[ask("proposal"), ask("question", { id: "q2" })], "A plan waits for your decision and 1 more, below"],
  ];
  for (const [waiting, words] of cases) {
    const { chat } = chatWith({ waiting });
    coder = "Claude Code";
    tl.render(chat);
    assert.deepEqual(pointers(), [words]);
    coder = "";
    tl.render(chat);
    assert.deepEqual(pointers(), [words], "the same under Filament's agent");
  }
});
