// @ts-check
// A note's reader (the owner's plan mode of 11-06): a long plan kept behind the graph, a review behind a task, read
// whole in a wide sheet outside the Plan view's redrawn tree — a document with its outline down its side, any other
// text as it stands — and the card's rows open it, where they opened the words beneath the row, which every new rev
// of the graph closed.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { applyTasks, graphView } from "../src/core/task-graph.js";
import { mdDoc } from "../src/ui/lib/md.js";
import { OUTLINE_MOST, isDoc, openReader, outlineOf, readerBody } from "../src/ui/harness/views/note-reader.js";
import { drawGraph } from "../src/ui/harness/views/task-graph.js";
import { chooseTask, renderPlan } from "../src/ui/harness/views/plan.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";

const PLAN = [
  "# Plan mode",
  "",
  "## 1. The offer card",
  "Depth and the switch.",
  "```md",
  "# not a heading",
  "```",
  "## The `tasks` tool",
  "### Steps",
  "#### Too deep for the outline",
  "## The **tasks** tool",
].join("\n");

/** Every node under `n` that `pred` picks. @param {any} n @param {(x: any) => boolean} pred @param {any[]} [out] @returns {any[]} */
const all = (n, pred, out = []) => {
  if (n && typeof n === "object") {
    if (pred(n)) out.push(n);
    for (const k of n.kids || []) all(k, pred, out);
  }
  return out;
};
/** @param {any} n @param {string} cls */
const byClass = (n, cls) => all(n, (x) => String(x.attrs?.class || "").split(/\s+/).includes(cls));

describe("the outline", () => {
  test("a document's headings of three levels, none in fenced code, each by the id mdDoc draws it with", () => {
    const o = outlineOf(PLAN, "note1");
    assert.deepEqual(o.map((x) => [x.level, x.text]), [[1, "Plan mode"], [2, "1. The offer card"], [2, "The tasks tool"], [3, "Steps"], [2, "The tasks tool"]]);
    const html = mdDoc(PLAN, "note1");
    for (const x of o) assert.ok(html.includes(`id="${x.id}"`), `${x.id} is drawn`);
    assert.deepEqual(o.map((x) => x.id), ["note1-plan-mode", "note1-the-offer-card", "note1-the-tasks-tool", "note1-steps", "note1-the-tasks-tool-2"]);
  });

  test("a note or a Markdown file reads as a document; other text as it stands", () => {
    assert.deepEqual([isDoc("note", "Plan"), isDoc("file", "plan.md"), isDoc("file", "out.log"), isDoc("file", "data.json")], [true, true, false, false]);
  });
});

describe("the reader", () => {
  test("a document with two headings or more: its outline beside it, each entry going to its heading; one or none: the document alone; other text: as it stands", () => {
    /** @type {string[]} */
    const went = [];
    const body = readerBody(fakeH, PLAN, true, "note1", (id) => went.push(id));
    assert.match(String(body.attrs.class), /has-outline/);
    const entries = byClass(body, "tg-rd-go");
    assert.deepEqual(entries.map(textOf), ["Plan mode", "1. The offer card", "The tasks tool", "Steps", "The tasks tool"]);
    assert.deepEqual(entries.map((e) => String(e.attrs.class)), ["tg-rd-go is-h1", "tg-rd-go is-h2", "tg-rd-go is-h2", "tg-rd-go is-h3", "tg-rd-go is-h2"]);
    entries[3].attrs.onclick();
    assert.deepEqual(went, ["note1-steps"]);
    assert.match(byClass(body, "tg-rd-doc")[0].attrs.html, /<h3 id="note1-steps">Steps<\/h3>/);
    assert.equal(byClass(readerBody(fakeH, "# One\n\nwords", true, "p", () => {}), "tg-rd-outline").length, 0);
    const plain = readerBody(fakeH, "line 1\n# line 2", false, "p", () => {});
    assert.deepEqual([plain.tag, textOf(plain)], ["pre", "line 1\n# line 2"]);
    const long = Array.from({ length: OUTLINE_MOST + 5 }, (_, i) => `## Part ${i + 1}`).join("\n");
    assert.equal(textOf(byClass(readerBody(fakeH, long, true, "p", () => {}), "tg-rd-more")[0]), "and 5 more headings");
  });

  test("it opens in a sheet over the page, reading until its words land, and says what stopped a read", async () => {
    /** @type {any[]} */
    const sheets = [];
    /** @type {string[]} */
    const asked = [];
    const scroller = { querySelector: (/** @type {string} */ sel) => (asked.push(sel), { scrollIntoView: () => asked.push("scrolled") }) };
    const sheet = (/** @type {any} */ o) => (sheets.push(o), { el: null, scroller, close: () => {} });
    const r = openReader({ name: "Plan", kind: "note", sub: "note · behind the graph", load: async () => PLAN, mk: fakeH, sheet });
    assert.deepEqual([sheets[0].label, sheets[0].class, textOf(sheets[0].head)], ["Plan", "tg-reader", "Plan|note · behind the graph"]);
    assert.equal(textOf(sheets[0].body), "Reading…");
    await r.landed;
    const go = byClass(sheets[0].body, "tg-rd-go");
    go[1].attrs.onclick();
    assert.match(asked[0], /^#note\d+-the-offer-card$/);
    assert.equal(asked[1], "scrolled");
    const failed = openReader({ name: "gone.md", kind: "file", sub: "file", load: async () => { throw new Error("404 Not Found"); }, mk: fakeH, sheet });
    await failed.landed;
    assert.equal(textOf(sheets[1].body), "Not read: 404 Not Found");
  });
});

describe("the card's rows open the reader", () => {
  // (fails before: yes — a note opened beneath its row, and every new rev of the graph closed it again)
  test("a note's row and a text file's open it, with what the row says of them; a picture and other files as before", () => {
    /** @type {any} */
    let g = null;
    for (const input of [{ action: "add", goal: "G", tasks: [{ id: "t1", name: "Design" }] }]) g = /** @type {any} */ (applyTasks(g, input, { at: 1_000, crew: "agent" })).graph;
    const view = graphView(g, { t1: { notes: 1, files: 2 } });
    /** @type {any[]} */
    const read = [];
    const pane = {
      of: () => ({ list: { notes: [{ title: "Designer review", chars: 12345, at: 1_000, by: "the agent", first: "Every control stays." }], files: [{ name: "mock.md", bytes: 900, at: 1_000, by: "the agent" }, { name: "login.png", bytes: 2048, at: 1_000, by: "the agent" }] }, error: null }),
      onOpen: (/** @type {any[]} */ ...a) => read.push(a),
      fileUrl: () => "/f",
      graphShown: false,
      onGraph: () => {},
      note: () => null,
    };
    const { el } = drawGraph(view, { h: fakeH, now: 121_000, chosen: "t1", kept: /** @type {any} */ (pane) });
    const rows = byClass(el, "tg-kept-open").filter((b) => b.tag === "button");
    assert.deepEqual(rows.map((b) => b.attrs.title), ["Read Designer review", "Read mock.md"]);
    assert.equal(rows[0].attrs["aria-expanded"], undefined, "it opens a sheet, never beneath the row");
    for (const b of rows) b.attrs.onclick();
    assert.deepEqual(read, [["t1", "Designer review", "note", "note · 12,345 characters · the agent · 2 min ago"], ["t1", "mock.md", "file", "file · 900 bytes · the agent · 2 min ago"]]);
  });
});

describe("the Plan view reads a kept note in the reader", () => {
  // (fails before: yes — the note opened beneath its row, and the graph's next rev closed it)
  test("a press on a note's row reads it whole in the sheet, saying what it is and whose; the view's draws leave it be", async () => {
    const NOW = 1_000_000;
    const g = /** @type {any} */ (applyTasks(null, { action: "add", goal: "G", tasks: [{ id: "t1", name: "Design" }] }, { at: NOW - 120_000, crew: "agent" })).graph;
    let view = graphView(g, { t1: { notes: 1, files: 0 } });
    /** @type {string[]} */
    const asked = [];
    const api = async (/** @type {string} */ path) => {
      asked.push(path);
      if (path.includes("note=")) return { note: { text: "# Plan\n\n## One\n\nwords\n\n## Two" } };
      if (path.includes("/graph/kept")) return { notes: [{ title: "Plan", chars: 30, at: NOW - 60_000, by: "the agent", first: "# Plan" }], files: [] };
      return { inForce: { graph: view, goal: null } };
    };
    /** @type {any[]} */
    const sheets = [];
    const sheet = (/** @type {any} */ o) => (sheets.push(o), { el: null, scroller: null, close: () => {} });
    const chat = { id: "rd", chainId: "chain-rd", title: "Reader", turns: [], live: null, view: { settings: {} } };
    chooseTask(chat, "t1");
    const body = fakeH("div");
    const v = renderPlan(body, { chat }, { h: fakeH, api, now: () => NOW, sheet });
    for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
    v.paint();
    const row = all(body, (x) => x.tag === "button" && x.attrs?.title === "Read Plan")[0];
    assert.ok(row, "the note's row");
    row.attrs.onclick();
    assert.deepEqual([sheets.length, sheets[0].label, textOf(sheets[0].head)], [1, "Plan", 'Plan|note · 30 characters · the agent · 1 min ago · behind t1 "Design"']);
    for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
    assert.ok(asked.some((p) => p.startsWith("/sessions/chain-rd/graph/kept?") && p.includes("note=Plan")), "read whole from the session");
    assert.deepEqual(byClass(sheets[0].body, "tg-rd-go").map(textOf), ["Plan", "One", "Two"]);
    // A new rev of the graph draws the view again; the reader stands outside it.
    view = graphView({ ...g, rev: g.rev + 1 }, { t1: { notes: 1, files: 0 } });
    v.paint();
    assert.equal(sheets.length, 1);
    assert.deepEqual(byClass(sheets[0].body, "tg-rd-go").map(textOf), ["Plan", "One", "Two"]);
  });
});
