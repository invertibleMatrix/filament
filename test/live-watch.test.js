// @ts-check
// The live view's watchdog (HarnessV3-FixRound F3 item 16, BUG-25): a page whose live view stopped hearing a run
// that kept working follows the run again from its cursor, and says so where that did not bring it back
// (HarnessV4_Tasks B15); a run that is merely quiet raises nothing.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { liveViewState, watchLive, LIVE_QUIET_MS } from "../src/ui/harness/lib/live-watch.js";
import { followRun } from "../src/ui/harness/lib/api.js";
import { keptPageTurns } from "../src/ui/harness/conversation/history.js";
import { pageEvents } from "./helpers/page-events.js";
import { fakeRunSocket } from "./helpers/run-socket.js";

// The followers hold their streams while the page is shown (ui/lib/put-away.js): the page's events, stood in.
pageEvents();

const until = async (/** @type {() => boolean} */ ok, ms = 3000, what = "the condition") => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("liveViewState", () => {
  const quiet = { now: LIVE_QUIET_MS + 1, heardAt: 0 };
  test("a page that heard within the window needs no lookup", () => {
    assert.equal(liveViewState({ now: LIVE_QUIET_MS - 1, heardAt: 0, cursor: 3, run: { events: 9 } }), "heard");
  });
  test("a log with events the page has not heard is a lost view, ended or not", () => {
    assert.equal(liveViewState({ ...quiet, cursor: 3, run: { events: 4, endedAt: null } }), "lost");
    assert.equal(liveViewState({ ...quiet, cursor: 3, run: { events: 9, endedAt: 5 } }), "lost");
  });
  // (fails before: yes — the user's report, 2026-10-09: "Live view lost — reconnecting…" kept showing over a turn
  // that ran fine; the run lookup took over a second while the test suite loaded the machine)
  test("a lookup that cannot get through says nothing: the reply may be streaming on", () => {
    assert.equal(liveViewState({ ...quiet, cursor: 3, run: "unreachable" }), "quiet");
  });
  test("a quiet run (a long command, a model thinking, a question waiting) is no loss", () => {
    assert.equal(liveViewState({ ...quiet, cursor: 3, run: { events: 3, endedAt: null } }), "quiet");
    assert.equal(liveViewState({ ...quiet, cursor: 0, run: null }), "quiet"); // the log knows no such run
  });
  test("an ended run with every event heard is ended", () => {
    assert.equal(liveViewState({ ...quiet, cursor: 7, run: { events: 7, endedAt: 5 } }), "ended");
  });
});

describe("watchLive", () => {
  /** A watchdog on a fake clock; the lookup answers what `run` holds (a function, to hang or throw). */
  const rig = (/** @type {any} */ run, /** @type {any} */ extra = {}) => {
    let clock = 1000;
    const calls = { behind: 0, lost: 0, back: 0, ended: 0, lookups: 0 };
    const w = watchLive({
      runId: () => ("runId" in extra ? extra.runId : "r1"),
      cursor: () => 3,
      lookup: async () => {
        calls.lookups++;
        return typeof run === "function" ? run() : run;
      },
      onBehind: () => calls.behind++,
      onLost: () => calls.lost++,
      onBack: () => calls.back++,
      onEnded: () => calls.ended++,
      ...(extra.aliveAt ? { aliveAt: () => extra.aliveAt(clock) } : {}),
      now: () => clock,
      intervalMs: 0,
      lookupMs: extra.lookupMs ?? 50,
    });
    return { w, calls, tick: (/** @type {number} */ ms) => (clock += ms) };
  };

  test("silence under the window asks nothing", async () => {
    const { w, calls, tick } = rig({ events: 9 });
    tick(LIVE_QUIET_MS - 1);
    assert.equal(await w.check(), "heard");
    assert.equal(calls.lookups, 0);
  });
  test("a quiet run: one lookup, no banner", async () => {
    const { w, calls, tick } = rig({ events: 3, endedAt: null });
    tick(LIVE_QUIET_MS);
    assert.equal(await w.check(), "quiet");
    assert.deepEqual([calls.lookups, calls.behind, calls.lost], [1, 0, 0]);
  });
  // (fails before: yes — B15, the owner's "lost connection … trying to connect" chip, 2026-10-09: the first look that
  // found the log ahead raised the banner at once, over a view its follow again brought back within the second)
  test("a view behind its run follows again without a word; the banner only where the next look finds it behind still", async () => {
    const { w, calls, tick } = rig({ events: 5, endedAt: null });
    tick(LIVE_QUIET_MS);
    assert.equal(await w.check(), "behind");
    assert.deepEqual([calls.behind, calls.lost, w.isLost()], [1, 0, false], "followed again, nothing said");
    tick(10_000);
    assert.equal(await w.check(), "lost", "a look later, behind still");
    assert.deepEqual([calls.behind, calls.lost, w.isLost()], [1, 1, true]);
    assert.equal(await w.check(), "heard", "the follow again gets its own window");
    tick(LIVE_QUIET_MS);
    assert.equal(await w.check(), "lost", "and is said again, never as a first finding");
    assert.deepEqual([calls.behind, calls.lost], [1, 2]);
    w.heard();
    w.heard();
    assert.deepEqual([calls.back, w.isLost()], [1, false]);
  });
  test("a view the follow again brought back says nothing, and a later lag starts from a silent follow again", async () => {
    const { w, calls, tick } = rig({ events: 5, endedAt: null });
    tick(LIVE_QUIET_MS);
    assert.equal(await w.check(), "behind");
    w.heard();
    assert.deepEqual([calls.back, calls.lost], [0, 0], "no banner went up, so none comes down");
    tick(LIVE_QUIET_MS);
    assert.equal(await w.check(), "behind");
    assert.deepEqual([calls.behind, calls.lost], [2, 0]);
  });
  // (fails before: yes — B15: a reply that carried its run's events and streamed on was asked about after 30 s
  // without a run event, and an event on its way read as a loss)
  test("a stream that carries the events and still speaks is asked nothing", async () => {
    const speaking = rig({ events: 9 }, { aliveAt: (/** @type {number} */ clock) => clock - 14_000 });
    speaking.tick(LIVE_QUIET_MS * 3);
    assert.equal(await speaking.w.check(), "heard");
    assert.equal(speaking.calls.lookups, 0);
    const silent = rig({ events: 9 }, { aliveAt: () => 1000 });
    silent.tick(LIVE_QUIET_MS);
    assert.equal(await silent.w.check(), "behind", "a reply silent as long as its events is asked about");
  });
  test("a lookup that hangs or fails raises no banner and opens no second follow", async () => {
    const hang = rig(() => new Promise(() => {}), { lookupMs: 20 });
    hang.tick(LIVE_QUIET_MS);
    assert.equal(await hang.w.check(), "quiet");
    const fail = rig(() => { throw new Error("HTTP 500"); });
    fail.tick(LIVE_QUIET_MS);
    assert.equal(await fail.w.check(), "quiet");
    assert.deepEqual([hang.calls.lost, fail.calls.lost, hang.w.isLost(), fail.w.isLost()], [0, 0, false, false]);
    assert.deepEqual([hang.calls.behind, fail.calls.behind], [0, 0]);
  });
  test("an ended run with nothing left to hear calls onEnded, not onLost", async () => {
    const { w, calls, tick } = rig({ events: 3, endedAt: 9 });
    tick(LIVE_QUIET_MS);
    assert.equal(await w.check(), "ended");
    assert.deepEqual([calls.ended, calls.behind, calls.lost], [1, 0, 0]);
  });
  test("no run yet: nothing to ask", async () => {
    const { w, calls, tick } = rig({ events: 9 }, { runId: null });
    tick(LIVE_QUIET_MS);
    assert.equal(await w.check(), "quiet");
    assert.equal(calls.lookups, 0);
  });
  test("one lookup at a time", async () => {
    /** @type {(v: any) => void} */
    let answer = () => {};
    const { w, calls, tick } = rig(() => new Promise((r) => (answer = r)), { lookupMs: 1000 });
    tick(LIVE_QUIET_MS);
    const first = w.check();
    assert.equal(await w.check(), "heard");
    answer({ events: 3 });
    assert.equal(await first, "quiet");
    assert.equal(calls.lookups, 1);
  });
});

// The plan's test: a follower whose stream stalls resumes. The real `followRun` against a fake run log whose first
// stream sends three events and then goes silent while the log grows to six. The follow again brings the view
// back, so no banner shows (HarnessV4_Tasks B15); one whose follow again hears nothing is the test after.
test("a follower whose stream stalls: the follow again from the cursor, every event once, no banner", async () => {
  const log = [1, 2, 3, 4, 5].map((n) => ({ n, type: "tick" }));
  /** @type {number[]} */
  const asked = [];
  let firstClosed = false;
  /** @type {string | null} */
  let firstKey = null;
  /** @type {import("./helpers/run-socket.js").Peer | null} */
  let firstPeer = null;
  const runs = await fakeRunSocket(
    (msg, peer) => {
      if (msg.op === "stop") return void (msg.key === firstKey && (firstClosed = true));
      asked.push(msg.since);
      peer.data(msg.key, { type: "hello" });
      if (msg.since === 0) {
        firstKey = msg.key;
        firstPeer = peer;
        for (const e of log.slice(0, 3)) peer.data(msg.key, e); // …then silence, the follow held open
        return;
      }
      for (const e of log.filter((x) => x.n > msg.since)) peer.data(msg.key, e);
      peer.data(msg.key, { n: 6, type: "run-end", status: "done" });
      peer.end(msg.key);
    },
    {
      onRequest: (req, res) => {
        if (new URL(String(req.url), "http://x").pathname !== "/api/runs/r1") return void res.writeHead(404).end();
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ run: { id: "r1", events: log.length, endedAt: null, status: "running" } }));
      },
    },
  );
  const base = runs.url;
  const realFetch = globalThis.fetch;
  // Stopped in `finally`, failed or not: a follow left running retries forever and the file never ends.
  /** @type {any} */
  let follower = null;
  try {
    let clock = 0;
    /** @type {number[]} */
    const heard = [];
    /** @type {string[]} */
    const banner = [];
    const cursor = () => heard[heard.length - 1] || 0;
    /** @type {any} */
    let w = null;
    const onEvent = (/** @type {any} */ e) => {
      w?.heard();
      if (e.n <= cursor()) return;
      heard.push(e.n);
    };
    let ended = false;
    follower = followRun("r1", { since: 0, onEvent, onDone: () => {} });
    w = watchLive({
      runId: () => "r1",
      cursor,
      lookup: (id) => realFetch(`${base}/api/runs/${id}`).then((r) => r.json()).then((j) => j.run),
      onBehind: () => {
        follower.stop();
        follower = followRun("r1", { since: cursor(), onEvent, onRunEnd: () => (ended = true), onDone: () => {} });
      },
      onLost: () => banner.push("lost"),
      onBack: () => banner.push("back"),
      now: () => clock,
      intervalMs: 0,
    });
    await until(() => heard.length === 3, 3000, "the first three events");
    clock += 10_000;
    assert.equal(await w.check(), "heard", "10 s of silence is not yet a loss");
    clock += LIVE_QUIET_MS;
    assert.equal(await w.check(), "behind");
    await until(() => ended, 3000, "the run's end through the follow again");
    assert.deepEqual(heard, [1, 2, 3, 4, 5, 6], "every event once, in order");
    assert.deepEqual(banner, [], "brought back by the follow again: nothing was said");
    assert.equal(w.isLost(), false);
    assert.deepEqual(asked, [0, 3], "followed again from the cursor");
    // Let go of: asked to stop, or — the page's only follow — its socket closed with it.
    await until(() => firstClosed || !!firstPeer?.closed, 3000, "the stalled stream to be closed");
  } finally {
    follower?.stop();
    await runs.close();
  }
});

// The page's wiring (no DOM here): the pins the watchdog's work rests on.
describe("the page's wiring", () => {
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
  const send = app.slice(app.indexOf("async function sendMessage("));
  const outside = app.slice(app.indexOf("function followLiveTurn("), app.indexOf("async function reloadSession("));
  test("a run event heard is heard by the watchdog, in both live paths", () => {
    assert.match(send, /const onRunEvent = \(e\) => \{\n\s+live\.watch\?\.heard\(\);/);
    assert.match(outside, /const onEvent = \(e\) => \{\n\s+live\.watch\?\.heard\(\);/);
  });
  test("a view behind follows again from the cursor, the old follow stopped; a loss says so and follows again", () => {
    for (const src of [send, outside]) {
      const again = src.slice(src.indexOf("const followAgain = () => {"), src.indexOf("live.watch = watchLive({"));
      assert.match(again, /live\.follower\?\.stop\(\);/);
      assert.match(again, /cursorOf\(live\)/);
      assert.match(src, /onBehind: followAgain,/);
      const lost = src.slice(src.indexOf("onLost: () => {"), src.indexOf("onBack:"));
      assert.match(lost, /pageSaid\("status", LIVE_LOST_WORDS/);
      assert.match(lost, /transcript\.liveLost\(turn, true\)/);
      assert.match(lost, /followAgain\(\);/);
    }
    assert.match(send, /onBack: \(\) => transcript\.liveLost\(turn, false\)/);
    // The page's own send: its reply carries the run's events, so a reply that still speaks is asked nothing.
    assert.match(send, /aliveAt: \(\) => \(carried \? live\.replyAt : 0\),/);
    assert.match(send, /const followAgain = \(\) => \{\n\s+live\.lostOnce = true;/, "the reply given up after a run's end needs a follow again to have run");
  });
  test("the watchdog ends with the turn, and its note with it", () => {
    assert.match(send, /live\.watch\.stop\(\);\n\s+if \(turn\.liveLost\) transcript\.liveLost\(turn, false\);\n\s+chat\.live = null;/);
    assert.match(outside, /chat\.live = null;\n\s+live\.watch\?\.stop\(\);/);
  });
  test("a silent reply after the run ended and a loss is given up, and the turn drawn from the transcript", () => {
    const ended = send.slice(send.indexOf("onEnded: () => {"), send.indexOf("try {\n    const r = await postTurn"));
    assert.match(ended, /!live\.lostOnce/);
    assert.match(ended, /live\.replyAt < LIVE_QUIET_MS/);
    assert.match(send, /AbortError" && live\.replyLost\) \{[\s\S]{0,200}turn\.status = "done";\s+turn\.fromTranscript = true;\s+chat\.hydrateAfterSend = true;/);
    assert.match(app, /chat\.turns = mergedTurns\(chat\.turns, turns\);/, "the hydrate keeps the page's turns through keptPageTurns");
  });
  // (fails before: yes — found on the F3 hand test: the hydrate kept the page's own copy of every turn it sent, so a
  // given-up reply stayed "Round 1." with the page's clock until a reload)
  test("the hydrate keeps the page's own turns, but a given-up one gives way to the server's copy", () => {
    const page = [{ n: 1, past: true }, { n: 2 }, { n: 3, fromTranscript: true }, { n: 4, fromTranscript: true }];
    const kept = keptPageTurns(page, [{ n: 1 }, { n: 2 }, { n: 3 }]);
    assert.deepEqual(kept.map((t) => t.n), [2, 4], "turn 3 drawn from the server's copy; turn 4 kept while the server has none");
  });
  test("the note sits under the newest work while the turn runs", () => {
    assert.match(timeline, /live \? steers : null, live && turn\.liveLost \? lostNote\(v\) : null,/);
    assert.match(timeline, /"Live view lost — reconnecting…"/);
  });
});

// (fails before: yes — fable51's F4, HarnessV4_Tasks U4: `followRun` returned on a 404 without a word, so whoever
// followed a run the server does not hold — not registered yet, or swept — kept the "running" face it had drawn)
test("a run the server does not hold is said to whoever follows it: missing, then done — never its end, never a retry", async () => {
  let asked = 0;
  const runs = await fakeRunSocket((msg, peer) => {
    if (msg.op !== "follow") return;
    asked++;
    peer.missing(msg.key);
  });
  /** @type {any} */
  let follower = null;
  try {
    /** @type {string[]} */
    const said = [];
    follower = followRun("gone", { since: 0, onEvent: () => said.push("event"), onRun: () => said.push("run"), onMissing: () => said.push("missing"), onRunEnd: () => said.push("run-end"), onDone: () => said.push("done") });
    await follower.promise;
    assert.deepEqual(said, ["missing", "done"]);
    assert.equal(asked, 1, "asked once: whoever follows decides whether to ask again");
    // Without a word for it, the follow still ends in the open: done.
    said.length = 0;
    follower = followRun("gone", { since: 0, onEvent: () => {}, onDone: () => said.push("done") });
    await follower.promise;
    assert.deepEqual(said, ["done"]);
  } finally {
    follower?.stop();
    await runs.close();
  }
  // The two views that draw a run from its log say so, instead of a lamp that runs for ever.
  const pane = readFileSync("src/ui/harness/panes/run.js", "utf8");
  assert.match(pane, /onMissing: \(\) => \{ missing = true; if \(el\.isConnected\) paint\(\); \},/);
  assert.match(pane, /missing \? h\("p", \{ class: "pane-note", "data-key": "missing" \}, RUN_GONE\) : null,/);
  const room = readFileSync("src/ui/harness/control-room.js", "utf8");
  assert.match(room, /onMissing: \(\) => \{\s+note\.textContent = RUN_GONE;\s+note\.classList\.remove\("hidden"\);\s+\},/);
  assert.match(readFileSync("src/ui/harness/lib/api.js", "utf8"), /export const RUN_GONE = "This run's log is no longer kept: what is drawn is all it had\.";/);
});
