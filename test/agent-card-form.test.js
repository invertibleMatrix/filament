// @ts-check
// A launched agent's card whose turn stopped hearing of it takes its end from the chat's list (lib/subagents.js
// `endFromList`), and the list carries each answer as a head (subagents.js `publicOf` `head`; the owner's of 11-17: the
// list carried each exchange's words to 4,000 characters, 2.28 of its 2.48 MB, read again at each move of an agent).
// Where the list cut the answer, the card reads its agent's cards' form (GET …/subagents/:sid?card=1) and shows that, cut
// as the list cut it before: the head stands while it is read, and where it could not be. The store holds what it read
// for the chat, asks an agent's once after each read of the list, and Find waits for those on their way, drawn.
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { cut } from "../src/core/text.js";
import { sessionRoutes } from "../src/http/admin/sessions.js";
import { createRouter } from "../src/http/router.js";
import { alignEvents } from "../src/ui/harness/lib/labels.js";

const g = /** @type {any} */ (globalThis);
const ADDED = ["EventSource", "addEventListener", "requestAnimationFrame", "cancelAnimationFrame"].filter((k) => !(k in g));
const had = { fetch: g.fetch };
/** The reads asked, each answered when the test says. @type {{ path: string, answer: (status: number, body: any) => void }[]} */
const reads = [];
/** @type {typeof import("../src/ui/harness/lib/subagents.js")} */
let mod;
/** @type {typeof import("../src/ui/harness/conversation/agent-card.js")} */
let card;
before(async () => {
  g.EventSource = class { close() {} };
  g.addEventListener ||= () => {};
  g.requestAnimationFrame = (/** @type {() => void} */ fn) => setImmediate(fn);
  g.cancelAnimationFrame = () => {};
  g.fetch = (/** @type {string} */ path) =>
    new Promise((resolve) => reads.push({ path, answer: (status, body) => resolve({ ok: status < 400, status, statusText: "busy", json: async () => body }) }));
  mod = await import("../src/ui/harness/lib/subagents.js");
  card = await import("../src/ui/harness/conversation/agent-card.js");
});
after(() => {
  for (const k of ADDED) delete g[k];
  g.fetch = had.fetch;
});
/** A few turns of the event loop. */
const turns = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};
/** The reads of agents' cards' form asked so far, taken off the queue in order. */
const formReads = () => reads.filter((r) => r.path.includes("?card=1"));
/** @param {{ path: string }} r */
const take = (r) => void reads.splice(reads.indexOf(/** @type {any} */ (r)), 1);

const at = 1_800_000_000_000;
const WHOLE = `The answer in full. ${"x".repeat(4400)}`;
/** The list's row of sa_1, its exchanges ended (`reportHead` where its answer was cut). @param {Record<string, any>[]} xs */
const rowOf = (xs) => /** @type {any} */ ({ id: "sa_1", status: "done", exchanges: xs.map((x, i) => ({ status: "done", startedAt: at + i, endedAt: at + i + 42_000, ms: 42_000, rounds: 3, tokensIn: 900, tokensOut: 100, ...x })) });
const running = { state: "running", exchange: 0, agentId: "sa_1" };

// (fails before: yes — the list's own report was the card's, whatever it carried; no form was read)
test("an end the list carries as a head takes the agent's cards' form, cut as the list cut it: the head while it is read, and where it could not be; an end the list holds whole, as ever", () => {
  const head = rowOf([{ report: `${WHOLE.slice(0, 599)}…`, reportHead: true }]);
  /** @type {[string, number][]} */
  const asked = [];
  /** @param {any} said */
  const form = (said) => (/** @type {string} */ id, /** @type {number} */ n) => (asked.push([id, n]), said);
  const ended = { state: "done", status: "done", ms: 42_000, rounds: 3, tokens: 1000, error: undefined, failure: null, asking: null };
  assert.deepEqual(mod.endFromList(running, head, true, null, form(undefined)), { ...ended, report: head.exchanges[0].report, reportHead: true }, "while it is read: the head, said as the list says it");
  assert.deepEqual(mod.endFromList(running, head, true, null, form(null)), { ...ended, report: head.exchanges[0].report, reportHead: true }, "where it could not be: the head");
  const before = mod.endFromList(running, rowOf([{ report: cut(WHOLE, 4000) }]));
  assert.deepEqual(mod.endFromList(running, head, true, null, form({ status: "done", report: cut(WHOLE, 4000) })), before, "the cards' form: the end the list gave before its heads");
  assert.deepEqual(mod.endFromList(running, head, true, null, form({ status: "done", report: WHOLE })), before, "a host that answers it whole: cut as the server cuts a card's");
  assert.deepEqual(asked, [["sa_1", 0], ["sa_1", 0], ["sa_1", 0], ["sa_1", 0]]);
  assert.equal(mod.endFromList(running, head)?.reportHead, true, "no form to read (a card drawn outside the harness): the head");
  asked.length = 0;
  const whole = rowOf([{ report: "Found 3 callers." }]);
  assert.deepEqual(mod.endFromList(running, whole, true, null, form(undefined)), { ...ended, report: "Found 3 callers." }, "held whole: as before");
  assert.equal(mod.endFromList(running, rowOf([{ status: "running" }]), true, null, form(undefined)), null);
  assert.equal(mod.endFromList({ ...running, state: "done" }, head, true, null, form(undefined)), null, "the events told its end");
  assert.deepEqual(asked, [], "and nothing asked of any of them");
  const al = alignEvents([
    { type: "tool-start", round: 1, id: "a1", name: "agent", args: "Map the parser" },
    { type: "subagent-start", round: 1, parent: "a1", agentId: "sa_1", description: "Map the parser", agent: "scout", card: { tag: "scout", name: "Scout" }, model: "m", background: true, exchange: 0 },
    { type: "tool-end", round: 1, id: "a1", ok: true },
  ]);
  assert.deepEqual(
    [mod.listEndsKey(al, () => whole, true, null, form(undefined)), mod.listEndsKey(al, () => head, true, null, form(undefined)), mod.listEndsKey(al, () => head, true, null, form({ status: "done", report: "R" }))],
    ["sa_1:0:done", "sa_1:0:done:head", "sa_1:0:done"],
    "the turn's cards drawn again once more, head to whole, which keys as an end held whole always did",
  );
});

// (fails before: yes — the folded line was the list's words, a head)
test("a card you asked, whose answer the chat holds only as the list's head: its cards' form once read, cut as before; the head meanwhile; nothing asked of one held whole or still running", () => {
  /** @type {[string, number][]} */
  const asked = [];
  /** @param {any} said */
  const form = (said) => (/** @type {string} */ id, /** @type {number} */ n) => (asked.push([id, n]), said);
  const head = rowOf([{ report: "ok" }, { report: `${WHOLE.slice(0, 599)}…`, reportHead: true }]);
  const m = { exchange: 1, model: "m" };
  const state = (/** @type {any} */ row, /** @type {any} */ said) => card.cardState(m, null, { row, known: true, now: at, card: form(said) });
  assert.equal(state(head, undefined).text, head.exchanges[1].report, "the head while it is read");
  assert.equal(state(head, null).text, head.exchanges[1].report, "and where it could not be");
  assert.equal(state(head, { status: "done", report: WHOLE }).text, cut(WHOLE, 4000), "its cards' form, cut as the list cut it");
  assert.equal(state(head, { status: "done", report: WHOLE }).whole, false, "still no whole answer: opened, the card reads it as ever");
  assert.deepEqual(asked, [["sa_1", 1], ["sa_1", 1], ["sa_1", 1], ["sa_1", 1]]);
  asked.length = 0;
  state(rowOf([{ report: "ok" }, { report: "held whole" }]), undefined);
  state({ ...head, status: "running", exchanges: [head.exchanges[0], { status: "running", startedAt: at, endedAt: null }] }, undefined);
  assert.deepEqual(asked, []);
});

/**
 * The store let go once its last frame ran, and the clock given back.
 * @param {ReturnType<typeof mod.createSubagentStore>} store
 */
const letGo = async (store) => {
  store.setChain(null);
  await turns();
  mock.timers.reset();
};
/** The store on chat c1, its list answered. */
const storeOn = async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const store = mod.createSubagentStore();
  store.setChain("c1");
  reads.shift()?.answer(200, { subagents: [] });
  await turns();
  return store;
};
/** The list read again and answered. @param {ReturnType<typeof mod.createSubagentStore>} store */
const listAgain = async (store) => {
  void store.refresh();
  await turns();
  const r = reads.find((x) => !x.path.includes("?card=1"));
  assert.ok(r, "a list read");
  take(r);
  r.answer(200, { subagents: [] });
  await turns();
};

// (fails before: yes — the store read no agent's cards' form)
test("the store reads an agent's cards' form once, holds it for the chat, and its listeners hear it before Find does; an exchange it lacks is asked again only after the list is read again", async () => {
  const store = await storeOn();
  try {
    /** @type {string[]} */
    const heard = [];
    store.onChange(() => heard.push("listeners"));
    assert.equal(await store.cardsHeard(), false, "nothing on its way: at once");
    assert.equal(store.card("sa_1", 0), undefined, "being read");
    assert.equal(store.card("sa_1", 1), undefined);
    assert.deepEqual(formReads().map((r) => r.path), ["/api/sessions/c1/subagents/sa_1?card=1"], "one read for the agent");
    const waited = store.cardsHeard().then((was) => heard.push(`find ${was}`));
    const r = formReads()[0];
    take(r);
    r.answer(200, { subagent: { id: "sa_1", exchanges: [{ status: "done", report: "R0" }, { status: "running" }] } });
    await turns();
    await waited;
    assert.deepEqual(heard, ["listeners", "find true"], "the cards drew it before Find searches again");
    assert.equal(store.card("sa_1", 0)?.report, "R0");
    assert.equal(store.card("sa_1", 1), null, "an exchange the form read holds running: a miss, not another read");
    assert.equal(formReads().length, 0);
    await listAgain(store);
    assert.equal(store.card("sa_1", 1), undefined, "the list read again: asked again, as one that ended after");
    const again = formReads()[0];
    take(again);
    again.answer(200, { subagent: { id: "sa_1", exchanges: [{ status: "done", report: "R0" }, { status: "done", report: "R1" }] } });
    await turns();
    assert.deepEqual([store.card("sa_1", 0)?.report, store.card("sa_1", 1)?.report], ["R0", "R1"]);
    await listAgain(store);
    store.card("sa_1", 0);
    store.card("sa_1", 1);
    assert.equal(formReads().length, 0, "held for the chat: not read again");
    store.card("sa_4", 0);
    store.card("sa_5", 0);
    let found = false;
    void store.cardsHeard().then(() => void (found = true));
    const [four, five] = formReads();
    take(four);
    four.answer(200, { subagent: { id: "sa_4", exchanges: [{ status: "done", report: "R4" }] } });
    await turns();
    assert.equal(found, false, "Find waits for every read on its way");
    take(five);
    five.answer(200, { subagent: { id: "sa_5", exchanges: [{ status: "done", report: "R5" }] } });
    await turns();
    assert.equal(found, true);
    store.setChain("c2");
    store.setChain("c1");
    await turns();
    for (const x of reads.filter((y) => !y.path.includes("?card=1"))) {
      take(x);
      x.answer(200, { subagents: [] });
    }
    await turns();
    assert.equal(store.card("sa_1", 0), undefined, "a chat left and come back to: what it held was let go");
    take(formReads()[0]);
  } finally {
    await letGo(store);
  }
});

// (fails before: yes — no read to fail)
test("a read that fails keeps the head, is not asked again at each hearing, and is asked once the list is read again; a chat left drops what comes for it", async () => {
  const store = await storeOn();
  try {
    store.card("sa_2", 0);
    const r = formReads()[0];
    take(r);
    r.answer(500, { error: "busy" });
    await turns();
    assert.equal(store.card("sa_2", 0), null, "could not be read");
    store.card("sa_2", 0);
    assert.equal(formReads().length, 0, "not asked again before the list is");
    await listAgain(store);
    assert.equal(store.card("sa_2", 0), undefined, "asked again");
    take(formReads()[0]);
    store.card("sa_3", 0);
    const left = formReads()[0];
    store.setChain("c2");
    await turns();
    take(left);
    left.answer(200, { subagent: { id: "sa_3", exchanges: [{ status: "done", report: "c1's" }] } });
    await turns();
    const list = reads.find((x) => !x.path.includes("?card=1"));
    if (list) {
      take(list);
      list.answer(200, { subagents: [] });
    }
    await turns();
    assert.equal(store.card("sa_3", 0), undefined, "another chat's answer is not held: read anew");
    assert.equal(formReads().at(-1)?.path, "/api/sessions/c2/subagents/sa_3?card=1");
    for (const x of [...formReads()]) {
      take(x);
      x.answer(404, { error: "gone" });
    }
    await turns();
  } finally {
    await letGo(store);
  }
});

/** The detail route over a registry of one chat's agent. */
const detailRoute = () => {
  /** @type {string[]} */
  const asked = [];
  const sa = (/** @type {string} */ form) => ({ id: "sa_1", chainId: "c1", form });
  const subagents = { recall: (/** @type {string} */ c) => void asked.push(`recall ${c}`), get: (/** @type {string} */ id) => (asked.push(`get ${id}`), sa("card")), detail: (/** @type {string} */ id) => (asked.push(`detail ${id}`), sa("whole")) };
  const call = createRouter(sessionRoutes(/** @type {any} */ ({ memory: {}, usage: {}, ops: {}, sessions: {}, subagents, config: { get: () => ({}) } })));
  /** @param {string} path */
  const get = async (path) => {
    const url = new URL(`http://127.0.0.1${path}`);
    const m = call("GET", url.pathname);
    assert.ok(m, "the route has a row");
    let body = "";
    let status = 0;
    const res = { headersSent: false, writableEnded: false, setHeader() {}, getHeader() {}, writeHead: (/** @type {number} */ s) => void (status = s), write: (/** @type {string} */ c) => void (body += c), end: (/** @type {string} */ c = "") => void (body += c), on() {} };
    await m.handler(/** @type {any} */ ({ req: { headers: {}, method: "GET", socket: { remoteAddress: "127.0.0.1" }, on() {} }, res, url, path: url.pathname, method: "GET", params: m.params }), /** @type {any} */ ({}));
    return { status, body: JSON.parse(body) };
  };
  return { get, asked };
};

// (fails before: yes — the route answered one form, the whole)
test("the route: card=1 answers the cards' form, the detail its whole as before; each recalls the chat's threads, and another chat's agent is none", async () => {
  const { get, asked } = detailRoute();
  assert.deepEqual(await get("/sessions/c1/subagents/sa_1?card=1"), { status: 200, body: { subagent: { id: "sa_1", chainId: "c1", form: "card" } } });
  assert.deepEqual(await get("/sessions/c1/subagents/sa_1"), { status: 200, body: { subagent: { id: "sa_1", chainId: "c1", form: "whole" } } });
  assert.equal((await get("/sessions/c2/subagents/sa_1?card=1")).status, 404);
  assert.deepEqual(asked, ["recall c1", "get sa_1", "recall c1", "detail sa_1", "recall c2", "get sa_1"]);
});
