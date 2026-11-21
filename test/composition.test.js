// @ts-check
// HarnessV2 Phase 6 (§10.5) — "explain this request": the composition report read off a request record, pure over
// synthetic records first (a native session's composed view, a proxied client's fold, a call with no view), then end
// to end: a native session's turn answered by a scripted upstream, its report fetched by request id.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { compositionReport } from "../src/app/sessions/composition.js";

describe("compositionReport — pure", () => {
  test("a native session's record: shapes, the result policy, memory's blocks, the settings hash and the notes in order", () => {
    const rec = {
      id: "r1", ts: "2026-09-23T00:00:00.000Z", status: "ok", model: "agent/m", upstream: "agent-loop", upstreamModel: "m", route: "agent:m", format: "anthropic", api: "session", source: "agent-loop",
      tokens: { input: 1200, output: 80, cacheRead: 900, cacheWrite: 0, thinking: 0 }, cost: 0.0123,
      priorChanges: ["routing: round-robin picked b first", "compose: filament_recall offered"],
      changes: ["agent: read ran", "memory: nothing added"],
      view: { form: "plain", version: 2, historyTokens: 9000, sentTokens: 2900, totalTurns: 6, underSummary: 2, foldedTurns: 3, rawTurns: 1, stubs: 3, composed: true, results: "pointer", deduped: 2, pointers: 4, head: { fromTurn: 1, toTurn: 2, kind: "plain" }, compactions: [], settingsHash: "abc123", shapes: [{ n: 3, shape: "fold", tokens: 40, compacted: true }, { n: 4, shape: "fold", tokens: 200, compacted: true }, { n: 5, shape: "fold", tokens: 800, compacted: true }, { n: 6, shape: "raw", tokens: 1800, compacted: false }] },
      memory: { chain: "c1", turn: 7, turnId: 77, position: "mid", client: "harness", briefing: 3, injected: 2, tokens: 350, ids: [1, 2], tools: true, muted: false, quiet: false, composition: { briefing: 600, goal: 0 }, toolRounds: 1, toolCalls: 1, recalls: 1, cue: false },
      agent: { status: "done", rounds: 2, toolCalls: 1, spentUsd: 0.02, denied: 0, ruleRuns: 1, instructions: { files: ["AGENTS.md"], triggered: ["greet"], hash: "h1", chars: 94 }, web: ["web_fetch"], mcp: [{ name: "fx", tools: 6 }] },
    };
    const r = compositionReport(rec, { chainKind: "interactive" });
    assert.equal(r.requestId, "r1"); assert.equal(r.settingsHash, "abc123");
    assert.deepEqual(r.session, { chain: "c1", turn: 7, turnId: 77, position: "mid", client: "harness", kind: "interactive", native: true });
    assert.equal(r.view?.form, "plain"); assert.equal(r.view?.historyTokens, 9000); assert.equal(r.view?.sentTokens, 2900); assert.equal(r.view?.composed, true);
    assert.equal(r.view?.foldedTurns, 3); assert.equal(r.view?.rawTurns, 1);
    assert.deepEqual(r.shapes.map((s) => `${s.n}:${s.shape}`), ["3:fold", "4:fold", "5:fold", "6:raw"]);
    assert.deepEqual(r.results, { policy: "pointer", deduped: 2, pointers: 4 });
    assert.deepEqual(r.compaction.head, { fromTurn: 1, toTurn: 2, kind: "plain" }); assert.equal(r.compaction.mode, "plain");
    assert.deepEqual(r.memory?.blocks, { briefing: 600, goal: 0, turn: 350 }); assert.equal(r.memory?.items, 2); assert.equal(r.memory?.recalls, 1);
    assert.deepEqual(r.instructions, { files: ["AGENTS.md"], triggered: ["greet"], told: [], hash: "h1", chars: 94 });
    assert.equal(r.agent?.rounds, 2); assert.deepEqual(r.agent?.web, ["web_fetch"]); assert.equal(r.agent?.mcp[0].name, "fx");
    assert.equal(r.costUsd, 0.02, "an agent turn costs what the loop spent, not the shell record's one round"); assert.deepEqual(r.tokens, { input: 1200, output: 80, cacheRead: 900, cacheWrite: 0, thinking: 0 });
    assert.deepEqual(r.notes, [...rec.priorChanges, ...rec.changes], "routing and composer notes first, then what happened");
    assert.deepEqual(r.gaps, []);
  });
  // (fails before: yes — the head was read from the compaction this turn wrote, so a turn after it had none in force,
  // and the turn that wrote one showed what it wrote rather than what stands)
  test("the compaction in force is the head the composer found, whichever turn wrote it", () => {
    const later = compositionReport({ id: "r6", status: "ok", api: "session", view: { composed: true, head: { fromTurn: 1, toTurn: 4, kind: "plain" }, compactions: [] } });
    assert.deepEqual([later.compaction.head, later.compaction.mode], [{ fromTurn: 1, toTurn: 4, kind: "plain" }, "plain"]);
    const wrote = compositionReport({ id: "r7", status: "ok", api: "session", view: { composed: true, head: { fromTurn: 1, toTurn: 6, kind: "plain" }, compactions: [{ id: 9, fromTurn: 5, toTurn: 6, kind: "plain", method: "summary" }] } });
    assert.deepEqual(wrote.compaction.head, { fromTurn: 1, toTurn: 6, kind: "plain" });
    const none = compositionReport({ id: "r8", status: "ok", api: "session", view: { composed: true, head: null, compactions: [] } });
    assert.deepEqual([none.compaction.head, none.compaction.mode], [null, null]);
  });
  test("a proxied client's record has the fold's counts and no shapes; a record with no view says why", () => {
    const proxied = compositionReport({ id: "r2", status: "ok", model: "claude-x", upstream: "anthropic", format: "anthropic", view: { historyTokens: 5000, sentTokens: 3100, foldedTurns: 3, stubs: 9 }, memory: { chain: "c2", turn: 4, position: "mid", client: "claude-code", briefing: 0, injected: 0, tokens: 0, ids: [] }, changes: ["trim: folded 3 turns"] });
    assert.equal(proxied.session?.native, false); assert.deepEqual(proxied.shapes, []); assert.equal(proxied.view?.foldedTurns, 3); assert.equal(proxied.view?.composed, false);
    assert.ok(proxied.gaps.some((g) => /proxied client/.test(g)), proxied.gaps.join(" | "));
    assert.equal(proxied.settingsHash, null);
    const local = compositionReport({ id: "r3", status: "ok", local: true, memory: { chain: "c3", command: true } });
    assert.ok(local.gaps.some((g) => /answered by Filament itself/.test(g)));
    assert.equal(local.view, null);
    const bare = compositionReport({ id: "r4", status: "error" });
    assert.equal(bare.session, null); assert.equal(bare.settingsHash, null); assert.equal(bare.gaps.length, 2);
    assert.equal(bare.memory, null); assert.equal(bare.agent, null); assert.equal(bare.tokens, null); assert.equal(bare.costUsd, null);
  });
  // (fails before: yes — a view without the shape counts had them counted from its shapes, a record's own settings hash
  // stood in for the view's, the memory block's weights stood in for the walk and the budget, and an autofit object
  // and a cleared count were reported, though this build writes none of them)
  test("the report reads the record as this build stamps it: what the view does not say is not known", () => {
    const r = compositionReport({
      id: "r5", status: "ok", api: "session", settingsHash: "rec-hash", autofit: { droppedTurns: 2, droppedTokens: 900 },
      view: { strategy: "fold+1", composed: true, results: "status", cleared: 3, composition: { walk: [{ n: 1, from: "raw", to: "fold" }], budget: 4000, deduped: 5, pointers: 6 }, shapes: [{ n: 1, shape: "summary" }, { n: 2, shape: "stub" }, { n: 3, shape: "drop" }] },
      memory: { chain: "c5", turn: 3, composition: { walk: [{ n: 2, from: "raw", to: "stub" }], budget: 5000, deduped: 7, pointers: 8 } },
    });
    assert.equal(r.settingsHash, null);
    assert.deepEqual(r.results, { policy: "status", deduped: null, pointers: null });
    assert.equal("autofit" in r, false);
  });
});

describe("GET /api/requests/:id/composition — end to end", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-composition-"));
    up = await fakeUpstream(async (call) => anthropicReply(`reply to ${String(call.body?.messages?.at(-1)?.content || "").slice(0, 20)}`, { model: "brain-model", usage: { input_tokens: 40, output_tokens: 6 } }));
    shim = await startApp({
      memory: true,
      keep: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    for (const dir of [shim.dataDir, root]) {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });
  test("a native session's turn has a report: composed view with per-turn shapes, the session and turn, the settings hash, the notes; an unknown id is a 404", async () => {
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "brain-model", preset: "plain", settings: { memory: { enabled: false } } } });
    if (created.status !== 200) assert.fail(await created.text());
    const id = (await created.json()).id;
    const ids = [];
    for (const text of ["first question", "second question", "third question"]) {
      const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: text, stream: false } });
      if (r.status !== 200) assert.fail(await r.text());
      ids.push(String(r.headers.get("x-filament-request-id")));
    }
    const res = await shim.api(`/api/requests/${ids[2]}/composition`);
    assert.equal(res.status, 200);
    const rep = await res.json();
    assert.equal(rep.requestId, ids[2]);
    // The harness runs on the loop: the turn's record is the loop's (upstream "agent-loop"), with the plain route
    // as its model; the composition beneath it is still the composer's.
    assert.equal(rep.request.api, "session"); assert.equal(rep.request.upstream, "agent-loop"); assert.equal(rep.request.upstreamModel, "brain-model");
    assert.equal(rep.session.chain, id); assert.equal(rep.session.turn, 3); assert.equal(rep.session.native, true); assert.equal(rep.session.kind, "interactive");
    assert.ok(rep.settingsHash, "the document in force is named");
    assert.equal(rep.view.composed, true); assert.equal(rep.view.form, "plain"); assert.equal(rep.view.totalTurns, 2, "two completed turns in the history");
    assert.deepEqual(rep.shapes.map((s) => s.n), [1, 2]); assert.ok(rep.shapes.every((s) => s.shape === "raw"), "every turn whole until a compaction");
    assert.ok(rep.view.historyTokens > 0 && rep.view.sentTokens > 0, "history → sent are counted (a folded one-line turn may weigh more than its raw text, so no order is asserted)");
    assert.ok(rep.tokens.input === 40 && rep.tokens.output === 6, "what the upstream billed");
    assert.ok(Array.isArray(rep.notes)); assert.equal(rep.memory.muted, true, "a session with its memory off records without injecting");
    assert.deepEqual(rep.gaps, []);
    const missing = await shim.api("/api/requests/nope-nope/composition");
    assert.equal(missing.status, 404);
    // The detail row still answers the plain id (the composition row sits in front of it, not instead of it).
    assert.equal((await shim.api(`/api/requests/${ids[2]}`)).status, 200);
  });
});
