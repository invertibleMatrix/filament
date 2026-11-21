// @ts-check
// HarnessV3-ACP AC3-7: more than one account for a coding agent. The lines a terminal runs and the words that point
// to Settings (core/catalogues.js); an agent's route placed above a broader one (core/routing.js); a change refused
// where it would leave the configuration invalid (app/config-change.js); and, through the whole app against the fake
// agents, an account added beside an agent's Default, signed in each agent's own way — the program Claude's adapter
// names, run in a terminal in the account's folder (a stand-in for node-pty runs the fakes); Codex's app-server, its
// page or its code, and `codex login` where it can't start; Cursor's SDK, which makes a key — stopped, signed out,
// renamed and removed.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { agentName, agentTitle, commandLine, signInAdvice, signInLine } from "../src/core/catalogues.js";
import { placeAgentRoute } from "../src/core/routing.js";
import { BROWSER_WAIT_MS, createAgentLogins } from "../src/app/agent-logins.js";
import { changeConfig } from "../src/app/config-change.js";
import { startApp, FAKE_ACP_AGENT, FIXTURES } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const FAKE_CODEX = join(FIXTURES, "fake-codex-app-server.mjs");
const FAKE_SDK = pathToFileURL(join(FIXTURES, "fake-cursor-sdk.mjs")).href;

/** @type {any} */
const MAX = { kind: "account", label: "Claude Max", plan: "max", email: "dev@example.com", organization: "Example Org", detail: null, billing: "plan" };
/** @type {any} */
const PLUS = { kind: "account", label: "ChatGPT Plus", plan: "plus", email: "dev@example.com", organization: null, detail: null, billing: "plan" };

/**
 * Every line the app's log says while a test runs, kept instead of printed (server.js `log` writes to the console):
 * its undo given back. @param {string[]} into @returns {() => void}
 */
const hear = (into) => {
  const was = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  for (const k of /** @type {const} */ (["log", "info", "warn", "error", "debug"])) console[k] = (...args) => void into.push(args.map(String).join(" "));
  return () => Object.assign(console, was);
};

describe("the lines a terminal runs, and the words that point to Settings (core/catalogues.js)", () => {
  test("on Windows, PowerShell's: a variable set for the command alone, its value quoted; a quoted program through its call operator", () => {
    assert.equal(commandLine(["claude", "auth", "login"], {}, "win32"), "claude auth login");
    assert.equal(
      commandLine(["claude", "auth", "login"], { CLAUDE_CONFIG_DIR: "C:\\Users\\x\\accounts\\claude-code-work" }, "win32"),
      "$env:CLAUDE_CONFIG_DIR='C:\\Users\\x\\accounts\\claude-code-work'; claude auth login; Remove-Item Env:CLAUDE_CONFIG_DIR",
    );
    assert.equal(commandLine(["C:\\Program Files\\nodejs\\node.exe", "a b", "it's"], {}, "win32"), "& 'C:\\Program Files\\nodejs\\node.exe' 'a b' 'it''s'");
  });

  test("elsewhere, a POSIX shell's: the variable before the command, quoted where it needs it", () => {
    assert.equal(commandLine(["codex", "login"], { CODEX_HOME: "/home/x/codex" }, "darwin"), "CODEX_HOME=/home/x/codex codex login");
    assert.equal(commandLine(["codex", "login"], { CODEX_HOME: "/home/x/it's" }, "linux"), "CODEX_HOME='/home/x/it'\\''s' codex login");
  });

  test("an agent's sign-in line: the program its sign-in runs, with an added account's folder; none for Cursor's SDK route or an agent Filament doesn't know", () => {
    assert.equal(signInLine({ type: "codex", acp: { home: "D:\\h" } }, "win32"), "$env:CODEX_HOME='D:\\h'; codex login; Remove-Item Env:CODEX_HOME");
    assert.equal(signInLine({ type: "acp", acp: { command: "claude-agent-acp" } }, "linux"), "claude auth login");
    assert.equal(signInLine({ type: "acp", acp: { command: "qodercli", home: "/x" } }, "linux"), "qodercli login", "Qoder reads no folder of its own");
    assert.equal(signInLine({ type: "acp", acp: { command: "C:\\f\\agy_acp_server.exe", home: "C:\\h" } }, "win32"), null, "Antigravity's ways are its own, whatever its folder");
    assert.equal(signInLine({ type: "cursor-sdk" }, "win32"), null);
    assert.equal(signInLine({ type: "acp", acp: { command: "my-agent" } }, "linux"), null);
    // (fails before: yes — the line named the catalogue's `agent login`, which runs nothing where Cursor's CLI is
    // another program: its old name, a full path)
    assert.equal(signInLine({ type: "acp", acp: { command: "C:\\Tools\\cursor-agent.cmd" } }, "win32"), "C:\\Tools\\cursor-agent.cmd login");
    // (fails before: yes — the line named `codex login`, not the program Filament runs Codex with)
    assert.equal(signInLine({ type: "codex", acp: { command: "npx", args: ["-y", "@openai/codex", "app-server"] } }, "linux"), "npx -y @openai/codex login");
  });

  test("an agent's name in a sentence, and where one nobody signed in to is signed in", () => {
    assert.equal(agentTitle({ id: "x", name: "Claude Code (agent via ACP)" }), "Claude Code");
    assert.equal(agentTitle({ id: "x" }), "x");
    assert.equal(agentTitle(null), "The agent");
    // The agent alone, for its accounts' card and its sign-in's name: an added account's name off.
    assert.deepEqual([agentName({ id: "x", name: "Claude Code · Work" }), agentName({ id: "x", name: "Claude Code (agent via ACP)" }), agentName({ id: "cx" })], ["Claude Code", "Claude Code", "cx"]);
    assert.equal(signInAdvice({ type: "codex", acp: {} }, "linux"), "Sign in under Settings → Coding agents in Filament's harness, or run `codex login` in a terminal");
    assert.equal(signInAdvice({ type: "acp", acp: { command: "my-agent" } }, "linux"), "Sign in under Settings → Coding agents in Filament's harness");
  });
});

describe("an agent's route placed (core/routing.js placeAgentRoute)", () => {
  /** @param {string} match @param {string} upstream @param {boolean} [enabled] */
  const r = (match, upstream, enabled = true) => ({ match, upstream, enabled });

  test("a new one goes before the catch-all; one a broader route above would catch moves to the top", () => {
    const routes = [r("claude-code/*", "claude-code"), r("*", "api")];
    assert.equal(placeAgentRoute(routes, "claude-code-work", "claude-code-work", r("claude-code-work/*", "claude-code-work")), null);
    assert.deepEqual(routes.map((x) => x.match), ["claude-code/*", "claude-code-work/*", "*"]);
    const shadowed = [r("claude-code/*", "claude-code"), r("claude-*", "api"), r("*", "api")];
    assert.deepEqual(placeAgentRoute(shadowed, "claude-code-work", "claude-code-work", r("claude-code-work/*", "claude-code-work")), { moved: "claude-code-work/*", above: "claude-*" });
    assert.deepEqual(shadowed.map((x) => x.match), ["claude-code-work/*", "claude-code/*", "claude-*", "*"]);
  });

  test("one already there is not added again; a route turned off catches nothing; with no catch-all, the end", () => {
    const routes = [r("claude-*", "api", false), r("a/*", "a")];
    assert.equal(placeAgentRoute(routes, "claude-x", "claude-x", r("claude-x/*", "claude-x")), null);
    assert.equal(placeAgentRoute(routes, "claude-x", "claude-x", r("claude-x/*", "claude-x")), null);
    assert.deepEqual(routes.map((x) => x.match), ["claude-*", "a/*", "claude-x/*"]);
  });
});

describe("a change a feature makes to the configuration (app/config-change.js)", () => {
  // (fails before: no — a guard the mutation pass asked for: no feature's change was ever an invalid one)
  test("one that would leave the configuration invalid is refused with what was wrong, and nothing is kept", () => {
    /** @type {string[]} */
    const kept = [];
    const store = { set: () => void kept.push("set"), save: () => void kept.push("saved") };
    const up = { id: "cc", name: "Claude Code", type: "acp", acp: { command: "claude-agent-acp" } };
    assert.throws(() => changeConfig(store, { upstreams: [up, up], routes: [] }), {
      status: 400,
      message: 'the change would leave an invalid configuration: upstreams[1].id "cc" is duplicated',
    });
    assert.deepEqual(kept, []);
    changeConfig(store, { upstreams: [up], routes: [] });
    assert.deepEqual(kept, ["set", "saved"]);
  });
});

describe("more than one account through the app: added, signed in each agent's way, stopped, signed out, renamed, removed", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  // Made once the suite runs: a run filtered to other suites leaves no folder behind.
  let root = "";
  let projDir = "";
  /** Claude's adapter as the catalogue knows it, by its program's name: node under that name, running the fake. */
  let exe = "";
  /** @type {{ file: string, args: string[], cwd: string, home: string | null, out: string, child: import("node:child_process").ChildProcess }[]} */
  const ran = [];
  /**
   * A stand-in for node-pty (`terminalSpawn`): the program runs as a child process, its output kept. Only the fakes
   * run — anything else is refused, as node-pty refuses a program it can't start — so no real CLI ever starts here.
   * @param {any} o
   */
  const terminalSpawn = (o) => {
    if (![exe, process.execPath].includes(o.file) || ![FAKE_ACP_AGENT, FAKE_CODEX].includes(o.args[0]))
      throw new Error(`the stand-in runs only the fakes, not ${o.file} ${o.args.join(" ")}`);
    const child = spawn(o.file, o.args, { cwd: o.cwd, env: o.env, windowsHide: true });
    const t = { file: o.file, args: o.args, cwd: o.cwd, home: o.env.CLAUDE_CONFIG_DIR || o.env.CODEX_HOME || null, out: "", child };
    ran.push(t);
    /** @type {((d: string) => void)[]} */
    const data = [];
    /** @type {((e: any) => void)[]} */
    const exits = [];
    const said = (/** @type {Buffer} */ b) => {
      t.out += String(b);
      for (const fn of data) fn(String(b));
    };
    child.stdout.on("data", said);
    child.stderr.on("data", said);
    child.on("close", (code) => {
      for (const fn of exits) fn({ exitCode: code, signal: 0 });
    });
    return {
      write: (/** @type {string} */ d) => child.stdin.write(d),
      resize: () => {},
      kill: () => child.kill(),
      onData: (/** @type {any} */ fn) => data.push(fn),
      onExit: (/** @type {any} */ fn) => exits.push(fn),
    };
  };

  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-logins-"));
    projDir = join(root, "project");
    mkdirSync(projDir);
    writeFileSync(join(projDir, "README.md"), "hello\n");
    const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: projDir, stdio: "ignore" });
    git("init", "-q");
    git("add", ".");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init");
    for (const d of ["bin", "default-home", "broken-home", "wait-home", "codex-home", "codex-wait-home", "codex-broken-home", "codex-key-home"]) mkdirSync(join(root, d));
    exe = join(root, "bin", process.platform === "win32" ? "claude-agent-acp.exe" : "claude-agent-acp");
    if (process.platform === "win32") copyFileSync(process.execPath, exe);
    else symlinkSync(process.execPath, exe);
    process.env.FAKE_SDK_LOG = join(root, "sdk.jsonl");
    /** Claude's adapter, as the fake plays it, its login kept in its folder. @param {string} home @param {Record<string, string>} [env] */
    const claude = (home, env = {}) => ({
      command: exe,
      args: [FAKE_ACP_AGENT],
      env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_HOME_LOGIN: "1", CLAUDE_CONFIG_DIR: join(root, home), ...env },
      cwdDefault: projDir,
      permissions: "allow-all",
      hints: false,
    });
    /** Codex's app-server, as the fake plays it, its login kept in CODEX_HOME. @param {string} home @param {Record<string, string>} [env] */
    const codex = (home, env = {}) => ({
      command: process.execPath,
      args: [FAKE_CODEX],
      env: { FAKE_CODEX_SIGNED_OUT: "home", CODEX_HOME: join(root, home), FAKE_CODEX_CALLS: join(root, `${home}.calls.jsonl`), ...env },
      cwdDefault: projDir,
      permissions: "allow-all",
    });
    shim = await startApp({
      overrides: { cursorSdkLoader: () => import(FAKE_SDK), terminalSpawn },
      configure: (cfg, { dataDir }) => {
        cfg.upstreams = [
          // Named as detection names it.
          { id: "claude-code", name: "Claude Code (agent via ACP)", type: "acp", acp: claude("default-home") },
          { id: "claude-broken", name: "Claude (broken)", type: "acp", acp: claude("broken-home", { FAKE_ACP_LOGIN_EXIT: "2" }) },
          { id: "claude-wait", name: "Claude (waits)", type: "acp", acp: claude("wait-home", { FAKE_ACP_LOGIN_EXIT: "wait" }) },
          { id: "cx", name: "Codex", type: "codex", acp: codex("codex-home") },
          { id: "cxwait", name: "Codex (waits)", type: "codex", acp: codex("codex-wait-home", { FAKE_CODEX_LOGIN: "wait" }) },
          { id: "cxbroken", name: "Codex (broken)", type: "codex", acp: codex("codex-broken-home", { FAKE_CODEX_START_FAIL: "1" }) },
          { id: "cxkey", name: "Codex (key)", type: "codex", acp: codex("codex-key-home") },
          { id: "cursor", name: "Cursor", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: projDir, permissions: "allow-all", hints: false } },
          // Qoder keeps one login on a computer; never started here (there is no such program).
          { id: "qd", name: "Qoder", type: "acp", acp: { command: join(root, "bin", "qodercli.exe"), args: ["--acp"] } },
          { id: "api", name: "API", type: "anthropic", baseUrl: "http://127.0.0.1:9", apiKey: "k", enabled: true },
        ];
        cfg.routes = [
          ...["claude-code", "claude-broken", "claude-wait", "cx", "cxwait", "cxbroken", "cxkey", "cursor", "qd"].map((id) => ({ match: `${id}/*`, upstream: id, upstreamModel: "{1}", enabled: true })),
          // Broader than an added Claude account's names: its route goes above this one.
          { match: "claude-*", upstream: "api", enabled: true },
          { match: "*", upstream: "api", enabled: true },
        ];
        // The models Claude Code listed at its last Refresh: an account added beside it starts with them.
        writeFileSync(join(dataDir, "models-cache.json"), JSON.stringify({ local: { "claude-code": { at: 1, names: ["fake-a", "fake-b"] } } }));
      },
    });
  });
  after(async () => {
    await shim?.stop();
    for (const t of ran) if (t.child.exitCode === null && t.child.signalCode === null) t.child.kill();
    delete process.env.FAKE_SDK_LOG;
    delete process.env.FAKE_SDK_LOGIN;
    await removeDirs(root);
  });

  /** @returns {Promise<any[]>} */
  const rows = async () => (await (await shim.api("/api/agent-accounts")).json()).agents;
  /** @param {string} id */
  const row = async (id) => (await rows()).find((r) => r.upstream === id);
  /** A change to the accounts through their routes: the status and the answer. @param {string} method @param {string} path @param {unknown} [body] */
  const call = async (method, path, body) => {
    const res = await shim.api(`/api/agent-accounts${path}`, { method, body });
    return { status: res.status, ...(await res.json()) };
  };
  /** The account's row once its sign-in ended. @param {string} id */
  const ended = (id) =>
    until(async () => {
      const r = await row(id);
      return r?.lastSignIn && !r.signingIn ? r : null;
    }, `${id}'s sign-in to end`, { timeoutMs: 20_000 });
  /** @returns {Promise<any>} */
  const configNow = async () => (await (await shim.api("/api/state")).json()).config;
  /** One turn of a chat client's: its status and what it said, a refusal's words. @param {string} model @param {string} text */
  const turn = async (model, text) => {
    const res = await shim.post("/v1/messages", { model, max_tokens: 100, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: text }] });
    const body = await res.text();
    return { status: res.status, body, error: res.status === 200 ? undefined : String(JSON.parse(body)?.error?.message), id: String(res.headers.get("x-filament-request-id")) };
  };
  /** The added Claude account's folder. */
  const home = () => join(shim.dataDir, "accounts", "claude-code-work");

  test("every coding agent's row says how it signs in: its account's name, its ways, whether it signs out, whether it can add accounts", async () => {
    const all = await rows();
    /** @param {string} id */
    const pick = (id) => {
      const r = all.find((x) => x.upstream === id);
      return [r.agentName, r.style, r.label, r.added, r.home, r.oneAccount, r.ways.map((/** @type {any} */ w) => w.id), r.signsOut, r.signingIn, r.lastSignIn, r.login];
    };
    assert.deepEqual(pick("claude-code"), ["Claude Code", "folder", "Default", false, null, null, ["cli"], false, null, null, "claude auth login"]);
    // (fails before: yes — the row carried the upstream's own name, "Claude Code (agent via ACP)", into every sentence)
    assert.equal(all.find((x) => x.upstream === "claude-code").name, "Claude Code", "named as the pages name it: the catalogue's suffix off");
    assert.deepEqual(all.find((x) => x.upstream === "claude-code").ways, [{ id: "cli", name: "Claude Code", description: "Its own CLI's sign-in, in a terminal" }], "before it ever ran: the catalogue's");
    assert.deepEqual(pick("cx"), ["Codex", "folder", "Default", false, null, null, ["chatgpt", "chatgpt-code", "api-key"], true, null, null, "codex login"]);
    assert.deepEqual(pick("cursor"), ["Cursor", "key", "Default", false, null, null, ["cursor", "api-key"], true, null, null, null]);
    assert.deepEqual(pick("qd"), ["Qoder", null, "Default", false, null, "Qoder keeps one login on a computer: its CLI reads it from one place, with no setting for a folder of its own", ["cli"], false, null, null, "qodercli login"]);
  });

  test("an account added beside Claude Code: its upstream and folder, its route above a broader one, its agent's model list; the open pages hear of it", async () => {
    // Claude Code's route holds something of its own, which an account added beside it takes.
    const pattern = await configNow();
    pattern.routes.find((/** @type {any} */ rt) => rt.upstream === "claude-code").discoverPrefixes = ["fake"];
    assert.equal((await shim.api("/api/config", { method: "PUT", body: pattern })).status, 200);
    /** @type {string[]} */
    const heard = [];
    const off = /** @type {any} */ (shim.app).events.subscribe("accounts", (/** @type {any} */ p) => heard.push(p.upstream));
    try {
      const r = await call("POST", "", { from: "claude-code", name: "  Work  " });
      assert.equal(r.status, 200, r.error);
      assert.deepEqual(
        [r.agent.upstream, r.agent.name, r.agent.agentName, r.agent.agent, r.agent.label, r.agent.added, r.agent.home, r.agent.style, r.agent.oneAccount, r.agent.signsOut],
        ["claude-code-work", "Claude Code · Work", "Claude Code", "claude-code", "Work", true, home(), "folder", null, false],
      );
      assert.deepEqual(r.agent.ways.map((/** @type {any} */ w) => w.name), ["Claude Code"], "its CLI's sign-in, named by its agent");
      assert.equal(r.agent.login, commandLine(["claude", "auth", "login"], { CLAUDE_CONFIG_DIR: home() }, process.platform), "its line names its folder");
      assert.ok(statSync(home()).isDirectory(), "its folder is made");
      assert.deepEqual(heard, ["claude-code-work"]);
    } finally {
      off();
    }
    const cfg = await configNow();
    const up = cfg.upstreams.find((/** @type {any} */ u) => u.id === "claude-code-work");
    assert.deepEqual([up.type, up.enabled, up.acp.command, up.acp.args, up.acp.account, up.acp.home, up.acp.cwdDefault], ["acp", true, exe, [FAKE_ACP_AGENT], "Work", home(), projDir]);
    assert.deepEqual(cfg.routes.slice(0, 2).map((/** @type {any} */ rt) => [rt.match, rt.upstream]), [["claude-code-work/*", "claude-code-work"], ["claude-code/*", "claude-code"]], "above claude-*, which would catch its names");
    // (fails before: no — a guard the mutation pass asked for: no agent's route held anything an account's route
    // takes from it)
    const [added, agent] = cfg.routes.slice(0, 2);
    assert.deepEqual({ ...added, match: agent.match, upstream: agent.upstream }, agent, "its agent's route is the pattern, under its own names");
    const ids = (await (await shim.api("/v1/models")).json()).data.map((/** @type {any} */ m) => m.id);
    assert.ok(["claude-code-work/fake-a", "claude-code-work/fake-b"].every((id) => ids.includes(id)), `its agent's models to start with: ${ids.join(", ")}`);
    await until(() => JSON.parse(readFileSync(join(shim.dataDir, "models-cache.json"), "utf8")).local?.["claude-code-work"], "its list in models-cache.json");
  });

  test("an account is refused where its agent keeps one login, where its name is empty or taken, and where there is no such agent", async () => {
    /** @param {unknown} body */
    const add = async (body) => {
      const r = await call("POST", "", body);
      return [r.status, r.error];
    };
    assert.deepEqual(await add({ from: "qd", name: "Work" }), [400, "Qoder keeps one login on a computer: its CLI reads it from one place, with no setting for a folder of its own"]);
    assert.deepEqual(await add({ from: "claude-code", name: "   " }), [400, "name the account: 1 to 40 characters"]);
    assert.deepEqual(await add({ from: "claude-code", name: "x".repeat(41) }), [400, "name the account: 1 to 40 characters"]);
    assert.deepEqual(await add({ from: "claude-code", name: "!!!" }), [400, "name the account with a letter or a number in it"]);
    assert.deepEqual(await add({ from: "claude-code", name: "work" }), [409, "there is already an upstream with the id claude-code-work: name the account another way"]);
    assert.deepEqual(await add({ from: "api", name: "Work" }), [404, "no such coding agent"]);
    assert.deepEqual(await add({ from: "nope", name: "Work" }), [404, "no such coding agent"]);
  });

  test("a turn on an account nobody signed in to is refused in words that point to Settings and to its own line", async () => {
    const { status, error } = await turn("claude-code-work/sonnet", "hello");
    assert.notEqual(status, 200);
    const line = commandLine(["claude", "auth", "login"], { CLAUDE_CONFIG_DIR: home() }, process.platform);
    assert.ok(
      String(error).includes(`Claude Code · Work is not signed in. Sign in under Settings → Coding agents in Filament's harness, or run \`${line}\` in a terminal, then send your message again.`),
      String(error),
    );
  });

  test("Claude's adapter names its two ways: the one chosen runs in a terminal, in the account's folder; ended well, the account says who it is", async () => {
    const choose = await call("POST", "/claude-code-work/sign-in", {});
    assert.equal(choose.status, 200, choose.error);
    assert.deepEqual(choose.choose.map((/** @type {any} */ w) => [w.id, w.name]), [["claude-ai-login", "Claude Subscription"], ["console-login", "Anthropic Console"]]);
    assert.equal(choose.agent.signingIn, null, "nothing starts until one is chosen");
    assert.deepEqual(choose.agent.ways.map((/** @type {any} */ w) => w.id), ["claude-ai-login", "console-login"], "the row offers the adapter's own now");
    const r = await call("POST", "/claude-code-work/sign-in", { way: "claude-ai-login" });
    assert.equal(r.status, 200, r.error);
    const s = r.signIn;
    const args = [FAKE_ACP_AGENT, "--cli", "auth", "login", "--claudeai"];
    assert.deepEqual([s.kind, s.way, s.name, s.line], ["terminal", "claude-ai-login", "Claude Subscription", commandLine([exe, ...args], { CLAUDE_CONFIG_DIR: home() }, process.platform)]);
    const t = ran.at(-1);
    assert.deepEqual([t?.file, t?.args, t?.cwd, t?.home], [exe, args, home(), home()], "the adapter's program, in the account's folder");
    const terminals = (await (await shim.api("/api/terminal")).json()).terminals;
    assert.ok(terminals.some((/** @type {any} */ x) => x.id === s.terminal && x.title === "Sign in · Claude Code · Work"), "the Terminal pane lists it by name");
    const done = await ended("claude-code-work");
    assert.deepEqual([done.lastSignIn.outcome, done.lastSignIn.error, done.signsOut], ["signed-in", null, true]);
    assert.deepEqual(done.account.identity, MAX);
    assert.match(t?.out || "", /Signing in to the fake Claude in /);
    const after = await turn("claude-code-work/sonnet", "hello");
    assert.equal(after.status, 200, `the next turn runs in the new login: ${after.error}`);
    assert.ok(!existsSync(join(root, "default-home", ".fake-login")), "the Default's login is untouched");
  });

  test("a sign-in whose program fails says so in its code; the account stays as it was", async () => {
    const r = await call("POST", "/claude-broken/sign-in", { way: "claude-ai-login" });
    assert.equal(r.status, 200, r.error);
    const done = await ended("claude-broken");
    assert.deepEqual(done.lastSignIn && [done.lastSignIn.outcome, done.lastSignIn.error], ["failed", "the sign-in ended with code 2"]);
  });

  test("one sign-in at a time; Cancel stops it, and so does closing its terminal", async () => {
    const r = await call("POST", "/claude-wait/sign-in", { way: "console-login" });
    assert.equal(r.status, 200, r.error);
    const again = await call("POST", "/claude-wait/sign-in", { way: "claude-ai-login" });
    assert.deepEqual(again.signIn, r.signIn, "asked again: the one under way");
    assert.equal((await row("claude-wait")).signingIn.terminal, r.signIn.terminal);
    const t = ran.at(-1);
    await until(() => t?.out.includes("Open the page"), "the waiting program to start");
    const stop = await call("POST", "/claude-wait/sign-in/cancel");
    assert.deepEqual([stop.status, stop.stopped, stop.agent.signingIn, stop.agent.lastSignIn.outcome, stop.agent.lastSignIn.error], [200, true, null, "cancelled", null]);
    await until(() => t?.child.exitCode !== null || t?.child.signalCode !== null, "its program to stop");
    assert.equal((await call("POST", "/claude-wait/sign-in/cancel")).stopped, false, "nothing under way to stop");
    const next = await call("POST", "/claude-wait/sign-in", { way: "claude-ai-login" });
    assert.equal(next.agent.lastSignIn, null, "a new sign-in clears how the last one ended");
    await until(() => ran.at(-1)?.out.includes("Open the page"), "the waiting program to start");
    assert.equal((await shim.api(`/api/terminal/${next.signIn.terminal}/kill`, { method: "POST" })).status, 200);
    const done = await ended("claude-wait");
    assert.deepEqual([done.lastSignIn.outcome, done.lastSignIn.error], ["cancelled", null]);
  });

  test("under a running turn an account is neither signed out nor removed; signed out, the agent says nobody is, and its next turn says where to sign in", async () => {
    const ac = new AbortController();
    const quiet = fetch(`${shim.url}/v1/messages`, {
      method: "POST",
      headers: shim.headers,
      body: JSON.stringify({ model: "claude-code-work/sonnet", max_tokens: 100, stream: true, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: "~quiet" }] }),
      signal: ac.signal,
    }).then((res) => res.text()).catch(() => null);
    await until(() => /** @type {any} */ (shim.app).acp.running("claude-code-work"), "the turn to run");
    assert.deepEqual(Object.values(await call("POST", "/claude-code-work/sign-out")), [409, "a turn is running on Claude Code · Work: sign out once the turn ends"]);
    assert.deepEqual(Object.values(await call("DELETE", "/claude-code-work")), [409, "a turn is running on Claude Code · Work: remove it once the turn ends"]);
    ac.abort();
    await quiet;
    await until(() => !(/** @type {any} */ (shim.app).acp.running("claude-code-work")), "the turn to end");
    const r = await call("POST", "/claude-code-work/sign-out");
    assert.equal(r.status, 200, r.error);
    assert.deepEqual([r.agent.lastSignIn.outcome, r.agent.account.identity.kind, r.agent.account.identity.label], ["signed-out", "none", "Not logged in"]);
    assert.ok(!existsSync(join(home(), ".fake-login")), "the adapter cleared its login in the account's folder");
    const next = await turn("claude-code-work/sonnet", "hello");
    assert.notEqual(next.status, 200);
    assert.match(String(next.error), /Claude Code · Work is not signed in\. Sign in under Settings → Coding agents in Filament's harness/);
  });

  // (fails before: no — a guard the mutation pass asked for: no account signed in as another login after its turns had
  // said its plan's windows)
  test("signed in again as another login: the next turn's record names it, with none of the last login's windows", async () => {
    const max = await call("POST", "/claude-code-work/sign-in", { way: "claude-ai-login" });
    assert.equal(max.status, 200, max.error);
    assert.deepEqual((await ended("claude-code-work")).account.identity, MAX);
    const limits = await turn("claude-code-work/sonnet", "~limits");
    assert.equal(limits.status, 200, limits.error);
    assert.equal((await call("POST", "/claude-code-work/sign-out")).status, 200);
    const key = await call("POST", "/claude-code-work/sign-in", { way: "console-login" });
    assert.equal(key.status, 200, key.error);
    assert.equal((await ended("claude-code-work")).account.identity.label, "Anthropic API key");
    const next = await turn("claude-code-work/sonnet", "hello");
    assert.equal(next.status, 200, next.error);
    const rec = await until(async () => {
      const r = await shim.record(next.id);
      return r?.acp?.account ? r : null;
    }, "the turn's record");
    assert.deepEqual([rec.acp.account.label, rec.acp.account.windows], ["Anthropic API key", []]);
  });

  test("Codex signs in on ChatGPT's page through its app-server, which reads the account afterwards; signed out, nobody is", async () => {
    const choose = await call("POST", "/cx/sign-in", {});
    assert.deepEqual(choose.choose, [
      { id: "chatgpt", name: "ChatGPT", description: "Sign in on ChatGPT's page, in this computer's browser" },
      // `far`: it finishes from a browser on another computer, which the command line sorts by (the re-read of 11-11).
      { id: "chatgpt-code", name: "ChatGPT on another device", description: "For a browser on another computer: open ChatGPT's page there and type the code it shows here", far: true },
      { id: "api-key", name: "OpenAI API key", description: "Paste a key from your OpenAI account: Codex keeps it in its own folder, and Filament keeps none", kind: "key", label: "OpenAI API key" },
    ]);
    const r = await call("POST", "/cx/sign-in", { way: "chatgpt" });
    assert.equal(r.status, 200, r.error);
    const s = r.signIn;
    assert.deepEqual([s.kind, s.way, s.name, s.code, s.line], ["browser", "chatgpt", "ChatGPT", null, commandLine([process.execPath, FAKE_CODEX, "login"], {}, process.platform)]);
    assert.match(s.url, /^https:\/\/auth\.example\.test\/oauth\/authorize\?state=login-/);
    const done = await ended("cx");
    assert.deepEqual([done.lastSignIn.outcome, done.lastSignIn.error], ["signed-in", null]);
    assert.deepEqual(done.account.identity, PLUS);
    assert.ok(existsSync(join(root, "codex-home", "fake-auth.json")), "Codex keeps the login in its folder");
    const out = await call("POST", "/cx/sign-out");
    assert.equal(out.status, 200, out.error);
    assert.deepEqual([out.agent.lastSignIn.outcome, out.agent.account.identity.kind], ["signed-out", "none"]);
    assert.ok(!existsSync(join(root, "codex-home", "fake-auth.json")));
  });

  test("an added Codex account signs in with ChatGPT's code, in its own folder", async () => {
    const add = await call("POST", "", { from: "cx", name: "Work" });
    assert.equal(add.status, 200, add.error);
    const codexHome = join(shim.dataDir, "accounts", "codex-work");
    assert.deepEqual([add.agent.upstream, add.agent.name, add.agent.home], ["codex-work", "Codex · Work", codexHome]);
    const r = await call("POST", "/codex-work/sign-in", { way: "chatgpt-code" });
    assert.equal(r.status, 200, r.error);
    const s = r.signIn;
    assert.deepEqual(
      [s.kind, s.way, s.name, s.url, s.code, s.line],
      ["browser", "chatgpt-code", "ChatGPT on another device", "https://auth.example.test/codex/device", "FAKE-1234", commandLine([process.execPath, FAKE_CODEX, "login"], { CODEX_HOME: codexHome }, process.platform)],
    );
    const done = await ended("codex-work");
    assert.deepEqual([done.lastSignIn.outcome, done.account.identity.label], ["signed-in", "ChatGPT Plus"]);
    assert.ok(existsSync(join(codexHome, "fake-auth.json")), "its login is in its own folder");
    assert.ok(!existsSync(join(root, "codex-home", "fake-auth.json")), "not in the Default's");
  });

  // (fails before: yes — the review of 11-10: Codex offered ChatGPT's two ways alone, so a person with only an OpenAI API
  // key could not sign it in from Filament, though its card says it takes one)
  test("Codex signs in with an OpenAI API key: the key goes to Codex alone, which keeps it in its own folder; Filament keeps it nowhere and says it nowhere", async () => {
    const key = "sk-test-0123456789abcdef";
    const refused = "pk-wrong-0123456789abcdef";
    /** @type {string[]} */
    const lines = [];
    const restore = hear(lines);
    try {
      const asked = await call("POST", "/cxkey/sign-in", { way: "api-key" });
      assert.deepEqual([asked.status, asked.choose?.map((/** @type {any} */ w) => w.id), asked.agent.signingIn], [200, ["chatgpt", "chatgpt-code", "api-key"], null], "no key given: the ways again, nothing started");
      const spaced = await call("POST", "/cxkey/sign-in", { way: "api-key", key: "sk-test 0123" });
      assert.deepEqual([spaced.status, spaced.error], [400, "paste the key alone: one line, with no spaces in it"]);
      const r = await call("POST", "/cxkey/sign-in", { way: "api-key", key: `  ${key}\n` });
      assert.equal(r.status, 200, r.error);
      assert.deepEqual([r.signIn.kind, r.signIn.way, r.signIn.name], ["key", "api-key", "OpenAI API key"]);
      const done = await ended("cxkey");
      assert.deepEqual([done.lastSignIn.outcome, done.lastSignIn.error, done.account.identity.kind, done.account.identity.label], ["signed-in", null, "api-key", "OpenAI API key"]);
      const calls = readFileSync(join(root, "codex-key-home.calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
      assert.deepEqual(calls.filter((c) => c.method === "account/login/start").map((c) => c.params), [{ type: "apiKey", apiKey: key }], "the key alone, trimmed, to account/login/start");
      assert.ok(readFileSync(join(root, "codex-key-home", "fake-auth.json"), "utf8").includes(key), "Codex keeps it in its own folder");
      // A key Codex refuses, in words that repeat it: its words reach the page without it.
      const bad = await call("POST", "/cxkey/sign-in", { way: "api-key", key: refused });
      assert.deepEqual([bad.status, bad.error], [502, "invalid OpenAI API key ••••"]);
      const kept = JSON.stringify([asked, r, done, bad, await configNow(), await rows(), await (await shim.api("/api/ops?kinds=all&limit=1000")).json(), await shim.records(200)]);
      const disk = readFileSync(join(shim.dataDir, "config.json"), "utf8");
      for (const k of [key, refused]) {
        assert.ok(!kept.includes(k), "no answer, row, operation or record says it");
        assert.ok(!disk.includes(k), "Filament's configuration keeps none");
        assert.ok(!lines.some((l) => l.includes(k)), "its log says none");
      }
    } finally {
      restore();
    }
  });

  test("Codex's sign-in stopped: its app-server is told to cancel it", async () => {
    const r = await call("POST", "/cxwait/sign-in", { way: "chatgpt" });
    assert.equal(r.status, 200, r.error);
    const loginId = new URL(r.signIn.url).searchParams.get("state");
    const stop = await call("POST", "/cxwait/sign-in/cancel");
    assert.deepEqual([stop.stopped, stop.agent.signingIn, stop.agent.lastSignIn.outcome], [true, null, "cancelled"]);
    const calls = readFileSync(join(root, "codex-wait-home.calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(calls.filter((c) => c.method === "account/login/cancel").map((c) => c.params), [{ loginId }]);
  });

  test("where Codex's app-server can't start, `codex login` runs in a terminal; the account it can't then be asked about says so", async () => {
    const r = await call("POST", "/cxbroken/sign-in", { way: "chatgpt" });
    assert.equal(r.status, 200, r.error);
    assert.deepEqual([r.signIn.kind, r.signIn.name], ["terminal", "Codex (broken)"]);
    const t = ran.at(-1);
    assert.deepEqual([t?.file, t?.args, t?.home], [process.execPath, [FAKE_CODEX, "login"], join(root, "codex-broken-home")]);
    const done = await ended("cxbroken");
    assert.equal(done.lastSignIn.outcome, "failed");
    assert.match(done.lastSignIn.error, /^the sign-in ended, but Codex \(broken\) could not be asked who it runs as \(Codex's app-server did not start/);
    assert.ok(existsSync(join(root, "codex-broken-home", "fake-auth.json")), "the login itself was made");
  });

  test("an added Cursor account signs in on Cursor's page: the key Cursor makes is kept, sealed, and named for the account; signed out, it is forgotten", async () => {
    const add = await call("POST", "", { from: "cursor", name: "Work" });
    assert.equal(add.status, 200, add.error);
    assert.deepEqual([add.agent.upstream, add.agent.name, add.agent.home, add.agent.ways.map((/** @type {any} */ w) => w.id)], ["cursor-sdk-work", "Cursor · Work", null, ["cursor", "api-key"]]);
    // (fails before: no — a guard the mutation pass asked for: no key account was added beside an agent with a key)
    assert.equal((await configNow()).upstreams.find((/** @type {any} */ u) => u.id === "cursor-sdk-work").apiKey, "", "it starts with no key: never its agent's");
    const r = await call("POST", "/cursor-sdk-work/sign-in", { way: "cursor" });
    assert.equal(r.status, 200, r.error);
    assert.deepEqual([r.signIn.kind, r.signIn.way, r.signIn.url, r.signIn.code, r.signIn.line], ["browser", "cursor", "https://cursor.example.test/loginDeepControl?challenge=fake", null, null]);
    const done = await ended("cursor-sdk-work");
    assert.equal(done.lastSignIn.outcome, "signed-in");
    assert.deepEqual(done.account.identity, { kind: "api-key", label: "Cursor API key “Filament · Work”", plan: null, email: "work@example.com", organization: null, detail: "Filament · Work", billing: "plan" });
    const logged = readFileSync(join(root, "sdk.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.event === "login");
    assert.deepEqual(logged, [{ event: "login", store: null, openBrowser: false, apiKeyName: "Filament · Work" }], "nothing written in Cursor's own store; the browser is the page's to open");
    const up = (await configNow()).upstreams.find((/** @type {any} */ u) => u.id === "cursor-sdk-work");
    assert.deepEqual([up.apiKey, up.apiKeyMasked], ["__SECRET__", "ck-m…ed-1"]);
    assert.ok(!JSON.stringify(await rows()).includes("ck-minted-1"), "the key is never shown");
    const out = await call("POST", "/cursor-sdk-work/sign-out");
    assert.equal(out.status, 200, out.error);
    assert.deepEqual([out.agent.lastSignIn.outcome, out.agent.account.identity.kind, out.agent.account.identity.detail], ["signed-out", "none", "no Cursor API key yet"]);
    assert.equal((await configNow()).upstreams.find((/** @type {any} */ u) => u.id === "cursor-sdk-work").apiKey, "", "its key is forgotten");
    // (fails before: no — a guard the mutation pass asked for: /status was never asked of a Cursor account signed out)
    // A harness chat's: an outside client's `/status` goes to its agent.
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "cursor-sdk-work/auto", preset: "plain" } });
    assert.equal(made.status, 200, await made.clone().text());
    const asked = await shim.api(`/api/sessions/${encodeURIComponent(String((await made.json()).id))}/turns`, { method: "POST", body: { content: "/status", stream: false } });
    const status = await asked.text();
    assert.match(status, /- signed in: /);
    assert.doesNotMatch(status, /work@example\.com/, "its last key's owner is not who it runs as");
  });

  // (fails before: yes — the review of 11-10: Cursor's SDK signed in on Cursor's page alone; a key made in its dashboard
  // had nowhere to go but the configuration's file)
  test("a Cursor account signs in with a key pasted: one Cursor refuses is said so and not kept; one it knows is kept, sealed", async () => {
    const bad = await call("POST", "/cursor-sdk-work/sign-in", { way: "api-key", key: "ck-nope" });
    assert.equal(bad.status, 200, bad.error);
    const refused = await ended("cursor-sdk-work");
    assert.deepEqual([refused.lastSignIn.outcome, refused.lastSignIn.error], ["failed", "Cursor refused the key (Invalid API key)"]);
    assert.equal((await configNow()).upstreams.find((/** @type {any} */ u) => u.id === "cursor-sdk-work").apiKey, "", "nothing kept");
    const good = await call("POST", "/cursor-sdk-work/sign-in", { way: "api-key", key: "ck-test" });
    assert.deepEqual([good.status, good.signIn?.kind, good.signIn?.way], [200, "key", "api-key"]);
    const done = await ended("cursor-sdk-work");
    assert.equal(done.lastSignIn.outcome, "signed-in");
    assert.equal(done.account.identity.email, "dev@example.com");
    const up = (await configNow()).upstreams.find((/** @type {any} */ u) => u.id === "cursor-sdk-work");
    assert.equal(up.apiKey, "__SECRET__", "kept, sealed");
    assert.ok(!JSON.stringify(await rows()).includes("ck-test"), "the key is never shown");
    assert.equal((await call("POST", "/cursor-sdk-work/sign-out")).status, 200);
  });

  test("Cursor's sign-in stopped: its wait is let go of", async () => {
    process.env.FAKE_SDK_LOGIN = "wait";
    try {
      const r = await call("POST", "/cursor-sdk-work/sign-in", { way: "cursor" });
      assert.equal(r.status, 200, r.error);
      const stop = await call("POST", "/cursor-sdk-work/sign-in/cancel");
      assert.deepEqual([stop.stopped, stop.agent.lastSignIn.outcome], [true, "cancelled"]);
    } finally {
      delete process.env.FAKE_SDK_LOGIN;
    }
  });

  test("an added account renamed keeps its id; removed, all of it goes — upstream, route, fallbacks naming it, folder, model list; a Default stays", async () => {
    const renamed = await call("PATCH", "/claude-code-work", { name: "Home" });
    assert.deepEqual([renamed.status, renamed.agent.upstream, renamed.agent.name, renamed.agent.label], [200, "claude-code-work", "Claude Code · Home", "Home"]);
    assert.deepEqual(Object.values(await call("POST", "", { from: "claude-code", name: "home" })), [409, "Claude Code already has an account named home"]);
    assert.deepEqual(Object.values(await call("PATCH", "/claude-code", { name: "Mine" })), [400, "Claude Code is the agent's Default account: it keeps its name"]);
    assert.deepEqual(Object.values(await call("DELETE", "/claude-code")), [400, "Claude Code is the agent's Default account: turn the agent off instead"]);
    const cfg = await configNow();
    cfg.routes.find((/** @type {any} */ rt) => rt.upstream === "claude-code").fallbacks = [{ upstream: "claude-code-work" }];
    const saved = await shim.api("/api/config", { method: "PUT", body: cfg });
    assert.equal(saved.status, 200, await saved.text());
    /** The agent processes Filament keeps for an upstream. @param {string} id @returns {Promise<any[]>} */
    const processesOf = async (id) => (await (await shim.api("/api/acp/status")).json()).processes.filter((/** @type {any} */ p) => String(p.key).startsWith(`${id}|`));
    assert.ok((await processesOf("claude-code-work")).length > 0, "its agent runs: its last turn started it");
    const gone = await call("DELETE", "/claude-code-work");
    assert.deepEqual([gone.status, gone.folder, gone.kept, gone.agent], [200, home(), null, null]);
    // (fails before: no — a guard the mutation pass asked for: nothing checked that a removed account's agent stops)
    assert.deepEqual(await processesOf("claude-code-work"), [], "its agent's processes go with it");
    assert.ok(!existsSync(home()), "its folder, and the login in it, are gone");
    const after = await configNow();
    assert.ok(!after.upstreams.some((/** @type {any} */ u) => u.id === "claude-code-work"));
    assert.ok(!after.routes.some((/** @type {any} */ rt) => rt.upstream === "claude-code-work"));
    assert.deepEqual(after.routes.find((/** @type {any} */ rt) => rt.upstream === "claude-code").fallbacks, []);
    await until(() => !JSON.parse(readFileSync(join(shim.dataDir, "models-cache.json"), "utf8")).local?.["claude-code-work"], "its list to leave models-cache.json");
    assert.ok(!(await rows()).some((r) => r.upstream === "claude-code-work"));
    assert.equal((await call("DELETE", "/claude-code-work")).status, 404);
  });

  // (fails before: yes — the owner's of 11-05: an account could be signed out, never set aside with its sign-in kept)
  test("an account turned off keeps its sign-in and stays listed, off; the agent stays on while any account is; its last account off turns it off, and Turn on there puts them all on", async () => {
    const upstreamOf = async (/** @type {string} */ id) => (await configNow()).upstreams.find((/** @type {any} */ u) => u.id === id);
    const entry = async () => (await (await shim.api("/api/coding-agents")).json()).entries.find((/** @type {any} */ e) => e.id === "claude-code");
    const made = await call("POST", "", { from: "claude-code", name: "Spare" });
    assert.equal(made.status, 200, made.error);
    const off = await call("POST", "/claude-code-spare/off");
    assert.equal(off.status, 200, off.error);
    assert.deepEqual([off.agent.upstream, off.agent.off], ["claude-code-spare", true]);
    const u = await upstreamOf("claude-code-spare");
    assert.deepEqual([u.enabled, u.acp.accountOff], [false, true]);
    assert.deepEqual([(await row("claude-code-spare"))?.off, (await row("claude-code"))?.off], [true, false], "listed, off; the Default stays on");
    assert.equal((await entry()).state, "connected", "the agent runs on the account still on");
    const back = await call("POST", "/claude-code-spare/on");
    assert.deepEqual([back.status, back.agent.off], [200, false]);
    const v = await upstreamOf("claude-code-spare");
    assert.deepEqual([v.enabled, v.acp.accountOff], [true, false]);
    // Every account off: the agent is off, and Turn on there puts each one on again.
    const all = (await entry()).upstreams;
    for (const id of all) assert.equal((await call("POST", `/${id}/off`)).status, 200);
    assert.equal((await entry()).state, "off");
    const connect = await shim.api("/api/coding-agents/claude-code/connect", { method: "POST" });
    assert.equal(connect.status, 200, await connect.text());
    for (const id of all) assert.equal((await upstreamOf(id)).enabled, true, id);
    assert.deepEqual([(await row("claude-code"))?.off, (await row("claude-code-spare"))?.off], [false, false]);
    assert.equal((await call("POST", "/nobody/off")).status, 404);
    assert.equal((await call("DELETE", "/claude-code-spare")).status, 200);
  });

  // (fails before: yes — the review of 4e913bf96: an account added from a Default turned off came with its mark, and
  // Connect then took it for one set aside, or turned the Default on with it)
  test("an account added while the Default is off comes on, unmarked; a mark left on an account switched on is none; Turn on leaves an account off with its agent to Connect", async () => {
    const upstreamOf = async (/** @type {string} */ id) => (await configNow()).upstreams.find((/** @type {any} */ u) => u.id === id);
    assert.equal((await call("POST", "/claude-code/off")).status, 200);
    const made = await call("POST", "", { from: "claude-code", name: "Fresh" });
    assert.equal(made.status, 200, made.error);
    const f = await upstreamOf("claude-code-fresh");
    assert.deepEqual([f.enabled, !!f.acp.accountOff, !!f.acp.turnedOff], [true, false, false]);
    assert.deepEqual([(await row("claude-code-fresh"))?.off, (await row("claude-code"))?.off], [false, true]);
    assert.equal((await call("POST", "/claude-code/on")).status, 200);
    // The console's switch turned an account on and left its mark: on, as the switch said.
    const cfg = await configNow();
    const t = cfg.upstreams.find((/** @type {any} */ u) => u.id === "claude-code-fresh");
    t.acp.accountOff = true;
    assert.equal((await shim.api("/api/config", { method: "PUT", body: cfg })).status, 200);
    assert.equal((await row("claude-code-fresh"))?.off, false);
    assert.equal((await call("POST", "/claude-code-fresh/on")).status, 200, "on already: nothing to do");
    // Off with its agent, not by itself: Connect turns it on, with the agent.
    t.enabled = false;
    t.acp.accountOff = false;
    t.acp.turnedOff = true;
    assert.equal((await shim.api("/api/config", { method: "PUT", body: cfg })).status, 200);
    const refused = await call("POST", "/claude-code-fresh/on");
    assert.deepEqual([refused.status, refused.error], [409, "Claude Code · Fresh is off with its agent: Connect turns them on"]);
    assert.equal((await call("DELETE", "/claude-code-fresh")).status, 200);
  });

  // (fails before: no — a guard the mutation pass asked for: no account removed had a folder Filament didn't make)
  test("an account whose folder Filament didn't make: removed, its folder stays, and so does the folder of all the accounts", async () => {
    const own = join(root, "own-home");
    mkdirSync(own);
    writeFileSync(join(own, "login.json"), "{}");
    const all = join(shim.dataDir, "accounts");
    for (const name of ["Mine", "Odd"]) {
      const r = await call("POST", "", { from: "claude-code", name });
      assert.equal(r.status, 200, r.error);
    }
    const cfg = await configNow();
    cfg.upstreams.find((/** @type {any} */ u) => u.id === "claude-code-mine").acp.home = own;
    cfg.upstreams.find((/** @type {any} */ u) => u.id === "claude-code-odd").acp.home = all;
    assert.equal((await shim.api("/api/config", { method: "PUT", body: cfg })).status, 200);
    const mine = await call("DELETE", "/claude-code-mine");
    assert.deepEqual([mine.status, mine.folder, mine.kept], [200, null, `its folder ${own} is not one Filament made, so it stays`]);
    assert.ok(existsSync(join(own, "login.json")));
    const odd = await call("DELETE", "/claude-code-odd");
    assert.deepEqual([odd.status, odd.folder, odd.kept], [200, null, `its folder ${all} is not one Filament made, so it stays`]);
    assert.ok(existsSync(all));
  });
});

describe("an ACP agent's own ways to sign in beyond a terminal's, through the app (the review of 11-10)", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  let projDir = "";
  /** @type {{ file: string, args: string[], child: import("node:child_process").ChildProcess }[]} */
  const ran = [];
  /** The stand-in for node-pty: the fake alone runs, as a child process. @param {any} o */
  const terminalSpawn = (o) => {
    if (o.file !== process.execPath || o.args[0] !== FAKE_ACP_AGENT) throw new Error(`the stand-in runs only the fake, not ${o.file} ${o.args.join(" ")}`);
    const child = spawn(o.file, o.args, { cwd: o.cwd, env: o.env, windowsHide: true });
    ran.push({ file: o.file, args: o.args, child });
    /** @type {((e: any) => void)[]} */
    const exits = [];
    child.on("close", (code) => exits.forEach((fn) => fn({ exitCode: code, signal: 0 })));
    return { write: (/** @type {string} */ d) => child.stdin.write(d), resize: () => {}, kill: () => child.kill(), onData: () => {}, onExit: (/** @type {any} */ fn) => exits.push(fn) };
  };
  /** What an agent was asked, as its calls file says. @param {string} id @returns {any[]} */
  const callsOf = (id) => {
    const f = join(root, `${id}.calls.jsonl`);
    return existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  };
  /** Ways of the agent's own: one it carries out itself, opened by `authenticate`. */
  const BROWSER_WAY = [{ id: "browser-login", name: "Log in", description: "Log in with your account, in your browser" }];

  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-logins-acp-"));
    projDir = join(root, "project");
    mkdirSync(projDir);
    mkdirSync(join(root, "termy-home"));
    /** A fake agent of ACP's registry, as Filament runs one it installed: its program by its full path. @param {string} id @param {Record<string, string>} env */
    const fake = (id, env) => ({ command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(root, `${id}.calls.jsonl`), ...env }, cwdDefault: projDir, permissions: "allow-all", hints: false, authenticate: false });
    shim = await startApp({
      overrides: { terminalSpawn },
      configure: (cfg) => {
        cfg.server.logLevel = "debug";
        cfg.upstreams = [
          { id: "oauthy", name: "Oauthy", type: "acp", acp: fake("oauthy", { FAKE_ACP_AUTH_METHODS: JSON.stringify(BROWSER_WAY), FAKE_ACP_SIGNED_IN: join(root, "oauthy.signed-in"), FAKE_ACP_AUTHENTICATE_MS: "100" }) },
          { id: "refusy", name: "Refusy", type: "acp", acp: fake("refusy", { FAKE_ACP_AUTH_METHODS: JSON.stringify(BROWSER_WAY), FAKE_ACP_SIGNED_IN: join(root, "refusy.signed-in"), FAKE_ACP_AUTHENTICATE: "fail" }) },
          { id: "waity", name: "Waity", type: "acp", acp: fake("waity", { FAKE_ACP_AUTH_METHODS: JSON.stringify(BROWSER_WAY), FAKE_ACP_SIGNED_IN: join(root, "waity.signed-in"), FAKE_ACP_AUTHENTICATE: "wait" }) },
          {
            id: "keyed",
            name: "Keyed",
            type: "acp",
            acp: fake("keyed", {
              FAKE_ACP_AUTH_METHODS: JSON.stringify([
                { type: "env_var", id: "fake-key", name: "Fake API key", description: "A key from the fake's dashboard", vars: [{ name: "FAKE_AGENT_API_KEY", label: "Your Fake API key" }] },
                // Not a variable Filament seals: never offered, so no key is kept where the page could read it.
                { type: "env_var", id: "fake-url", name: "Fake gateway", vars: [{ name: "FAKE_AGENT_URL" }] },
              ]),
              FAKE_ACP_KEY_VAR: "FAKE_AGENT_API_KEY",
            }),
          },
          {
            id: "termy",
            name: "Termy",
            type: "acp",
            acp: fake("termy", {
              FAKE_ACP_AUTH_METHODS: JSON.stringify([
                { id: "old-login", name: "Old login", description: "Signs in in a terminal", _meta: { "terminal-auth": { command: process.execPath, args: [FAKE_ACP_AGENT, "--cli", "auth", "login", "--claudeai"], label: "Old Login" } } },
              ]),
              FAKE_ACP_HOME_LOGIN: "1",
              CLAUDE_CONFIG_DIR: join(root, "termy-home"),
            }),
          },
          { id: "bare", name: "Bare", type: "acp", acp: fake("bare", { FAKE_ACP_AUTH_METHODS: "[]" }) },
        ];
        cfg.routes = cfg.upstreams.map((/** @type {any} */ u) => ({ match: `${u.id}/*`, upstream: u.id, upstreamModel: "{1}", enabled: true }));
      },
    });
  });
  after(async () => {
    await shim?.stop();
    for (const t of ran) if (t.child.exitCode === null && t.child.signalCode === null) t.child.kill();
    await removeDirs(root);
  });

  /** @param {string} id */
  const row = async (id) => (await (await shim.api("/api/agent-accounts")).json()).agents.find((/** @type {any} */ r) => r.upstream === id);
  /** @param {string} method @param {string} path @param {unknown} [body] */
  const call = async (method, path, body) => {
    const res = await shim.api(`/api/agent-accounts${path}`, { method, body });
    return { status: res.status, ...(await res.json()) };
  };
  /** @param {string} id */
  const ended = (id) =>
    until(async () => {
      const r = await row(id);
      return r?.lastSignIn && !r.signingIn ? r : null;
    }, `${id}'s sign-in to end`, { timeoutMs: 20_000 });
  /** @param {string} model */
  const turn = async (model) => {
    const res = await shim.post("/v1/messages", { model, max_tokens: 100, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: "hello" }] });
    const body = await res.text();
    return { status: res.status, error: res.status === 200 ? undefined : String(JSON.parse(body)?.error?.message) };
  };

  // (fails before: yes — an agent's way that `authenticate` carries out was no way to sign in: the account named none,
  // and its turns were refused for its sign-in with nothing on its card to press)
  test("a way the agent carries out itself: Sign in asks it to (`authenticate`), and it opens its own page; ended well, its next turn runs", async () => {
    const before = await turn("oauthy/fake-a");
    assert.notEqual(before.status, 200);
    assert.match(String(before.error), /Oauthy is not signed in\. Sign in under Settings → Coding agents in Filament's harness, then send your message again\./);
    assert.deepEqual((await row("oauthy")).ways, BROWSER_WAY, "its own way, from its start");
    const r = await call("POST", "/oauthy/sign-in", {});
    assert.equal(r.status, 200, r.error);
    assert.deepEqual([r.signIn.kind, r.signIn.way, r.signIn.name, r.signIn.url, r.signIn.code, r.signIn.line], ["browser", "browser-login", "Log in", null, null, null], "its one way, started at once: no page of Filament's to open");
    const done = await ended("oauthy");
    assert.deepEqual([done.lastSignIn.outcome, done.lastSignIn.error], ["signed-in", null]);
    assert.deepEqual(callsOf("oauthy").filter((c) => c.method === "authenticate").map((c) => c.methodId), ["browser-login"]);
    const after = await turn("oauthy/fake-a");
    assert.equal(after.status, 200, after.error);
  });

  // (fails before: yes — as above: no such way)
  test("refused, the sign-in fails in the agent's words; stopped while the agent waits, its process is let go of, and the next one is asked afresh", async () => {
    const r = await call("POST", "/refusy/sign-in", { way: "browser-login" });
    assert.equal(r.status, 200, r.error);
    const done = await ended("refusy");
    assert.deepEqual([done.lastSignIn.outcome, done.lastSignIn.error], ["failed", "the fake's sign-in page was closed"]);
    const w = await call("POST", "/waity/sign-in", { way: "browser-login" });
    assert.equal(w.status, 200, w.error);
    await until(() => callsOf("waity").some((c) => c.method === "authenticate"), "the agent to be asked");
    const stop = await call("POST", "/waity/sign-in/cancel");
    assert.deepEqual([stop.stopped, stop.agent.signingIn, stop.agent.lastSignIn.outcome], [true, null, "cancelled"]);
    const again = await call("POST", "/waity/sign-in", { way: "browser-login" });
    assert.equal(again.status, 200, again.error);
    await until(() => callsOf("waity").filter((c) => c.method === "authenticate").length === 2, "the agent to be asked again");
    const pids = callsOf("waity").filter((c) => c.method === "authenticate").map((c) => c.pid);
    assert.notEqual(pids[0], pids[1], "asked again in a process of its own");
    await call("POST", "/waity/sign-in/cancel");
  });

  // (fails before: yes — a key an agent reads from a variable (ACP's `env_var`) was no way to sign in)
  test("a key the agent reads from a variable: asked with none, its way and its field; pasted, kept sealed in the account's environment, never said back; its next process starts with it, and its turn runs", async () => {
    const key = "fk-live-0123456789abcdef";
    /** @type {string[]} */
    const lines = [];
    const restore = hear(lines);
    try {
      const before = await turn("keyed/fake-a");
      assert.notEqual(before.status, 200);
      const way = { id: "fake-key", name: "Fake API key", description: "A key from the fake's dashboard", kind: "key", label: "Your Fake API key" };
      assert.deepEqual((await row("keyed")).ways, [way], "the variable Filament seals alone");
      const asked = await call("POST", "/keyed/sign-in", {});
      assert.deepEqual([asked.status, asked.choose], [200, [way]], "its one way is a key's: asked for first");
      const r = await call("POST", "/keyed/sign-in", { way: "fake-key", key: ` ${key} ` });
      assert.equal(r.status, 200, r.error);
      assert.deepEqual([r.signIn.kind, r.signIn.way, r.signIn.name], ["key", "fake-key", "Fake API key"]);
      const done = await ended("keyed");
      // Its agent says nothing of who it runs as, and nothing here can tell: the key is kept, which is all its end says
      // (the re-read of 11-11: "signed-in" stood here, of a key nothing had tried — sign-in-reread.test.js).
      assert.deepEqual([done.lastSignIn.outcome, done.lastSignIn.error], ["key-kept", null]);
      const cfg = (await (await shim.api("/api/state")).json()).config;
      assert.equal(cfg.upstreams.find((/** @type {any} */ u) => u.id === "keyed").acp.env.FAKE_AGENT_API_KEY, "__SECRET__", "kept under its variable, as the card's environment keeps one");
      const after = await turn("keyed/fake-a");
      assert.equal(after.status, 200, after.error);
      assert.deepEqual(callsOf("keyed").filter((c) => c.method === "start").map((c) => c.keyed).slice(-1), [true], "its next process started with it");
      const kept = JSON.stringify([asked, r, done, cfg, await row("keyed"), await (await shim.api("/api/ops?kinds=all&limit=1000")).json(), await shim.records(200)]);
      assert.ok(!kept.includes(key), "no answer, row, operation or record says it");
      assert.ok(!readFileSync(join(shim.dataDir, "config.json"), "utf8").includes(key), "sealed on disk");
      assert.ok(!lines.some((l) => l.includes(key)), "its log says none, at the debug level either");
    } finally {
      restore();
    }
  });

  // (fails before: yes — Filament never declared Zed's older form, and read none of it: the agent offered its terminal
  // sign-in to no one)
  test("Zed's older form: a terminal sign-in the agent names under `_meta[\"terminal-auth\"]`, to a client that declares it, runs its own program in a terminal", async () => {
    await call("POST", "/termy/check");
    assert.deepEqual((await row("termy")).ways.map((/** @type {any} */ w) => [w.id, w.name]), [["old-login", "Old login"]]);
    const r = await call("POST", "/termy/sign-in", { way: "old-login" });
    assert.equal(r.status, 200, r.error);
    assert.equal(r.signIn.kind, "terminal");
    assert.deepEqual([ran.at(-1)?.file, ran.at(-1)?.args], [process.execPath, [FAKE_ACP_AGENT, "--cli", "auth", "login", "--claudeai"]], "the program and arguments it named, whole");
    const done = await ended("termy");
    assert.deepEqual([done.lastSignIn.outcome, done.account?.identity?.label], ["signed-in", "Claude Max"]);
  });

  // (fails before: yes — the words said to sign in with its own CLI, which an agent Filament installed keeps in a folder
  // of Filament's, on no PATH)
  test("an agent that names no way: the refusal names its own program by its full path, to run in a terminal", async () => {
    const r = await call("POST", "/bare/sign-in", {});
    assert.deepEqual(
      [r.status, r.error],
      [400, `Bare names no way to sign in here: run its own program in a terminal, \`${commandLine([process.execPath], {}, process.platform)}\`, and sign in there, then Check now`],
    );
  });
});

describe("a sign-in's start and end, one step at a time (app/agent-logins.js, HarnessV3-ACP AC3-7)", () => {
  /** @type {string[]} */
  const roots = [];
  after(() => removeDirs(...roots));
  /**
   * The logins over stand-ins: a Claude account that signs in in a terminal and a Codex one on its page. The agent's
   * ways come when the test lets them (`hold`, `release`), a terminal ends when the test says (`terminals`), a page's
   * sign-in ends with what the test gives (`pages`), and the agent then says who it runs as (`who`). The terminals
   * killed and the page sign-ins the agent was told to stop are kept (`killed`, `cancelled`); a sign-out fails, as
   * Claude's where it has none of its own and as an app-server's that didn't answer.
   * @param {{ enabled?: boolean }} [o]
   */
  const stand = ({ enabled = true } = {}) => {
    const root = mkdtempSync(join(tmpdir(), "filament-logins-steps-"));
    roots.push(root);
    const upstreams = [
      { id: "cc", name: "Claude Code", type: "acp", enabled, acp: { command: process.execPath, args: [], cwdDefault: root } },
      { id: "cx", name: "Codex", type: "codex", enabled: true, acp: { command: process.execPath, args: [], cwdDefault: root } },
    ];
    const s = {
      /** The ids the agent was started to name its ways for. @type {string[]} */
      asked: [],
      hold: false,
      /** @type {(() => void)[]} */
      held: [],
      release: () => s.held.splice(0).forEach((r) => r()),
      /** @type {Map<string, (code: number | null, closed: boolean) => void>} */
      terminals: new Map(),
      /** @type {string[]} */
      killed: [],
      /** @type {string[]} */
      cancelled: [],
      /** @type {((out: any) => void)[]} */
      pages: [],
      who: "account",
      /** @type {string[]} */
      models: [],
      /** @param {string} id */
      row: (id) => logins.state(upstreams.find((u) => u.id === id)),
    };
    const bridge = {
      signInWays: async (/** @type {any} */ u, /** @type {any} */ o) => {
        if (o?.start) {
          s.asked.push(u.id);
          if (s.hold) await new Promise((r) => s.held.push(() => r(undefined)));
        }
        return u.type === "codex"
          ? [{ id: "chatgpt", name: "ChatGPT", description: "", kind: "browser" }]
          : [{ id: "cli", name: "Claude Code", description: "", kind: "terminal", command: process.execPath, args: ["--version"], env: {} }];
      },
      signIn: async () => ({ url: "https://example.test/login", code: null, done: new Promise((r) => s.pages.push(r)) }),
      cancelSignIn: async (/** @type {any} */ u) => {
        s.cancelled.push(u.id);
        return true;
      },
      checkAccount: async () => {},
      letGo: () => {},
      running: () => false,
      signOut: async (/** @type {any} */ u) => {
        throw u.type === "codex"
          ? new Error("the app-server did not answer")
          : Object.assign(new Error("this agent has no sign-out of its own: sign out in its own CLI"), { code: "NO_SIGN_OUT" });
      },
    };
    let n = 0;
    const logins = createAgentLogins({
      config: /** @type {any} */ ({ get: () => ({ upstreams, routes: [] }), set: () => {}, save: () => {} }),
      destinationFor: () => /** @type {any} */ ({ agent: bridge }),
      terminal: /** @type {any} */ ({
        create: (/** @type {any} */ o) => {
          const id = `t${++n}`;
          s.terminals.set(id, o.onExit);
          return { id };
        },
        kill: (/** @type {string} */ id) => void s.killed.push(id),
      }),
      accounts: /** @type {any} */ ({ view: () => ({ identity: { kind: s.who } }) }),
      dataDir: root,
      adoptModels: () => {},
      askModels: async (/** @type {string} */ id) => void s.models.push(id),
      publish: () => {},
      log: () => {},
      // Both agents say who they run as: nothing here reads a sign-in without them.
      signInOf: async () => ({ signedIn: null, identity: null }),
      saysWho: () => true,
    });
    return { logins, s };
  };
  const settle = () => new Promise((r) => setImmediate(r));

  // (fails before: no — a guard the mutation pass asked for: no sign-in was asked for twice at once, or of a turned-off
  // agent)
  test("asked twice at once, one sign-in; asked again, the one under way, its agent not asked again; turned off, none", async () => {
    const { logins, s } = stand();
    s.hold = true;
    const both = Promise.all([logins.signIn("cc", { way: "cli" }), logins.signIn("cc", { way: "cli" })]);
    await settle();
    s.release();
    const [a, b] = /** @type {any[]} */ (await both);
    assert.deepEqual([a.signIn.terminal, b.signIn.terminal, s.terminals.size], ["t1", "t1", 1]);
    const again = /** @type {any} */ (await logins.signIn("cc", { way: "cli" }));
    assert.equal(again.signIn.terminal, "t1");
    assert.deepEqual(s.asked, ["cc", "cc"], "asked again while it runs, the agent isn't started to name its ways");
    await assert.rejects(stand({ enabled: false }).logins.signIn("cc", { way: "cli" }), { status: 404, message: "no such coding agent" });
  });

  // (fails before: no — a guard the mutation pass asked for: no terminal ended after its sign-in was replaced, no agent
  // said nobody was signed in after one, and nothing checked its models were asked for)
  test("a terminal's end is its own sign-in's; ended well, the agent says who it runs as: nobody is a failure, someone is signed in, and its models are asked for", async () => {
    const { logins, s } = stand();
    await logins.signIn("cc", { way: "cli" });
    assert.equal(await logins.cancelSignIn("cc"), true);
    await logins.signIn("cc", { way: "cli" });
    /** @type {any} */ (s.terminals.get("t1"))(null, true);
    await settle();
    assert.equal(/** @type {any} */ ((await s.row("cc")).signingIn)?.terminal, "t2", "the stopped one's end ends nothing it didn't start");
    /** @type {any} */ (s.terminals.get("t2"))(0, false);
    await until(async () => (await s.row("cc")).lastSignIn?.outcome === "signed-in", "the sign-in to end");
    await until(async () => s.models.length === 1, "its models to be asked for");
    assert.deepEqual(s.models, ["cc"]);
    s.who = "none";
    await logins.signIn("cc", { way: "cli" });
    /** @type {any} */ (s.terminals.get("t3"))(0, false);
    await until(async () => (await s.row("cc")).lastSignIn?.outcome === "failed", "the sign-in to fail");
    assert.equal((await s.row("cc")).lastSignIn?.error, "the sign-in ended, but Claude Code says nobody is signed in");
  });

  // (fails before: no — a guard the mutation pass asked for: no page sign-in was given up, or stopped before its
  // end came)
  test("a page's sign-in given up is cancelled, one refused fails; stopped, its late end changes nothing", async () => {
    const { logins, s } = stand();
    const last = async () => (await s.row("cx")).lastSignIn;
    await logins.signIn("cx", { way: "chatgpt" });
    s.pages[0]({ ok: false, error: null });
    await until(async () => (await last())?.outcome === "cancelled", "the page given up");
    await logins.signIn("cx", { way: "chatgpt" });
    s.pages[1]({ ok: false, error: "the page said no" });
    await until(async () => (await last())?.outcome === "failed", "the page refused");
    assert.equal((await last())?.error, "the page said no");
    await logins.signIn("cx", { way: "chatgpt" });
    assert.equal(await logins.cancelSignIn("cx"), true);
    const stopped = await last();
    s.pages[2]({ ok: true, error: null });
    for (let i = 0; i < 5; i++) await settle();
    assert.deepEqual(await last(), stopped, "cancelled it stays");
  });

  // (fails before: no — a guard the mutation pass asked for: no page's sign-in was left waiting past its 15 minutes)
  test("a page's sign-in nobody finished in 15 minutes stops by itself, and fails saying so", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { logins, s } = stand();
    await logins.signIn("cx", { way: "chatgpt" });
    t.mock.timers.tick(BROWSER_WAIT_MS);
    for (let i = 0; i < 5; i++) await settle();
    const { signingIn, lastSignIn } = await s.row("cx");
    assert.deepEqual([s.cancelled, signingIn, lastSignIn?.outcome, lastSignIn?.error], [["cx"], null, "failed", "nobody finished the sign-in within 15 minutes"]);
  });

  // (fails before: no — a guard the mutation pass asked for: no agent said it had no sign-out of its own)
  test("a sign-out the agent has none of is the person's to do (400); one that failed is the agent's (502)", async () => {
    const { logins } = stand();
    await assert.rejects(logins.signOut("cc"), { status: 400, message: "this agent has no sign-out of its own: sign out in its own CLI" });
    await assert.rejects(logins.signOut("cx"), { status: 502, message: "the app-server did not answer" });
  });

  // (fails before: no — a guard the mutation pass asked for: no sign-in was under way when the server stopped)
  test("the server's stop stops every sign-in under way: a terminal's is killed, a page's agent is told", async () => {
    const { logins, s } = stand();
    await logins.signIn("cc", { way: "cli" });
    await logins.signIn("cx", { way: "chatgpt" });
    await logins.stopAll();
    assert.deepEqual([s.killed, s.cancelled], [["t1"], ["cx"]]);
    assert.deepEqual([(await s.row("cc")).signingIn, (await s.row("cx")).signingIn], [null, null]);
  });
});
