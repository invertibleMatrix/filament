// @ts-check
// `@#` and a name in the message box (the owner's LSP of 11-04, phase 2): the project's names its language servers know
// (app/agent/lsp-tool.js `projectSymbols`, the route /api/lsp/symbols) — each server asked with one of the project's
// files opened, the names kept to the project's own files, best first, and why none where none is found. A pick tags the
// name's file with its lines (`@src/b.ts#L10-40`); the bubble's chip opens the file there, scrolled to them and marked
// (code-viewer.js `showLines`).
// (fails before: yes — an `@#` searched chats and files for "#name" and found none; a file's tag with lines opened the
// file at its top)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLspPool } from "../src/adapters/lsp/pool.js";
import { projectSymbols } from "../src/app/agent/lsp-tool.js";
import { projectIdOf } from "../src/core/project-id.js";
import { projectFolderOf } from "../src/services/project-folder.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { removeDirs } from "./helpers/wait.js";
import { startApp, fakeUpstream } from "./helpers/app.js";

const FAKE = fileURLToPath(new URL("./fixtures/fake-lsp.mjs", import.meta.url));
/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
/** @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-lsp-symbols-${tag}-`));
  made.push(d);
  return d;
};
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

// The page's API client keeps the `fetch` it finds when it is first imported: the stand-in goes first. It answers the
// page's own asks (`/api/...`); a running Filament's go where they went.
const g = /** @type {any} */ (globalThis);
const realFetch = g.fetch;
/** @type {string[]} */
const asked = [];
/** @param {string} url */
const pageAnswer = (url) => {
  const q = new URL(url, "http://x").searchParams.get("q") || "";
  if (url.startsWith("/api/lsp/symbols"))
    return q === "par"
      ? {
          symbols: [
            { name: "parseThing", kind: "function", container: "", path: "src/b.ts", line: 10, end: 40 },
            { name: "Parser", kind: "class", container: "", path: "lib/my file.ts", line: 3, end: 3 },
            { name: "parsed", kind: "variable", container: "Parser", path: "src/x.ts", line: null, end: null },
          ],
          said: "",
        }
      : q === "zz"
        ? { symbols: [], said: "ts has just started and is reading the project: its names come in a moment." }
        : { symbols: [], said: "" };
  if (url.startsWith("/api/files/mentions")) return { under: null, files: [{ name: "parse.js", path: "src/parse.js" }], folders: [] };
  if (url.startsWith("/api/memory/sessions")) return { sessions: [] };
  if (url.startsWith("/api/files/read")) return { kind: "text", content: Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n") + "\n" };
  return {};
};
/** Each page ask's signal, by its address. @type {Map<string, AbortSignal | null>} */
const signals = new Map();
g.fetch = async (/** @type {any} */ url, /** @type {any} */ init) => {
  if (!String(url).startsWith("/")) return realFetch(url, init);
  asked.push(String(url));
  signals.set(String(url), init?.signal ?? null);
  return { ok: true, status: 200, json: async () => pageAnswer(String(url)) };
};
const { createSlashPanel } = await import("../src/ui/harness/composer/slash.js");
const { referenceChips } = await import("../src/ui/harness/lib/labels.js");
const { userRow } = await import("../src/ui/harness/conversation/turn.js");
const { chipActions } = await import("../src/ui/harness/conversation/tools/layout.js");
const { refreshCodeViewer, renderCodeViewer, showLines } = await import("../src/ui/harness/panes/code-viewer.js");
after(() => {
  g.fetch = realFetch;
});

/** A server of the tests' own, by its name and the files it serves. @param {string} name @param {Record<string, string>} languages @param {string} [install] */
const entry = (name, languages, install) => /** @type {import("../src/adapters/lsp/servers.js").LspEntry} */ ({ name, from: "yours", on: true, spec: { name, command: `${name}-ls`, languages }, ...(install ? { install } : {}) });
const TS = entry("ts", { ".ts": "typescript" });
const PY = entry("py", { ".py": "python" });

/**
 * A pool whose servers answer workspace/symbol with `answers[name]` (an Error is thrown), and what they were asked.
 * `caps`: whether a server, by its name, says it lists a project's names; `gone`: the files no longer on the disk, which
 * a server cannot open.
 * @param {Record<string, any>} answers @param {{ fresh?: boolean, problem?: string, caps?: (name: string) => boolean, gone?: string[] }} [o]
 */
const stubPool = (answers, { fresh = false, problem = "", caps = () => true, gone = [] } = {}) => {
  const log = { synced: /** @type {string[]} */ ([]), asked: /** @type {any[]} */ ([]), released: 0 };
  const release = () => void log.released++;
  const pool = {
    server: async (/** @type {any} */ spec, /** @type {string} */ at) => {
      if (problem) return /** @type {any} */ ({ server: null, problem, fresh: true, release });
      const server = {
        name: spec.name,
        root: at,
        capabilities: caps(spec.name) ? { workspaceSymbolProvider: true } : {},
        sync: (/** @type {string} */ p) => {
          const rel = relative(at, p).split(sep).join("/");
          if (gone.includes(rel)) throw new Error(`ENOENT: no such file or directory, stat '${p}'`);
          log.synced.push(rel);
          return { uri: "", mark: 0 };
        },
        request: async (/** @type {string} */ method, /** @type {any} */ params) => {
          log.asked.push([spec.name, method, params.query]);
          const a = answers[spec.name];
          if (a instanceof Error) throw a;
          return a;
        },
      };
      return /** @type {any} */ ({ server, problem: null, fresh, release });
    },
  };
  return { log, pool };
};

describe("the project's names an @# asks for (projectSymbols)", () => {
  const root = fresh("unit");
  const uri = (/** @type {string} */ rel) => pathToFileURL(join(root, rel)).href;
  /** @param {number} a @param {number} ac @param {number} b @param {number} bc */
  const range = (a, ac, b, bc) => ({ start: { line: a, character: ac }, end: { line: b, character: bc } });
  const FILES = ["vite.config.ts", "deep/x/a.ts", "src/b.ts", "src/d.ts", "lib/c.ts", "b.py", "README.md"];

  // (fails before: yes — the review of 11-04 on lsp-symbols: the file nearest the folder's top was opened, vite.config.ts,
  // whose project in a Vite template is not src's, so its names were never found)
  test("each server asked with a file opened from the folder holding most of its files; kept to the project's files, each once; the name itself first, then one it starts, then one holding it", async () => {
    const { log, pool } = stubPool({
      ts: [
        { name: "parseThing", kind: 12, location: { uri: uri("src/b.ts"), range: range(9, 0, 39, 1) } },
        { name: "parse", kind: 6, containerName: "Parser", location: { uri: uri("lib/c.ts"), range: range(2, 2, 4, 0) } },
        { name: "parse", kind: 12, location: { uri: pathToFileURL(join(tmpdir(), "elsewhere", "lib.d.ts")).href, range: range(0, 0, 0, 5) } },
        { name: "reparse", kind: 12, location: { uri: uri("node_modules/x/index.ts"), range: range(0, 0, 0, 5) } },
        { name: "parseThing", kind: 12, location: { uri: uri("src/b.ts"), range: range(9, 0, 39, 1) } },
        { name: "unparsed", kind: 13, location: { uri: uri("src/b.ts") } },
      ],
      py: [{ name: "parse_py", kind: 12, location: { uri: uri("b.py"), range: range(0, 4, 0, 12) } }],
    });
    const got = await projectSymbols("parse", { root, files: FILES, servers: [TS, PY], pool, found: () => true });
    assert.deepEqual(got, {
      symbols: [
        { name: "parse", kind: "method", container: "Parser", path: "lib/c.ts", line: 3, end: 4 },
        { name: "parseThing", kind: "function", container: "", path: "src/b.ts", line: 10, end: 40 },
        { name: "parse_py", kind: "function", container: "", path: "b.py", line: 1, end: 1 },
        { name: "unparsed", kind: "variable", container: "", path: "src/b.ts", line: null, end: null },
      ],
      said: "",
    });
    assert.deepEqual(log.synced.sort(), ["b.py", "src/b.ts"], "one file a server: in src, where most are, not the config file beside it");
    assert.deepEqual(log.asked.sort(), [["py", "workspace/symbol", "parse"], ["ts", "workspace/symbol", "parse"]]);
    assert.equal(log.released, 2, "each server let go");
    const one = await projectSymbols("parse", { root, files: FILES, servers: [TS, PY], pool, found: () => true, limit: 1 });
    assert.deepEqual(one.symbols.map((s) => s.name), ["parse"], "as many as asked");
  });

  test("why none: no server for the project's files, none installed, one starting, one's problem, one that lists none; nothing typed asks nothing", async () => {
    const asks = (/** @type {Record<string, any>} */ answers, /** @type {any} */ o = {}, /** @type {any} */ more = {}) => projectSymbols("parse", { root, files: FILES, servers: [TS], pool: stubPool(answers, o).pool, found: () => true, ...more });
    const quiet = stubPool({ ts: [] });
    assert.deepEqual(await projectSymbols("  ", { root, files: FILES, servers: [TS], pool: quiet.pool }), { symbols: [], said: "" });
    assert.equal(quiet.log.asked.length, 0, "nothing asked");
    assert.equal((await asks({ ts: [] }, {}, { files: ["README.md"] })).said, "No language server here serves this project's files.");
    assert.equal(
      (await projectSymbols("parse", { root, files: FILES, servers: [entry("ts", { ".ts": "typescript" }, "npm i ts-ls")], pool: quiet.pool, found: () => false })).said,
      "No language server for .ts files is installed on this computer: ts-ls (npm i ts-ls). Filament runs the first it finds on the PATH.",
    );
    assert.equal((await asks({ ts: [] }, { fresh: true })).said, "ts has just started and is reading the project: its names come in a moment.");
    assert.equal((await asks({ ts: [] })).said, "", "a server that knows no such name says nothing more");
    assert.equal((await asks({ ts: Object.assign(new Error("modified"), { code: -32801 }) })).said, "ts has just started and is reading the project: its names come in a moment.");
    assert.equal((await asks({ ts: new Error("boom") })).said, "ts: boom.");
    assert.equal((await asks({}, { problem: "language server ts could not start (spawn ts-ls ENOENT)" })).said, "ts: language server ts could not start (spawn ts-ls ENOENT).");
    assert.equal((await asks({ ts: [] }, { caps: () => false })).said, "ts does not list a project's names.");
    // (the drive of 11-04 with pylsp, which lists none: "zzzz" read "pylsp does not list a project's names" where
    // TypeScript's server had searched and knew no such name)
    const two = (/** @type {any} */ o) => projectSymbols("zzzz", { root, files: FILES, servers: [TS, PY], pool: stubPool({ ts: [], py: [] }, o).pool, found: () => true });
    assert.equal((await two({ caps: (/** @type {string} */ n) => n === "ts" })).said, "", "one searched: no such name is all there is to say");
    assert.equal((await two({ caps: (/** @type {string} */ n) => n === "ts", fresh: true })).said, "ts has just started and is reading the project: its names come in a moment. py does not list a project's names.", "none could: each says why");
  });

  // (fails before: yes — the review of 11-04 on lsp-symbols: a file git still lists but gone from the disk lost every name
  // of its server, "ts: ENOENT…"; a request's timeout read "ts: ts: …")
  test("a file gone from the disk: the next is opened; none of them, said so; a request's own words name its server once", async () => {
    const answers = { ts: [{ name: "parseThing", kind: 12, location: { uri: uri("src/b.ts"), range: range(9, 0, 39, 1) } }] };
    const one = stubPool(answers, { gone: ["src/b.ts"] });
    const got = await projectSymbols("parse", { root, files: FILES, servers: [TS], pool: one.pool, found: () => true });
    assert.deepEqual([one.log.synced, got.symbols.map((s) => s.name)], [["src/d.ts"], ["parseThing"]]);
    const all = await projectSymbols("parse", { root, files: FILES, servers: [TS], pool: stubPool(answers, { gone: ["src/b.ts", "src/d.ts"] }).pool, found: () => true });
    assert.equal(all.said, `ts could open none of the project's files it was given: ENOENT: no such file or directory, stat '${join(root, "src/b.ts")}'.`);
    const late = await projectSymbols("parse", { root, files: FILES, servers: [TS], pool: stubPool({ ts: new Error("ts: workspace/symbol did not answer within 10 s") }).pool, found: () => true });
    assert.equal(late.said, "ts: workspace/symbol did not answer within 10 s.");
  });

  test("a real server: the project's names, a library's left out; the file it opened, the folder's top one", async () => {
    const dir = fresh("real");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "util.js"), "function helper() {}\nfunction other() {}\n");
    writeFileSync(join(dir, "app.js"), "helper();\n");
    const lib = join(fresh("lib"), "lib.js");
    writeFileSync(lib, "function otherLib() {}\n");
    const log = join(fresh("log"), "fake.log");
    const pool = createLspPool();
    try {
      const fake = /** @type {import("../src/adapters/lsp/servers.js").LspEntry} */ ({ name: "fake", from: "yours", on: true, spec: { name: "fake", command: process.execPath, args: [FAKE, `--log=${log}`], env: { FAKE_LSP_ELSEWHERE: lib }, languages: { ".js": "javascript" } } });
      const got = await projectSymbols("oth", { root: dir, files: ["app.js", "src/util.js"], servers: [fake], pool });
      assert.deepEqual(got, { symbols: [{ name: "other", kind: "function", container: "", path: "src/util.js", line: 2, end: 2 }], said: "" });
      const opened = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((l) => l.method === "textDocument/didOpen").map((l) => fileURLToPath(l.params.textDocument.uri));
      assert.deepEqual(opened.map((p) => relative(dir, p)), ["app.js"]);
      assert.deepEqual(pool.running().map((r) => r.held), [0], "let go");
    } finally {
      await pool.closeAll();
    }
  });
});

describe("GET /api/lsp/symbols, in a running Filament", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {string} */
  let root;
  before(async () => {
    root = fresh("app");
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "util.js"), "function helper() {}\nfunction other() {}\n");
    writeFileSync(join(root, "app.js"), "helper();\n");
    up = await fakeUpstream(async () => undefined);
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
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    await removeDirs(shim?.dataDir);
  });

  test("a chat's own servers answer, as its turns have them; a chat not held, a folder outside the roots, refused", async () => {
    const settings = { lsp: { servers: [{ name: "fake", command: process.execPath, args: [FAKE], extensionToLanguage: { ".js": "javascript" } }] } };
    const res = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings } });
    if (res.status !== 200) assert.fail(`HTTP ${res.status}: ${await res.text()}`);
    const id = String((await res.json()).id);
    const r = await shim.api(`/api/lsp/symbols?cwd=${encodeURIComponent(root)}&q=help&chain=${encodeURIComponent(id)}`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.deepEqual([body.symbols, body.said], [[{ name: "helper", kind: "function", container: "", path: "src/util.js", line: 1, end: 1 }], ""]);
    assert.equal((await shim.api(`/api/lsp/symbols?cwd=${encodeURIComponent(root)}&q=help&chain=nope`)).status, 404);
    // (fails before: yes — the review of 11-04 on lsp-symbols: a chat not started yet took your defaults' servers, its
    // project's own and their switches passed over)
    const set = await shim.api(`/api/projects/${projectIdOf(projectFolderOf(root))}/settings`, { method: "POST", body: { patch: settings } });
    if (set.status !== 200) assert.fail(`HTTP ${set.status}: ${await set.text()}`);
    const unstarted = await (await shim.api(`/api/lsp/symbols?cwd=${encodeURIComponent(root)}&q=oth`)).json();
    assert.deepEqual([unstarted.symbols, unstarted.said], [[{ name: "other", kind: "function", container: "", path: "src/util.js", line: 2, end: 2 }], ""], "a chat not started yet: its folder's project's servers");
    assert.equal((await shim.api(`/api/lsp/symbols?cwd=${encodeURIComponent(fresh("outside"))}&q=help&chain=${encodeURIComponent(id)}`)).status, 403);
  });
});

describe("the @# list, the chip, the file opened at its lines", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => {
    doc = stubDocument();
  });
  after(() => doc.restore());
  const labels = (/** @type {any} */ el) => /** @type {any[]} */ (el.querySelectorAll(".slash-label")).map((s) => s.textContent);
  const empty = (/** @type {any} */ el) => el.querySelector(".slash-empty")?.textContent;

  test("a name typed after @#: the project's names, a pick tagging the file with its lines; why none, in the servers' words", async () => {
    /** @type {string[]} */
    const put = [];
    const panel = createSlashPanel({ onInsert: (/** @type {string} */ t) => void put.push(t), getFolder: () => "H:\\p", getChain: () => "c1" });
    asked.length = 0;
    await panel.open("@", "#par");
    await settle();
    assert.deepEqual(asked, ["/api/lsp/symbols?cwd=H%3A%5Cp&q=par&chain=c1"], "names alone: no chat or file asked");
    assert.deepEqual(/** @type {any[]} */ (panel.el.querySelectorAll(".slash-section")).map((s) => s.textContent), ["Symbols"]);
    assert.deepEqual(labels(panel.el), ["parseThing", "Parser", "parsed"]);
    assert.deepEqual(/** @type {any[]} */ (panel.el.querySelectorAll(".slash-detail")).map((s) => s.textContent), ["function · src/b.ts:10", "class · lib/my file.ts:3", "variable in Parser · src/x.ts"]);
    // (fails before: yes — the drive of 11-04: the mark looked for "#par" in the names, and marked none)
    assert.deepEqual(/** @type {any[]} */ (panel.el.querySelectorAll(".slash-mark")).map((s) => s.textContent), ["par", "Par", "par"], "the name typed, marked in each");
    for (const i of [0, 1, 2]) {
      await panel.open("@", "#par");
      await settle();
      /** @type {any[]} */ (panel.el.querySelectorAll(".slash-row"))[i].dispatch("click");
    }
    assert.deepEqual(put, ["@src/b.ts#L10-40 ", '@"lib/my file.ts"#L3 ', "@src/x.ts "]);
    asked.length = 0;
    await panel.open("@", "#");
    await settle();
    assert.deepEqual([asked, empty(panel.el)], [[], "Type a name: the project's names its language servers know"]);
    await panel.open("@", "#zz");
    await settle();
    assert.equal(empty(panel.el), "ts has just started and is reading the project: its names come in a moment.");
    await panel.open("@", "#none");
    await settle();
    assert.equal(empty(panel.el), "No name like it in the project");
    // From files to names, the last list's rows go at once: none of them is picked while the servers answer.
    await panel.open("@", "par");
    await settle();
    assert.ok(labels(panel.el).includes("parse.js"), labels(panel.el).join(", "));
    const pending = panel.open("@", "#par");
    assert.deepEqual([panel.el.querySelectorAll(".slash-row").length, empty(panel.el)], [0, "Searching…"]);
    await pending;
    await settle();
    assert.deepEqual(labels(panel.el), ["parseThing", "Parser", "parsed"]);
    // (fails before: yes — the review of 11-04 on lsp-symbols: each key typed left its ask running, and a language server
    // answers one at a time, the newest last)
    const older = panel.open("@", "#pa");
    const newer = panel.open("@", "#pars");
    await Promise.all([older, newer]);
    await settle();
    const signalOf = (/** @type {string} */ q) => signals.get(`/api/lsp/symbols?cwd=H%3A%5Cp&q=${q}&chain=c1`);
    assert.deepEqual([signalOf("pa")?.aborted, signalOf("pars")?.aborted], [true, false], "a key typed stops the ask before it");
    panel.close();
    assert.equal(signalOf("pars")?.aborted, false, "one that landed stays as it was");
  });

  test("the bubble's chip of a file's tag with its lines opens the file at them", () => {
    assert.deepEqual(referenceChips("see @src/b.ts#L10-40 now").filter((p) => p.kind === "ref"), [{ kind: "ref", mark: "@", name: "src/b.ts#L10-40", file: "src/b.ts", range: "#L10-40" }]);
    /** @type {any[]} */
    const opened = [];
    const before = chipActions.open;
    chipActions.open = (/** @type {string} */ p, /** @type {string | undefined} */ r) => void opened.push([p, r]);
    try {
      const row = /** @type {any} */ (userRow({ n: 1, userText: "see @src/b.ts#L10-40 and @src/c.ts" }, { onCopy: () => {} }));
      for (const chip of /** @type {any[]} */ (row.querySelectorAll(".ref-chip.is-file"))) chip.dispatch("click", { stopPropagation() {} });
      assert.deepEqual(opened, [["src/b.ts", "#L10-40"], ["src/c.ts", ""]]);
    } finally {
      chipActions.open = before;
    }
  });

  test("a file's viewer scrolls to the lines asked and marks them: asked before it is drawn, while it stands, and of one that left the page", async () => {
    const d = /** @type {any} */ (globalThis.document);
    const proto = Object.getPrototypeOf(d.createElement("div"));
    const was = proto.scrollIntoView;
    /** @type {string[]} */
    const scrolled = [];
    proto.scrollIntoView = function () {
      scrolled.push(this.querySelector(".code-no")?.textContent ?? "");
    };
    try {
      const marked = (/** @type {any} */ el) => /** @type {any[]} */ (el.querySelectorAll(".code-line.is-marked")).map((r) => r.querySelector(".code-no")?.textContent);
      showLines("H:\\p", "notes.txt", "#L10-12");
      const viewer = d.createElement("div");
      d.body.append(viewer);
      renderCodeViewer(viewer, { path: "notes.txt", cwd: "H:\\p" });
      await settle();
      assert.deepEqual([marked(viewer), scrolled], [["10", "11", "12"], ["10"]]);
      showLines("H:\\p", "notes.txt", "#L30");
      assert.deepEqual([marked(viewer), scrolled.at(-1)], [["30"], "30"], "at once, where it stands");
      viewer.remove();
      showLines("H:\\p", "notes.txt", "#L5");
      assert.deepEqual(marked(viewer), ["30"], "a viewer that left the page takes none");
      const again = d.createElement("div");
      d.body.append(again);
      renderCodeViewer(again, { path: "notes.txt", cwd: "H:\\p" });
      await settle();
      assert.deepEqual([marked(again), scrolled.at(-1)], [["5"], "5"], "the one drawn in its place does");
      showLines("H:\\p", "README.md", "#L2");
      const md = d.createElement("div");
      d.body.append(md);
      renderCodeViewer(md, { path: "README.md", cwd: "H:\\p" });
      await settle();
      assert.deepEqual([md.querySelector(".md-file"), marked(md)], [null, ["2"]], "a markdown file shows its source, where its lines are");
      // (fails before: yes — the review of 11-04 on lsp-symbols: a viewer on the page but out of sight — its tab behind the
      // chat — took the lines and "scrolled" where nothing is laid out, and shown, stood at its top)
      const away = d.createElement("div");
      away.className = "hidden";
      d.body.append(away);
      renderCodeViewer(away, { path: "far.txt", cwd: "H:\\p" });
      await settle();
      const at = scrolled.length;
      showLines("H:\\p", "far.txt", "#L40");
      assert.deepEqual([marked(away), scrolled.length], [["40"], at], "marked, not scrolled while out of sight");
      away.className = "";
      refreshCodeViewer(away);
      await settle();
      assert.equal(scrolled.at(-1), "40", "scrolled to as it shows");
    } finally {
      proto.scrollIntoView = was;
    }
  });
});
