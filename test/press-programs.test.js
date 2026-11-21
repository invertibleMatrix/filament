// @ts-check
// What starts a program as the person, or names one Filament starts by itself, is a press (r-doors, 11-12; the press
// key's own tests are x-sec-press-key.test.js's). Any program on this computer reaches the admin API with no secret, and
// while the desktop app holds a key a press is its window's alone: yet a chat, a project or your defaults took a hook,
// an MCP server, a plugin or a language server from any caller, the config a coding agent's program and a listener
// opened to the network, and the rows that open a terminal, test or write an MCP server, switch a plugin on or name a
// team's check answered whoever called. Each is refused without the key, in words, and nothing is written or started;
// with the key — the page's every write carries it — each answers as it did; what only removes, switches off or closes
// needs none; and with no key held — a plain browser, a server, the CLI — everything is as it was. Through a real
// Filament, a fake provider and a stand-in for node-pty.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAKE_ACP_AGENT, anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { until } from "./helpers/wait.js";
import { PRESS_HEADER, setPressKey } from "../src/http/guards.js";
import { runCli } from "../src/cli/main.js";
import { EXIT } from "../src/cli/client.js";

const KEY = randomBytes(32).toString("base64url");
const PRESS = { [PRESS_HEADER]: KEY };
const FAR = { "x-forwarded-for": "100.101.102.103" };
const REFUSED = /Filament app/;
const WS = { connection: "Upgrade", upgrade: "websocket", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13" };

/**
 * A request over node:http, so the test sets every header itself.
 * @param {number} port @param {string} path @param {{ method?: string, headers?: Record<string, string>, body?: any }} [o]
 * @returns {Promise<{ status: number, headers: http.IncomingHttpHeaders, json: any, text: string }>}
 */
const ask = (port, path, { method = "GET", headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const text = body === undefined ? "" : JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port, path, method, headers: { host: `127.0.0.1:${port}`, ...(text ? { "content-type": "application/json" } : {}), ...headers } });
    req.on("response", (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(b);
        } catch {}
        resolve({ status: Number(res.statusCode), headers: res.headers, json, text: b });
      });
    });
    req.on("error", reject);
    req.end(text || undefined);
  });

/**
 * A WebSocket's upgrade asked: its status — 101 where it opened, then let go — and what a refusal said.
 * @param {number} port @param {string} path @param {Record<string, string>} [headers]
 * @returns {Promise<{ status: number, text: string }>}
 */
const upgrade = (port, path, headers = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, ...WS, ...headers } });
    req.on("upgrade", (res, socket) => {
      socket.on("error", () => {});
      socket.destroy();
      resolve({ status: Number(res.statusCode), text: "" });
    });
    req.on("response", (res) => {
      let b = "";
      res.on("error", () => {});
      res.on("data", (d) => (b += d));
      res.on("end", () => resolve({ status: Number(res.statusCode), text: b }));
    });
    req.on("error", reject);
    req.end();
  });

/** A stand-in for node-pty: it stays up, says nothing, and keeps what is typed. @type {string[]} */
const typed = [];
const fakePty = () => ({ onData() {}, onExit() {}, write: (/** @type {string} */ d) => void typed.push(d), resize() {}, kill() {} });

describe("what starts a program is a press, on one Filament", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-press-programs-"));
  /** @param {string} path @param {{ method?: string, headers?: Record<string, string>, body?: any }} [o] */
  const call = (path, o) => ask(shim.port, path, o);
  const S = (/** @type {string} */ id) => `/api/sessions/${encodeURIComponent(id)}`;
  /** A new chat of this computer's, its id. */
  const create = async () => {
    const r = await call("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    assert.equal(r.status, 200, r.text);
    return String(r.json.id);
  };
  /** A press refused in words, the press marked so a client can tell. @param {{ status: number, json: any, text: string }} r @param {string} what */
  const refused = (r, what) => {
    assert.equal(r.status, 403, `${what}: ${r.text}`);
    assert.match(String(r.json?.error), REFUSED, what);
    assert.equal(r.json?.press, true, what);
  };
  /** An answer that is no refusal of a press: the row was reached. @param {{ status: number, json: any, text: string }} r @param {string} what */
  const reached = (r, what) => assert.ok(!(r.status === 403 && r.json?.press), `${what}: ${r.text}`);
  /** A chat's settings in force. @param {string} id */
  const flat = async (id) => (await call(`${S(id)}/settings`)).json.flat;

  before(async () => {
    up = await fakeUpstream(async (c) => (c.kind === "anthropic" ? anthropicReply("MODEL ANSWER", { model: "brain-model" }) : undefined));
    shim = await startApp({
      overrides: { terminalSpawn: fakePty },
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true },
          { id: "coder", name: "coder", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: {}, cwdDefault: root, permissions: "allow-all", hints: false } },
        ];
        cfg.routes = [
          { match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true },
          { match: "coder/*", upstream: "coder", upstreamModel: "{1}", enabled: true },
        ];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "edit", roots: [root], readerModel: "" };
        // Cursor's SDK off: with the key its install answers that, and no npm runs.
        cfg.experimental.cursorSdk = false;
      },
    });
    setPressKey(KEY);
  });
  after(async () => {
    setPressKey("");
    await shim.stop();
    await up.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  // (fails before: yes — a program on this computer wrote a chat, a project, your defaults, a new chat, a fork or a turn a
  // hook, a command at a turn's end, an MCP server, a plugin or a language server with no key: the first, a hook on
  // the chat, answered 200 where the refusal stands now — `asksLess` weighed the mode and the rules alone)
  test("a settings write that names what Filament starts by itself is a press: a hook, the command at a turn's end, an MCP server or one switched on, a plugin, a language server — for a chat, a new one, a fork, a turn, /set, your defaults, a project —; one emptied, taken back or switched off is not", async () => {
    const id = await create();
    const { projectId } = (await call(`${S(id)}/settings`)).json;
    assert.ok(projectId, "the chat is in a project");
    const hook = { hooks: [{ on: "turn-end", command: "node -e 0" }] };
    /** @type {[string, string, any][]} */
    const rows = [
      [`${S(id)}/settings`, "PATCH", { patch: hook }],
      [`${S(id)}/settings`, "PATCH", hook],
      [`${S(id)}/settings`, "PATCH", { patch: { "loop.verify.afterEdits": "node -e 0" } }],
      [`${S(id)}/settings`, "PATCH", { patch: { loop: { verify: { afterEdits: "node -e 0" } } } }],
      [`${S(id)}/settings`, "PATCH", { patch: { "plugins.mcp": [{ name: "planted", command: "node", args: ["-e", "0"] }] } }],
      [`${S(id)}/settings`, "PATCH", { patch: { plugins: { mcp: [{ name: "planted", url: "https://mcp.example.invalid/" }] } } }],
      [`${S(id)}/settings`, "PATCH", { patch: { "plugins.mcp": [{ name: "planted", command: "node", enabled: false }] } }],
      [`${S(id)}/settings`, "PATCH", { patch: { "plugins.mcp": [{ name: "planted", enabled: true }] } }],
      [`${S(id)}/settings`, "PATCH", { patch: { "plugins.on": [{ id: "tool@market" }] } }],
      [`${S(id)}/settings`, "PATCH", { patch: { "plugins.on": [{ id: "tool@market", enabled: false, hooks: true }] } }],
      [`${S(id)}/settings`, "PATCH", { patch: { "lsp.servers": [{ name: "planted", command: "node", extensionToLanguage: { ".planted": "planted" } }] } }],
      [`${S(id)}/settings`, "PATCH", { patch: { "lsp.servers": [{ name: "typescript", enabled: true }] } }],
      ["/api/defaults/settings", "PATCH", { patch: hook }],
      [`/api/projects/${encodeURIComponent(projectId)}/settings`, "POST", { patch: hook }],
      ["/api/sessions", "POST", { cwd: root, model: "agent/brain-model", preset: "plain", settings: hook }],
      [`${S(id)}/fork`, "POST", { settings: hook }],
      [`${S(id)}/turns`, "POST", { content: "hello", settingsPatch: hook, stream: false }],
      [`${S(id)}/turns`, "POST", { content: "/set loop.verify.afterEdits node -e 0", stream: false }],
    ];
    for (const [path, method, body] of rows) refused(await call(path, { method, body }), `${method} ${path} ${JSON.stringify(body)}`);
    const now = await flat(id);
    assert.deepEqual([now.hooks, now["loop.verify.afterEdits"] ?? null, now["plugins.mcp"], now["plugins.on"], now["lsp.servers"]], [[], null, [], [], []], "the chat starts nothing it did not");
    assert.deepEqual((await call("/api/defaults/settings")).json.flat?.hooks ?? [], [], "nor your defaults");
    // One emptied, taken back or switched off, a pick, and a write that names no such knob: no key.
    for (const change of [
      { patch: { hooks: [] } },
      { unset: ["hooks", "plugins.mcp"] },
      { patch: { "loop.verify.afterEdits": null } },
      { patch: { "plugins.mcp": [{ name: "planted", enabled: false }] } },
      { patch: { "plugins.on": [{ id: "tool@market", enabled: false }] } },
      { patch: { "lsp.servers": [{ name: "typescript", enabled: false }] } },
      { patch: { "model.effort": "high" } },
    ]) {
      const r = await call(`${S(id)}/settings`, { method: "PATCH", body: change });
      assert.equal(r.status, 200, `${JSON.stringify(change)}: ${r.text}`);
    }
    // With the key each stands, as the page's writes do.
    const yes = await call(`${S(id)}/settings`, { method: "PATCH", headers: PRESS, body: { patch: { ...hook, "plugins.mcp": [{ name: "planted", command: "node", args: ["-e", "0"] }] } } });
    assert.equal(yes.status, 200, yes.text);
    const set = await flat(id);
    assert.deepEqual(set.hooks, hook.hooks);
    assert.deepEqual(set["plugins.mcp"].map((/** @type {any} */ s) => s.name), ["planted"]);
    const slash = await call(`${S(id)}/turns`, { method: "POST", headers: PRESS, body: { content: "/set loop.verify.afterEdits node -e 0", stream: false } });
    assert.equal(slash.status, 200, slash.text);
    assert.equal((await flat(id))["loop.verify.afterEdits"], "node -e 0", "/set with the key");
    const off = await call(`${S(id)}/settings`, { method: "PATCH", body: { patch: { hooks: [], "loop.verify.afterEdits": null } } });
    assert.equal(off.status, 200, `taken away with no key: ${off.text}`);
    assert.deepEqual((await flat(id)).hooks, []);
  });

  // (fails before: yes — the config's rows weighed the mode, the rules and the folders: a save that pointed a coding agent
  // at another program answered 200 with no key, and so did the network's listener switched on by a field)
  test("a coding agent's program, what your defaults start, and a door opened beyond this computer are presses, by the config whole and by its fields; one closed, and a save that leaves them, are not", async () => {
    const config = async () => (await call("/api/state")).json.config;
    const was = await config();
    const coder = (/** @type {any} */ cfg) => cfg.upstreams.find((/** @type {any} */ u) => u.id === "coder");
    /** The config as it is, changed. @param {(cfg: any) => void} change */
    const put = async (change) => {
      const next = structuredClone(await config());
      change(next);
      return call("/api/config", { method: "PUT", body: next });
    };
    refused(await put((c) => void (coder(c).acp.command = join(root, "planted.exe"))), "a coding agent's program");
    refused(await put((c) => void (coder(c).acp.args = ["-e", "0"])), "its arguments");
    refused(await put((c) => void (coder(c).acp.env = { NODE_OPTIONS: "--require ./planted.js" })), "its environment");
    refused(await put((c) => void c.upstreams.push({ id: "planted", name: "planted", type: "acp", enabled: false, acp: { command: process.execPath, args: ["-e", "0"] } })), "a coding agent that is new");
    refused(await put((c) => void (c.sessions = { ...c.sessions, defaults: { hooks: [{ on: "turn-end", command: "node -e 0" }] } })), "a hook in your defaults");
    refused(await put((c) => void (c.sessions = { ...c.sessions, defaults: { plugins: { mcp: [{ name: "planted", command: "node" }] } } })), "an MCP server in your defaults");
    refused(await put((c) => void (c.server.host = "0.0.0.0")), "the host widened");
    for (const set of [{ "server.lan.enabled": true }, { "server.host": "0.0.0.0" }, { "server.tailscale.serve": true }])
      refused(await call("/api/config/fields", { method: "PATCH", body: { set } }), `PATCH /config/fields ${JSON.stringify(set)}`);
    const now = await config();
    assert.deepEqual(coder(now).acp, coder(was).acp, "the coding agent's program is as it was");
    assert.deepEqual([now.upstreams.length, now.server.host, now.server.lan?.enabled === true, now.server.tailscale?.serve === true], [was.upstreams.length, was.server.host, false, false], "and so are the doors");
    assert.deepEqual(now.sessions?.defaults ?? {}, was.sessions?.defaults ?? {}, "and your defaults");
    // The command line, which holds no key: told so, as it is of the mode.
    /** @type {string[]} */
    const err = [];
    const code = await runCli(["settings", "set", "server.lan.enabled", "true"], { dataDir: shim.dataDir, out: () => {}, err: (s) => err.push(s), write: () => {} });
    assert.notEqual(code, EXIT.ok, "the command line opens no listener while the app holds a key");
    assert.match(err.join("\n"), REFUSED);
    // Closed, or left as they are: no key.
    const closed = await call("/api/config/fields", { method: "PATCH", body: { set: { "server.lan.enabled": false } } });
    assert.equal(closed.status, 200, `the listener closed needs no key: ${closed.text}`);
    assert.equal((await put(() => {})).status, 200, "a save that leaves them as they are needs no key");
    // With the key the program is the config's.
    const yes = await call("/api/config", { method: "PUT", headers: PRESS, body: (() => { const c = structuredClone(now); coder(c).acp.env = { R_DOORS: "1" }; return c; })() });
    assert.equal(yes.status, 200, yes.text);
    assert.deepEqual(coder(await config()).acp.env, { R_DOORS: "1" });
  });

  // (fails before: yes — any caller here wrote an MCP server into every chat's servers and had Filament start one to
  // test it: the test's program ran with no key and wrote its file)
  test("an MCP server tested, brought in, written or switched on is a press, and nothing is started or kept without the key; switched off, noted or removed needs none", async () => {
    const mark = join(root, "tested.txt");
    const probe = { scope: "all", server: { name: "probe", command: process.execPath, args: ["-e", `require("fs").writeFileSync(${JSON.stringify(mark)}, "1")`] } };
    const names = async () => ((await call("/api/mcp-servers?scope=all")).json.servers || []).map((/** @type {any} */ s) => s.name);
    refused(await call("/api/mcp-servers/test", { method: "POST", body: probe }), "a server tested");
    refused(await call("/api/mcp-servers/import", { method: "POST", body: { scope: "all", picks: [{ source: "claude-desktop", name: "planted" }] } }), "servers brought in from another app");
    refused(await call("/api/mcp-servers/all/planted", { method: "PUT", body: { command: "node", args: ["-e", "0"] } }), "a server written");
    refused(await call("/api/mcp-servers/all/planted", { method: "PUT", body: { url: "https://mcp.example.invalid/" } }), "a remote server written");
    refused(await call("/api/mcp-servers/all/planted", { method: "PUT", body: { enabled: true } }), "a server switched on");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(existsSync(mark), false, "no program was started to test one");
    assert.deepEqual(await names(), [], "and none is kept");
    // With the key, as the page's writes carry it: tested — its program runs —, written, switched.
    reached(await call("/api/mcp-servers/test", { method: "POST", headers: PRESS, body: probe }), "tested with the key");
    await until(() => existsSync(mark), "the tested server's program ran");
    const wrote = await call("/api/mcp-servers/all/planted", { method: "PUT", headers: PRESS, body: { command: "node", args: ["-e", "0"] } });
    assert.equal(wrote.status, 200, wrote.text);
    assert.deepEqual(await names(), ["planted"]);
    reached(await call("/api/mcp-servers/import", { method: "POST", headers: PRESS, body: { scope: "all", picks: [] } }), "the import with the key");
    // Off, a note, and gone: no key. On again: the key.
    const off = await call("/api/mcp-servers/all/planted", { method: "PUT", body: { enabled: false } });
    assert.equal(off.status, 200, `switched off with no key: ${off.text}`);
    assert.equal((await call("/api/mcp-servers/all/planted", { method: "PUT", body: { note: "the search alone" } })).status, 200, "a note with no key");
    refused(await call("/api/mcp-servers/all/planted", { method: "PUT", body: { enabled: true } }), "switched on again");
    assert.equal((await call("/api/mcp-servers/all/planted", { method: "PUT", headers: PRESS, body: { enabled: true } })).status, 200, "with the key it is on");
    assert.equal((await call("/api/mcp-servers/all/planted", { method: "DELETE" })).status, 200, "removed with no key");
    assert.deepEqual(await names(), []);
  });

  // (fails before: yes — each row answered any caller: a team's check was named with no key — the first, a Duplicate
  // with a check, answered 200 —, a chat was filed under another project, a plugin switched on)
  test("a connector added, a plugin switched on, the Cursor SDK installed, a reset credit spent, a chat filed under another project and a team's check named are presses; a plugin off, a team without a check and an agent's install from the catalogue are not", async () => {
    refused(await call("/api/plugins/connectors/add", { method: "POST", body: { from: "nowhere", name: "planted", place: "all" } }), "a connector added");
    refused(await call("/api/plugins/installed/tool%40market/on", { method: "POST", body: { place: "all", on: true } }), "a plugin switched on");
    refused(await call("/api/plugins/installed/tool%40market/on", { method: "POST", body: { place: "all", on: true, hooks: true } }), "a plugin's hooks switched on");
    refused(await call("/api/sdk/install", { method: "POST", body: {} }), "the Cursor SDK installed");
    refused(await call("/api/agent-accounts/coder/reset-credit", { method: "POST", body: {} }), "a reset credit spent");
    reached(await call("/api/plugins/installed/tool%40market/on", { method: "POST", body: { place: "all", on: false } }), "a plugin switched off");
    // The command line's `filament agents install <id>` holds no key, and installs the catalogue's entry alone.
    reached(await call("/api/coding-agents/no-such-agent/install", { method: "POST", body: {} }), "an agent's install from the catalogue");
    // With the key each row is reached, as from the page.
    reached(await call("/api/plugins/connectors/add", { method: "POST", headers: PRESS, body: { from: "nowhere", name: "planted", place: "all" } }), "a connector added with the key");
    reached(await call("/api/plugins/installed/tool%40market/on", { method: "POST", headers: PRESS, body: { place: "all", on: true } }), "a plugin on with the key");
    const sdk = await call("/api/sdk/install", { method: "POST", headers: PRESS, body: {} });
    assert.equal(sdk.status, 400, `the SDK's install is reached, and says its switch is off: ${sdk.text}`);
    assert.equal((await call("/api/agent-accounts/coder/reset-credit", { method: "POST", headers: PRESS, body: {} })).status, 404, "the reset credit's row is reached: no Codex account here");

    // A chat filed under another project takes that project's rules, folders, hooks and servers for its own.
    const id = await create();
    const own = (await call(`${S(id)}/settings`)).json.projectId;
    const other = join(root, "other");
    mkdirSync(other);
    const made = await call("/api/memory/projects", { method: "POST", body: { cwd: other } });
    assert.equal(made.status, 200, made.text);
    const there = String(made.json.id);
    assert.notEqual(there, own);
    refused(await call(`/api/memory/sessions/${encodeURIComponent(id)}/move`, { method: "POST", body: { project: there } }), "a chat filed under another project");
    assert.equal((await call(`${S(id)}/settings`)).json.projectId, own, "the chat is where it was");
    const moved = await call(`/api/memory/sessions/${encodeURIComponent(id)}/move`, { method: "POST", headers: PRESS, body: { project: there } });
    assert.equal(moved.status, 200, moved.text);
    assert.equal((await call(`${S(id)}/settings`)).json.projectId, there, "with the key it is filed there");

    // A team's check is a command every worker of it runs unasked, and Filament runs itself.
    const check = async (/** @type {string} */ key) => (await call("/api/teams")).json.saved.find((/** @type {any} */ t) => t.key === key)?.check ?? null;
    const teams = async () => (await call("/api/teams")).json.saved.length;
    const count = await teams();
    refused(await call("/api/teams", { method: "POST", body: { from: "builders", name: "Planted", check: "node -e 0" } }), "a Duplicate with a check");
    assert.equal(await teams(), count, "no team was made");
    const dup = await call("/api/teams", { method: "POST", body: { from: "builders", name: "Mine" } });
    assert.equal(dup.status, 200, `a Duplicate with none needs no key: ${dup.text}`);
    const key = String(dup.json.team.key);
    refused(await call(`/api/teams/${key}`, { method: "PUT", body: { check: "node -e 0" } }), "a team's check named");
    assert.equal(await check(key), null, "its check is as it was");
    assert.equal((await call(`/api/teams/${key}`, { method: "PUT", body: { name: "Mine too", check: null } })).status, 200, "another field, and no check");
    const yes = await call(`/api/teams/${key}`, { method: "PUT", headers: PRESS, body: { check: "node -e 0" } });
    assert.equal(yes.status, 200, yes.text);
    assert.equal(await check(key), "node -e 0");
    assert.equal((await call(`/api/teams/${key}`, { method: "PUT", body: { check: null } })).status, 200, "a check taken away with no key");
    assert.equal((await call(`/api/teams/${key}`, { method: "DELETE" })).status, 200, "deleted with no key");
  });

  // Whom a chat's main agent may start by itself is the person's to say: a saved agent runs the commands its card names
  // unasked, and a team that builds changes files. r-doors' builder found the two lists written with no key and left
  // them for the owner; they are the same kind of setting as a rule or a mode — what the agent does unasked.
  // (fails before: yes — every one of these answered 200 with no key, and the name was listed)
  test("whom a chat's main agent may start by itself is a press where a name is added — a saved agent it may ask, a team it may send —, by their own rows, the config's fields, the config whole and a chat's settings; the same list again, a name taken out and a list emptied need none", async () => {
    const lists = async () => {
      const s = (await call("/api/state")).json.config.agentLoop.subagents || {};
      return [s.ask ?? null, s.teams ?? null];
    };
    assert.equal((await call("/api/agents", { method: "POST", body: { tag: "asked", name: "Asked", goodFor: "trying the press", may: "copy" } })).status, 200);
    const was = await lists();
    refused(await call("/api/subagents/ask", { method: "PUT", body: { tags: ["asked"] } }), "a saved agent the main agent may ask, by its row");
    refused(await call("/api/subagents/teams", { method: "PUT", body: { teams: ["bughunters", "builders"] } }), "a team the main agent may send, by its row");
    refused(await call("/api/config/fields", { method: "PATCH", body: { set: { "agentLoop.subagents.ask": ["asked"] } } }), "a saved agent, by the config's field");
    refused(await call("/api/config/fields", { method: "PATCH", body: { set: { "agentLoop.subagents.teams": ["builders"] } } }), "a team, by the config's field");
    const whole = structuredClone((await call("/api/state")).json.config);
    whole.agentLoop.subagents = { ...whole.agentLoop.subagents, ask: ["asked"], teams: ["bughunters", "builders"] };
    refused(await call("/api/config", { method: "PUT", body: whole }), "both, by the config whole");
    const id = await create();
    refused(await call(`${S(id)}/settings`, { method: "PATCH", body: { patch: { "subagents.ask": ["asked"] } } }), "a chat's own list of agents");
    refused(await call(`${S(id)}/settings`, { method: "PATCH", body: { patch: { subagents: { teams: ["builders"] } } } }), "a chat's own list of teams");
    assert.deepEqual(await lists(), was, "nothing was listed");
    assert.deepEqual([(await flat(id))["subagents.ask"], (await flat(id))["subagents.teams"]], [[], ["bughunters"]], "nor for the chat");
    // With the key, as from the page.
    const asked = await call("/api/subagents/ask", { method: "PUT", headers: PRESS, body: { tags: ["asked"] } });
    assert.equal(asked.status, 200, asked.text);
    const sent = await call("/api/subagents/teams", { method: "PUT", headers: PRESS, body: { teams: ["bughunters", "builders"] } });
    assert.equal(sent.status, 200, sent.text);
    assert.deepEqual(await lists(), [["asked"], ["bughunters", "builders"]]);
    // What lets the agent start no more than it could needs no key.
    assert.equal((await call("/api/subagents/ask", { method: "PUT", body: { tags: ["asked"] } })).status, 200, "the same list again");
    assert.equal((await call("/api/subagents/teams", { method: "PUT", body: { teams: ["builders"] } })).status, 200, "a team taken out");
    assert.equal((await call("/api/config/fields", { method: "PATCH", body: { set: { "agentLoop.subagents.teams": [] } } })).status, 200, "the teams emptied, by the config's field");
    assert.equal((await call("/api/subagents/ask", { method: "PUT", body: { tags: [] } })).status, 200, "the agents emptied");
    assert.equal((await call(`${S(id)}/settings`, { method: "PATCH", body: { patch: { "subagents.ask": [], "subagents.teams": [] } } })).status, 200, "a chat's own lists emptied");
    assert.equal((await call(`${S(id)}/settings`, { method: "PATCH", body: { unset: ["subagents.ask", "subagents.teams"] } })).status, 200, "and taken back to the layer below");
    assert.deepEqual(await lists(), [[], []]);
  });

  // (fails before: yes — a program on this computer opened a terminal in the person's project with no key, typed into
  // it by its row, and opened its stream: POST /terminal answered 200 where the refusal stands now, and the stream 101)
  test("a terminal opened, typed into and streamed is a press: the rows by the key, the stream by a ticket the key was given, good once and for its terminal; its size and its end need none; a paired device's are as the gate lets it", async () => {
    const opened = async () => (await call("/api/terminal")).json.terminals.length;
    refused(await call("/api/terminal", { method: "POST", body: { cwd: root } }), "a terminal opened");
    assert.equal(await opened(), 0, "none was opened");
    const made = await call("/api/terminal", { method: "POST", headers: PRESS, body: { cwd: root } });
    assert.equal(made.status, 200, made.text);
    const id = String(made.json.terminal.id);
    const T = `/api/terminal/${encodeURIComponent(id)}`;
    refused(await call(`${T}/input`, { method: "POST", body: { data: "planted\r" } }), "typed into by its row");
    refused(await call(`${T}/ticket`, { method: "POST", body: {} }), "its stream's ticket");
    const bare = await upgrade(shim.port, `${T}/stream`);
    assert.equal(bare.status, 403, "its stream with no ticket");
    assert.match(bare.text, REFUSED);
    assert.equal((await upgrade(shim.port, `${T}/stream?ticket=${randomBytes(24).toString("base64url")}`)).status, 403, "a ticket nobody was given");
    assert.deepEqual(typed, [], "nothing was typed");
    // The page's way: its press asks a ticket, and its stream — a WebSocket, which carries no header — shows it, once.
    const ticket = async (/** @type {string} */ of = T) => {
      const r = await call(`${of}/ticket`, { method: "POST", headers: PRESS, body: {} });
      assert.equal(r.status, 200, r.text);
      return String(r.json.ticket);
    };
    const first = await ticket();
    assert.equal((await upgrade(shim.port, `${T}/stream?ticket=${first}`)).status, 101, "the stream opens with its ticket");
    assert.equal((await upgrade(shim.port, `${T}/stream?ticket=${first}`)).status, 403, "a ticket is good once");
    const second = (await call("/api/terminal", { method: "POST", headers: PRESS, body: { cwd: root } })).json.terminal.id;
    assert.equal((await upgrade(shim.port, `${T}/stream?ticket=${await ticket(`/api/terminal/${second}`)}`)).status, 403, "another terminal's ticket opens none");
    assert.equal((await upgrade(shim.port, `${T}/stream`, PRESS)).status, 101, "a client that can send the key opens it by the key");
    const keyed = await call(`${T}/input`, { method: "POST", headers: PRESS, body: { data: "echo hi\r" } });
    assert.equal(keyed.status, 200, keyed.text);
    assert.deepEqual(typed, ["echo hi\r"]);
    // Its size and its end start nothing: no key.
    assert.equal((await call(`${T}/resize`, { method: "POST", body: { cols: 100, rows: 30 } })).status, 200, "resized with no key");
    assert.equal((await call(`/api/terminal/${second}/kill`, { method: "POST", body: {} })).status, 200, "stopped with no key");
    // A full device the app paired presses as the gate lets it: its terminal and its stream need no ticket.
    const own = { origin: `http://127.0.0.1:${shim.port}` };
    const pair = await call("/api/remote/pair", { method: "POST", headers: PRESS, body: { scope: "full" } });
    assert.equal(pair.status, 200, pair.text);
    const claimed = await call("/api/remote/claim", { method: "POST", headers: { ...FAR, ...own }, body: { code: pair.json.code, name: "a full device" } });
    assert.equal(claimed.status, 200, claimed.text);
    const far = { ...FAR, ...own, cookie: String(claimed.headers["set-cookie"]?.[0] || "").split(";")[0] };
    const theirs = await call("/api/terminal", { method: "POST", headers: far, body: { cwd: root } });
    assert.equal(theirs.status, 200, theirs.text);
    assert.equal((await upgrade(shim.port, `/api/terminal/${theirs.json.terminal.id}/stream`, far)).status, 101, "a paired device's stream");
  });

  // (fails before: no — with no key nothing changed; it guards that it still does not)
  test("with no key — a browser, a server, the CLI —, this computer starts what it did: a hook written, a server kept, a terminal opened and streamed with no ticket, the listener's field", async () => {
    setPressKey("");
    try {
      const id = await create();
      const hooked = await call(`${S(id)}/settings`, { method: "PATCH", body: { patch: { hooks: [{ on: "turn-end", command: "node -e 0" }] } } });
      assert.equal(hooked.status, 200, hooked.text);
      assert.equal((await call(`/api/mcp-servers/${encodeURIComponent(`chat:${id}`)}/kept`, { method: "PUT", body: { command: "node", args: ["-e", "0"] } })).status, 200);
      const made = await call("/api/terminal", { method: "POST", body: { cwd: root } });
      assert.equal(made.status, 200, made.text);
      const T = `/api/terminal/${made.json.terminal.id}`;
      assert.equal((await upgrade(shim.port, `${T}/stream`)).status, 101, "its stream opens with no ticket");
      assert.equal((await call(`${T}/input`, { method: "POST", body: { data: "x" } })).status, 200);
      assert.equal((await call(`${T}/kill`, { method: "POST", body: {} })).status, 200);
      /** @type {string[]} */
      const out = [];
      const code = await runCli(["settings", "set", "server.tailscale.trustOwnLogin", "true"], { dataDir: shim.dataDir, out: (s) => out.push(s), err: (s) => out.push(s), write: () => {} });
      assert.equal(code, EXIT.ok, `the command line sets a door's field as it did: ${out.join("\n")}`);
      assert.equal((await call("/api/state")).json.config.server.tailscale?.trustOwnLogin, true);
    } finally {
      await call("/api/config/fields", { method: "PATCH", body: { set: { "server.tailscale.trustOwnLogin": false } } });
      setPressKey(KEY);
    }
  });
});
