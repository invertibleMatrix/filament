// @ts-check
// A provider's ceiling, kept once it is confirmed (the owner's word of 10-23: "yeah do that"). Z.ai refused the 8th
// GLM-5.3 Flash call every ten minutes: each refusal held the model at 7 for ten minutes, the hold lifted to the 40 set,
// the waiting agents started at once and the 8th was refused again — a failed call and a ten-second pause of every Z.ai
// call each time, and words that said the hold would be over in ten minutes. Now a refusal at the same number again
// confirms it: it holds twice as long each time, to an hour, and after it one more is tried, not the number set; a day
// with no refusal forgets it. The board (services/health.js), the gate that waits under it, and its words — a slot's
// and a pool's (core), and the line under the model's row under its provider (the page).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ConcurrencyGate, HealthBoard, LEARNED_CEILING_MS, LEARNED_HOLD_MOST_MS, LEARNED_KEPT_MS } from "../src/services/health.js";
import { confirmedWords, ordinal, slotOf, slotWords } from "../src/core/slots.js";
import { lendsWords, seatsOf } from "../src/core/pool.js";
import { heldWords } from "../src/ui/harness/lib/model-rows.js";
import { judgeReply } from "../src/app/pipeline/dispatch/verdict.js";
import * as attempt from "../src/app/pipeline/dispatch/attempt.js";

const TEN_MIN = 600_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = 1_800_000_000_000;
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

describe("a provider's ceiling the provider confirms", () => {
  test("the hold's numbers: ten minutes, an hour at most, a day kept", () => {
    assert.deepEqual([LEARNED_CEILING_MS, LEARNED_HOLD_MOST_MS, LEARNED_KEPT_MS], [TEN_MIN, HOUR, DAY]);
  });

  // (fails before: yes — the owner's word of 10-23: each hold lifted to the number set, and the 8th was refused again)
  test("refused at the same number again: the provider takes that many — kept, held twice as long each time to an hour, and one more tried after, not the number set", () => {
    const b = new HealthBoard();
    const t0 = 5_000_000;
    assert.equal(b.note429("zai", "flash", 8, t0), 7);
    assert.deepEqual(b.observedCeiling("zai", "flash", t0 + 1000), { cap: 7, from: "429", at: t0, liftsAt: t0 + TEN_MIN }, "refused once: as before");
    assert.equal(b.observedCeiling("zai", "flash", t0 + TEN_MIN), null, "it lifts after ten minutes, to the number set");
    const t1 = t0 + TEN_MIN + 5 * 60_000;
    assert.equal(b.note429("zai", "flash", 8, t1), 7, "the 8th refused again");
    assert.deepEqual(b.observedCeiling("zai", "flash", t1 + 1000), { cap: 7, from: "429", at: t1, liftsAt: t1 + 2 * TEN_MIN, takes: 7, times: 2, since: t0, probing: false }, "the provider takes 7: held twice as long");
    assert.deepEqual(b.observedCeiling("zai", "flash", t1 + 2 * TEN_MIN), { cap: 8, from: "429", at: t1, liftsAt: t1 + 4 * TEN_MIN, takes: 7, times: 2, since: t0, probing: true }, "then one more is tried, not the 40 set");
    const t2 = t1 + 2 * TEN_MIN + 30_000;
    assert.equal(b.note429("zai", "flash", 8, t2), 7, "the one more refused");
    assert.deepEqual(b.observedCeiling("zai", "flash", t2 + 1000), { cap: 7, from: "429", at: t2, liftsAt: t2 + 4 * TEN_MIN, takes: 7, times: 3, since: t0, probing: false }, "held forty minutes");
    const t3 = t2 + 4 * TEN_MIN + 30_000;
    b.note429("zai", "flash", 8, t3);
    assert.equal(/** @type {any} */ (b.observedCeiling("zai", "flash", t3 + 1000))?.liftsAt, t3 + HOUR, "eighty would be past an hour: an hour");
    const t4 = t3 + HOUR + 30_000;
    b.note429("zai", "flash", 8, t4);
    assert.deepEqual(b.snapshot(t4 + 1000).zai.ceilings, [{ model: "flash", cap: 7, liftsInMs: HOUR - 1000, times: 5, probing: false }], "the health table says how often, and that it holds an hour at most");
    assert.deepEqual(b.snapshot(t4 + HOUR).zai.ceilings, [{ model: "flash", cap: 8, liftsInMs: HOUR, times: 5, probing: true }], "and when one more is tried");
  });

  // (fails before: yes — the owner's word of 10-23)
  test("one more each hold with no refusal, a day at most; another number is learned anew; one refused once is remembered one hold more, then forgotten; Reset forgets", () => {
    const t0 = 5_000_000;
    const once = new HealthBoard();
    once.note429("u", "m", 8, t0);
    assert.equal(once.observedCeiling("u", "m", t0 + 2 * TEN_MIN - 1), null, "lifted, and remembered");
    assert.equal(once.note429("u", "m", 8, t0 + 2 * TEN_MIN), 7);
    assert.deepEqual(once.observedCeiling("u", "m", t0 + 2 * TEN_MIN + 1000), { cap: 7, from: "429", at: t0 + 2 * TEN_MIN, liftsAt: t0 + 3 * TEN_MIN }, "forgotten after one hold more: a first refusal again");

    const sure = new HealthBoard();
    sure.note429("u", "m", 8, t0);
    const t1 = t0 + TEN_MIN + 1000;
    sure.note429("u", "m", 8, t1);
    assert.deepEqual([30, 50, 70].map((min) => sure.observedCeiling("u", "m", t1 + min * 60_000)?.cap), [8, 9, 10], "one more each twenty minutes with no refusal");
    assert.equal(/** @type {any} */ (sure.observedCeiling("u", "m", t1 + 70 * 60_000))?.liftsAt, t1 + 80 * 60_000, "and when the next comes");
    assert.equal(/** @type {any} */ (sure.observedCeiling("u", "m", t1 + DAY - 1))?.probing, true);
    assert.equal(sure.observedCeiling("u", "m", t1 + DAY), null, "a day with no refusal: the number set again");

    const more = new HealthBoard();
    more.note429("u", "m", 8, t0);
    more.note429("u", "m", 8, t1);
    assert.equal(more.note429("u", "m", 10, t1 + 70 * 60_000), 9, "refused at the 10th: the provider takes 9 now");
    assert.deepEqual(more.observedCeiling("u", "m", t1 + 70 * 60_000 + 1000), { cap: 9, from: "429", at: t1 + 70 * 60_000, liftsAt: t1 + 80 * 60_000 }, "learned anew, as a first refusal");

    const tight = new HealthBoard();
    tight.note429("u", "m", 8, t0);
    tight.note429("u", "m", 8, t1);
    assert.equal(tight.note429("u", "m", 6, t1 + 60_000), 5, "a tighter refusal while it holds lowers it");
    assert.equal(/** @type {any} */ (tight.observedCeiling("u", "m", t1 + 120_000))?.times, undefined, "and that number is a first one");

    sure.reset("u");
    assert.equal(sure.observedCeiling("u", "m", t1 + 1000), null, "Reset forgets a confirmed one too");
  });

  // (fails before: yes — the owner's word of 10-23: the note said ten minutes, every time)
  test("the 429's note: refused at the same number again, how long it holds now, and that one more is tried after", async () => {
    const health = new HealthBoard();
    health.note429("zai", "glm-5.3-flash", 8, Date.now() - 11 * 60_000);
    const ctx = /** @type {any} */ ({ res: { headersSent: false }, format: "anthropic", rec: { id: "rq_1" }, candidates: [{ upstream: "zai" }, { upstream: "next" }], failover: true, body: {}, headers: {} });
    const deps = /** @type {any} */ ({ log: () => {}, health, concurrency: { inflightAt: () => 8 } });
    const res = new Response(JSON.stringify({ error: { code: "1302", message: "Rate limit reached for requests" } }), { status: 429, headers: { "content-type": "application/json" } });
    const first = /** @type {any} */ ({ p: { upstream: { id: "zai" }, upstreamModel: "glm-5.3-flash", shaped: { body: {} } }, fw: { res, cleanup() {} } });
    const out = await judgeReply(ctx, deps, /** @type {any} */ ({ candUp: { id: "zai" }, index: 0, attempt: async () => first, unreachable: () => "next", trail: { note() {} } }), first);
    assert.equal(out, "next");
    assert.ok(
      ctx.rec.changes.includes("concurrency: zai answered 429 with 8 calls of glm-5.3-flash in flight — glm-5.3-flash runs at most 7 at a time there now, until 20 minutes after this 429: it refused the 8th 2 times in a row, so then one more is tried, not the number set"),
      ctx.rec.changes.join("\n"),
    );
  });

  // (fails before: yes — the owner's word of 10-23)
  test("a call under a confirmed ceiling says on its record how many the provider takes and when one more is tried", async () => {
    const health = new HealthBoard();
    const now = Date.now();
    health.note429("up", "m1", 3, now - 11 * 60_000);
    health.note429("up", "m1", 3, now - 60_000);
    /** @type {any[]} */
    const asked = [];
    const free = { inflightAt: () => 0, acquire: (/** @type {string} */ _u, /** @type {string} */ _m, /** @type {any} */ ceiling) => (asked.push(ceiling()), { release() {}, waitedMs: 0, queued: false }) };
    const deps = /** @type {any} */ ({
      config: () => ({ observability: { storeBodies: "none", maxStoredBodyBytes: 0 }, agentLoop: { subagents: { slots: [{ upstream: "up", model: "m1", n: 40 }] } } }),
      log: () => {},
      health,
      concurrency: free,
      plan: () => ({ upstream: { id: "up" }, shaped: { body: { model: "m1" }, changes: [] }, headers: {}, url: "http://up.invalid/v1/messages" }),
      destination: () => ({ answers: { open: async () => ({ res: new Response("{}"), cleanup() {} }), unreachable: (/** @type {any} */ e) => ({ message: e.message, retryable: true }) } }),
      finish: () => {},
    });
    const ctx = /** @type {any} */ ({
      format: "anthropic", body: { model: "m1", messages: [] }, raw: "{}", pre: null, headers: {}, requested: { base: "m1" }, route: { match: "m1" },
      rec: { id: "rq_client" }, house: false, client: { abort: new AbortController() }, flags: { bodiesAllowed: false }, res: { headersSent: false },
      candidates: [{ upstream: "up" }], failover: true,
    });
    assert.ok("fw" in (await attempt.createAttempt(ctx, deps, { candidate: { upstream: "up" }, index: 0 })(null)));
    assert.deepEqual(ctx.rec.changes.filter((/** @type {string} */ c) => c.startsWith("concurrency:")), [
      "concurrency: m1 runs 2 calls at a time at up (its provider takes about 2 at once on this account: it refused the 3rd 2 times in 11 min; one more is tried in 19 min)",
    ]);
    assert.deepEqual(asked.at(-1), { cap: 2, liftsAt: now - 60_000 + 2 * TEN_MIN }, "held twenty minutes from the second refusal, below the 40 set");
  });

  // (fails before: yes — the owner's word of 10-23: the waiting calls all went when the hold lifted)
  test("under a confirmed ceiling the gate lets one more call go as the hold ends, and another each hold after", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 5_000_000 });
    const b = new HealthBoard();
    const g = new ConcurrencyGate();
    const ceiling = () => {
      const c = b.observedCeiling("zai", "flash");
      return { cap: c?.cap ?? null, liftsAt: c?.from === "429" ? c.liftsAt : null };
    };
    b.note429("zai", "flash", 3, Date.now());
    t.mock.timers.tick(TEN_MIN + 60_000);
    b.note429("zai", "flash", 3, Date.now());
    const held = [await g.acquire("zai", "flash", ceiling), await g.acquire("zai", "flash", ceiling)];
    /** @type {any[]} */
    const went = [];
    const third = Promise.resolve(g.acquire("zai", "flash", ceiling)).then((s) => went.push(["third", s]));
    const fourth = Promise.resolve(g.acquire("zai", "flash", ceiling)).then((s) => went.push(["fourth", s]));
    await settle();
    assert.deepEqual(went, [], "two at once while it holds");
    t.mock.timers.tick(2 * TEN_MIN);
    await settle();
    assert.deepEqual(went.map((w) => w[0]), ["third"], "its hold over: one more, not every waiter");
    t.mock.timers.tick(2 * TEN_MIN);
    await settle();
    assert.deepEqual(went.map((w) => w[0]), ["third", "fourth"], "a hold with no refusal: another");
    await Promise.all([third, fourth]);
    for (const s of [...held, ...went.map((w) => w[1])]) s.release();
  });
});

describe("a confirmed ceiling in words", () => {
  const sure = { cap: 7, from: /** @type {const} */ ("429"), liftsAt: NOW + 35 * 60_000, takes: 7, times: 3, since: NOW - 59 * 60_000, probing: false };

  // (fails before: yes — the owner's word of 10-23: "for 10 more minutes", every ten minutes)
  test("a slot's and a pool's: how many the provider takes, how often it refused one more, or that one more is tried", () => {
    assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th"]);
    assert.equal(confirmedWords(sure, NOW), "its provider takes about 7 at once on this account: it refused the 8th 3 times in 59 min");
    assert.equal(confirmedWords({ ...sure, cap: 8, probing: true }, NOW), "trying one more at a time: its provider refused the 8th 3 times in 59 min");
    assert.equal(confirmedWords({ cap: 7, from: "429", liftsAt: NOW }, NOW), "", "refused once: said as before");
    const cut = slotOf([{ upstream: "zai", model: "glm-5.3-flash", n: 40 }], { upstream: "zai", model: "glm-5.3-flash" }, { seen: sure, running: 7 });
    assert.deepEqual(cut.lowered, { cap: 7, from: "429", liftsAt: sure.liftsAt, takes: 7, times: 3, since: sure.since, probing: false });
    assert.equal(slotWords(cut, NOW), "7 of 7 busy: lowered from 40, its provider takes about 7 at once on this account: it refused the 8th 3 times in 59 min");
    const once = slotOf([{ upstream: "zai", model: "glm-5.3-flash", n: 40 }], { upstream: "zai", model: "glm-5.3-flash" }, { seen: { cap: 7, from: "429", liftsAt: NOW + 4 * 60_000 }, running: 7 });
    assert.equal(slotWords(once, NOW), "7 of 7 busy: lowered from 40, its provider said too many, for 4 more minutes", "once: as before");
    const [row] = seatsOf([{ model: "flash", seats: 12 }], { main: "m-main", facts: () => ({ problem: null, limit: { ...sure, probing: true, cap: 8 } }), running: () => 0 });
    assert.equal(lendsWords(row, NOW), "8 at once: trying one more at a time: its provider refused the 8th 3 times in 59 min");
  });

  // (fails before: yes — the owner's word of 10-23)
  test("the line under a model's row under its provider: how many it takes on your account, since when, and when one more is tried — or that it is tried now; a rate limit is no refusal", () => {
    const at = new Date(NOW);
    at.setHours(12, 48, 0, 0);
    const line = { set: 40, cap: 7, lowered: { ...sure, since: at.getTime() } };
    assert.equal(heldWords(line, NOW), "Agents at once: 7 of 40 — its provider takes about 7 on your account: it refused the 8th 3 times since 12:48. One more is tried in 35 minutes");
    assert.equal(heldWords({ ...line, cap: 8, lowered: { ...line.lowered, cap: 8, probing: true } }, NOW), "Agents at once: 8 of 40 for now, trying one more at a time — its provider refused the 8th 3 times since 12:48");
    const day = at.getTime() - DAY;
    assert.equal(heldWords({ ...line, lowered: { ...line.lowered, since: day } }, NOW), `Agents at once: 7 of 40 — its provider takes about 7 on your account: it refused the 8th 3 times since ${new Date(day).toLocaleDateString("en-US", { month: "short", day: "numeric" })}, 12:48. One more is tried in 35 minutes`, "another day says its date");
    assert.equal(heldWords({ ...line, set: null }, NOW).startsWith("Agents at once: 7 — its provider takes about 7"), true, "no limit set: what the provider holds it to");
    assert.equal(heldWords({ ...line, lowered: { cap: 7, from: "429", liftsAt: NOW + 120_000 } }, NOW), "Agents at once: 7 of 40 for now — its provider said too many requests, for 2 more minutes", "once: as before");
    // (the review of 11-05: a provider's rate-limit headers count a minute's requests, and hold no agents)
    assert.equal(heldWords({ set: 8, cap: 5, lowered: { cap: 5, from: "headers" } }, NOW), "");
  });
});
