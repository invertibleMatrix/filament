// @ts-check
// HarnessV3-ACP AC0, the ground, through the app and a fake agent: the agent's profile kept (AC0-1), its updates read
// against ACP's own schema (AC0-2), a failure by its kind (AC0-3), and sessions let go of where the agent can (AC0-4).
// The parts on their own (the profile's reading, the pin, the failure table) are in acp-ground-parts.test.js.
import "./helpers/clean-env.js";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/server.js";
import { defaultConfig } from "../src/config.js";
import { createUpdateReader } from "../src/adapters/agents/acp/updates.js";
import { conversationKey } from "../src/core/conversation.js";
import { alignEvents, agentNoticeWords } from "../src/ui/harness/lib/labels.js";
import { noticesEl } from "../src/ui/harness/conversation/timeline.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-acp-agent.mjs");
const VERSION = String.raw`ACP schema (\d+\.\d+\.\d+)`;

// (fails before: yes — every kind Filament does not draw was "an update Filament does not know", with no schema version,
// and a tool call without its title went unremarked)
test("an update the reader does not draw is named with the schema's version: outside it, in it but not drawn yet, or missing what it requires", () => {
  /** @type {string[]} */
  const notes = [];
  const read = createUpdateReader({ out: { tools: [] }, conv: {}, turn: { bridgePlan: () => null }, onEvent: () => {}, notes });
  read({ sessionUpdate: "something_new", payload: 1 });
  read({ sessionUpdate: "plan_removed", planId: "p9" });
  read({ sessionUpdate: "tool_call", toolCallId: "t1", kind: "read", status: "completed" });
  read({ sessionUpdate: "something_new", payload: 2 });
  read({ sessionUpdate: "tool_call", toolCallId: "t2", kind: "read", status: "completed" });
  read({ sessionUpdate: "tool_call", toolCallId: "t3", title: "Read a.js", kind: "read", status: "completed" });
  read({ sessionUpdate: "subagent_spawned", subagentSessionId: "s1", name: "explorer" });
  assert.equal(notes.length, 3, `each said once per turn; an update that fits, or one Filament draws, says nothing: ${notes.join(" | ")}`);
  const [outside, undrawn, missing] = notes;
  assert.match(outside, new RegExp(`^acp: the agent sent something_new, which ${VERSION} does not have; ignored$`));
  assert.match(undrawn, new RegExp(`^acp: the agent sent plan_removed \\(in ${VERSION}, marked unstable there\\); Filament does not draw it yet$`));
  assert.match(missing, new RegExp(`^acp: the agent sent tool_call without title, which ${VERSION} requires; read as far as it goes$`));
  assert.equal(new Set(notes.map((n) => new RegExp(VERSION).exec(n)?.[1])).size, 1, "one schema, one version");
});

// (fails before: yes — HarnessV4_Tasks C21: a notice was an update Filament did not draw, and Claude's adapter, told of no
// notices, wrote them into its answer)
test("a notice is the agent's word beside its answer: an event of its own, plain, its sub-agent's said so — none of the reply's text", () => {
  /** @type {string[]} */
  const notes = [];
  /** @type {any[]} */
  const events = [];
  const out = { tools: [] };
  const read = createUpdateReader({ out, conv: {}, turn: { bridgePlan: () => null }, onEvent: (/** @type {any} */ e) => events.push(e), notes });
  read({ sessionUpdate: "notice", severity: "warning", title: "Model fallback", description: " It went on with another model. " });
  read({ sessionUpdate: "notice", severity: "info", title: "Fast mode turned off" }, { subagent: "s1" });
  read({ sessionUpdate: "notice", title: "  " });
  read({ sessionUpdate: "notice", title: "No severity said" });
  assert.deepEqual(events, [
    { type: "agent-notice", severity: "warning", title: "Model fallback", description: "It went on with another model." },
    { type: "agent-notice", severity: "info", title: "Fast mode turned off", subagent: "s1" },
    { type: "agent-notice", severity: "info", title: "No severity said" },
  ], "one without a title says nothing; one without a severity is info");
  assert.ok(!events.some((e) => e.type === "text"), "none of the reply's words");
  assert.equal(notes.length, 1, notes.join(" | "));
  assert.match(notes[0], new RegExp(`^acp: the agent sent notice without severity, which ${VERSION} requires; read as far as it goes$`), "what it lacks is said as for any update, once a turn");
});

// (fails before: yes — claude-agent-acp 0.93 says a sub-agent in ACP's sub-agents RFD, which the reader did not draw:
// the sub-agent never started on the page, and never ended)
test("a sub-agent in ACP's sub-agents RFD: announced running, its end idle with why — said as the form before said them; its prompt nothing more", () => {
  /** @type {string[]} */
  const notes = [];
  /** @type {any[]} */
  const events = [];
  const read = createUpdateReader({ out: { tools: [] }, conv: {}, turn: { bridgePlan: () => null }, onEvent: (/** @type {any} */ e) => events.push(e), notes });
  read({ sessionUpdate: "subagent_update", sessionId: "k1", title: "Explore", description: "Look for TODOs", capabilities: { cancel: {} }, state: { state: "running" } });
  read({ sessionUpdate: "session_message", messageId: "toolu_1", senderSessionId: "root", recipientSessionId: "k1", content: [{ type: "text", text: "Find the TODOs" }] });
  read({ sessionUpdate: "subagent_update", sessionId: "k1", state: { state: "requires_action" } });
  read({ sessionUpdate: "subagent_update", sessionId: "k1", state: { state: "idle", stopReason: "end_turn" } });
  read({ sessionUpdate: "subagent_update", sessionId: "k2", state: { state: "idle", stopReason: "cancelled" } });
  read({ sessionUpdate: "subagent_update", sessionId: "k3", state: { state: "idle", stopReason: "error", error: { code: -32603, message: "boom" } } });
  read({ sessionUpdate: "subagent_update", sessionId: "k4", state: { state: "idle" } });
  read({ sessionUpdate: "subagent_update", sessionId: "k5", state: { state: "unknown" } });
  read({ sessionUpdate: "subagent_update", sessionId: "k6", title: "general-purpose" }, { subagent: "k1" });
  assert.deepEqual(events, [
    { type: "subagent", state: "spawned", id: "k1", name: "Look for TODOs", description: "", kind: "Explore" },
    { type: "subagent", state: "completed", id: "k1" },
    { type: "subagent", state: "cancelled", id: "k2" },
    { type: "subagent", state: "failed", id: "k3" },
    { type: "subagent", state: "disconnected", id: "k4" },
    { type: "subagent", state: "disconnected", id: "k5" },
    { type: "subagent", state: "spawned", id: "k6", name: "general-purpose", description: "", kind: "general-purpose", subagent: "k1" },
  ], "waiting on a question says nothing; an end without its reason is no claim it finished; a sub-agent's own is marked");
  assert.deepEqual(notes, [], "each of them read: none is an update Filament does not draw");
});

// (fails before: yes — HarnessV4_Tasks C21: the page drew no notice; what it said was the reply's words, folded with
// them under "Worked for…" once the turn settled)
test("the page draws each notice once, on a line of its own under the answer and outside the fold, in its severity's tone; a sub-agent's says so", () => {
  const al = alignEvents([
    { type: "agent-notice", round: 1, severity: "warning", title: "Model fallback", description: "It went on with another model." },
    { type: "agent-notice", round: 2, severity: "info", title: "Fast mode turned off", subagent: true },
    { type: "agent-notice", round: 2, severity: "error", title: "" },
  ]);
  assert.deepEqual(al.notices, [
    { severity: "warning", title: "Model fallback", description: "It went on with another model." },
    { severity: "info", title: "Fast mode turned off", subagent: true },
  ], "in the order said; one without a title is nothing to draw");
  assert.deepEqual(agentNoticeWords(al.notices[0]), { tone: "warn", words: "Model fallback — It went on with another model." });
  assert.deepEqual(agentNoticeWords(al.notices[1]), { tone: "info", words: "A sub-agent: Fast mode turned off" });
  assert.equal(agentNoticeWords({ severity: "error", title: "Out of credit" }).tone, "err");
  const doc = stubDocument();
  try {
    const rows = /** @type {any} */ (noticesEl(al.notices)).querySelectorAll(".agent-notice");
    assert.deepEqual(rows.map((/** @type {any} */ r) => [r.className, r.getAttribute("role"), r.textContent]), [
      ["agent-notice is-warn", "note", "Model fallback — It went on with another model."],
      ["agent-notice is-info", "note", "A sub-agent: Fast mode turned off"],
    ]);
  } finally {
    doc.restore();
  }
  const src = (/** @type {string} */ f) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", f), "utf8");
  const tl = src("src/ui/harness/conversation/timeline.js");
  assert.match(tl, /lastText \? lastText\.el : null, \.\.\.after\.map\(\(s\) => s\.el\), v\.notices, v\.orders,/, "under the answer's words, outside the fold: live and settled alike");
  assert.match(tl, /if \(noticesKey !== v\.noticesKey\) \{/, "rebuilt only when what they say changes");
  const css = src("src/ui/harness.css");
  assert.match(css, /\.agent-notice\.is-warn \{[^}]*var\(--color-warning\)/);
  assert.match(css, /\.agent-notice\.is-err \{[^}]*var\(--color-destructive\)/);
});

describe("agents at work: the profile kept, failures by kind, sessions let go of", () => {
  /** @type {any} */
  let app;
  let port = 0;
  const dataDir = mkdtempSync(join(tmpdir(), "filament-acp-ground-"));
  const projDir = join(dataDir, "project");
  const calls = join(dataDir, "calls.jsonl");
  const prompts = join(dataDir, "prompts.jsonl");
  const start = async () => {
    app = createApp(/** @type {any} */ ({ dataDir, overrides: { port: 0, heartbeatMs: 1000 } }));
    port = (await app.start()).port;
  };
  before(async () => {
    mkdirSync(projDir);
    const cfg = defaultConfig();
    cfg.server.port = 0;
    cfg.server.inboundKeys = ["k"];
    cfg.observability.logFile = "";
    cfg.memory.enabled = false;
    /** @param {Record<string, string>} env */
    const acp = (env) => ({
      command: process.execPath,
      args: [FAKE],
      env: { FAKE_ACP_LOG: prompts, FAKE_ACP_CALLS: calls, FAKE_ACP_ALLOW_LOAD: "1", ...env },
      cwdDefault: projDir,
      permissions: "allow-all",
      hints: false,
    });
    cfg.upstreams = [
      { id: "ground", name: "an agent that declares its session methods", type: "acp", acp: acp({ FAKE_ACP_SESSION_CAPS: "close,resume,fork,list", FAKE_ACP_STEERING: "1" }) },
      { id: "plain", name: "an agent that declares none", type: "acp", acp: acp({}) },
      { id: "flaky", name: "an agent whose resume fails", type: "acp", acp: acp({ FAKE_ACP_SESSION_CAPS: "close,resume", FAKE_ACP_RESUME_FAIL: "1" }) },
      { id: "refuser", name: "an agent that refuses every prompt", type: "acp", acp: acp({ FAKE_ACP_FAIL_KIND: "invalid_request" }) },
      { id: "loser", name: "an agent whose session's process can die", type: "acp", acp: acp({ FAKE_ACP_SESSION_CAPS: "close,resume" }) },
    ];
    cfg.routes = [
      { match: "ground/*", upstream: "ground", upstreamModel: "{1}", format: "auto" },
      { match: "loser/*", upstream: "loser", upstreamModel: "{1}", format: "auto" },
      { match: "plain/*", upstream: "plain", upstreamModel: "{1}", format: "auto" },
      { match: "flaky/*", upstream: "flaky", upstreamModel: "{1}", format: "auto" },
      { match: "chain/*", upstream: "refuser", upstreamModel: "{1}", format: "auto", fallbacks: [{ upstream: "plain", upstreamModel: "m" }] },
    ];
    // chain/*'s backup is tried: failover is off until switched on (the owner's of 11-09).
    cfg.rules.resilience = { ...(cfg.rules.resilience || {}), failover: true };
    writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
    await start();
  });
  after(async () => {
    await app.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });
  const api = async (/** @type {string} */ path, method = "GET") => (await fetch(`http://127.0.0.1:${port}/api${path}`, { method })).json();
  /** The health board's word on an upstream: no entry is a healthy one. @param {string} id */
  const health = async (id) => (await api("/usage/upstreams")).health[id] || { coolingDown: false, cooldownLeftMs: 0 };
  /** @param {string} model @param {string} conv @param {{ role: string, content: string }[]} messages */
  const chat = (model, conv, messages) =>
    fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer k", "x-filament-conversation": conv },
      body: JSON.stringify({ model, messages: [{ role: "system", content: `Working directory: ${projDir}` }, ...messages] }),
    });
  /** @param {string} model @param {string} conv @param {{ role: string, content: string }[]} messages */
  const ok = async (model, conv, messages) => {
    const r = await chat(model, conv, messages);
    const text = await r.text();
    assert.equal(r.status, 200, text);
  };
  /** The session methods the fake agents were sent, in order. @returns {{ method: string, sessionId: string, pid: number }[]} */
  const sent = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  /** The agent session a conversation's first prompt went to. @param {string} text @returns {string} */
  const sessionOf = (text) => readFileSync(prompts, "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((p) => p.text === text)?.sessionId;
  /**
   * The developer's forget on a client's conversation (`DELETE /api/acp/conversations/:key`): Filament lets go of its
   * session, as a harness chat's `/new` does. @param {string} upstream @param {string} conv
   */
  const forget = async (upstream, conv) => {
    // Keyed by the folder the request named, which a resumed session's own folder may not be.
    const key = conversationKey(upstream, projDir, [], conv);
    assert.ok(app.acp.convs.has(key), `${conv}'s conversation`);
    assert.equal((await api(`/acp/conversations/${encodeURIComponent(key)}`, "DELETE")).ok, true);
  };

  // (fails before: yes — the offer named five capabilities as `capabilities`, and nothing was kept once it answered)
  test("the offer carries the agent's profile, and Filament keeps it, with the version it read, across a restart, without starting the agent", async () => {
    const o = await api("/acp/ground/offer");
    assert.equal(o.ok, true, JSON.stringify(o));
    assert.deepEqual(
      [o.profile?.sessions?.close, o.profile?.sessions?.resume, o.profile?.sessions?.fork, o.profile?.steering, o.profile?.agent?.version],
      [true, true, true, true, "1.0"],
    );
    assert.equal(o.capabilities, undefined, "one name for it: the profile");
    // (fails before: no — a guard the mutation pass asked for: the sessions the offer counts were never read)
    assert.equal(o.sessionsKnown, 3, "the agent declares list, so the offer counts the sessions it knows");
    const kept = (await api("/acp/profiles")).profiles?.ground;
    assert.deepEqual([kept?.sessions?.close, kept?.agent?.version, kept?.at > 0], [true, "1.0", true]);
    await app.stop();
    await start();
    const again = (await api("/acp/profiles")).profiles?.ground;
    assert.deepEqual([again?.sessions?.close, again?.agent?.version, again?.at], [true, "1.0", kept.at], "read back from the data folder");
    assert.equal(app.acp.procs.size, 0, "no agent was started to answer");
  });

  // (fails before: yes — a refused prompt was a 502 like a dead agent's, and the agent cooled down for it)
  test("a prompt the agent refuses, or one too long for its context, leaves it out of cooldown and tells the client not to send it again as is", async () => {
    for (const [word, kind] of [["~rpcrefuse", "refusal"], ["~overflow", "overflow"]]) {
      const r = await chat("ground/m", `fail-${kind}`, [{ role: "user", content: `please ${word} this` }]);
      await r.text();
      assert.equal(r.status, 502, kind);
      assert.equal(r.headers.get("x-should-retry"), "false", kind);
      const h = await health("ground");
      assert.deepEqual([h.coolingDown, h.cooldownLeftMs], [false, 0], `${kind}: no cooldown`);
      const rec = app.usage.list(1)[0];
      assert.deepEqual(rec.failure, { kind, retryable: false }, kind);
      assert.ok((rec.changes || []).includes(`acp: ground failed (${kind}: not retryable as sent; no cooldown)`), JSON.stringify(rec.changes));
    }
  });

  // (fails before: yes — no record named a failure's kind; that a failure of the agent's own still cools it down is the
  // guard the fix asks for)
  test("an overloaded agent, or one whose process dies, still cools down, and the client may try again", async () => {
    for (const [word, kind] of [["~overloaded", "limit"], ["~crash", "transport"]]) {
      await api("/health/ground/reset", "POST");
      const r = await chat("ground/m", `fail-${kind}`, [{ role: "user", content: `please ${word} this` }]);
      await r.text();
      assert.equal(r.status, 502, kind);
      assert.equal(r.headers.get("x-should-retry"), null, kind);
      const h = await health("ground");
      assert.ok(h.coolingDown && h.cooldownLeftMs > 0, `${kind}: cooling down (${JSON.stringify(h)})`);
      const rec = app.usage.list(1)[0];
      assert.deepEqual(rec.failure, { kind, retryable: true }, kind);
      assert.ok((rec.changes || []).includes(`acp: ground failed (${kind}: retryable)`), JSON.stringify(rec.changes));
      // (fails before: no — a guard the mutation pass asked for: the record's cooldown note was never read)
      assert.ok(rec.changes.some((/** @type {string} */ c) => /^health: ground cooling down \d+ s after 1 failure\(s\)$/.test(c)), JSON.stringify(rec.changes));
    }
    await api("/health/ground/reset", "POST");
  });

  // (fails before: no — a guard the mutation pass asked for: no agent failed after its client hung up, so nothing
  // checked that such a failure is not counted against the agent)
  test("an agent that fails after its client hung up is not counted as failing: no kind, no note, no cooldown", async () => {
    const ac = new AbortController();
    const pending = fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer k", "x-filament-conversation": "hang-up" },
      body: JSON.stringify({ model: "ground/m", stream: true, messages: [{ role: "system", content: `Working directory: ${projDir}` }, { role: "user", content: "please ~hangfail this" }] }),
      signal: ac.signal,
    });
    await until(() => existsSync(prompts) && readFileSync(prompts, "utf8").includes("~hangfail"), "the prompt to reach the agent");
    ac.abort();
    await pending.then((r) => r.text()).catch(() => {});
    const rec = await until(() => { const x = app.usage.list(1)[0]; return x?.status === "aborted" && x; }, "the hung-up turn's record");
    assert.equal(rec.failure, undefined);
    assert.deepEqual((rec.changes || []).filter((/** @type {string} */ c) => /^acp: ground failed|^health:/.test(c)), []);
    const h = await health("ground");
    assert.deepEqual([h.coolingDown, h.cooldownLeftMs], [false, 0], "the agent's failure came after the hang-up");
  });

  // (fails before: no — a guard the mutation pass asked for: no agent failure fell back, so the notes an early failure
  // carries to the record were never read)
  test("a refusal before any output falls back to the next upstream; the record names it, and the agent does not cool down", async () => {
    await ok("chain/m", "chain-refuse", [{ role: "user", content: "refused here, answered there" }]);
    const rec = app.usage.list(1)[0];
    assert.deepEqual([rec.upstream, rec.attempt, rec.failure], ["plain", 2, undefined]);
    assert.ok(rec.changes.includes("acp: refuser failed (refusal: not retryable as sent; no cooldown)"), JSON.stringify(rec.changes));
    assert.equal((await health("refuser")).coolingDown, false);
  });

  // (fails before: yes — Filament never sent session/close: a session it let go of held the agent's resources until its
  // process ended)
  test("a session Filament lets go of is closed where the agent declares close: on a forget and on the sweep; not where it does not", async () => {
    await ok("ground/m", "close-new", [{ role: "user", content: "close me on new" }]);
    const onNew = sessionOf("close me on new");
    await forget("ground", "close-new");
    await until(() => sent().some((c) => c.method === "session/close" && c.sessionId === onNew), "the forget's close to reach the agent");

    await ok("ground/m", "close-sweep", [{ role: "user", content: "close me on the sweep" }]);
    const onSweep = sessionOf("close me on the sweep");
    for (const c of app.acp.convs.values()) if (c.sessionId === onSweep) c.lastUsed = 0;
    assert.equal(app.acp.sweep(Date.now()), 1, "the idle conversation is dropped");
    await until(() => sent().some((c) => c.method === "session/close" && c.sessionId === onSweep), "the sweep's close to reach the agent");

    await ok("plain/m", "plain-new", [{ role: "user", content: "plain on new" }]);
    const plain = sessionOf("plain on new");
    await forget("plain", "plain-new");
    // The next session in the same process: a close sent at the forget would have reached the agent before it.
    await ok("plain/m", "plain-new", [{ role: "user", content: "plain after new" }]);
    assert.notEqual(sessionOf("plain after new"), plain, "the forget let the next message open a fresh session");
    assert.deepEqual(sent().filter((c) => c.sessionId === plain).map((c) => c.method), ["session/new"], "an agent that does not declare close is sent none");
  });

  // (fails before: yes — chats that shared one agent session and were swept together sent its close once each)
  test("a session two swept chats shared is closed once", async () => {
    const n = sent().length;
    await ok("ground/sw#sess_old1", "sweep-a", [{ role: "user", content: "swept first" }]);
    await ok("ground/sw#sess_old1", "sweep-b", [{ role: "user", content: "swept second" }]);
    const pid = sent().slice(n).find((c) => c.method === "session/resume" && c.sessionId === "sess_old1")?.pid;
    for (const c of app.acp.convs.values()) if (c.sessionId === "sess_old1" && app.acp.procs.get(c.procKey)?.child?.pid === pid) c.lastUsed = 0;
    assert.equal(app.acp.sweep(Date.now()), 2, "both idle chats are dropped");
    // The next session in the same process: every close the sweep sent reaches the agent before it.
    await ok("ground/sw", "after-sweep", [{ role: "user", content: "after the sweep" }]);
    const closes = sent().slice(n).filter((c) => c.method === "session/close");
    assert.deepEqual(closes.map((c) => [c.sessionId, c.pid === pid]), [["sess_old1", true]], JSON.stringify(closes));
  });

  // (fails before: no — a guard the mutation pass asked for: no session was replaced, and none was held by two chats)
  test("a session a chat leaves for another is closed; one another chat still holds is not", async () => {
    const n = sent().length;
    await ok("ground/m", "replace-c", [{ role: "user", content: "leave me" }]);
    const left = sessionOf("leave me");
    await ok("ground/m#sess_old2", "replace-c", [{ role: "user", content: "into the old chat" }]);
    await until(() => sent().some((c) => c.method === "session/close" && c.sessionId === left), "the left session's close");

    await ok("ground/m#sess_old1", "share-a", [{ role: "user", content: "first of two" }]);
    await ok("ground/m#sess_old1", "share-b", [{ role: "user", content: "second of two" }]);
    await forget("ground", "share-a");
    await ok("ground/m", "share-b", [{ role: "user", content: "the second goes on" }]);
    assert.equal(sessionOf("the second goes on"), "sess_old1", "the other chat goes on in the session");
    assert.deepEqual(sent().slice(n).filter((c) => c.method === "session/close" && c.sessionId === "sess_old1"), [], "held by another chat: not closed");
  });

  // (fails before: yes — a session moved to another process was replayed there with session/load, and the process it
  // left kept it open)
  test("a session moved to another process is resumed there without its history replayed, and closed where it was", async () => {
    await ok("ground/m1", "move", [{ role: "user", content: "move me" }]);
    const sid = sessionOf("move me");
    const from = sent().find((c) => c.method === "session/new" && c.sessionId === sid)?.pid;
    await ok("ground/m2", "move", [{ role: "user", content: "move me" }, { role: "assistant", content: "ok" }, { role: "user", content: "now on m2" }]);
    // (fails before: no — a guard the mutation pass asked for: the move's note was never read)
    const moved = app.usage.list(1)[0].changes;
    assert.ok(moved.includes(`acp: session ${sid.slice(0, 8)} resumed into m2 process`), JSON.stringify(moved));
    await until(() => sent().some((c) => c.method === "session/close" && c.sessionId === sid), "the old process's close");
    const mine = sent().filter((c) => c.sessionId === sid);
    assert.deepEqual(mine.map((c) => [c.method, c.pid === from ? "from" : "to"]), [["session/new", "from"], ["session/resume", "to"], ["session/close", "from"]], JSON.stringify(mine));

    await ok("plain/m1", "move-plain", [{ role: "user", content: "move plain" }]);
    const psid = sessionOf("move plain");
    await ok("plain/m2", "move-plain", [{ role: "user", content: "move plain" }, { role: "assistant", content: "ok" }, { role: "user", content: "now on m2" }]);
    assert.ok(app.usage.list(1)[0].changes.includes(`acp: session ${psid.slice(0, 8)} loaded into m2 process`), JSON.stringify(app.usage.list(1)[0].changes));
    // The next session in the process it left: a close sent at the move would have reached the agent before it.
    await ok("plain/m1", "after-move-plain", [{ role: "user", content: "after the move" }]);
    assert.deepEqual(sent().filter((c) => c.sessionId === psid).map((c) => c.method), ["session/new", "session/load"], "without resume and close: loaded, and nothing closed");
  });

  // (fails before: no — a guard the mutation pass asked for: no reopen failed, so the session it left open was never
  // looked at)
  test("a session the new process cannot reopen is closed in the one it was in, and the chat goes on in a new one", async () => {
    await ok("flaky/m1", "flaky-move", [{ role: "user", content: "flaky start" }]);
    const sid = sessionOf("flaky start");
    const from = sent().find((c) => c.method === "session/new" && c.sessionId === sid)?.pid;
    await ok("flaky/m2", "flaky-move", [{ role: "user", content: "flaky start" }, { role: "assistant", content: "ok" }, { role: "user", content: "flaky on m2" }]);
    await until(() => sent().some((c) => c.method === "session/close" && c.sessionId === sid), "the close where it was");
    const mine = sent().filter((c) => c.sessionId === sid);
    assert.deepEqual(mine.map((c) => [c.method, c.pid === from ? "from" : "to"]), [["session/new", "from"], ["session/resume", "to"], ["session/close", "from"]], JSON.stringify(mine));
  });

  // (fails before: yes — the owner's chat of 10-31: Claude Code's process died between two turns, claude-agent-acp let
  // the session go and said to start a new one, and every Retry went to the session it no longer had: "Session not
  // found", four times)
  test("a session the agent lost under a turn is opened again by the next, from what the agent saved, in the same session", async () => {
    const first = [{ role: "user", content: "loser start" }];
    await ok("loser/m", "loser-chat", first);
    const sid = sessionOf("loser start");
    const asked = [...first, { role: "assistant", content: "ok" }, { role: "user", content: "~losesession one: go on" }];
    const died = await chat("loser/m", "loser-chat", asked);
    const why = await died.text();
    assert.notEqual(died.status, 200, why);
    assert.match(why, /process exited unexpectedly/);
    // Retry: the same words again.
    const again = await chat("loser/m", "loser-chat", asked);
    const text = await again.text();
    assert.equal(again.status, 200, text);
    assert.doesNotMatch(text, /Session not found/);
    const prompts = readFileSync(join(dataDir, "prompts.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(prompts.filter((p) => /~losesession one/.test(p.text)).map((p) => p.sessionId), [sid, sid], "the retry went to the same session, opened again");
    const mine = sent().filter((c) => c.sessionId === sid).map((c) => c.method);
    assert.deepEqual(mine, ["session/new", "session/close", "session/resume"], JSON.stringify(mine));
  });
});

// (fails before: yes — an agent removed from the config kept what it declared in acp-profiles.json for good)
test("an agent removed from the config takes what it declared with it: on the save, and at start for one removed while Filament was down", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "filament-acp-profiles-"));
  const cfg = defaultConfig();
  cfg.server.port = 0;
  cfg.server.inboundKeys = ["k"];
  cfg.observability.logFile = "";
  cfg.memory.enabled = false;
  const acp = { command: process.execPath, args: [FAKE], env: {}, cwdDefault: dataDir, permissions: "allow-all", hints: false };
  cfg.upstreams = [
    { id: "stays", name: "an agent that stays", type: "acp", acp },
    { id: "goes", name: "an agent that is removed", type: "acp", acp },
  ];
  cfg.routes = [];
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
  const file = join(dataDir, "acp-profiles.json");
  /** The upstreams acp-profiles.json keeps an answer for. */
  const inFile = () => Object.keys(JSON.parse(readFileSync(file, "utf8")).profiles).sort();
  let port = 0;
  /** @param {string} path @param {RequestInit} [init] */
  const api = async (path, init) => (await fetch(`http://127.0.0.1:${port}/api${path}`, init)).json();
  const shown = async () => Object.keys((await api("/acp/profiles")).profiles).sort();
  /** @type {any} */
  let app = createApp(/** @type {any} */ ({ dataDir, overrides: { port: 0 } }));
  try {
    port = (await app.start()).port;
    for (const id of ["stays", "goes"]) assert.equal((await api(`/acp/${id}/offer`)).ok, true, id);
    assert.deepEqual(inFile(), ["goes", "stays"]);
    const { config } = await api("/state");
    const saved = await api("/config", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...config, upstreams: config.upstreams.filter((/** @type {any} */ u) => u.id !== "goes") }) });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.deepEqual([await shown(), inFile()], [["stays"], ["stays"]], "gone from the page's answer and from the data folder");
    await app.stop();
    // One removed while Filament was down: its answer is still in the file when Filament starts. The save kept the port
    // the app bound; the restart takes a new one, as at first, so no kept connection reaches the stopped app.
    const kept = JSON.parse(readFileSync(file, "utf8"));
    kept.profiles.ghost = kept.profiles.stays;
    writeFileSync(file, JSON.stringify(kept));
    const onDisk = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8"));
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ ...onDisk, server: { ...onDisk.server, port: 0 } }));
    app = createApp(/** @type {any} */ ({ dataDir, overrides: { port: 0 } }));
    port = (await app.start()).port;
    assert.deepEqual([await shown(), inFile()], [["stays"], ["stays"]], "let go of at start");
  } finally {
    await app.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
