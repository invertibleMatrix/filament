// @ts-check
// `followRunEvents` (HarnessV3-Responsiveness R3): the one replay-then-follow behind the run events stream and the
// harness turn's reply. A run stream is a record, not a feed: every event exactly once, in order, whatever lands while
// the replay waits for a slow reader.
import { test } from "node:test";
import assert from "node:assert/strict";
import { followRunEvents } from "../src/services/runs.js";

/** A run log in miniature: a list of events, one subscriber, a publish. */
function fakeRuns(n = 0) {
  /** @type {any[]} */
  const all = [];
  /** @type {((e: any) => void) | null} */
  let sub = null;
  let endedAt = /** @type {number | null} */ (null);
  let status = "running";
  const publish = (/** @type {any} */ e) => {
    const evt = { n: all.length + 1, ...e };
    all.push(evt);
    sub?.(evt);
    if (e.type === "run-end") {
      endedAt = 1;
      status = e.status;
    }
    return evt;
  };
  for (let i = 0; i < n; i++) publish({ type: "tick", i });
  return {
    publish,
    all,
    runs: /** @type {any} */ ({
      subscribe: (/** @type {string} */ _id, /** @type {(e: any) => void} */ fn) => {
        sub = fn;
        return () => (sub = null);
      },
      events: (/** @type {string} */ _id, /** @type {{ since?: number, limit?: number }} */ { since = 0, limit = 5000 } = {}) => ({ run: { endedAt }, events: all.filter((e) => e.n > since).slice(0, limit) }),
      getRun: () => ({ endedAt, status }),
    }),
    get subscribed() {
      return !!sub;
    },
  };
}

// (a follow without the number check sends event 3 twice here: once from the next page, once from the backlog)
test("an event that lands while the replay waits for the reader is sent once, in its place", async () => {
  const f = fakeRuns(2);
  /** @type {number[]} */
  const sent = [];
  let slow = true;
  /** @type {string[]} */
  const ended = [];
  const follow = followRunEvents(f.runs, "r", f.runs.events("r", { since: 0, limit: 2 }), {
    pageSize: 2,
    send: (evt) => (sent.push(evt.n), true),
    needsDrain: () => slow,
    drained: async () => {
      if (slow) f.publish({ type: "tick", i: "during the replay" }); // lands in the log AND the follow's backlog
      slow = false;
    },
    onEnded: (s) => ended.push(s),
  });
  await follow.live;
  assert.deepEqual(sent, [1, 2, 3], "every event once, in order");
  f.publish({ type: "tick", i: "live" });
  f.publish({ type: "run-end", status: "done" });
  assert.deepEqual(sent, [1, 2, 3, 4, 5]);
  assert.deepEqual(ended, ["done"], "the end said once");
  follow.stop();
  assert.equal(f.subscribed, false, "stop lets go of the run");
});

// (fails before: yes — the follow said the end and went on: a caller that stopped it at the end had none to stop yet
// for a run that had ended, as the run events stream did, and the run kept its subscriber, which held it in memory)
test("a follow stops at the run's end by itself, said as it starts for a run that had ended; a kept one follows on", async () => {
  const f = fakeRuns(1);
  f.publish({ type: "run-end", status: "done" });
  /** @type {string[]} */
  const ended = [];
  await followRunEvents(f.runs, "r", f.runs.events("r"), { send: () => true, onEnded: (s) => ended.push(s) }).live;
  assert.deepEqual([ended, f.subscribed], [["done"], false], "said, and the run let go of");
  const g = fakeRuns(1);
  await followRunEvents(g.runs, "r", g.runs.events("r"), { send: () => true }).live;
  g.publish({ type: "run-end", status: "stopped" });
  assert.equal(g.subscribed, false, "a live end lets go of the run too");
  const h = fakeRuns(1);
  h.publish({ type: "run-end", status: "done" });
  /** @type {string[]} */
  const said = [];
  const kept = followRunEvents(h.runs, "r", h.runs.events("r"), { send: () => true, keep: true, onEnded: (s) => said.push(s) });
  await kept.live;
  assert.deepEqual([said, h.subscribed], [[], true], "kept past the end: nothing said, still following");
  kept.stop();
  assert.equal(h.subscribed, false);
});

test("a run that ended before the follow went live ends it; a send that fails stops it", async () => {
  const f = fakeRuns(1);
  f.publish({ type: "run-end", status: "stopped" });
  /** @type {string[]} */
  const ended = [];
  const follow = followRunEvents(f.runs, "r", f.runs.events("r"), { send: () => true, onEnded: (s) => ended.push(s) });
  await follow.live;
  assert.deepEqual(ended, ["stopped"]);
  const g = fakeRuns(3);
  /** @type {number[]} */
  const sent = [];
  const cut = followRunEvents(g.runs, "r", g.runs.events("r"), { send: (evt) => (sent.push(evt.n), evt.n < 2) });
  await cut.live;
  assert.deepEqual(sent, [1, 2], "nothing after the reader went away");
  assert.equal(g.subscribed, false);
});
