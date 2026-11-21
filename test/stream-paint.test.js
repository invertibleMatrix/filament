// @ts-check
// A reply streaming into the transcript (the performance audit of 10-29, C4): each piece of it laid the whole turn out
// again, many times a frame, and each paint set the whole message's markup anew — every word of it parsed and laid out
// again, so a word cost more the longer the reply; each scroll read every turn's place. Now the turn is laid out once a
// frame, a paint draws only the markdown block still being written, and the turns' places are read once a lay-out.
// The real timeline is drawn here, on the stub document, with frames the test runs.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { STREAM_DRAW_MS } from "../src/ui/harness/lib/stream-pace.js";

/** @type {ReturnType<typeof stubDocument>} */
let dom;
/** @type {any} */
let tl;
/** @type {any} */
let host;
const g = /** @type {any} */ (globalThis);
/** The globals the page reads that node lacks, put back after. */
const ADDED = ["requestAnimationFrame", "cancelAnimationFrame", "IntersectionObserver", "ResizeObserver", "getComputedStyle", "localStorage", "sessionStorage"].filter((k) => !(k in g));
/** The frames the page asked for, run when the test says. @type {(() => void)[]} */
const frames = [];
const runFrames = () => {
  for (const fn of frames.splice(0)) fn();
};

before(async () => {
  dom = stubDocument();
  g.requestAnimationFrame = (/** @type {() => void} */ fn) => frames.push(fn);
  g.cancelAnimationFrame = () => {};
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
  tl = createTimeline(host, /** @type {any} */ ({}));
});
after(() => {
  for (const k of ADDED) delete g[k];
  dom.restore();
});

/** Every element under `el` that wears the class, in order. @param {any} el @param {string} cls @returns {any[]} */
const all = (el, cls) => [...(el.classList?.contains(cls) ? [el] : []), ...[...(el.children || [])].flatMap((k) => all(k, cls))];

/** A turn a send just started, its first words to come. @param {number} n */
const sending = (n) => {
  const turn = /** @type {any} */ ({ n, status: "streaming", past: false, blocks: [], steers: [], segments: [], boundaries: [], boundariesAfter: [], startedAt: Date.now() });
  const live = /** @type {any} */ ({ turn, reply: null, blockHandles: [] });
  const chat = /** @type {any} */ ({ turns: [turn], live: null });
  live.chat = chat;
  tl.render(chat);
  chat.live = live;
  tl.startLive(live);
  return { turn, live, chat };
};

// (fails before: yes — a paint set the message's whole markup: the paragraph that had ended was parsed and drawn again
// with every word that followed it)
test("a streamed reply draws again only its block still being written: one that ended keeps its nodes", () => {
  const { turn, live } = sending(1);
  live.reply = { blocks: [{ type: "text", text: "The first paragraph.\n\nThe second" }], tailClosed: false };
  tl.drawBlocks(live);
  const md = turn.segments[0].el;
  assert.equal(md.children.length, 2, "a node a block");
  const [ended, open] = md.children;
  assert.match(ended.innerHTML, /^<p>The first paragraph\.<\/p>$/);
  live.reply.blocks[0].text += " paragraph grows";
  tl.drawBlocks(live);
  live.blockHandles[0].flush();
  assert.equal(md.children.length, 2);
  assert.equal(md.children[0], ended, "the ended paragraph stands as drawn");
  assert.notEqual(md.children[1], open);
  assert.match(md.children[1].innerHTML, /The second paragraph grows/);
  live.reply.blocks[0].text += "\n\n- a list";
  live.blockHandles[0].flush();
  assert.equal(md.children.length, 3, "a block begun is drawn after the ones that stand");
  assert.equal(md.children[0], ended);
  assert.match(md.children[2].innerHTML, /<ul class="md-list"><li>a list<\/li><\/ul>/);
  runFrames();
});

// (fails before: yes — every piece of the reply laid the whole turn out again at once)
test("the pieces of a reply that come before a frame lay the turn out once, at that frame", async () => {
  const { turn, live } = sending(2);
  let read = 0;
  // The turn's closing note is read by its lay-out alone, as a piece of the reply is drawn.
  Object.defineProperty(turn, "note", { get: () => (read++, null), configurable: true });
  live.reply = { blocks: [{ type: "text", text: "One" }], tailClosed: false };
  tl.drawBlocks(live);
  runFrames();
  // What one lay-out reads of it.
  const once = read;
  assert.ok(once > 0);
  read = 0;
  for (const more of [" two", " three", " four", " five"]) {
    live.reply.blocks[0].text += more;
    tl.drawBlocks(live);
  }
  assert.equal(read, 0, "nothing laid out before the frame");
  // The pieces came within the reply's pace of its first draw: they are drawn together at the pace's end.
  runFrames();
  assert.equal(read, 0, "nothing laid out before the pace's end");
  await new Promise((r) => setTimeout(r, STREAM_DRAW_MS + 20));
  runFrames();
  assert.equal(read, once, "four pieces, one lay-out");
  assert.ok(turn.segments[0].el.parentNode, "the words stand in the turn");
});

/** The markup a reply's block stands in now. @param {any} md */
const shown = (md) => [...md.children].map((/** @type {any} */ k) => k.innerHTML).join("");

// (fails before: yes — each piece of the reply drew its block again at the next frame, ten pieces in a pace ten draws;
// and a turn that ended with words still coming had its caret put back by a draw that waited)
test("a growing reply is drawn at once, then once a pace from its newest words; a block's end and the turn's end draw at once", async () => {
  const { turn, live } = sending(3);
  live.reply = { blocks: [{ type: "text", text: "First" }], tailClosed: false };
  tl.drawBlocks(live);
  const md = turn.segments[0].el;
  assert.match(shown(md), /First/, "the first words, with no wait");
  runFrames();
  /** The block's paints: each sets its markup anew. */
  let paints = 0;
  const insert = md.insertAdjacentHTML.bind(md);
  md.insertAdjacentHTML = (/** @type {any} */ where, /** @type {string} */ html) => (paints++, insert(where, html));
  for (const more of [" two", " three", " four"]) {
    live.reply.blocks[0].text += more;
    tl.drawBlocks(live);
    runFrames();
  }
  assert.equal(paints, 0, "three pieces and three frames inside the pace: not drawn yet");
  assert.doesNotMatch(shown(md), /two/);
  await new Promise((r) => setTimeout(r, STREAM_DRAW_MS + 20));
  runFrames();
  assert.equal(paints, 1, "one draw at the pace's end");
  assert.match(shown(md), /First two three four/, "from the newest words");
  // The block ends inside the next pace: its last words and the caret's leaving do not wait for it.
  live.reply.blocks[0].text += " five";
  live.reply.tailClosed = true;
  tl.drawBlocks(live);
  runFrames();
  assert.match(shown(md), /four five/);
  assert.equal(md.classList.contains("streaming"), false, "the caret left the ended block");
  // A block begun is drawn at once; its words that follow wait for the pace, and the turn's end draws them.
  live.reply.blocks.push({ type: "text", text: "Next" });
  live.reply.tailClosed = false;
  tl.drawBlocks(live);
  const next = turn.segments.find((/** @type {any} */ s) => s.kind === "block" && s.block === live.reply.blocks[1]).el;
  assert.match(shown(next), /Next/);
  assert.equal(next.classList.contains("streaming"), true);
  live.reply.blocks[1].text += " words";
  tl.drawBlocks(live);
  await tl.finish(live, "done");
  assert.match(shown(next), /Next words/, "the turn's end draws the words that waited");
  await new Promise((r) => setTimeout(r, STREAM_DRAW_MS + 20));
  runFrames();
  assert.equal(next.classList.contains("streaming"), false, "and no draw that waited puts the caret back after it");
});

// (fails before: yes — the page let go of a live view with the reply's last words held back by its pace)
test("the page draws the words the pace holds back wherever it lets go of a live view", () => {
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  assert.match(app, /if \(chat\.live !== live\) return;\n {4}runDraw\.now\(\);[^\n]*\n {4}transcript\.flushBlocks\(live\);/, "a followed turn's settle");
  assert.match(app, /const letLiveGo = \(said\) => \{\n {4}runDraw\.now\(\);\n {4}transcript\.flushBlocks\(live\);/, "a send that hands its turn over");
  const timeline = readFileSync(new URL("../src/ui/harness/conversation/timeline.js", import.meta.url), "utf8");
  assert.match(timeline, /async finish\(live, status\) \{\n {6}const turn = live\.turn;\n(?: {6}\/\/[^\n]*\n)* {6}live\.pace\?\.flush\(\);/, "the send's end");
});

// (fails before: yes — each scroll read every drawn turn's place, which lays the page out)
test("a scroll reads the turns' places once until the transcript is laid out again", () => {
  const turns = [1, 2].map((n) => /** @type {any} */ ({ n, status: "done", past: false, blocks: [{ type: "text", text: `Reply ${n}` }], steers: [], segments: [], boundaries: [], boundariesAfter: [], startedAt: Date.now() }));
  const chat = /** @type {any} */ ({ turns, live: null, view: null });
  tl.render(chat);
  runFrames();
  let reads = 0;
  for (const [i, t] of all(host, "turn").entries()) Object.defineProperty(t, "offsetTop", { get: () => (reads++, i * 400), configurable: true });
  const scroller = all(host, "transcript")[0];
  Object.assign(scroller, { scrollTop: 0, scrollHeight: 2000, clientHeight: 600 });
  for (let i = 0; i < 5; i++) scroller.dispatch("scroll", { target: scroller });
  assert.equal(reads, 2, "five scrolls, the places read once");
  // A message the developer sent into the turn lays it out anew.
  tl.addSteer(turns[0], { id: "s1", text: "and this", files: [] });
  scroller.dispatch("scroll", { target: scroller });
  assert.equal(reads, 4, "laid out anew: read again");
});
