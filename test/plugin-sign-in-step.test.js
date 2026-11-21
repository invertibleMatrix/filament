// @ts-check
// A plugin installed or turned on at a place goes on to its setup there — a sign-in, a test — instead of its sheet just
// closing (the Designer's of 10-26: the owner installed Linear and Figma for Northwind from Library › Plugins, and nothing
// said a sign-in waited). The sheet's choice (library/plugin-sheet.js `setsUpAt`); Library › Plugins & Connectors opened on the
// place with the setup held for it (settings/mcp-servers.js), whose list opens Add connector's second step once
// (lib/mcp-list.js `finish`, lib/connector-pick.js).
// (fails before: yes — Install for… closed the sheet with a toast, and the Connectors page took no setup to open)
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setsUpAt, installSteps } from "../src/ui/harness/library/plugin-sheet.js";
import { renderMcpServers } from "../src/ui/harness/settings/mcp-servers.js";
import { fakeH, fakeDrawIn, textOf, buttonsOf } from "./helpers/fake-dom.js";

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

describe("which plugins go on to their setup", () => {
  test("one with a server over the web, at all chats, a Space or a project; not one that runs on this computer alone, nor a chat's own", () => {
    const linear = { parts: { servers: [{ name: "linear", remote: true, runs: "https://mcp.linear.app/mcp" }] } };
    const local = { parts: { servers: [{ name: "pw", remote: false, runs: "npx @playwright/mcp" }], skills: ["a"] } };
    const skills = { parts: { skills: ["a"] } };
    assert.deepEqual(["all", "project:w1", "chat:c1"].map((at) => setsUpAt(linear, at)), [true, true, false]);
    assert.deepEqual([setsUpAt(local, "all"), setsUpAt(skills, "all"), setsUpAt(null, "all")], [false, false, false]);
  });
});

describe("Install for…, pressed again after a step failed", () => {
  // (fails before: yes — the bug hunt of 10-30, UIST-6: each press installed it again, which the server refuses as installed (409) once a press got that far, so no later press could reach its values or turn it on)
  test("it is installed once: the next press goes on to its values and turning it on, at the place now picked", async () => {
    /** @type {[string, any][]} */
    const calls = [];
    const installed = new Set();
    let refuse = true;
    const call = async (/** @type {string} */ path, /** @type {any} */ o) => {
      calls.push([path, o?.body]);
      if (path === "/plugins/install") {
        if (installed.has("linear@m")) throw Object.assign(new Error("Linear is installed already: Check for updates brings a newer version."), { status: 409 });
        installed.add("linear@m");
        return { ok: true, plugin: { id: "linear@m" } };
      }
      if (path.endsWith("/values") && refuse) {
        refuse = false;
        throw Object.assign(new Error("PORT is a number"), { status: 400 });
      }
      return { ok: true };
    };
    const press = installSteps({ from: "m", name: "linear", id: "linear@m" }, call);
    await assert.rejects(press("all", () => ({ values: { PORT: "x" }, hooks: false })), /PORT is a number/);
    assert.equal(await press("project:w1", () => ({ values: { PORT: 8 }, hooks: true })), "linear@m");
    assert.deepEqual(calls, [
      ["/plugins/install", { from: "m", name: "linear" }],
      ["/plugins/installed/linear%40m/values", { place: "all", values: { PORT: "x" } }],
      ["/plugins/installed/linear%40m/values", { place: "project:w1", values: { PORT: 8 } }],
      ["/plugins/installed/linear%40m/on", { place: "project:w1", on: true, hooks: true }],
    ]);
    // One press that gets through: installed, then turned on — its values left out where none is given.
    /** @type {[string, any][]} */
    const once = [];
    const first = installSteps({ from: "m", name: "figma", id: "" }, async (path, o) => (once.push([path, o?.body]), path === "/plugins/install" ? { ok: true, plugin: { id: "figma@m" } } : { ok: true }));
    assert.equal(await first("all", () => ({ values: {}, hooks: false })), "figma@m");
    assert.deepEqual(once, [["/plugins/install", { from: "m", name: "figma" }], ["/plugins/installed/figma%40m/on", { place: "all", on: true, hooks: false }]]);
    // An install that failed installed nothing: the next press installs.
    /** @type {string[]} */
    const tries = [];
    let down = true;
    const flaky = installSteps({ from: "m", name: "pw", id: "" }, async (path) => {
      tries.push(path);
      if (path === "/plugins/install" && down) {
        down = false;
        throw new Error("the fetch failed");
      }
      return path === "/plugins/install" ? { ok: true, plugin: { id: "pw@m" } } : { ok: true };
    });
    await assert.rejects(flaky("all", () => ({ values: {}, hooks: false })), /the fetch failed/);
    assert.equal(await flaky("all", () => ({ values: {}, hooks: false })), "pw@m");
    assert.deepEqual(tries, ["/plugins/install", "/plugins/install", "/plugins/installed/pw%40m/on"]);
  });

  test("the sheet's Install for… presses through them, one set of steps for the sheet", () => {
    const sheet = readFileSync("src/ui/harness/library/plugin-sheet.js", "utf8");
    assert.match(sheet, /\n {4}const install = installSteps\(v\);\n {4}go\.addEventListener\("click", async \(\) => \{\n/);
    assert.match(sheet, /\n {8}const pid = await install\(at, \(\) => \(\{ values: values\.read\(\), hooks: !!hooksBox\?\.checked \}\)\);\n/);
  });
});

describe("Library › Plugins & Connectors opened on a plugin's setup", () => {
  /** @param {{ start?: string | null, finish?: any }} cb */
  const mount = async (cb) => {
    /** @type {any[]} */
    const picks = [];
    const api = async (/** @type {string} */ path) =>
      path === "/memory/projects" ? { projects: [{ id: "w1", name: "northwind-folder" }] }
        : path === "/spaces/own" ? { spaces: [{ project: "w1", name: "Northwind", shows: [] }] }
          : { scope: path.includes("project%3Aw1") ? "project:w1" : "all", at: path.includes("project%3Aw1") ? "project" : "global", label: "x", projectId: null, held: false, unread: [], servers: [] };
    const body = /** @type {any} */ (fakeH("div", {}));
    renderMcpServers(body, cb, /** @type {any} */ ({ h: fakeH, api, menu: () => {}, list: { h: fakeH, drawIn: fakeDrawIn, api, pick: (/** @type {any} */ p) => picks.push(p) } }));
    await flush();
    return { body, picks };
  };

  test("on the Space it was turned on for, its setup opens once, as a row's Finish setup… does; going to All chats and back opens nothing more", async () => {
    const { body, picks } = await mount({ start: "project:w1", finish: { plugin: "linear@claude-plugins-official", title: "Linear" } });
    assert.equal(picks.length, 1);
    assert.deepEqual([picks[0].scope, picks[0].finish, picks[0].finishTitle], ["project:w1", "linear@claude-plugins-official", "Linear"]);
    const press = (/** @type {string} */ words) => buttonsOf(body).find((b) => textOf(b) === words)?.dispatch("click");
    press("All chats");
    await flush();
    press("Northwind");
    await flush();
    assert.equal(picks.length, 1, "once");
  });

  test("for all chats, on All chats; with no setup held, none opens", async () => {
    const all = await mount({ finish: { plugin: "linear@m", title: "Linear" } });
    assert.deepEqual(all.picks.map((p) => [p.scope, p.finish]), [["all", "linear@m"]]);
    const none = await mount({ start: "project:w1" });
    assert.equal(none.picks.length, 0);
  });
});
