// @ts-check
// An agent's own steps have no clock (HarnessV3-FailurePoints §4 B): a request waits for the agent's answer, its error
// or its process's end. A turn's stop ends its own wait, and what it waited on goes on for whoever comes next; a probe
// names its own limit (FP-D2).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AcpProcess } from "../src/adapters/agents/acp/process.js";
import { AcpBridge } from "../src/adapters/agents/acp/bridge.js";
import { FAKE_ACP_AGENT } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const quiet = () => {};
/** Real time passing, a few event-loop turns at a time, while the test's clock is mocked. @param {number} ms */
const breathe = async (ms) => {
  const end = performance.now() + ms;
  while (performance.now() < end) await new Promise((r) => setImmediate(r));
};
/**
 * A promise's state, read without waiting on it.
 * @param {Promise<any>} p @returns {{ settled: boolean, value: any, error: any }}
 */
const watch = (p) => {
  const s = { settled: false, value: /** @type {any} */ (undefined), error: /** @type {any} */ (undefined) };
  p.then(
    (v) => Object.assign(s, { settled: true, value: v }),
    (e) => Object.assign(s, { settled: true, error: e }),
  );
  return s;
};
/** Breathe until `s` settles, ten seconds at most. @param {{ settled: boolean }} s @param {string} what */
const settles = async (s, what) => {
  const end = performance.now() + 10_000;
  while (!s.settled) {
    if (performance.now() > end) assert.fail(`timed out waiting for ${what}`);
    await breathe(10);
  }
};
/** @param {string} text */
const bodyOf = (text) => ({ model: "m", max_tokens: 100, messages: [{ role: "user", content: text }] });

describe("an agent's own steps have no clock", () => {
  /** @type {string} */ let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-agent-waits-"));
  });
  after(() => removeDirs(dir));

  /** The fake agent, started. @param {import("node:test").TestContext} t @param {Record<string, string>} env */
  const started = (t, env) => {
    const p = /** @type {any} */ (new AcpProcess({ command: process.execPath, args: [FAKE_ACP_AGENT], env, log: quiet })).start();
    t.after(() => p.kill());
    return p;
  };
  /** An upstream on the fake agent. @param {string} id @param {Record<string, string>} env */
  const upstreamOf = (id, env) => ({ id, name: id, type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env, cwdDefault: dir, permissions: "allow-all" } });
  /** The agent's requests still waiting on its answer. @param {any} b */
  const waitingOn = (b) => [...b.procs.values()].flatMap((/** @type {any} */ p) => [...p.pending.values()].map((/** @type {any} */ x) => x.method));

  // (fails before: yes — a request that named no limit was given a minute: "ACP session/new timed out after 60000 ms";
  // and nothing but its clock or its answer ended it)
  test("a request is waited for past the minute it was given; a stop ends its own wait and its late answer is dropped; a probe's limit holds", async (t) => {
    const calls = join(dir, "request-calls.jsonl");
    const p = started(t, { FAKE_ACP_SLOW_NEW_MS: "300", FAKE_ACP_CALLS: calls });
    /** How many sessions the agent was asked to open. */
    const opened = () => readFileSync(calls, "utf8").split("\n").filter((l) => l.includes('"session/new"')).length;
    await p.initialize();
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const slow = watch(p.request("session/new", { cwd: dir, mcpServers: [] }));
    t.mock.timers.tick(61_000);
    await breathe(20);
    assert.equal(slow.settled, false, "no clock ended it");
    await settles(slow, "the agent's answer");
    assert.match(String(slow.value?.sessionId), /^sess_/);
    const stop = new AbortController();
    const cut = watch(p.request("session/new", { cwd: dir, mcpServers: [] }, 0, stop.signal));
    stop.abort();
    await settles(cut, "the stop");
    assert.deepEqual([cut.error?.name, cut.error?.message], ["AbortError", "stopped while waiting for ACP's answer to session/new"]);
    // (fails before: no — guards the mutation pass asked for: a stopped wait kept until its answer came, and a request
    // whose stop came first sent anyway)
    assert.equal(p.pending.size, 0, "the stop let go of its wait at once");
    await breathe(500);
    assert.equal(p.pending.size, 0, "its answer came, and nobody was waiting for it");
    const asked = opened();
    const late = watch(p.request("session/new", { cwd: dir, mcpServers: [] }, 0, stop.signal));
    await settles(late, "the stop that came first");
    assert.equal(late.error?.message, "stopped while waiting for ACP's answer to session/new");
    await breathe(500);
    assert.equal(opened(), asked, "never sent");
    const probe = watch(p.request("session/new", { cwd: dir, mcpServers: [] }, 1000));
    t.mock.timers.tick(1000);
    await settles(probe, "the probe's limit");
    assert.equal(probe.error?.message, "ACP session/new timed out after 1000 ms");
    t.mock.timers.reset();
  });

  // (fails before: yes — the handshake was a request with its minute: every caller waiting on it failed with it, and a
  // stop ended no caller's wait)
  test("a handshake has no clock: a probe's wait ends at its limit, a turn's at its stop, and the handshake goes on", async (t) => {
    const gate = join(dir, "init-gate");
    const p = started(t, { FAKE_ACP_INIT_GATE: gate });
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const turn = watch(p.initialize());
    const stop = new AbortController();
    const stopped = watch(p.initialize({ signal: stop.signal }));
    const probe = watch(p.initialize({ waitMs: 60_000 }));
    t.mock.timers.tick(60_000);
    await settles(probe, "the probe's limit");
    assert.equal(probe.error?.message, "ACP did not finish its handshake in 60 s");
    assert.deepEqual([turn.settled, stopped.settled], [false, false]);
    stop.abort();
    await settles(stopped, "the stop");
    assert.deepEqual([stopped.error?.name, stopped.error?.message], ["AbortError", "stopped while waiting for ACP's answer to its handshake"]);
    // (fails before: no — a guard the mutation pass asked for: a wait whose stop came first waited on)
    const late = watch(p.initialize({ signal: stop.signal }));
    await settles(late, "the stop that came first");
    assert.equal(late.error?.message, "stopped while waiting for ACP's answer to its handshake");
    t.mock.timers.reset();
    writeFileSync(gate, "");
    await settles(turn, "the handshake");
    assert.equal(turn.value?.agentInfo?.name, "fake-acp");
    assert.equal(p.initResult, turn.value);
  });

  // (fails before: yes — a turn waited for the agent's handshake with no way to stop it: the stop came, and the turn
  // went on waiting for an agent that had not answered)
  test("a stop while the agent starts ends the turn there, cancelled; the start goes on, and the chat's next turn runs on that agent", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    const gate = join(dir, "turn-init-gate");
    const upstream = upstreamOf("held-start", { FAKE_ACP_INIT_GATE: gate });
    try {
      const stop = new AbortController();
      const running = b.run({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf("hello"), conversationId: "held-start", signal: stop.signal, onEvent: () => {} });
      await until(() => waitingOn(b).includes("initialize"), "the agent's handshake to be asked");
      stop.abort();
      const out = await running;
      assert.equal(out.stopReason, "cancelled");
      assert.ok(out.notes.includes("acp: stopped while waiting for ACP's answer to its handshake"), out.notes.join("\n"));
      const [agent] = [...b.procs.values()];
      assert.equal(agent.exited, false, "its start goes on");
      writeFileSync(gate, "");
      const next = await b.run({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf("hello"), conversationId: "held-start", signal: null, onEvent: () => {} });
      assert.equal(next.stopReason, "end_turn");
      assert.deepEqual([...b.procs.values()], [agent], "the same agent");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — the stop waited for session/new's answer, a minute here: a session was opened with no clock
  // the turn's stop could end)
  test("a stop while the session opens ends the turn at once, cancelled", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    try {
      const stop = new AbortController();
      const running = b.run({ upstream: upstreamOf("slow-new", { FAKE_ACP_SLOW_NEW_MS: "60000" }), modelId: "fake-a", format: "anthropic", body: bodyOf("hello"), conversationId: "slow-new", signal: stop.signal, onEvent: () => {} });
      await until(() => waitingOn(b).includes("session/new"), "the session to be asked for");
      const t0 = performance.now();
      stop.abort();
      const out = await running;
      assert.ok(performance.now() - t0 < 10_000, "at once, not when the agent answered");
      assert.equal(out.stopReason, "cancelled");
      assert.ok(out.notes.includes("acp: stopped while waiting for ACP's answer to session/new"), out.notes.join("\n"));
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — HarnessV4_Tasks B9: the answer a stop no longer waited for was dropped, so the session the
  // agent then opened stayed in it, held by nothing)
  test("a session the agent opens after a stop cut the wait for it is let go of", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    const calls = join(dir, "late-new-calls.jsonl");
    /** @returns {any[]} */
    const called = () => { try { return readFileSync(calls, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
    try {
      const stop = new AbortController();
      const running = b.run({ upstream: upstreamOf("late-new", { FAKE_ACP_SLOW_NEW_MS: "600", FAKE_ACP_SESSION_CAPS: "close", FAKE_ACP_CALLS: calls }), modelId: "fake-a", format: "anthropic", body: bodyOf("hello"), conversationId: "late-new", signal: stop.signal, onEvent: () => {} });
      await until(() => waitingOn(b).includes("session/new"), "the session to be asked for");
      stop.abort();
      assert.equal((await running).stopReason, "cancelled");
      const opened = await until(() => called().find((c) => c.method === "session/new"), "the session the agent opened");
      await until(() => called().some((c) => c.method === "session/close" && c.sessionId === opened.sessionId), "the session let go of, once the agent answered");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — a mode switch had thirty seconds and no stop: the turn's stop waited them out, and the switch
  // the stop cut short was noted as one the agent refused, "mode ask not applied")
  test("a stop while the session's mode switches ends the turn at once, cancelled, and notes no refusal", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    try {
      const stop = new AbortController();
      const running = b.run({ upstream: upstreamOf("slow-mode", { FAKE_ACP_SLOW_MODE_MS: "60000" }), modelId: "fake-a", format: "anthropic", body: bodyOf("hello"), conversationId: "slow-mode", mode: "ask", signal: stop.signal, onEvent: () => {} });
      await until(() => waitingOn(b).includes("session/set_mode"), "the mode to be switched");
      const t0 = performance.now();
      stop.abort();
      const out = await running;
      assert.ok(performance.now() - t0 < 10_000, "at once, not when the agent answered");
      assert.equal(out.stopReason, "cancelled");
      assert.ok(!out.notes.some((/** @type {string} */ n) => /not applied/.test(n)), out.notes.join("\n"));
    } finally {
      b.shutdown();
    }
  });

  // (fails before: no — a guard: a probe of the agent waits a minute for its handshake, and says so when it gives up)
  test("a probe waits a minute for the agent's handshake, and says what it waited for", async (t) => {
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    try {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      const listed = watch(b.listSessions(upstreamOf("probe-held", { FAKE_ACP_INIT_GATE: join(dir, "probe-gate-never") })));
      await breathe(300);
      t.mock.timers.tick(60_000);
      await settles(listed, "the probe's limit");
      assert.deepEqual(listed.value, { ok: false, error: "ACP did not finish its handshake in 60 s", sessions: [] });
    } finally {
      t.mock.timers.reset();
      b.shutdown();
    }
  });
});
