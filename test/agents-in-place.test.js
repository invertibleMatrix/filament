// @ts-check
// The Agents tab drawn again at each pulse of the chat's agents keeps the elements under the pointer (the owner's of
// 11-01: "when i hover over my mouse over some interactive elements like buttons then those are just suppose to
// highlight only once they quite a lot of time they start blinking … and during that sometimes the clicks even don't
// pass through so i have to press more than once"). Its Start pane's tiles were made anew at every pulse — four or five
// a second while an agent works —, a running agent's row its insides as its clock moved, and a tile of Tiles whole as
// its agent's words moved, its Stop and Open thread with it: new elements under a resting pointer, whose hover started
// over and where a press that began on the old one never clicked. Drawn in place (dom.js `morphChildren`), each is the
// element that stood, its words and its handler the newest draw's.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { NOW, agentRow, sideIO } from "./helpers/side-view.js";

/** @type {ReturnType<typeof stubDocument>} */
let doc;
/** @type {typeof import("../src/ui/harness/views/side.js")} */
let side;
const g = /** @type {any} */ (globalThis);
before(async () => {
  doc = stubDocument();
  g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  // The page's document hears its own events (md.js's, as it loads).
  const page = /** @type {any} */ (doc.document);
  page.addEventListener ||= () => {};
  page.removeEventListener ||= () => {};
  // The window's clocks, which a part's ticking reads as it loads (turn.js's); never holding the run open.
  g.window.setInterval ||= (/** @type {() => void} */ fn, /** @type {number} */ ms) => { const t = setInterval(fn, ms); t.unref?.(); return t; };
  g.window.clearInterval ||= clearInterval;
  side = await import("../src/ui/harness/views/side.js");
});
after(() => {
  doc.restore();
  delete g.localStorage;
});

/** The same element, never compared by its shape. @param {any} now @param {any} was @param {string} what */
const same = (now, was, what) => assert.ok(now != null && now === was, `${what}: the element that stood`);
/** A button by its words. @param {any} at @param {string} label @returns {any} */
const button = (at, label) => at.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === label) || null;
/** An agent at work, at its round with its words. @param {number} round @param {string} words */
const working = (round, words) => agentRow("s1", { status: "running", progress: { round, words }, exchanges: [{ description: "Job s1", startedAt: NOW - 60_000 }] });

/**
 * The Agents tab on the page over a chat whose one agent works, its clock and its words the test's to move.
 * @param {string[]} did  what its presses did
 */
function tabOf(did) {
  const t = {
    rows: [working(3, "Reading the parser.")],
    clock: NOW,
    chat: /** @type {any} */ ({ id: "chat-1", chainId: "c1", turns: [] }),
    view: /** @type {any} */ (null),
    el: /** @type {any} */ (null),
    /** A pulse: the clock on by five seconds, and the agent's words where given. @param {number} [round] @param {string} [words] */
    pulse(round, words) {
      t.clock += 5_000;
      if (round) t.rows = [working(round, words || "")];
      t.view.paint(t.chat);
    },
  };
  const io = sideIO({ rows: () => t.rows, now: () => t.clock, stop: (/** @type {string} */ id) => did.push(`stop ${id}`) });
  t.view = side.createSideView(/** @type {any} */ (io));
  t.el = t.view.el;
  /** @type {any} */ (doc.document.body).replaceChildren(t.el);
  t.view.paint(t.chat);
  return t;
}

test("the Start pane's tiles stay at each pulse; a press on one chooses it", () => {
  const t = tabOf([]);
  const tiles = t.el.querySelectorAll(".sd-short");
  assert.ok(tiles.length > 1, "its start tiles");
  t.pulse(4, "Writing the fix.");
  t.el.querySelectorAll(".sd-short").forEach((/** @type {any} */ b, /** @type {number} */ i) => same(b, tiles[i], `start tile ${i + 1}`));
  tiles[1].dispatch("click");
  t.pulse();
  same(t.el.querySelectorAll(".sd-short")[1], tiles[1], "the tile chosen");
  assert.equal(tiles[1].getAttribute("aria-checked"), "true", "chosen, on the tile that stood");
});

test("a running agent's row keeps its parts as its clock and its words move", () => {
  const t = tabOf([]);
  const name = t.el.querySelector(".sd-row .sd-row-name");
  const fact = t.el.querySelector(".sd-row .sd-row-fact");
  const right = t.el.querySelector(".sd-row .sd-row-right");
  assert.ok(name && fact && right, "the agent's row, its clock at its end");
  const was = right.textContent;
  t.pulse(4, "Writing the fix.");
  same(t.el.querySelector(".sd-row .sd-row-name"), name, "the row's name");
  same(t.el.querySelector(".sd-row .sd-row-fact"), fact, "the row's state");
  same(t.el.querySelector(".sd-row .sd-row-right"), right, "the row's clock");
  assert.notEqual(right.textContent, was, "its clock moved");
});

test("a tile of Tiles keeps its Stop and its Open thread as its agent's words move; its clock is the one on the page, and Stop stops it", () => {
  /** @type {string[]} */
  const did = [];
  const t = tabOf(did);
  button(t.el, "Tiles").dispatch("click");
  const card = t.el.querySelector(".sw-tile");
  const open = button(card, "Open thread");
  const stop = button(card, "Stop");
  assert.ok(open && stop, "its Open thread and its Stop");
  t.pulse(5, "Running the tests.");
  same(t.el.querySelector(".sw-tile"), card, "its tile");
  same(button(card, "Open thread"), open, "Open thread");
  same(button(card, "Stop"), stop, "Stop");
  assert.ok(card.textContent.includes("Running the tests."), "its words the newest");
  // Its clock moves alone between its words' moves, on the tile that stands.
  const took = card.querySelector(".sw-took");
  const was = took.textContent;
  t.pulse();
  same(t.el.querySelector(".sw-took"), took, "its clock");
  assert.notEqual(took.textContent, was, "and it moved");
  stop.dispatch("click");
  assert.deepEqual(did, ["stop s1"]);
});
