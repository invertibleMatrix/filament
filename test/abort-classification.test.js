// W8 D1: an AbortError of unproven origin must not become a retryable 502 that cools a healthy upstream.
// Classification lives in resilience.js so every catch agrees; finish() also refuses to record a health failure
// for a cancelled request even if a caller still passes status:"error" with an abort message.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAbortError, requestWasAborted } from "../src/resilience.js";
import { createApp } from "../src/server.js";
import { defaultConfig } from "../src/config.js";

// Filament sets no clock on a provider's call any more (HarnessV3-FailurePoints FP-D1): no abort of its own is the
// upstream's fault, so every AbortError is an abort.
test("requestWasAborted: a stray AbortError is an abort; a fetch failure is not, until the client hangs up", () => {
  const abort = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
  const fetchFail = new TypeError("fetch failed");
  const client = new AbortController();

  assert.equal(isAbortError(abort), true);
  assert.equal(isAbortError(fetchFail), false);

  assert.equal(requestWasAborted(abort, client), true, "AbortError while the client is still connected — the D1 case");
  assert.equal(requestWasAborted(fetchFail, client), false);

  client.abort();
  assert.equal(requestWasAborted(fetchFail, client), true, "once the client hung up, anything is an abort");
});

test("requestWasAborted: AbortSignal.timeout (TimeoutError) is not a client abort", () => {
  const e = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  const client = new AbortController();
  assert.equal(isAbortError(e), false);
  assert.equal(requestWasAborted(e, client), false, "a timeout Filament set itself must not read as the client hanging up");
});

let up, app, port, dataDir;
const H = { "content-type": "application/json", "x-api-key": "k" };
before(async () => {
  up = http.createServer((req, res) => {
    // Hang: the request stays in-flight so /cancel can abort it.
    req.on("close", () => { try { res.destroy(); } catch {} });
  });
  await new Promise((r) => up.listen(0, "127.0.0.1", r));
  dataDir = mkdtempSync(join(tmpdir(), "filament-abort-"));
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

test("cancelling an in-flight request records aborted, not a health cooldown", async () => {
  const pending = fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "m", max_tokens: 16, messages: [{ role: "user", content: "hi" }] }) });
  let id = null;
  for (let i = 0; i < 40 && !id; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const live = await (await fetch(`http://127.0.0.1:${port}/api/live`, { headers: H })).json();
    id = live.active?.[0]?.id || null;
  }
  assert.ok(id, "the hanging request is on /api/live");
  const c = await fetch(`http://127.0.0.1:${port}/api/requests/${id}/cancel`, { method: "POST", headers: { ...H, "x-filament-ui": "1" } });
  assert.equal(c.status, 200, await c.text());
  await pending.catch(() => {});
  await new Promise((r) => setTimeout(r, 150));
  const recs = (await (await fetch(`http://127.0.0.1:${port}/api/requests?limit=10`, { headers: H })).json()).requests;
  const rec = recs.find((r) => r.id === id);
  assert.ok(rec, "the cancelled request is in the ring");
  assert.equal(rec.status, "aborted", `status is aborted, not error: ${JSON.stringify({ status: rec.status, error: rec.error, httpStatus: rec.httpStatus })}`);
  const health = (await (await fetch(`http://127.0.0.1:${port}/api/ops?kinds=health&limit=20`, { headers: H })).json()).ops;
  assert.ok(!health.some((o) => o.sub === "cooldown"), `a cancel must not cool the upstream down: ${JSON.stringify(health.map((o) => o.sub))}`);
});
