// @ts-check
// HarnessV4_SpacesPlugins_Plan B1: where plugins come from. The files' words in one shape (core/plugins.js) — a
// marketplace's list in Claude's and Codex's format, a plugin's manifest, Anthropic's directory as Claude Code keeps
// its copy, a source in words, what a person types to add a marketplace —; then a home folder laid out as Claude Code
// and Codex lay theirs (app/plugin-sources.js): what is found, a source's plugins found by a search, a marketplace
// added from a folder, a git repository (cloned, brought up to date, removed) and an address; and the routes.
// (fails before: yes — Filament read no plugin from anywhere)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  directoryOf, foundWords, manifestOf, marketplaceInput, marketplaceOf, pluginName, searchPlugins, sourceOf, sourceWords,
} from "../src/core/plugins.js";
import { createPluginSources, fetchList } from "../src/app/plugin-sources.js";
import { startApp } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
/** @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-plugins-${tag}-`));
  made.push(d);
  return d;
};
/** A file written, its folders made. @param {string} path @param {unknown} body */
const put = (path, body) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body, null, 2));
};

const OFFICIAL = {
  name: "claude-plugins-official",
  description: "Anthropic's",
  owner: { name: "Anthropic" },
  renames: { adlc: "agentforce-adlc", "bad name!": "x" },
  plugins: [
    { name: "discord", description: "Discord messaging bridge", category: "productivity", source: "./external_plugins/discord" },
    { name: "linear", description: "Linear issue tracking", source: "./external_plugins/linear", author: { name: "Linear" } },
    { name: "api-security", description: "42Crunch", source: { source: "git-subdir", url: "https://github.com/42Crunch-AI/claude-plugins.git", path: "plugins/api-security-testing", ref: "v1.5.5", sha: "faf5305385de8afed9468904e8639be737aff39e" } },
    { name: "adlc", source: { source: "url", url: "https://gitlab.com/acme/adlc.git", sha: "09bf1539d41f" } },
    { name: "escape", source: "../../elsewhere" },
    { name: "discord", description: "a second discord", source: "./x" },
    { name: "no name!", source: "./y" },
  ],
};
const DIRECTORY = {
  schemaVersion: 2,
  fetchedAt: "2026-10-25T23:16:05.700Z",
  listings: [
    { id: "plugin_01", name: "Superpowers", summary: "Core skills library", release: { version: "6.4.2" }, links: {}, surfaces: ["claude_code"], source: { type: "directory", repository: { url: "https://github.com/obra/superpowers", reviewed_commit: "8ca22dba9a94f28898bbce59f2537ff4d87c747d" } }, checks: { review: { state: "done", by: { type: "partner" } } } },
    { id: "plugin_02", name: "Linear", summary: "Linear issues", links: { documentation: "https://linear.app/docs" }, surfaces: ["claude_code"], source: { type: "directory", repository: { url: "https://github.com/anthropics/claude-plugins-official", path: "external_plugins/linear", reviewed_commit: "58267944f92187b7d6a1c822165c96c81c864806" } }, checks: { review: { state: "done", by: { type: "anthropic" } } } },
    { id: "plugin_03", name: "Discord", summary: "Discord channel", surfaces: ["claude_code"], source: { type: "directory", repository: { url: "https://github.com/anthropics/claude-plugins-official", path: "external_plugins/discord", reviewed_commit: "aaaaaaa1" } }, checks: { review: { state: "done", by: { type: "anthropic" } } } },
    { id: "plugin_04", name: "Slack Dad Joke", summary: "jokes about linear time", publisher: { name: "AJ" }, surfaces: ["claude_code"], source: { type: "directory", repository: { url: "https://github.com/ajribeiro/slack-dad-joke", reviewed_commit: "bbbbbbb2" } }, checks: { review: { state: "none" } } },
    { id: "plugin_05", name: "No repository", summary: "", source: { type: "directory" } },
  ],
  entryNames: { plugin_01: "superpowers", plugin_02: "linear", plugin_03: "discord", plugin_04: "slack-dad-joke" },
};

describe("the files' words (core)", () => {
  test("a source in one shape and in words: a relative folder, GitHub, git with a folder, npm; one that climbs out or is unknown, said", () => {
    assert.deepEqual(sourceOf("./external_plugins/discord"), { kind: "path", path: "external_plugins/discord" });
    assert.deepEqual(sourceOf({ source: "local", path: "./plugins/pdf" }), { kind: "path", path: "plugins/pdf" }, "Codex's local");
    assert.deepEqual(sourceOf({ source: "github", repo: "obra/superpowers", ref: "main" }), { kind: "github", repo: "obra/superpowers", ref: "main", sha: "", path: "" });
    assert.deepEqual(sourceOf({ source: "git-subdir", url: "https://github.com/amd/skills.git", path: "skills", sha: "6916fb3" }), { kind: "github", repo: "amd/skills", ref: "", sha: "6916fb3", path: "skills" }, "a GitHub address is GitHub");
    assert.deepEqual(sourceOf({ source: "url", url: "https://gitlab.com/acme/adlc.git" }), { kind: "git", url: "https://gitlab.com/acme/adlc.git", ref: "", sha: "", path: "" });
    assert.deepEqual(sourceOf({ source: "npm", package: "@acme/plugin", version: "1.2.0" }), { kind: "npm", package: "@acme/plugin", version: "1.2.0" });
    assert.equal(sourceOf("../../elsewhere").kind, "unknown");
    assert.equal(sourceOf({ source: "git-subdir", url: "https://x/y.git", path: "../up" }).kind, "unknown");
    assert.deepEqual(sourceOf({ source: "pip", package: "x" }), { kind: "unknown", said: "a Python package, which Filament does not install" });
    assert.deepEqual(sourceOf({ source: "ftp" }), { kind: "unknown", said: "a source of the kind ftp, which Filament does not fetch" });
    // A ref, a commit or an address that reads as one of git's options is no source (the bug hunt of 10-30, SVC-1).
    assert.deepEqual(sourceOf({ source: "github", repo: "a/b", ref: "--upload-pack=touch x" }), { kind: "unknown", said: "a branch that reads as one of git's options (--upload-pack=touch x)" });
    assert.deepEqual(sourceOf({ source: "git-subdir", url: "https://github.com/a/b.git", path: "p", sha: "-c" }), { kind: "unknown", said: "a commit that reads as one of git's options (-c)" });
    assert.deepEqual(sourceOf({ source: "url", url: "--upload-pack=touch x" }), { kind: "unknown", said: "an address that reads as one of git's options (--upload-pack=touch x)" });
    assert.equal(sourceWords(sourceOf({ source: "git-subdir", url: "https://github.com/anthropics/claude-plugins-official", path: "external_plugins/linear", sha: "58267944f92187b7" })), "github.com/anthropics/claude-plugins-official · external_plugins/linear at 5826794");
    assert.equal(sourceWords(sourceOf({ source: "url", url: "https://gitlab.com/acme/adlc.git", ref: "v2" })), "gitlab.com/acme/adlc.git at v2");
    assert.equal(sourceWords(sourceOf("./plugins/x")), "./plugins/x");
    // A marketplace added from a folder of this computer names it whole (found on the E50 drive: "./C:\…").
    assert.equal(sourceWords({ kind: "path", path: "C:\\Users\\me\\market" }), "C:\\Users\\me\\market");
    assert.equal(sourceWords({ kind: "path", path: "/home/me/market" }), "/home/me/market");
    assert.equal(sourceWords({ kind: "npm", package: "@acme/p", version: "" }), "npm: @acme/p");
    assert.deepEqual([pluginName("claude-mem"), pluginName("-x"), pluginName("a b"), pluginName("x".repeat(65))], ["claude-mem", null, null, null]);
  });

  test("a marketplace's list, Claude's and Codex's; a plugin's manifest, Claude's and Codex's; refusals in words", () => {
    const got = marketplaceOf(OFFICIAL);
    assert.ok(got.ok);
    assert.deepEqual([got.market.name, got.market.owner, got.market.description], ["claude-plugins-official", "Anthropic", "Anthropic's"]);
    assert.deepEqual(got.market.plugins.map((p) => [p.name, p.source.kind]), [["discord", "path"], ["linear", "path"], ["api-security", "github"], ["adlc", "git"], ["escape", "unknown"]], "a second of a name, and a name neither app takes, left out");
    assert.deepEqual([got.market.plugins[1].author, got.market.plugins[1].title], ["Linear", "linear"]);
    assert.deepEqual(got.market.renames, { adlc: "agentforce-adlc" });
    const codex = marketplaceOf({ name: "openai-bundled", interface: { displayName: "OpenAI Bundled" }, plugins: [{ name: "browser", source: { source: "local", path: "./plugins/browser" }, policy: { installation: "AVAILABLE" }, category: "Engineering" }] });
    assert.ok(codex.ok);
    assert.deepEqual([codex.market.title, codex.market.plugins[0].category, codex.market.plugins[0].source], ["OpenAI Bundled", "Engineering", { kind: "path", path: "plugins/browser" }]);
    assert.deepEqual(marketplaceOf([]), { ok: false, error: "it is not a marketplace: no JSON object" });
    assert.deepEqual(marketplaceOf({ name: "x" }), { ok: false, error: "it is not a marketplace: it lists no plugins" });
    const claude = manifestOf({ name: "discord", description: "Discord channel", version: "0.0.4", keywords: ["discord", 3], author: { name: "Anthropic" } });
    assert.ok(claude.ok);
    assert.deepEqual([claude.manifest.title, claude.manifest.version, claude.manifest.keywords, claude.manifest.author], ["discord", "0.0.4", ["discord"], "Anthropic"]);
    const cx = manifestOf({ name: "code-review", version: "26.1", description: "Review PRs", interface: { displayName: "Code Review", developerName: "OpenAI" } });
    assert.ok(cx.ok);
    assert.deepEqual([cx.manifest.title, cx.manifest.author], ["Code Review", "OpenAI"]);
    assert.equal(manifestOf({ description: "x" }).ok, false);
  });

  test("Anthropic's directory: each listing with the name it installs under, who reviewed it and the commit; a search, a page", () => {
    const got = directoryOf(DIRECTORY);
    assert.ok(got.ok);
    assert.equal(got.fetchedAt, "2026-10-25T23:16:05.700Z");
    assert.deepEqual(got.listings.map((l) => [l.id, l.name, l.title, l.reviewed]), [["plugin_01", "superpowers", "Superpowers", "partner"], ["plugin_02", "linear", "Linear", "anthropic"], ["plugin_03", "discord", "Discord", "anthropic"], ["plugin_04", "slack-dad-joke", "Slack Dad Joke", ""]], "one with no repository left out");
    assert.deepEqual(got.listings[1].source, { kind: "github", repo: "anthropics/claude-plugins-official", ref: "", sha: "58267944f92187b7d6a1c822165c96c81c864806", path: "external_plugins/linear" });
    assert.deepEqual([got.listings[1].docs, got.listings[3].publisher, got.listings[0].version], ["https://linear.app/docs", "AJ", "6.4.2"]);
    // "linear": the one named so first, then one whose words say it.
    assert.deepEqual(searchPlugins(got.listings, { q: "linear" }).items.map((l) => l.name), ["linear", "slack-dad-joke"]);
    assert.deepEqual(searchPlugins(got.listings, { q: "LINEAR time" }).items.map((l) => l.name), ["slack-dad-joke"], "every word");
    assert.deepEqual(searchPlugins(got.listings, { limit: 2, offset: 1 }), { total: 4, items: got.listings.slice(1, 3) });
    assert.deepEqual(directoryOf({ listings: "no" }), { ok: false, error: "it is not Claude Code's copy of the directory: no listings" });
  });

  test("what a person types to add a marketplace; the line the Plugins page heads its list with", () => {
    assert.deepEqual(marketplaceInput("thedotmack/claude-mem"), { ok: true, source: { kind: "github", repo: "thedotmack/claude-mem", ref: "", sha: "", path: "" } });
    assert.deepEqual(marketplaceInput("https://github.com/anthropics/claude-plugins-official.git"), { ok: true, source: { kind: "github", repo: "anthropics/claude-plugins-official", ref: "", sha: "", path: "" } });
    assert.deepEqual(marketplaceInput("git@gitlab.com:acme/plugins.git"), { ok: true, source: { kind: "git", url: "git@gitlab.com:acme/plugins.git", ref: "", sha: "", path: "" } });
    assert.equal(marketplaceInput("file:///C:/x/repo").ok, true);
    assert.deepEqual(marketplaceInput("https://example.com/m/marketplace.json"), { ok: true, source: { kind: "url", url: "https://example.com/m/marketplace.json" } });
    assert.deepEqual(marketplaceInput("C:\\Users\\me\\plugins"), { ok: true, source: { kind: "path", path: "C:\\Users\\me\\plugins" } });
    assert.deepEqual(marketplaceInput("https://example.com/page"), { ok: false, error: "That address is neither a git repository (….git) nor a marketplace.json." });
    assert.equal(marketplaceInput("not a thing").ok, false);
    assert.equal(marketplaceInput("").ok, false);
    assert.equal(foundWords({ claude: ["Discord"], codex: ["Browser", "Code Review", "PDF", "Documents", "Spreadsheets"] }), "Found on this computer — Claude Code: Discord · Codex: Browser, Code Review, PDF and 2 more");
    assert.equal(foundWords({ claude: [], codex: ["Browser", "PDF"] }), "Found on this computer — Codex: Browser and PDF");
    assert.equal(foundWords({ claude: [], codex: [] }), "");
  });
});

/** A home folder laid out as Claude Code and Codex lay theirs. */
function homeOf() {
  const home = fresh("home");
  const cp = join(home, ".claude", "plugins");
  const official = join(cp, "marketplaces", "claude-plugins-official");
  put(join(cp, "known_marketplaces.json"), {
    "claude-plugins-official": { source: { source: "github", repo: "anthropics/claude-plugins-official" }, installLocation: official, lastUpdated: "2026-10-25T23:30:22.320Z" },
    gone: { source: { source: "github", repo: "someone/gone" }, installLocation: join(cp, "marketplaces", "gone") },
  });
  put(join(official, ".claude-plugin", "marketplace.json"), OFFICIAL);
  put(join(cp, "plugin-directory-cache-v2.json"), DIRECTORY);
  // Installed in Claude Code (version 2's shape), and one Claude Desktop synced down.
  const linear = join(cp, "cache", "claude-plugins-official", "linear", "1.0.0");
  put(join(linear, ".claude-plugin", "plugin.json"), { name: "linear", description: "Linear issue tracking integration" });
  put(join(cp, "installed_plugins.json"), { version: 2, plugins: { "linear@claude-plugins-official": [{ scope: "user", installPath: linear, version: "1.0.0" }] } });
  const synced = join(cp, "synced", "acct_org");
  put(join(synced, "manifest.json"), { plugins: [{ pluginId: "plugin_03", name: "1d0e901b", description: "Discord channel", version: "0002", marketplaceName: "anthropic-plugin-directory" }] });
  put(join(synced, "1d0e901b", ".claude-plugin", "plugin.json"), { name: "discord", description: "Discord channel for Claude Code", version: "0.0.4" });
  // Codex: a local marketplace (its path as Codex writes it on Windows), its cache, and ~/.agents' own.
  const bundled = join(home, ".codex", ".tmp", "bundled-marketplaces", "openai-bundled");
  put(join(bundled, ".agents", "plugins", "marketplace.json"), { name: "openai-bundled", interface: { displayName: "OpenAI Bundled" }, plugins: [{ name: "browser", source: { source: "local", path: "./plugins/browser" } }, { name: "pdf", source: { source: "local", path: "./plugins/pdf" } }] });
  const prefix = process.platform === "win32" ? "\\\\?\\" : "";
  put(join(home, ".codex", "config.toml"), [
    "[marketplaces.openai-bundled]", 'source_type = "local"', `source = '${prefix}${bundled}'`, "",
    "[marketplaces.remote-one]", 'source_type = "git"', "source = 'https://example.com/remote.git'", "",
    '[plugins."browser@openai-bundled"]', "enabled = true", "",
    '[plugins."pdf@openai-bundled"]', "enabled = false", "",
  ].join("\n"));
  put(join(home, ".codex", "plugins", "cache", "openai-bundled", "browser", "26.1007", ".codex-plugin", "plugin.json"), { name: "browser", version: "26.1007", description: "Drive a browser", interface: { displayName: "Browser" } });
  put(join(home, ".codex", "plugins", "cache", "openai-bundled", "pdf", "26.1013", ".codex-plugin", "plugin.json"), { name: "pdf", version: "26.1013", interface: { displayName: "PDF" } });
  put(join(home, ".codex", "plugins", "cache", "openai-curated", "work-pets", "0.1.6", ".codex-plugin", "plugin.json"), { name: "work-pets", version: "0.1.6", interface: { displayName: "Pets" } });
  put(join(home, ".agents", "plugins", "marketplace.json"), { name: "mine", plugins: [{ name: "notes", source: { source: "local", path: "./plugins/notes" } }] });
  return { home, official };
}

/** A marketplace in its own git repository: its list, one plugin; `git` with an identity of its own. @param {string} dir @param {string[]} names */
function repoOf(dir, names) {
  mkdirSync(dir, { recursive: true });
  const git = (/** @type {string[]} */ ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: dir, stdio: "pipe" });
  put(join(dir, ".claude-plugin", "marketplace.json"), { name: "acme", owner: { name: "Acme" }, plugins: names.map((n) => ({ name: n, source: `./plugins/${n}` })) });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "one");
  return { commit: (/** @type {string[]} */ more) => {
    put(join(dir, ".claude-plugin", "marketplace.json"), { name: "acme", owner: { name: "Acme" }, plugins: more.map((n) => ({ name: n, source: `./plugins/${n}` })) });
    git("add", "-A");
    git("commit", "-q", "-m", "two");
  } };
}

describe("where plugins come from on this computer (app)", () => {
  test("found: Claude Code's marketplaces and plugins, Claude Desktop's, the directory, Codex's; each part's failure said", () => {
    const { home, official } = homeOf();
    const s = createPluginSources({ dataDir: fresh("data"), home });
    const f = s.found();
    assert.equal(f.line, "Found on this computer — Claude Code: Linear and Discord · Codex: Browser and Pets", "Codex's switched-off PDF is not named");
    assert.deepEqual(f.claude.marketplaces.map((m) => [m.id, m.name, m.count, m.origin, m.error]), [
      ["claude/claude-plugins-official", "claude-plugins-official", 5, "github.com/anthropics/claude-plugins-official", ""],
      ["claude/gone", "gone", 0, "github.com/someone/gone", `its folder ${join(home, ".claude", "plugins", "marketplaces", "gone")} is not there`],
    ]);
    assert.deepEqual(f.claude.installed.map((p) => [p.name, p.title, p.version, p.marketplace, p.from]), [
      ["linear", "Linear", "1.0.0", "claude-plugins-official", "claude"],
      ["discord", "Discord", "0.0.4", "anthropic-plugin-directory", "claude-desktop"],
    ], "the synced one's name from its directory listing");
    assert.deepEqual(f.directory, { there: true, count: 4, fetchedAt: "2026-10-25T23:16:05.700Z", error: "" });
    assert.deepEqual(f.codex.marketplaces.map((m) => [m.id, m.count, m.error ? "said" : ""]), [["codex/openai-bundled", 2, ""], ["codex/remote-one", 0, "said"], ["codex/mine", 1, ""]]);
    assert.deepEqual(f.codex.installed.map((p) => [p.name, p.title, p.marketplace, p.enabled]), [["browser", "Browser", "openai-bundled", true], ["pdf", "PDF", "openai-bundled", false], ["work-pets", "Pets", "openai-curated", null]]);
    assert.deepEqual(f.added, []);
    // Each plugin of a marketplace: its folder made one of this computer, where it comes from in words, where installed.
    const e = s.entries("claude/claude-plugins-official");
    assert.equal(e.total, 5);
    assert.deepEqual(e.plugins.map((p) => [p.name, p.installedIn]), [["discord", []], ["linear", ["Claude Code"]], ["api-security", []], ["adlc", []], ["escape", []]]);
    assert.deepEqual(e.plugins[0].source, { kind: "path", path: join(official, "external_plugins", "discord") });
    assert.equal(e.plugins[2].where, "github.com/42Crunch-AI/claude-plugins · plugins/api-security-testing at faf5305");
    assert.equal(e.plugins[4].where, "a folder outside its marketplace (../../elsewhere)");
    assert.deepEqual(s.entries("codex/openai-bundled").plugins.map((p) => [p.name, p.installedIn]), [["browser", ["Codex"]], ["pdf", ["Codex"]]]);
    // An install's entry is titled as the connectors' picker shows it: the directory's name, else its own words' casing.
    assert.deepEqual([s.entry("claude/claude-plugins-official", "discord").entry.title, s.entry("claude/claude-plugins-official", "linear").entry.title, s.entry("claude/claude-plugins-official", "escape").entry.title], ["Discord", "Linear", "Escape"]);
    // The directory, found by a search: what Claude Desktop synced says so.
    const d = s.entries("directory", { q: "discord" });
    assert.deepEqual([d.total, d.plugins[0].name, d.plugins[0].installedIn, d.plugins[0].where], [1, "discord", ["Claude Desktop"], "github.com/anthropics/claude-plugins-official · external_plugins/discord at aaaaaaa"]);
    assert.throws(() => s.entries("claude/nope"), { status: 404, message: "There is no such marketplace here." });
    // Nothing of either app's: nothing found, no failure.
    const bare = createPluginSources({ dataDir: fresh("data2"), home: fresh("empty") }).found();
    assert.deepEqual([bare.line, bare.claude.there, bare.claude.marketplaces, bare.directory.there, bare.codex.installed, bare.claude.error], ["", false, [], false, [], ""]);
    assert.throws(() => createPluginSources({ dataDir: fresh("data3"), home: fresh("empty2") }).entries("directory"), { status: 404 });
  });

  test("a marketplace you add: a folder read where it stands; a git repository cloned, brought up to date, removed; an address's list; refusals", async () => {
    const dataDir = fresh("data");
    let at = 1000;
    /** @type {string[]} */
    const fetched = [];
    const s = createPluginSources({
      dataDir,
      home: fresh("home-add"),
      now: () => at,
      fetchText: async (url) => {
        fetched.push(url);
        return JSON.stringify({ name: "listed", plugins: [{ name: "far", source: { source: "github", repo: "acme/far" } }, { name: "near", source: "./plugins/near" }] });
      },
    });
    // A folder: read in place, never copied.
    const folder = fresh("folder");
    put(join(folder, ".claude-plugin", "marketplace.json"), { name: "local-one", plugins: [{ name: "x", source: "./plugins/x" }] });
    const a = await s.add(folder);
    assert.deepEqual([a.id.startsWith("added/"), a.name, a.count, a.root, a.error], [true, "local-one", 1, folder, ""]);
    await assert.rejects(s.add(folder), { status: 409, message: "That marketplace is added already." });
    await assert.rejects(s.add(fresh("nolist")), { status: 422, message: /^It is not a marketplace: it holds no marketplace.json\.$/ });
    await assert.rejects(s.add(join(folder, "nope")), { status: 404 });
    await assert.rejects(s.add("not a thing"), { status: 400 });
    // A git repository: cloned into Filament's own folder, its plugins listed; a new commit, Refresh brings it.
    const repo = fresh("repo");
    const r = repoOf(repo, ["one"]);
    const g = await s.add(pathToFileURL(repo).href);
    const id = g.id.slice("added/".length);
    assert.deepEqual([g.name, g.count, g.root], ["acme", 1, join(dataDir, "plugins", "marketplaces", id)]);
    assert.ok(existsSync(join(dataDir, "plugins", "marketplaces", id, ".git")), "a clone of its own");
    assert.deepEqual(s.entries(g.id).plugins.map((p) => [p.name, p.source.kind]), [["one", "path"]]);
    r.commit(["one", "two"]);
    at = 2000;
    const again = await s.refresh(id);
    assert.deepEqual([again.count, again.updated], [2, new Date(2000).toISOString()]);
    // A marketplace.json's address: its list kept; a plugin in a folder of it cannot be fetched, said so.
    const u = await s.add("https://example.com/m/marketplace.json");
    assert.deepEqual([u.name, u.count, fetched], ["listed", 2, ["https://example.com/m/marketplace.json"]]);
    assert.deepEqual(s.entries(u.id).plugins.map((p) => [p.name, p.where]), [["far", "github.com/acme/far"], ["near", "a folder of a marketplace Filament has only the list of"]]);
    // Kept across a restart, in the order added.
    assert.deepEqual(createPluginSources({ dataDir, home: fresh("home-add2") }).found().added.map((m) => m.name), ["local-one", "acme", "listed"]);
    // Removed: Filament's copy goes; a folder given stays.
    assert.deepEqual(s.remove(id), { id: g.id, name: "acme", origin: pathToFileURL(repo).href.replace(/^https?:\/\//, "") });
    assert.equal(existsSync(join(dataDir, "plugins", "marketplaces", id)), false);
    s.remove(a.id.slice("added/".length));
    assert.ok(existsSync(join(folder, ".claude-plugin", "marketplace.json")), "the person's folder is left as it was");
    assert.throws(() => s.remove(id), { status: 404 });
    // A clone that fails says git's words, and leaves nothing.
    await assert.rejects(s.add(pathToFileURL(join(repo, "missing")).href), { status: 502, message: /^It could not be cloned: / });
    assert.deepEqual(s.found().added.map((m) => m.name), ["listed"]);
  });
});

describe("the routes", () => {
  test("GET /api/plugins/sources and /entries; a marketplace added, refreshed and removed; refusals in words", async (t) => {
    const { home } = homeOf();
    const was = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME, CODEX_HOME: process.env.CODEX_HOME };
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    delete process.env.CODEX_HOME;
    t.after(() => {
      for (const [k, v] of Object.entries(was)) if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
    const shim = await startApp();
    t.after(() => shim.stop());
    const call = async (/** @type {string} */ path, /** @type {any} */ o = {}) => {
      const res = await shim.api(path, o);
      return { status: res.status, body: await res.json() };
    };
    const f = await call("/api/plugins/sources");
    assert.equal(f.status, 200);
    assert.equal(f.body.line, "Found on this computer — Claude Code: Linear and Discord · Codex: Browser and Pets");
    const e = await call(`/api/plugins/entries?id=${encodeURIComponent("claude/claude-plugins-official")}&q=linear`);
    assert.deepEqual([e.status, e.body.total, e.body.plugins[0].name], [200, 1, "linear"]);
    assert.deepEqual(await call("/api/plugins/entries"), { status: 400, body: { error: "say which source: ?id=directory, or a marketplace's id" } });
    assert.equal((await call("/api/plugins/entries?id=directory&limit=2")).body.plugins.length, 2);
    const folder = fresh("route-folder");
    put(join(folder, ".claude-plugin", "marketplace.json"), { name: "routed", plugins: [{ name: "x", source: "./x" }] });
    const add = await call("/api/plugins/marketplaces", { method: "POST", body: { source: folder } });
    assert.deepEqual([add.status, add.body.ok, add.body.marketplace.name], [200, true, "routed"]);
    assert.equal((await call(`/api/plugins/marketplaces/${encodeURIComponent(add.body.marketplace.id)}/refresh`, { method: "POST", body: {} })).body.marketplace.count, 1);
    assert.deepEqual(await call("/api/plugins/marketplaces", { method: "POST", body: { source: 3 } }), { status: 400, body: { error: "Say a GitHub repository (owner/repo), a git address, the address of a marketplace.json, or a folder on this computer." } });
    const gone = await call(`/api/plugins/marketplaces/${encodeURIComponent(add.body.marketplace.id)}`, { method: "DELETE" });
    assert.deepEqual([gone.status, gone.body.removed.name], [200, "routed"]);
    assert.equal((await call("/api/plugins/marketplaces/0123456789", { method: "DELETE" })).status, 404);
  });
});

// (fails before: yes — the bug hunt of 10-30, SVC-5: a marketplace.json's address that answered a redirect to this
// computer had Filament GET that address — its own API among them —, and a body was read whole before its cap)
test("a marketplace.json's address: a redirect is followed to the web alone, never to this computer or a name that resolves to it; a body past its cap is cut off as it comes", async () => {
  /** @type {string[]} */
  const asked = [];
  const own = http.createServer((req, res) => {
    asked.push(String(req.url));
    res.end("{}");
  });
  let sent = 0;
  const outer = http.createServer((req, res) => {
    const ownPort = /** @type {import("node:net").AddressInfo} */ (own.address()).port;
    if (req.url === "/to-ip") return void res.writeHead(302, { location: `http://127.0.0.1:${ownPort}/api/upstreams/u/test` }).end();
    if (req.url === "/to-name") return void res.writeHead(302, { location: `http://rebind.example:${ownPort}/api/x` }).end();
    if (req.url === "/big") {
      res.writeHead(200);
      const chunk = Buffer.alloc(1024 * 1024, 32);
      const more = () => {
        while (sent < 64) {
          sent++;
          if (!res.write(chunk)) return void res.once("drain", more);
        }
        res.end();
      };
      return more();
    }
    res.writeHead(200, { "content-type": "application/json" }).end('{"name":"m","plugins":[]}');
  });
  await Promise.all([own, outer].map((s) => new Promise((r) => s.listen(0, "127.0.0.1", () => r(null)))));
  try {
    const base = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (outer.address()).port}`;
    assert.equal(await fetchList(`${base}/list.json`), '{"name":"m","plugins":[]}', "the address given, read where it points");
    await assert.rejects(fetchList(`${base}/to-ip`), { status: 502, message: /^It could not be read: its address sent the read on to 127\.0\.0\.1:\d+, which Filament does not follow \(127\.0\.0\.1 is a private or local address\)\.$/ });
    await assert.rejects(fetchList(`${base}/to-name`, { resolve: async () => ["127.0.0.1"] }), { status: 502, message: /rebind\.example resolves to 127\.0\.0\.1, a private or local address/ });
    assert.deepEqual(asked, [], "this computer was never asked");
    await assert.rejects(fetchList(`${base}/big`), { status: 413, message: "Its marketplace.json is larger than Filament reads." });
    assert.ok(sent < 64, `read up to its cap, not whole (${sent} of 64 MB sent)`);
  } finally {
    own.closeAllConnections();
    outer.closeAllConnections();
    await Promise.all([own, outer].map((s) => new Promise((r) => s.close(() => r(null)))));
  }
});
