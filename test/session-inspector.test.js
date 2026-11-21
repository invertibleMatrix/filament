// The session inspector's backend (WP-S): sessionTruth over the archive, the policies and the session's records; the
// override rows and their audit; the request list; and what a session without records still shows.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive } from "../src/services/memory/archive.js";
import { SessionPolicies } from "../src/services/memory/policy.js";
import { sessionTruth, trafficOf } from "../src/services/memory/truth.js";
import { chainKeyForConversationId } from "../src/services/memory/brain.js";
import { startApp, fakeUpstream } from "./helpers/app.js";

const dir = mkdtempSync(join(tmpdir(), "filament-truth-"));
let seq = 0;
const opened = [];
let clock = 1_758_100_000_000;
const now = () => (clock += 1000);
const open = () => {
  const a = new Archive({ file: join(dir, `t${++seq}.db`), now });
  opened.push(a);
  return a;
};
after(() => {
  for (const a of opened) a.close();
  rmSync(dir, { recursive: true, force: true });
});
const user = (text) => ({ role: "user", content: [{ type: "text", text }] });
const final = (text) => ({ role: "assistant", content: [{ type: "text", text }] });
function turn(a, chainId, text, answer) {
  const req = `r${++seq}`;
  const { turnId } = a.beginTurn(chainId, { requestId: req, model: "big-model", upstream: "u", userMessage: user(text) });
  a.addWork(turnId, [{ role: "assistant", content: [{ type: "tool_use", id: "t" + turnId, name: "bash", input: {} }] }]);
  a.finishTurn(turnId, { finalMessage: final(answer), requestId: req + "c" });
  return turnId;
}
const policiesFor = (a, config = {}) =>
  new SessionPolicies({ archive: () => a, archiveWhy: () => "Memory has not started.", config: () => config, now, enabled: () => true, summarizerModel: () => "cheap" });
/** A finished client record on the chain. */
const rec = (chain, over = {}) => ({
  id: `req_${++seq}`,
  ts: new Date(now()).toISOString(),
  status: "done",
  model: "big-model",
  tokens: { input: 1000, output: 100, cacheRead: 3000, cacheWrite: 0, thinking: 0 },
  cost: 0.01,
  memory: { chain, briefing: 2, injected: 3, tokens: 400 },
  view: { historyTokens: 20000, sentTokens: 8000, foldedTurns: 5, totalTurns: 7, stubs: 9, rawTurns: 2, thinTurns: 0 },
  ...over,
});

describe("trafficOf", () => {
  test("splits a session's records into its own, its children and memory's cheap calls, and never mixes their money", () => {
    const own = [rec("c1"), rec("c1", { cost: null, status: "error", tokens: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0 } })];
    const cheap = [
      { id: "m1", ts: "2026-01-01T00:00:00Z", status: "done", memoryFor: { purpose: "summarizer", chain: "c1" }, tokens: { input: 500, output: 50 }, cost: 0.001 },
      { id: "m2", ts: "2026-01-01T00:00:01Z", status: "done", memoryFor: { purpose: "summarizer", chain: "c1" }, tokens: { input: 500, output: 50 }, cost: 0.001 },
      { id: "m3", ts: "2026-01-01T00:00:02Z", status: "done", memoryFor: { purpose: "learner", chain: "c1" }, tokens: { input: 200, output: 20 }, cost: null },
    ];
    const kids = [{ id: "k1", ts: "2026-01-01T00:00:03Z", status: "pending", agentOf: own[0].id, tokens: { input: 5, output: 0 } }];
    const t = trafficOf([...own, ...cheap, ...kids], "c1");
    assert.equal(t.own.requests, 2);
    assert.equal(t.own.costUsd, 0.01);
    assert.equal(t.own.pricedRequests, 1);
    assert.equal(t.own.unpricedRequests, 1);
    assert.equal(t.own.cacheHitRate, Math.round((3000 / 4010) * 10000) / 10000);
    assert.deepEqual(t.statuses, { done: 1, error: 1 });
    assert.equal(t.cheap.requests, 3);
    assert.equal(t.cheap.costUsd, 0.002);
    assert.deepEqual(t.cheap.byPurpose, [
      { purpose: "summarizer", calls: 2, tokens: 1100, costUsd: 0.002 },
      { purpose: "learner", calls: 1, tokens: 220, costUsd: 0 },
    ]);
    assert.equal(t.children.requests, 1);
    assert.equal(t.live, true, "a pending child makes the session live");
    assert.equal(t.view.requestsFolded, 2);
    assert.equal(t.view.stubs, 18);
    assert.equal(t.view.latest.sentTokens, 8000);
    assert.equal(t.memory.requestsBriefed, 2);
    assert.equal(t.memory.itemsInjected, 6);
    assert.equal(t.memory.tokensInjected, 800);
  });

  // (fails before: no — a guard the mutation pass asked for: no sub-agent call on the session's chain was in a test)
  test("a sub-agent's call on the session's own chain is one of its children, never its own", () => {
    const own = [rec("c1")];
    const sub = rec("c1", { subagentOf: own[0].id, cost: 0.05 });
    const t = trafficOf([...own, sub], "c1");
    assert.deepEqual([t.own.requests, t.own.costUsd, t.children.requests], [1, 0.01, 1]);
  });
});

describe("sessionTruth", () => {
  test("aggregates identity, what is in force, cost, activity, memory and lineage — counts and flags, no transcript text", () => {
    const a = open();
    const c = a.chainForKey("h:c", { cwd: "C:\\src\\proj", client: "opencode", model: "big-model" });
    for (const n of [1, 2, 3]) turn(a, c.id, `SECRET question ${n}`, `SECRET answer ${n}`);
    a.setTitle(c.id, "SECRET title");
    a.setBriefing(c.id, "SECRET briefing");
    a.setMeta(c.id, { briefingIds: ["i1"], learnedThrough: 3, muted: false });
    a.setState(c.id, { status: "open", summary: "SECRET summary", open: ["a", "b"], done: ["c"] });
    a.addCompaction(c.id, { fromTurn: 1, toTurn: 2, summaryText: "SECRET summary", kind: "plain", window: "harness", method: "summary" });
    a.injections.add({ requestId: "req_a", chainId: c.id, kind: "briefing", ids: ["i1", "i2"], tokens: 300 });
    a.injections.add({ requestId: "req_b", chainId: c.id, kind: "turn", ids: ["i3"], tokens: 100 });
    a.injections.markUsed("req_a", true);
    a.items.add({ projectId: c.project_id, chainId: c.id, kind: "correction", text: "SECRET correction", status: "inferred", importance: 0.8 });
    a.items.add({ projectId: c.project_id, chainId: c.id, kind: "fact", text: "SECRET fact", status: "confirmed", importance: 0.8 });
    const fork = a.forkChain(c.id, { atTurn: 2, key: "h:fork" });
    const policies = policiesFor(a, {});
    const lineage = (id) => ({ root: id, nodes: [{ id }], edges: [] });
    const records = [rec(c.id), rec(c.id, { memory: { chain: c.id } })];
    const truth = sessionTruth({ archive: a, policies, lineage }, c.id, { records, capped: true, now: clock + 60_000 });
    // identity
    assert.equal(truth.identity.chainId, c.id);
    assert.equal(truth.identity.title, "SECRET title", "the title is the one user-visible string the surface shows");
    assert.equal(truth.identity.project.name, "proj");
    assert.deepEqual(truth.identity.models, ["big-model"]);
    assert.equal(truth.identity.turns, 3);
    assert.equal(truth.identity.forks, 1);
    assert.equal(truth.identity.fork, null);
    assert.equal(truth.identity.live, false);
    assert.ok(truth.identity.ageMs > 0 && truth.identity.idleMs >= 0);
    // in force (fails before: yes — the owner's rules of 10-31 took /trim, whose choices and passes the truth carried)
    assert.equal("trim" in truth.inForce, false, "no /trim choices");
    assert.equal(truth.inForce.muted, false);
    assert.equal(truth.inForce.permissions, null);
    // cost
    assert.equal(truth.cost.requests, 2);
    assert.equal(truth.cost.costUsd, 0.02);
    assert.equal(truth.cost.totalUsd, 0.02);
    assert.equal(truth.cost.coverage.ringCapped, true);
    assert.match(truth.cost.coverage.note, /request ring is full/);
    // activity
    assert.deepEqual(truth.activity.compactions, { total: 1, byKind: { plain: 1 } });
    assert.equal("trim" in truth.activity, false, "no /trim passes");
    assert.equal(truth.activity.workMessages, 3);
    // memory
    assert.equal(truth.memory.briefing, true);
    assert.equal(truth.memory.briefingItems, 1);
    assert.equal(truth.memory.injections.total, 2);
    assert.equal(truth.memory.injections.tokens, 400);
    assert.equal(truth.memory.injections.used, 1);
    assert.equal(truth.memory.injections.rows.length, 2);
    assert.equal(truth.memory.injections.rows[0].ids, 1, "ids are a count, not the ids");
    assert.equal(truth.memory.items.total, 2);
    assert.equal(truth.memory.items.corrections, 1);
    assert.deepEqual(truth.memory.items.byStatus, { inferred: 1, confirmed: 1 });
    assert.deepEqual(truth.memory.state, { status: "open", open: 2, done: 1, learnedAt: null });
    assert.equal(truth.memory.learnedThrough, 3);
    // lineage came from the function handed in
    assert.equal(truth.lineage.root, c.id);
    // Nothing from the transcript, the briefing, the summary, the items or the state's prose leaks.
    const blob = JSON.stringify({ ...truth, identity: { ...truth.identity, title: null } });
    assert.ok(!blob.includes("SECRET"), `content leaked into the truth: ${blob.match(/.{0,40}SECRET.{0,40}/)?.[0]}`);
    // The fork sees its source.
    const ft = sessionTruth({ archive: a, policies, lineage }, fork.id, {});
    assert.deepEqual(ft.identity.fork, { from: c.id, atTurn: 2, at: ft.identity.fork.at });
    assert.deepEqual(ft.identity.tree, { snapshotRef: null });
    assert.equal(ft.identity.forks, 0);
    assert.equal(sessionTruth({ archive: a, policies, lineage }, "nope", {}), null);
  });

  test("a session with no records still renders identity, what is in force and the archive side; the cost side is zero, not missing", () => {
    const a = open();
    const c = a.chainForKey("h:bare", { cwd: "C:\\src\\bare" });
    turn(a, c.id, "q", "a");
    const truth = sessionTruth({ archive: a, policies: policiesFor(a), lineage: () => null }, c.id, {});
    assert.equal(truth.identity.turns, 1);
    assert.equal(truth.cost.requests, 0);
    assert.equal(truth.cost.costUsd, 0);
    assert.equal(truth.cost.cacheHitRate, null);
    assert.equal(truth.cost.coverage.ringCapped, false);
    assert.equal(truth.activity.folds.latest, null);
    assert.equal(truth.memory.injections.total, 0);
    assert.equal(truth.lineage, null);
  });
});

describe("the sessions area against a real app", () => {
  test("GET /api/sessions/:id and /requests work end to end; the settings route writes what the override API used to (D12)", async () => {
    const up = await fakeUpstream();
    const shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "ant", name: "ant", type: "anthropic", baseUrl: up.url, apiKey: "x", enabled: true }];
        cfg.routes = [{ match: "insp-*", upstream: "ant", upstreamModel: "{model}", enabled: true }];
      },
    });
    try {
      const H = { "x-filament-conversation": "insp-convo" };
      for (const t of ["first", "second"]) {
        const r = await shim.post("/v1/messages", { model: "insp-model", max_tokens: 32, system: "cwd: C:\\proj\\insp", messages: [{ role: "user", content: t }] }, H);
        assert.equal(r.status, 200);
      }
      const archive = shim.app.memory.archive;
      const chainId = archive.chainIdForKey(chainKeyForConversationId("insp-convo"));
      assert.ok(chainId);
      for (let i = 0; i < 50 && archive.getChain(chainId).turns < 2; i++) await new Promise((r) => setTimeout(r, 100));

      assert.equal((await shim.api("/api/sessions/zzzz")).status, 404);
      const truth = await (await shim.api(`/api/sessions/${chainId}`)).json();
      assert.equal(truth.identity.chainId, chainId);
      assert.equal(truth.identity.turns, 2);
      assert.deepEqual(truth.identity.models, ["ant/insp-model"], "the models row names the upstream that answers, not the raw asked-for name");
      assert.equal(truth.identity.client, "node", "the client is what the user-agent said");
      assert.equal(truth.cost.requests, 2, "both client requests were placed on the chain by memory");
      assert.ok(truth.cost.tokens.input > 0);
      assert.equal(truth.inForce.pinned, false, "the sidebar float is part of the inspector's in-force layer");
      assert.equal(truth.lineage.root, chainId);

      const list = await (await shim.api(`/api/sessions/${chainId}/requests?limit=10`)).json();
      assert.equal(list.total, 2);
      assert.equal(list.capped, false);
      assert.equal(truth.cost.coverage.ringCapped, false, "the same coverage flag reaches the truth");
      assert.equal(list.requests.length, 2);
      assert.equal(list.requests[0].model, "insp-model");
      assert.ok(!("inboundBody" in list.requests[0]), "the list carries public records; the bytes are on /api/requests/:id");
      assert.equal((await shim.api(`/api/sessions/zzzz/requests`)).status, 404);

      // The override layer is gone (D12); every write it served goes through the settings route now.
      assert.equal((await shim.api(`/api/sessions/${chainId}/override`, { method: "POST", body: {} })).status, 404, "the override row is gone");
      const bad = await shim.api(`/api/sessions/${chainId}/settings`, { method: "PATCH", body: { patch: { context: { results: "nonsense" } } } });
      assert.equal(bad.status, 400);
      assert.match((await bad.json()).error, /must be one of/);
      // All or nothing: a patch with one bad key writes none of its keys (applyPatch validates the whole change).
      const half = await shim.api(`/api/sessions/${chainId}/settings`, { method: "PATCH", body: { patch: { context: { results: "status", view: { stubChars: 10 } } } } });
      assert.equal(half.status, 400);
      assert.match((await half.json()).error, /context\.view\.stubChars/);
      assert.ok(!archive.chainSettings(chainId)?.context, "the valid half was not written either");
      // The bounds are the knobs' own now (min/max on the registry entry), not a second set of rules.
      for (const body of [
        { patch: { context: { view: { stubChars: 5000 } } } },
        { patch: { memory: { enabled: "false" } } },
        { patch: { display: { pinned: "yes" } } },
        { patch: { display: { title: 42 } } },
      ]) {
        const r = await shim.api(`/api/sessions/${chainId}/settings`, { method: "PATCH", body });
        assert.equal(r.status, 400, JSON.stringify(body));
      }
      const res = await shim.api(`/api/sessions/${chainId}/settings`, {
        method: "PATCH",
        body: {
          patch: { context: { results: "pointer", view: { stubChars: 200 } }, memory: { enabled: false }, display: { pinned: true } },
        },
      });
      assert.equal(res.status, 200);
      const out = await res.json();
      assert.deepEqual(out.changes.map((c) => c.path).sort(), ["context.results", "context.view.stubChars", "display.pinned", "memory.enabled"]);
      assert.equal(out.effective.context.results, "pointer");
      assert.equal(out.effective.context.view.stubChars, 200);
      const meta = archive.getChain(chainId).meta;
      const layer = archive.chainSettings(chainId)?.context || {};
      assert.equal(layer.results, "pointer");
      assert.deepEqual(layer.view, { stubChars: 200 });
      assert.equal(meta.muted, true, "memory.enabled false mutes through the mirror");
      assert.equal(meta.pinned, true, "the sidebar pin mirrors from display.pinned");
      const listed = (await (await shim.api("/api/memory/sessions?limit=20")).json()).sessions.find((s) => s.id === chainId);
      assert.equal(listed.pinned, true, "the sessions list carries the mark for the rail");
      // Unpinning is a display write alone: nothing else moves, and no operation is recorded (D7).
      const opsBefore = (await (await shim.api("/api/ops?kinds=archive&limit=200")).json()).ops.length;
      const unpin = await shim.api(`/api/sessions/${chainId}/settings`, { method: "PATCH", body: { patch: { display: { pinned: false } } } });
      assert.equal(unpin.status, 200);
      assert.equal(archive.getChain(chainId).meta.pinned, undefined);
      assert.equal(archive.getChain(chainId).meta.muted, true, "the other choices are untouched");
      assert.equal((await (await shim.api("/api/ops?kinds=archive&limit=200")).json()).ops.length, opsBefore, "a display-only write records nothing");

      // Clearing: unset returns a knob to the layers below; the mirror follows (an unset memory.enabled unmutes).
      const clr = await shim.api(`/api/sessions/${chainId}/settings`, { method: "PATCH", body: { unset: ["context.results", "memory.enabled"] } });
      assert.equal(clr.status, 200);
      assert.equal(archive.chainSettings(chainId)?.context?.results, undefined);
      assert.notEqual(archive.getChain(chainId).meta.muted, true, "unset memory.enabled unmutes through the mirror (the flag reads false, not gone)");

      // The audit trail: one session-settings operation per write, the knobs named, display knobs never audited.
      const opsRows = (await (await shim.api("/api/ops?kinds=archive&limit=100")).json()).ops.filter((o) => o.sub === "session-settings");
      assert.equal(opsRows.length, 2, "the big write and the clearing; the display-only unpin is not there");
      assert.deepEqual(opsRows[0].detail.changes, [
        "context.results: inherits again",
        "memory.enabled: inherits again",
      ], "the clearing");
      const first = opsRows.at(-1); // the list is newest first
      assert.deepEqual(first.detail.changes.sort(), [
        "context.results: \"pointer\"",
        "context.view.stubChars: 200",
        "memory.enabled: false",
      ], "display.pinned is deliberately absent (D7)");
      assert.equal(first.ref.chainId, chainId);

      // A browser-shaped write without JSON is refused before any handler runs.
      const csrf = await shim.api(`/api/sessions/${chainId}/settings`, {
        method: "PATCH",
        body: "muted=true",
        headers: { "content-type": "application/x-www-form-urlencoded", origin: "http://evil.example" },
      });
      assert.equal(csrf.status, 403);
      const form = await shim.api(`/api/sessions/${chainId}/settings`, {
        method: "PATCH",
        body: "muted=true",
        headers: { "content-type": "application/x-www-form-urlencoded", origin: shim.url },
      });
      assert.equal(form.status, 415);

      // The sidebar's other states: rename, archive, unread — display knobs on the chain like `pinned`.
      const named = await (await shim.api(`/api/sessions/${chainId}/settings`, { method: "PATCH", body: { patch: { display: { title: "Renamed by hand", archived: true, unread: true } } } })).json();
      assert.equal(named.effective.display.title, "Renamed by hand");
      assert.equal(named.effective.display.archived, true);
      assert.equal(named.effective.display.unread, true);
      assert.equal(archive.getChain(chainId).title, "Renamed by hand");
      assert.equal((await (await shim.api(`/api/sessions/${chainId}`)).json()).identity.title, "Renamed by hand");
      const all = (await (await shim.api("/api/memory/sessions?limit=20&archived=all")).json()).sessions.find((s) => s.id === chainId);
      assert.equal(all.title, "Renamed by hand");
      assert.equal(all.archived, true);
      assert.equal(all.unread, true);
      assert.ok(!(await (await shim.api("/api/memory/sessions?limit=20")).json()).sessions.some((s) => s.id === chainId), "the default list leaves archived sessions out");
      assert.ok((await (await shim.api("/api/memory/sessions?limit=20&archived=only")).json()).sessions.some((s) => s.id === chainId), "the archived view has it");
      const back = await (await shim.api(`/api/sessions/${chainId}/settings`, { method: "PATCH", body: { unset: ["display.title", "display.archived", "display.unread"] } })).json();
      assert.equal(back.effective.display.title, null);
      assert.equal(archive.getChain(chainId).title, null, "a cleared title hands naming back to the learner");
      assert.equal(archive.getChain(chainId).meta.archived, undefined);
      assert.equal(archive.getChain(chainId).meta.unread, undefined);
      assert.ok((await (await shim.api("/api/memory/sessions?limit=20")).json()).sessions.some((s) => s.id === chainId), "unarchived: back in the default list");
    } finally {
      await shim.stop();
      await up.close();
    }
  });

  test("memory off is recording only: the archive opens, native sessions work, nothing is recalled or offered (D6)", async () => {
    const up = await fakeUpstream();
    const shim = await startApp({
      configure: (cfg, { dataDir }) => {
        cfg.memory = { enabled: false, folder: join(dataDir, "mem-off"), privacy: { encryptArchive: false } };
        cfg.upstreams = [{ id: "ant", name: "ant", type: "anthropic", baseUrl: up.url, apiKey: "x", enabled: true }];
        cfg.routes = [{ match: "off-*", upstream: "ant", upstreamModel: "{model}", enabled: true }];
      },
    });
    try {
      const st = await (await shim.api("/api/memory/status")).json();
      assert.equal(st.enabled, false);
      assert.ok(st.archive && typeof st.archive.chains === "number", "the archive is open with memory off");
      assert.equal(st.learning, null, "no learner with memory off");
      assert.equal((await shim.api("/api/sessions/abc")).status, 404, "an unknown session is a 404, not a 503");
      const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: process.cwd(), model: "off-model", preset: "plain", title: "off" } });
      if (made.status !== 200) assert.fail(await made.text());
      const { id } = await made.json();
      // A turn is recorded — the transcript holds it — and the model got no memory block and no memory tool.
      const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "hello with memory off", stream: false } });
      if (t.status !== 200) assert.fail(await t.text());
      const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
      assert.equal(tr.turns.length, 1); assert.equal(tr.turns[0].open, false);
      const sent = up.received[up.received.length - 1].body;
      assert.ok(!JSON.stringify(sent).includes("<filament-memory"), "nothing injected with memory off");
      assert.ok(!(sent.tools || []).some((x) => /^filament_memory_/.test(x.name)), "no memory tools offered with memory off");
      assert.ok((sent.tools || []).some((x) => x.name === "filament_recall"), "the recall tool rides: it reads the archive, which records with memory off");
      const truth = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}`)).json();
      assert.equal(truth.inForce.muted, false, "the session's own choice is memory on (Plain, HarnessV3-AtHome AH-D8): the global switch keeps memory out, and the session's mute stays its own");
      assert.equal(truth.activity.turns, 1);
      // A chat command Filament answers itself is a turn of the transcript too, marked as Filament's — a reload keeps it.
      const calls = up.received.length;
      const cmd = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "@mem status", stream: false } });
      if (cmd.status !== 200) assert.fail(await cmd.text());
      assert.equal(up.received.length, calls, "the upstream was not called for the command");
      const tr2 = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
      assert.equal(tr2.turns.length, 2);
      assert.equal(tr2.turns[1].command, true);
      assert.match(JSON.stringify(tr2.turns[1].final), /Memory status/);
      assert.ok(JSON.stringify(tr2.turns[1].final).includes("memory is **off** in Memory settings"), "the status names the switch");
      // The next model turn composes the history without the command exchange: Filament's words about itself are not
      // conversation, and the dry run shows the same history the request carries.
      const dry = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/compose?dry=1&prompt=1&text=${encodeURIComponent("and now?")}`)).json();
      assert.deepEqual(dry.current.prompt.messages.map((m) => m.role), ["user", "assistant", "user"], "turn 1 and the draft; the command turn is not in the request");
      assert.ok(!JSON.stringify(dry.current.prompt.messages).includes("Memory status"));
      const t3 = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "and now?", stream: false } });
      if (t3.status !== 200) assert.fail(await t3.text());
      const sent3 = up.received[up.received.length - 1].body;
      assert.ok(!JSON.stringify(sent3.messages).includes("Memory status") && !JSON.stringify(sent3.messages).includes("@mem status"), "the request carries no command turn");
      assert.equal(sent3.messages.filter((m) => m.role === "user").length, 2, "turn 1's user message and the new one");
      const tr3 = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
      assert.equal(tr3.turns.length, 3, "the transcript still shows the command turn");
      assert.ok(!(tr3.turns[2].composed?.notes || []).some((n) => /unanswered/.test(n)), "a command turn is not counted as unanswered");
      const board = await (await shim.api(`/api/features?session=${encodeURIComponent(id)}`)).json();
      const mem = board.features.find((f) => f.id === "memory");
      assert.equal(mem.switch.on, false);
      assert.equal(mem.count.source, "archive", "the board counts from the archive even with memory off");
    } finally {
      await shim.stop();
      await up.close();
    }
  });

  // (fails before: yes — the bug hunt of 10-30, UIST-3: the list took no offset, so every page past the first read the first again, and Settings' auto-archive and Archived chats saw the newest 200 alone)
  test("GET /api/memory/sessions takes an offset: a list read a page at a time reaches every row once", async () => {
    const shim = await startApp({ memory: true });
    try {
      const archive = shim.app.memory.archive;
      for (let i = 0; i < 5; i++) archive.chainForKey(`paged-${i}`, { cwd: "C:\\proj\\paged" });
      const page = async (/** @type {string} */ q) => (await (await shim.api(`/api/memory/sessions?${q}`)).json()).sessions.map((/** @type {any} */ s) => s.id);
      const all = await page("limit=50");
      assert.equal(all.length, 5);
      assert.deepEqual([...(await page("limit=2&offset=0")), ...(await page("limit=2&offset=2")), ...(await page("limit=2&offset=4"))], all);
      assert.deepEqual(await page("limit=2&offset=5"), []);
      assert.deepEqual(await page("limit=2&offset=x"), all.slice(0, 2), "an offset that is no number reads from the first row");
    } finally {
      await shim.stop();
    }
  });

  test("without an archive (a failed open) the area says so with a 503 instead of a stack trace", async () => {
    const shim = await startApp();
    // The real archive goes back before the stop, which closes it: a handle left open keeps the data dir on Windows.
    const held = shim.app.memory.archive;
    try {
      // The one state that keeps the archive away now is an open that failed; the service then has no archive.
      shim.app.memory.archive = null;
      const r = await shim.api("/api/sessions/abc");
      assert.equal(r.status, 503);
      assert.match((await r.json()).error, /no archive/);
      assert.equal((await shim.api("/api/sessions/abc/requests")).status, 503);
      const w = await shim.api("/api/sessions/abc/settings", { method: "PATCH", body: { patch: { memory: { enabled: false } } } });
      assert.equal(w.status, 503);
    } finally {
      shim.app.memory.archive = held;
      await shim.stop();
    }
  });
});
