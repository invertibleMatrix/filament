// The panes that tile beside the chat (proposal_ux §3.5, Phase 1): the tiling rule's arithmetic (lib/layout.js), the
// layout it keeps (panes/tiles.js) — columns of tiles, each a stack of tabs, cut to the chat shown and folded to the
// window's room — where a pane dragged by hand lands (panes/tile-drag.js), and the Layout menu (panes/pane-buttons.js).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { READ_MIN, PANE_MIN_CONV, PANE_MIN, columnsFor, panesWidth, rowsFor, TILE_MIN_H } from "../src/ui/harness/lib/layout.js";
import {
  blankLayout, chatKey, shownOf, openTab, addTab, closeTab, activate, moveTab, swapTiles, setShares, arrange, rekey, readLayout,
  layoutJson, tileOf, ITEMS_MAX,
} from "../src/ui/harness/panes/tiles.js";
import { dropAt } from "../src/ui/harness/panes/tile-drag.js";
import { layoutItems } from "../src/ui/harness/panes/pane-buttons.js";

/** The room right of a 264 px left bar, as the plan's table counts it. @param {number} w */
const rowOf = (w) => w - 264;
/** A layout's shape as the person sees it: per column, its tiles' tabs. @param {any[]} shown */
const shape = (shown) => shown.map((c) => c.tiles.map((t) => t.tabs.join("+")));
const A = "c:chat-a";
const B = "c:chat-b";
const TOOLS = new Set(["changes", "terminal", "run", "files", "outputs", "prompt"]);
const canOpen = (/** @type {string} */ id) => TOOLS.has(id) || id.startsWith("file:") || id.startsWith("artifact:");

describe("the tiling rule's arithmetic", () => {
  // (fails before: yes — there was one side pane: chosen once, fitted to keep the conversation 480 px, and at 2560 px a
  // 700 px chat sat in empty room while the pane's tabs were cut to one letter)
  test("columns by the room the chat leaves: none under 1440, one to 1600, two from 1920, three on a 3000 px window", () => {
    assert.equal(columnsFor(rowOf(1280), 1280), 0, "1280: the panes float");
    assert.equal(columnsFor(rowOf(1440), 1440), 1);
    assert.equal(columnsFor(rowOf(1600), 1600), 1);
    assert.equal(columnsFor(rowOf(1920), 1920), 2);
    assert.equal(columnsFor(rowOf(2560), 2560), 2, "wide but under 3000: two");
    assert.equal(columnsFor(rowOf(3440), 3440), 3);
    assert.equal(columnsFor(1008, 1280, PANE_MIN_CONV), 1, "Beside: the chat keeps 480, so a 1280 px window docks one");
    assert.equal(columnsFor(700, 1280, PANE_MIN_CONV), 0, "even Beside, a column needs its room");
  });

  test("the chat's width beside the panes: the plan's table, to the pixel", () => {
    const chat = (/** @type {number} */ w, /** @type {number} */ n) => rowOf(w) - panesWidth(rowOf(w), n, null);
    assert.equal(chat(1440, 1), 730);
    assert.equal(chat(1600, 1), 829);
    assert.deepEqual([chat(1920, 1), chat(1920, 2)], [1027, 663]);
    assert.deepEqual([chat(2560, 1), chat(2560, 2)], [1536, 919]);
    assert.deepEqual([chat(3440, 1), chat(3440, 2), chat(3440, 3)], [2416, 1776, 1076]);
  });

  test("a width the person dragged stands, within the chat's least and the columns' own", () => {
    assert.equal(panesWidth(1656, 1, 700), 700);
    assert.equal(panesWidth(1656, 1, 1400), 1656 - READ_MIN, "the chat keeps its 640");
    assert.equal(panesWidth(1656, 2, 300), 2 * PANE_MIN, "two columns keep their least each");
    assert.equal(panesWidth(1100, 1, 700, PANE_MIN_CONV), 1100 - PANE_MIN_CONV, "Beside: 480");
  });

  test("a column holds as many tiles as its height has room for, one at least", () => {
    assert.equal(rowsFor(TILE_MIN_H * 4 + 10), 4);
    assert.equal(rowsFor(40), 1);
  });
});

describe("the panes' layout", () => {
  const wide = { cols: 2, rows: 6 };
  // (fails before: yes — a second pane became a tab of the one strip; the owner's 10-08 description, D2)
  test("the rule: a column, two rows, a second column, 2 × 2 — each pane in a tile of its own", () => {
    const L = blankLayout();
    openTab(L, "changes", A, wide);
    assert.deepEqual(shape(shownOf(L, A, wide)), [["changes"]]);
    openTab(L, "terminal", A, wide);
    assert.deepEqual(shape(shownOf(L, A, wide)), [["changes", "terminal"]], "the second splits the column into two rows");
    openTab(L, "run", A, wide);
    assert.deepEqual(shape(shownOf(L, A, wide)), [["changes", "terminal"], ["run"]], "the third starts a column at full height");
    openTab(L, "files", A, wide);
    assert.deepEqual(shape(shownOf(L, A, wide)), [["changes", "terminal"], ["run", "files"]], "the fourth makes 2 × 2");
    assert.equal(L.shown, true);
    const shown = shownOf(L, A, wide);
    assert.deepEqual(shown.map((c) => c.w), [0.5, 0.5], "evenly wide");
    assert.deepEqual(shown[1].tiles.map((t) => t.h), [0.5, 0.5], "evenly tall");
  });

  test("a third column only on a window that docks three; past the room, a pane joins the tile in use as a tab", () => {
    const L = blankLayout();
    const three = { cols: 3, rows: 6 };
    for (const id of ["changes", "terminal", "run", "files", "outputs", "prompt"]) openTab(L, id, A, three);
    assert.deepEqual(shape(shownOf(L, A, three)), [["changes", "terminal"], ["run", "files"], ["outputs", "prompt"]]);
    const narrow = { cols: 1, rows: 6 };
    const M = blankLayout();
    for (const id of ["changes", "terminal", "run"]) openTab(M, id, A, narrow);
    assert.deepEqual(shape(shownOf(M, A, narrow)), [["changes", "terminal+run"]], "1440: the third joins the tile in use");
    assert.equal(tileOf(M, "run")?.tile.active, "run", "and shows");
    activate(M, "changes");
    openTab(M, "files", A, narrow);
    assert.deepEqual(shape(shownOf(M, A, narrow)), [["changes+files", "terminal+run"]], "the tile in use is the one you last used");
  });

  test("floating, every pane is a tab of one tile, the one in use shown; the layout keeps its tiles for a wider window", () => {
    const L = blankLayout();
    for (const id of ["changes", "terminal", "run"]) openTab(L, id, A, wide);
    const float = shownOf(L, A, { cols: 0, rows: 6 });
    assert.deepEqual(shape(float), [["changes+terminal+run"]], "in the layout's order");
    assert.equal(float[0].tiles[0].active, "run", "the tile in use's tab shows");
    activate(L, "terminal");
    assert.deepEqual(shape(shownOf(L, A, { cols: 0, rows: 6 })), [["changes+terminal+run"]], "a tab picked never moves");
    assert.equal(shownOf(L, A, { cols: 0, rows: 6 })[0].tiles[0].active, "terminal");
    assert.equal(shownOf(L, A, { cols: 0, rows: 6 })[0].tiles[0].id, float[0].tiles[0].id, "one tile, the same, whichever tab shows");
    assert.deepEqual(shape(shownOf(L, A, wide)), [["changes", "terminal"], ["run"]], "nothing was undone");
    const F = blankLayout();
    for (const id of ["changes", "terminal"]) openTab(F, id, A, { cols: 0, rows: 6 });
    assert.deepEqual(shape(shownOf(F, A, wide)), [["changes+terminal"]], "opened floating: tabs, as there was no room");
  });

  test("folded to the room: columns past it and tiles past a column's height join the last tile as tabs", () => {
    const L = blankLayout();
    for (const id of ["changes", "terminal", "run", "files"]) openTab(L, id, A, wide);
    assert.deepEqual(shape(shownOf(L, A, { cols: 1, rows: 6 })), [["changes", "terminal+run+files"]]);
    assert.deepEqual(shape(shownOf(L, A, { cols: 2, rows: 1 })), [["changes+terminal"], ["run+files"]]);
    activate(L, "files");
    const folded = shownOf(L, A, { cols: 1, rows: 6 });
    assert.equal(folded[0].tiles[1].active, "files", "the tab in use shows where it was folded to");
    assert.deepEqual(folded[0].tiles[1].from, [tileOf(L, "terminal")?.tile.id, tileOf(L, "run")?.tile.id, tileOf(L, "files")?.tile.id]);
  });

  test("closing: the tile goes with its last tab and its neighbour takes its room", () => {
    const L = blankLayout();
    L.arrange = "column";
    for (const id of ["changes", "terminal", "run"]) openTab(L, id, A, wide);
    setShares(L, { tiles: L.cols[0].tiles.map((t, i) => ({ id: t.id, h: [0.5, 0.25, 0.25][i] })) });
    closeTab(L, "terminal", A);
    assert.deepEqual(shape(shownOf(L, A, wide)), [["changes", "run"]]);
    assert.deepEqual(shownOf(L, A, wide)[0].tiles.map((t) => t.h), [0.75, 0.25], "the tile above takes its room, the one below keeps its own");
    const M = blankLayout();
    for (const id of ["changes", "terminal", "run"]) openTab(M, id, A, wide);
    setShares(M, { cols: [{ at: 0, w: 0.6 }, { at: 1, w: 0.4 }] });
    closeTab(M, "run", A);
    assert.deepEqual(shape(shownOf(M, A, wide)), [["changes", "terminal"]]);
    assert.equal(M.cols[0].w, 1, "the column beside takes the width");
    assert.equal(M.focus, M.cols[0].tiles[0].id, "and a tile left is the one in use");
    closeTab(M, "terminal", A);
    closeTab(M, "changes", A);
    assert.deepEqual(M.cols, []);
    assert.equal(closeTab(M, "changes", A), false, "closing what is not open does nothing");
  });

  test("a tab of a tile with others: the tile stays and shows its neighbour", () => {
    const L = blankLayout();
    for (const id of ["changes", "terminal", "run"]) openTab(L, id, A, { cols: 1, rows: 6 });
    closeTab(L, "run", A);
    assert.equal(tileOf(L, "terminal")?.tile.active, "terminal");
  });

  // (fails before: yes — a file's or an artifact's tab stayed in the one strip whatever chat was open)
  test("an item belongs to the chats it was opened in; a tool pane follows the chat shown", () => {
    const L = blankLayout();
    openTab(L, "changes", A, wide);
    const file = 'file:["H:/x","a.js"]';
    openTab(L, file, A, wide, { item: true });
    assert.deepEqual(shape(shownOf(L, A, wide)), [["changes", file]]);
    assert.deepEqual(shape(shownOf(L, B, wide)), [["changes"]], "another chat: its tile gives way, Changes takes the column");
    openTab(L, file, B, wide, { item: true });
    assert.deepEqual(shape(shownOf(L, B, wide)), [["changes", file]], "opened there too: the same tile");
    closeTab(L, file, B);
    assert.deepEqual(shape(shownOf(L, B, wide)), [["changes"]], "closed in one chat");
    assert.deepEqual(shape(shownOf(L, A, wide)), [["changes", file]], "still the other's");
    closeTab(L, file, A);
    assert.equal(tileOf(L, file), null, "closed in its last chat: gone");
    assert.deepEqual(L.owners, {});
  });

  test("a new pane goes by what shows: another chat's item tile is not counted, and keeps its place for that chat", () => {
    const L = blankLayout();
    openTab(L, "changes", A, wide);
    openTab(L, 'file:["H:/x","a.js"]', A, wide, { item: true });
    openTab(L, "terminal", B, wide);
    assert.deepEqual(shape(shownOf(L, B, wide)), [["changes", "terminal"]]);
    assert.equal(shownOf(L, A, wide)[0].tiles.length, 3, "back in the first chat, its file shows where it was");
  });

  // (fails before: yes — HarnessV4_Four_Plan FO-D28 kept for the tiles: a pane offered by itself joins without taking the view)
  test("a tab offered by itself joins the tile in use, not shown, the panes as they were", () => {
    const L = blankLayout();
    openTab(L, "changes", A, wide);
    L.shown = false;
    assert.equal(addTab(L, "outputs", A, wide), true);
    assert.deepEqual(shape(shownOf(L, A, wide)), [["changes+outputs"]]);
    assert.equal(tileOf(L, "outputs")?.tile.active, "changes", "the view stays");
    assert.equal(L.shown, false, "hidden panes stay hidden");
    assert.equal(addTab(L, "outputs", A, wide), false, "once");
    // (fails before: yes — Phase 1's pictures: with no tile yet it took one of its own, so Changes then Terminal showed
    // "Outputs" over "Changes + Terminal" as tabs, where the rule gives Changes over Terminal)
    const M = blankLayout();
    assert.equal(addTab(M, "outputs", A, wide), true);
    assert.deepEqual([shape(shownOf(M, A, wide)), M.held, M.shown], [[], ["outputs"], false], "no tile yet: it waits, and takes none");
    assert.equal(addTab(M, "outputs", A, wide), false, "once");
    assert.deepEqual(readLayout(layoutJson(M), canOpen).held, ["outputs"], "kept through a reload");
    openTab(M, "changes", A, wide);
    assert.deepEqual(shape(shownOf(M, A, wide)), [["changes+outputs"]], "it joins the first pane opened, behind it");
    assert.deepEqual([tileOf(M, "outputs")?.tile.active, M.held], ["changes", []]);
    openTab(M, "terminal", A, wide);
    assert.deepEqual(shape(shownOf(M, A, wide)), [["changes+outputs", "terminal"]], "and the rule goes on by the panes the person opens");
    const N = blankLayout();
    addTab(N, "outputs", A, wide);
    openTab(N, "outputs", A, wide);
    assert.deepEqual([shape(shownOf(N, A, wide)), N.held], [[["outputs"]], []], "opened while it waits: a pane like any other");
    addTab(N, "files", B, { cols: 0, rows: 6 });
    assert.deepEqual([shape(shownOf(N, B, wide)), N.held], [[["outputs+files"]], []], "where a tile shows, it joins that tile as a tab");
    const W = blankLayout();
    addTab(W, "outputs", A, wide);
    assert.deepEqual([closeTab(W, "outputs", A), W.held], [true, []], "closed while it waits: it waits no more");
  });

  test("a chat sent for the first time: its items, held under the page's key, are its session's", () => {
    const L = blankLayout();
    const page = chatKey({ id: "harness-1" });
    assert.equal(page, "p:harness-1");
    assert.equal(chatKey({ id: "harness-1", chainId: "s1" }), "c:s1");
    openTab(L, "artifact:deck", page, wide, { item: true });
    assert.equal(rekey(L, page, "c:s1"), true);
    assert.deepEqual(L.owners["artifact:deck"], ["c:s1"]);
    assert.equal(rekey(L, page, "c:s1"), false);
  });

  test("past the items' cap, the oldest another chat holds goes, never the chat's own", () => {
    const L = blankLayout();
    for (let i = 0; i < ITEMS_MAX; i++) openTab(L, `file:["H:/x","${i}.js"]`, B, wide, { item: true });
    openTab(L, 'file:["H:/x","mine.js"]', A, wide, { item: true });
    assert.equal(Object.keys(L.owners).length, ITEMS_MAX);
    assert.equal(tileOf(L, 'file:["H:/x","0.js"]'), null, "the oldest went");
    assert.ok(tileOf(L, 'file:["H:/x","mine.js"]'));
  });

  test("moving: onto a tile's tabs, or to its edge — a column beside it or a tile above or below it, taking half its room", () => {
    const L = blankLayout();
    for (const id of ["changes", "terminal"]) openTab(L, id, A, wide);
    const tChanges = /** @type {any} */ (tileOf(L, "changes")).tile.id;
    assert.equal(moveTab(L, "terminal", { tile: tChanges }), true);
    assert.deepEqual(shape(shownOf(L, A, wide)), [["changes+terminal"]], "onto its tabs");
    assert.equal(tileOf(L, "terminal")?.tile.active, "terminal");
    moveTab(L, "terminal", { tile: tChanges, edge: "right" });
    assert.deepEqual(shape(shownOf(L, A, wide)), [["changes"], ["terminal"]], "to its right edge: a column");
    assert.deepEqual(L.cols.map((c) => c.w), [0.5, 0.5]);
    moveTab(L, "terminal", { tile: tChanges, edge: "top" });
    assert.deepEqual(shape(shownOf(L, A, wide)), [["terminal", "changes"]], "to its top edge: a tile above");
    assert.equal(moveTab(L, "changes", { tile: tChanges, edge: "left" }), false, "alone in its tile, to its own edge: stays");
    openTab(L, "run", A, wide);
    const tRun = /** @type {any} */ (tileOf(L, "run")).tile.id;
    moveTab(L, "changes", { tile: tRun, index: 0 });
    assert.deepEqual(tileOf(L, "run")?.tile.tabs, ["changes", "run"], "at the place it was dropped");
    moveTab(L, "changes", { tile: tRun, index: 2 });
    assert.deepEqual(tileOf(L, "run")?.tile.tabs, ["run", "changes"], "and reordered in its own tile");
  });

  test("the tile ⋯ menu's Move swaps what two tiles hold, their sizes kept", () => {
    const L = blankLayout();
    for (const id of ["changes", "terminal"]) openTab(L, id, A, wide);
    setShares(L, { tiles: [{ id: L.cols[0].tiles[0].id, h: 0.7 }, { id: L.cols[0].tiles[1].id, h: 0.3 }] });
    swapTiles(L, L.cols[0].tiles[0].id, L.cols[0].tiles[1].id);
    assert.deepEqual(shape(shownOf(L, A, wide)), [["terminal", "changes"]]);
    assert.deepEqual(L.cols[0].tiles.map((t) => t.h), [0.7, 0.3]);
  });

  test("an arrangement picked lays the chat's panes out anew: Tabs in one tile, One column as rows, Grid by the rule", () => {
    const L = blankLayout();
    for (const id of ["changes", "terminal", "run", "files"]) openTab(L, id, A, wide);
    openTab(L, 'file:["H:/x","b.js"]', B, wide, { item: true });
    activate(L, "run");
    arrange(L, "tabs", A, wide);
    assert.deepEqual(shape(shownOf(L, A, wide)), [["changes+terminal+run+files"]]);
    assert.equal(shownOf(L, A, wide)[0].tiles[0].active, "run", "the tab in use stays in use");
    assert.ok(tileOf(L, 'file:["H:/x","b.js"]'), "another chat's item keeps a tile of its own");
    openTab(L, "outputs", A, wide);
    assert.deepEqual(shape(shownOf(L, A, wide)), [["changes+terminal+run+outputs+files"]], "Tabs: the next joins the tile in use");
    arrange(L, "column", A, wide);
    assert.deepEqual(shape(shownOf(L, A, wide)), [["changes", "terminal", "run", "outputs", "files"]]);
    arrange(L, "grid", A, wide);
    assert.deepEqual(shape(shownOf(L, A, wide)), [["changes", "terminal"], ["run", "outputs+files"]]);
    assert.deepEqual(shape(shownOf(L, B, wide)), [["changes", "terminal"], ["run", "outputs+files", 'file:["H:/x","b.js"]']], "the tool panes follow the other chat, its item after them");
  });

  test("stored and read back: as it was; what it cannot open, junk and another page's chats left out", () => {
    const L = blankLayout();
    for (const id of ["changes", "terminal", "run"]) openTab(L, id, A, wide);
    openTab(L, "artifact:deck", "p:harness-old", wide, { item: true });
    L.widths["1"] = 610;
    L.place = "beside";
    const back = readLayout(layoutJson(L), canOpen);
    assert.deepEqual(shape(shownOf(back, A, wide)), [["changes", "terminal"], ["run"]], "the unsent chat's item went with its page");
    assert.equal(tileOf(back, "artifact:deck"), null);
    assert.deepEqual([back.place, back.arrange, back.widths["1"], back.shown], ["beside", "grid", 610, true]);
    const odd = readLayout(JSON.stringify({ cols: [{ w: -1, tiles: [{ id: "t9", tabs: ["changes", "changes", "gone", 5], h: "x" }] }, { tiles: "no" }], arrange: "spiral", place: 7, widths: { 1: -3, 4: 900 }, seq: 2 }), canOpen);
    assert.deepEqual(shape(shownOf(odd, A, wide)), [["changes"]]);
    assert.deepEqual([odd.arrange, odd.place, odd.widths, odd.seq, odd.cols[0].w, odd.cols[0].tiles[0].h], ["grid", "auto", {}, 9, 1, 1]);
    openTab(odd, "terminal", A, wide);
    assert.equal(tileOf(odd, "terminal")?.tile.id, "t10", "a new tile's number follows the highest");
    assert.deepEqual(readLayout("{not json", canOpen).cols, []);
  });

  // (fails before: yes — the plan's "today's open tabs carry over into the first tile")
  test("nothing stored: the one strip's tabs carried over into one tile, hidden as the strip started", () => {
    const L = readLayout(null, canOpen, { tabs: JSON.stringify(["changes", 'file:["H:/x","a.js"]', "devtools-gone", "terminal"]), tab: "terminal" });
    assert.deepEqual(shape(shownOf(L, A, wide)), [['changes+file:["H:/x","a.js"]+terminal']]);
    assert.equal(L.cols[0].tiles[0].active, "terminal");
    assert.equal(L.shown, false);
    assert.deepEqual(shape(shownOf(L, B, wide)), [['changes+file:["H:/x","a.js"]+terminal']], "a carried-over file shows in every chat, as it did");
    assert.deepEqual(readLayout(null, canOpen, {}).cols, []);
  });
});

describe("moving a pane by hand, and the Layout menu", () => {
  const box = { left: 0, top: 0, width: 400, height: 300 };
  const tabs = [{ left: 10, width: 100 }, { left: 110, width: 100 }];

  test("dropped on a tile's head: among its tabs, before the first whose middle is right of the point; past them, at the end", () => {
    assert.deepEqual(dropAt({ x: 20, y: 10 }, box, 38, tabs), { edge: null, index: 0 });
    assert.deepEqual(dropAt({ x: 100, y: 10 }, box, 38, tabs), { edge: null, index: 1 });
    assert.deepEqual(dropAt({ x: 300, y: 10 }, box, 38, tabs), { edge: null, index: 2 });
    assert.deepEqual(dropAt({ x: 300, y: 10 }, box, 38, []), { edge: null, index: 1 }, "a tile showing one pane: after it");
  });

  test("dropped in a tile's body: its nearest edge within a quarter of the tile, else the middle, joining its tabs at their end", () => {
    assert.deepEqual(dropAt({ x: 40, y: 150 }, box, 38, tabs), { edge: "left", index: 0 });
    assert.deepEqual(dropAt({ x: 380, y: 150 }, box, 38, tabs), { edge: "right", index: 0 });
    assert.deepEqual(dropAt({ x: 200, y: 60 }, box, 38, tabs), { edge: "top", index: 0 });
    assert.deepEqual(dropAt({ x: 200, y: 290 }, box, 38, tabs), { edge: "bottom", index: 0 });
    assert.deepEqual(dropAt({ x: 200, y: 150 }, box, 38, tabs), { edge: null, index: 2 });
    assert.deepEqual(dropAt({ x: 20, y: 280 }, box, 38, []), { edge: "left", index: 0 }, "a corner: the nearer edge");
  });

  test("the Layout menu: Arrange, then Place, the ones in force checked; a pick goes to the panes", () => {
    /** @type {string[][]} */
    const picked = [];
    const host = { arrange: "column", place: "over", setArrange: (/** @type {string} */ a) => picked.push(["arrange", a]), setPlace: (/** @type {string} */ p) => picked.push(["place", p]) };
    /** @type {any[]} */
    const rows = layoutItems(host);
    const words = rows.map((r) => (r.type === "radio" ? `${r.checked ? "●" : "○"} ${r.label}` : r.type === "label" ? `[${r.label}]` : "—"));
    assert.deepEqual(words, ["[Arrange]", "○ Grid as they open", "● One column", "○ Tabs in one pane", "—", "[Place]", "○ Auto", "○ Beside", "● Over the chat"]);
    rows[1].onClick();
    rows[7].onClick();
    assert.deepEqual(picked, [["arrange", "grid"], ["place", "beside"]]);
  });
});
