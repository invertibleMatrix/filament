// @ts-check
// Library › Plugins and Library › Connectors are one page, Plugins & Connectors (the owner's of 11-09: "both are
// essentially the same. Plugins can contain scripts + connectors and connectors are just mcp servers without
// scripts"): one row in the left bar counting both, its page key `plugins`, and Connectors' address — with every door
// that opened it, a Space's or a project's with its place chosen — landing on that page at its connectors part.
// (fails before: yes — `#/library/connectors` was a page of its own, and the left bar had a row for each)
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { LIBRARY_PAGES, libraryOf, parseRoute, routeFor } from "../src/ui/harness/lib/router.js";

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };

/** @param {any} el @param {string} cls @returns {any[]} */
const allOf = (el, cls) => [...(el.classList?.contains(cls) ? [el] : []), ...[...(el.children || [])].flatMap((c) => allOf(c, cls))];

/** What Filament answers the page's reads with: no connectors, no plugins, one project. @param {string} url */
const answer = (url) => {
  const path = url.replace(/^\/api/, "");
  if (path.startsWith("/mcp-servers?scope=")) {
    const project = path === "/mcp-servers?scope=project%3Aw1";
    return { scope: project ? "project:w1" : "all", at: project ? "project" : "global", label: project ? "northwind" : "all chats", held: false, unread: [], servers: [] };
  }
  if (path === "/memory/projects") return { projects: [{ id: "w1", name: "northwind" }] };
  if (path === "/spaces/own") return { spaces: [] };
  if (path === "/plugins/sources") return { line: "Found on this computer — nothing from Claude Code or Codex.", claude: { installed: [], marketplaces: [] }, codex: { installed: [], marketplaces: [] } };
  if (path === "/plugins/installed") return { plugins: [] };
  return {};
};

/**
 * The Library drawn at an address, on the stub document, Filament's reads answered: what it read, and what it
 * scrolled into sight.
 * @param {string} hash @param {(page: any) => void} [before]  what happens before it is drawn (a door holds its place)
 */
async function libraryAt(hash, before) {
  const doc = stubDocument();
  const g = /** @type {any} */ (globalThis);
  const had = { fetch: g.fetch, location: g.location };
  /** @type {string[]} */
  const read = [];
  g.fetch = async (/** @type {string} */ url) => { read.push(url); return { ok: true, status: 200, json: async () => answer(url) }; };
  g.location = { hash, protocol: "http:", hostname: "127.0.0.1", port: "1" };
  const proto = Object.getPrototypeOf(document.createElement("div"));
  const wasScroll = proto.scrollIntoView;
  /** @type {string[]} */
  const scrolled = [];
  proto.scrollIntoView = function () { scrolled.push(this.className); };
  try {
    const page = await import("../src/ui/harness/library/page.js");
    const search = await import("../src/ui/harness/settings/search.js");
    before?.(search);
    const host = /** @type {any} */ (document.createElement("div"));
    document.body.append(host);
    page.renderLibrary(host, /** @type {any} */ (parseRoute(hash)), { onClose() {}, onToast() {} });
    await flush();
    return { host, read, scrolled };
  } finally {
    proto.scrollIntoView = wasScroll;
    for (const [k, v] of Object.entries(had)) {
      if (v === undefined) delete g[k];
      else g[k] = v;
    }
    doc.restore();
  }
}

describe("the address", () => {
  test("Plugins & Connectors is the page `plugins`; Connectors is no page of its own, and its address names that page's connectors part", () => {
    assert.deepEqual(LIBRARY_PAGES, ["agents", "skills", "memory", "plugins"]);
    assert.deepEqual(parseRoute("#/library/connectors"), { kind: "library", page: "plugins", scope: "", part: "connectors" });
    assert.deepEqual(parseRoute("#/library/plugins"), { kind: "library", page: "plugins", scope: "" });
    assert.deepEqual(parseRoute("#/library/plugins/linear%40m"), { kind: "library", page: "plugins", scope: "linear@m" }, "a plugin's sheet still opens from its address");
    // Every door that asks for Connectors by name keeps its address, which reads back to the same part.
    assert.equal(routeFor("library", { page: "connectors" }), "#/library/connectors");
    assert.equal(routeFor(parseRoute("#/library/connectors")), "#/library/connectors");
    assert.equal(routeFor("library", { page: "plugins", scope: "linear@m" }), "#/library/plugins/linear%40m");
    // Settings › MCP servers' old address and its search results lead there too (app.js, settings/page.js).
    assert.deepEqual(parseRoute(routeFor("library", { page: /** @type {any} */ (libraryOf("mcp-servers")).page })), { kind: "library", page: "plugins", scope: "", part: "connectors" });
  });
});

describe("the page", () => {
  test("opened from `#/library/connectors`: Plugins & Connectors, its connectors part first and brought into sight, on All chats", async () => {
    const { host, read, scrolled } = await libraryAt("#/library/connectors");
    const lib = allOf(host, "library")[0];
    assert.equal(lib.getAttribute("data-page"), "plugins");
    assert.equal(allOf(lib, "lib-crumb-at")[0].textContent, "Plugins & Connectors");
    assert.equal(allOf(lib, "lib-title")[0].textContent, "Plugins & Connectors");
    const parts = allOf(lib, "plg-sec");
    assert.deepEqual(parts.map((p) => allOf(p, "plg-h")[0]?.textContent), ["Connectors", "Installed plugins", "Add from this computer", "Find more plugins"]);
    assert.equal(parts[0].classList.contains("plg-connectors"), true);
    // Library › Connectors' own control and list, with Import from other apps beside Add.
    assert.equal(allOf(parts[0], "set-scope").length, 1);
    assert.ok(parts[0].textContent.includes("Import from other apps…"), parts[0].textContent);
    assert.ok(read.includes("/api/mcp-servers?scope=all"), read.join("\n"));
    assert.deepEqual(scrolled, ["plg-sec plg-connectors"]);
  });

  test("a Space's or a project's door — its place held, then Settings › MCP servers' address — lands at the connectors part on that place", async () => {
    const hash = routeFor("library", { page: /** @type {any} */ (libraryOf("mcp-servers")).page });
    const { host, read, scrolled } = await libraryAt(hash, (search) => search.holdJump({ section: "mcp-servers", start: "project:w1" }));
    const lib = allOf(host, "library")[0];
    assert.equal(lib.getAttribute("data-page"), "plugins");
    assert.ok(read.includes("/api/mcp-servers?scope=project%3Aw1"), read.join("\n"));
    const picked = allOf(allOf(lib, "plg-connectors")[0], "set-seg-btn").filter((b) => b.classList.contains("on")).map((b) => b.textContent);
    assert.deepEqual(picked, ["northwind ▾"]);
    assert.deepEqual(scrolled, ["plg-sec plg-connectors"]);
  });

  test("opened from its own address it starts at its top: nothing is scrolled", async () => {
    const { host, scrolled } = await libraryAt("#/library/plugins");
    assert.equal(allOf(host, "library")[0].getAttribute("data-page"), "plugins");
    assert.deepEqual(scrolled, []);
  });
});

describe("the left bar", () => {
  test("Plugins & Connectors counts each thing once: the plugins installed, and the connectors that are no plugin's", async () => {
    const { pluginsCount } = await import("../src/ui/harness/sidebar.js");
    const plugins = { plugins: [{ id: "linear@m" }, { id: "guard@m" }] };
    // linear's server comes with its plugin; a switch left for a server that is gone is no connector.
    const servers = { servers: [{ name: "github" }, { name: "linear", plugin: "linear@m" }, { name: "fs" }, { name: "old", orphan: true }] };
    assert.equal(pluginsCount(plugins, servers), 4);
    assert.deepEqual([pluginsCount(null, servers), pluginsCount(plugins, null), pluginsCount({}, {})], [null, null, 0], "a list not read leaves it blank");
  });

  test("one row, Plugins & Connectors, its count drawn with the bar and again when the feed says a connector or a plugin moved; it opens the page `plugins`", async () => {
    const doc = stubDocument();
    const g = /** @type {any} */ (globalThis);
    const had = { EventSource: g.EventSource, fetch: g.fetch, addEventListener: g.addEventListener, removeEventListener: g.removeEventListener, localStorage: g.localStorage };
    const d = /** @type {any} */ (document);
    d.addEventListener = () => {};
    d.removeEventListener = () => {};
    /** The feed's streams the page opened. @type {any[]} */
    const feeds = [];
    g.EventSource = class { constructor() { feeds.push(this); } addEventListener() {} close() {} };
    g.addEventListener = () => {};
    g.removeEventListener = () => {};
    g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    let plugins = [{ id: "linear@m" }, { id: "guard@m" }];
    /** @type {any[]} */
    let servers = [{ name: "github" }, { name: "linear", plugin: "linear@m" }, { name: "fs" }];
    g.fetch = async (/** @type {string} */ url) => ({
      ok: true, status: 200,
      json: async () => (url === "/api/plugins/installed" ? { plugins }
        : url === "/api/mcp-servers?scope=all" ? { servers }
          : { sessions: [], projects: [], runs: [] }),
    });
    try {
      const { createSidebar } = await import("../src/ui/harness/sidebar.js");
      const host = /** @type {any} */ (document.createElement("div"));
      /** @type {string[]} */
      const opened = [];
      const sb = createSidebar(host, { onNew() {}, onSettings() {}, onHide() {}, onSelectChat() {}, onOpen() {}, onChanged() {}, onLibrary: (page) => { opened.push(page); } });
      // The counts are read once the chats are in (the app loads the bar as it starts).
      await sb.load();
      await flush();
      const rows = allOf(host, "lib-row");
      assert.deepEqual(rows.map((r) => allOf(r, "lib-label")[0].textContent), ["Agents", "Skills", "Memory", "Plugins & Connectors", "Artifacts"], "Settings › Experimental's Teams switch off, as it ships");
      const count = () => allOf(rows[3], "lib-count")[0].textContent;
      assert.equal(count(), "4", "two plugins, and github and fs: linear's server comes with its plugin");
      /** What the feed says, heard by the page. @param {any} msg */
      const say = async (msg) => {
        for (const f of feeds) f.onmessage?.({ data: JSON.stringify(msg) });
        await flush();
      };
      // A connector of yours added for all chats saves the config, as the feed says.
      servers = [...servers, { name: "playwright" }];
      await say({ type: "config-changed", version: 2 });
      assert.equal(count(), "5", "drawn again at once, not two minutes later");
      // A plugin uninstalled is no config change: the plugin routes say it.
      plugins = [{ id: "linear@m" }];
      await say({ type: "plugins-changed", id: "guard@m" });
      assert.equal(count(), "4");
      rows[3].dispatch("click");
      assert.deepEqual(opened, ["plugins"]);
    } finally {
      for (const [k, v] of Object.entries(had)) {
        if (v === undefined) delete g[k];
        else g[k] = v;
      }
      doc.restore();
    }
  });
});
