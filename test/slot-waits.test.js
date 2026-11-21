// @ts-check
// HarnessV3-AtHome AH-F5 (2026-10-04): the spin's turn died queued behind Filament's own background work. A 429 that
// said kimi-cn was overloaded taught it a ceiling of one — counted from the capped lanes, and no lane was capped, so
// from nought — and the ceiling never lifted. The turn, two sub-agents and their compaction forks then took turns on
// one slot; a sub-agent's fork held it for 332 s, the turn's call waited its 120 s, and the wait was reported as
// kimi-cn unreachable, which cooled a healthy provider down. Now an overloaded 429 teaches nothing; a ceiling counts
// the calls really in flight and lifts ten minutes after the last 429 that taught it; Filament's own calls wait, the
// developer's turn ahead of background work, and say what they wait for. Since HarnessV3-FailurePoints §4 A no wait for
// a slot has a deadline — a client's call waited two minutes and failed over in words — and no internal call has a
// clock: the hang-up or a Stop ends a wait, and the provider's answer or failure a call.
import { test, describe, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HealthBoard, ConcurrencyGate } from "../src/services/health.js";
import * as attempt from "../src/app/pipeline/dispatch/attempt.js";
import { judgeReply } from "../src/app/pipeline/dispatch/verdict.js";
import { TRAFFIC_SOURCES } from "../src/core/schema.js";
import { createInternalCall } from "../src/app/internal-call.js";
import { alignEvents, turnStateWords } from "../src/ui/harness/lib/labels.js";
import { PROMPT } from "../src/app/agent/prompt.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until, gate } from "./helpers/wait.js";

const TEN_MIN = 600_000;
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
/** A turn-state event that says the call waits for a slot. @param {any} e */
const isQueueWait = (e) => e?.type === "turn-state" && e.to === "waiting" && !!e.queue;
/** Real time passing, a few event-loop turns at a time: the sockets' work, while the test's clock is mocked. @param {number} ms */
const breathe = async (ms) => {
  const end = performance.now() + ms;
  while (performance.now() < end) await new Promise((r) => setImmediate(r));
};

describe("what a 429 teaches, and for how long", () => {
  // (fails before: yes — the review of 11-05: an agent's slot read the lower of a 429's and the headers', a minute's
  // requests, and a hold kept under the name as sent was missed under its row's spelling)
  test("what an agent's slot holds to: a 429's alone, whatever the headers say and whatever the name's case; none once it cuts nothing", () => {
    const b = new HealthBoard();
    const t0 = 5_000_000;
    b.recordMeta("u", { "x-ratelimit-limit-requests": "4", "x-ratelimit-remaining-requests": "3" });
    assert.equal(b.learnedCeiling("u", "m-1", t0), null, "the headers' says nothing of agents");
    assert.equal(b.note429("u", "M-1", 8, t0), 7);
    b.recordMeta("u", { "x-ratelimit-limit-requests": "2", "x-ratelimit-remaining-requests": "1" });
    assert.deepEqual(b.observedCeiling("u", "M-1", t0 + 1000), { cap: 2, from: "headers" }, "a call holds to the lower");
    assert.deepEqual(b.learnedCeiling("u", "m-1", t0 + 1000), { cap: 7, from: "429", at: t0, liftsAt: t0 + TEN_MIN }, "an agent to the 429's, in any case");
    // Refused at the same number after its lift: confirmed, with how often and since when.
    assert.equal(b.note429("u", "M-1", 8, t0 + TEN_MIN + 1000), 7);
    const c = /** @type {any} */ (b.learnedCeiling("u", "m-1", t0 + TEN_MIN + 2000));
    assert.deepEqual([c.cap, c.from, c.takes, c.times, c.since, c.probing], [7, "429", 7, 2, t0, false]);
    // One refusal, past its lift: remembered, cutting nothing.
    const once = new HealthBoard();
    once.note429("u", "m", 3, t0);
    assert.equal(once.learnedCeiling("u", "m", t0 + TEN_MIN + 1000), null);
  });

  // (fails before: yes — the review of 11-05: of holds kept under two spellings of one name, the one spelled as asked
  // won, though the other held lower)
  test("holds under two spellings of one model: an agent's slot holds to the lowest that holds, whichever spelling asks", () => {
    const b = new HealthBoard();
    const t0 = 5_000_000;
    assert.equal(b.note429("u", "M-1", 4, t0), 3);
    assert.equal(b.note429("u", "m-1", 8, t0 + 1000), 7);
    const at = (/** @type {number} */ now) => ["M-1", "m-1"].map((x) => b.learnedCeiling("u", x, now)?.cap ?? null);
    assert.deepEqual(at(t0 + 2000), [3, 3], "the lowest");
    assert.deepEqual(at(t0 + TEN_MIN + 500), [7, 7], "the lower lifted: the other, which still holds");
    assert.deepEqual(at(t0 + 1000 + TEN_MIN + 500), [null, null], "both lifted: none");
  });

  // (fails before: yes — note429 counted the capped lanes, and in the spin none was capped: it learned 1 from 0)
  test("the spin's ceiling: three calls in flight and a 429 → at most two; a tighter 429 lowers it, a looser one does not raise it while it holds", () => {
    const b = new HealthBoard();
    const t0 = 5_000_000;
    assert.equal(b.note429("u", "m", 3, t0), 2);
    assert.deepEqual(b.observedCeiling("u", "m", t0 + 1000), { cap: 2, from: "429", at: t0, liftsAt: t0 + TEN_MIN });
    assert.equal(b.note429("u", "m", 2, t0 + 2000), 1, "a tighter 429 lowers it");
    assert.equal(b.note429("u", "m", 8, t0 + 3000), 1, "a looser one does not raise it");
    b.recordMeta("u", { "x-ratelimit-limit-requests": "4", "x-ratelimit-remaining-requests": "3" });
    assert.deepEqual(b.observedCeiling("u", "m", t0 + 4000), { cap: 1, from: "429", at: t0 + 3000, liftsAt: t0 + 3000 + TEN_MIN }, "the lower of the 429's and the headers'");
    b.recordSuccess("u");
    assert.equal(b.observedCeiling("u", "m", t0 + 5000)?.cap, 1, "an answer does not lift it");
    b.reset("u");
    assert.deepEqual(b.observedCeiling("u", "m", t0 + 6000), { cap: 4, from: "headers" }, "Reset forgets the 429's at once; the headers' stays");
  });

  // (fails before: yes — a 429 counted every model's calls at the provider and capped each model with that number:
  // seven agents on two models of one key and a note-taking call drew a 429, and both models were held to seven)
  test("a 429 teaches the model it refused, and another model at the same provider keeps its lane", () => {
    const b = new HealthBoard();
    const t0 = 5_000_000;
    assert.equal(b.note429("zai", "flash", 4, t0), 3, "four of its calls in flight: at most three");
    assert.deepEqual(b.observedCeiling("zai", "flash", t0 + 1000), { cap: 3, from: "429", at: t0, liftsAt: t0 + TEN_MIN });
    assert.equal(b.observedCeiling("zai", "glm", t0 + 1000), null, "the other model was refused nothing");
    assert.equal(b.observedCeiling("elsewhere", "flash", t0 + 1000), null, "nor was the same model at another provider");
    assert.equal(b.note429("zai", "glm", 6, t0 + 60_000), 5, "its own 429 teaches its own number");
    assert.equal(b.observedCeiling("zai", "flash", t0 + 61_000)?.cap, 3, "and leaves the first model's as it was");
    assert.deepEqual(
      b.snapshot(t0 + 120_000).zai.ceilings,
      [{ model: "flash", cap: 3, liftsInMs: TEN_MIN - 120_000 }, { model: "glm", cap: 5, liftsInMs: TEN_MIN - 60_000 }],
      "the health table lists each model's, with when it lifts",
    );
    assert.deepEqual(b.snapshot(t0 + TEN_MIN + 1000).zai.ceilings, [{ model: "glm", cap: 5, liftsInMs: 59_000 }], "one lifts while the other holds");
    b.reset("zai");
    assert.deepEqual(b.snapshot(t0 + TEN_MIN + 2000).zai.ceilings, [], "Reset forgets every model's");
  });

  // (fails before: yes — a learned ceiling never lifted: the spin's held for the rest of the session)
  test("a learned ceiling lifts ten minutes after the last 429 that taught it, and a 429 after the lift is learned anew", () => {
    const b = new HealthBoard();
    const t0 = 5_000_000;
    b.note429("u", "m", 3, t0);
    assert.equal(b.note429("u", "m", 5, t0 + 300_000), 2, "a 429 while it holds keeps it");
    assert.equal(b.observedCeiling("u", "m", t0 + TEN_MIN + 1000)?.cap, 2, "and holds it ten minutes from that 429");
    assert.equal(b.observedCeiling("u", "m", t0 + 300_000 + TEN_MIN), null, "then it lifts");
    assert.deepEqual(b.snapshot(t0 + 400_000).u.ceilings, [{ model: "m", cap: 2, liftsInMs: TEN_MIN - 100_000 }], "the health table says when it lifts");
    assert.deepEqual(b.snapshot(t0 + 300_000 + TEN_MIN).u.ceilings, [], "and shows no cap once it has");
    assert.equal(b.note429("u", "m", 5, t0 + 300_000 + TEN_MIN), 4, "a 429 after the lift learns anew");
  });
});

describe("the gate: every call in flight, the turn's ahead of background work", () => {
  const one = () => ({ cap: 1, liftsAt: null });
  const none = () => ({ cap: null, liftsAt: null });

  // (fails before: yes — one queue, first come first served: the background calls went first)
  test("background calls wait behind the rest: the turn's call takes the next slot, then the background ones in their order", async () => {
    const g = new ConcurrencyGate();
    const fork = { id: "rq_fork", what: "a sub-agent's compaction fork" };
    const first = await g.acquire("u", "m", one, { holder: fork });
    /** @type {string[]} */
    const order = [];
    /** @type {any[]} */
    const told = [];
    const take = (/** @type {string} */ name, /** @type {boolean} */ background) =>
      Promise.resolve(g.acquire("u", "m", one, { background, holder: { id: name, what: name }, onQueued: (holders) => told.push(holders) })).then((s) => {
        order.push(name);
        return s;
      });
    const bg1 = take("bg1", true);
    const bg2 = take("bg2", true);
    const fg = take("fg", false);
    assert.deepEqual(told, [[fork], [fork], [fork]], "each waiter hears what holds the slot");
    assert.deepEqual(g.holdersOf("u", "m"), [fork]);
    first.release();
    (await fg).release();
    (await bg1).release();
    (await bg2).release();
    assert.deepEqual(order, ["fg", "bg1", "bg2"]);
  });

  // (fails before: yes — a call with no cap never entered its lane: a ceiling learned while three calls ran let more in)
  test("every call holds its lane, capped or not: a ceiling learned while calls run counts them", async () => {
    const g = new ConcurrencyGate();
    const a = await g.acquire("u", "m", none, { holder: { id: "rq_a", what: "a" } });
    const b = await g.acquire("u", "m", none, { holder: { id: "rq_b", what: "b" } });
    const c = await g.acquire("u", "other", none, {});
    assert.equal(g.inflightAt("u"), 3, "every model's calls at the upstream");
    assert.equal(g.inflightAt("u", "m"), 2, "and one model's alone, which is what a 429 on it counts");
    assert.equal(g.inflightAt("u", "idle"), 0);
    assert.deepEqual(g.holdersOf("u", "m"), [{ id: "rq_a", what: "a" }, { id: "rq_b", what: "b" }]);
    let got = false;
    const late = Promise.resolve(g.acquire("u", "m", one, {})).then((s) => {
      got = true;
      return s;
    });
    a.release();
    await sleep(20);
    assert.equal(got, false, "one call still runs: the ceiling of one is full");
    b.release();
    (await late).release();
    c.release();
    assert.equal(g.inflightAt("u"), 0);
  });

  // (fails before: yes — the cap was fixed when the call queued: nothing let a waiter go when a ceiling lifted)
  test("a call waiting under a learned ceiling goes when the ceiling lifts", async () => {
    const g = new ConcurrencyGate();
    const liftsAt = Date.now() + 300;
    const learned = () => (Date.now() < liftsAt ? { cap: 1, liftsAt } : { cap: null, liftsAt: null });
    const held = await g.acquire("u", "m", learned, {});
    const t0 = Date.now();
    const next = await g.acquire("u", "m", learned, {});
    assert.equal(next.queued, true);
    assert.ok(Date.now() - t0 >= 250, `it waited for the lift (${Date.now() - t0} ms)`);
    next.release();
    held.release();
  });
});

describe("one attempt's slot", () => {
  // A price card's maxConcurrency caps nothing (the owner's word of 10-19), and since 11-05 neither does a model's agent
  // limit (agentLoop.subagents.slots): only what the provider showed caps a call.
  const UP = { id: "up", pricing: { m1: { maxConcurrency: 9 } } };
  /** @param {number} n */
  const slotsAt = (n) => ({ agentLoop: { subagents: { slots: [{ upstream: "up", model: "m1", n }] } } });
  /**
   * A request's context for one attempt: a client's, or Filament's own (`house`) with the headers it was admitted with.
   * @param {{ house?: boolean, headers?: Record<string, string>, rec?: any }} [o]
   */
  const ctxFor = ({ house = false, headers = {}, rec = { id: "rq_client" } } = {}) =>
    /** @type {any} */ ({
      format: "anthropic",
      body: { model: "m1", messages: [] },
      raw: "{}",
      pre: null,
      headers,
      requested: { base: "m1" },
      route: { match: "m1" },
      rec,
      house,
      client: { abort: new AbortController() },
      flags: { bodiesAllowed: false },
      res: { headersSent: false },
      candidates: [{ upstream: "up" }, { upstream: "next" }],
      failover: true,
    });
  /** @param {any} concurrency */
  const depsWith = (concurrency) =>
    /** @type {any} */ ({
      config: () => ({ observability: { storeBodies: "none", maxStoredBodyBytes: 0 }, ...slotsAt(1) }),
      log: () => {},
      health: new HealthBoard(),
      concurrency,
      plan: () => ({ upstream: UP, shaped: { body: { model: "m1" }, changes: [] }, headers: {}, url: "http://up.invalid/v1/messages" }),
      destination: () => ({
        answers: {
          open: async () => ({ res: new Response("{}"), cleanup() {} }),
          unreachable: (/** @type {any} */ e) => ({ message: `upstream up unreachable: ${e.message}`, retryable: true }),
        },
      }),
      finish: () => {},
    });

  // (fails before: yes — every call waited 120 s at most, first come first served, and named nothing)
  test("every call waits for its slot without a deadline — behind the rest when it is a sub-agent's — and names itself as a holder", async () => {
    /** @type {any[]} */
    const asked = [];
    const free = { inflightAt: () => 0, acquire: (/** @type {string} */ _u, /** @type {string} */ _m, /** @type {any} */ _c, /** @type {any} */ o) => (asked.push(o), { release() {}, waitedMs: 0, queued: false }) };
    const calls = [
      ctxFor({ house: true, rec: { id: "rq_round", agentOf: "rq_turn" } }),
      ctxFor({ house: true, headers: { "x-filament-background": "1" }, rec: { id: "rq_sub", agentOf: "rq_subrun" } }),
      ctxFor({ house: true, headers: { "x-filament-background": "1" }, rec: { id: "rq_fork", forkFor: "compaction", subagentOf: "owner" } }),
      ctxFor({ rec: { id: "rq_client" } }),
    ];
    for (const ctx of calls) assert.ok("fw" in (await attempt.createAttempt(ctx, depsWith(free), { candidate: { upstream: "up" }, index: 0 })(null)));
    assert.deepEqual(
      asked.map((o) => [o.timeoutMs, o.background, o.holder]),
      [
        [undefined, false, { id: "rq_round", what: "a turn's model call" }],
        [undefined, true, { id: "rq_sub", what: "a sub-agent's model call" }],
        [undefined, true, { id: "rq_fork", what: "a sub-agent's compaction fork" }],
        [undefined, false, { id: "rq_client", what: "a request from your tools" }],
      ],
    );
  });

  // (fails before: yes — a model's agent limit capped every call to it too, the main agent's and your tools'; the
  // owner's word of 11-05: that number counts agents only)
  test("a model's agent limit caps no call: the ceiling in force is the one a 429 taught, and a call that runs under it says so on its record", async () => {
    /** @type {any[]} */
    const asked = [];
    const free = { inflightAt: () => 0, acquire: (/** @type {string} */ _u, /** @type {string} */ _m, /** @type {any} */ ceiling) => (asked.push(ceiling()), { release() {}, waitedMs: 0, queued: false }) };
    /** @param {number} n */
    const depsAt = (n) => ({ ...depsWith(free), config: () => ({ observability: { storeBodies: "none", maxStoredBodyBytes: 0 }, ...slotsAt(n) }) });
    const learnedAt = Date.now() - 60_000;
    /** The concurrency lines on the record of one call that ran at once. @param {any} deps */
    const run = async (deps) => {
      const ctx = ctxFor();
      assert.ok("fw" in (await attempt.createAttempt(ctx, deps, { candidate: { upstream: "up" }, index: 0 })(null)));
      return ctx.rec.changes?.filter((/** @type {string} */ c) => c.startsWith("concurrency:")) || [];
    };
    const set = depsAt(1);
    assert.deepEqual(await run(set), [], "a number set says nothing on a call");
    assert.deepEqual(asked.at(-1), { cap: null, liftsAt: null }, "the 1 set caps no call");
    set.health.note429("up", "m1", 3, learnedAt);
    assert.deepEqual(await run(set), ["concurrency: m1 runs 2 calls at a time at up (learned from a 429 60 s ago; it lifts in 9 min)"]);
    assert.deepEqual(asked.at(-1), { cap: 2, liftsAt: learnedAt + TEN_MIN }, "the 429's 2, though 1 is set, and when it lifts");
  });

  // (fails before: yes — no call named what held its slot)
  test("every source Traffic knows has its words as what holds a slot", () => {
    for (const source of Object.keys(TRAFFIC_SOURCES)) assert.ok(attempt.HOLDER_WORDS?.[source], source);
  });
});

// (fails before: yes — a wait for a slot read "waiting for its sub-agents")
test("the page draws a wait for a slot in the turn's live words", () => {
  const why = "waiting for a slot: k3 runs 1 call at a time at kimi-cn (learned from a 429 4 min ago; it lifts in 6 min), held by a sub-agent's compaction fork (rq_1)";
  const e = { type: "turn-state", from: "planning", to: "waiting", why, queue: { upstream: "kimi-cn", model: "k3", cap: 1, holders: [{ id: "rq_1", what: "a sub-agent's compaction fork" }] } };
  assert.equal(turnStateWords(e), why);
  assert.equal(turnStateWords(alignEvents([{ n: 1, ...e }]).turnState), why);
});

describe("through the front door", () => {
  /** @type {string} */
  let root;
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  /** The replies a test holds back: opened when it ends, so a failure leaves no call holding the next test's slot. @type {ReturnType<typeof gate>[]} */
  const holds = [];
  const holdReply = () => {
    const g = gate();
    holds.push(g);
    return g;
  };
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-slot-waits-"));
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "rate", name: "rate", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true },
          { id: "busy", name: "busy", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true },
          { id: "one", name: "one", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "one-model": { input: 1, output: 1 } } },
        ];
        cfg.routes = [
          { match: "rate-*", upstream: "rate", upstreamModel: "{model}", enabled: true },
          { match: "busy-*", upstream: "busy", upstreamModel: "{model}", enabled: true },
          { match: "one-*", upstream: "one", upstreamModel: "{model}", enabled: true },
        ];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "", subagents: {} };
      },
    });
    // One call at a time on one-model: as a 429 with two in flight teaches it, the only cap a call holds to.
    shim.app.health.note429("one", "one-model", 2);
  });
  afterEach(() => {
    for (const g of holds.splice(0)) g.open();
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(root);
  });
  const board = async () => (await (await shim.api("/api/usage/upstreams?hours=1")).json()).health;
  const ask = (/** @type {string} */ model, /** @type {string} */ content) => shim.post("/v1/messages", { model, max_tokens: 20, messages: [{ role: "user", content }] });

  // (fails before: yes — the board learned 1: it counted the capped lanes, and none was capped)
  test("three calls in flight and a 429 about the account's rate: the provider takes at most two at a time now", async () => {
    const hold = holdReply();
    let n = 0;
    brain = async (call) => {
      if (!String(call.body?.model).startsWith("rate-")) return undefined;
      if (++n <= 2) {
        await hold.promise;
        return anthropicReply("ok", { model: "rate-model" });
      }
      return { status: 429, json: { type: "error", error: { type: "rate_limit_error", message: "Number of requests has exceeded your per-minute rate limit" } } };
    };
    const first = [ask("rate-model", "a"), ask("rate-model", "b")];
    await until(() => n === 2, "two calls in flight at the provider");
    const third = await ask("rate-model", "c");
    assert.equal(third.status, 429);
    const rec = await shim.record(third.headers.get("x-filament-request-id"));
    hold.open();
    for (const r of await Promise.all(first)) assert.equal(r.status, 200, await r.text());
    const hb = (await board()).rate;
    assert.deepEqual(hb.ceilings.map((/** @type {any} */ c) => [c.model, c.cap]), [["rate-model", 2]]);
    assert.ok(hb.ceilings[0].liftsInMs > TEN_MIN - 60_000 && hb.ceilings[0].liftsInMs <= TEN_MIN, `it lifts in ${hb.ceilings[0].liftsInMs} ms`);
    assert.ok(rec.changes.includes("concurrency: rate answered 429 with 3 calls of rate-model in flight — rate-model runs at most 2 at a time there now, until ten minutes after its last 429"), rec.changes.join("\n"));
  });

  // (fails before: yes — the first test's ceiling of two held every model at this provider, so the third call of the
  // cool model waited for a slot and the five never ran together; and a 429 counted both models' calls)
  test("two models at one provider and a 429 on one: it runs one fewer than its own calls in flight, and the other keeps its lane", async () => {
    const hold = holdReply();
    let held = 0;
    brain = async (call) => {
      const model = String(call.body?.model);
      if (model !== "rate-cool" && model !== "rate-hot") return undefined;
      if (model === "rate-hot" && held >= 5) return { status: 429, json: { type: "error", error: { type: "rate_limit_error", message: "Number of requests has exceeded your per-minute rate limit" } } };
      held++;
      await hold.promise;
      return anthropicReply("ok", { model });
    };
    const first = [ask("rate-cool", "a"), ask("rate-cool", "b"), ask("rate-cool", "c"), ask("rate-hot", "d"), ask("rate-hot", "e")];
    await until(() => held === 5, "five calls in flight at the provider: three of one model, two of the other");
    const sixth = await ask("rate-hot", "f");
    assert.equal(sixth.status, 429);
    const rec = await shim.record(sixth.headers.get("x-filament-request-id"));
    hold.open();
    for (const r of await Promise.all(first)) assert.equal(r.status, 200, await r.text());
    const ceilings = (await board()).rate.ceilings.map((/** @type {any} */ c) => [c.model, c.cap]);
    assert.deepEqual(ceilings.filter((/** @type {any[]} */ c) => c[0] !== "rate-model"), [["rate-hot", 2]], "three of its calls in flight: two; the cool model learned nothing");
    assert.ok(rec.changes.includes("concurrency: rate answered 429 with 3 calls of rate-hot in flight — rate-hot runs at most 2 at a time there now, until ten minutes after its last 429"), rec.changes.join("\n"));
  });

  // (fails before: yes — an overloaded provider taught a ceiling of one: the spin's first step)
  test("a 429 that says the provider is overloaded teaches no ceiling", async () => {
    brain = (call) =>
      String(call.body?.model).startsWith("busy-") ? { status: 429, json: { type: "error", error: { type: "engine_overloaded_error", message: "The engine is currently overloaded, please try again later" } } } : undefined;
    const r = await ask("busy-model", "hi");
    assert.equal(r.status, 429);
    const rec = await shim.record(r.headers.get("x-filament-request-id"));
    assert.deepEqual((await board()).busy?.ceilings ?? [], []);
    assert.ok(rec.changes.includes("concurrency: busy is overloaded (HTTP 429) — busy for everyone, so it teaches no ceiling"), rec.changes.join("\n"));
  });

  // (fails before: no — first written for AH-F5, when the call's own bound ran while it waited and cut it in the queue;
  // with no bound (HarnessV3-FailurePoints §4 A) it guards the wait and its words)
  test("Filament's own call waits for its slot as long as it is held, and hears what holds it", async () => {
    const hold = holdReply();
    let n = 0;
    brain = async (call) => {
      if (!String(call.body?.model).startsWith("one-")) return undefined;
      if (++n === 1) await hold.promise;
      return anthropicReply(`answer ${n}`, { model: "one-model" });
    };
    const holder = ask("one-model", "hold the slot");
    await until(() => n === 1, "a client's call to hold the only slot");
    /** @type {any[]} */
    const news = [];
    const internal = createInternalCall({ config: () => ({ server: { port: shim.port } }), log: () => {} });
    const t0 = Date.now();
    const asked = internal({ body: { model: "one-model", max_tokens: 20, messages: [{ role: "user", content: "wait" }] }, onQueue: (q) => news.push(q) }).then(
      (r) => ({ r, e: null }),
      (/** @type {any} */ e) => ({ r: null, e }),
    );
    await sleep(1500); // all of it waiting for the slot
    hold.open();
    const { r, e } = await asked;
    assert.equal(e?.message ?? null, null, "the wait ended with the slot, and nothing else");
    assert.ok(r?.ok, JSON.stringify(r?.json));
    assert.ok(Date.now() - t0 >= 1500);
    const held = await holder;
    assert.equal(held.status, 200);
    const holderId = held.headers.get("x-filament-request-id");
    const [q, slot] = news;
    assert.match(q.words, /^waiting for a slot: one-model runs 1 call at a time at one \(learned from a 429 [^)]*\), held by a request from your tools \(/);
    assert.ok(q.words.endsWith(`(${holderId})`), q.words);
    assert.deepEqual([q.upstream, q.model, q.cap, q.holders], ["one", "one-model", 1, [{ id: holderId, what: "a request from your tools" }]]);
    assert.equal(slot, null, "and hears when the slot is its own");
    const rec = await shim.record(r?.id);
    assert.ok(rec.changes.some((/** @type {string} */ c) => /^concurrency: waited \d+ s for a slot: one-model runs 1 call at a time at one \(learned from a 429 [^)]*\), held by a request from your tools \(/.test(c)), rec.changes.join("\n"));
  });

  // (fails before: yes — an internal call had a bound, 600 s unless its caller set one: a provider that took longer was
  // cut, its answer lost — HarnessV3-FailurePoints §4 A)
  test("Filament's own call has no clock: an answer eleven minutes coming is waited for, and its caller's signal ends a call", async (t) => {
    /** @type {http.ServerResponse[]} */
    const held = [];
    let heard = () => {};
    const next = () => new Promise((r) => (heard = () => r(undefined)));
    // A front door that holds every call until the test answers it.
    const door = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        held.push(res);
        heard();
      });
    });
    await new Promise((r) => door.listen(0, "127.0.0.1", () => r(undefined)));
    const internal = createInternalCall({ config: () => ({ server: { port: /** @type {any} */ (door.address()).port } }), log: () => {} });
    t.mock.timers.enable({ apis: ["setTimeout"] });
    try {
      let came = next();
      let settled = false;
      const late = internal({ body: { model: "one-model", max_tokens: 20, messages: [{ role: "user", content: "take your time" }] } }).finally(() => (settled = true));
      await came;
      t.mock.timers.tick(11 * 60_000);
      await breathe(50);
      assert.equal(settled, false, "eleven minutes without an answer, still waited for");
      held[0].writeHead(200, { "content-type": "application/json", "x-filament-request-id": "rq_late" });
      held[0].end(JSON.stringify(anthropicReply("late but whole", { model: "one-model" }).json));
      const r = await late;
      assert.deepEqual([r.ok, r.id, r.json.content[0].text], [true, "rq_late", "late but whole"]);
      const stop = new AbortController();
      came = next();
      const stopped = internal({ body: { model: "one-model", max_tokens: 20, messages: [{ role: "user", content: "never mind" }] }, signal: stop.signal });
      await came;
      stop.abort(new Error("the turn was stopped"));
      await assert.rejects(stopped, /the turn was stopped/);
    } finally {
      for (const res of held) if (!res.writableEnded) res.end();
      door.closeAllConnections?.();
      door.close();
    }
  });

  // (fails before: yes — the turn sat in "thinking": nothing said what it waited for)
  test("a turn's round that waits for a slot says what holds it, and a stop ends the wait", async () => {
    const hold = holdReply();
    let n = 0;
    brain = async (call) => {
      if (!String(call.body?.model).startsWith("one-")) return undefined;
      if (++n === 1) await hold.promise;
      return anthropicReply(`answer ${n}`, { model: "one-model" });
    };
    const holder = ask("one-model", "hold the slot");
    await until(() => n === 1, "a client's call to hold the only slot");
    const res = await shim.house("/v1/messages", { model: "agent/one-model", max_tokens: 400, stream: true, messages: [{ role: "user", content: "go" }] }, { "x-filament-cwd": root, "x-session-id": "slot-wait" });
    assert.equal(res.status, 200);
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    const events = async () => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=500`)).json()).events;
    const waiting = await until(async () => (await events()).find(isQueueWait), "the turn to say it waits for a slot");
    assert.match(waiting.why, /^waiting for a slot: one-model runs 1 call at a time at one \(learned from a 429 [^)]*\), held by a request from your tools \(\S+\)$/);
    assert.deepEqual([waiting.queue.upstream, waiting.queue.model, waiting.queue.cap], ["one", "one-model", 1]);
    const t0 = Date.now();
    const s = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "stop", text: "", from: "harness" } });
    assert.equal(s.status, 200, await s.text());
    await body;
    assert.ok(Date.now() - t0 < 5000, `the stop ended the wait (${Date.now() - t0} ms)`);
    assert.equal((await events()).at(-1)?.status, "stopped");
    assert.equal(n, 1, "the turn's call never reached the provider");
    hold.open();
    assert.equal((await holder).status, 200);
    const rec = await shim.record(runId);
    assert.ok(rec.changes.some((/** @type {string} */ c) => /^agent: round 1: waiting for a slot: one-model runs 1 call at a time at one \(learned from a 429 [^)]*\), held by a request from your tools \(/.test(c)), rec.changes.join("\n"));
  });
});

describe("the spin: a sub-agent's call holds the only slot", () => {
  /** @type {string} */
  let root;
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  /** The replies a test holds back: opened when it ends, so a failure leaves no call holding the next test's slot. @type {ReturnType<typeof gate>[]} */
  const holds = [];
  const holdReply = () => {
    const g = gate();
    holds.push(g);
    return g;
  };
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-slot-spin-"));
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-model": { input: 1, output: 1, contextTokens: 200000 } } }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "", subagents: { slots: [{ upstream: "m", model: "brain-model", n: 1 }] } };
      },
    });
    // The row caps agents; a call's lane holds to what the provider showed: one at a time, as a 429 teaches it.
    shim.app.health.note429("m", "brain-model", 2);
  });
  afterEach(() => {
    for (const g of holds.splice(0)) g.open();
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(root);
  });
  /** @param {string} runId */
  const eventsOf = async (runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=2000`)).json()).events || [];
  const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
  const lastText = (/** @type {any} */ m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ c) => c?.type === "text").map((/** @type {any} */ c) => c.text).join("\n"));
  /** A reply that read and wrote the provider's cache, so its conversation is warm to fork. @param {any[]} blocks @param {string} [stop] */
  const warm = (blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7, cache_read_input_tokens: 4, cache_creation_input_tokens: 2 } });
  const isFork = (/** @type {any} */ b) => /^\[Filament: (this turn has reached the compaction line|the developer asked to compact this turn now)\./.test(lastText(b.messages?.at(-1)));
  const isSubagent = (/** @type {any} */ b) => JSON.stringify(b.system ?? "").includes(PROMPT.subagentRole);

  // (fails before: yes — first come first served: a sub-agent went ahead of the developer's turn, and the turn's wait
  // said nothing)
  // Since 10-20 the model's one number (here one) holds its agents across Filament and its calls alike: a second agent on
  // it is refused, in its own session and in another (team_v2_plan TV2-D9); the developer's turn waits for the call.
  test("a sub-agent's call holds the model's one slot: a second agent on it is refused in any session, and the developer's turn waits, saying what holds it", async () => {
    const open = async () => {
      const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
      assert.equal(created.status, 200, await created.clone().text());
      return String((await created.json()).id);
    };
    const id = await open();
    const other = await open();
    const hold = holdReply();
    /** @type {string[]} */
    const arrivals = [];
    brain = async (call) => {
      if (call.kind !== "anthropic") return undefined;
      const sub = JSON.stringify(call.body?.system ?? "").includes(PROMPT.subagentRole);
      const said = JSON.stringify(call.body?.messages ?? []);
      const who = sub ? (said.includes("ALPHA") ? "ALPHA" : said.includes("BETA") ? "BETA" : "OTHER") : said.includes("MAIN:") ? "MAIN" : "OTHER";
      arrivals.push(who);
      if (who === "ALPHA") await hold.promise;
      return anthropicReply(`${who} DONE`, { model: "brain-model" });
    };
    const spawn = async (/** @type {string} */ session, /** @type {string} */ prompt) => {
      const r = await shim.api(`/api/sessions/${encodeURIComponent(session)}/subagents`, { method: "POST", body: { prompt, description: prompt.slice(0, 5), deliver: false } });
      assert.equal(r.status, 200, await r.clone().text());
      return String((await r.json()).subagent.id);
    };
    await spawn(id, "ALPHA: say what this folder is for.");
    await until(() => arrivals.includes("ALPHA"), "the first sub-agent's call to hold the only slot");
    const again = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`, { method: "POST", body: { prompt: "GAMMA: and again.", deliver: false } });
    assert.deepEqual([again.status, (await again.json()).error], [400, "The limit is 1 at once, and 1 is running. Wait for one to finish. brain-model runs 1 at once: its provider said too many, for 10 more minutes."], "its own session has no second seat on a model that takes one call");
    const beta = await shim.api(`/api/sessions/${encodeURIComponent(other)}/subagents`, { method: "POST", body: { prompt: "BETA: say what this folder is for.", deliver: false } });
    assert.equal(beta.status, 400, "another session's launch on the model is refused too");
    assert.match(String((await beta.json()).error), /its slots across Filament are busy \(1 of 1 busy; set on its row under its provider in Settings\)/);
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "MAIN: say hello", stream: true } });
    assert.equal(res.status, 200);
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    const mainWait = await until(async () => (await eventsOf(runId)).find(isQueueWait), "the developer's turn to wait for the slot");
    assert.match(mainWait.why, /^waiting for a slot: brain-model runs 1 call at a time at m \(learned from a 429 [^)]*\), held by a sub-agent's model call \(\S+\)$/);
    hold.open();
    await body;
    assert.deepEqual(arrivals.filter((w) => w !== "OTHER").slice(0, 2), ["ALPHA", "MAIN"], "the developer's turn went once the slot was free");
  });

  /** The three files a turn reads, each about 1,200 tokens: the third round's reply is what a Compact folds after. */
  const writeFiles = () => {
    for (const f of ["a", "b", "c"]) writeFileSync(join(root, `${f}.txt`), `MARKER-${f.toUpperCase()} ${"words ".repeat(800)}`);
  };
  /** A session on the capped model. */
  const session = async () => {
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    assert.equal(created.status, 200, await created.clone().text());
    return String((await created.json()).id);
  };
  /** @param {string} id @param {string} prompt */
  const spawnRun = async (id, prompt) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`, { method: "POST", body: { prompt, description: prompt.slice(0, 5), deliver: false } });
    assert.equal(r.status, 200, await r.clone().text());
    const sid = String((await r.json()).subagent.id);
    return String(await until(async () => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json()).subagents.find((/** @type {any} */ s) => s.id === sid)?.runId || null, "the sub-agent's run"));
  };
  /** @param {string} runId */
  const compactNow = async (runId) => {
    const s = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "compact", text: "", from: "harness" } });
    assert.equal(s.status, 200, await s.text());
  };
  /** Rounds that read a, b and c, the third held until `third` opens, then "Done.". @param {{ promise: Promise<unknown> }} third */
  const readsThree = (third) => {
    let n = 0;
    return {
      rounds: () => n,
      next: async () => {
        n++;
        if (n === 1) return warm([toolUse("r1", "read", { path: "a.txt" })], "tool_use");
        if (n === 2) return warm([toolUse("r2", "read", { path: "b.txt" })], "tool_use");
        if (n === 3) {
          await third.promise;
          return warm([toolUse("r3", "read", { path: "c.txt" })], "tool_use");
        }
        return warm([{ type: "text", text: "Done." }]);
      },
    };
  };

  // (fails before: no — a guard the mutation pass asked for: no test had a compaction fork wait for its slot, so nothing
  // showed that its wait is said)
  test("the developer's compaction fork waits for the slot a sub-agent's call holds, and says so", async () => {
    writeFiles();
    const id = await session();
    const third = holdReply();
    const subHold = holdReply();
    const turn = readsThree(third);
    let forks = 0;
    let subCalls = 0;
    brain = async (call) => {
      if (call.kind !== "anthropic") return undefined;
      const b = call.body || {};
      if (isSubagent(b)) {
        subCalls++;
        await subHold.promise;
        return warm([{ type: "text", text: "SUB DONE" }]);
      }
      if (isFork(b)) {
        forks++;
        return warm([{ type: "text", text: "<summary>\nFROM THE FORK\n</summary>" }]);
      }
      return JSON.stringify(b.messages ?? []).includes("read a, b and c") ? turn.next() : undefined;
    };
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "read a, b and c", stream: true } });
    assert.equal(res.status, 200);
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await until(() => turn.rounds() === 3, "the turn's third round to hold the only slot");
    const subRun = await spawnRun(id, "AUDIT: say what this folder is for.");
    await until(async () => (await eventsOf(subRun)).find(isQueueWait), "the sub-agent's call to wait for the slot");
    await compactNow(runId);
    third.open();
    await until(() => subCalls === 1, "the sub-agent's call to take the slot");
    await until(async () => (await eventsOf(runId)).filter(isQueueWait).length > 0, "the fork to wait for the slot");
    subHold.open();
    await body;
    assert.equal(forks, 1, "the fold was written by the fork");
    const rec = await shim.record(runId);
    assert.ok(
      rec.changes.some((/** @type {string} */ c) => /^agent: compacting rounds \d+–\d+: waiting for a slot: brain-model runs 1 call at a time at m \(learned from a 429 [^)]*\), held by a sub-agent's model call \(\S+\)$/.test(c)),
      rec.changes.join("\n"),
    );
  });

  // (fails before: no — a guard the mutation pass asked for: no test had a sub-agent's compaction fork hold the slot,
  // which is the spin's own case)
  test("a sub-agent's compaction fork holds the only slot: the developer's turn waits, saying so", async () => {
    writeFiles();
    const id = await session();
    const third = holdReply();
    const forkHold = holdReply();
    const sub = readsThree(third);
    let forks = 0;
    brain = async (call) => {
      if (call.kind !== "anthropic") return undefined;
      const b = call.body || {};
      if (isSubagent(b) && isFork(b)) {
        forks++;
        await forkHold.promise;
        return warm([{ type: "text", text: "<summary>\nFROM THE FORK\n</summary>" }]);
      }
      if (isSubagent(b)) return sub.next();
      return JSON.stringify(b.messages ?? []).includes("MAIN:") ? warm([{ type: "text", text: "MAIN DONE" }]) : undefined;
    };
    const subRun = await spawnRun(id, "read a, b and c");
    await until(() => sub.rounds() === 3, "the sub-agent's third round in flight");
    await compactNow(subRun);
    third.open();
    await until(() => forks === 1, "the sub-agent's compaction fork to hold the only slot");
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "MAIN: say hello", stream: true } });
    assert.equal(res.status, 200);
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    const mainWait = await until(async () => (await eventsOf(runId)).find(isQueueWait), "the developer's turn to wait for the slot");
    assert.match(mainWait.why, /^waiting for a slot: brain-model runs 1 call at a time at m \(learned from a 429 [^)]*\), held by a sub-agent's compaction fork \(\S+\)$/);
    forkHold.open();
    await body;
    await until(async () => (await eventsOf(subRun)).some((/** @type {any} */ e) => e.type === "run-end"), "the sub-agent to finish");
  });
});
