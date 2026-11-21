// @ts-check
// HarnessV3-Responsiveness R2 (2026-10-01): the widgets' preview (`GET /sessions/:id/compose?dry=1&compaction=1`)
// composes the whole history about a dozen times — the current view, every strategy, every compaction method — and
// the composer has no await inside, so nothing else in Filament ran until it finished: measured, a `/api/state` that
// takes 2 ms took 469 ms behind one preview, and a running turn's stream stalled with it. The preview now lets the
// event loop in between compositions. The app runs in this process, so the test's own timer cannot fire while the
// server is blocked: without the yields, the state request is not even sent until the preview is over.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { compose } from "../src/app/sessions/compose.js";

const TURNS = 20;
const reply = (/** @type {number} */ n) => `Answer ${n}. ${"The reply goes over what the file says, line by line, at some length. ".repeat(290)}`;

/** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
let up;
/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
/** @type {string} */
let root;
/** @type {string} */
let id;

before(async () => {
  root = mkdtempSync(join(tmpdir(), "filament-preview-yields-"));
  up = await fakeUpstream((call) => (call.kind === "anthropic" ? anthropicReply(reply(call.n), { model: "brain-model" }) : undefined));
  shim = await startApp({
    memory: true,
    configure: (cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
      cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.memory.autopilot = { enabled: false };
      cfg.memory.capture = { turns: true, learn: false };
    },
  });
  const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "brain-model" } });
  assert.equal(r.status, 200, await r.clone().text());
  id = (await r.json()).id;
  for (let i = 1; i <= TURNS; i++) {
    const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: `question ${i}: what does the file say?`, stream: false } });
    assert.equal(t.status, 200, await t.clone().text());
    await t.text();
  }
});

after(async () => {
  await shim.stop();
  await up.close();
  for (const dir of [shim.dataDir, root]) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

// (fails before: the state request waited behind every composition and finished after the preview)
test("a request that arrives while the widgets' preview composes is answered before the preview ends", async () => {
  let previewDone = 0;
  let stateDone = 0;
  const preview = shim.api(`/api/sessions/${encodeURIComponent(id)}/compose?dry=1&compaction=1`).then(async (r) => {
    assert.equal(r.status, 200);
    const pv = await r.json();
    previewDone = performance.now();
    return pv;
  });
  await new Promise((r) => setTimeout(r, 20));
  const state = shim.api("/api/state").then(async (r) => {
    assert.equal(r.status, 200);
    await r.text();
    stateDone = performance.now();
  });
  const [pv] = await Promise.all([preview, state]);
  assert.equal(pv.turns, TURNS, "the preview composed the whole session");
  assert.ok(pv.compaction?.methods, "with the compactor's plan");
  assert.ok(stateDone < previewDone, `the state request finished ${Math.round(stateDone - previewDone)} ms after the preview; it should have gone first`);
});

// The unit under every one of them: a composition lets the event loop in before it starts. Node runs setImmediate
// callbacks in order, so one queued before the call runs before the composition goes on; without the yield the
// composition resolves on microtasks alone and finishes first.
test("every composition lets the event loop in before it composes", async () => {
  let ran = false;
  setImmediate(() => (ran = true));
  const c = await compose({ turns: [], settings: { context: { strategy: "plain" } }, newUser: { role: "user", content: [{ type: "text", text: "hi" }] }, model: "m" });
  assert.ok(c.body, "it composed");
  assert.equal(ran, true, "a callback queued before the composition ran before it finished");
});
