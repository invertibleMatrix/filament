// @ts-check
// HarnessV3-Views V3's drive: a page the browser puts away — navigated from, into the back/forward cache — sat frozen
// with its streams open, and the browser gives a host six connections in all. Five pages put away, each following a
// run, and the sixth page's own first requests waited with no answer: every page of the app starved. Each stream a
// page holds is now let go as the page is put away (ui/lib/put-away.js), and a page brought back loads afresh.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pageEvents } from "./helpers/page-events.js";
import { fakeRunSocket } from "./helpers/run-socket.js";
import { until } from "./helpers/wait.js";
import { holdWhileShown } from "../src/ui/lib/put-away.js";
import { followRun } from "../src/ui/harness/lib/api.js";

const page = pageEvents();

/** A run log's stream in miniature, on the page's run socket: `ends` ends at once; any other run is held open, one
 *  event in. A follow is closed once the page asks it to stop or its socket closes. */
async function runServer() {
  /** @type {{ run: string, key: string, peer: import("./helpers/run-socket.js").Peer, stopped: boolean, closed: boolean }[]} */
  const asked = [];
  const socket = await fakeRunSocket((msg, peer) => {
    if (msg.op === "stop") {
      for (const one of asked) if (one.key === msg.key && one.peer === peer) one.stopped = true;
      return;
    }
    asked.push({
      run: msg.run,
      key: msg.key,
      peer,
      stopped: false,
      get closed() {
        return this.stopped || this.peer.closed;
      },
    });
    peer.data(msg.key, { type: "hello" });
    if (msg.run === "ends") {
      peer.data(msg.key, { n: 1, type: "run-end", status: "done" });
      peer.end(msg.key);
    } else peer.data(msg.key, { n: 1, type: "tick" });
  });
  return { asked, close: socket.close };
}

// (fails before: yes — no follow held its stream, so nothing heard the page being put away; and a page whose streams
// had all ended is whole as the cache kept it)
test("nothing listens before the first hold; a follow that ended lets nothing go, and the page comes back as kept", async () => {
  assert.deepEqual(page.listening(), [], "importing the module listens for nothing");
  const runs = await runServer();
  let done = false;
  const follow = followRun("ends", { onEvent: () => {}, onDone: () => void (done = true) });
  try {
    await follow.promise;
    assert.deepEqual([done, page.listening()], [true, ["pagehide", "pageshow"]]);
    page.putAway();
    page.bringBack();
    assert.equal(page.reloads, 0, "nothing was let go: the page shows as the cache kept it");
  } finally {
    follow.stop();
    await runs.close();
  }
});

// (fails before: yes — a page put away kept its follow of a running run open in the back/forward cache: five such
// pages held five of the browser's six connections to Filament, and the next page's own requests waited unanswered)
test("a run followed while the page is put away lets its connection go and asks for no more; brought back, the page loads afresh", async () => {
  const runs = await runServer();
  /** @type {any[]} */
  const heard = [];
  let done = false;
  const follow = followRun("r1", { onEvent: (e) => heard.push(e), onDone: () => void (done = true) });
  try {
    await until(() => heard.some((e) => e.type === "tick"), "the run's first event");
    page.putAway();
    await until(() => runs.asked[0]?.closed, "the stream's connection to close");
    await follow.promise;
    assert.deepEqual([runs.asked.length, done], [1, false], "one stream, let go: no follow again, and no done");
    page.bringBack();
    assert.equal(page.reloads, 1, "brought back, the page loads afresh");
  } finally {
    follow.stop();
    await runs.close();
  }
});

// (fails before: no — a guard: each stream closes once, one released first is left alone, and one close that fails
// is reported without keeping the others open)
test("a page put away closes each stream it holds, once; one released first is left alone; a failing close keeps no other open", () => {
  /** @type {string[]} */
  const closed = [];
  holdWhileShown(() => closed.push("a"));
  const releaseB = holdWhileShown(() => closed.push("b"));
  holdWhileShown(() => {
    throw new Error("this close failed");
  });
  holdWhileShown(() => closed.push("c"));
  releaseB();
  page.putAway();
  page.putAway();
  assert.deepEqual(closed, ["a", "c"]);
  assert.deepEqual(page.reported.map((e) => String(/** @type {any} */ (e)?.message)), ["this close failed"]);
});

// The pages boot a DOM at import: their holds are read from the source.
// (fails before: yes — none of them let go of its stream when the page was put away)
test("the page's other streams are held as they open and released as they end: the turn's reply, the console's events, a request of the Playground's or the Assistant's, a terminal", () => {
  const read = (/** @type {string} */ p) => readFileSync(p, "utf8");
  const app = read("src/ui/harness/app.js");
  const send = app.slice(app.indexOf("async function sendMessage("), app.indexOf("/** One message into a run's mailbox"));
  assert.match(send, /const letGo = holdWhileShown\(\(\) => \{\s*live\.putAway = true;\s*aborter\.abort\(\);\s*\}\);\s*try \{\s*const r = await postTurn\(/);
  assert.match(send, /\} catch \(\/\*\* @type \{any\} \*\/ e\) \{\s*if \(live\.putAway\) return;/, "the turn runs on, the server's: nothing ends it here");
  // Between the release and the end, what landed last is drawn (the bug report's X1) — after a broken connection's
  // question to the session, too (send-dropped.test.js).
  assert.match(send, /\} finally \{\s*letGo\(\);\s*\}/);
  assert.match(send, /\n\s*runDraw\.now\(\);[^\n]*\n\s*turn\.reply = turn\.reply \|\| live\.reply;/);
  const console_ = read("src/ui/app.js");
  const events = console_.slice(console_.indexOf("function connectEvents() {"), console_.indexOf("bindUi({"));
  assert.match(events, /const es = new EventSource\("\/api\/events"\);\s*\/\/[^\n]*\n\s*const letGo = holdWhileShown\(\(\) => es\.close\(\)\);/);
  assert.match(events, /es\.onerror = \(\) => \{[^\n]*es\.close\(\); letGo\(\); setTimeout\(connectEvents, 5000\); \};/, "a stream that failed is released before the next opens");
  const lab = read("src/ui/pages/lab.js");
  assert.match(lab, /aborter = new AbortController\(\);[^\n]*\n\s*\/\/[^\n]*\n\s*const letGo = holdWhileShown\(\(\) => aborter\?\.abort\(\)\);/);
  assert.match(lab, /letGo\(\); sendBtn\.disabled = false; stopBtn\.classList\.add\("hidden"\);/);
  const assistant = read("src/ui/pages/assistant.js");
  assert.match(assistant, /A\.aborter = new AbortController\(\);\s*\/\/[^\n]*\n\s*const letGo = holdWhileShown\(\(\) => A\.aborter\?\.abort\(\)\);/);
  assert.match(assistant, /letGo\(\); live\.remove\(\); setBusy\(false\);/);
  // A terminal's stream is its view's, which the Terminal pane and the sign-in sheet both show (HarnessV3-ACP AC3-7).
  const terminal = read("src/ui/harness/lib/xterm.js");
  assert.match(terminal, /const ws = new WebSocket\([^\n]*\n\s*(\/\/[^\n]*\n\s*)+let putAway = false;\s*const letGo = holdWhileShown\(\(\) => \{\s*putAway = true;\s*ws\.close\(\);\s*\}\);/);
  // (fails before: yes — HarnessV4_Tasks U4, found in HarnessV3-Views V3: the page's own close as it was put away read
  // as the process's end, so the page brought back showed "[Process exited]" — and its tab's warning — over a terminal
  // that was running, until its fresh load attached again)
  assert.match(terminal, /ws\.onclose = \(\) => \{\s*letGo\(\);\s*if \(!putAway\) exited\(null\);\s*\};/, "a close the page made itself says nothing of an exit");
});
