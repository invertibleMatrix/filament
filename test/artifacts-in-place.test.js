// @ts-check
// The Artifacts page drawn again keeps what stands under the pointer (the owner's of 11-01: "when i hover over my mouse
// over some interactive elements like buttons then those are just suppose to highlight only once they quite a lot of
// time they start blinking … and during that sometimes the clicks even don't pass through so i have to press more than
// once"). Each version published and each rename, pin and delete, wherever it was done, read the list again and placed
// it anew whole: the months, the rows and the ⋮ buttons new elements under a resting pointer, whose hover started over
// and where a press that began on the old one never clicked, and each grid new, its cards moved into it — a frame moved
// loads again. Drawn in place (dom.js `morphChildren`), each keyed by what it is, they are the elements that stood, the
// cards placed in the grid that stood and never taken out; a ⋮ pressed hangs its menu off the button on the page, and
// a row's press opens the record as it is now.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";

/** @type {ReturnType<typeof stubDocument>} */
let doc;
/** @type {typeof import("../src/ui/harness/artifacts-page.js")} */
let lib;
/** The events streams the page opened: a message handed to one reaches the page as the fan-out's would. @type {any[]} */
const streams = [];
/** Each read of the admin API. @type {string[]} */
const reads = [];
/** The artifacts as the admin API answers them now. @type {any[]} */
let artifacts = [];
before(async () => {
  const g = /** @type {any} */ (globalThis);
  doc = stubDocument();
  /** @type {any} */ (doc.document).addEventListener ||= () => {};
  g.window.setTimeout = setTimeout;
  g.window.clearTimeout = clearTimeout;
  g.addEventListener ||= () => {};
  g.removeEventListener ||= () => {};
  g.requestAnimationFrame ||= (/** @type {() => void} */ fn) => setTimeout(fn, 0);
  g.MutationObserver ||= class { observe() {} disconnect() {} };
  g.EventSource = class {
    /** @param {string} url */
    constructor(url) {
      this.url = url;
      streams.push(this);
    }
    close() {}
  };
  // Served to another machine by its name: the grid's previews frame nothing, so no frame is loaded here.
  g.location = { hostname: "mybox.lan", host: "mybox.lan:20300", port: "20300", protocol: "http:", search: "", hash: "", href: "http://mybox.lan:20300/" };
  /** @type {Map<string, string>} */
  const kept = new Map();
  g.localStorage = { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, String(v)), removeItem: (/** @type {string} */ k) => void kept.delete(k) };
  g.fetch = async (/** @type {string} */ url) => {
    reads.push(url);
    if (url === "/api/artifacts") return { ok: true, status: 200, json: async () => ({ artifacts: structuredClone(artifacts) }) };
    return { ok: false, status: 404, statusText: "no such route", json: async () => ({ error: `no route ${url}` }) };
  };
  lib = await import("../src/ui/harness/artifacts-page.js");
});
after(() => doc.restore());

const OCT_20 = Date.UTC(2026, 9, 20, 10, 0, 0);
const OCT_10 = Date.UTC(2026, 9, 10, 10, 0, 0);
/** An artifact as the admin API lists it. @param {Record<string, any>} o */
const art = (o) => ({ description: "", icon: "page", type: "page", pinned: false, viewedAt: 0, folder: "", model: "", address: "", chats: {}, versions: [{ v: 1, at: o.createdAt, model: "", chain: "c1", files: 1, bytes: 10 }], ...o });
const budget = () => art({ name: "budget-ab12", title: "Budget", createdAt: OCT_20, updatedAt: OCT_20 });
const board = () => art({ name: "board-cd34", title: "Board", createdAt: OCT_10, updatedAt: OCT_10 });

const settle = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
};
/** The page's wait after a change heard passed, and what it read answered. */
const heard = async () => {
  await new Promise((r) => setTimeout(r, 150));
  await settle();
};
/** A change to an artifact on the events fan-out, as the page's stream hands it. @param {string} name @param {string} change */
const say = (name, change) => streams[0].onmessage({ data: JSON.stringify({ type: "artifact", name, v: 1, title: "", change }) });

/** The page on the stub document over the artifacts as they are, each open recorded. */
const open = async () => {
  /** @type {string[]} */
  const opened = [];
  const host = /** @type {any} */ (doc.document.createElement("div"));
  doc.document.body.append(host);
  lib.renderArtifactsPage(host, { onClose() {}, onOpen: (name) => void opened.push(name), onNew() {}, onSession() {} });
  await settle();
  return { host, opened };
};

// (fails before: yes — each change heard placed the list anew whole: the month, its grid and the card's ⋮ new elements, the card moved into the new grid)
test("the grid, a rename heard: the month, its grid, the card and its ⋮ stand, the card never taken out; the ⋮ that stood opens its menu, and the card opens the record as it is now", async () => {
  artifacts = [budget(), board()];
  const { host, opened } = await open();
  try {
    host.querySelector('[data-layout="grid"]').dispatch("click");
    const month = host.querySelector(".artifacts-month");
    const grid = month?.querySelector(".artifacts-grid");
    const card = grid?.querySelector('[data-artifact-row="budget-ab12"]');
    const more = card?.querySelector(".artifacts-more");
    const icon = host.querySelector(".artifacts-filter .artifacts-filter-ic");
    assert.ok(month && grid && card && more && icon, "the month, its grid, a card, its ⋮ and the filter's icon");
    assert.equal(grid.children.length, 2);
    // What the grid takes out or puts in from here on: nothing, for a card that stays — a frame taken out loads again.
    /** @type {string[]} */
    const moved = [];
    const proto = Object.getPrototypeOf(grid);
    grid.removeChild = (/** @type {any} */ n) => (moved.push(`out ${n.getAttribute("data-artifact-row")}`), proto.removeChild.call(grid, n));
    grid.insertBefore = (/** @type {any} */ n, /** @type {any} */ ref) => (moved.push(`in ${n.getAttribute("data-artifact-row")}`), proto.insertBefore.call(grid, n, ref));
    // Renamed in another tab: the list read again, drawn on the elements that stood.
    artifacts[0].title = "Budget 2027";
    reads.length = 0;
    say("budget-ab12", "renamed");
    await heard();
    assert.deepEqual(reads, ["/api/artifacts"], "the list read again");
    assert.equal(host.querySelector(".artifacts-month"), month, "the month that stood");
    assert.equal(month.querySelector(".artifacts-grid"), grid, "the grid that stood");
    assert.equal(grid.querySelector('[data-artifact-row="budget-ab12"]'), card, "the card that stood");
    assert.equal(card.querySelector(".artifacts-more"), more, "its ⋮");
    assert.equal(host.querySelector(".artifacts-filter .artifacts-filter-ic"), icon, "the filter's icon");
    assert.deepEqual(moved, [], "the card was never taken out of its grid");
    assert.equal(card.querySelector(".artifact-title").textContent, "Budget 2027", "the card that stood reads the new title");
    assert.equal(card.getAttribute("aria-label"), "Open Budget 2027");
    // The ⋮ that stood opens its menu, hung off it; a second press closes it.
    more.dispatch("click");
    const menu = doc.document.body.querySelector(".zc-menu");
    assert.ok(menu, "its menu");
    assert.match(menu.textContent, /Rename…/);
    more.dispatch("click");
    assert.ok(!doc.document.body.querySelector(".zc-menu"), "closed by the second press");
    // A press on the card that stood opens it, and so does Enter on it.
    card.dispatch("click");
    card.dispatch("keydown", { key: "Enter" });
    assert.deepEqual(opened, ["budget-ab12", "budget-ab12"]);
  } finally {
    host.remove();
  }
});

// (fails before: yes — each change heard placed the list anew whole: the list, its rows and their ⋮ new elements)
test("the list, a pin heard: the rows that stood, by name as they move, the pin on the one pinned; its ⋮ that stood reads the record as it is now, and the row that stood opens it", async () => {
  artifacts = [budget(), board()];
  const { host, opened } = await open();
  try {
    host.querySelector('[data-layout="list"]').dispatch("click");
    const list = host.querySelector(".artifacts-list");
    const rows = () => [...host.querySelectorAll(".artifacts-row")].map((r) => r.getAttribute("data-artifact-row"));
    const budgetRow = host.querySelector('.artifacts-row[data-artifact-row="budget-ab12"]');
    const boardRow = host.querySelector('.artifacts-row[data-artifact-row="board-cd34"]');
    const more = boardRow?.querySelector(".artifacts-more");
    assert.ok(list && budgetRow && boardRow && more, "the list, its two rows and a ⋮");
    assert.deepEqual(rows(), ["budget-ab12", "board-cd34"]);
    assert.ok(!boardRow.querySelector(".artifacts-pin"), "Board not pinned yet");
    // Board pinned, and changed since, in another tab — the newest now: the rows that stood, Board's first, its pin on it.
    artifacts[1].pinned = true;
    artifacts[1].updatedAt = OCT_20 + 60_000;
    say("board-cd34", "pinned");
    await heard();
    assert.equal(host.querySelector(".artifacts-list"), list, "the list that stood");
    assert.equal(host.querySelector('.artifacts-row[data-artifact-row="board-cd34"]'), boardRow, "Board's row that stood");
    assert.equal(host.querySelector('.artifacts-row[data-artifact-row="budget-ab12"]'), budgetRow, "Budget's row that stood");
    assert.equal(boardRow.querySelector(".artifacts-more"), more, "its ⋮");
    assert.deepEqual(rows(), ["board-cd34", "budget-ab12"], "Board first");
    assert.ok(boardRow.querySelector(".artifacts-pin"), "pinned, on the row that stood");
    // The ⋮ that stood offers Unpin: the record as it is now.
    more.dispatch("click");
    const menu = doc.document.body.querySelector(".zc-menu");
    assert.ok(menu, "its menu");
    assert.match(menu.textContent, /Unpin/);
    assert.doesNotMatch(menu.textContent, /\bPin\b/);
    more.dispatch("click");
    assert.ok(!doc.document.body.querySelector(".zc-menu"), "closed by the second press");
    // The row that stood opens the record, by its name.
    boardRow.dispatch("click");
    assert.deepEqual(opened, ["board-cd34"]);
  } finally {
    host.remove();
  }
});
