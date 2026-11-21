// @ts-check
// The front door (HarnessV3-Launch L2). LD-D1: one rule for whether a model can answer, read by Get started, Home's
// hero and `--open`; LD-D2: Get started's facts come from the server.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { upstreamCanAnswer, modelsThatAnswer, frontDoorUrl, startFacts } from "../src/app/readiness.js";
import { buildFamilies } from "../src/core/model-families.js";
import { startSteps, createGetStarted, createStartReader, startActions } from "../src/ui/components/get-started.js";
import { PAGES, HELP_TABS, TAB_ALIAS, HOME_PANES, parseHash, palettePages } from "../src/ui/nav.js";
import { bindUi, state as uiState } from "../src/ui/runtime.js";
import { overview } from "../src/ui/pages/home.js";
import { fmt } from "../src/ui/lib/format.js";
import { startApp, fakeUpstream } from "./helpers/app.js";
import { loadConfig } from "../src/config.js";
import { until } from "./helpers/wait.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { emptyList, pickerFoot } from "../src/ui/harness/composer/model.js";
import { CONNECT_URL, CONSOLE_WINDOW } from "../src/ui/harness/lib/catalogue.js";

describe("a model can answer (LD-D1)", () => {
  // (fails before: yes — there was no rule: Home said "Ready" with nothing behind it, and `--open` opened the console always)
  test("an upstream can answer when it is enabled and holds what its type needs", () => {
    const http = { id: "z", type: "openai-compatible", baseUrl: "https://api.z.ai/api/coding/paas/v4" };
    assert.equal(upstreamCanAnswer({ ...http, apiKey: "k" }), true, "a key");
    assert.equal(upstreamCanAnswer(http), false, "no key");
    assert.equal(upstreamCanAnswer({ ...http, apiKey: "k", enabled: false }), false, "switched off");
    assert.equal(upstreamCanAnswer({ id: "o", type: "openai-compatible", baseUrl: "http://localhost:11434/v1" }), true, "a local server the catalogue marks keyless");
    assert.equal(upstreamCanAnswer({ id: "cc", type: "acp", acp: { command: "claude" } }), true, "a coding agent brings its own login");
    assert.equal(upstreamCanAnswer({ id: "cs", type: "cursor-sdk" }), false, "the Cursor SDK needs its key");
    assert.equal(upstreamCanAnswer({ id: "cs", type: "cursor-sdk", apiKey: "k" }), true);
    assert.equal(upstreamCanAnswer({ id: "q", type: "qoder" }), false, "Qoder before its login");
    assert.equal(upstreamCanAnswer({ id: "q", type: "qoder", qoder: { accessToken: "t", userId: "u" } }), true, "Qoder's login");
    assert.equal(upstreamCanAnswer({ id: "q", type: "qoder", apiKey: "pt-x" }), true, "or a personal token");
    assert.equal(upstreamCanAnswer(null), false);
  });

  test("the models that answer: a model on an upstream that can, never its twins or a model not for chat", () => {
    const cfg = {
      upstreams: [
        { id: "z", type: "openai-compatible", baseUrl: "https://example.test/v1", apiKey: "k" },
        { id: "bare", type: "anthropic", baseUrl: "https://api.anthropic.com" },
        { id: "cc", type: "acp", acp: { command: "claude" } },
      ],
      routes: [],
    };
    const models = [
      { id: "z/glm", upstream: "z", upstreamModel: "glm", source: "discovered" },
      { id: "z/glm-high", upstream: "z", upstreamModel: "glm", source: "effort-variant" },
      { id: "z/text-embedding-3", upstream: "z", upstreamModel: "text-embedding-3", source: "discovered" },
      { id: "bare/claude", upstream: "bare", upstreamModel: "claude", source: "discovered" },
      { id: "claude-code/sonnet", upstream: "cc", upstreamModel: "sonnet", source: "discovered" },
    ];
    assert.deepEqual(modelsThatAnswer(cfg, models).map((m) => m.id), ["z/glm", "claude-code/sonnet"]);
  });

  // (fails before: yes, for the families — they left out every row of an upstream named agent-loop, the upstream the
  // loop's own names once carried)
  test("an upstream of yours may carry the loop's record name: its models answer, and are the families'", () => {
    // Upstream ids are yours to choose: one may carry the name the loop's own records give their upstream.
    const keyed = (/** @type {string} */ id) => ({ id, type: "openai-compatible", baseUrl: "https://example.test/v1", apiKey: "k" });
    const cfg = { upstreams: [keyed("agent-loop")], routes: [] };
    const models = [{ id: "agent-loop/glm", upstream: "agent-loop", upstreamModel: "glm", source: "discovered" }];
    assert.deepEqual(modelsThatAnswer(cfg, models).map((m) => m.id), ["agent-loop/glm"], "the upstream itself answers");
    assert.deepEqual(buildFamilies(cfg, models).flatMap((f) => f.members.map((/** @type {any} */ m) => m.id)), ["agent-loop/glm"]);
  });

  test("--open lands on the harness once a model can answer, on the console's Home before that", () => {
    assert.equal(frontDoorUrl("http://127.0.0.1:20300", 0), "http://127.0.0.1:20300/");
    assert.equal(frontDoorUrl("http://127.0.0.1:20300", 3), "http://127.0.0.1:20300/ui/harness.html");
    const bin = readFileSync("bin/filament.js", "utf8");
    assert.match(bin, /app\.start\(\)\.then\(\(\{ host, port, created, configFile, answering, engine, lan \}\) =>/, "start() says how many models answer");
    assert.match(bin, /const door = frontDoorUrl\(url, answering\);/, "the CLI opens what the rule says");
    assert.match(bin, /\["cmd", \["\/c", "start", "", door\]\]/, "on Windows too");
  });
});

describe("the console's way into the harness, and its one name (LD-D1)", () => {
  // (fails before: yes — no link to the harness anywhere in the console, and its tab said "Home · Filament")
  test("the sidebar opens the harness above Home, in one window of its own; the console calls itself the console", () => {
    const html = readFileSync("src/ui/index.html", "utf8");
    const link = /<a class="harness-link" id="open-harness" href="\/ui\/harness\.html" target="filament-harness"[^>]*>[\s\S]*?<span class="label">Open the harness<\/span>[\s\S]*?<\/a>/.exec(html);
    assert.ok(link, "the entry, a link to the harness in its own named window");
    assert.ok(html.indexOf(link[0]) < html.indexOf('<nav id="tabs">'), "above the console's own pages");
    assert.ok(html.indexOf(link[0]) > html.indexOf('<div class="brand">'), "under the brand");
    assert.match(html, /<title>Filament console<\/title>/);
    assert.match(html, /<span class="brand-text"><b>Filament<\/b><small>console · <span id="version"><\/span><\/small><\/span>/, "the brand names it");
    const app = readFileSync("src/ui/app.js", "utf8");
    assert.match(app, /document\.title = `\$\{title\} · Filament console`;/, "every page's tab");
    assert.match(app, /\$\("#version"\)\.textContent = `v\$\{st\.version\}`;/, "the version still fills its slot");
    const css = readFileSync("src/ui/style.css", "utf8");
    assert.match(css, /html\[data-nav=collapsed\] \.harness-link \.label/, "a collapsed sidebar keeps its icon");
  });
});

describe("a provider Filament has no list for says so (LD-D3)", () => {
  // (fails before: yes — L2's tour, tour4: a provider set up outside the console read "Not set up yet: connect a model"
  // over requests that worked, and its models appeared nowhere)
  test("set up outside the console: named until its models are listed, then a model can answer", async () => {
    const acme = await fakeUpstream((call) =>
      call.method === "GET" ? { json: { data: [{ id: "echo-1", type: "model", display_name: "Echo 1" }], has_more: false } } : undefined,
    );
    const t = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "acme", name: "Acme AI", type: "anthropic", baseUrl: acme.url, apiKey: "k-test", enabled: true }];
        cfg.routes = [{ match: "echo-*", upstream: "acme", upstreamModel: "{model}", enabled: true }];
      },
    });
    try {
      let f = await (await t.api("/api/start")).json();
      assert.deepEqual([f.connected.ok, f.connected.unlisted], [false, ["Acme AI"]]);
      assert.equal((await (await t.api("/api/models")).json()).upstreams.acme?.unasked, true, "the Destinations card says so too");
      assert.equal(acme.received.length, 0, "a read never asks");
      const listed = await t.api("/api/models?refresh=1");
      assert.equal(listed.status, 200, await listed.clone().text());
      f = await (await t.api("/api/start")).json();
      assert.deepEqual([f.connected.ok, f.connected.example, f.connected.unlisted], [true, "echo-1", []]);
    } finally {
      await t.stop();
      await acme.close();
    }
  });

  test("named: can answer, a route reaches it, nothing asked it, and the catalogue lists none of its models", async () => {
    const up = (/** @type {string} */ id, extra = {}) => ({ id, name: `${id} name`, type: "anthropic", apiKey: "k", enabled: true, ...extra });
    const cfg = {
      upstreams: [up("bare"), up("keyless", { apiKey: "" }), up("unrouted"), up("asked"), up("named"), up("off", { enabled: false }), up("routeoff")],
      // (fails before: no — L2's mutation pass: a route switched off reaches nothing)
      routes: [
        ...["bare", "keyless", "asked", "named", "off"].map((id) => ({ match: `${id}/*`, upstream: id, upstreamModel: "{1}", enabled: true })),
        { match: "routeoff/*", upstream: "routeoff", upstreamModel: "{1}", enabled: false },
      ],
    };
    const models = [{ id: "named/m", upstream: "named", upstreamModel: "m", source: "route" }];
    const discoveryOf = (/** @type {string} */ id) => (id === "asked" ? null : { asking: false, unasked: true });
    const f = await startFacts({ cfg, models, memory: null, discoveryOf });
    assert.deepEqual(f.connected.unlisted, ["bare name"]);
    assert.deepEqual((await startFacts({ cfg, models, memory: null })).connected.unlisted, [], "with no word on what was asked, none is named");
  });

  test("step 1 names them, with the click that lists their models", async () => {
    const { draw, calls } = drawn();
    const one = draw.steps(factsOf({ unlisted: ["Acme AI"] }), O);
    // (fails before: no — L2's mutation pass: one name is the sentence's start, with nothing joined before it)
    const said = classed(one, "small").map(textOf);
    assert.ok(said.includes("Acme AI is set up, but Filament has no list of its models yet."), said.join(" / "));
    assert.doesNotMatch(textOf(one), /Until one is connected/, "something is connected");
    const list = buttonsOf(one).find((b) => textOf(b) === "List its models");
    assert.ok(list, "the click that asks");
    assert.ok(!buttonsOf(one).some((b) => textOf(b) === "Connect a model"));
    await list.attrs.onclick();
    assert.deepEqual(calls.at(-1), ["listModels"]);
    const three = draw.steps(factsOf({ unlisted: ["Acme AI", "Beta", "Gamma"] }), O);
    assert.match(textOf(three), /Acme AI, Beta and Gamma are set up, but Filament has no list of their models yet\./);
    assert.ok(buttonsOf(three).some((b) => textOf(b) === "List their models"));
    assert.match(textOf(draw.steps(factsOf({ unlisted: ["Acme AI", "Beta"] }), O)), /Acme AI and Beta are set up/);
    const answering = draw.steps(factsOf({ ok: true, models: 1, example: "m-1", unlisted: ["Beta"] }), O);
    assert.doesNotMatch(textOf(answering), /no list of/, "once a model can answer, step 1 is done");
  });

  test("List its models: the providers asked, one that did not answer said, and the facts read again", async () => {
    /** @type {any[]} */
    const log = [];
    const acts = startActions({
      api: async (path) => {
        log.push(["api", path]);
        return { upstreams: { acme: { count: 3 }, beta: { count: 0, error: "401 Unauthorized" } } };
      },
      toast: (msg, kind = "ok") => log.push(["toast", msg, kind]),
      copies: () => [],
      refresh: () => log.push(["refresh"]),
    });
    await acts.listModels();
    assert.deepEqual(log, [["api", "/models?refresh=1"], ["toast", "beta did not list its models: 401 Unauthorized", "err"], ["refresh"]]);
    // (fails before: no — L2's mutation pass: a Refresh every provider answered says nothing; the step ticks)
    const fine = startActions({
      api: async (path) => {
        log.push(["api", path]);
        return { upstreams: { acme: { count: 3 } } };
      },
      toast: (msg, kind = "ok") => log.push(["toast", msg, kind]),
      copies: () => [],
      refresh: () => log.push(["refresh"]),
    });
    log.length = 0;
    await fine.listModels();
    assert.deepEqual(log, [["api", "/models?refresh=1"], ["refresh"]]);
    const down = startActions({
      api: async () => {
        throw new Error("the server went away");
      },
      toast: (msg, kind = "ok") => log.push(["toast", msg, kind]),
      copies: () => [],
      refresh: () => log.push(["refresh"]),
    });
    log.length = 0;
    await down.listModels();
    assert.deepEqual(log, [["toast", "the server went away", "err"], ["refresh"]]);
  });

  test("Home's hero: almost set up, with their models to list", () => {
    let facts = factsOf({ unlisted: ["Acme AI"] });
    const { draw } = drawn();
    Object.assign(uiState, {
      homePane: "status",
      requests: [],
      summary: {},
      keys: ["sk-local-key"],
      config: { server: { host: "127.0.0.1", port: 20300 }, upstreams: [{ id: "acme", type: "anthropic", apiKey: "k" }], routes: [], rules: {} },
    });
    const later = () => new Promise(() => {});
    bindUi({
      h: fakeH, fmt, HOME_PANES, api: later, memStatus: later,
      goto: (/** @type {string} */ _tab, /** @type {string} */ label) => fakeH("a", {}, label),
      go() {}, render() {}, toast() {}, empty: (/** @type {string} */ title) => fakeH("div", {}, title),
      copyline: (/** @type {string} */ text) => fakeH("code", { class: "copyline" }, text),
      secretLine: (/** @type {string} */ key) => fakeH("code", { class: "secret" }, `${key.slice(0, 3)}…`),
      requestsTable: () => fakeH("table"), liveTree: () => [], liveRow: () => fakeH("div"), startLiveTicker() {},
      store: { get: () => null, set() {} },
      getStarted: draw,
      startFacts: () => facts,
    });
    const hero = classed(overview(), "hero")[0];
    assert.match(textOf(hero), /Almost set up: list your models/);
    assert.match(textOf(hero), /Filament is running, but it has no list of your provider's models yet, so no model can answer\./);
    assert.doesNotMatch(textOf(hero), /connect a model/);
    // (fails before: no — L2's mutation pass: two providers are two)
    facts = factsOf({ unlisted: ["Acme AI", "Beta"] });
    assert.match(textOf(classed(overview(), "hero")[0]), /no list of your providers' models yet/);
  });

  // The console's shell needs a browser: what it hands the builder is pinned by its source.
  test("the console's shell hands Get started the click", () => {
    const app = readFileSync("src/ui/app.js", "utf8");
    assert.ok(app.includes("listModels: startActs.listModels"), "List its models asks through the page's actions");
  });
});

describe("Get started's facts come from the server (LD-D2)", () => {
  // (fails before: yes — no /api/start; the page guessed from the redacted config, which knows no catalogue)
  test("a fresh install: nothing answers, memory is off, the harness has no task, and start() says none answers", async () => {
    const t = await startApp();
    try {
      assert.equal(t.started.answering, 0);
      const f = await (await t.api("/api/start")).json();
      assert.deepEqual(f.connected, { ok: false, models: 0, example: null, unlisted: [] });
      assert.equal(f.memory.enabled, false);
      assert.equal(f.memory.summarizer, "", "memory's model as set: none");
      assert.equal(f.harness.used, false);
    } finally {
      await t.stop();
    }
  });

  test("a provider with a key and a model: it answers; a harness task ticks the harness", async () => {
    const t = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "m", name: "m", type: "anthropic", baseUrl: "http://127.0.0.1:9", apiKey: "s", enabled: true },
          { id: "off", name: "off", type: "anthropic", baseUrl: "http://127.0.0.1:9", enabled: true },
        ];
        cfg.routes = [
          { match: "m-1", upstream: "m", upstreamModel: "{model}", enabled: true },
          { match: "keyless-1", upstream: "off", upstreamModel: "{model}", enabled: true },
        ];
      },
    });
    try {
      assert.equal(t.started.answering, 1, "start() counts the model on the keyed upstream alone");
      const f = await (await t.api("/api/start")).json();
      assert.deepEqual(f.connected, { ok: true, models: 1, example: "m-1", unlisted: [] }, "a provider whose model a route names is not unlisted, asked or not");
      assert.equal(f.memory.enabled, true);
      assert.equal(f.harness.used, false, "no task yet");
      const made = await t.api("/api/sessions", { method: "POST", body: { cwd: t.dataDir, autoTitle: true } });
      assert.equal(made.status, 200, await made.clone().text());
      const after = await (await t.api("/api/start")).json();
      assert.equal(after.harness.used, true, "a task made on the page");
    } finally {
      await t.stop();
    }
  });

  // (fails before: yes — L2's mutation pass: a finished install, or another job running, drew as the install in progress,
  // and memory's model as set was never read back)
  test("the install in progress is an install that runs; memory's model is said as set", async () => {
    const running = { id: "install-2", kind: "install", status: "running" };
    /** Memory's facts for a status with these jobs. @param {any[]} jobs */
    const memoryWith = async (jobs) =>
      (
        await startFacts({
          cfg: { upstreams: [], routes: [] },
          models: [],
          memory: {
            status: async () => ({ enabled: true, engine: { installed: false }, jobs }),
            models: () => ({ summarizer: "off", now: null, from: "off", whyNone: "memory's model is off (Settings › Memory › Model)" }),
            sessions: () => [],
          },
        })
      ).memory;
    const busy = await memoryWith([{ id: "install-1", kind: "install", status: "done" }, { id: "update-1", kind: "update", status: "running" }, running]);
    assert.deepEqual(busy.installing, running, "the one install that runs, not one that ended nor another job");
    const idle = await memoryWith([{ id: "install-1", kind: "install", status: "failed" }, { id: "backup-1", kind: "backup", status: "running" }]);
    assert.equal(idle.installing, null);
    assert.equal(idle.summarizer, "off", "as set: \"learns nothing\" reads differently when it was asked for");
  });

  // (fails before: yes — the facts said nothing of a bundle (HarnessV3-AtHome AH-D2), so the step promised a download)
  test("whether the bundle that came with Filament is here: the status's word, false when it has none", async () => {
    /** @param {any} engine */
    const factsWith = async (engine) =>
      (
        await startFacts({
          cfg: { upstreams: [], routes: [] },
          models: [],
          memory: { status: async () => ({ enabled: true, engine, jobs: [] }), models: () => null, sessions: () => [] },
        })
      ).memory.bundled;
    assert.equal(await factsWith({ installed: false, bundle: { ready: true, why: null, current: false } }), true);
    assert.equal(await factsWith({ installed: false, bundle: { ready: false, why: "none here", current: false } }), false);
    assert.equal(await factsWith({ installed: false }), false);
    assert.equal((await startFacts({ cfg: { upstreams: [], routes: [] }, models: [], memory: null })).memory.bundled, false, "no memory: no bundle");
  });

  // (fails before: yes — L2's mutation pass: another client's session ticked the harness's step, and an archived task
  // unticked it)
  test("the harness's step ticks for its own tasks alone, archived ones too", async () => {
    const up = await fakeUpstream();
    const t = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-1", upstream: "m", upstreamModel: "{model}", enabled: true }];
      },
    });
    try {
      const used = async () => (await (await t.api("/api/start")).json()).harness.used;
      const sessions = async (/** @type {string} */ q) => (await (await t.api(`/api/memory/sessions?${q}`)).json()).sessions || [];
      const asked = await t.post("/v1/messages", { model: "m-1", max_tokens: 50, messages: [{ role: "user", content: "hello from another client" }] }, { "user-agent": "claude-cli/2.1.258 (external, cli)" });
      assert.equal(asked.status, 200, await asked.clone().text());
      await until(async () => (await sessions("archived=all")).length > 0, "Claude Code's session is in the archive");
      assert.deepEqual((await sessions("archived=all")).map((s) => [s.client, s.kind]), [["claude-code", "interactive"]]);
      assert.equal(await used(), false, "a task of another client's is not the harness's");
      const made = await (await t.api("/api/sessions", { method: "POST", body: { cwd: t.dataDir, autoTitle: true } })).json();
      assert.equal(await used(), true);
      const archived = await t.api(`/api/sessions/${encodeURIComponent(made.id)}/settings`, { method: "PATCH", body: { patch: { display: { archived: true } } } });
      assert.equal(archived.status, 200, await archived.clone().text());
      assert.deepEqual((await sessions("archived=only")).map((s) => s.id), [made.id], "archived");
      assert.equal(await used(), true, "an archived task: the harness was opened all the same");
    } finally {
      await t.stop();
      await up.close();
    }
  });

  // (fails before: yes — memory went on only through a full config save on Memory → Settings)
  test("memory's one switch: saved at once, said in the op log, refused unless it is true or false", async () => {
    const t = await startApp();
    try {
      const saved = () => loadConfig(t.dataDir).config.memory.enabled;
      const bad = await t.api("/api/memory/enabled", { method: "POST", body: { enabled: "yes" } });
      assert.equal(bad.status, 400);
      assert.notEqual(saved(), true, "a refusal changes nothing");
      const on = await t.api("/api/memory/enabled", { method: "POST", body: { enabled: true } });
      assert.deepEqual(await on.json(), { ok: true, enabled: true });
      assert.equal(saved(), true, "saved at once, as the failover switch is");
      const f = await (await t.api("/api/start")).json();
      assert.equal(f.memory.enabled, true);
      assert.equal(f.memory.installed, false, "the engine is its own click: this switch installs nothing");
      const ops = (await (await t.api("/api/ops?kinds=config&limit=20")).json()).ops;
      assert.ok(ops.some((o) => o.title === "memory switched on" && o.sub === "memory-enabled"), JSON.stringify(ops.map((o) => o.title)));
      await t.api("/api/memory/enabled", { method: "POST", body: { enabled: false } });
      assert.equal(saved(), false);
    } finally {
      await t.stop();
    }
  });
});

/** The facts /api/start answers, for a page in a given state. @param {any} [o] */
const factsOf = ({ ok = false, models = 0, example = null, unlisted = /** @type {string[]} */ ([]), enabled = false, installed = false, installing = null, bundled = false, learnsWith = null, chosen = false, summarizer = "", whyNone = null, used = false } = {}) => ({
  connected: { ok, models, example, unlisted },
  memory: { enabled, installed, installing, bundled, learnsWith, chosen, summarizer, whyNone },
  harness: { used },
});

/** Get started drawn with the recording `h`, and what its actions were asked. */
function drawn() {
  /** @type {any[]} */
  const calls = [];
  const draw = createGetStarted({
    h: fakeH,
    copyline: (/** @type {string} */ text) => fakeH("code", { class: "copyline" }, text),
    secretLine: (/** @type {string} */ key) => fakeH("code", { class: "secret" }, `${key.slice(0, 3)}…`),
    jobPanel: (/** @type {any} */ job, /** @type {Function} */ onDone) => { calls.push(["jobPanel", job.id, onDone]); return fakeH("div", { class: "job" }, `job ${job.id}`); },
    settingsLink: (/** @type {string} */ label) => fakeH("a", { class: "golink", href: "#memory:settings" }, label),
    connect: () => calls.push(["connect"]),
    memoryOn: async (/** @type {any} */ o) => { calls.push(["memoryOn", o]); },
    install: async () => { calls.push(["install"]); },
    listModels: async () => { calls.push(["listModels"]); },
    refresh: () => calls.push(["refresh"]),
    open: () => calls.push(["open"]),
  });
  return { draw, calls };
}

/** Every element under a node whose tag is `tag`. @param {any} el @param {string} tag @param {any[]} [out] @returns {any[]} */
const tagged = (el, tag, out = []) => {
  if (!el || typeof el !== "object") return out;
  if (el.tag === tag) out.push(el);
  for (const k of el.kids || []) tagged(k, tag, out);
  return out;
};
const O = { base: "http://127.0.0.1:20300", key: "sk-local-key" };

describe("Get started: one builder for Home and Start here (LD-D2)", () => {
  // (fails before: yes — the module did not exist: three ways to start, each with its own advice)
  test("the steps tick from the server's facts; the one Filament can't see never ticks", () => {
    assert.deepEqual(startSteps(factsOf()).map((s) => [s.id, s.done, s.optional]), [
      ["connect", false, false],
      ["memory", false, true],
      ["harness", false, false],
      ["tools", null, true],
    ]);
    const all = startSteps(factsOf({ ok: true, models: 3, enabled: true, installed: true, used: true }));
    assert.deepEqual(all.map((s) => s.done), [true, true, true, null]);
    assert.equal(startSteps(factsOf({ enabled: true })).find((s) => s.id === "memory")?.done, false, "on, but no engine yet: not done");
    // (fails before: no — written for L5's surviving mutant L17: the step ticked on the engine alone, with memory off)
    assert.equal(startSteps(factsOf({ installed: true })).find((s) => s.id === "memory")?.done, false, "the engine in, but memory off: not done");
    assert.equal(startSteps(null).length, 4, "before the facts come, nothing is done");
    // HarnessV3-AtHome AH-D13 (fails before: yes — the step said "Turn on memory" to a stranger whose memory is on by
    // default with its engine installing itself): the step is memory set up, whatever part of it is still to come.
    for (const f of [factsOf(), factsOf({ enabled: true }), factsOf({ enabled: true, installing: { id: "install-1" } }), factsOf({ enabled: true, installed: true })])
      assert.equal(startSteps(f).find((s) => s.id === "memory")?.title, "Set up memory", JSON.stringify(f.memory));
  });

  test("a fresh install: four steps open, Connect first; memory names its size; the harness opens in its own window; the address and key", async () => {
    const { draw, calls } = drawn();
    const card = draw.steps(factsOf({ bundled: true }), O);
    const text = textOf(card);
    assert.match(text, /1 · Connect a model/);
    assert.match(text, /2 · Set up memory/);
    assert.match(text, /3 · Open the harness/);
    assert.match(text, /4 · Use it from your other tools/);
    assert.match(text, /about 500 MB/, "the engine is named with its size");
    const buttons = buttonsOf(card);
    const connect = buttons.find((b) => textOf(b) === "Connect a model");
    assert.ok(connect, "Connect a model is a button");
    connect.dispatch("click");
    assert.deepEqual(calls.at(-1), ["connect"]);
    const both = buttons.find((b) => textOf(b) === "Turn on memory and install it");
    assert.ok(both, "one click: on, and its engine installed");
    const harness = tagged(card, "a").find((a) => a.attrs.href === "/ui/harness.html");
    assert.ok(harness, "a link to the harness");
    assert.equal(harness.attrs.target, "filament-harness", "in the window the sidebar's entry opens");
    assert.match(text, /http:\/\/127\.0\.0\.1:20300\/v1/, "the base URL");
    assert.match(text, /sk-…/, "the key, as a secret line");
    await both.attrs.onclick();
    assert.deepEqual(calls.at(-1), ["memoryOn", { install: true }], "with no engine, the click installs it too");
    // (fails before: yes — the second Hunter's find: with no bundle here the click installed too, and the install could
    // only fail, saying nothing) This Filament came without its engine: the click only switches memory on.
    const none = buttonsOf(draw.steps(factsOf(), O)).find((b) => textOf(b) === "Turn on memory");
    assert.ok(none, "no bundle: Turn on memory alone");
    await none.attrs.onclick();
    assert.deepEqual(calls.at(-1), ["memoryOn", { install: false }]);
  });

  // (fails before: yes — the step named a download whether or not a bundle came with Filament (HarnessV3-AtHome AH-D2))
  // (fails before: yes — with no bundle, the step promised a download, which no Filament makes now)
  test("memory's step says the engine comes from the copy that came with Filament, offline, and with none here, that there is none", () => {
    const { draw } = drawn();
    const off = textOf(draw.steps(factsOf({ bundled: true }), O));
    assert.ok(off.includes("Its engine runs on this machine: about 500 MB (uv, a private Python 3.12, Mnemosyne and a 65 MB embedding model), installed from the copy that came with Filament, offline."), off);
    assert.ok(!off.includes("one to three minutes"), off);
    const bare = textOf(draw.steps(factsOf({ ok: true, enabled: true, bundled: true }), O));
    assert.ok(bare.includes("installed from the copy that came with Filament, offline"), bare);
    const none = textOf(draw.steps(factsOf(), O));
    assert.ok(none.includes("about 500 MB (uv, a private Python 3.12, Mnemosyne and a 65 MB embedding model), but this Filament came without it: the Memory page says why."), none);
    assert.ok(!none.includes("download"), none);
  });

  test("Turn on memory asks once and hands the facts on; with the engine there it only switches on", async () => {
    const { draw, calls } = drawn();
    const off = draw.steps(factsOf({ ok: true, models: 1, example: "m-1", installed: true }), O);
    const on = buttonsOf(off).find((b) => textOf(b) === "Turn on memory");
    assert.ok(on, "the engine is installed: the click only switches memory on");
    await on.attrs.onclick();
    assert.deepEqual(calls.at(-1), ["memoryOn", { install: false }]);
  });

  test("memory on and installing draws the install's progress; on with no engine offers the install", async () => {
    const { draw, calls } = drawn();
    const busy = draw.steps(factsOf({ ok: true, enabled: true, installing: { id: "install-1", kind: "install", status: "running" } }), O);
    assert.match(textOf(busy), /job install-1/);
    const [what, id, onDone] = calls.at(-1);
    assert.deepEqual([what, id], ["jobPanel", "install-1"]);
    // (fails before: no — L2's mutation pass showed nothing held the panel's end to the facts)
    onDone();
    assert.deepEqual(calls.at(-1), ["refresh"], "the install's end reads the facts again: the step ticks");
    const bare = draw.steps(factsOf({ ok: true, enabled: true, bundled: true }), O);
    // (fails before: yes — it said nothing is learned without the engine, and the archive learns all the same)
    assert.ok(textOf(bare).includes("Memory is on. Until its engine is installed, memory recalls by matching words only, not by meaning; sessions are recorded and learned from as usual."), textOf(bare));
    const install = buttonsOf(bare).find((b) => textOf(b) === "Install the engine");
    assert.ok(install);
    await install.attrs.onclick();
    assert.deepEqual(calls.at(-1), ["install"]);
    // (fails before: yes — the second Hunter's find) No bundle here: no Install that could only fail.
    assert.deepEqual(buttonsOf(draw.steps(factsOf({ ok: true, enabled: true }), O)).filter((b) => /Install/.test(textOf(b))), []);
  });

  // (fails before: yes — the memory plan's m1: not set, memory took "the cheapest model with a price")
  test("memory on says what it learns with: the model set, else each chat's own, off, or why it has none", () => {
    const { draw } = drawn();
    const said = (/** @type {any} */ o) => textOf(draw.steps(factsOf({ ok: true, enabled: true, installed: true, ...o }), O));
    assert.match(said({ learnsWith: "m-1", chosen: true }), /It learns with each chat's compaction model, else the chat's own — or one model you set for it in \|Memory → Settings/);
    assert.match(said({ learnsWith: "mine-1", summarizer: "mine-1" }), /It learns with \|mine-1\|\. \|Change/);
    assert.doesNotMatch(said({ learnsWith: "mine-1", summarizer: "mine-1" }), /each chat's/);
    assert.match(said({ summarizer: "off" }), /It learns nothing: memory's model is off\./);
    assert.match(said({ whyNone: "no model to call" }), /It has no model to call \(a coding agent's alone is none\): set one in \|Memory → Settings/);
    assert.doesNotMatch(said({ learnsWith: "m-1", chosen: true }), /cheapest|price/);
  });

  // (fails before: yes — L2's tour, tour4: with no model able to answer, step 2 sent a newcomer to Memory → Settings to
  // name one, with none there to name)
  test("with no model able to answer, memory's step says what it will learn with, and sends nowhere", () => {
    const { draw } = drawn();
    const said = (/** @type {any} */ o) => textOf(draw.steps(factsOf({ enabled: true, installed: true, ...o }), O));
    const none = said({ whyNone: "no model to call" });
    assert.match(none, /Memory is on\. \|Once a model can answer, it learns with each chat's own\./);
    assert.doesNotMatch(none, /Memory → Settings/);
    assert.match(said({ ok: true, models: 1, example: "m-1", whyNone: "no model to call" }), /It has no model to call \(a coding agent's alone is none\): set one in \|Memory → Settings/);
  });

  test("folded, it is one line with each step's tick, and a click opens it", () => {
    const { draw, calls } = drawn();
    const f = factsOf({ ok: true, models: 2, example: "m-1", enabled: true, installed: true, learnsWith: "m-1", chosen: true });
    const line = draw.line(f);
    assert.equal(line.tag, "button", "the folded line is one button");
    assert.match(textOf(line), /Get started\|✓\|Connect a model\|✓\|Set up memory\|\|Open the harness\|\|Use it from your other tools/);
    line.dispatch("click");
    assert.deepEqual(calls.at(-1), ["open"]);
    assert.match(textOf(draw.steps(f, O)), /2 models can answer, such as \|m-1/);
    // (fails before: no — L2's mutation pass: nothing held the singular, nor step 4's model to try)
    assert.match(textOf(draw.steps({ ...f, connected: { ok: true, models: 1, example: "m-1" } }, O)), /1 model can answer, such as \|m-1/);
    assert.match(textOf(draw.steps({ ...f, connected: { ok: true, models: 3, example: null } }, O)), /3 models can answer\./);
    assert.match(textOf(draw.steps(f, O)), /API key\|sk-…\|Model\|m-1/, "a model name to try from the other tools");
  });
});

describe("Get started's clicks (LD-D2)", () => {
  /**
   * The actions, with every call they make written down, on a page whose copies of the config are `edited` (memory
   * off) and `saved` (no memory block yet). @param {(path: string) => void} [refuse]
   */
  const acting = (refuse = () => {}) => {
    /** @type {any[]} */
    const log = [];
    const edited = { memory: { enabled: false, folder: "x" } };
    /** @type {any} */
    const saved = {};
    const acts = startActions({
      api: async (path, o) => {
        log.push(["api", path, o?.body]);
        refuse(path);
        return {};
      },
      toast: (msg, kind = "ok") => log.push(["toast", msg, kind]),
      copies: () => [edited, saved, null],
      refresh: () => log.push(["refresh"]),
    });
    return { acts, log, edited, saved };
  };

  // (fails before: yes — the clicks lived in the console's shell, where no test reached them, and it asked the facts
  // again whether an install was running, which the step had already answered by drawing the button)
  test("Turn on memory: the switch saved, the page's copies told, the engine installed when asked, said, and the facts read again", async () => {
    const { acts, log, edited, saved } = acting();
    await acts.memoryOn({ install: true });
    assert.deepEqual([edited.memory, saved.memory], [{ enabled: true, folder: "x" }, { enabled: true }], "both copies know: a save from the page keeps it on");
    assert.deepEqual(log, [
      ["api", "/memory/enabled", { enabled: true }],
      ["api", "/memory/install", {}],
      ["toast", "Memory is on; its engine is installing", "ok"],
      ["refresh"],
    ]);
    log.length = 0;
    await acts.memoryOn({ install: false });
    assert.deepEqual(log, [["api", "/memory/enabled", { enabled: true }], ["toast", "Memory is on", "ok"], ["refresh"]]);
    log.length = 0;
    await acts.install();
    assert.deepEqual(log, [["api", "/memory/install", {}], ["refresh"]]);
  });

  test("a refusal is said, the page's copies are not told, and the facts are read again all the same", async () => {
    const off = acting((path) => {
      if (path === "/memory/enabled") throw new Error("the config could not be saved");
    });
    await off.acts.memoryOn({ install: true });
    assert.deepEqual(off.log, [["api", "/memory/enabled", { enabled: true }], ["toast", "the config could not be saved", "err"], ["refresh"]]);
    assert.deepEqual([off.edited.memory.enabled, off.saved.memory], [false, undefined], "a switch not saved is not one the page's copies learn");
    const stuck = acting((path) => {
      if (path === "/memory/install") throw new Error("an install is already running");
    });
    await stuck.acts.memoryOn({ install: true });
    assert.deepEqual(stuck.log.slice(1), [["api", "/memory/install", {}], ["toast", "an install is already running", "err"], ["refresh"]], "on, but not installing");
    assert.equal(stuck.edited.memory.enabled, true, "the switch itself was saved");
    stuck.log.length = 0;
    await stuck.acts.install();
    assert.deepEqual(stuck.log, [["api", "/memory/install", {}], ["toast", "an install is already running", "err"], ["refresh"]]);
  });
});

describe("Get started's facts on the page (LD-D2)", () => {
  /** A reader over a server whose answers the test hands out, on a clock the test moves. */
  const reading = () => {
    /** @type {{ ok: (f: any) => void, no: (e: Error) => void }[]} */
    const asks = [];
    let t = 1_000_000;
    let told = 0;
    const r = createStartReader({
      api: (path) => {
        assert.equal(path, "/start");
        return new Promise((ok, no) => asks.push({ ok, no }));
      },
      changed: () => told++,
      now: () => t,
    });
    return { r, asks, told: () => told, tick: (/** @type {number} */ ms) => (t += ms) };
  };
  const settle = () => new Promise((r) => setImmediate(r));

  // (fails before: yes — L2's mutation pass: the reader lived in the console's shell, where no test reached it)
  test("read when asked, then at most every five seconds; a change is told, an install's progress is not", async () => {
    const { r, asks, told, tick } = reading();
    assert.equal(r.get(), null, "nothing before the first answer");
    r.get();
    assert.equal(asks.length, 1, "one read at a time");
    const first = factsOf({ ok: true, models: 1, example: "m-1", installing: { id: "install-1", progress: 10 } });
    asks[0].ok(first);
    await settle();
    assert.equal(r.get(), first);
    assert.equal(told(), 1);
    tick(4999);
    r.get();
    assert.equal(asks.length, 1, "read less than five seconds ago");
    tick(1);
    r.get();
    assert.equal(asks.length, 2, "five seconds on, it reads again");
    asks[1].ok(factsOf({ ok: true, models: 1, example: "m-1", installing: { id: "install-1", progress: 60 } }));
    await settle();
    assert.equal(told(), 1, "the same install further on is no change");
    void r.read();
    asks[2].ok(factsOf({ ok: true, models: 1, example: "m-1", enabled: true, installed: true }));
    await settle();
    assert.equal(told(), 2, "its end is");
  });

  test("the newest read wins; the facts read with the config are the newest; a discovery makes them stale", async () => {
    const { r, asks, told, tick } = reading();
    r.set(factsOf());
    assert.deepEqual(r.get(), factsOf(), "read with the config: no read of its own");
    assert.equal(asks.length, 0);
    void r.read(); // a read that began before a click…
    void r.read(); // …and the click's own
    asks[1].ok(factsOf({ ok: true, models: 1, example: "m-1", enabled: true }));
    await settle();
    asks[0].ok(factsOf());
    await settle();
    assert.equal(r.get().memory.enabled, true, "the older answer, landing last, does not undo the click");
    assert.equal(told(), 1);
    void r.read();
    r.set(factsOf({ ok: true, models: 2, example: "m-1" }));
    asks[2].ok(factsOf());
    await settle();
    assert.equal(r.get().connected.models, 2, "a read that began before the config's own is the older");
    r.stale();
    r.get();
    assert.equal(asks.length, 4, "stale: the next ask reads at once");
    asks[3].no(new Error("the server went away"));
    await settle();
    assert.equal(r.get().connected.models, 2, "a failed read keeps the facts");
    tick(4999);
    r.get();
    assert.equal(asks.length, 4, "and waits its five seconds, as an answered one does");
  });

  // The console's shell needs a browser: what it hands the builder and the reader is pinned by its source.
  test("the console's shell hands them their pieces: both copies of the config, the facts read at boot, a discovery's news", () => {
    const app = readFileSync("src/ui/app.js", "utf8");
    assert.ok(app.includes("copies: () => [state.config, state.saved]"), "memory's switch reaches both copies");
    assert.match(app, /starts\.set\(start\);/, "the facts read with the config");
    assert.match(app, /if \(ev\?\.type === "models-discovered"\) \{[\s\S]{0,500}starts\.stale\(\);/, "a save's discovery: Get started may tick now");
  });
});

describe("the Setup wizard is retired (LD-D2)", () => {
  // (fails before: yes — the wizard, its scenarios and its first-visit landing were all still there)
  test("no page, no names, no menu entry, no alias; the first visit lands on Home", () => {
    assert.equal(existsSync("src/ui/pages/setup.js"), false, "the page is gone");
    assert.equal(/** @type {any} */ (PAGES).setup, undefined);
    assert.equal(HELP_TABS.has("setup"), false);
    // (fails before: yes — `#setup` was kept as an alias of Home)
    assert.equal(Object.hasOwn(TAB_ALIAS, "setup"), false, "no alias");
    assert.equal(parseHash("setup"), null, "an unknown page, like any other");
    assert.equal(palettePages().some((c) => c.tab === "setup"), false, "the palette has no entry");
    assert.ok(!/data-tab="setup"/.test(readFileSync("src/ui/index.html", "utf8")), "the help menu has none");
    const app = readFileSync("src/ui/app.js", "utf8");
    assert.ok(!/"visited"/.test(app), "no first-visit mark");
    assert.ok(!/\bsetup\b/.test(app), "nothing in the shell names it");
    const pages = ["src/ui/app.js", ...readdirSync("src/ui/pages").map((f) => `src/ui/pages/${f}`)];
    for (const f of pages) assert.ok(!/\bSCENARIOS\b|\bwiz\b/.test(readFileSync(f, "utf8")), `${f} still names the wizard's state`);
    for (const f of [...pages, "src/app/assistant.js"]) assert.ok(!/[Ss]etup wizard|first-run wizard/.test(readFileSync(f, "utf8")), `${f} still points at the wizard`);
  });

  test("Home and Start here draw the one builder; Home's hero is honest before a model can answer", () => {
    const home = readFileSync("src/ui/pages/home.js", "utf8");
    assert.ok(/getStarted\.steps\(/.test(home), "Home draws Get started");
    assert.ok(/Not set up yet: connect a model/.test(home), "the amber title");
    assert.ok(/enabledUps\.length >= 2 \?/.test(home), "failover and the virtual-model tip need somewhere else to go");
    assert.ok(/getStarted\.line\(/.test(home), "once a model answers, the folded line");
    assert.ok(/store\.set\("home\.getStarted", /.test(home), "open or folded is remembered in this browser");
    const guide = readFileSync("src/ui/pages/docs.js", "utf8");
    assert.ok(/getStarted\.steps\(/.test(guide), "Start here draws the same steps");
    assert.ok(!/Set-up checklist/.test(guide), "its own checklist is gone");
  });
});

/** Every element under a node carrying a class. @param {any} el @param {string} c @param {any[]} [out] @returns {any[]} */
const classed = (el, c, out = []) => {
  if (!el || typeof el !== "object") return out;
  if (String(el.attrs?.class || "").split(/\s+/).includes(c)) out.push(el);
  for (const k of el.kids || []) classed(k, c, out);
  return out;
};

describe("Home puts Get started where it belongs (LD-D3)", () => {
  /**
   * Home's Status pane on the fake DOM for these facts (null: not read yet), with Get started open or folded as this
   * browser left it. @param {any} facts @param {{ remembered?: string | null, upstreams?: any[], routes?: any[] }} [o]
   */
  const home = (facts, { remembered = null, upstreams = [{ id: "m", type: "anthropic", apiKey: "k" }], routes = [] } = {}) => {
    /** @type {Record<string, any>} */
    const kept = { "home.getStarted": remembered };
    const { draw } = drawn();
    Object.assign(uiState, {
      homePane: "status",
      requests: [],
      summary: {},
      keys: ["sk-local-key"],
      config: { server: { host: "127.0.0.1", port: 20300 }, upstreams, routes, rules: {} },
    });
    const later = () => new Promise(() => {}); // the panels that read the server stay "loading…"
    bindUi({
      h: fakeH, fmt, HOME_PANES, api: later, memStatus: later,
      goto: (/** @type {string} */ _tab, /** @type {string} */ label) => fakeH("a", {}, label),
      go() {}, render() {}, toast() {}, empty: (/** @type {string} */ title) => fakeH("div", {}, title),
      copyline: (/** @type {string} */ text) => fakeH("code", { class: "copyline" }, text),
      secretLine: (/** @type {string} */ key) => fakeH("code", { class: "secret" }, `${key.slice(0, 3)}…`),
      requestsTable: () => fakeH("table"), liveTree: () => [], liveRow: () => fakeH("div"), startLiveTicker() {}, routeMeaning: () => "",
      store: { get: (/** @type {string} */ k) => kept[k] ?? null, set: (/** @type {string} */ k, /** @type {any} */ v) => { kept[k] = v; } },
      getStarted: draw,
      startFacts: () => facts,
    });
    return { page: overview(), kept };
  };
  const answering = factsOf({ ok: true, models: 1, example: "m-1" });

  // (fails before: yes — L2's mutation pass: where Home puts Get started was held by no test, only by its source's words)
  test("facts not read yet: today's hero and no Get started; nothing answers: the steps in the hero's place, amber", () => {
    const unknown = home(null);
    assert.equal(classed(unknown.page, "get-started-line").length + classed(unknown.page, "get-started").length, 0, "nothing said before it is known");
    assert.match(textOf(classed(unknown.page, "hero")[0]), /Ready for your first request/);
    const none = home(factsOf());
    const hero = classed(none.page, "hero")[0];
    assert.ok(classed(none.page, "hero-setup").includes(hero));
    assert.match(textOf(hero), /Not set up yet: connect a model/);
    assert.equal(classed(hero, "get-started").length, 1, "the steps, in the hero's place");
    assert.equal(classed(none.page, "get-started-line").length, 0, "no folded line");
    assert.doesNotMatch(textOf(none.page), /Ready for your first request/);
  });

  test("once a model answers: today's hero, with Get started folded to one line above it, or open as this browser left it", () => {
    const folded = home(answering);
    assert.equal(classed(folded.page, "get-started-line").length, 1, "folded unless it was opened");
    assert.equal(classed(folded.page, "get-started").length, 0);
    assert.equal(classed(folded.page, "hero-setup").length, 0);
    assert.match(textOf(classed(folded.page, "hero")[0]), /Ready for your first request/);
    const open = home(answering, { remembered: "open" });
    assert.equal(classed(open.page, "get-started-line").length, 0);
    assert.equal(classed(open.page, "get-started").length, 1, "open, above the hero");
    assert.equal(classed(classed(open.page, "hero")[0], "get-started").length, 0, "not in the hero's place");
    buttonsOf(open.page).find((b) => b.attrs.title === "Fold Get started to one line").dispatch("click");
    assert.equal(open.kept["home.getStarted"], "folded", "folded again, remembered in this browser");
  });

  test("failover and the virtual-model tip need somewhere else to go: two enabled upstreams", () => {
    const spare = { id: "spare", type: "anthropic", apiKey: "k" };
    const one = home(answering, { upstreams: [{ id: "m", type: "anthropic", apiKey: "k" }, { ...spare, enabled: false }] });
    assert.doesNotMatch(textOf(one.page), /Failover between providers/, "a disabled upstream is nowhere to go");
    const two = home(answering, { upstreams: [{ id: "m", type: "anthropic", apiKey: "k" }, spare] });
    // Off until switched on (the owner's of 11-09): the switch is offered, saying so.
    assert.match(textOf(two.page), /Failover between providers: off/);
  });

  // (fails before: yes — L2's probe: one provider on one route read "1 upstream enabled, 1 routes")
  test("the hero counts in words: one route is a route, and a route switched off is not counted", () => {
    const route = (/** @type {string} */ id, o = {}) => ({ match: `${id}-*`, upstream: "m", upstreamModel: "{model}", ...o });
    const one = home(answering, { routes: [route("a"), route("b", { enabled: false })] });
    assert.match(textOf(classed(one.page, "hero")[0]), /1 upstream enabled, 1 route\. /);
    const two = home(answering, { routes: [route("a"), route("b")] });
    assert.match(textOf(classed(two.page, "hero")[0]), /1 upstream enabled, 2 routes\. /);
  });
});

describe("the harness never strands a newcomer (LD-D4)", () => {
  // (fails before: yes — the list said "No models here", and Send's toast sent them to "the dashboard (Destinations)")
  test("the picker with no model at all: No models yet, and Connect a model opens the console's catalogue in its own window", () => {
    let left = 0;
    const none = /** @type {any} */ (emptyList("", true, () => left++, /** @type {any} */ (fakeH)));
    assert.equal(textOf(none), "No models yet|Connect a model");
    /** @type {any[]} */
    const links = [];
    const walk = (/** @type {any} */ n) => { if (n && typeof n === "object") { if (n.tag === "a") links.push(n); for (const k of n.kids || []) walk(k); } };
    walk(none);
    assert.deepEqual(links.map((a) => [a.attrs.href, a.attrs.target]), [["/ui/?add=1#destinations", "filament-console"]]);
    assert.deepEqual([CONNECT_URL, CONSOLE_WINDOW], ["/ui/?add=1#destinations", "filament-console"]);
    links[0].dispatch("click");
    assert.equal(left, 1, "the menu closes as the console opens");
    assert.equal(textOf(/** @type {any} */ (emptyList("", false, undefined, /** @type {any} */ (fakeH)))), "No models here", "a source with none, others with some");
    assert.equal(textOf(/** @type {any} */ (emptyList("gpt", true, undefined, /** @type {any} */ (fakeH)))), "No model matches “gpt”");
  });

  // (fails before: yes — L2's probe: Send opens this picker, and with no model at all its footer said "No model chosen
  // yet" and offered "Use the default", with no default to fall back on)
  test("the picker with no model at all has no footer; with models, the one chosen and the way back to the default", () => {
    const mk = /** @type {any} */ (fakeH);
    assert.equal(pickerFoot({ note: "", none: true, title: "t", onUseDefault() {} }, mk), null);
    let used = 0;
    const foot = /** @type {any} */ (pickerFoot({ note: "Echo 1", none: false, title: "the project's", onUseDefault: () => used++ }, mk));
    assert.equal(textOf(foot), "Echo 1|Use the default");
    assert.equal(buttonsOf(foot)[0].attrs.title, "the project's");
    buttonsOf(foot)[0].dispatch("click");
    assert.equal(used, 1);
    const unchosen = /** @type {any} */ (pickerFoot({ note: "", none: false, title: "t", onUseDefault() {} }, mk));
    assert.equal(textOf(unchosen), "No model chosen yet|Use the default", "models, none chosen yet");
    // (fails before: yes — E15 step 8's look: the picker under a pool's "Add a model" drew a Use the default that
    // did nothing; a caller with no default to go back to has no button, and no footer with no model chosen)
    assert.equal(textOf(/** @type {any} */ (pickerFoot({ note: "GLM-5.3", none: false, title: "t", onUseDefault: null }, mk))), "GLM-5.3");
    assert.equal(pickerFoot({ note: "", none: false, title: "t", onUseDefault: null }, mk), null);
    // The picker that draws it needs a browser (L2's probe opens it): its wiring is pinned whole.
    const picker = readFileSync("src/ui/harness/composer/model.js", "utf8");
    const wired = [
      "    const foot = pickerFoot({",
      "      note: current ? `${here ? familyName(here.family) : prettyModel(shownName(current))}${note ? ` · ${note}` : \"\"}` : \"\",",
      "      none: !sources().length,",
      "      title: cb.defaultDesc || \"Unset this session's own model: your project or global setting applies\",",
      "      onUseDefault: cb.onUseDefault ? () => { d.close(); cb.onUseDefault?.(); } : null,",
      "    });",
    ].join("\n");
    assert.ok(picker.includes(wired), "the footer knows when there is no model at all, what is chosen and what the default is");
  });

  test("Send with no model says no model can answer yet and opens the picker; the palette's console is the same window", () => {
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.ok(app.includes('return no(state.models.length ? "Choose a model first" : "No model can answer yet: connect one in the console, from the model picker");'), "Send's toast");
    assert.match(app, /const no = \(words, shown = true\) => \{\s+refuse\(words, shown\);\s+return null;/, "the chat is not ready, in the send's own refusal");
    assert.match(app, /const refuse = \(words, shown = true, again = true\) => \{\s+refusal = words;\s+refusalAgain = again;\s+if \(shown\) toast\(words, "err"\);\s+return false;/, "said in a toast, and kept for the queue");
    assert.ok(!/add a model on the dashboard/.test(app), "the old words are gone");
    // (fails before: no — L2's mutation pass: the picker opening was held by nothing)
    assert.ok(app.includes('    composer.openModel?.();\n    return no(state.models.length ? "Choose a model first"'), "and the picker opens, on its Connect a model");
    // The picker and the greeting need a browser: their wiring is pinned by their source, their rules by the tests above.
    const picker = readFileSync("src/ui/harness/composer/model.js", "utf8");
    assert.ok(picker.includes("emptyList(search.value.trim(), !all.length, () => d.close())"), "the list knows when there is no model at all");
    const empty = readFileSync("src/ui/harness/conversation/empty.js", "utf8");
    assert.ok(empty.includes("greetingAt(now.getHours(), workedToday(state.sessions, now))"), "the greeting reads the sidebar's tasks");
    assert.ok(app.includes('run: () => window.open("/ui/", CONSOLE_WINDOW)'), "Open Filament console reuses the console's window");
    assert.ok(/composer\.setFamilies\(models\.families \|\| \[\]\);[\s\S]{0,900}if \(!chatOf\(state\.currentId\)\?\.chainId\) transcript\.startChanged\(\);\n    \},/.test(app), "a model connected meanwhile reaches the Start board");
  });

  // (fails before: yes — L2's probe: a fresh install's Send asked for a project folder first, and said no model could
  // answer only once one was picked)
  test("Send says no model can answer before it asks for a project folder", () => {
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    // A chat is made ready for a message in one place (HarnessV4_Tasks E15 step 2): the send's, and a question to saved
    // agents in a chat that has no session yet.
    const ready = app.slice(app.indexOf("async function readySession("), app.indexOf("async function sendMessage("));
    const send = app.slice(app.indexOf("async function sendMessage("), app.indexOf("async function stopCurrent("));
    // The check is shell glue (it needs a browser: L2's probe drives it), so it is pinned whole, just before the folder's.
    const check = [
      "  const model = composer.modelName() || chat.model || lastModel();",
      "  if (!model) {",
      "    // With no model at all, the picker opens on its Connect a model (LD-D4).",
      "    composer.openModel?.();",
      '    return no(state.models.length ? "Choose a model first" : "No model can answer yet: connect one in the console, from the model picker");',
      "  }",
      "  const chip = folderIn.value.trim();",
    ].join("\n");
    const at = ready.indexOf(check);
    assert.ok(at > 0, "the model's check, whole, just before the header's folder is read");
    assert.ok(at < ready.indexOf("pickProjectFolder()"), "what stops the send is said before the folder is asked");
    assert.equal(ready.split("const model = ").length, 2, "one model, read once");
    assert.match(send, /const ready = away \? readyAway\(chat\) : await readySession\(chat, \{ opens: fresh \}\);\n {2}if \(!ready\) return false;\n {2}chat = ready\.chat;/, "the send makes its chat ready there — a chat not shown as its own turn left it — and stops where it is not");
    assert.ok(!send.includes("pickProjectFolder()") && !send.includes("const model = "), "and asks for no model or folder of its own");
    const ask = app.slice(app.indexOf("async function askAgents("), app.indexOf("// The dock's decisions"));
    assert.match(ask, /if \(!chat\.chainId\) \{\n {4}const ready = await readySession\(chat, \{ title: question\.split\("\\n"\)\[0\]\.trim\(\), opens: true \}\);\n {4}if \(!ready\) return false;/, "a question to agents in a chat with no session meets the same checks");
    // (fails before: yes — found by hand in the browser: the card stayed on Starting… and the chat was "untitled",
    // because nothing told the page's list of agents, the header or the sidebar that the chat now had a session)
    assert.match(ask, /chat = ready\.chat;\n {4}if \(chat\.id === state\.currentId\) setTitle\(chat\);\n {4}refreshStatus\(chat\);\n {4}sidebar\.load\(\);\n {2}\}/, "and the header, the page's list of the session's agents and the sidebar follow the session made for it");
    assert.match(app, /async function ensureSession\(chat, model, permissions = "", effort = "", title = ""\) \{\s+if \(chat\.chainId\) return chat\.chainId;\s+chat\.making \|\|= makeSession\(chat, model, permissions, effort, title\)/, "the one session a chat's sends wait for is made with the name");
    assert.match(app, /async function makeSession\(chat, model, permissions, effort, title\) \{\s+const row = await api\("\/sessions", \{ method: "POST", body: sessionStartBody\(chat, chat\.cwd, model, title, permissions, effort, composer\.heldSettings\(\)\) \}\);\n {2}if \(title\) chat\.title = row\.title \|\| title;/, "the session made for a question is named by it: no message of it reaches the main agent to name it");
    assert.equal((ready.match(/await ensureSession\(chat, model, perm, composer\.effortValue\(\), title\);/g) || []).length, 2, "the name goes with the session wherever it is made");
  });
});

describe("the repo's front door (HarnessV3-Launch LD-D12)", () => {
  // (fails before: yes — the README opened with the shim, "One local address for every AI model …", and memory was a
  // bullet under "The proxy underneath")
  // The README rewritten for the public repo (11-22): the demo's moving picture and the three pillars first, then a
  // section and a picture for each feature, the long reference left to the guide.
  test("the README leads with the pitch, the moving picture and the three pillars, then a picture for each feature", () => {
    const readme = readFileSync("README.md", "utf8");
    const at = (/** @type {string} */ s, /** @type {string} */ what) => {
      const i = s.indexOf(what);
      assert.ok(i >= 0, `missing: ${what}`);
      return i;
    };
    assert.match(readme, /^<img src="assets\/filament-logo\.png" alt="Filament" width="96" \/>\n\n# Filament\n\n\*\*Any model\. Any agent\. One memory\.\*\*\n/, "the pitch first");
    const lead = readme.slice(0, at(readme, "\n## "));
    assert.ok(lead.includes('<img src="assets/readme/story.webp" alt="'), "the moving picture before any section");
    assert.match(lead, /a scripted demo on a sample project/, "said for what it is");
    assert.ok(lead.includes('<a href="https://filamentdev.com/#tour"><img src="assets/readme/tour.webp" '), "the tour, linked where it plays");
    const pillars = ["1. **The harness**", "2. **Memory**", "3. **A local API for your other tools**"].map((p) => at(lead, `\n${p}: `));
    assert.deepEqual([...pillars].sort((a, b) => a - b), pillars, "the harness, memory, the local API");
    const features = [
      "## Several agents on one project, without collisions",
      "## Claude Code, Codex, Cursor, Antigravity, Devin and Any ACP Agent inside Filament with any number of accounts signed in at the same time.",
      "## A memory that steers every agent",
      "## Every change in view, and a way back",
      "## About 99% read from the provider's cache",
      "## Every model you pay for. Every agent you use.",
    ];
    const rest = ["## And a lot more", "## Your data stays yours", "## Download", "## Run it from source", "## Contributing", "## Supporting Filament", "## License"];
    const heads = [...features, ...rest].map((h) => at(readme, `\n${h}\n`));
    assert.deepEqual([...heads].sort((a, b) => a - b), heads, "the features, then the rest, in order");
    const section = (/** @type {number} */ i) => readme.slice(heads[i], heads[i + 1]);
    features.forEach((h, i) => assert.equal((section(i).match(/<img src="assets\/readme\/[a-z-]+\.webp" alt="[^"]+"/g) || []).length, 1, `${h}: one picture, with its words`));
    // Claims with their source: the maker's numbers as the maker's own, the cache's from real use.
    assert.ok(section(0).includes("not a published benchmark"), "the maker's own runs, said so");
    assert.ok(section(4).includes("98.87%") && section(4).includes("4,491 model calls"), "the cache figure, with what it was measured over");
    assert.ok(section(features.length + 2).includes("about 500 MB"), "memory's engine and its size, said at the download");
    // Every picture the README names is in the repo, and the folder holds no picture it doesn't name.
    const named = [...readme.matchAll(/src="(assets\/readme\/[^"]+)"/g)].map((m) => m[1]).sort();
    for (const f of named) assert.ok(existsSync(f), `${f} is missing`);
    const kept = readdirSync("assets/readme").filter((f) => f.endsWith(".webp"));
    assert.deepEqual(kept.map((f) => `assets/readme/${f}`).sort(), named, "no picture left over");
  });
});
