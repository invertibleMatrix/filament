// A language server for the tests (LSP over stdio, framed by byte length), as small as the client's needs: it knows a
// file's functions by `function <name>` and its problems by the words ERROR: and WARN: on a line. Definition, references,
// hover, a file's symbols and the workspace's; its problems published at each open and change, with the text's version —
// twice where the line TWICE stands (a syntax pass, then a fuller one) and late by FAKE_LSP_DIAG_MS. It asks the client
// for its configuration and a progress token once initialized, and writes what it was told of to FAKE_LSP_LOG, or the
// file its --log= argument names (one JSON line each, with the folder it serves as `at`). Its hover
// has characters of more than one byte, so a message's length is its bytes'. FAKE_LSP_CRASH=1 ends it at its first open.
// FAKE_LSP_LOWER_DRIVE=1 spells a drive in the addresses it sends as rust-analyzer does: `file:///c%3A/`.
// FAKE_LSP_ELSEWHERE names a file outside its folder it knows too, as a library's; FAKE_LSP_INIT_MS answers its
// initialize that late. Its log's initialize line names its process (`pid`).
import { appendFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const LOG = process.env.FAKE_LSP_LOG || process.argv.find((a) => a.startsWith("--log="))?.slice("--log=".length) || "";
const DIAG_MS = Number(process.env.FAKE_LSP_DIAG_MS || 0);
const ELSEWHERE = process.env.FAKE_LSP_ELSEWHERE || "";
const INIT_MS = Number(process.env.FAKE_LSP_INIT_MS || 0);
/** Each open file's version, by its address. @type {Map<string, number>} */
const versions = new Map();
/** An address as the server sends it. @param {string} uri */
const said = (uri) => (process.env.FAKE_LSP_LOWER_DRIVE === "1" ? uri.replace(/^file:\/\/\/([A-Za-z]):/, (_, d) => `file:///${d.toLowerCase()}%3A`) : uri);
/** @type {Map<string, string>} */
const docs = new Map();
let root = "";
const note = (/** @type {any} */ o) => LOG && appendFileSync(LOG, `${JSON.stringify({ ...o, at: root })}\n`);
let nextId = 1000;

const send = (/** @type {any} */ msg) => {
  const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...msg }), "utf8");
  process.stdout.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
};
const linesOf = (/** @type {string} */ text) => text.split(/\r?\n/);
const wordAt = (/** @type {string} */ text, /** @type {{ line: number, character: number }} */ p) => {
  const line = linesOf(text)[p.line] || "";
  let s = p.character;
  let e = p.character;
  while (s > 0 && /\w/.test(line[s - 1])) s--;
  while (e < line.length && /\w/.test(line[e])) e++;
  return line.slice(s, e);
};
const range = (/** @type {number} */ line, /** @type {number} */ start, /** @type {number} */ end) => ({ start: { line, character: start }, end: { line, character: end } });
/** Every file the server knows: those opened, then the .js files on disk in its folder and the folders in it. */
const known = () => {
  const out = new Map(docs);
  try {
    for (const f of readdirSync(root, { recursive: true }).map(String).filter((f) => !/(^|[\\/])(\.git|node_modules)([\\/]|$)/.test(f))) {
      const p = join(root, f);
      const uri = pathToFileURL(p).href;
      if (/\.js$/.test(f) && !out.has(uri) && statSync(p).isFile()) out.set(uri, readFileSync(p, "utf8"));
    }
    if (ELSEWHERE) out.set(pathToFileURL(ELSEWHERE).href, readFileSync(ELSEWHERE, "utf8"));
  } catch {}
  return out;
};
const functions = (/** @type {string} */ uri, /** @type {string} */ text) =>
  linesOf(text).flatMap((l, i) => {
    const m = /function (\w+)/.exec(l);
    return m ? [{ name: m[1], uri, line: i, start: m.index + 9, end: m.index + 9 + m[1].length, full: l.length }] : [];
  });
const publish = (/** @type {string} */ uri) => {
  const text = docs.get(uri) || "";
  const version = versions.get(uri);
  const all = linesOf(text).flatMap((l, i) => [
    ...(l.includes("ERROR:") ? [{ range: range(i, l.indexOf("ERROR:"), l.length), severity: 1, source: "fake", code: "E1", message: l.slice(l.indexOf("ERROR:") + 6).trim() }] : []),
    ...(l.includes("WARN:") ? [{ range: range(i, l.indexOf("WARN:"), l.length), severity: 2, source: "fake", message: l.slice(l.indexOf("WARN:") + 5).trim() }] : []),
  ]);
  const go = () => {
    if (text.includes("TWICE")) send({ method: "textDocument/publishDiagnostics", params: { uri: said(uri), version, diagnostics: [] } });
    setTimeout(() => send({ method: "textDocument/publishDiagnostics", params: { uri: said(uri), version, diagnostics: all } }), text.includes("TWICE") ? 50 : 0);
  };
  if (DIAG_MS) setTimeout(go, DIAG_MS);
  else go();
};

const handle = (/** @type {any} */ msg) => {
  const { id, method, params } = msg;
  if (method === undefined) return void note({ answer: msg.id, result: msg.result });
  if (method !== "initialize" && method !== "initialized") note({ method, params });
  if (method === "initialize") {
    root = fileURLToPath(params.rootUri);
    note({ method, root, folders: params.workspaceFolders, capabilities: !!params.capabilities?.textDocument?.publishDiagnostics, pid: process.pid });
    const answer = () => send({ id, result: { capabilities: { textDocumentSync: 1, definitionProvider: true, referencesProvider: true, hoverProvider: true, documentSymbolProvider: true, workspaceSymbolProvider: true }, serverInfo: { name: "fake-lsp" } } });
    return void (INIT_MS ? setTimeout(answer, INIT_MS) : answer());
  }
  if (method === "initialized") {
    send({ id: nextId++, method: "workspace/configuration", params: { items: [{ section: "fake.lint" }, { section: "other" }] } });
    send({ id: nextId++, method: "window/workDoneProgress/create", params: { token: "t1" } });
    return send({ id: nextId++, method: "workspace/applyEdit", params: { edit: {} } });
  }
  if (method === "textDocument/didOpen") {
    if (process.env.FAKE_LSP_CRASH === "1") process.exit(3);
    docs.set(params.textDocument.uri, params.textDocument.text);
    versions.set(params.textDocument.uri, params.textDocument.version);
    return publish(params.textDocument.uri);
  }
  if (method === "textDocument/didChange") {
    docs.set(params.textDocument.uri, params.contentChanges.at(-1).text);
    versions.set(params.textDocument.uri, params.textDocument.version);
    return publish(params.textDocument.uri);
  }
  if (method === "textDocument/didClose") {
    versions.delete(params.textDocument.uri);
    return void docs.delete(params.textDocument.uri);
  }
  if (method === "shutdown") return send({ id, result: null });
  if (method === "exit") return process.exit(0);
  const text = docs.get(params?.textDocument?.uri) || "";
  if (method === "textDocument/definition") {
    const w = wordAt(text, params.position);
    // FAKE_LSP_IMPORTS=1, as TypeScript's server answers: a name an `import { … }` line of the file brings leads, from
    // anywhere else in the file, to that import — a link, its target the name there; from the import, to its function.
    const imported = process.env.FAKE_LSP_IMPORTS === "1" ? linesOf(text).findIndex((l) => /^import \{/.test(l) && new RegExp(`\\b${w}\\b`).test(l)) : -1;
    if (w && imported >= 0 && imported !== params.position.line) {
      const at = linesOf(text)[imported].search(new RegExp(`\\b${w}\\b`));
      return send({ id, result: [{ originSelectionRange: range(params.position.line, params.position.character, params.position.character + w.length), targetUri: said(params.textDocument.uri), targetRange: range(imported, 0, linesOf(text)[imported].length), targetSelectionRange: range(imported, at, at + w.length) }] });
    }
    const f = [...known()].flatMap(([uri, t]) => functions(uri, t)).find((x) => x.name === w);
    return send({ id, result: f ? { uri: said(f.uri), range: range(f.line, f.start, f.end) } : null });
  }
  if (method === "textDocument/references") {
    const w = wordAt(text, params.position);
    const out = [...known()].flatMap(([uri, t]) => linesOf(t).flatMap((l, i) => [...l.matchAll(new RegExp(`\\b${w}\\b`, "g"))].map((m) => ({ uri: said(uri), range: range(i, m.index || 0, (m.index || 0) + w.length) }))));
    return send({ id, result: w ? out : [] });
  }
  if (method === "textDocument/hover") {
    const w = wordAt(text, params.position);
    return send({ id, result: w ? { contents: { kind: "markdown", value: `\`\`\`js\nfunction ${w}()\n\`\`\`\nIt does ${w} — café ✓` } } : null });
  }
  if (method === "textDocument/documentSymbol") {
    return send({ id, result: functions(params.textDocument.uri, text).map((f) => ({ name: f.name, kind: 12, range: range(f.line, 0, f.full), selectionRange: range(f.line, f.start, f.end), children: [] })) });
  }
  if (method === "workspace/symbol") {
    const q = String(params.query || "").toLowerCase();
    return send({ id, result: [...known()].flatMap(([uri, t]) => functions(uri, t)).filter((f) => f.name.toLowerCase().includes(q)).map((f) => ({ name: f.name, kind: 12, location: { uri: said(f.uri), range: range(f.line, f.start, f.end) } })) });
  }
  if (id !== undefined) send({ id, error: { code: -32601, message: `no ${method}` } });
};

let buf = Buffer.alloc(0);
process.stdin.on("data", (/** @type {Buffer} */ chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const head = buf.indexOf("\r\n\r\n");
    if (head < 0) return;
    const len = Number(/content-length:\s*(\d+)/i.exec(buf.subarray(0, head).toString())?.[1] || 0);
    if (buf.length < head + 4 + len) return;
    const body = buf.subarray(head + 4, head + 4 + len).toString("utf8");
    buf = buf.subarray(head + 4 + len);
    handle(JSON.parse(body));
  }
});
process.stdin.on("end", () => process.exit(0));
