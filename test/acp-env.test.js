// The environment an agent process inherits. Filament is routinely started from a coding agent's terminal, and
// `CLAUDECODE` in that environment makes claude-agent-acp believe it is nested inside another Claude Code session.
// Until this change every spawn passed `process.env` through
// whole: the agent process, the login-status probe and the `--list-models` probe alike.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { agentEnv, AGENT_ENV_SCRUB, AcpProcess, AcpBridge } from "../src/acp.js";
import { dropElectronVars, pathNode, resolveAgentCommand, scriptNode } from "../src/adapters/agents/agent-process.js";
import { AGENT_GIVEN, AGENT_OWN, AGENT_SET } from "./helpers/clean-env.js";
import { removeDirs } from "./helpers/wait.js";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-acp-agent.mjs");

const withEnv = (vars, fn) => {
  const saved = {}; for (const [k, v] of Object.entries(vars)) { saved[k] = process.env[k]; if (v == null) delete process.env[k]; else process.env[k] = v; }
  return Promise.resolve().then(fn).finally(() => { for (const [k, v] of Object.entries(saved)) { if (v == null) delete process.env[k]; else process.env[k] = v; } });
};

// (fails before: yes — HarnessV4_Tasks C1: run from a coding agent's terminal, the suite inherited the agent's markers
// and its login folder, and five tests that read what an agent's process is given failed on them)
test("the tests' own environment holds nothing a coding agent's terminal sets", () => {
  assert.deepEqual(AGENT_SET, ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SSE_PORT", "GEMINI_HOME", "CLAUDE_CONFIG_DIR", "CODEX_HOME"]);
  for (const name of AGENT_SET) assert.ok(!(name in process.env), `${name} reached the tests`);
});

// (fails before: yes — run from a chat Filament started on a name typed on a Claude Code card, the suite inherited the
// model named to that chat's Claude Code, and each fake Claude Code a test started listed it as its own: three tests
// of typed-models failed on it)
test("nor what Claude Code is started with for its model calls: the model named to it, an Anthropic key and its address", () => {
  assert.deepEqual(AGENT_GIVEN, ["ANTHROPIC_CUSTOM_MODEL_OPTION", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_CUSTOM_HEADERS"]);
  for (const name of AGENT_GIVEN) assert.ok(!(name in process.env), `${name} reached the tests`);
});

// (fails before: yes — run from a chat's own terminal the suite inherited Claude Code's session id, its socket and token,
// its effort and its switches, sixteen names on 11-11 and more with each of its versions)
test("nor anything Claude Code sets for the programs it starts, by its names' head", () => {
  for (const name of ["CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDE_EFFORT", "CLAUDE_PID", "claude_code_disable_auto_memory"]) assert.ok(AGENT_OWN.test(name), name);
  for (const name of ["CLAUDECODE", "ANTHROPIC_MODEL", "FILAMENT_CLAUDE_HOME", "MY_CLAUDE_DIR"]) assert.ok(!AGENT_OWN.test(name), name);
  assert.deepEqual(Object.keys(process.env).filter((k) => AGENT_OWN.test(k)), []);
});

// (fails before: yes — eleven files that start a coding agent's fake loaded neither the clean environment nor
// helpers/app.js, which loads it: acp, acp-ground, acp-kill, agent-parity, agent-thrash, archive-seed, ask-ids,
// cursor-sdk, cursor-sdk-permits, memory, own-agents. From a chat's own terminal their fakes met the model named to
// that chat's Claude Code, and builders read the failures as their own change's.)
test("every test file that starts a coding agent's fake loads the clean environment first, by itself or through a helper", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  /** @type {Map<string, boolean>} */
  const known = new Map();
  /** Whether a file of the tests' loads the clean environment, itself or by a file of the tests' it imports. @param {string} file @returns {boolean} */
  const loads = (file) => {
    const was = known.get(file);
    if (was !== undefined) return was;
    known.set(file, false);
    const yes = file === join(dir, "helpers", "clean-env.js") || (file.startsWith(dir) && existsSync(file) && [...readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\s(?:[^;]*?\sfrom\s+)?["'](\.[^"']+)["']/gm)].some((m) => loads(resolve(dirname(file), m[1]))));
    known.set(file, yes);
    return yes;
  };
  const starts = (/** @type {string} */ f) => /fake-acp-agent|fake-codex-app-server|fake-cursor-sdk/.test(readFileSync(join(dir, f), "utf8"));
  const files = readdirSync(dir).filter((f) => f.endsWith(".test.js") && starts(f));
  assert.ok(files.includes("acp.test.js") && files.includes("cursor-sdk.test.js"), "the files that start a fake were found");
  assert.deepEqual(files.filter((f) => !loads(join(dir, f))), []);
});

test("agentEnv withholds the Claude Code markers and reports exactly what it withheld", () => withEnv({ CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", FILAMENT_KEEP_ME: "yes" }, () => {
  const { env, removed } = agentEnv();
  assert.ok(!("CLAUDECODE" in env), "the nested-session marker is gone");
  assert.ok(!("CLAUDE_CODE_ENTRYPOINT" in env), "and so is the entrypoint marker");
  assert.equal(env.FILAMENT_KEEP_ME, "yes", "everything else is inherited untouched");
  assert.deepEqual([...removed].sort(), ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"], "the removed list is the truth the turn record will state");
  for (const k of AGENT_ENV_SCRUB) assert.ok(!(k in env), `${k} is never handed to an agent`);
}));

test("agentEnv: the upstream's own env wins, envRemove adds names, and nothing is reported that was not there", () => withEnv({ CLAUDECODE: "1", ANTHROPIC_API_KEY: "sk-inherited", QODERCLI_SITE: null }, () => {
  const { env, removed } = agentEnv({ QODERCLI_SITE: "cn", CLAUDECODE: "explicit" }, ["ANTHROPIC_API_KEY", "  ", null, "NOT_SET_ANYWHERE"]);
  assert.equal(env.QODERCLI_SITE, "cn", "the upstream's env is applied");
  assert.equal(env.CLAUDECODE, "explicit", "an explicit setting in the upstream's env is never withheld, even for a scrubbed name");
  assert.ok(!("ANTHROPIC_API_KEY" in env), "a name added through envRemove is withheld");
  assert.ok(!removed.includes("NOT_SET_ANYWHERE"), "only variables that were actually present are reported");
  assert.deepEqual([...removed].sort(), ["ANTHROPIC_API_KEY", "CLAUDECODE"]);
}));

test("agentEnv: extra values are strings and null extras are skipped", () => {
  const { env } = agentEnv({ PORT: 20300, EMPTY: "", GONE: null, UNDEF: undefined });
  assert.equal(env.PORT, "20300"); assert.equal(env.EMPTY, ""); assert.ok(!("GONE" in env)); assert.ok(!("UNDEF" in env));
});

test("agentEnv matches names case-insensitively on Windows, where the environment itself does", { skip: process.platform !== "win32" ? "Windows-only semantics" : false }, () => withEnv({ CLAUDECODE: "1" }, () => {
  const { env, removed } = agentEnv({}, ["claudecode"]);
  assert.ok(!("CLAUDECODE" in env)); assert.deepEqual(removed, ["CLAUDECODE"]);
}));

// (fails before: yes — the bug hunt of 10-30: an upstream's `PATH` stood beside the inherited `Path`, two names Windows
// reads as one, and which of them the agent read was down to their order)
test("agentEnv on Windows: the upstream's own variable replaces the inherited one of its name in any case", { skip: process.platform !== "win32" ? "Windows-only semantics" : false }, () => withEnv({ Filament_Probe_Path: "inherited" }, () => {
  const { env } = agentEnv({ FILAMENT_PROBE_PATH: "C:\\agent\\bin" });
  assert.deepEqual(Object.keys(env).filter((k) => k.toUpperCase() === "FILAMENT_PROBE_PATH"), ["FILAMENT_PROBE_PATH"]);
  assert.equal(env.FILAMENT_PROBE_PATH, "C:\\agent\\bin");
  const path = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH");
  const own = agentEnv({ PATH: "C:\\agent\\bin" }).env;
  assert.deepEqual(Object.keys(own).filter((k) => k.toUpperCase() === "PATH"), ["PATH"], `the inherited ${path} is not handed beside it`);
}));

// (fails before: yes — the bug hunt of 10-30, AGT-4: Cursor's installed versions were ordered as text, so 1.9.0 ran over
// 1.10.0)
test("Cursor's CLI on Windows runs its newest installed version, its numbers read as numbers; names that are no version keep their order as text", { skip: process.platform !== "win32" ? "Cursor's own install folder is Windows'" : false }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-cursor-versions-"));
  /** Cursor's install folder with these versions in it. @param {string[]} names */
  const installed = (names) => {
    const root = join(dir, String(Math.random()).slice(2), "cursor-agent", "versions");
    for (const name of names) {
      mkdirSync(join(root, name), { recursive: true });
      for (const f of ["node.exe", "index.js"]) writeFileSync(join(root, name, f), "");
    }
    return dirname(dirname(root));
  };
  try {
    for (const [names, newest] of /** @type {[string[], string][]} */ ([
      [["1.9.0", "1.10.0", "1.2.0"], "1.10.0"],
      [["2026.09.30-aa11bb2", "2026.10.02-0c3d4e5", "2026.10.01-ff00ee1"], "2026.10.02-0c3d4e5"],
      [["2026.10.02-0c3d4e5", "2026.10.02-9f8e7d6"], "2026.10.02-9f8e7d6"],
      [["beta", "alpha"], "beta"],
    ])) {
      await withEnv({ LOCALAPPDATA: installed(names) }, () => assert.equal(resolveAgentCommand("agent").resolved, `cursor-agent ${newest}`, names.join(", ")));
    }
  } finally {
    await removeDirs(dir);
  }
});

// (fails before: yes — HarnessV3-Native NA-D5: inside the desktop app, an Electron program's own variables reached every
// agent, and `ELECTRON_RUN_AS_NODE` makes an Electron program it starts — VS Code, Cursor — run as plain Node)
test("agentEnv withholds an Electron program's own variables, in any case, and says so; an upstream's own env still wins", () => withEnv({ ELECTRON_RUN_AS_NODE: "1", Electron_Enable_Logging: "1", FILAMENT_KEEP_ME: "yes" }, () => {
  const { env, removed } = agentEnv();
  assert.ok(!("ELECTRON_RUN_AS_NODE" in env) && !("Electron_Enable_Logging" in env));
  assert.equal(env.FILAMENT_KEEP_ME, "yes");
  assert.deepEqual([...removed].sort(), ["ELECTRON_RUN_AS_NODE", "Electron_Enable_Logging"]);
  assert.equal(agentEnv({ ELECTRON_ENABLE_LOGGING: "true" }).env.ELECTRON_ENABLE_LOGGING, "true", "an explicit setting is never withheld");
}));

// (fails before: yes — HarnessV3-Native NA-D5: nothing took them out of Filament's own environment, which a terminal's
// shell, git and every MCP server inherit)
test("dropElectronVars takes an Electron program's variables out of the environment it is given, and names them", () => {
  const env = { ELECTRON_RUN_AS_NODE: "1", electron_no_attach_console: "1", PATH: "p", NOT_ELECTRON_X: "kept" };
  assert.deepEqual(dropElectronVars(env), ["ELECTRON_RUN_AS_NODE", "electron_no_attach_console"]);
  assert.deepEqual(env, { PATH: "p", NOT_ELECTRON_X: "kept" });
  assert.deepEqual(dropElectronVars(env), [], "none left: none named");
  // Filament's own start takes them out of its environment before anything starts.
  const bin = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "filament.js"), "utf8");
  assert.ok(bin.indexOf("dropElectronVars(process.env);") > 0 && bin.indexOf("dropElectronVars(process.env);") < bin.indexOf("createApp({"), "at the start, before the server is made");
});

// (fails before: yes — HarnessV3-Native NA-D5: an npm shim's script ran with `process.execPath`, which inside the desktop
// app is the app itself, and the Cursor SDK was looked for beside it)
test("the node a script runs with: Filament's own, except inside Electron, where it is the PATH's first node — none, none", () => {
  const files = new Set([join("C:\\tools", "node.exe"), join("D:\\node", "node.exe"), join("/opt/node/bin", "node")]);
  const exists = (/** @type {string} */ f) => files.has(f);
  assert.equal(pathNode({ env: { Path: ' ;"C:\\nowhere";C:\\tools;D:\\node' }, exists, win: true }), join("C:\\tools", "node.exe"), "Windows: its Path, any case, quotes and blanks read past");
  assert.equal(pathNode({ env: { PATH: `/usr/bin${delimiter}/opt/node/bin` }, exists, win: false }), join("/opt/node/bin", "node"));
  assert.equal(pathNode({ env: { PATH: "C:\\nowhere" }, exists, win: true }), null);
  assert.equal(pathNode({ env: {}, exists, win: true }), null, "no PATH at all");
  assert.equal(scriptNode({ versions: { node: "24.12.0" }, env: {}, exists }), process.execPath, "plain node: its own");
  assert.equal(scriptNode({ versions: { node: "24.22.0", electron: "45.0.0" }, env: { PATH: "D:\\node" }, exists, win: true }), join("D:\\node", "node.exe"), "inside Electron: the PATH's");
  assert.equal(scriptNode({ versions: { electron: "45.0.0" }, env: { PATH: "" }, exists, win: true }), null, "inside Electron with no node: none, so the shim runs through cmd.exe");
});

test("an AcpProcess is started without the withheld variables, and records what it withheld", () => withEnv({ CLAUDECODE: "1", FILAMENT_ENV_PROBE: "probe" }, async () => {
  // The child is node itself, reporting its own environment as one JSON-RPC notification — the same wire the bridge
  // reads, so this exercises the real spawn path rather than a re-implementation of it.
  const script = `process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "env/report", params: { claudecode: "CLAUDECODE" in process.env, probe: process.env.FILAMENT_ENV_PROBE || null, site: process.env.QODERCLI_SITE || null } }) + "\\n")`;
  const p = new AcpProcess({ command: process.execPath, args: ["-e", script], env: { QODERCLI_SITE: "cn" }, envRemove: ["FILAMENT_ENV_PROBE"] });
  const report = new Promise((resolve, reject) => { p.on("notification", (method, params) => { if (method === "env/report") resolve(params); }); p.on("exit", () => setTimeout(() => reject(new Error("the child exited without reporting")), 200)); });
  p.start();
  try {
    const r = await Promise.race([report, new Promise((_, rej) => setTimeout(() => rej(new Error("no report within 10 s")), 10000))]);
    assert.equal(r.claudecode, false, "the agent process does not see CLAUDECODE");
    assert.equal(r.probe, null, "nor a name the upstream's envRemove withheld");
    assert.equal(r.site, "cn", "but it does see the upstream's own env");
    assert.deepEqual([...p.scrubbed].sort(), ["CLAUDECODE", "FILAMENT_ENV_PROBE"], "and the process remembers what was withheld, for the turn record");
  } finally { p.kill(); }
}));

// HarnessV3-ACP AC2-1. (fails before: yes — the connection test and the model list started an agent that names no
// arguments with `acp`, which only Cursor's CLI takes: Claude Code's adapter was handed it on every Test)
test("every way Filament starts an agent hands it the arguments a turn does: its own, `acp` only for Cursor's CLI", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-argv-"));
  const argv = join(dir, "argv.jsonl");
  // An agent with a command of its own and no arguments, as Claude Code's adapter is: on Windows an npm-style shim on
  // the PATH, naming its script beside it as npm's do; elsewhere a script.
  const win = process.platform === "win32";
  if (win) {
    copyFileSync(FAKE, join(dir, "fake-acp-agent.mjs"));
    copyFileSync(join(dirname(FAKE), "person-words.mjs"), join(dir, "person-words.mjs"));
    writeFileSync(join(dir, "argv-agent.cmd"), `@"%~dp0\\node.exe" "%dp0%\\fake-acp-agent.mjs" %*\r\n`);
  } else {
    writeFileSync(join(dir, "argv-agent"), `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`);
    chmodSync(join(dir, "argv-agent"), 0o755);
  }
  const up = { id: "argv", name: "argv", type: "acp", acp: { command: win ? "argv-agent" : join(dir, "argv-agent"), args: [], env: { FAKE_ACP_ARGV: argv }, modelSelection: "none", cwdDefault: dir, permissions: "allow-all" } };
  const bridge = new AcpBridge({ log: () => {} });
  const path = process.env.PATH;
  process.env.PATH = `${dir}${delimiter}${path}`;
  try {
    assert.equal((await bridge.test(up)).ok, true);
    await bridge.listModels(up, { force: true });
    await bridge.offer(up, { force: true });
    await bridge.listSessions(up);
    const out = await bridge.run({ upstream: up, modelId: "auto", format: "anthropic", body: { model: "m", max_tokens: 50, messages: [{ role: "user", content: "hi" }] }, conversationId: "argv", onEvent: () => {} });
    assert.equal(out.stopReason, "end_turn");
    const starts = existsSync(argv) ? readFileSync(argv, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
    assert.deepEqual(starts, [[], [], [], [], []], "the test, the model list, the offer, the session list and the turn");
  } finally {
    process.env.PATH = path;
    bridge.shutdown();
    await removeDirs(dir);
  }
});

// HarnessV3-ACP AF2.
test("an agent's list in its own words: printed (Cursor's `--list-models`) and kept for the hour, or offered by a session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-listed-"));
  const win = process.platform === "win32";
  if (win) {
    copyFileSync(FAKE, join(dir, "fake-acp-agent.mjs"));
    copyFileSync(join(dirname(FAKE), "person-words.mjs"), join(dir, "person-words.mjs"));
    writeFileSync(join(dir, "list-agent.cmd"), `@"%~dp0\\node.exe" "%dp0%\\fake-acp-agent.mjs" %*\r\n`);
  } else {
    writeFileSync(join(dir, "list-agent"), `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`);
    chmodSync(join(dir, "list-agent"), 0o755);
  }
  const up = { id: "listed", name: "listed", type: "acp", acp: { command: win ? "list-agent" : join(dir, "list-agent"), args: [], listModelsArgs: ["--list-models"], cwdDefault: dir, permissions: "allow-all" } };
  const bridge = new AcpBridge({ log: () => {} });
  const path = process.env.PATH;
  process.env.PATH = `${dir}${delimiter}${path}`;
  try {
    const words = { "fake-a": { label: "Fake A" }, "fake-b": { label: "Fake B" } };
    assert.deepEqual(await bridge.listModels(up, { force: true }), { names: ["fake-a", "fake-b"], labels: words, source: "discovered" });
    assert.deepEqual(await bridge.listModels(up), { names: ["fake-a", "fake-b"], labels: words, source: "cache" });
    // One that names them in a session's offer instead, as Claude Code's adapter does: the ones it lists, not its
    // "default".
    const offered = { id: "offered", name: "offered", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_CONFIG: "1" }, cwdDefault: dir, permissions: "allow-all" } };
    assert.deepEqual(await bridge.listModels(offered, { force: true }), {
      names: ["opus[1m]", "sonnet"],
      labels: {
        "opus[1m]": { label: "Opus (1M context)", note: "Opus 5 with 1M context · Best for everyday, complex tasks" },
        sonnet: { label: "Sonnet 5", note: "Sonnet 5 · Efficient for routine tasks" },
      },
      source: "discovered",
    });
  } finally {
    process.env.PATH = path;
    bridge.shutdown();
    await removeDirs(dir);
  }
});
