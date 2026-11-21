// @ts-check
// A turn's file card draws its rows only while it stands open, or while Find's words match one of them (the owner's of
// 11-17: one turn's card held 78,058 rows — 530,000 of the chat window's 540,000 nodes — closed, under the tree card that
// stands in for it, drawn again at each placing of its turn). Its head says what it always said; opened, it shows the
// rows it always showed; Find finds what it always found, a hidden card's rows included.
// (fails before: yes — a closed card held every row)
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";

const g = /** @type {any} */ (globalThis);
/** Each run's answer the stand-in server gives, by its id; a run with none is answered as gone. @type {Map<string, any>} */
const answers = new Map();
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url) => {
  const id = decodeURIComponent(/\/runs\/([^/]+)\/changes/.exec(String(url))?.[1] || "");
  const body = answers.get(id);
  return body ? new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }) : new Response("{}", { status: 404 });
};
const dom = stubDocument();
// The page's timers, which the timeline reads off its window as it loads.
Object.assign(g.window, {
  setInterval: (/** @type {any} */ fn, /** @type {number} */ ms) => { const t = setInterval(fn, ms); t.unref?.(); return t; },
  clearInterval,
  setTimeout: (/** @type {any} */ fn, /** @type {number} */ ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; },
  clearTimeout,
});
const { fileChangeCard, revealFiles, foldFiles } = await import("../src/ui/harness/conversation/timeline.js");
const { h } = await import("../src/ui/lib/dom.js");
test.after(() => {
  g.fetch = realFetch;
  dom.restore();
});

/** @param {any} card */
const rows = (card) => card.querySelectorAll(".file-row");
/** @param {any} card */
const summaryOf = (card) => card.querySelector("summary");
/** A row's texts, span by span, as Find walks them. @param {any} row */
const said = (row) => row.children.map((/** @type {any} */ k) => k.textContent);

test("closed, a card holds no row; its head counts them; a press draws them before it shows open, in order", () => {
  const card = /** @type {any} */ (fileChangeCard(["src/a.js", "b.md", "deep/x/c.ts"], {}));
  assert.equal(rows(card).length, 0);
  assert.equal(card.querySelector(".file-label").textContent, "3 files changed");
  summaryOf(card).dispatch("click");
  assert.deepEqual(rows(card).map((/** @type {any} */ r) => r.querySelector(".file-leaf").textContent), ["a.js", "b.md", "c.ts"]);
  assert.deepEqual(said(rows(card)[0]), ["a.js", "", "src/a.js"], "leaf, counts, path — as drawn before");
});

test("opening keeps the rows a press drew (Find's marks stand); closing lets them go; any other open draws them", () => {
  const card = /** @type {any} */ (fileChangeCard(["a.js", "b.js"], {}));
  summaryOf(card).dispatch("click");
  const first = rows(card)[0];
  card.open = true;
  card.dispatch("toggle");
  assert.equal(rows(card)[0], first, "the same row, not drawn again");
  card.open = false;
  card.dispatch("toggle");
  assert.equal(rows(card).length, 0);
  card.open = true;
  card.dispatch("toggle");
  assert.equal(rows(card).length, 2);
});

test("the run's answer: a closed card's head moves and no row is drawn; an open card's rows are drawn from it", async () => {
  const run = { whole: { files: [{ path: "src/x.js", added: 12, removed: 3, place: "/repo" }, { path: "y.js", added: 1, place: "/other", via: "command" }], during: [{ place: "/repo", path: "z" }], outside: [], totals: { added: 13, removed: 3 } }, folder: "/repo" };
  answers.set("run-closed", run).set("run-open", run);
  const closed = /** @type {any} */ (fileChangeCard(["src/x.js"], { runId: "run-closed" }));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(closed.querySelector(".file-label").textContent, "2 files changed");
  assert.equal(rows(closed).length, 0);
  assert.equal(closed.querySelectorAll(".file-during").length, 1, "the lines under the rows stand");

  const open = /** @type {any} */ (fileChangeCard(["src/x.js"], { runId: "run-open" }));
  summaryOf(open).dispatch("click");
  open.open = true;
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(rows(open).map(said), [["x.js", "+12−3", "src/x.js"], ["y.js", "+1", "in other", "via a command"]]);
  // The rows stand before the lines under them, as before (harness.css `.file-outside:first-child`).
  const list = open.querySelector(".file-list");
  assert.equal(list.children.at(-1).classList.contains("file-during"), true);
});

test("Find draws the rows of a closed card that hold its words — a hidden one's too — and lets them go", () => {
  const root = h("div", {});
  const shown = /** @type {any} */ (fileChangeCard(["src/parser.js", "readme.md"], {}));
  const hidden = /** @type {any} */ (fileChangeCard(["lib/parser-old.js"], {}));
  hidden.classList.add("hidden");
  const other = /** @type {any} */ (fileChangeCard(["notes.txt"], {}));
  root.append(shown, hidden, other);
  assert.equal(revealFiles(root, "parser"), 2);
  assert.equal(rows(shown).length, 2, "every row of a card that holds the words");
  assert.equal(rows(hidden).length, 1);
  assert.equal(rows(other).length, 0);
  // Find opens the card its match is in: the rows it marked stay.
  const marked = rows(shown)[0];
  shown.open = true;
  shown.dispatch("toggle");
  assert.equal(rows(shown)[0], marked);
  shown.open = false;
  shown.dispatch("toggle");
  assert.equal(rows(shown).length, 2, "closed while Find holds it: kept");
  // Words that no longer match let go of what they drew.
  revealFiles(root, "readme");
  assert.equal(rows(hidden).length, 0);
  assert.equal(rows(shown).length, 2);
  foldFiles(root);
  assert.equal(rows(shown).length, 0);
});
