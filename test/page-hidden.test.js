// @ts-check
// A page out of sight reads nothing it can read later (the owner's Mac of 11-14: the desktop app kept another machine's
// page loaded and hidden in its side rail, and that page took 50–80% of a core and churned 2.5 GB of memory, reading a
// long chat's transcript — up to 3 MB — every two seconds while another window's turn held it, and the left bar's
// lists, the runs and the agents' list at each word of the feed and each tick). What it would read waits under a name
// (lib/page-shown.js), a later ask of the same name taking its place, and runs once as the page shows again; in sight,
// everything reads as it did. The feed is heard all the while.
import { test, after, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pageShownGate } from "../src/ui/harness/lib/page-shown.js";
import { lift } from "./helpers/app-lift.js";
import { stubDocument } from "./helpers/dom-stub.js";

const tick = () => new Promise((r) => setImmediate(r));
/** A few turns of the event loop. */
const turns = async () => {
  for (let i = 0; i < 20; i++) await tick();
};

/** A document of the test's: its sight set by the test, its `visibilitychange` heard by what listens. */
function fakeDoc() {
  /** @type {(() => void)[]} */
  const heard = [];
  const doc = {
    visibilityState: "visible",
    /** @param {string} type @param {() => void} fn */
    addEventListener: (type, fn) => void (type === "visibilitychange" && heard.push(fn)),
  };
  /** Its sight changes: what listens hears it. */
  const fire = () => {
    for (const fn of heard) fn();
  };
  return {
    doc,
    fire,
    hide: () => void (doc.visibilityState = "hidden"),
    show: () => {
      doc.visibilityState = "visible";
      fire();
    },
    listeners: () => heard.length,
  };
}

// (fails before: yes — lib/page-shown.js did not exist)
test("in sight a read runs at once; out of sight it waits under its name, the newest ask in its place, and runs once as the page shows", () => {
  const d = fakeDoc();
  const gate = pageShownGate(() => d.doc);
  /** @type {string[]} */
  const ran = [];
  assert.equal(gate.whenShown("list", () => (ran.push("list now"), 7)), 7, "in sight: run now, its answer given back");
  assert.equal(d.listeners(), 0, "nothing listens until something waits");
  d.hide();
  assert.equal(gate.shown(), false);
  assert.equal(gate.whenShown("list", () => ran.push("list 1")), undefined);
  gate.whenShown("list", () => ran.push("list 2"));
  gate.whenShown("runs", () => ran.push("runs"));
  gate.whenShown("list", () => ran.push("list 3"));
  assert.deepEqual([ran, gate.waiting()], [["list now"], 2], "out of sight: nothing read, one wait a name");
  d.fire();
  assert.deepEqual(ran, ["list now"], "a change of sight that leaves it hidden runs nothing");
  d.show();
  assert.deepEqual(ran, ["list now", "list 3", "runs"], "once each, the newest ask of a name, in the order first asked");
  d.show();
  assert.deepEqual(ran, ["list now", "list 3", "runs"], "shown again: nothing waits");
  assert.equal(d.listeners(), 1, "one listener, however many waits");
  // What waited and is asked again in sight is that ask alone.
  d.hide();
  gate.whenShown("list", () => ran.push("list waited"));
  d.doc.visibilityState = "visible";
  gate.whenShown("list", () => ran.push("list in sight"));
  d.show();
  assert.deepEqual(ran.slice(3), ["list in sight"]);
});

test("one that throws leaves the others to run; a page that cannot tell is in sight", () => {
  const d = fakeDoc();
  const gate = pageShownGate(() => d.doc);
  const g = /** @type {any} */ (globalThis);
  const had = g.reportError;
  /** @type {unknown[]} */
  const reported = [];
  g.reportError = (/** @type {unknown} */ e) => void reported.push(e);
  try {
    d.hide();
    /** @type {string[]} */
    const ran = [];
    gate.whenShown("a", () => { throw new Error("read failed"); });
    gate.whenShown("b", () => ran.push("b"));
    d.show();
    assert.deepEqual([ran, reported.map((e) => /** @type {Error} */ (e).message)], [["b"], ["read failed"]]);
  } finally {
    if (had === undefined) delete g.reportError;
    else g.reportError = had;
  }
  const none = pageShownGate(() => undefined);
  assert.equal(none.shown(), true);
  assert.equal(none.whenShown("x", () => "ran"), "ran");
});

/**
 * The page's catch-up of the chat shown, lifted out of app.js over a gate of the test's: each read of the transcript
 * counted and answered by `read`.
 * @param {ReturnType<typeof fakeDoc>} d @param {(chat: any, n: number) => void} read
 */
function catchUp(d, read) {
  const gate = pageShownGate(() => d.doc);
  const state = { currentId: "c1", chats: new Map() };
  const chat = { id: "c1", chainId: "s-c1", turns: [], view: /** @type {any} */ ({ holder: { window: "harness" } }) };
  state.chats.set("c1", chat);
  const reads = { n: 0 };
  const fns = lift(["FOLLOW_TRIES", "followElsewhere", "catchUpOnShow?", "clientTurnEnded"], {
    state,
    chatOf: (/** @type {string} */ id) => state.chats.get(id) || null,
    opening: new WeakSet(),
    hydrate: async (/** @type {any} */ c) => read(c, ++reads.n),
    setTimeout: (/** @type {() => void} */ fn) => setImmediate(fn),
    pageShown: gate.shown,
    whenPageShown: gate.whenShown,
  });
  return { gate, chat, reads, fns };
}

// (fails before: yes — the page read the chat every 250 ms to 2 s for as long as another window's turn held it, seen or
// not; `catchUpOnShow` did not exist)
test("out of sight, the chat shown is not read while another window's turn holds it; it is read once as the page shows", async () => {
  const d = fakeDoc();
  d.hide();
  // The read finds the turn over: drawn whole, nothing left to follow.
  const { gate, chat, reads, fns } = catchUp(d, (c) => void (c.view = { holder: null }));
  // The feed's word, the holders resync and a reconnect each ask for the catch-up.
  for (let i = 0; i < 3; i++) await fns.followElsewhere(chat);
  assert.deepEqual([reads.n, gate.waiting(), chat.catchingUp], [0, 1, false], "nothing read; one catch-up waits");
  d.show();
  await turns();
  assert.equal(reads.n, 1, "read once as the page shows: the turn drawn as it ended");
  d.show();
  await turns();
  assert.equal(reads.n, 1, "shown again: nothing waited");
});

// (fails before: yes — the catch-up read on out of sight, until its turn ended or its reads failed)
test("a catch-up under way stops as the page goes out of sight, and goes on as it shows again", async () => {
  const d = fakeDoc();
  const { chat, reads, fns } = catchUp(d, (c, n) => {
    // The page is put away after the second read; the old page read on until the session was gone.
    if (n === 2) d.hide();
    if (n === 6) throw Object.assign(new Error("no such session: s-c1"), { status: 404 });
    if (n === 3) c.view = { holder: null };
  });
  await fns.followElsewhere(chat);
  assert.deepEqual([reads.n, chat.catchingUp], [2, false], "two reads in sight, none out of it");
  d.show();
  await turns();
  assert.equal(reads.n, 3, "shown: read again, and the turn found over");
});

// (fails before: no — the old page followed every turn; this keeps the one whose end only a follow says)
test("out of sight, a turn the chat's coding agent began by itself is followed still: its end is said out loud", async () => {
  const d = fakeDoc();
  d.hide();
  const { gate, chat, reads, fns } = catchUp(d, (c) => void (c.view = { holder: null }));
  chat.view = { holder: { window: "harness", own: { agent: "claude" } } };
  await fns.followElsewhere(chat);
  assert.deepEqual([reads.n, gate.waiting()], [1, 0]);
});

// (fails before: yes — an outside client's turn that ended read the chat at once, seen or not)
test("out of sight, an outside client's chat whose turn ended is read once as the page shows", async () => {
  const d = fakeDoc();
  d.hide();
  const { chat, reads, fns } = catchUp(d, () => {});
  chat.view = { holder: null };
  fns.clientTurnEnded(chat);
  fns.clientTurnEnded(chat);
  await turns();
  assert.equal(reads.n, 0);
  d.show();
  await turns();
  assert.equal(reads.n, 1);
  // In sight, as before: read at once.
  fns.clientTurnEnded(chat);
  await turns();
  assert.equal(reads.n, 2);
});

// ---- The page's own modules, over the stub document: the singleton gate reads `document` as it asks. ----

const g = /** @type {any} */ (globalThis);
const ADDED = ["EventSource", "addEventListener", "removeEventListener", "requestAnimationFrame", "cancelAnimationFrame", "localStorage"].filter((k) => !(k in g));
const realFetch = g.fetch;
/** The reads the page asked, by path; each answered by `answer`. @type {string[]} */
const asked = [];
/** @type {(path: string) => any} */
let answer = () => ({});
g.fetch = async (/** @type {string} */ path) => {
  asked.push(String(path));
  return { ok: true, status: 200, json: async () => answer(String(path)) };
};
/** The feed's stream, as the page opened it. @type {any} */
let feed = null;
g.EventSource = class {
  constructor() {
    /** @type {((e: { data: string }) => void) | null} */
    this.onmessage = null;
    feed = this;
  }
  addEventListener() {}
  close() {}
};
g.addEventListener ||= () => {};
g.removeEventListener ||= () => {};
g.requestAnimationFrame = (/** @type {() => void} */ fn) => setImmediate(fn);
g.cancelAnimationFrame = () => {};
g.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
const dom = stubDocument();
const page = /** @type {any} */ (dom.document);
/** @type {(() => void)[]} */
const sightHeard = [];
page.addEventListener = (/** @type {string} */ type, /** @type {() => void} */ fn) => void (type === "visibilitychange" && sightHeard.push(fn));
page.visibilityState = "visible";
const hidePage = () => void (page.visibilityState = "hidden");
const showPage = () => {
  page.visibilityState = "visible";
  for (const fn of sightHeard) fn();
};
after(() => {
  dom.restore();
  g.fetch = realFetch;
  for (const k of ADDED) delete g[k];
});
/** How many reads asked for paths that hold `part`. @param {string} part */
const count = (part) => asked.filter((p) => p.includes(part)).length;

// (fails before: yes — each turn's end anywhere read the left bar's list, and the tick and each burst of the feed the
// runs, seen or not)
test("out of sight, the left bar's list and its runs wait, and each is read once as the page shows", async () => {
  answer = (p) => (p.includes("/runs") ? { runs: [] } : p.includes("/memory/sessions") ? { sessions: [] } : p.includes("/memory/projects") ? { projects: [] } : {});
  const { createSidebar } = await import("../src/ui/harness/sidebar.js");
  const host = page.createElement("div");
  const sb = createSidebar(host, { onNew() {}, onSettings() {}, onHide() {}, onSelectChat() {}, onOpen() {}, onChanged() {} });
  await sb.load();
  await sb.loadRuns();
  await turns();
  const list = count("/memory/sessions?limit=200");
  const runs = count("/runs?limit=50");
  assert.deepEqual([list, runs], [1, 1], "in sight: read at once");
  hidePage();
  for (let i = 0; i < 3; i++) {
    await sb.load();
    await sb.loadRuns();
  }
  await turns();
  assert.deepEqual([count("/memory/sessions?limit=200"), count("/runs?limit=50")], [list, runs], "out of sight: nothing read");
  showPage();
  await turns();
  assert.deepEqual([count("/memory/sessions?limit=200"), count("/runs?limit=50")], [list + 1, runs + 1], "shown: each read once");
});

// (fails before: yes — the agents' list was read every five seconds while one ran, and at each of their messages)
test("out of sight, the agents' list waits for its timer and the feed's words, and is read once as the page shows", async () => {
  answer = () => ({ subagents: [{ id: "a1", chainId: "c1", status: "running", exchanges: [], progress: null }] });
  const { createSubagentStore } = await import("../src/ui/harness/lib/subagents.js");
  mock.timers.enable({ apis: ["setTimeout"] });
  const store = createSubagentStore();
  try {
    showPage();
    store.setChain("c1");
    await turns();
    const first = count("/subagents");
    assert.ok(first >= 1, "a chat opened reads its list at once");
    assert.equal(store.running().length, 1);
    hidePage();
    mock.timers.tick(5_000);
    for (let i = 0; i < 3; i++) feed.onmessage({ data: JSON.stringify({ type: "subagent", chainId: "c1", id: "a1" }) });
    mock.timers.tick(200);
    await turns();
    mock.timers.tick(5_000);
    await turns();
    assert.equal(count("/subagents"), first, "out of sight: nothing read");
    showPage();
    await turns();
    assert.equal(count("/subagents"), first + 1, "shown: read once");
  } finally {
    store.setChain(null);
    await turns();
    mock.timers.reset();
  }
});

// (fails before: yes — the lab of 11-17, Fable 5.2's review: a window kept hidden while a long turn ran held every row
// it drew with a shimmer or a fade, the document's timeline keeping each animation it started until a next frame that a
// hidden page never draws)
test("out of sight, the page starts no animation, and a new block comes without its fade; in sight again, they play", async () => {
  const { stillWhileHidden } = await import("../src/ui/harness/lib/page-shown.js");
  const page = fakeDoc();
  /** @type {Set<string>} */
  const marks = new Set();
  /** @type {any} */ (page.doc).documentElement = { toggleAttribute: (/** @type {string} */ n, /** @type {boolean} */ on) => void (on ? marks.add(n) : marks.delete(n)) };
  stillWhileHidden(/** @type {any} */ (page.doc));
  assert.deepEqual([...marks], [], "in sight: moving");
  page.hide();
  page.fire();
  assert.deepEqual([...marks], ["data-out-of-sight"], "out of sight: still");
  page.show();
  assert.deepEqual([...marks], [], "in sight again");
  const css = readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8");
  assert.match(css, /\[data-out-of-sight\] \*, \[data-out-of-sight\] \*::before, \[data-out-of-sight\] \*::after \{ animation: none !important; transition: none !important; \}/);
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  assert.match(app, /async function boot\(\) \{\s+(sayCrash\(\);\s+)?stillWhileHidden\(\);/, "the page heard from its start, after the word of a crash");
  const timeline = readFileSync(new URL("../src/ui/harness/conversation/timeline.js", import.meta.url), "utf8");
  assert.match(timeline, /function arriveOnce\(el\) \{\s+if \(!pageShown\(\)\) return;\s+el\.classList\.add\("arrive"\);/, "a block drawn out of sight: no fade held for the page's return");
  assert.match(timeline, /el\.addEventListener\("animationcancel", done\);/, "a fade the page's hiding stopped leaves its class");
});
