// @ts-check
// HarnessV4_Tasks E15 step 8 (the pool) over the live app: the pool's editor reads its rows as a launch would —
// what each takes now, its model's limit in force (one its provider showed; a price card's caps nothing since 10-20),
// its number across Filament, its price, why it cannot run — from rows not saved yet; and a session's own pool is a
// setting like any other: written by a patch, refused in the pool's own words, the default where the global one does
// not hold.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fakeUpstream, anthropicReply, startApp } from "./helpers/app.js";
import { upstreamsOffProblem } from "../src/app/engine.js";

describe("the pool over the API", () => {
  /** @type {any} */ let up;
  /** @type {any} */ let limited;
  /** @type {any} */ let strict;
  /** @type {any} */ let shim;
  /** @param {string} method @param {string} path @param {any} [body] */
  const call = async (method, path, body) => {
    const r = await shim.api(`/api${path}`, { method, ...(body === undefined ? {} : { body }) });
    return { status: r.status, json: await r.json() };
  };
  /** @param {any[]} seats */
  const rows = (seats) => seats.map((s) => [s.model, s.lent, s.lends, s.limit, s.shared?.cap ?? null, s.price]);

  before(async () => {
    up = await fakeUpstream(async (c) => anthropicReply("OK", { model: String(c.body?.model || "") }));
    // A provider that says how many requests it takes: Filament reads the limit off its answers.
    limited = await fakeUpstream(async (c) => ({
      ...anthropicReply("OK", { model: String(c.body?.model || "") }),
      headers: { "anthropic-ratelimit-requests-limit": "2", "anthropic-ratelimit-requests-remaining": "1" },
    }));
    // A provider that refuses one of its models for this account's rate, and answers the other.
    strict = await fakeUpstream(async (c) =>
      String(c.body?.model) === "d-hot"
        ? { status: 429, json: { type: "error", error: { type: "rate_limit_error", message: "Number of requests has exceeded your per-minute rate limit" } } }
        : anthropicReply("OK", { model: String(c.body?.model || "") }),
    );
    shim = await startApp({
      configure: (cfg) => {
        cfg.rules.resilience.failover = true; // the backups below are tried: off until switched on (the owner's of 11-09)
        cfg.upstreams = [
          { id: "d", name: "d", type: "anthropic", baseUrl: strict.url, apiKey: "s", enabled: true },
          { id: "a", name: "a", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "a-card": { input: 1, output: 2, maxConcurrency: 3 }, "a-main": { input: 3, output: 15, maxConcurrency: 2 } } },
          { id: "b", name: "b", type: "anthropic", baseUrl: limited.url, apiKey: "s", enabled: true, pricing: { "b-1": { input: 0.5, output: 1, maxConcurrency: 8 } } },
          { id: "c", name: "Sea", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: false },
        ];
        cfg.routes = [
          { match: "a-*", upstream: "a", upstreamModel: "{model}", enabled: true },
          { match: "b-*", upstream: "b", upstreamModel: "{model}", enabled: true },
          { match: "d-*", upstream: "d", upstreamModel: "{model}", enabled: true },
          { match: "c-backed", upstream: "c", upstreamModel: "a-free", fallbacks: [{ upstream: "a" }], enabled: true },
          { match: "c-*", upstream: "c", upstreamModel: "{model}", enabled: true },
        ];
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await limited.close();
    await strict.close();
  });

  // (fails before: yes — the route did not exist: nothing said what a row would lend before it was saved; and until
  // 10-20 a price card's maxConcurrency cut a row, against the owner's word of 10-19)
  test("POST /api/subagents/seats: each row with what it takes, its limit, its number across Filament, its price, and why it cannot run; a price card's maxConcurrency caps nothing; nothing is written", async () => {
    const pool = [{ model: "a-card" }, { model: "a-free", seats: 2 }, { model: "" }, { model: "nowhere-9" }];
    const r = await call("POST", "/subagents/seats", { pool, main: "agent/a-main" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(rows(r.json.seats).slice(0, 3), [
      // (the owner's word of 11-05: with no limit set on a model, none — read as null over JSON)
      ["a-card", null, "", null, null, { input: 1, output: 2 }],
      ["a-free", null, "", null, null, null],
      ["a-main", null, "", null, null, { input: 3, output: 15 }],
    ]);
    const gone = r.json.seats[3];
    assert.deepEqual([gone.model, gone.lent, gone.lends, typeof gone.problem], ["nowhere-9", 0, "", "string"], JSON.stringify(gone));
    assert.deepEqual(["total" in r.json, r.json.seats.map((/** @type {any} */ s) => [s.named, s.own, s.running])], [false, [[true, false, 0], [true, false, 0], [false, true, 0], [true, false, 0]]], "no total of the list's own: each model's limit holds");
    // (the owner's word of 11-05: a list for agents is a chat's own alone; Filament keeps none to show)
    assert.ok(!("pool" in (await call("GET", "/teams")).json), "the rows were the body's: nothing is stored");
  });

  // (fails before: yes — E15 step 8's look, AG-259: a row on a switched-off upstream had no problem and lent its seat,
  // so a launch took it and died at its first call with nothing sent)
  test("a row whose upstream is switched off cannot run: it lends nothing and says which upstream; one with a backup that is on runs", async () => {
    const r = await call("POST", "/subagents/seats", { pool: [{ model: "c-1" }, { model: "c-backed" }, { model: "a-free" }], main: "agent/a-main" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.seats.map((/** @type {any} */ s) => [s.model, s.lent !== 0, s.problem]), [
      ["c-1", false, 'its upstream "Sea" is switched off. Switch it on on the Upstreams page.'],
      ["c-backed", true, null],
      ["a-free", true, null],
    ]);
    // The same check answers the Agents page for a card's own model.
    assert.equal((await call("GET", "/subagents/model-problem?model=c-1")).json.problem, 'its upstream "Sea" is switched off. Switch it on on the Upstreams page.');
    assert.equal((await call("GET", "/subagents/model-problem?model=c-backed")).json.problem, null);
  });

  // (fails before: yes — AG-259: the rule did not exist)
  test("no upstream switched on, in words: the backups count only while failover is on, and an upstream that is gone is named as gone", () => {
    /** @param {any} [more] */
    const cfg = (more = {}) => ({
      // Failover is off until switched on (the owner's of 11-09): on here, so a backup counts.
      rules: { resilience: { failover: true } },
      upstreams: [{ id: "on", enabled: true }, { id: "off", name: "Off Co", enabled: false }, { id: "off2", enabled: false }],
      routes: [
        { match: "m-on", upstream: "on" },
        { match: "m-off", upstream: "off" },
        { match: "m-backed", upstream: "off", fallbacks: [{ upstream: "on" }] },
        { match: "m-both", upstream: "off", fallbacks: ["off2", { upstream: "lost" }] },
        { match: "m-lost", upstream: "lost" },
      ],
      ...more,
    });
    assert.equal(upstreamsOffProblem(cfg(), "m-on"), null);
    assert.equal(upstreamsOffProblem(cfg(), "m-off"), 'its upstream "Off Co" is switched off. Switch it on on the Upstreams page.');
    assert.equal(upstreamsOffProblem(cfg(), "m-backed"), null, "a call moves on to the backup");
    assert.equal(
      upstreamsOffProblem(cfg({ rules: { resilience: { failover: false } } }), "m-backed"),
      'its upstream "Off Co" is switched off. Switch it on on the Upstreams page.',
      "with failover off a call never reaches the backup",
    );
    assert.equal(upstreamsOffProblem(cfg({ rules: {} }), "m-backed"), 'its upstream "Off Co" is switched off. Switch it on on the Upstreams page.', "nor where nothing says it is on");
    assert.equal(upstreamsOffProblem(cfg(), "m-both"), 'none of its upstreams can answer: "Off Co" is switched off, "off2" is switched off, "lost" is gone. Switch one on on the Upstreams page.');
    assert.equal(upstreamsOffProblem(cfg(), "m-lost"), 'its upstream "lost" is gone. Pick another on the Routes page.');
    assert.equal(upstreamsOffProblem(cfg(), "m-nowhere"), null, "no route is the route's own refusal to word");
  });

  // (fails before: yes — the review of 11-05: a provider's requests limit, which Anthropic and OpenAI send on every
  // answer and count per minute, was read as how many agents a model runs at once: with no limit set, 3999 of 4000
  // under each row, and a set limit cut to it. A call's own wait still holds to it, dispatch/attempt.js)
  test("a provider's requests limit on its answers says nothing of agents at once; nor does the price card's", async () => {
    const before = await call("POST", "/subagents/seats", { pool: [{ model: "b-1" }] });
    assert.deepEqual(rows(before.json.seats), [["b-1", null, "", null, null, { input: 0.5, output: 1 }]]);
    const said = await shim.post("/v1/messages", { model: "b-1", max_tokens: 50, messages: [{ role: "user", content: "hi" }] });
    assert.equal(said.status, 200, await said.clone().text());
    const now = await call("POST", "/subagents/seats", { pool: [{ model: "b-1" }] });
    assert.deepEqual(rows(now.json.seats), [["b-1", null, "", null, null, { input: 0.5, output: 1 }]], "no limit set: none");
    assert.equal((await call("PUT", "/subagents/slots", { upstream: "b", model: "b-1", n: 3 })).status, 200);
    try {
      const row = (await call("GET", "/subagents/slots")).json.rows.find((/** @type {any} */ r) => r.upstream === "b" && r.model === "b-1");
      assert.deepEqual([row?.set, row?.cap, row?.lowered], [3, 3, null], "a limit set holds as set");
    } finally {
      await call("PUT", "/subagents/slots", { upstream: "b", model: "b-1", n: null });
    }
  });

  // (fails before: yes — the review of 11-05: a 65th row was saved, the stored list then failed its check, and every
  // model's limit was read as none)
  test("a limit past the list's last row is refused in words, and the rows set stay", async () => {
    const put = (/** @type {number} */ i, /** @type {number | null} */ n) => call("PUT", "/subagents/slots", { upstream: "a", model: `a-row-${i}`, n });
    try {
      for (let i = 0; i < 64; i++) assert.equal((await put(i, 2)).status, 200);
      const past = await put(64, 2);
      assert.deepEqual([past.status, past.json.error], [400, "Not kept: a list of limits holds at most 64 rows — take a model's limit away first"]);
      const set = (await call("GET", "/subagents/slots")).json.rows.filter((/** @type {any} */ r) => r.set != null);
      assert.equal(set.length, 64, "the rows set stay");
    } finally {
      for (let i = 0; i < 64; i++) await put(i, null);
    }
  });

  test("a body that is no pool is refused in the pool's own words", async () => {
    /** @type {[any, string][]} */
    const refused = [
      [{}, '"pool" must be a list of { model, effort? } rows: the models sub-agents run on, in order — model "" is the main agent\'s'],
      [{ pool: [] }, '"pool" needs one row at least: a session with no seat could run no agent'],
      [{ pool: [{ model: "a-card", n: 3 }] }, '"pool" [0] holds "n": a row is { model, effort? }'],
    ];
    for (const [body, error] of refused) {
      const r = await call("POST", "/subagents/seats", body);
      assert.deepEqual([r.status, r.json.error], [400, error], JSON.stringify(body));
    }
  });

  // (fails before: yes — a session named one model and one number: subagents.model, subagents.maxConcurrent)
  test("a session's pool is its setting: a patch writes it, one that is no pool is refused, and the two settings it replaced are gone", async () => {
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: process.cwd(), model: "a-main", preset: null } });
    assert.equal(made.status, 200, await made.clone().text());
    const id = String((await made.json()).id);
    const at = `/sessions/${encodeURIComponent(id)}/settings`;
    const first = (await call("GET", at)).json;
    assert.deepEqual([first.flat["subagents.pool"], Object.hasOwn(first.flat, "subagents.model"), Object.hasOwn(first.flat, "subagents.maxConcurrent")], [[{ model: "" }], false, false]);
    const pool = [{ model: "a-card", seats: 2 }, { model: "", seats: 1 }];
    assert.equal((await call("PATCH", at, { patch: { subagents: { pool } } })).status, 200);
    const now = (await call("GET", at)).json;
    assert.deepEqual([now.flat["subagents.pool"], now.sources["subagents.pool"]], [pool, "session"]);
    const bad = await call("PATCH", at, { patch: { subagents: { pool: [{ model: "a-card", seats: 2 }, { model: "a-card", seats: 1 }] } } });
    assert.equal(bad.status, 400, JSON.stringify(bad.json));
    assert.equal(bad.json.error, '"subagents.pool" names "a-card" twice: each model has one row');
    for (const old of [{ model: "a-card" }, { maxConcurrent: 2 }]) {
      const r = await call("PATCH", at, { patch: { subagents: old } });
      assert.equal(r.status, 400, JSON.stringify(r.json));
    }
    assert.deepEqual((await call("GET", at)).json.flat["subagents.pool"], pool);
  });

  // (fails before: yes — AG-260: the list did not say it, and the Side tab named the pool's first row, warning that
  // it cannot run of a launch the next row would run)
  test("a session's list of agents says which seat a launch that names no model would take now: past a row that cannot run, the main agent's row marked", async () => {
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: process.cwd(), model: "a-main", preset: null } });
    const id = encodeURIComponent(String((await made.json()).id));
    const next = async () => (await call("GET", `/sessions/${id}/subagents`)).json.nextSeat;
    assert.deepEqual(await next(), { model: "a-main", own: true }, "the default pool is the main agent's model");
    assert.equal((await call("PATCH", `/sessions/${id}/settings`, { patch: { subagents: { pool: [{ model: "c-1", seats: 2 }, { model: "a-card", seats: 2 }, { model: "", seats: 1 }] } } })).status, 200);
    assert.deepEqual(await next(), { model: "a-card", own: false });
    assert.equal((await call("PATCH", `/sessions/${id}/settings`, { patch: { subagents: { pool: [{ model: "c-1", seats: 2 }, { model: "nowhere-9", seats: 1 }] } } })).status, 200);
    assert.equal(await next(), null, "no row can run");
  });

  // (fails before: yes — AG-261: a 429 was kept for the whole provider, so the row of a model it never refused was
  // cut with the refused one's)
  test("a 429 on one model of a provider cuts that model's row, and the row of another model there stays whole", async () => {
    const pool = [{ model: "d-cool" }, { model: "d-hot" }];
    const before = await call("POST", "/subagents/seats", { pool, main: "agent/a-main" });
    assert.deepEqual(before.json.seats.map((/** @type {any} */ s) => [s.model, s.lent, s.limit]), [["d-cool", null, null], ["d-hot", null, null]]);
    const said = await shim.post("/v1/messages", { model: "d-hot", max_tokens: 50, messages: [{ role: "user", content: "hi" }] });
    assert.equal(said.status, 429, await said.text());
    const r = await call("POST", "/subagents/seats", { pool, main: "agent/a-main" });
    const [cool, hot] = r.json.seats;
    assert.deepEqual([cool.model, cool.lent, cool.limit, cool.lends], ["d-cool", null, null, ""], "it was refused nothing");
    assert.deepEqual([hot.model, hot.lent, hot.limit?.cap, hot.limit?.from], ["d-hot", 1, 1, "429"]);
    assert.match(hot.lends, /^1 at once: its provider said too many/);
    assert.equal("total" in r.json, false, "no total of the list's own");
  });
});
