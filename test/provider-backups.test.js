// @ts-check
// Settings › Models' pieces where the owner's settings cleanup of 11-09 moved them, Models itself gone: a model's
// backups on its provider's page (lib/model-backups.js) — its backups under its name, Backups › beside Tune ›, never on
// a coding agent's card, and the sheet that sets them —; the backups switch at the top of Settings › Providers
// (failover-card.js), off unless switched on; New chats start on in Settings › General; Models' old address leading to
// Providers. DOM-free where it can be: the fake `h`, and a scripted `api` that answers the model routes with the server's
// own view and write (app/model-routes.js) over a configuration it keeps at a version, as Filament does, the providers'
// fake (helpers/providers-fake.js) answering the rest. The server's view is model-backups.test.js's.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { every, fakeBus, fakeServer, flush, named, recordingDialogs, viewOf } from "./helpers/providers-fake.js";
import { aggregateModels } from "../src/core/routing.js";
import { modelRoutesView, setBackups } from "../src/app/model-routes.js";
import { normalizeConfig } from "../src/services/config/store.js";
import { OFF_NOTE, bestName, chainWords, sheetSentence } from "../src/ui/harness/lib/model-backups.js";
import { createModelRows } from "../src/ui/harness/lib/model-rows.js";
import { providersState } from "../src/ui/harness/lib/providers-state.js";
import { FAILOVER_OFF, FAILOVER_ON, FAILOVER_ROW, failoverCard } from "../src/ui/harness/settings/failover-card.js";
import { renderProviders } from "../src/ui/harness/settings/providers.js";
import { renderGeneral, SEARCH_ROWS as GENERAL_ROWS } from "../src/ui/harness/settings/general.js";
import { NEW_CHAT_ROW } from "../src/ui/harness/settings/new-chat-model.js";
import { MOVED, PAGE_ROWS, SECTIONS } from "../src/ui/harness/settings/page.js";

const NOW = Date.parse("2026-10-15T12:00:00Z");
/** @param {Record<string, any>} r @returns {any} */
const route = (r) => ({ upstreamModel: "{1}", format: "auto", fallbacks: [], strategy: "in_order", discoverPrefixes: [], enabled: true, rules: {}, ...r });
/** @param {number} status @param {any} body */
const refusal = (status, body) => Object.assign(new Error(body.error || "refused"), { status, body });

/** Z.AI and OpenRouter, Claude Code, and a console route with a pattern; backups on unless `cfg` says otherwise. */
const cfgOf = () => ({
  rules: { resilience: { failover: true } },
  upstreams: [
    { id: "zai", name: "Z.AI", type: "openai-compatible", baseUrl: "http://z.invalid", enabled: true, discoverModels: false, models: ["glm-5.3", "glm-4.5"], hiddenModels: [], pricing: { "glm-5.3": { input: 1, output: 3.2, contextTokens: 200000 } } },
    { id: "or", name: "OpenRouter", type: "openai-compatible", baseUrl: "http://o.invalid", enabled: true, discoverModels: false, models: ["z-ai/glm-5.3", "x/grok"], hiddenModels: [] },
    { id: "cc", name: "Claude Code", type: "acp", baseUrl: "acp://local", enabled: true, models: ["sonnet"], hiddenModels: [] },
  ],
  routes: [route({ match: "zai/*", upstream: "zai" }), route({ match: "or/*", upstream: "or" }), route({ match: "cc/*", upstream: "cc" }), route({ match: "fast-*", upstream: "zai", upstreamModel: "{model}", format: "openai" })],
});

/**
 * The server over a configuration kept at a version: the model routes' view and write and the backups switch are the
 * server's own; the providers' views, caps and the rest are the providers' fake, its families the view's own.
 * @param {{ cfg?: (c: any) => void }} [o]
 */
async function serverOf(o = {}) {
  let cfg = /** @type {any} */ (cfgOf());
  o.cfg?.(cfg);
  let version = 4;
  /** @type {Map<number, any>} */
  const kept = new Map([[version, structuredClone(cfg)]]);
  const store = {
    get: () => cfg,
    at: (/** @type {number} */ v) => kept.get(v) || null,
    version: () => version,
    set: (/** @type {any} */ c) => { cfg = c; version++; kept.set(version, structuredClone(c)); },
    save: () => {},
  };
  const view = async () => {
    const base = { ...cfg, upstreams: cfg.upstreams.map((/** @type {any} */ u) => ({ ...u, hiddenModels: [] })) };
    return { ...modelRoutesView(cfg, base, await aggregateModels(base)), version };
  };
  // A provider's page lists the families the server folds its models into: the view's own.
  const first = await view();
  /** @type {Record<string, any[]>} */
  const families = {};
  for (const r of first.models) (families[r.upstream.id] ||= []).push({ id: r.id, name: r.label || r.sent, kind: "chat", lead: r.lead, members: r.members.map((/** @type {any} */ x) => ({ id: x.id, name: x.name, source: "discovered" })) });
  const srv = fakeServer({
    upstreams: [viewOf({ id: "zai", name: "Z.AI", prefix: "zai" }), viewOf({ id: "or", name: "OpenRouter", prefix: "or", provider: null }), viewOf({ id: "cc", name: "Claude Code", type: "acp", agent: true, provider: null, prefix: null })],
    families,
  });
  /** @type {[string, string, any][]} */
  const calls = [];
  const api = async (/** @type {string} */ path, /** @type {any} */ init = {}) => {
    const method = init.method || "GET";
    calls.push([method, path, init.body]);
    if (path === "/model-routes" && method === "GET") return view();
    if (path === "/model-routes" && method === "PUT") {
      try {
        setBackups(store, init.body.name, init.body.backups, init.body.base);
      } catch (/** @type {any} */ e) {
        throw refusal(e.status, { error: e.message, ...(e.extra || {}), version });
      }
      return view();
    }
    // http/admin/config.js: off unless the configuration says on.
    if (path === "/failover") {
      if (method === "POST") {
        cfg = structuredClone(cfg);
        cfg.rules = { ...cfg.rules, resilience: { ...cfg.rules?.resilience, failover: init.body.enabled !== false } };
        store.set(cfg);
      }
      return { enabled: cfg.rules?.resilience?.failover === true, routesWithBackups: [], version };
    }
    return srv.api(path, init);
  };
  return { api, calls, srv, store, cfg: () => cfg, version: () => version };
}

/**
 * Settings › Providers over the server, opened on `start`; recording toasts, dialogs and questions.
 * @param {Awaited<ReturnType<typeof serverOf>>} s @param {{ start?: string | null, yes?: boolean }} [o]
 */
async function providersOver(s, o = {}) {
  const bus = fakeBus();
  /** @type {[string, string | undefined][]} */
  const toasts = [];
  const { dialog, shown } = recordingDialogs();
  /** @type {any[]} */
  const asked = [];
  const body = /** @type {any} */ (fakeH("div", {}));
  renderProviders(body, { onToast: (msg, kind) => toasts.push([msg, kind]), now: () => NOW, start: o.start === undefined ? "provider:zai" : o.start }, /** @type {any} */ ({
    h: fakeH, api: s.api, dialog, subscribe: bus.subscribe, confirm: async (/** @type {any} */ q) => { asked.push(q); return o.yes ?? true; }, later: () => 0,
  }));
  await flush();
  await flush();
  return { body, bus, toasts, shown, asked };
}

/** A model's row on a provider's page. @param {any} el @param {string} id */
const rowOf = (el, id) => every(el, "mrow").find((n) => n.attrs["data-family"] === id);
/** A button by its label or its aria-label. @param {any} el @param {string} label */
const press = (el, label) => {
  const b = buttonsOf(el).find((x) => textOf(x) === label || x.attrs["aria-label"] === label);
  assert.ok(b, `a button "${label}" in ${textOf(el).slice(0, 300)}`);
  b.dispatch("click");
};
const has = (/** @type {any} */ el, /** @type {string} */ label) => buttonsOf(el).some((x) => textOf(x) === label || x.attrs["aria-label"] === label);

describe("Settings › Models went (the owner's settings cleanup of 11-09)", () => {
  // (fails before: yes — Models was a section of its own)
  test("the section is gone, its old address opens Providers, and its search rows are where its pieces went", () => {
    assert.deepEqual(SECTIONS.filter((s) => s.group === "Models and agents").map((s) => s.id), ["providers", "agents"]);
    assert.equal(MOVED.models, "providers");
    assert.ok(!("models" in PAGE_ROWS));
    assert.deepEqual(PAGE_ROWS.providers.map((r) => r.label), [FAILOVER_ROW]);
    assert.ok(GENERAL_ROWS.some((r) => r.label === NEW_CHAT_ROW));
  });

  test("a backup's name at another provider, a row's backups and the sheet's sentence", () => {
    assert.equal(bestName(["x/grok", "z-ai/glm-5.3"], "glm-5.3"), "z-ai/glm-5.3");
    assert.equal(bestName(["z-ai/GLM-5.3-20260101"], "glm-5.3"), "z-ai/GLM-5.3-20260101");
    assert.equal(bestName(["glm-5.3", "z-ai/glm-5.3"], "glm-5.3"), "glm-5.3", "the very name first");
    assert.equal(bestName(["x/grok"], "glm-5.3"), "");
    const row = { upstream: { agent: false, name: "Z.AI" }, lead: "zai/glm-5.3", sent: "glm-5.3", can: true, why: null, strategy: "in_order", backups: [{ name: "OpenRouter", sent: "z-ai/glm-5.3", enabled: true, agent: false }, { name: "Groq", sent: "glm", enabled: false, agent: false }] };
    assert.equal(chainWords(row), "Then OpenRouter as z-ai/glm-5.3, then Groq as glm (off: skipped)");
    assert.equal(chainWords({ ...row, strategy: "round_robin" }), "Then OpenRouter as z-ai/glm-5.3, then Groq as glm (off: skipped), chosen taking turns");
    assert.equal(chainWords({ ...row, backups: [] }), "No backups");
    assert.equal(chainWords({ ...row, upstream: { agent: true } }), "");
    const nameOf = (/** @type {string} */ id) => ({ or: "OpenRouter" })[id] || id;
    assert.equal(sheetSentence(row, [{ upstream: "or", upstreamModel: " z-ai/glm-5.3 " }, { upstream: "or", upstreamModel: "" }], nameOf), "zai/glm-5.3 goes to Z.AI as glm-5.3; when it fails, OpenRouter as z-ai/glm-5.3.");
    assert.equal(sheetSentence(row, [], nameOf), "zai/glm-5.3 goes to Z.AI as glm-5.3, and nowhere else when it fails.");
  });
});

describe("the backups switch heads Settings › Providers, off unless switched on", () => {
  // (fails before: yes — the owner's of 11-09: "by default the Provider failovers should be off")
  test("a configuration that never said is off, everywhere it is read; one that stored on keeps it", async () => {
    assert.equal(normalizeConfig({}).rules.resilience.failover, false);
    assert.equal(normalizeConfig({ rules: { resilience: { failover: true } } }).rules.resilience.failover, true);
    const s = await serverOf({ cfg: (c) => { delete c.rules.resilience; } });
    const v = await s.api("/model-routes");
    assert.equal(v.failover, false, "the server's view says off where nothing was said");
  });

  // (fails before: yes — the switch was Settings › Models' head)
  test("the card at the head of the list: off says backups are not tried; switched on, it says they are and where they are set", async () => {
    const s = await serverOf({ cfg: (c) => { delete c.rules.resilience; } });
    const p = await providersOver(s, { start: null });
    const root = p.body.kids[0];
    assert.equal(root.kids[0], every(root, "mdl-failover")[0], "first on the list");
    assert.match(textOf(root.kids[0]), new RegExp(`^${FAILOVER_ROW}\\|`));
    assert.ok(textOf(root.kids[0]).includes(FAILOVER_OFF));
    const sw = named(root, FAILOVER_ROW);
    assert.equal(sw.attrs["aria-checked"], "false");
    sw.dispatch("click");
    await flush();
    assert.deepEqual(s.calls.filter(([m, path]) => m === "POST" && path === "/failover").map((c) => c[2]), [{ enabled: true }]);
    assert.equal(s.cfg().rules.resilience.failover, true);
    assert.ok(textOf(every(p.body, "mdl-failover")[0]).includes(FAILOVER_ON));
    assert.equal(named(p.body, FAILOVER_ROW).attrs["aria-checked"], "true");
    assert.deepEqual(p.toasts.at(-1), ["Backups are on: a model whose provider fails goes to its backups", undefined]);
  });

  test("a change made elsewhere — the console's Home, the tray — shows without a reload", async () => {
    const s = await serverOf();
    const bus = fakeBus();
    const card = failoverCard({}, { h: fakeH, api: s.api, subscribe: bus.subscribe });
    await card.ready;
    assert.ok(textOf(card.el).includes(FAILOVER_ON));
    await s.api("/failover", { method: "POST", body: { enabled: false } });
    bus.say({ type: "config-changed", version: s.version() });
    await flush();
    assert.ok(textOf(card.el).includes(FAILOVER_OFF));
  });
});

describe("a model's backups on its provider's page", () => {
  // (fails before: yes — Backups › was Settings › Models' alone)
  test("Backups › beside Tune › on a provider's model; a model with backups says them under its name", async () => {
    const s = await serverOf({ cfg: (c) => { c.routes.unshift(route({ match: "zai/glm-4.5", upstream: "zai", upstreamModel: "glm-4.5", fallbacks: [{ upstream: "or", upstreamModel: "x/grok" }] })); } });
    const p = await providersOver(s);
    const glm = rowOf(p.body, "zai/glm-5.3");
    assert.ok(glm, textOf(p.body).slice(0, 400));
    const acts = every(glm, "mrow-acts")[0];
    assert.deepEqual(buttonsOf(acts).map((b) => textOf(b)).slice(-2), ["Tune ›", "Backups ›"]);
    assert.equal(every(glm, "mdl-chain").length, 0, "no backups, nothing said");
    assert.equal(textOf(every(rowOf(p.body, "zai/glm-4.5"), "mdl-chain")[0]), "Then OpenRouter as x/grok");
  });

  // (fails before: yes — HS-D59: a coding agent's model takes none; the owner's of 11-09: its card's own refresh is the
  // icon on its models line, so Refresh list is a provider's alone)
  test("a coding agent's card: no Backups ›, and no Refresh list beside its models line's own", async () => {
    const s = await serverOf();
    const state = providersState(s.api);
    await state.read();
    const { modelBackups } = await import("../src/ui/harness/lib/model-backups.js");
    const backups = modelBackups({}, { h: fakeH, api: s.api, subscribe: fakeBus().subscribe });
    const agent = createModelRows({ state, id: "cc", now: () => NOW, backups }, /** @type {any} */ ({ h: fakeH, api: s.api }));
    const provider = createModelRows({ state, id: "zai", now: () => NOW }, /** @type {any} */ ({ h: fakeH, api: s.api }));
    await flush();
    assert.ok(every(agent.el, "mrow").length > 1, textOf(agent.el));
    assert.equal(has(agent.el, "Backups ›"), false);
    assert.equal(has(agent.el, "Refresh list"), false);
    assert.equal(has(provider.el, "Refresh list"), true, "a provider's page keeps it");
  });

  // (fails before: yes — HC-70, HC-73, HC-96: the sheet picks the name OpenRouter serves, Save keeps the route)
  test("the sheet: Add a backup offers the provider's own name, Save keeps it, the row says it", async () => {
    const s = await serverOf();
    const p = await providersOver(s);
    press(rowOf(p.body, "zai/glm-5.3"), "Backups for glm-5.3");
    const sheet = p.shown[0];
    assert.equal(sheet.title, "Backups for zai/glm-5.3");
    press(sheet.body, "Add a backup");
    assert.equal(every(sheet.body, "mdl-bname")[0].value, "z-ai/glm-5.3", "the same model's name at OpenRouter");
    assert.match(textOf(sheet.body), /zai\/glm-5\.3 goes to Z\.AI as glm-5\.3; when it fails, OpenRouter as z-ai\/glm-5\.3\./);
    press(sheet.body, "Save");
    await flush();
    assert.equal(sheet.closed, "forced");
    const put = s.calls.find(([m, path]) => m === "PUT" && path === "/model-routes");
    assert.deepEqual(put?.[2], { name: "zai/glm-5.3", backups: [{ upstream: "or", upstreamModel: "z-ai/glm-5.3" }], base: 4 });
    assert.deepEqual(s.cfg().routes.map((/** @type {any} */ r) => r.match), ["zai/glm-5.3", "zai/*", "or/*", "cc/*", "fast-*"]);
    assert.deepEqual(p.toasts.at(-1), ["Backups for zai/glm-5.3 kept: when Z.AI fails, OpenRouter answers, from the next message", undefined]);
    assert.match(textOf(rowOf(p.body, "zai/glm-5.3")), /Then OpenRouter as z-ai\/glm-5\.3/);
  });

  // (fails before: yes — HS-D67: Add a backup offered the first provider in the list, one that lists no such model)
  test("Add a backup offers a provider that serves the same model before one that does not", async () => {
    const s = await serverOf({ cfg: (c) => { c.upstreams.splice(1, 0, { id: "an", name: "Anthropic", type: "anthropic", baseUrl: "http://a.invalid", enabled: true, discoverModels: false, models: ["claude-x"], hiddenModels: [] }); } });
    const p = await providersOver(s);
    press(rowOf(p.body, "zai/glm-5.3"), "Backups for glm-5.3");
    const sheet = p.shown[0];
    press(sheet.body, "Add a backup");
    assert.deepEqual([every(sheet.body, "mdl-bpick")[0].value, every(sheet.body, "mdl-bname")[0].value], ["or", "z-ai/glm-5.3"]);
    press(sheet.body, "Add a backup");
    assert.deepEqual([every(sheet.body, "mdl-bpick")[1].value, every(sheet.body, "mdl-bname")[1].value], ["an", ""], "none else serves it: the next one on");
    assert.match(textOf(sheet.body), /Pick or type its name at Anthropic\./);
  });

  // (fails before: yes — HC-73, HC-102: a typed name, a refused list said in the sheet)
  test("a typed name not in the list is said; a refusal stays in the sheet with its words", async () => {
    const s = await serverOf();
    const p = await providersOver(s);
    press(rowOf(p.body, "zai/glm-5.3"), "Backups for glm-5.3");
    const sheet = p.shown[0];
    press(sheet.body, "Add a backup");
    const name = every(sheet.body, "mdl-bname")[0];
    name.value = "z-ai/glm-6";
    name.oninput();
    assert.match(textOf(sheet.body), /Not in OpenRouter's list: a request there says whether it answers\./);
    const pick = every(sheet.body, "mdl-bpick")[0];
    pick.value = "zai";
    pick.onchange();
    assert.equal(every(sheet.body, "mdl-bname")[0].value, "glm-5.3");
    press(sheet.body, "Save");
    await flush();
    assert.equal(sheet.closed, null);
    assert.match(textOf(sheet.body), /Z\.AI as glm-5\.3 is where zai\/glm-5\.3 goes first\./);
  });

  // (fails before: yes — HC-96, HC-97: order, take off, Cancel asks, all off takes the route away)
  test("reorder, take off, Cancel with edits asks first, and every backup off leaves the routes as they were", async () => {
    const s = await serverOf({ cfg: (c) => { c.routes.unshift(route({ match: "zai/glm-5.3", upstream: "zai", upstreamModel: "glm-5.3", fallbacks: [{ upstream: "or", upstreamModel: "z-ai/glm-5.3" }, { upstream: "or", upstreamModel: "x/grok" }] })); } });
    const p = await providersOver(s);
    press(rowOf(p.body, "zai/glm-5.3"), "Backups for glm-5.3");
    const sheet = p.shown[0];
    press(sheet.body, "Move backup 2 up");
    assert.deepEqual(every(sheet.body, "mdl-bname").map((n) => n.value), ["x/grok", "z-ai/glm-5.3"]);
    sheet.close();
    await flush();
    assert.equal(sheet.closed, "forced", "asked, and discarded on yes");
    assert.equal(p.asked[0].title, "Discard these backups?");
    press(rowOf(p.body, "zai/glm-5.3"), "Backups for glm-5.3");
    const again = p.shown[1];
    press(again.body, "Take backup 1 off");
    press(again.body, "Take backup 1 off");
    assert.match(textOf(again.body), /No backups: when Z\.AI fails, zai\/glm-5\.3 fails\./);
    press(again.body, "Save");
    await flush();
    assert.deepEqual(s.cfg().routes.map((/** @type {any} */ r) => r.match), ["zai/*", "or/*", "cc/*", "fast-*"]);
    assert.deepEqual(p.toasts.at(-1), ["zai/glm-5.3 has no backups now: it goes to Z.AI alone", undefined]);
    assert.equal(every(rowOf(p.body, "zai/glm-5.3"), "mdl-chain").length, 0);
  });

  // (fails before: yes — HC-100: another window changed the route; the sheet closes, the page reads it again)
  test("a write from an old read is refused with what changed, and the page shows the route as it is", async () => {
    const s = await serverOf();
    const p = await providersOver(s);
    press(rowOf(p.body, "zai/glm-5.3"), "Backups for glm-5.3");
    const sheet = p.shown[0];
    press(sheet.body, "Add a backup");
    setBackups(s.store, "zai/glm-5.3", [{ upstream: "or", upstreamModel: "x/grok" }], s.version());
    press(sheet.body, "Save");
    await flush();
    assert.equal(sheet.closed, "forced");
    assert.match(String(p.toasts.at(-1)?.[0]), /^zai\/glm-5\.3's backups changed elsewhere since this page read them: .*They now show as they are/);
    assert.equal(p.toasts.at(-1)?.[1], "err");
    assert.match(textOf(rowOf(p.body, "zai/glm-5.3")), /Then OpenRouter as x\/grok/);
  });

  // (fails before: yes — HC-71: the sheet says backups are off while they are, and where to switch them on)
  test("while backups are off, the sheet says so and where they are switched on", async () => {
    const s = await serverOf({ cfg: (c) => { delete c.rules.resilience; } });
    const p = await providersOver(s);
    press(rowOf(p.body, "zai/glm-5.3"), "Backups for glm-5.3");
    assert.ok(textOf(p.shown[0].body).includes(OFF_NOTE));
    assert.match(OFF_NOTE, /at the top of Settings › Providers/);
  });

  // (fails before: yes — HC-98: a pattern route's format goes with its backups' route, and the sheet says so)
  test("a name a console pattern catches: the sheet says its format is kept, and its backups' route keeps it", async () => {
    const s = await serverOf({ cfg: (c) => { c.upstreams[0].models.push("fast-glm"); } });
    const p = await providersOver(s);
    press(rowOf(p.body, "fast-glm"), "Backups for fast-glm");
    const sheet = p.shown[0];
    assert.match(textOf(sheet.body), /Route fast-\* sends it in OpenAI's format: its backups' route keeps the same\./);
    press(sheet.body, "Add a backup");
    every(sheet.body, "mdl-bname")[0].value = "x/grok";
    every(sheet.body, "mdl-bname")[0].oninput();
    press(sheet.body, "Save");
    await flush();
    assert.deepEqual(s.cfg().routes.find((/** @type {any} */ r) => r.match === "fast-glm"), route({ match: "fast-glm", upstream: "zai", upstreamModel: "fast-glm", format: "openai", fallbacks: [{ upstream: "or", upstreamModel: "x/grok" }] }));
    assert.deepEqual(s.cfg().routes.map((/** @type {any} */ r) => r.match), ["zai/*", "or/*", "cc/*", "fast-glm", "fast-*"], "right above the pattern");
  });

  // (fails before: yes — a change heard on the events stream reads the view again)
  test("a change made elsewhere shows without a reload", async () => {
    const s = await serverOf();
    const p = await providersOver(s);
    setBackups(s.store, "zai/glm-5.3", [{ upstream: "or", upstreamModel: "z-ai/glm-5.3" }]);
    p.bus.say({ type: "config-changed", version: s.version() });
    await flush();
    assert.match(textOf(rowOf(p.body, "zai/glm-5.3")), /Then OpenRouter as z-ai\/glm-5\.3/);
  });
});

describe("New chats start on is Settings › General's", () => {
  const g = /** @type {any} */ (globalThis);
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  beforeEach(() => {
    doc = stubDocument();
    g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  });
  afterEach(() => {
    delete g.localStorage;
  });

  // (fails before: yes — the owner's settings cleanup of 11-09: it headed Settings › Models)
  test("under New chats, after Getting started: the one used last, or one chosen in the composer's picker; one gone from the picker is said", async () => {
    /** @type {any[]} */
    const picks = [];
    let chosen = "";
    /** @type {string[]} */
    const toasts = [];
    const io = {
      api: async () => ({ models: [{ id: "zai/glm-5.3" }, { id: "or/x/grok" }], families: [] }),
      // The composer's model picker as the card uses it, recording what it was given; `o` its callbacks.
      modelSelect: /** @type {any} */ ((/** @type {any} */ o) => {
        const p = { o, models: /** @type {any[]} */ ([]), value: "", note: "", el: doc.document.createElement("button"),
          setModels(/** @type {any[]} */ m) { p.models = m; }, setFamilies() {}, set(/** @type {string} */ v) { p.value = v; }, setNote(/** @type {string} */ n) { p.note = n; }, setLocked() {} };
        picks.push(p);
        return p;
      }),
      pref: { get: () => chosen, set: (/** @type {string} */ m) => { chosen = m; }, last: () => "zai/glm-5.3" },
    };
    const body = /** @type {any} */ (doc.document.createElement("div"));
    renderGeneral(body, { onToast: (/** @type {string} */ m) => void toasts.push(m) }, io);
    await flush();
    const heads = body.querySelectorAll(".nset-h").map((/** @type {any} */ n) => n.textContent);
    assert.deepEqual(heads.slice(0, 2), ["Getting started", "New chats"]);
    const card = body.querySelector(".mdl-start");
    assert.match(card.textContent, /^New chats start onThe model you used last\. Choose one, and every new chat starts on it/);
    const pick = picks.at(-1);
    assert.deepEqual(pick.models.map((/** @type {any} */ m) => m.id), ["zai/glm-5.3", "or/x/grok"], "what the composer's picker lists");
    assert.deepEqual([pick.value, pick.note], ["zai/glm-5.3", "the one you used last"]);
    pick.o.onChange("or/x/grok");
    assert.equal(chosen, "or/x/grok");
    assert.equal(toasts.at(-1), "New chats start on or/x/grok; a chat's own picker changes it for that chat");
    assert.equal(picks.at(-1).note, "chosen for new chats");
    picks.at(-1).o.onUseDefault();
    assert.equal(chosen, "", "Use the default: the one used last again");
    chosen = "old/model";
    const again = /** @type {any} */ (doc.document.createElement("div"));
    renderGeneral(again, {}, io);
    await flush();
    assert.equal(picks.at(-1).note, "not offered now");
    assert.match(again.querySelector(".mdl-start").textContent, /It has left the picker: new chats take the model you used last/);
  });
});
