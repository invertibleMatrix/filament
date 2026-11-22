// @ts-check
// Google's coding agent is Antigravity (the owner's of 11-10: "Google had depricated gemini cli with antigravity so remove
// gemini cli and only use antigravity as coding agent for google's models"): since 11-22 Google's agy CLI as an ACP
// server, which Filament downloads into its own folder from Google's release feed (test/agy-feed.test.js), named by its
// own prefix, an account's folder its `--gemini-dir`. Gemini CLI leaves the catalogue, detection and the templates; the
// one an install seeded, still off and holding nothing of the person's, goes as the settings are read, with its routes,
// which would hold `gemini/*`; one turned on stays as it is, and a write never takes one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_CATALOGUE, KNOWN_AGENTS, RETIRED_AGENTS, agentArgs, agentHomeVar, agentKey, agentLaunchEnv, catalogueSignIn, installCommand, signInLine, signsInInTerminal, viaRegistry } from "../src/core/catalogues.js";
import { CLIENT_INFO } from "../src/adapters/agents/acp/process.js";
import { AcpBridge } from "../src/adapters/agents/acp/bridge.js";
import { detectAgents } from "../src/adapters/agents/acp/detect.js";
import { TEMPLATES } from "../src/services/config/templates.js";
import { defaultConfig, loadConfig, normalizeConfig, withoutRetiredAgents } from "../src/services/config/store.js";
import { startApp } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-acp-agent.mjs");

// (fails before: yes — Gemini CLI was the catalogue's Google agent, and nothing Filament knew installed from the registry)
test("the catalogue: Antigravity in Gemini CLI's place, installed ACP's registry's way, known by its program, its folder by GEMINI_HOME", () => {
  const ids = AGENT_CATALOGUE.map((a) => a.id);
  assert.deepEqual(ids, ["claude-code", "codex", "cursor", "cursor-sdk", "antigravity-acp", "qoder", "qoder-cn"]);
  assert.equal(KNOWN_AGENTS.some((a) => a.id === "gemini"), false);
  const a = /** @type {any} */ (KNOWN_AGENTS.find((x) => x.id === "antigravity-acp"));
  assert.deepEqual([a.prefix, a.registry, a.install, viaRegistry(a), installCommand(a, "win32")], ["antigravity", "antigravity-acp", { registry: "antigravity-acp" }, true, null]);
  // It signs in on its card alone: no line for a terminal (the review of 11-10: its card showed a sentence as one).
  assert.equal(a.login, undefined);
  for (const command of ["C:\\Users\\x\\AppData\\Roaming\\Filament\\agents\\installed\\antigravity-acp\\1.4.5\\program\\agy_acp_server.exe", "/home/x/.local/share/filament/agents/installed/antigravity-acp/1.4.5/program/agy_acp_server.par"]) {
    const u = { id: "antigravity-acp", type: "acp", acp: { command } };
    assert.equal(agentKey(u), "antigravity-acp", command);
    // Its own words: "Gemini home resolved to … (from $GEMINI_HOME)", its settings under that folder (read in 1.4.5).
    assert.equal(agentHomeVar(u), "GEMINI_HOME", "an account of its own is a folder of its own");
  }
  assert.equal(agentKey({ type: "acp", acp: { command: "gemini" } }), "gemini", "a kept Gemini CLI is an agent made by hand");
  assert.equal(agentHomeVar({ type: "acp", acp: { command: "gemini" } }), null);
  assert.match(RETIRED_AGENTS.gemini, /Google retired it for Antigravity/);
  // Why alone: what becomes of a connection is its card's to say, by how it stands (test/coding-agents.test.js).
  assert.doesNotMatch(RETIRED_AGENTS.gemini, /turned off|leaves your settings|list above/i);
  // No PATH holds it, and no template starts it by its name: Settings → Coding agents downloads and connects it.
  assert.equal(detectAgents().some((x) => x.id === "antigravity-acp" || x.id === "gemini"), false);
  assert.equal(TEMPLATES.some((t) => /antigravity|gemini-via-acp/.test(t.id)), false, TEMPLATES.map((t) => t.id).join(", "));
});

// (fails before: yes — the owner's of 11-22: Filament ran the registry's agy_acp_server, which read GEMINI_HOME; Google's
// agy reads none, keeps every folder's Google sign-in in one keyring entry, and signs a folder's in only in a terminal)
test("agy: known by each of its names; an account's folder is its --gemini-dir, its sign-in kept there, signed in in a terminal; the Default account and the older server as before", () => {
  const win = "C:\\Users\\x\\AppData\\Roaming\\Filament\\agents\\installed\\antigravity-acp\\1.5.14\\program\\agy.exe";
  const mac = "/Users/x/Library/Application Support/Filament/agents/installed/antigravity-acp/1.5.14/program/antigravity";
  const old = "C:\\Users\\x\\AppData\\Roaming\\Filament\\agents\\installed\\antigravity-acp\\1.4.5\\program\\agy_acp_server.exe";
  for (const command of [win, mac, old]) assert.equal(agentKey({ type: "acp", acp: { command } }), "antigravity-acp", command);
  const args = ["acp", "--app-data-dir", "antigravity-acp"];
  const env = { AGY_CLI_DISABLE_AUTO_UPDATE: "1" };
  const home = "C:\\Users\\x\\AppData\\Roaming\\Filament\\accounts\\antigravity-acp-work";
  const base = { id: "antigravity-acp", name: "Antigravity (agent via ACP)", type: "acp", acp: { command: win, args, env } };
  const work = { ...base, id: "antigravity-acp-work", name: "Antigravity · Work", acp: { ...base.acp, home } };
  // The Default account: ~/.gemini, Google's page by its own ways, no terminal line.
  assert.deepEqual([agentArgs(base.acp), agentLaunchEnv(base), catalogueSignIn(base), signInLine(base, "win32"), signsInInTerminal(base)], [args, env, null, null, false]);
  // An account of its own: its folder on the command line, its sign-in kept there, signed in by `agy acp --login`.
  const ssh = { SSH_CONNECTION: "127.0.0.1 0 127.0.0.1 0" };
  assert.deepEqual(agentArgs(work.acp), [...args, "--gemini-dir", home]);
  assert.deepEqual(agentLaunchEnv(work), { ...env, ...ssh, GEMINI_HOME: home });
  assert.deepEqual(catalogueSignIn(work), { name: "Antigravity", command: win, args: [...args, "--login", "--gemini-dir", home], env: { ...env, ...ssh, GEMINI_HOME: home } });
  assert.equal(signsInInTerminal(work), true);
  assert.equal(
    signInLine(work, "win32"),
    `$env:SSH_CONNECTION='127.0.0.1 0 127.0.0.1 0'; $env:GEMINI_HOME='${home}'; ${win} acp --app-data-dir antigravity-acp --login --gemini-dir ${home}; Remove-Item Env:SSH_CONNECTION; Remove-Item Env:GEMINI_HOME`,
  );
  assert.deepEqual(agentArgs({ ...work.acp, args: [] }), ["--gemini-dir", home], "its folder follows whatever arguments it has");
  // The older server, until its card's Update: its folder by GEMINI_HOME alone, as it read it.
  const before = { ...work, acp: { command: old, args: [], env: {}, home } };
  assert.deepEqual([agentArgs(before.acp), agentLaunchEnv(before), catalogueSignIn(before), signsInInTerminal(before)], [[], { GEMINI_HOME: home }, null, false]);
  // Any other agent with a folder of its own is as it was.
  const claude = { id: "claude-code-work", type: "acp", acp: { command: "claude-agent-acp", args: [], home: "/x/claude-work" } };
  assert.deepEqual([agentArgs(claude.acp), agentLaunchEnv(claude)], [[], { CLAUDE_CONFIG_DIR: "/x/claude-work" }]);
});

// (fails before: yes — an added account's card offered Google's page, which agy refuses for a folder's sign-in: "No
// browser is available here (this is a remote (SSH) session…)")
test("an added account's ways to sign in: agy acp --login in a terminal, its pages not offered; the Default account keeps Google's page", async () => {
  const win = "C:\\Filament\\agents\\installed\\antigravity-acp\\1.5.14\\program\\agy.exe";
  const args = ["acp", "--app-data-dir", "antigravity-acp"];
  const home = "C:\\Filament\\accounts\\antigravity-acp-work";
  const base = { id: "antigravity-acp", name: "Antigravity (agent via ACP)", type: "acp", acp: { command: win, args, env: {} } };
  const work = { ...base, id: "antigravity-acp-work", name: "Antigravity · Work", acp: { ...base.acp, home } };
  // Its four ways it carries out itself, as agy names them to a client that runs no terminal sign-in.
  const ways = ["oauth-personal", "oauth-business", "gemini-api-key", "agent-platform"].map((id) => ({ kind: "agent", id, name: id, description: "" }));
  const bridge = new AcpBridge(/** @type {any} */ ({ log: () => {} }));
  try {
    for (const u of [base, work]) bridge.profiles.put(u.id, /** @type {any} */ ({ ways }));
    assert.deepEqual((await bridge.signInWays(base)).map((w) => [w.id, w.kind]), ways.map((w) => [w.id, "browser"]));
    const own = await bridge.signInWays(work);
    assert.deepEqual(own.map((w) => [w.id, w.kind]), [["cli", "terminal"]]);
    const cli = /** @type {any} */ (own[0]);
    assert.deepEqual([cli.command, cli.args, cli.env.SSH_CONNECTION], [win, [...args, "--login", "--gemini-dir", home], "127.0.0.1 0 127.0.0.1 0"]);
  } finally {
    bridge.shutdown();
  }
});

// (fails before: yes — agy 1.5.14 names a terminal way of its own to a client that runs them, and the card then offered
// an added account every way, Google's pages among them)
test("agy's own terminal sign-in: an added account's only way, run in its folder; the Default account has it beside Google's page", async () => {
  const win = "C:\\Filament\\agents\\installed\\antigravity-acp\\1.5.14\\program\\agy.exe";
  const args = ["acp", "--app-data-dir", "antigravity-acp"];
  const home = "C:\\Filament\\accounts\\antigravity-acp-work";
  const base = { id: "antigravity-acp", name: "Antigravity (agent via ACP)", type: "acp", acp: { command: win, args, env: {} } };
  const work = { ...base, id: "antigravity-acp-work", name: "Antigravity · Work", acp: { ...base.acp, home } };
  // Its ways as agy 1.5.14 names them to a client that declares `auth.terminal`, Filament's.
  const pages = ["oauth-personal", "oauth-business", "gemini-api-key", "agent-platform"].map((id) => ({ kind: "agent", id, name: id, description: "" }));
  const ways = [...pages, { kind: "terminal", id: "terminal-login", name: "Log in from the terminal", description: "", args: ["--login"], env: {} }];
  const bridge = new AcpBridge(/** @type {any} */ ({ log: () => {} }));
  try {
    for (const u of [base, work]) bridge.profiles.put(u.id, /** @type {any} */ ({ ways }));
    const mine = await bridge.signInWays(base);
    assert.deepEqual(mine.map((w) => [w.id, w.kind]), [...pages.map((w) => [w.id, "browser"]), ["terminal-login", "terminal"]]);
    assert.deepEqual([/** @type {any} */ (mine[4]).args, /** @type {any} */ (mine[4]).env.SSH_CONNECTION], [[...args, "--login"], undefined]);
    const own = await bridge.signInWays(work);
    assert.deepEqual(own.map((w) => [w.id, w.kind]), [["terminal-login", "terminal"]]);
    const t = /** @type {any} */ (own[0]);
    assert.deepEqual([t.command, t.args, t.env.SSH_CONNECTION, t.env.GEMINI_HOME], [win, [...args, "--gemini-dir", home, "--login"], "127.0.0.1 0 127.0.0.1 0", home]);
  } finally {
    bridge.shutdown();
  }
});

test("Filament tells an agent its own version as it starts, package.json's", () => {
  const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"));
  assert.deepEqual(CLIENT_INFO, { name: "Filament", version: pkg.version });
});

// (fails before: yes — every install kept the Gemini CLI it seeded, off, with its route on, holding `gemini/*`; then, the
// review of 11-10, one turned off that held a key of the person's went too, and on every write)
test("settings read: a seeded Gemini CLI still off goes with its route; one turned on, or holding a key or a folder, stays; a write takes none", () => {
  const seeded = { id: "gemini", name: "Gemini CLI (agent via ACP)", type: "acp", enabled: false, acp: { command: "gemini", args: ["--acp"], turnedOff: true } };
  const api = { id: "google", name: "Google", type: "openai-compatible", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiKey: "k" };
  // (a fallback that names it is the person's, and keeps it: the test below)
  const routes = [
    { match: "gemini/*", upstream: "gemini", upstreamModel: "{1}" },
    { match: "gemini-2.5-*", upstream: "google", upstreamModel: "{model}" },
  ];
  /** @param {any} u */
  const read = (u) => withoutRetiredAgents(normalizeConfig({ upstreams: [u, api], routes }));
  const off = read(seeded);
  assert.deepEqual(off.upstreams.map((/** @type {any} */ u) => u.id), ["google"]);
  assert.deepEqual(off.routes.map((/** @type {any} */ r) => [r.match, r.upstream]), [["gemini-2.5-*", "google"]]);
  for (const [why, u] of /** @type {[string, any][]} */ ([
    ["turned on: it runs as it is set up", { ...seeded, enabled: true, acp: { command: "gemini", args: ["--acp"] } }],
    ["a key of the person's in its environment", { ...seeded, acp: { ...seeded.acp, env: { GEMINI_API_KEY: "g-1" } } }],
    ["an account's folder of its own", { ...seeded, acp: { ...seeded.acp, home: "/x/gemini-work" } }],
    // (fails before: yes — the bug hunt of 7c404ad4f: one turned off with the person's MCP servers or typed model names
    // went at the next start)
    ["an MCP server of the person's", { ...seeded, acp: { ...seeded.acp, mcpServers: [{ name: "docs", type: "http", url: "https://docs.example.test/mcp" }] } }],
    ["model names typed on its card", { ...seeded, models: ["gemini-3-pro"] }],
  ])) {
    const kept = read(u);
    assert.deepEqual(kept.upstreams.map((/** @type {any} */ x) => x.id), ["gemini", "google"], why);
    assert.deepEqual(kept.routes.map((/** @type {any} */ r) => r.match), ["gemini/*", "gemini-2.5-*"], why);
  }
  // A write normalizes; it takes nothing, so a Turn off never takes the agent from under its own process.
  assert.deepEqual(normalizeConfig({ upstreams: [seeded, api], routes }).upstreams.map((/** @type {any} */ u) => u.id), ["gemini", "google"]);
  // An upstream named gemini that is no Gemini CLI is never touched.
  const other = withoutRetiredAgents(normalizeConfig({ upstreams: [{ ...api, id: "gemini", enabled: false }], routes: [routes[0]] }));
  assert.deepEqual([other.upstreams.length, other.routes.length], [1, 1]);
  // Read from its file: gone, and the file written without it.
  const dir = mkdtempSync(join(tmpdir(), "filament-retired-"));
  const cfg = defaultConfig();
  cfg.server.inboundKeys = ["k"];
  cfg.server.encryptSecrets = false;
  writeFileSync(join(dir, "config.json"), JSON.stringify({ ...cfg, upstreams: [seeded, api], routes }));
  const loaded = loadConfig(dir).config;
  assert.deepEqual(loaded.upstreams.map((/** @type {any} */ u) => u.id), ["google"]);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "config.json"), "utf8")).upstreams.map((/** @type {any} */ u) => u.id), ["google"]);
});

/** Gemini CLI's upstream and route as an install wrote them until 11-10 (core/catalogues.js `agentUpstream`, `agentRoute`). */
const SEEDED = {
  id: "gemini", name: "Gemini CLI (agent via ACP)", type: "acp", baseUrl: "", apiKey: "", authStyle: "auto", enabled: false, discoverModels: true, models: [], rules: {},
  acp: {
    command: "gemini", args: ["--acp"], env: {}, listModelsArgs: [], authenticate: false, modelSelection: "arg", mode: "yolo",
    modeAliases: { agent: ["yolo", "autoEdit"], plan: ["plan"], ask: ["plan", "default"] }, permissions: "allow-all", thoughts: "auto", toolActivity: "text", cwdSource: "client",
  },
};
const SEEDED_ROUTE = { match: "gemini/*", upstream: "gemini", upstreamModel: "{1}", format: "auto", fallbacks: [], discoverPrefixes: [], enabled: false, rules: {} };

// (fails before: yes — the Fable 5.2 re-read's finding 7: only a variable, an MCP server, a model name and a folder
// counted as the person's, so one turned off went at the next start with its arguments, its permission policy, its
// rules and the routes made for it by hand, and nothing said so)
test("settings read: a Gemini CLI still off goes only as its install wrote it; any setting, route or fallback made by hand keeps it", () => {
  const api = { id: "google", name: "Google", type: "openai-compatible", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiKey: "k" };
  const own = { match: "gemini-2.5-*", upstream: "google", upstreamModel: "{model}" };
  /** @param {any} u @param {any[]} [routes] @param {any[]} [more] */
  const read = (u, routes = [SEEDED_ROUTE], more = []) => withoutRetiredAgents(normalizeConfig({ upstreams: [u, api, ...more], routes: [...routes, own] }));
  /** @param {any} cfg */
  const said = (cfg) => [cfg.upstreams.map((/** @type {any} */ u) => u.id), cfg.routes.map((/** @type {any} */ r) => r.match)];
  // As its install wrote it — never turned on, or turned off in Settings — it goes, and its route with it.
  for (const u of [SEEDED, { ...SEEDED, acp: { ...SEEDED.acp, turnedOff: true } }]) assert.deepEqual(said(read(u)), [["google"], ["gemini-2.5-*"]]);
  const rule = { thinking: { mode: "disabled" } };
  const cases = /** @type {[string, any, any[]?, any[]?][]} */ ([
    ["arguments of the person's", { ...SEEDED, acp: { ...SEEDED.acp, args: ["--acp", "--sandbox"] } }],
    ["its program by a path", { ...SEEDED, acp: { ...SEEDED.acp, command: "/opt/gemini/bin/gemini" } }],
    ["a permission policy chosen", { ...SEEDED, acp: { ...SEEDED.acp, permissions: "ask" } }],
    ["a mode chosen", { ...SEEDED, acp: { ...SEEDED.acp, mode: "plan" } }],
    ["a folder it starts in", { ...SEEDED, acp: { ...SEEDED.acp, cwdDefault: "/work" } }],
    ["a rule on it", { ...SEEDED, rules: rule }],
    ["a name given", { ...SEEDED, name: "Gemini (work)" }],
    ["a model's card tuned", { ...SEEDED, pricing: { "gemini-3-pro": { contextTokens: 1_000_000 } } }],
    ["a route made for it by hand", SEEDED, [SEEDED_ROUTE, { match: "g3", upstream: "gemini", upstreamModel: "gemini-3-pro" }]],
    ["its own route sent to one model", SEEDED, [{ ...SEEDED_ROUTE, upstreamModel: "gemini-3-pro" }]],
    ["a rule on its route", SEEDED, [{ ...SEEDED_ROUTE, rules: rule }]],
    ["a fallback that names it", SEEDED, [SEEDED_ROUTE, { match: "gemini-3-*", upstream: "google", upstreamModel: "{model}", fallbacks: [{ upstream: "gemini" }] }]],
    ["a second connection that runs Gemini CLI", SEEDED, [SEEDED_ROUTE], [{ ...SEEDED, id: "gemini-work", enabled: true }]],
  ]);
  const went = cases.filter(([, u, routes, more]) => !read(u, routes, more).upstreams.some((/** @type {any} */ x) => x.id === "gemini")).map(([why]) => why);
  assert.deepEqual(went, [], "each of these is the person's: the connection stays");
  // What stays keeps every route and fallback as it was.
  const kept = read(SEEDED, [SEEDED_ROUTE, { match: "gemini-3-*", upstream: "google", upstreamModel: "{model}", fallbacks: [{ upstream: "gemini" }] }]);
  assert.deepEqual(kept.routes.map((/** @type {any} */ r) => [r.match, r.fallbacks.length]), [["gemini/*", 0], ["gemini-3-*", 1], ["gemini-2.5-*", 0]]);
});

// (fails before: yes — the review of 11-10: Turn off on a kept Gemini CLI wrote it off, and the write took it, its
// routes and its process's let-go with it; Antigravity's guide and notes never reached the Upstreams page, which read them
// from detection, which leaves it out)
test("through the app: a kept Gemini CLI turned off stays; Antigravity's card on the Upstreams page has the catalogue's words", async () => {
  const root = mkdtempSync(join(tmpdir(), "filament-antigravity-"));
  mkdirSync(join(root, "work"));
  const shim = await startApp({
    configure: (cfg) => {
      cfg.upstreams = [
        // Never started: no such program, by its path (a bare name might find the person's own).
        { id: "gemini", name: "Gemini CLI (agent via ACP)", type: "acp", enabled: true, acp: { command: join(root, "bin", "gemini.exe"), args: ["--acp"] } },
        // Antigravity, as the fake agent plays it.
        { id: "antigravity-acp", name: "Antigravity (agent via ACP)", type: "acp", enabled: true, acp: { command: process.execPath, args: [FAKE], env: {}, cwdDefault: join(root, "work"), permissions: "allow-all" } },
      ];
      cfg.routes = [
        { match: "gemini/*", upstream: "gemini", upstreamModel: "{1}" },
        { match: "antigravity/*", upstream: "antigravity-acp", upstreamModel: "{1}" },
      ];
    },
  });
  try {
    const listed = await (await shim.api("/api/coding-agents")).json();
    assert.equal(listed.entries.find((/** @type {any} */ e) => e.id === "gemini")?.about, RETIRED_AGENTS.gemini);
    const r = await shim.api("/api/coding-agents/gemini/off", { method: "POST" });
    assert.equal(r.status, 200, await r.clone().text());
    const g = shim.app.config.upstreams.find((/** @type {any} */ u) => u.id === "gemini");
    assert.deepEqual([g?.enabled, g?.acp?.turnedOff], [false, true], "turned off, kept");
    assert.ok(shim.app.config.routes.some((/** @type {any} */ x) => x.upstream === "gemini"), "its route kept");
    const a = /** @type {any} */ (KNOWN_AGENTS.find((x) => x.id === "antigravity-acp"));
    const o = await (await shim.api("/api/acp/antigravity-acp/offer")).json();
    assert.deepEqual([o.guide, o.notes, o.account, o.login, o.prefix], [a.guide, a.notes, a.account, null, "antigravity/"]);
  } finally {
    await shim.stop();
    await removeDirs(root);
  }
});
