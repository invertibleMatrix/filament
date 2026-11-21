// @ts-check
// The usage breakdown Settings › Usage stats reads in one answer (the owner's of 11-12): a span's days and sums from
// the daily store, each account named as a person knows it with how it bills, what caching saved at today's list
// prices — worked out as it is read, nothing of it kept —, and who asked, by client and by project.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";
import { accountsOf, cacheSaved, spanOf, usageBreakdown } from "../src/app/usage-breakdown.js";
import { priceCard } from "../src/core/pricing.js";
import { projectIdOf } from "../src/core/project-id.js";
import { localDay } from "../src/services/daily-usage.js";
import { UsageStore } from "../src/services/records.js";
import { pressClass, NO_PRESS } from "../src/http/admin/press.js";
import { viewReads } from "../src/http/admin/remote.js";

const DAY = 86_400_000;
const dayBack = (/** @type {number} */ n) => localDay(new Date(Date.now() - n * DAY));

describe("what caching saved, at the list prices as they stand", () => {
  /** An upstream's own card: cache reads a tenth of new input, cache writes a quarter more. */
  const card = { "zeta-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 } };
  /** @param {any} o */
  const row = (o) => ({ upstream: "z", model: "zeta-5", input: 0, cacheRead: 0, cacheWrite: 0, output: 0, ...o });
  const tableOf = (/** @type {string} */ id) => (id === "z" ? card : null);

  // (fails before: yes — nothing said what caching saved over a span of days)
  test("cache reads billed as new input less as cache reads, less what cache writes cost over new input", () => {
    const got = cacheSaved([row({ cacheRead: 1_000_000, cacheWrite: 100_000, input: 50_000, output: 9_000 })], tableOf);
    // 1M × ($2 − $0.20) − 100K × ($2.50 − $2)
    assert.deepEqual(got, { usd: 1.75, plan: 0, models: 1, unpriced: [], flat: [] });
    // Rows add up; one with no cache token is none of it, priced or not.
    const more = cacheSaved([row({ cacheRead: 1_000_000 }), row({ cacheRead: 500_000, cacheWrite: 1_000_000 }), row({ model: "nobody-1", input: 9 })], tableOf);
    assert.deepEqual(more, { usd: 2.2, plan: 0, models: 1, unpriced: [], flat: [] }, "1.8 + (0.9 − 0.5)");
    // Writing more than was ever read back cost more than it saved: the figure says so.
    assert.equal(cacheSaved([row({ cacheWrite: 1_000_000 })], tableOf).usd, -0.5);
    // A card that names no price for a cache write bills it as new input: nothing to take off.
    assert.equal(cacheSaved([row({ upstream: "w", cacheRead: 1_000_000, cacheWrite: 1_000_000 })], () => ({ "zeta-5": { input: 2, output: 10, cacheRead: 0.2 } })).usd, 1.8);
    // The part of it on calls a plan paid for is said apart: what they would have cost less, no money paid less.
    const two = [row({ cacheRead: 1_000_000 }), row({ upstream: "sub", cacheRead: 500_000 })];
    assert.deepEqual(cacheSaved(two, () => card, (r) => r.upstream === "sub"), { usd: 2.7, plan: 0.9, models: 1, unpriced: [], flat: [] });
  });

  // (fails before: yes)
  test("a model no table prices is left out and named; one whose card names no cache price has no saving to say", () => {
    const got = cacheSaved(
      [
        row({ cacheRead: 1_000_000 }),
        row({ model: "nobody-1", cacheRead: 700 }),
        row({ model: "nobody-2", cacheWrite: 700 }),
        row({ model: "nobody-1", upstream: "other", cacheRead: 5 }),
        row({ upstream: "flat", model: "plain-1", cacheRead: 900 }),
      ],
      (id) => (id === "flat" ? { "plain-1": { input: 1, output: 2 } } : tableOf(id)),
    );
    assert.deepEqual(got, { usd: 1.8, plan: 0, models: 1, unpriced: ["nobody-1", "nobody-2"], flat: ["plain-1"] });
    assert.deepEqual(cacheSaved([row({ model: "nobody-1", cacheRead: 700 })], tableOf), { usd: null, plan: 0, models: 0, unpriced: ["nobody-1"], flat: [] }, "nothing priced: no figure, never $0");
    assert.deepEqual(cacheSaved([], tableOf), { usd: null, plan: 0, models: 0, unpriced: [], flat: [] });
  });

  test("with no card of the upstream's, Filament's built-in rates price it, as they price a call", () => {
    const p = /** @type {NonNullable<ReturnType<typeof priceCard>>} */ (priceCard("claude-sonnet-5"));
    assert.ok(p.cacheRead < p.input && p.cacheWrite > p.input, "the built-in card prices the cache apart");
    const got = cacheSaved([row({ upstream: "gone", model: "claude-sonnet-5", cacheRead: 2_000_000, cacheWrite: 1_000_000 })], () => null);
    assert.equal(got.usd, Math.round((2 * (p.input - p.cacheRead) - (p.cacheWrite - p.input)) * 1e6) / 1e6);
  });
});

describe("an account, named as a person knows it", () => {
  const cfg = {
    upstreams: [
      { id: "claude-code", name: "Claude Code (agent via ACP)", type: "acp", acp: { command: "claude-agent-acp" } },
      { id: "claude-code-work", name: "Claude Code · Work", type: "acp", acp: { command: "claude-agent-acp", account: "Work" } },
      { id: "codex", name: "Codex", type: "codex", acp: { command: "codex", args: ["app-server"] } },
      { id: "anthropic", name: "Anthropic", type: "anthropic", baseUrl: "https://api.anthropic.com" },
      { id: "sub", name: "My gateway", type: "openai-compatible", baseUrl: "https://gateway.example.test/v1", billing: "plan" },
    ],
  };
  // (fails before: yes — a row of Usage named an upstream by its id)
  test("a coding agent's account by its agent and its name, a provider by its card's; each with how it bills", () => {
    assert.deepEqual(accountsOf(cfg, ["claude-code", "claude-code-work", "codex", "anthropic", "sub", "left", "?"]), {
      "claude-code": { name: "Claude Code", kind: "agent", of: "Claude Code", billing: "plan" },
      "claude-code-work": { name: "Claude Code · Work", kind: "agent", of: "Claude Code", billing: "plan" },
      codex: { name: "Codex", kind: "agent", of: "Codex", billing: "plan" },
      anthropic: { name: "Anthropic", kind: "provider", of: "Anthropic", billing: "metered" },
      sub: { name: "My gateway", kind: "provider", of: null, billing: "plan" },
      left: { name: "left", kind: "gone", of: null, billing: null },
      "?": { name: "?", kind: "gone", of: null, billing: null },
    });
    assert.deepEqual(accountsOf({}, []), {});
  });
});

describe("a span of days", () => {
  test("the last N days end today; from and to are taken as given; all time has neither", () => {
    assert.deepEqual(spanOf({ days: 1 }), { from: localDay(), to: localDay() });
    assert.deepEqual(spanOf({ days: 7 }), { from: dayBack(6), to: localDay() });
    assert.deepEqual(spanOf({ from: "2026-10-01", to: "2026-10-31" }), { from: "2026-10-01", to: "2026-10-31" });
    assert.deepEqual(spanOf({}), { from: null, to: null });
    assert.deepEqual(spanOf({ days: 0 }), { from: null, to: null });
  });
});

describe("the breakdown, over the store", () => {
  const ok = { status: "ok", httpStatus: 200 };
  /** A store with calls today and five days back, on a plan and on a metered key. */
  const filled = () => {
    const u = new UsageStore({ dataDir: ".", options: { logFile: "", broadcast: false, keepLastRequests: 50 } });
    /** @param {any} meta @param {any} tokens @param {any} [o] */
    const call = (meta, tokens, o = {}) => {
      const rec = u.start({ format: "anthropic", ...meta });
      if (o.back) rec.ts = new Date(Date.now() - o.back * DAY).toISOString();
      if (o.project) rec.memory = { project: o.project };
      u.finish(rec, { ...ok, ...(o.patch || {}), tokens }, o.table || null, { billing: o.billing });
    };
    const card = { "zeta-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 } };
    call({ model: "z/zeta-5", upstreamModel: "zeta-5", upstream: "z", ua: "OpenCode/2.4" }, { input: 1000, cacheRead: 1_000_000, cacheWrite: 100_000, output: 500 }, { table: card, project: "p1" });
    call({ model: "claude-code/sonnet", upstreamModel: "sonnet", upstream: "claude-code", ua: "Mozilla/5.0", api: "session" }, { input: 10, cacheRead: 90, output: 5 }, { billing: "plan", patch: { listCost: 0.4 }, project: "p2" });
    call({ model: "z/zeta-5", upstreamModel: "zeta-5", upstream: "z", ua: "OpenCode/2.4" }, { input: 7, output: 3 }, { table: card, back: 5, project: "p1" });
    return { u, card };
  };
  const cfgOf = (/** @type {any} */ card) => ({
    upstreams: [
      { id: "z", name: "Zeta", type: "anthropic-compatible", baseUrl: "https://zeta.example.test", pricing: card },
      { id: "claude-code", name: "Claude Code (agent via ACP)", type: "acp", acp: { command: "claude-agent-acp" } },
    ],
  });

  // (fails before: yes — no such answer: the page read /usage/days and summed the days itself)
  test("one answer: the span's days without their rows, its sums and rows, the accounts, the cache, who asked, what is kept", () => {
    const { u, card } = filled();
    const memory = { projectNamed: (/** @type {string} */ id) => (id === "p1" ? { id, name: "shop-api", cwd: "H:\\shop-api" } : id === "none" ? null : { id, name: null, cwd: null }) };
    const b = usageBreakdown({ usage: u, config: { get: () => cfgOf(card) }, memory }, { days: 7 });
    assert.equal(b.today, localDay());
    assert.deepEqual([b.from, b.to], [dayBack(6), localDay()]);
    assert.deepEqual(b.kept, { days: 2, first: dayBack(5), last: localDay(), keepDays: 400, file: null });
    assert.deepEqual(b.days.map((/** @type {any} */ d) => [d.day, d.requests]), [[localDay(), 2], [dayBack(5), 1]], "newest first");
    assert.equal("rows" in b.days[0] || "hours" in b.days[0], false, "a day here is its sums: the rows are the span's");
    assert.equal(b.total.requests, 3);
    assert.equal(b.total.rows.length, 2);
    assert.equal(b.total.hours.reduce((/** @type {number} */ a, /** @type {number} */ n) => a + n, 0), 3);
    assert.deepEqual(b.accounts, {
      z: { name: "Zeta", kind: "provider", of: null, billing: "metered" },
      "claude-code": { name: "Claude Code", kind: "agent", of: "Claude Code", billing: "plan" },
    });
    // 1M × ($2 − $0.20) − 100K × ($2.50 − $2); the agent's `sonnet` has a list price by its own word and no card here.
    assert.deepEqual(b.cache, { usd: 1.75, plan: 0, models: 1, unpriced: ["sonnet"], flat: [] });
    assert.equal(b.who.since, dayBack(5));
    assert.deepEqual(b.who.clients.map((/** @type {any} */ c) => [c.name, c.requests]), [["OpenCode", 2], ["Filament harness", 1]]);
    assert.deepEqual(b.who.projects.map((/** @type {any} */ p) => [p.id, p.name, p.cwd, p.requests]), [["p1", "shop-api", "H:\\shop-api", 2], ["p2", null, null, 1]], "a project in words, by memory's archive");
    assert.equal(b.memoryPurposes.learn, "Learning", "memory's purposes in words, for its own calls' rows");
    // Today alone: the day five back is no part of it, and what is kept is still said.
    const today = usageBreakdown({ usage: u, config: { get: () => cfgOf(card) }, memory }, { days: 1 });
    assert.deepEqual([today.total.requests, today.days.length, today.kept.days, today.who.requests], [2, 1, 2, 2]);
    // All time, and no memory to name a project: its id alone.
    const all = usageBreakdown({ usage: u, config: { get: () => cfgOf(card) }, memory: null }, {});
    assert.deepEqual([all.from, all.to, all.total.requests], [null, null, 3]);
    assert.deepEqual(all.who.projects.map((/** @type {any} */ p) => [p.id, p.name]), [["p1", null], ["p2", null]]);
    // Nothing kept yet.
    const none = usageBreakdown({ usage: new UsageStore({ dataDir: ".", options: { logFile: "", broadcast: false } }), config: { get: () => ({}) }, memory: null }, { days: 30 });
    assert.deepEqual(none.kept, { days: 0, first: null, last: null, keepDays: 400, file: null });
    assert.deepEqual([none.total.requests, none.days, none.accounts, none.cache, none.who], [0, [], {}, { usd: null, plan: 0, models: 0, unpriced: [], flat: [] }, { since: null, days: 0, requests: 0, clients: [], projects: [] }]);
  });
});

describe("GET /api/usage/breakdown", () => {
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  /** @type {string} */ let root;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-breakdown-"));
    up = await fakeUpstream(async () => anthropicReply("", { model: "m-1", stop: "end_turn", blocks: [{ type: "text", text: "ok." }], usage: { input_tokens: 30, output_tokens: 7, cache_read_input_tokens: 1000, cache_creation_input_tokens: 100 } }));
    shim = await startApp({
      memory: true,
      configure: (/** @type {any} */ cfg) => {
        // A request log, so the days are kept in their file as they are on a person's computer.
        cfg.observability.logFile = "requests.jsonl";
        cfg.upstreams = [{ id: "m", name: "Acme", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 } } }];
        cfg.routes = [{ match: "m-1", upstream: "m", upstreamModel: "{model}", enabled: true }];
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(root);
  });

  // (fails before: yes — 404: no such route)
  test("a real Filament answers it for the last days, names the account and the project, and refuses a day it cannot read", async () => {
    const cwd = realpathSync.native((mkdirSync(join(root, "shop-api")), join(root, "shop-api")));
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd, model: "m-1", preset: "plain" } });
    assert.equal(made.status, 200, await made.clone().text());
    const id = String((await made.json()).id);
    const turn = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "hello", stream: false } });
    assert.equal(turn.status, 200, await turn.clone().text());
    await turn.text();
    // And another tool's call at the front door.
    const direct = await shim.api("/v1/messages", { method: "POST", headers: { "user-agent": "OpenCode/2.4 (win32)", "anthropic-version": "2023-06-01" }, body: { model: "m-1", max_tokens: 50, messages: [{ role: "user", content: "hi" }] } });
    assert.equal(direct.status, 200, await direct.clone().text());
    await direct.text();

    const r = await shim.api("/api/usage/breakdown?days=7");
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.today, localDay());
    assert.deepEqual([b.from, b.to], [dayBack(6), localDay()]);
    assert.equal(b.total.requests, 2);
    assert.deepEqual(b.accounts, { m: { name: "Acme", kind: "provider", of: null, billing: "metered" } });
    assert.equal(b.kept.days, 1);
    assert.match(String(b.kept.file), /daily-usage\.json$/);
    // Two calls, each 1,000 read and 100 written: 2 × (1000 × $1.80 − 100 × $0.50) a million.
    assert.deepEqual(b.cache, { usd: 0.0035, plan: 0, models: 1, unpriced: [], flat: [] });
    assert.deepEqual(b.who.clients.map((/** @type {any} */ c) => [c.name, c.requests]).sort(), [["Filament harness", 1], ["OpenCode", 1]]);
    const mine = b.who.projects.find((/** @type {any} */ p) => p.id === projectIdOf(cwd));
    assert.deepEqual([mine?.name, mine?.cwd, mine?.requests], ["shop-api", cwd, 1]);
    assert.equal(b.who.projects.reduce((/** @type {number} */ n, /** @type {any} */ p) => n + p.requests, 0), 2, "every call is some project's, or none's");
    // /usage/days answers as it did: a day carries no part of who asked.
    const days = await (await shim.api("/api/usage/days?limit=1")).json();
    assert.deepEqual(Object.keys(days.days[0]).filter((k) => k === "clients" || k === "projects"), []);
    // All time, a span by its days, and a day it cannot read.
    assert.equal((await (await shim.api("/api/usage/breakdown")).json()).from, null);
    const span = await (await shim.api(`/api/usage/breakdown?from=${dayBack(40)}&to=${dayBack(10)}`)).json();
    assert.deepEqual([span.from, span.to, span.total.requests, span.kept.days], [dayBack(40), dayBack(10), 0, 1]);
    const bad = await shim.api("/api/usage/breakdown?from=yesterday");
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: "from/to must look like 2026-09-13" });
  });

  test("it is a read: no press, and a view-only device reads it as it reads the days", () => {
    assert.deepEqual(pressClass("GET /usage/breakdown"), { press: "no", why: NO_PRESS.reads });
    assert.equal(viewReads("GET", "/usage/breakdown"), true);
  });
});
