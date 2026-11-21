// @ts-check
// BUG-19's instrumentation (HarnessV3-FixRound F3 item 17): about 60 s passed between the owner's Enter and the server
// seeing the turn, and the server could not say where. A turn's record now carries when the page sent it, when the
// route had it, and each pre-send phase; a held event loop is an operation.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { turnClock } from "../src/app/sessions/service.js";
import { watchLoopStalls } from "../src/services/loop-stall.js";

describe("turnClock", () => {
  test("the gap from the page's stamp, the body read, each phase, the hand-off", async () => {
    const receivedAt = Date.now() - 40;
    const c = turnClock({ receivedAt, bodyAt: receivedAt + 15, sentAt: receivedAt - 1500 });
    c.mark("lock");
    await new Promise((r) => setTimeout(r, 30));
    c.mark("compose");
    const t = c.done();
    assert.equal(t.receivedAt, receivedAt);
    assert.equal(t.gapMs, 1500);
    assert.deepEqual(Object.keys(t.phases), ["body", "lock", "compose"]);
    assert.equal(t.phases.body, 15);
    assert.ok(t.phases.compose >= 25, `compose ${t.phases.compose}`);
    assert.ok(t.handoffMs >= 40 + 25, `hand-off ${t.handoffMs}`);
  });
  test("no page stamp: no gap, never an invented one", () => {
    const t = turnClock({ receivedAt: Date.now(), sentAt: null }).done();
    assert.deepEqual([t.sentAt, t.gapMs], [null, null]);
  });
});

describe("a turn's record carries its timing", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-turn-timing-"));
    up = await fakeUpstream((call) => (call.kind === "anthropic" ? anthropicReply("pong", { model: "brain-model" }) : undefined));
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(root);
  });

  // (fails before: yes — the record had no `view.timing`, and the route stamped nothing)
  test("sent, received, the phases and the hand-off", async () => {
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "brain-model", preset: "plain" } });
    assert.equal(s.status, 200, await s.clone().text());
    const id = String((await s.json()).id);
    const sentAt = Date.now() - 1500; // as if the browser held the POST for 1.5 s
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "hi", stream: false }, headers: { "x-filament-sent-at": String(sentAt) } });
    assert.equal(r.status, 200, await r.clone().text());
    const requestId = String(r.headers.get("x-filament-request-id"));
    const rec = await shim.record(requestId);
    const t = rec.view?.timing;
    assert.ok(t, `the record has view.timing: ${JSON.stringify(rec.view || {}).slice(0, 200)}`);
    assert.equal(t.sentAt, sentAt);
    assert.ok(t.gapMs >= 1500 && t.gapMs < 10_000, `gap ${t.gapMs}`);
    for (const p of ["body", "lock", "archive", "compose"]) assert.equal(typeof t.phases[p], "number", `phase ${p}: ${JSON.stringify(t.phases)}`);
    assert.ok(t.handoffMs >= 0 && t.handoffMs < 10_000, `hand-off ${t.handoffMs}`);
  });
  test("an agent turn's record keeps it (the loop restamps the view's composition)", async () => {
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    assert.equal(s.status, 200, await s.clone().text());
    const id = String((await s.json()).id);
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "hi", stream: false }, headers: { "x-filament-sent-at": String(Date.now()) } });
    assert.equal(r.status, 200, await r.clone().text());
    const rec = await shim.record(String(r.headers.get("x-filament-request-id")));
    assert.ok(rec.agent, "an agent turn");
    assert.equal(typeof rec.view?.timing?.phases?.compose, "number", JSON.stringify(rec.view?.timing || null));
    assert.ok(rec.view?.composition, "and its composition");
  });
  // (fails before: yes — the page said which row of the send menu a message went by, and the turn kept nothing of it)
  test("the send menu's row a message went by: its turn's row keeps it; a head not of its form, or none, keeps nothing", async () => {
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "brain-model", preset: "plain" } });
    assert.equal(s.status, 200, await s.clone().text());
    const id = String((await s.json()).id);
    /** @param {Record<string, string>} headers */
    const via = async (headers) => {
      const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "hi", stream: false }, headers });
      assert.equal(r.status, 200, await r.clone().text());
      return /** @type {any} */ (shim.app.memory).archive.turnBodies(id).at(-1)?.meta?.via ?? null;
    };
    assert.deepEqual(await via({ "x-filament-via": "row=when-done; by=click" }), { row: "when-done", by: "click" });
    assert.deepEqual(await via({ "x-filament-via": "row=unread-note; by=auto" }), { row: "unread-note", by: "auto" });
    assert.equal(await via({}), null, "a message typed between turns: none");
    for (const head of ["row=Next-Step; by=key", "row=next-step; by=mouse", "row=next-step;by=key", "by=key; row=next-step", `row=${"a".repeat(41)}; by=key`, "row=next-step; by=key; x=1", "row=next_step; by=key"])
      assert.equal(await via({ "x-filament-via": head }), null, `not of its form: ${head}`);
  });
});

describe("a held event loop is an operation", () => {
  /** A busy wait: the loop is held for `ms`. */
  const hold = (/** @type {number} */ ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end);
  };
  // (fails before: yes — nothing watched the loop)
  test("a stall past the threshold writes one warning with its length; a quiet loop writes none", async () => {
    /** @type {any[]} */
    const ops = [];
    const w = watchLoopStalls({ ops: { record: (kind, title, o) => ops.push({ kind, title, ...o }) }, thresholdMs: 250, everyMs: 50 });
    try {
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(ops.length, 0, "a quiet loop is no stall");
      hold(700);
      await until(() => ops.length > 0, "the stall's warning", { timeoutMs: 3000 });
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(ops.length, 1, JSON.stringify(ops));
      const op = ops[0];
      assert.deepEqual([op.kind, op.sub, op.level], ["log", "stall", "warn"]);
      assert.ok(op.ms >= 600 && op.ms < 1500, `held 700 ms, said ${op.ms} ms: short by at most one tick`);
      assert.match(op.title, /event loop was held for \d+\.\d s/);
      assert.equal(op.detail.thresholdMs, 250);
    } finally {
      w.stop();
    }
  });
  // (fails before: yes — the watcher reset `monitorEventLoopDelay` after each look, and a reset forgets the last
  // sample time, so a stall that began within a sample of a reset was lost; the F4 suite caught it, one run in three)
  test("a stall is seen wherever it falls between two looks", async () => {
    /** @type {any[]} */
    const ops = [];
    const w = watchLoopStalls({ ops: { record: (kind, title, o) => ops.push({ kind, title, ...o }) }, thresholdMs: 250, everyMs: 50 });
    try {
      for (let k = 0; k < 6; k++) {
        await new Promise((r) => setTimeout(r, 60 + k * 9));
        hold(500);
        await until(() => ops.length === k + 1, `stall ${k + 1}'s warning (${ops.length} so far)`, { timeoutMs: 3000 });
      }
      assert.ok(ops.every((o) => o.ms >= 400), JSON.stringify(ops.map((o) => Math.round(o.ms))));
    } finally {
      w.stop();
    }
  });
  test("the server watches its loop from the start and stops at shutdown; the page stamps its turns", () => {
    const server = readFileSync("src/server.js", "utf8");
    assert.match(server, /const stalls = watchLoopStalls\(\{ ops \}\);/);
    assert.match(server, /runs\.close\(\);\n\s+stalls\.stop\(\);/);
    const api = readFileSync("src/ui/harness/lib/api.js", "utf8");
    assert.match(api, /"x-filament-sent-at": String\(Date\.now\(\)\)/);
  });
});
