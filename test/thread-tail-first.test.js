// @ts-check
// A sub-agent's thread opened follows its newest exchange's run alone; the exchanges before it are followed as the place
// shown comes near them, one at a time, the nearest the end first, each once the one before it is shown (the owner's of
// 11-17: "when i click any running sub agent, it first shows the start of a turn text, then Loading text and in many
// cases it takes seconds and then it snap back to tail of the session. clicking it should take directly to tail" — a
// thread of 37 to 51 exchanges replayed every exchange's run from its first event at once, the newest's answered
// last). What an exchange not followed yet shows is what it showed before its run came: its prompt and how it ended.
// A page with no watcher of what comes near follows every exchange at once, as before.
// (fails before: yes — every exchange's run was followed as the thread opened)
import { test, describe, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { agentRow, NOW } from "./helpers/side-view.js";
import { until } from "./helpers/wait.js";
import { runSocketStandIn } from "./helpers/run-socket.js";

const g = /** @type {any} */ (globalThis);
/** @type {(url: string) => Response | null} */
let serve = () => null;
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url) => serve(String(url)) ?? new Promise(() => {});
const { subagentConversation } = await import("../src/ui/harness/subagent-viewer.js");
const { h } = await import("../src/ui/lib/dom.js");

/** @param {any} body */
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const MAIN = { state: () => /** @type {const} */ ("idle"), outside: () => null, start: () => {}, write: () => {} };
/** The page's follows, as the socket stand-in heard them: which run each asks. @type {{ key: string, run: string, peer: any }[]} */
const follows = [];
/** The page's event streams, as the stand-in made them: a message on one reaches the page's bus. @type {any[]} */
const streams = [];
/** The agent changed, as the feed says it: the thread looks at it again. */
const told = () => {
  for (const s of streams) s.onmessage?.({ data: JSON.stringify({ type: "subagent", chainId: "c1", id: "sa_t" }) });
};

/** The page's watcher of what comes near the place shown, stood in: the test says what is near. */
class NearStandIn {
  /** @type {NearStandIn[]} */
  static made = [];
  /** @param {(entries: { target: any, isIntersecting: boolean, boundingClientRect?: any }[]) => void} cb @param {any} [opts] */
  constructor(cb, opts = {}) {
    this.cb = cb;
    this.opts = opts;
    /** @type {Set<any>} */
    this.watched = new Set();
    NearStandIn.made.push(this);
  }
  /** @param {any} el */
  observe(el) {
    this.watched.add(el);
  }
  /** @param {any} el */
  unobserve(el) {
    this.watched.delete(el);
  }
  disconnect() {
    this.watched.clear();
  }
  /** The newest watcher's first word, as a watch begun says it: every element it watches, these near — on the screen. @param {any[]} near */
  static say(near) {
    const o = /** @type {NearStandIn} */ (NearStandIn.made.at(-1));
    o.cb([...o.watched].map((target) => ({ target, isIntersecting: near.includes(target), boundingClientRect: near.includes(target) ? { top: 100, bottom: 300 } : { top: -3000, bottom: -2800 } })));
  }
  static watching() {
    return NearStandIn.made.flatMap((o) => [...o.watched]);
  }
}

/** @param {number} i */
const ended = (i) => ({ prompt: `Step ${i}.`, description: `Step ${i}.`, by: "owner", runId: `run_${i}`, status: "done", startedAt: NOW - 600_000 + i * 1000, endedAt: NOW - 590_000 + i * 1000, delivery: "held", report: `Did step ${i}.` });
/** @param {number} i */
const running = (i) => ({ prompt: `Step ${i}.`, description: `Step ${i}.`, by: "owner", runId: `run_${i}`, status: "running", startedAt: NOW - 1000, endedAt: null, delivery: null });
/** @param {any[]} exchanges */
const rowOf = (exchanges) => agentRow("sa_t", { status: "running", origin: "owner", asked: false, card: { tag: "scout", name: "Scout" }, exchanges });
const ROW = rowOf([ended(0), ended(1), ended(2), running(3)]);
/** What the stand-in server answers for the agent now: its row, or a 404. @type {any} */
let answer = ROW;
/** @param {string} id @param {string} status @param {number} events */
const hello = (id, status, events) => ({ type: "hello", run: { id, status, endedAt: status === "running" ? null : NOW, events }, firstAvailable: 1, gap: null });

describe("a thread opened follows its newest exchange first", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {Record<string, any>} */
  const had = {};
  const STUBS = {
    requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
    cancelAnimationFrame: (/** @type {any} */ id) => clearTimeout(id),
    MutationObserver: class { observe() {} disconnect() {} },
    EventSource: class {
      constructor() {
        streams.push(this);
      }
      close() {}
    },
    IntersectionObserver: NearStandIn,
    WebSocket: runSocketStandIn((msg, peer) => {
      if (msg.op === "follow") follows.push({ key: msg.key, run: msg.run, peer });
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
    for (const c of open.splice(0)) c.close();
    follows.length = 0;
    NearStandIn.made.length = 0;
    g.IntersectionObserver = NearStandIn;
    answer = ROW;
  });
  const settle = () => new Promise((r) => setTimeout(r, 5));

  const opened = async (row = ROW) => {
    answer = row;
    serve = (url) => (!url.startsWith("/api/sessions/c1/subagents/sa_t") ? null : answer ? json({ subagent: answer }) : new Response(JSON.stringify({ error: "no such sub-agent in this session" }), { status: 404 }));
    const conv = subagentConversation({ chainId: "c1", id: "sa_t", toast: () => {}, main: MAIN });
    open.push(conv);
    const scroll = /** @type {any} */ (h("div", { class: "scroll" }, conv.body));
    // The place shown: 600 px of the thread, from the scroller's top.
    scroll.getBoundingClientRect = () => ({ top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600 });
    doc.document.body.append(h("div", { class: "host" }, conv.head, scroll, conv.foot));
    conv.mount(scroll);
    await until(() => follows.length >= 1, "the thread follows a run");
    const body = /** @type {any} */ (conv.body);
    return {
      conv,
      scroll,
      body,
      exchanges: () => body.querySelectorAll(".sav-ex"),
      outcomes: () => body.querySelectorAll(".sav-outcome").length,
      /** A followed run's replay, in: its hello, its events, and its end where it ended. @param {number} at @param {string} status */
      land: (at, status) => {
        const f = follows[at];
        f.peer.data(f.key, hello(f.run, status, 1));
        f.peer.data(f.key, { n: 1, at: NOW, type: "round-start", round: 1, blocksBefore: 0 });
        if (status !== "running") f.peer.end(f.key);
      },
    };
  };

  test("its newest exchange's run is followed alone; the others show their prompt and their end, and wait", async () => {
    const t = await opened();
    await settle();
    assert.deepEqual(follows.map((f) => f.run), ["run_3"]);
    assert.equal(t.exchanges().length, 4, "every exchange drawn");
    assert.equal(t.outcomes(), 3, "how each earlier one ended stands, followed or not");
    assert.equal(NearStandIn.watching().length, 0, "nothing woken while the newest's replay is on its way");
  });

  test("once the newest is shown, the nearest the end of those near is followed, then the next once it is shown", async () => {
    const t = await opened();
    const [ex0, ex1, ex2] = t.exchanges();
    t.land(0, "running");
    await until(() => NearStandIn.watching().length === 3, "the earlier exchanges are watched once the newest is shown");
    NearStandIn.say([ex0, ex2]);
    await settle();
    assert.deepEqual(follows.map((f) => f.run), ["run_3", "run_2"], "one at a time, the nearest the end first");
    assert.equal(NearStandIn.watching().length, 0, "the rest wait for it to be shown");
    t.land(1, "done");
    await until(() => NearStandIn.watching().length === 2, "watched again once it is shown");
    assert.deepEqual(NearStandIn.watching(), [ex0, ex1]);
    NearStandIn.say([ex1]);
    await settle();
    assert.deepEqual(follows.map((f) => f.run), ["run_3", "run_2", "run_1"]);
    // Nothing near: nothing more is followed.
    t.land(2, "done");
    await until(() => NearStandIn.watching().length === 1, "the last one waits, watched");
    NearStandIn.say([]);
    await settle();
    assert.equal(follows.length, 3);
  });

  test("a thread let go of follows nothing more: a word of the watcher that lands after it wakes nothing", async () => {
    const t = await opened();
    const [ex0] = t.exchanges();
    t.land(0, "running");
    await until(() => NearStandIn.watching().length === 3, "watched");
    const late = /** @type {NearStandIn} */ (NearStandIn.made.at(-1));
    t.conv.close();
    assert.equal(NearStandIn.watching().length, 0, "the watch let go of with the thread");
    late.cb([{ target: ex0, isIntersecting: true }]);
    await settle();
    assert.deepEqual(follows.map((f) => f.run), ["run_3"]);
  });

  test("the watch is the place shown's, reaching a screen's height around it; one on the screen wakes before one only near it", async () => {
    const t = await opened();
    const [ex0, , ex2] = t.exchanges();
    t.land(0, "running");
    await until(() => NearStandIn.watching().length === 3, "watched");
    const watch = /** @type {NearStandIn} */ (NearStandIn.made.at(-1));
    assert.equal(watch.opts.root, t.scroll);
    assert.equal(watch.opts.rootMargin, "100% 0px");
    // After a jump up: the first exchange on the screen, the third just under it, in the watch's reach alone.
    watch.cb([
      { target: ex0, isIntersecting: true, boundingClientRect: { top: 100, bottom: 400 } },
      { target: ex2, isIntersecting: true, boundingClientRect: { top: 700, bottom: 900 } },
    ]);
    await settle();
    assert.deepEqual(follows.map((f) => f.run), ["run_3", "run_0"]);
  });

  test("an exchange with no run of its own waits for nothing: it is not watched", async () => {
    const { runId, ...refused } = ended(1);
    const t = await opened(rowOf([ended(0), refused, ended(2), running(3)]));
    const [ex0, , ex2] = t.exchanges();
    t.land(0, "running");
    await until(() => NearStandIn.watching().length === 2, "the two with a run watched");
    assert.deepEqual(NearStandIn.watching(), [ex0, ex2]);
  });

  test("an exchange that comes after the thread opened is followed at once; one gone takes the watch with it", async () => {
    const t = await opened();
    t.land(0, "running");
    await until(() => NearStandIn.watching().length === 3, "watched");
    // A follow-up: the newest ended, the next one runs.
    answer = rowOf([ended(0), ended(1), ended(2), ended(3), running(4)]);
    told();
    await until(() => follows.some((f) => f.run === "run_4"), "the new exchange followed");
    assert.deepEqual(follows.map((f) => f.run), ["run_3", "run_4"], "the earlier ones still wait");
    assert.equal(NearStandIn.watching().length, 3);
    // Gone: what waited is watched no more.
    answer = null;
    told();
    await until(() => /This thread is gone/.test(String(t.body.textContent)), "the thread says it is gone");
    assert.equal(NearStandIn.watching().length, 0);
  });

  test("a page with no watcher of what comes near follows every exchange as the thread opens", async () => {
    delete g.IntersectionObserver;
    await opened();
    await until(() => follows.length === 4, "every exchange followed");
    assert.deepEqual(follows.map((f) => f.run).sort(), ["run_0", "run_1", "run_2", "run_3"]);
  });
});
