// @ts-check
// A language server over stdio (src/adapters/lsp/client.js; the owner's of 11-04: agents get definition, references,
// hover and symbols, and an edit's errors): messages framed by their bytes, a server's requests answered as an editor
// with no settings answers them, a folder's files opened and sent again where they changed, their problems waited on
// past a change, and the server stopped as the protocol has it — or seen gone.
// (fails before: yes — Filament spoke no LSP: there was no client)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { frameMessage, frameReader, pathOfUri, startLsp, uriOf } from "../src/adapters/lsp/client.js";
import { removeDirs, until } from "./helpers/wait.js";

const FAKE = fileURLToPath(new URL("./fixtures/fake-lsp.mjs", import.meta.url));
/** The fake server's spec, its log and its knobs in its environment. @param {string} log @param {Record<string, string>} [env] */
const specOf = (log, env = {}) => ({ name: "fake", command: process.execPath, args: [FAKE], env: { FAKE_LSP_LOG: log, ...env }, languages: { ".js": "javascript" }, settings: { "fake.lint": { on: true } } });
/** What the fake server was told and answered, in order. @param {string} log */
const told = (log) => {
  try {
    return readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};

describe("messages framed by their bytes", () => {
  test("a message split anywhere, a character's bytes too, waits for the rest; two in one chunk are two", () => {
    const msg = { jsonrpc: "2.0", id: 1, result: { text: "café ✓ — naïve" } };
    const wire = Buffer.concat([frameMessage(msg), frameMessage({ jsonrpc: "2.0", method: "x" })]);
    assert.equal(Number(/Content-Length: (\d+)/.exec(wire.toString())?.[1]), Buffer.byteLength(JSON.stringify(msg)), "its length is its bytes'");
    for (let cut = 1; cut < wire.length; cut++) {
      /** @type {any[]} */
      const got = [];
      const read = frameReader((m) => got.push(m));
      read(wire.subarray(0, cut));
      read(wire.subarray(cut));
      assert.deepEqual(got, [msg, { jsonrpc: "2.0", method: "x" }], `cut at ${cut}`);
    }
  });

  test("a header with no length is passed over; one past what any server sends ends the stream", () => {
    /** @type {any[]} */
    const got = [];
    /** @type {string[]} */
    const broke = [];
    const read = frameReader((m) => got.push(m), (why) => broke.push(why));
    read(Buffer.concat([Buffer.from("X-Odd: 1\r\n\r\n"), frameMessage({ id: 2 })]));
    read(Buffer.from("Content-Length: 99999999999\r\n\r\n"));
    read(frameMessage({ id: 3 }));
    assert.deepEqual([got, broke], [[{ id: 2 }], ["a message of 99999999999 bytes"]]);
  });

  test("a file's address and back", () => {
    const p = join(tmpdir(), "a b", "c#d.js");
    assert.equal(pathOfUri(uriOf(p)), p);
    assert.equal(pathOfUri("untitled:Untitled-1"), null);
  });
});

describe("a server in a folder", () => {
  /** @type {string} */
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-lsp-client-"));
    writeFileSync(join(dir, "lib.js"), "function helper() {}\nfunction other() {}\n");
    writeFileSync(join(dir, "app.js"), "helper();\nconst x = 1; // ERROR: x is never read\n// WARN: a long line\n");
  });
  after(() => removeDirs(dir));

  test("initialized in the folder; its requests answered: configuration from the spec's settings, progress taken, an edit refused", async () => {
    const log = join(dir, "init.log");
    const s = await startLsp(specOf(log), { root: dir });
    try {
      assert.equal(s.capabilities.definitionProvider, true);
      await until(() => told(log).filter((t) => "answer" in t).length === 3, "its three requests answered");
      const t = told(log);
      assert.deepEqual([t[0].root, t[0].folders, t[0].capabilities], [dir, [{ uri: uriOf(dir), name: dir.split(/[\\/]/).at(-1) }], true]);
      assert.deepEqual(t.filter((x) => "answer" in x).map((x) => x.result), [[{ on: true }, null], null, { applied: false, failureReason: "Filament's agents change files with their own tools" }]);
    } finally {
      await s.close();
    }
  });

  test("a file opened as it is asked of, its problems waited on past the mark; changed on disk, sent again whole; asked again unchanged, not sent", async () => {
    const log = join(dir, "sync.log");
    const s = await startLsp(specOf(log), { root: dir });
    try {
      const first = s.sync("app.js");
      assert.equal(first.uri, uriOf(join(dir, "app.js")));
      const found = await s.diagnostics("app.js", { after: first.mark });
      assert.deepEqual(found?.map((d) => [d.severity, d.message, d.range.start.line]), [[1, "x is never read", 1], [2, "a long line", 2]]);
      writeFileSync(join(dir, "app.js"), "helper();\n");
      const again = s.sync("app.js");
      assert.deepEqual(await s.diagnostics("app.js", { after: again.mark }), [], "its problems as they stand now");
      const t0 = Date.now();
      assert.deepEqual(await s.diagnostics("app.js", { after: s.sync("app.js").mark }), [], "unchanged: what it said of the text last sent");
      assert.ok(Date.now() - t0 < 250, `at once, as it has been quiet since (${Date.now() - t0} ms)`);
      const sent = told(log).filter((t) => /^textDocument\/did/.test(t.method));
      assert.deepEqual(sent.map((t) => [t.method, t.params.textDocument.version, t.params.textDocument.languageId ?? null]), [["textDocument/didOpen", 1, "javascript"], ["textDocument/didChange", 2, null]], "unchanged, nothing sent");
      assert.equal(sent[1].params.contentChanges[0].text, "helper();\n", "whole");
    } finally {
      await s.close();
      writeFileSync(join(dir, "app.js"), "helper();\nconst x = 1; // ERROR: x is never read\n// WARN: a long line\n");
    }
  });

  // (fails before: on Windows — rust-analyzer says `file:///c%3A/` of the file opened as `file:///C:/`, and its problems
  // were kept as another file's)
  test("a server that spells the drive its own way: the file's problems are still its own", async () => {
    const s = await startLsp(specOf(join(dir, "drive.log"), { FAKE_LSP_LOWER_DRIVE: "1" }), { root: dir });
    try {
      const { mark } = s.sync("app.js");
      const found = await s.diagnostics("app.js", { after: mark, waitMs: 5000 });
      assert.deepEqual(found?.map((d) => d.message), ["x is never read", "a long line"]);
      assert.equal((await s.diagnostics("app.js", { after: s.sync("app.js").mark, waitMs: 1000 }))?.length, 2, "asked again: the same file");
    } finally {
      await s.close();
    }
  });

  // (fails before: a word the server said of the text before the last one counted as the last one's)
  test("what the server says of an older text than the one last sent is not the file's problems", async () => {
    writeFileSync(join(dir, "older.js"), "// ERROR: the first text\n");
    const s = await startLsp(specOf(join(dir, "older.log"), { FAKE_LSP_DIAG_MS: "300" }), { root: dir });
    try {
      s.sync("older.js");
      await new Promise((r) => setTimeout(r, 100));
      writeFileSync(join(dir, "older.js"), "// ERROR: the second, longer text\n");
      const { mark } = s.sync("older.js");
      assert.deepEqual((await s.diagnostics("older.js", { after: mark, waitMs: 5000, settleMs: 0 }))?.map((d) => d.message), ["the second, longer text"]);
    } finally {
      await s.close();
    }
  });

  // (fails before: a file opened once kept the text it was opened with, though it changed on disk or went, for as long
  // as the server ran — and on Windows two spellings of one file opened as two)
  test("every file open with the server goes again where it changed on disk, one gone is closed; a file in any case is one", async () => {
    const log = join(dir, "others.log");
    writeFileSync(join(dir, "other.js"), "function first() {}\n");
    writeFileSync(join(dir, "gone.js"), "function gone() {}\n");
    const s = await startLsp(specOf(log), { root: dir });
    try {
      s.sync("other.js");
      s.sync("gone.js");
      writeFileSync(join(dir, "other.js"), "// one more line\nfunction first() {}\n");
      rmSync(join(dir, "gone.js"));
      s.sync("app.js");
      s.sync("app.js");
      if (process.platform === "win32") s.sync("APP.js");
      await s.request("workspace/symbol", { query: "" });
      const sent = told(log).filter((t) => /^textDocument\/did/.test(t.method)).map((t) => [t.method, t.params.textDocument.uri.split("/").at(-1), t.params.textDocument.version ?? null]);
      assert.deepEqual(sent, [["textDocument/didOpen", "other.js", 1], ["textDocument/didOpen", "gone.js", 1], ["textDocument/didChange", "other.js", 2], ["textDocument/didClose", "gone.js", null], ["textDocument/didOpen", "app.js", 1]]);
    } finally {
      await s.close();
    }
  });

  test("definition, references, hover with characters of more than one byte, a file's symbols, the workspace's", async () => {
    const s = await startLsp(specOf(join(dir, "ask.log")), { root: dir });
    try {
      const { uri } = s.sync("app.js");
      s.sync("lib.js");
      const at = { textDocument: { uri }, position: { line: 0, character: 2 } };
      const def = await s.request("textDocument/definition", at);
      assert.deepEqual([pathOfUri(def.uri), def.range.start], [join(dir, "lib.js"), { line: 0, character: 9 }]);
      const refs = await s.request("textDocument/references", { ...at, context: { includeDeclaration: true } });
      assert.deepEqual(refs.map((/** @type {any} */ r) => pathOfUri(r.uri)).sort(), [join(dir, "app.js"), join(dir, "lib.js")]);
      const hover = await s.request("textDocument/hover", at);
      assert.match(hover.contents.value, /It does helper — café ✓$/);
      const syms = await s.request("textDocument/documentSymbol", { textDocument: { uri: uriOf(join(dir, "lib.js")) } });
      assert.deepEqual(syms.map((/** @type {any} */ x) => x.name), ["helper", "other"]);
      const ws = await s.request("workspace/symbol", { query: "oth" });
      assert.deepEqual(ws.map((/** @type {any} */ x) => x.name), ["other"]);
      await assert.rejects(s.request("textDocument/rename", at), /no textDocument\/rename/);
    } finally {
      await s.close();
    }
  });

  test("a server that speaks twice of one change is waited for; one that says nothing in time is null; a stop ends the wait", async () => {
    writeFileSync(join(dir, "twice.js"), "// TWICE\nlet y; // ERROR: y is never read\n");
    const s = await startLsp(specOf(join(dir, "twice.log")), { root: dir });
    try {
      const { mark } = s.sync("twice.js");
      assert.deepEqual((await s.diagnostics("twice.js", { after: mark }))?.map((d) => d.message), ["y is never read"], "its fuller word, not its first");
    } finally {
      await s.close();
    }
    const slow = await startLsp(specOf(join(dir, "slow.log"), { FAKE_LSP_DIAG_MS: "800" }), { root: dir });
    try {
      const { mark } = slow.sync("app.js");
      const t0 = Date.now();
      assert.equal(await slow.diagnostics("app.js", { after: mark, waitMs: 150 }), null);
      assert.ok(Date.now() - t0 < 700, "not past its time");
      const stop = new AbortController();
      setTimeout(() => stop.abort(), 20);
      assert.equal(await slow.diagnostics("app.js", { after: mark, waitMs: 5000, signal: stop.signal }), null);
      assert.equal((await slow.diagnostics("app.js", { after: mark, waitMs: 5000 }))?.length, 2, "late, it is heard");
    } finally {
      await slow.close();
    }
  });

  test("stopped as the protocol has it; a server that ends is seen gone: its waits and requests end, said", async () => {
    const log = join(dir, "close.log");
    const s = await startLsp(specOf(log), { root: dir });
    await s.close();
    assert.equal(s.alive(), false);
    assert.deepEqual(told(log).filter((t) => t.method === "shutdown" || t.method === "exit").map((t) => t.method), ["shutdown", "exit"]);
    const crash = await startLsp(specOf(join(dir, "crash.log"), { FAKE_LSP_CRASH: "1" }), { root: dir });
    /** @type {string[]} */
    const why = [];
    crash.onExit((w) => why.push(w));
    const { mark } = crash.sync("app.js");
    assert.equal(await crash.diagnostics("app.js", { after: mark, waitMs: 5000 }), null);
    await until(() => why.length > 0, "its end heard");
    assert.match(why[0], /^exited \(code 3\)/);
    assert.equal(crash.alive(), false);
    await assert.rejects(crash.request("workspace/symbol", { query: "" }), /language server fake exited \(code 3\)/);
    assert.throws(() => crash.sync("lib.js"), /language server fake exited/);
    await crash.close();
  });

  test("a program that does not start is said in Node's words", async () => {
    await assert.rejects(startLsp({ name: "nope", command: join(dir, "no-such-server.exe"), languages: {} }, { root: dir }), /language server nope could not start/);
  });
});
