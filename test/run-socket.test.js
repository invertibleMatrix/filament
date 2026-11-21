// @ts-check
// A page's run follows on one WebSocket (the perf pass's A1). A browser gives a page six HTTP/1.1 connections to this
// host, shared by every window of the app, and each run the harness followed held one as an event stream: with a few
// chats at work, every other request — the transcript of the chat just clicked among them — queued behind them. The
// page now follows every run on one socket (`/api/runs/socket`), which counts against none of the six; each follow
// carries the frames the events route sends, keyed by the follow.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startApp } from "./helpers/app.js";
import { until } from "./helpers/wait.js";
import { pageEvents } from "./helpers/page-events.js";
import { fakeRunSocket } from "./helpers/run-socket.js";
import { followRun } from "../src/ui/harness/lib/api.js";
import { artifactAddress } from "../src/core/artifacts.js";

// The followers hold their streams while the page is shown (ui/lib/put-away.js): the page's events, stood in.
const page = pageEvents();

/**
 * A socket to the app's run follows, with every message it got, parsed.
 * @param {string} base  http://host:port
 */
async function socketTo(base) {
  const ws = new WebSocket(`${base.replace(/^http/, "ws")}/api/runs/socket`);
  /** @type {any[]} */
  const got = [];
  ws.onmessage = (e) => got.push(JSON.parse(String(e.data)));
  let closed = false;
  ws.onclose = () => void (closed = true);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  return {
    ws,
    got,
    get closed() {
      return closed;
    },
    /** @param {any} msg */
    ask: (msg) => ws.send(JSON.stringify(msg)),
    /** What came for a key: its stream's frames as `data`, its last word as itself. @param {string} key */
    of: (key) => got.filter((m) => m.key === key).map((m) => ("data" in m ? m.data : m)),
  };
}

/**
 * An upgrade asked over node:http, answered by status: 101 taken, else the refusal's.
 * @param {string} base @param {Record<string, string>} headers
 * @returns {Promise<number>}
 */
function upgradeStatus(base, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}/api/runs/socket`, {
      headers: { connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", ...headers },
    });
    req.on("upgrade", (res, socket) => {
      socket.destroy();
      resolve(res.statusCode || 0);
    });
    req.on("response", (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on("error", reject);
    req.end();
  });
}

describe("the run socket, against the app", () => {
  /** @type {any} */ let t;
  before(async () => {
    t = await startApp();
  });
  after(async () => {
    await t?.stop();
  });

  // (fails before: yes — server.js handed the socket no chats' browsers: a whole Filament said it casts none)
  test("a cast asked of the whole app reaches its chats' browsers, which say where it stands", async () => {
    const s = await socketTo(t.url);
    try {
      s.ask({ op: "cast", key: "v", chain: "c-cast" });
      await until(() => s.of("v").length, "the cast's state");
      const said = s.of("v")[0];
      assert.equal(said.cast?.on, false, JSON.stringify(said));
      assert.notEqual(said.cast?.why, "this Filament casts no browser", JSON.stringify(said));
    } finally {
      s.ws.close();
    }
  });

  // (fails before: yes — there was no socket: the upgrade was the terminal's to refuse)
  test("one socket carries many follows, each the events route's frames keyed by it: hello, the replay, live, the end", async () => {
    const runs = t.app.runs;
    runs.startRun({ id: "sock_live", kind: "agent-turn", title: "t" });
    t.app.events.publish("run:sock_live", { type: "round-start", round: 1 });
    runs.startRun({ id: "sock_done", kind: "agent-turn", title: "t" });
    runs.endRun("sock_done", { status: "done" });
    const s = await socketTo(t.url);
    try {
      s.ask({ op: "follow", key: "a", run: "sock_live", since: 0, words: false });
      s.ask({ op: "follow", key: "b", run: "sock_done", since: 0, words: false });
      s.ask({ op: "follow", key: "c", run: "no_such_run", since: 0 });
      await until(() => s.of("b").some((m) => m.end) && s.of("c").length && s.of("a").some((m) => m.type === "round-start"), "the three follows");
      assert.deepEqual(s.of("c"), [{ key: "c", missing: true }], "a run the log does not hold is said missing — where the route answers 404");
      const b = s.of("b");
      assert.equal(b[0].type, "hello");
      assert.equal(b[0].run.status, "done");
      assert.deepEqual(b.slice(1).map((m) => m.type ?? (m.end ? "(end)" : "?")), ["run-start", "run-end", "ended", "(end)"], "an ended run: its events, `ended`, then the follow's end");
      // The live follow goes on: an event published now arrives, then the run's end ends it.
      t.app.events.publish("run:sock_live", { type: "round-text", round: 1, text: "live words" });
      await until(() => s.of("a").some((m) => m.type === "round-text"), "the live event");
      runs.endRun("sock_live", { status: "stopped" });
      await until(() => s.of("a").some((m) => m.end), "the live run's end");
      const a = s.of("a");
      assert.deepEqual(a.map((m) => m.type ?? "(end)"), ["hello", "run-start", "round-start", "round-text", "run-end", "ended", "(end)"]);
      assert.deepEqual(a.filter((m) => m.n).map((m) => m.n), [1, 2, 3, 4], "numbered as the log numbers them");
      assert.equal(a.at(-2).status, "stopped");
      // The frame is the events route's own JSON, spliced in after its key.
      const raw = /** @type {any} */ (runs.events("sock_live", { since: 2, limit: 1 })).events[0];
      assert.deepEqual(a[3], raw);
    } finally {
      s.ws.close();
    }
  });

  test("a follow resumes after its cursor; with words it hears the running turn's words; a stop lets the run go, and so does the socket's close", async () => {
    const runs = t.app.runs;
    runs.startRun({ id: "sock_words", kind: "agent-turn", title: "t" });
    for (let i = 0; i < 4; i++) t.app.events.publish("run:sock_words", { type: "tick", i });
    t.app.liveWords.start("sock_words");
    t.app.liveWords.piece("sock_words", "text", "So far. ");
    const s = await socketTo(t.url);
    try {
      s.ask({ op: "follow", key: "w", run: "sock_words", since: 3, words: true });
      await until(() => s.of("w").filter((m) => m.n).length === 2, "the events after the cursor");
      const w = s.of("w");
      assert.deepEqual(w[1], { type: "words", blocks: [{ type: "text", text: "So far. " }], open: true });
      assert.deepEqual(w.filter((m) => m.n).map((m) => m.n), [4, 5]);
      t.app.liveWords.piece("sock_words", "text", "More.");
      await until(() => s.of("w").some((m) => m.piece), "the next piece");
      assert.equal(t.app.liveWords.held(), 2, "the turn's words and this one reader");
      s.ask({ op: "stop", key: "w" });
      await until(() => t.app.liveWords.held() === 1, "the stopped follow to stop reading");
      s.ask({ op: "follow", key: "w2", run: "sock_words", since: 5, words: true });
      await until(() => t.app.liveWords.held() === 2, "a second follow");
      s.ws.close();
      await until(() => t.app.liveWords.held() === 1, "the socket's close to let its follows go");
    } finally {
      s.ws.close();
      t.app.liveWords.end("sock_words");
      runs.endRun("sock_words");
    }
  });

  test("its guard: a page of another site, an artifact's page, or no handshake is refused; this server's own page is taken", async () => {
    const port = new URL(t.url).port;
    assert.equal(await upgradeStatus(t.url, { origin: "http://evil.example" }), 403, "another site's page");
    assert.equal(await upgradeStatus(t.url, { origin: artifactAddress("chart-ab12", Number(port)) }), 403, "an artifact's page");
    assert.equal(await upgradeStatus(t.url, { host: new URL(artifactAddress("chart-ab12", Number(port))).host }), 404, "asked on an artifact's address");
    assert.equal(await upgradeStatus(t.url, { origin: `http://localhost:${port}` }), 101, "the page on localhost, the same server");
    assert.equal(await upgradeStatus(t.url, {}), 101, "no Origin: no browser page");
    assert.equal(await upgradeStatus(t.url, { "sec-websocket-key": "" }), 400);
    assert.equal(await upgradeStatus(t.url, { host: "evil.example" }), 403, "a host that does not name this machine");
  });

  test("the harness's own follow rides it: followRun against the app hears the run and its end", async () => {
    const { pointPageAt } = await import("./helpers/run-socket.js");
    pointPageAt(t.url);
    const runs = t.app.runs;
    runs.startRun({ id: "sock_page", kind: "agent-turn", title: "t" });
    /** @type {string[]} */
    const heard = [];
    const follower = followRun("sock_page", { onRun: (r) => heard.push(`run:${r.status}`), onEvent: (e) => heard.push(e.type), onRunEnd: (s) => heard.push(`end:${s}`), onDone: () => heard.push("done") });
    try {
      await until(() => heard.includes("run-start"), "the run's start");
      runs.endRun("sock_page", { status: "done" });
      await follower.promise;
      assert.deepEqual(heard, ["run:running", "run-start", "run-end", "end:done", "done"]);
    } finally {
      follower.stop();
    }
  });
});

// (fails before: yes — each follow was a fetch of its own: eight followed runs held eight HTTP connections, past the
// six a browser gives the page)
test("the page's follows hold one socket between them and no HTTP connection; the socket goes with the last follow", async () => {
  const server = await fakeRunSocket((msg, peer) => {
    if (msg.op !== "follow") return;
    peer.data(msg.key, { type: "hello", run: { id: msg.run, status: "running" } });
    peer.data(msg.key, { n: 1, type: "run-start" });
  });
  /** @type {ReturnType<typeof followRun>[]} */
  const follows = [];
  try {
    /** @type {Record<string, number>} */
    const heard = {};
    for (let i = 0; i < 8; i++) follows.push(followRun(`r${i}`, { onEvent: () => void (heard[`r${i}`] = (heard[`r${i}`] || 0) + 1) }));
    await until(() => Object.keys(heard).length === 8, "every run's first event");
    assert.deepEqual([server.sockets, server.requests], [1, 0], "eight runs followed: one socket, no request");
    for (const f of follows.splice(0, 7)) f.stop();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(server.sockets, 1, "the socket stays while a follow does");
    follows.pop()?.stop();
    follows.push(followRun("again", { onEvent: () => void (heard.again = 1) }));
    await until(() => heard.again === 1, "a follow after the last one ended");
    assert.equal(server.sockets, 2, "the last follow's stop closed the socket; the next follow opened one");
    // A page put away lets every follow go (ui/lib/put-away.js), and with them the socket.
    page.putAway();
    await Promise.all(follows.map((f) => f.promise));
    page.bringBack();
  } finally {
    for (const f of follows) f.stop();
    await server.close();
  }
});
