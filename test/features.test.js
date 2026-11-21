// @ts-check
// HarnessV2 Phase 6 (§10.6) — the Feature board and replay-compare: the board pure over a config, a request ring, an
// archive and a session's truth; then end to end — a native session's last turns replayed on a copy under other settings,
// followed through its run, the two sides' numbers in the summary, the original untouched.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { featureBoard } from "../src/app/features.js";
import { SECTIONS } from "../src/ui/harness/settings/page.js";
import { sideOf, totalsOf } from "../src/app/sessions/replay-compare.js";
import { RUN_EVENT_TYPE_LIST } from "../src/services/runs.js";

describe("featureBoard — pure", () => {
  const cfg = {
    rules: { translate: { mode: "auto" }, autofit: { enabled: true } },
    memory: { enabled: true, autopilot: { enabled: true } },
    agentLoop: { enabled: true, permissions: "edit" },
    upstreams: [{ id: "oa", type: "openai-compatible", enabled: true }, { id: "an", type: "anthropic", enabled: true }],
    routes: [{ match: "brain-*", upstream: "oa", upstreamModel: "{model}", enabled: true }, { match: "claude-*", upstream: "an", upstreamModel: "{model}", enabled: true }],
  };
  const records = [
    { id: "a", ts: "2026-09-23T00:00:00Z", status: "ok", translatedFormats: "anthropic -> openai", memory: { chain: "c1", injected: 2 } },
    { id: "b", ts: "2026-09-23T00:01:00Z", status: "ok" },
    { id: "c", ts: "2026-09-23T00:02:00Z", status: "ok", agent: { status: "done" }, memory: { chain: "c2" } },
    { id: "d", ts: "2026-09-23T00:03:00Z", status: "pending" },
    { id: "e", ts: "2026-09-23T00:04:00Z", status: "ok", memoryFor: { purpose: "digest" } },
    { id: "f", ts: "2026-09-23T00:05:00Z", status: "ok", memoryFor: { purpose: "compact" } },
  ];
  const archive = {
    counts: () => ({ injections: 12, compactions: 5 }),
    chainCounts: () => ({ byKind: { interactive: 9, fork: 3, subagent: 4 }, withSettings: 6, compactionsByKind: { plain: 3, brief: 2 } }),
  };
  test("six features; switches read the config; counts come from the ring (own, finished requests) and the archive; no session → session column empty", () => {
    const b = featureBoard({ cfg, records, archive, session: null });
    assert.deepEqual(b.features.map((f) => f.id), ["translation", "memory", "compaction", "session-config", "loop", "fork"]);
    assert.equal(b.window.records, 3, "pending and memory's own calls are not the owner's traffic");
    /** @type {Record<string, any>} */
    const by = Object.fromEntries(b.features.map((f) => [f.id, f]));
    assert.equal(by.translation.switch.on, true); assert.equal(by.translation.count.value, 1); assert.equal(by.translation.session, null);
    assert.equal(by.memory.switch.value, "On, with recall in every request"); // in words since HarnessV3-Launch LD-D10 assert.equal(by.memory.count.value, 12); assert.equal(by.memory.count.source, "archive");
    // (fails before: yes — the owner's rules of 10-31: the switch was rules.trim.enabled, /trim answering a client's compaction)
    assert.equal(by.compaction.switch.value, "Always on in a chat Filament runs · /compact and /autofit on command"); assert.equal(by.compaction.count.value, 5); assert.match(by.compaction.count.what, /3 plain, 2 brief/);
    assert.equal(by["session-config"].count.value, 6);
    // The loop is always on (the owner's of 11-09): no switch turns it off, so its row says so.
    assert.equal(by.loop.switch.value, "Always on, in edit mode by default"); assert.equal(by.loop.count.value, 1);
    assert.equal(by.fork.count.value, 3);
    // (fails before: yes — the owner's of 11-09: Records was #/settings/records, a section Settings has not, so it opened
    // General) Every row points at a screen there is: a Settings section, the sessions, or the console's Records.
    const screens = new Set(["#/", ...SECTIONS.map((s) => `#/settings/${s.id}`)]);
    for (const f of b.features) assert.ok(screens.has(f.evidence.href) || f.evidence.href === "/ui/#requests", `${f.id}: ${f.evidence.href}`);
    assert.deepEqual(b.features.filter((f) => f.evidence.label === "Records").map((f) => f.id), ["translation", "session-config", "loop"]);
    assert.ok(b.features.filter((f) => f.evidence.label === "Records").every((f) => f.evidence.href === "/ui/#requests"), "the console's Records, as About links it");
    assert.ok(b.features.every((f) => f.compare === null), "no session, no replay-compare");
  });
  test("with a session: translating or not by the route's upstream, muted or on, the way it makes room, the layer's knobs, the loop's mode, forked-from", () => {
    const truth = {
      identity: { models: ["brain-x"], fork: { from: "src1", atTurn: 4 }, forks: 1 },
      inForce: { muted: false, permissions: null },
      activity: { compactions: { total: 2, byKind: { plain: 2 } }, toolLegs: 0, trim: { count: 0 } },
      memory: { briefing: true, briefingItems: 5, injections: { total: 4, used: 2 }, items: { total: 7 } },
    };
    const settings = { effective: { model: { name: "brain-x" }, memory: { enabled: true }, context: { compaction: { method: "fold", keepWhole: 2 }, results: "pointer" }, loop: { permissions: "edit", rules: [] }, hooks: [], fork: { transcript: "ditto", settings: "inherit" } }, sources: { "context.compaction.method": "session", "context.results": "session", "memory.enabled": "global" }, hash: "h123" };
    const b = featureBoard({ cfg, records, archive, session: { id: "s1", truth, settings } });
    /** @type {Record<string, any>} */
    const by = Object.fromEntries(b.features.map((f) => [f.id, f]));
    assert.equal(b.session, "s1");
    assert.equal(by.translation.session.on, true); assert.match(by.translation.session.detail, /anthropic → openai for oa/);
    const unrouted = featureBoard({ cfg, records, archive, session: { id: "s0", truth: { ...truth, identity: { models: ["gone-model"], forks: 0 } }, settings: { ...settings, effective: { ...settings.effective, model: { name: "gone-model" } } } } });
    assert.deepEqual(unrouted.features.find((x) => x.id === "translation")?.session, { on: null, state: "no route for this session's model" });
    assert.equal(by.memory.session.on, true); assert.match(by.memory.session.detail, /briefing of 5 items · 4 injections \(2 used\) · 7 items learned/);
    assert.equal(by.compaction.session.state, "Instant fold, newest 2 whole", "the way it makes room, by its name"); assert.match(by.compaction.session.detail, /2 compactions \(2 plain\)/);
    assert.equal(by["session-config"].session.state, "2 settings chosen for this session"); // "setting", not "knob", since LD-D10
    assert.match(by["session-config"].session.detail, /document h123/);
    assert.deepEqual(by.loop.session, { on: false, state: "a plain model (no hands)" });
    assert.equal(by.fork.session.on, true); assert.equal(by.fork.session.state, "forked from src1 at turn 4");
    assert.ok(by.compaction.compare && by.memory.compare && by.fork.compare, "replay-compare offered where other settings change the outcome");
    // A muted Plain session on an anthropic route with the loop.
    const plain = featureBoard({ cfg, records, archive, session: { id: "s2", truth: { ...truth, identity: { models: ["agent/claude-3"], forks: 0 }, inForce: { muted: true, permissions: "read-only" } }, settings: { effective: { model: { name: "agent/claude-3" }, memory: { enabled: false }, context: { strategy: "plain" }, loop: { permissions: "read-only", rules: [{}] }, hooks: [{}, {}], fork: { transcript: "ditto", settings: "inherit" } }, sources: {}, hash: "p" } } });
    /** @type {Record<string, any>} */
    const p = Object.fromEntries(plain.features.map((f) => [f.id, f]));
    assert.equal(p.translation.session.on, false); assert.match(p.translation.session.detail, /speaks the harness's format/);
    assert.equal(p.memory.session.state, "muted");
    assert.equal(p.loop.session.on, true); assert.equal(p.loop.session.state, "read-only mode"); assert.match(p.loop.session.detail, /1 rule · 2 hooks · 0 tool legs/);
    assert.equal(p["session-config"].session.state, "global and project layers only");
  });
  test("without an archive (memory off) the counts fall back to the ring and say so", () => {
    const b = featureBoard({ cfg: { ...cfg, memory: { enabled: false } }, records, archive: null, session: null });
    /** @type {Record<string, any>} */
    const by = Object.fromEntries(b.features.map((f) => [f.id, f]));
    assert.equal(by.memory.switch.on, false); assert.equal(by.memory.count.value, 1); assert.equal(by.memory.count.source, "records");
    // (fails before: yes — the ring's count was the requests /trim acted on; it is Filament's own compaction calls)
    assert.deepEqual([by.compaction.count.value, by.compaction.count.source], [1, "records"]); assert.equal(by["session-config"].count.value, 0); assert.equal(by.fork.count.value, 0);
  });
  test("sideOf and totalsOf: a record's numbers on one side, summed over rows; a missing record is all nulls", () => {
    const s = sideOf({ id: "x", status: "ok", view: { sentTokens: 120, historyTokens: 300, form: "fold+2" }, tokens: { input: 130, output: 20, cacheRead: 50 }, cost: 0.002, totalMs: 900 });
    assert.deepEqual(s, { requestId: "x", status: "ok", sentTokens: 120, historyTokens: 300, inputTokens: 130, outputTokens: 20, cacheReadTokens: 50, costUsd: 0.002, ms: 900, form: "fold+2" });
    assert.equal(sideOf({ id: "a", status: "ok", cost: 0, agent: { spentUsd: 0.0057 } }).costUsd, 0.0057, "an agent turn costs what its loop spent");
    assert.equal(sideOf(null).requestId, null); assert.equal(sideOf(null, 5).ms, 5);
    assert.deepEqual(totalsOf([s, sideOf({ id: "y", tokens: { input: 70 }, cost: 0.001 }, 100)]), { sentTokens: 120, inputTokens: 200, outputTokens: 20, cacheReadTokens: 50, costUsd: 0.003, ms: 1000, turns: 2 });
    assert.ok(RUN_EVENT_TYPE_LIST.includes("replay-turn"), "the run event is in the registry");
  });
});

describe("replay-compare — end to end", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  let calls = 0;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-replay-"));
    up = await fakeUpstream(async (call) => {
      calls++;
      const last = String(call.body?.messages?.at(-1)?.content || "");
      return anthropicReply(`answer to "${last.slice(0, 30)}" (${call.body.messages.length} messages)`, { model: "brain-model", usage: { input_tokens: 10 * call.body.messages.length, output_tokens: 8 } });
    });
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
  /** @param {Record<string, any>} [settings] */
  const create = async (settings = undefined) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "brain-model", title: "replay source", ...(settings ? { settings } : {}) } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return (await r.json()).id;
  };
  const turn = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return String(r.headers.get("x-filament-request-id"));
  };
  const runDone = async (runId) => {
    for (let i = 0; i < 200; i++) {
      const run = await (await shim.api(`/api/runs/${encodeURIComponent(runId)}`)).json();
      const status = run?.status || run?.run?.status;
      if (status && status !== "running") return run.run || run;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.fail("the replay-compare run did not end");
  };

  test("the last two of three turns replay on a fork under other settings: 202 with the run and the copy, one replay-turn per turn, both sides in the summary, the original untouched", async () => {
    const id = await create();
    const originals = [];
    for (const text of ["first: list the plan", "second: refine it", "third: summarise"]) originals.push(await turn(id, text));
    calls = 0;
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/replay-compare`, { method: "POST", body: { settings: { memory: { enabled: false } }, turns: 2 } });
    if (res.status !== 202) assert.fail(await res.text());
    const started = await res.json();
    assert.ok(started.runId && started.forkId && started.forkId !== id);
    assert.equal(started.atTurn, 1); assert.deepEqual(started.turns, [2, 3]); assert.equal(started.under, "memory.enabled false");
    const run = await runDone(started.runId);
    assert.equal(run.status, "done", JSON.stringify(run));
    assert.equal(run.kind, "replay-compare");
    const sum = run.summary;
    assert.equal(sum.replayed, 2); assert.equal(sum.fork, started.forkId); assert.equal(sum.source, id);
    assert.deepEqual(sum.rows.map((r) => [r.n, r.status]), [[2, "ok"], [3, "ok"]]);
    assert.deepEqual(sum.rows.map((r) => r.original.requestId), originals.slice(1), "each row's original is that turn's request");
    assert.ok(sum.rows.every((r) => r.replay.requestId && r.replay.requestId !== r.original.requestId && r.replay.status === "ok"));
    assert.ok(sum.rows.every((r) => r.original.inputTokens > 0 && r.replay.inputTokens > 0), "both sides have what the upstream billed");
    assert.equal(sum.rows[0].replay.form, "plain", "the copy sends its turns whole, as every chat does until a compaction");
    assert.equal(sum.totals.original.turns, 2); assert.equal(sum.totals.replay.turns, 2);
    assert.equal(sum.totals.replay.inputTokens, sum.rows[0].replay.inputTokens + sum.rows[1].replay.inputTokens);
    assert.equal(calls, 2, "two model calls: the two replayed turns");
    const events = (await (await shim.api(`/api/runs/${encodeURIComponent(started.runId)}/events?limit=100`)).json()).events || [];
    assert.deepEqual(events.filter((e) => e.type === "replay-turn").map((e) => e.n), [2, 3]);
    // The copy: turn 1 inherited, turns 2 and 3 replayed, memory off; the original: still three turns, memory on.
    const fork = await (await shim.api(`/api/sessions/${encodeURIComponent(started.forkId)}/transcript`)).json();
    assert.equal(fork.turns.length, 3); assert.equal(fork.kind, "fork");
    const settingsOf = async (/** @type {string} */ sid) => (await shim.api(`/api/sessions/${encodeURIComponent(sid)}/settings`)).json();
    assert.equal((await settingsOf(started.forkId)).flat["memory.enabled"], false);
    assert.equal(fork.meta?.replayOf?.from, id); assert.equal(fork.meta?.replayOf?.under, "memory.enabled false");
    const src = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    assert.equal(src.turns.length, 3); assert.equal((await settingsOf(id)).flat["memory.enabled"], true);
    assert.equal(src.turns[2].requestIds[0], originals[2], "the original's turns keep their requests");
  });

  test("replaying every turn opens a fresh copy (no turn to fork at); more turns than exist are clamped; settings no chat may hold and a missing session are refused", async () => {
    const id = await create();
    await turn(id, "only one turn");
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/replay-compare`, { method: "POST", body: { settings: { context: { results: "status" } }, turns: 5 } });
    if (res.status !== 202) assert.fail(await res.text());
    const started = await res.json();
    assert.equal(started.atTurn, 0); assert.deepEqual(started.turns, [1]);
    const run = await runDone(started.runId);
    assert.equal(run.status, "done", JSON.stringify(run.summary));
    assert.equal(run.summary.replayed, 1);
    const fork = await (await shim.api(`/api/sessions/${encodeURIComponent(started.forkId)}/transcript`)).json();
    assert.equal(fork.turns.length, 1, "the copy holds the one replayed turn"); const own = await (await shim.api(`/api/sessions/${encodeURIComponent(started.forkId)}/settings`)).json();
    assert.equal(own.flat["context.results"], "status", "the copy carries the settings it replays under"); assert.equal(own.sources["context.results"], "session"); assert.equal(fork.kind, "fork");
    const bad = await shim.api(`/api/sessions/${encodeURIComponent(id)}/replay-compare`, { method: "POST", body: { settings: { context: { results: "no-such-form" } }, turns: 1 } });
    assert.equal(bad.status, 400, "a value no chat may hold");
    const none = await shim.api(`/api/sessions/nope/replay-compare`, { method: "POST", body: { turns: 1 } });
    assert.equal(none.status, 404);
  });

  // (fails before: yes — HarnessV4_Tasks C26: the copy's first turn was answered 409 with the question a person
  // answers, and the replay ended in error)
  test("a replay whose copy is past its line makes room by the copy's method and finishes: nobody is at the page to answer a question, and the copy still asks a person", async () => {
    const id = await create({ context: { compaction: { model: "brain-model", method: "summary", keepWhole: 0 } } });
    await turn(id, `first: read this report. ${"lorem ipsum dolor ".repeat(8000)}`);
    for (const text of ["second: refine it", "third: summarise"]) await turn(id, text);
    // The line drawn under what turn 1 weighs (~24,000 tokens, beside the loop's own part): the copy forked after it
    // starts past it, and once summarized is under it. 10% of the 200,000 window until the loop's part neared 20,000
    // with the Space's drafts (HarnessV4_Space_Plan S5c): summarized, the copy was past it again.
    const set = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { context: { compaction: { thresholdPercent: 15 } } } } });
    if (set.status !== 200) assert.fail(await set.text());
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/replay-compare`, { method: "POST", body: { turns: 2 } });
    if (res.status !== 202) assert.fail(await res.text());
    const started = await res.json();
    const run = await runDone(started.runId);
    assert.equal(run.status, "done", JSON.stringify(run.summary || run));
    assert.deepEqual(run.summary.rows.map((r) => [r.n, r.status]), [[2, "ok"], [3, "ok"]]);
    const fork = await (await shim.api(`/api/sessions/${encodeURIComponent(started.forkId)}/transcript`)).json();
    assert.equal(fork.turns.length, 3);
    const made = (fork.boundaries || []).filter((/** @type {any} */ b) => b.type === "compaction");
    assert.deepEqual(made.map((/** @type {any} */ b) => b.method), ["summary"], "room was made once, as the copy's first replayed turn began");
    const eff = (await (await shim.api(`/api/sessions/${encodeURIComponent(started.forkId)}/settings`)).json()).effective;
    assert.equal(eff.context.compaction.mode, "ask", "the copy's own settings stand: a message a person sends into it is asked");
  });

  test("a turn Filament answered itself (`@mem status`) is not replayed: the model's newest turn is, and the fork keeps the command turn it saw", async () => {
    const id = await create();
    await turn(id, "first: a model turn");
    await turn(id, "@mem status");
    await turn(id, "third: another model turn");
    await turn(id, "@mem status");
    const src = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    assert.deepEqual(src.turns.map((t) => !!t.command), [false, true, false, true], "the command turns are on record as Filament's");
    calls = 0;
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/replay-compare`, { method: "POST", body: { defaults: true, turns: 1 } });
    if (res.status !== 202) assert.fail(await res.text());
    const started = await res.json();
    assert.equal(started.under, "your defaults");
    assert.deepEqual(started.turns, [3], "the newest model turn, not the newest turn");
    assert.equal(started.atTurn, 2, "the fork holds turns 1–2: the model turn and the command turn it saw");
    const run = await runDone(started.runId);
    assert.equal(run.status, "done", JSON.stringify(run.summary));
    assert.deepEqual(run.summary.rows.map((r) => [r.n, r.status]), [[3, "ok"]]);
    assert.ok(run.summary.rows[0].original.inputTokens > 0 && run.summary.rows[0].replay.inputTokens > 0, "both sides are model calls");
    assert.equal(calls, 1, "one model call: the replayed turn");
    const onlyCommands = await create();
    await turn(onlyCommands, "@mem status");
    const bad = await shim.api(`/api/sessions/${encodeURIComponent(onlyCommands)}/replay-compare`, { method: "POST", body: { turns: 1 } });
    assert.equal(bad.status, 400); assert.match((await bad.json()).error, /no finished model turns/);
  });

  test("the board over the live app: every row has a number, the open session's column is filled", async () => {
    const id = await create({ context: { compaction: { method: "fold", keepWhole: 2 } } });
    await turn(id, "a turn for the board");
    const board = await (await shim.api(`/api/features?session=${encodeURIComponent(id)}`)).json();
    assert.equal(board.session, id); assert.equal(board.features.length, 6);
    assert.ok(board.features.every((f) => typeof f.count.value === "number"), "every feature has a number next to it");
    const by = Object.fromEntries(board.features.map((f) => [f.id, f]));
    assert.equal(by.compaction.session.state, "Instant fold, newest 2 whole"); assert.equal(by.translation.session.on, false);
    assert.equal(by.memory.session.state, "on", "a new chat keeps memory on (HarnessV3-AtHome AH-D8)");
    assert.match(by["session-config"].session.state, /^[0-9]+ settings? chosen for this session$/, by["session-config"].session.state);
    assert.ok(by.fork.count.value >= 2, "the forks the replays made are counted");
    const bare = await (await shim.api("/api/features")).json();
    assert.equal(bare.session, null); assert.ok(bare.features.every((f) => f.session === null));
  });
});
