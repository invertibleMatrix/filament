// @ts-check
// Which language server serves a file (src/adapters/lsp/servers.js; the owner's LSP of 11-04: installed ones, nothing
// bundled): the ones Filament knows, found by their programs here — an npm shim run by Node —; a Claude Code plugin's
// lspServers, read and filled as its MCP servers are (core/plugin-parts.js, app/plugins.js); yours and your switches,
// `lsp.servers`, adding up by name across the layers (services/session-settings.js), a value it refuses passed over
// so the layer beneath decides, with nothing converted.
// (fails before: yes — Filament knew no language server, and read a plugin's as "not supported here")
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FOUND_TTL_MS, installed, languageServers, serverFor } from "../src/adapters/lsp/servers.js";
import { languageOf, startLsp } from "../src/adapters/lsp/client.js";
import { lspServersOf, runChangeWords, runKeyOf } from "../src/core/plugin-parts.js";
import { lspServerProblem, mergeLspServers, resolveSettings, validateLayer } from "../src/services/session-settings.js";
import { createPlugins } from "../src/app/plugins.js";
import { removeDirs } from "./helpers/wait.js";

const FAKE = fileURLToPath(new URL("./fixtures/fake-lsp.mjs", import.meta.url));
/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
/** @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-lsp-servers-${tag}-`));
  made.push(d);
  return d;
};
/** @param {string} path @param {unknown} body */
const put = (path, body) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body, null, 2));
};
/** The PATH and npm's folder for one test, put back after it. @param {import("node:test").TestContext} t @param {string} path @param {string} appdata */
const onPath = (t, path, appdata) => {
  const was = { PATH: process.env.PATH, APPDATA: process.env.APPDATA };
  process.env.PATH = path;
  process.env.APPDATA = appdata;
  t.after(() => {
    process.env.PATH = was.PATH;
    process.env.APPDATA = was.APPDATA;
  });
};
const anywhere = () => true;

describe("Filament's own servers, found where they are installed", () => {
  test("a file's server by its extension, its program an npm shim on the PATH that Node runs; none installed, said with how; none for such files, said", { skip: process.platform !== "win32" && "npm's shims are Windows' .cmd files" }, async (t) => {
    const dir = fresh("path");
    const bin = join(dir, "bin");
    // An npm shim as npm writes one, its script under node_modules beside it: the fake server.
    put(join(bin, "node_modules", "fake-ls", "server.mjs"), readFileSync(FAKE, "utf8"));
    put(join(bin, "typescript-language-server.cmd"), ["@ECHO off", "GOTO start", ":find_dp0", "SET dp0=%~dp0", "EXIT /b", ":start", "SETLOCAL", "CALL :find_dp0", 'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\fake-ls\\server.mjs" %*', ""].join("\r\n"));
    put(join(dir, "app.ts"), "function helper() {}\n");
    onPath(t, bin, join(dir, "appdata"));
    const servers = languageServers(resolveSettings({}).effective.lsp);
    const ts = serverFor(join(dir, "src", "App.TSX"), servers);
    assert.deepEqual([ts.server?.name, ts.server?.from, ts.server?.spec.languages[".tsx"]], ["typescript", "filament", "typescriptreact"]);
    if (!ts.server) return;
    const s = await startLsp(ts.server.spec, { root: dir });
    try {
      assert.equal(s.capabilities.definitionProvider, true, "started by its script under Node, and initialized");
    } finally {
      await s.close();
    }
    assert.deepEqual([serverFor("a.py", servers).server, serverFor("a.py", servers).said], [null, "No language server for .py files is installed on this computer: pyright-langserver (npm install -g pyright), or pylsp (pip install python-lsp-server). Filament runs the first it finds on the PATH."]);
    assert.equal(serverFor("README.md", servers).said, "No language server here serves .md files.");
    assert.equal(serverFor("Makefile", servers).said, "No language server here serves a file with no extension.");
  });

  // (fails before: the review of 11-04 — a server not found was taken as not there for 30 s, so an agent told how to
  // install it and asking again was told the same)
  test("a server installed on being told how is found at the next ask; one found is taken as there a while for its PATH", (t) => {
    const dir = fresh("ttl");
    onPath(t, dir, join(dir, "appdata"));
    const spec = { name: "x", command: "fake-ls-ttl", languages: { ".x": "x" } };
    const file = join(dir, process.platform === "win32" ? "fake-ls-ttl.exe" : "fake-ls-ttl");
    const t0 = 1_000_000;
    assert.equal(installed(spec, { cwd: dir, now: t0 }), false);
    put(file, "");
    assert.equal(installed(spec, { cwd: dir, now: t0 + 1000 }), true, "looked for again");
    rmSync(file);
    assert.equal(installed(spec, { cwd: dir, now: t0 + 2000 }), true, "kept");
    assert.equal(installed(spec, { cwd: dir, now: t0 + 1000 + FOUND_TTL_MS }), false, "looked at again once old");
  });

  // (fails before: the review of 11-04 — the agents' lookup said a server was there that the start could not run, and
  // missed one it could)
  test("a program is installed where its start finds it: a whole path without its .exe, yes; a file with no extension Windows cannot run, no", { skip: process.platform !== "win32" && "Windows' PATHEXT" }, (t) => {
    const dir = fresh("found");
    put(join(dir, "llvm", "clangd.exe"), "");
    put(join(dir, "bin", "posix-ls"), "#!/bin/sh\n");
    onPath(t, join(dir, "bin"), join(dir, "appdata"));
    const spec = (/** @type {string} */ command) => ({ name: "x", command, languages: { ".c": "c" } });
    assert.equal(installed(spec(join(dir, "llvm", "clangd")), { cwd: dir }), true);
    assert.equal(installed(spec("posix-ls"), { cwd: dir }), false);
    assert.equal(serverFor(join(dir, "a.c"), languageServers({ servers: [{ name: "mine", command: "posix-ls", extensionToLanguage: { ".c": "c" } }] }), { root: dir }).said, "No language server for .c files is installed on this computer: posix-ls, or clangd (clangd from LLVM, or your package manager's). Filament runs the first it finds on the PATH.");
  });

  // (fails before: the review of 11-04 — Claude's clangd map names .c and .C, and each extension in small letters kept
  // the last: every C file opened as C++)
  test("a file's language by its extension as written, else in any case: .c is C and .C is C++", () => {
    const map = { ".c": "c", ".h": "c", ".C": "cpp", ".H": "cpp" };
    assert.deepEqual([languageOf(map, "a.c"), languageOf(map, "a.C"), languageOf(map, "b.H"), languageOf({ ".tsx": "typescriptreact" }, "App.TSX"), languageOf(map, "Makefile"), languageOf(map, "a.go")], ["c", "cpp", "cpp", "typescriptreact", null, null]);
    assert.deepEqual(lspServersOf({ clangd: { command: "clangd", extensionToLanguage: map } }).servers[0].spec.languages, map);
  });
});

describe("yours, a plugin's, Filament's own", () => {
  test("a file picks yours first, then a plugin's, then Filament's own, the first on and installed; a switch turns one of its name off; a name of yours replaces Filament's", () => {
    const own = mergeLspServers([
      [{ name: "pylsp", enabled: false }, { name: "mine", command: "my-py-ls", args: ["--stdio"], extensionToLanguage: { ".PY": "python" } }],
      [{ name: "mine", enabled: false }],
      [{ name: "mine", enabled: true }],
    ]);
    assert.deepEqual(own, [{ name: "pylsp", enabled: false }, { name: "mine", command: "my-py-ls", args: ["--stdio"], extensionToLanguage: { ".PY": "python" }, enabled: true }], "a switch keeps what the server runs");
    const plugins = [{ name: "pyright-lsp", command: "/p/bin/pyright-langserver", args: ["--stdio"], languages: { ".py": "python" }, env: { CLAUDE_PLUGIN_ROOT: "/p" }, plugin: "pyright-lsp@official" }];
    const all = languageServers({ servers: own, plugins });
    assert.deepEqual(all.map((s) => [s.name, s.from, s.on]), [
      ["mine", "yours", true], ["pyright-lsp", "plugin", true], ["typescript", "filament", true], ["pyright", "filament", true],
      ["pylsp", "filament", false], ["gopls", "filament", true], ["rust-analyzer", "filament", true], ["clangd", "filament", true],
    ]);
    assert.deepEqual(serverFor("a.py", all, { found: anywhere }).server?.spec, { name: "mine", command: "my-py-ls", args: ["--stdio"], languages: { ".PY": "python" } }, "it serves .py in any case");
    assert.deepEqual(serverFor("a.py", all, { found: (s) => s.command !== "my-py-ls" }).server?.spec, { name: "pyright-lsp", command: "/p/bin/pyright-langserver", args: ["--stdio"], env: { CLAUDE_PLUGIN_ROOT: "/p" }, languages: { ".py": "python" } });
    assert.equal(serverFor("a.py", all, { found: (s) => s.command === "pylsp" }).said, "No language server for .py files is installed on this computer: my-py-ls, or /p/bin/pyright-langserver, or pyright-langserver (npm install -g pyright). Filament runs the first it finds on the PATH.", "one switched off is never started");
    const deno = languageServers({ servers: mergeLspServers([[{ name: "typescript", command: "deno", args: ["lsp"], extensionToLanguage: { ".ts": "typescript" } }, { name: "pyright", enabled: false }, { name: "pylsp", enabled: false }]]) });
    assert.deepEqual([serverFor("a.ts", deno, { found: anywhere }).server?.spec.command, deno.filter((s) => s.name === "typescript").length], ["deno", 1]);
    assert.equal(serverFor("a.tsx", deno, { found: anywhere }).said, "No language server here serves .tsx files.");
    assert.equal(serverFor("a.py", deno, { found: anywhere }).said, "The language servers for .py files are switched off here (lsp.servers): pyright, pylsp.");
    // (fails before: the review of 11-04 — a plugin's server of a name Filament's own has hid Filament's)
    const gopls = [{ name: "gopls", command: "/p/gopls", languages: { ".go": "go" }, plugin: "gopls@acme" }];
    assert.deepEqual(languageServers({ plugins: gopls }).filter((s) => s.name === "gopls").map((s) => s.from), ["plugin", "filament"]);
    assert.equal(serverFor("a.go", languageServers({ plugins: gopls }), { found: (s) => s.command === "gopls" }).server?.from, "filament", "where the plugin's is not installed");
    assert.equal(serverFor("a.go", languageServers({ plugins: gopls, servers: [{ name: "gopls", enabled: false }] }), { found: anywhere }).said, "The language servers for .go files are switched off here (lsp.servers): gopls, gopls.", "a switch reaches every server of its name");
  });

  // (fails before: the owner's of 11-04 — the lsp tool runs in every mode, read-only too, and rust-analyzer ran the
  // project's build scripts and procedural macros as it started)
  test("Filament's own rust-analyzer runs no code of the project: no build scripts, no procedural macros, no cargo check — told at its start, and as its configuration; yours runs as written", () => {
    const tamed = { cargo: { buildScripts: { enable: false } }, procMacro: { enable: false }, checkOnSave: false };
    const own = languageServers({}).find((s) => s.name === "rust-analyzer");
    assert.deepEqual([own?.spec.initializationOptions, own?.spec.settings], [tamed, { "rust-analyzer": tamed }]);
    assert.deepEqual(languageServers({ servers: [{ name: "rust-analyzer", enabled: true }] }).find((s) => s.name === "rust-analyzer")?.spec.initializationOptions, tamed, "a switch keeps it tamed");
    const yours = languageServers({ servers: [{ name: "rust-analyzer", command: "rust-analyzer", extensionToLanguage: { ".rs": "rust" } }] }).find((s) => s.name === "rust-analyzer");
    assert.deepEqual([yours?.from, yours?.spec.initializationOptions, yours?.spec.settings], ["yours", undefined, undefined]);
  });
});

describe("lsp.servers (settings)", () => {
  test("checked as written; the layers add up by name; a value it refuses is passed over whole, so the layer beneath decides", () => {
    const deno = { name: "deno", command: "deno", args: ["lsp"], extensionToLanguage: { ".ts": "typescript" } };
    assert.deepEqual([lspServerProblem({ name: "pyright", enabled: false }), lspServerProblem(deno)], [null, null]);
    assert.equal(lspServerProblem({ name: "deno", command: "deno" }), 'needs extensionToLanguage: { ".ext": "languageId" }, the files it serves');
    assert.equal(lspServerProblem({ ...deno, extensionToLanguage: { ts: "typescript" } }), 'extensionToLanguage\'s "ts" is no file extension: a dot, then up to 16 letters or digits');
    assert.equal(lspServerProblem({ ...deno, extensionToLanguage: { ".ts": "" } }), 'extensionToLanguage\'s ".ts" needs its language id, as "typescript"');
    assert.equal(lspServerProblem({ name: "x", args: ["a"] }), "needs a command: a server of your own starts one, a switch is { name, enabled } alone");
    assert.equal(lspServerProblem({ name: "x" }), "needs a command, or enabled to switch the server of that name");
    assert.equal(lspServerProblem({ ...deno, command: "./bin/ls" }), "command must be a program's name on the PATH, or its whole path");
    assert.equal(lspServerProblem({ name: "Bad Name", enabled: true }), "needs a name: a-z, 0-9, -, up to 32 characters");
    assert.equal(lspServerProblem({ ...deno, settings: [] }), "settings must be { section: value }");
    // (fails before: the review of 11-04 — a socket server of yours was taken and then started over stdio)
    assert.equal(lspServerProblem({ ...deno, transport: "socket" }), "transport must be stdio: Filament speaks to language servers over stdio");
    assert.equal(lspServerProblem({ ...deno, transport: "stdio", startupTimeout: 120000 }), null);
    assert.equal(lspServerProblem({ ...deno, startupTimeout: 5 }), "startupTimeout must be a whole number of ms from 1000 to 600000");
    assert.equal(lspServerProblem({ ...deno, env: { TOKEN: "x" } }), "env is not taken: a server of yours starts in Filament's environment, and settings keep no secrets");
    assert.equal(languageServers({ servers: [{ ...deno, startupTimeout: 120000, enabled: true }] })[0].spec.startupTimeout, 120000, "its time to start, carried to the start");
    assert.deepEqual(validateLayer({ lsp: { servers: [{ name: "a", enabled: false }, { name: "a", enabled: true }] } }).errors, ['"lsp.servers" names the server a twice']);
    assert.deepEqual(validateLayer({ lsp: { servers: [{ name: "a", enabled: false }] } }, { at: "project" }).errors, [], "a project may hold it");
    const r = resolveSettings({ global: { lsp: { servers: [{ name: "pyright", enabled: false }] } }, project: { lsp: { servers: [deno] } }, session: { lsp: { servers: [{ name: "pyright", enabled: true }] } } });
    assert.deepEqual(r.effective.lsp.servers, [{ name: "pyright", enabled: true }, { ...deno, enabled: true }]);
    assert.equal(r.sources["lsp.servers"], "session");
    assert.deepEqual(resolveSettings({}).effective.lsp.servers, []);
    // A layer written in a shape Filament does not take — an entry it refuses, a key it does not know — gives nothing.
    const old = resolveSettings({ global: { lsp: { servers: [{ name: "pyright", enabled: false }] } }, project: { lsp: { servers: [{ name: "mine", command: "x" }], timeoutMs: 5 } } });
    assert.deepEqual([old.effective.lsp.servers, old.effective.lsp.timeoutMs, old.sources["lsp.servers"]], [[{ name: "pyright", enabled: false }], undefined, "global"]);
  });
});

describe("a plugin's language servers", () => {
  test("read as Claude Code writes them, wrapped or not; one Filament cannot run named with why; what runs keyed, and an update's change said", () => {
    assert.deepEqual(
      lspServersOf({ go: { command: "gopls", args: ["serve"], extensionToLanguage: { ".go": "go" }, transport: "stdio", env: { GOFLAGS: "-mod=mod" }, initializationOptions: { usePlaceholders: true }, settings: { gopls: { staticcheck: true } }, restartOnCrash: true } }),
      { servers: [{ name: "go", spec: { command: "gopls", args: ["serve"], env: { GOFLAGS: "-mod=mod" }, languages: { ".go": "go" }, initializationOptions: { usePlaceholders: true }, settings: { gopls: { staticcheck: true } } } }], skipped: [] },
    );
    assert.deepEqual(lspServersOf({ lspServers: { sock: { command: "x", transport: "socket", extensionToLanguage: { ".x": "x" } }, bare: { extensionToLanguage: { ".x": "x" } }, blind: { command: "y" }, ok: { command: "z", extensionToLanguage: { ".Z": "zed", bad: "q" } } } }), {
      servers: [{ name: "ok", spec: { command: "z", languages: { ".Z": "zed" } } }],
      skipped: [{ name: "sock", why: "it talks over socket, and Filament speaks to language servers over stdio" }, { name: "bare", why: "it names nothing to start" }, { name: "blind", why: "it names no files it serves" }],
    });
    const a = { servers: [], hooks: [], lsp: [{ name: "go", spec: { command: "gopls", languages: { ".go": "go" } } }] };
    const b = { servers: [], hooks: [], lsp: [{ name: "go", spec: { command: "gopls", args: ["serve"], languages: { ".go": "go" } } }, { name: "rs", spec: { command: "rust-analyzer", languages: { ".rs": "rust" } } }] };
    assert.notEqual(runKeyOf(a), runKeyOf(b), "a language server is a program that runs");
    assert.equal(runChangeWords(a, b), "its language server go runs another way; a new language server, rs");
    assert.equal(runChangeWords(b, { servers: [], hooks: [] }), "its language server go goes; its language server rs goes");
  });

  test("a plugin on brings its language servers, its paths and the place's values filled, named as its MCP servers are; its page shows them; a switch of yours turns one off", async () => {
    const folder = fresh("plugin");
    put(join(folder, ".claude-plugin", "plugin.json"), { name: "golang", version: "1.0.0", description: "Go", userConfig: { flags: { type: "string", title: "Build flags", required: true } } });
    put(join(folder, ".lsp.json"), {
      go: { command: "${CLAUDE_PLUGIN_ROOT}/bin/gopls", extensionToLanguage: { ".go": "go" }, env: { GOFLAGS: "${user_config.flags}" }, settings: { gopls: { directoryFilters: ["${workspaceFolder}/vendor"] } } },
      sock: { command: "x", transport: "socket", extensionToLanguage: { ".x": "x" } },
    });
    put(join(folder, ".mcp.json"), { mcpServers: { docs: { command: "node", args: ["docs.js"] } } });
    const sources = { entry: (/** @type {string} */ from, /** @type {string} */ name) => ({ market: { id: from, name: from.split("/")[1], title: from }, entry: { name, title: name, description: "", version: "", category: "", author: "", homepage: "", source: { kind: /** @type {const} */ ("path"), path: folder } } }) };
    const p = createPlugins({ dataDir: fresh("data"), sources });
    const v = await p.install({ from: "claude/acme", name: "golang" });
    assert.deepEqual(v.parts.lsp, [{ name: "go", as: "golang-go", runs: "${CLAUDE_PLUGIN_ROOT}/bin/gopls", files: [".go"] }]);
    assert.deepEqual(v.parts.notHere, ["The language server sock: it talks over socket, and Filament speaks to language servers over stdio"]);
    // (fails before: the review of 11-04 — `${workspaceFolder}` in a server's settings, the server's own words, was a
    // value the plugin asked for, and held its connectors back until it was set)
    assert.deepEqual(v.parts.asks.map((/** @type {any} */ a) => a.key), ["flags"]);
    // (fails before: the review of 11-04 — a connector's row took a plugin with language servers for one that brings
    // connectors alone, and its Remove took them away unsaid)
    assert.deepEqual(p.serversAt([{ id: "golang@acme" }]).map((s) => [s.name, s.only]), [["golang-docs", false]]);
    const doc = { plugins: { on: [{ id: "golang@acme", hooks: false }] }, lsp: { servers: [] } };
    let got = p.into(doc, { project: "p1" });
    assert.deepEqual([got.lsp, got.plugins.notes], [doc.lsp, ["golang's connectors and language servers wait for Build flags: set it on its sheet in Library › Plugins & Connectors"]]);
    p.setValues("golang@acme", "all", { flags: "-mod=mod" });
    got = p.into(doc, { project: "p1", cwd: "/w/app" });
    const s = got.lsp.plugins[0];
    assert.deepEqual([s.name, s.command, s.languages, s.env.GOFLAGS, s.env.CLAUDE_PLUGIN_ROOT, s.env.CLAUDE_PROJECT_DIR, s.plugin], ["golang-go", `${v.root}/bin/gopls`, { ".go": "go" }, "-mod=mod", v.root, "/w/app", "golang@acme"]);
    assert.deepEqual([got.lsp.servers, doc.lsp], [[], { servers: [] }], "yours as they were, and the document given too");
    assert.equal(serverFor("main.go", languageServers(got.lsp), { found: anywhere }).server?.name, "golang-go", "before Filament's own gopls");
    assert.equal(serverFor("main.go", languageServers({ ...got.lsp, servers: [{ name: "golang-go", enabled: false }] }), { found: anywhere }).server?.name, "gopls");
    // (fails before: the review of 11-04 — a second plugin's server of the same name was left out unsaid)
    await p.install({ from: "claude/beta", name: "golang" });
    p.setValues("golang@beta", "all", { flags: "-v" });
    got = p.into({ ...doc, plugins: { on: [{ id: "golang@acme", hooks: false }, { id: "golang@beta", hooks: false }] } }, {});
    assert.deepEqual(got.lsp.plugins.map((/** @type {any} */ x) => x.plugin), ["golang@acme"]);
    assert.ok(got.plugins.notes.includes("golang's language server go is left out: golang@acme's is named golang-go too"), got.plugins.notes.join("\n"));
  });
});
