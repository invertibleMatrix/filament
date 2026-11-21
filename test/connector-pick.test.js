// @ts-check
// Add a connector (the owner's word of 10-26: "some well know connectors like github, linear … should be easy like
// Claude code to add … maybe sync with claude code or codex … keeping the maintenence in mind"; the Designer's of
// 10-26): the connectors the marketplaces Filament reads list, nothing kept by hand. The words a row and the second step
// say; the catalogue — a folder's plugin read at once, a repository's looked at in the background and kept by its
// commit, one row per service, Add installing and turning it on with its hooks off —; a look at a real repository that
// fetches its JSON files alone; a marketplace's name to show from its own words; and the sheet on the fake DOM.
// (fails before: yes — Add connector offered only the hand-made form: a command or an address to know)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { envAsksOf, envTitle } from "../src/core/plugin-parts.js";
import { createConnectorCatalogue, hostOf, programOf } from "../src/app/connector-catalogue.js";
import { createPlugins, removeTree } from "../src/app/plugins.js";
import { createPluginPlaces } from "../src/app/plugin-places.js";
import { namedIn } from "../src/app/plugin-sources.js";
import {
  BY_HAND, GET_LIST, GROUPS, LATER, NO_LIST, SEALED, SEARCH_HINT, countWords, detailWords, isOnline, moreWords, needWords, notYetWords, openConnectorPick, readingWords, rowWords, serverWords, setupWords, testedWords,
} from "../src/ui/harness/lib/connector-pick.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
/** @type {string[]} */
const made = [];
const tmp = (/** @type {string} */ tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-cpick-${tag}-`));
  made.push(d);
  return d;
};
// git's read-only packs among them, which the desktop app's Node will not delete as they are.
after(() => { for (const d of made) removeTree(d); });

/** A value a server reads, as the look gives it. @param {string} key @param {string} title @param {Record<string, any>} [o] */
const ask = (key, title, o = {}) => ({ key, type: /** @type {const} */ ("string"), title, description: "", default: null, options: [], sensitive: true, required: true, env: true, ...o });
/** A look. @param {Record<string, any>} [o] */
const lookOf = (o = {}) => ({ title: "", description: "", servers: [], asks: [], skills: 0, hooks: 0, commands: 0, agents: 0, ...o });
/** A marketplace as the sources list it. @param {string} id @param {"claude" | "codex" | "added"} from @param {string} name */
const market = (id, from, name) => ({ id, from, name, title: name, description: "", owner: "", root: "", origin: "", updated: "2026-10-20", count: 0, error: "" });

describe("the words", () => {
  test("a row: only what a person must bring, else nothing; where it connects or what it runs on its title's hover (the Designer's of 10-26)", () => {
    const github = { servers: [{ remote: true, host: "api.githubcopilot.com", runs: "", program: "", missing: false }], needs: ["Personal access token"], more: { skills: 0, hooks: 0, commands: 0, agents: 0 }, marketFrom: "claude", market: "claude-plugins-official" };
    assert.deepEqual([rowWords(github), detailWords(github), isOnline(github)], ["Needs a personal access token", "Connects to api.githubcopilot.com", true]);
    const play = { servers: [{ remote: false, host: "", runs: "npx @playwright/mcp", program: "Node.js", missing: false }], needs: [], more: { skills: 2, hooks: 1, commands: 0, agents: 0 }, marketFrom: "codex", market: "openai" };
    assert.deepEqual([rowWords(play), detailWords(play), isOnline(play)], ["", "Runs on this computer: npx @playwright/mcp · also adds 2 skills and a hook · from Codex's marketplace", false]);
    const boost = { servers: [{ remote: false, host: "", runs: "php artisan boost:mcp", program: "PHP", missing: true }], needs: ["Tfe token"], more: { skills: 0, hooks: 0, commands: 0, agents: 0 }, marketFrom: "claude" };
    assert.equal(rowWords(boost), "Needs PHP (not found on this computer) and a tfe token");
    assert.equal(serverWords({ servers: [{ remote: true, host: "", runs: "${ENDPOINT}/mcp" }, { remote: true, host: "", runs: "" }] }), "Connects to an address you give");
    assert.deepEqual([needWords([]), needWords(["API key"]), needWords(["Endpoint", "Access token"]), needWords(["a", "b", "c"]), needWords([], ["uv", "uv"])], ["", "Needs an API key", "Needs an endpoint and an access token", "Needs 3 values", "Needs uv (not found on this computer)"]);
    assert.deepEqual(GROUPS, { mine: "Already in Claude Code", online: "Online services", local: "Tools that run on this computer" });
    assert.equal(moreWords({ skills: 1, hooks: 0, commands: 3, agents: 1 }), "also adds a skill, 3 commands and an agent");
    assert.deepEqual([countWords({ claude: 52, codex: 4, added: 0 }), countWords({ claude: 0, codex: 1, added: 2 })], ["52 connectors from Claude Code's marketplace · 4 from Codex's", "1 connector from Codex's marketplace · 2 from marketplaces you added"]);
    assert.deepEqual([readingWords(87, 312), readingWords(1, 312)], ["Reading plugins: 225 of 312 done — more connectors appear as they're read.", "Reading plugins: 311 of 312 done — more connectors appear as they're read."]);
    assert.equal(notYetWords("figma"), `Nothing is named like "figma" yet — it may still turn up as the plugins are read.`);
    assert.deepEqual(LATER, { reading: "Checking…", failed: "Couldn't be read" });
    assert.equal(SEARCH_HINT, "Search by name, like GitHub or Linear");
  });

  test("the second step: a token, a sign-in, one that runs here; a test's answer", () => {
    const s = { title: "GitHub", servers: [{ remote: true, host: "api.githubcopilot.com", runs: "" }], needs: [ask("GITHUB_PERSONAL_ACCESS_TOKEN", "Personal access token")] };
    assert.equal(setupWords(s, "all chats", "token"), "GitHub is added for all chats. It needs your personal access token before it works.");
    assert.equal(setupWords({ ...s, title: "Linear", servers: [{ remote: true, host: "mcp.linear.app", runs: "" }], needs: [] }, "all chats", "sign-in"), "Linear is added for all chats. Sign in on mcp.linear.app so its tools can reach your account.");
    assert.equal(setupWords({ title: "Playwright", servers: [{ remote: false, host: "", runs: "npx @playwright/mcp" }], needs: [] }, "Work", "local"), "Playwright is added for Work. It runs on this computer when a chat uses it.");
    const linear = { title: "Linear", servers: [{ remote: true, host: "mcp.linear.app", runs: "" }], needs: [] };
    assert.deepEqual([setupWords(linear, "all chats", "waiting"), setupWords(linear, "all chats", "testing"), setupWords(linear, "all chats", "signed", 23)], [
      "Sign in on mcp.linear.app's page… This waits until you do, or press Cancel",
      "Linear is added for all chats: signed in on mcp.linear.app, testing…",
      "Linear is added for all chats: signed in on mcp.linear.app · 23 tools.",
    ]);
    assert.deepEqual([testedWords({ ok: true, tools: [{}, {}] }), testedWords({ ok: false, words: "The server refused: 401." })], ["Connected · 2 tools", "The server refused: 401."]);
  });

  test("an address's host: a default read in, one a value you give makes said as none; a name from its marketplace's own words", () => {
    assert.deepEqual([hostOf("https://mcp.linear.app/mcp"), hostOf("${LOGFIRE_URL:-https://logfire-us.pydantic.dev/mcp}"), hostOf("${SOURCEGRAPH_ENDPOINT}/.api/mcp"), hostOf("not an address")],
      ["mcp.linear.app", "logfire-us.pydantic.dev", "", ""]);
    assert.deepEqual([namedIn("Official GitHub MCP server for repositories", "github"), namedIn("Laravel Boost's MCP server", "laravel-boost"), namedIn("a server for sentry", "sentry"), namedIn("nothing here", "linear")],
      ["GitHub", "Laravel Boost", "", ""]);
  });
});

describe("the catalogue", () => {
  /**
   * The catalogue over stand-ins: two marketplaces, a folder's plugin and a repository's, what is installed and on;
   * more entries of Claude Code's after them (`more`), and how many looks run at once.
   * @param {{ dataDir?: string, installed?: any[], on?: Record<string, { on: boolean, here: boolean, from?: string }>, env?: Record<string, string>, more?: any[], atOnce?: number }} [o]
   */
  const withCatalogue = (o = {}) => {
    const dataDir = o.dataDir || tmp("cat");
    const claude = market("claude/official", "claude", "claude-plugins-official");
    const codex = market("codex/openai", "codex", "openai-curated");
    const entries = [
      { market: claude, installedIn: ["Claude Code"], entry: { name: "github", title: "GitHub", description: "Official GitHub MCP server", version: "", category: "", author: "", homepage: "", source: { kind: "path", path: "/m/github" } } },
      { market: claude, installedIn: [], entry: { name: "linear", title: "Linear", description: "Linear issues", version: "", category: "", author: "", homepage: "", source: { kind: "github", repo: "acme/linear", ref: "", sha: "abc123", path: "" } } },
      { market: claude, installedIn: [], entry: { name: "code-review", title: "Code review", description: "Reviews code", version: "", category: "", author: "", homepage: "", source: { kind: "path", path: "/m/review" } } },
      { market: codex, installedIn: ["Codex"], entry: { name: "github", title: "GitHub", description: "Codex's GitHub", version: "", category: "", author: "", homepage: "", source: { kind: "path", path: "/x/github" } } },
      { market: codex, installedIn: [], entry: { name: "figma", title: "Figma", description: "Design files", version: "", category: "", author: "", homepage: "", source: { kind: "path", path: "/x/figma" } } },
      ...(o.more || []).map((entry) => ({ market: claude, installedIn: [], entry: { version: "", category: "", author: "", homepage: "", ...entry } })),
    ];
    /** @type {{ entry: any, kind: string }[]} */
    const looked = [];
    /** @type {((v: any) => void)[]} */
    const remote = [];
    const looks = /** @type {Record<string, any>} */ ({
      "/m/github": lookOf({ servers: [{ name: "github", spec: { url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" } } }], asks: [ask("GITHUB_PERSONAL_ACCESS_TOKEN", "Personal access token")] }),
      "/m/review": lookOf({ skills: 2 }),
      "/x/github": lookOf({ servers: [{ name: "github", spec: { url: "https://other.example/mcp" } }] }),
      "/x/figma": lookOf({ servers: [{ name: "figma", spec: { command: "npx", args: ["figma-mcp"] } }], skills: 3, hooks: 1 }),
    });
    /** @type {any[]} */
    const installs = [];
    /** @type {any[]} */
    const turns = [];
    const installed = o.installed || [];
    const plugins = {
      look: async (/** @type {any} */ entry, /** @type {any} */ kind) => {
        looked.push({ entry, kind });
        if (entry.source.kind === "path") return looks[entry.source.path];
        return new Promise((r) => remote.push(r));
      },
      list: () => installed,
      get: (/** @type {string} */ id) => ({ id, title: "Linear", parts: { servers: [{ name: "linear", as: "linear", runs: "https://mcp.linear.app/mcp", remote: true }] } }),
      install: async (/** @type {any} */ x) => { installs.push(x); installed.push({ id: `${x.name}@claude-plugins-official`, name: x.name, parts: { servers: [{}] } }); return { id: `${x.name}@claude-plugins-official` }; },
      needsAt: () => [],
    };
    const places = {
      turn: (/** @type {string} */ id, /** @type {any} */ x) => { turns.push({ id, ...x }); return {}; },
      at: (/** @type {string} */ id, /** @type {string} */ place) => ({ place, label: place === "all" ? "all chats" : "Work", on: !!o.on?.[id]?.on, here: !!o.on?.[id]?.here }),
      placeOn: (/** @type {string} */ id) => o.on?.[id]?.from ?? (o.on?.[id]?.on ? "all" : null),
    };
    const sources = { allEntries: () => ({ markets: [claude, codex], entries }), entry: (/** @type {string} */ from, /** @type {string} */ name) => ({ market: from === "claude/official" ? claude : codex, entry: entries.find((e) => e.market.id === from && e.entry.name === name)?.entry }), add: async () => ({}) };
    const cat = createConnectorCatalogue({ dataDir, sources: /** @type {any} */ (sources), plugins: /** @type {any} */ (plugins), places: /** @type {any} */ (places), env: o.env || {}, ...(o.atOnce ? { atOnce: o.atOnce } : {}) });
    return { cat, dataDir, looked, remote, installs, turns };
  };

  test("a folder's plugin is read at once, a repository's in the background and kept by its commit; one row per service, Claude Code's first", async () => {
    const t = withCatalogue();
    const first = await t.cat.list({});
    assert.deepEqual(first.connectors.map((r) => `${r.title}@${r.marketFrom}`), ["Figma@codex", "GitHub@claude"], "Codex's GitHub is the same service; Code review brings no connector");
    assert.deepEqual([first.reading, first.counts], [1, { claude: 1, codex: 1, added: 0 }]);
    const gh = first.connectors.find((r) => r.name === "github");
    assert.deepEqual([gh?.servers, gh?.needs, gh?.installedIn, gh?.on, gh?.plugin], [[{ name: "github", remote: true, host: "api.githubcopilot.com", runs: "https://api.githubcopilot.com/mcp/", program: "", missing: false }], ["Personal access token"], ["Claude Code"], null, null]);
    assert.deepEqual(first.connectors.find((r) => r.name === "figma")?.more, { skills: 3, hooks: 1, commands: 0, agents: 0 });
    assert.deepEqual(first.connectors.find((r) => r.name === "figma")?.servers.map((s) => [s.program, s.missing]), [["Node.js", true]], "npx on no PATH: Node.js not found here");
    // The repository's look comes in; the next list has it, and it is kept for a catalogue started again.
    t.remote[0](lookOf({ servers: [{ name: "linear", spec: { url: "https://mcp.linear.app/mcp" } }] }));
    await flush();
    await new Promise((r) => setTimeout(r, 600));
    const next = await t.cat.list({});
    assert.deepEqual([next.reading, next.connectors.map((r) => r.title)], [0, ["Figma", "GitHub", "Linear"]]);
    assert.ok(existsSync(join(t.dataDir, "plugins", "looks.json")));
    assert.match(readFileSync(join(t.dataDir, "plugins", "looks.json"), "utf8"), /github:acme\/linear#@abc123/);
    const again = withCatalogue({ dataDir: t.dataDir });
    const kept = await again.cat.list({});
    assert.deepEqual([kept.reading, kept.connectors.map((r) => r.title), again.looked.filter((l) => l.entry.source.kind !== "path").length], [0, ["Figma", "GitHub", "Linear"], 0], "kept: not looked at again");
  });

  test("a failed look waits an hour, then is looked at again", async () => {
    const withFailed = (/** @type {number} */ ago) => {
      const dataDir = tmp("looks-failed");
      mkdirSync(join(dataDir, "plugins"), { recursive: true });
      writeFileSync(join(dataDir, "plugins", "looks.json"), JSON.stringify({ version: 1, looks: { "github:acme/linear#@abc123": { at: Date.now() - ago, error: "It could not be fetched: timed out" } } }));
      return withCatalogue({ dataDir });
    };
    const fresh = withFailed(30 * 60_000);
    const held = await fresh.cat.list({});
    assert.deepEqual([held.reading, held.failed, fresh.looked.filter((l) => l.entry.source.kind !== "path").length], [0, 1, 0], "half an hour on: still failed");
    const stale = withFailed(61 * 60_000);
    const read = await stale.cat.list({});
    assert.deepEqual([read.reading, read.failed, stale.looked.filter((l) => l.entry.source.kind !== "path").length], [1, 0, 1], "an hour on: looked at again");
  });

  // (fails before: yes — a search answered nothing of the plugins not read yet, so "figma" read as no connector for the
  // minutes the hundreds queued before it took, and the one looked for waited behind them; the review of 10-31: those it
  // names were read in their marketplace's order, a name that only mentions it before the one named so)
  test("a search names the plugins not read yet and those that could not be; those it names are read next, as their rows stand; how many of how many are read", async () => {
    const repo = (/** @type {string} */ name, /** @type {string} */ title, /** @type {string} */ description) => ({ name, title, description, source: { kind: "github", repo: `acme/${name}`, ref: "", sha: `${name}1`, path: "" } });
    const t = withCatalogue({ atOnce: 1, more: [repo("asana", "Asana", "Asana tasks"), repo("box", "Box", "Box files"), repo("notes", "Notes", "Notes kept in Notion"), repo("notion", "Notion", "Notion pages"), { name: "notion-sync", title: "Notion sync", description: "Syncs Notion", source: { kind: "npm", package: "notion-sync", version: "" } }] });
    const first = await t.cat.list({});
    assert.deepEqual([first.readable, first.reading, first.pending], [5, 5, []], "five read from a repository, none read yet; nothing searched, nothing pending");
    assert.deepEqual(t.looked.filter((l) => l.entry.source.kind !== "path").map((l) => l.entry.name), ["linear"], "one at a time: Linear first, in the marketplace's order");
    const searched = await t.cat.list({ q: "notion" });
    const row = (/** @type {Record<string, any>} */ o) => ({ from: "claude/official", market: "claude-plugins-official", marketFrom: "claude", ...o });
    assert.deepEqual([searched.connectors, searched.pending], [[], [
      row({ name: "notion", title: "Notion", line: "Notion pages", state: "reading" }),
      row({ name: "notion-sync", title: "Notion sync", line: "Syncs Notion", state: "failed", why: "Filament does not fetch it" }),
      row({ name: "notes", title: "Notes", line: "Notes kept in Notion", state: "reading" }),
    ]], "a name that starts with the search first");
    // Linear's look comes in: Notion is read next — ahead of Notes, which only mentions it, and of Asana and Box, queued
    // before them both.
    t.remote[0](lookOf());
    await flush();
    assert.deepEqual(t.looked.filter((l) => l.entry.source.kind !== "path").map((l) => l.entry.name), ["linear", "notion"]);
    t.remote[1](lookOf({ servers: [{ name: "notion", spec: { url: "https://mcp.notion.com/mcp" } }] }));
    await flush();
    assert.deepEqual(t.looked.filter((l) => l.entry.source.kind !== "path").map((l) => l.entry.name), ["linear", "notion", "notes"]);
    const found = await t.cat.list({ q: "notion" });
    assert.deepEqual([found.connectors.map((r) => r.title), found.pending.map((p) => p.name), found.readable, found.reading], [["Notion"], ["notion-sync", "notes"], 5, 3], "read: a connector, no longer pending");
  });

  test("found by name, a name that starts with the search first; a value Filament's environment holds is not needed; where each is on", async () => {
    const t = withCatalogue({ env: { GITHUB_PERSONAL_ACCESS_TOKEN: "x" }, installed: [{ id: "figma@openai-curated", name: "figma", parts: { servers: [{}] } }], on: { "figma@openai-curated": { on: true, here: false } } });
    assert.deepEqual((await t.cat.list({ q: "git" })).connectors.map((r) => r.title), ["GitHub"]);
    assert.deepEqual((await t.cat.list({ q: "design" })).connectors.map((r) => r.title), ["Figma"]);
    const all = await t.cat.list({ place: "project:p1" });
    assert.deepEqual(all.connectors.find((r) => r.name === "github")?.needs, [], "its token is in Filament's environment");
    assert.deepEqual([all.connectors.find((r) => r.name === "figma")?.plugin, all.connectors.find((r) => r.name === "figma")?.on], ["figma@openai-curated", "all"], "on from your defaults, seen from a project");
    const here = withCatalogue({ installed: [{ id: "figma@openai-curated", name: "figma", parts: { servers: [{}] } }], on: { "figma@openai-curated": { on: true, here: true } } });
    assert.equal((await here.cat.list({ place: "project:p1" })).connectors.find((r) => r.name === "figma")?.on, "here");
    // On for Work, the Space of yours that shows the project: by its name.
    const space = withCatalogue({ installed: [{ id: "figma@openai-curated", name: "figma", parts: { servers: [{}] } }], on: { "figma@openai-curated": { on: true, here: false, from: "project:w1" } } });
    const figma = (await space.cat.list({ place: "project:p1" })).connectors.find((r) => r.name === "figma");
    assert.deepEqual([figma?.on, figma?.onIn], ["all", "Work"]);
    // The program a server runs, found where the PATH Filament starts it with has it.
    const bin = tmp("bin");
    writeFileSync(join(bin, process.platform === "win32" ? "npx.cmd" : "npx"), "");
    const found = withCatalogue({ env: { PATH: bin, PATHEXT: ".EXE;.CMD" } });
    assert.deepEqual((await found.cat.list({})).connectors.find((r) => r.name === "figma")?.servers.map((s) => [s.program, s.missing]), [["Node.js", false]]);
  });

  test("a server's program by the name a person knows; a path or a value in it is not looked for", () => {
    const none = () => false;
    assert.deepEqual([programOf({ command: "uvx", args: [] }, none), programOf({ command: "php" }, none), programOf({ command: "C:\\tools\\x.exe" }, none), programOf({ command: "${CLAUDE_PLUGIN_ROOT}/run" }, none), programOf({ url: "https://x.dev" }, none), programOf({ command: "cmd.exe" }, () => true)], [
      { program: "uv", missing: true }, { program: "PHP", missing: true }, { program: "x", missing: false }, { program: "run", missing: false }, { program: "", missing: false }, { program: "cmd", missing: false },
    ]);
  });

  test("Add installs the plugin where it is not yet, turns it on at the place with its hooks off, and answers its setup; installed already, it only turns it on", async () => {
    const t = withCatalogue();
    const s = await t.cat.add({ from: "claude/official", name: "linear", place: "all" });
    assert.deepEqual(t.installs, [{ from: "claude/official", name: "linear" }]);
    assert.deepEqual(t.turns, [{ id: "linear@claude-plugins-official", place: "all", on: true, hooks: false }]);
    assert.deepEqual(s, { plugin: "linear@claude-plugins-official", title: "Linear", place: "all", label: "all chats", on: false, servers: [{ name: "linear", remote: true, host: "mcp.linear.app", runs: "https://mcp.linear.app/mcp", program: "", missing: false }], needs: [] });
    await t.cat.add({ from: "claude/official", name: "linear", place: "project:p1" });
    assert.equal(t.installs.length, 1, "installed once");
    assert.deepEqual(t.turns.at(-1), { id: "linear@claude-plugins-official", place: "project:p1", on: true, hooks: false });
  });
});

describe("a look at a repository", () => {
  const git = (/** @type {string} */ cwd, /** @type {string[]} */ args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdio: "pipe" }).toString();

  test("its files listed at the commit, its JSON fetched alone, its Markdown counted: servers, the values they read, skills and commands", async () => {
    const src = tmp("repo");
    const at = join(src, "plugins", "demo");
    for (const d of [join(at, ".claude-plugin"), join(at, "skills", "one"), join(at, "commands"), join(src, "big")]) mkdirSync(d, { recursive: true });
    writeFileSync(join(at, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "demo", description: "A demo" }));
    writeFileSync(join(at, ".mcp.json"), JSON.stringify({ demo: { type: "http", url: "https://demo.example/mcp", headers: { Authorization: "Bearer ${DEMO_API_KEY}" } } }));
    writeFileSync(join(at, "skills", "one", "SKILL.md"), "---\nname: one\ndescription: x\n---\nbody");
    writeFileSync(join(at, "commands", "go.md"), "go");
    writeFileSync(join(src, "big", "data.bin"), "x".repeat(200_000));
    git(src, ["init", "-q"]);
    git(src, ["add", "-A"]);
    git(src, ["commit", "-q", "-m", "one"]);
    // A server that hands out a filtered fetch and a blob by its id, as GitHub does.
    git(src, ["config", "uploadpack.allowFilter", "true"]);
    git(src, ["config", "uploadpack.allowAnySHA1InWant", "true"]);
    const sha = git(src, ["rev-parse", "HEAD"]).trim();
    const dataDir = tmp("look");
    const plugins = createPlugins({ dataDir, sources: /** @type {any} */ ({}), key: () => null });
    const url = `file://${src.replace(/\\/g, "/")}`;
    const look = await plugins.look(/** @type {any} */ ({ name: "demo", title: "Demo", description: "", source: { kind: "git", url, ref: "", sha, path: "plugins/demo" } }), "claude");
    assert.deepEqual(look.servers, [{ name: "demo", spec: { url: "https://demo.example/mcp", headers: { Authorization: "Bearer ${DEMO_API_KEY}" } } }]);
    assert.deepEqual(look.asks.map((a) => [a.key, a.title, a.sensitive, a.required]), [["DEMO_API_KEY", "API key", true, true]]);
    assert.deepEqual([look.title, look.skills, look.commands, look.hooks, look.agents], ["Demo", 1, 1, 0, 0]);
    assert.equal(existsSync(join(dataDir, "plugins", "tmp")) ? (await import("node:fs")).readdirSync(join(dataDir, "plugins", "tmp")).length : 0, 0, "its folder let go");
    await assert.rejects(plugins.look(/** @type {any} */ ({ name: "x", source: { kind: "git", url, ref: "", sha, path: "plugins/none" } }), "claude"), /holds no folder plugins\/none/);
  });

  // The desktop app's Node (Electron 45's) refuses to delete a read-only file on Windows, which plain Node does: there
  // every look failed on its cleanup and its folder stayed (10-26). Checked by hand under Electron's Node; here, that
  // the removal clears them and a start with such folders left goes on.
  test("a folder of git's read-only packs is removed whole; a start with such folders left in tmp removes them and starts", () => {
    const packOf = (/** @type {string} */ dir) => {
      const pack = join(dir, ".git", "objects", "pack");
      mkdirSync(pack, { recursive: true });
      writeFileSync(join(pack, "p.pack"), "x");
      chmodSync(join(pack, "p.pack"), 0o444);
      return dir;
    };
    const d = tmp("ro");
    assert.equal(removeTree(packOf(join(d, "look-1"))), true);
    assert.equal(existsSync(join(d, "look-1")), false);
    assert.equal(removeTree(join(d, "never-there")), true, "nothing there: gone");
    const dataDir = tmp("ro-start");
    packOf(join(dataDir, "plugins", "tmp", "look-2"));
    createPlugins({ dataDir, sources: /** @type {any} */ ({}), key: () => null });
    assert.equal(existsSync(join(dataDir, "plugins", "tmp")), false);
  });
});

describe("a value a server reads", () => {
  test("titled in words, the service's name dropped; a secret by its name; one with a default not needed", () => {
    assert.deepEqual([envTitle("GITHUB_PERSONAL_ACCESS_TOKEN", "github"), envTitle("API_KEY", "pinecone"), envTitle("SOURCEGRAPH_ENDPOINT", "sourcegraph")], ["Personal access token", "API key", "Endpoint"]);
    const asks = envAsksOf([{ spec: { url: "${HOST:-https://x.dev}/mcp", headers: { Authorization: "Bearer ${ACME_TOKEN}" }, env: { ROOT: "${CLAUDE_PLUGIN_ROOT}" } } }], "acme", [ask("ACME_TOKEN", "Token", { env: false })]);
    assert.deepEqual(asks.map((a) => [a.key, a.title, a.sensitive, a.required, a.default]), [["HOST", "Host", false, false, "https://x.dev"]], "Filament's own names and the plugin's own asks are not asked again");
  });

  test("its plugin's server waits for it, Filament's environment fills it, a value set at the place fills it over that", async () => {
    const folder = tmp("gh");
    mkdirSync(join(folder, ".claude-plugin"), { recursive: true });
    writeFileSync(join(folder, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "github", description: "Official GitHub MCP server" }));
    writeFileSync(join(folder, ".mcp.json"), JSON.stringify({ github: { type: "http", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" } } }));
    const sources = { entry: (/** @type {string} */ _f, /** @type {string} */ name) => ({ market: { id: "claude/official", name: "official", title: "Official" }, entry: { name, title: "GitHub", description: "", version: "", category: "", author: "", homepage: "", source: { kind: /** @type {const} */ ("path"), path: folder } } }) };
    const dataDir = tmp("ghdata");
    const key = randomBytes(32);
    /** @type {Record<string, string | undefined>} */
    const env = {};
    const plugins = createPlugins({ dataDir, sources, key: () => key, env });
    const p = await plugins.install({ from: "claude/official", name: "github" });
    const one = () => plugins.serversAt([{ id: p.id }])[0];
    assert.deepEqual([one().spec, one().waits, one().only], [null, ["Personal access token"], true]);
    assert.deepEqual(plugins.needsAt(p.id, "all").map((a) => a.key), ["GITHUB_PERSONAL_ACCESS_TOKEN"]);
    env.GITHUB_PERSONAL_ACCESS_TOKEN = "from-env";
    assert.equal(one().spec?.headers?.Authorization, "Bearer from-env");
    assert.deepEqual(plugins.needsAt(p.id, "all"), []);
    plugins.setValues(p.id, "all", { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_set" });
    assert.equal(one().spec?.headers?.Authorization, "Bearer ghp_set");
    assert.equal(plugins.valuesAt(p.id, "all").values.GITHUB_PERSONAL_ACCESS_TOKEN, "__SECRET__", "a secret never goes back to the page");
    assert.doesNotMatch(readFileSync(join(dataDir, "plugins", "values.json"), "utf8"), /ghp_set/, "kept sealed");
  });
});

describe("where a plugin is on, for Finish setup…", () => {
  test("the narrowest place a chat reads whose own list turns it on; none where a narrower one turns it off", () => {
    /** @type {{ defaults: any, projects: Record<string, any>, chats: Record<string, any> }} */
    const st = { defaults: { plugins: { on: [{ id: "github@o" }, { id: "linear@o" }] } }, projects: { p1: { plugins: { on: [{ id: "linear@o" }, { id: "figma@o" }] } } }, chats: { c1: { plugins: { on: [{ id: "github@o", enabled: false }] } } } };
    const places = createPluginPlaces({
      sessions: { launchInfo: (/** @type {string} */ id) => (st.chats[id] ? { projectId: "p1" } : null) },
      memory: { archive: { getProject: (/** @type {string} */ id) => (st.projects[id] ? { id, name: "Work" } : null), projectSettings: (/** @type {string} */ id) => st.projects[id], chainSettings: (/** @type {string} */ id) => st.chats[id] } },
      config: { get: () => ({ sessions: { defaults: st.defaults } }) },
    });
    assert.deepEqual(["github@o", "linear@o", "figma@o", "none@o"].map((id) => places.placeOn(id, "chat:c1")), [null, "project:p1", "project:p1", null]);
    assert.deepEqual(["github@o", "linear@o"].map((id) => places.placeOn(id, "project:p1")), ["all", "project:p1"]);
    assert.deepEqual([places.projectOf("chat:c1"), places.projectOf("all")], ["p1", null], "a chat's values are read over its project's");
  });
});

describe("the sheet on the fake DOM", () => {
  /**
   * The sheet with a recording server and dialog.
   * @param {{ answer?: any, reply?: (path: string, method: string, body: any) => any, at?: string, finish?: string, rows?: any[] }} [o]
   */
  const sheetWith = (o = {}) => {
    /** @type {{ path: string, method: string, body: any }[]} */
    const calls = [];
    /** What the list hands the sheet each time it draws its rows, and the sign-ins cancelled. @type {Set<(rows: any[]) => void>} */
    const watchers = new Set();
    /** @type {any[]} */
    const cancelled = [];
    /** @type {any[]} */
    const dialogs = [];
    /** @type {[string, string | undefined][]} */
    const toasts = [];
    /** @type {any[]} */
    const sheets = [];
    /** @type {any[]} */
    const signIns = [];
    let manual = 0;
    let refreshed = 0;
    /** What the sheet asked to do later, run by hand. @type {(() => void)[]} */
    const timers = [];
    const api = async (/** @type {string} */ path, /** @type {any} */ x = {}) => {
      const method = x.method || "GET";
      calls.push({ path, method, body: x.body });
      const r = o.reply ? await o.reply(path, method, x.body) : undefined;
      if (r instanceof Error) throw r;
      return r !== undefined ? r : o.answer;
    };
    const d = openConnectorPick(
      { scope: o.at === "project" ? "project:p1" : "all", at: o.at || "global", label: o.at === "project" ? "Work" : "all chats", onToast: (m, k) => toasts.push([m, k]), onManual: () => { manual++; },
        rows: () => o.rows || [], refresh: async () => { refreshed++; }, signIn: async (row) => { signIns.push(row); }, cancelSignIn: async (row) => { cancelled.push(row); },
        watch: (fn) => { watchers.add(fn); return () => void watchers.delete(fn); }, ...(o.finish ? { finish: o.finish, finishTitle: "GitHub" } : {}) },
      /** @type {any} */ ({ h: fakeH, api, dialog: (/** @type {any} */ x) => { const rec = { ...x, closed: false, close() { rec.closed = true; } }; dialogs.push(rec); return rec; }, pluginSheet: (/** @type {any} */ x) => sheets.push(x), later: (/** @type {() => void} */ fn) => { timers.push(fn); return {}; }, now: () => 1_000_000 }),
    );
    /** The list draws its rows: the sheet hears them. @param {any[]} rows */
    const draw = (rows) => { for (const fn of [...watchers]) fn(rows); };
    return { d: /** @type {any} */ (d), calls, dialogs, toasts, sheets, signIns, cancelled, watchers, draw, timers, body: () => dialogs[0].body, manual: () => manual, refreshed: () => refreshed };
  };
  const button = (/** @type {any} */ el, /** @type {string} */ words) => {
    const b = buttonsOf(el).find((x) => textOf(x) === words);
    assert.ok(b, `a button "${words}" in: ${textOf(el)}`);
    return b;
  };
  /** A row as the catalogue answers it. @param {Record<string, any>} [o] */
  const crow = (o = {}) => ({ from: "claude/official", market: "claude-plugins-official", marketFrom: "claude", name: "linear", title: "Linear", line: "Linear issues", installedIn: [], plugin: null, on: null, servers: [{ name: "linear", remote: true, host: "mcp.linear.app", runs: "https://mcp.linear.app/mcp" }], needs: [], more: { skills: 0, hooks: 0, commands: 0, agents: 0 }, ...o });
  const listAnswer = (/** @type {any[]} */ connectors, o = {}) => ({ none: false, markets: [], counts: { claude: connectors.length, codex: 0, added: 0 }, reading: 0, readable: 0, failed: 0, total: connectors.length, connectors, pending: [], ...o });

  test("before typing: the search, the count, those Claude Code has installed, the online services, the tools that run here; each row's words, only what it needs, and its button", async () => {
    const t = sheetWith({ answer: listAnswer([
      crow({ name: "github", title: "GitHub", installedIn: ["Claude Code"], servers: [{ name: "github", remote: true, host: "api.githubcopilot.com", runs: "" }], needs: ["Personal access token"] }),
      crow({ name: "boost", title: "Laravel boost", line: "Laravel tools", servers: [{ name: "boost", remote: false, host: "", runs: "php artisan boost:mcp", program: "PHP", missing: true }] }),
      crow(),
      crow({ name: "figma", title: "Figma", more: { skills: 2, hooks: 0, commands: 0, agents: 0 } }),
      crow({ name: "notion", title: "Notion", on: "here" }),
    ], { reading: 12, readable: 40 }) });
    await flush();
    assert.deepEqual([t.dialogs[0].title, t.dialogs[0].description], ["Add a connector", "Into all chats · each chat has it from its next message"]);
    const text = textOf(t.body());
    assert.match(text, /5 connectors from Claude Code's marketplace\|Reading plugins: 28 of 40 done — more connectors appear as they're read\./);
    assert.match(text, /Already in Claude Code\|GitHub\|Linear issues\|Needs a personal access token\|Add\|Online services\|Linear\|Linear issues\|Add\|Figma\|Linear issues\|Add…\|Notion\|Linear issues\|Added\|Tools that run on this computer\|Laravel boost\|Laravel tools\|Needs PHP \(not found on this computer\)\|Add\|/);
    assert.doesNotMatch(text, /Connects to|Runs on this computer:|also adds/, "no host, command or extras on the rows");
    assert.equal(t.body().querySelector("mcps-name").attrs.title, "Connects to api.githubcopilot.com", "on its title's hover");
    assert.deepEqual(t.calls[0], { path: "/plugins/connectors?q=&place=all", method: "GET", body: undefined });
    button(t.body(), BY_HAND).dispatch("click");
    assert.deepEqual([t.manual(), t.dialogs[0].closed], [1, true], "the hand-made form, the sheet closed");
  });

  test("read again while plugins are still read: a row that stands keeps its button, so no press is lost under it; one that changes is drawn anew", async () => {
    let reads = 0;
    const t = sheetWith({ reply: (p) => (p.startsWith("/plugins/connectors?") ? listAnswer(++reads < 3 ? [crow()] : [crow({ on: "here" })], { reading: 3 }) : undefined) });
    await flush();
    const add = button(t.body(), "Add");
    assert.equal(t.timers.length, 1, "read again 3 s on");
    t.timers.shift()?.();
    await flush();
    assert.equal(reads, 2);
    assert.equal(button(t.body(), "Add"), add, "the same button, never replaced");
    t.timers.shift()?.();
    await flush();
    assert.match(textOf(t.body()), /Linear\|Linear issues\|Added/);
  });

  // (fails before: yes — the reading said itself only in the count line's faint words, a search that found nothing yet
  // said "No connector is named like", and a plugin the search names that was not read yet was not shown)
  test("while plugins are read: a spinner and how far it has got; a search's plugins not read yet say Checking…, or that they could not be; none is said only once all are read", async () => {
    const figma = { from: "claude/official", market: "claude-plugins-official", marketFrom: "claude", name: "figma", title: "Figma", line: "Design files", state: "reading" };
    const figjam = { ...figma, name: "figjam", title: "FigJam", line: "Whiteboards", state: "failed", why: "It could not be fetched: timed out" };
    let reads = 0;
    const t = sheetWith({ reply: (p) => {
      if (!p.startsWith("/plugins/connectors?")) return undefined;
      reads++;
      if (p.includes("q=figma")) return reads < 3 ? listAnswer([], { reading: 40, readable: 120, pending: [figma, figjam] }) : listAnswer([crow({ name: "figma", title: "Figma", line: "Design files" })], { reading: 12, readable: 120, pending: [figjam] });
      if (p.includes("q=zeplin")) return listAnswer([], { reading: reads < 5 ? 12 : 0, readable: 120 });
      return listAnswer([], { reading: 40, readable: 120 });
    } });
    await flush();
    const progress = t.body().querySelector("cpick-progress");
    const spinner = progress.kids[0];
    assert.equal(spinner.attrs.class, "tk-spin");
    assert.equal(progress.hasAttribute("hidden"), false, "shown while plugins are read");
    assert.equal(textOf(progress), "Reading plugins: 80 of 120 done — more connectors appear as they're read.");
    assert.equal(textOf(t.body().querySelector("cpick-count")), "", "the count says only what is found");
    const typed = (/** @type {string} */ q) => { const s = t.body().querySelector("cpick-search"); s.value = q; s.dispatch("input"); t.timers.pop()?.(); };
    typed("figma");
    await flush();
    const list = textOf(t.body().querySelector("cpick-list"));
    assert.equal(list, "Figma|Design files|Checking…|FigJam|Whiteboards|Couldn't be read", "named before it is read; never said as none");
    const failed = t.body().querySelector("is-failed");
    assert.equal(failed.querySelector("cpick-state").attrs.title, "It could not be fetched: timed out", "why, on hover");
    // Read again 3 s on: Figma's look is in, its row adds it; the spinner the same one, still turning.
    t.timers.pop()?.();
    await flush();
    assert.match(textOf(t.body().querySelector("cpick-list")), /^Figma\|Design files\|Add\|FigJam\|Whiteboards\|Couldn't be read$/);
    assert.equal(t.body().querySelector("cpick-progress").kids[0], spinner);
    assert.equal(textOf(progress), "Reading plugins: 108 of 120 done — more connectors appear as they're read.");
    // A search that finds nothing while plugins are still read says so; once all are read, that there is none.
    typed("zeplin");
    await flush();
    assert.equal(textOf(t.body().querySelector("cpick-list")), notYetWords("zeplin"));
    const left = t.timers.length;
    t.timers.pop()?.();
    await flush();
    assert.equal(textOf(t.body().querySelector("cpick-list")), `No connector is named like "zeplin".`);
    assert.equal(progress.hasAttribute("hidden"), true, "all read: no spinner");
    assert.equal(t.timers.length, left - 1, "nothing more to read: not read again");
  });

  test("Add… opens its plugin's sheet with the place picked; with no marketplace, one press gets Anthropic's", async () => {
    const t = sheetWith({ at: "project", answer: listAnswer([crow({ name: "figma", title: "Figma", from: "codex/openai", more: { skills: 2, hooks: 1, commands: 0, agents: 0 } }), crow({ on: "all" }), crow({ name: "slack", title: "Slack", line: "Slack messages", on: "all", onIn: "Work" })]) });
    await flush();
    assert.match(textOf(t.body()), /Linear\|Linear issues\|On for all chats/);
    assert.match(textOf(t.body()), /Slack\|Slack messages\|On for Work/, "on for the Space that shows the project: by its name");
    button(t.body(), "Add…").dispatch("click");
    assert.deepEqual([t.sheets[0].from, t.sheets[0].name, t.sheets[0].place], ["codex/openai", "figma", "project:p1"]);
    const none = sheetWith({ answer: listAnswer([], { none: true }), reply: (p) => (p === "/plugins/connectors/anthropic" ? { ok: true } : undefined) });
    await flush();
    assert.match(textOf(none.body()), new RegExp(NO_LIST.replace(/[.']/g, ".")));
    button(none.body(), GET_LIST).dispatch("click");
    await flush();
    assert.deepEqual(none.calls.filter((c) => c.method === "POST").map((c) => c.path), ["/plugins/connectors/anthropic"]);
    assert.equal(none.calls.filter((c) => c.path.startsWith("/plugins/connectors?")).length, 2, "the list read again");
  });

  test("Add one that needs a token: its field, sealed; Save and test keeps it with the place's values and tests it by name", async () => {
    const setup = { plugin: "github@official", title: "GitHub", place: "all", label: "all chats", on: true, servers: [{ name: "github", remote: true, host: "api.githubcopilot.com", runs: "" }], needs: [ask("GITHUB_PERSONAL_ACCESS_TOKEN", "Personal access token")] };
    const t = sheetWith({
      answer: listAnswer([crow({ name: "github", title: "GitHub" })]),
      reply: (p, m) => (p === "/plugins/connectors/add" ? setup : p.endsWith("/values?place=all") ? { values: { OTHER: "__SECRET__" } } : m === "POST" && p.endsWith("/values") ? { ok: true } : p === "/mcp-servers/test" ? { ok: true, tools: [{}, {}, {}] } : undefined),
    });
    await flush();
    button(t.body(), "Add").dispatch("click");
    await flush();
    assert.deepEqual(t.calls.find((c) => c.path === "/plugins/connectors/add")?.body, { from: "claude/official", name: "github", place: "all" });
    assert.deepEqual(t.toasts[0], ["GitHub added for all chats", undefined]);
    const text = textOf(t.body());
    assert.match(text, /GitHub is added for all chats\. It needs your personal access token before it works\.\|Personal access token\|GITHUB_PERSONAL_ACCESS_TOKEN/);
    assert.ok(text.includes(SEALED));
    button(t.body(), "Save and test").dispatch("click");
    await flush();
    assert.match(textOf(t.body()), /Give personal access token/, "nothing typed: said, nothing sent");
    const [input] = /** @type {any[]} */ (t.body().kids.flatMap((/** @type {any} */ k) => k.kids || []).flatMap((/** @type {any} */ f) => f.kids || []).flatMap((/** @type {any} */ v) => v.kids || []).filter((/** @type {any} */ n) => n.tag === "input"));
    assert.equal(input.attrs.type, "password");
    input.value = " ghp_x ";
    button(t.body(), "Save and test").dispatch("click");
    await flush();
    assert.deepEqual(t.calls.find((c) => c.method === "POST" && c.path === "/plugins/installed/github%40official/values")?.body, { place: "all", values: { OTHER: "__SECRET__", GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_x" } });
    assert.deepEqual(t.calls.find((c) => c.path === "/mcp-servers/test")?.body, { scope: "all", server: { name: "github", plugin: true } });
    assert.match(textOf(t.body()), /Connected · 3 tools\|Done/);
  });

  test("Add one over the web: tested at once; connected says so, one that asks hands Sign in to the list's row", async () => {
    const setup = { plugin: "linear@official", title: "Linear", place: "all", label: "all chats", on: true, servers: [{ name: "linear", remote: true, host: "mcp.linear.app", runs: "" }], needs: [] };
    const ok = sheetWith({ answer: listAnswer([crow()]), reply: (p) => (p === "/plugins/connectors/add" ? setup : p === "/mcp-servers/test" ? { ok: true, tools: [{}] } : undefined) });
    await flush();
    button(ok.body(), "Add").dispatch("click");
    await flush();
    assert.match(textOf(ok.body()), /Linear is added for all chats: connected · 1 tool\./);
    const row = { name: "linear", plugin: "linear@official" };
    const asks = sheetWith({ rows: [row], answer: listAnswer([crow()]), reply: (p) => (p === "/plugins/connectors/add" ? setup : p === "/mcp-servers/test" ? { ok: false, signIn: true, words: "It needs you to sign in" } : undefined) });
    await flush();
    button(asks.body(), "Add").dispatch("click");
    await flush();
    assert.match(textOf(asks.body()), /Linear is added for all chats\. Sign in on mcp\.linear\.app so its tools can reach your account\.\|Later\|Sign in/);
    button(asks.body(), "Sign in").dispatch("click");
    await flush();
    assert.deepEqual(asks.signIns, [row], "its own press, handed to the list: it opens the page and follows it");
    // (fails before: yes, found by the Designer — the sheet said "Finish signing in on …'s page" to a person the page
    // had just told to come back, and the toast that said it was done fired in a hidden tab)
    assert.equal(asks.watchers.size, 1, "the sheet hears the list's rows; it follows nothing itself");
    asks.draw([{ ...row, signIn: { state: "waiting", page: "https://mcp.linear.app/authorize" } }]);
    assert.match(textOf(asks.body()), /^Sign in on mcp\.linear\.app's page… This waits until you do, or press Cancel\|Open it again\|Cancel$/);
    asks.draw([{ ...row, signIn: { state: "in" }, test: { ok: true, at: 500_000, tools: [{}] } }]);
    assert.match(textOf(asks.body()), /signed in on mcp\.linear\.app, testing…/, "a test from before the press is not its test");
    asks.draw([{ ...row, signIn: { state: "in" }, test: { ok: true, at: 1_000_500, tools: Array.from({ length: 23 }, () => ({})) } }]);
    assert.match(textOf(asks.body()), /^Linear is added for all chats: signed in on mcp\.linear\.app · 23 tools\.\|Done$/);
    assert.equal(asks.watchers.size, 0, "done: it hears no more");
    // Cancel ends the sign-in and asks again.
    const again = sheetWith({ rows: [row], answer: listAnswer([crow()]), reply: (p) => (p === "/plugins/connectors/add" ? setup : p === "/mcp-servers/test" ? { ok: false, signIn: true } : undefined) });
    await flush();
    button(again.body(), "Add").dispatch("click");
    await flush();
    button(again.body(), "Sign in").dispatch("click");
    await flush();
    again.draw([{ ...row, signIn: { state: "waiting", page: "p" } }]);
    button(again.body(), "Cancel").dispatch("click");
    await flush();
    assert.deepEqual(again.cancelled.map((r) => r.name), ["linear"]);
    assert.match(textOf(again.body()), /Sign in on mcp\.linear\.app so its tools can reach your account\.\|Later\|Sign in$/);
  });

  test("Finish setup… opens the second step alone, titled for it, for the place its plugin is on; Save and test works there", async () => {
    const t = sheetWith({ finish: "github@official", reply: (p, m) => (p.startsWith("/plugins/connectors/setup") ? { plugin: "github@official", title: "GitHub", place: "all", label: "all chats", on: true, servers: [{ name: "github", remote: true, host: "x", runs: "" }], needs: [ask("GITHUB_PERSONAL_ACCESS_TOKEN", "Personal access token")] }
      : p.includes("/values?") ? { values: {} } : m === "POST" && p.endsWith("/values") ? { ok: true } : p === "/mcp-servers/test" ? { ok: true, tools: [{}] } : undefined) });
    await flush();
    assert.deepEqual([t.dialogs[0].title, t.dialogs[0].description], ["Finish setting up GitHub", undefined]);
    assert.equal(t.calls[0].path, "/plugins/connectors/setup?id=github%40official&place=all");
    assert.match(textOf(t.body()), /^GitHub is added for all chats\. It needs your personal access token before it works\./);
    const input = /** @type {any} */ (t.body().kids[1].kids[0].kids[1].kids[0]);
    input.value = "ghp_y";
    button(t.body(), "Save and test").dispatch("click");
    await flush();
    assert.match(textOf(t.body()), /Connected · 1 tool\|Done/);
  });
});
