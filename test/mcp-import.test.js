// @ts-check
// Settings › MCP servers › Import from other apps, the server half (HarnessV4_Settings_Plan HS-6, HS-D75 to HS-D77,
// HC-79 and HC-127 to HC-136): Claude Desktop's, Cursor's and Codex's files read when asked — from a scripted reader
// here, never this computer's own — each file's state, each server's offered name and how it stands against yours,
// credentials masked on the way to the page and read from the files again on Save; and the small TOML reader Codex's
// file needs (HS-D76).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readToml } from "../src/core/toml.js";
import { foundSources, foundIn, nameFrom } from "../src/app/sessions/mcp-found.js";
import { createMcpServers } from "../src/app/sessions/mcp-servers.js";
import { mcpServerRoutes } from "../src/http/admin/mcp-servers.js";
import { createRouter } from "../src/http/router.js";
import { SECRET_MARK } from "../src/services/mcp-servers.js";

const HOME = "C:\\Users\\someone";
const APPDATA = "C:\\Users\\someone\\AppData\\Roaming";
const [CLAUDE, CURSOR, CODEX] = foundSources({ home: HOME, appData: APPDATA, platform: "win32" }).map((s) => s.path);
const TOKEN = "ghp_realtoken0123456789";

const CODEX_TOML = `
# Codex's config
model = "gpt-5.6-luna"

[mcp_servers.figma]
url = "https://mcp.figma.com/mcp"
bearer_token_env_var = "FIGMA_TOKEN"

[mcp_servers."Brave Search"]
command = "npx"
args = [
  "-y",   # the package
  "@brave/brave-search-mcp-server",
]
env_vars = ["BRAVE_API_KEY"]

[mcp_servers.old]
command = "old-server"
enabled = false

[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]
env = { GITHUB_TOKEN = "${TOKEN}" }
`;

/** The settings for all chats, kept as the sessions service keeps them, and the files a scripted reader serves. */
function rig(files = new Map()) {
  /** @type {any} */
  let cfg = { sessions: { defaults: {} } };
  const config = { get: () => cfg };
  const sessions = {
    patchDefaults: (/** @type {any} */ c) => {
      cfg = { sessions: { defaults: c.patch ? { ...c.patch } : {} } };
    },
  };
  /** @type {string[]} */
  const reads = [];
  const read = async (/** @type {string} */ path) => {
    reads.push(path);
    const v = files.get(path);
    if (v instanceof Error) throw v;
    return v ?? null;
  };
  const mcpServers = createMcpServers({ sessions, memory: null, config, home: HOME, appData: APPDATA, platform: "win32", read });
  const route = createRouter(mcpServerRoutes({ mcpServers }));
  /** @param {string} method @param {string} path @param {any} [body] */
  const call = async (method, path, body = undefined) => {
    const url = new URL(`http://x${path}`);
    const m = route(method, url.pathname);
    assert.ok(m, `${method} ${path} has a row`);
    let out = "";
    let status = 0;
    const res = /** @type {any} */ ({
      headersSent: false, writableEnded: false, setHeader() {}, getHeader() {}, on() {},
      writeHead(/** @type {number} */ s) { status = s; this.headersSent = true; return this; },
      write(/** @type {string} */ c) { out += c; },
      end(/** @type {string} */ c = "") { out += c; this.writableEnded = true; },
    });
    const req = { headers: {}, method, socket: { remoteAddress: "127.0.0.1" }, on() {} };
    await m.handler({ req, res, url, path: url.pathname, method, params: m.params, json: async () => body }, {});
    return { status, text: out, body: out ? JSON.parse(out) : null };
  };
  return { config, mcpServers, call, reads, files, cfg: () => cfg };
}

/** A file's servers as the page reads them: [name, mark, notes]. @param {any} source */
const rows = (source) => source.servers.map((/** @type {any} */ s) => [s.name, s.mark, ...(s.notes.length ? [s.notes] : [])]);

describe("the small TOML reader (HS-D76)", () => {
  test("Codex's config: tables with quoted names, arrays over lines with comments, inline tables", () => {
    const doc = readToml(CODEX_TOML);
    assert.equal(doc.model, "gpt-5.6-luna");
    assert.deepEqual(Object.keys(doc.mcp_servers), ["figma", "Brave Search", "old", "github"]);
    assert.deepEqual(doc.mcp_servers["Brave Search"].args, ["-y", "@brave/brave-search-mcp-server"]);
    assert.deepEqual(doc.mcp_servers.github.env, { GITHUB_TOKEN: TOKEN });
    assert.equal(doc.mcp_servers.old.enabled, false);
  });

  test("strings, numbers, dotted keys, arrays of tables, multi-line strings", () => {
    const doc = readToml([
      'a.b = "x\\ty\\u00e9"',
      "c = 'C:\\path\\no-escapes'",
      "n = 1_000",
      "f = -2.5e3",
      "h = 0xff",
      "d = 2026-10-16",
      'm = """',
      "one",
      'two"""',
      "l = '''",
      "raw \\n'''",
      "[[t]]",
      "x = 1",
      "[[t]]",
      "x = 2",
      "[t.sub]",
      "y = true",
    ].join("\r\n"));
    assert.deepEqual(doc, { a: { b: "x\tyé" }, c: "C:\\path\\no-escapes", n: 1000, f: -2500, h: 255, d: "2026-10-16", m: "one\ntwo", l: "raw \\n", t: [{ x: 1 }, { x: 2, sub: { y: true } }] });
  });

  test("what it does not read, it names with the line", () => {
    assert.throws(() => readToml('a = 1\nb = "open'), /^Error: line 2: a string is not closed on its line$/);
    assert.throws(() => readToml("a = 1\na = 2"), /line 2: a is set twice/);
    assert.throws(() => readToml("[x\ny = 1"), /line 1: a table's name is not closed/);
    assert.throws(() => readToml("a = nope"), /line 1: a value Filament does not read: nope/);
    assert.throws(() => readToml("a = 1 b = 2"), /line 1: more after the value/);
    assert.throws(() => readToml("[__proto__]\nx = 1"), /__proto__/);
  });
});

describe("the files, as Filament's servers", () => {
  test("where each app keeps its file", () => {
    assert.deepEqual(foundSources({ home: "/home/me", platform: "linux" }).map((s) => s.path.replace(/\\/g, "/")), ["/home/me/.config/Claude/claude_desktop_config.json", "/home/me/.cursor/mcp.json", "/home/me/.codex/config.toml"]);
    assert.match(foundSources({ home: "/Users/me", platform: "darwin" })[0].path.replace(/\\/g, "/"), /\/Users\/me\/Library\/Application Support\/Claude\/claude_desktop_config\.json$/);
    assert.match(foundSources({ home: "/h", codexHome: "/elsewhere", platform: "linux" })[2].path.replace(/\\/g, "/"), /^\/elsewhere\/config\.toml$/);
  });

  // (fails before: yes — HC-131, HS-D77)
  test("a name Filament does not take is offered in its form", () => {
    assert.deepEqual(["Brave Search", "GitHub_MCP", "42-things", "日本", "a".repeat(40) + "-"].map(nameFrom), ["brave-search", "github-mcp", "things", "server", "a".repeat(32)]);
  });

  // (fails before: yes — HC-133)
  test("Codex's tokens from its environment come with a note; a server it has off comes in off", () => {
    const [CODEX_SOURCE] = foundSources({ home: HOME, platform: "win32" }).slice(2);
    const got = foundIn(CODEX_SOURCE, CODEX_TOML);
    assert.deepEqual(got.map((f) => [f.from, f.spec, f.notes]), [
      ["figma", { url: "https://mcp.figma.com/mcp" }, ["Codex sends the token in FIGMA_TOKEN as its Authorization header: add that header here"]],
      ["Brave Search", { command: "npx", args: ["-y", "@brave/brave-search-mcp-server"] }, ["Codex passes BRAVE_API_KEY from its environment: add it here"]],
      ["old", { command: "old-server", enabled: false }, ["Off in Codex: it comes in off"]],
      ["github", { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: TOKEN } }, []],
    ]);
  });
});

describe("Import from other apps (HS-D75)", () => {
  // (fails before: yes — HC-127: there was no import)
  test("nothing found: each file says where it looked and that nothing is there", async () => {
    const r = rig();
    const { status, body } = await r.call("GET", "/mcp-servers/import?scope=all");
    assert.equal(status, 200);
    assert.deepEqual(body.sources.map((/** @type {any} */ s) => [s.label, s.path, s.state, s.servers.length]), [["Claude Desktop", CLAUDE, "missing", 0], ["Cursor", CURSOR, "missing", 0], ["Codex", CODEX, "missing", 0]]);
  });

  // (fails before: yes — HC-79, HC-128 to HC-132, HC-135 to HC-137)
  test("each file's servers, each marked against yours; a file it cannot read says why and the rest are listed; credentials masked", async () => {
    const r = rig(new Map([
      [CLAUDE, JSON.stringify({ mcpServers: { github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: TOKEN } }, notes: { command: "node", args: ["notes.js"] }, filament: { command: "npx", args: ["filament", "mcp"] } } })],
      [CURSOR, "{ not json"],
      [CODEX, CODEX_TOML],
    ]));
    // Yours: a server called notes that is another program, and one that is Claude Desktop's github under another name.
    r.mcpServers.put("all", "notes", { name: "notes", command: "other-notes" });
    r.mcpServers.put("all", "gh", { name: "gh", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: TOKEN } });
    const { body, text } = await r.call("GET", "/mcp-servers/import?scope=all");
    const [claude, cursor, codex] = body.sources;
    assert.deepEqual([claude.state, cursor.state, codex.state], ["found", "unreadable", "found"]);
    assert.match(cursor.why, /^it is not JSON/);
    assert.deepEqual(rows(claude), [["github", "same"], ["notes", "taken"], ["filament", "own"]]);
    assert.deepEqual([claude.servers[0].yours, claude.servers[1].yours], ["gh", "notes"]);
    assert.deepEqual(rows(codex), [
      ["figma", "new", ["Codex sends the token in FIGMA_TOKEN as its Authorization header: add that header here"]],
      ["brave-search", "new", ["Codex passes BRAVE_API_KEY from its environment: add it here"]],
      ["old", "new", ["Off in Codex: it comes in off"]],
      ["github", "repeat"],
    ]);
    assert.equal(codex.servers[3].sameIn, "Claude Desktop", "the same server twice is offered once");
    assert.equal(claude.servers[0].spec.env.GITHUB_TOKEN, SECRET_MARK);
    assert.ok(!text.includes(TOKEN), "no credential reaches the page");
  });

  // (fails before: yes — HC-135: two apps' servers of one name)
  test("another app's server of a name already offered takes its app's word", async () => {
    const r = rig(new Map([
      [CLAUDE, JSON.stringify({ mcpServers: { search: { command: "a" } } })],
      [CURSOR, JSON.stringify({ mcpServers: { search: { command: "b" } } })],
      [CODEX, '[mcp_servers.search]\ncommand = "c"\n'],
    ]));
    const { body } = await r.call("GET", "/mcp-servers/import?scope=all");
    assert.deepEqual(body.sources.map((/** @type {any} */ s) => s.servers[0].name), ["search", "search-cursor", "search-codex"]);
  });

  // (fails before: yes — HC-129, HC-132, HC-134)
  test("Save writes the picks from the files read again: a taken name is replaced, a server gone from its file is named", async () => {
    const r = rig(new Map([
      [CLAUDE, JSON.stringify({ mcpServers: { github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: TOKEN } }, notes: { command: "node", args: ["notes.js"] } } })],
      [CODEX, CODEX_TOML],
    ]));
    r.mcpServers.put("all", "notes", { name: "notes", command: "other-notes" });
    await r.call("GET", "/mcp-servers/import?scope=all");
    // Between the list and Save, Codex's file lost its figma server.
    r.files.set(CODEX, CODEX_TOML.replace(/\[mcp_servers\.figma\][^[]+/, ""));
    const picks = [{ source: "claude-desktop", name: "github" }, { source: "claude-desktop", name: "notes" }, { source: "codex", name: "figma" }, { source: "codex", name: "old" }];
    const { status, body, text } = await r.call("POST", "/mcp-servers/import", { scope: "all", picks });
    assert.equal(status, 200);
    assert.deepEqual([body.added, body.gone, body.failed], [["github", "notes", "old"], ["Codex's figma"], []]);
    assert.deepEqual(body.servers.map((/** @type {any} */ s) => [s.name, s.on]), [["notes", true], ["github", true], ["old", false]]);
    const kept = r.cfg().sessions.defaults["plugins.mcp"];
    assert.equal(kept.find((/** @type {any} */ s) => s.name === "github").env.GITHUB_TOKEN, TOKEN, "the value came from the file, not the page");
    assert.deepEqual(kept.find((/** @type {any} */ s) => s.name === "notes"), { name: "notes", command: "node", args: ["notes.js"] }, "your notes replaced");
    assert.ok(!text.includes(TOKEN));
  });

  test("Save refuses picks it cannot read, in words", async () => {
    const r = rig();
    const { status, body } = await r.call("POST", "/mcp-servers/import", { scope: "all", picks: "everything" });
    assert.deepEqual([status, body.error], [400, "picks must be a list of { source, name }, the servers to add"]);
  });
});
