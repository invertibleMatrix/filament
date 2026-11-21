// @ts-check
// A Space of your own passes its connectors and plugins to the projects it shows (the owner's word of 10-26): a shown
// project's Connectors list reads the Space's list between yours for all chats and the project's own, each row from it
// named by the Space; the project switches one off, a chat of it on again; a plugin on for the Space says so on its
// connectors' rows (app/sessions/mcp-servers.js `list`, ui/harness/lib/mcp-list.js). The settings a chat resolves are
// in plugins-on.test.js; the store's `ownAbove` in space-shows.test.js.
// (fails before: yes — a project shown in Work got none of Work's connectors, and its list never named Work)
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createMcpServers } from "../src/app/sessions/mcp-servers.js";
import { chipOf, layerWords, rowLines } from "../src/ui/harness/lib/mcp-list.js";

/** Your defaults; Work (w1), a Space of yours, shows api; other is shown nowhere; a chat c1 in api. */
function setup() {
  /** @type {{ defaults: any, projects: Record<string, any>, chats: Record<string, any> }} */
  const st = { defaults: {}, projects: { w1: {}, api: {}, other: {} }, chats: { c1: {} } };
  /** @param {any} layer @param {any} change */
  const apply = (layer, change) => {
    for (const k of change.unset || []) delete layer[k];
    Object.assign(layer, change.patch || {});
  };
  const sessions = {
    patchDefaults: (/** @type {any} */ c) => apply(st.defaults, c),
    patchProjectSettings: (/** @type {string} */ id, /** @type {any} */ c) => apply(st.projects[id], c),
    patchSettings: (/** @type {string} */ id, /** @type {any} */ c) => apply(st.chats[id], c),
    launchInfo: (/** @type {string} */ id) => (st.chats[id] ? { projectId: "api", cwd: "/w/api" } : null),
  };
  const archive = {
    getProject: (/** @type {string} */ id) => (st.projects[id] ? { id, name: id, cwd: `/w/${id}` } : null),
    projectSettings: (/** @type {string} */ id) => st.projects[id],
    chainSettings: (/** @type {string} */ id) => st.chats[id],
    spaceOf: (/** @type {string} */ id) => (id === "api" ? "w1" : null),
  };
  const config = { get: () => ({ sessions: { defaults: st.defaults } }) };
  /** A plugin on for Work brings linear, on wherever Work reaches. @type {import("../src/app/plugins.js").PluginServer[]} */
  const linear = [{ name: "linear", server: "linear", plugin: "linear@m", title: "Linear", spec: { name: "linear", url: "https://mcp.linear.example/mcp" }, shown: { name: "linear", url: "https://mcp.linear.example/mcp" }, waits: [], only: true, onPlace: "project:w1" }];
  const servers = createMcpServers({
    sessions, memory: { archive }, config, home: "/home/me",
    ownName: (id) => (id === "w1" ? "Work" : null),
    pluginServers: (p) => (p.projectId === "api" || p.projectId === "w1" ? linear : []),
  });
  return { st, servers };
}

/** A list's row by its name. @param {any} list @param {string} name @returns {any} */
const rowIn = (list, name) => list.servers.find((/** @type {any} */ r) => r.name === name);

describe("a Space's connectors in a project it shows", () => {
  test("listed between yours and the project's, named by the Space; a project it does not show has none of them; its own place names no Space above", () => {
    const { st, servers } = setup();
    st.defaults["plugins.mcp"] = [{ name: "github", url: "https://gh.example/mcp" }];
    st.projects.w1["plugins.mcp"] = [{ name: "slack", url: "https://slack.example/mcp" }];
    const api = servers.list("project:api");
    assert.deepEqual(api.space, { id: "w1", name: "Work" });
    assert.deepEqual(api.servers.map((/** @type {any} */ r) => [r.name, r.from, r.on, r.own]), [["github", "global", true, false], ["slack", "space", true, false], ["linear", "plugin", true, false]]);
    const slack = rowIn(api, "slack");
    assert.deepEqual([slack.spaceId, slack.spaceName, chipOf(slack, "project")], ["w1", "Work", { words: "Work", here: false }]);
    const linear = rowIn(api, "linear");
    assert.equal(rowLines(linear, "project", 0)[0].text, "On for Work, this project's Space (Library › Plugins & Connectors)");
    // A chat of api reads it too; a project Work does not show, and Work's own list, name no Space above.
    assert.deepEqual(servers.list("chat:c1").servers.map((/** @type {any} */ r) => r.name), ["github", "slack", "linear"]);
    assert.deepEqual(servers.list("project:other").servers.map((/** @type {any} */ r) => r.name), ["github"]);
    assert.equal(servers.list("project:other").space, undefined);
    const own = servers.list("project:w1");
    assert.deepEqual([own.space, rowIn(own, "slack").from, rowIn(own, "linear").spaceName], [undefined, "project", undefined]);
    // Work's own list says "this Space" of what it holds, where a project's says "this project".
    assert.deepEqual([own.ownSpace, api.ownSpace], [true, undefined]);
    assert.deepEqual([chipOf(rowIn(own, "slack"), "project", "this Space"), chipOf(rowIn(own, "slack"), "project")], [{ words: "this Space", here: true }, { words: "this project", here: true }]);
  });

  test("the project switches Work's connector off, a chat of it on again; a switch that says what beneath says goes", () => {
    const { st, servers } = setup();
    st.projects.w1["plugins.mcp"] = [{ name: "slack", url: "https://slack.example/mcp" }];
    let row = rowIn(servers.put("project:api", "slack", { enabled: false }), "slack");
    assert.deepEqual(st.projects.api["plugins.mcp"], [{ name: "slack", enabled: false }]);
    assert.deepEqual([row.on, row.switchedHere, chipOf(row, "project"), rowLines(row, "project", 0)[0].text], [false, true, { words: "off for this project", here: true }, "On for Work; this project switched it off"]);
    row = rowIn(servers.put("chat:c1", "slack", { enabled: true }), "slack");
    assert.deepEqual([st.chats.c1["plugins.mcp"], row.on, row.switchedHere], [[{ name: "slack", enabled: true }], true, true]);
    servers.put("project:api", "slack", { enabled: true });
    assert.equal(st.projects.api["plugins.mcp"], undefined, "on, as Work has it: the switch goes");
    // A switch Work makes over yours for all chats says Work by its name.
    st.defaults["plugins.mcp"] = [{ name: "github", url: "https://gh.example/mcp" }];
    st.projects.w1["plugins.mcp"] = [{ name: "github", enabled: false }];
    row = rowIn(servers.list("project:api"), "github");
    assert.deepEqual([row.on, rowLines(row, "project", 0)[0].text], [false, "Switched off for Work"]);
  });

  test("a layer's words: the Space by its name, its Space where none is given", () => {
    assert.deepEqual([layerWords("space", { spaceName: "Work" }), layerWords("space"), layerWords("global"), layerWords("project"), layerWords(null)], ["Work", "its Space", "all chats", "this project", ""]);
  });
});
