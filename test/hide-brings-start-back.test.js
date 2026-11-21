// @ts-check
// Hiding the only card of an agent asked before a chat's first turn brings the Start board back (the Hunter's of 11-01, a
// Medium, over the owner's Hide of the same day): the card left the chat and the chat stood blank — the Start board
// gave way to the cards of `c.asked` while any was drawn, a hidden one among them, and nothing asked again once one was
// hidden. The real timeline and agent card are drawn on the stub document.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";

const g = /** @type {any} */ (globalThis);
const ADDED = ["requestAnimationFrame", "cancelAnimationFrame", "IntersectionObserver", "ResizeObserver", "getComputedStyle", "localStorage", "sessionStorage"].filter((k) => !(k in g));
const CHIP_KEYS = ["cardMarks", "subagentRow", "subagentsKnown", "subagentDelivery", "watchSubagents", "cardClosed"];
/** @type {ReturnType<typeof stubDocument>} */
let dom;
/** @type {any} */
let tl;
/** @type {any} */
let host;
/** @type {any} */
let chipActions;
/** The cards' follows of the session's list: told as the store is touched. @type {Set<() => void>} */
const listeners = new Set();
/** The cards this browser keeps hidden, by agent and exchange. @type {Set<string>} */
const hidden = new Set();

const QUESTION = "should a fifth launch queue or fail?";
const sent = { type: "subagent", event: "dispatch", agentId: "sa_1", exchange: 0, at: 1_000, model: "zai/glm-5.3", card: { tag: "pm", name: "PM" }, asked: true, question: QUESTION };
const back = { ...sent, event: "arrival", status: "done", ms: 9_000, answer: "Fail.", delivery: "held" };
const ended = { id: "sa_1", status: "done", model: "zai/glm-5.3", card: { tag: "pm", name: "PM" }, asked: true, may: "read", description: QUESTION, exchanges: [{ status: "done", startedAt: 1_000, endedAt: 10_000, delivery: "held", report: "Fail." }], progress: null };

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
  ({ chipActions } = await import("../src/ui/harness/conversation/tools/layout.js"));
  Object.assign(chipActions, {
    cardMarks: () => ({ dispatch: sent, arrival: back }),
    subagentRow: () => ended,
    subagentsKnown: () => true,
    subagentDelivery: () => "held",
    watchSubagents: (/** @type {() => void} */ f) => (listeners.add(f), () => void listeners.delete(f)),
    cardClosed: { has: (/** @type {string} */ id, /** @type {number} */ x) => hidden.has(`${id}:${x}`), close: (/** @type {string} */ id, /** @type {number} */ x) => void hidden.add(`${id}:${x}`) },
  });
  const { createTimeline } = await import("../src/ui/harness/conversation/timeline.js");
  host = document.createElement("div");
  tl = createTimeline(host, /** @type {any} */ ({ onRetry() {} }));
});
after(() => {
  for (const k of CHIP_KEYS) chipActions[k] = null;
  for (const k of ADDED) delete g[k];
  dom.restore();
});

/** Whether the Start board stands. */
const startShown = () => !host.querySelector(".empty-chat").classList.contains("hidden");
/** The store touched, as the chat menu's Show N hidden agent cards touches it: every card paints again. */
const touch = () => { for (const f of [...listeners]) f(); };

// (fails before: yes — the card went and the Start board stayed away: a blank chat)
test("the only agent's card of a chat with no turn hidden: the Start board comes back; shown again, it gives way again", async () => {
  const chat = { turns: [], asked: [sent], live: null };
  tl.render(chat);
  assert.equal(startShown(), false, "the card stands where the Start board was");
  const hide = host.querySelector(".ask-card-hide");
  assert.ok(hide, "an ended card has its Hide");
  hide.dispatch("click");
  assert.ok(host.querySelector(".ask-card").classList.contains("hidden"), "the card is off the chat");
  assert.equal(startShown(), true, "the Start board is back: the chat is not blank");
  // Drawn again — the chat opened again, a reload — it stays so.
  tl.render(chat);
  assert.equal(startShown(), true, "drawn again");
  // The chat menu's Show N hidden agent cards: the card comes back, and the Start board gives way to it again.
  hidden.clear();
  touch();
  assert.equal(host.querySelector(".ask-card").classList.contains("hidden"), false);
  assert.equal(startShown(), false, "the card stands again");
});

// (fails before: no — a second card standing kept the Start board away, as it should)
test("with another agent's card still standing, the Start board stays away", () => {
  const other = { ...sent, agentId: "sa_2" };
  hidden.clear();
  const chat = { turns: [], asked: [sent, other], live: null };
  tl.render(chat);
  host.querySelectorAll(".ask-card-hide")[0].dispatch("click");
  assert.deepEqual(host.querySelectorAll(".ask-card").map((/** @type {any} */ c) => c.classList.contains("hidden")), [true, false]);
  assert.equal(startShown(), false, "one card still stands");
});
