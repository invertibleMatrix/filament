// @ts-check
// The agent's lsp tool (src/app/agent/lsp-tool.js; the owner's LSP of 11-04): what the language server that serves a
// file knows of the code — places by their path relative to the folder, with the line's text; a hover's words; a
// file's symbols and the project's; a file's problems, at once where nothing changed since the server spoke. A place
// said wrong, a file no server serves, a server that does not start, each said in words. Offered to every agent of the
// loop after its hands, run in every mode; in a whole turn, the chat's own servers answer it, and a worker's in its
// worktree close with its run.
// (fails before: yes — the agent had no lsp tool)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLspPool } from "../src/adapters/lsp/pool.js";
import { languageServers } from "../src/adapters/lsp/servers.js";
import { LSP, LSP_TOOL, runLsp } from "../src/app/agent/lsp-tool.js";
import { argSummary, changesOrRuns, gate, isLoopTool, leadToolSetFor, toolSetFor } from "../src/app/agent/tools.js";
import { cardOf } from "../src/core/tool-vocab.js";
import { LOOP_TOOL_NAMES } from "../src/services/session-settings.js";
import { roundRows } from "../src/ui/harness/conversation/tools/render.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { removeDirs, until } from "./helpers/wait.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";

const FAKE = fileURLToPath(new URL("./fixtures/fake-lsp.mjs", import.meta.url));
/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
const APP = "helperish(); helper(); helper();\nconst helperish = 1; // ERROR: helperish is never read\n// WARN: a long line\n";
/** A folder with a file that calls into another, one with problems, and one no server serves. */
const folder = () => {
  const d = mkdtempSync(join(tmpdir(), "filament-lsp-tool-"));
  made.push(d);
  mkdirSync(join(d, "src"));
  writeFileSync(join(d, "src", "util.js"), "function helper() {}\nfunction other() {}\n");
  writeFileSync(join(d, "app.js"), APP);
  writeFileSync(join(d, "notes.md"), "# notes\n");
  return d;
};
/** The fake server as yours, with knobs in its environment. @param {Record<string, string>} [env] @returns {import("../src/adapters/lsp/servers.js").LspEntry} */
const fakeEntry = (env = {}) => ({ name: "fake", from: "yours", on: true, spec: { name: "fake", command: process.execPath, args: [FAKE], env, languages: { ".js": "javascript" } } });

describe("asked of a place, a file, the project", () => {
  /** @type {string} */
  let dir;
  /** @type {ReturnType<typeof createLspPool>} */
  let pool;
  before(() => {
    dir = folder();
    pool = createLspPool();
  });
  after(() => pool.closeAll());
  /** @param {any} input @param {any} [o] */
  const ask = (input, o = {}) => runLsp(input, { root: dir, servers: [fakeEntry()], pool, ...o });

  // (fails before: the name's place found inside another name — helperish — where it stands whole further on)
  test("definition, references, hover, a file's symbols, the project's: places relative to the folder, with the line's text; the server let go after each", async () => {
    assert.equal(await ask({ action: "definition", path: "app.js", line: 1, symbol: "helper" }), "src/util.js:1:10: function helper() {}");
    assert.equal(await ask({ action: "references", path: "app.js", line: 1, symbol: "helper", occurrence: 2 }), ["app.js:1:14: helperish(); helper(); helper();", "app.js:1:24: helperish(); helper(); helper();", "src/util.js:1:10: function helper() {}"].join("\n"));
    assert.match(await ask({ action: "hover", path: "app.js", line: 1, symbol: "helper" }), /^```js\nfunction helper\(\)\n```\nIt does helper — café ✓$/);
    assert.match(await ask({ action: "hover", path: "app.js", line: 1, column: 1 }), /function helperish\(\)/, "by its column");
    assert.equal(await ask({ action: "symbols", path: "src/util.js" }), "function helper (line 1)\nfunction other (line 2)");
    assert.equal(await ask({ action: "workspace_symbols", path: "app.js", query: "oth" }), "src/util.js:2:10: function other");
    assert.equal(await ask({ action: "definition", path: "app.js", line: 3, column: 4 }), "(no matches) fake knows no definition of WARN at app.js:3:4.");
    assert.equal(await ask({ action: "type_definition", path: "app.js", line: 1, symbol: "helper" }), "(no matches) Language server fake does not answer type_definition. Use grep and read for it.");
    assert.deepEqual(pool.running().map((r) => r.held), [0], "one server, held by no call now");
  });

  test("a place said wrong is said back, with what the line reads", async () => {
    /** @param {any} input */
    const said = async (input) => {
      try {
        return `ran: ${await ask(input)}`;
      } catch (/** @type {any} */ e) {
        return String(e.message);
      }
    };
    assert.equal(await said({ action: "rename", path: "app.js" }), "action must be one of: definition, type_definition, implementation, references, hover, symbols, workspace_symbols, diagnostics");
    assert.equal(await said({ action: "definition" }), "definition needs path: the file");
    assert.equal(await said({ action: "definition", path: "app.js", symbol: "helper" }), "definition needs line: the line the name is on, 1-based");
    assert.equal(await said({ action: "definition", path: "app.js", line: 9, symbol: "helper" }), "app.js has 4 lines: line 9 is past its end");
    assert.equal(await said({ action: "definition", path: "app.js", line: 2, symbol: "helper()" }), "helper() is not on line 2 of app.js, which reads: const helperish = 1; // ERROR: helperish is never read");
    assert.equal(await said({ action: "definition", path: "app.js", line: 1, symbol: "helper", occurrence: 3 }), "occurrence 3: helper is on line 1 of app.js twice");
    assert.equal(await said({ action: "hover", path: "app.js", line: 1 }), "hover needs symbol, the name on line 1 to ask about, or column");
    assert.equal(await said({ action: "hover", path: "app.js", line: 1, column: 99 }), "column 99 is not on line 1 of app.js, which has 32 characters");
    assert.equal(await said({ action: "workspace_symbols", path: "app.js" }), "workspace_symbols needs query: the name, or a part of it");
    assert.equal(await said({ action: "symbols", path: "nope.js" }), "nope.js is no file in the working folder");
    assert.match(await said({ action: "symbols", path: "../elsewhere.js" }), /resolves outside the allowed task folder/);
  });

  test("a file no server serves, or none installed, says why and to use grep; a server that does not start, its problem", async () => {
    const servers = [fakeEntry(), ...languageServers({})];
    const found = (/** @type {any} */ spec) => spec.name === "fake";
    assert.equal(await ask({ action: "symbols", path: "notes.md" }, { servers, found }), "(no matches) No language server here serves .md files. Use grep and read for this file.");
    writeFileSync(join(dir, "tool.py"), "x = 1\n");
    assert.equal(
      await ask({ action: "symbols", path: "tool.py" }, { servers, found }),
      "(no matches) No language server for .py files is installed on this computer: pyright-langserver (npm install -g pyright), or pylsp (pip install python-lsp-server). Filament runs the first it finds on the PATH. Use grep and read for this file.",
    );
    const broken = { ...fakeEntry(), spec: { ...fakeEntry().spec, command: join(dir, "no-such-server.exe") } };
    await assert.rejects(ask({ action: "symbols", path: "app.js" }, { servers: [broken], found: () => true }), /^Error: language server fake could not start .*\. Use grep and read meanwhile\.$/);
  });
});

describe("a file's problems", () => {
  // (fails before: on Windows a server that spells the drive its own way had its problems kept as another file's, and
  // a file asked of again unchanged waited out the whole wait for a word the server never says again)
  test("errors first, each where it stands; asked again unchanged, at once; changed, its new ones — from a server that spells the drive its own way", async () => {
    const dir = folder();
    const pool = createLspPool();
    after(() => pool.closeAll());
    const ask = (/** @type {number} */ waitMs) => runLsp({ action: "diagnostics", path: "app.js" }, { root: dir, servers: [fakeEntry({ FAKE_LSP_LOWER_DRIVE: "1" })], pool, waitMs });
    const col = APP.split("\n")[1].indexOf("ERROR:") + 1;
    const want = [`app.js:2:${col}: error: helperish is never read (fake E1)`, "app.js:3:4: warning: a long line (fake)"].join("\n");
    assert.equal(await ask(10_000), want);
    const t0 = Date.now();
    assert.equal(await ask(4000), want);
    assert.ok(Date.now() - t0 < 2000, `answered at once, from what the server said (${Date.now() - t0} ms)`);
    writeFileSync(join(dir, "app.js"), "helper();\n");
    assert.equal(await ask(10_000), "(no matches) fake finds no problems in app.js.");
    assert.equal(await runLsp({ action: "references", path: "app.js", line: 1, symbol: "helper" }, { root: dir, servers: [fakeEntry({ FAKE_LSP_LOWER_DRIVE: "1" })], pool }), "app.js:1:1: helper();\nsrc/util.js:1:10: function helper() {}", "its places relative to the folder too");
  });
});

describe("as the files and the call stand", () => {
  /** @type {ReturnType<typeof createLspPool>} */
  let pool;
  before(() => {
    pool = createLspPool();
  });
  after(() => pool.closeAll());

  // (fails before: the second call found the change already sent by the first and gave the problems of the text before)
  test("a change one call sends is the one another call's problems wait for, side by side", async () => {
    const dir = folder();
    const ask = (/** @type {any} */ input) => runLsp(input, { root: dir, servers: [fakeEntry({ FAKE_LSP_DIAG_MS: "300" })], pool, waitMs: 5000 });
    assert.match(await ask({ action: "diagnostics", path: "app.js" }), /helperish is never read/);
    writeFileSync(join(dir, "app.js"), "helper(); // ERROR: this one now\n");
    const [, problems] = await Promise.all([ask({ action: "references", path: "app.js", line: 1, symbol: "helper" }), ask({ action: "diagnostics", path: "app.js" })]);
    assert.equal(problems, "app.js:1:14: error: this one now (fake E1)");
  });

  // (fails before: a file the server was told of once kept that text with it, so its places were the old text's)
  test("another file the server was told of, changed since: its places are the disk's", async () => {
    const dir = folder();
    const ask = (/** @type {any} */ input) => runLsp(input, { root: dir, servers: [fakeEntry()], pool });
    assert.equal(await ask({ action: "symbols", path: "src/util.js" }), "function helper (line 1)\nfunction other (line 2)");
    writeFileSync(join(dir, "src", "util.js"), "// two lines\n// on top\nfunction helper() {}\nfunction other() {}\n");
    assert.equal(await ask({ action: "definition", path: "app.js", line: 1, symbol: "helper" }), "src/util.js:3:10: function helper() {}");
  });

  // The drive of 11-04: TypeScript's server answered the definition of an imported name with its import line, and the
  // agent had to ask again from there — a round, and its tokens, for every imported name.
  // (fails before: yes — the answer was the import's place)
  test("a definition that leads to the name's import in the same file is followed once, to where the name is defined", async () => {
    const dir = folder();
    writeFileSync(join(dir, "main.js"), 'import { helper } from "./src/util.js";\n\nhelper();\nlocal();\nfunction local() {}\n');
    const ask = (/** @type {any} */ input) => runLsp(input, { root: dir, servers: [fakeEntry({ FAKE_LSP_IMPORTS: "1" })], pool });
    assert.equal(await ask({ action: "definition", path: "main.js", line: 3, symbol: "helper" }), "src/util.js:1:10: function helper() {}");
    // A name defined in the same file is that place, asked again from there to no other.
    assert.equal(await ask({ action: "definition", path: "main.js", line: 4, symbol: "local" }), "main.js:5:10: function local() {}");
    // From the import itself, as before.
    assert.equal(await ask({ action: "definition", path: "main.js", line: 1, symbol: "helper" }), "src/util.js:1:10: function helper() {}");
  });

  // (fails before: the line of a place outside the working folder was read and shown)
  test("a place outside the working folder is named, its line not read", async () => {
    const dir = folder();
    const far = mkdtempSync(join(tmpdir(), "filament-lsp-far-"));
    made.push(far);
    const lib = join(far, "lib.js");
    writeFileSync(lib, "function faraway() {} // a line from elsewhere\n");
    writeFileSync(join(dir, "far.js"), "faraway();\n");
    const got = await runLsp({ action: "definition", path: "far.js", line: 1, symbol: "faraway" }, { root: dir, servers: [fakeEntry({ FAKE_LSP_ELSEWHERE: lib })], pool });
    assert.equal(got, `${lib}:1:10:`);
  });

  // (fails before: a stop waited out the server's start, up to its whole startup time)
  test("a stop while the server starts ends the call; the server that comes after is let go", async () => {
    const dir = folder();
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 100);
    const t0 = Date.now();
    await assert.rejects(runLsp({ action: "symbols", path: "app.js" }, { root: dir, servers: [fakeEntry({ FAKE_LSP_INIT_MS: "2500" })], pool, signal: stop.signal }), /^Error: stopped while language server fake started$/);
    assert.ok(Date.now() - t0 < 1500, `not past the stop (${Date.now() - t0} ms)`);
    await until(() => pool.running().some((r) => r.root.toLowerCase() === dir.toLowerCase()), "the server, once started");
    assert.deepEqual(pool.running().filter((r) => r.root.toLowerCase() === dir.toLowerCase()).map((r) => r.held), [0], "held by no call");
  });
});

describe("offered to every agent of the loop, in every mode", () => {
  test("after the hands in the loop's set and a lead's; its switch takes it; it runs in read-only; its call in words; its card by what it asks", () => {
    const names = toolSetFor({ delegateRead: false }).map((t) => t.name);
    assert.equal(names[names.indexOf("glob") + 1], LSP);
    const lead = leadToolSetFor({ delegateRead: false }).map((t) => t.name);
    assert.equal(lead[lead.indexOf("glob") + 1], LSP);
    assert.ok(!toolSetFor({ delegateRead: false, disabled: [LSP] }).some((t) => t.name === LSP));
    assert.ok(LOOP_TOOL_NAMES.includes(LSP) && isLoopTool(LSP));
    assert.deepEqual(LSP_TOOL.input_schema.required, ["action", "path"]);
    for (const mode of /** @type {const} */ (["read-only", "ask", "edit", "auto"])) assert.equal(gate(mode, LSP, { action: "references", path: "a.js", line: 1, symbol: "x" }).verdict, "run", mode);
    assert.equal(changesOrRuns(LSP), false);
    assert.equal(argSummary(LSP, { action: "references", path: "src\\a.js", line: 4, symbol: "greet" }), "greet in src/a.js:4");
    assert.deepEqual(cardOf(LSP, { action: "definition", path: "a.js", line: 4, symbol: "greet" }), { kind: "search", title: "Definition", subject: "greet in a.js:4" });
    assert.deepEqual(cardOf(LSP, { action: "diagnostics", path: "a.js" }), { kind: "list", title: "Problems", subject: "a.js" });
    assert.deepEqual(cardOf(LSP, { action: "hover", path: "a.js", line: 2, column: 5 }), { kind: "other", title: "Hover", subject: "column 5 in a.js:2" });
    assert.deepEqual(cardOf(LSP, { action: "workspace_symbols", path: "a.js", query: "Gre" }), { kind: "search", title: "Workspace symbols", subject: "Gre" });
  });

  // Its words ride every request of every agent of the loop, a lead's and each sub-agent's (the owner's of 11-04: keep the
  // tokens of what LSP adds in mind): short, and still naming every action.
  // (fails before: yes — they were some 2,100 characters)
  test("its words are short, and name every action", () => {
    const words = LSP_TOOL.description;
    assert.ok(words.length <= 1100, `${words.length} characters`);
    for (const a of ["definition", "type_definition", "implementation", "references", "hover", "symbols", "workspace_symbols", "diagnostics"]) assert.match(words, new RegExp(`\\b${a}\\b`), a);
    assert.match(words, /use grep and read/);
  });
});

describe("its row on the page", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => {
    doc = stubDocument();
  });
  after(() => doc.restore());
  /** What a live call's row says: its kind, its subject, the rest. @param {any} input @param {string} preview */
  const row = (input, preview) => {
    const t = { id: "l1", name: LSP, state: "done", args: argSummary(LSP, input), card: cardOf(LSP, input), preview, chars: preview.length };
    const [r] = roundRows({ round: 1, order: [t.id], tools: new Map([[t.id, t]]), plan: null });
    return ["tool-kind", "tool-primary", "tool-secondary"].map((c) => r.querySelector(`.${c}`)?.textContent ?? null);
  };

  // (fails before: each row said its ask twice — "definition greet in app.py:9" beside "Find greet in app.py:9" — and a
  // file no server serves counted as a hit)
  test("says its ask once; the places it found as hits, an answer that found none as none", () => {
    const [kind, primary, rest] = row({ action: "definition", path: "app.py", line: 9, symbol: "greet" }, "app.py:5:5: def greet(name):");
    assert.deepEqual([kind, primary], ["Definition", "Find greet in app.py:9"]);
    assert.match(String(rest), /^1 hit · /);
    assert.deepEqual(row({ action: "hover", path: "app.py", line: 9, symbol: "helper" }, "```python\nhelper(x)\n```"), ["Hover", "helper in app.py:9", null]);
    assert.doesNotMatch(String(row({ action: "symbols", path: "notes.md" }, "(no matches) No language server here serves .md files. Use grep and read for this file.")[2]), /hit/);
  });
});

describe("in a whole turn", () => {
  /** @type {any} */
  let up;
  /** @type {any} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {string} */
  let log;
  /** @type {string} */
  let dataDir;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    root = folder();
    log = join(mkdtempSync(join(tmpdir(), "filament-lsp-tool-log-")), "fake.log");
    made.push(join(log, ".."));
    const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: root, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
    git("init", "-q");
    git("add", "-A");
    git("commit", "-qm", "init");
    up = await fakeUpstream(async (/** @type {any} */ call) => brain(call));
    shim = await startApp({
      memory: true,
      keep: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-model": { input: 1, output: 1, contextTokens: 200000 } } }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
    dataDir = shim.dataDir;
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    await removeDirs(dataDir);
  });
  const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
  /** @param {any} body */
  const resultsOf = (body) => {
    const m = body.messages.at(-1);
    return Array.isArray(m?.content) ? m.content.filter((/** @type {any} */ c) => c?.type === "tool_result").map((/** @type {any} */ c) => String(c.content)) : [];
  };
  /** What the fake server was told, each with the folder it serves. */
  const told = () => readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

  test("the chat's own server answers in read-only; a worker's, in its worktree, closes with its run; the chat's with Filament", async () => {
    const settings = { lsp: { servers: [{ name: "fake", command: process.execPath, args: [FAKE, `--log=${log}`], extensionToLanguage: { ".js": "javascript" } }] } };
    const make = async (/** @type {any} */ s) => {
      const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: s } });
      if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
      return String((await r.json()).id);
    };
    const turn = async (/** @type {string} */ id, /** @type {string} */ content) => {
      const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
      if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
      return r.json();
    };
    /** @type {any[]} */
    const seen = [];
    /** @type {string[]} */
    const workerSaw = [];
    brain = (/** @type {any} */ call) => {
      const body = call.body;
      seen.push(body);
      const all = JSON.stringify(body.messages);
      const results = resultsOf(body);
      // A sub-agent launches none of its own: its tools have no agent.
      if (!body.tools.some((/** @type {any} */ t) => t.name === "agent")) {
        if (!results.length) return reply([{ type: "tool_use", id: "w1", name: LSP, input: { action: "symbols", path: "src/util.js" } }], "tool_use");
        workerSaw.push(...results);
        return reply([{ type: "text", text: "Read the symbols." }]);
      }
      if (all.includes("LAUNCH")) return results.length ? reply([{ type: "text", text: "Launched." }]) : reply([{ type: "tool_use", id: "a1", name: "agent", input: { run_in_background: false, description: "Symbols", prompt: "List the symbols of src/util.js." } }], "tool_use");
      if (all.includes("LOOK")) return results.length ? reply([{ type: "text", text: "Looked." }]) : reply([{ type: "tool_use", id: "l1", name: LSP, input: { action: "definition", path: "app.js", line: 1, symbol: "helper" } }], "tool_use");
      return reply([{ type: "text", text: "?" }]);
    };
    const ro = await make({ ...settings, loop: { permissions: "read-only" } });
    await turn(ro, "LOOK at helper");
    const names = seen[0].tools.map((/** @type {any} */ t) => t.name);
    assert.equal(names[names.indexOf("glob") + 1], LSP, names.join(", "));
    assert.deepEqual(resultsOf(seen.at(-1)), ["src/util.js:1:10: function helper() {}"], "run in read-only, by the chat's own server");
    const rw = await make({ ...settings, subagents: { workspace: "worktree" } });
    await turn(rw, "LAUNCH a worker");
    assert.deepEqual(workerSaw, ["function helper (line 1)\nfunction other (line 2)"]);
    const starts = told().filter((t) => t.method === "initialize").map((t) => t.root);
    assert.equal(starts.length, 2, JSON.stringify(starts));
    assert.equal(starts[0], root, "the chat's, in its folder");
    const worktree = starts[1];
    assert.notEqual(worktree, root, "the worker's, in its worktree");
    await until(() => told().some((t) => t.method === "exit" && t.at === worktree), "the worker's closed with its run");
    assert.ok(!told().some((t) => t.method === "shutdown" && t.at === root), "the chat's runs on");
    // A worker on Auto works in a patch: its language server moves it to a worktree at the same folder first — said with
    // the server's answer, nothing changed yet — and closes with its run there too.
    const auto = await make(settings);
    await turn(auto, "LAUNCH a worker");
    assert.deepEqual(workerSaw.slice(1), ["function helper (line 1)\nfunction other (line 2)\n\n[Filament: your workspace became a git worktree at the same folder, with nothing changed yet; the language server ran there.]"]);
    const moved = told().filter((t) => t.method === "initialize").map((t) => t.root)[2];
    assert.ok(moved && moved !== root && moved !== worktree, `the patch worker's, in the worktree it moved to: ${moved}`);
    await until(() => told().some((t) => t.method === "exit" && t.at === moved), "the patch worker's closed with its run");
    assert.ok(!told().some((t) => t.method === "shutdown" && t.at === root), "the chat's runs on");
    await shim.stop();
    shim = null;
    assert.ok(told().some((t) => t.method === "shutdown" && t.at === root), "closed with Filament");
  });
});
