// @ts-check
// A plugin's connectors in your Connectors (the Designer's of 10-26, approved by the owner): a place's list shows the MCP
// servers its plugins on bring, after yours, each marked with its plugin and shown as its plugin writes it; one waiting
// for a value says so, and one of yours that takes its name says which plugin's it keeps out. Test, sign-in, Always
// loaded and a switch work on its row as on an inherited one of yours, and a turn takes the place's picks for it
// (app/sessions/mcp-servers.js, app/plugins.js `serversAt`, `into`).
// (fails before: yes — a plugin's servers were in no list, could not be signed in to, and always loaded on demand)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPlugins } from "../src/app/plugins.js";
import { createPluginPlaces } from "../src/app/plugin-places.js";
import { createMcpServers } from "../src/app/sessions/mcp-servers.js";
import { removeDirs } from "./helpers/wait.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/mcp-server.mjs", import.meta.url));
/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
/** @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-plugin-connectors-${tag}-`));
  made.push(d);
  return d;
};
/** @param {string} path @param {unknown} body */
const put = (path, body) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body, null, 2));
};

/**
 * A plugin, "fixture": a server started from its own folder, given a value it asks for (a token, required and secret),
 * and a remote one that signs in. @param {string} dir
 */
function pluginAt(dir) {
  put(join(dir, ".claude-plugin", "plugin.json"), { name: "fixture", version: "1.0.0", description: "A plugin for tests", userConfig: { token: { type: "string", title: "Token", required: true, sensitive: true } } });
  copyFileSync(FIXTURE, join(dir, "server.mjs"));
  put(join(dir, ".mcp.json"), {
    mcpServers: {
      notes: { command: process.execPath, args: ["${CLAUDE_PLUGIN_ROOT}/server.mjs", "--token", "${user_config.token}"] },
      remote: { type: "http", url: "https://mcp.example.test/mcp" },
    },
  });
}

/** Your defaults, a project "Work" and a chat in it, each layer written as its writer writes; the plugin installed. */
async function setup() {
  /** @type {{ defaults: any, projects: Record<string, any>, chats: Record<string, any> }} */
  const st = { defaults: {}, projects: { p1: {} }, chats: { c1: {} } };
  /** @param {any} layer @param {any} change */
  const apply = (layer, change) => {
    for (const k of change.unset || []) delete layer[k];
    Object.assign(layer, change.patch || {});
  };
  const sessions = {
    patchDefaults: (/** @type {any} */ c) => apply(st.defaults, c),
    patchProjectSettings: (/** @type {string} */ id, /** @type {any} */ c) => apply(st.projects[id], c),
    patchSettings: (/** @type {string} */ id, /** @type {any} */ c) => apply(st.chats[id], c),
    launchInfo: (/** @type {string} */ id) => (st.chats[id] ? { projectId: "p1", cwd: "/w/work" } : null),
  };
  const archive = {
    getProject: (/** @type {string} */ id) => (st.projects[id] ? { id, name: "work-folder", cwd: "/w/work" } : null),
    projectSettings: (/** @type {string} */ id) => st.projects[id],
    chainSettings: (/** @type {string} */ id) => st.chats[id],
    projects: () => Object.keys(st.projects).map((id) => ({ id, name: "work-folder" })),
  };
  const memory = { archive };
  const config = { get: () => ({ sessions: { defaults: st.defaults } }) };
  const folder = fresh("src");
  pluginAt(folder);
  const sources = { entry: (/** @type {string} */ _id, /** @type {string} */ name) => ({ market: { id: "claude/acme", name: "acme", title: "Acme" }, entry: { name, title: name, description: "", version: "", category: "", author: "", homepage: "", source: { kind: /** @type {const} */ ("path"), path: folder } } }) };
  /** @type {any} */
  let servers = null;
  const plugins = createPlugins({ dataDir: fresh("data"), sources, mcpLayers: (w) => servers.layersAt(w) });
  const v = await plugins.install({ from: "claude/acme", name: "fixture" });
  const places = createPluginPlaces({ sessions, memory, config });
  /** @type {any[]} */
  const connects = [];
  /** @type {any[]} */
  const started = [];
  const signIns = /** @type {any} */ ({
    stateOf: () => null,
    start: (/** @type {any} */ o) => { started.push(o); return { id: "s1", page: "https://login.example.test" }; },
  });
  servers = createMcpServers({
    sessions, memory, config, home: "/home/me", signIns,
    connect: /** @type {any} */ (async (/** @type {any} */ spec, /** @type {any} */ o) => { connects.push({ spec, cwd: o?.cwd }); return { tools: [{ tool: "read_note", readOnly: true }], close: async () => {} }; }),
    pluginServers: (p) => plugins.serversAt(places.onAt(p.scope), { project: p.projectId, chat: p.chainId, cwd: p.cwd }),
  });
  return { st, plugins, places, servers, v, connects, started };
}

/** The effective document a turn of the chat reads, as resolveSettings leaves it: the plugin on, your servers. @param {any[]} mcp */
const docWith = (mcp = []) => ({ plugins: { on: [{ id: "fixture@acme", hooks: false }], mcp } });

describe("a plugin's connectors in your Connectors", () => {
  test("listed after yours where the plugin is on, as its plugin writes them; waiting for a value until it is set", async () => {
    const { st, plugins, places, servers } = await setup();
    st.defaults["plugins.mcp"] = [{ name: "github", url: "https://api.example.test/mcp" }];
    assert.deepEqual(servers.list("all").servers.map((/** @type {any} */ r) => r.name), ["github"], "off everywhere: none of its servers");
    places.turn("fixture@acme", { place: "project:p1", on: true });
    assert.deepEqual(servers.list("all").servers.map((/** @type {any} */ r) => r.name), ["github"], "on for Work only: not in the list for all chats");
    // On for Work, its token not set: its rows wait for it.
    let rows = servers.list("project:p1").servers;
    assert.deepEqual(rows.map((/** @type {any} */ r) => [r.name, r.plugin || null, r.waits || null, r.on]), [["github", null, null, true], ["fixture-notes", "fixture@acme", ["Token"], false], ["fixture-remote", "fixture@acme", ["Token"], false]]);
    // Set: its rows are on, shown as the plugin writes them — the token never in them —, nothing of yours to edit.
    plugins.setValues("fixture@acme", "project:p1", { token: "s3cret-token" });
    rows = servers.list("project:p1").servers;
    const notes = rows.find((/** @type {any} */ r) => r.name === "fixture-notes");
    assert.deepEqual([notes.plugin, notes.pluginTitle, notes.from, notes.on, notes.own, notes.load, notes.waits], ["fixture@acme", "fixture", "plugin", true, false, "on-demand", undefined]);
    assert.deepEqual(notes.spec.args, ["${CLAUDE_PLUGIN_ROOT}/server.mjs", "--token", "${user_config.token}"]);
    assert.ok(!JSON.stringify(rows).includes("s3cret-token"), "no value of the plugin's reaches the page");
    assert.equal(rows.find((/** @type {any} */ r) => r.name === "fixture-remote").kind, "http");
  });

  test("one of yours of its name keeps the name, and its row says which plugin's it keeps out", async () => {
    const { st, plugins, places, servers } = await setup();
    places.turn("fixture@acme", { place: "all", on: true });
    plugins.setValues("fixture@acme", "all", { token: "t" });
    st.defaults["plugins.mcp"] = [{ name: "fixture-notes", command: "mine" }];
    const rows = servers.list("all").servers;
    assert.deepEqual(rows.map((/** @type {any} */ r) => [r.name, r.from, r.plugin || null]), [["fixture-notes", "global", null], ["fixture-remote", "plugin", "fixture@acme"]]);
    assert.deepEqual([rows[0].hides, rows[0].own, rows[0].spec.command], [{ plugin: "fixture@acme", title: "fixture" }, true, "mine"]);
    const got = plugins.into(docWith([{ name: "fixture-notes", command: "mine" }]), {});
    assert.deepEqual(got.plugins.mcp.map((/** @type {any} */ m) => [m.name, m.command || m.url]), [["fixture-notes", "mine"], ["fixture-remote", "https://mcp.example.test/mcp"]]);
    assert.ok(got.plugins.notes.includes("fixture's connector notes is left out: one of yours is named fixture-notes"), got.plugins.notes.join("\n"));
  });

  test("Always loaded and a switch on its row are the place's picks, and a turn there takes them", async () => {
    const { st, plugins, places, servers } = await setup();
    places.turn("fixture@acme", { place: "all", on: true });
    plugins.setValues("fixture@acme", "all", { token: "t" });
    // Always loaded for all chats: a pick beside your servers, its row says so.
    const row = servers.put("all", "fixture-notes", { load: "core" }).servers.find((/** @type {any} */ r) => r.name === "fixture-notes");
    assert.deepEqual(st.defaults["plugins.mcp"], [{ name: "fixture-notes", load: "core" }]);
    assert.deepEqual([row.load, row.loadHere, row.plugin], ["core", true, "fixture@acme"]);
    let got = plugins.into(docWith(), { project: "p1", chat: "c1" });
    assert.deepEqual(got.plugins.mcp.map((/** @type {any} */ m) => [m.name, m.load, m.plugin]), [["fixture-notes", "core", "fixture@acme"], ["fixture-remote", "on-demand", "fixture@acme"]]);
    // Switched off for Work: its chats leave it out, said; others still have it.
    servers.put("project:p1", "fixture-remote", { enabled: false });
    assert.deepEqual(st.projects.p1["plugins.mcp"], [{ name: "fixture-remote", enabled: false }]);
    got = plugins.into(docWith(), { project: "p1", chat: "c1" });
    assert.deepEqual(got.plugins.mcp.map((/** @type {any} */ m) => m.name), ["fixture-notes"]);
    assert.ok(got.plugins.notes.includes("fixture's connector remote is switched off here (Library › Plugins & Connectors)"), got.plugins.notes.join("\n"));
    assert.deepEqual(plugins.into(docWith(), {}).plugins.mcp.map((/** @type {any} */ m) => m.name), ["fixture-notes", "fixture-remote"]);
    // Its spec stays the plugin's: Remove refuses where the place holds nothing of it, in words; where it holds a pick,
    // the pick goes and the row is the plugin's as written again.
    assert.throws(() => servers.remove("project:p1", "fixture-notes"), /project work-folder holds no server named fixture-notes/);
    const back = servers.remove("all", "fixture-notes").servers.find((/** @type {any} */ r) => r.name === "fixture-notes");
    assert.deepEqual([back.load, back.plugin, "plugins.mcp" in st.defaults], ["on-demand", "fixture@acme", false]);
  });

  test("Test starts it as the place would, by its name; Sign in reaches its remote one", async () => {
    const { plugins, places, servers, v, connects, started } = await setup();
    places.turn("fixture@acme", { place: "project:p1", on: true });
    plugins.setValues("fixture@acme", "project:p1", { token: "s3cret-token" });
    const r = await servers.test("project:p1", { name: "fixture-notes", plugin: true });
    assert.deepEqual([r.ok, r.words], [true, "1 tool: 1 only read"]);
    assert.deepEqual([connects[0].spec.args, connects[0].cwd], [[`${v.root}/server.mjs`, "--token", "s3cret-token"], "/w/work"]);
    assert.equal(connects[0].spec.env.CLAUDE_PLUGIN_ROOT, v.root);
    // Its row shows that test's dot.
    assert.equal(servers.list("project:p1").servers.find((/** @type {any} */ x) => x.name === "fixture-notes").test.ok, true);
    await assert.rejects(servers.test("all", { name: "fixture-notes", plugin: true }), { status: 404, message: "no plugin's connector named fixture-notes reaches all chats" });
    await servers.signIn("project:p1", "fixture-remote");
    assert.deepEqual([started[0].name, started[0].url, started[0].from], ["fixture-remote", "https://mcp.example.test/mcp", "project:p1"]);
  });
});
