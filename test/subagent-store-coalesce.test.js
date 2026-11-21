// @ts-check
// The open session's agents' list (lib/subagents.js createSubagentStore) while several agents run: each running agent's
// progress comes about twice a second on the events feed, and each sub-agent message asks for the list again. The
// listeners — the status, the agents' band, the widgets, the dock and every agent card drawn — hear the list moved once a
// frame, however often it moved before it, and the list is read once at a time, with one read at most waiting behind.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const g = /** @type {any} */ (globalThis);
const ADDED = ["EventSource", "addEventListener", "requestAnimationFrame", "cancelAnimationFrame"].filter((k) => !(k in g));
const had = { fetch: g.fetch };

/** The feed's stream, as the page opened it. @type {any} */
let feed = null;
/** The list reads asked, each answered when the test says. @type {{ path: string, answer: (body: any) => void }[]} */
const reads = [];
/** The frames asked for, run when the test says. @type {(() => void)[]} */
const frames = [];
/** @type {typeof import("../src/ui/harness/lib/subagents.js")} */
let mod;

before(async () => {
  g.EventSource = class {
    /** @param {string} url */
    constructor(url) {
      this.url = url;
      /** @type {((e: { data: string }) => void) | null} */
      this.onmessage = null;
      feed = this;
    }
    close() {}
  };
  g.addEventListener ||= () => {};
  g.requestAnimationFrame = (/** @type {() => void} */ fn) => frames.push(fn);
  g.cancelAnimationFrame = () => {};
  g.fetch = (/** @type {string} */ path) =>
    new Promise((resolve) => reads.push({ path, answer: (body) => resolve({ ok: true, status: 200, json: async () => body }) }));
  mod = await import("../src/ui/harness/lib/subagents.js");
});
after(() => {
  for (const k of ADDED) delete g[k];
  g.fetch = had.fetch;
});

/** A message on the events feed. @param {any} msg */
const say = (msg) => feed.onmessage({ data: JSON.stringify(msg) });
/** Every frame asked for so far, run. */
const runFrames = () => {
  for (const fn of frames.splice(0)) fn();
};
/** Let the answers' promises settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));
const ROW = (/** @type {string} */ id) => ({ id, chainId: "c1", status: "running", exchanges: [], progress: null });

// (fails before: yes — each progress message ran every listener at once: five messages, five repaints of the page)
test("the listeners hear the list moved once a frame, reading it as it stands then", async () => {
  const store = mod.createSubagentStore();
  let heard = 0;
  /** @type {any[]} */
  const seen = [];
  store.onChange(() => {
    heard++;
    seen.push(store.row("a1")?.progress);
  });
  store.setChain("c1");
  assert.equal(reads.length, 1, "the list is read for the session followed");
  reads.shift()?.answer({ subagents: [ROW("a1"), ROW("a2")] });
  await settle();
  runFrames();
  heard = 0;
  seen.length = 0;
  for (let i = 1; i <= 5; i++) say({ type: "subagent-progress", chainId: "c1", id: i % 2 ? "a1" : "a2", progress: { round: i } });
  assert.equal(heard, 0, "nothing repaints before the frame");
  assert.equal(frames.length, 1, "five moves ask for one frame");
  runFrames();
  assert.equal(heard, 1, "one repaint for the five");
  assert.deepEqual(seen, [{ round: 5 }], "it reads the newest progress");
  // A tab put away gets no frames: the listeners hear within a beat all the same.
  say({ type: "subagent-progress", chainId: "c1", id: "a1", progress: { round: 6 } });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(heard, 2, "heard with no frame");
  assert.deepEqual(seen.at(-1), { round: 6 });
  frames.length = 0;
  store.setChain(null);
  runFrames();
});

// (fails before: yes — there was nothing to share: every agent card drawn read the chat's marks and pictures for itself,
// each looking through every turn of the chat, as often as the list moved)
test("what the listeners of one hearing read of the chat is read once for all of them; outside a hearing, each time", async () => {
  const store = mod.createSubagentStore();
  let made = 0;
  const make = () => ++made;
  const got = [];
  for (let i = 0; i < 20; i++) store.onChange(() => got.push(store.shared("marks", make)));
  store.touch();
  runFrames();
  assert.deepEqual([made, new Set(got).size, got.length], [1, 1, 20], "twenty cards, one reading");
  store.touch();
  runFrames();
  assert.equal(made, 2, "the next hearing reads afresh");
  store.shared("marks", make);
  store.shared("marks", make);
  assert.equal(made, 4, "outside a hearing it is made each time");
  // The index the cards read: the same marks and pictures as each card's own look through the turns.
  const { cardMarksKept } = await import("../src/ui/harness/lib/agent-cards.js");
  const d0 = { type: "subagent", event: "dispatch", asked: true, agentId: "sa_1", exchange: 0 };
  const a0 = { type: "subagent", event: "arrival", asked: true, agentId: "sa_1", exchange: 0 };
  const d1 = { type: "subagent", event: "dispatch", asked: true, agentId: "sa_1", exchange: 1 };
  const chat = { asked: [d0], turns: [{ boundaries: [{ type: "settings" }, { ...d1, asked: false }], boundariesAfter: [a0] }, { boundaries: [d1], boundariesAfter: [] }] };
  const marks = cardMarksKept(chat);
  assert.deepEqual([marks("sa_1", 0), marks("sa_1", 1), marks("sa_2", 0)], [{ dispatch: d0, arrival: a0 }, { dispatch: d1 }, {}]);
  const kept = mod.drewKept({ turns: [{ n: 0, visuals: [{ by: "sa_1", id: "x" }] }, { n: 2, visuals: [{ by: "sa_1", id: "a", title: "A", bytes: 3 }, { by: "sa_2", id: "b" }] }], visuals: [{ by: "sa_1", id: "s", exchange: 0 }] });
  assert.deepEqual(kept("sa_1", 0), [{ id: "a", title: "A", bytes: 3, turn: 2 }, { id: "s", title: "", bytes: 0, session: true }]);
  assert.deepEqual(kept("sa_3", 0), []);
});

// (fails before: yes — every ask read the list again, each read beside the ones on their way: four asks, four reads)
test("one read of the list at a time, and one at most behind it, which every ask meanwhile shares and waits for", async () => {
  const store = mod.createSubagentStore();
  reads.length = 0;
  store.setChain("c2");
  assert.equal(reads.length, 1);
  const asks = [store.refresh(), store.refresh(), store.refresh()];
  assert.equal(reads.length, 1, "asked while a read is on its way: none goes out beside it");
  let waited = 0;
  for (const a of asks) a.then(() => waited++);
  reads.shift()?.answer({ subagents: [ROW("b1")] });
  await settle();
  assert.equal(reads.length, 1, "the asks meanwhile read it once more, together");
  assert.equal(waited, 0, "whoever asked waits for a read that started after the ask");
  reads.shift()?.answer({ subagents: [ROW("b1"), ROW("b2")] });
  await settle();
  assert.equal(waited, 3);
  assert.deepEqual(store.rows().map((r) => r.id), ["b1", "b2"]);
  assert.equal(reads.length, 0, "nothing else was read");
  // Another session followed while a read is on its way: its list is read at once, not behind the one it left.
  store.refresh();
  assert.equal(reads.length, 1);
  store.setChain("c3");
  assert.equal(reads.length, 2, "the new session's read went out at once");
  assert.match(reads[1].path, /\/sessions\/c3\/subagents\?heads=1$/);
  reads.shift()?.answer({ subagents: [ROW("old")] });
  reads.shift()?.answer({ subagents: [ROW("c1")] });
  await settle();
  assert.deepEqual(store.rows().map((r) => r.id), ["c1"], "the session left's answer is dropped");
  store.setChain(null);
  runFrames();
});
