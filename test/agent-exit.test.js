// @ts-check
// An agent that exits: what it wrote before is read before its turn ends (the bug report's X4). Node can say a process
// exited before the last of its output has come, as on a busy machine; the tests pause the fake's output while it says
// its last and exits, so Node says it exited first, and resume it once it has.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { AcpBridge } from "../src/adapters/agents/acp/bridge.js";
import { RpcProcess } from "../src/adapters/agents/agent-process.js";
import { CodexBridge } from "../src/adapters/agents/codex/bridge.js";
import { FAKE_ACP_AGENT, FIXTURES } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const quiet = () => {};
/** JSON lines of a file, oldest first. @param {string} file */
const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
/** @param {string} text */
const bodyOf = (text) => ({ model: "m", max_tokens: 100, messages: [{ role: "user", content: text }] });
/** A turn's events, and a wait for its first words. */
const heard = () => {
  /** @type {any[]} */
  const events = [];
  /** @type {() => void} */
  let said = () => {};
  const first = new Promise((resolve) => (said = () => resolve(undefined)));
  /** @param {any} ev */
  const onEvent = (ev) => {
    events.push(ev);
    if (ev.type === "text") said();
  };
  return { events, first, onEvent, says: (/** @type {string} */ words) => events.some((ev) => ev.type === "text" && String(ev.text).includes(words)) };
};
/**
 * The agent says its last and exits (`gate` lets it) while its output is paused; once Node has said it exited, the
 * output is resumed. @param {any} agent @param {string} gate
 */
const exitBeforeRead = async (agent, gate) => {
  agent.child.stdout.pause();
  agent.child.stderr.pause();
  writeFileSync(gate, "");
  await until(() => agent.exited, "Node to say the agent exited");
  agent.child.stdout.resume();
  agent.child.stderr.resume();
};

describe("an agent that exits", () => {
  /** @type {string} */ let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-exit-"));
  });
  // The agents run in it, and a bridge's shutdown kills them without waiting for them to exit.
  after(() => removeDirs(dir));

  // (fails before: yes — the turn failed as soon as Node said the agent had exited, and what it wrote last, read after,
  // was lost: its edit gone from the turn, its words from the reply and its stderr from the failure)
  test("an ACP turn whose agent exits keeps what the agent wrote before it: its edit, its words, its stderr", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    const gate = join(dir, "acp-gate");
    const upstream = { id: "exit-acp", name: "exit-acp", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_EXIT_GATE: gate }, cwdDefault: dir, permissions: "allow-all" } };
    const turn = heard();
    /** @type {any} */
    let facts = null;
    try {
      const running = b.run({
        upstream,
        modelId: "fake-a",
        format: "anthropic",
        body: bodyOf("~lastwords"),
        conversationId: "chat",
        signal: null,
        onEvent: (/** @type {any} */ ev) => {
          if (ev.type === "session") facts = ev.facts;
          turn.onEvent(ev);
        },
      });
      running.catch(() => {});
      await turn.first;
      await exitBeforeRead([...b.procs.values()][0], gate);
      await assert.rejects(running, /agent process exited \(code 3\): fake agent: gone for good/);
      assert.ok(turn.says("last words"), "its last words reached the reply");
      assert.deepEqual([facts?.tools.find((/** @type {any} */ t) => t.id === "e9")?.status, facts?.linesAdded], ["completed", 1], "its last edit is the turn's");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: no — a guard the mutation pass asked for: an agent whose pipes stay open once it has exited, as a
  // process it started holds them where its pipes are inherited, left its requests waiting for ever. No real process
  // holds them so on Windows: the agent here is a stand-in that says it exited and never that its pipes closed)
  test("an agent whose pipes stay open once it has exited fails its requests within a moment", async () => {
    const child = Object.assign(new EventEmitter(), { pid: 0, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
    const p = new RpcProcess({ command: process.execPath, name: "held" });
    const cp = /** @type {any} */ (childProcess);
    const real = cp.spawn;
    cp.spawn = () => child;
    syncBuiltinESMExports();
    try {
      p.start();
    } finally {
      cp.spawn = real;
      syncBuiltinESMExports();
    }
    const asked = p.request("ping", {}, 0);
    child.emit("exit", 3, null);
    /** @type {any} */
    let timer = null;
    const ended = await Promise.race([
      asked.then(
        () => "answered",
        (/** @type {any} */ e) => String(e.message),
      ),
      new Promise((r) => (timer = setTimeout(() => r("still waiting"), 5000))),
    ]);
    clearTimeout(timer);
    assert.match(String(ended), /agent process exited \(code 3\)/);
  });

  // (fails before: yes — nothing ended a wait on the agent's own word when its process ended, once no clock did
  // (HarnessV3-FailurePoints §4 B): `ending` is that end)
  test("a wait on an agent's process fails as its requests do once it ends; at once when it has; and lets go when told", async () => {
    const child = Object.assign(new EventEmitter(), { pid: 0, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
    const p = new RpcProcess({ command: process.execPath, name: "ends" });
    const cp = /** @type {any} */ (childProcess);
    const real = cp.spawn;
    cp.spawn = () => child;
    syncBuiltinESMExports();
    try {
      p.start();
    } finally {
      cp.spawn = real;
      syncBuiltinESMExports();
    }
    const waiting = p.ending("the turn");
    const kept = p.ending("a turn that ended first");
    assert.equal(p.listenerCount("close"), 2);
    kept.unhook();
    assert.equal(p.listenerCount("close"), 1, "let go of, a wait no longer watches");
    child.emit("exit", 3, null);
    child.emit("close");
    await assert.rejects(waiting.gone, /agent process exited \(code 3\)/);
    assert.equal(p.listenerCount("close"), 0);
    await assert.rejects(p.ending("the next wait").gone, /agent process exited \(code 3\)/, "at once, once it has ended");
  });

  // (fails before: yes — the turn failed as Codex's app-server exited, before the end of the turn it had sent was read)
  test("a Codex turn the app-server ended just before it exited is ended, with its last words", async () => {
    const b = new CodexBridge({ log: quiet });
    const gate = join(dir, "codex-gate");
    const upstream = { id: "exit-codex", name: "exit-codex", type: "codex", acp: { command: process.execPath, args: [join(FIXTURES, "fake-codex-app-server.mjs")], env: { FAKE_CODEX_EXIT_GATE: gate }, cwdDefault: dir, permissions: "allow-all" } };
    const turn = heard();
    try {
      const running = b.run({ upstream, modelId: "gpt-6-astra", format: "anthropic", body: bodyOf("~lastwords"), conversationId: "chat", onEvent: turn.onEvent });
      running.catch(() => {});
      await turn.first;
      await exitBeforeRead(b.procs.get("exit-codex"), gate);
      assert.equal((await running).stopReason, "end_turn");
      assert.ok(turn.says("last words"), "its last words reached the reply");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — the review of 10-31: a chat whose session the agent had lost closed it as it opened it again,
  // outside the session's lock, so under the running turn of a chat that shares it and had opened it again already;
  // the Hunter's of 10-31: the chat that shares it was not told, and its next turn failed "Session not found" first;
  // the Hunter's of 11-01 on ed10cb730: once the other had opened it again, the chat was still marked lost — its card
  // said its session opens first, and its next turn opened it once more)
  test("a session two chats share, lost under one: both are told; the first to open it again closes it and opens it for both, the other going on in it as it stands", async () => {
    const gate = join(dir, "shared-gate");
    const calls = join(dir, "shared-calls.jsonl");
    const prompts = join(dir, "shared-prompts.jsonl");
    const upstream = { id: "shared", name: "shared", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: calls, FAKE_ACP_LOG: prompts, FAKE_ACP_SESSION_CAPS: "close,resume", FAKE_ACP_ALLOW_LOAD: "1" }, cwdDefault: dir, permissions: "allow-all" } };
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    /** @param {string} chat @param {string} text @param {AbortSignal | null} [signal] */
    const run = (chat, text, signal = null) => b.run({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf(text), conversationId: chat, signal, onEvent: () => {} });
    try {
      for (const chat of ["A", "B"]) {
        const r = await b.attach({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf("/resume sess_old1"), cwdHint: null, conversationId: chat, sessionId: "sess_old1" });
        assert.ok(r.ok, JSON.stringify(r));
      }
      await run("A", "a one");
      await run("B", "b one");
      await assert.rejects(run("A", "~losesession a"), /process exited unexpectedly/);
      const closed = () => ["A", "B"].map((chat) => b.closed({ upstream, conversationId: chat }));
      assert.deepEqual(closed(), [true, true], "both are told: each opens it first");
      const mark = lines(calls).length;
      const opens = () => lines(calls).slice(mark).filter((c) => c.sessionId === "sess_old1" && /^session\/(close|resume|load|new)$/.test(c.method)).map((c) => c.method);
      const bTurn = run("B", `b two ~waitfor ${gate}`);
      await until(() => lines(prompts).some((p) => String(p.text).includes("b two ~waitfor")), "B's turn to run on the session");
      assert.deepEqual(closed(), [false, false], "B's open opened it for both");
      const aWaits = run("A", "a two");
      writeFileSync(gate, "");
      await bTurn;
      const a2 = await aWaits;
      assert.equal(a2.sessionId, "sess_old1");
      assert.deepEqual(opens(), ["session/close", "session/resume"], "B's open closed it first; A's turn, after B's, went on in it");
      assert.deepEqual(lines(prompts).filter((p) => /^a two$/.test(p.text)).map((p) => p.text), ["a two"]);
    } finally {
      b.shutdown();
    }
  });

  // (fails before: no — a guard: the review of 10-31 found a stop while a chat waited to open its lost session again
  // forgot the loss, so its next turn went to a session the agent had not)
  test("a chat waiting to open its lost session again, stopped meanwhile, keeps it lost: its next turn opens it, closed first", async () => {
    const calls = join(dir, "waitlost-calls.jsonl");
    const prompts = join(dir, "waitlost-prompts.jsonl");
    const upstream = { id: "waitlost", name: "waitlost", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: calls, FAKE_ACP_LOG: prompts, FAKE_ACP_SESSION_CAPS: "close,resume" }, cwdDefault: dir, permissions: "allow-all" } };
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    /** @param {string} text @param {AbortSignal | null} [signal] @param {(ev: any) => void} [onEvent] */
    const run = (text, signal = null, onEvent = () => {}) => b.run({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf(text), conversationId: "W", signal, onEvent });
    try {
      const one = await run("w one");
      await assert.rejects(run("~losesession w"), /process exited unexpectedly/);
      // Something else holds the session's lock: the chat's next turn waits to open it again.
      const release = await b.lockSession(String(one.sessionId));
      const mark = lines(calls).length;
      const opens = () => lines(calls).slice(mark).filter((c) => /^session\/(close|resume|load|new)$/.test(c.method)).map((c) => c.method);
      const stop = new AbortController();
      let resuming = false;
      const waits = run("w two", stop.signal, (ev) => void (ev.type === "step" && ev.step === "resuming" && (resuming = true)));
      waits.catch(() => {});
      await until(() => resuming || null, "the turn to wait to open it again");
      stop.abort();
      const stopped = await waits.then((r) => r?.stopReason, (e) => String(e?.message || e));
      assert.notEqual(stopped, "end_turn", String(stopped));
      release();
      assert.deepEqual(opens(), [], "the stopped turn asked the agent nothing");
      assert.equal(b.closed({ upstream, conversationId: "W" }), true, "still lost");
      const three = await run("w three");
      assert.equal(three.sessionId, one.sessionId);
      assert.deepEqual(opens(), ["session/close", "session/resume"]);
      assert.deepEqual(lines(prompts).filter((p) => /^w (two|three)$/.test(p.text)).map((p) => p.text), ["w three"], "the stopped turn never reached it");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: no — a guard: of two chats waiting to open the session they share again, the first closes and opens
  // it, and the other, under the same lock after it, opens it as it stands, never closing it under the first's turn)
  test("two chats that share a lost session, both waiting to open it again: the first closes and opens it, the other opens it as it stands", async () => {
    const calls = join(dir, "bothwait-calls.jsonl");
    const prompts = join(dir, "bothwait-prompts.jsonl");
    const upstream = { id: "bothwait", name: "bothwait", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: calls, FAKE_ACP_LOG: prompts, FAKE_ACP_SESSION_CAPS: "close,resume", FAKE_ACP_ALLOW_LOAD: "1" }, cwdDefault: dir, permissions: "allow-all" } };
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    /** @type {Set<string>} */
    const resuming = new Set();
    /** @param {string} chat @param {string} text */
    const run = (chat, text) => b.run({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf(text), conversationId: chat, signal: null, onEvent: (ev) => void (ev.type === "step" && ev.step === "resuming" && resuming.add(chat)) });
    try {
      for (const chat of ["A", "B"]) {
        const r = await b.attach({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf("/resume sess_old1"), cwdHint: null, conversationId: chat, sessionId: "sess_old1" });
        assert.ok(r.ok, JSON.stringify(r));
      }
      await run("A", "a one");
      await run("B", "b one");
      await assert.rejects(run("A", "~losesession a"), /process exited unexpectedly/);
      // Something else holds the session's lock: both chats' next turns wait to open it again.
      resuming.clear();
      const release = await b.lockSession("sess_old1");
      const mark = lines(calls).length;
      const aTurn = run("A", "a two");
      const bTurn = run("B", "b two");
      await until(() => resuming.size === 2 || null, "both turns to wait to open it again");
      release();
      const [a2, b2] = await Promise.all([aTurn, bTurn]);
      assert.deepEqual([a2.sessionId, b2.sessionId], ["sess_old1", "sess_old1"]);
      const opens = lines(calls).slice(mark).filter((c) => c.sessionId === "sess_old1" && /^session\/(close|resume|load|new)$/.test(c.method)).map((c) => c.method);
      assert.deepEqual(opens, ["session/close", "session/resume", "session/resume"], "closed once, by the first");
      assert.deepEqual(["A", "B"].map((chat) => b.closed({ upstream, conversationId: chat })), [false, false]);
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — the Hunter's of 11-01 on ed10cb730, its summary way: a summary of the chat that shares the
  // session opened it again for itself alone, so the chat it was lost under still read lost and opened it once more)
  test("a session two chats share, lost under one, opened again by the other's summary: open for both, the first going on in it", async () => {
    const calls = join(dir, "sharesum-calls.jsonl");
    const upstream = { id: "sharesum", name: "sharesum", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: calls, FAKE_ACP_CONFIG: "1", FAKE_ACP_SESSION_CAPS: "close,resume", FAKE_ACP_ALLOW_LOAD: "1" }, cwdDefault: dir, permissions: "allow-all" } };
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    /** @param {string} chat @param {string} text */
    const run = (chat, text) => b.run({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf(text), conversationId: chat, signal: null, onEvent: () => {} });
    try {
      for (const chat of ["A", "B"]) {
        const r = await b.attach({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf("/resume sess_old1"), cwdHint: null, conversationId: chat, sessionId: "sess_old1" });
        assert.ok(r.ok, JSON.stringify(r));
      }
      await run("A", "a one");
      await run("B", "b one");
      await assert.rejects(run("A", "~losesession a"), /process exited unexpectedly/);
      const mark = lines(calls).length;
      const opens = () => lines(calls).slice(mark).filter((c) => c.sessionId === "sess_old1" && /^session\/(close|resume|load|new)$/.test(c.method)).map((c) => c.method);
      await b.summarize({ upstream, conversationId: "B", instruction: "Summarize the conversation." });
      assert.deepEqual(opens(), ["session/close", "session/resume"], "B's summary opened it again, closed first");
      assert.deepEqual(["A", "B"].map((chat) => b.closed({ upstream, conversationId: chat })), [false, false], "open for both");
      const a2 = await run("A", "a two");
      assert.equal(a2.sessionId, "sess_old1");
      assert.deepEqual(opens(), ["session/close", "session/resume"], "A's turn went on in it");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — the developer's Hunter of 11-01 on 58c3ea758 and on 9aefc0bf5: a chat attaching its own lost
  // session had it probed — opened without Filament's tools — and its record replaced, the mark that it was lost with it,
  // so what its next turn found was the probe's session or one it kept the probe's way)
  test("a chat attaching its own lost session attaches nothing: its next turn opens it, closed first", async () => {
    const calls = join(dir, "selfattach-calls.jsonl");
    const upstream = { id: "selfattach", name: "selfattach", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: calls, FAKE_ACP_SESSION_CAPS: "close,resume", FAKE_ACP_ALLOW_LOAD: "1" }, cwdDefault: dir, permissions: "allow-all" } };
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    /** @param {string} text */
    const run = (text) => b.run({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf(text), conversationId: "S", signal: null, onEvent: () => {} });
    const attach = () => b.attach({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf("/resume sess_old1"), cwdHint: null, conversationId: "S", sessionId: "sess_old1" });
    try {
      assert.ok((await attach()).ok);
      await run("s one");
      await assert.rejects(run("~losesession s"), /process exited unexpectedly/);
      const mark = lines(calls).length;
      const opens = () => lines(calls).slice(mark).filter((c) => c.sessionId === "sess_old1" && /^session\/(close|resume|load|new)$/.test(c.method)).map((c) => c.method);
      const r = await attach();
      assert.ok(r.ok, JSON.stringify(r));
      assert.deepEqual(opens(), [], "nothing opened: the chat holds it");
      assert.equal(b.closed({ upstream, conversationId: "S" }), true, "still lost");
      const two = await run("s two");
      assert.equal(two.sessionId, "sess_old1");
      assert.deepEqual(opens(), ["session/close", "session/resume"], "its next turn opened it, closed first");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — the review of 11-01 on 9aefc0bf5's first form, and the Hunter's on it: a chat attaching the
  // session it holds live had it probed and its record replaced, the process it is open in no longer named)
  test("a chat attaching the session it holds live attaches nothing: the session as it was, its next turn on in it", async () => {
    const calls = join(dir, "liveattach-calls.jsonl");
    const upstream = { id: "liveattach", name: "liveattach", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: calls, FAKE_ACP_SESSION_CAPS: "close,resume", FAKE_ACP_ALLOW_LOAD: "1" }, cwdDefault: dir, permissions: "allow-all" } };
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    /** @param {string} text */
    const run = (text) => b.run({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf(text), conversationId: "L", signal: null, onEvent: () => {} });
    const attach = () => b.attach({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf("/resume sess_old1"), cwdHint: null, conversationId: "L", sessionId: "sess_old1" });
    try {
      assert.ok((await attach()).ok);
      await run("l one");
      const mark = lines(calls).length;
      const opens = () => lines(calls).slice(mark).filter((c) => c.sessionId === "sess_old1" && /^session\/(close|resume|load|new)$/.test(c.method)).map((c) => c.method);
      assert.ok((await attach()).ok);
      assert.deepEqual(opens(), [], "nothing opened or closed");
      assert.equal((await run("l two")).sessionId, "sess_old1");
      assert.deepEqual(opens(), [], "its next turn went on in it");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — the developer's Hunter of 11-01 on 1c8b72028: the attach found a session in its agent's list
  // alone, so a chat attaching the session it holds, which its agent did not list, was told no session matched, though
  // its next turn goes on in it by its id)
  test("a chat attaching the session it holds, which its agent does not list, by its id or the id's start attaches nothing: its next turn goes on in it", async () => {
    const calls = join(dir, "unlisted-calls.jsonl");
    const upstream = { id: "unlisted", name: "unlisted", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: calls, FAKE_ACP_SESSION_CAPS: "close,resume", FAKE_ACP_ALLOW_LOAD: "1" }, cwdDefault: dir, permissions: "allow-all" } };
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    /** @param {string} chat @param {string} text */
    const run = (chat, text) => b.run({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf(text), conversationId: chat, signal: null, onEvent: () => {} });
    /** @param {string} chat @param {string} ref */
    const attach = (chat, ref) => b.attach({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf(`/resume ${ref}`), cwdHint: null, conversationId: chat, sessionId: ref });
    try {
      const sid = String((await run("N", "n one")).sessionId);
      const mark = lines(calls).length;
      const opens = () => lines(calls).slice(mark).filter((c) => /^session\/(close|resume|load|new)$/.test(c.method)).map((c) => c.method);
      for (const ref of [sid, sid.slice(0, -1)]) {
        const r = await attach("N", ref);
        assert.deepEqual([r.ok, r.session?.sessionId, r.session?.title], [true, sid, "n one"], JSON.stringify(r));
      }
      assert.deepEqual(opens(), [], "nothing opened or closed");
      assert.equal((await run("N", "n two")).sessionId, sid);
      assert.deepEqual(opens(), [], "its next turn went on in it");
      // (fails before: no — a guard: another chat's session the agent does not list is no match)
      assert.deepEqual(await attach("M", sid), { ok: false, error: `no session matches "${sid}" (3 known; type /sessions to list them by name)` });
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — the review of 11-01 and the Hunter's on 9aefc0bf5: the attach replaced the record of a chat
  // whose force-stopped turn its agent had not ended, the mark that said so with it, so the chat's next turn went on in
  // that session, behind that turn — where another chat held it too, the session left open for it)
  test("a chat attaching the session whose force-stopped turn its agent has not ended attaches nothing: its next turn lets it go and starts a new one, the other chat that shares it keeping it", async () => {
    const calls = join(dir, "unendedattach-calls.jsonl");
    const prompts = join(dir, "unendedattach-prompts.jsonl");
    const upstream = { id: "unendedattach", name: "unendedattach", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: calls, FAKE_ACP_LOG: prompts, FAKE_ACP_SESSION_CAPS: "close,resume", FAKE_ACP_ALLOW_LOAD: "1" }, cwdDefault: dir, permissions: "allow-all" } };
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    /** @param {string} chat @param {string} text @param {AbortSignal | null} [force] */
    const run = (chat, text, force = null) => b.run({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf(text), conversationId: chat, signal: null, force, onEvent: () => {} });
    /** @param {string} chat */
    const attach = (chat) => b.attach({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf("/resume sess_old1"), cwdHint: null, conversationId: chat, sessionId: "sess_old1" });
    try {
      for (const chat of ["U", "V"]) assert.ok((await attach(chat)).ok);
      await run("U", "u one");
      await run("V", "v one");
      const force = new AbortController();
      const stuck = run("U", "~deaf to everything", force.signal);
      await until(() => lines(prompts).some((p) => String(p.text).includes("~deaf")), "the turn the agent will not end");
      force.abort();
      await stuck.then(() => {}, () => {});
      const mark = lines(calls).length;
      assert.ok((await attach("U")).ok);
      assert.deepEqual(lines(calls).slice(mark).filter((c) => c.sessionId === "sess_old1" && /^session\/(close|resume|load|new)$/.test(c.method)).map((c) => c.method), [], "nothing opened: the chat holds it");
      // Its words reach the agent where they would wait behind the stuck turn too: the check reads where they went.
      const two = run("U", "u two");
      two.catch(() => {});
      const sent = await until(() => lines(prompts).find((p) => String(p.text).includes("u two")), "the chat's next words to reach the agent");
      assert.notEqual(sent.sessionId, "sess_old1", "a new session, not the one behind the stuck turn");
      assert.notEqual((await two).sessionId, "sess_old1");
      assert.deepEqual(lines(prompts).filter((p) => String(p.text).includes("u two")).map((p) => p.sessionId === "sess_old1"), [false], "its words went to the new session alone");
      assert.deepEqual(lines(calls).slice(mark).filter((c) => c.sessionId === "sess_old1" && c.method === "session/close").map((c) => c.method), [], "not closed: the other chat holds it");
      assert.equal([...b.convs.values()].filter((c) => c.sessionId === "sess_old1").length, 1, "the other chat keeps it");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — the review of 11-01: an attach opened a lost session only to know it opens, without Filament's
  // tools, never closing it first, so a chat attaching its own lost session resumed it as the agent kept it; closing it
  // first, the probe must not open it for the chats it was lost under, whose next turns would go on in it so)
  test("a lost session two chats share, attached meanwhile by a third: the probe, closing it first, opens it for neither; the next turn opens it, closed first", async () => {
    const calls = join(dir, "probe-calls.jsonl");
    const upstream = { id: "probe", name: "probe", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: calls, FAKE_ACP_SESSION_CAPS: "close,resume", FAKE_ACP_ALLOW_LOAD: "1" }, cwdDefault: dir, permissions: "allow-all" } };
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    /** @param {string} chat @param {string} text */
    const run = (chat, text) => b.run({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf(text), conversationId: chat, signal: null, onEvent: () => {} });
    /** @param {string} chat */
    const attach = (chat) => b.attach({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf("/resume sess_old1"), cwdHint: null, conversationId: chat, sessionId: "sess_old1" });
    try {
      for (const chat of ["A", "B"]) assert.ok((await attach(chat)).ok);
      await run("A", "a one");
      await run("B", "b one");
      await assert.rejects(run("A", "~losesession a"), /process exited unexpectedly/);
      const closed = () => ["A", "B"].map((chat) => b.closed({ upstream, conversationId: chat }));
      const mark = lines(calls).length;
      const opens = () => lines(calls).slice(mark).filter((c) => c.sessionId === "sess_old1" && /^session\/(close|resume|load|new)$/.test(c.method)).map((c) => c.method);
      const x = await attach("X");
      assert.ok(x.ok, JSON.stringify(x));
      assert.deepEqual(opens(), ["session/close", "session/resume"], "the probe closed it first");
      assert.deepEqual(closed(), [true, true], "still lost for both");
      await run("B", "b two");
      assert.deepEqual(opens(), ["session/close", "session/resume", "session/close", "session/resume"], "B's turn opened it, closed first");
      assert.deepEqual(closed(), [false, false]);
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — the Hunter's of 10-31: a session lost under a turn kept the tasks its agent ran, which ended
  // with it, so the chat showed them at work for good and could not move)
  test("a session the agent lost under a turn takes its tasks with it: the chat that showed them hears they ended", async () => {
    const upstream = { id: "losttasks", name: "losttasks", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_SESSION_CAPS: "close,resume", FAKE_ACP_WAKE_GATE: join(dir, "never-ends") }, cwdDefault: dir, permissions: "allow-all" } };
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    /** @type {string[][]} */
    const said = [];
    b.onTasks = (/** @type {any} */ e) => void said.push(e.tasks.map((/** @type {any} */ t) => t.id));
    /** @param {string} text */
    const run = (text) => b.run({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf(text), conversationId: "T", chain: "ch_tasks", signal: null, onEvent: () => {} });
    try {
      await run("~thinking");
      await until(() => said.at(-1)?.includes("sh1"), "the chat to hear its task at work");
      await assert.rejects(run("~losesession t"), /process exited unexpectedly/);
      assert.deepEqual(said.at(-1), [], "its tasks ended with it");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — the Hunter's of 10-31: a lost session opened again outside a turn stayed lost, so the chat's
  // next turn closed and opened it once more, saying the agent had lost it under the last turn)
  test("a lost session opened again outside a turn, for a summary, is no longer lost: the next turn goes on in it", async () => {
    const calls = join(dir, "openagain-calls.jsonl");
    const upstream = { id: "openagain", name: "openagain", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: calls, FAKE_ACP_CONFIG: "1", FAKE_ACP_SESSION_CAPS: "resume,close" }, cwdDefault: dir, permissions: "allow-all" } };
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    /** @param {string} text */
    const run = (text) => b.run({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf(text), conversationId: "R", signal: null, onEvent: () => {} });
    try {
      const one = await run("r one");
      await assert.rejects(run("~losesession r"), /process exited unexpectedly/);
      await b.restByRequest({ upstream, format: "anthropic", body: bodyOf("r one"), cwdHint: null, conversationId: "R" });
      await b.summarize({ upstream, conversationId: "R", instruction: "Summarize the conversation." });
      const mark = lines(calls).length;
      const two = await run("r two");
      assert.equal(two.sessionId, one.sessionId);
      assert.deepEqual(lines(calls).slice(mark).filter((c) => /^session\/(close|resume|load|new)$/.test(c.method)).map((c) => c.method), [], "opened already: neither closed nor opened again");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — the developer's Hunter of 10-31: only a turn's prompt marked a session lost, so one lost under
  // a summary was prompted as it stood by the chat's next turn, which failed "Session not found" first)
  test("a session the agent lost under a summary is lost for the chat: its next turn opens it again, closed first", async () => {
    const calls = join(dir, "lostsummary-calls.jsonl");
    const upstream = { id: "lostsum", name: "lostsum", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: calls, FAKE_ACP_CONFIG: "1", FAKE_ACP_SESSION_CAPS: "resume,close" }, cwdDefault: dir, permissions: "allow-all" } };
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    /** @param {string} text */
    const run = (text) => b.run({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf(text), conversationId: "S", signal: null, onEvent: () => {} });
    try {
      const one = await run("s one");
      await assert.rejects(b.summarize({ upstream, conversationId: "S", instruction: "~losesession s" }), /process exited unexpectedly/);
      const mark = lines(calls).length;
      const two = await run("s two");
      assert.equal(two.sessionId, one.sessionId);
      assert.deepEqual(lines(calls).slice(mark).filter((c) => /^session\/(close|resume|load|new)$/.test(c.method)).map((c) => c.method), ["session/close", "session/resume"]);
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — the review's of 10-31: a fork the summary was written in, lost under it, marked the session it
  // was forked from lost, so the chat's next turn closed a session that lived and opened it again)
  test("a fork lost under the summary written in it is the fork's alone: the chat's next turn goes on in its session", async () => {
    const calls = join(dir, "lostfork-calls.jsonl");
    const upstream = { id: "lostfork", name: "lostfork", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: calls, FAKE_ACP_CONFIG: "1", FAKE_ACP_SESSION_CAPS: "resume,close,fork" }, cwdDefault: dir, permissions: "allow-all" } };
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    /** @param {string} text */
    const run = (text) => b.run({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf(text), conversationId: "F", signal: null, onEvent: () => {} });
    try {
      const one = await run("f one");
      await assert.rejects(b.summarize({ upstream, conversationId: "F", instruction: "~losesession f" }), /process exited unexpectedly/);
      const fork = lines(calls).find((c) => c.method === "session/fork")?.sessionId;
      assert.ok(fork, "the summary was written in a fork");
      const mark = lines(calls).length;
      const two = await run("f two");
      assert.equal(two.sessionId, one.sessionId);
      // The fork is let go of as the summary ends, without waiting for the agent: its close may come at any time.
      const opened = lines(calls).slice(mark).filter((c) => c.sessionId !== fork && /^session\/(close|resume|load|new)$/.test(c.method));
      assert.deepEqual(opened.map((c) => c.method), [], "the session lives: neither closed nor opened again");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — the developer's Hunter of 10-31 on 72aefbbc5: a session lost under a turn, its agent's process
  // still up, was said to be open as it stood, so Compact now's card said "In its live session" though the compaction
  // opens it first)
  test("a session lost under a turn, its agent's process up, is one a summary or a compaction opens first, where its agent opens one again; opened again, it is open as it stands", async () => {
    const upstream = { id: "lostclosed", name: "lostclosed", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CONFIG: "1", FAKE_ACP_SESSION_CAPS: "resume,close" }, cwdDefault: dir, permissions: "allow-all" } };
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    const where = { upstream, conversationId: "P" };
    /** @param {string} text */
    const run = (text) => b.run({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf(text), conversationId: "P", signal: null, onEvent: () => {} });
    try {
      await run("p one");
      assert.equal(b.closed(where), false, "open in its process");
      await assert.rejects(run("~losesession p"), /process exited unexpectedly/);
      assert.equal(b.closed(where), true, "lost: opened first");
      await b.summarize({ ...where, instruction: "Summarize the conversation." });
      assert.equal(b.closed(where), false, "opened again");
    } finally {
      b.shutdown();
    }
    // (fails before: yes — the review's: the lost session was said to be opened first by an agent that opens none)
    const none = { id: "lostnone", name: "lostnone", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CONFIG: "1", FAKE_ACP_NO_LOAD: "1" }, cwdDefault: dir, permissions: "allow-all" } };
    const c = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    try {
      await c.run({ upstream: none, modelId: "fake-a", format: "anthropic", body: bodyOf("n one"), conversationId: "N", signal: null, onEvent: () => {} });
      await assert.rejects(c.run({ upstream: none, modelId: "fake-a", format: "anthropic", body: bodyOf("~losesession n"), conversationId: "N", signal: null, onEvent: () => {} }), /process exited unexpectedly/);
      assert.equal(c.closed({ upstream: none, conversationId: "N" }), false, "an agent that opens no session again has none opened first");
    } finally {
      c.shutdown();
    }
  });

  // (fails before: yes — the developer's Hunter of 10-31 on 72aefbbc5: words queued at the agent, which it lost the
  // session under before it took them, failed unread and were let go with the session unmarked, so the chat's next turn
  // went to the session as it stood and failed "Session not found" first)
  test("words queued at the agent, lost with the session before it took them: the session is lost for the chat, and its next turn opens it again, closed first", async () => {
    const gate = mkdtempSync(join(dir, "queued-lose-"));
    const calls = join(dir, "queuedlose-calls.jsonl");
    const upstream = { id: "queuedlose", name: "queuedlose", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_CALLS: calls, FAKE_ACP_QUEUE_GATE: gate, FAKE_ACP_SESSION_CAPS: "close,resume" }, cwdDefault: dir, permissions: "allow-all" } };
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    /** @param {string} text @param {(ev: any) => void} [onEvent] */
    const run = (text, onEvent = () => {}) => b.run({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf(text), conversationId: "L", signal: null, onEvent });
    try {
      const one = await run("l one");
      for (const step of ["q1", "q2"]) writeFileSync(join(gate, step), "");
      /** @type {any} */
      let steer = null;
      let said = "";
      const turn = run("~queue", (ev) => {
        if (ev?.type === "session") steer = ev.steer;
        if (ev?.type === "text") said += String(ev.text || "");
      });
      await until(() => steer && said.includes("done"), "the turn's steps to end, its result held");
      const took = steer.send("and the docs");
      await until(() => lines(calls).some((c) => c.method === "queued prompt"), "the words to be queued at the agent");
      writeFileSync(join(gate, "lose"), "");
      writeFileSync(join(gate, "end"), "");
      await turn;
      assert.equal(await took, false, "never taken");
      const mark = lines(calls).length;
      const two = await run("l two");
      assert.equal(two.sessionId, one.sessionId);
      assert.deepEqual(lines(calls).slice(mark).filter((c) => /^session\/(close|resume|load|new)$/.test(c.method)).map((c) => c.method), ["session/close", "session/resume"]);
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — the developer's Hunter of 10-31: a summary asked for a session lost under a turn, its agent's
  // process still up, went to the session as it stood and failed; and one opened again so was not closed first)
  test("a summary asked for a session lost under a turn opens it again first, closed first, though the agent's process lives", async () => {
    const calls = join(dir, "sumafterlost-calls.jsonl");
    const upstream = { id: "sumafterlost", name: "sumafterlost", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: calls, FAKE_ACP_CONFIG: "1", FAKE_ACP_SESSION_CAPS: "resume,close" }, cwdDefault: dir, permissions: "allow-all" } };
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    /** @param {string} text */
    const run = (text) => b.run({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf(text), conversationId: "Q", signal: null, onEvent: () => {} });
    /** @param {number} from */
    const opens = (from) => lines(calls).slice(from).filter((c) => /^session\/(close|resume|load|new)$/.test(c.method)).map((c) => c.method);
    try {
      const one = await run("q one");
      await assert.rejects(run("~losesession q"), /process exited unexpectedly/);
      const mark = lines(calls).length;
      await b.summarize({ upstream, conversationId: "Q", instruction: "Summarize the conversation." });
      assert.deepEqual(opens(mark), ["session/close", "session/resume"]);
      const mark2 = lines(calls).length;
      const two = await run("q two");
      assert.equal(two.sessionId, one.sessionId);
      assert.deepEqual(opens(mark2), [], "opened already: the turn goes on in it");
    } finally {
      b.shutdown();
    }
  });
});
