// @ts-check
// HarnessV4_SpacesPlugins_Plan B2: installing a plugin. Its parts read from its folder (core/plugin-parts.js) — where
// each stands in Claude's and Codex's layouts, its MCP servers, hooks, the values it asks for, checked, its paths and
// values filled in, what does not run here said, what runs as a key —; then app/plugins.js over a folder and a git
// repository: copied at its commit with a data folder of its own; Check for updates — words only go through, what runs
// waits for Update —; values per place, a secret sealed and never shown; Uninstall, its data folder only when asked;
// and the routes.
// (fails before: yes — Filament installed no plugin)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  checkValues, fillPaths, fillSpec, hooksOf, mcpServersOf, notHereWords, partPaths, pluginEnv, runChangeWords, runKeyOf, userConfigOf,
} from "../src/core/plugin-parts.js";
import { createPlugins, readPlugin, treeKey } from "../src/app/plugins.js";
import { startApp } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
/** @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-plugin-install-${tag}-`));
  made.push(d);
  return d;
};
/** @param {string} path @param {unknown} body */
const put = (path, body) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body, null, 2));
};

/** A Claude plugin's folder: a manifest that asks for a token and a channel, a server, hooks, a skill, a command, an agent. @param {string} dir @param {{ command?: string, readme?: string }} [o] */
function pluginAt(dir, o = {}) {
  put(join(dir, ".claude-plugin", "plugin.json"), {
    name: "discord",
    version: "0.0.4",
    description: "Discord channel",
    userConfig: {
      token: { type: "string", title: "Bot token", sensitive: true, required: true },
      channel: { type: "string", title: "Channel", options: ["general", "eng"], default: "general" },
      verbose: { type: "boolean", title: "Verbose", default: false },
    },
  });
  put(join(dir, ".mcp.json"), { mcpServers: { discord: { command: o.command || "bun", args: ["run", "--cwd", "${CLAUDE_PLUGIN_ROOT}", "start"], env: { DISCORD_TOKEN: "${user_config.token}" } } } });
  put(join(dir, "hooks", "hooks.json"), { hooks: {
    PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "node ${CLAUDE_PLUGIN_ROOT}/hooks/check.js", timeout: 10 }] }],
    Notification: [{ hooks: [{ type: "command", command: "echo hi" }] }],
    Stop: [{ hooks: [{ type: "prompt", prompt: "Was it done?" }] }],
  } });
  put(join(dir, "skills", "access", "SKILL.md"), "---\nname: access\ndescription: Manage who may message the bot\n---\nBody.\n");
  put(join(dir, "commands", "configure.md"), "Configure the bot.\n");
  put(join(dir, "agents", "triage.md"), "---\nname: triage\n---\nTriage messages.\n");
  put(join(dir, "README.md"), o.readme || "Discord.\n");
  put(join(dir, ".lsp.json"), { x: { command: "clangd" } });
}

describe("a plugin's parts (core)", () => {
  test("where each part stands: Claude's defaults plus what its manifest adds, a path given replacing the file; Codex's fields", () => {
    const c = partPaths({ commands: "./extra/cmds", hooks: "./config/hooks.json", mcpServers: { inline: { url: "https://x" } } }, "claude");
    assert.deepEqual([c.commands, c.agents, c.skills, c.hooks, c.mcp, c.outputStyles], [["commands", "extra/cmds"], ["agents"], ["skills"], ["config/hooks.json"], { inline: { url: "https://x" } }, ["output-styles"]]);
    assert.deepEqual(partPaths({ skills: "../up" }, "claude").skills, ["skills"], "a path that climbs out is left out");
    const x = partPaths({ skills: "./skills/", mcpServers: "./.mcp.json", hooks: "./hooks/codex-hooks.json", apps: "./.app.json" }, "codex");
    assert.deepEqual([x.skills, x.mcp, x.hooks, x.apps, x.commands], [["skills"], [".mcp.json"], ["hooks/codex-hooks.json"], [".app.json"], []]);
  });

  test("MCP servers, wrapped or not, stdio and HTTP; hooks by event; the values asked, checked; paths and values filled; what runs as a key", () => {
    assert.deepEqual(mcpServersOf({ linear: { type: "http", url: "https://mcp.linear.app/mcp" }, old: { type: "sse", url: "https://x/sse", headers: { A: 1 } }, bare: {} }), {
      servers: [{ name: "linear", spec: { url: "https://mcp.linear.app/mcp" } }, { name: "old", spec: { url: "https://x/sse", headers: { A: "1" }, type: "sse" } }],
      skipped: ["bare"],
    });
    assert.deepEqual(mcpServersOf({ mcpServers: { d: { command: "bun", args: ["start"], env: { T: "x" }, cwd: "/w" } } }).servers, [{ name: "d", spec: { command: "bun", args: ["start"], env: { T: "x" }, cwd: "/w" } }]);
    assert.deepEqual(hooksOf({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "c1", timeout: 5 }] }], Stop: [{ hooks: [{ type: "http", url: "https://h" }] }] } }), [
      { event: "PreToolUse", matcher: "Bash", type: "command", command: "c1", timeout: 5 },
      { event: "Stop", matcher: "", type: "http", command: "https://h", timeout: null },
    ]);
    const asks = userConfigOf({ userConfig: { token: { type: "string", title: "Bot token", sensitive: true, required: true }, n: { type: "number" }, on: { type: "boolean", default: true }, pick: { type: "string", options: ["a", "b"] }, "bad key": {} } });
    assert.deepEqual(asks.map((a) => [a.key, a.type, a.title, a.sensitive, a.required, a.default]), [["token", "string", "Bot token", true, true, null], ["n", "number", "n", false, false, null], ["on", "boolean", "on", false, false, true], ["pick", "string", "pick", false, false, null]]);
    assert.deepEqual(checkValues(asks, { token: "t1", n: "3", on: false, pick: "b" }), { ok: true, values: { token: "t1", n: 3, on: false, pick: "b" } });
    assert.deepEqual(checkValues(asks, { pick: "c", token: "t" }), { ok: false, error: "pick is one of a, b." });
    assert.deepEqual(checkValues(asks, { n: 1 }), { ok: false, error: "It needs Bot token." });
    assert.deepEqual(checkValues(asks, { n: 1 }, { need: false }), { ok: true, values: { n: 1 } });
    assert.deepEqual(checkValues(asks, { token: "__SECRET__" }, { had: { token: "kept" }, keep: "__SECRET__" }), { ok: true, values: { token: "kept" } }, "the placeholder written back keeps the secret");
    assert.deepEqual(checkValues(asks, { other: 1 }), { ok: false, error: 'It asks for no value "other".' });
    assert.deepEqual(checkValues(asks, { on: "yes", token: "t" }), { ok: false, error: "on is yes or no." });
    const vars = { root: "/p/root", data: "/p/data", project: "/w/app", values: { token: "t1" }, asks };
    assert.equal(fillPaths("${CLAUDE_PLUGIN_ROOT}/s ${PLUGIN_DATA} ${CLAUDE_PROJECT_DIR} ${user_config.token} ${user_config.on} ${user_config.none} ${HOME}", vars), "/p/root/s /p/data /w/app t1 true ${user_config.none} ${HOME}");
    assert.deepEqual(fillSpec({ command: "bun", args: ["--cwd", "${CLAUDE_PLUGIN_ROOT}"], env: { T: "${user_config.token}" } }, vars), { command: "bun", args: ["--cwd", "/p/root"], env: { T: "t1" } });
    assert.deepEqual(pluginEnv(vars), { CLAUDE_PLUGIN_ROOT: "/p/root", CLAUDE_PLUGIN_DATA: "/p/data", PLUGIN_ROOT: "/p/root", PLUGIN_DATA: "/p/data", CLAUDE_PROJECT_DIR: "/w/app", CLAUDE_PLUGIN_OPTION_ON: "true", CLAUDE_PLUGIN_OPTION_TOKEN: "t1" });
    const a = { servers: [{ name: "d", spec: { command: "bun", args: ["start"] } }], hooks: [{ event: "Stop", matcher: "", type: "command", command: "x", timeout: null }] };
    const words = { ...a, skills: ["s"] };
    assert.equal(runKeyOf(a), runKeyOf(words), "a skill is words");
    const b = { servers: [{ name: "d", spec: { command: "node", args: ["start"] } }, { name: "e", spec: { url: "https://e" } }], hooks: [{ event: "SessionStart", matcher: "", type: "command", command: "y", timeout: null }] };
    assert.notEqual(runKeyOf(a), runKeyOf(b));
    assert.equal(runChangeWords(a, b), "its MCP server d runs another way; a new MCP server, e; hooks new or changed on SessionStart");
    assert.equal(runChangeWords(a, a), "");
    assert.deepEqual(notHereWords({ hooks: [{ event: "Notification", matcher: "", type: "command", command: "x", timeout: null }, { event: "Stop", matcher: "", type: "prompt", command: "p", timeout: null }], lsp: [{ name: "x", why: "it names no files it serves" }], outputStyles: false, apps: true, bin: false, settings: false, skipped: ["bare"] }), [
      "Hooks on Notification: not here yet — Filament has no such moment",
      "Hooks of the kind prompt: not here yet — Filament runs command hooks",
      "The language server x: it names no files it serves",
      "Apps: not supported — they are connections registered in ChatGPT",
      "The MCP server bare: it names nothing to start",
    ]);
  });

  test("a plugin's folder read: its kind, manifest, servers, hooks, skills, commands, agents, asks, and what does not run here", () => {
    const dir = fresh("read");
    pluginAt(dir);
    const got = readPlugin(dir, "claude", { name: "x" });
    assert.deepEqual([got.kind, got.manifest.name, got.manifest.version], ["claude", "discord", "0.0.4"]);
    assert.deepEqual(got.parts.servers.map((s) => s.name), ["discord"]);
    assert.deepEqual(got.parts.hooks.map((x) => x.event), ["PreToolUse", "Notification", "Stop"]);
    assert.deepEqual([got.parts.skills, got.parts.commands, got.parts.agents], [["skills/access"], ["commands/configure.md"], ["agents/triage.md"]]);
    assert.deepEqual(got.parts.asks.map((a) => a.key), ["token", "channel", "verbose"]);
    assert.deepEqual(got.parts.notHere, ["Hooks on Notification: not here yet — Filament has no such moment", "Hooks of the kind prompt: not here yet — Filament runs command hooks", "The language server x: it names no files it serves"]);
    // No manifest: its marketplace's words; Codex's layout.
    const bare = fresh("bare");
    put(join(bare, "skills", "one", "SKILL.md"), "x");
    const b = readPlugin(bare, "claude", { name: "bare-one", description: "from the list", version: "2.0.0" });
    assert.deepEqual([b.manifest.name, b.manifest.description, b.manifest.version, b.parts.skills], ["bare-one", "from the list", "2.0.0", ["skills/one"]]);
    const cx = fresh("codex");
    put(join(cx, ".codex-plugin", "plugin.json"), { name: "pdf", version: "26.1", skills: "./skills/", apps: "./.app.json", interface: { displayName: "PDF" } });
    put(join(cx, "skills", "render", "SKILL.md"), "x");
    put(join(cx, ".app.json"), {});
    const c = readPlugin(cx, "claude", { name: "pdf" });
    assert.deepEqual([c.kind, c.manifest.title, c.parts.skills, c.parts.notHere], ["codex", "PDF", ["skills/render"], ["Apps: not supported — they are connections registered in ChatGPT"]]);
  });
});

/** A stand-in for the sources: one marketplace whose entries the test sets. */
function sourcesOf() {
  /** @type {Record<string, any>} */
  const entries = {};
  return {
    entries,
    entry: (/** @type {string} */ id, /** @type {string} */ name) => {
      const e = entries[name];
      if (id !== "claude/acme" || !e) throw Object.assign(new Error(`Acme lists no plugin "${name}".`), { status: 404 });
      return { market: { id: "claude/acme", name: "acme", title: "Acme" }, entry: { title: name, description: "", version: "", category: "", author: "", homepage: "", ...e, name } };
    },
  };
}

/** A git repository holding a plugin in plugins/discord; commit() commits what changed. @param {string} dir */
function repoOf(dir) {
  mkdirSync(dir, { recursive: true });
  const git = (/** @type {string[]} */ ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: dir, stdio: "pipe" }).toString().trim();
  pluginAt(join(dir, "plugins", "discord"));
  put(join(dir, "other", "x.txt"), "not this plugin's");
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "one");
  return { head: () => git("rev-parse", "HEAD"), commit: () => (git("add", "-A"), git("commit", "-q", "-m", "next"), git("rev-parse", "HEAD")) };
}

describe("installed (app)", () => {
  test("from a folder: copied with a data folder of its own; installed twice refused; Check — words go through, what runs waits for Update; Uninstall", async () => {
    const dataDir = fresh("data");
    const src = sourcesOf();
    const folder = fresh("src");
    pluginAt(folder);
    src.entries.discord = { source: { kind: "path", path: folder } };
    let at = 1000;
    const p = createPlugins({ dataDir, sources: src, now: () => at });
    const v = await p.install({ from: "claude/acme", name: "discord" });
    assert.deepEqual([v.id, v.version, v.kind, v.marketplace, v.from, v.sha, v.pending], ["discord@acme", "0.0.4", "claude", "acme", "claude/acme", "", null]);
    assert.ok(v.root.startsWith(join(dataDir, "plugins", "installed", "discord@acme")), "in Filament's own folder, not run from the source");
    assert.ok(existsSync(join(v.root, ".mcp.json")) && existsSync(v.data));
    assert.deepEqual(v.parts.servers, [{ name: "discord", as: "discord", runs: "bun run --cwd ${CLAUDE_PLUGIN_ROOT} start", remote: false }], "what it would run, as written, and its name here");
    assert.deepEqual(v.parts.hooks.map((x) => [x.event, x.command]), [["PreToolUse", "node ${CLAUDE_PLUGIN_ROOT}/hooks/check.js"], ["Notification", "echo hi"], ["Stop", "Was it done?"]]);
    await assert.rejects(p.install({ from: "claude/acme", name: "discord" }), { status: 409, message: "discord is installed already: Check for updates brings a newer version." });
    // Nothing newer.
    at = 2000;
    let c = await p.check("discord@acme");
    assert.deepEqual([c.newer, c.applied, c.plugin.checked], [false, false, 2000]);
    // Its words change: it goes through; its data folder is kept, the old version folder goes.
    writeFileSync(join(v.data, "state.json"), "{}");
    put(join(folder, "README.md"), "Discord, better.\n");
    c = await p.check("discord@acme");
    assert.deepEqual([c.newer, c.applied, c.words], [true, true, ""]);
    assert.notEqual(c.plugin.root, v.root);
    assert.equal(existsSync(v.root), false);
    assert.ok(existsSync(join(c.plugin.data, "state.json")), "its data folder survives its updates");
    assert.equal(readFileSync(join(c.plugin.root, "README.md"), "utf8"), "Discord, better.\n");
    // What runs changes: it waits; the version in use stays until Update.
    put(join(folder, ".mcp.json"), { mcpServers: { discord: { command: "node", args: ["server.js"] } } });
    const before = c.plugin.root;
    c = await p.check("discord@acme");
    assert.deepEqual([c.newer, c.applied, c.words, c.plugin.root, c.plugin.pending?.words], [true, false, "its MCP server discord runs another way", before, "its MCP server discord runs another way"]);
    assert.deepEqual(p.get("discord@acme").parts.servers[0].runs, "bun run --cwd ${CLAUDE_PLUGIN_ROOT} start", "the one in use");
    const u = p.update("discord@acme");
    assert.deepEqual([u.parts.servers[0].runs, u.pending], ["node server.js", null]);
    assert.equal(existsSync(before), false);
    assert.throws(() => p.update("discord@acme"), { status: 409 });
    // A restart reads the same.
    assert.deepEqual(createPlugins({ dataDir, sources: src }).list().map((x) => [x.id, x.parts.servers[0].runs]), [["discord@acme", "node server.js"]]);
    // Uninstall: its copy goes, its data folder stays unless asked.
    const gone = p.uninstall("discord@acme");
    assert.deepEqual([gone.data, gone.kept], [null, join(dataDir, "plugins", "data", "discord@acme")]);
    assert.equal(existsSync(join(dataDir, "plugins", "installed", "discord@acme")), false);
    assert.ok(existsSync(join(dataDir, "plugins", "data", "discord@acme", "state.json")));
    await p.install({ from: "claude/acme", name: "discord" });
    p.uninstall("discord@acme", { data: true });
    assert.equal(existsSync(join(dataDir, "plugins", "data", "discord@acme")), false);
    assert.deepEqual(p.list(), []);
    // Sources Filament does not install from, in words.
    src.entries.npm = { source: { kind: "npm", package: "@acme/x", version: "" } };
    await assert.rejects(p.install({ from: "claude/acme", name: "npm" }), { status: 422, message: "It comes from npm, which Filament does not install from yet." });
    src.entries.odd = { source: { kind: "unknown", said: "a Python package, which Filament does not install" } };
    await assert.rejects(p.install({ from: "claude/acme", name: "odd" }), { status: 422 });
    await assert.rejects(p.install({ from: "claude/acme", name: "none" }), { status: 404 });
    assert.equal(readdirSync(join(dataDir, "plugins")).includes("tmp") ? readdirSync(join(dataDir, "plugins", "tmp")).length : 0, 0, "nothing left in tmp");
  });

  test("from a git repository: its folder at the commit, no .git; a pinned commit stays; a new commit, Check brings it", async () => {
    const dataDir = fresh("data-git");
    const repo = fresh("repo");
    const r = repoOf(repo);
    const first = r.head();
    const src = sourcesOf();
    src.entries.discord = { source: { kind: "git", url: pathToFileURL(repo).href, ref: "", sha: "", path: "plugins/discord" } };
    const p = createPlugins({ dataDir, sources: src });
    const v = await p.install({ from: "claude/acme", name: "discord" });
    assert.equal(v.sha, first.slice(0, 12));
    assert.deepEqual([existsSync(join(v.root, ".git")), existsSync(join(v.root, "other")), existsSync(join(v.root, "skills", "access", "SKILL.md"))], [false, false, true], "its folder alone, at the commit");
    // A new commit that changes words: Check fetches the branch's head, and it goes through.
    put(join(repo, "plugins", "discord", "README.md"), "v2\n");
    const second = r.commit();
    const c = await p.check("discord@acme");
    assert.deepEqual([c.newer, c.applied, c.plugin.sha], [true, true, second.slice(0, 12)]);
    // A marketplace that pins a commit installs that one.
    src.entries.pinned = { source: { kind: "git", url: pathToFileURL(repo).href, ref: "", sha: first, path: "plugins/discord" } };
    const pinned = await p.install({ from: "claude/acme", name: "pinned" });
    assert.equal(pinned.sha, first.slice(0, 12));
    assert.equal(readFileSync(join(pinned.root, "README.md"), "utf8"), "Discord.\n");
    assert.equal((await p.check("pinned@acme")).newer, false, "the pin stands");
    // A repository that is not there: git's words.
    src.entries.lost = { source: { kind: "git", url: pathToFileURL(join(repo, "nope")).href, ref: "", sha: "", path: "" } };
    await assert.rejects(p.install({ from: "claude/acme", name: "lost" }), { status: 502, message: /^It could not be fetched: / });
  });

  // (fails before: yes — the bug hunt of 10-30, SVC-1/SVC-2: a marketplace's ref of `--upload-pack=<command>` ran the
  // command on a file:// repository, at Install, its sheet's preview and the market's look)
  test("a ref or commit a marketplace names that reads as one of git's options is never taken as one: Install, its preview and the look refuse it, and what it names never runs", async () => {
    const dataDir = fresh("data-git-option");
    const repo = fresh("repo-option");
    repoOf(repo);
    const marker = join(fresh("marker"), "ran.txt");
    const evil = `--upload-pack=echo ran > "${marker.replace(/\\/g, "/")}"; false`;
    const src = sourcesOf();
    src.entries.byRef = { source: { kind: "git", url: pathToFileURL(repo).href, ref: evil, sha: "", path: "plugins/discord" } };
    src.entries.bySha = { source: { kind: "git", url: pathToFileURL(repo).href, ref: "", sha: evil, path: "plugins/discord" } };
    const p = createPlugins({ dataDir, sources: src });
    for (const name of ["byRef", "bySha"]) {
      await assert.rejects(p.install({ from: "claude/acme", name }), { status: 502 });
      await assert.rejects(p.preview({ from: "claude/acme", name }), { status: 502 });
      await assert.rejects(p.look(src.entry("claude/acme", name).entry, "claude"), { status: 502 });
      assert.equal(existsSync(marker), false, `${name}: the command it named never ran`);
    }
    assert.deepEqual(p.list(), []);
  });

  // (fails before: yes — the bug hunt of 10-30, SVC-4: the copy kept a plugin's links as links, and every later read of it
  // followed them, so a SKILL.md that was a link to a file outside put that file's words into the prompt)
  test("a plugin's links: one to a file or a folder inside it is copied as what it points to, one to anything outside — or to a folder that holds it — is left out", async () => {
    const dataDir = fresh("data-links");
    const outside = fresh("outside");
    put(join(outside, "secret.txt"), "the key itself");
    const folder = fresh("src-links");
    pluginAt(folder);
    put(join(folder, "shared", "notes.md"), "shared notes\n");
    mkdirSync(join(folder, "skills", "leak"), { recursive: true });
    const dirLink = process.platform === "win32" ? "junction" : "dir";
    symlinkSync(join(outside, "secret.txt"), join(folder, "skills", "leak", "SKILL.md"), "file");
    symlinkSync(outside, join(folder, "outdir"), dirLink);
    symlinkSync(join(folder, "shared", "notes.md"), join(folder, "commands", "notes.md"), "file");
    symlinkSync(join(folder, "shared"), join(folder, "docs"), dirLink);
    symlinkSync(folder, join(folder, "shared", "up"), dirLink);
    const src = sourcesOf();
    src.entries.discord = { source: { kind: "path", path: folder } };
    const v = await createPlugins({ dataDir, sources: src }).install({ from: "claude/acme", name: "discord" });
    assert.equal(existsSync(join(v.root, "skills", "leak", "SKILL.md")), false, "a link to a file outside is left out");
    assert.equal(existsSync(join(v.root, "outdir")), false, "a link to a folder outside is left out");
    assert.equal(readFileSync(join(v.root, "commands", "notes.md"), "utf8"), "shared notes\n", "a link to a file inside is that file");
    assert.equal(lstatSync(join(v.root, "commands", "notes.md")).isSymbolicLink(), false);
    assert.equal(readFileSync(join(v.root, "docs", "notes.md"), "utf8"), "shared notes\n", "a link to a folder inside is that folder");
    assert.deepEqual([existsSync(join(v.root, "shared", "up")), existsSync(join(v.root, "docs", "up"))], [false, false], "a link to a folder that holds it is left out");
  });

  // (fails before: yes — the bug hunt of 10-30, SVC-8: the look wrote a placeholder for every Markdown name its tree
  // listed, `..` and all, over any file there, so a crafted repository emptied a file outside its folder)
  test("the look: a name of the tree that climbs out of its folder makes nothing there, and a file there is never written over", async () => {
    const dataDir = fresh("data-look-climb");
    const repo = fresh("repo-climb");
    const git = (/** @type {string[]} */ args, input = "") =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: repo, input, stdio: ["pipe", "pipe", "pipe"] }).toString().trim();
    git(["init", "-q"]);
    const blob = git(["hash-object", "-w", "--stdin"], "x\n");
    const climbs = git(["mktree"], `100644 blob ${blob}\tvictim.md\n`);
    const sha = git(["commit-tree", git(["mktree"], `040000 tree ${climbs}\t..\n100644 blob ${blob}\tREADME.md\n`), "-m", "crafted"]);
    git(["update-ref", "refs/heads/crafted", sha]);
    const p = createPlugins({ dataDir, sources: sourcesOf() });
    const victim = join(dataDir, "plugins", "tmp", "victim.md");
    put(victim, "kept\n");
    const look = await p.look(/** @type {any} */ ({ name: "x", title: "X", description: "", source: { kind: "git", url: pathToFileURL(repo).href, ref: "", sha, path: "" } }), "claude");
    assert.equal(look.title, "X");
    assert.equal(readFileSync(victim, "utf8"), "kept\n");
  });

  test("values per place: each checked, a secret sealed on disk and shown as the placeholder; the narrower place over the broader", async () => {
    const dataDir = fresh("data-values");
    const src = sourcesOf();
    const folder = fresh("src-values");
    pluginAt(folder);
    src.entries.discord = { source: { kind: "path", path: folder } };
    const p = createPlugins({ dataDir, sources: src });
    await p.install({ from: "claude/acme", name: "discord" });
    const got = p.setValues("discord@acme", "all", { token: "sk-ALL-123", channel: "eng" });
    assert.deepEqual(got.values, { token: "__SECRET__", channel: "eng" });
    assert.equal(readFileSync(join(dataDir, "plugins", "values.json"), "utf8").includes("sk-ALL-123"), false, "sealed on disk");
    p.setValues("discord@acme", "project:p1", { token: "sk-P1-456" });
    assert.deepEqual(p.valuesFor("discord@acme", ["all", "project:p1"]), { token: "sk-P1-456", channel: "eng" });
    assert.deepEqual(p.valuesFor("discord@acme", ["all", "project:p2"]), { token: "sk-ALL-123", channel: "eng" });
    // The placeholder written back keeps the secret; other values change.
    p.setValues("discord@acme", "all", { token: "__SECRET__", channel: "general", verbose: true });
    assert.deepEqual(p.valuesFor("discord@acme", ["all"]), { token: "sk-ALL-123", channel: "general", verbose: true });
    assert.throws(() => p.setValues("discord@acme", "all", { channel: "random" }), { status: 400, message: "Channel is one of general, eng." });
    assert.throws(() => p.setValues("discord@acme", "everywhere", {}), { status: 400, message: "say the place: all, project:<id> or chat:<id>" });
    assert.throws(() => p.valuesAt("nope@acme", "all"), { status: 404 });
    // None given clears the place's; uninstalling clears them all.
    p.setValues("discord@acme", "project:p1", {});
    assert.deepEqual(p.valuesAt("discord@acme", "project:p1").values, {});
    p.uninstall("discord@acme");
    assert.deepEqual(JSON.parse(readFileSync(join(dataDir, "plugins", "values.json"), "utf8")), { version: 1, places: {} });
    assert.equal(treeKey(folder), treeKey(folder), "a folder's key is its own");
  });
});

describe("the routes", () => {
  test("install from a marketplace on this computer, list, values, check, uninstall; refusals in words", async (t) => {
    const home = fresh("home");
    const market = join(home, ".claude", "plugins", "marketplaces", "acme");
    put(join(home, ".claude", "plugins", "known_marketplaces.json"), { acme: { source: { source: "github", repo: "acme/plugins" }, installLocation: market } });
    put(join(market, ".claude-plugin", "marketplace.json"), { name: "acme", plugins: [{ name: "discord", source: "./plugins/discord" }] });
    pluginAt(join(market, "plugins", "discord"));
    const was = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME };
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    t.after(() => {
      for (const [k, v] of Object.entries(was)) if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
    const shim = await startApp();
    t.after(() => shim.stop());
    // An install or an uninstall rides the feed, as no config change does: the left bar's Plugins & Connectors counts again.
    // (fails before: yes — the feed said nothing, and the count stood until the bar's next read, minutes later)
    /** @type {string[]} */
    const told = [];
    const unhear = /** @type {any} */ (shim.app).events.subscribe("config", (/** @type {any} */ p) => p?.type === "plugins-changed" && told.push(p.id));
    t.after(() => unhear());
    const call = async (/** @type {string} */ path, /** @type {any} */ o = {}) => {
      const res = await shim.api(path, o);
      return { status: res.status, body: await res.json() };
    };
    const id = encodeURIComponent("discord@acme");
    // Read before it is installed (B5): what it holds, nothing kept.
    const pre = await call("/api/plugins/preview", { method: "POST", body: { from: "claude/acme", name: "discord" } });
    assert.deepEqual([pre.status, pre.body.id, pre.body.installed, pre.body.parts.asks.length, typeof pre.body.weight], [200, "discord@acme", false, 3, "number"], JSON.stringify(pre.body));
    assert.deepEqual((await call("/api/plugins/installed")).body.plugins, [], "a preview installs nothing");
    assert.equal((await call("/api/plugins/preview", { method: "POST", body: { from: "claude/acme" } })).status, 400);
    const ins = await call("/api/plugins/install", { method: "POST", body: { from: "claude/acme", name: "discord" } });
    assert.deepEqual([ins.status, ins.body.plugin.id, ins.body.plugin.parts.asks.length], [200, "discord@acme", 3], JSON.stringify(ins.body));
    assert.deepEqual((await call("/api/plugins/installed")).body.plugins.map((/** @type {any} */ x) => x.id), ["discord@acme"]);
    assert.deepEqual(await call("/api/plugins/install", { method: "POST", body: { from: "claude/acme" } }), { status: 400, body: { error: "say { from, name }: the source's id (a marketplace's, or directory) and the plugin's name" } });
    assert.equal((await call("/api/plugins/install", { method: "POST", body: { from: "claude/acme", name: "discord" } })).status, 409);
    assert.deepEqual(told, ["discord@acme"], "said once: a refused install changes nothing");
    const set = await call(`/api/plugins/installed/${id}/values`, { method: "POST", body: { place: "all", values: { token: "sk-route-1" } } });
    assert.deepEqual([set.status, set.body.values], [200, { token: "__SECRET__" }]);
    assert.deepEqual((await call(`/api/plugins/installed/${id}/values?place=all`)).body.values, { token: "__SECRET__" }, "never sent back");
    assert.equal((await call("/api/plugins/preview", { method: "POST", body: { from: "claude/acme", name: "discord" } })).body.installed, true);
    // Turned on for every chat; where it is on rides with it; a place it cannot name is refused in words.
    const on = await call(`/api/plugins/installed/${id}/on`, { method: "POST", body: { place: "all", on: true } });
    assert.deepEqual(on, { status: 200, body: { ok: true, place: "all", label: "all chats", on: true, hooks: false, here: true } });
    assert.deepEqual((await call("/api/plugins/installed")).body.plugins[0].on, [{ place: "all", label: "all chats", on: true, hooks: false }]);
    assert.deepEqual((await call(`/api/plugins/installed/${id}/on?place=all`)).body, { place: "all", label: "all chats", on: true, hooks: false, here: true });
    assert.deepEqual(await call(`/api/plugins/installed/${id}/on`, { method: "POST", body: { place: "everywhere", on: true } }), { status: 400, body: { error: "say the place: all, project:<id> or chat:<id>" } });
    assert.equal((await call(`/api/plugins/installed/${encodeURIComponent("nope@acme")}/on`, { method: "POST", body: { place: "all", on: true } })).status, 404);
    assert.equal((await call(`/api/plugins/installed/${id}/check`, { method: "POST", body: {} })).body.newer, false);
    assert.equal((await call(`/api/plugins/installed/${id}/update`, { method: "POST", body: {} })).status, 409);
    const gone = await call(`/api/plugins/installed/${id}?data=1`, { method: "DELETE" });
    assert.deepEqual([gone.status, gone.body.removed.id, gone.body.removed.kept], [200, "discord@acme", null]);
    assert.equal((await call(`/api/plugins/installed/${id}`)).status, 404);
    assert.deepEqual(told, ["discord@acme", "discord@acme"], "the uninstall said too");
    // Uninstalled, it is on nowhere: installed again, it starts off.
    await call("/api/plugins/install", { method: "POST", body: { from: "claude/acme", name: "discord" } });
    assert.deepEqual((await call(`/api/plugins/installed/${id}/on?place=all`)).body.on, false);
  });
});
