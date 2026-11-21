// @ts-check
// HarnessV3-Providers P2 (2026-10-01): models listed by family.
// - The core sets a model that is not for chat apart, as a family of its own (kind "other"), never folded with chat ids.
// - The caps route answers a provider card's family table over every name the upstream offers, the hidden ones too.
// - The card draws one row per family: a checkbox that hides every member, the chips once, one window cell and a quiet
//   list price; its ids sit under a ▸ and the other models are set apart.
// - The Tune sheet's Pricing writes the list price on the row the sheet is keyed on.
// - The Models tab joins a model's families across providers. The harness picker leaves "other" out.
// - The client's /v1/models is not touched by any of it.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startApp, fakeUpstream } from "./helpers/app.js";
import { buildFamilies } from "../src/core/model-families.js";
import { UPSTREAM_TYPES } from "../src/core/schema.js";
import { familyWindowWords, spelledWords } from "../src/ui/lib/model-caps.js";
import { openTune } from "../src/ui/lib/model-tune.js";
import { pickable } from "../src/ui/harness/lib/families.js";
import { bindUi, state as runtimeState } from "../src/ui/runtime.js";
import { upstreams, models as modelsTab } from "../src/ui/pages/destinations.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";
import { fmt } from "../src/ui/lib/format.js";

/** @type {any} */
const state = runtimeState;
/** @param {any} el @param {(n: any) => boolean} ok @returns {any[]} */
const all = (el, ok, out = /** @type {any[]} */ ([])) => {
  if (!el || typeof el !== "object") return out;
  if (ok(el)) out.push(el);
  for (const k of el.kids || []) all(k, ok, out);
  return out;
};
const cls = (/** @type {string} */ c) => (/** @type {any} */ n) => String(n.attrs?.class || "").split(/\s+/).includes(c);
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

// The walkthrough's fake provider (the plan's §1): ten ids, one of them an embedding model. A second provider serves
// zeta-5 too, so the Models tab has one model at two places.
const IDS = ["zeta-5", "zeta-5-fast", "zeta-5-flex", "zeta-5-mini", "zeta-5-mini-low", "zeta-5-mini-high", "zeta-5-thinking", "zeta-5-non-reasoning", "zeta-5-1m", "zeta-embed-1"];
/** @type {any} */ let zeta;
/** @type {any} */ let rt;
/** @type {any} */ let shim;
/** What the server answered, for the page tests: the card's table, the plain caps answer, the catalogue, the client list. */
/** @type {any} */ let caps;
/** @type {any} */ let capsPlain;
/** @type {any} */ let capsRt;
/** @type {any} */ let catalog;
/** @type {any} */ let v1;
/** @type {any} */ let savedCfg;
const list = (/** @type {string[]} */ ids) => async (/** @type {any} */ call) => (call.path.includes("/models") ? { json: { object: "list", data: ids.map((id) => ({ id, object: "model" })) } } : undefined);

before(async () => {
  zeta = await fakeUpstream(list(IDS));
  rt = await fakeUpstream(list(["zeta-5-fast", "zeta-5", "other-1"])); // the fast id first: the lead is still the plain one
  shim = await startApp({
    configure: (cfg) => {
      cfg.upstreams = [
        { id: "zeta", name: "Zeta", type: "openai-compatible", baseUrl: zeta.url, apiKey: "k", enabled: true, hiddenModels: ["zeta-5-fast"], pricing: { "zeta-5-mini": { input: 0.5, output: 2 } } },
        { id: "rt", name: "Router", type: "openai-compatible", baseUrl: rt.url, apiKey: "k", enabled: true },
      ];
      cfg.routes = [
        { match: "zeta/*", upstream: "zeta", upstreamModel: "{1}", enabled: true },
        { match: "rt/*", upstream: "rt", upstreamModel: "{1}", enabled: true },
      ];
    },
  });
  await (await shim.api("/api/models?refresh=1")).json(); // ask both providers once (a saved config asks on save)
  const post = async (/** @type {any} */ body) => (await shim.api("/api/models/caps", { method: "POST", body })).json();
  caps = await post({ upstream: { id: "zeta" }, families: true });
  capsPlain = await post({ upstream: { id: "zeta" } });
  capsRt = await post({ upstream: { id: "rt" }, families: true });
  catalog = await (await shim.api("/api/models")).json();
  v1 = await (await shim.api("/v1/models")).json();
  savedCfg = (await (await shim.api("/api/state")).json()).config; // the redacted config, as the dashboard holds it
});
after(async () => {
  await shim?.stop();
  await zeta?.close();
  await rt?.close();
});

describe("the core: a model that is not for chat", () => {
  // (fails before: yes — zeta-embed-1 was a chat model in every family list)
  test("is a family of its own, kind other, never folded with chat ids", () => {
    const cfg = { upstreams: [{ id: "z", type: "openai-compatible", baseUrl: "http://127.0.0.1:1/v1" }], routes: [{ match: "z/*", upstream: "z", upstreamModel: "{1}", enabled: true }] };
    const rows = ["zeta-5", "zeta-5-fast", "zeta-embed-1", "text-embedding-3-small", "text-embedding-3-small-fast"].map((n) => ({ id: `z/${n}`, upstream: "z", upstreamModel: n, source: "discovered" }));
    const fams = buildFamilies(cfg, rows);
    assert.deepEqual(fams.map((f) => [f.id, f.kind, f.members.length]), [
      ["z/zeta-5", "variants", 2],
      ["z/zeta-embed-1", "other", 1],
      ["z/text-embedding-3-small", "other", 1],
      ["z/text-embedding-3-small-fast", "other", 1],
    ], "an embedding id that spells -fast stays alone: it is no speed of a chat model");
    assert.equal(fams[1].effort, null);
    assert.equal(fams[1].speed, null);
  });

  test("the harness picker lists every family but the other ones", () => {
    const f = (/** @type {string} */ id, /** @type {any} */ kind) => /** @type {any} */ ({ id, kind, upstream: "z", members: [] });
    assert.deepEqual(pickable([f("a", "model"), f("e", "other"), f("v", "variants"), f("t", "team")]).map((x) => x.id), ["a", "v", "t"]);
    assert.match(readFileSync("src/ui/harness/composer/model.js", "utf8"), /families\.length \? \/\*\* @type \{any\[\]\} \*\/ \(pickable\(families\)\)/, "and the picker lists through it");
  });

  // (fails before: yes — the add flow's `.fam-row { display: grid }` also caught the Models tab's group rows, a P1 fault)
  test("the add flow's family rows are styled inside their own list only", () => {
    const css = readFileSync("src/ui/style.css", "utf8");
    // every selector that names .fam-row, one by one (two rules can share a line)
    const sels = [...css.matchAll(/([^{}]*)\{/g)].flatMap((m) => m[1].split(",")).map((s) => s.trim()).filter((s) => /\.fam-row\b/.test(s));
    assert.ok(sels.length >= 3, sels.join(" | "));
    assert.deepEqual(sels.filter((s) => !s.startsWith(".fam-list ")), []);
  });
});

describe("the caps route's family table", () => {
  // (fails before: yes — the route answered one card per name, the hidden ones left out, and no families)
  test("lists every name the upstream offers, the hidden one too, with each family's lead and each id's own name", () => {
    const ids = caps.families.flatMap((/** @type {any} */ f) => f.members.map((/** @type {any} */ m) => m.name)).sort();
    assert.deepEqual(ids, [...IDS].sort(), "all ten, zeta-5-fast (hidden in the saved config) included");
    assert.deepEqual(caps.families.map((/** @type {any} */ f) => [f.id, f.kind, f.lead, f.name]), [
      ["zeta/zeta-5", "variants", "zeta/zeta-5", "zeta-5"],
      ["zeta/zeta-5-mini", "variants", "zeta/zeta-5-mini", "zeta-5-mini"],
      ["zeta/zeta-embed-1", "other", "zeta/zeta-embed-1", "zeta-embed-1"],
    ]);
    assert.ok(caps.families[0].members.every((/** @type {any} */ m) => m.source === "discovered"));
    assert.deepEqual(caps.models.map((/** @type {any} */ m) => m.id).sort(), ["zeta/zeta-5", "zeta/zeta-5-mini", "zeta/zeta-embed-1"], "a card for each family's lead, not one per id");
    assert.deepEqual(capsRt.families.map((/** @type {any} */ f) => [f.id, f.lead, f.members.map((/** @type {any} */ m) => m.id).join(",")]), [["rt/zeta-5", "rt/zeta-5", "rt/zeta-5-fast,rt/zeta-5"], ["rt/other-1", "rt/other-1", "rt/other-1"]], "the lead is the id that spells no variant, wherever the provider lists it");
    const mini = caps.models.find((/** @type {any} */ m) => m.id === "zeta/zeta-5-mini");
    assert.deepEqual([mini.price.input, mini.price.output, mini.price.source], [0.5, 2, "upstream"]);
  });

  test("without the families flag the answer is what it was: no table, the hidden id left out", () => {
    assert.equal(capsPlain.families, undefined);
    const ids = capsPlain.models.map((/** @type {any} */ m) => m.id);
    assert.ok(!ids.includes("zeta/zeta-5-fast"));
    assert.ok(ids.includes("zeta/zeta-5-flex"));
  });

  // (the plan's golden: the client list is unchanged — an embedding model still routes and is still listed)
  test("the client's /v1/models still lists the embedding model; the catalogue marks it other", () => {
    const ids = v1.data.map((/** @type {any} */ m) => m.id);
    assert.ok(ids.includes("zeta/zeta-embed-1"));
    assert.ok(!ids.includes("zeta/zeta-5-fast"), "the hidden id is not listed, as before");
    assert.deepEqual(ids.filter((/** @type {string} */ i) => i.startsWith("zeta/")).sort(), IDS.filter((n) => n !== "zeta-5-fast").map((n) => `zeta/${n}`).sort());
    const emb = catalog.families.find((/** @type {any} */ f) => f.id === "zeta/zeta-embed-1");
    assert.equal(emb?.kind, "other");
  });
});

describe("the caps route on an agent upstream (HarnessV3-FixRound decision 26)", () => {
  /** @type {any} */ let agentShim;
  /** @type {any} */ let capsCc;
  before(async () => {
    agentShim = await startApp({
      configure: (cfg) => {
        const fake = new URL("./fixtures/fake-acp-agent.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
        cfg.upstreams = [{ id: "cc", name: "Fake agent", type: "acp", enabled: true, acp: { command: process.execPath, args: [fake], permissions: "allow-all", hints: false }, pricing: { "fake-a": { input: 15, output: 75 } } }];
        cfg.routes = [{ match: "cc/*", upstream: "cc", upstreamModel: "{1}", enabled: true }];
      },
    });
    await (await agentShim.api("/api/models?refresh=1")).json(); // ask the agent for its models once
    capsCc = await (await agentShim.api("/api/models/caps", { method: "POST", body: { upstream: { id: "cc" }, families: true } })).json();
  });
  after(async () => { await agentShim?.stop(); });

  // (fails before: yes — the route answered no price for any agent model, so the card and the sheet never showed the
  // list price the operator wrote; an agent turn's record was priced by it all along)
  test("answers the row the operator wrote, with its source: the page shows an agent only a price someone set", () => {
    assert.equal(capsCc.agent, true);
    const byId = new Map(capsCc.models.map((/** @type {any} */ m) => [m.id, m]));
    assert.deepEqual(["cc/fake-a", "cc/fake-b"].filter((id) => byId.has(id)), ["cc/fake-a", "cc/fake-b"], "both of the agent's models are on the card");
    const a = byId.get("cc/fake-a");
    assert.deepEqual([a.price?.input, a.price?.output, a.price?.source], [15, 75, "upstream"]);
    assert.equal(byId.get("cc/fake-b").price, null, "a model nobody prices has no card");
  });
});

describe("the card's Models section, on the fake DOM", () => {
  /** @type {any} */ let marked;
  beforeEach(() => {
    /** @type {any} */ (globalThis).location = { search: "" };
    marked = 0;
    const cfg = structuredClone(savedCfg);
    Object.assign(state, { tab: "upstreams", addUp: false, addFlow: null, justAdded: null, dirty: false, requests: [], _providers: { providers: [] }, _usage30: null, config: cfg, saved: structuredClone(cfg), selUp: "zeta",
      schema: { upstreamTypes: { "openai-compatible": { label: "OpenAI-compatible server (…)", formats: ["openai"] }, acp: UPSTREAM_TYPES.acp }, upstream: {} } });
    bindUi({
      h: fakeH, fmt,
      api: async (/** @type {string} */ path) => (path === "/models/caps" ? caps : path.startsWith("/models") ? catalog : path.startsWith("/usage") ? { total: { rows: [] } } : {}),
      toast() {}, render() {}, markDirty: (/** @type {boolean} */ on = true) => { state.dirty = on; if (on) marked++; },
      input: (/** @type {any} */ u, /** @type {string} */ k) => fakeH("input", { value: u[k] || "", "data-field": k }), idInput: () => fakeH("input"), flatten: (/** @type {any} */ o) => o || {}, openRulesDrawer() {}, mergedRules() {}, removeUpstream() {},
      goto: (/** @type {string} */ _t, /** @type {string} */ l) => fakeH("a", {}, l), intro: (/** @type {string} */ _id, /** @type {any[]} */ ...k) => fakeH("div", {}, ...k), md: (/** @type {string} */ s) => s,
      store: { get: () => null, set() {} }, pingResult: () => fakeH("span"), memAgo: () => "now", empty: (/** @type {string} */ a) => fakeH("p", {}, a),
      schemaForm: () => fakeH("div"), bridgeModes: () => [], BRIDGE_HINT: {},
    });
  });
  const panel = async () => {
    const page = upstreams();
    await settle();
    return all(page, cls("models-box"))[0];
  };
  const famRows = (/** @type {any} */ box) => all(box, (n) => n.tag === "tr" && n.attrs?.["data-family"]);

  // (fails before: yes — every id was its own row, each carrying the whole family's chips, the embedding model among them)
  test("one row per family, chips once, one window cell, a quiet list price; the other model apart", async () => {
    const box = await panel();
    const rows = famRows(box);
    assert.deepEqual(rows.map((r) => r.attrs["data-family"]), ["zeta/zeta-5", "zeta/zeta-5-mini"]);
    const five = textOf(rows[0]);
    assert.equal((five.match(/fast/g) || []).length, 1, "the fast chip once, on the family's row");
    assert.match(five, /flex/);
    assert.match(five, /thinking/);
    const win = all(rows[0], cls("fam-window"))[0];
    assert.equal(textOf(win), "? · 1M", "the standard window nobody states, then the 1M its id spells — the chip no longer says 1M alone");
    assert.doesNotMatch(textOf(all(rows[0], cls("cap-chips"))[0]), /1M/, "the windows are in their own cell, not the chips");
    assert.equal(textOf(all(rows[1], cls("list-price"))[0]), "$0.5 / $2");
    assert.equal(textOf(all(rows[0], cls("list-price"))[0]), "–", "no price: a dash, never a warning");
    assert.doesNotMatch(textOf(box), /no price/);
    const other = all(box, (n) => n.tag === "tr" && n.attrs?.["data-other"]);
    assert.deepEqual(other.map((r) => r.attrs["data-other"]), ["zeta/zeta-embed-1"]);
    assert.match(textOf(all(box, cls("other-models"))[0]), /Other models \(not for chat\) · 1/);
    assert.match(textOf(box), /Models · 2 \(1 id hidden\)/);
  });

  // HarnessV3-FixRound item 34, decision 26. (fails before: yes — an agent's row read "plan" whatever its price)
  test("an agent upstream's row reads its plan, with the list price only a row the operator wrote gives it", async () => {
    /** @type {any} */ (state.config.upstreams.find((/** @type {any} */ x) => x.id === "zeta")).type = "acp";
    let rows = famRows(await panel());
    assert.equal(textOf(all(rows[1], cls("list-price"))[0]), "plan · $0.5 / $2");
    assert.equal(textOf(all(rows[0], cls("list-price"))[0]), "plan");
    const mini = caps.models.find((/** @type {any} */ m) => m.id === "zeta/zeta-5-mini");
    const was = mini.price.source;
    mini.price.source = "builtin";
    try {
      rows = famRows(await panel());
      assert.equal(textOf(all(rows[1], cls("list-price"))[0]), "plan", "a built-in API rate never prices an agent's turn");
    } finally {
      mini.price.source = was;
    }
  });

  // (fails before: yes — a model was hidden id by id)
  test("a family's checkbox hides every member, and ticks them all back; one hidden id makes it half-ticked", async () => {
    const box = await panel();
    const u = state.config.upstreams.find((/** @type {any} */ x) => x.id === "zeta");
    const tick = () => all(famRows(box)[0], cls("fam-tick"))[0];
    assert.equal(tick().checked, true);
    assert.equal(tick().indeterminate, true, "zeta-5-fast is hidden in the saved config");
    tick().checked = false;
    tick().dispatch("change", { target: tick() });
    await settle();
    const five = ["zeta-5", "zeta-5-fast", "zeta-5-flex", "zeta-5-thinking", "zeta-5-non-reasoning", "zeta-5-1m"];
    assert.deepEqual([...u.hiddenModels].sort(), [...five].sort(), "all six ids of zeta-5, each once");
    assert.ok(marked > 0, "the page has unsaved changes");
    assert.equal(tick().checked, false);
    tick().checked = true;
    tick().dispatch("change", { target: tick() });
    await settle();
    assert.deepEqual(u.hiddenModels, [], "ticked back: none of them hidden, zeta-5-fast included");
  });

  test("▸ lists a family's ids with what each spells, and one id hides alone", async () => {
    const box = await panel();
    const toggle = all(famRows(box)[0], cls("fam-toggle"))[0];
    assert.match(textOf(toggle), /zeta\/zeta-5\| · 6 ids/);
    toggle.dispatch("click");
    await settle();
    const members = all(box, (n) => n.tag === "tr" && n.attrs?.["data-member"]);
    assert.deepEqual(members.map((m) => [m.attrs["data-member"], textOf(all(m, cls("spells"))[0]).trim()]), [
      ["zeta/zeta-5", "standard"],
      ["zeta/zeta-5-fast", "Fast"],
      ["zeta/zeta-5-flex", "Flex"],
      ["zeta/zeta-5-thinking", "Thinking"],
      ["zeta/zeta-5-non-reasoning", "No thinking"],
      ["zeta/zeta-5-1m", "1M"],
    ]);
    const u = state.config.upstreams.find((/** @type {any} */ x) => x.id === "zeta");
    const flexTick = all(members[2], cls("fam-tick"))[0];
    flexTick.checked = false;
    flexTick.dispatch("change", { target: flexTick });
    await settle();
    assert.deepEqual([...u.hiddenModels].sort(), ["zeta-5-fast", "zeta-5-flex"]);
  });

  test("the other model's checkbox lists it for your tools or leaves it out", async () => {
    const box = await panel();
    const u = state.config.upstreams.find((/** @type {any} */ x) => x.id === "zeta");
    const t = all(all(box, (n) => n.tag === "tr" && n.attrs?.["data-other"])[0], cls("fam-tick"))[0];
    assert.equal(t.checked, true);
    t.checked = false;
    t.dispatch("change", { target: t });
    await settle();
    assert.deepEqual([...u.hiddenModels].sort(), ["zeta-5-fast", "zeta-embed-1"]);
  });
});

describe("the tune sheet's Pricing", () => {
  /** @type {any} */ let drawer;
  /** A face's kit, recording the sheet it opens and how it was closed. @type {import("../src/ui/lib/model-tune.js").TuneKit} */
  const kit = {
    h: fakeH,
    open: (title, body, guard) => {
      drawer = { title, body, guard, closed: null };
      return { close: (force) => { drawer.closed = force ? "forced" : "asked"; } };
    },
    button: (o) => fakeH("button", { type: "button", ...(o.title ? { title: o.title } : {}), ...(o.onClick ? { onclick: o.onClick } : {}) }, o.label),
  };
  /** Apply as the console takes it: the row into the upstream's pricing, or away. @param {any} u */
  const into = (u) => (/** @type {{ key: string, row: any }} */ { key, row }) => { u.pricing ||= {}; if (row) u.pricing[key] = row; else delete u.pricing[key]; };
  /** @param {any} o */
  const openTuneWith = (o) => openTune({ onApply: into(o.u), ...o }, kit);
  beforeEach(() => {
    drawer = null;
  });
  const entryOf = (/** @type {any} */ over = {}) => ({
    caps: { wire: "openai", effort: { levels: null, source: null }, fast: { available: false, source: null }, thinking: { available: false, source: null }, window: { standard: null, options: [], source: null }, maxOutput: { tokens: null, source: null } },
    fallback: {}, offer: { kind: "model", effort: null, speed: null, thinking: null, window: null }, policy: {}, rowKeys: {}, ...over,
  });
  const box = (/** @type {string} */ label) => all(drawer.body, (n) => n.tag === "input" && n.attrs?.["aria-label"] === label)[0];
  const applyIn = () => all(drawer.body, (n) => n.tag === "button" && textOf(n) === "Apply")[0];

  // (fails before: yes — the sheet had no prices: they were edited in the model table)
  test("the first price typed on a row with none of its own carries the rest from what applied; Apply writes that row only", async () => {
    const u = { id: "zeta", pricing: { "zeta-5": { input: 1, output: 4, cacheRead: 0.1, contextTokens: 200000 } } };
    const entry = entryOf({ price: { input: 1, output: 4, cacheRead: 0.1, cacheWrite: 1, source: "upstream", stated: ["input", "output", "cacheRead"] } });
    openTuneWith({ u, x: { id: "zeta/zeta-5-mini", upstreamModel: "zeta-5-mini" }, entry, load: async () => ({ byId: new Map(), errors: [] }), agent: false });
    assert.match(drawer.title, /Tune zeta-5-mini/);
    assert.match(textOf(drawer.body), /Pricing — for analytics/);
    const out = box("out price, USD per million tokens");
    assert.equal(out.attrs.placeholder, "4", "what applies now, from the row zeta-5 that covers it");
    out.value = "3";
    out.oninput();
    assert.equal(box("in price, USD per million tokens").value, "1", "carried: the in price is not left at $0");
    applyIn().dispatch("click");
    await settle();
    assert.deepEqual(u.pricing["zeta-5-mini"], { input: 1, cacheRead: 0.1, output: 3 });
    assert.deepEqual(u.pricing["zeta-5"], { input: 1, output: 4, cacheRead: 0.1, contextTokens: 200000 }, "the covering row is untouched");
  });

  test("a family of variant ids is priced on its base row; capability fields and other fields of the row stay", async () => {
    const u = { id: "zeta", pricing: { "zeta-5": { contextTokens: 300000, keepsThinking: true } } };
    const entry = entryOf({ offer: { kind: "variants", familyKey: "zeta-5", family: "zeta/zeta-5", members: ["zeta/zeta-5", "zeta/zeta-5-fast"], effort: null, speed: { via: "name", options: ["standard", "fast"] }, thinking: null, window: null } });
    openTuneWith({ u, x: { id: "zeta/zeta-5", upstreamModel: "zeta-5" }, entry, load: async () => ({ byId: new Map(), errors: [] }), agent: false });
    assert.match(textOf(drawer.body), /Set on the family's base row “zeta-5”/);
    const inp = box("in price, USD per million tokens");
    inp.value = "2";
    inp.oninput();
    const out = box("out price, USD per million tokens");
    out.value = "8";
    out.oninput();
    applyIn().dispatch("click");
    await settle();
    assert.deepEqual(u.pricing["zeta-5"], { contextTokens: 300000, keepsThinking: true, input: 2, output: 8 });
  });

  test("a price that is not a number holds Apply back", async () => {
    const u = { id: "zeta", pricing: {} };
    openTuneWith({ u, x: { id: "zeta/zeta-5", upstreamModel: "zeta-5" }, entry: entryOf(), load: async () => ({ byId: new Map(), errors: [] }), agent: false });
    const out = box("out price, USD per million tokens");
    out.value = "-1";
    out.oninput();
    assert.equal(applyIn().disabled, true);
  });

  // HarnessV4_Settings_Plan HS-D1: one sheet for both faces; what Apply does is the face's (the harness saves at once).
  // (fails before: yes — the sheet wrote the console's draft itself and closed the console's drawer, so no other face could open it)
  test("Apply hands the row to the face and closes the sheet once that is done; a refused save stays on the sheet, said", async () => {
    const u = { id: "zeta", pricing: { "zeta-5": { input: 1, output: 4 } } };
    /** @type {any[]} */
    const asked = [];
    let refuse = true;
    openTune({ u, x: { id: "zeta/zeta-5", upstreamModel: "zeta-5" }, entry: entryOf(), load: async () => ({ byId: new Map(), errors: [] }), agent: false,
      onApply: async (/** @type {any} */ r) => { asked.push(r); if (refuse) throw new Error("zeta changed since this page read it: read it again"); } }, kit);
    assert.equal(drawer.guard.dirty(), false, "nothing typed: closing asks nothing");
    assert.match(drawer.guard.discard, /Discard your changes to zeta-5\?/);
    const out = box("out price, USD per million tokens");
    out.value = "5";
    out.oninput();
    assert.equal(drawer.guard.dirty(), true, "a typed price is asked about before it goes");
    applyIn().dispatch("click");
    await settle();
    assert.deepEqual(asked, [{ key: "zeta-5", row: { input: 1, output: 5 } }]);
    assert.equal(drawer.closed, null, "a refused save keeps the sheet open");
    assert.match(textOf(drawer.body), /Not kept: zeta changed since this page read it: read it again/);
    assert.equal(applyIn().disabled, false, "and Apply can be pressed again");
    refuse = false;
    applyIn().dispatch("click");
    await settle();
    assert.equal(drawer.closed, "forced", "taken: the sheet closes without asking");
    assert.deepEqual(u.pricing, { "zeta-5": { input: 1, output: 4 } }, "the sheet never writes the upstream itself");
  });

  // (fails before: yes — the button said Apply on every face, though the harness's writes the row at once)
  test("the face names the button that hands the row over, and the discard question says it", () => {
    openTune({ u: { id: "zeta", pricing: {} }, x: { id: "zeta/zeta-5", upstreamModel: "zeta-5" }, entry: entryOf(), load: async () => ({ byId: new Map(), errors: [] }), agent: false, onApply: () => {} }, { ...kit, applyLabel: "Save" });
    assert.equal(applyIn(), undefined);
    assert.equal(all(drawer.body, (n) => n.tag === "button" && textOf(n) === "Save").length, 1);
    assert.match(drawer.guard.discard, /Nothing is kept until you press Save\./);
  });

  test("a row emptied of everything is handed over as null: the face takes the row away", async () => {
    const u = { id: "zeta", pricing: { "zeta-5": { fast: true } } };
    /** @type {any[]} */
    const asked = [];
    openTune({ u, x: { id: "zeta/zeta-5", upstreamModel: "zeta-5" }, entry: entryOf(), load: async () => ({ byId: new Map(), errors: [] }), agent: false, onApply: (/** @type {any} */ r) => { asked.push(r); } }, kit);
    all(drawer.body, (n) => n.tag === "button" && textOf(n) === "All automatic")[0].dispatch("click");
    applyIn().dispatch("click");
    await settle();
    assert.deepEqual(asked, [{ key: "zeta-5", row: null }]);
  });

  // HarnessV3-FixRound item 34, decision 26. (fails before: yes — the sheet showed an agent no Pricing at all, so its
  // list price could be written only in the config JSON)
  test("an agent's Pricing is its list price alone: no Billed switch, no cap, and a built-in rate is not its price", async () => {
    const u = { id: "cc", type: "acp", pricing: {} };
    openTuneWith({ u, x: { id: "cc/opus", upstreamModel: "opus" }, entry: entryOf({ price: { input: 15, output: 75, cacheRead: 15, cacheWrite: 15, source: "builtin", stated: ["input", "output"] } }), load: async () => ({ byId: new Map(), errors: [] }), agent: true });
    const body = textOf(drawer.body);
    assert.match(body, /Pricing — for analytics/);
    assert.match(body, /The agent's turns are paid by its plan \(\$0\); this price only gives them the “at list” figure/);
    const notes = () => all(drawer.body, cls("tune-src")).map((n) => String(n.textContent || ""));
    assert.ok(notes().includes("automatic: nobody prices it — its turns show no list figure"), "a built-in rate never prices an agent's turn");
    assert.doesNotMatch(body, /Billed|requests at once/, "no billing switch and no concurrency cap for an agent");
    assert.equal(box("out price, USD per million tokens").attrs.placeholder, "–");
    const inp = box("in price, USD per million tokens");
    inp.value = "15";
    inp.oninput();
    const out = box("out price, USD per million tokens");
    out.value = "75";
    out.oninput();
    applyIn().dispatch("click");
    await settle();
    assert.deepEqual(u.pricing, { opus: { input: 15, output: 75 } });
    openTuneWith({ u: { id: "cc", type: "acp", pricing: {} }, x: { id: "cc/opus-4", upstreamModel: "opus-4" }, entry: entryOf({ price: { input: 15, output: 75, cacheRead: 15, cacheWrite: 15, source: "upstream", stated: ["input", "output"] } }), load: async () => ({ byId: new Map(), errors: [] }), agent: true });
    assert.equal(box("out price, USD per million tokens").attrs.placeholder, "75", "a row the operator wrote that covers it is its price");
    assert.ok(notes().some((t) => /^automatic: .+, a row of this upstream that covers it$/.test(t)), notes().join(" / "));
  });
});

describe("the words", () => {
  test("a family's windows: the standard, then the others; ? for a standard nobody states", () => {
    assert.equal(familyWindowWords({ via: "name", options: [0, 1_000_000], standard: null }, { standard: null }), "? · 1M");
    assert.equal(familyWindowWords({ via: "name", options: [0, 256_000], standard: 1_000_000, multipliers: { "0": 2 } }, null), "1M (2×) · 256K");
    assert.equal(familyWindowWords({ via: "setting", options: [200_000, 1_000_000], standard: 200_000 }, { standard: 200_000 }), "200K · 1M");
    assert.equal(familyWindowWords(null, { standard: 128_000 }), "128K");
    assert.equal(familyWindowWords(null, null), "–");
  });

  test("what a member id spells", () => {
    assert.equal(spelledWords({ effort: "high", speed: "fast" }), "High · Fast");
    assert.equal(spelledWords({ thinking: "off" }), "No thinking");
    assert.equal(spelledWords({ window: 1_000_000 }), "1M");
    assert.equal(spelledWords({}), "standard");
  });
});

describe("the Models tab", () => {
  beforeEach(() => {
    const cfg = structuredClone(savedCfg);
    Object.assign(state, { config: cfg, catalog: { q: "", agents: false, multi: false }, schema: { upstreamTypes: { "openai-compatible": { label: "OpenAI-compatible server (…)" } } } });
    bindUi({
      h: fakeH, fmt, api: async (/** @type {string} */ path) => (path.startsWith("/models") ? catalog : { total: { rows: [{ upstream: "zeta", model: "zeta-5", requests: 3, cost: 0.03, costN: 3, avgTps: 50, avgTtftMs: 400, cacheHitRate: 0.5 }, { upstream: "zeta", model: "zeta-5-flex", requests: 1, cost: 0.01, costN: 1, avgTps: 10, avgTtftMs: 800, cacheHitRate: 0.1 }] } }),
      intro: (/** @type {string} */ _id, /** @type {any[]} */ ...k) => fakeH("div", {}, ...k), empty: (/** @type {string} */ a) => fakeH("p", {}, a), memAgo: () => "now",
      pingResult: () => fakeH("span"), go() {},
    });
  });

  // (fails before: yes — the tab grouped ids by their price key, one line per id, zeta-5-flex a model of its own)
  test("one group per model, one line per provider, its variant ids folded in and their traffic added up", async () => {
    const page = modelsTab();
    await settle();
    const groups = all(page, cls("cat-group"));
    const five = groups.find((g) => g.attrs["data-model"] === "zeta-5");
    assert.ok(five, groups.map((g) => g.attrs["data-model"]).join(","));
    assert.match(textOf(five), /zeta-5\| · 2 providers · 4 requests in 30 days/);
    const lines = all(page, (n) => n.tag === "tr" && String(n.attrs?.class) === "cat-line" && /zeta-5$/.test(n.attrs["data-family"]));
    assert.deepEqual(lines.map((l) => l.attrs["data-family"]), ["zeta/zeta-5", "rt/zeta-5"], "the busier provider first");
    assert.match(textOf(lines[0]), /5 ids/, "zeta-5-fast is hidden, so five ids here");
    const cells = lines[0].kids.filter((/** @type {any} */ k) => k?.tag === "td").map(textOf);
    assert.deepEqual(cells.slice(2, 6), ["4", "40", fmt.ms(500), fmt.pct(0.4)], "requests added up; tok/s, first byte and cache hit weighted by requests: (50×3 + 10×1) / 4, (400×3 + 800×1) / 4, (0.5×3 + 0.1×1) / 4");
    assert.match(textOf(lines[1]), /2 ids/, "zeta-5 and zeta-5-fast at the router");
    assert.ok(all(page, cls("fam-row")).length === 0, "the tab's rows are its own, not the add flow's");
    assert.ok(!groups.some((g) => g.attrs["data-model"] === "zeta-5-flex"), "a variant is no model of its own");
    const emb = all(page, (n) => n.tag === "tr" && n.attrs?.["data-family"] === "zeta/zeta-embed-1")[0];
    assert.match(textOf(emb), /not for chat/);
  });

  // (fails before: yes — "1 requests in 30 days"; backlog 21)
  test("one request is said in the singular", async () => {
    bindUi({ api: async (/** @type {string} */ path) => (path.startsWith("/models") ? catalog : { total: { rows: [{ upstream: "zeta", model: "zeta-5", requests: 1, cost: 0.01, costN: 1 }] } }) });
    const page = modelsTab();
    await settle();
    const five = all(page, cls("cat-group")).find((g) => g.attrs["data-model"] === "zeta-5");
    assert.match(textOf(five), / · 1 request in 30 days/);
  });
});
