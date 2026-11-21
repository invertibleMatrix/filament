// @ts-check
// The open chat's agents' list when Filament cannot answer (the owner's logs of 11-01: the Agents tab stayed empty while
// Filament stalled). A read that failed was swallowed, and the list was read again only on a timer armed while an agent
// ran — none was known yet — or at the next agent's message: the tab showed nothing until something moved. Now a failed
// read is tried again in a moment. And with nothing running, work that waits for Apply keeps the list read on a slower
// timer: the server finds work brought into the folder another way only as the list is read.
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";

const g = /** @type {any} */ (globalThis);
const ADDED = ["EventSource", "addEventListener", "requestAnimationFrame", "cancelAnimationFrame"].filter((k) => !(k in g));
const had = { fetch: g.fetch };
/** The list reads asked, each answered when the test says. @type {{ path: string, answer: (status: number, body: any) => void }[]} */
const reads = [];
/** @type {typeof import("../src/ui/harness/lib/subagents.js")} */
let mod;
/** @type {typeof import("../src/ui/harness/lib/side.js")} */
let side;
before(async () => {
  g.EventSource = class { close() {} };
  g.addEventListener ||= () => {};
  g.requestAnimationFrame = (/** @type {() => void} */ fn) => setImmediate(fn);
  g.cancelAnimationFrame = () => {};
  g.fetch = (/** @type {string} */ path) =>
    new Promise((resolve) => reads.push({ path, answer: (status, body) => resolve({ ok: status < 400, status, statusText: "busy", json: async () => body }) }));
  mod = await import("../src/ui/harness/lib/subagents.js");
  side = await import("../src/ui/harness/lib/side.js");
});
after(() => {
  for (const k of ADDED) delete g[k];
  g.fetch = had.fetch;
});
/** A few turns of the event loop: the clock is the test's. */
const turns = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};
/**
 * The store let go, and the clock given back once its last frame ran: that frame clears its own timer, and cleared after
 * the clock went back it would cancel a timer of the next test's clock.
 * @param {ReturnType<typeof mod.createSubagentStore>} store
 */
const letGo = async (store) => {
  store.setChain(null);
  await turns();
  mock.timers.reset();
};

// (fails before: yes — the failed read was the last: nothing read the list again)
test("a read of the list that fails is tried again in a moment, and the list stands once it answers", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const store = mod.createSubagentStore();
  try {
    store.setChain("c1");
    assert.equal(reads.length, 1, "read at once");
    reads.shift()?.answer(503, { error: "busy" });
    await turns();
    assert.equal(store.known(), false);
    assert.equal(reads.length, 0, "not at once again");
    mock.timers.tick(5_000);
    await turns();
    assert.equal(reads.length, 1, "read again a moment later");
    reads.shift()?.answer(200, { subagents: [{ id: "sa_1", chainId: "c1", status: "done", exchanges: [] }] });
    await turns();
    assert.equal(store.known(), true);
    assert.deepEqual(store.rows().map((r) => r.id), ["sa_1"]);
    mock.timers.tick(60_000);
    await turns();
    assert.equal(reads.length, 0, "answered, with nothing running, it rests");
  } finally {
    await letGo(store);
  }
});

/** A finished sub-agent whose two files wait for Apply, or, `found`, the server's word once it found them in the folder. @param {boolean} found */
const helper = (found) => ({
  id: "sa_1",
  chainId: "c1",
  status: "done",
  exchanges: [],
  work: found
    ? { pending: 0, added: 0, removed: 0, applied: 1, open: false, files: [], lastApplied: { at: 1, files: 2, by: "found", hand: true, undo: true } }
    : { pending: 2, added: 2, removed: 1, applied: 0, open: false, files: [{ path: "a.txt", status: "M", added: 1, removed: 1, binary: false }, { path: "c.txt", status: "A", added: 1, removed: 0, binary: false }] },
});
/** The store's groups, by id and their rows'. @param {ReturnType<typeof mod.createSubagentStore>} store */
const groups = (store) => side.sideGroups(store.rows(), store.own()).map((x) => [x.id, x.rows.map((r) => r.id)]);

// (fails before: yes — with nothing running the list was read no more: work brought into the folder with git, which the
// server finds only as the list is read, stayed under Needs you until something else read it)
test("work that waits for Apply with nothing running keeps the list read on a slower timer, and it rests once nothing waits", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const store = mod.createSubagentStore();
  try {
    store.setChain("c1");
    reads.shift()?.answer(200, { subagents: [helper(false)] });
    await turns();
    assert.deepEqual(groups(store), [["needs", ["sa_1"]]]);
    mock.timers.tick(5_000);
    await turns();
    assert.equal(reads.length, 0, "not at a running agent's pace");
    mock.timers.tick(25_000);
    await turns();
    assert.equal(reads.length, 1, "read again on the slower timer");
    reads.shift()?.answer(200, { subagents: [helper(true)] });
    await turns();
    assert.deepEqual(groups(store), [["done", ["sa_1"]]], "out of Needs you once the server found its work in the folder");
    mock.timers.tick(120_000);
    await turns();
    assert.equal(reads.length, 0, "nothing waits: it rests");
  } finally {
    await letGo(store);
  }
});
