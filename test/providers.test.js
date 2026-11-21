// @ts-check
// HarnessV3-Providers P1 (2026-10-01): the provider catalogue and the probe that "Add a provider" asks before anything
// is saved. The catalogue's entries are well-formed and every address resolves to the endpoints Filament will call;
// the owner's addresses are recognised; the page's copy of the address matcher agrees with core's, address for
// address; and the probe answers a draft's models as the picker will show them, sets the non-chat ones apart, says
// why a refused key was refused, and writes nothing.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { PROVIDERS, OTHER_KINDS, providerById, planOf, providerForBaseUrl, fillBaseUrl, placeholdersOf, isOtherModel } from "../src/core/providers.js";
import { UPSTREAM_TYPES } from "../src/core/schema.js";
import { upstreamEndpoint, upstreamVersionedBase } from "../src/core/routing.js";
import { normalizeConfig, validateConfig } from "../src/services/config/store.js";
import { providerFor, fillUrl, fieldsOf, prefixRouteOf, prefixProblem, freePrefix, hostWord, variantWords } from "../src/ui/lib/providers.js";
import { fmt } from "../src/ui/lib/format.js";
import { testProvider } from "../src/adapters/providers/http.js";
import { startApp, fakeUpstream } from "./helpers/app.js";

describe("the catalogue", () => {
  test("every entry is well-formed: an id, a prefix, a known API type, plans with addresses, a key page for a keyed one", () => {
    assert.ok(PROVIDERS.length >= 18, "the eighteen entries the owner kept (2026-10-01)");
    const ids = new Set(), prefixes = new Set();
    for (const p of PROVIDERS) {
      assert.ok(/^[a-z0-9-]+$/.test(p.id) && !ids.has(p.id), `${p.id}: a unique id`);
      ids.add(p.id);
      assert.ok(/^[a-z0-9][a-z0-9_-]*$/.test(p.prefix) && !prefixes.has(p.prefix), `${p.id}: a unique prefix that is also a valid upstream id`);
      prefixes.add(p.prefix);
      const t = UPSTREAM_TYPES[/** @type {keyof typeof UPSTREAM_TYPES} */ (p.type)];
      assert.ok(t && !("local" in t) && !("builtin" in t), `${p.id}: an API type`);
      assert.ok(p.name && p.blurb, `${p.id}: words to show`);
      assert.ok(p.plans.length >= 1 && new Set(p.plans.map((x) => x.id)).size === p.plans.length, `${p.id}: plans with their own ids`);
      for (const plan of p.plans) {
        assert.ok(["metered", "plan"].includes(plan.billing), `${p.id}/${plan.id}: billed one way or the other`);
        const url = fillBaseUrl(plan.baseUrl, Object.fromEntries(placeholdersOf(plan.baseUrl).map((k) => [k, "ws-abc123"])));
        assert.ok(url, `${p.id}/${plan.id}: the address fills`);
        assert.ok(p.keyless ? /^http:\/\/localhost:\d+\//.test(url) : /^https:\/\//.test(url), `${p.id}/${plan.id}: https, except on this machine (${url})`);
        for (const k of placeholdersOf(plan.baseUrl)) assert.ok((p.fields || []).some((f) => f.id === k), `${p.id}/${plan.id}: its {${k}} is asked for`);
        if (plan.keyUrl) assert.match(plan.keyUrl, /^https:\/\//);
      }
      if (!p.keyless) assert.match(String(p.keyUrl), /^https:\/\//, `${p.id}: a "Get a key" page`);
      if (p.docsUrl) assert.match(p.docsUrl, /^https:\/\//);
    }
  });

  test("every plan's address reaches the endpoints Filament calls: chat, and the model list", () => {
    /** @type {Record<string, [string, string]>} a few pinned by hand: the version kept, Gemini's full endpoint */
    const want = {
      "zai/coding": ["https://api.z.ai/api/coding/paas/v4/chat/completions", "https://api.z.ai/api/coding/paas/v4/models"],
      "kimi/code": ["https://api.kimi.com/coding/v1/chat/completions", "https://api.kimi.com/coding/v1/models"],
      "deepseek/api": ["https://api.deepseek.com/v1/chat/completions", "https://api.deepseek.com/v1/models"],
      "groq/api": ["https://api.groq.com/openai/v1/chat/completions", "https://api.groq.com/openai/v1/models"],
      "gemini/api": ["https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", "https://generativelanguage.googleapis.com/v1beta/openai/models"],
      "anthropic/api": ["https://api.anthropic.com/v1/messages?beta=true", "https://api.anthropic.com/v1/models"],
      "dashscope/singapore": ["https://ws-abc123.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions", "https://ws-abc123.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/models"],
    };
    for (const p of PROVIDERS)
      for (const plan of p.plans) {
        const baseUrl = /** @type {string} */ (fillBaseUrl(plan.baseUrl, { workspace: "ws-abc123" }));
        const u = { type: p.type, baseUrl, modelsPath: plan.modelsPath || "" };
        const chat = upstreamEndpoint(u, p.type.startsWith("anthropic") ? "anthropic" : "openai");
        const [base, ver] = upstreamVersionedBase(u);
        const list = u.modelsPath || `${base}/${ver}/models`;
        assert.doesNotMatch(chat, /\/v\d+\/v\d+\//, `${p.id}/${plan.id}: never two versions (${chat})`);
        assert.doesNotMatch(chat, /\/chat\/completions\/v1\//, `${p.id}/${plan.id}: a full endpoint is used as it is (${chat})`);
        const pin = want[`${p.id}/${plan.id}`];
        if (pin) assert.deepEqual([chat, list], pin, `${p.id}/${plan.id}`);
      }
  });

  test("the owner's addresses are recognised, whatever the trailing slash or case; another address is Custom", () => {
    const cases = [
      ["https://api.z.ai/api/coding/paas/v4", "zai", "coding"],
      ["https://api.kimi.com/coding/v1/", "kimi", "code"],
      ["https://api.x.ai/v1", "xai", "api"],
      ["https://integrate.api.nvidia.com/v1", "nvidia", "api"],
      ["https://api.neuralwatt.com/v1", "neuralwatt", "api"],
      ["https://API.Anthropic.com", "anthropic", "api"],
      ["https://open.bigmodel.cn/api/paas/v4", "zai", "china"],
      ["https://ws-9f2.cn-hongkong.maas.aliyuncs.com/compatible-mode/v1", "dashscope", "hongkong"],
    ];
    for (const [url, id, plan] of cases) {
      const got = providerForBaseUrl(url);
      assert.deepEqual([got?.provider.id, got?.plan.id], [id, plan], url);
    }
    for (const url of ["http://127.0.0.1:9000/v1", "https://api.z.ai/api/coding/paas/v4/extra", "https://evil.example/ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1", "", "https://a.b.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"])
      assert.equal(providerForBaseUrl(url), null, `${url || "(empty)"} is Custom`);
  });

  test("a plan's field fills its address; a missing one, or one that would move the request elsewhere, does not", () => {
    const tpl = /** @type {string} */ (planOf(providerById("dashscope"), "singapore")?.baseUrl);
    assert.equal(fillBaseUrl(tpl, { workspace: "ws-1" }), "https://ws-1.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1");
    for (const bad of ["", " ", "evil.com/x", "a.b", "x:1", "a/b"]) assert.equal(fillBaseUrl(tpl, { workspace: bad }), null, JSON.stringify(bad));
    assert.equal(fillBaseUrl("https://api.x.ai/v1", {}), "https://api.x.ai/v1", "an address with no field is itself");
    assert.equal(planOf(providerById("zai"), "nope")?.id, "coding", "an unknown plan is the default one: Z.AI's coding plan (the owner, 2026-10-01)");
    assert.equal(planOf(providerById("kimi"))?.id, "code", "and Kimi Code's");
    assert.equal(planOf(providerById("zai"))?.billing, "plan");
  });

  test("the catalogue's hints are ordinary model rows: a save takes them as they are", () => {
    for (const p of PROVIDERS) {
      if (!p.hints) continue;
      const cfg = normalizeConfig({ upstreams: [{ id: p.prefix, type: p.type, baseUrl: fillBaseUrl(p.plans[0].baseUrl, { workspace: "w" }), pricing: structuredClone(p.hints) }], routes: [] });
      const errors = validateConfig(cfg).errors.filter((e) => e.startsWith("upstreams[0]"));
      assert.deepEqual(errors, [], p.id);
    }
    assert.deepEqual(providerById("xai")?.hints, { "grok-": { fastParams: { service_tier: "priority" } } });
  });

  test("which ids are not for chat: embeddings, rerankers, speech, images, moderation", () => {
    for (const id of ["zeta-embed-1", "text-embedding-3-large", "bge-reranker", "tts-1", "whisper-1", "dall-e-3", "omni-moderation-latest", "gpt-image-1"]) assert.ok(isOtherModel(null, id), id);
    for (const id of ["zeta-5", "glm-5", "kimi-k3", "grok-4.7-fast", "deepseek-reasoner"]) assert.ok(!isOtherModel(null, id), id);
    assert.ok(new RegExp(OTHER_KINDS, "i").test("EMBED"));
  });
});

describe("the page's copies of the catalogue's logic", () => {
  // The dashboard never imports core (ratchets: ui imports ui): providerFor and fillUrl are copies, pinned here.
  const urls = [
    ...PROVIDERS.flatMap((p) => p.plans.flatMap((x) => { const u = fillBaseUrl(x.baseUrl, { workspace: "ws-7" }) || ""; return [u, `${u}/`, u.toUpperCase()]; })),
    "http://127.0.0.1:9000/v1", "https://api.z.ai/api/coding/paas/v4/extra", "", "https://x.y.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
  ];
  test("providerFor answers what core's providerForBaseUrl answers, for every address", () => {
    for (const u of urls) {
      const a = providerForBaseUrl(u), b = providerFor(/** @type {any} */ (PROVIDERS), u);
      assert.deepEqual([b?.provider.id, b?.plan.id], [a?.provider.id, a?.plan.id], u);
    }
  });
  test("fillUrl answers what core's fillBaseUrl answers", () => {
    for (const p of PROVIDERS) for (const x of p.plans) for (const v of ["ws-1", "", "a.b", "x/y"]) assert.equal(fillUrl(x.baseUrl, { workspace: v }), fillBaseUrl(x.baseUrl, { workspace: v }), `${x.baseUrl} ${v}`);
  });
  test("switching region keeps the workspace: fieldsOf reads it back out of an address", () => {
    const tpl = /** @type {string} */ (planOf(providerById("dashscope"), "tokyo")?.baseUrl);
    assert.deepEqual(fieldsOf(tpl, "https://ws-42.ap-northeast-1.maas.aliyuncs.com/compatible-mode/v1/"), { workspace: "ws-42" });
    assert.deepEqual(fieldsOf(tpl, "https://api.x.ai/v1"), {});
    assert.deepEqual(fieldsOf("https://api.x.ai/v1", "https://api.x.ai/v1"), {});
  });
});

describe("prefixes", () => {
  const cfg = {
    upstreams: [{ id: "zai", name: "Z.AI" }, { id: "anthropic" }],
    routes: [
      { match: "zai/*", upstream: "zai", upstreamModel: "{1}", enabled: true },
      { match: "claude-*", upstream: "anthropic", upstreamModel: "{model}", enabled: true },
      { match: "fast/*", upstream: "anthropic", upstreamModel: "{1}", enabled: true, fallbacks: [{ upstream: "zai", upstreamModel: "{1}" }] },
    ],
  };
  test("a provider's prefix route is derived: its first enabled P/* → {1}; failover, overrides or a fixed format make it the operator's", () => {
    assert.equal(prefixRouteOf(cfg, "zai")?.match, "zai/*");
    assert.equal(prefixRouteOf(cfg, "anthropic"), null, "claude-* is a bare-name route; fast/* carries failover");
    const off = { ...cfg, routes: [{ ...cfg.routes[0], enabled: false }] };
    assert.equal(prefixRouteOf(off, "zai"), null, "a switched-off route is no prefix");
    for (const extra of [{ rules: { stream: { force: true } } }, { format: "anthropic" }, { upstreamModel: "{model}" }, { match: "re:^zai/(.*)$" }, { match: "zai/glm-*" }])
      assert.equal(prefixRouteOf({ ...cfg, routes: [{ ...cfg.routes[0], ...extra }] }, "zai"), null, JSON.stringify(extra));
  });
  test("a new prefix: an id's letters, not taken by an upstream, not already caught by a route", () => {
    assert.equal(prefixProblem(cfg, "zeta"), "");
    assert.match(prefixProblem(cfg, "zai"), /already the id of Z\.AI/);
    assert.match(prefixProblem(cfg, "ZAI"), /already the id/, "case does not make it another");
    assert.match(prefixProblem(cfg, "fast"), /route fast\/\* already catches/);
    assert.match(prefixProblem(cfg, ""), /Type a prefix/);
    assert.match(prefixProblem(cfg, "a/b"), /letters, digits/);
    assert.equal(freePrefix(cfg, "zai"), "zai-2");
    assert.equal(freePrefix(cfg, "kimi"), "kimi");
  });
  test("an address the catalogue does not know gets its host's name as a prefix", () => {
    assert.equal(hostWord("https://api.example.com/v1"), "example");
    assert.equal(hostWord("https://gateway.corp.internal"), "corp");
    assert.equal(hostWord("http://127.0.0.1:9000/v1"), "local");
    assert.equal(hostWord("http://localhost:4000"), "local");
    assert.equal(hostWord("not a url"), "");
  });
  test("a family's variants in the picker's words, each once", () => {
    assert.deepEqual(variantWords({ effort: { levels: ["low", "high"] }, speed: { options: ["standard", "fast", "flex"] }, thinking: { options: ["off", "on"] }, window: { options: [0, 1_000_000] } }), ["Low–High", "Fast", "Flex", "Thinking", "1M"]);
    assert.deepEqual(variantWords({ effort: null, speed: null, thinking: null, window: null }), []);
  });
});

describe("POST /api/providers/probe", () => {
  // The walkthrough's fake provider (the plan's §1): ten ids, one of them an embedding model; a key it takes.
  const IDS = ["zeta-5", "zeta-5-fast", "zeta-5-flex", "zeta-5-mini", "zeta-5-mini-low", "zeta-5-mini-high", "zeta-5-thinking", "zeta-5-non-reasoning", "zeta-5-1m", "zeta-embed-1"];
  /** @type {any} */ let up;
  /** @type {any} */ let open;
  /** @type {any} */ let shim;
  before(async () => {
    up = await fakeUpstream(async (call) => {
      if (!call.path.includes("/models")) return undefined;
      if (call.headers.authorization !== "Bearer good-key") return { status: 401, json: { error: { message: "invalid api key" } } };
      return { json: { object: "list", data: IDS.map((id) => ({ id, object: "model" })) } };
    });
    open = await fakeUpstream(async (call) => (call.path.startsWith("/site/") ? { text: "<!doctype html><title>Zeta</title>" } : call.path.includes("/models") ? { json: { models: [{ name: "llama-4" }] } } : undefined));
    shim = await startApp({ configure: (cfg) => { cfg.upstreams = []; cfg.routes = []; } });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    await open?.close();
  });
  const probe = async (/** @type {any} */ body) => {
    const r = await shim.api("/api/providers/probe", { method: "POST", body });
    return { status: r.status, j: await r.json() };
  };
  const draft = (/** @type {any} */ over = {}) => ({ id: "zeta", name: "Zeta", type: "openai-compatible", baseUrl: up.url, apiKey: "good-key", ...over });

  // (fails before: yes — there was no such route; the Test button answered a count)
  test("the fake provider's ten ids come back as the picker will show them: two families and one other", async () => {
    const { status, j } = await probe({ upstream: draft(), prefix: "zeta" });
    assert.equal(status, 200);
    assert.equal(j.ok, true);
    assert.deepEqual(j.models, IDS);
    assert.deepEqual(j.families.map((/** @type {any} */ f) => f.id), ["zeta/zeta-5", "zeta/zeta-5-mini"]);
    assert.deepEqual(j.other, ["zeta-embed-1"]);
    const five = j.families[0];
    assert.deepEqual(variantWords(five), ["Fast", "Flex", "Thinking", "1M"], "the family's variants, once each");
    assert.deepEqual(five.members.map((/** @type {any} */ m) => m.name).sort(), IDS.filter((id) => /^zeta-5(-fast|-flex|-thinking|-non-reasoning|-1m)?$/.test(id)).sort(), "each member says the name the provider spells");
    assert.deepEqual(variantWords(j.families[1]), ["Low–High"]);
  });

  test("nothing is written: not the config, not the model list, and the key is not kept", async () => {
    await probe({ upstream: draft(), prefix: "zeta" });
    const st = await (await shim.api("/api/state")).json();
    assert.deepEqual(st.config.upstreams, [], "no upstream was saved");
    assert.deepEqual(st.config.routes, [], "no route was saved");
    const models = await (await shim.api("/api/models")).json();
    assert.deepEqual(models.models, [], "no names are advertised");
    assert.equal(models.upstreams.zeta, undefined, "and nothing was cached under the draft's id");
  });

  test("a refused key says why in the provider's words; the page's gist reads them", async () => {
    const { j } = await probe({ upstream: draft({ apiKey: "wrong" }), prefix: "zeta" });
    assert.equal(j.ok, false);
    assert.equal(j.status, 401);
    assert.deepEqual([j.families, j.other], [[], []]);
    assert.equal(fmt.errorGist(j.sample), "invalid api key");
  });

  test("a keyless local server is asked without a key; a `models` listing reads like a `data` one", async () => {
    const before = open.received.length;
    const { j } = await probe({ upstream: { id: "lm", type: "openai-compatible", baseUrl: `${open.url}/v1`, apiKey: "" }, prefix: "lm" });
    assert.equal(j.ok, true);
    assert.deepEqual(j.models, ["llama-4"]);
    const call = open.received.slice(before).find((/** @type {any} */ c) => c.path.includes("/models"));
    assert.equal(call.path, "/v1/models");
    assert.equal(call.headers.authorization, undefined, "no key was sent");
  });

  // (fails before: yes, with the list check taken out — a web page read as a crash's words)
  test("an address that answers a web page is not a provider: it says so", async () => {
    const { j } = await probe({ upstream: { id: "site", type: "openai-compatible", baseUrl: `${open.url}/site/v1`, apiKey: "" }, prefix: "site" });
    assert.deepEqual([j.ok, j.status, j.error, j.models], [false, 200, "the answer is not a model list", []]);
    assert.match(j.sample, /<!doctype html>/, "the page's first words, for the hover");
  });

  test("nothing listening at the address says so in words (Ollama not started)", async () => {
    const gone = await fakeUpstream();
    const port = gone.port;
    await gone.close();
    const { j } = await probe({ upstream: { id: "ollama", type: "openai-compatible", baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "" }, prefix: "ollama" });
    assert.equal(j.ok, false);
    assert.equal(j.error, `nothing answers at 127.0.0.1:${port} (ECONNREFUSED)`);
  });

  // (fails before: yes — both read "fetch failed": fetch refuses a blocked port before it connects, with no code)
  test("a port fetch never calls says so, and a provider's Test says why it got no answer in the same words", async () => {
    const { j } = await probe({ upstream: { id: "odd", type: "openai-compatible", baseUrl: "http://127.0.0.1:1/v1", apiKey: "" }, prefix: "odd" });
    assert.equal(j.error, "127.0.0.1:1: that port is blocked for web requests (bad port)");
    const gone = await fakeUpstream();
    const port = gone.port;
    await gone.close();
    const t = await testProvider({ id: "ollama", type: "openai-compatible", baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "" });
    assert.deepEqual([t.ok, t.error], [false, `nothing answers at 127.0.0.1:${port} (ECONNREFUSED)`]);
  });

  test("a catalogue provider's hints come with the answer", async () => {
    const { j } = await probe({ upstream: draft(), prefix: "xai", provider: "xai" });
    assert.deepEqual(j.hints, { "grok-": { fastParams: { service_tier: "priority" } } });
  });

  test("an agent, a bad address and a missing draft are refused before anything is asked", async () => {
    const before = up.received.length;
    assert.equal((await probe({ upstream: { id: "a", type: "acp" } })).status, 400);
    assert.equal((await probe({})).status, 400);
    const { j } = await probe({ upstream: draft({ baseUrl: "ftp://x" }), prefix: "zeta" });
    assert.equal(j.ok, false);
    assert.match(j.error, /http:\/\/ or https:\/\//);
    assert.equal(up.received.length, before, "the provider was never asked");
  });

  // These save; each puts the configuration back as it found it.
  /** @param {(cfg: any) => void} edit */
  const save = async (edit) => {
    const cfg = structuredClone((await (await shim.api("/api/state")).json()).config);
    edit(cfg);
    const r = await shim.api("/api/config", { method: "PUT", body: cfg });
    assert.equal(r.status, 200, await r.text());
  };
  const empty = () => save((cfg) => { cfg.upstreams = []; cfg.routes = []; });
  /** @param {() => Promise<boolean>} ok */
  const until = async (ok, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ok()) return; await new Promise((r) => setTimeout(r, 25)); } assert.fail("timed out waiting"); };

  // (fails before: yes, with the probe asking through discovery — its answer was cached under the draft's id)
  test("an abandoned probe leaves nothing behind: a later provider saved under that id shows only what it answers", async () => {
    await probe({ upstream: draft(), prefix: "zeta" });
    await save((cfg) => {
      cfg.upstreams.push({ id: "zeta", type: "openai-compatible", baseUrl: up.url, apiKey: "wrong", enabled: true });
      cfg.routes.push({ match: "zeta/*", upstream: "zeta", upstreamModel: "{1}", enabled: true });
    });
    await until(async () => !!(await (await shim.api("/api/models")).json()).upstreams.zeta?.error);
    const m = await (await shim.api("/api/models")).json();
    assert.deepEqual(m.models.filter((/** @type {any} */ x) => x.upstream === "zeta"), [], "the refused key lists nothing — no names the probe once saw");
    await empty();
  });

  test("a stored key is never spliced into a draft: the placeholder goes as no key", async () => {
    await save((cfg) => { cfg.upstreams.push({ id: "zeta", type: "openai-compatible", baseUrl: up.url, apiKey: "good-key", enabled: true, discoverModels: false }); });
    const { j } = await probe({ upstream: draft({ apiKey: "__SECRET__" }), prefix: "zeta" });
    assert.equal(j.status, 401, "the saved zeta's good key was not used");
    await empty();
  });

  test("families are what the picker shows after the add: the prefix route sits above a saved catch-all", async () => {
    await save((cfg) => {
      cfg.upstreams.push({ id: "other", type: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1", enabled: true, discoverModels: false });
      cfg.routes.push({ match: "*", upstream: "other", upstreamModel: "{model}", enabled: true });
    });
    const { j } = await probe({ upstream: draft(), prefix: "zeta" });
    assert.deepEqual(j.families.map((/** @type {any} */ f) => f.id), ["zeta/zeta-5", "zeta/zeta-5-mini"], "the catch-all below does not take them");
    await empty();
  });
});
