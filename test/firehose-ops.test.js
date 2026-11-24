// W9: the three firehose producers — `search`, `engineop`, `tool` — recorded but hidden by default.
//
// These fire several times per request, so they are the noisy kinds: recorded, and shown only when their chip is
// enabled. Each is content-free by construction: a search query is user text (only its length survives), an engine
// operation's name is a fixed enum, and a tool call records the tool's name and who ran it, never its arguments or
// output. `stream` is deliberately NOT wired: the request record already carries ttft and totalMs and the Live tab
// shows in-flight requests, so a stream operation would only duplicate them — the hint in ops.js says so.
//
// A NEW file rather than an append, for the same reason as the other producers: appends have been silently reverted
// mid-run twice tonight.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryService } from "../src/memory-service.js";
import { McpToolServer } from "../src/mcp-server.js";
import { LocalHands } from "../src/local-hands.js";
import { WIRED_OP_KINDS, DEFAULT_OP_KINDS, NOISY_OP_KINDS } from "../src/ops.js";
import { createApp } from "../src/server.js";
import { defaultConfig } from "../src/config.js";

const FAKE = fileURLToPath(new URL("./fixtures/fake-sidecar.mjs", import.meta.url));

// Content that must never reach a durable operation: a remembered memory's text, a search query, a file path.
const CONTENT = "the user prefers PowerShell on this machine";
const QUERY = "where did I put the deployment checklist";
const FORBIDDEN = [CONTENT, QUERY];

let dir;
const services = [];
before(() => { dir = mkdtempSync(join(tmpdir(), "filament-firehose-")); });
after(async () => { for (const s of services) { try { await s.shutdown(); } catch {} } rmSync(dir, { recursive: true, force: true }); });

// A real MemoryService with the fake sidecar as its engine, so remember/recall produce real engine calls.
const svcWithEngine = () => {
  const prev = process.env.FILAMENT_MEMORY_SIDECAR;
  process.env.FILAMENT_MEMORY_SIDECAR = JSON.stringify({ command: process.execPath, args: [FAKE], env: {} });
  const s = new MemoryService({ getConfig: () => ({ memory: { enabled: true, folder: join(dir, "mem-" + Math.random().toString(36).slice(2, 8)) } }), dataDir: dir, log: () => {} });
  const seen = [];
  s.onEngineCallOp = (title, opts) => seen.push({ title, ...(opts || {}) });
  s.onSearchOp = (title, opts) => seen.push({ title, ...(opts || {}) });
  s.start();
  services.push(s);
  return { s, seen, restoreEnv: () => { if (prev === undefined) delete process.env.FILAMENT_MEMORY_SIDECAR; else process.env.FILAMENT_MEMORY_SIDECAR = prev; } };
};

test("engineop: every engine call is recorded, with the op name, the outcome and the duration — never the content", async () => {
  const { s, seen, restoreEnv } = svcWithEngine();
  try {
    await s.store.remember({ content: CONTENT, source: "environment", importance: 0.8 });
    await s.store.recall(QUERY, { topK: 3 });
    const ops = seen.filter((o) => o.detail && o.detail.op);
    assert.ok(ops.length >= 2, `remember and recall each produced an op: ${ops.map((o) => o.detail.op).join(", ")}`);
    const remember = ops.find((o) => o.detail.op === "remember");
    assert.ok(remember, "a remember call is recorded");
    assert.equal(remember.sub, "call");
    assert.equal(remember.detail.ok, true);
    assert.equal(typeof remember.ms, "number", "with a duration");
    assert.ok(remember.detail.cold === true || remember.detail.cold === undefined, "cold is only set when the engine had to start");
    const recall = ops.find((o) => o.detail.op === "recall");
    assert.ok(recall, "and a recall");
    const flat = JSON.stringify(seen);
    for (const bad of FORBIDDEN) assert.ok(!flat.includes(bad), `engine operations must not carry "${bad}" — they are content`);
  } finally { restoreEnv(); }
});

test("search: a memory search is recorded as a count and a length, never the query", async () => {
  const { s, seen, restoreEnv } = svcWithEngine();
  try {
    await s.store.remember({ content: CONTENT, source: "environment", importance: 0.8 });
    const hits = await s.scope({ role: "owner" }).search(QUERY, { limit: 5 });
    const op = seen.find((o) => o.sub === "search");
    assert.ok(op, "a search is recorded");
    assert.match(op.title, /memory search: \d+ hit/, "the title says how many hits, not what was asked");
    assert.equal(op.detail.queryChars, QUERY.length, "only the query's LENGTH survives — it is user text");
    assert.equal(typeof op.detail.hits, "number", "and the hit count is recorded");
    assert.ok(Array.isArray(hits), "the search itself still returns the hits");
    const flat = JSON.stringify(seen.filter((o) => o.sub === "search"));
    assert.ok(!flat.includes(QUERY), "the search op must not carry the query text");
  } finally { restoreEnv(); }
});

test("tool: a real tool call through the MCP dispatch path is recorded, with who ran it", async () => {
  const file = join(dir, "a-file.txt"); writeFileSync(file, "line one\nline two\nline three\n");
  const seen = [];
  const bridge = { contextForMcpToken: () => ({ conv: null, turn: null, cwd: dir, upstream: { id: "fake", acp: {} }, native: true }), hands: new LocalHands(), permitLocal: async () => {} };
  const mcp = new McpToolServer({ bridge, log: () => {} });
  mcp.onOp = (title, opts) => seen.push({ title, ...(opts || {}) });
  // A minimal stand-in for the HTTP response, capturing what the server writes.
  const out = { status: 0, body: "" };
  const res = { writeHead(s) { out.status = s; }, end(b) { out.body += b || ""; } };
  await mcp.handle({ method: "POST" }, res, "tok123", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "Read", arguments: { file_path: file } } }));
  assert.ok(out.body.includes("line one"), "the Read actually ran through Filament's hands");
  const op = seen.find((o) => o.sub === "tool");
  assert.ok(op, `the tool call is recorded: ${seen.map((o) => o.title).join(", ")}`);
  assert.equal(op.detail.tool, "Read");
  assert.equal(op.detail.ok, true);
  assert.equal(op.detail.via, "filament", "Filament's own hands ran it — there was no client tool");
  assert.ok(!JSON.stringify(seen).includes("line one"), "the tool's OUTPUT is not in the op");
  assert.ok(!JSON.stringify(seen).includes("a-file.txt"), "and neither is the path it read");
});

test("the firehose kinds are recorded but hidden by default, and a throwing recorder breaks nothing", async () => {
  // The user's standing choice: record everything, default-hide the noisy. These three are wired (a chip you can turn
  // on) but not in the default view (they fire several times a request).
  for (const k of ["search", "engineop", "tool"]) {
    assert.ok(WIRED_OP_KINDS.includes(k), `${k} is wired, so its chip is not dimmed`);
    assert.ok(NOISY_OP_KINDS.includes(k), `and noisy, so it is hidden until you ask for it`);
    assert.ok(!DEFAULT_OP_KINDS.includes(k), `so it does not crowd the default view`);
  }
  assert.ok(!WIRED_OP_KINDS.includes("stream"), "stream stays unwired — the request record already carries it");

  // A throwing recorder must not break the tool call it is observing. Drive a real Read with one attached.
  const file = join(dir, "throwing.txt"); writeFileSync(file, "still readable");
  const mcp = new McpToolServer({ bridge: { contextForMcpToken: () => ({ conv: null, turn: null, cwd: dir, upstream: { id: "fake", acp: {} }, native: true }), hands: new LocalHands(), permitLocal: async () => {} }, log: () => {} });
  mcp.onOp = () => { throw new Error("disk on fire"); };
  const out = { status: 0, body: "" }; const res = { writeHead(s) { out.status = s; }, end(b) { out.body += b || ""; } };
  await mcp.handle({ method: "POST" }, res, "tok", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "Read", arguments: { file_path: file } } }));
  assert.ok(out.body.includes("still readable"), "the Read still answers even though the recorder threw");
});

// ------------------------------------------------------------------ through the server
let app, port, srvDir;
before(async () => {
  srvDir = mkdtempSync(join(tmpdir(), "filament-firehose-srv-"));
  const cfg = defaultConfig(); cfg.server.port = 0; cfg.server.loopbackTrust = "legacy"; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = "";
  writeFileSync(join(srvDir, "config.json"), JSON.stringify(cfg));
  app = createApp({ dataDir: srvDir, overrides: { port: 0 } }); port = (await app.start()).port;
});
after(async () => { await app.stop(); rmSync(srvDir, { recursive: true, force: true }); });

test("the server injects all three firehose recorders, and each lands through /api/ops", async () => {
  assert.equal(typeof app.memory.onSearchOp, "function", "search recorder injected");
  assert.equal(typeof app.memory.onEngineCallOp, "function", "engineop recorder injected");
  assert.equal(typeof app.mcp.onOp, "function", "tool recorder injected");

  app.memory.onSearchOp("memory search: 2 hit(s)", { sub: "search", detail: { hits: 2, queryChars: 42 } });
  app.memory.onEngineCallOp("engine recall ok", { sub: "call", ms: 5, detail: { op: "recall", ok: true } });
  app.mcp.onOp("tools/call Read ok via Filament", { sub: "tool", detail: { method: "tools/call", tool: "Read", ok: true, via: "filament" } });
  await new Promise((r) => setTimeout(r, 80));
  for (const [kind, needle] of [["search", "2 hit"], ["engineop", "recall"], ["tool", "Read"]]) {
    const j = await (await fetch(`http://127.0.0.1:${port}/api/ops?limit=50&kinds=${kind}`, { headers: { "content-type": "application/json", "x-api-key": "k" } })).json();
    assert.ok((j.ops || []).some((o) => o.kind === kind && JSON.stringify(o).includes(needle)), `the ${kind} op is retrievable`);
    assert.ok((j.wired || []).includes(kind), `and ${kind} is declared wired`);
  }
  await app.ops.flush();
  const onDisk = existsSync(join(srvDir, "ops.jsonl")) ? readFileSync(join(srvDir, "ops.jsonl"), "utf8") : "";
  for (const k of ["search", "engineop", "tool"]) assert.ok(onDisk.includes(`"kind":"${k}"`), `the ${k} op persists`);
});
