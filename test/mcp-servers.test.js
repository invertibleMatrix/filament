// @ts-check
// HarnessV4_Settings_Plan HS-1, the server half: your MCP servers across the layers (HS-D7 — the lists add up by name,
// a switch turns an inherited server on or off), their credentials never back on a page, in a log or unsealed on disk
// (HS-D8), one place's list read and written one entry at a time through the admin rows (HC-25), Test in words a person
// can act on (HC-7 to HC-11), and the New Task board's dots (HC-26). The page half is in mcp-servers-ui.test.js.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { SECRET_MARK, cryptLayer, isSwitch, maskAnswer, maskEntry, mergeServers, restoreList, serversOn } from "../src/services/mcp-servers.js";
import { applyPatch, mcpEntryProblem, resolveSettings, validateLayer } from "../src/services/session-settings.js";
import { isSealed, openConfig, sealConfig } from "../src/services/config/secrets.js";
import { createConfigStore, mergeSecrets, redactConfig } from "../src/services/config/store.js";
import { Archive } from "../src/services/memory/archive.js";
import { MemoryService } from "../src/services/memory/index.js";
import { sidecar } from "../src/adapters/sidecar/index.js";
import { createSessions } from "../src/app/sessions/service.js";
import { createMcpServers, testWords } from "../src/app/sessions/mcp-servers.js";
import { McpError, connectMcp, specKey } from "../src/adapters/tools/mcp-client.js";
import { mcpServerRoutes } from "../src/http/admin/mcp-servers.js";
import { sessionRoutes } from "../src/http/admin/sessions.js";
import { memoryRoutes } from "../src/http/admin/memory.js";
import { createRouter } from "../src/http/router.js";
import { SessionWriters } from "../src/services/session-writers.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/mcp-server.mjs", import.meta.url));
// Credentials no answer, log or file may ever hold in the clear.
const TOKEN = `ghp_${randomBytes(12).toString("hex")}`;
const BEARER = `Bearer lin_${randomBytes(12).toString("hex")}`;
const CHAT_KEY = `sk-${randomBytes(12).toString("hex")}`;

const github = { name: "github", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: TOKEN, LOG_LEVEL: "info" } };
const linear = { name: "linear", url: "https://mcp.linear.app/mcp", headers: { Authorization: BEARER, Accept: "application/json" } };

describe("the merge (HS-D7)", () => {
  // (fails before: yes — the narrowest layer's list replaced the others whole, and a switch entry was refused)
  test("lists add up by name: a narrower spec replaces, a switch turns on or off, a switch with nothing beneath is an orphan", () => {
    const merged = mergeServers([
      { at: "global", list: [github, { name: "fs", command: "fs-server" }, { name: "old", command: "old", enabled: false }] },
      { at: "project", list: [{ name: "github", command: "gh-local" }, { name: "fs", enabled: false }] },
      { at: "session", list: [{ name: "fs", enabled: true }, { name: "old", enabled: true }, { name: "ghost", enabled: false }, linear] },
    ]);
    const by = Object.fromEntries(merged.map((s) => [s.name, s]));
    assert.deepEqual([by.github.from, by.github.replaces, by.github.spec?.command, by.github.on], ["project", "global", "gh-local", true]);
    assert.deepEqual([by.fs.from, by.fs.on, by.fs.switchedAt], ["global", true, "session"], "off for the project, on again for the chat");
    assert.deepEqual([by.old.on, by.old.switchedAt], [true, "session"], "a server kept off is switched on beneath it");
    assert.deepEqual([by.ghost.orphan, by.ghost.spec], [true, null]);
    assert.deepEqual([by.linear.from, by.linear.replaces], ["session", null]);
    assert.deepEqual(serversOn(merged).map((s) => s.name), ["github", "fs", "old", "linear"], "the orphan and nothing off runs");
    assert.equal("enabled" in serversOn(merged)[2], false, "the spec a chat starts carries no switch");
  });

  test("resolveSettings runs the merged list; the narrowest layer that names one is the source; none names one: the default", () => {
    const r = resolveSettings({ global: { plugins: { mcp: [github] } }, project: { "plugins.mcp": [{ name: "github", enabled: false }] }, session: { plugins: { mcp: [linear] } } });
    assert.deepEqual(r.flat["plugins.mcp"].map((/** @type {any} */ s) => s.name), ["linear"]);
    assert.equal(r.sources["plugins.mcp"], "session");
    // (fails before: yes — HC-21: a chat that set a list of its own lost yours; now its entries add to yours by name)
    const old = resolveSettings({ global: { plugins: { mcp: [github] } }, session: { plugins: { mcp: [{ name: "fs", command: "fs" }] } } });
    assert.deepEqual(old.flat["plugins.mcp"].map((/** @type {any} */ s) => s.name), ["github", "fs"]);
    assert.deepEqual(resolveSettings({}).flat["plugins.mcp"], []);
  });

  test("a layer's entries: a switch is { name, enabled } only; a spec may say enabled: false; a name once; a refused one is said in words", () => {
    assert.equal(isSwitch({ name: "a", enabled: false }), true);
    assert.equal(isSwitch({ name: "a", enabled: false, command: "x" }), false);
    assert.equal(mcpEntryProblem({ name: "a", enabled: true }), null);
    assert.equal(mcpEntryProblem({ name: "a", command: "x", enabled: false }), null);
    assert.match(String(mcpEntryProblem({ name: "a", command: "x", enabled: "no" })), /enabled must be true or false/);
    assert.match(String(mcpEntryProblem({ name: "Bad", enabled: true })), /needs a name/);
    assert.match(String(mcpEntryProblem({ name: "filament", enabled: true })), /Filament's own server's name/);
    const twice = validateLayer({ "plugins.mcp": [github, { name: "github", enabled: false }] }, { at: "session" });
    assert.deepEqual(twice.errors, ['"plugins.mcp" names the server github twice']);
  });
});

describe("credentials (HS-D8)", () => {
  test("masked by their names: a key or token in env, Authorization in headers; the rest as written", () => {
    const m = /** @type {any} */ (maskEntry(github));
    assert.deepEqual(m.env, { GITHUB_TOKEN: SECRET_MARK, LOG_LEVEL: "info" });
    assert.equal(github.env.GITHUB_TOKEN, TOKEN, "the entry itself is not touched");
    assert.deepEqual(/** @type {any} */ (maskEntry(linear)).headers, { Authorization: SECRET_MARK, Accept: "application/json" });
  });

  // (fails before: yes — no answer masked a server's credentials)
  test("maskAnswer finds the knob anywhere — flat, nested, a change row — and copies a Date or a Buffer as it is", () => {
    const at = new Date(1_758_000_000_000);
    const buf = Buffer.from("x");
    const out = maskAnswer({
      flat: { "plugins.mcp": [github] },
      layers: { session: { plugins: { mcp: [linear], web: { fetch: true } } } },
      changes: [{ path: "plugins.mcp", from: [github], to: [linear] }, { path: "model.name", to: "m" }],
      at,
      buf,
    });
    const text = JSON.stringify(out);
    assert.equal(text.includes(TOKEN) || text.includes(BEARER), false, text);
    assert.deepEqual(out.layers.session.plugins.web, { fetch: true });
    assert.equal(out.changes[1].to, "m");
    assert.equal(out.at, at, "a Date is written as it is, not walked into {}");
    assert.equal(out.buf, buf);
  });

  test("a placeholder sent back keeps the stored value, nearest layer first; one nothing stands behind is refused in words", () => {
    const back = restoreList([{ ...github, env: { GITHUB_TOKEN: SECRET_MARK } }], [[{ name: "github", env: { GITHUB_TOKEN: "near" } }], [github]]);
    assert.deepEqual([back.list[0].env.GITHUB_TOKEN, back.errors], ["near", []]);
    const none = restoreList([{ name: "new", command: "x", env: { API_KEY: SECRET_MARK } }], [[github]]);
    assert.deepEqual(none.errors, ['"plugins.mcp" server new: the value of the environment\'s API_KEY is hidden and none is kept to stand for it — type its value']);
    // The settings' one writer does the same against the layer it writes (a page's JSON row sends the mask back).
    const layer = { plugins: { mcp: [github] } };
    const r = applyPatch(layer, { patch: { plugins: { mcp: [{ ...github, args: ["-y", "other"], env: { GITHUB_TOKEN: SECRET_MARK } }] } } }, { at: "session" });
    assert.deepEqual([r.errors, r.layer.plugins.mcp[0].env.GITHUB_TOKEN, r.layer.plugins.mcp[0].args], [[], TOKEN, ["-y", "other"]]);
  });

  test("sealed in a stored layer and opened with the same key; another key opens to empty; no key leaves it as written", () => {
    const key = randomBytes(32);
    const sealed = cryptLayer({ plugins: { mcp: [github] }, "plugins.mcp": [linear], model: { name: "m" } }, key, "seal");
    assert.equal(isSealed(sealed.plugins.mcp[0].env.GITHUB_TOKEN), true);
    assert.equal(sealed.plugins.mcp[0].env.LOG_LEVEL, "info");
    assert.equal(isSealed(sealed["plugins.mcp"][0].headers.Authorization), true);
    assert.deepEqual(sealed.model, { name: "m" });
    assert.equal(cryptLayer(sealed, key, "open").plugins.mcp[0].env.GITHUB_TOKEN, TOKEN);
    assert.equal(cryptLayer(sealed, randomBytes(32), "open").plugins.mcp[0].env.GITHUB_TOKEN, "");
    const plain = { plugins: { mcp: [github] } };
    assert.equal(cryptLayer(plain, null, "seal"), plain);
  });

  // (fails before: yes — config.json kept your servers' credentials in plain text, and the dashboard's answer showed them)
  test("config.json: your defaults' servers sealed, nested or dotted; the dashboard's answer masked; its placeholder kept by where it sits", () => {
    const key = randomBytes(32);
    const cfg = { sessions: { defaults: { plugins: { mcp: [github] }, "plugins.mcp": [linear] } }, upstreams: [] };
    const sealed = sealConfig(cfg, key);
    assert.equal(isSealed(sealed.sessions.defaults.plugins.mcp[0].env.GITHUB_TOKEN), true);
    assert.equal(sealed.sessions.defaults.plugins.mcp[0].env.LOG_LEVEL, "info");
    assert.equal(isSealed(sealed.sessions.defaults["plugins.mcp"][0].headers.Authorization), true);
    assert.equal(openConfig(sealed, key).config.sessions.defaults.plugins.mcp[0].env.GITHUB_TOKEN, TOKEN);
    const shown = redactConfig(cfg);
    assert.equal(JSON.stringify(shown).includes(TOKEN) || JSON.stringify(shown).includes(BEARER), false);
    const back = mergeSecrets(shown, cfg);
    assert.equal(back.sessions.defaults.plugins.mcp[0].env.GITHUB_TOKEN, TOKEN);
    assert.equal(back.sessions.defaults["plugins.mcp"][0].headers.Authorization, BEARER);
  });

  // (fails before: yes — a chat's or a project's layer held them in plain text in archive.db)
  test("the archive seals a chat's and a project's servers with its secret key, bodies encrypted or not", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-mcps-archive-"));
    try {
      const secretKey = randomBytes(32);
      const file = join(dir, "archive.db");
      const a = new Archive({ file, key: null, secretKey });
      const project = a.ensureProject(dir);
      const chain = a.chainForKey("h:mcps", { project: project.id, cwd: dir, client: "harness" });
      a.setChainSettings(chain.id, { plugins: { mcp: [github] } });
      a.setProjectSettings(project.id, { "plugins.mcp": [linear] });
      assert.equal(a.chainSettings(chain.id).plugins.mcp[0].env.GITHUB_TOKEN, TOKEN);
      assert.equal(a.getChain(chain.id)?.settings.plugins.mcp[0].env.GITHUB_TOKEN, TOKEN);
      assert.equal(a.projectSettings(project.id)["plugins.mcp"][0].headers.Authorization, BEARER);
      // The same file read without the key: what is at rest.
      const raw = new Archive({ file, key: null, secretKey: null });
      assert.equal(isSealed(raw.chainSettings(chain.id).plugins.mcp[0].env.GITHUB_TOKEN), true);
      assert.equal(isSealed(raw.projectSettings(project.id)["plugins.mcp"][0].headers.Authorization), true);
      raw.close();
      a.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Test in words (HC-7 to HC-11)", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-mcps-test-"));
  after(() => rmSync(dir, { recursive: true, force: true }));

  test("each failure says what to do: not on PATH, no program at a path, a refusal, another status, no answer, no host; old SSE is named", () => {
    const stdio = { name: "github", command: "npx" };
    const http = { name: "linear", url: "https://mcp.linear.app/mcp" };
    assert.deepEqual(testWords(new McpError("MCP server github could not start (spawn npx ENOENT)"), stdio), { words: "npx was not found on this computer's PATH" });
    assert.deepEqual(testWords(new McpError("MCP server x could not start (spawn C:\\tools\\srv.exe ENOENT)"), { name: "x", command: "C:\\tools\\srv.exe" }), { words: "C:\\tools\\srv.exe was not found: no program is there" });
    assert.deepEqual(testWords(new McpError("linear: initialize: HTTP 401 — Unauthorized"), http), { words: "The server refused: 401. Check the Authorization header." });
    assert.deepEqual(testWords(new McpError("linear: initialize: HTTP 500 — boom"), http), { words: "The server answered HTTP 500: boom." });
    assert.deepEqual(testWords(new McpError("github: initialize did not answer within 15 s"), stdio), { words: "No answer in 15 s; the program was stopped." });
    assert.deepEqual(testWords(new McpError("linear: initialize did not answer within 15 s"), http), { words: "No answer in 15 s." });
    assert.deepEqual(testWords(new McpError("linear: initialize: mcp.linear.app could not be reached (ENOTFOUND)"), http), { words: "mcp.linear.app could not be reached (ENOTFOUND)." });
    assert.match(testWords(new McpError("linear: initialize: HTTP 405 — no"), { ...http, type: "sse" }).words, /It is written as an old SSE server/);
    assert.deepEqual(testWords(new McpError("MCP server github: something else"), stdio), { words: "something else" });
  });

  // (fails before: yes — the client's error carried no output, so a server that ended said only its last line)
  test("a real program: one that ends before it answers shows its exit and its output; a name on no PATH says so", async () => {
    const ended = { name: "fx", command: process.execPath, args: [FIXTURE, "--stderr", "--crash"] };
    const e1 = await connectMcp(ended, { cwd: dir, timeoutMs: 10_000 }).then(() => null, (e) => e);
    assert.ok(e1, "the program ended");
    assert.deepEqual(testWords(e1, ended), { words: "It started and ended (code 3) before it answered. Its last lines:", output: "fixture: hello from stderr" });
    const missing = { name: "fx", command: "filament-no-such-program-hs1" };
    const e2 = await connectMcp(missing, { cwd: dir, timeoutMs: 10_000 }).then(() => null, (e) => e);
    assert.deepEqual(testWords(e2, missing), { words: "filament-no-such-program-hs1 was not found on this computer's PATH" });
  });
});

describe("one place's list, through the admin rows", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-mcps-"));
  const folder = mkdtempSync(join(dir, "project-"));
  let clock = 1_758_000_000_000;
  const now = () => (clock += 1000);
  const config = createConfigStore({ dataDir: dir });
  config.set({ ...config.get(), memory: { ...config.get().memory, enabled: true } });
  const memory = new MemoryService(/** @type {any} */ ({
    sidecar,
    getConfig: config.get,
    dataDir: dir,
    log: () => {},
    selfBase: () => "http://127.0.0.1:20399",
    getModelNames: () => ["cheap"],
    now,
  }));
  /** @type {any[]} */
  const ops = [];
  // The op forwarder the server wires (wireMemoryOps): the archive's audit lines land in the same list.
  /** @type {any} */ (memory).onArchiveOp = (/** @type {string} */ title, /** @type {any} */ o) => ops.push({ kind: "archive", title, ...(o || {}) });
  memory.start();
  const archive = /** @type {Archive} */ (memory.archive);
  // The op log as the History reads it: newest first.
  const record = {
    record: (/** @type {string} */ kind, /** @type {string} */ title, /** @type {any} */ o) => ops.push({ kind, title, ...(o || {}) }),
    list: ({ kinds = /** @type {string[]} */ ([]) } = {}) => ops.filter((o) => kinds.includes(o.kind)).reverse(),
  };
  const mcpTests = new Map();
  const sessions = createSessions(/** @type {any} */ ({ memory, config, pipeline: { handle() {} }, ops: record, log: () => {}, forkSession: async () => ({}), mcpTests }));
  /** @type {any[]} */
  const connects = [];
  /** @type {import("../src/adapters/tools/mcp-client.js").connectMcp} */
  const connect = async (spec, o) => {
    connects.push({ spec, cwd: o?.cwd });
    if (spec.name === "broken") throw new McpError("MCP server broken could not start (spawn nope ENOENT)");
    return /** @type {any} */ ({ tools: [{ tool: "read_issue", readOnly: true }, { tool: "create_issue", readOnly: false }], close: async () => {} });
  };
  const mcpServers = createMcpServers({ sessions, memory, config, tests: mcpTests, connect, now, home: dir });
  const sessionWriters = new SessionWriters();
  const a = { memory, sessions, mcpServers, sessionWriters, config, ops: record, usage: { forChain: () => ({ records: [], capped: false }), publicRecord: (/** @type {any} */ r) => r, records: [] } };
  const route = createRouter([...mcpServerRoutes(a), ...sessionRoutes(a), ...memoryRoutes(a)]);
  /** Every answer this suite saw, for the sweep at its end. @type {string[]} */
  const answers = [];
  /** @param {string} method @param {string} path @param {any} [body] @param {Record<string, string>} [headers] */
  const call = async (method, path, body = undefined, headers = {}) => {
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
    const req = { headers: { "x-api-key": "k", ...headers }, method, socket: { remoteAddress: "127.0.0.1" }, on() {} };
    await m.handler({ req, res, url, path: url.pathname, method, params: m.params, json: async () => body }, a);
    answers.push(out);
    return { status, body: out ? JSON.parse(out) : null };
  };
  const enc = encodeURIComponent;
  const chat = sessions.create({ cwd: folder, model: "cheap" });
  const projectScope = `project:${chat.projectId}`;
  const chatScope = `chat:${chat.id}`;

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

  // (fails before: yes — no row read or wrote one place's servers)
  test("HC-1, HC-17, HC-20: a server for all chats, one for a project, one for a chat — each place lists what reaches it, credentials masked", async () => {
    let r = await call("GET", "/mcp-servers?scope=all");
    assert.deepEqual([r.status, r.body.label, r.body.servers, r.body.held], [200, "all chats", [], false]);
    r = await call("PUT", `/mcp-servers/all/github`, github);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.servers.map((/** @type {any} */ s) => [s.name, s.kind, s.from, s.own, s.on]), [["github", "stdio", "global", true, true]]);
    assert.equal(r.body.servers[0].spec.env.GITHUB_TOKEN, SECRET_MARK);
    assert.equal(config.get().sessions.defaults.plugins.mcp[0].env.GITHUB_TOKEN, TOKEN, "kept whole in the config");
    r = await call("PUT", `/mcp-servers/${enc(projectScope)}/linear`, linear);
    assert.deepEqual(r.body.servers.map((/** @type {any} */ s) => [s.name, s.from, s.own]), [["github", "global", false], ["linear", "project", true]]);
    assert.match(r.body.label, /^project /);
    r = await call("PUT", `/mcp-servers/${enc(chatScope)}/notes`, { command: "node", args: ["notes.js"], env: { API_KEY: CHAT_KEY } });
    assert.deepEqual([r.body.label, r.body.servers.map((/** @type {any} */ s) => [s.name, s.from])], ["this chat", [["github", "global"], ["linear", "project"], ["notes", "session"]]]);
    const settings = sessions.settingsOf(chat.id);
    assert.deepEqual(settings.effective.plugins.mcp.map((/** @type {any} */ s) => s.name), ["github", "linear", "notes"], "the chat runs all three");
    assert.equal(settings.effective.plugins.mcp[0].env.GITHUB_TOKEN, TOKEN, "with the real credentials");
  });

  test("HC-19: a chat switches an inherited server off, then on again — the switch is dropped where it says what beneath says", async () => {
    let r = await call("PUT", `/mcp-servers/${enc(chatScope)}/github`, { enabled: false });
    const row = r.body.servers.find((/** @type {any} */ s) => s.name === "github");
    assert.deepEqual([row.on, row.switchedAt, row.switchedHere, row.own], [false, "session", true, false]);
    assert.deepEqual(archive.chainSettings(chat.id).plugins.mcp.find((/** @type {any} */ e) => e.name === "github"), { name: "github", enabled: false });
    assert.deepEqual(sessions.settingsOf(chat.id).effective.plugins.mcp.map((/** @type {any} */ s) => s.name), ["linear", "notes"]);
    r = await call("PUT", `/mcp-servers/${enc(chatScope)}/github`, { enabled: true });
    assert.equal(archive.chainSettings(chat.id).plugins.mcp.some((/** @type {any} */ e) => e.name === "github"), false, "back to what beneath says: no switch kept");
    r = await call("PUT", `/mcp-servers/${enc(chatScope)}/nobody`, { enabled: false });
    assert.deepEqual([r.status, r.body.error], [404, "no server named nobody reaches this chat"]);
  });

  test("HC-16, HC-14: switching your own server off keeps it, off; an edit that sends the placeholder keeps the token; a project's switch puts it back on there", async () => {
    let r = await call("PUT", `/mcp-servers/all/github`, { enabled: false });
    assert.deepEqual(config.get().sessions.defaults.plugins.mcp[0].enabled, false);
    r = await call("PUT", `/mcp-servers/all/github`, { command: "npx", args: ["-y", "gh-v2"], env: { GITHUB_TOKEN: SECRET_MARK, LOG_LEVEL: "debug" } });
    const kept = config.get().sessions.defaults.plugins.mcp[0];
    assert.deepEqual([kept.args, kept.env.GITHUB_TOKEN, kept.env.LOG_LEVEL, kept.enabled], [["-y", "gh-v2"], TOKEN, "debug", false], "the edit keeps the switch");
    r = await call("PUT", `/mcp-servers/${enc(projectScope)}/github`, { enabled: true });
    assert.equal(r.body.servers.find((/** @type {any} */ s) => s.name === "github").on, true);
    r = await call("GET", `/mcp-servers?scope=all`);
    assert.equal(r.body.servers[0].on, false, "still off for all chats");
    r = await call("PUT", `/mcp-servers/all/github`, { enabled: true });
    r = await call("PUT", `/mcp-servers/${enc(projectScope)}/github`, { enabled: true });
    assert.deepEqual(archive.projectSettings(chat.projectId).plugins.mcp.map((/** @type {any} */ e) => e.name), ["linear"], "the project's switch now says what beneath says: dropped");
  });

  test("a placeholder with nothing behind it, a bad name, a rename onto a taken one: refused in words, nothing written", async () => {
    let r = await call("PUT", `/mcp-servers/all/fresh`, { command: "x", env: { API_KEY: SECRET_MARK } });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /API_KEY is hidden and none is kept to stand for it/);
    r = await call("PUT", `/mcp-servers/all/Bad`, { command: "x" });
    assert.deepEqual([r.status, r.body.error], [400, "server Bad needs a name: a-z, 0-9, -, up to 32 characters"]);
    await call("PUT", `/mcp-servers/all/fs`, { command: "fs-server" });
    r = await call("PUT", `/mcp-servers/all/fs`, { name: "github", command: "fs-server" });
    assert.deepEqual([r.status, r.body.error], [409, "all chats already has a server named github"]);
    assert.deepEqual(config.get().sessions.defaults.plugins.mcp.map((/** @type {any} */ e) => e.name), ["github", "fs"]);
  });

  test("an edit for a place of a server it inherits becomes the place's own, its credentials kept from beneath; a rename keeps them too", async () => {
    let r = await call("PUT", `/mcp-servers/${enc(projectScope)}/github`, { command: "gh-local", env: { GITHUB_TOKEN: SECRET_MARK } });
    const row = r.body.servers.find((/** @type {any} */ s) => s.name === "github");
    assert.deepEqual([row.from, row.replaces, row.own], ["project", "global", true]);
    assert.equal(archive.projectSettings(chat.projectId).plugins.mcp.find((/** @type {any} */ e) => e.name === "github").env.GITHUB_TOKEN, TOKEN);
    r = await call("PUT", `/mcp-servers/${enc(projectScope)}/github`, { name: "gh", command: "gh-local", env: { GITHUB_TOKEN: SECRET_MARK } });
    const own = archive.projectSettings(chat.projectId).plugins.mcp;
    assert.deepEqual(own.map((/** @type {any} */ e) => e.name), ["linear", "gh"]);
    assert.equal(own[1].env.GITHUB_TOKEN, TOKEN);
    await call("DELETE", `/mcp-servers/${enc(projectScope)}/gh`);
  });

  test("HC-15: remove — a place that does not hold the server is told where it comes from; yours gone leaves a chat's switch as an orphan to clear", async () => {
    await call("PUT", `/mcp-servers/${enc(chatScope)}/fs`, { enabled: false });
    let r = await call("DELETE", `/mcp-servers/${enc(chatScope)}/linear`);
    assert.deepEqual([r.status, r.body.error], [404, "this chat holds no server named linear: switch it off here, or remove it where it comes from"]);
    r = await call("DELETE", `/mcp-servers/all/fs`);
    assert.deepEqual(r.body.servers.map((/** @type {any} */ s) => s.name), ["github"]);
    r = await call("GET", `/mcp-servers?scope=${enc(chatScope)}`);
    const orphan = r.body.servers.find((/** @type {any} */ s) => s.name === "fs");
    assert.deepEqual([orphan.orphan, orphan.spec], [true, undefined]);
    r = await call("DELETE", `/mcp-servers/${enc(chatScope)}/fs`);
    assert.equal(r.body.servers.some((/** @type {any} */ s) => s.name === "fs"), false, "Clear takes the switch away");
  });

  test("a read-only tab is refused a chat's write in words; another place's write is not a chat's", async () => {
    const close = sessionWriters.connect("tab-a");
    sessionWriters.open("tab-a", chat.id);
    try {
      let r = await call("PUT", `/mcp-servers/${enc(chatScope)}/github`, { enabled: false }, { "x-filament-tab": "tab-b" });
      assert.deepEqual([r.status, r.body.readOnly], [409, true]);
      r = await call("DELETE", `/mcp-servers/${enc(chatScope)}`, undefined, { "x-filament-tab": "tab-b" });
      assert.equal(r.status, 409);
      r = await call("PUT", `/mcp-servers/all/github`, { enabled: true }, { "x-filament-tab": "tab-b" });
      assert.equal(r.status, 200);
      r = await call("PUT", `/mcp-servers/${enc(chatScope)}/github`, { enabled: false }, { "x-filament-tab": "tab-a" });
      assert.equal(r.status, 200, "the writing tab writes");
    } finally {
      close();
    }
  });

  test("Back to what it inherits: the place's own list goes, so it reads the layers beneath; a place that names nothing is refused", async () => {
    let r = await call("GET", `/mcp-servers?scope=${enc(chatScope)}`);
    assert.equal(r.body.held, true);
    r = await call("DELETE", `/mcp-servers/${enc(chatScope)}`);
    assert.deepEqual([r.body.held, r.body.servers.map((/** @type {any} */ s) => [s.name, s.on])], [false, [["github", true], ["linear", true]]]);
    assert.equal("plugins" in archive.chainSettings(chat.id), false);
    for (const [scope, status] of /** @type {const} */ ([["bogus", 400], ["project:nope", 404], ["chat:nope", 404]]))
      assert.equal((await call("GET", `/mcp-servers?scope=${scope}`)).status, status, scope);
  });

  test("HC-11, HC-26: Test connects in the place's folder with the kept credentials, says what it found, and the list and the New Task board dot it", async () => {
    connects.length = 0;
    // The page sends the row as it was listed, its credentials as the placeholder.
    let r = await call("GET", `/mcp-servers?scope=${enc(projectScope)}`);
    const listed = r.body.servers.find((/** @type {any} */ s) => s.name === "github");
    r = await call("POST", "/mcp-servers/test", { scope: projectScope, server: { name: listed.name, ...listed.spec } });
    assert.deepEqual([r.status, r.body.ok, r.body.words, r.body.tools], [200, true, "2 tools: 1 only read", [{ name: "read_issue", readOnly: true }, { name: "create_issue", readOnly: false }]]);
    assert.deepEqual([connects[0].cwd, connects[0].spec.env.GITHUB_TOKEN], [folder, TOKEN]);
    r = await call("GET", `/mcp-servers?scope=${enc(projectScope)}`);
    assert.deepEqual([r.body.servers[0].test.ok, r.body.servers[0].test.words], [true, "2 tools: 1 only read"]);
    r = await call("POST", "/mcp-servers/test", { scope: "all", server: { name: "broken", command: "nope" } });
    assert.deepEqual([r.body.ok, r.body.words], [false, "nope was not found on this computer's PATH"]);
    assert.equal(connects.at(-1).cwd, dir, "all chats: a test starts in your home folder");
    r = await call("POST", "/mcp-servers/test", { scope: "all", server: { name: "x" } });
    assert.equal(r.status, 400);
    // The board weighs a new chat in the folder: each server it would start, with its last test.
    const board = await sessions.draftStart({ cwd: folder, model: "cheap" });
    assert.deepEqual(board.tools.mcp, ["github", "linear"]);
    assert.deepEqual(board.tools.mcpTests, { github: { ok: true, words: "2 tools: 1 only read" }, linear: null });
    assert.equal(mcpTests.get(specKey(/** @type {any} */ (sessions.settingsOf(chat.id).effective.plugins.mcp[0]))).ok, true, "one map: the list's and the board's");
  });

  // (fails before: yes — a Space of the person's own was "project Work" in its Connections, and "this project" where a draft could not send)
  test("a Space of your own is said by its name, and as a Space where a draft's server is missing", () => {
    const own = createMcpServers({ sessions, memory, config, connect, now, home: dir, ownName: (id) => (id === chat.projectId ? "Work" : null) });
    assert.deepEqual([own.placeOf(projectScope).label, mcpServers.placeOf(projectScope).label.startsWith("project ")], ["Work", true]);
    const missing = own.serverFor(chat.projectId, "nope");
    assert.equal(!missing.ok && missing.error, "nope is no MCP server of this Space's chats (its Connectors, or Library › Plugins & Connectors for all chats)");
  });

  // (fails before: yes — the sessions and memory areas answered a chat's settings and its row with the credentials)
  test("the sweep: no answer of the sessions, memory or MCP areas, no ops line, no file under the data folder holds a credential", async () => {
    await call("PUT", `/mcp-servers/${enc(chatScope)}/notes`, { command: "node", env: { API_KEY: CHAT_KEY } });
    await call("PATCH", `/sessions/${chat.id}/settings`, { patch: { plugins: { mcp: [{ name: "notes", command: "node", args: ["v2"], env: { API_KEY: SECRET_MARK } }] } } });
    assert.equal(archive.chainSettings(chat.id).plugins.mcp[0].env.API_KEY, CHAT_KEY, "the JSON row's placeholder kept the key");
    for (const path of [`/sessions/${chat.id}/settings`, `/sessions/${chat.id}/settings/history`, `/defaults/settings`, `/projects/${chat.projectId}/settings`, `/memory/sessions/${chat.id}`, `/memory/sessions`, `/mcp-servers?scope=${enc(chatScope)}`])
      assert.equal((await call("GET", path)).status, 200, path);
    const secrets = [TOKEN, BEARER, CHAT_KEY];
    const leaks = (/** @type {string} */ text) => secrets.filter((s) => text.includes(s));
    assert.deepEqual(answers.flatMap(leaks), [], "no answer");
    assert.deepEqual(leaks(JSON.stringify(ops)), [], "no ops line");
    /** @param {string} d @returns {string[]} */
    const files = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? files(join(d, n)) : [join(d, n)]));
    const found = files(dir).filter((f) => leaks(readFileSync(f).toString("latin1")).length);
    assert.deepEqual(found, [], "no file at rest");
    assert.ok(files(dir).some((f) => f.endsWith("config.json")) && files(dir).some((f) => /archive\.db/.test(f)), "the sweep read the config and the archive");
  });
});
