// @ts-check
// What the page read of a turn, onto the same turn of a fresh reading of its session (lib/turn-reads.js; the chat-open
// audit of 10-29): every reading makes the turns anew, and each turn near the screen read its run's log and its changes
// again — the turn a page followed to its end, its log a third time. A turn is the same turn by its id; what was read of
// it holds while it has ended and runs the same run. Since the owner's of 11-15 (the page's process at 1.4 GB after
// three days) what holds of its run is its log's alignment, the log itself let go of (labels.js `letGoOfLog`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { withReadRuns } from "../src/ui/harness/lib/turn-reads.js";
import { alignOnto, letGoOfLog } from "../src/ui/harness/lib/labels.js";

const LOG = [{ n: 1, type: "run-start" }, { n: 2, type: "round-start", round: 1 }, { n: 3, type: "run-end" }];
const TREE = { totals: { files: 2 } };

/** A turn's alignment of the whole log, the log let go of, as the timeline leaves an ended turn's. */
function wholeRun() {
  const cache = /** @type {any} */ ({});
  const aligned = alignOnto(cache, LOG.slice());
  letGoOfLog(cache, /** @type {any[]} */ (cache.list));
  return { cache, aligned };
}

// (fails before: yes — the module did not exist; each reading read every turn's log and changes again. Since 11-15:
// the turn carried its run's whole log, `runLog`, not its alignment)
test("an ended turn's alignment and changes come with it, by its id, its log let go of", () => {
  const { cache, aligned } = wholeRun();
  const was = [{ turnId: "t1", runId: "r1", status: "streaming", alignCache: cache, aligned, tree: TREE }];
  const now = [{ turnId: "t1", runId: "r1", status: "done" }];
  /** @type {any[]} */
  const also = [];
  const out = withReadRuns(now, was, (from, to) => also.push([from, to]));
  assert.equal(out, now);
  const t = /** @type {any} */ (now[0]);
  assert.equal(t.aligned, aligned, "the alignment, as drawn");
  assert.equal(t.alignCache.whole, true);
  assert.equal(t.alignCache.a, cache.a, "the fold that holds it");
  assert.notEqual(t.alignCache, cache, "a cache of its own: a log handed to the old turn starts that one over");
  assert.equal(t.alignCache.list, null, "no log");
  assert.equal(t.runLog, undefined);
  assert.equal(t.tree, TREE);
  assert.deepEqual(also, [[was[0], now[0]]], "what else the page keeps of the turn goes with it");
});

test("nothing comes onto a turn still open, another run's, or one with no id", () => {
  const { cache, aligned } = wholeRun();
  const was = [
    { turnId: "t1", runId: "r1", alignCache: cache, aligned, tree: TREE },
    { turnId: "t2", runId: "r2", alignCache: cache, aligned, tree: TREE },
    { turnId: null, runId: "r3", alignCache: cache, aligned },
  ];
  const now = [
    { turnId: "t1", runId: "r1", status: "open" },
    { turnId: "t2", runId: "r9", status: "done" },
    { turnId: null, runId: "r3", status: "done" },
  ];
  withReadRuns(now, was);
  for (const t of now) {
    assert.equal(/** @type {any} */ (t).alignCache, undefined);
    assert.equal(/** @type {any} */ (t).aligned, undefined);
    assert.equal(/** @type {any} */ (t).tree, undefined);
  }
});

// A log aligned while its turn ran, or by a follow that never reached the run's end, is not the whole of it: the turn
// made anew reads it again.
test("an alignment that does not hold its whole log does not come", () => {
  const cache = /** @type {any} */ ({});
  const aligned = alignOnto(cache, LOG.slice());
  const now = [{ turnId: "t1", runId: "r1", status: "done" }];
  withReadRuns(now, [{ turnId: "t1", runId: "r1", status: "done", alignCache: cache, aligned }]);
  assert.equal(/** @type {any} */ (now[0]).alignCache, undefined);
  assert.equal(/** @type {any} */ (now[0]).aligned, undefined);
});

test("a turn whose changes were asked for and not answered asks again", () => {
  const now = [{ turnId: "t1", runId: "r1", status: "done" }];
  withReadRuns(now, [{ turnId: "t1", runId: "r1", tree: null }]);
  assert.equal(/** @type {any} */ (now[0]).tree, undefined, "its answer lands on the turn it was asked for");
});
