// @ts-check
// A running agent's thread opened midway: its run's stream says the words so far first — every block of the run, each
// round's — then replays its events from the start, one message each on the page's run socket, a frame's turn between
// any two. The thread draws nothing of the replay as it passes (its rounds wait out of sight, no frame drawn): once the
// event its hello named is in, every round lands in one frame, each with its own words, formatted, at the thread's end
// (the owner's of 11-15: "it takes some times to load it, the text loads and then takes sometimes it reaches the tail.
// the text being rendered feels unformatted as well"). A replay that takes too long is drawn as it comes, never a
// round's words glued to the later rounds'; a follow taken up again hides nothing already shown.
import { test, describe, before, after, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { agentRow, NOW } from "./helpers/side-view.js";
import { until } from "./helpers/wait.js";
import { runSocketStandIn } from "./helpers/run-socket.js";

const g = /** @type {any} */ (globalThis);
/** What the stand-in server answers, by the whole address; null leaves the request unanswered. @type {(url: string) => Response | null} */
let serve = () => null;
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url) => serve(String(url)) ?? new Promise(() => {});
const { subagentConversation } = await import("../src/ui/harness/subagent-viewer.js");
const { h } = await import("../src/ui/lib/dom.js");

/** @param {any} body */
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const MAIN = { state: () => /** @type {const} */ ("idle"), outside: () => null, start: () => {}, write: () => {} };
/** The page's follows of the run, as the socket stand-in heard them. @type {{ key: string, peer: any }[]} */
const follows = [];
/** Frames asked of the page so far. */
let frames = 0;

/** The run's whole stream as the server sends a follow from its start: the words so far, every block of the run's. */
const WORDS = { type: "words", blocks: [{ type: "text", text: "I read the files." }, { type: "text", text: "## Plan\n\n- fix the lexer" }, { type: "text", text: "Now editing lex.js" }], open: true };
/** Its log, numbered from 1: three rounds, the third one running, its words still only in the words frame. */
const LOG = [
  { type: "round-start", round: 1, blocksBefore: 0 },
  { type: "round-text", round: 1, text: "I read the files." },
  { type: "round-start", round: 2, blocksBefore: 1 },
  { type: "round-text", round: 2, text: "## Plan\n\n- fix the lexer" },
  { type: "round-start", round: 3, blocksBefore: 2 },
].map((e, i) => ({ n: i + 1, at: NOW, ...e }));
/** @param {number} events */
const hello = (events) => ({ type: "hello", run: { id: "run_r1", status: "running", endedAt: null, events }, firstAvailable: 1, gap: null });

describe("a running agent's thread opened midway", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {Record<string, any>} */
  const had = {};
  const STUBS = {
    requestAnimationFrame: (/** @type {(t: number) => void} */ f) => {
      frames++;
      return setTimeout(() => f(0), 0);
    },
    cancelAnimationFrame: (/** @type {any} */ id) => clearTimeout(id),
    MutationObserver: class { observe() {} disconnect() {} },
    EventSource: class { close() {} },
    WebSocket: runSocketStandIn((msg, peer) => {
      if (msg.op === "follow") follows.push({ key: msg.key, peer });
    }),
    location: { protocol: "http:", host: "stand-in" },
    addEventListener: () => {},
  };
  before(() => {
    doc = stubDocument();
    for (const [k, v] of Object.entries(STUBS)) {
      had[k] = Object.prototype.hasOwnProperty.call(g, k) ? g[k] : undefined;
      g[k] = v;
    }
  });
  after(() => {
    doc.restore();
    for (const k of Object.keys(STUBS)) {
      if (had[k] === undefined) delete g[k];
      else g[k] = had[k];
    }
    g.fetch = realFetch;
  });
  /** @type {{ close: () => void }[]} */
  const open = [];
  afterEach(() => {
    mock.timers.reset();
    for (const c of open.splice(0)) c.close();
    follows.length = 0;
  });
  /** A frame asked for is drawn first: the stand-in's frames are a timer of 0. */
  const frameTurn = () => new Promise((r) => setTimeout(r, 0));
  /** What a message on the socket brings has reached the page: it comes a microtask after it is sent. */
  const landed = () => new Promise((r) => setImmediate(r));

  /** The thread of a running agent, opened, its run followed. */
  const opened = async () => {
    const row = agentRow("sa_r1", { status: "running", origin: "owner", asked: false, card: { tag: "scout", name: "Scout" }, exchanges: [{ prompt: "Fix the parser.", description: "Fix the parser.", by: "owner", runId: "run_r1", status: "running", startedAt: NOW - 60_000, endedAt: null, delivery: null }] });
    serve = (url) => (url.startsWith("/api/sessions/c1/subagents/sa_r1") ? json({ subagent: row }) : null);
    const conv = subagentConversation({ chainId: "c1", id: "sa_r1", toast: () => {}, main: MAIN });
    open.push(conv);
    const scroll = h("div", { class: "scroll" }, conv.body);
    doc.document.body.append(h("div", { class: "host" }, conv.head, scroll, conv.foot));
    conv.mount(scroll);
    await until(() => follows.length === 1, "the thread follows its run");
    const { key, peer } = follows[0];
    const body = /** @type {any} */ (conv.body);
    return {
      /** @param {any} frame */
      send: (frame) => peer.data(key, frame),
      peer,
      /** The rounds' boxes as the person sees them: none while they wait out of sight. */
      seen: () => body.querySelectorAll(".sav-round").filter((/** @type {any} */ r) => r.getClientRects().length > 0),
      texts: () => body.querySelectorAll(".sav-round .sav-text").map((/** @type {any} */ t) => (t.classList.contains("hidden") ? "" : String(t.innerHTML))),
      working: () => String(body.querySelector(".sav-working")?.textContent || ""),
    };
  };

  test("the replay draws nothing as it passes, then lands in one frame, each round's words its own, formatted", async () => {
    const t = await opened();
    await frameTurn();
    t.send(hello(LOG.length));
    t.send(WORDS);
    await landed();
    const before = frames;
    for (const e of LOG.slice(0, -1)) {
      t.send(e);
      await landed();
      await frameTurn();
      assert.equal(t.seen().length, 0, `no round shown while the replay passes event ${e.n}`);
      assert.equal(t.working(), "Loading");
    }
    assert.equal(frames, before, "no frame drawn while the replay passes");
    t.send(LOG[LOG.length - 1]);
    await landed();
    assert.equal(frames, before + 1, "the replay in, one frame asked");
    await frameTurn();
    assert.equal(t.seen().length, 3, "every round shown at once");
    const texts = t.texts();
    assert.equal(texts.length, 3);
    assert.doesNotMatch(texts[0], /Plan|editing/, `round 1 shows only its own words: ${texts[0]}`);
    assert.match(texts[1], /class="md-h md-h2">Plan</, "round 2's words, formatted");
    assert.doesNotMatch(texts[1], /editing/, `round 2 shows only its own words: ${texts[1]}`);
    assert.match(texts[2], /Now editing lex\.js/, "the running round's words, from the words frame");
    assert.notEqual(t.working(), "Loading");
  });

  test("a replay that falls quiet is drawn as it comes, with no round's words glued to the later rounds'", async () => {
    const t = await opened();
    await frameTurn();
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    t.send(hello(LOG.length));
    t.send(WORDS);
    t.send(LOG[0]);
    await landed();
    assert.equal(t.seen().length, 0, "out of sight while it waits for the replay");
    mock.timers.tick(1000);
    // Still coming, on a slow link: the wait goes on.
    t.send(WORDS);
    await landed();
    mock.timers.tick(1000);
    assert.equal(t.seen().length, 0, "out of sight while the replay keeps coming");
    mock.timers.tick(500);
    mock.timers.tick(1);
    assert.equal(t.seen().length, 1, "shown once it fell quiet");
    assert.equal(t.texts()[0], "", "the words after round 1's start are not all round 1's: they wait for the replay");
    t.send(LOG[1]);
    t.send(LOG[2]);
    await landed();
    mock.timers.tick(1);
    assert.equal(t.seen().length, 2, "drawn as it comes");
    assert.match(t.texts()[0], /I read the files\./);
    assert.doesNotMatch(t.texts()[0], /Plan|editing/, "round 1 shows only its own words");
    t.send(LOG[3]);
    t.send(LOG[4]);
    await landed();
    mock.timers.tick(1);
    assert.match(t.texts()[2], /Now editing lex\.js/, "the running round's words once the replay reaches it");
  });

  test("a follow taken up again hides nothing already shown", async () => {
    const t = await opened();
    await frameTurn();
    t.send(hello(3));
    t.send(WORDS);
    for (const e of LOG.slice(0, 3)) t.send(e);
    await landed();
    await frameTurn();
    assert.equal(t.seen().length, 2);
    // The socket drops: the page follows again from the event it has, and the server says the run has gone on since.
    t.peer.close();
    await until(() => follows.length === 2, "the thread follows its run again");
    const again = follows[1];
    again.peer.data(again.key, hello(5));
    await landed();
    await frameTurn();
    assert.equal(t.seen().length, 2, "the rounds shown stay shown");
    again.peer.data(again.key, LOG[3]);
    again.peer.data(again.key, LOG[4]);
    await landed();
    await frameTurn();
    assert.equal(t.seen().length, 3);
    assert.match(t.texts()[2], /Now editing lex\.js/);
  });

  test("a replay that keeps coming is drawn as it comes once it has waited its most", async () => {
    const t = await opened();
    await frameTurn();
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    t.send(hello(1000));
    t.send(LOG[0]);
    await landed();
    for (let s = 1; s < 10; s++) {
      mock.timers.tick(1000);
      t.send(WORDS);
      await landed();
    }
    assert.equal(t.seen().length, 0, "out of sight for nine seconds of a replay that keeps coming");
    mock.timers.tick(1000);
    mock.timers.tick(1);
    assert.equal(t.seen().length, 1, "shown at ten");
  });

  test("a run with no events yet holds nothing", async () => {
    const t = await opened();
    await frameTurn();
    t.send(hello(0));
    t.send(WORDS);
    await landed();
    assert.notEqual(t.working(), "Loading");
    t.send(LOG[0]);
    await landed();
    await frameTurn();
    assert.equal(t.seen().length, 1);
  });

  test("a running agent's frames read no command's output, and one you scrolled keeps its place", async () => {
    const t = await opened();
    await frameTurn();
    const run = [
      { type: "round-start", round: 1, blocksBefore: 0 },
      { type: "tool-start", round: 1, id: "b1", name: "bash", args: { command: "npm test" } },
      { type: "tool-end", round: 1, id: "b1", ok: true, preview: "pass 1\npass 2\npass 3", exitCode: 0 },
    ].map((e, i) => ({ n: i + 1, at: NOW, ...e }));
    t.send(hello(run.length));
    for (const e of run) t.send(e);
    await landed();
    await frameTurn();
    await frameTurn();
    const round = t.seen()[0];
    const out = round.querySelector("pre.term-out");
    assert.ok(out, "the command's output is drawn");
    // Its place as the page holds it: each read laid the page out.
    let top = 0;
    let reads = 0;
    Object.defineProperty(out, "scrollTop", { configurable: true, get: () => (reads++, top), set: (v) => { top = v; } });
    // Each event of the running agent draws its newest round again.
    let n = run.length;
    const more = () => t.send({ n: ++n, at: NOW, type: "turn-state", round: 1, to: "planning" });
    more();
    await landed();
    await frameTurn();
    assert.equal(reads, 0, "a frame reads no output's place");
    // You scroll it: the scroll reaches the thread as it goes by (a capture listener), and the frames keep it.
    top = 120;
    round.parentNode.dispatch("scroll", { target: out });
    top = 0; // drawn again, the page put it back at its top
    more();
    await landed();
    await frameTurn();
    assert.equal(top, 120, "given back the place you left it at");
  });

  test("a follow that ends before the event its hello named shows what came", async () => {
    const t = await opened();
    await frameTurn();
    t.send(hello(LOG.length));
    t.send(LOG[0]);
    t.send(LOG[1]);
    await landed();
    assert.equal(t.seen().length, 0);
    t.send({ type: "ended", status: "done" });
    follows[0].peer.end(follows[0].key);
    await until(() => t.seen().length === 1, "the rounds that came, shown once the follow is over");
    assert.match(t.texts()[0], /I read the files\./);
  });
});
