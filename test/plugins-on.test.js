// @ts-check
// HarnessV4_SpacesPlugins_Plan B3: a plugin turned on at a place. `plugins.on` adds up by id across your defaults, the
// project and the chat (services/session-settings.js); what a plugin on brings joins the chat's settings as each request
// reads them (app/plugins.js `into`): its MCP servers on demand, named after it, its paths and its values for the place
// filled in; its skills, and its commands as skills, each `<plugin>:<name>`, which the loader reads beside yours
// (app/agent/skills.js) — the model loads one with the skill tool, and a message that names `/<plugin>:<name>` has it
// whole. What is left out is said.
// (fails before: yes — an installed plugin reached no chat)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mergePluginsOn, pluginOnProblem, resolveSettings, spaceLayerOf, validateLayer } from "../src/services/session-settings.js";
import { createPlugins, reachOf, serverName } from "../src/app/plugins.js";
import { createPluginPlaces } from "../src/app/plugin-places.js";
import { loadSkills } from "../src/app/agent/skills.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/mcp-server.mjs", import.meta.url));
/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
/** @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-plugins-on-${tag}-`));
  made.push(d);
  return d;
};
/** @param {string} path @param {unknown} body */
const put = (path, body) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body, null, 2));
};

/**
 * A plugin, "fixture": an MCP server started from its own folder that logs what it is given, a value it asks for (a
 * flag, required), a skill and a command. @param {string} dir @param {string} log
 */
function pluginAt(dir, log) {
  put(join(dir, ".claude-plugin", "plugin.json"), { name: "fixture", version: "1.0.0", description: "A plugin for tests", userConfig: { flag: { type: "string", title: "Flag", required: true } } });
  copyFileSync(FIXTURE, join(dir, "server.mjs"));
  put(join(dir, ".mcp.json"), { mcpServers: { notes: { command: process.execPath, args: ["${CLAUDE_PLUGIN_ROOT}/server.mjs"], env: { MCP_FIXTURE_LOG: log, FIXTURE_FLAG: "${user_config.flag}" } } } });
  put(join(dir, "skills", "greet", "SKILL.md"), "---\nname: greet\ndescription: Greet the developer\n---\nSay hello from the plugin.");
  put(join(dir, "commands", "configure.md"), "---\ndescription: Configure the fixture\n---\nAsk which flag to use, then set it.");
}

describe("plugins.on (settings)", () => {
  test("checked as written; the layers add up by id — a narrower one turns one off or switches its hooks, the rest stays", () => {
    assert.equal(pluginOnProblem({ id: "discord@acme" }), null);
    assert.equal(pluginOnProblem({ id: "discord" }), "needs the plugin's id, as name@marketplace");
    assert.equal(pluginOnProblem({ id: "a@b", hooks: "yes" }), "hooks must be true or false");
    assert.deepEqual(validateLayer({ plugins: { on: [{ id: "a@b" }, { id: "a@b", enabled: false }] } }).errors, ['"plugins.on" names the plugin a@b twice']);
    assert.deepEqual(validateLayer({ plugins: { on: [{ id: "a@b", hooks: true }] } }, { at: "project" }).errors, [], "a project may hold it");
    assert.deepEqual(mergePluginsOn([[{ id: "a@m" }, { id: "b@m", hooks: true }], [{ id: "a@m", enabled: false }, { id: "c@m" }], [{ id: "b@m", hooks: false }]]), [{ id: "b@m", hooks: false }, { id: "c@m", hooks: false }]);
    assert.deepEqual(mergePluginsOn([[{ id: "a@m", enabled: false }], [{ id: "a@m", hooks: true }]]), [], "a hooks switch alone does not turn on one a broader layer turned off");
    const r = resolveSettings({ global: { plugins: { on: [{ id: "a@m" }] } }, project: { plugins: { on: [{ id: "b@m", hooks: true }] } }, session: { plugins: { on: [{ id: "a@m", enabled: false }] } } });
    assert.deepEqual(r.effective.plugins.on, [{ id: "b@m", hooks: true }]);
    assert.equal(r.sources["plugins.on"], "session");
    assert.deepEqual(resolveSettings({}).effective.plugins.on, []);
  });

  test("a server's name: the plugin's, or plugin-server, as Filament names servers", () => {
    assert.deepEqual([serverName("linear", "linear"), serverName("discord", "bot"), serverName("My_Plugin", "x"), serverName("9lives", "s"), serverName("filament", "filament"), serverName("a".repeat(40), "b")], ["linear", "discord-bot", "my-plugin-x", "p-9lives-s", "filament-plugin", "a".repeat(32)]);
  });

  test("what a server reaches: its address and headers, or its program, arguments and environment, and its account — never its name", () => {
    const url = reachOf({ name: "a", url: "https://MCP.Linear.app/mcp/", headers: { B: "2", A: "1" } });
    assert.equal(url, reachOf({ name: "b", url: "https://mcp.linear.app/mcp", headers: { A: "1", B: "2" }, load: "core", plugin: "x@m" }));
    assert.notEqual(url, reachOf({ name: "a", url: "https://mcp.linear.app/mcp", headers: { A: "1", B: "3" } }));
    assert.notEqual(url, reachOf({ name: "a", url: "https://mcp.linear.app/mcp/", headers: { B: "2", A: "1" }, account: "Work" }));
    assert.equal(reachOf({ name: "a", command: "npx.cmd", args: ["-y", "x"] }), reachOf({ name: "b", command: "npx", args: ["-y", "x"], env: {} }));
    assert.notEqual(reachOf({ name: "a", command: "npx", args: ["-y", "x"] }), reachOf({ name: "a", command: "npx", args: ["-y", "y"] }));
    assert.deepEqual([reachOf({ name: "a", enabled: false }), reachOf(null), reachOf("x")], [null, null, null], "a switch, a pick: no server");
  });
});

describe("where a plugin is on (places)", () => {
  /** Your defaults, a project "Work" (a Space of yours) and a chat in it, each layer written as its writer writes. */
  function fakes() {
    /** @type {{ defaults: any, projects: Record<string, any>, chats: Record<string, any>, via: string[] }} */
    const st = { defaults: {}, projects: { p1: {} }, chats: { c1: {} }, via: [] };
    /** @param {any} layer @param {any} change */
    const apply = (layer, change) => {
      for (const k of change.unset || []) delete layer[k];
      Object.assign(layer, change.patch || {});
    };
    const sessions = {
      patchDefaults: (/** @type {any} */ c) => apply(st.defaults, c),
      patchProjectSettings: (/** @type {string} */ id, /** @type {any} */ c) => apply(st.projects[id], c),
      patchSettings: (/** @type {string} */ id, /** @type {any} */ c, /** @type {any} */ o) => { st.via.push(o?.via); apply(st.chats[id], c); },
      launchInfo: (/** @type {string} */ id) => (st.chats[id] ? { projectId: "p1" } : null),
    };
    const archive = {
      getProject: (/** @type {string} */ id) => (st.projects[id] ? { id, name: "work-folder", cwd: "/w/work" } : null),
      projectSettings: (/** @type {string} */ id) => st.projects[id],
      chainSettings: (/** @type {string} */ id) => st.chats[id],
      projects: () => Object.keys(st.projects).map((id) => ({ id, name: "work-folder" })),
    };
    const places = createPluginPlaces({ sessions, memory: { archive }, config: { get: () => ({ sessions: { defaults: st.defaults } }) }, ownName: (id) => (id === "p1" ? "Work" : null) });
    return { st, places };
  }

  // (fails before: a project shown in a Space of yours got nothing of the Space's — Linear on for Work reached only the
  // chats started in Work; and a chat turning on what its project turned off stayed off)
  test("a Space of your own passes its plugins and connectors to the projects it shows; a project turns one off, a chat of it on again; the Space's other settings stay its own", () => {
    /** Work, a Space of yours (p1), shows the project api; a chat c2 in api. */
    const st = { defaults: /** @type {any} */ ({}), projects: /** @type {Record<string, any>} */ ({ p1: {}, api: {}, other: {} }), chats: /** @type {Record<string, any>} */ ({ c2: {} }) };
    const apply = (/** @type {any} */ layer, /** @type {any} */ change) => {
      for (const k of change.unset || []) delete layer[k];
      Object.assign(layer, change.patch || {});
    };
    const sessions = {
      patchDefaults: (/** @type {any} */ c) => apply(st.defaults, c),
      patchProjectSettings: (/** @type {string} */ id, /** @type {any} */ c) => apply(st.projects[id], c),
      patchSettings: (/** @type {string} */ id, /** @type {any} */ c) => apply(st.chats[id], c),
      launchInfo: (/** @type {string} */ id) => (st.chats[id] ? { projectId: "api" } : null),
    };
    const archive = {
      getProject: (/** @type {string} */ id) => (st.projects[id] ? { id, name: id, cwd: `/w/${id}` } : null),
      projectSettings: (/** @type {string} */ id) => st.projects[id],
      chainSettings: (/** @type {string} */ id) => st.chats[id],
      projects: () => Object.keys(st.projects).map((id) => ({ id, name: id })),
      spaceOf: (/** @type {string} */ id) => (id === "api" ? "p1" : null),
    };
    const places = createPluginPlaces({ sessions, memory: { archive }, config: { get: () => ({ sessions: { defaults: st.defaults } }) }, ownName: (id) => (id === "p1" ? "Work" : null) });
    places.turn("linear@m", { place: "project:p1", on: true });
    assert.deepEqual(places.at("linear@m", "project:api"), { place: "project:api", label: "api", on: true, hooks: false, here: false }, "on in the project Work shows");
    assert.deepEqual(places.at("linear@m", "chat:c2"), { place: "chat:c2", label: "this chat", on: true, hooks: false, here: false });
    assert.equal(places.placeOn("linear@m", "chat:c2"), "project:p1", "its values are Work's");
    assert.equal(places.at("linear@m", "project:other").on, false, "a project Work does not show gets nothing of it");
    // Off for api; a chat of api turns it on again — an entry that says so, since one that only names it keeps the off.
    places.turn("linear@m", { place: "project:api", on: false });
    assert.deepEqual(st.projects.api["plugins.on"], [{ id: "linear@m", enabled: false }]);
    assert.equal(places.at("linear@m", "chat:c2").on, false);
    places.turn("linear@m", { place: "chat:c2", on: true });
    assert.deepEqual(st.chats.c2["plugins.on"], [{ id: "linear@m", enabled: true }]);
    assert.equal(places.at("linear@m", "chat:c2").on, true);
    // The chat's settings, resolved with the Space between your defaults and the project: its plugins and connectors,
    // nothing else of it.
    st.projects.p1["plugins.mcp"] = [{ name: "slack", url: "https://slack.example/mcp" }];
    st.projects.p1["loop.addedFolders"] = ["/w/p1-files"];
    const resolved = resolveSettings({ global: {}, space: spaceLayerOf(archive, "api"), project: st.projects.api, session: st.chats.c2 });
    assert.deepEqual(resolved.effective.plugins.on, [{ id: "linear@m", hooks: false }]);
    assert.deepEqual(resolved.effective.plugins.mcp.map((/** @type {any} */ m) => m.name), ["slack"]);
    assert.equal(resolved.sources["plugins.mcp"], "project", "what the Space names counts as the project's");
    assert.deepEqual(resolved.effective.loop.addedFolders ?? [], [], "the Space's folders stay its own chats'");
    st.projects.api["plugins.mcp"] = [{ name: "slack", enabled: false }];
    assert.deepEqual(resolveSettings({ space: spaceLayerOf(archive, "api"), project: st.projects.api }).effective.plugins.mcp, [], "the project switches the Space's connector off");
    assert.deepEqual([spaceLayerOf(archive, "other"), spaceLayerOf(archive, null), spaceLayerOf(null, "api")], [{}, {}, {}]);
  });

  test("turned on or off at a place, its own entry is only what differs from beneath; hooks a switch of their own", () => {
    const { st, places } = fakes();
    assert.deepEqual(places.turn("a@m", { place: "all", on: true }), { place: "all", label: "all chats", on: true, hooks: false, here: true });
    assert.deepEqual(st.defaults["plugins.on"], [{ id: "a@m" }]);
    // Off for the Space: it says so; its chats follow.
    assert.deepEqual(places.turn("a@m", { place: "project:p1", on: false }), { place: "project:p1", label: "Work", on: false, hooks: false, here: true });
    assert.deepEqual(st.projects.p1["plugins.on"], [{ id: "a@m", enabled: false }]);
    assert.equal(places.at("a@m", "chat:c1").on, false);
    // On again there: on beneath already, so the Space's entry goes and the layer inherits.
    assert.deepEqual(places.turn("a@m", { place: "project:p1", on: true }), { place: "project:p1", label: "Work", on: true, hooks: false, here: false });
    assert.equal("plugins.on" in st.projects.p1, false);
    // Its hooks run in the Space, stopped in one chat of it.
    places.turn("a@m", { place: "project:p1", on: true, hooks: true });
    assert.deepEqual(st.projects.p1["plugins.on"], [{ id: "a@m", hooks: true }]);
    assert.deepEqual(places.turn("a@m", { place: "chat:c1", on: true, hooks: false }), { place: "chat:c1", label: "this chat", on: true, hooks: false, here: true });
    assert.deepEqual([st.chats.c1["plugins.on"], st.via], [[{ id: "a@m", hooks: false }], ["Plugins"]]);
    // Off where it was never on: nothing to write.
    places.turn("b@m", { place: "project:p1", on: false });
    assert.deepEqual(st.projects.p1["plugins.on"], [{ id: "a@m", hooks: true }]);
    assert.deepEqual(places.everywhere(), { "a@m": [{ place: "all", label: "all chats", on: true, hooks: false }, { place: "project:p1", label: "Work", on: true, hooks: true }] });
    // Refused in words.
    assert.throws(() => places.turn("a@m", { place: "everywhere", on: true }), { status: 400, message: "say the place: all, project:<id> or chat:<id>" });
    assert.throws(() => places.turn("a@m", { place: "project:nope", on: true }), { status: 404, message: "There is no such project." });
    assert.throws(() => places.turn("a@m", { place: "chat:nope", on: true }), { status: 404, message: "There is no such chat." });
    assert.throws(() => places.turn("a@m", { place: "all", on: "yes" }), { status: 400, message: "say on: true or false" });
    // Uninstalled: off your defaults and every project; a chat's own switch stays the chat's.
    places.forget("a@m");
    assert.deepEqual(["plugins.on" in st.defaults, "plugins.on" in st.projects.p1], [false, false]);
    assert.deepEqual(places.everywhere(), {});
  });
});

describe("what a plugin on brings (app)", () => {
  test("its servers on demand with its paths and the place's values filled; its skills and commands; what is left out said", async () => {
    const dataDir = fresh("data");
    const folder = fresh("src");
    const log = join(folder, "fixture.log");
    pluginAt(folder, log);
    /** @type {Record<string, any>} */
    const listed = { fixture: { source: { kind: "path", path: folder } } };
    const sources = { entry: (/** @type {string} */ _id, /** @type {string} */ name) => ({ market: { id: "claude/acme", name: "acme", title: "Acme" }, entry: { name, title: name, description: "", version: "", category: "", author: "", homepage: "", ...listed[name] } }) };
    const p = createPlugins({ dataDir, sources });
    const v = await p.install({ from: "claude/acme", name: "fixture" });
    const doc = { plugins: { on: [{ id: "fixture@acme", hooks: false }, { id: "gone@acme", hooks: false }], mcp: [{ name: "mine", command: "x" }] }, skills: { enabled: false, folders: [] } };
    // Its required value is missing: its servers wait, said; its skills and commands come.
    let got = p.into(doc, { project: "p1", chat: "c1", cwd: "/w/app" });
    assert.deepEqual(got.plugins.mcp.map((/** @type {any} */ m) => m.name), ["mine"]);
    assert.deepEqual(got.plugins.notes, ["fixture's connectors wait for Flag: set it on its sheet in Library › Plugins & Connectors", "the plugin gone@acme is on here but not installed: it brings nothing"]);
    assert.deepEqual(got.skills.plugins.map((/** @type {any} */ s) => [s.plugin, s.kind, s.path]), [["fixture", "skill", join(v.root, "skills", "greet", "SKILL.md")], ["fixture", "command", join(v.root, "commands", "configure.md")]]);
    assert.equal(doc.plugins.mcp.length, 1, "the document given is left as it was");
    // Its values: your defaults', then the project's over them, then the chat's.
    p.setValues("fixture@acme", "all", { flag: "everywhere" });
    p.setValues("fixture@acme", "project:p1", { flag: "in-p1" });
    got = p.into(doc, { project: "p1", chat: "c1", cwd: "/w/app" });
    const s = got.plugins.mcp.find((/** @type {any} */ m) => m.name === "fixture-notes");
    assert.deepEqual([s.command, s.args, s.load, s.plugin], [process.execPath, [`${v.root}/server.mjs`], "on-demand", "fixture@acme"], "filled in as written");
    assert.equal(s.env.FIXTURE_FLAG, "in-p1");
    assert.deepEqual([s.env.CLAUDE_PLUGIN_ROOT, s.env.CLAUDE_PLUGIN_DATA, s.env.CLAUDE_PROJECT_DIR, s.env.CLAUDE_PLUGIN_OPTION_FLAG], [v.root, v.data, "/w/app", "in-p1"]);
    assert.equal(p.into(doc, { project: "p2" }).plugins.mcp[1].env.FIXTURE_FLAG, "everywhere");
    p.setValues("fixture@acme", "chat:c1", { flag: "this-chat" });
    assert.equal(p.into(doc, { project: "p1", chat: "c1" }).plugins.mcp[1].env.FIXTURE_FLAG, "this-chat");
    // One of yours of its name keeps the name.
    const clash = p.into({ ...doc, plugins: { ...doc.plugins, mcp: [{ name: "fixture-notes", command: "mine" }] } }, {});
    assert.deepEqual(clash.plugins.mcp.map((/** @type {any} */ m) => m.command), ["mine"]);
    assert.ok(clash.plugins.notes.includes("fixture's connector notes is left out: one of yours is named fixture-notes"), clash.plugins.notes.join("\n"));
    // The plugin's line for the prompt: its name, words and the connector the agent reaches for it.
    got = p.into(doc, { project: "p1", chat: "c1", cwd: "/w/app" });
    assert.deepEqual(got.skills.pluginsOn, [{ name: "fixture", title: "fixture", description: "A plugin for tests", servers: ["fixture-notes"] }]);
    // (fails before: one of yours reaching the same program, under another name, ran beside it — every tool twice)
    // One of yours that reaches the same — its program, arguments and environment — keeps it: the plugin's is left out,
    // and its line names yours.
    const theirs = got.plugins.mcp.find((/** @type {any} */ m) => m.name === "fixture-notes");
    const { name: _n, plugin: _p, load: _l, ...same } = theirs;
    const twice = p.into({ ...doc, plugins: { ...doc.plugins, mcp: [{ name: "my-notes", ...same }] } }, { project: "p1", chat: "c1", cwd: "/w/app" });
    assert.deepEqual(twice.plugins.mcp.map((/** @type {any} */ m) => m.name), ["my-notes"]);
    assert.ok(twice.plugins.notes.includes("fixture's connector notes is left out: my-notes here reaches the same"), twice.plugins.notes.join("\n"));
    assert.deepEqual(twice.skills.pluginsOn[0].servers, ["my-notes"]);
    // Another environment — another account's token — is another connection: both run.
    const other = p.into({ ...doc, plugins: { ...doc.plugins, mcp: [{ name: "my-notes", ...same, env: { ...same.env, FIXTURE_FLAG: "mine" } }] } }, { project: "p1", chat: "c1", cwd: "/w/app" });
    assert.deepEqual(other.plugins.mcp.map((/** @type {any} */ m) => m.name), ["my-notes", "fixture-notes"]);
    // None on: the document as it was.
    const none = { plugins: { on: [] } };
    assert.equal(p.into(none, {}), none);
  });

  test("the loader reads a plugin's skills and commands beside yours, each <plugin>:<name>, yours off or on", () => {
    const root = fresh("skills");
    put(join(root, "mine", "deploy", "SKILL.md"), "---\nname: deploy\ndescription: Ship it\n---\nRun the release.");
    put(join(root, "plug", "skills", "greet", "SKILL.md"), "---\nname: greet\ndescription: Greet\n---\nHello.");
    put(join(root, "plug", "commands", "configure.md"), "---\ndescription: Configure it\n---\nAsk, then set.");
    const plugins = [{ plugin: "fixture", kind: "skill", path: join(root, "plug", "skills", "greet", "SKILL.md") }, { plugin: "fixture", kind: "command", path: join(root, "plug", "commands", "configure.md") }];
    const off = loadSkills({ skills: { plugins } });
    assert.deepEqual(off.skills.map((k) => [k.name, k.description, k.triggers]), [["fixture:greet", "Greet", []], ["fixture:configure", "Configure it", []]]);
    const on = loadSkills({ skills: { yours: [{ name: "deploy", path: join(root, "mine", "deploy", "SKILL.md") }], plugins } });
    assert.deepEqual(on.skills.map((k) => k.name), ["deploy", "fixture:greet", "fixture:configure"]);
  });
});

describe("through a turn", () => {
  test("a plugin on for a chat: its server runs with the chat's value, its skills are listed and load, a command a message names rides whole", async (t) => {
    const home = fresh("home");
    const market = join(home, ".claude", "plugins", "marketplaces", "acme");
    const log = join(home, "fixture.log");
    put(join(home, ".claude", "plugins", "known_marketplaces.json"), { acme: { source: { source: "github", repo: "acme/plugins" }, installLocation: market } });
    put(join(market, ".claude-plugin", "marketplace.json"), { name: "acme", plugins: [{ name: "fixture", source: "./plugins/fixture" }] });
    pluginAt(join(market, "plugins", "fixture"), log);
    const root = fresh("work");
    const was = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME };
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    t.after(() => {
      for (const [k, v] of Object.entries(was)) if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
    /** @type {any[]} */
    const seen = [];
    const up = await fakeUpstream(async (/** @type {any} */ call) => {
      if (!(call.body?.tools || []).length) return anthropicReply("A title", { model: "brain-model" });
      seen.push(call.body);
      const last = call.body.messages.at(-1);
      const results = Array.isArray(last?.content) ? last.content.filter((/** @type {any} */ c) => c.type === "tool_result") : [];
      // The plugin first, by its name — its index —, then the skill it lists.
      if (seen.length === 1) return anthropicReply("", { model: "brain-model", stop: "tool_use", blocks: [{ type: "tool_use", id: "k0", name: "skill", input: { name: "fixture" } }] });
      if (seen.length === 2) return anthropicReply("", { model: "brain-model", stop: "tool_use", blocks: [{ type: "tool_use", id: "k1", name: "skill", input: { name: "fixture:greet" } }] });
      return anthropicReply(results.length ? "Greeted." : "Configured.", { model: "brain-model" });
    });
    t.after(() => up.close());
    const shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
    t.after(() => shim.stop());
    const ins = await shim.api("/api/plugins/install", { method: "POST", body: { from: "claude/acme", name: "fixture" } });
    assert.equal(ins.status, 200, await ins.clone().text());
    const created = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { plugins: { on: [{ id: "fixture@acme" }] } } } })).json();
    const id = encodeURIComponent("fixture@acme");
    assert.equal((await shim.api(`/api/plugins/installed/${id}/values`, { method: "POST", body: { place: "all", values: { flag: "for-all" } } })).status, 200);
    assert.equal((await shim.api(`/api/plugins/installed/${id}/values`, { method: "POST", body: { place: `chat:${created.id}`, values: { flag: "for-this-chat" } } })).status, 200);
    // The Start board, before a chat: its server says the plugin it came with; its skills are counted.
    const board = await (await shim.api("/api/sessions/draft-start", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { plugins: { on: [{ id: "fixture@acme" }] } } } })).json();
    assert.deepEqual([board.tools?.mcp, board.tools?.mcpFrom], [["fixture-notes"], { "fixture-notes": "fixture@acme" }], JSON.stringify(board.tools));
    // (fails before: yes — Hunter's find: the list did not say a skill was a plugin's, so the board gave it a switch whose
    // off the server refuses)
    const fromPlugin = board.skills.list.filter((/** @type {any} */ s) => s.plugin);
    assert.ok(fromPlugin.length > 0 && fromPlugin.every((/** @type {any} */ s) => s.plugin === "fixture" && s.name.startsWith("fixture:")), JSON.stringify(board.skills.list));
    // `asIs`: the card's Send it as it is, the answer where what the chat sends ahead changed (the owner's of 11-06).
    const turn = async (/** @type {string} */ content, asIs = false) => {
      const r = await shim.api(`/api/sessions/${encodeURIComponent(created.id)}/turns`, { method: "POST", body: { content, stream: false, ...(asIs ? { sendAsIs: true } : {}) } });
      assert.equal(r.status, 200, await r.clone().text());
      return { rid: String(r.headers.get("x-filament-request-id")), body: await r.json() };
    };
    const one = await turn("say hello");
    const first = seen[0];
    const system = (/** @type {any} */ b) => (Array.isArray(b.system) ? b.system.map((x) => x.text).join("") : String(b.system || ""));
    // (fails before: each of its skills and commands rode the prompt in a line of its own)
    assert.match(system(first), /# Plugins\n.*\n- fixture — A plugin for tests \(1 skill, 1 command; connector fixture-notes\)/s);
    assert.ok(!system(first).includes("fixture:greet") && !system(first).includes("# Skills"), "the plugin's skills are not listed until it is loaded");
    const names = first.tools.map((/** @type {any} */ x) => x.name);
    assert.ok(names.includes("skill") && names.includes("mcp"), names.join(", "));
    assert.ok(!names.some((/** @type {string} */ n) => n.startsWith("mcp__")), "on demand: its server's tools ride by name only");
    assert.match(system(first), /\n- fixture-notes: 6 tools/, "its server named in the prompt's MCP line, with how many tools it has");
    const resultOf = (/** @type {any} */ body, /** @type {string} */ id) => {
      const c = body.messages.at(-1).content.find((/** @type {any} */ x) => x.tool_use_id === id);
      return typeof c.content === "string" ? c.content : c.content.map((/** @type {any} */ x) => x.text).join("");
    };
    // The skill tool loaded the plugin by its name: its skills and commands, each with what it is for, and its connector.
    assert.equal(
      resultOf(seen[1], "k0"),
      [
        "Plugin: fixture — A plugin for tests",
        "",
        "Its skills — load the one whose description fits with this tool, by its full name, before you start that work:",
        "- fixture:greet — Greet the developer",
        "",
        "Its commands — procedures the developer may also type as /<name>; load one the same way:",
        "- fixture:configure — Configure the fixture",
        "",
        "Its connector, MCP server of this session: fixture-notes. The mcp tool lists its tools (find, with server), loads one and calls it.",
      ].join("\n"),
    );
    // Then the skill it listed.
    assert.match(resultOf(seen[2], "k1"), /^Skill: fixture:greet — Greet the developer\n.*Say hello from the plugin\.$/s);
    assert.deepEqual([seen[2].tools, system(seen[2])], [first.tools, system(first)], "loading moved nothing the provider caches");
    // Its server ran from Filament's copy, with this chat's value.
    await until(() => existsSync(log), "the plugin's server started");
    const runs = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(runs.find((r) => r.method === "initialize")?.env, "for-this-chat");
    const rec = await shim.record(one.rid);
    assert.ok(!(rec.changes || []).some((/** @type {string} */ c) => /^agent: plugins — /.test(c)), (rec.changes || []).join("\n"));
    // A command the message names rides whole, on that message (the owner's of 11-07): the system prompt holds.
    await turn("/fixture:configure please");
    const called = seen.at(-1).messages.at(-1).content.filter((/** @type {any} */ b) => b?.type === "text" && String(b.text).startsWith('<filament-context kind="skill">'));
    assert.equal(called.length, 1, JSON.stringify(seen.at(-1).messages.at(-1)));
    assert.match(called[0].text, /^<filament-context kind="skill">\nThe person called \$fixture:configure[\s\S]*Ask which flag to use, then set it\.\n<\/filament-context>$/);
    assert.equal(system(seen.at(-1)), system(first), "the system prompt holds");
    // Off for this chat: nothing of it.
    assert.equal((await shim.api(`/api/sessions/${encodeURIComponent(created.id)}/settings`, { method: "PATCH", body: { patch: { plugins: { on: [{ id: "fixture@acme", enabled: false }] } } } })).status, 200);
    await turn("again", true);
    assert.doesNotMatch(system(seen.at(-1)), /fixture/);
  });
});
