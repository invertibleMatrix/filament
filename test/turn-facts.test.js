// HarnessV3-Facade Phase FA (D2): a turn's facts — the pure fold over a turn's records, the two predicates that
// replace the three hand-written "parents don't bill" copies, and finish's write of the facts on the archived turn.
// The service-level tests (the live fold, the transcript's facts) ride the app helper below.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { billedByChildren, booksOnSession, foldTurnFacts, lineageParentOf, ownAgentCall } from "../src/core/turn-facts.js";
import { MemoryService } from "../src/memory-service.js";
import { Archive } from "../src/archive.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { until, gate } from "./helpers/wait.js";
import { chainKeyForConversationId } from "../src/services/memory/brain.js";
import { cutOffBefore } from "../src/app/sessions/shapes.js";

/** A finished record with the fields the fold reads; times are absolute ms. */
let seq = 0;
const rec = ({ id, start, ms = 100, own = false, ...rest }) => ({
  id: id || `r${++seq}`,
  ts: new Date(start).toISOString(),
  totalMs: ms,
  status: "ok",
  stopReason: "end_turn",
  model: "test-model",
  upstream: "up1",
  tokens: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0, thinking: 0 },
  cost: 0.01,
  changes: [],
  ...rest,
});

describe("turn facts: the predicates", () => {
  test("billedByChildren: an agent-loop parent, nothing else", () => {
    assert.equal(billedByChildren({ agent: { rounds: 3 } }), true);
    assert.equal(billedByChildren({ agentOf: "parent" }), false, "a tick is a child, not a parent");
    assert.equal(billedByChildren({ subagentOf: "parent" }), false, "a sub-agent's call is a child, not a parent");
    assert.equal(billedByChildren({}), false);
    assert.equal(billedByChildren(null), false);
  });
  test("booksOnSession: not memory's own call, not Filament's answer", () => {
    assert.equal(booksOnSession({ memoryFor: { purpose: "learn" } }), false);
    assert.equal(booksOnSession({ local: true }), false);
    assert.equal(booksOnSession({ memory: { command: true } }), false);
    assert.equal(booksOnSession({ memory: { chain: "c1", turnId: 3 } }), true);
    assert.equal(booksOnSession({}), true);
    assert.equal(booksOnSession(null), false);
  });
  test("lineage: the first parent header names the ancestor", () => {
    assert.equal(lineageParentOf({ agentOf: "a", parentRequest: "p" }), "a");
    assert.equal(lineageParentOf({ subagentOf: "s" }), "s");
    assert.equal(lineageParentOf({ parentRequest: "p" }), "p");
    assert.equal(lineageParentOf({}), null);
    // (fails before: no — a guard the mutation pass asked for: no test had a sub-agent the developer launched)
    assert.equal(lineageParentOf({ subagentOf: "owner" }), null, "a sub-agent the developer launched from the side is a root of its own");
  });
  // (fails before: yes — the review of 10-26: the session's last request was any agent's newest call, so the Cache could
  // show a Watcher's or a sub-agent's call as the main agent's)
  test("ownAgentCall: the session's own agent's calls — its loop's rounds, its coding agent's turn — and no side agent's", () => {
    const recs = new Map([
      ["turn", { id: "turn", agent: { rounds: 2 } }],
      ["side", { id: "side", subagentOf: "turn", subagent: "sa1", agent: { rounds: 1 } }],
      ["loopA", { id: "loopA", agentOf: "loopB" }],
      ["loopB", { id: "loopB", agentOf: "loopA" }],
    ]);
    const byId = (/** @type {string} */ id) => recs.get(id) || null;
    assert.equal(ownAgentCall({ id: "t1", agentOf: "turn" }, byId), true, "a round of the session's own loop");
    assert.equal(ownAgentCall({ id: "acp", memory: { chain: "c" } }, byId), true, "a coding agent's own turn");
    assert.equal(ownAgentCall({ id: "s1", agentOf: "side" }, byId), false, "a round of a sub-agent's loop");
    assert.equal(ownAgentCall({ id: "w", subagentOf: "turn", subagent: "sa2" }, byId), false, "a worker's or a card's own turn");
    assert.equal(ownAgentCall({ id: "f", subagentOf: "owner" }, byId), false, "Filament's fork of the conversation");
    assert.equal(ownAgentCall({ id: "x", agentOf: "loopA" }, byId), false, "a lineage that goes round is no one's");
    assert.equal(ownAgentCall(null, byId), false);
  });
});

describe("turn facts: the fold (FA 1)", () => {
  test("an outside client's turn of three legs sums tokens and cost, and takes model, held, context and stop reason from the newest leg", () => {
    const ctx = { window: 200000, usable: 180000, verdict: "fits", source: "provider", estimate: 42000 };
    const mem = (tokens) => ({ chain: "c", turnId: 1, injected: 2, tokens, briefing: 100 });
    const leg1 = rec({ start: 1000, tokens: { input: 1000, output: 20, cacheRead: 500, cacheWrite: 100 }, cost: 0.01, memory: mem(300), changes: ["view: fold applied"] });
    const leg2 = rec({ start: 5000, tokens: { input: 2000, output: 30, cacheRead: 1500, cacheWrite: 0 }, cost: 0.02, stopReason: "tool_use", memory: mem(310) });
    const leg3 = rec({ start: 9000, tokens: { input: 3000, output: 40, cacheRead: 2500, cacheWrite: 50 }, cost: 0.04, context: ctx, memory: mem(320), view: { form: "plain", historyTokens: 5000, shapedTokens: 4000, foldedTurns: 2 } });
    let f = foldTurnFacts(null, leg1, { own: true });
    f = foldTurnFacts(f, leg2, { own: true });
    f = foldTurnFacts(f, leg3, { own: true });
    assert.equal(f.v, 1);
    assert.equal(f.requests, 3, "each leg is one of the turn's own requests");
    assert.equal(f.calls, 3);
    assert.equal(f.model, leg3.model);
    assert.equal(f.held, 3000 + 2500 + 50, "the newest leg's prompt as the provider counted it");
    assert.deepEqual(f.tokens, { input: 6000, output: 90, cacheRead: 4500, cacheWrite: 150, cacheSeen: 10_650 });
    assert.ok(Math.abs(f.costUsd - 0.07) < 1e-9);
    assert.equal(f.startedAt, 1000, "the first own request's start");
    assert.equal(f.endedAt, 9100, "the last call's finish");
    assert.equal(f.stopReason, "end_turn", "the newest leg's stop reason");
    assert.deepEqual(f.context, { window: 200000, usable: 180000, verdict: "fits", source: "provider" });
    assert.deepEqual(f.view, { form: "plain", foldedTurns: 2, savedTokens: 1000 });
    assert.deepEqual(f.memory, { injected: 2, tokens: 320, briefing: 100, related: null }, "the newest own request's memory block decides it");
    assert.equal(f.failovers, 0);
    assert.deepEqual(f.changes, ["view: fold applied"]);
    assert.equal(f.changesMore, 0);
  });

  // (fails before: yes — a failed turn's facts kept no word of its failure: a reload drew it as a turn never answered)
  test("the newest own request's failure is the turn's, its words cut; a request that ends well after it clears them", () => {
    let f = foldTurnFacts(null, rec({ start: 1000, status: "error", error: "x".repeat(600) }), { own: true });
    assert.equal(f.error, "x".repeat(500));
    f = foldTurnFacts(f, rec({ start: 2000, status: "error", error: "a call's" }));
    assert.equal(f.error, "x".repeat(500), "a call that billed is none of the turn's own requests");
    f = foldTurnFacts(f, rec({ start: 3000 }), { own: true });
    assert.equal(f.error, null);
    assert.equal(foldTurnFacts(null, rec({ start: 1000, status: "aborted", error: "client disconnected" }), { own: true }).error, null, "a stop is no failure");
  });

  test("an agent turn: the rounds' billing summed, the parent's figures for the rest, never the parent's tokens", () => {
    const parent = rec({
      start: 1000,
      ms: 8000,
      agent: { status: "done", rounds: 4 },
      tokens: { input: 9000, output: 900, cacheRead: 0, cacheWrite: 0 },
      cost: 0.9,
      memory: { chain: "c", turnId: 7, injected: 1, tokens: 50, briefing: 50 },
      view: { form: "plain", historyTokens: 9000, sentTokens: 9000 },
    });
    let f = foldTurnFacts(null, parent, { own: true });
    for (let i = 0; i < 4; i++) {
      f = foldTurnFacts(f, rec({ start: 2000 + i * 1000, agentOf: parent.id, tokens: { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0 }, cost: 0.1 }), { own: false });
    }
    assert.equal(billedByChildren(parent), true, "the parent's billing is carried by its children");
    assert.equal(f.requests, 1, "the parent is the turn's one own request");
    assert.equal(f.calls, 4, "the four rounds — the parent carries the client-facing tokens, it is not itself a call that billed");
    assert.deepEqual(f.tokens, { input: 4000, output: 400, cacheRead: 0, cacheWrite: 0 }, "the parent's tokens are not added");
    assert.ok(Math.abs(f.costUsd - 0.4) < 1e-9);
    assert.equal(f.model, parent.model, "the parent's model stands for the turn");
    assert.equal(f.startedAt, 1000);
    assert.equal(f.endedAt, 9000, "the parent closes last; its finish ends the turn");
    assert.deepEqual(f.memory, { injected: 1, tokens: 50, briefing: 50, related: null });
    // Where the turn ended: the loop stamps its newest round, which the meter reads after a reload.
    const ended = foldTurnFacts(null, { ...parent, context: { window: 100000, usable: 80000, verdict: "fits", source: "provider", last: { held: 42000, rounds: 4, composition: {} } } }, { own: true });
    assert.deepEqual(ended.context, { window: 100000, usable: 80000, verdict: "fits", source: "provider", held: 42000 });
    assert.equal(ended.held, 9000, "the parent's own figure stays what it was: round one's");
  });

  test("costUsd is null when no call had a price, and never 0 for unknown", () => {
    const a = rec({ start: 1000, cost: null });
    let f = foldTurnFacts(null, a, { own: true });
    assert.equal(f.costUsd, null);
    f = foldTurnFacts(f, rec({ start: 2000, agentOf: a.id, cost: null }), { own: false });
    assert.equal(f.costUsd, null, "still unknown, not 0");
    f = foldTurnFacts(f, rec({ start: 3000, agentOf: a.id, cost: 0.05 }), { own: false });
    assert.ok(Math.abs(f.costUsd - 0.05) < 1e-9, "the one priced call is the sum");
  });

  // (fails before: yes — the facts carried the paid figure only; Providers P4: a plan's turn read "$0" with no worth)
  test("listUsd folds by the same rule: null until a call names a list figure, then the sum, beside the paid one", () => {
    const a = rec({ start: 1000, cost: 0, listCost: null });
    let f = foldTurnFacts(null, a, { own: true });
    assert.deepEqual([f.costUsd, f.listUsd], [0, null], "paid $0 on a plan; no card, so no list figure");
    f = foldTurnFacts(f, rec({ start: 2000, agentOf: a.id, cost: 0, listCost: 0.29 }), { own: false });
    f = foldTurnFacts(f, rec({ start: 3000, agentOf: a.id, cost: 0.1, listCost: 0.1 }), { own: false });
    assert.deepEqual([f.costUsd, f.listUsd], [0.1, 0.39]);
  });

  test("recalls are summed over every call, whichever order the records fold in", () => {
    const root = rec({ start: 1000, memory: { chain: "c", turnId: 1, injected: 1, tokens: 10, briefing: 0 } });
    const child1 = rec({ start: 2000, agentOf: root.id, memory: { recalls: 2 } });
    const child2 = rec({ start: 3000, agentOf: root.id, memory: { recalls: 1 } });
    const a = foldTurnFacts(foldTurnFacts(foldTurnFacts(null, root, { own: true }), child1, {}), child2, {});
    const b = foldTurnFacts(foldTurnFacts(foldTurnFacts(null, child2, {}), root, { own: true }), child1, {});
    assert.equal(a.memory.recalls, 3);
    assert.equal(b.memory.recalls, 3, "children first or last, the count is the same");
  });
});

describe("turn facts: the fold is order-free (FA 2)", () => {
  const legs = () => {
    const root = rec({ id: "own-1", start: 1000, ms: 900, tokens: { input: 500, output: 50, cacheRead: 100, cacheWrite: 0 }, cost: 0.02, memory: { chain: "c", turnId: 3, injected: 3, tokens: 120, briefing: 40 }, changes: ["a: one"] });
    return [
      root,
      rec({ id: "own-2", start: 4000, ms: 800, tokens: { input: 700, output: 60, cacheRead: 0, cacheWrite: 20 }, cost: 0.03, context: { window: 100, usable: 90, verdict: "fits", source: "provider" }, changes: ["b: two", "a: one"] }),
      rec({ id: "tick-1", start: 2500, ms: 300, agentOf: "own-1", tokens: { input: 200, output: 10 }, cost: 0.01 }),
      rec({ id: "mem-1", start: 2600, ms: 50, parentRequest: "own-1", memoryFor: { purpose: "learn" }, tokens: { input: 400, output: 4 }, cost: 0.004 }),
      rec({ id: "ans-1", start: 5000, ms: 5, local: true, cost: 0 }),
    ];
  };
  const orders = [
    ["own-1", "own-2", "tick-1", "mem-1", "ans-1"],
    ["tick-1", "own-2", "ans-1", "own-1", "mem-1"],
    ["mem-1", "ans-1", "tick-1", "own-1", "own-2"],
  ];
  const foldSet = (order) => {
    const own = new Set(["own-1", "own-2"]);
    let f = null;
    for (const id of order) {
      const r = legs().find((x) => x.id === id);
      f = foldTurnFacts(f, r, { own: own.has(id) });
    }
    return f;
  };
  test("sums, selections and counts are identical in every order", () => {
    const [first, ...rest] = orders.map(foldSet);
    for (const f of rest) {
      assert.deepEqual({ ...f, changes: undefined }, { ...first, changes: undefined });
    }
    assert.equal(first.calls, 3, "memory's call and Filament's answer fold as nothing");
    assert.deepEqual(first.tokens, { input: 1400, output: 120, cacheRead: 100, cacheWrite: 20, cacheSeen: 1320 });
  });
  test("changes keep the own requests' finish order under a finish-time fold", () => {
    const f = foldSet(["own-1", "tick-1", "own-2", "mem-1", "ans-1"]);
    assert.deepEqual(f.changes, ["a: one", "b: two"], "de-duplicated in finish order");
    assert.equal(f.changesMore, 0);
  });
  test("a round of the turn's own loop brings its notes; past the cap they are counted, not kept", () => {
    const round = rec({ id: "tick-9", start: 1500, agentOf: "own-1", changes: ["c: round", "a: one"] });
    let f = foldTurnFacts(null, legs()[0], { own: true });
    f = foldTurnFacts(f, round, { round: true });
    assert.deepEqual(f.changes, ["a: one", "c: round"]);
    assert.deepEqual(foldTurnFacts(null, round, {}), { ...foldTurnFacts(null, round, {}), changes: [] }, "not a round: no notes");
    const many = rec({ id: "tick-10", start: 1600, agentOf: "own-1", changes: Array.from({ length: 35 }, (_, i) => `n: ${i}`) });
    const g = foldTurnFacts(f, many, { round: true });
    assert.equal(g.changes.length, 30);
    assert.equal(g.changesMore, 7, "the cap counts what it leaves out");
  });
});

describe("turn facts over a real memory service", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-facts-"));
  const services = [];
  after(async () => {
    for (const s of services) { try { await s.shutdown(); } catch {} }
    rmSync(dir, { recursive: true, force: true });
  });

  /** A finished record as `persist` writes it; times are absolute ms. */
  const logRec = ({ start, ms = 100, ...rest }) => ({
    id: `lr${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date(start).toISOString(),
    totalMs: ms,
    status: "ok",
    stopReason: "end_turn",
    model: "m",
    upstream: "u",
    tokens: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0, thinking: 0 },
    cost: 0.01,
    changes: [],
    ...rest,
  });
  // A real MemoryService over a real archive; each test hands it a records stand-in: the ring the lineage walk reads.
  const svc = (folder) => {
    const s = new MemoryService({
      getConfig: () => ({ memory: { enabled: true, folder, privacy: { encryptArchive: false } } }),
      dataDir: dir,
      log: () => {},
    });
    services.push(s);
    s.start();
    return s;
  };
  const seedTurns = (folder) => {
    mkdirSync(folder, { recursive: true });
    const a = new Archive({ file: join(folder, "archive.db") });
    const ch = a.chainForKey("k1", { cwd: dir, client: "opencode", model: "m" });
    const turns = {};
    for (const name of ["t1", "t2", "t3", "t4", "t5"]) {
      const { turnId } = a.beginTurn(ch.id, { requestId: `req-${name}`, model: "m", userMessage: { role: "user", content: [{ type: "text", text: `seeded turn ${name}` }] } });
      a.finishTurn(turnId, { finalMessage: { role: "assistant", content: [{ type: "text", text: `done ${name}` }] }, requestId: `req-${name}` });
      turns[name] = turnId;
    }
    a.close();
    return turns;
  };
  const factsOf = (s, turnId) => s.archive.turnMeta(turnId)?.facts || null;

  // HarnessV3-FixRound F2 item 14: an agent turn's Details showed the parent's notes only; a round's (a flex or fast
  // downgrade, the model rewrite, the tier fields sent) were lost. (fails before: yes — the fold kept ["agent: loop note"])
  test("a turn's notes fold its own loop rounds' notes, de-duplicated in finish order; a sub-agent's stay its own", async () => {
    const folder = join(dir, "mem-rounds");
    const turns = seedTurns(folder);
    const parent = logRec({ start: 1000, ms: 9000, agent: { rounds: 2 }, memory: { chain: "k1", turnId: turns.t1 }, changes: ["agent: loop note"] });
    const round1 = logRec({ start: 1100, agentOf: parent.id, memory: { chain: "t-internal", turnId: 998 }, changes: ["model: brain-model as sent"] });
    const round2 = logRec({ start: 3000, agentOf: parent.id, memory: { chain: "t-internal", turnId: 998 }, changes: ["flex: brain-model fell back to the standard tier", "model: brain-model as sent"] });
    const sub = logRec({ start: 4000, subagentOf: parent.id, memory: { chain: "s-internal", turnId: 997 }, changes: ["sub: its own note"] });
    const subRound = logRec({ start: 4100, agentOf: sub.id, memory: { chain: "s-internal", turnId: 997 }, changes: ["sub-round: its own note"] });
    const want = ["model: brain-model as sent", "flex: brain-model fell back to the standard tier", "agent: loop note"];
    // Each record folds as it finishes (the parent closes last), its ancestors in the ring.
    const order = [round1, round2, sub, subRound, parent];
    const s = svc(folder);
    s.records = { byId: new Map(order.map((r) => [r.id, r])) };
    for (const r of order) s.turnFactsAdd(r);
    assert.deepEqual(factsOf(s, turns.t1).changes, want);
    assert.equal(factsOf(s, turns.t1).calls, 4, "two rounds, the sub-agent and its round; the parent bills nothing");
  });

  // (fails before: yes — nothing marked the turn a request ran, so after a restart every unanswered turn begun
  // before it read as cut off, one whose request had failed among them: HarnessV3-FailurePoints finding 3)
  test("a request's record closing clears its own turn's running mark — a round's is its internal turn's, never the turn it works for", async () => {
    const folder = join(dir, "mem-running");
    mkdirSync(folder, { recursive: true });
    const s = svc(folder);
    const a = s.archive;
    const msg = (/** @type {string} */ text) => ({ role: "user", content: [{ type: "text", text }] });
    const ch = a.chainForKey("k-run", { cwd: dir, client: "opencode", model: "m" });
    const { turnId } = a.beginTurn(ch.id, { requestId: "leg-1", model: "m", startedAt: 5_000, running: true, userMessage: msg("go") });
    const inner = a.chainForKey("k-run-round", { cwd: dir, client: "opencode", model: "m" });
    const { turnId: round } = a.beginTurn(inner.id, { requestId: "round-1", model: "m", startedAt: 5_100, running: true, userMessage: msg("go") });
    assert.deepEqual([a.turnMeta(turnId).running, a.turnMeta(round).running], [5_000, 5_100]);
    s.turnStopped({ id: "round-1", agentOf: "leg-1", memory: { turnId: round } });
    assert.deepEqual([a.turnMeta(turnId).running, a.turnMeta(round).running], [5_000, undefined], "the round's own turn, not the one it works for");
    s.turnStopped({ id: "leg-1", memory: { turnId } });
    assert.equal(a.turnMeta(turnId).running, undefined);
    // The client's next request of the same turn runs it again, marked when it began.
    const leg2 = a.beginTurn(ch.id, { requestId: "leg-2", model: "m", startedAt: 6_000, running: true, userMessage: msg("go") });
    assert.deepEqual([leg2.turnId, leg2.isNew, a.turnMeta(turnId).running], [turnId, false, 6_000]);
    // A record that ran no turn, or whose turn is gone, leaves the rest as it is.
    s.turnStopped({ id: "house" });
    s.turnStopped({ id: "gone", memory: { turnId: 999_999 } });
    assert.equal(a.turnMeta(turnId).running, 6_000);
    // A turn opened by no running request — imported, or Filament's own answer — carries no mark.
    const done = a.beginTurn(ch.id, { requestId: "cmd", model: "m", command: true, startedAt: 7_000, userMessage: msg("/set x") });
    assert.equal(a.turnMeta(done.turnId).running, undefined);
  });

describe("the live agent path: a round's record lands on its parent turn's facts (FA 4, 5)", () => {
  test("turnFactsAdd folds a round onto its parent's turn through the ring's lineage; the round's internal turn gets none", async () => {
    const folder = join(dir, "mem-agent");
    const turns = seedTurns(folder);
    const s = svc(folder);
    const parent = {
      id: "agent-parent", ts: new Date(1000).toISOString(), totalMs: 9000, status: "ok", stopReason: "tool_use",
      model: "agent/m", upstream: "u", agent: { model: "m" },
      tokens: { input: 9000, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0 },
      memory: { chain: "k1", turnId: turns.t1 },
      changes: ["agent: the loop ran"],
    };
    const round = {
      id: "round-1", ts: new Date(2000).toISOString(), totalMs: 800, status: "ok", stopReason: "end_turn",
      model: "m", upstream: "u", agentOf: "agent-parent",
      tokens: { input: 400, output: 60, cacheRead: 0, cacheWrite: 0, thinking: 0 }, cost: 0.03,
      memory: { chain: "w1", turnId: 424242 }, // the round's own internal chain's turn — which gets nothing (D2)
    };
    // The ring the walk reads: `records.byId`, the same store the live path reads it from.
    s.records = { byId: new Map([[parent.id, parent], [round.id, round]]) };
    s.turnFactsAdd(parent);
    s.turnFactsAdd(round);
    const f = factsOf(s, turns.t1);
    assert.ok(f, "the parent's turn has facts");
    assert.equal(f.requests, 1, "one own request");
    assert.equal(f.calls, 1, "the round's call bills; the agent parent's does not (billedByChildren)");
    assert.ok(Math.abs(f.costUsd - 0.03) < 1e-9, "the parent's own cost is carried by its child; the round's cost lands");
    assert.equal(f.stopReason, "tool_use", "the parent's stop reason stands (the round's is not the turn's)");
    assert.equal(factsOf(s, 424242), null, "the round's internal turn got no facts (D2)");
    // The order-free property on the live path too: the round first, then the parent, lands in the same place.
    const folder2 = join(dir, "mem-agent-2");
    const turns2 = seedTurns(folder2);
    const s2 = svc(folder2);
    s2.records = { byId: new Map([[parent.id, parent], [round.id, round]]) };
    s2.turnFactsAdd(round);
    s2.turnFactsAdd(parent);
    const f2 = factsOf(s2, turns2.t1);
    assert.ok(Math.abs(f2.costUsd - 0.03) < 1e-9, "the same facts either order");
    assert.equal(f2.calls, 1);
    assert.equal(factsOf(s2, 424242), null);
  });
});
});

// --- the live pipeline: facts at the end on every path, the cue's two forms, eviction, the kept and windows rows ---
import { UsageStore } from "../src/services/records.js";
import { localDay } from "../src/services/daily-usage.js";
import { createFinish } from "../src/app/finish.js";
import { SessionTurns } from "../src/services/session-turns.js";
import { upstreamControls, readEvents } from "./helpers/wait.js";

describe("one agent-loop parent against all three sites: the rollup, the spend booking and the fold (FA 3)", () => {
  test("the parent bills nowhere; a plain request bills everywhere; memory's call and Filament's answer book nowhere", async () => {
    const dir3 = mkdtempSync(join(tmpdir(), "filament-fa3-"));
    try {
      // The REAL store: its finish is the daily rollup's site; createFinish is the booking's and the fold's. What the
      // rollup counted is read off the day itself: the store hands it every record and its rule takes model calls
      // alone (HarnessV3-Launch LD-D9).
      const store = new UsageStore({ dataDir: dir3, options: { logFile: "" } });
      const today = localDay();
      const rolled = () => store.dailyStore.aggregate({ from: today, to: today }).requests;
      /** @type {string[]} */
      const booked = [];
      /** @type {string[]} */
      const folded = [];
      const memory = {
        spendAdd: (_c, e) => booked.push(e.requestId),
        sessionChainOf: (rec) => rec.memory?.chain || null,
        turnFactsAdd: (rec) => { if (booksOnSession(rec)) folded.push(rec.id); },
      };
      const finish = createFinish({
        config: { get: () => ({ upstreams: [], alerts: {} }) },
        usage: store,
        health: { recordSuccess: () => {}, recordFailure: () => {}, recordMeta: () => {} },
        liveAborts: new Map(),
        pushAlert: () => {},
        log: () => {},
        memory,
      });
      const mk = (id, extra) => {
        const r = store.start({ format: "anthropic", model: "m", upstream: "u", upstreamModel: null, stream: false, clientIp: "", ua: "" });
        Object.assign(r, { id, ...extra });
        return r;
      };
      const tokens = { input: 9000, output: 900, cacheRead: 0, cacheWrite: 0, thinking: 0 };
      // The agent-loop parent: carries the turn's tokens for the client, no billing of its own.
      const parent = mk("agent-parent", { agent: { rounds: 2 }, memory: { chain: "c1", turnId: 1 } });
      finish(parent, { status: "ok", tokens, cost: 0.9, stopReason: "end_turn" }, null);
      assert.equal(rolled(), 0, "the daily rollup adds nothing for the parent (site 1)");
      assert.deepEqual(booked, [], "the goal and spend booking adds nothing (site 2)");
      assert.deepEqual(folded, ["agent-parent"], "the fold sees the parent (site 3) — and adds no tokens, billedByChildren");
      // A plain client request: all three sites see it.
      const plain = mk("plain-1", { memory: { chain: "c1", turnId: 2 } });
      finish(plain, { status: "ok", tokens: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0, thinking: 0 }, cost: 0.01, stopReason: "end_turn" }, null);
      assert.equal(rolled(), 1, "the rollup adds the client request");
      assert.deepEqual([...new Set(booked)], ["plain-1"], "the booking books the client request (goal + spend both)");
      assert.deepEqual(folded, ["agent-parent", "plain-1"], "the fold folds it");
      // Memory's own call and Filament's answer: the booking and the fold see neither.
      const memCall = mk("mem-1", { memoryFor: { purpose: "learn" }, memory: { chain: "c1", turnId: 2 } });
      finish(memCall, { status: "ok", tokens: { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, thinking: 0 }, cost: 0.001, stopReason: "end_turn" }, null);
      const answer = mk("ans-1", { memory: { chain: "c1", turnId: 2, command: true } });
      finish(answer, { status: "ok", local: true, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0 }, cost: 0, stopReason: "end_turn" }, null);
      assert.equal(rolled(), 1, "the parent never reached the rollup, before or after — nor memory's call (its own store) or Filament's answer");
      assert.deepEqual([...new Set(booked)], ["plain-1"], "neither books on the session");
      assert.deepEqual(folded, ["agent-parent", "plain-1"], "neither reaches the fold");
    } finally {
      rmSync(dir3, { recursive: true, force: true });
    }
  });
});

describe("turn facts through the real pipeline (FA 4, 5, 6, 8, 11, 14, 15, 16)", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const SYS = { role: "system", content: "You help." };
  const person = (text) => ({ role: "user", content: [{ type: "text", text }] });
  const replyText = (m) =>
    Array.isArray(m?.content) ? m.content.filter((b) => b?.type === "text").map((b) => b.text).join("") : String(m?.content ?? "");
  const untilOf = async () => (await import("./helpers/wait.js")).until;

  // A turn whose newest message says so is refused by the model, or held until the test lets it go.
  const letGo = gate();
  before(async () => {
    up = await fakeUpstream(async (call) => {
      const asks = JSON.stringify(call.body?.messages?.at(-1) ?? null);
      if (asks.includes("refuse this turn")) return { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "messages: a bad block" } } };
      if (asks.includes("hold this turn")) await letGo.promise;
      return anthropicReply("a reply from the model", { model: "m-1" });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot.enabled = true;
      },
    });
  });
  after(async () => {
    letGo.open();
    await shim.stop();
    await up.close();
    try { rmSync(shim.dataDir, { recursive: true, force: true }); } catch {}
  });

  const chainOf = (sid) => /** @type {any} */ (shim.app.memory.archive).chainIdForKey(chainKeyForConversationId(sid));
  const zcTurn = async (sid, text) => {
    const r = await shim.post("/v1/messages", { model: "m-1", max_tokens: 100, messages: [SYS, person(text)] }, { "x-session-id": sid, "x-filament-cwd": process.cwd(), "user-agent": "opencode/1.2" });
    await r.text();
    return r;
  };
  const transcript = async (chainId) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(chainId)}/transcript`);
    assert.equal(r.status, 200);
    return r.json();
  };

  test("a JSON turn: the record closes with its facts and the transcript row carries them (FA 4, 5)", async () => {
    const sid = "fp-json";
    await zcTurn(sid, "the json turn");
    const chainId = chainOf(sid);
    assert.ok(chainId, "the session exists");
    const t = await transcript(chainId);
    const row = t.turns.find((x) => x.user && replyText(x.user).includes("the json turn"));
    assert.ok(row?.facts, "the row carries the facts");
    assert.equal(row.facts.stopReason, "end_turn");
    assert.equal(row.facts.requests, 1);
    assert.equal(row.facts.model, "m-1");
    assert.ok(row.facts.tokens.input > 0, "the tokens are the request's own");
    assert.equal(row.clientLabel, "OpenCode", "the transcript names the turn's client in the server's words (FA 14)");
  });

  // (fails before: yes — no request marked the turn it ran: HarnessV3-FailurePoints finding 3)
  test("a turn is marked running while its request runs, and its record's close clears the mark — refused or answered", async () => {
    const archive = /** @type {any} */ (shim.app.memory.archive);
    const turnOf = (/** @type {string} */ sid, /** @type {string} */ text) => {
      const chainId = chainOf(sid);
      return chainId ? archive.turnBodies(chainId).find((/** @type {any} */ t) => replyText(t.user).includes(text)) : null;
    };
    const refused = await zcTurn("fp-refused", "refuse this turn");
    assert.equal(refused.status, 400);
    const failed = turnOf("fp-refused", "refuse this turn");
    assert.deepEqual([failed?.final, failed?.meta.running], [null, undefined], "refused, with no reply, and its mark gone with its request");
    assert.equal(cutOffBefore(failed, Infinity), false, "after a restart it is not cut off: its request had failed");
    const going = zcTurn("fp-held", "hold this turn");
    const held = await until(() => turnOf("fp-held", "hold this turn"), "the held turn archived");
    assert.equal(typeof held.meta.running, "number", "marked while its request runs");
    assert.equal(cutOffBefore(held, Infinity), true, "a restart now would cut it off");
    letGo.open();
    await going;
    const answered = turnOf("fp-held", "hold this turn");
    assert.deepEqual([answered.final != null, answered.meta.running], [true, undefined]);
  });

  test("a turn whose request records left memory still shows its numbers (FA 6, FB 2)", async () => {
    const sid = "fp-evict";
    await zcTurn(sid, "the evicted turn");
    const chainId = chainOf(sid);
    const before = (await transcript(chainId)).turns.find((x) => x.user && replyText(x.user).includes("the evicted turn"));
    assert.ok(before?.requestIds?.length, "the turn names its requests");
    // The ring rolls over: the turn's records leave memory, as they do after 500 newer requests.
    const usage = /** @type {any} */ (shim.app.usage);
    for (const id of before.requestIds) {
      usage.byId.delete(id);
      usage.records.splice(usage.records.findIndex((/** @type {any} */ r) => r.id === id), 1);
      assert.equal((await shim.api(`/api/requests/${encodeURIComponent(id)}`)).status, 404, "the record is gone");
    }
    const row = (await transcript(chainId)).turns.find((x) => x.user && replyText(x.user).includes("the evicted turn"));
    assert.ok(row?.facts, "the facts ride the archived turn");
    assert.equal(row.facts.stopReason, "end_turn");
    assert.equal(row.facts.model, "m-1");
    assert.ok(row.facts.tokens.input > 0);
  });

  test("a composed harness turn carries the cue as data, and neither its reply nor its record has the sentence (FA 11)", async () => {
    // The project already holds earlier sessions (this suite's turns ran in the same folder), so the briefing of
    // a new session's first turn names them: the cue exists. A harness session's first turn is composed.
    await zcTurn("fp-cue-earlier", "an earlier session in this folder");
    const born = await shim.api("/api/sessions", { method: "POST", body: { cwd: process.cwd(), model: "m-1", title: "composed cue" } });
    assert.equal(born.status, 200);
    const chainId = (await born.json()).id;
    const r = await shim.api(`/api/sessions/${encodeURIComponent(chainId)}/turns`, { method: "POST", body: { content: "the composed turn", stream: false } });
    assert.equal(r.status, 200);
    const reply = await r.json();
    const t = await transcript(chainId);
    const row = t.turns.find((x) => x.user && replyText(x.user).includes("the composed turn"));
    assert.ok(row?.requestIds?.length, "the harness turn is on the transcript");
    const rec = await (await shim.api(`/api/requests/${encodeURIComponent(row.requestIds[0])}`)).json();
    assert.equal(typeof rec.memory?.cue, "object", "the cue rides the turn's own record as data (the loop's ticks follow it)");
    assert.ok(rec.memory.cue.sessions.length >= 1, "it names the earlier sessions here");
    // A session with no stored title — an outside client's — rides the record by its id alone: its first words never do
    // (the bug hunt of 10-27: the record counts and never quotes, and an outside client's cue sentence said them). The
    // page names it as its sessions list does, from that list (HarnessV4_Tasks U4: cards.js `memoryNoteEl`, the
    // Memory widget).
    const earlier = rec.memory.cue.sessions.find((/** @type {any} */ s) => s.id === chainOf("fp-cue-earlier"));
    assert.ok(earlier, "the earlier session is named");
    assert.equal(earlier.title, "", "no title: none on the record");
    assert.ok(!JSON.stringify(rec.memory.cue).includes("an earlier session in this folder"), "its first words are not on the record");
    assert.notEqual(rec.memory.cuePlaced, true, "a composed turn never places the sentence");
    const said = replyText(reply) + replyText(row.final);
    assert.ok(!said.includes("earlier session") && !said.includes("@mem load"), `no cue sentence reached the reply: ${said.slice(0, 160)}`);
    assert.deepEqual(row.facts?.memory?.related?.sessions?.map((/** @type {any} */ s) => s.id), rec.memory.cue.sessions.map((/** @type {any} */ s) => s.id), "the facts carry what the harness draws its memory note from");
  });

  test("an orphan child record (its ancestry is gone) writes no facts anywhere and is said in the log (FA 4)", async () => {
    const s = /** @type {any} */ (shim.app.memory);
    // The internal chain's turn a worker or a round names: the one place an orphan must never fall back to.
    const internal = s.archive.chainForKey("fp-orphan-internal", { cwd: process.cwd(), client: "filament", model: "m-1" });
    const { turnId } = s.archive.beginTurn(internal.id, { requestId: "orphan-own", model: "m-1", userMessage: { role: "user", content: [{ type: "text", text: "a worker's brief" }] } });
    s.archive.finishTurn(turnId, { finalMessage: { role: "assistant", content: [{ type: "text", text: "done" }] }, requestId: "orphan-own" });
    const orphan = { id: "orphan-1", ts: new Date().toISOString(), totalMs: 10, status: "ok", stopReason: "end_turn", model: "m-1", upstream: "u", tokens: { input: 5, output: 1, cacheRead: 0, cacheWrite: 0, thinking: 0 }, cost: 0.01, agentOf: "gone-parent", memory: { chain: internal.key, turnId } };
    /** @type {string[]} */
    const said = [];
    const log = s.log;
    s.log = (/** @type {string} */ level, /** @type {string} */ msg) => { said.push(`${level}: ${msg}`); };
    try {
      s.turnFactsAdd(orphan);
    } finally {
      s.log = log;
    }
    assert.equal(s.archive.turnMeta(turnId)?.facts, undefined, "the internal turn got no facts");
    assert.ok(said.some((l) => l.startsWith("warn") && l.includes("orphan-1") && /ancestry could not be followed/.test(l)), said.join(" | "));
  });

  // (the owner's of 11-07: there are no presets, so no presetStatus: where each value comes from is the sources' word)
  test("a knob set on the chat rides the transcript's settings as the session's own (FA 15)", async () => {
    const sid = "fp-kept";
    await zcTurn(sid, "warm the kept session");
    const chainId = chainOf(sid);
    const set = await shim.api(`/api/sessions/${encodeURIComponent(chainId)}/settings`, { method: "PATCH", body: { patch: { loop: { resultCapChars: 9000 } } } });
    assert.equal(set.status, 200);
    const t = await transcript(chainId);
    assert.equal(t.settings.sources["loop.resultCapChars"], "session");
    assert.equal("presetStatus" in t.settings, false);
  });

  test("SessionTurns stamps holderLabel's words on every snapshot when given labelOf (FA 14)", async () => {
    const turns = new SessionTurns({ labelOf: (h) => (h.window === "harness" ? "the harness" : String(h.client)) });
    const a = await turns.acquire("h:k", { window: "move", client: "the move to another folder" });
    assert.ok(a.ok);
    assert.equal(turns.holder("h:k")?.label, "the move to another folder", "a chat's move reads its own words");
    const b = await turns.acquire("h:h", { window: "harness" });
    assert.ok(b.ok);
    assert.equal(turns.holder("h:h")?.label, "the harness", "the harness's window reads the harness");
    // holders() carries the words too (the route's rows, D11).
    assert.equal(turns.holders().find((h) => h.key === "h:h")?.label, "the harness");
  });

});

describe("the review round on the live app: facts at the end on the streaming and command paths, the topic's words, undo's round trip (FA 5, 8, 9, 14)", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const controls = upstreamControls();
  const SYS = { role: "system", content: "You help." };
  const person = (text) => ({ role: "user", content: [{ type: "text", text }] });
  const replyText = (m) =>
    Array.isArray(m?.content) ? m.content.filter((b) => b?.type === "text").map((b) => b.text).join("") : String(m?.content ?? "");
  const readEventsOf = async () => (await import("./helpers/wait.js")).readEvents;
  const untilOf = async () => (await import("./helpers/wait.js")).until;

  before(async () => {
    up = await fakeUpstream(() => anthropicReply("a streamed reply from the model", { model: "m-1" }));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      },
    });
  });
  after(async () => {
    controls.letGo();
    await shim.stop();
    await up.close();
    try { rmSync(shim.dataDir, { recursive: true, force: true }); } catch {}
  });

  const chainOf = (sid) => /** @type {any} */ (shim.app.memory.archive).chainIdForKey(chainKeyForConversationId(sid));
  const zcTurn = async (sid, text) => {
    const r = await shim.post("/v1/messages", { model: "m-1", max_tokens: 100, messages: [SYS, person(text)] }, { "x-session-id": sid, "x-filament-cwd": process.cwd(), "user-agent": "opencode/1.2" });
    await r.text();
    return r;
  };
  const transcript = async (chainId) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(chainId)}/transcript`);
    assert.equal(r.status, 200);
    return r.json();
  };

  test("a streamed turn: the first transcript read after the client's stream ends sees the facts (FA 5, streaming path)", async () => {
    const sid = "rv-stream";
    const r = await shim.post("/v1/messages", { model: "m-1", max_tokens: 100, stream: true, messages: [SYS, person("the streamed turn")] }, { "x-session-id": sid, "x-filament-cwd": process.cwd(), "user-agent": "opencode/1.2" });
    assert.equal(r.status, 200);
    const body = await r.text();
    assert.ok(body.includes("a streamed reply from the model"), "the stream completed");
    const chainId = chainOf(sid);
    const t = await transcript(chainId);
    const row = t.turns.find((x) => x.user && replyText(x.user).includes("the streamed turn"));
    assert.ok(row?.facts, "the streaming turn's facts exist the moment the reply ends");
    assert.equal(row.facts.stopReason, "end_turn");
  });

  test("the events feed says the holder's words and the turn's end — the holder gone — and the first transcript read after it has the facts (FA 5, 14)", async () => {
    const readEvents = await readEventsOf();
    const until = await untilOf();
    // A harness chat: its turn holds the chat while it runs (an outside client's turn holds none, and says nothing there)
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: process.cwd(), model: "m-1", preset: "plain" } });
    assert.equal(created.status, 200);
    const chainId = String((await created.json()).id);
    const harnessTurn = async (/** @type {string} */ content) => (await shim.api(`/api/sessions/${encodeURIComponent(chainId)}/turns`, { method: "POST", body: { content, stream: false } })).text();
    await harnessTurn("warm");
    const res = await shim.api("/api/events");
    assert.equal(res.status, 200);
    const events = readEvents(res);
    await until(() => events.events.some((e) => e.data?.type === "hello"), "the feed to open");
    await harnessTurn("the feed-watched turn");
    const evs = () => events.events.filter((e) => e.data?.type === "turn" && e.data.chainId === chainId);
    await until(() => evs().some((e) => e.data.holder) && evs().at(-1)?.data.holder === null, "the feed's holder, then its going");
    const holderEvents = evs().filter((e) => e.data.holder);
    assert.ok(holderEvents.length, "holder changes were published");
    // The feed's holder IS the lock's snapshot: its `label` is the words a page shows for it (FA 14). The 409 and the
    // holders route carry the same snapshot (pinned server-side).
    assert.equal(holderEvents.at(-1).data.holder.label, "the harness", "the live holder's words (D13)");
    const t = await transcript(chainId);
    const row = t.turns.find((x) => x.user && replyText(x.user).includes("the feed-watched turn"));
    assert.ok(row?.facts, "the feed's reader found the facts written");
    await events.stop();
  });

  test("running a card's Undo through the chat restores exactly (FA 9)", async () => {
    const until = await untilOf();
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: process.cwd(), model: "m-1", preset: "plain" } });
    assert.equal(created.status, 200);
    const chainId = String((await created.json()).id);
    await shim.api(`/api/sessions/${encodeURIComponent(chainId)}/turns`, { method: "POST", body: { content: "/set context.view.stubChars 200", stream: false } });
    await until(async () => {
      const t = await transcript(chainId);
      return t.turns.find((x) => x.command && x.card) || null;
    }, "the command turn with its card");
    const t = await transcript(chainId);
    const cmdTurn = t.turns.find((x) => x.command);
    const undo = cmdTurn.card.actions?.[0];
    assert.ok(undo?.command, "the card offers its undo");
    await shim.api(`/api/sessions/${encodeURIComponent(chainId)}/turns`, { method: "POST", body: { content: undo.command, stream: false } });
    const { flatten } = await import("../src/services/session-settings.js");
    const layer = flatten(/** @type {any} */ (shim.app.memory).archive.chainSettings(chainId));
    assert.equal(layer["context.view.stubChars"], undefined, "the undo removed the session's value — the layers below hold 160 again");
  });

  // (fails before: yes — the owner's rule of 10-31: a client's chat is a session of its own, yet every row carried the
  // ids of the clients whose windows ran turns on it, their words, and whether more than one had)
  test("the session list names a chat's client, and no clients it is shared with (FA 14)", async () => {
    const sid = "rv-list";
    await zcTurn(sid, "one");
    await zcTurn(sid, "two");
    const chainId = chainOf(sid);
    const r = await shim.api("/api/memory/sessions");
    assert.equal(r.status, 200);
    const out = await r.json();
    const list = Array.isArray(out) ? out : out.sessions || out.chains || [];
    const row = list.find((x) => x.id === chainId);
    assert.ok(row, `the session's row; got: ${JSON.stringify(list.map((x) => x.id)).slice(0, 400)}`);
    assert.equal(row.client, "opencode");
    assert.deepEqual(["clients", "clientLabels", "shared"].filter((k) => k in row), [], "no session is shared with a client");
    // Its last moment whole beside the day (E35 S1: a lane's "idle · 14h" read the day as UTC midnight).
    assert.match(row.when, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Number.isInteger(row.lastAt) && Math.abs(Date.now() - row.lastAt) < 3_600_000, String(row.lastAt));
  });
});

// (fails before: yes — HarnessV4_Tasks C26: nothing in a turn's facts said whether its coding agent's session was ever
// up, so a turn stopped as the session opened read as one the agent held, and the next message was asked about a lost
// session there had never been)
test("a turn's facts say whether it ran in a session of its coding agent: its newest request's; null for a model Filament calls", () => {
  const stopped = foldTurnFacts(null, rec({ start: 1000, own: true, stopReason: "cancelled", acp: { sessionId: null } }), { own: true });
  assert.equal(stopped.agentSession, false, "stopped before its session was up");
  const ran = foldTurnFacts(null, rec({ start: 1000, own: true, acp: { sessionId: "s-1" } }), { own: true });
  assert.equal(ran.agentSession, true);
  assert.equal(foldTurnFacts(null, rec({ start: 1000, own: true }), { own: true }).agentSession, null, "no coding agent ran it");
  // The newest own request's word stands, whichever finishes first.
  const a = rec({ start: 1000, ms: 100, own: true, acp: { sessionId: null } }), b = rec({ start: 2000, ms: 100, own: true, acp: { sessionId: "s-2" } });
  assert.equal(foldTurnFacts(foldTurnFacts(null, a, { own: true }), b, { own: true }).agentSession, true);
  assert.equal(foldTurnFacts(foldTurnFacts(null, b, { own: true }), a, { own: true }).agentSession, true);
});

// (fails before: yes — HarnessV4_Tasks C13: a coding agent's record held the models it counted its tokens on
// (`acp.modelUsage`), and the turn's facts kept one name, the model the turn asked for)
test("a turn's facts keep the models its coding agent counted its tokens on, summed by model, the same in any order", () => {
  const first = rec({ start: 1000, own: true, upstreamModel: "claude-fable-5-1[1m]-max", acp: { modelUsage: [
    { model: "claude-fable-5-1", input: 100, output: 4000, cacheRead: 200000, cacheWrite: 90000 },
    { model: "claude-opus-5", input: 56, output: 4100, cacheRead: 198000, cacheWrite: 5000 },
  ] } });
  const second = rec({ start: 5000, own: true, upstreamModel: "claude-fable-5-1[1m]-max", acp: { modelUsage: [
    { model: "claude-opus-4-8", input: 2, output: 3020, cacheRead: 0, cacheWrite: 210000 },
    { model: "claude-fable-5-1", input: 14, output: 3012, cacheRead: 201000, cacheWrite: 77000 },
  ] } });
  const want = [
    { model: "claude-fable-5-1", input: 114, output: 7012, cacheRead: 401000, cacheWrite: 167000 },
    { model: "claude-opus-5", input: 56, output: 4100, cacheRead: 198000, cacheWrite: 5000 },
    { model: "claude-opus-4-8", input: 2, output: 3020, cacheRead: 0, cacheWrite: 210000 },
  ];
  const ab = foldTurnFacts(foldTurnFacts(null, first, { own: true }), second, { own: true });
  const ba = foldTurnFacts(foldTurnFacts(null, second, { own: true }), first, { own: true });
  assert.deepEqual(ab.models, want, "most written first");
  assert.deepEqual(ba.models, want, "whichever record finished first");
  assert.equal(ab.model, "claude-fable-5-1[1m]-max", "the model the turn asked for is still its model");
  // A record with no count from an agent leaves what stands; a turn with none has none.
  assert.deepEqual(foldTurnFacts(ab, rec({ start: 6000, own: true }), { own: true }).models, want);
  assert.equal(foldTurnFacts(null, rec({ start: 1000, own: true }), { own: true }).models, null);
});
