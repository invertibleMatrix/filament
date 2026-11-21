// @ts-check
// E49, the setting half: how an MCP server's tools reach Filament's own agent — `core`, every tool in full with every
// request, or `on-demand`, the default, each by its name until the agent loads it (the owner's word of 10-26: "we don't
// wanna bloat the context anymore"). A server says it on its entry; a narrower layer sets it for an inherited server
// with `{ name, load }` beside its switch and its account, as it picks the account; the admin rows show it and set it
// with `{ load }`; an edit that says none keeps it; a coding agent, which loads its servers its own way, is never given
// it and its session does not open again for it. The loop half is in mcp-on-demand.test.js.
// (fails before: yes — a server had no load: every tool rode every request in full)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOADS, isPick, loadOf, mergeServers, serversOn, withLoad } from "../src/services/mcp-servers.js";
import { mcpEntryProblem, mcpServerProblem } from "../src/services/session-settings.js";
import { chatKeyOf, serversFor } from "../src/adapters/agents/chat-servers.js";
import { createConfigStore } from "../src/services/config/store.js";
import { MemoryService } from "../src/services/memory/index.js";
import { sidecar } from "../src/adapters/sidecar/index.js";
import { createSessions } from "../src/app/sessions/service.js";
import { createMcpServers } from "../src/app/sessions/mcp-servers.js";
import { mcpServerRoutes } from "../src/http/admin/mcp-servers.js";
import { createRouter } from "../src/http/router.js";

const github = { name: "github", command: "npx", args: ["-y", "gh-mcp"], env: { LOG_LEVEL: "info" } };
const linear = { name: "linear", url: "https://mcp.linear.app/mcp" };

describe("the pure parts", () => {
  test("a server's load is core or on-demand — on demand where it says none; anything else is refused in words", () => {
    assert.deepEqual(LOADS, ["core", "on-demand"]);
    assert.deepEqual([loadOf(github), loadOf({ ...github, load: "core" }), loadOf({ ...github, load: "on-demand" }), loadOf(null)], ["on-demand", "core", "on-demand", "on-demand"]);
    assert.equal(mcpServerProblem({ ...github, load: "core" }), null);
    assert.equal(mcpServerProblem({ ...linear, load: "on-demand" }), null);
    assert.match(String(mcpServerProblem({ ...github, load: "lazy" })), /^load must be "core" or "on-demand"/);
    assert.match(String(mcpServerProblem({ ...github, load: true })), /^load must be/);
  });

  test("a pick may carry load, beside a switch and an account, on a server of any kind; merged, the narrowest layer's load holds", () => {
    assert.deepEqual(
      [isPick({ name: "github", load: "core" }), isPick({ name: "github", load: "core", enabled: false, account: "work" }), isPick({ name: "github", load: 1 }), isPick({ name: "github", load: "core", command: "x" })],
      [true, true, false, false],
    );
    assert.equal(mcpEntryProblem({ name: "github", load: "core" }), null, "a program run on this computer takes a load: it has nothing to do with signing in");
    assert.match(String(mcpEntryProblem({ name: "github", load: "eager" })), /^load must be/);
    assert.deepEqual(withLoad({ ...github, load: "core" }, "on-demand"), { ...github, load: "on-demand" }, "said whole: the one beneath said core");
    const merged = mergeServers([{ at: "global", list: [{ ...github, load: "core" }, linear] }, { at: "project", list: [{ name: "github", load: "on-demand" }, { name: "linear", load: "core", account: "work" }] }]);
    assert.deepEqual(merged.map((s) => [s.name, loadOf(s.spec), s.loadAt, s.pickedAt]), [["github", "on-demand", "project", null], ["linear", "core", "project", "project"]]);
    const chat = mergeServers([{ at: "global", list: [github] }, { at: "session", list: [{ name: "github", load: "core", enabled: false }] }]);
    assert.deepEqual([loadOf(chat[0].spec), chat[0].on, chat[0].loadAt], ["core", false, "session"]);
    assert.deepEqual(serversOn(mergeServers([{ at: "global", list: [github] }, { at: "project", list: [{ name: "github", load: "core" }] }])), [{ ...github, load: "core" }], "the chat runs the server with its load");
  });

  test("a coding agent is never given load, and its session does not open again when only a server's load changed", () => {
    const given = serversFor({}, [{ ...github, load: "core" }], { title: "Claude", http: true, cwd: false });
    assert.equal(JSON.stringify(given.servers).includes("load"), false);
    assert.equal(chatKeyOf([{ ...github, load: "core" }]), chatKeyOf([github]));
    assert.equal(chatKeyOf([{ ...github, load: "on-demand" }]), chatKeyOf([github]));
    assert.notEqual(chatKeyOf([{ ...github, args: ["-y", "gh-mcp@2"] }]), chatKeyOf([github]), "any other change still opens it again");
  });
});

describe("one place's servers' load, through the admin rows", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-mcp-load-"));
  const folder = mkdtempSync(join(dir, "project-"));
  let clock = 1_758_000_000_000;
  const now = () => (clock += 1000);
  const config = createConfigStore({ dataDir: dir });
  config.set({ ...config.get(), memory: { ...config.get().memory, enabled: true } });
  const memory = new MemoryService(/** @type {any} */ ({ sidecar, getConfig: config.get, dataDir: dir, log: () => {}, selfBase: () => "http://127.0.0.1:20399", getModelNames: () => ["cheap"], now }));
  memory.start();
  const archive = /** @type {any} */ (memory.archive);
  const record = { record: () => {}, list: () => [] };
  const sessions = createSessions(/** @type {any} */ ({ memory, config, pipeline: { handle() {} }, ops: record, log: () => {}, forkSession: async () => ({}), mcpTests: new Map() }));
  const connect = async () => /** @type {any} */ ({ tools: [], close: async () => {} });
  const mcpServers = createMcpServers({ sessions, memory, config, tests: new Map(), connect, now, home: dir });
  const a = { memory, sessions, mcpServers, config, ops: record };
  const route = createRouter([...mcpServerRoutes(/** @type {any} */ (a))]);
  /** @param {string} method @param {string} path @param {any} [body] */
  const call = async (method, path, body = undefined) => {
    const url = new URL(`http://x${path}`);
    const m = route(method, url.pathname);
    assert.ok(m, `${method} ${path} has a row`);
    let out = "";
    let status = 0;
    const res = /** @type {any} */ ({
      headersSent: false,
      writableEnded: false,
      setHeader() {},
      getHeader() {},
      writeHead(/** @type {number} */ s) { status = s; this.headersSent = true; return this; },
      write(/** @type {string} */ c) { out += c; },
      end(/** @type {string} */ c = "") { out += c; this.writableEnded = true; },
      on() {},
    });
    const req = { headers: { "x-api-key": "k" }, method, socket: { remoteAddress: "127.0.0.1" }, on() {} };
    await m.handler({ req, res, url, path: url.pathname, method, params: m.params, json: async () => body }, a);
    return { status, body: out ? JSON.parse(out) : null };
  };
  const enc = encodeURIComponent;
  const chat = sessions.create({ cwd: folder, model: "cheap" });
  const projectScope = `project:${chat.projectId}`;
  const chatScope = `chat:${chat.id}`;
  /** A place's row of a server. @param {any} r @param {string} name */
  const rowOf = (r, name) => r.body.servers.find((/** @type {any} */ s) => s.name === name);
  /** What the chat runs of a server. @param {string} name */
  const ran = (name) => sessions.settingsOf(chat.id).effective.plugins.mcp.find((/** @type {any} */ s) => s.name === name);

  after(async () => {
    await memory.shutdown();
    for (let i = 0; i < 10; i++) {
      try {
        rmSync(dir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  });

  test("your own server: on demand at first; { load } sets core on its entry and on demand takes the field away; an edit that says none keeps it", async () => {
    let r = await call("PUT", "/mcp-servers/all/github", github);
    assert.deepEqual([rowOf(r, "github").load, rowOf(r, "github").loadHere], ["on-demand", false]);
    r = await call("PUT", "/mcp-servers/all/github", { load: "core" });
    assert.equal(r.status, 200);
    assert.deepEqual(config.get().sessions.defaults.plugins.mcp[0], { ...github, load: "core" });
    assert.equal(rowOf(r, "github").load, "core");
    r = await call("PUT", "/mcp-servers/all/github", { command: "npx", args: ["-y", "gh-mcp@2"], env: { LOG_LEVEL: "info" } });
    assert.deepEqual([config.get().sessions.defaults.plugins.mcp[0].load, config.get().sessions.defaults.plugins.mcp[0].args], ["core", ["-y", "gh-mcp@2"]], "an editor that knows no load changes none");
    r = await call("PUT", "/mcp-servers/all/github", { command: "npx", args: ["-y", "gh-mcp"], env: { LOG_LEVEL: "info" }, load: "on-demand" });
    assert.equal("load" in config.get().sessions.defaults.plugins.mcp[0], false, "on demand is the default: no field says it");
    r = await call("PUT", "/mcp-servers/all/github", { load: "core" });
    assert.equal(ran("github").load, "core", "the chat runs it as it is set");
  });

  test("an inherited server: a project sets it apart from all chats, a chat apart from its project; the pick goes where it says what beneath says", async () => {
    let r = await call("PUT", `/mcp-servers/${enc(projectScope)}/github`, { load: "on-demand" });
    assert.deepEqual([rowOf(r, "github").load, rowOf(r, "github").loadHere, rowOf(r, "github").own], ["on-demand", true, false]);
    assert.deepEqual(archive.projectSettings(chat.projectId).plugins.mcp, [{ name: "github", load: "on-demand" }]);
    assert.equal(ran("github").load, "on-demand");
    r = await call("PUT", `/mcp-servers/${enc(chatScope)}/github`, { enabled: false });
    r = await call("PUT", `/mcp-servers/${enc(chatScope)}/github`, { load: "core" });
    assert.deepEqual(archive.chainSettings(chat.id).plugins.mcp, [{ name: "github", enabled: false, load: "core" }], "beside its switch");
    r = await call("PUT", `/mcp-servers/${enc(chatScope)}/github`, { enabled: true });
    assert.deepEqual(archive.chainSettings(chat.id).plugins.mcp, [{ name: "github", load: "core" }], "the switch goes, the load stays");
    assert.deepEqual([ran("github").load, rowOf(await call("GET", `/mcp-servers?scope=${enc(chatScope)}`), "github").loadHere], ["core", true]);
    r = await call("PUT", `/mcp-servers/${enc(chatScope)}/github`, { load: "on-demand" });
    assert.equal((archive.chainSettings(chat.id)?.plugins?.mcp || []).some((/** @type {any} */ e) => e.name === "github"), false, "what its project says: nothing kept");
    r = await call("PUT", `/mcp-servers/${enc(projectScope)}/github`, { load: "core" });
    assert.equal((archive.projectSettings(chat.projectId)?.plugins?.mcp || []).some((/** @type {any} */ e) => e.name === "github"), false, "what all chats say: nothing kept");
  });

  test("a load that is none, or a server that reaches no place: refused in words, nothing written", async () => {
    let r = await call("PUT", "/mcp-servers/all/github", { load: "lazy" });
    assert.deepEqual([r.status, r.body.error], [400, 'A server\'s load is "core" or "on-demand", not "lazy"']);
    r = await call("PUT", `/mcp-servers/${enc(chatScope)}/nobody`, { load: "core" });
    assert.deepEqual([r.status, r.body.error], [404, "no server named nobody reaches this chat"]);
    assert.equal(config.get().sessions.defaults.plugins.mcp[0].load, "core");
  });
});
