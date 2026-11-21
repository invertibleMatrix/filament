// @ts-check
// HarnessV3-Responsiveness R6 (2026-10-01): "every API request coming from Filament is shown twice inside the tray
// where agent/ is prefixed in one". A harness turn is one record for the whole turn (`agent/<model>`, open for as long
// as the turn runs — over an hour in the owner's session) and one record per model call inside it; `/api/live` listed
// them flat, and the tray's NOW card and the dashboard's Status pane drew each as an equal "live" row — between calls
// the turn's row alone read "waiting…". Now each call carries its turn (`parentId`) and each turn says what it is
// doing right now (`now`), so one row per turn can be drawn.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nestLive } from "../src/services/records.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { until } from "./helpers/wait.js";

const NOW = 1_000_000;
const turnRow = (id, extra = {}) => ({ id, source: "agent-loop", model: "agent/opus", elapsedMs: 60_000, ...extra });
const tick = (id, parent, extra = {}) => ({ id, source: "agent-tick", model: "opus", agentOf: parent, elapsedMs: 4_000, ...extra });

describe("nestLive: one row per turn", () => {
  test("a model call in flight sits under its turn, and the turn says it is calling the model", () => {
    const rows = nestLive([turnRow("t1"), tick("c1", "t1")], () => []);
    const t = rows.find((r) => r.id === "t1");
    const c = rows.find((r) => r.id === "c1");
    assert.equal(t.parentId, null, "the turn is a top-level row");
    assert.equal(c.parentId, "t1", "the call belongs to it");
    assert.deepEqual(t.now, { what: "model", model: "opus", forMs: 4_000 });
  });
  // (fails before: yes — HarnessV4_Tasks U1, found on the Requests page in the live drive: a turn's own record takes
  // no byte, so it counted the time since its first byte as silence and read stalled, with nothing streamed, while
  // its model call wrote)
  test("a turn's stream figures are its model call's in flight; between calls it has none and is not stalled", () => {
    const own = { liveOutTokens: 0, liveThinkTokens: null, liveTps: 0, liveTpsNow: 0, liveTpsWriting: null, sinceOutputMs: 19_000, stalled: true };
    const calls = { liveOutTokens: 42, liveThinkTokens: 9, liveTps: 4.1, liveTpsNow: 5, liveTpsWriting: 4.4, sinceOutputMs: 400, stalled: false };
    const [t] = nestLive([turnRow("t1", own), tick("c1", "t1", calls)], () => []);
    assert.deepEqual(Object.fromEntries(Object.keys(own).map((k) => [k, t[k]])), calls, "what streams is the call's");
    const [quiet] = nestLive([turnRow("t1", own), tick("c1", "t1", { ...calls, sinceOutputMs: 8_000, stalled: true })], () => []);
    assert.deepEqual([quiet.stalled, quiet.sinceOutputMs], [true, 8_000], "a call that went quiet makes its turn quiet");
    const [first] = nestLive([turnRow("t1", own), tick("c1", "t1", {})], () => []);
    assert.deepEqual([first.stalled, first.sinceOutputMs, first.liveOutTokens], [false, null, null], "a call with no byte yet");
    const [between] = nestLive([turnRow("t1", own)], () => [{ type: "tool-start", id: "u1", name: "bash", args: "npm test", ts: NOW - 60_000 }], NOW);
    assert.deepEqual([between.stalled, between.sinceOutputMs, between.liveOutTokens, between.now.what], [false, null, null, "tool"], "a tool runs: nothing streams, and nothing is stuck");
    const [call] = nestLive([tick("c9", "gone", { ...calls, stalled: true, sinceOutputMs: 5_000 })], () => []);
    assert.deepEqual([call.stalled, call.sinceOutputMs], [true, 5_000], "a call keeps its own");
  });
  test("between calls the turn says which tool is running and for how long", () => {
    const evs = [
      { type: "round-start", round: 3, ts: NOW - 90_000 },
      { type: "tool-start", id: "u1", name: "read", ts: NOW - 80_000 },
      { type: "tool-end", id: "u1", name: "read", ts: NOW - 79_000 },
      { type: "tool-start", id: "u2", name: "bash", args: "npm test", ts: NOW - 60_000 },
    ];
    const [t] = nestLive([turnRow("t1")], () => evs, NOW);
    assert.deepEqual(t.now, { what: "tool", name: "bash", args: "npm test", forMs: 60_000 });
  });
  test("a tool that ended is no longer what the turn does; of two running at once, the newest is", () => {
    const done = [
      { type: "round-start", round: 1, ts: NOW - 30_000 },
      { type: "tool-start", id: "u1", name: "bash", args: "npm test", ts: NOW - 20_000 },
      { type: "tool-end", id: "u1", name: "bash", ts: NOW - 10_000 },
    ];
    const [a] = nestLive([turnRow("t1")], () => done, NOW);
    assert.deepEqual(a.now, { what: "working", forMs: 10_000 }, "the bash ended: the turn is between steps");
    const both = [
      { type: "tool-start", id: "u1", name: "read", args: "a.txt", ts: NOW - 8_000 },
      { type: "tool-start", id: "u2", name: "grep", args: "TODO", ts: NOW - 3_000 },
    ];
    const [b] = nestLive([turnRow("t1")], () => both, NOW);
    assert.deepEqual(b.now, { what: "tool", name: "grep", args: "TODO", forMs: 3_000 });
  });
  test("the wait tool and the loop's own wait both read as waiting; a finished round reads as working", () => {
    const [a] = nestLive([turnRow("t1")], () => [{ type: "tool-start", id: "w1", name: "wait", ts: NOW - 30_000 }], NOW);
    assert.equal(a.now.what, "waiting");
    assert.equal(a.now.forMs, 30_000);
    const [b] = nestLive([turnRow("t1")], () => [{ type: "round-start", round: 2, ts: NOW - 50_000 }, { type: "waiting", why: "waiting for sub-agents to report", ts: NOW - 20_000 }], NOW);
    assert.deepEqual(b.now, { what: "waiting", why: "waiting for sub-agents to report", forMs: 20_000 });
    const [c] = nestLive([turnRow("t1")], () => [{ type: "waiting", why: "x", ts: NOW - 20_000 }, { type: "round-start", round: 3, ts: NOW - 5_000 }], NOW);
    assert.deepEqual(c.now, { what: "working", forMs: 5_000 }, "a new round ended the wait");
  });
  test("a sub-agent's turn sits under the turn that launched it, with its own now; a call whose turn ended stands alone", () => {
    const rows = nestLive(
      [turnRow("t1"), { id: "s1", source: "subagent", model: "agent/glm", subagentOf: "t1", elapsedMs: 9_000 }, tick("c2", "s1", { model: "glm" }), tick("c3", "gone")],
      (id) => (id === "t1" ? [{ type: "tool-start", id: "a1", name: "agent", ts: NOW - 9_000 }] : []),
      NOW,
    );
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.equal(by.s1.parentId, "t1");
    assert.equal(by.c2.parentId, "s1");
    assert.deepEqual(by.s1.now, { what: "model", model: "glm", forMs: 4_000 }, "the sub-agent's own call is its now");
    assert.deepEqual(by.t1.now, { what: "tool", name: "agent", args: null, forMs: 9_000 }, "a sub-agent turn is not the launcher's model call");
    assert.equal(by.c3.parentId, null, "a parent no longer in flight is no parent");
    assert.equal(by.c3.now, undefined, "and a model call has no now of its own");
  });
});

// (fails before: /api/live had neither field)
test("/api/live nests a running agent turn's work and says what it is doing", async () => {
  const root = mkdtempSync(join(tmpdir(), "filament-live-nesting-"));
  const up = await fakeUpstream((call) => {
    if (call.kind !== "anthropic") return undefined;
    const last = (call.body?.messages || []).at(-1);
    const done = Array.isArray(last?.content) && last.content.some((b) => b?.type === "tool_result");
    return done
      ? anthropicReply("done", { model: "brain-model" })
      : anthropicReply("", { model: "brain-model", stop: "tool_use", blocks: [{ type: "tool_use", id: "b1", name: "bash", input: { command: 'node -e "setTimeout(()=>{},4000)"' } }] });
  });
  const shim = await startApp({
    memory: true,
    configure: (cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
      cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.memory.autopilot = { enabled: false };
      cfg.memory.capture = { turns: true, learn: false };
      cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
    },
  });
  try {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    const id = (await r.json()).id;
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "run it", stream: true } });
    const runId = String(res.headers.get("x-filament-request-id") || "");
    const body = res.text();
    /** @type {any} */
    let row = null;
    await until(async () => {
      const live = await (await shim.api("/api/live")).json();
      row = (live.active || []).find((a) => a.id === runId);
      return row?.now?.what === "tool";
    }, "the turn's row to say it runs a tool");
    assert.equal(row.parentId, null);
    assert.equal(row.now.name, "bash");
    assert.ok(Number(row.now.forMs) >= 0);
    await body;
  } finally {
    await shim.stop();
    await up.close();
    for (const dir of [shim.dataDir, root]) {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  }
});
