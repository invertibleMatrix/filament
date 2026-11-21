// @ts-check
// The owner's of 11-16: a running turn opened from elsewhere (the window opened again from the tray) showed its newest
// words at once, and under them the calls of every step it had taken, "rapidly showing up and hiding": the page followed
// its run from the first event and drew each frame of the replay. Its draws wait now until the replay is in
// (ui/harness/lib/replay-hold.js), and the page's follow of a turn running elsewhere holds them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createReplayHold, REPLAY_MAX_MS, REPLAY_QUIET_MS } from "../src/ui/harness/lib/replay-hold.js";
import { createRunDraw } from "../src/ui/harness/lib/run-draw.js";
import { liveLineOf } from "../src/ui/harness/conversation/live-line.js";

/** A clock the test moves by hand, its timers with it. */
const clock = () => {
  let t = 1_000;
  /** @type {Map<number, { at: number, fn: () => void }>} */
  const timers = new Map();
  let id = 0;
  return {
    now: () => t,
    setTimeout: (/** @type {() => void} */ fn, /** @type {number} */ ms) => (timers.set(++id, { at: t + ms, fn }), id),
    clearTimeout: (/** @type {number} */ handle) => void timers.delete(handle),
    /** @param {number} ms */
    tick(ms) {
      const until = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, x]) => x.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        t = due[1].at;
        due[1].fn();
      }
      t = until;
    },
    pending: () => timers.size,
  };
};

const hold = () => {
  const c = clock();
  /** @type {string[]} */
  const said = [];
  const r = createReplayHold({ onHold: () => said.push("hold"), onEnd: () => said.push("end") }, c);
  return { c, said, r };
};

test("a follow from the first event holds until the replay reaches the newest event its hello named, then ends once", () => {
  const { c, said, r } = hold();
  r.begin(34_607, 0);
  assert.equal(r.holding, true);
  assert.deepEqual(said, ["hold"]);
  for (let n = 1; n < 34_607; n += 1000) {
    r.heard(n);
    c.tick(10);
  }
  assert.equal(r.holding, true, "still passing earlier steps");
  r.heard(34_607);
  assert.equal(r.holding, false);
  assert.deepEqual(said, ["hold", "end"]);
  r.heard(34_608);
  r.end();
  c.tick(REPLAY_MAX_MS * 2);
  assert.deepEqual(said, ["hold", "end"], "live events after it, and a turn's end, draw nothing twice");
  assert.equal(c.pending(), 0, "its timer was given back");
});

test("a follow taken up again, or a run with nothing to replay, holds nothing", () => {
  const again = hold();
  again.r.begin(500, 420);
  assert.equal(again.r.holding, false, "the watchdog's follow from its cursor replays what it missed onto what is drawn");
  const none = hold();
  none.r.begin(0, 0);
  none.r.begin(undefined, 0);
  assert.equal(none.r.holding, false);
  assert.deepEqual([...again.said, ...none.said], []);
});

test("a replay that falls quiet is drawn as it stands", () => {
  const { c, said, r } = hold();
  r.begin(9_000, 0);
  r.heard(1);
  c.tick(REPLAY_QUIET_MS - 1);
  assert.equal(r.holding, true);
  c.tick(2);
  assert.equal(r.holding, false);
  assert.deepEqual(said, ["hold", "end"]);
});

// (fails before: yes — the review of c5b791484: the follow's retry after a drop took longer than its quiet left, and the
// hold ended as the replay began again)
test("a follow taken up again while it holds counts its quiet from the new hello", () => {
  const { c, said, r } = hold();
  r.begin(9_000, 0);
  r.heard(400);
  c.tick(1_200);
  r.begin(9_000, 400);
  c.tick(REPLAY_QUIET_MS - 100);
  assert.equal(r.holding, true, "the hello is word from the run");
  r.heard(9_000);
  assert.deepEqual(said, ["hold", "end"]);
});

test("its words count as the replay coming: a long reply's words ahead of the first event do not end the hold", () => {
  const { c, said, r } = hold();
  r.begin(9_000, 0);
  c.tick(REPLAY_QUIET_MS - 100);
  r.brought();
  c.tick(REPLAY_QUIET_MS - 100);
  assert.equal(r.holding, true, "the words came within its quiet");
  r.heard(1);
  r.heard(9_000);
  assert.deepEqual(said, ["hold", "end"]);
  r.brought();
  assert.equal(r.holding, false, "words after it change nothing");
});

test("a replay that keeps coming is drawn as it comes once it has taken its most", () => {
  const { c, said, r } = hold();
  r.begin(1_000_000, 0);
  let n = 0;
  const step = () => {
    r.heard(++n);
    c.tick(200);
  };
  for (let i = 0; i < (REPLAY_MAX_MS - 400) / 200; i++) step();
  assert.equal(r.holding, true, "never quiet, under its most");
  step();
  step();
  assert.equal(r.holding, false);
  assert.deepEqual(said, ["hold", "end"]);
});

test("the run draw holds what lands until it is released, and now draws it whatever", () => {
  /** @type {Map<number, () => void>} */
  const frames = new Map();
  let id = 0;
  const io = { frame: (/** @type {() => void} */ fn) => (frames.set(++id, fn), id), cancelFrame: (/** @type {number} */ h) => void frames.delete(h) };
  const paint = () => {
    const fns = [...frames.values()];
    frames.clear();
    for (const fn of fns) fn();
  };
  /** @type {number[]} */
  const draws = [];
  const d = createRunDraw((landed) => draws.push(landed.length), io);
  d.add({ n: 1 });
  d.hold();
  assert.equal(frames.size, 0, "the frame asked for before the hold is given back");
  for (let n = 2; n <= 3000; n++) d.add({ n });
  paint();
  assert.deepEqual(draws, [], "nothing drawn while held");
  d.release();
  assert.equal(frames.size, 1);
  paint();
  assert.deepEqual(draws, [3000], "everything that waited, in one draw");
  d.add({ n: 3001 });
  paint();
  assert.deepEqual(draws, [3000, 1], "and what lands after, at its frame as before");
  d.hold();
  d.add({ n: 3002 });
  d.now();
  assert.deepEqual(draws, [3000, 1, 1], "the turn's end draws what waits");
});

test("the live line says the turn loads what it did so far, never the replay's stale step", () => {
  const turn = { startedAt: 5, loading: true, aligned: { turnState: { to: "acting" }, maxRound: 354, sentAt: 9 } };
  assert.deepEqual(liveLineOf(turn), { asks: false, state: "loading what it did so far", round: 0, startedAt: 5, sentAt: null });
  assert.equal(liveLineOf({ ...turn, paused: true }).state, "for your answer", "a question waiting still comes first");
  assert.equal(liveLineOf({ ...turn, loading: false }).round, 354);
});

// (fails before: yes — the follow drew each frame of the replay, its words first)
test("a turn followed from elsewhere holds its draws and its words while its replay passes, and its end draws them", () => {
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  const start = app.indexOf("function followLiveTurn(");
  const body = app.slice(start, app.indexOf("\n}\n", start));
  assert.match(body, /const replay = createReplayHold\(\{\n\s+onHold: \(\) => \{\n\s+runDraw\.hold\(\);\n\s+transcript\.loading\(turn, true\);/);
  assert.match(body, /onEnd: \(\) => \{\n\s+if \(chat\.live === live && live\.reply\) transcript\.drawBlocks\(live, \{ redraw: true \}\);\n\s+transcript\.loading\(turn, false\);\n\s+runDraw\.release\(\);\n\s+runDraw\.now\(\);/, "its words first, as a follow's first frame draws them, then its cards");
  assert.match(body, /const onRun = \(run\) => \{\n\s+if \(chat\.live === live\) replay\.begin\(run\?\.events, cursorOf\(live\)\);/, "the hello begins it, whatever else onRun skips");
  assert.match(body, /runDraw\.add\(e\);\n\s+replay\.heard\(e\?\.n\);/);
  assert.match(body, /replay\.brought\(\);\n\s+if \(!replay\.holding\) transcript\.drawBlocks\(live, \{ redraw: Array\.isArray\(w\.blocks\) \}\);/);
  assert.match(body, /runDraw\.now\(\);[^\n]*\n\s+transcript\.flushBlocks\(live\);[^\n]*\n\s+replay\.end\(\);/, "the turn's end draws what still waits");
});
