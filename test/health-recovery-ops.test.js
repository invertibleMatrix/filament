// Health recovery events (W9 follow-up): a success that clears a failure streak or an active cooldown is recorded
// as a `health` op with sub "recovered" — without it the System tab showed every upstream going down and none of
// them coming back. A success on a HEALTHY upstream must record nothing: one op per request is exactly the firehose
// the op log's design refuses.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server.js";
import { defaultConfig } from "../src/config.js";

let up, app, port, dataDir, failing = false;
const H = { "content-type": "application/json", "x-api-key": "k" };

before(async () => {
  up = http.createServer((req, res) => {
    let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
      if (failing) { res.writeHead(500, { "content-type": "application/json" }); return res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "upstream exploded" } })); }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "msg_x", type: "message", role: "assistant", model: "m", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 3 } }));
    });
  });
  await new Promise((r) => up.listen(0, "127.0.0.1", r));
  dataDir = mkdtempSync(join(tmpdir(), "filament-healthrec-"));
  const cfg = defaultConfig(); cfg.server.port = 0; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = "";
  cfg.upstreams = [{ id: "u", name: "u", type: "anthropic-compatible", baseUrl: `http://127.0.0.1:${up.address().port}`, apiKey: "s" }];
  cfg.routes = [{ match: "m", upstream: "u", upstreamModel: "m" }];
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
  app = createApp({ dataDir, overrides: { port: 0 } }); port = (await app.start()).port;
});
after(async () => {
  try { if (app) await app.stop(); } catch {}
  try { up?.close(); } catch {}
  for (let i = 0; i < 10; i++) { try { rmSync(dataDir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
});

const post = () => fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "m", max_tokens: 16, messages: [{ role: "user", content: "hi" }] }) });
const healthOps = async () => (await (await fetch(`http://127.0.0.1:${port}/api/ops?limit=100&kinds=health`, { headers: H })).json()).ops;

test("a failure cools the upstream down, the next success records the recovery — and a healthy success records nothing", async () => {
  failing = true;
  const bad = await post();
  assert.equal(bad.status, 500, "the failure reached the client");
  const downs = await healthOps();
  assert.ok(downs.some((o) => o.sub === "cooldown" && o.detail?.upstream === "u"), "the cooldown is an op (this half already worked)");

  failing = false;
  const good = await post();
  assert.equal(good.status, 200, "the same upstream is still tried (parked last, not skipped) and now answers");
  const after1 = await healthOps();
  const rec = after1.find((o) => o.sub === "recovered");
  assert.ok(rec, "the recovery is recorded — before this, the log showed the upstream go down and never come back");
  assert.equal(rec.detail.upstream, "u");
  assert.equal(rec.detail.failures, 1, "the streak it cleared");
  assert.ok(typeof rec.detail.cooldownLeftMs === "number" && rec.detail.cooldownLeftMs > 0, "and how much cooldown was left");
  assert.deepEqual(Object.keys(rec.detail).sort(), ["cooldownLeftMs", "failures", "upstream"], "content-free: no error message, no body");
  assert.equal(rec.ref?.upstreamId, "u");

  const n0 = after1.length;
  const again = await post();
  assert.equal(again.status, 200);
  const after2 = await healthOps();
  assert.equal(after2.filter((o) => o.sub === "recovered").length, 1, "a second healthy success adds no recovery op");
  assert.equal(after2.length, n0, "and no health op at all — the firehose guard holds");
});
