// The Plan page's task-graph lines as drawn (HarnessV4_TaskGraphPlus_Design D4, D5, D16, D18; the Product agent's
// redesign of 11-05, the owner's yes): a line as a curve, its look, the folded steps and the straight line. Where the
// lines run is graph-boxes.test.js's.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FOLD, curvePath, foldCount, lineLook, straightLine } from "../src/ui/harness/lib/graph-lanes.js";

/** The mock's search graph: each task's step and its needs, in the order they were added. */
const SEARCH = [
  ["t1", 0, []],
  ["t2", 1, ["t1"]],
  ["t3", 1, ["t1"]],
  ["t4", 2, ["t2"]],
  ["t5", 2, ["t3"]],
  ["t6", 2, ["t3"]],
  ["t7", 3, ["t4"]],
  ["t8", 3, ["t4"]],
  ["t9", 3, ["t4"]],
  ["t10", 4, ["t7", "t5"]],
  ["t11", 5, ["t8", "t9", "t10"]],
  ["t12", 6, ["t11", "t6"]],
].map(([id, layer, needs]) => ({ id: /** @type {string} */ (id), layer: /** @type {number} */ (layer), needs: /** @type {string[]} */ (needs), state: "waiting" }));

describe("a line (the owner's yes of 11-05)", () => {
  // (fails before: yes — a line ran at right angles, turning in the gaps, its corners rounded: no curve to draw)
  test("a soft curve from the foot of the task needed to the top of the one that needs it, leaving and arriving straight down", () => {
    const d = curvePath({ x: 100, y: 40 }, { x: 300, y: 120 });
    assert.equal(d, "M100,40 C100,80 300,80 300,120");
    // A short drop still bends: never less than 12 px.
    assert.equal(curvePath({ x: 0, y: 0 }, { x: 50, y: 10 }), "M0,0 C0,12 50,-2 50,10");
  });

  test("through each row it passes, straight down that row's slot", () => {
    const d = curvePath({ x: 100, y: 40 }, { x: 300, y: 300 }, [{ x: 200, top: 100, bottom: 140 }, { x: 210, top: 190, bottom: 230 }]);
    assert.equal(d, "M100,40 C100,67 200,67 200,94 L200,146 C200,165 210,165 210,184 L210,236 C210,268 300,268 300,300");
  });

  // (fails before: yes — the owner's of 11-14: a graph drawn left to right had no line to draw)
  test("drawn left to right, the same turned: out of the right side straight across, into the left side straight across, through each column's slot", () => {
    assert.equal(curvePath({ x: 40, y: 100 }, { x: 120, y: 300 }, [], "right"), "M40,100 C80,100 80,300 120,300");
    const d = curvePath({ x: 40, y: 100 }, { x: 300, y: 300 }, [{ y: 200, left: 100, right: 140 }, { y: 210, left: 190, right: 230 }], "right");
    assert.equal(d, "M40,100 C67,100 67,200 94,200 L146,200 C165,200 165,210 184,210 L236,210 C268,210 268,300 300,300");
  });
});

describe("a line's look (D5)", () => {
  const byId = new Map([
    ["a", { state: "done" }],
    ["b", { state: "failed" }],
    ["c", { state: "waiting" }],
    ["f", { state: "running" }],
  ]);
  /** @param {string} from @param {string} to @param {string[]} [froms] */
  const e = (from, to, froms = [from]) => ({ from, to, froms, tos: [to] });
  // (fails before: yes — a failed task's lines were dashed, the critical path heavy, and a key said so)
  test("out of finished work it recedes, the chosen task's lines blue and drawn last; nothing else changes its look", () => {
    assert.deepEqual(lineLook(e("a", "b"), byId, null), { cls: "e done", p: 0 });
    assert.deepEqual(lineLook(e("b", "c"), byId, null), { cls: "e", p: 1 }, "a failed task's line is a line");
    assert.deepEqual(lineLook(e("a", "b"), byId, "b"), { cls: "e done on", p: 2 });
    assert.deepEqual(lineLook({ from: FOLD, to: "c", froms: ["a"], tos: ["c"] }, byId, null), { cls: "e done", p: 0 }, "out of the folded steps");
  });

  test("a hunt box's line stands for its fixes too: one open among them keeps it plain, and choosing one turns it blue", () => {
    assert.deepEqual(lineLook(e("a", "c", ["a", "f"]), byId, null), { cls: "e", p: 1 });
    assert.deepEqual(lineLook(e("a", "c", ["a", "f"]), byId, "f"), { cls: "e on", p: 2 });
  });
});

describe("the folded steps (D16) and the straight line (D18)", () => {
  test("three finished steps or more at the top fold, all but the newest", () => {
    const st = (/** @type {string[]} */ ...s) => s.map((state) => ({ state }));
    assert.equal(foldCount(st("done", "done", "done", "running")), 2);
    assert.equal(foldCount(st("done", "done", "running")), 0);
    assert.equal(foldCount(st("done", "running", "done", "done", "done")), 0);
    assert.equal(foldCount(st("done", "done", "done", "done")), 3);
  });
  test("one straight line: three tasks or more, each needing the one before it and nothing else", () => {
    const line = [
      { id: "a", layer: 0, needs: [], state: "done" },
      { id: "b", layer: 1, needs: ["a"], state: "running" },
      { id: "c", layer: 2, needs: ["b"], state: "waiting" },
    ];
    assert.equal(straightLine(line), true);
    assert.equal(straightLine(line.slice(0, 2)), false);
    assert.equal(straightLine(SEARCH), false);
    assert.equal(straightLine([...line, { id: "d", layer: 1, needs: ["a"], state: "dropped" }]), true);
    assert.equal(straightLine([...line, { id: "d", layer: 1, needs: ["a"], state: "waiting" }]), false);
  });
});
