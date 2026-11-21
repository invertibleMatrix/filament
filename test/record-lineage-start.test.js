// @ts-check
// HarnessV3-Responsiveness, found on the test drive (2026-10-01): the dashboard's Home badge read "3 live" for one turn
// with one sub-agent. The route stage named a record's parent (agentOf, subagentOf, …) AFTER usage.start had put the
// record on the bus, so the start event said "a client call, no parent" — and the dashboard keeps that snapshot until
// the record's next event, which a loop's parent record (a turn, a sub-agent) does not send until it ends. The
// lineage now goes into the start itself; the source (agent-tick, subagent) comes out right from the first event.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, fakeUpstream } from "./helpers/app.js";
import { houseAuth, houseKey } from "../src/services/house.js";
import { UsageStore } from "../src/services/records.js";

/** @type {any} */
let up;
/** @type {any} */
let shim;
before(async () => {
  up = await fakeUpstream();
  shim = await startApp({
    configure: (cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
      cfg.routes = [{ match: "big-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
    },
  });
});
after(async () => {
  await shim?.stop();
  await up?.close();
});

/** The record the bus announced at `start` for one house call carrying `lineage`. @param {Record<string, string>} lineage */
async function startedWith(lineage) {
  /** @type {any[]} */
  const starts = [];
  const on = (/** @type {any} */ e) => { if (e.type === "start") starts.push(e.record); };
  shim.app.usage.on("event", on);
  try {
    const r = await shim.post("/v1/messages", { model: "big-one", max_tokens: 5, messages: [{ role: "user", content: "hi" }] }, { ...houseAuth(), authorization: `Bearer ${houseKey()}`, ...lineage });
    await r.text();
  } finally {
    shim.app.usage.off("event", on);
  }
  assert.equal(starts.length, 1, "one record started");
  return starts[0];
}

// (fails before: the start event had no agentOf and read as a client call)
test("a loop's model call is announced with its turn and as a tick, from the start", async () => {
  const rec = await startedWith({ "x-filament-agent-of": "turn-1", "x-filament-cwd": "/work/demo" });
  assert.equal(rec.agentOf, "turn-1");
  assert.equal(rec.source, "agent-tick");
  assert.equal(rec.cwd, "/work/demo");
});

test("a sub-agent is announced with the turn that launched it, from the start", async () => {
  const rec = await startedWith({ "x-filament-subagent-of": "turn-2", "x-filament-subagent": "explore" });
  assert.equal(rec.subagentOf, "turn-2");
  assert.equal(rec.subagent, "explore");
  assert.equal(rec.source, "subagent");
});

test("a replay names what it replays at the start too; a plain call names none", async () => {
  const r = await startedWith({ "x-filament-replay-of": "rec-1" });
  assert.equal(r.replayOf, "rec-1");
  assert.equal(r.source, "replay");
  const plain = await startedWith({});
  for (const k of ["agentOf", "subagentOf", "replayOf", "subagent", "cwd"]) assert.equal(k in plain, false, `no ${k} key on a plain call`);
});

// (fails before: no — a guard the mutation pass asked for: the ring's order of eviction had no test)
test("a full ring drops a finished tick or sub-agent call before a client's request (W3.7)", () => {
  const store = new UsageStore({ dataDir: null, options: { keepLastRequests: 3, broadcast: false } });
  const ids = () => store.records.map((r) => r.id);
  const client = store.start({ model: "big-one" });
  store.finish(client, { status: "done" });
  const tick = store.start({ model: "big-one", agentOf: client.id });
  store.finish(tick, { status: "done" });
  const sub = store.start({ model: "big-one", subagentOf: client.id });
  store.finish(sub, { status: "done" });
  const next = store.start({ model: "big-one" });
  assert.deepEqual(ids(), [client.id, sub.id, next.id], "the tick went first");
  const last = store.start({ model: "big-one" });
  assert.deepEqual(ids(), [client.id, next.id, last.id], "then the sub-agent's call; the client's request stayed");
});

// (fails before: yes — the owner's chat on GLM 5.3 of 11-11: a full ring of client requests dropped each of the running
// turn's ticks as the next request started, so its cache card said "Not cached" over a request that read 97% from the
// cache, and the turn's end lost its recalls, its list price and where its context ended)
test("a full ring keeps the finished ticks and sub-agent calls of a turn still running; once it ends they go first again", () => {
  const store = new UsageStore({ dataDir: null, options: { keepLastRequests: 3, broadcast: false } });
  const ids = () => store.records.map((r) => r.id);
  const old = store.start({ model: "big-one" });
  store.finish(old, { status: "done" });
  const turn = store.start({ model: "big-one" });
  const tick = store.start({ model: "big-one", agentOf: turn.id });
  store.finish(tick, { status: "done" });
  const sub = store.start({ model: "big-one", subagentOf: turn.id });
  store.finish(sub, { status: "done" });
  assert.deepEqual(ids(), [turn.id, tick.id, sub.id], "a client's finished request went before the running turn's tick");
  const other = store.start({ model: "big-one" });
  assert.deepEqual(ids(), [turn.id, tick.id, sub.id, other.id], "the running turn's calls stay past the ring's size");
  assert.equal(store.byId.get(tick.id)?.status, "done", "its tick is still read by id");
  store.finish(turn, { status: "done" });
  store.finish(other, { status: "done" });
  const next = store.start({ model: "big-one" });
  assert.deepEqual(ids(), [turn.id, other.id, next.id], "the ended turn's tick and sub-agent call went first, the ring back to its size");
});

// (fails before: no — a guard the mutation pass asked for: no sub-agent call without the session's chain was in a test)
test("a session's records reach a sub-agent's calls by their lineage, where memory stayed out of them", () => {
  const store = new UsageStore({ dataDir: null, options: { broadcast: false } });
  const turn = store.start({ model: "big-one", memory: { chain: "c1", turnId: 1 } });
  const sub = store.start({ model: "big-one", subagentOf: turn.id });
  const subTick = store.start({ model: "big-one", agentOf: sub.id });
  store.start({ model: "big-one", memory: { chain: "c2", turnId: 1 } });
  assert.deepEqual(new Set(store.forChain("c1").records.map((r) => r.id)), new Set([turn.id, sub.id, subTick.id]));
});
