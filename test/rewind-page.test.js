// @ts-check
// A rewind's Undo stands until the next message (rewind in place, 10-27): once that message is on its way, the line
// a rewind of the files alone left goes, and the rewound line keeps no Undo — at once, in place, while the new turn
// runs, not when the chat is next drawn again. The real timeline is drawn here, on the stub document.
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
  tl = createTimeline(host, /** @type {any} */ ({ onPauseChange() {}, onUndoRewind() {} }));
});
after(() => {
  for (const k of ADDED) delete g[k];
  dom.restore();
});

/** A finished turn n of the archive. @param {number} n @param {any} [rewound] */
const pastTurn = (n, rewound = null) =>
  /** @type {any} */ ({ n, history: true, past: true, status: "done", userText: `turn ${n}`, blocks: [{ type: "text", text: `Answer ${n}.` }], steers: [], segments: [], ...(rewound ? { rewound } : {}) });
const lines = () => host.querySelectorAll(".boundary-row.is-rewound");
const undos = () => host.querySelectorAll(".boundary-row.is-rewound .is-undo");

// (fails before: yes — nothing took them away when the next message went: the line and its Undo stood until the chat
// was drawn again, the Undo then refused by the server)
test("the next message takes the files-only line away, and the rewound line's Undo, in place", () => {
  const files = /** @type {any} */ ({ chainId: "c1", turns: [pastTurn(1), pastTurn(2), pastTurn(3)], rewind: { at: "t", turn: 3, what: "files", line: "", from: 3, to: 3, files: 1 } });
  tl.render(files);
  assert.deepEqual(lines().map((/** @type {any} */ el) => el.querySelector(".boundary-label").textContent), ["↺ You put 1 file back as it was before turn 3"]);
  assert.equal(undos().length, 1);
  files.rewind = null;
  tl.rewindEnded(files);
  assert.equal(lines().length, 0, "the files-only line went with the next message");

  const mark = { from: 2, to: 3, line: "L1", by: "harness", what: "both" };
  const both = /** @type {any} */ ({ chainId: "c2", turns: [pastTurn(1), pastTurn(2, mark), pastTurn(3, mark)], rewind: { at: "t", turn: 2, what: "both", line: "L1", from: 2, to: 3, files: 2 } });
  tl.render(both);
  assert.equal(lines().length, 1);
  assert.equal(undos().length, 1, "Undo stands on the rewound line until the next message");
  tl.rewindEnded(files);
  assert.equal(undos().length, 1, "another chat's message leaves this one's Undo as it is");
  both.rewind = null;
  tl.rewindEnded(both);
  assert.equal(lines().length, 1, "the rewound line stays");
  assert.equal(undos().length, 0, "its Undo went with the next message");
  assert.deepEqual(lines()[0].querySelectorAll("button").map((/** @type {any} */ b) => b.textContent), ["Show them", "Open as a fork"]);
});
