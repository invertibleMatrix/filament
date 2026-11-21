// @ts-check
// Settings search (HarnessV4_Settings_Plan HS-6, HS-D68, HS-D69): its words — the sections, each page's rows, the
// schema-drawn rows run over the schema as their pages run them, your things — how a query finds them, the field and
// its keys, and the jump that lights a row. The pages are drawn on the fake DOM over the real schema; the field and the
// light on the stub document.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fakeH, fakeDrawIn, textOf } from "./helpers/fake-dom.js";
import { WORDS } from "../src/ui/harness/lib/words.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { schemaAsJson } from "../src/core/schema.js";
import { defaultConfig } from "../src/config.js";
import { SECTIONS, PAGE_ROWS, LIBRARY_HITS, DESCRIPTIONS } from "../src/ui/harness/settings/page.js";
import { staticHits, schemaHits, thingHits, readHits, findHits, findRow, lightRow, settingsSearch } from "../src/ui/harness/settings/search.js";
import { renderAgentLoop } from "../src/ui/harness/settings/agent-loop.js";
import { renderDataPrivacy } from "../src/ui/harness/settings/data-privacy.js";
import { renderAbout } from "../src/ui/harness/settings/about.js";
import { renderConnect } from "../src/ui/harness/settings/connect.js";
import { renderMemoryEngine } from "../src/ui/harness/settings/memory-engine.js";
import { renderExperimental } from "../src/ui/harness/settings/experimental.js";
import { mountContext } from "../src/ui/harness/settings/context.js";
import "./helpers/teams-on-page.js";

const read = (/** @type {string} */ p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const settle = async () => {
  for (let i = 0; i < 15; i++) await new Promise((r) => setImmediate(r));
};
/** @type {Record<string, any>} */
const ROWS = PAGE_ROWS;

/** Every node of a fake tree that `ok` takes. @param {any} el @param {(n: any) => boolean} ok @returns {any[]} */
const every = (el, ok) => {
  /** @type {any[]} */
  const out = [];
  /** @param {any} n */
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (ok(n)) out.push(n);
    for (const k of n.kids || []) walk(k);
  };
  walk(el);
  return out;
};
/** @param {any} n @param {string} cls */
const hasClass = (n, cls) => String(n.attrs?.class || "").split(/\s+/).includes(cls);

/** The configuration and Filament's answers as the schema-drawn pages read them. @param {(s: any) => void} [edit] */
function configServer(edit) {
  const schema = structuredClone(schemaAsJson());
  edit?.(schema);
  const cfg = /** @type {any} */ (defaultConfig());
  cfg.server.inboundKeysMasked = ["sk-l…aaaa"];
  const state = { version: "9.9.9", uptimeMs: 60_000, dataDir: "C:\\data", configFile: "C:\\data\\config.json", configVersion: 3, listening: { host: cfg.server.host, port: cfg.server.port }, supervisor: "tray", logReach: null, config: cfg };
  const api = async (/** @type {string} */ path) => {
    if (path === "/schema") return schema;
    if (path === "/state") return structuredClone(state);
    if (path === "/memory/mcp") return { path: "/mcp/memory", keyed: true };
    throw Object.assign(new Error(`no route ${path}`), { body: { error: `no route ${path}` } });
  };
  return { schema, state, api };
}

/**
 * A page drawn over the server: its leaf rows' paths and their labels.
 * @param {Function} render @param {ReturnType<typeof configServer>} srv
 */
async function drawnLeaves(render, srv) {
  const body = fakeH("div", {});
  const modelSelect = () => ({ el: fakeH("button", {}, "chip"), setModels() {}, setFamilies() {}, set() {}, setNote() {}, setLocked() {} });
  render(body, {}, { h: fakeH, drawIn: fakeDrawIn, api: srv.api, bus: () => () => {}, copy: async () => {}, confirm: async () => true, now: () => 0, origin: "http://127.0.0.1:1", modelSelect });
  await settle();
  return every(body, (n) => !!n.attrs?.["data-path"]).map((n) => [n.attrs["data-path"], textOf(every(n, (k) => hasClass(k, "settings-row-label"))[0])]);
}

/**
 * The leaves the search finds for a section, as [path, label].
 * @param {string} section @param {ReturnType<typeof configServer>} srv
 */
const foundLeaves = (section, srv) =>
  schemaHits(SECTIONS, { [section]: ROWS[section] }, srv.schema, srv.state).map((x) => [/data-path="([^"]+)"/.exec(String(x.go.selector))?.[1], x.label]);

describe("the words: each page's rows (HS-D68)", () => {
  // The schema-drawn pages: what the search finds is what the page draws, leaf for leaf, under the same label.
  const PAGES = /** @type {[string, Function][]} */ ([["agent-loop", renderAgentLoop], ["data", renderDataPrivacy], ["connect", renderConnect], ["memory", renderMemoryEngine], ["experimental", renderExperimental]]);

  // (fails before: yes — HC-113: Settings had no search)
  test("a schema-drawn page's rows are found as the page draws them, each by its label, its path and its value", async () => {
    const srv = configServer();
    for (const [section, render] of PAGES) {
      const drawn = await drawnLeaves(render, srv);
      assert.ok(drawn.length, `${section} draws leaves`);
      assert.deepEqual(foundLeaves(section, srv), drawn, section);
    }
    // About draws no setting since the owner's of 11-09 (the log's level is the console's Settings › Server): none found.
    assert.deepEqual([await drawnLeaves(renderAbout, srv), foundLeaves("about", srv)], [[], []], "about");
    const hits = schemaHits(SECTIONS, ROWS, srv.schema, srv.state);
    assert.equal(findHits(hits, "storeBodies")[0]?.go.selector, '[data-path="observability.storeBodies"]', "by its path");
    assert.equal(findHits(hits, "agentLoop").length, hits.filter((x) => String(x.go.selector).includes('"agentLoop.')).length, "a console word: the whole group");
    const listens = findHits(hits, "listens on")[0];
    assert.deepEqual([listens?.label, listens?.where], ["Listens on", "Connect other apps"], "the page's own label");
    assert.ok(findHits(hits, `server.port ${srv.state.config.server.port}`).some((x) => x.label === "Port"), "by its value");
    assert.ok(!hits.some((x) => String(x.go.selector).includes("agentLoop.systemPrompt")), "the system prompt has its own page");
    assert.ok(!hits.some((x) => /apiKey|inboundKeys"/.test(String(x.go.selector))), "a credential is no row");
  });

  // (fails before: yes — HC-114)
  test("a setting a later version adds to a schema-drawn page is found by itself, as the page draws it", async () => {
    const srv = configServer((s) => {
      s.config.agentLoop.brandNew = { type: "boolean", default: false, description: "A setting a later version adds.", effect: "" };
      // Data and privacy's rows of the log are its own words (the owner's of 11-09); its alerts are drawn from their group.
      s.config.alerts.alsoNew = { type: "number", default: 3, description: "Another." };
    });
    for (const [section, render] of PAGES.slice(0, 2)) assert.deepEqual(foundLeaves(section, srv), await drawnLeaves(render, srv), section);
    const hits = schemaHits(SECTIONS, ROWS, srv.schema, srv.state);
    // Agent loop is drawn by hand now (the owner's of 11-09): a setting the schema adds there waits for its row, found
    // as it is drawn — not at all.
    assert.deepEqual(findHits(hits, "brand new"), []);
    assert.deepEqual(findHits(hits, "also new").map((x) => x.where), ["Data and privacy"]);
  });

  // (fails before: yes — HC-115: a hand-drawn page's rows had no words to be found by)
  test("a hand-drawn page's list says each row its code draws, and nothing it does not", () => {
    /** The sections' code: each page's files. General draws from its list (test/composer-keys.test.js). */
    const FILES = /** @type {Record<string, string[]>} */ ({
      appearance: ["appearance.js"],
      // Settings › Models went (the owner's settings cleanup of 11-09): its backups switch heads Providers.
      providers: ["failover-card.js"],
      permissions: ["permissions.js"],
      instructions: ["instructions.js"],
      "language-servers": ["language-servers.js"],
      context: ["context.js", "../panes/context-how.js"],
      memory: ["memory.js", "memory-chats.js", "memory-engine.js"],
      connect: ["connect.js"],
      remote: ["remote.js"],
      "agent-loop": ["agent-loop.js"],
      space: ["space.js"],
      data: ["data-privacy.js"],
      experimental: ["experimental.js"],
      about: ["about.js"],
    });
    const LABEL = /(?:\brow\(|\b(?:switchRow|linesRow|onOff)\(\s*"[^"]*",)\s*"([^"]+)"|"(?:settings-row-label|prov-crow-label)" \}, "([^"]+)"/g;
    const FIELD = /kit\.field\("([^"]+)"(?:, \{ label: "([^"]*)")?/g;
    const GROUP = /kit\.group\("([^"]+)"/g;
    const src = (/** @type {string} */ f) => read(`src/ui/harness/settings/${f}`);
    // Every page with a row of literal words has a list. Providers' rows are each provider's card's: the search finds
    // the provider itself (thingHits).
    for (const name of readdirSync(new URL("../src/ui/harness/settings/", import.meta.url)).filter((f) => f.endsWith(".js")))
      if ([...src(name).matchAll(LABEL)].length && name !== "general.js" && name !== "providers.js") assert.ok(Object.values(FILES).flat().includes(name), `${name} draws rows: give its section a list`);
    for (const [section, files] of Object.entries(FILES)) {
      const code = files.map(src).join("\n");
      const list = /** @type {any[]} */ (ROWS[section]);
      const labels = new Set(list.flatMap((r) => [r.label, ...(r.also || [])]).filter(Boolean));
      for (const m of code.matchAll(LABEL)) assert.ok(labels.has(m[1] || m[2]), `${section}: "${m[1] || m[2]}" is drawn but not in its list`);
      for (const m of code.matchAll(FIELD)) {
        const r = list.find((x) => x.path === m[1]);
        assert.ok(r, `${section}: ${m[1]} is drawn but not in its list`);
        if (m[2]) assert.equal(r.label, m[2], `${section}: ${m[1]}'s label`);
      }
      for (const m of code.matchAll(GROUP)) assert.ok(list.some((x) => x.group === m[1]), `${section}: the group ${m[1]} is drawn but not in its list`);
      // And the list names nothing the code does not.
      // A name several pages say is the words table's (lib/words.js): the code reads it from there.
      const shared = (/** @type {string} */ l) => Object.entries(WORDS).find(([, w]) => w === l)?.[0];
      for (const l of labels) assert.ok(code.includes(`"${l}"`) || (shared(l) && code.includes(`WORDS.${shared(l)}`)), `${section}: "${l}" is in its list but not in its code`);
      for (const r of list.filter((x) => x.path)) assert.ok(code.includes(`kit.field("${r.path}"`), `${section}: ${r.path} is listed but not drawn`);
      for (const r of list.filter((x) => x.group)) assert.ok(code.includes(`kit.group("${r.group}"`), `${section}: ${r.group} is listed but not drawn`);
    }
  });

  // (fails before: yes — HC-115, the Context section's parts)
  test("the Context page's list names the parts it draws over your defaults", async () => {
    const host = fakeH("div", {});
    const doc = { layer: {}, flat: { "context.strategy": "fold", "context.compaction.thresholdPercent": 85, "context.carry": "plain" }, sources: {}, effective: { context: { strategy: "fold", carry: "plain", compaction: { thresholdPercent: 85 } } }, hash: "h", preset: null };
    const modelSelect = () => ({ el: fakeH("button", {}, "chip"), setModels() {}, set() {}, setNote() {}, setLocked() {} });
    await mountContext(host, {}, { h: fakeH, drawIn: fakeDrawIn, api: async () => doc, modelSelect }).ready;
    await settle();
    // The rows of the mock's parts, then Advanced, whose words name what waits under it (HarnessV4_Tasks U11).
    const drawn = [...new Set(every(host, (n) => hasClass(n, "inst-how-name") || hasClass(n, "inst-how-more-title")).map((n) => textOf(n)))];
    assert.deepEqual(drawn, ROWS.context.map((/** @type {any} */ r) => r.label).filter((/** @type {string} */ l) => l !== "How earlier turns reach the model"));
    // HarnessV4_Envelopes_Plan EN5 added Other agents' results: While your agent works.
    assert.deepEqual(drawn, ["Your line", "Then", "Back after a break", "After an update", "The way", "A coding agent's way", "Summaries written by", "While your agent works", "Advanced"]);
  });

  test("the sections are found by their names and descriptions; the shortcuts by their names and keys", () => {
    const hits = staticHits([...SECTIONS, ...LIBRARY_HITS], { general: "" }, {});
    // MCP servers are the Library's Connectors (the owner's word of 10-26), on Library › Plugins & Connectors since 11-09:
    // found by either name, opening the Library there.
    for (const q of ["mcp", "connectors"]) {
      const hit = findHits(hits, q)[0];
      assert.deepEqual([hit?.label, hit?.where, hit?.go], ["Connectors", "Library", { section: "mcp-servers" }], q);
    }
    const kb = findHits(hits, "toggle sidebar")[0];
    assert.deepEqual([kb?.label, kb?.where, kb?.go], ["Toggle Sidebar", "Keyboard shortcuts", { section: "shortcuts", label: "Toggle Sidebar" }]);
    assert.equal(findHits(hits, "ctrl+b")[0]?.label, "Toggle Sidebar");
    // (fails before: yes — HC-139, found in HS-6's drive: “key” listed all 28 shortcuts, by “Keyboard” in their place)
    assert.deepEqual(findHits(hits, "key").filter((x) => x.where === "Keyboard shortcuts"), [], "no shortcut by its place alone");
    assert.ok(findHits(hits, "shortcut").filter((x) => x.where === "Keyboard shortcuts").length > 20, "“shortcut” lists them");
    assert.deepEqual(findHits(hits, "keyboard").map((x) => x.go), [{ section: "shortcuts" }], "the place itself is found");
  });

  // (fails before: yes — HC-139: “data” found every row of Data and privacy by its place)
  test("where a row is narrows a search but never finds a row alone", () => {
    const hit = (/** @type {string} */ label, /** @type {string} */ where) => ({ label, where, desc: "", words: "", go: { section: "x" } });
    const hits = [hit("Store bodies", "Data and privacy"), hit("Data folder", "About"), hit("Theme", "Appearance")];
    assert.deepEqual(findHits(hits, "privacy store").map((x) => x.label), ["Store bodies"]);
    assert.deepEqual(findHits(hits, "data").map((x) => x.label), ["Data folder"]);
    assert.deepEqual(findHits(hits, "appearance"), []);
  });
});

/** A server's answers for your things. */
const THINGS = {
  upstreams: { upstreams: [
    { id: "zai", name: "Z.ai", baseUrl: "https://api.z.ai/api/coding/paas/v4", type: "openai" },
    { id: "cerebras", name: "Cerebras", baseUrl: "https://api.cerebras.ai/v1", type: "openai" },
    { id: "qoder", name: "Qoder", type: "qoder" },
    { id: "claude-code", name: "Claude Code", type: "acp", agent: true },
  ] },
  models: { models: [
    { id: "glm-5.3", lead: "glm-5.3", label: null, upstream: { id: "zai", name: "Z.ai" }, members: ["glm-5.3"] },
    { id: "cerebras/glm-5.3", lead: "glm-5.3", label: "glm-5.3", upstream: { id: "cerebras", name: "Cerebras" }, members: ["glm-5.3"] },
    { id: "kimi-k3", lead: "kimi-k3", label: null, upstream: { id: "kimi", name: "Kimi" }, members: [] },
    { id: "cc/sonnet", lead: "cc/sonnet", label: "sonnet", upstream: { id: "claude-code", name: "Claude Code", agent: true }, members: ["cc/sonnet"] },
  ] },
  mcp: { servers: [
    { name: "github", kind: "stdio", spec: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_PERSONAL_ACCESS_TOKEN: "__SECRET__" } } },
    { name: "brave-search", kind: "stdio", spec: { command: "npx", env: { BRAVE_API_KEY: "__SECRET__" } } },
    { name: "linear", kind: "http", spec: { url: "https://mcp.linear.app/mcp", headers: { Authorization: "__SECRET__" } } },
  ] },
  agents: { entries: [{ id: "claude-code", name: "Claude Code" }, { id: "codex", name: "Codex" }] },
  saved: { saved: [{ tag: "pm", name: "PM", goodFor: "plans and priorities" }], shipped: [{ tag: "review", name: "Reviewer", goodFor: "" }] },
  teams: { saved: [], shipped: [{ key: "build", name: "Build team" }] },
};

describe("a query (HS-D69)", () => {
  // (fails before: yes — HC-74)
  test("“key”: each provider's Key first — Qoder's Account is not one — then Connect's keys, then an MCP server whose environment names a key", () => {
    const srv = configServer();
    const hits = [...staticHits(SECTIONS, {}, ROWS), ...schemaHits(SECTIONS, ROWS, srv.schema, srv.state), ...thingHits(THINGS)];
    const found = findHits(hits, "key");
    assert.deepEqual(found.slice(0, 2).map((x) => [x.label, x.where, x.go]), [
      ["Key", "Providers › Z.ai", { section: "providers", start: "provider:zai", label: "Key" }],
      ["Key", "Providers › Cerebras", { section: "providers", start: "provider:cerebras", label: "Key" }],
    ]);
    const at = (/** @type {(x: any) => boolean} */ ok) => found.findIndex(ok);
    const connect = at((x) => x.label === "Newest key");
    const mcp = at((x) => x.label === "brave-search");
    assert.ok(connect > 1 && at((x) => x.label === "Ask apps for a key") > 1, "Connect's keys after the providers'");
    assert.ok(mcp > connect, "the server whose environment names a key after them");
    assert.equal(found[mcp].go.selector, '.mcps-row[data-name="brave-search"]');
    assert.ok(!found.some((x) => x.label === "Account"), "Qoder signs in: its row is Account");
    assert.ok(!found.some((x) => x.where.includes("Claude Code")), "a coding agent is no provider");
    assert.equal(findHits(hits, "qoder account")[0]?.go.label, "Account");
  });

  // (fails before: yes — HC-109; the owner's settings cleanup of 11-09: a model opens its provider's page at its row,
  // Settings › Models gone, and a coding agent's model the Coding agents page)
  test("“glm-5.3”: the models of that name, each at its provider's page; a coding agent's model at Coding agents", () => {
    const found = findHits(thingHits(THINGS), "glm-5.3");
    assert.deepEqual(found.map((x) => [x.label, x.where, x.go]), [
      ["glm-5.3", "Providers › Z.ai", { section: "providers", start: "provider:zai", selector: '[data-family="glm-5.3"]' }],
      ["glm-5.3", "Providers › Cerebras", { section: "providers", start: "provider:cerebras", selector: '[data-family="cerebras/glm-5.3"]' }],
    ]);
    assert.deepEqual(findHits(thingHits(THINGS), "sonnet").map((x) => [x.where, x.go]), [["Coding agents › Claude Code", { section: "agents" }]]);
  });

  // (fails before: yes — the owner's 10-20 two tabs: an agent's result opened the page wherever it stood; U13: one page,
  // a team and the lists each where it stands on it)
  test("your things by their names and words: an MCP server by its header's name, an agent by its tag, a team — a team at the teams, a model's agents at once at its provider", () => {
    const hits = thingHits(THINGS);
    assert.deepEqual(findHits(hits, "authorization").map((x) => x.label), ["linear"]);
    assert.deepEqual(findHits(hits, "@pm").map((x) => [x.label, x.go]), [["PM", { section: "saved-agents", start: "agents", selector: '[data-tag="pm"]' }]]);
    assert.deepEqual(findHits(hits, "build").map((x) => x.go), [], "Settings › Experimental's Teams switch off, as it ships: no team is found");
    assert.deepEqual(findHits(hits, "@pm").map((x) => x.where), ["Library › Agents"]);
    const teamsOn = thingHits({ ...THINGS, state: { config: { experimental: { teams: true } } } });
    assert.deepEqual(findHits(teamsOn, "build").map((x) => x.go), [{ section: "saved-agents", start: "groups", selector: '[data-key="build"]' }]);
    assert.deepEqual(findHits(teamsOn, "@pm").map((x) => x.where), ["Library › Agents and teams"]);
    // (fails before: yes — the owner's word of 11-05: Library's Models for agents is gone; a model's limit is set on its
    // row, under its provider or its coding agent) "Agents at once" finds the two pages that set it.
    const rows = staticHits(SECTIONS, DESCRIPTIONS, ROWS);
    assert.deepEqual(findHits(rows, "agents at once").map((x) => x.go), [{ section: "providers" }, { section: "agents" }]);
    assert.deepEqual(rows.filter((x) => ["Models for agents", "Each model, across all your chats", "Agents in one chat"].includes(x.label)), []);
    // (the owner's of 11-07: there are no presets to find)
    assert.deepEqual(findHits(hits, "read-only review"), []);
    assert.deepEqual(findHits(hits, "codex").map((x) => x.go), [{ section: "agents", selector: '[data-agent="codex"]' }]);
  });

  test("every word must be there; a label that is the query comes first, then one that starts with it, then one that holds it", () => {
    const hit = (/** @type {string} */ label, /** @type {string} */ words = "") => ({ label, where: "", desc: "", words, go: { section: "x" } });
    const hits = [hit("Something else", "theme"), hit("Theme colors"), hit("App theme"), hit("Theme")];
    assert.deepEqual(findHits(hits, "  THEME ").map((x) => x.label), ["Theme", "Theme colors", "App theme", "Something else"]);
    assert.deepEqual(findHits(hits, "app theme").map((x) => x.label), ["App theme"]);
    assert.deepEqual(findHits(hits, ""), []);
  });

  test("a read that fails is named with its cause; the rest are searched", async () => {
    const srv = configServer();
    const r = await readHits(async (path) => {
      if (path === "/model-routes") throw Object.assign(new Error("x"), { body: { error: "Filament is restarting" } });
      if (path === "/schema" || path === "/state") return srv.api(path);
      return /** @type {any} */ (THINGS)[{ "/upstreams": "upstreams", "/mcp-servers?scope=all": "mcp", "/coding-agents": "agents", "/agents": "saved", "/teams": "teams" }[path] || ""] ?? null;
    }, SECTIONS, ROWS);
    assert.deepEqual(r.failed, ["your models (Filament is restarting)"]);
    assert.ok(r.hits.some((x) => x.label === "Z.ai") && r.hits.some((x) => x.label === "Listens on"));
  });
});

describe("the field and the jump (HS-D69)", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  beforeEach(() => { doc = stubDocument(); });
  afterEach(() => doc.restore());

  /** The field over a scripted server; what it opened and whether results show, recorded. */
  const field = async (/** @type {(path: string) => any} */ answer = () => null) => {
    /** @type {any[]} */
    const opened = [];
    /** @type {boolean[]} */
    const searching = [];
    const srv = configServer();
    const f = settingsSearch({
      sections: SECTIONS, descriptions: {}, rows: ROWS,
      open: (go) => opened.push(go), onSearching: (on) => searching.push(on),
    }, { api: async (path) => (path === "/schema" || path === "/state" ? srv.api(path) : answer(path)) });
    doc.document.body.append(f.field, f.results);
    /** @param {string} words */
    const type = async (words) => { f.field.value = words; f.field.oninput(); await settle(); };
    /** @param {string} key */
    const press = (key) => {
      const e = { key, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
      f.field.onkeydown(e);
      return e;
    };
    const shown = () => f.results.querySelectorAll(".settings-hit").map((/** @type {any} */ b) => b.textContent);
    const marked = () => f.results.querySelector(".settings-hit.is-marked")?.textContent;
    return { f, opened, searching, type, press, shown, marked };
  };

  // (fails before: yes — HC-110)
  test("a word nothing has: “Nothing in Settings matches …”", async () => {
    const s = await field();
    await s.type("xyzzy");
    assert.deepEqual(s.shown(), []);
    assert.equal(s.f.results.querySelector(".settings-hits-none")?.textContent, "Nothing in Settings matches “xyzzy”.");
    assert.equal(s.searching.at(-1), true);
    await s.type("");
  });

  // (fails before: yes — HC-111)
  test("↓ ↑ move through the results, Enter opens the one marked, Esc empties the field and the sections come back", async () => {
    const s = await field((path) => (path === "/upstreams" ? THINGS.upstreams : null));
    await s.type("font size");
    assert.deepEqual(s.shown(), ["UI font sizeAppearance", "Code font sizeAppearance"]);
    assert.equal(s.marked(), "UI font sizeAppearance", "the first is marked");
    assert.equal(s.press("ArrowDown").prevented, true);
    assert.equal(s.marked(), "Code font sizeAppearance");
    s.press("ArrowDown");
    assert.equal(s.marked(), "UI font sizeAppearance", "round to the first");
    s.press("ArrowUp");
    assert.equal(s.press("Enter").prevented, true);
    assert.deepEqual(s.opened, [{ section: "appearance", label: "Code font size" }]);
    const esc = s.press("Escape");
    assert.equal(esc.prevented && esc.stopped, true, "the page does not close");
    assert.equal(s.f.field.value, "");
    assert.deepEqual([s.shown(), s.searching.at(-1)], [[], false]);
    assert.equal(s.press("Escape").prevented, false, "an empty field leaves Esc to the page");
    // The things arrive after the first words: a provider is found.
    await s.type("cerebras");
    assert.equal(s.shown()[0], "CerebrasProviders");
    await s.type("");
  });

  test("the words stay across the page's draws, with the one marked, and the field takes the focus back when a result was opened from it", async () => {
    const s = await field();
    await s.type("font size");
    s.press("ArrowDown");
    const again = settingsSearch({ sections: SECTIONS, descriptions: {}, rows: ROWS, open: () => {} }, { api: async () => null });
    assert.equal(again.field.value, "font size");
    await settle();
    assert.equal(again.results.querySelector(".settings-hit.is-marked")?.textContent, "Code font sizeAppearance");
    again.field.value = "";
    again.field.oninput();
  });

  // (fails before: yes — HC-112)
  test("a result opened: its row found by its label or its marker, scrolled to, lit for two seconds; a closed part around it opened", () => {
    const { h } = { h: (/** @type {string} */ tag, /** @type {Record<string, string>} */ attrs = {}, /** @type {any[]} */ ...kids) => {
      const el = doc.document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      el.append(...kids.map((k) => (typeof k === "string" ? doc.document.createTextNode(k) : k)));
      return el;
    } };
    const keyRow = h("div", { class: "prov-crow" }, h("div", { class: "prov-crow-label" }, "Key"));
    const inner = h("div", { class: "settings-row", "data-path": "observability.storeBodies" }, h("div", { class: "settings-row-label" }, "Store bodies"));
    const part = h("details", {}, inner);
    const body = h("div", {}, keyRow, part);
    /** @type {{ fn: () => void, ms: number }[]} */
    const timers = [];
    const later = (/** @type {() => void} */ fn, /** @type {number} */ ms) => timers.push({ fn, ms });
    let scrolled = 0;
    keyRow.scrollIntoView = () => { scrolled++; };
    lightRow(body, { section: "providers", label: "Key" }, { later });
    assert.equal(keyRow.classList.contains("is-lit"), true);
    assert.equal(scrolled, 1);
    assert.deepEqual(timers.map((t) => t.ms), [2000]);
    timers[0].fn();
    assert.equal(keyRow.classList.contains("is-lit"), false, "the light goes after two seconds");
    assert.equal(/** @type {any} */ (part).open, false);
    lightRow(body, { section: "data", selector: '[data-path="observability.storeBodies"]' }, { later });
    assert.equal(inner.classList.contains("is-lit"), true);
    assert.equal(/** @type {any} */ (part).open, true, "the closed part around it opened");
    assert.equal(findRow(body, { section: "about", label: "Restart Filament", also: ["Key"] }), keyRow, "a row's other label");
    assert.equal(findRow(body, { section: "x", label: "Nothing like it" }), null);
  });

  test("a row a page draws after its read is lit when it comes; a newer jump ends the older watch", () => {
    const g = /** @type {any} */ (globalThis);
    /** @type {{ fn: () => void, on: boolean }[]} */
    const watches = [];
    g.MutationObserver = class {
      /** @param {() => void} fn */
      constructor(fn) { this.w = { fn, on: false }; watches.push(this.w); }
      observe() { this.w.on = true; }
      disconnect() { this.w.on = false; }
    };
    try {
      const body = doc.document.createElement("div");
      doc.document.body.append(body);
      /** @type {(() => void)[]} */
      const timers = [];
      const later = (/** @type {() => void} */ fn) => timers.push(fn);
      lightRow(body, { section: "providers", selector: '[data-family="glm-5.3"]' }, { later });
      assert.equal(watches[0].on, true, "watching until it comes");
      lightRow(body, { section: "providers", selector: '[data-family="kimi-k3"]' }, { later });
      assert.equal(watches[0].on, false, "the older watch ended");
      const row = doc.document.createElement("div");
      row.setAttribute("data-family", "kimi-k3");
      body.append(row);
      watches[1].fn();
      assert.equal(row.classList.contains("is-lit"), true);
      assert.equal(timers.length, 1);
      timers[0]();
      assert.equal(row.classList.contains("is-lit"), false);
      assert.equal(watches[1].on, false, "the light gone: the watch ends");
    } finally {
      delete g.MutationObserver;
    }
  });

  // (fails before: yes — HC-138, found in HS-6's drive: a provider's page paints again as its reads come back, and
  // Key's light went with the row it was on)
  test("a page that draws again while its row is lit: the new row is lit for the rest of the two seconds", () => {
    const g = /** @type {any} */ (globalThis);
    /** @type {{ fn: () => void, on: boolean }[]} */
    const watches = [];
    g.MutationObserver = class {
      /** @param {() => void} fn */
      constructor(fn) { this.w = { fn, on: false }; watches.push(this.w); }
      observe() { this.w.on = true; }
      disconnect() { this.w.on = false; }
    };
    try {
      const keyRow = () => {
        const row = doc.document.createElement("div");
        row.className = "prov-crow";
        const label = doc.document.createElement("div");
        label.className = "prov-crow-label";
        label.textContent = "Key";
        row.append(label);
        return row;
      };
      const body = doc.document.createElement("div");
      doc.document.body.append(body);
      const first = keyRow();
      body.append(first);
      /** @type {(() => void)[]} */
      const timers = [];
      let scrolled = 0;
      first.scrollIntoView = () => { scrolled++; };
      lightRow(body, { section: "providers", label: "Key" }, { later: (fn) => timers.push(fn) });
      assert.equal(first.classList.contains("is-lit"), true);
      const second = keyRow();
      second.scrollIntoView = () => { scrolled++; };
      body.replaceChildren(second);
      watches[0].fn();
      assert.equal(second.classList.contains("is-lit"), true, "the row drawn again is lit");
      assert.equal(scrolled, 1, "scrolled to once: a page that draws again does not move the view");
      assert.equal(timers.length, 1, "one light, two seconds long");
      timers[0]();
      assert.equal(second.classList.contains("is-lit"), false);
      assert.equal(watches[0].on, false);
    } finally {
      delete g.MutationObserver;
    }
  });

  test("the settings page puts the field over its sections and a result's jump through its section", () => {
    const page = read("src/ui/harness/settings/page.js");
    assert.match(page, /nav\.append\(finder\.field\);/);
    assert.match(page, /nav\.append\(finder\.results\);/);
    assert.match(page, /if \(go\.section === current && !go\.start && !moved\) return lightRow\(body, go\);/);
    // (fails before: yes — phase 7) A result on a page the Library took over opens it there, held until it is drawn.
    assert.match(page, /holdJump\(go\);\n {6}if \(moved\) location\.hash = routeFor\("library", \{ page: moved\.page \}\);/);
    // Held for the page, or for a part of it: Connectors, on Plugins & Connectors (the owner's of 11-09).
    assert.match(read("src/ui/harness/library/page.js"), /const taken = takeJump\(\(s\) => libraryPage\(libraryOf\(s\)\?\.page\) === page\);[\s\S]*if \(taken\) lightRow\(body, taken\);/);
    assert.match(page, /if \(taken\) lightRow\(body, taken\);/);
    assert.match(read("src/ui/harness/settings/settings.css"), /\.settings-nav\.is-searching > \.settings-group, \.settings-nav\.is-searching > \.settings-item \{ display: none; \}/);
  });
});
