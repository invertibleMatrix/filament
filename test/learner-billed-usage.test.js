// Learner ops carry BILLED tokens when the model reports them (W9 follow-up). The start op keeps estTokens — a
// prompt-size estimate made before any call exists — but the end op used to stop there, so a learning run's real
// cost was nowhere. callModel gained an opt-in `includeUsage` return ({ text, usage }); string callers (trim slices,
// recall rewrites, every test stub) are untouched, and a route that reports no usage yields ABSENT fields — never a
// fabricated zero that would read as real.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Archive } from "../src/archive.js";
import { MemoryLearner } from "../src/memory-learn.js";
import { MemoryBrain } from "../src/services/memory/brain.js";
import { createApp } from "../src/server.js";
import { defaultConfig } from "../src/config.js";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE_SIDECAR = join(here, "fixtures", "fake-sidecar.mjs");
const fakeStore = () => { const mem = []; return { mem, async remember(o) { mem.push(o); return { id: `m${mem.length}` }; }, async recall() { return []; } }; };
const MODEL_JSON = JSON.stringify({ title: "T", state: { summary: "S" }, turns: [{ n: 1, summary: "x" }], items: [{ kind: "rule", text: "do the thing properly", importance: 0.8, turn: 1 }] });

const seed = (a) => {
  const ch = a.chainForKey("k1", { cwd: "C:\\filament", client: "claude-code", model: "m" });
  const t1 = a.beginTurn(ch.id, { requestId: "r1", userMessage: { role: "user", content: "fix the login page crash" } });
  a.finishTurn(t1.turnId, { finalMessage: { role: "assistant", content: "Guarded the null user object." }, requestId: "r1", outputChars: 30 });
  return ch;
};
const collect = (learner) => { const seen = []; learner.onOp = (title, opts) => seen.push({ title, ...(opts || {}) }); return seen; };
const mk = (callModel) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-billed-"));
  const a = new Archive({ file: join(dir, "a.db") });
  const learner = new MemoryLearner({ archive: a, brain: new MemoryBrain({ archive: a, store: fakeStore() }), callModel, getConfig: () => ({ capture: { learn: true, idleMinutes: 30, dailyCap: 200 } }), log: () => {} });
  return { dir, a, learner, ops: collect(learner) };
};

test("a learn run whose model reports usage records BILLED tokens on the end op, estimates only on the start op", async () => {
  const { dir, a, learner, ops } = mk(async () => ({ text: MODEL_JSON, usage: { input: 1234, output: 56 } }));
  try {
    const ch = seed(a);
    const out = await learner.learnChain(ch.id, { reason: "idle" });
    assert.ok(!out.skipped && !out.error, `the run completed: ${JSON.stringify(out)}`);
    const start = ops.find((o) => o.sub === "start");
    const end = ops.find((o) => o.sub === "done");
    assert.ok(start.detail.estTokens > 0, "the start op still estimates the prompt size");
    assert.ok(start.detail.tokensIn == null, "and does not pretend to know the bill yet");
    assert.equal(end.detail.tokensIn, 1234, "the end op carries the billed input tokens");
    assert.equal(end.detail.tokensOut, 56, "and the billed output tokens");
    assert.ok(end.detail.estTokens == null, "no estimate once the real numbers exist — the two must never share a row");
  } finally { a.close(); for (let i = 0; i < 10; i++) { try { rmSync(dir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 150)); } } }
});

test("a string-returning callModel (every existing stub) leaves the billed fields ABSENT, not zero", async () => {
  const { dir, a, learner, ops } = mk(async () => MODEL_JSON);
  try {
    const ch = seed(a);
    await learner.learnChain(ch.id, { reason: "idle" });
    const end = ops.find((o) => o.sub === "done");
    assert.ok(end, "the run completed on the string path");
    assert.ok(!("tokensIn" in end.detail) && !("tokensOut" in end.detail), "no fabricated zeros");
  } finally { a.close(); for (let i = 0; i < 10; i++) { try { rmSync(dir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 150)); } } }
});

test("a run read in passes sums the billed totals of every call it made, a retry included (HarnessV3-Memory M7-D28)", async () => {
  let n = 0;
  const { dir, a, learner, ops } = mk(async () => { n++; return { text: n === 1 ? "not json" : MODEL_JSON, usage: { input: 100, output: 10 } }; });
  try {
    const ch = a.chainForKey("k-long", { cwd: "C:\\filament", client: "claude-code", model: "m" });
    // Each turn keeps 24,000 characters of itself, both ends: two of them are more than one pass holds.
    for (let i = 1; i <= 2; i++) {
      const t = a.beginTurn(ch.id, { requestId: `r${i}`, userMessage: { role: "user", content: `step ${i}` } });
      a.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: `done ${i} ${"x".repeat(30000)}` }, requestId: `r${i}` });
    }
    const out = await learner.learnChain(ch.id, { reason: "idle" });
    assert.equal(out.passes, 2, JSON.stringify(out));
    assert.equal(n, 3, "the first pass's unparseable answer caused the one retry, the second pass one call");
    const end = ops.find((o) => o.sub === "done");
    assert.deepEqual([end.detail.tokensIn, end.detail.tokensOut, end.detail.modelCalls], [300, 30, 3], "every call is summed");
  } finally { a.close(); for (let i = 0; i < 10; i++) { try { rmSync(dir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 150)); } } }
});

// ---- the wire shape, through a real Filament: includeUsage returns { text, usage }, the default returns a string ---
let up, app, port, dataDir;
const H = { "content-type": "application/json", "x-api-key": "k" };
before(async () => {
  up = http.createServer((req, res) => {
    let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "msg_x", type: "message", role: "assistant", model: "cheap-1", content: [{ type: "text", text: "a summary" }], stop_reason: "end_turn", usage: { input_tokens: 321, output_tokens: 45 } }));
    });
  });
  await new Promise((r) => up.listen(0, "127.0.0.1", r));
  dataDir = mkdtempSync(join(tmpdir(), "filament-billed-e2e-"));
  const stateFile = join(dataDir, "fake-engine-state.json"); writeFileSync(stateFile, JSON.stringify({ memories: [], canonical: [], seq: 1 }));
  process.env.FILAMENT_MEMORY_SIDECAR = JSON.stringify({ command: process.execPath, args: [FAKE_SIDECAR], env: { FAKE_SIDECAR_STATE: stateFile } });
  const cfg = defaultConfig(); cfg.server.port = 0; cfg.server.loopbackTrust = "legacy"; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = "";
  cfg.upstreams = [{ id: "u", name: "u", type: "anthropic-compatible", baseUrl: `http://127.0.0.1:${up.address().port}`, apiKey: "s", pricing: { "cheap-1": { input: 1, output: 1, contextTokens: 6000 } } }];
  cfg.routes = [{ match: "cheap-*", upstream: "u", upstreamModel: "{model}" }];
  cfg.memory = { enabled: true, folder: join(dataDir, "mem"), models: { summarizer: "cheap-1" }, autopilot: { enabled: false }, capture: { turns: true, learn: false }, privacy: { encryptArchive: true } };
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
  app = createApp({ dataDir, overrides: { port: 0 } }); port = (await app.start()).port;
});
after(async () => {
  try { if (app) await app.stop(); } catch {}
  try { up?.close(); } catch {}
  delete process.env.FILAMENT_MEMORY_SIDECAR;
  for (let i = 0; i < 10; i++) { try { rmSync(dataDir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
});

test("callModel on the wire: includeUsage returns text + the billed usage, the default returns a bare string", async () => {
  const plain = await app.memory.callModel({ system: "s", user: "u" });
  assert.equal(typeof plain, "string", "the default shape is unchanged");
  const withUsage = await app.memory.callModel({ system: "s", user: "u", includeUsage: true });
  assert.equal(withUsage.text, "a summary");
  assert.deepEqual(withUsage.usage, { input: 321, output: 45 }, "the upstream's usage, not an estimate");
});

// (fails before: yes — a call the front door asked again (M7-D69) counted as one in the run's model calls)
test("a call the front door asked again counts as two in the run's model calls", async () => {
  const { dir, a, learner, ops } = mk(async () => ({ text: MODEL_JSON, usage: { input: 100, output: 10 }, calls: 2 }));
  try {
    await learner.learnChain(seed(a).id, { reason: "idle" });
    const end = ops.find((o) => o.sub === "done");
    assert.deepEqual([end.detail.tokensIn, end.detail.tokensOut, end.detail.modelCalls], [100, 10, 2]);
  } finally { a.close(); for (let i = 0; i < 10; i++) { try { rmSync(dir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 150)); } } }
});
