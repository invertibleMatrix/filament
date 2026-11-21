// @ts-check
// The words of a running turn stand where they were said among its cards, from the moment the chat is drawn (the owner's
// report of 10-27: "a lot of time whole bunch of texts shows up at the end of transcript and until a new tool call
// result arrives then that text vanishes but only 1 line remains"). A full render of the chat — a switch back to it, a
// read of its transcript — draws the running turn's cards before its live words, which only the reply holds; the
// words were then pushed after every card and stood there until the next run event laid the cards again.
// The real timeline is drawn here, on the stub document.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";

/** @type {ReturnType<typeof stubDocument>} */
let dom;
/** @type {any} */
let tl;
/** @type {typeof import("../src/ui/harness/lib/labels.js").alignEvents} */
let alignEvents;
const g = /** @type {any} */ (globalThis);
/** The globals the page reads that node lacks, put back after. */
const ADDED = ["requestAnimationFrame", "cancelAnimationFrame", "IntersectionObserver", "ResizeObserver", "getComputedStyle", "localStorage", "sessionStorage"].filter((k) => !(k in g));

before(async () => {
  dom = stubDocument();
  // Nothing the page schedules runs here: a frame, a timeout and a clock are taken and dropped.
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
  ({ alignEvents } = await import("../src/ui/harness/lib/labels.js"));
  const { createTimeline } = await import("../src/ui/harness/conversation/timeline.js");
  tl = createTimeline(document.createElement("div"), /** @type {any} */ ({}));
});
after(() => {
  for (const k of ADDED) delete g[k];
  dom.restore();
});

/** A command its round ran. @param {number} round @param {string} id */
const command = (round, id) => [
  { type: "tool-start", round, name: "bash", args: "npm test", id, input: { command: "npm test" } },
  { type: "tool-end", round, name: "bash", ok: true, ms: 40, id, chars: 2, preview: "ok" },
];
/** A turn three rounds in: words, a command, words, a command, and the newest words. */
const running = () => {
  const turn = /** @type {any} */ ({ n: 1, status: "streaming", past: false, blocks: [], steers: [], segments: [], runId: "r1", startedAt: Date.now() });
  turn.aligned = alignEvents([
    { type: "round-start", round: 1, blocksBefore: 0 }, ...command(1, "t1"),
    { type: "round-start", round: 2, blocksBefore: 1 }, ...command(2, "t2"),
    { type: "round-start", round: 3, blocksBefore: 2 },
  ]);
  const words = ["A: first, a look", "B: after the first command", "C: after the second"].map((text) => ({ type: "text", text }));
  const live = /** @type {any} */ ({ turn, reply: { blocks: words, tailClosed: false }, blockHandles: [] });
  const chat = { turns: [turn], live };
  live.chat = chat;
  return { turn, live, chat };
};
/** The turn's order as the page lays it: each text by its letter, each box of cards as "cards". @param {any} turn */
const order = (turn) => turn.segments.map((/** @type {any} */ s) => (s.kind === "block" ? s.block.text[0] : s.kind)).join(" ");

// (fails before: yes — after the render the turn held its cards alone, "cards"; the next piece of the reply pushed
// every word after them, "cards A B C", until the next run event laid the cards again)
test("a running turn drawn again keeps each of its words where it was said among its cards, before any more of the reply comes and after", () => {
  const { turn, live, chat } = running();
  tl.render(chat);
  assert.equal(order(turn), "A cards B cards C", "drawn again: the words are there at once, each before the command that followed it");
  const words = turn.segments.filter((/** @type {any} */ s) => s.kind === "block");
  assert.ok(words.every((/** @type {any} */ s) => !s.el.classList.contains("arrive")), "words drawn before do not fade in again");
  live.reply.blocks[2].text += ", and more";
  tl.drawBlocks(live);
  assert.equal(order(turn), "A cards B cards C", "the next piece of the reply grows the newest words where they stand");
  tl.placeCards(turn);
  assert.equal(order(turn), "A cards B cards C", "the next run event moves nothing");
});

test("a turn's first words, on a send, are drawn as they come, with no cards to lay", () => {
  const turn = /** @type {any} */ ({ n: 1, status: "streaming", past: false, blocks: [], steers: [], segments: [], startedAt: Date.now() });
  const live = /** @type {any} */ ({ turn, reply: null, blockHandles: [] });
  const chat = { turns: [turn], live: null };
  live.chat = chat;
  tl.render(chat);
  chat.live = live;
  tl.startLive(live);
  assert.equal(order(turn), "", "nothing said yet");
  live.reply = { blocks: [{ type: "text", text: "Hello" }], tailClosed: false };
  tl.drawBlocks(live);
  assert.equal(order(turn), "H");
});

// (fails before: yes — every run event drew the round's plan card anew: a plan the reader closed opened again, and each
// one played its arrival)
test("a running turn's plan card is the same card from one run event to the next while its list holds", () => {
  const turn = /** @type {any} */ ({ n: 1, status: "streaming", past: false, blocks: [], steers: [], segments: [], runId: "r2", startedAt: Date.now() });
  const events = [
    { type: "round-start", round: 1, blocksBefore: 0 },
    { type: "plan", round: 1, items: [{ text: "read the code", status: "doing" }, { text: "fix it", status: "pending" }] },
    ...command(1, "p1"),
  ];
  turn.aligned = alignEvents(events);
  const live = /** @type {any} */ ({ turn, reply: { blocks: [{ type: "text", text: "A look first" }], tailClosed: false }, blockHandles: [] });
  const chat = { turns: [turn], live };
  live.chat = chat;
  tl.render(chat);
  const planOf = () => turn.segments.flatMap((/** @type {any} */ s) => (s.kind === "cards" ? [s.el] : [])).map((/** @type {any} */ el) => el.querySelector(".plan-card-body")).find(Boolean);
  const first = planOf();
  assert.ok(first, "the plan card is drawn");
  turn.aligned = alignEvents([...events, { type: "tool-start", round: 1, name: "read", args: "a.txt", id: "p2", input: { path: "a.txt" } }]);
  tl.placeCards(turn);
  assert.equal(planOf(), first, "the next run event keeps the same card");
  turn.aligned = alignEvents([...events, { type: "plan", round: 1, items: [{ text: "read the code", status: "done" }, { text: "fix it", status: "doing" }] }]);
  tl.placeCards(turn);
  // Drawn again into the card that stands (the owner's of 11-01: a card made anew under a resting pointer blinked).
  assert.equal(planOf(), first, "a changed list draws it again, in the card that stood");
  assert.deepEqual([...first.querySelectorAll(".plan-item")].map((/** @type {any} */ el) => el.className), ["plan-item done", "plan-item doing"], "saying the newest list");
});
