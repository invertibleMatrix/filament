// @ts-check
// HarnessV3-Providers P1 (2026-10-01): "Add a provider" on the fake DOM — choose a tile, paste the key, the probe's
// families drawn as rows, one unticked, Add — and what the one write holds: the upstream, its prefix route at the top,
// the models left out as its hidden list, the catalogue's hints as its first rows. The write is POST /api/upstreams
// (HarnessV4_Settings_Plan HS-D3), answered here by the server's own code over a configuration in memory, so the page's
// body and the server's reading of it are pinned together. Edits elsewhere on the page stay unsaved. And on Routes
// (advanced), a provider's own prefix route is the provider's: shown, never edited there.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { bindUi, state as runtimeState } from "../src/ui/runtime.js";
import { providerAdd } from "../src/ui/pages/provider-add.js";
import { providerFor, billingAt } from "../src/ui/lib/providers.js";
import { followConfig } from "../src/ui/lib/config-follow.js";
import { routes } from "../src/ui/pages/destinations.js";
import { PROVIDERS } from "../src/core/providers.js";
import { createProviders } from "../src/app/providers.js";
import { redactConfig, configView } from "../src/services/config/store.js";
import { fmt } from "../src/ui/lib/format.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";

/** The dashboard's mutable bag, loosely typed as the pages read it. @type {any} */
const state = runtimeState;
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
/** Every node under `el` for which `ok` holds. @param {any} el @param {(n: any) => boolean} ok @returns {any[]} */
const all = (el, ok, out = /** @type {any[]} */ ([])) => {
  if (!el || typeof el !== "object") return out;
  if (ok(el)) out.push(el);
  for (const k of el.kids || []) all(k, ok, out);
  return out;
};
const one = (/** @type {any} */ el, /** @type {(n: any) => boolean} */ ok) => all(el, ok)[0];
const cls = (/** @type {string} */ c) => (/** @type {any} */ n) => String(n.attrs?.class || "").split(/\s+/).includes(c);
const button = (/** @type {any} */ el, /** @type {string} */ starts) => buttonsOf(el).find((b) => textOf(b).startsWith(starts));
/** Types into an input the way a person does: its value, then its input event. @param {any} i @param {string} v */
const type = (i, v) => { i.value = v; i.dispatch("input"); };

// The probe's answer for the walkthrough's fake provider, as POST /api/providers/probe gives it (test/providers.test.js
// pins the route itself): two families and one embedding model.
const fam = (/** @type {string} */ id, /** @type {string[]} */ names, /** @type {any} */ axes) => ({ id: `zeta/${id}`, upstream: "zeta", kind: "variants", members: names.map((n) => ({ id: `zeta/${n}`, name: n })), effort: null, speed: null, thinking: null, window: null, ...axes });
const PROBE = {
  ok: true, status: 200, ms: 12, sample: "",
  models: ["zeta-5", "zeta-5-fast", "zeta-5-mini", "zeta-5-mini-low", "zeta-5-mini-high", "zeta-embed-1"],
  families: [fam("zeta-5", ["zeta-5", "zeta-5-fast"], { speed: { via: "name", options: ["standard", "fast"] } }), fam("zeta-5-mini", ["zeta-5-mini", "zeta-5-mini-low", "zeta-5-mini-high"], { effort: { via: "name", levels: ["low", "high"] } })],
  other: ["zeta-embed-1"], hints: {},
};

/**
 * The configuration as the server keeps it, in memory: what `changeConfig` sets and saves, its version moving per save,
 * and `unreadable` the places its secret.key cannot open.
 * @param {any} cfg @param {string[]} unreadable
 */
const memoryStore = (cfg, unreadable) => {
  let now = cfg;
  let version = 1;
  return { get: () => now, set: (/** @type {any} */ c) => { now = c; }, save: () => { version += 1; }, version: () => version, at: () => null, unreadable: () => unreadable };
};

/** @type {{ path: string, o: any }[]} */
let calls;
let probeAnswer = /** @type {any} */ (PROBE);
/** @type {ReturnType<typeof memoryStore>} */
let store;
/** @type {ReturnType<typeof followConfig>} */
let follow;
/** What the store's secret.key cannot open, as a test sets it. @type {string[]} */
let lost;
beforeEach((t) => {
  /** @type {any} */ (t).mock.timers.enable({ apis: ["setTimeout"] }); // the probe's 600 ms quiet time is the test's to run
  calls = [];
  probeAnswer = PROBE;
  lost = [];
  const base = { upstreams: [{ id: "anthropic", name: "Anthropic", type: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "sk-ant-kept" }], routes: [{ match: "claude-*", upstream: "anthropic", upstreamModel: "{model}", enabled: true }] };
  store = memoryStore(structuredClone(base), lost);
  const providers = createProviders({ config: /** @type {any} */ (store) });
  const page = redactConfig(base);
  Object.assign(state, { config: structuredClone(page), saved: structuredClone(page), dirty: false, addFlow: null, addUp: true, selUp: null, _providers: null, justAdded: null, requests: [], tab: "upstreams", schema: { upstreamTypes: { anthropic: { label: "Anthropic API (your own key)" }, "openai-compatible": { label: "OpenAI-compatible server (…)" } } } });
  follow = followConfig({ dirty: () => state.dirty, reload: async () => null, changes: async () => ({ count: null, changes: null }), bar: () => {} });
  follow.loaded(store.version());
  bindUi({
    h: fakeH, fmt,
    toast: () => {},
    render: () => {},
    markDirty: (/** @type {boolean} */ on = true) => { state.dirty = on; },
    configFollow: follow,
    api: async (/** @type {string} */ path, /** @type {any} */ o) => {
      calls.push({ path, o: o && structuredClone(o) });
      if (path === "/providers") return { providers: structuredClone(PROVIDERS) };
      if (path === "/providers/probe") return structuredClone(probeAnswer);
      // The admin route's answer (http/admin/providers.js), from the server's own code.
      if (path === "/upstreams" && o?.method === "POST") {
        try {
          const upstream = providers.add(o.body);
          return { upstream, ...configView(store), version: store.version() };
        } catch (/** @type {any} */ e) {
          throw Object.assign(new Error(e.message), { status: e.status, body: { error: e.message, ...(e.extra || {}) } });
        }
      }
      throw new Error(`unexpected ${path}`);
    },
  });
});
/** The one write's body, and the provider and route it left in the configuration. @param {string} id */
const added = (id) => ({
  body: calls.find((c) => c.path === "/upstreams")?.o.body,
  up: store.get().upstreams.find((/** @type {any} */ u) => u.id === id),
  routes: store.get().routes,
});
afterEach(() => { state.addFlow = null; });

/** The flow at its Connect step for one tile. @param {string} id */
async function connectTo(id) {
  const box = providerAdd({ canCancel: true });
  await settle();
  const tile = one(box, (n) => n.attrs?.["data-provider"] === id);
  assert.ok(tile, `a tile for ${id}`);
  tile.dispatch("click");
  await settle();
  return box;
}
const inputs = (/** @type {any} */ box) => ({
  url: one(box, (n) => n.tag === "input" && n.attrs?.placeholder === "https://gateway.example.com/v1"),
  key: one(box, (n) => n.tag === "input" && n.attrs?.type === "password"),
  prefix: one(box, cls("prefix-in")),
});
const probes = () => calls.filter((c) => c.path === "/providers/probe");

// (fails before: yes — there was no such flow: "OpenAI-compatible server" opened a card of twelve empty fields)
test("custom provider: the address names the prefix, the key asks after a quiet time, the families are rows, and Add saves it all in one", async (t) => {
  const box = await connectTo("custom-openai");
  const { url, key, prefix } = inputs(box);
  type(url, "http://127.0.0.1:51704/v1");
  assert.equal(prefix.value, "local", "an address on this machine proposes the prefix local");
  type(prefix, "zeta");
  type(key, "good-key");
  assert.equal(probes().length, 0, "nothing is asked while typing");
  t.mock.timers.tick(600);
  await settle();
  assert.equal(probes().length, 1, "asked once, 600 ms after the typing stopped");
  const sent = probes()[0].o.body;
  assert.deepEqual([sent.prefix, sent.upstream.baseUrl, sent.upstream.apiKey, sent.upstream.type, sent.provider], ["zeta", "http://127.0.0.1:51704/v1", "good-key", "openai-compatible", ""]);
  assert.match(textOf(box), /connected\| \|6 models/);
  assert.match(textOf(box), /Your tools ask for \|zeta\/zeta-5/);
  const rows = all(box, cls("fam-row"));
  assert.deepEqual(rows.map((r) => r.attrs["data-family"]), ["zeta/zeta-5", "zeta/zeta-5-mini"]);
  assert.match(textOf(rows[0]), /Fast/);
  assert.match(textOf(rows[1]), /Low–High/);
  assert.match(textOf(box), /Other models \(not for chat\) · 1/);
  // Leave the mini family out.
  const cb = one(rows[1], (n) => n.tag === "input" && n.attrs?.type === "checkbox");
  cb.checked = false;
  cb.dispatch("change");
  assert.match(textOf(box), /1 of 2 offered in pickers/);
  const add = button(box, "Add this provider");
  assert.equal(add.disabled, false, "Add is offered once it connected");
  add.dispatch("click");
  await settle();
  assert.equal(calls.filter((c) => c.path === "/upstreams" || c.path === "/config").length, 1, "one write, and never the whole configuration");
  const { body, up, routes: rs } = added("zeta");
  assert.deepEqual([body.provider, body.type, body.prefix, body.baseUrl], ["", "openai-compatible", "zeta", "http://127.0.0.1:51704/v1"]);
  const pick = (/** @type {any} */ u, /** @type {string[]} */ keys) => Object.fromEntries(keys.map((k) => [k, u[k]]));
  assert.deepEqual(pick(up, ["id", "name", "type", "baseUrl", "apiKey", "authStyle", "wireApi", "modelsPath", "headers", "enabled", "hiddenModels", "pricing"]), { id: "zeta", name: "zeta", type: "openai-compatible", baseUrl: "http://127.0.0.1:51704/v1", apiKey: "good-key", authStyle: "auto", wireApi: "auto", modelsPath: "", headers: {}, enabled: true, hiddenModels: ["zeta-5-mini", "zeta-5-mini-low", "zeta-5-mini-high", "zeta-embed-1"], pricing: {} });
  assert.deepEqual(pick(rs[0], ["match", "upstream", "upstreamModel", "format", "fallbacks", "discoverPrefixes", "enabled"]), { match: "zeta/*", upstream: "zeta", upstreamModel: "{1}", format: "auto", fallbacks: [], discoverPrefixes: [], enabled: true }, "its prefix route, at the top");
  assert.equal(rs[1].match, "claude-*", "the other routes as they were");
  assert.deepEqual([state.selUp, state.addUp, state.addFlow, state.justAdded], ["zeta", false, null, { id: "zeta", prefix: "zeta" }], "its card opens, saying so");
  assert.equal(state.dirty, false);
  assert.ok(state.config.upstreams.some((/** @type {any} */ u) => u.id === "zeta"), "the page holds the configuration the write left");
  assert.equal(follow.base(), store.version(), "and the version it is at, for its next Save");
});

// (fails before: yes — the bug hunt of 10-30, #4: a clean page took the configuration the add left, but kept its list of
// what this secret.key cannot read from before)
test("a clean page takes the add's answer whole: the configuration it left, and what this secret.key cannot read in it", async (t) => {
  state.unreadable = [];
  store.get().upstreams[0].apiKey = "";
  lost.push("upstreams.anthropic.apiKey");
  const box = await connectTo("custom-openai");
  const { url, key } = inputs(box);
  type(url, "http://127.0.0.1:51704/v1");
  type(key, "good-key");
  t.mock.timers.tick(600);
  await settle();
  button(box, "Add this provider").dispatch("click");
  await settle();
  assert.deepEqual(state.unreadable, ["upstreams.anthropic.apiKey"]);
  assert.equal(state.config.upstreams.find((/** @type {any} */ u) => u.id === "anthropic").apiKey, "__SECRET__", "kept, shown as kept");
});

test("catalogue provider: its default plan's address, its key page, its hints as the new rows; a refused key says why and offers Add anyway", async (t) => {
  const box = await connectTo("zai");
  assert.match(textOf(box), /Coding plan/, "Z.AI opens on its coding plan (the owner, 2026-10-01)");
  assert.match(textOf(box), /A subscription: requests use your plan\./);
  assert.ok(one(box, (n) => n.tag === "a" && n.attrs?.href === "https://z.ai/manage-apikey/apikey-list"), "Get a key");
  assert.equal(probes().length, 0, "no key yet: nothing is asked");
  assert.match(textOf(box), /Paste the key to connect\./);
  const { key } = inputs(box);
  probeAnswer = { ok: false, status: 401, ms: 5, sample: '{"error":{"message":"invalid api key"}}', error: "HTTP 401", models: [], families: [], other: [], hints: {} };
  key.value = "bad";
  key.dispatch("input");
  key.dispatch("keydown", { key: "Enter" });
  await settle();
  assert.equal(probes().length, 1, "Enter asks at once");
  assert.equal(probes()[0].o.body.upstream.baseUrl, "https://api.z.ai/api/coding/paas/v4");
  assert.equal(probes()[0].o.body.provider, "zai");
  assert.match(textOf(box), /not connected\| \|401 · invalid api key/);
  assert.equal(button(box, "Add Z.AI").disabled, true, "no Add on a refused key");
  assert.ok(button(box, "Add anyway"), "but a provider with no model list can still be added");
  t.mock.timers.tick(600);
  await settle();
  assert.equal(probes().length, 1, "Enter cancelled the quiet time's ask");
  // The right key, and xAI-style hints on the answer: they become the upstream's rows.
  probeAnswer = { ...PROBE, families: PROBE.families.map((f) => ({ ...f, id: f.id.replace("zeta/", "zai/") })), hints: { "glm-": { effortDefault: "high" } } };
  type(key, "good");
  t.mock.timers.tick(600);
  await settle();
  button(box, "Add Z.AI").dispatch("click");
  await settle();
  const { body, up, routes: rs } = added("zai");
  assert.deepEqual([body.provider, body.plan], ["zai", "coding"]);
  assert.deepEqual([up.name, up.baseUrl, up.apiKey], ["Z.AI (GLM)", "https://api.z.ai/api/coding/paas/v4", "good"]);
  assert.deepEqual(up.pricing, structuredClone(PROVIDERS.find((p) => p.id === "zai")?.hints || {}), "the catalogue's hints are its first rows");
  assert.equal(rs[0].match, "zai/*");
});

test("a plan switch asks again at the new address; a workspace field fills DashScope's", async (t) => {
  const box = await connectTo("dashscope");
  assert.match(textOf(box), /Type the Workspace ID to connect\./, "the Singapore address needs its workspace first");
  const ws = one(box, (n) => n.tag === "input" && n.attrs?.placeholder === "ws-…");
  type(ws, "ws-9");
  type(inputs(box).key, "k");
  t.mock.timers.tick(600);
  await settle();
  assert.equal(probes().at(-1)?.o.body.upstream.baseUrl, "https://ws-9.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1");
  button(box, "US (Virginia)").dispatch("click");
  await settle();
  assert.equal(probes().at(-1)?.o.body.upstream.baseUrl, "https://dashscope-us.aliyuncs.com/compatible-mode/v1", "the new plan's address, asked at once with the key kept");
  assert.equal(probes().at(-1)?.o.body.upstream.apiKey, "k");
});

test("answers that land out of order: the older one is never drawn", async () => {
  /** @type {((v: any) => void)[]} */
  const held = [];
  const api = (/** @type {string} */ path, /** @type {any} */ o) => {
    calls.push({ path, o: o && structuredClone(o) });
    if (path === "/providers") return Promise.resolve({ providers: structuredClone(PROVIDERS) });
    return new Promise((r) => held.push(r));
  };
  bindUi({ api });
  const box = await connectTo("zai");
  const { key } = inputs(box);
  type(key, "old");
  key.dispatch("keydown", { key: "Enter" });
  type(key, "new");
  key.dispatch("keydown", { key: "Enter" });
  assert.equal(held.length, 2);
  held[1]({ ...PROBE, families: [PROBE.families[0]] });
  await settle();
  held[0]({ ok: false, status: 401, sample: "old key refused", models: [], families: [], other: [], hints: {} });
  await settle();
  assert.equal(all(box, cls("fam-row")).length, 1, "the newer answer's one family");
  assert.doesNotMatch(textOf(box), /old key refused|not connected/);
});

test("a prefix that is taken cannot be added, and says why", async (t) => {
  state.config.routes.push({ match: "zeta/special", upstream: "anthropic", upstreamModel: "x", enabled: true });
  state.saved = structuredClone(state.config);
  const box = await connectTo("custom-openai");
  const { url, key, prefix } = inputs(box);
  type(url, "http://127.0.0.1:1/v1");
  type(prefix, "zeta");
  type(key, "k");
  t.mock.timers.tick(600);
  await settle();
  assert.match(textOf(box), /The route zeta\/special already catches names starting with zeta\//);
  assert.equal(button(box, "Add this provider").disabled, true);
  type(prefix, "anthropic");
  assert.match(textOf(box), /anthropic is already the id of Anthropic/);
});

test("with unsaved edits elsewhere, Add saves only the provider: the edits stay unsaved, and the draft gains the provider too", async (t) => {
  state.config.upstreams[0].name = "Anthropic (edited, unsaved)";
  state.dirty = true;
  const box = await connectTo("custom-openai");
  const { url, key, prefix } = inputs(box);
  type(url, "http://127.0.0.1:1/v1");
  type(prefix, "zeta");
  type(key, "k");
  t.mock.timers.tick(600);
  await settle();
  const before = follow.base();
  button(box, "Add this provider").dispatch("click");
  await settle();
  assert.equal(store.get().upstreams.find((/** @type {any} */ u) => u.id === "anthropic").name, "Anthropic", "the write carried the provider alone, not the edit");
  assert.equal(state.dirty, true, "the edit is still to be saved");
  assert.equal(state.config.upstreams[0].name, "Anthropic (edited, unsaved)");
  assert.ok(state.config.upstreams.some((/** @type {any} */ u) => u.id === "zeta") && state.config.routes[0].match === "zeta/*", "the draft holds the new provider as well");
  assert.ok(state.saved.upstreams.some((/** @type {any} */ u) => u.id === "zeta"));
  // The draft holds what the write made, and nothing else changed between: its next Save names the new version.
  assert.equal(follow.base(), before + 1);
});

// HS-D3: an edited draft merges a write of its own only when nothing else changed between — a change that landed
// meanwhile (a sign-in's tokens, the harness) is not in the draft, so its next Save must still be refused.
// (fails before: yes — the add saved the page's copy of the whole configuration, undoing whatever landed meanwhile)
test("with unsaved edits, a change that landed before the add keeps the draft's version, so its Save is refused", async (t) => {
  state.config.upstreams[0].name = "Anthropic (edited, unsaved)";
  state.dirty = true;
  // Another window's save, not yet heard by this page.
  store.get().upstreams[0].name = "Anthropic (renamed elsewhere)";
  store.save();
  const box = await connectTo("custom-openai");
  const { url, key, prefix } = inputs(box);
  type(url, "http://127.0.0.1:1/v1");
  type(prefix, "zeta");
  type(key, "k");
  t.mock.timers.tick(600);
  await settle();
  const before = follow.base();
  button(box, "Add this provider").dispatch("click");
  await settle();
  assert.equal(store.get().upstreams[0].name, "Anthropic (renamed elsewhere)", "the other window's change stands");
  assert.ok(store.get().upstreams.some((/** @type {any} */ u) => u.id === "zeta"));
  assert.equal(follow.base(), before, "the draft is still at the version it was read at");
});

test("a prefix taken since the page drew it: the server's refusal, and a free prefix offered in the box", async (t) => {
  const box = await connectTo("custom-openai");
  const { url, key, prefix } = inputs(box);
  type(url, "http://127.0.0.1:1/v1");
  type(prefix, "zeta");
  type(key, "k");
  t.mock.timers.tick(600);
  await settle();
  // Another window added a zeta meanwhile.
  store.get().upstreams.push({ id: "zeta", name: "Zeta", type: "openai-compatible", baseUrl: "http://127.0.0.1:2/v1" });
  store.save();
  button(box, "Add this provider").dispatch("click");
  await settle();
  assert.equal(store.get().upstreams.filter((/** @type {any} */ u) => u.id === "zeta").length, 1, "nothing added over it");
  assert.equal(inputs(box).prefix.value, "zeta-2", "the server's free prefix, ready for a second Add");
  assert.match(textOf(box), /zeta is already the id of Zeta/);
});

test("OpenRouter's hundreds start unticked; the search narrows the tiles", async (t) => {
  const box = providerAdd({ special: [{ title: "Qoder cloud", when: "Your Qoder account", action: () => {} }] });
  await settle();
  const search = one(box, cls("prov-search"));
  type(search, "qoder");
  assert.deepEqual(all(box, cls("add-option")).map((n) => textOf(n).split("|")[0]), ["Qoder cloud"]);
  type(search, "router");
  one(box, (n) => n.attrs?.["data-provider"] === "openrouter").dispatch("click");
  await settle();
  type(inputs(box).key, "k");
  t.mock.timers.tick(600);
  await settle();
  assert.match(textOf(box), /0 of 2 offered in pickers/, "every family starts unticked");
});

test("Routes (advanced): a provider's prefix route is shown as the provider's, with no Edit; other routes keep theirs", () => {
  state.config = {
    upstreams: [{ id: "zai", name: "Z.AI", type: "openai-compatible", baseUrl: "https://api.z.ai/api/coding/paas/v4" }, { id: "anthropic", name: "Anthropic", type: "anthropic", baseUrl: "https://api.anthropic.com" }],
    routes: [{ match: "zai/*", upstream: "zai", upstreamModel: "{1}", enabled: true }, { match: "claude-*", upstream: "anthropic", upstreamModel: "{model}", enabled: true }],
    rules: {},
  };
  state._modelNames = [];
  bindUi({
    intro: (/** @type {string} */ _id, /** @type {any[]} */ ...kids) => fakeH("div", {}, ...kids), cmpTable: () => fakeH("table"), routeTester: () => fakeH("div"), empty: () => fakeH("p"),
    modelCatalog: () => null, flatten: (/** @type {any} */ o) => o || {}, routeMeaning: () => "meaning", store: { get: () => null, set() {} }, STRATEGIES: [], go: () => {},
  });
  const page = routes();
  const rows = all(page, (n) => n.tag === "tr" && !cls("meaning-row")(n) && textOf(n).includes("*"));
  const zai = rows.find((r) => textOf(r).includes("zai/*"));
  const claude = rows.find((r) => textOf(r).includes("claude-*"));
  assert.match(textOf(zai), /made by provider Z\.AI: \|edit its prefix on the provider/);
  assert.deepEqual(buttonsOf(zai).map(textOf), ["Provider"], "no Edit and no moving: its prefix is set on the provider");
  assert.equal(one(zai, (n) => n.tag === "input" && n.attrs?.type === "checkbox").attrs.disabled, "", "nor switched off here");
  assert.deepEqual(buttonsOf(claude).map(textOf), ["Edit", "↑", "↓"]);
  assert.match(textOf(page), /You need this page for bare names, rewrites, failover and virtual models\./);
});

// Providers P4: the provider card's billing switch shows what core/pricing.js `billingOf` decides for the upstream.
// (fails before: yes — the card had no billing at all)
test("the card's billing: its own choice, else the catalogue plan its address is, else per token", () => {
  const zaiCoding = providerFor([...PROVIDERS], "https://api.z.ai/api/coding/paas/v4");
  assert.ok(zaiCoding, "the catalogue knows the address");
  assert.deepEqual(billingAt({}, zaiCoding), { billing: "plan", source: "catalogue" });
  assert.deepEqual(billingAt({ billing: "metered" }, zaiCoding), { billing: "metered", source: "upstream" }, "a choice beats the catalogue");
  assert.deepEqual(billingAt({ billing: "plan" }, null), { billing: "plan", source: "upstream" });
  assert.deepEqual(billingAt({ billing: "free" }, null), { billing: "metered", source: "default" }, "anything else is nobody saying");
  assert.deepEqual(billingAt({}, providerFor([...PROVIDERS], "https://api.z.ai/api/paas/v4")), { billing: "metered", source: "catalogue" });
});
