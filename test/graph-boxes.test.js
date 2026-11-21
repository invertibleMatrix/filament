// @ts-check
// The Plan page's task graph laid out (the Product agent's redesign of 11-05, the owner's yes: "a task is one line, a row
// is a step, a line means needs" — no islands, no wrapping; a hunt's fixes inside the task it hunted): the rows, the
// order that crosses fewest lines, the boxes' places, the lines and the slots they pass rows in, the hunt boxes, the
// folds, and an 80-task graph. Numbers in, numbers out: the drawing of it is task-graph-view.test.js's and
// plan-page.test.js's.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { BOX, PAD, PADX, boxesOf, groupsOf, layersOf, packRow } from "../src/ui/harness/lib/graph-boxes.js";
import { FOLD } from "../src/ui/harness/lib/graph-lanes.js";

/** Tasks from [id, needs, state?, found on?] rows, in the view's order. @param {[string, string[], string?, string?][]} rows */
const tasksOf = (rows) => rows.map(([id, needs, state, on]) => ({ id, needs, state: state || "waiting", ...(on ? { foundBy: { task: on } } : {}) }));

/** The mock's search graph. */
const SEARCH = tasksOf([
  ["t1", []], ["t2", ["t1"]], ["t3", ["t1"]], ["t4", ["t2"]], ["t5", ["t3"]], ["t6", ["t3"]], ["t7", ["t4"]], ["t8", ["t4"]], ["t9", ["t4"]],
  ["t10", ["t7", "t5"]], ["t11", ["t8", "t9", "t10"]], ["t12", ["t11", "t6"]],
]);

/** The docs site's shape: one root, twelve pages under it — and a page apart — and one sink that needs every page. */
const DOCS = tasksOf([
  ["d1", []],
  ...Array.from({ length: 12 }, (_, i) => /** @type {[string, string[]]} */ ([`d${i + 2}`, ["d1"]])),
  ["d14", Array.from({ length: 12 }, (_, i) => `d${i + 2}`)], ["d15", ["d1"]], ["d16", ["d15"]], ["d17", ["d14", "d16"]], ["d18", ["d17"]],
]);

/**
 * An 80-task graph of the kind that grows in a long session, the same every run: one wide part with joins that skip
 * rows, a fan out and in, a chain with branches, and tasks on their own.
 */
function eighty() {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  /** @type {[string, string[], string?][]} */
  const rows = [];
  for (let i = 0; i < 32; i++) {
    const needs = i === 0 ? [] : [...new Set([`w${Math.floor(rnd() * i)}`, ...(i > 3 && rnd() < 0.45 ? [`w${Math.floor(rnd() * i)}`] : [])])];
    rows.push([`w${i}`, needs, i < 10 ? "done" : i < 13 ? "running" : undefined]);
  }
  rows.push(["f0", [], "done"]);
  for (let i = 1; i <= 12; i++) rows.push([`f${i}`, ["f0"], i < 6 ? "done" : undefined]);
  rows.push(["f13", Array.from({ length: 12 }, (_, i) => `f${i + 1}`)]);
  for (let i = 0; i < 18; i++) rows.push([`c${i}`, i === 0 ? [] : [`c${i % 3 === 0 ? i - 3 < 0 ? 0 : i - 3 : i - 1}`]]);
  for (let i = 0; i < 16; i++) rows.push([`s${i}`, []]);
  return tasksOf(rows);
}

/** Random graphs of 10 to 80 tasks, the same every run. */
function randomGraphs() {
  /** @type {ReturnType<typeof tasksOf>[]} */
  const out = [];
  for (let seed0 = 1; seed0 <= 40; seed0++) {
    let seed = seed0 * 7919;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const n = 10 + Math.floor(rnd() * 71);
    /** @type {[string, string[]][]} */
    const rows = [];
    for (let i = 0; i < n; i++) rows.push([`t${i}`, i === 0 || rnd() < 0.15 ? [] : [...new Set(Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => `t${Math.floor(rnd() * i)}`))]]);
    out.push(tasksOf(rows));
  }
  return out;
}

/** A box's middle. @param {ReturnType<typeof boxesOf>} lay @param {string} id */
const mid = (lay, id) => { const b = /** @type {any} */ (lay.boxes.get(id)); return b.x + b.w / 2; };
/** A box's top. @param {ReturnType<typeof boxesOf>} lay @param {string} id */
const top = (lay, id) => /** @type {any} */ (lay.boxes.get(id)).y;

describe("a row a step (the owner's yes of 11-05)", () => {
  test("a task one row under the deepest of its needs, from 0", () => {
    const byId = new Map(SEARCH.map((t) => [t.id, t]));
    const layer = layersOf(SEARCH.map((t) => t.id), byId);
    assert.deepEqual(Object.fromEntries(layer), { t1: 0, t2: 1, t3: 1, t4: 2, t5: 2, t6: 2, t7: 3, t8: 3, t9: 3, t10: 4, t11: 5, t12: 6 });
    const lay = boxesOf(SEARCH);
    for (const t of SEARCH) for (const n of t.needs) assert.ok(top(lay, n) < top(lay, t.id), `${n} above ${t.id}`);
    assert.deepEqual(lay.rows.map((r) => r.length), [1, 2, 3, 3, 1, 1, 1]);
  });

  // (fails before: yes — a layer wider than the room wrapped into rows of as many columns as the room held, so a row
  // looked as if it waited on the one above it)
  test("a row never wraps: the docs site's thirteen pages stand in one row, the graph as wide as they need", () => {
    const lay = boxesOf(DOCS);
    assert.deepEqual(lay.rows.map((r) => r.length), [1, 13, 2, 1, 1]);
    const second = new Set(["d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9", "d10", "d11", "d12", "d13", "d15"].map((id) => top(lay, id)));
    assert.equal(second.size, 1, "one row");
    assert.ok(lay.w >= 13 * BOX.w + 12 * BOX.gx + 2 * PADX);
    assert.ok(top(lay, "d1") < top(lay, "d2") && top(lay, "d2") < top(lay, "d14") && top(lay, "d14") < top(lay, "d17"));
  });

  // (fails before: yes — the tasks with no needs and nothing that needs them stood apart, in a loose island of their own)
  test("no islands: a task on its own stands in the top row with the others that need nothing, in the order it was added", () => {
    const lay = boxesOf(tasksOf([["a", []], ["lone", []], ["b", ["a"]], ["x", []], ["y", ["x"]]]));
    assert.deepEqual(lay.rows, [["a", "lone", "x"], ["b", "y"]]);
  });

  test("a loop of needs the core never makes still lays out", () => {
    assert.equal(boxesOf(tasksOf([["a", ["b"]], ["b", ["a"]], ["c", ["a"]]])).boxes.size, 3);
  });

  test("an empty graph lays out empty", () => {
    const lay = boxesOf([]);
    assert.deepEqual([lay.boxes.size, lay.rows, lay.lines, lay.fold], [0, [], [], null]);
  });
});

describe("the order and the places", () => {
  test("in a row, the order that crosses fewest lines; ties keep the view's order", () => {
    // y was added before x, so the view's order alone would cross a's line to x with b's to y; j joins them.
    const lay = boxesOf(tasksOf([["a", []], ["b", []], ["y", ["b"]], ["x", ["a"]], ["j", ["x", "y"]]]));
    assert.ok(mid(lay, "a") < mid(lay, "b") && mid(lay, "x") < mid(lay, "y"), "x under a, y under b");
  });

  test("a task's state never moves its box", () => {
    const half = SEARCH.map((t, i) => ({ ...t, state: i < 2 ? "done" : i === 5 ? "failed" : "running" }));
    assert.deepEqual(boxesOf(half).boxes, boxesOf(SEARCH).boxes);
  });

  test("every task one line, one width; a chain stands in one column, a fork of three's need over the middle one; boxes in a row never closer than the gap", () => {
    for (const b of boxesOf(SEARCH).boxes.values()) assert.deepEqual([b.w, b.h], [BOX.w, BOX.h]);
    const lay = boxesOf(tasksOf([["a", []], ["b", ["a"]], ["c", ["b"]], ["p", []], ["q", ["p"]], ["r", ["p"]], ["s", ["p"]]]));
    assert.deepEqual([mid(lay, "b"), mid(lay, "c")], [mid(lay, "a"), mid(lay, "a")]);
    assert.equal(mid(lay, "p"), mid(lay, "r"));
    assert.deepEqual([mid(lay, "r") - mid(lay, "q"), mid(lay, "s") - mid(lay, "r")], [BOX.w + BOX.gx, BOX.w + BOX.gx]);
  });

  test("a row packs each place as near its wish as the least distances allow", () => {
    assert.deepEqual(packRow([0, 0, 0], [1, 1, 1], [0, 10, 10]), [-10, 0, 10]);
    assert.deepEqual(packRow([0, 50], [1, 1], [0, 10]), [0, 50]);
    assert.deepEqual(packRow([0, 0], [1, 3], [0, 8]), [-6, 2]);
  });

  test("the boxes take the size they are given, as the page's type is larger or smaller; the drawing starts at its padding", () => {
    const lay = boxesOf(SEARCH, { box: { w: 300, h: 50 } });
    for (const b of lay.boxes.values()) assert.deepEqual([b.w, b.h], [300, 50]);
    assert.equal(Math.min(...[...lay.boxes.values()].map((b) => b.x)), PADX);
    assert.equal(Math.min(...[...lay.boxes.values()].map((b) => b.y)), PAD);
    assert.deepEqual(lay.box, { w: 300, h: 50 });
  });
});

describe("the lines (the owner's yes of 11-05: a line means needs)", () => {
  // (fails before: yes — lines entered a box side by side along its top, out of trunks in lanes between columns)
  test("each line leaves its need's box at the middle of its foot and arrives at the middle of its task's top: one point each way", () => {
    for (const tasks of [SEARCH, DOCS, eighty()]) {
      const lay = boxesOf(tasks);
      for (const l of lay.lines) {
        const T = /** @type {any} */ (lay.boxes.get(l.to));
        assert.deepEqual(l.b, { x: T.x + T.w / 2, y: T.y }, `${l.from}>${l.to} arrives`);
        if (l.from !== FOLD) {
          const S = /** @type {any} */ (lay.boxes.get(l.from));
          assert.deepEqual(l.a, { x: S.x + S.w / 2, y: S.y + S.h }, `${l.from}>${l.to} leaves`);
        }
      }
    }
    const into = boxesOf(SEARCH).lines.filter((l) => l.to === "t11");
    assert.deepEqual(into.map((l) => l.from).sort(), ["t10", "t8", "t9"]);
    assert.equal(new Set(into.map((l) => `${l.b.x},${l.b.y}`)).size, 1, "one point into t11");
  });

  test("a line that skips rows passes each in a slot of its own, clear of every box there; one to the next row passes none", () => {
    const lay = boxesOf(SEARCH);
    const t6 = /** @type {any} */ (lay.lines.find((l) => l.from === "t6" && l.to === "t12"));
    assert.equal(t6.via.length, 3, "t6 to t12 passes the rows of t7, t10 and t11");
    const t1 = /** @type {any} */ (lay.lines.find((l) => l.from === "t1" && l.to === "t2"));
    assert.deepEqual(t1.via, []);
    for (const tasks of [SEARCH, DOCS, eighty(), ...randomGraphs()]) {
      const L = boxesOf(tasks);
      const boxes = [...L.boxes.entries()];
      for (const l of L.lines)
        for (const v of /** @type {import("../src/ui/harness/lib/graph-lanes.js").Pass[]} */ (l.via)) {
          assert.ok(v.top > l.a.y && v.bottom < l.b.y, `${l.from}>${l.to} passes rows between its ends`);
          for (const [id, B] of boxes) if (B.y === v.top) assert.ok(v.x <= B.x - 10 || v.x >= B.x + B.w + 10, `${l.from}>${l.to} clear of ${id}`);
        }
    }
  });

  test("random graphs of 10 to 80 tasks: every task a box, its needs above it, no two boxes in a row closer than the gap", () => {
    for (const tasks of randomGraphs()) {
      const lay = boxesOf(tasks);
      assert.equal(lay.boxes.size, tasks.length);
      for (const t of tasks) for (const n of t.needs) if (n !== t.id && lay.boxes.has(n)) assert.ok(top(lay, n) < top(lay, t.id) || t.needs.length === 0);
      for (const r of lay.rows) {
        const xs = r.map((id) => /** @type {any} */ (lay.boxes.get(id))).sort((a, b) => a.x - b.x);
        xs.forEach((b, i) => { if (i) assert.ok(b.x - (xs[i - 1].x + xs[i - 1].w) >= BOX.gx - 0.5, "the gap"); });
      }
    }
  });
});

describe("the hunt boxes (the owner's yes of 11-05: a hunt's fixes inside the task it hunted)", () => {
  // t5 was hunted: f1 and f2 need t5 alone; f3 needs t4 too; g1 is a fix of f1's own finding.
  const HUNT = tasksOf([
    ["t4", [], "done"], ["t5", ["t4"], "done"], ["f1", ["t5"], "running", "t5"], ["f2", ["t5"], "done", "t5"], ["f3", ["t5", "t4"], "waiting", "t5"],
    ["g1", ["f1"], "waiting", "f1"], ["t6", ["t5", "f2"]],
  ]);

  // (fails before: yes — each fix was its own box a row under the hunted task, joined by a dotted line)
  test("a fix that needs nothing of the graph but the task its hunt was fired from goes inside that task's box; one that needs another task too keeps its own", () => {
    const lay = boxesOf(HUNT, { tall: (id) => (id === "t5" || id === "f1" ? 100 : 0) });
    assert.deepEqual([...lay.boxes.keys()].sort(), ["f1", "f3", "t4", "t5", "t6"]);
    assert.equal(/** @type {any} */ (lay.boxes.get("t5")).h, BOX.h + 100, "as tall as the page draws it");
    const t6 = /** @type {any} */ (lay.lines.find((l) => l.to === "t6"));
    assert.deepEqual([t6.from, t6.froms], ["t5", ["t5", "f2"]], "one line for t5 and f2");
    assert.deepEqual(t6.a, { x: mid(lay, "t5"), y: top(lay, "t5") + BOX.h + 100 }, "out of the box's foot");
  });

  // (fails before: yes — the review of 11-05: a fix hunted in its turn sat inside its box, and the hunt fired from it
  // was drawn nowhere)
  test("a fix hunted in its turn — a fix found on it, or a Reviewer sent from it — stands apart, a box of its own holding its hunt: a box never sits in a box", () => {
    // f1 has g1 found on it: f1 is a box of its own under t5's, g1 in it.
    assert.deepEqual([...groupsOf(HUNT)], [["t5", ["f2"]], ["f1", ["g1"]]]);
    const lay = boxesOf(HUNT, { tall: (id) => (id === "t5" || id === "f1" ? 100 : 0) });
    assert.ok(top(lay, "f1") > top(lay, "t5"));
    const f1 = /** @type {any} */ (lay.lines.find((l) => l.to === "f1"));
    assert.deepEqual([f1.from, f1.froms, f1.tos], ["t5", ["t5"], ["f1"]], "its line leaves t5's box, into f1's");
    // A Reviewer sent from a fix with nothing found on it yet: the fix stands apart too.
    const sent = tasksOf([["h", [], "done"], ["a", ["h"], "done", "h"], ["b", ["h"], "done", "h"]]);
    assert.deepEqual([[...groupsOf(sent)], [...groupsOf(sent, (id) => id === "a")]], [[["h", ["a", "b"]]], [["h", ["b"]]]]);
    assert.deepEqual([...boxesOf(sent, { fired: (id) => id === "a" }).boxes.keys()].sort(), ["a", "h"]);
  });

  test("a step whose hunt box has a fix open is not finished, so it never folds; once the fixes are done it may", () => {
    const chain = (/** @type {string} */ fix) => tasksOf([["t1", [], "done"], ["t2", ["t1"], "done"], ["t3", ["t2"], "done"], ["f", ["t2"], fix, "t2"], ["t4", ["t3"]]]);
    assert.deepEqual(boxesOf(chain("running")).hidden, []);
    assert.deepEqual(boxesOf(chain("done")).hidden, ["t1", "t2", "f"], "t2 folds with its fix");
  });
});

describe("the folded steps (D16)", () => {
  // The finished steps at the top fold into one row, all but the newest; the lines into the open work come down out of it.
  test("three finished steps or more at the top fold into a row, all but the newest; their lines come down out of it", () => {
    const chain = tasksOf([["t1", [], "done"], ["t2", ["t1"], "done"], ["t3", ["t2"], "done"], ["t4", ["t3"], "done"], ["t5", ["t4"], "running"], ["t6", ["t1", "t5"]]]);
    const lay = boxesOf(chain);
    assert.deepEqual(lay.hidden, ["t1", "t2", "t3"]);
    assert.deepEqual([...lay.boxes.keys()], ["t4", "t5", "t6"]);
    const fold = /** @type {any} */ (lay.fold);
    assert.ok(fold.y + fold.h < top(lay, "t4"));
    const out = lay.lines.filter((l) => l.from === FOLD).map((l) => [l.to, l.a.y, l.froms]);
    assert.deepEqual(out, [["t4", fold.y + fold.h, ["t3"]], ["t6", fold.y + fold.h, ["t1"]]]);
    assert.deepEqual([lay.foldLayers, lay.folds], [3, ["t1", "t2", "t3"]]);
    // Shown by the person: none folds, and what would fold is still said, for the line that folds them again.
    const shown = boxesOf(chain, { open: { steps: true } });
    assert.deepEqual([shown.hidden, shown.fold, shown.foldLayers, shown.folds], [[], null, 3, ["t1", "t2", "t3"]]);
  });
});

describe("the person's layout (the owner's of 11-14: Rearrange, and top to bottom or left to right)", () => {
  /** Each box's place along the flow and across it, drawn left to right. @param {ReturnType<typeof boxesOf>} lay @param {string} id */
  const box = (lay, id) => /** @type {any} */ (lay.boxes.get(id));
  /** @param {ReturnType<typeof boxesOf>} lay */
  const across = (lay) => /** @type {import("../src/ui/harness/lib/graph-lanes.js").PassAcross[]} */ (lay.lines.flatMap((l) => l.via));

  // (fails before: yes — the graph was drawn top to bottom alone)
  test("drawn left to right: a column a step, each task right of its needs, a column's boxes never closer than its gap, the lines out of a right side's middle into a left side's", () => {
    for (const tasks of [SEARCH, DOCS, eighty(), ...randomGraphs()]) {
      const lay = boxesOf(tasks, { dir: "right" });
      assert.equal(lay.dir, "right");
      for (const t of tasks) for (const n of t.needs) if (lay.boxes.has(n) && lay.boxes.has(t.id) && n !== t.id) assert.ok(box(lay, n).x + BOX.w < box(lay, t.id).x, `${n} left of ${t.id}`);
      for (const r of lay.rows) {
        assert.equal(new Set(r.map((id) => box(lay, id).x)).size, 1, "one column");
        const ys = r.map((id) => box(lay, id)).sort((a, b) => a.y - b.y);
        ys.forEach((b, i) => { if (i) assert.ok(b.y - (ys[i - 1].y + ys[i - 1].h) >= 16 - 0.5, "the gap"); });
      }
      for (const l of lay.lines) {
        const T = box(lay, l.to);
        assert.deepEqual(l.b, { x: T.x, y: T.y + T.h / 2 }, `${l.from}>${l.to} arrives`);
        if (l.from !== FOLD) assert.deepEqual(l.a, { x: box(lay, l.from).x + BOX.w, y: box(lay, l.from).y + box(lay, l.from).h / 2 }, `${l.from}>${l.to} leaves`);
        // A line that skips columns passes each in a slot of its own, clear of every box there.
        for (const v of /** @type {import("../src/ui/harness/lib/graph-lanes.js").PassAcross[]} */ (l.via)) {
          assert.ok(v.left > l.a.x && v.right < l.b.x, `${l.from}>${l.to} passes columns between its ends`);
          for (const [id, B] of lay.boxes) if (B.x === v.left) assert.ok(v.y <= B.y - 10 || v.y >= B.y + B.h + 10, `${l.from}>${l.to} clear of ${id}`);
        }
      }
      assert.ok(Math.max(...[...lay.boxes.values()].map((b) => b.x + b.w)) <= lay.w - PADX && Math.max(...[...lay.boxes.values()].map((b) => b.y + b.h)) <= lay.h - PAD + 0.5, "inside the drawing");
    }
    const t6 = /** @type {any} */ (boxesOf(SEARCH, { dir: "right" }).lines.find((l) => l.from === "t6" && l.to === "t12"));
    assert.equal(t6.via.length, 3, "t6 to t12 passes the columns of t7, t10 and t11");
  });

  test("the same order either way: a row drawn down is a column drawn right, its first box at the top; a hunt box as tall as the page draws it", () => {
    for (const tasks of [SEARCH, DOCS, eighty()]) {
      const down = boxesOf(tasks);
      const right = boxesOf(tasks, { dir: "right" });
      assert.deepEqual([right.rows, right.order, right.crossings], [down.rows, down.order, down.crossings]);
      for (const r of right.rows) r.forEach((id, i) => { if (i) assert.ok(box(right, r[i - 1]).y < box(right, id).y); });
    }
    const lay = boxesOf(tasksOf([["t4", [], "done"], ["t5", ["t4"], "done"], ["f1", ["t5"], "running", "t5"], ["t6", ["t5"]], ["t7", ["t5"]]]), { dir: "right", tall: (id) => (id === "t5" ? 100 : 0) });
    assert.deepEqual([box(lay, "t5").w, box(lay, "t5").h], [BOX.w, BOX.h + 100]);
    assert.equal(box(lay, "t4").y + BOX.h / 2, box(lay, "t5").y + box(lay, "t5").h / 2, "a chain runs straight across");
  });

  test("the folded steps drawn left to right: a column at the left as tall as the drawing, their lines out of its right side", () => {
    const chain = tasksOf([["t1", [], "done"], ["t2", ["t1"], "done"], ["t3", ["t2"], "done"], ["t4", ["t3"], "done"], ["t5", ["t4"], "running"], ["t6", ["t1", "t5"]]]);
    const lay = boxesOf(chain, { dir: "right" });
    const fold = /** @type {any} */ (lay.fold);
    assert.deepEqual([fold.x, fold.y, fold.w, fold.h], [PADX, PAD, BOX.w, lay.h - 2 * PAD]);
    assert.ok(fold.x + fold.w < box(lay, "t4").x);
    const out = lay.lines.filter((l) => l.from === FOLD);
    assert.deepEqual(out.map((l) => l.to), ["t4", "t6"]);
    for (const l of out) assert.equal(l.a.x, fold.x + fold.w);
    for (const v of across(lay)) assert.ok(v.y >= fold.y && v.y <= fold.y + fold.h, "a line passing columns leaves the folded column where it runs");
  });

  // e needs a and d, which the view's order put either side of b: b's two lines cross e's.
  const KNOT = tasksOf([["a", []], ["b", []], ["c", ["b"]], ["d", []], ["e", ["a", "d"]], ["f", ["c"]], ["g", ["b"]], ["h", ["c"]]]);

  // (fails before: yes — no press laid the graph out again: the order was the view's, swept six times, and it crossed
  // what it crossed)
  test("Rearrange: the view's order crossed two lines that it uncrosses; never more crossings than the drawing, fewer over many graphs", () => {
    const was = boxesOf(KNOT);
    assert.deepEqual([was.rows, was.crossings], [[["a", "b", "d"], ["c", "e", "g"], ["f", "h"]], 2]);
    const now = boxesOf(KNOT, { keep: was.order, thorough: true });
    assert.deepEqual([now.rows, now.crossings], [[["a", "d", "b"], ["e", "c", "g"], ["f", "h"]], 0]);
    let before = 0;
    let after = 0;
    for (const tasks of [SEARCH, DOCS, eighty(), ...randomGraphs()]) {
      const drawn = boxesOf(tasks);
      const found = boxesOf(tasks, { keep: drawn.order, thorough: true });
      assert.ok(found.crossings <= drawn.crossings, `${found.crossings} ≤ ${drawn.crossings}`);
      before += drawn.crossings;
      after += found.crossings;
    }
    assert.ok(after < before * 0.8, `${before} → ${after}`);
  });

  test("what Rearrange found holds as drawn, either way, at every draw; a second press finds the same; one with nothing better leaves it as it stands", () => {
    for (const tasks of [KNOT, SEARCH, eighty(), ...randomGraphs()]) {
      const found = boxesOf(tasks, { keep: boxesOf(tasks).order, thorough: true });
      const kept = boxesOf(tasks, { keep: found.order });
      assert.deepEqual([kept.order, kept.crossings, kept.boxes], [found.order, found.crossings, found.boxes], "drawn as found");
      assert.deepEqual(boxesOf(tasks, { keep: found.order, dir: "right" }).order, found.order, "turned, the same order");
      assert.deepEqual(boxesOf(tasks, { keep: found.order, thorough: true }).order, found.order, "a second press");
    }
    const line = tasksOf([["a", []], ["b", ["a"]], ["c", ["b"]]]);
    assert.deepEqual(boxesOf(line, { keep: boxesOf(line).order, thorough: true }).order, boxesOf(line).order);
  });

  test("a task added after a Rearrange goes in under what it needs, and nothing kept passes another; a task's state still moves nothing", () => {
    const found = boxesOf(KNOT, { keep: boxesOf(KNOT).order, thorough: true });
    const more = boxesOf([...KNOT, ...tasksOf([["i", ["d"]], ["j", []]])], { keep: found.order });
    assert.deepEqual(more.rows, [["a", "d", "b", "j"], ["e", "i", "c", "g"], ["f", "h"]], "i under d, beside e; j, needing nothing, where the view's order puts it");
    // (fails before: yes — the review of 11-14: a task its needs moved to another row kept its old row's place there,
    // its line crossing two)
    const moved = boxesOf(KNOT.map((t) => (t.id === "g" ? { ...t, needs: ["e"] } : t)), { keep: found.order });
    assert.deepEqual([moved.rows, moved.crossings], [[["a", "d", "b"], ["e", "c"], ["g", "f", "h"]], 0], "g, now under e, goes in under it");
    const half = KNOT.map((t, i) => ({ ...t, state: i < 3 ? "done" : "running" }));
    assert.deepEqual(boxesOf(half, { keep: found.order }).boxes, found.boxes);
  });
});

describe("eighty tasks", () => {
  test("an 80-task graph lays out in one drawing, every task a box or folded, every line between two boxes", () => {
    const tasks = eighty();
    assert.equal(tasks.length, 80);
    const lay = boxesOf(tasks);
    assert.equal(new Set([...lay.boxes.keys(), ...lay.hidden]).size, 80);
    for (const l of lay.lines) assert.ok((l.from === FOLD || lay.boxes.has(l.from)) && lay.boxes.has(l.to), `${l.from}>${l.to}`);
    assert.ok(Number.isFinite(lay.w) && Number.isFinite(lay.h));
  });
});
