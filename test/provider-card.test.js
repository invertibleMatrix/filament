// @ts-check
// HarnessV3-Providers P1 (2026-10-01): an API provider's card on the Upstreams page, on the fake DOM — it knows its
// catalogue entry and plan from its address, switches plan by address (keeping DashScope's workspace, refusing one it
// does not hold), edits its prefix on its prefix route (refusing one another route already catches), and folds the
// rest under Advanced. An address the catalogue does not know is "Custom", with its address kept in plain view.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bindUi, state as runtimeState } from "../src/ui/runtime.js";
import { upstreams } from "../src/ui/pages/destinations.js";
import { PROVIDERS } from "../src/core/providers.js";
import { fmt } from "../src/ui/lib/format.js";
import { redactConfig, mergeSecrets } from "../src/services/config/store.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";

/** @type {any} */
const state = runtimeState;
/** @type {string[]} */
let toasts;
/** @param {any} el @param {(n: any) => boolean} ok @returns {any[]} */
const all = (el, ok, out = /** @type {any[]} */ ([])) => {
  if (!el || typeof el !== "object") return out;
  if (ok(el)) out.push(el);
  for (const k of el.kids || []) all(k, ok, out);
  return out;
};
const cls = (/** @type {string} */ c) => (/** @type {any} */ n) => String(n.attrs?.class || "").split(/\s+/).includes(c);
const card = (/** @type {any} */ page) => all(page, cls("provider-card"))[0];

beforeEach(() => {
  /** @type {any} */ (globalThis).location = { search: "" }; // the page reads ?only= and ?add=
  toasts = [];
  Object.assign(state, {
    tab: "upstreams", addUp: false, addFlow: null, justAdded: null, dirty: false, requests: [], unreadable: [], _providers: { providers: structuredClone(PROVIDERS) },
    schema: { upstreamTypes: { "openai-compatible": { label: "OpenAI-compatible server (…)", formats: ["openai"] }, anthropic: { label: "Anthropic API (your own key)", formats: ["anthropic"] } }, upstream: {} },
  });
  bindUi({
    h: fakeH, fmt,
    api: async (/** @type {string} */ path) => (path.startsWith("/models") ? { models: [], upstreams: {} } : path.startsWith("/usage") ? { total: { rows: [] } } : {}),
    toast: (/** @type {string} */ m) => toasts.push(m), render: () => {}, markDirty: (/** @type {boolean} */ on = true) => { state.dirty = on; },
    input: (/** @type {any} */ u, /** @type {string} */ k, /** @type {string} */ ph) => fakeH("input", { value: u[k] || "", placeholder: ph, "data-field": k }),
    idInput: () => fakeH("input"), flatten: (/** @type {any} */ o) => o || {}, openRulesDrawer() {}, mergedRules() {}, removeUpstream() {},
    goto: (/** @type {string} */ _t, /** @type {string} */ l) => fakeH("a", {}, l), intro: (/** @type {string} */ _id, /** @type {any[]} */ ...k) => fakeH("div", {}, ...k), md: (/** @type {string} */ s) => s,
    store: { get: () => null, set() {} }, pingResult: () => fakeH("span"),
  });
});
/** @param {any[]} ups @param {any[]} routes @param {string} sel */
const open = (ups, routes, sel) => {
  state.config = { upstreams: ups, routes, rules: {} };
  state.saved = structuredClone(state.config);
  state.selUp = sel;
  return upstreams();
};

// (fails before: yes — the card was twelve fields for any upstream, with no idea which provider it was)
test("a Z.AI card: its entry, plan and prefix in the header; another plan is its address; Advanced holds the rest", () => {
  const zai = { id: "zai", name: "Z.AI", type: "openai-compatible", baseUrl: "https://api.z.ai/api/coding/paas/v4/", apiKey: "__SECRET__", apiKeyMasked: "…ab12" };
  const page = open([zai], [{ match: "zai/*", upstream: "zai", upstreamModel: "{1}", enabled: true }], "zai");
  const head = all(card(page), cls("card-head"))[0];
  assert.match(textOf(head), /Z\.AI \(GLM\)\|Coding plan\|zai\//);
  const seg = all(card(page), cls("seg"))[0];
  assert.deepEqual(buttonsOf(seg).map(textOf), ["Coding plan", "API", "China (BigModel)"]);
  assert.match(textOf(card(page)), /a subscription/);
  buttonsOf(seg).find((b) => textOf(b) === "API").dispatch("click");
  assert.equal(zai.baseUrl, "https://api.z.ai/api/paas/v4");
  assert.equal(state.dirty, true);
  const adv = all(card(page), cls("provider-advanced"))[0];
  assert.ok(adv && adv.tag === "details" && !("open" in adv.attrs), "Advanced is folded");
  assert.ok(all(adv, (n) => n.attrs?.["data-field"] === "baseUrl").length === 1, "the address itself is under Advanced for a known provider");
});

test("the prefix is edited on its route; one another route already catches is refused", () => {
  const routes = [{ match: "zai/*", upstream: "zai", upstreamModel: "{1}", enabled: true }, { match: "fast/*", upstream: "anthropic", upstreamModel: "{1}", enabled: true }];
  const page = open([{ id: "zai", type: "openai-compatible", baseUrl: "https://api.z.ai/api/coding/paas/v4" }, { id: "anthropic", type: "anthropic", baseUrl: "https://api.anthropic.com" }], routes, "zai");
  const input = all(card(page), cls("prefix-in"))[0];
  input.value = "glm";
  input.onchange();
  assert.equal(routes[0].match, "glm/*");
  input.value = "fast";
  input.onchange();
  assert.equal(routes[0].match, "glm/*", "unchanged");
  assert.match(toasts.at(-1) || "", /route fast\/\* already catches/);
});

test("DashScope: a region switch keeps the workspace; a region that needs one this address lacks is not offered", () => {
  const sg = { id: "qwen", type: "openai-compatible", baseUrl: "https://ws-9.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1" };
  let page = open([sg], [{ match: "qwen/*", upstream: "qwen", upstreamModel: "{1}", enabled: true }], "qwen");
  buttonsOf(all(card(page), cls("seg"))[0]).find((b) => textOf(b) === "Tokyo").dispatch("click");
  assert.equal(sg.baseUrl, "https://ws-9.ap-northeast-1.maas.aliyuncs.com/compatible-mode/v1");
  const us = { id: "qwen", type: "openai-compatible", baseUrl: "https://dashscope-us.aliyuncs.com/compatible-mode/v1" };
  page = open([us], [], "qwen");
  const tokyo = buttonsOf(all(card(page), cls("seg"))[0]).find((b) => textOf(b) === "Tokyo");
  assert.equal(tokyo.attrs.disabled, "");
  tokyo.dispatch("click");
  assert.equal(us.baseUrl, "https://dashscope-us.aliyuncs.com/compatible-mode/v1", "unchanged");
  assert.match(textOf(card(page)), /No prefix: nothing asks for its models as \|qwen\/…/);
  buttonsOf(card(page)).find((b) => textOf(b).startsWith("Add prefix qwen/")).dispatch("click");
  assert.deepEqual(state.config.routes[0], { match: "qwen/*", upstream: "qwen", upstreamModel: "{1}", format: "auto", fallbacks: [], discoverPrefixes: [], enabled: true, rules: {} });
});

test("an address the catalogue does not know is Custom, with the address in plain view", () => {
  const page = open([{ id: "gw", name: "Gateway", type: "openai-compatible", baseUrl: "http://127.0.0.1:9000/v1" }], [{ match: "claude-*", upstream: "gw", upstreamModel: "{model}", enabled: true }], "gw");
  const c = card(page);
  assert.match(textOf(all(c, cls("card-head"))[0]), /Gateway\|Custom/);
  const body = all(c, cls("card-body"))[0];
  const adv = all(c, cls("provider-advanced"))[0];
  assert.ok(all(body, (n) => n.attrs?.["data-field"] === "baseUrl").length === 1 && all(adv, (n) => n.attrs?.["data-field"] === "baseUrl").length === 0, "in Connection, not under Advanced");
  assert.equal(all(c, (n) => cls("seg")(n) && !cls("billing-seg")(n)).length, 0, "no plans to pick");
  assert.match(textOf(c), /Also reached by claude-\*/);
});

// (fails before: yes — the bug hunt of 10-30, UIST-10: a stored header's value showed as the text __SECRET__ to edit, and a header renamed carried the placeholder to a name the store holds nothing under, so Save dropped it)
test("an extra header that keeps a stored value: shown as stored, typed over to replace it, its name kept until a value is typed", () => {
  const stored = { upstreams: [{ id: "gw", name: "Gateway", type: "openai-compatible", baseUrl: "http://127.0.0.1:9000/v1", headers: { Authorization: "Bearer stored-secret", "X-Team": "red" } }] };
  const gw = redactConfig(stored).upstreams[0];
  const page = open([gw], [{ match: "gw/*", upstream: "gw", upstreamModel: "{1}", enabled: true }], "gw");
  const editor = all(card(page), cls("kv-edit"))[0];
  const [[name, value], [, team]] = all(editor, cls("row")).map((r) => all(r, (n) => n.tag === "input"));
  assert.deepEqual([value.attrs.type, value.value, value.attrs.placeholder], ["password", "", "stored, type to replace"], "never the placeholder as a value to edit");
  assert.deepEqual([team.attrs.type, team.value], ["text", "red"], "a plain header as it is");
  name.value = "X-Api-Key";
  name.onchange();
  assert.equal(name.value, "Authorization", "the name stays");
  assert.match(toasts.at(-1) || "", /^Authorization keeps its stored value under its own name: give it a new value to rename it/);
  assert.deepEqual(gw.headers, { Authorization: "__SECRET__", "X-Team": "red" });
  assert.equal(mergeSecrets(state.config, stored).upstreams[0].headers.Authorization, "Bearer stored-secret", "Save finds the stored value");
  value.value = "";
  value.onchange();
  assert.equal(gw.headers.Authorization, "__SECRET__", "an empty box keeps it");
  value.value = "Bearer typed";
  value.onchange();
  name.value = "X-Api-Key";
  name.onchange();
  assert.deepEqual(gw.headers, { "X-Api-Key": "Bearer typed", "X-Team": "red" }, "a value typed: the header is renamed with it");
  // A Qoder card's headers are one JSON field: the placeholder put under a name that holds no stored value is refused.
  bindUi({ schemaForm: () => fakeH("div", {}) });
  state.schema.upstream.qoder = {};
  const qd = redactConfig({ upstreams: [{ id: "qd", name: "Qoder", type: "qoder", headers: { Authorization: "Bearer q" } }] }).upstreams[0];
  const json = all(open([qd], [], "qd"), (n) => n.tag === "input" && String(n.attrs?.value || "").startsWith('{"'))[0];
  json.value = '{"X-Key":"__SECRET__"}';
  json.onchange();
  assert.deepEqual([qd.headers, json.value], [{ Authorization: "__SECRET__" }, '{"Authorization":"__SECRET__"}'], "refused, the field as it was");
  assert.match(toasts.at(-1) || "", /^X-Key: __SECRET__ stands for a value stored under the header's own name/);
  json.value = '{"Authorization":"__SECRET__","X-Key":"plain"}';
  json.onchange();
  assert.deepEqual(qd.headers, { Authorization: "__SECRET__", "X-Key": "plain" }, "the stored one under its own name and a new one with its value: taken");
});

// (fails before: yes — the bug hunt of 10-30, #4: a key this secret.key cannot open came to its card as no key at all,
// "paste key", with nothing said; and, 10-30 again, its card offered no Remove)
test("a key this secret.key cannot read shows on its card as kept and unreadable, how it opens again, and Remove takes it out for Save to forget", () => {
  state.unreadable = ["upstreams.gw.apiKey", "upstreams.gw.headers.Authorization"];
  const stored = { upstreams: [{ id: "gw", name: "Gateway", type: "openai-compatible", baseUrl: "http://127.0.0.1:9000/v1", apiKey: "", headers: { Authorization: "" } }] };
  const gw = redactConfig(stored, { unreadable: state.unreadable }).upstreams[0];
  const page = () => card(open([gw], [{ match: "gw/*", upstream: "gw", upstreamModel: "{1}", enabled: true }], "gw"));
  const c = page();
  assert.match(textOf(c), /Stored, but this secret\.key cannot read it: \|apiKey, headers\.Authorization\|\. Put back the secret\.key it was sealed with, beside config\.json, and restart Filament to read it again\. A value typed in its place replaces it, and Remove forgets it; a save of anything else keeps it\./);
  const key = all(c, (n) => n.tag === "input" && n.attrs?.type === "password")[0];
  assert.deepEqual([key.value, key.attrs.placeholder], ["", "stored, unreadable here: type a key to replace it"]);
  key.value = "";
  key.onchange();
  assert.equal(gw.apiKey, "__SECRET__", "an empty box keeps it");
  // The header shows as kept, its name held (UIST-10), so a Save never takes it away by a rename.
  const [name] = all(all(c, cls("kv-edit"))[0], (n) => n.tag === "input");
  name.value = "X-Auth";
  name.onchange();
  assert.deepEqual(gw.headers, { Authorization: "__SECRET__" });
  // Remove: the person's own act. The draft holds no key, which Save sends as one to forget.
  const remove = buttonsOf(c).find((b) => textOf(b) === "remove");
  assert.equal(remove?.attrs.title, "Forget the stored key, which this secret.key cannot read; requests then go without one");
  remove.dispatch("click");
  assert.equal(gw.apiKey, "");
  assert.match(textOf(page()), /Stored, but this secret\.key cannot read it: \|headers\.Authorization\|/, "its key no longer said kept");
});

// (fails before: yes — the bug hunt of 10-30: an upstream renamed on its card saved with no key, its headers' kept values
// gone)
test("an upstream renamed on its card keeps the id it was read under, and Save takes its key and headers to the new id", () => {
  const stored = { upstreams: [{ id: "gw", type: "openai-compatible", baseUrl: "http://127.0.0.1:9000/v1", apiKey: "sk-gw-0123456789", headers: { Authorization: "Bearer gw-h" } }], routes: [{ match: "gw/*", upstream: "gw" }] };
  state.config = redactConfig(stored);
  // The console's shell boots the page as it loads: its id field is read from its text, and run on the fake DOM.
  const line = readFileSync("src/ui/app.js", "utf8").split("\n").find((l) => l.startsWith("function idInput("));
  const idInput = new Function("h", "state", "markDirty", `${line}\nreturn idInput;`)(fakeH, state, () => {});
  const u = state.config.upstreams[0];
  const box = idInput(u);
  for (const id of ["gateway", "gw2"]) {
    box.value = id;
    box.onchange();
  }
  assert.deepEqual([u.id, u.renamedFrom, state.config.routes[0].upstream], ["gw2", "gw", "gw2"]);
  const saved = mergeSecrets(state.config, stored).upstreams[0];
  assert.deepEqual([saved.id, saved.apiKey, saved.headers, "renamedFrom" in saved], ["gw2", "sk-gw-0123456789", { Authorization: "Bearer gw-h" }, false]);
});

// Providers P4: how the provider bills — the catalogue's plan by its address until the card says otherwise.
// (fails before: yes — the card had no billing, and a subscription's requests were "paid" at the card)
test("the billing switch: the catalogue's way until picked; picked is stored; automatic forgets it", () => {
  const zai = { id: "zai", name: "Z.AI", type: "openai-compatible", baseUrl: "https://api.z.ai/api/coding/paas/v4/", apiKey: "__SECRET__" };
  const routes = [{ match: "zai/*", upstream: "zai", upstreamModel: "{1}", enabled: true }];
  const sw = () => all(card(open([zai], routes, "zai")), cls("billing-seg"))[0];
  const on = () => buttonsOf(sw()).filter((b) => cls("active")(b)).map(textOf);
  assert.deepEqual(buttonsOf(sw()).map(textOf), ["Billed per token", "Subscription (plan)"]);
  assert.deepEqual(on(), ["Subscription (plan)"], "the Coding plan's address is a subscription");
  assert.match(textOf(all(card(open([zai], routes, "zai")), cls("card-body"))[0]), /as its Coding plan address says/);
  buttonsOf(sw()).find((b) => textOf(b) === "Billed per token").dispatch("click");
  assert.equal(state.config.upstreams[0].billing, "metered");
  assert.equal(state.dirty, true);
  const after = card(upstreams());
  assert.deepEqual(buttonsOf(all(after, cls("billing-seg"))[0]).filter((b) => cls("active")(b)).map(textOf), ["Billed per token"]);
  buttonsOf(after).find((b) => textOf(b) === "automatic").dispatch("click");
  assert.equal(state.config.upstreams[0].billing, null, "back to the catalogue's say");
  const custom = { id: "gw", name: "Gateway", type: "openai-compatible", baseUrl: "http://127.0.0.1:9000/v1" };
  const c = card(open([custom], [{ match: "gw/*", upstream: "gw", upstreamModel: "{1}", enabled: true }], "gw"));
  assert.deepEqual(buttonsOf(all(c, cls("billing-seg"))[0]).filter((b) => cls("active")(b)).map(textOf), ["Billed per token"]);
  assert.match(textOf(c), /nobody said, so per token/);
});

// (fails before: yes — every agent carried its install command in a column of its own, installed or not, and the column
// pushed the table past its panel: HarnessV3-Launch F8)
test("the coding agents on this machine: no install column; the command shows under an agent's name only while it isn't installed", async () => {
  const agents = [
    { id: "claude", name: "Claude Code (agent via ACP)", notes: "Your Claude plan pays.", account: "Claude subscription", installed: true, loggedIn: true, configured: true, enabled: true, install: "npm i -g @zed-industries/claude-code-acp" },
    { id: "codex", name: "Codex", notes: "Your ChatGPT plan pays.", account: "ChatGPT subscription", installed: false, configured: false, install: "npm install -g @openai/codex" },
  ];
  bindUi({ api: async (/** @type {string} */ path) => (path === "/acp/agents" ? { agents } : path.startsWith("/models") ? { models: [], upstreams: {} } : {}) });
  state.addUp = true;
  const page = open([], [], "");
  await new Promise((r) => setTimeout(r, 0));
  const panel = all(page, (n) => n.attrs?.id === "agents-panel")[0];
  const table = all(panel, (n) => n.tag === "table")[0];
  assert.deepEqual(all(table, (n) => n.tag === "th").map(textOf), ["agent", "what pays for it", "installed", "login", "in your config"]);
  const rows = all(table, (n) => n.tag === "tr").slice(1);
  const nameCell = (/** @type {any} */ tr) => tr.kids[0];
  assert.equal(textOf(nameCell(rows[0])), "Claude Code|Your Claude plan pays.", "installed: no command");
  assert.equal(textOf(nameCell(rows[1])), "Codex|Your ChatGPT plan pays.|Install: |npm install -g @openai/codex");
  assert.equal(all(nameCell(rows[1]), (n) => n.tag === "code").length, 1, "the command is code, to copy");
});
