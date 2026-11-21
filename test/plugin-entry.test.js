// @ts-check
// A marketplace's entry's own parts (the owner's LSP of 11-04): Claude Code's official marketplace writes gopls-lsp's
// language server in its entry alone (`strict: false`), the plugin's folder holding a LICENSE and a README. An entry's
// parts are kept as written (core/plugins.js) and read as Claude Code reads them (core/plugin-parts.js,
// app/plugins.js): a `strict: false` entry is the whole manifest — beside a plugin.json that says what it holds too,
// refused, the two in conflict —; a strict one adds to the plugin.json: its MCP servers, hooks (off until switched on),
// commands and agents beside the plugin.json's. The install keeps the entry, so a change in the marketplace is an
// update: one that changes what runs waits for Update.
// (fails before: yes — an entry's own parts were dropped, and installing gopls-lsp brought no language server)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { marketplaceOf } from "../src/core/plugins.js";
import { inlineConflict, partPaths } from "../src/core/plugin-parts.js";
import { createPlugins } from "../src/app/plugins.js";
import { createPluginSources } from "../src/app/plugin-sources.js";
import { languageServers, serverFor } from "../src/adapters/lsp/servers.js";
import { removeDirs } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
/** @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-plugin-entry-${tag}-`));
  made.push(d);
  return d;
};
/** @param {string} path @param {unknown} body */
const put = (path, body) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body, null, 2));
};
/** A path as the bash a hook runs in reads it. @param {string} s */
const slashed = (s) => (process.platform === "win32" ? s.replace(/\\/g, "/") : s);

/** gopls-lsp's entry as Claude Code's official marketplace writes it (11-04). */
const GOPLS = {
  name: "gopls-lsp",
  description: "Go language server for code intelligence and refactoring",
  version: "1.0.0",
  author: { name: "Anthropic", email: "support@anthropic.com" },
  source: "./plugins/gopls-lsp",
  category: "development",
  strict: false,
  lspServers: { gopls: { command: "gopls", extensionToLanguage: { ".go": "go" } } },
};

/** A stand-in for the sources: one marketplace whose entries the test sets, each as core/plugins.js gives it. */
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

describe("an entry's own parts (core)", () => {
  test("a marketplace's list keeps the parts an entry writes, with its strict — true unless it says false; an entry that writes none has none", () => {
    const got = marketplaceOf({
      name: "claude-plugins-official",
      plugins: [
        GOPLS,
        { name: "box", source: { source: "url", url: "https://github.com/box/skills.git", sha: "84320fd8984b95cab430335cd341d8314c14bbcb" }, skills: ["./skills/box"], homepage: "https://github.com/box/skills" },
        { name: "plain", description: "words alone", source: "./plugins/plain", strict: false, tags: ["x"] },
      ],
    });
    assert.ok(got.ok);
    assert.deepEqual(got.market.plugins.map((p) => p.inline), [{ strict: false, parts: { lspServers: GOPLS.lspServers } }, { strict: true, parts: { skills: ["./skills/box"] } }, undefined]);
  });

  test("where the parts stand: a strict:false entry's alone; a strict one's beside the plugin.json's — its folders after, its own object beside a file; a plugin.json that says what it holds beside a whole-manifest entry, in conflict", () => {
    const plugin = { commands: "./extra", hooks: "./config/hooks.json" };
    const lsp = { gopls: { command: "gopls", extensionToLanguage: { ".go": "go" } } };
    const whole = partPaths(plugin, "claude", { strict: false, parts: { lspServers: lsp } });
    assert.deepEqual([whole.commands, whole.hooks, whole.mcp, whole.lsp], [["commands"], ["hooks/hooks.json"], [".mcp.json"], lsp], "the plugin.json's fields not read");
    const hooks = { PostToolUse: [{ hooks: [{ type: "command", command: "x" }] }] };
    const extra = { extra: { command: "node" } };
    const added = partPaths(plugin, "claude", { strict: true, parts: { commands: ["./more", "./extra"], hooks, mcpServers: extra, agents: "./crew/a.md" } });
    assert.deepEqual([added.commands, added.agents, added.hooks, added.mcp, added.lsp], [["commands", "extra", "more"], ["agents", "crew/a.md"], ["config/hooks.json", hooks], [".mcp.json", extra], [".lsp.json"]]);
    assert.equal(
      inlineConflict({ name: "x", commands: "./c", mcpServers: {} }, { strict: false, parts: { lspServers: lsp } }),
      "Its marketplace's entry is its whole manifest (strict: false), and its plugin.json says what it holds too (commands, mcpServers): the two are in conflict, and Filament does not install it.",
    );
    assert.equal(inlineConflict({ name: "x", version: "1.0.0" }, { strict: false, parts: { lspServers: lsp } }), "", "a plugin.json of words alone");
    assert.equal(inlineConflict({ commands: "./c" }, { strict: true, parts: { commands: ["./d"] } }), "", "a strict entry adds");
  });
});

describe("installed (app)", () => {
  test("gopls-lsp@claude-plugins-official, from Claude Code's own marketplace: its sheet and its install bring its language server, which serves a .go file", async () => {
    const home = fresh("home");
    const market = join(home, ".claude", "plugins", "marketplaces", "claude-plugins-official");
    put(join(home, ".claude", "plugins", "known_marketplaces.json"), { "claude-plugins-official": { source: { source: "github", repo: "anthropics/claude-plugins-official" }, installLocation: market } });
    put(join(market, ".claude-plugin", "marketplace.json"), { name: "claude-plugins-official", description: "Anthropic's", owner: { name: "Anthropic" }, plugins: [GOPLS] });
    put(join(market, "plugins", "gopls-lsp", "LICENSE"), "Apache License\n");
    put(join(market, "plugins", "gopls-lsp", "README.md"), "# gopls-lsp\n");
    const dataDir = fresh("data");
    const p = createPlugins({ dataDir, sources: createPluginSources({ dataDir, home }) });
    const row = { name: "gopls", as: "gopls-lsp-gopls", runs: "gopls", files: [".go"] };
    const pre = await p.preview({ from: "claude/claude-plugins-official", name: "gopls-lsp" });
    assert.deepEqual([pre.id, pre.parts.lsp, pre.parts.notHere], ["gopls-lsp@claude-plugins-official", [row], []]);
    const v = await p.install({ from: "claude/claude-plugins-official", name: "gopls-lsp" });
    assert.deepEqual([v.id, v.version, v.parts.lsp], ["gopls-lsp@claude-plugins-official", "1.0.0", [row]]);
    const got = p.into({ plugins: { on: [{ id: v.id, hooks: false }] }, lsp: { servers: [] } }, { project: "p1", cwd: "/w/app" });
    const s = got.lsp.plugins[0];
    assert.deepEqual([got.lsp.plugins.length, s.name, s.command, s.languages, s.env.CLAUDE_PLUGIN_ROOT, s.plugin], [1, "gopls-lsp-gopls", "gopls", { ".go": "go" }, v.root, v.id]);
    assert.equal(serverFor("main.go", languageServers(got.lsp), { found: () => true }).server?.name, "gopls-lsp-gopls");
  });

  test("a strict entry adds to the plugin.json: its MCP servers, its hooks — off until switched on —, its commands and agents beside the plugin's own; a skill folder named in a default one, once", async () => {
    const folder = fresh("guard");
    put(join(folder, ".claude-plugin", "plugin.json"), { name: "guard", version: "1.0.0", description: "Guards" });
    put(join(folder, ".mcp.json"), { mcpServers: { notes: { command: "node", args: ["notes.js"] } } });
    put(join(folder, "hooks", "hooks.json"), { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "node own.js" }] }] } });
    put(join(folder, "commands", "own.md"), "Own.\n");
    put(join(folder, "agents", "own.md"), "---\nname: own\n---\nOwn.\n");
    put(join(folder, "more", "deploy.md"), "Deploy.\n");
    put(join(folder, "more", "reviewer.md"), "---\nname: reviewer\ndescription: Reviews a change\ntools: Read, Grep\n---\nReview it.\n");
    put(join(folder, "skills", "box", "SKILL.md"), "---\nname: box\ndescription: Box files\n---\nBody.\n");
    const src = sourcesOf();
    src.entries.guard = {
      source: { kind: "path", path: folder },
      inline: {
        strict: true,
        parts: {
          mcpServers: { extra: { command: "node", args: ["extra.js"] } },
          hooks: { PostToolUse: [{ matcher: "Read", hooks: [{ type: "command", command: "node ${CLAUDE_PLUGIN_ROOT}/entry-hook.js" }] }] },
          commands: ["./more/deploy.md"],
          agents: ["./more/reviewer.md"],
          skills: ["./skills/box"],
        },
      },
    };
    const p = createPlugins({ dataDir: fresh("data-guard"), sources: src });
    const v = await p.install({ from: "claude/acme", name: "guard" });
    assert.deepEqual(v.parts.servers.map((/** @type {any} */ x) => [x.name, x.runs]), [["notes", "node notes.js"], ["extra", "node extra.js"]]);
    assert.deepEqual(v.parts.hooks.map((/** @type {any} */ x) => [x.event, x.command]), [["PreToolUse", "node own.js"], ["PostToolUse", "node ${CLAUDE_PLUGIN_ROOT}/entry-hook.js"]]);
    assert.deepEqual([v.parts.commands, v.parts.agents, v.parts.skills], [["commands/own.md", "more/deploy.md"], ["agents/own.md", "more/reviewer.md"], ["skills/box"]]);
    const reviewer = p.agents().find((c) => c.tag === "guard:reviewer");
    assert.deepEqual([reviewer?.goodFor, reviewer?.may], ["Reviews a change", "read"]);
    const doc = (/** @type {boolean} */ hooks) => ({ plugins: { on: [{ id: "guard@acme", hooks }] } });
    let got = p.into(doc(false), { project: "p1", cwd: "/w/app" });
    assert.deepEqual([got.plugins.mcp.map((/** @type {any} */ m) => m.name), got.hooks], [["guard-notes", "guard-extra"], undefined], "its hooks off here: none of them");
    got = p.into(doc(true), { project: "p1", cwd: "/w/app" });
    assert.deepEqual(got.hooks.map((/** @type {any} */ x) => [x.on, x.matcher, x.command]), [["pre-tool", "Bash", "node own.js"], ["post-tool", "Read", `node ${slashed(v.root)}/entry-hook.js`]]);
  });

  test("a strict:false entry is the whole manifest: the connectors' look and the install read its servers; beside a plugin.json that says what it holds too, the sheet and the install refuse it", async () => {
    const bare = fresh("bare");
    put(join(bare, "README.md"), "Docs.\n");
    const both = fresh("both");
    put(join(both, ".claude-plugin", "plugin.json"), { name: "both", commands: "./cmds" });
    const src = sourcesOf();
    const inline = { strict: false, parts: { mcpServers: { docs: { command: "node", args: ["docs.js"] } } } };
    src.entries.docs = { source: { kind: "path", path: bare }, inline };
    src.entries.both = { source: { kind: "path", path: both }, inline };
    const p = createPlugins({ dataDir: fresh("data-whole"), sources: src });
    const look = await p.look(src.entry("claude/acme", "docs").entry, "claude");
    assert.deepEqual(look.servers, [{ name: "docs", spec: { command: "node", args: ["docs.js"] } }]);
    assert.deepEqual((await p.install({ from: "claude/acme", name: "docs" })).parts.servers.map((/** @type {any} */ x) => x.as), ["docs"]);
    const words = "Its marketplace's entry is its whole manifest (strict: false), and its plugin.json says what it holds too (commands): the two are in conflict, and Filament does not install it.";
    await assert.rejects(p.preview({ from: "claude/acme", name: "both" }), { status: 422, message: words });
    await assert.rejects(p.install({ from: "claude/acme", name: "both" }), { status: 422, message: words });
    assert.deepEqual(p.list().map((x) => x.id), ["docs@acme"]);
  });

  test("the install keeps its entry: a restart reads the entry as installed; a change in the marketplace is an update — what runs waits for Update, words go through — and nothing that moved is nothing newer", async () => {
    const folder = fresh("gopls");
    put(join(folder, "README.md"), "# gopls-lsp\n");
    put(join(folder, "docs", "go.md"), "Go notes.\n");
    const src = sourcesOf();
    const lsp = (/** @type {string[]} */ args) => ({ gopls: { command: "gopls", ...(args.length ? { args } : {}), extensionToLanguage: { ".go": "go" } } });
    src.entries["gopls-lsp"] = { version: "1.0.0", source: { kind: "path", path: folder }, inline: { strict: false, parts: { lspServers: lsp([]) } } };
    const dataDir = fresh("data-update");
    let at = 1000;
    const p = createPlugins({ dataDir, sources: src, now: () => at });
    const v = await p.install({ from: "claude/acme", name: "gopls-lsp" });
    assert.deepEqual(v.parts.lsp.map((/** @type {any} */ x) => x.runs), ["gopls"]);
    at = 2000;
    let c = await p.check("gopls-lsp@acme");
    assert.deepEqual([c.newer, c.applied, c.plugin.checked], [false, false, 2000], "nothing moved: nothing newer");
    // The marketplace's entry changes what runs: a restart still reads the entry it was installed with.
    src.entries["gopls-lsp"].inline = { strict: false, parts: { lspServers: lsp(["serve"]) } };
    assert.deepEqual(createPlugins({ dataDir, sources: src }).get("gopls-lsp@acme").parts.lsp.map((/** @type {any} */ x) => x.runs), ["gopls"]);
    c = await p.check("gopls-lsp@acme");
    assert.deepEqual([c.newer, c.applied, c.words, c.plugin.pending?.words, c.plugin.root], [true, false, "its language server gopls runs another way", "its language server gopls runs another way", v.root]);
    assert.deepEqual(p.get("gopls-lsp@acme").parts.lsp.map((/** @type {any} */ x) => x.runs), ["gopls"], "the one in use until Update");
    const u = p.update("gopls-lsp@acme");
    assert.deepEqual([u.parts.lsp.map((/** @type {any} */ x) => x.runs), u.pending], [["gopls serve"], null]);
    // The entry adds a command, its folder as it was: words alone, it goes through.
    src.entries["gopls-lsp"].inline = { strict: false, parts: { lspServers: lsp(["serve"]), commands: ["./docs/go.md"] } };
    c = await p.check("gopls-lsp@acme");
    assert.deepEqual([c.newer, c.applied, c.plugin.parts.commands, c.plugin.parts.lsp.map((/** @type {any} */ x) => x.runs)], [true, true, ["docs/go.md"], ["gopls serve"]]);
    assert.notEqual(c.plugin.root, u.root);
    assert.deepEqual(createPlugins({ dataDir, sources: src }).get("gopls-lsp@acme").parts.commands, ["docs/go.md"], "a restart reads the entry it was updated to");
    // The same entry, its keys in another order: nothing newer.
    src.entries["gopls-lsp"].inline = { parts: { commands: ["./docs/go.md"], lspServers: lsp(["serve"]) }, strict: false };
    assert.equal((await p.check("gopls-lsp@acme")).newer, false);
  });
});
