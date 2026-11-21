// @ts-check
// A model's backups as Backups › on a provider's page sets them (HarnessV4_Settings_Plan HS-5): the route that catches a name, its
// first provider and its backups; a new list kept as a route of the name's own right above the one that caught it,
// with that route's format and rule overrides, and taken away again once it holds nothing; only API providers, for a
// model of an API provider; the name still offered as its provider lists it, so its tick keeps working; and the page's
// view and write over the admin API, a stale write refused, a failing first provider answered by the backup.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { backupsOf, backupsProblem, withBackups, routeWords, AGENT_WHY } from "../src/core/backups.js";
import { aggregateModels, addsOnly } from "../src/core/routing.js";
import { modelRoutesView } from "../src/app/model-routes.js";
import { changeLines } from "../src/app/config-change.js";
import { describeDiff } from "../src/services/config/diff.js";
import { startApp, fakeUpstream } from "./helpers/app.js";

/** @param {Record<string, any>} r @returns {any} */
const route = (r) => ({ upstreamModel: "{1}", format: "auto", fallbacks: [], strategy: "in_order", discoverPrefixes: [], enabled: true, rules: {}, ...r });

/** Z.AI and OpenRouter as API providers, Claude Code as a coding agent, and a console route with a pattern. */
const cfgOf = () => ({
  rules: { resilience: { failover: true } },
  upstreams: [
    { id: "zai", name: "Z.AI", type: "openai-compatible", baseUrl: "http://z.invalid", enabled: true, discoverModels: false, models: ["glm-5.3", "glm-4.5"], hiddenModels: [] },
    { id: "or", name: "OpenRouter", type: "openai-compatible", baseUrl: "http://o.invalid", enabled: true, discoverModels: false, models: ["z-ai/glm-5.3", "x/grok"], hiddenModels: [] },
    { id: "cc", name: "Claude Code", type: "acp", baseUrl: "acp://local", enabled: true, models: ["sonnet"], hiddenModels: [] },
  ],
  routes: [
    route({ match: "cc/*", upstream: "cc" }),
    route({ match: "zai/*", upstream: "zai" }),
    route({ match: "or/*", upstream: "or" }),
    route({ match: "fast-*", upstream: "zai", upstreamModel: "{model}", format: "openai", rules: { effort: { allowed: ["low"] } } }),
  ],
});

describe("a name's backups (core/backups.js)", () => {
  // (fails before: yes — no such module; backups were the console's route editor only)
  test("a name caught by its provider's prefix route: its first provider, the name sent, no backups, and settable", () => {
    const at = backupsOf(cfgOf(), "zai/glm-5.3");
    assert.deepEqual(at && { ...at }, { index: 1, match: "zai/*", exact: false, upstream: "zai", sent: "glm-5.3", backups: [], strategy: "in_order", format: "auto", ruleOverrides: 0, can: true, why: null });
    assert.equal(backupsOf(cfgOf(), "nobody/x"), null);
  });

  // (fails before: yes — HC-70)
  test("backups go on a route of the name's own, right above the route that caught it; the old configuration is left", () => {
    const cfg = cfgOf();
    const before = JSON.stringify(cfg);
    const next = withBackups(cfg, "zai/glm-5.3", [{ upstream: "or", upstreamModel: " z-ai/glm-5.3 " }]);
    assert.equal(JSON.stringify(cfg), before, "a copy");
    assert.deepEqual(next.routes.map((/** @type {any} */ r) => r.match), ["cc/*", "zai/glm-5.3", "zai/*", "or/*", "fast-*"]);
    assert.deepEqual(next.routes[1], route({ match: "zai/glm-5.3", upstream: "zai", upstreamModel: "glm-5.3", fallbacks: [{ upstream: "or", upstreamModel: "z-ai/glm-5.3" }] }));
    const at = backupsOf(next, "zai/glm-5.3");
    assert.deepEqual([at?.exact, at?.backups], [true, [{ upstream: "or", sent: "z-ai/glm-5.3" }]]);
    // a second change edits that route; taking every backup off takes it away, and the name goes where it went before
    const two = withBackups(next, "zai/glm-5.3", [{ upstream: "or", upstreamModel: "x/grok" }, { upstream: "or", upstreamModel: "z-ai/glm-5.3" }]);
    assert.equal(two.routes.length, 5);
    assert.deepEqual(two.routes[1].fallbacks.map((/** @type {any} */ f) => f.upstreamModel), ["x/grok", "z-ai/glm-5.3"]);
    assert.equal(JSON.stringify(withBackups(two, "zai/glm-5.3", [])), before, "HC-97: as it was");
  });

  // (fails before: yes — HC-98)
  test("a name caught by a console pattern gets that route's format and rule overrides; with its own rules it stays", () => {
    const next = withBackups(cfgOf(), "fast-glm", [{ upstream: "or", upstreamModel: "z-ai/glm-5.3" }]);
    const own = next.routes.find((/** @type {any} */ r) => r.match === "fast-glm");
    assert.deepEqual([own.upstreamModel, own.format, own.rules], ["fast-glm", "openai", { effort: { allowed: ["low"] } }]);
    assert.equal(next.routes.indexOf(own), 3, "right above fast-*");
    // a route of the name's own that holds more than its backups keeps that when they go
    const ruled = structuredClone(next);
    ruled.routes[3].rules = { effort: { allowed: ["high"] } };
    const off = withBackups(ruled, "fast-glm", []);
    assert.deepEqual(off.routes[3].match, "fast-glm");
    assert.deepEqual(off.routes[3].fallbacks, []);
  });

  // (fails before: yes — HC-94, HC-99, HC-102, HS-D59)
  test("what cannot be kept is said: an agent's model, a pattern's own backups, an agent as backup, repeats, no name", () => {
    assert.deepEqual([backupsOf(cfgOf(), "cc/sonnet")?.can, backupsOf(cfgOf(), "cc/sonnet")?.why], [false, AGENT_WHY]);
    const withPattern = cfgOf();
    withPattern.routes[3].fallbacks = [{ upstream: "or", upstreamModel: "x/grok" }];
    const at = backupsOf(withPattern, "fast-glm");
    assert.equal(at?.can, false);
    assert.match(String(at?.why), /route fast-\*'s, set in the console/);
    assert.deepEqual(at?.backups, [{ upstream: "or", sent: "x/grok" }]);
    const said = (/** @type {any} */ rows, name = "zai/glm-5.3", cfg = cfgOf()) => backupsProblem(cfg, name, rows);
    assert.equal(said([{ upstream: "or", upstreamModel: "z-ai/glm-5.3" }]), null);
    assert.deepEqual(said([{ upstream: "cc", upstreamModel: "sonnet" }]), { status: 400, words: "Claude Code is a coding agent: a backup is a provider's API, so the agent loop can still run on zai/glm-5.3." });
    assert.deepEqual(said([{ upstream: "zai", upstreamModel: "GLM-5.3" }]), { status: 400, words: "Z.AI as GLM-5.3 is where zai/glm-5.3 goes first." });
    assert.deepEqual(said([{ upstream: "or", upstreamModel: "x/grok" }, { upstream: "or", upstreamModel: "X/Grok" }]), { status: 400, words: "OpenRouter as X/Grok is in the list twice." });
    assert.deepEqual(said([{ upstream: "or", upstreamModel: "  " }]), { status: 400, words: "Type the model's name at OpenRouter." });
    assert.deepEqual(said([{ upstream: "or", upstreamModel: "{model}" }]), { status: 400, words: "A model's name has no braces or commas: {model}" });
    assert.deepEqual(said([{ upstream: "nope", upstreamModel: "x" }]), { status: 400, words: 'There is no provider "nope".' });
    assert.deepEqual(said("or"), { status: 400, words: "Backups are a list of providers, each with the model's name there." });
    assert.deepEqual(said([], "cc/sonnet"), { status: 409, words: AGENT_WHY });
    assert.deepEqual(said([], "nobody/x"), { status: 404, words: "No route takes nobody/x: it is in no picker." });
  });

  // (fails before: yes — HC-72, HC-105)
  test("a route the page does not draw, in words", () => {
    const cfg = cfgOf();
    assert.equal(routeWords(cfg, cfg.routes[3]), "Names like fast-* go to Z.AI as asked; OpenAI's format only; 1 rule override");
    assert.equal(routeWords(cfg, route({ match: "*", upstream: "gone", upstreamModel: "{model}", enabled: false })), "Every other name goes to gone (gone) as asked; switched off");
    assert.equal(
      routeWords(cfg, route({ match: "free-model", upstream: "or", upstreamModel: "x/grok", fallbacks: [{ upstream: "zai", upstreamModel: "glm-4.5" }], strategy: "round_robin" })),
      "The name free-model goes to OpenRouter as x/grok; then Z.AI; chosen taking turns",
    );
  });

  // (fails before: yes — HS-5's drive: a route's backups changed read "route.fallbacks: [object Object] → [object Object]")
  test("a change line says a route's backups as JSON, a list of names as words, an empty one as a dash", () => {
    const was = withBackups(cfgOf(), "zai/glm-5.3", [{ upstream: "or", upstreamModel: "z-ai/glm-5.3" }]);
    const now = structuredClone(was);
    now.routes.find((/** @type {any} */ r) => r.match === "zai/glm-5.3").fallbacks = [{ upstream: "or", upstreamModel: "x/grok" }];
    now.upstreams[0].hiddenModels = ["glm-4.5", "glm-5.3"];
    assert.deepEqual(changeLines(describeDiff(was, now)), [
      "upstreams.zai.hiddenModels: – → glm-4.5,glm-5.3",
      'routes.zai/glm-5.3.fallbacks: [{"upstream":"or","upstreamModel":"z-ai/glm-5.3"}] → [{"upstream":"or","upstreamModel":"x/grok"}]',
    ]);
  });
});

describe("a name a route only adds to is offered as its provider lists it (HS-D62)", () => {
  // (fails before: yes — an exact route's name was always offered, so a model with backups could not be hidden)
  test("its place in the list, its tick, and a name no list has stays offered by its route", async () => {
    const cfg = withBackups(cfgOf(), "zai/glm-5.3", [{ upstream: "or", upstreamModel: "z-ai/glm-5.3" }]);
    assert.equal(addsOnly(cfg, 1), true);
    const ids = async (/** @type {any} */ c) => (await aggregateModels(c)).models.filter((/** @type {any} */ m) => m.upstream === "zai").map((/** @type {any} */ m) => `${m.id}:${m.source}`);
    assert.deepEqual(await ids(cfg), ["zai/glm-5.3:discovered", "zai/glm-4.5:discovered"]);
    const hidden = structuredClone(cfg);
    hidden.upstreams[0].hiddenModels = ["glm-5.3"];
    assert.deepEqual(await ids(hidden), ["zai/glm-4.5:discovered"]);
    // a name Z.AI does not list: its route makes it, so it is offered whatever is hidden
    const unlisted = withBackups(cfgOf(), "zai/glm-9", [{ upstream: "or", upstreamModel: "x/grok" }]);
    unlisted.upstreams[0].hiddenModels = ["glm-9"];
    assert.deepEqual(await ids(unlisted), ["zai/glm-9:route", "zai/glm-5.3:discovered", "zai/glm-4.5:discovered"]);
  });
});

describe("the models view Backups › reads (app/model-routes.js)", () => {
  // (fails before: yes — HC-93, HC-94, HC-95, HC-72, HC-104)
  test("every family with its first provider and backups, the providers that can back up, the routes not drawn", async () => {
    const cfg = withBackups(cfgOf(), "zai/glm-5.3", [{ upstream: "or", upstreamModel: "z-ai/glm-5.3" }, { upstream: "or", upstreamModel: "x/typed" }]);
    cfg.upstreams[0].hiddenModels = ["glm-4.5"];
    cfg.upstreams[1].models.push("x/grok-fast");
    const base = { ...cfg, upstreams: cfg.upstreams.map((/** @type {any} */ u) => ({ ...u, hiddenModels: [] })) };
    const v = modelRoutesView(cfg, base, await aggregateModels(base));
    /** @param {string} id @returns {any} */
    const row = (id) => v.models.find((/** @type {any} */ m) => m.id === id);
    assert.deepEqual(v.models.map((/** @type {any} */ m) => m.id), ["zai/glm-5.3", "zai/glm-4.5", "or/z-ai/glm-5.3", "or/x/grok", "cc/sonnet"], "in the providers' order");
    const glm = row("zai/glm-5.3");
    assert.deepEqual([glm.upstream, glm.sent, glm.route, glm.can, glm.why], [{ id: "zai", name: "Z.AI", agent: false, enabled: true }, "glm-5.3", { match: "zai/glm-5.3", exact: true }, true, null]);
    assert.deepEqual(glm.backups, [
      { id: "or", name: "OpenRouter", agent: false, enabled: true, sent: "z-ai/glm-5.3", listed: true },
      { id: "or", name: "OpenRouter", agent: false, enabled: true, sent: "x/typed", listed: false },
    ]);
    assert.deepEqual(glm.members, [{ id: "zai/glm-5.3", name: "glm-5.3", hidable: true, hidden: false }]);
    assert.deepEqual(row("zai/glm-4.5").members[0].hidden, true);
    assert.deepEqual([row("cc/sonnet").can, row("cc/sonnet").why, row("cc/sonnet").upstream.agent], [false, AGENT_WHY, true]);
    const grok = row("or/x/grok");
    assert.deepEqual([grok.kind, grok.lead, grok.alone], ["variants", "or/x/grok", ["or/x/grok-fast"]]);
    assert.deepEqual(v.providers.map((/** @type {any} */ p) => p.id), ["zai", "or"], "no coding agent backs up");
    assert.deepEqual(v.providers[1].names, ["z-ai/glm-5.3", "x/grok", "x/grok-fast"]);
    assert.deepEqual(v.routes, [{ match: "fast-*", upstream: "zai", enabled: true, words: "Names like fast-* go to Z.AI as asked; OpenAI's format only; 1 rule override" }]);
    assert.equal(v.failover, true);
  });
});

describe("GET and PUT /api/model-routes", () => {
  let failZ = false;
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let z;
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let o;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let s;
  before(async () => {
    z = await fakeUpstream((call) => (failZ && call.kind === "openai" ? { status: 503, json: { error: { message: "overloaded" } } } : undefined));
    o = await fakeUpstream();
    s = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "zai", name: "Z.AI", type: "openai-compatible", baseUrl: z.url, apiKey: "s", enabled: true, discoverModels: false, models: ["glm-5.3"] },
          { id: "or", name: "OpenRouter", type: "openai-compatible", baseUrl: o.url, apiKey: "s", enabled: true, discoverModels: false, models: ["z-ai/glm-5.3"] },
        ];
        cfg.routes = [route({ match: "zai/*", upstream: "zai" }), route({ match: "or/*", upstream: "or" })];
        cfg.rules.resilience.failover = true; // a backup kept is tried: off until switched on (the owner's of 11-09)
      },
    });
  });
  after(async () => {
    await s?.stop();
    await z?.close();
    await o?.close();
  });
  const view = async () => (await s.api("/api/model-routes")).json();
  /** @param {any} body */
  const put = async (body) => {
    const r = await s.api("/api/model-routes", { method: "PUT", body });
    return { status: r.status, json: await r.json() };
  };
  const onDisk = () => JSON.parse(readFileSync(join(s.dataDir, "config.json"), "utf8"));

  // (fails before: yes — no such routes; HC-70, HC-107 without a network)
  test("a backup kept answers when the first provider fails, under the backup's name for the model", async () => {
    const v0 = await view();
    assert.deepEqual(v0.models.map((/** @type {any} */ m) => m.id), ["zai/glm-5.3", "or/z-ai/glm-5.3"]);
    const r = await put({ name: "zai/glm-5.3", backups: [{ upstream: "or", upstreamModel: "z-ai/glm-5.3" }], base: v0.version });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.version, v0.version + 1);
    assert.deepEqual(r.json.models[0].backups.map((/** @type {any} */ b) => `${b.id}:${b.sent}`), ["or:z-ai/glm-5.3"]);
    assert.deepEqual(onDisk().routes.map((/** @type {any} */ x) => x.match), ["zai/glm-5.3", "zai/*", "or/*"]);
    failZ = true;
    const res = await s.post("/v1/messages", { model: "zai/glm-5.3", max_tokens: 50, messages: [{ role: "user", content: "hi" }] });
    assert.equal(res.status, 200);
    assert.equal(o.received.at(-1)?.body?.model, "z-ai/glm-5.3");
    const rec = await s.record(String(res.headers.get("x-filament-request-id")));
    assert.equal(rec.upstream, "or");
    assert.equal(rec.failover?.servedBy, "or");
    assert.deepEqual(rec.failover?.trail?.map((/** @type {any} */ t) => t.upstream), ["zai"]);
    failZ = false;
  });

  // (fails before: yes — HC-100: two windows on one model's backups)
  test("a page read before another change to that model's route is refused with what changed; another model's is not", async () => {
    const v = await view();
    const first = await put({ name: "zai/glm-5.3", backups: [], base: v.version });
    assert.equal(first.status, 200);
    const stale = await put({ name: "zai/glm-5.3", backups: [{ upstream: "or", upstreamModel: "z-ai/glm-5.3" }], base: v.version });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.stale, true);
    assert.match(stale.json.error, /zai\/glm-5\.3's backups changed since this page read them/);
    // (fails before: yes — HS-5's drive: the line read "route.fallbacks: [object Object] → –")
    assert.deepEqual(stale.json.changes, ["they were OpenRouter as z-ai/glm-5.3; now none"]);
    // the route of zai/glm-5.3 changed; or/z-ai/glm-5.3's did not, so a write to it from the old read is kept
    const other = await put({ name: "or/z-ai/glm-5.3", backups: [{ upstream: "zai", upstreamModel: "glm-5.3" }], base: v.version });
    assert.equal(other.status, 200, JSON.stringify(other.json));
    assert.equal((await put({ name: "or/z-ai/glm-5.3", backups: [], base: other.json.version })).status, 200);
    assert.deepEqual(onDisk().routes.map((/** @type {any} */ x) => x.match), ["zai/*", "or/*"], "as it was");
  });

  // (fails before: yes — HC-101, HS-D62)
  test("a model with backups can still be taken out of the picker", async () => {
    const v = await view();
    await put({ name: "zai/glm-5.3", backups: [{ upstream: "or", upstreamModel: "z-ai/glm-5.3" }], base: v.version });
    const offered = async () => (await (await s.api("/api/models")).json()).models.map((/** @type {any} */ m) => m.id);
    assert.ok((await offered()).includes("zai/glm-5.3"));
    const st = await (await s.api("/api/upstreams")).json();
    const r = await s.api("/api/upstreams/zai", { method: "PATCH", body: { hiddenModels: ["glm-5.3"], base: st.version } });
    assert.equal(r.status, 200);
    assert.ok(!(await offered()).includes("zai/glm-5.3"));
    const row = (await view()).models.find((/** @type {any} */ m) => m.id === "zai/glm-5.3");
    assert.deepEqual([row.members[0].hidable, row.members[0].hidden, row.backups.length], [true, true, 1]);
  });
});
