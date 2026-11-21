// @ts-check
// A message that waits for a running turn (app.js `armWaiting`, HarnessV3 Step 3 D14): its row's footer says the queue's
// line, with Cancel, and Stop it and go first while the turn it waits on is a coding agent's own (HarnessV3-ACP AC3-9).
// What the row offers moves with that turn — an outside client may take the session once the agent's own turn ends —
// and goes once the message has gone or was cancelled: the timeline draws the footer again from the turn
// (`drawFoot`), with the chat drawn again, and on the row a reload restored once it is armed. The real timeline is drawn
// here, on the stub document.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";

/** @type {ReturnType<typeof stubDocument>} */
let dom;
/** @type {any} */
let tl;
/** @type {any} */
let host;
const g = /** @type {any} */ (globalThis);
const ADDED = ["requestAnimationFrame", "cancelAnimationFrame", "IntersectionObserver", "ResizeObserver", "getComputedStyle", "localStorage", "sessionStorage"].filter((k) => !(k in g));

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
  const { createTimeline } = await import("../src/ui/harness/conversation/timeline.js");
  host = document.createElement("div");
  tl = createTimeline(host, /** @type {any} */ ({ onPauseChange() {}, onRetry() {}, onFork() {}, onWatchRun() {} }));
});
after(() => {
  for (const k of ADDED) delete g[k];
  dom.restore();
});

/** The words of the row's buttons that have any, and its waiting line. */
const footOf = () => ({
  buttons: host.querySelectorAll("button").map((/** @type {any} */ b) => String(b.textContent || "")).filter((t) => /^(Cancel|Stop it and go first)$/.test(t)),
  line: host.querySelectorAll(".a-flag").map((/** @type {any} */ f) => String(f.textContent || "")).filter((t) => t.startsWith("Waiting")),
});

// (fails before: yes — on e7f453755 the footer was drawn once, as the send that met the running turn ended: the Stop it
// offered then stood whoever took the session after, and the row's line and buttons stood after its message went)
test("a waiting message's footer is drawn again from its turn: its Stop goes as the turn it waits on stops being the agent's own, and its line and buttons once the message has gone", async () => {
  const turn = /** @type {any} */ ({ n: 1, status: "streaming", userText: "go on", userContent: [{ type: "text", text: "go on" }], blocks: [], steers: [], segments: [], boundaries: [], boundariesAfter: [], requestId: null, startedAt: Date.now() });
  const chat = { turns: [turn], live: null };
  tl.render(chat);
  // The send met the agent's own turn: the 409 path arms the queue (app.js `armWaiting`), and the send's end draws it.
  Object.assign(turn, { waitingText: "Waiting — Claude Code is working on its own · 1 min · idle 0 s", cancelWait() {}, stopIt() {} });
  await tl.finish({ turn, chat, reply: null, aborter: null, blockHandles: [] }, "waiting");
  assert.deepEqual(footOf(), { buttons: ["Cancel", "Stop it and go first"], line: ["Waiting — Claude Code is working on its own · 1 min · idle 0 s"] });
  // The agent's turn ended and OpenCode took the session: the queue's next look takes the Stop back.
  Object.assign(turn, { waitingText: "Waiting — OpenCode is working · 1 min · idle 0 s", stopIt: null });
  tl.drawFoot?.(turn);
  assert.deepEqual(footOf(), { buttons: ["Cancel"], line: ["Waiting — OpenCode is working · 1 min · idle 0 s"] }, "the Stop went, and the line says who holds the turn now");
  // The message went: the row is spent.
  Object.assign(turn, { status: "done", waitingText: null, cancelWait: null, stopIt: null });
  tl.drawFoot?.(turn);
  assert.deepEqual(footOf(), { buttons: [], line: [] }, "no line, no Cancel, no Stop");
});

/** A message waiting on its row, armed as app.js `armWaiting` arms it (`waitingText`, `cancelWait`, `stopIt`). @param {any} [o] */
const waitingTurn = (o = {}) => /** @type {any} */ ({ n: 1, status: "waiting", userText: "go on", userContent: [{ type: "text", text: "go on" }], blocks: [], steers: [], segments: [], boundaries: [], boundariesAfter: [], waitingText: "Waiting — Claude Code is working on its own · 1 min · idle 0 s", cancelWait() {}, stopIt() {}, ...o });

// (fails before: yes — on 32afa3f3f a waiting row drawn again with its chat (switched away from and back, its transcript
// read again) was drawn with no footer, and the row a reload restored was laid out with none, which `drawFoot` then left
// as it was: its line, Cancel and Stop it and go first were gone, though the message still waited)
test("a waiting row keeps its line, Cancel and Stop: drawn again with its chat, and restored by a reload once it is armed", () => {
  tl.render({ turns: [waitingTurn()], live: null });
  assert.deepEqual(footOf(), { buttons: ["Cancel", "Stop it and go first"], line: ["Waiting — Claude Code is working on its own · 1 min · idle 0 s"] }, "drawn again with its chat");
  // A reload: the transcript lands and the kept message's row is laid out, then armed (app.js `hydrate`).
  const chat = { turns: /** @type {any[]} */ ([]), live: null };
  tl.render(chat);
  const restored = waitingTurn({ n: 2, waitingText: null, cancelWait: null, stopIt: null });
  chat.turns.push(restored);
  tl.startTurn(restored);
  assert.deepEqual(footOf(), { buttons: [], line: [] }, "laid out before it is armed");
  Object.assign(restored, { waitingText: "Waiting — the move to another folder · 1 min · idle 0 s", cancelWait() {} });
  tl.drawFoot(restored);
  assert.deepEqual(footOf(), { buttons: ["Cancel"], line: ["Waiting — the move to another folder · 1 min · idle 0 s"] }, "armed: its line and Cancel");
});

// (fails before: yes — the review of fe86a180d: a waiting row, whose message is on no record yet, offered Retry — a
// second send of it, with a queue of its own beside the row's — and Fork, from a turn the session does not have; and the
// map of 11-01 (P8): its Copy, which copied nothing — the message has no reply)
test("a waiting row offers no Retry, no Fork and no Copy: its message sends itself, or is cancelled", () => {
  tl.render({ turns: [waitingTurn()], live: null });
  const titles = host.querySelectorAll(".a-foot button").map((/** @type {any} */ b) => String(b.getAttribute?.("title") || ""));
  assert.ok(footOf().buttons.includes("Cancel"), titles.join(" | "));
  assert.deepEqual(titles.filter((t) => /^(Retry|Fork|Copy)/.test(t)), []);
});

// (fails before: yes — the 11-01 report (B12): the queue's line says idle seconds, so at each look of the queue, two
// seconds apart, the row's whole footer was drawn again — a Cancel under the pointer replaced mid-click)
test("a waiting row's line says its words anew in place: its footer and Cancel stand as drawn", () => {
  const turn = waitingTurn();
  tl.render({ turns: [turn], live: null });
  const cancelOf = () => host.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === "Cancel");
  const cancel = cancelOf();
  turn.waitingText = "Waiting — Claude Code is working on its own · 1 min · idle 2 s";
  tl.waitingLine(turn);
  assert.deepEqual(footOf(), { buttons: ["Cancel", "Stop it and go first"], line: ["Waiting — Claude Code is working on its own · 1 min · idle 2 s"] });
  assert.equal(cancelOf(), cancel, "the same Cancel");
});

// (fails before: yes — the review of d53154737: a waiting row cancelled offered Fork, from a turn the session does not
// have)
test("a waiting row withdrawn offers no Fork; its Retry sends the message after all", () => {
  tl.render({ turns: [waitingTurn({ status: "stopped", withdrawn: true, cancelWait: null, stopIt: null, waitingText: null })], live: null });
  const titles = host.querySelectorAll("button").map((/** @type {any} */ b) => String(b.getAttribute?.("title") || ""));
  assert.deepEqual(titles.filter((t) => /^Fork/.test(t)), [], titles.join(" | "));
  assert.ok(titles.some((t) => /^Retry/.test(t)), titles.join(" | "));
});

// (fails before: yes — the review of 9f0185fbe: a withdrawn row shares its number with the turn sent after it, and the
// overview's "Open it in the chat" scrolled to the row)
test("a scroll to a turn's number goes to the turn on record, not a withdrawn row of its number", () => {
  const withdrawn = waitingTurn({ n: 2, status: "stopped", withdrawn: true, cancelWait: null, stopIt: null, waitingText: null, userText: "the words withdrawn", userContent: [{ type: "text", text: "the words withdrawn" }] });
  const sent = waitingTurn({ n: 2, status: "done", cancelWait: null, stopIt: null, waitingText: null, userText: "the words sent", userContent: [{ type: "text", text: "the words sent" }] });
  tl.render({ turns: [withdrawn, sent], live: null });
  assert.equal(tl.scrollToTurn(2), true);
  const lit = host.querySelectorAll(".turn-hl").map((/** @type {any} */ el) => String(el.textContent || ""));
  assert.deepEqual([lit.some((t) => t.includes("the words sent")), lit.some((t) => t.includes("the words withdrawn"))], [true, false], lit.join(" | "));
});

// (fails before: no — a guard: a running row drawn with no footer gains none from a look at the queue, and a turn of a
// chat not shown draws nothing into the chat shown)
test("a running row with no footer, or a turn of another chat, is left as it is", () => {
  const running = waitingTurn({ status: "streaming" });
  tl.render({ turns: [running], live: null });
  tl.drawFoot(running);
  assert.deepEqual(footOf(), { buttons: [], line: [] }, "a running row");
  tl.drawFoot(waitingTurn({ n: 7 }));
  assert.deepEqual(footOf(), { buttons: [], line: [] }, "another chat's");
});
