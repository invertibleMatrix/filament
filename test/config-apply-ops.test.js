// Config ops for the two apply paths that used to only log to stdout (W9 follow-up): applying a template and the
// dashboard assistant applying its draft both record a `config` op with the SAME flattened, redacted diff shape a
// hand save stores — one shared helper, so the three paths cannot drift apart in what they persist.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server.js";
import { defaultConfig } from "../src/config.js";

let app, port, dataDir;
const H = { "content-type": "application/json", "x-api-key": "k", "x-filament-ui": "1" };

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "filament-cfgapply-"));
  const cfg = defaultConfig(); cfg.server.port = 0; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = "";
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
  app = createApp({ dataDir, overrides: { port: 0 } }); port = (await app.start()).port;
});
after(async () => {
  try { if (app) await app.stop(); } catch {}
  for (let i = 0; i < 10; i++) { try { rmSync(dataDir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
});

const configOps = async (sub) => (await (await fetch(`http://127.0.0.1:${port}/api/ops?limit=100&kinds=config`, { headers: H })).json()).ops.filter((o) => o.sub === sub);

test("applying a template records a config op with the redacted diff", async () => {
  // direct-anthropic, not claude-visible-thinking: the latter's patch is already the default config, so applying it
  // is a legitimate zero-change op — a template that ADDS an upstream and a route always produces a diff.
  const r = await fetch(`http://127.0.0.1:${port}/api/templates/direct-anthropic/apply`, { method: "POST", headers: H });
  assert.equal(r.status, 200, await r.text());
  const ops = await configOps("template");
  assert.equal(ops.length, 1, "exactly one template op");
  const o = ops[0];
  assert.equal(o.detail.template, "direct-anthropic");
  assert.ok(o.detail.count >= 1, `the template changed something (${o.detail.count})`);
  const flat = JSON.stringify(o.detail.changes || []);
  assert.ok(!/\[obj\]/.test(flat), "flattened to strings, not object placeholders");
  assert.ok(o.detail.changes.every((c) => typeof c === "string" && c.includes(":")), "each entry names its path");
  assert.ok(!/sk-[A-Za-z0-9_-]{12}/.test(flat), "nothing secret-shaped survives");
});

test("the assistant applying its draft records a config op — with the diff when the draft reverts an intervening save", async () => {
  const { sessionId } = await (await fetch(`http://127.0.0.1:${port}/api/assistant/session`, { headers: H })).json();
  assert.ok(sessionId, "a session exists (its draft is a clone of the config at creation)");
  // Move the live config AFTER the draft was cloned: the apply then reverts that change, a real non-zero diff.
  const cur = (await (await fetch(`http://127.0.0.1:${port}/api/state`, { headers: H })).json()).config;
  const next = JSON.parse(JSON.stringify(cur));
  next.observability.keepLastRequests = 555;
  const put = await fetch(`http://127.0.0.1:${port}/api/config`, { method: "PUT", headers: H, body: JSON.stringify(next) });
  assert.equal(put.status, 200, await put.text());
  const r = await fetch(`http://127.0.0.1:${port}/api/assistant/apply`, { method: "POST", headers: H, body: JSON.stringify({ sessionId }) });
  assert.equal(r.status, 200, await r.text());
  const ops = await configOps("assistant");
  assert.equal(ops.length, 1, "exactly one assistant-apply op");
  const o = ops[0];
  assert.ok(o.detail.count >= 1, "the draft and the live config had drifted, and the op says so");
  const flat = JSON.stringify(o.detail.changes || []);
  assert.ok(/keepLastRequests/.test(flat), `the diff names the drifted path: ${flat.slice(0, 200)}`);
  assert.ok(!/\[obj\]/.test(flat), "flattened to strings");
});

test("the save path still records its own op through the same helper", async () => {
  const saves = await configOps("save");
  assert.ok(saves.length >= 1, "the PUT earlier was recorded too");
  assert.ok(JSON.stringify(saves[0].detail.changes || []).includes("keepLastRequests"), "same flattened shape");
});
