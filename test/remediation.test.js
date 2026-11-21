import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/config.js";
import { createAnthropicToOpenaiStream } from "../src/translate.js";
import { forwardRequest } from "../src/proxy.js";
import { Archive } from "../src/archive.js";
import { runHand } from "../src/hands.js";
import { SHELL } from "../src/adapters/tools/shell.js";

// Regression pins for the W1 remediation batch (see vault: Remediation Plan.md).

test("1.16 a translated OpenAI stream always terminates with [DONE], even when the upstream dies mid-message", () => {
  const s = createAnthropicToOpenaiStream({ model: "m" });
  let out = s.push(`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "msg_1", usage: { input_tokens: 5 } } })}\n\n`);
  out += s.push(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } })}\n\n`);
  // message_delta arrives (finish reason + usage) but message_stop never does: the upstream died
  out += s.push(`event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } })}\n\n`);
  out += s.end();
  assert.match(out, /data: \[DONE\]\n\n$/, "strict SSE consumers need the terminator");
  // and a clean stream still emits exactly one [DONE]
  const c = createAnthropicToOpenaiStream({ model: "m" });
  let o2 = c.push(`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "m2", usage: {} } })}\n\n`);
  o2 += c.push(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
  o2 += c.end();
  assert.equal(o2.split("[DONE]").length - 1, 1, "exactly one terminator");
});

/** Real time passing, a few event-loop turns at a time: the sockets' work, while the test's clock is mocked. @param {number} ms */
const breathe = async (ms) => {
  const end = performance.now() + ms;
  while (performance.now() < end) await new Promise((r) => setImmediate(r));
};

// (fails before: yes — the head was waited for `upstream.timeoutMs` (600 s unset) and then cut: HarnessV3-FailurePoints
// FP-D1)
test("1.14 a provider's head is waited for however long it takes; its caller's signal ends the wait", async (t) => {
  /** @type {http.ServerResponse[]} */
  const held = [];
  let heard = () => {};
  const next = () => new Promise((r) => (heard = () => r(undefined)));
  const slow = http.createServer((req, res) => { req.resume(); req.on("end", () => { held.push(res); heard(); }); });
  await new Promise((r) => slow.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${slow.address().port}/`;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let came = next();
    let settled = false;
    const a = forwardRequest({ url, headers: {}, bodyString: "{}" }).finally(() => (settled = true));
    await came;
    t.mock.timers.tick(11 * 60_000); // eleven minutes with no head
    await breathe(50);
    assert.equal(settled, false, "a head slow to come is waited for");
    held[0].writeHead(200, { "content-type": "application/json" });
    held[0].end('{"ok":true}');
    const got = await a;
    assert.equal(got.res.status, 200);
    assert.equal(await got.res.text(), '{"ok":true}');
    got.cleanup();
    const stop = new AbortController();
    came = next();
    const b = forwardRequest({ url, headers: {}, bodyString: "{}", signal: stop.signal });
    await came;
    stop.abort();
    await assert.rejects(b, /abort/i);
  } finally {
    for (const res of held) if (!res.writableEnded) res.end();
    slow.closeAllConnections?.();
    slow.close();
  }
});

test("1.15 deleting a chain or project purges its FTS rows (the index must not grow forever)", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-fts-"));
  const a = new Archive({ file: join(dir, "a.db") });
  const ch = a.chainForKey("fts-1", { cwd: "C:\\proj" });
  const t = a.beginTurn(ch.id, { requestId: "r1", userMessage: { role: "user", content: "searchable flux capacitor text" } });
  a.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: "done" }, requestId: "r1", outputChars: 4 });
  const count = (id) => a.db.prepare("SELECT COUNT(*) AS n FROM fts_text WHERE chain_id = ?").get(id).n;
  assert.ok(count(ch.id) >= 1, "the turn was indexed");
  assert.ok(a.searchInputs("flux capacitor", { limit: 5 }).length >= 1, "and is searchable");
  a.deleteChain(ch.id);
  assert.equal(count(ch.id), 0, "deleteChain purged the FTS rows");
  // project delete too
  const ch2 = a.chainForKey("fts-2", { cwd: "C:\\proj" });
  const t2 = a.beginTurn(ch2.id, { requestId: "r2", userMessage: { role: "user", content: "another searchable line" } });
  a.finishTurn(t2.turnId, { finalMessage: { role: "assistant", content: "ok" }, requestId: "r2", outputChars: 2 });
  assert.ok(count(ch2.id) >= 1);
  a.deleteProject(ch2.project_id);
  assert.equal(count(ch2.id), 0, "deleteProject purged them as well");
  a.close(); rmSync(dir, { recursive: true, force: true });
});

test("1.2 the bash hand does not inherit Filament's secrets from the process environment", async () => {
  const root = mkdtempSync(join(tmpdir(), "filament-env-"));
  const secret = "SENTINEL-VALUE-9f3k2";
  process.env.OPENAI_API_KEY = secret;
  process.env.FILAMENT_TEST_TOKEN = secret;
  process.env.FILAMENT_HANDS_CUSTOM = "visible";
  try {
    const dump = SHELL.kind === "cmd" ? "set" : "env";
    const out = await runHand("bash", { command: dump }, { root });
    assert.ok(!out.includes(secret), "no secret-shaped variable reached the worker's shell");
    assert.ok(/PATH/i.test(out), "the shell still has a usable PATH");
    // the filter is an allowlist, not a denylist: anything not explicitly needed is dropped
    assert.ok(!out.includes("FILAMENT_HANDS_CUSTOM"), "arbitrary variables are not inherited (allowlist)");
    assert.ok(!out.includes("OPENAI_API_KEY"), "provider key names do not even appear");
  } finally {
    delete process.env.OPENAI_API_KEY; delete process.env.FILAMENT_TEST_TOKEN; delete process.env.FILAMENT_HANDS_CUSTOM;
    rmSync(root, { recursive: true, force: true });
  }
});

test("1.13 bash spill files are cleaned up after the call, not left in the temp dir forever", async () => {
  const root = mkdtempSync(join(tmpdir(), "filament-spill-"));
  const line = "a".repeat(60);
  // force a spill: well over the 50 KB visible window
  const cmd = SHELL.kind === "cmd"
    ? `for /L %i in (1,1,20000) do @echo ${line}`
    : `i=0; while [ $i -lt 20000 ]; do echo ${line}; i=$((i+1)); done`;
  const out = await runHand("bash", { command: cmd, timeout: 120 }, { root, spillTtlMs: 300 });
  assert.match(out, /Full output/, `the notice points at the spill file (got ${out.length} chars, tail: ${out.slice(-160)})`);
  const named = /Full output[^:]*: (\S+)/.exec(out)[1];
  assert.ok(existsSync(named), "the spill file exists while the result is in hand");
  await new Promise((r) => setTimeout(r, 700)); // the injected 300 ms sweeper removes it
  assert.ok(!existsSync(named), "and is swept afterwards");
  rmSync(root, { recursive: true, force: true });
});

test("1.8 the grep fallback cannot be handed an unbounded pattern (ReDoS guard)", async () => {
  const root = mkdtempSync(join(tmpdir(), "filament-redos-"));
  writeFileSync(join(root, "a.txt"), "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab\n");
  const evil = "(a+)+b".repeat(100); // a catastrophic-backtracking pattern, and far too long anyway
  assert.ok(evil.length > 500);
  await assert.rejects(() => runHand("grep", { pattern: evil }, { root, noRg: true }), /longer than 500 characters/);
  // a normal long-but-sane pattern still works
  const ok = await runHand("grep", { pattern: "a{10}b" }, { root, noRg: true });
  assert.match(ok, /a\.txt:1/);
  rmSync(root, { recursive: true, force: true });
});

test("1.9 a local memory failure is a 500, not a 502 (nothing upstream was involved)", async () => {
  const { createApp } = await import("../src/server.js");
  const dir = mkdtempSync(join(tmpdir(), "filament-status-"));
  const cfg = defaultConfig(); cfg.server.port = 0; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = "";
  cfg.memory.enabled = false; // its learner does not run, so learning fails here (a fresh config has memory on — HarnessV3-AtHome AH-D1)
  writeFileSync(join(dir, "config.json"), JSON.stringify(cfg));
  const app = createApp({ dataDir: dir, overrides: { port: 0 } }); const port = (await app.start()).port;
  const r = await fetch(`http://127.0.0.1:${port}/api/memory/learn/whatever`, { method: "POST", headers: { "content-type": "application/json", "x-filament-ui": "1" }, body: "{}" });
  assert.equal(r.status, 500, `a local failure must be 500 (got ${r.status})`);
  assert.match((await r.text()), /memory is off|error/);
  await app.stop(); rmSync(dir, { recursive: true, force: true });
});

test("1.10 auto-fit does not fire on the Responses passthrough wire (it would resend the same oversized body and lie in the record)", async () => {
  const { createApp } = await import("../src/server.js");
  let hits = 0;
  const fake = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { hits++; JSON.parse(b);
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "prompt is too long: 90000 tokens > 8000 maximum", type: "invalid_request_error" } })); }); });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  const dir = mkdtempSync(join(tmpdir(), "filament-resp-"));
  const cfg = defaultConfig(); cfg.server.port = 0; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = ""; cfg.observability.storeBodies = "full";
  cfg.upstreams = [{ id: "rw", name: "rw", type: "openai-compatible", wireApi: "responses", baseUrl: `http://127.0.0.1:${fake.address().port}`, apiKey: "s" }];
  cfg.routes = [{ match: "gpt-*", upstream: "rw", upstreamModel: "{model}" }];
  writeFileSync(join(dir, "config.json"), JSON.stringify(cfg));
  const app = createApp({ dataDir: dir, overrides: { port: 0 } }); const port = (await app.start()).port;
  const r = await fetch(`http://127.0.0.1:${port}/v1/responses`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": "k" }, body: JSON.stringify({ model: "gpt-5", input: [{ role: "user", content: "hello there" }] }) });
  assert.equal(r.status, 400, "the overflow reaches the client unchanged");
  const recs = (await (await fetch(`http://127.0.0.1:${port}/api/requests?limit=5`)).json()).requests;
  const rec = recs[0];
  assert.ok(rec, "a record exists");
  assert.ok(!(rec.changes || []).some((c) => /auto-fit/.test(c)), `no false auto-fit claim: ${JSON.stringify(rec.changes)}`);
  assert.equal(rec.autofit, undefined, "and no autofit bookkeeping");
  assert.equal(hits, 1, "the oversized body was not sent twice");
  await app.stop(); fake.close(); rmSync(dir, { recursive: true, force: true });
});

test("1.4 the injection id junction is written, indexed and used (no more instr() table scans)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-inj-"));
  const a = new Archive({ file: join(dir, "a.db") });
  const ch = a.chainForKey("inj-1", {});
  const t = a.beginTurn(ch.id, { requestId: "r1", userMessage: { role: "user", content: "x" } });
  const i1 = a.injections.add({ requestId: "r1", chainId: ch.id, turnId: t.turnId, kind: "turn", ids: ["m1", "m2"], tokens: 10 });
  const i2 = a.injections.add({ requestId: "r2", chainId: ch.id, turnId: t.turnId, kind: "turn", ids: ["m1"], tokens: 5 });
  // the junction holds one row per (injection, memory id)
  const rows = a.db.prepare("SELECT injection_id, memory_id FROM injection_ids ORDER BY injection_id, memory_id").all();
  assert.deepEqual(rows.map((r) => `${r.injection_id}:${r.memory_id}`), [`${i1}:m1`, `${i1}:m2`, `${i2}:m1`]);
  // the streak semantics: unjudged skipped, a used one stops the count — judged per memory id since HarnessV3-Memory M1
  // (a request's verdict names the ids its reply echoed)
  assert.equal(a.injections.neverUsedCount("m1"), 0, "nothing judged yet");
  a.injections.markUsed("r1", false);
  assert.equal(a.injections.neverUsedCount("m1"), 1, "one judged-unused injection in a row");
  a.injections.markUsed("r2", false);
  assert.equal(a.injections.neverUsedCount("m1"), 2, "both judged unused");
  a.injections.markUsed("r2", true, ["m1"]);
  assert.equal(a.injections.neverUsedCount("m1"), 0, "the newest was used, so the streak resets");
  assert.equal(a.injections.neverUsedCount("m2"), 1, "and a memory injected once, unused, counts 1");
  // an id that was never injected is 0, and a substring-ish id must not match (the old instr() scan could)
  assert.equal(a.injections.neverUsedCount("m9"), 0);
  a.injections.markUsed("r1", false);
  assert.equal(a.injections.neverUsedCount("m"), 0, "no substring false positives");
  // deleting the chain purges both tables
  a.deleteChain(ch.id);
  assert.equal(a.db.prepare("SELECT COUNT(*) AS n FROM injections").get().n, 0);
  assert.equal(a.db.prepare("SELECT COUNT(*) AS n FROM injection_ids").get().n, 0, "no orphaned junction rows");
  a.close(); rmSync(dir, { recursive: true, force: true });
});

test("contextWindowFor: the model's window comes from the upstream's table by longest prefix, then the built-ins", async () => {
  const { contextWindowFor } = await import("../src/usage.js");
  const up = { "claude-opus-5": { input: 1, output: 2, contextTokens: 1000000 }, "glm-5": { input: 1, output: 1 } };
  assert.equal(contextWindowFor("claude-opus-5-xhigh", up), 1000000, "the upstream's own table wins (same model, different provider)");
  assert.equal(contextWindowFor("claude-opus-4-6", up), 200000, "no row says a window: the built-in one");
  assert.equal(contextWindowFor("glm-5.2", up), null, "a model with no window recorded returns null, not a guess");
  assert.equal(contextWindowFor("glm-5.2", { "glm-5": { contextTokens: 128000 } }), 128000, "and an upstream-only window is honoured");
  assert.equal(contextWindowFor("whatever", null), null);
});
