// @ts-check
// A running turn's cards, drawn again on every run event. The owner's words of 10-18: "the images that show in
// transcript are buggy. it resizes as it flickers, becomes small and then restores to it's size and it happens after
// every round in a running turn", then "not just the image but whole transcript flickers, when a tool run shows and
// then right after it runs another tool call, first it kinda disappears and then shown again after few milli seconds".
// Each event drew every card anew: a picture came back in its placeholder's shape and grew once it loaded, an edit's
// diff and a command's output end came a moment later. A call whose record did not change now keeps its row, a box
// its place, an output where it stood, and a picture the page holds shows whole at once. One that changed is drawn again
// into the row that stands (render.js `drawInto`, the owner's of 11-01: a row made anew under a resting pointer blinked
// and lost the press): a mark on it that only a drawing takes off says it was drawn.
// (fails before: yes — every build made new rows and a new box; nothing kept an output's place)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { alignEvents } from "../src/ui/harness/lib/labels.js";
import { roundRows } from "../src/ui/harness/conversation/tools/render.js";
import { cardsEl, keptBox, keepOutputs } from "../src/ui/harness/conversation/timeline.js";
import { pictureThumb } from "../src/ui/harness/lib/picture-view.js";

/** A round's events: a read that handed its model a picture, two commands that ended, one still running — and `more`.
 *  @param {any[]} [more] */
const events = (more = []) => [
  { type: "round-start", round: 1, n: 1 },
  { type: "tool-start", id: "r1", name: "read", args: { path: "shot.png" }, n: 2 },
  { type: "tool-end", id: "r1", ok: true, preview: "", images: [{ ref: "r1-0.png", type: "image/png", bytes: 5000 }], n: 3 },
  { type: "tool-start", id: "b1", name: "bash", args: { command: "npm test" }, n: 4 },
  { type: "tool-end", id: "b1", ok: true, preview: "pass 12", exitCode: 0, n: 5 },
  { type: "tool-start", id: "b2", name: "bash", args: { command: "npm run lint" }, n: 6 },
  { type: "tool-end", id: "b2", ok: true, preview: "clean", exitCode: 0, n: 7 },
  { type: "tool-start", id: "b3", name: "bash", args: { command: "npm run build" }, n: 8 },
  ...more,
];
/** A mark on a row's own element, which a drawing of it takes off: whether it was drawn since. @param {any} el */
const mark = (el) => el.setAttribute("data-unchanged", "");
/** @param {any} el */
const drawnSince = (el) => !el.hasAttribute("data-unchanged");

/** The round's cell, its records minted anew each time as a run event mints them. @param {any[]} evs */
const cellOf = (evs) => alignEvents(evs.map((e) => ({ round: 1, ...e }))).byRound.get(1);

test("a call whose record holds keeps its row, its picture with it; one that changed is drawn anew", () => {
  const dom = stubDocument();
  try {
    const drawn = new Map();
    const first = roundRows(cellOf(events()), { drawn, runId: "run-1" });
    assert.equal(first.length, 3, "the read, the two commands' group, the running command");
    const img = first[0].querySelector("img.tool-shot");
    assert.ok(img, "the read draws its picture");
    const again = roundRows(cellOf(events()), { drawn, runId: "run-1" });
    assert.deepEqual(again.map((row, i) => row === first[i]), [true, true, true], "the same records: the same rows, the group too");
    assert.equal(again[0].querySelector("img.tool-shot"), img, "the picture on the page stays: it neither loads nor takes its placeholder's shape again");

    // The running command ends: its row is drawn again and joins the group, whose rows stay the ones on the page.
    mark(first[1]);
    const ended = roundRows(cellOf(events([{ type: "tool-end", id: "b3", ok: true, preview: "built", exitCode: 0, n: 9 }])), { drawn, runId: "run-1" });
    assert.equal(ended.length, 2);
    assert.equal(ended[0], first[0], "the read's row stays");
    assert.deepEqual([ended[1], drawnSince(ended[1])], [first[1], true], "the group gained a row: drawn again, in the group that stood");
    assert.equal(ended[1].querySelector(".tool-children")?.children.length, 3);
  } finally {
    dom.restore();
  }
});

test("a group keeps its rows when it is drawn anew, and a build without kept rows draws fresh ones as before", () => {
  const dom = stubDocument();
  try {
    const drawn = new Map();
    const first = roundRows(cellOf(events()), { drawn });
    const b1 = first[1].querySelector(".tool-children")?.children[0];
    const ended = roundRows(cellOf(events([{ type: "tool-end", id: "b3", ok: true, preview: "built", exitCode: 0, n: 9 }])), { drawn });
    assert.equal(ended[1].querySelector(".tool-children")?.children[0], b1, "the first command's row is the one that was on the page");
    // Other callers (a sub-agent's viewer, an archived turn) keep nothing: each build is new, as it was.
    const a = roundRows(cellOf(events()));
    const b = roundRows(cellOf(events()));
    assert.ok(a.every((row, i) => row !== b[i]));
  } finally {
    dom.restore();
  }
});

test("a sub-agent's card reads the session's list as well: drawn anew each time, while a plain call beside it stays", () => {
  const dom = stubDocument();
  try {
    const evs = [
      { type: "round-start", round: 1, n: 1 },
      { type: "tool-start", id: "a1", name: "agent", args: { brief: "look around" }, n: 2 },
      { type: "subagent-start", parent: "a1", agentId: "sub-1", description: "look around", agent: "scout", n: 3 },
      { type: "tool-start", id: "w1", name: "web_fetch", args: { url: "https://example.test" }, n: 4 },
    ];
    const drawn = new Map();
    const first = roundRows(cellOf(evs), { drawn });
    mark(first[0].children[0]);
    mark(first[1]);
    const again = roundRows(cellOf(evs), { drawn });
    assert.equal(first.length, 2);
    assert.deepEqual([again[0], drawnSince(again[0].children[0])], [first[0], true], "the sub-agent's card is drawn again, in the card that stood");
    assert.deepEqual([again[1], drawnSince(again[1])], [first[1], false], "the fetch beside it keeps its row");
  } finally {
    dom.restore();
  }
});

test("a message the loop read, with your picture, keeps its bubble among the cards while it holds", () => {
  const dom = stubDocument();
  try {
    const shot = `data:image/png;base64,${"A".repeat(5000)}`;
    /** @param {any} s */
    const cell = (s) => ({ round: 1, order: [], tools: new Map(), plan: null, hooks: [], marks: [], reports: [], snapshots: [], steers: [s] });
    const steer = { id: "s1", kind: "note", text: "this is what i see", read: true, files: ["shot.png"], shots: [{ src: shot }] };
    const drawn = new Map();
    const [first] = cardsEl(cell({ ...steer, shots: [{ src: shot }] }), { live: true, drawn });
    const [again] = cardsEl(cell({ ...steer, shots: [{ src: shot }] }), { live: true, drawn });
    assert.ok(first.querySelector("img.tool-shot"), "the bubble draws your picture");
    assert.equal(again, first, "the same message: the same bubble, its picture with it");
    mark(first);
    const [said] = cardsEl(cell({ ...steer, text: "this is what i see now" }), { live: true, drawn });
    assert.deepEqual([said, drawnSince(said)], [first, true], "its words changed: drawn again, in the bubble that stood");
    assert.match(String(said.textContent), /this is what i see now/);
  } finally {
    dom.restore();
  }
});

test("a box of cards keeps its place: a row in place does not move, only a new one goes in", () => {
  const dom = stubDocument();
  try {
    const rows = [document.createElement("div"), document.createElement("div")];
    const boxes = new Map();
    const box = keptBox(boxes, 1, rows);
    boxes.set(1, box);
    let moves = 0;
    const stub = /** @type {any} */ (box);
    const insert = stub.insertBefore.bind(stub);
    const remove = stub.removeChild.bind(stub);
    stub.insertBefore = (/** @type {any} */ n, /** @type {any} */ ref) => (moves++, insert(n, ref));
    stub.removeChild = (/** @type {any} */ n) => (moves++, remove(n));
    assert.equal(keptBox(boxes, 1, rows), box, "the round's box again");
    assert.equal(moves, 0, "nothing moved");
    const added = document.createElement("div");
    keptBox(boxes, 1, [...rows, added]);
    assert.equal(moves, 1, "only the new row went in");
    assert.deepEqual(box.children.map((/** @type {any} */ x) => x), [...rows, added]);
    assert.notEqual(keptBox(boxes, 2, rows), box, "another round's box is its own");
  } finally {
    dom.restore();
  }
});

test("a command's output keeps where it stood across a move, and one drawn now starts at its end", () => {
  const dom = stubDocument();
  try {
    const root = /** @type {any} */ (document.createElement("section"));
    document.body.append(root);
    /** @param {string} [mark] */
    const out = (mark) => {
      const p = /** @type {any} */ (document.createElement("pre"));
      p.className = "term-out";
      if (mark != null) p.setAttribute("data-end", mark);
      p.scrollHeight = 900;
      root.append(p);
      return p;
    };
    const moved = out();
    moved.scrollTop = 600;
    const read = out();
    read.scrollTop = 40;
    const before = /** @type {[HTMLElement, number][]} */ ([[moved, 600], [read, 40]]);
    moved.scrollTop = 0; // a row moved into a group drawn anew: the page put its output back at its top
    const fresh = out("");
    keepOutputs(before, root);
    assert.equal(moved.scrollTop, 600, "given its place back");
    assert.equal(read.scrollTop, 40, "one you scrolled stays where you left it");
    assert.equal(fresh.scrollTop, 900, "a new one at its end, in this frame");
    assert.equal(fresh.hasAttribute("data-end"), false, "once: your scroll afterwards is yours");
  } finally {
    dom.restore();
  }
});

test("a picture the page holds already shows whole at once, with no placeholder's shape first", () => {
  const dom = stubDocument();
  const make = dom.document.createElement;
  try {
    let held = true;
    dom.document.createElement = (/** @type {string} */ tag) => {
      const el = /** @type {any} */ (make(tag));
      if (tag === "img") Object.assign(el, { complete: held, naturalWidth: held ? 1280 : 0 });
      return el;
    };
    assert.equal(pictureThumb("/api/runs/images/a.png", "a.png", () => {}).classList.contains("loading"), false, "held: whole at once");
    held = false;
    assert.equal(pictureThumb("/api/runs/images/b.png", "b.png", () => {}).classList.contains("loading"), true, "on its way: the placeholder holds its place");
  } finally {
    dom.document.createElement = make;
    dom.restore();
  }
});

test("the timeline keeps the turn's rows and boxes as it places its cards, and its outputs' places", () => {
  const src = readFileSync(new URL("../src/ui/harness/conversation/timeline.js", import.meta.url), "utf8");
  const place = src.slice(src.indexOf("    placeCards(turn, aligned = null) {"), src.indexOf("    /** The session's sub-agents moved: the order rows"));
  assert.match(place, /drawn: v\.drawn \}\);/, "the cards are drawn with the turn's kept rows");
  assert.match(place, /keptBox\(v\.boxes, rounds\[0\], rows\)/, "each box is the one its rounds had");
  assert.match(place, /layout\(turn, v\);\n {6}keepOutputs\(outputs, v\.root\);/, "the outputs once the cards are placed");
});
