// @ts-check
// The chats of the three agent bridges, kept: no idle sweep takes a chat with work queued or running, its session or its
// agent, however long the work runs, and a chat is idle from its last turn's end, a failed turn's too, as a restart
// reads it (the bug report's H8); a shutdown writes every chat at once, and keeps them for the saves after it (H10);
// and an agent let go of while a turn opens its session (Connect, an install finishing) runs that turn to its end (H11).
// Cursor's agent a chat dropped or forgotten is closed once no chat holds it (fable51's list). A harness chat idle past
// its limit keeps its session: its agent lets go of it, and the chat's next message opens it again (HarnessV4_Tasks C25).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AcpBridge } from "../src/adapters/agents/acp/bridge.js";
import { SessionMap } from "../src/adapters/agents/acp/sessions.js";
import { CodexBridge } from "../src/adapters/agents/codex/bridge.js";
import { CursorSdkBridge } from "../src/adapters/agents/cursor-sdk.js";
import { CHAT_KEPT_MS, idleStep } from "../src/adapters/agents/idle.js";
import { FAKE_ACP_AGENT, FIXTURES } from "./helpers/app.js";
import { until } from "./helpers/wait.js";

const quiet = () => {};
const HOUR = 3600_000;
/** What a harness turn names its chat's compaction in: none yet. */
const HARNESS = { "x-filament-compaction": "0" };
const SDK = () => import(pathToFileURL(join(FIXTURES, "fake-cursor-sdk.mjs")).href);
/** @param {string} text */
const bodyOf = (text) => ({ model: "m", max_tokens: 100, messages: [{ role: "user", content: text }] });
/** A chat's first message with an earlier conversation before it, which a fake refuses as too long when seeded with it. */
const seeded = () => ({
  model: "m",
  max_tokens: 100,
  messages: [
    { role: "user", content: "one" },
    { role: "assistant", content: "Echo: one" },
    { role: "user", content: "two" },
  ],
});
/** The JSON lines a fake logged. @param {string} file @returns {any[]} */
const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
/** The chat an upstream's turns went to, with its key. @param {any} bridge @param {string} upstreamId @returns {[string, any]} */
const chatOf = (bridge, upstreamId) => {
  const found = [...bridge.convs].find(([, c]) => c.upstreamId === upstreamId);
  assert.ok(found, `a chat on ${upstreamId}`);
  return found;
};
/** A chat as the bridge's state file holds it, once written. @param {string} file @param {string} key @returns {any} */
const savedChat = (file, key) => {
  try {
    return JSON.parse(readFileSync(file, "utf8")).conversations?.[key];
  } catch {
    return undefined;
  }
};
/** The chat on disk last used two hours ago, as a chat left that long is. @param {string} file @param {string} key */
const idleOnDisk = (file, key) => {
  const j = JSON.parse(readFileSync(file, "utf8"));
  j.conversations[key].lastUsed -= 2 * HOUR;
  writeFileSync(file, JSON.stringify(j));
};
/** Until a turn of the bridge's has said something. */
const saying = () => {
  /** @type {() => void} */
  let said = () => {};
  const heard = new Promise((resolve) => (said = () => resolve(undefined)));
  return { heard, onEvent: (/** @type {any} */ ev) => ev.type === "text" && said() };
};
/**
 * Shut a bridge down as the server's stop does, its first chat idle two hours and its second's turn (`running`) two
 * hours in: the state file is written at once, the idle chat as it was and the busy one used until then; once the turn
 * has ended (`end` ends it where the shutdown does not), the save after it finds the map whole.
 * @param {any} bridge @param {string} file @param {[string, string]} on the upstreams of the idle chat and the busy one
 * @param {Promise<any>} running @param {() => void} [end]
 */
const downAndAfter = async (bridge, file, [idleOn, busyOn], running, end = () => {}) => {
  const [idleKey, idle] = chatOf(bridge, idleOn);
  const [busyKey, busy] = chatOf(bridge, busyOn);
  idle.lastUsed -= 2 * HOUR;
  busy.lastUsed -= 2 * HOUR;
  const idleSince = idle.lastUsed;
  rmSync(file, { force: true });
  bridge.shutdown();
  assert.equal(savedChat(file, idleKey)?.lastUsed, idleSince, "the idle chat, written as it was");
  assert.ok(savedChat(file, busyKey)?.lastUsed > Date.now() - HOUR, "the chat whose turn ran, used until the shutdown");
  rmSync(file);
  end();
  await running.then(
    () => {},
    () => {},
  );
  await until(() => existsSync(file), "the save after the turn's end");
  assert.ok(savedChat(file, idleKey) && savedChat(file, busyKey), "the map still holds both chats");
};

describe("an ACP agent's chats", () => {
  /** @type {string} */ let dir;
  /** @type {AcpBridge} */ let bridge;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-kept-acp-"));
    bridge = new AcpBridge(/** @type {any} */ ({ log: quiet }));
  });
  after(() => {
    bridge.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });
  /** @param {string} id */
  const up = (id) => ({
    id,
    name: id,
    type: "acp",
    acp: {
      command: process.execPath,
      args: [FAKE_ACP_AGENT],
      env: { FAKE_ACP_CALLS: join(dir, `${id}-calls.jsonl`), FAKE_ACP_LOG: join(dir, `${id}-prompts.jsonl`), FAKE_ACP_SESSION_CAPS: "close", FAKE_ACP_ALLOW_LOAD: "1" },
      cwdDefault: dir,
      permissions: "allow-all",
      sessionIdleMinutes: 60,
    },
  });
  /** @param {AcpBridge} b @param {any} upstream @param {string} text @param {AbortSignal | null} [signal] */
  const turn = (b, upstream, text, signal = null) =>
    b.run({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf(text), conversationId: "chat", signal, onEvent: () => {} });

  // (fails before: yes — the sweep read the chat as idle from before its turn began, and the agent's process from the
  // turn's start: two hours into the turn it dropped the chat, closed its session and stopped the agent under it)
  test("a chat whose turn runs is never idle: the sweep keeps it, its session and its agent, however long the turn has run", async () => {
    const upstream = up("acp-live");
    const stop = new AbortController();
    const running = turn(bridge, upstream, "keep me ~quiet", stop.signal);
    running.catch(() => {});
    await until(() => lines(join(dir, "acp-live-prompts.jsonl")).some((p) => p.text === "keep me ~quiet"), "the prompt to reach the agent");
    const [key, chat] = chatOf(bridge, "acp-live");
    const agent = bridge.procs.get(chat.procKey);
    bridge.sweep(Date.now() + 2 * HOUR);
    assert.equal(bridge.convs.get(key), chat, "the chat is kept");
    assert.equal(bridge.procs.get(chat.procKey), agent, "its agent runs on");
    assert.equal(agent.exited, false);
    stop.abort();
    assert.equal((await running).stopReason, "cancelled", "the turn ends as its stop ends it");
    assert.deepEqual(lines(join(dir, "acp-live-calls.jsonl")).filter((c) => c.method === "session/close"), [], "its session was never closed");
  });

  // (fails before: yes — a failed turn left the chat idle from before it ran: the next sweep dropped the chat and closed
  // the session a "continue" goes on in, and the state file kept it so for a restart)
  test("a chat is idle from its failed turn's end: the sweep after the failure keeps it, and a restart reads it so", async () => {
    const stateFile = join(dir, "acp-sessions.json");
    const upstream = up("acp-failed");
    const first = new AcpBridge(/** @type {any} */ ({ log: quiet, stateFile }));
    /** @type {AcpBridge | null} */
    let again = null;
    try {
      await turn(first, upstream, "hello");
      const [key] = chatOf(first, "acp-failed");
      await until(() => savedChat(stateFile, key), "the chat saved");
      first.shutdown();
      idleOnDisk(stateFile, key);
      again = new AcpBridge(/** @type {any} */ ({ log: quiet, stateFile }));
      await assert.rejects(turn(again, upstream, "please ~rpcrefuse this"));
      again.sweep(Date.now());
      assert.ok(again.convs.has(key), "the chat is kept");
      await until(() => savedChat(stateFile, key)?.lastUsed > Date.now() - HOUR, "the failure's end saved, for a restart to read");
    } finally {
      first.shutdown();
      again?.shutdown();
    }
  });

  // (fails before: yes — the shutdown wrote nothing: a save still waiting was lost with the process, the map it emptied
  // went over every chat's session at the next save, and a chat whose turn ran read idle from before the turn)
  test("a shutdown writes every chat at once, one whose turn runs used until then, and the saves after it find them all", async () => {
    const stateFile = join(dir, "acp-down.json");
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet, stateFile }));
    try {
      await turn(b, up("acp-done"), "hello");
      const running = turn(b, up("acp-busy"), "keep me ~quiet");
      running.catch(() => {});
      await until(() => lines(join(dir, "acp-busy-prompts.jsonl")).some((p) => p.text === "keep me ~quiet"), "the prompt to reach the agent");
      await downAndAfter(b, stateFile, ["acp-done", "acp-busy"], running);
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — an agent counted as busy only once the turn's session had opened: Connect, or an install
  // finishing, stopped it under a turn still opening its session, and the turn failed)
  test("an agent let go of while a turn opens its session runs the turn to its end, then stops; the chat reopens the session in the next", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    const upstream = up("acp-letgo");
    upstream.acp.env.FAKE_ACP_SLOW_NEW_MS = "600";
    const calls = join(dir, "acp-letgo-calls.jsonl");
    /** @type {any} */
    let agent = null;
    try {
      const running = turn(b, upstream, "hello");
      await until(() => lines(calls).some((c) => c.method === "session/new"), "the session to be opening");
      agent = [...b.procs.values()][0];
      b.letGo("acp-letgo");
      assert.equal((await running).stopReason, "end_turn", "the turn ran to its end");
      await until(() => agent.exited, "the agent let go of to stop once its turn ended");
      const [, chat] = chatOf(b, "acp-letgo");
      assert.equal((await turn(b, upstream, "again")).stopReason, "end_turn");
      const reopened = lines(calls).find((c) => c.method === "session/load");
      assert.equal(reopened?.sessionId, chat.sessionId, "the chat's session reopened in the next agent");
      assert.notEqual(reopened.pid, agent.child.pid);
    } finally {
      agent?.kill();
      b.shutdown();
    }
  });

  // (fails before: yes — the same, on an agent another chat had started)
  test("an agent let go of while a second chat's turn opens its session runs that turn to its end, then stops", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    const upstream = up("acp-letgo2");
    upstream.acp.env.FAKE_ACP_SLOW_NEW_MS = "300";
    const calls = join(dir, "acp-letgo2-calls.jsonl");
    /** @type {any} */
    let agent = null;
    try {
      await turn(b, upstream, "hello");
      agent = [...b.procs.values()][0];
      const running = b.run({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf("a second chat"), conversationId: "second", signal: null, onEvent: () => {} });
      await until(() => lines(calls).filter((c) => c.method === "session/new").length === 2, "the second chat's session to be opening");
      b.letGo("acp-letgo2");
      assert.equal((await running).stopReason, "end_turn", "the turn ran to its end");
      await until(() => agent.exited, "the agent let go of to stop once its turn ended");
    } finally {
      agent?.kill();
      b.shutdown();
    }
  });

  // (fails before: no — a guard the mutation pass asked for: an agent let go of under two turns stopped once the first
  // of them ended)
  test("an agent let go of under two chats' turns runs both to their ends, and stops after the last", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    const upstream = up("acp-letgo5");
    upstream.acp.env.FAKE_ACP_SLOW_NEW_MS = "300";
    const calls = join(dir, "acp-letgo5-calls.jsonl");
    const stop = new AbortController();
    /** @type {any} */
    let agent = null;
    try {
      const first = turn(b, upstream, "keep me ~quiet", stop.signal);
      first.catch(() => {});
      await until(() => lines(join(dir, "acp-letgo5-prompts.jsonl")).some((p) => p.text === "keep me ~quiet"), "the first chat's prompt to reach the agent");
      agent = [...b.procs.values()][0];
      const second = b.run({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf("a second chat"), conversationId: "second", signal: null, onEvent: () => {} });
      await until(() => lines(calls).filter((c) => c.method === "session/new").length === 2, "the second chat's session to be opening");
      b.letGo("acp-letgo5");
      assert.equal((await second).stopReason, "end_turn", "the second chat's turn ran to its end");
      await until(() => b.live.size === 1, "the second chat's turn to be over");
      assert.equal(agent.exited, false, "the first chat's turn runs on it");
      stop.abort();
      assert.equal((await first).stopReason, "cancelled", "the first chat's turn ends as its stop ends it");
      await until(() => agent.exited, "the agent let go of to stop once its last turn ended");
    } finally {
      agent?.kill();
      b.shutdown();
    }
  });

  // (fails before: yes — the agent let go of while the turn's first attempt opened its session was stopped under it,
  // and the turn failed)
  test("a turn refused for its earlier conversation and run again bare keeps to the agent it started on, let go of meanwhile, which stops after it", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    const upstream = up("acp-letgo3");
    Object.assign(upstream.acp.env, { FAKE_ACP_SLOW_NEW_MS: "300", FAKE_ACP_OVERFLOW_SEEDED: "1" });
    const calls = join(dir, "acp-letgo3-calls.jsonl");
    /** @type {any} */
    let agent = null;
    try {
      const running = b.run({ upstream, modelId: "fake-a", format: "anthropic", body: seeded(), conversationId: "seeded", signal: null, onEvent: () => {} });
      await until(() => lines(calls).some((c) => c.method === "session/new"), "the session to be opening");
      agent = [...b.procs.values()][0];
      b.letGo("acp-letgo3");
      const out = await running;
      assert.deepEqual([out.stopReason, out.seeded], ["end_turn", false], "run again bare, to its end");
      const opened = lines(calls).filter((c) => c.method === "session/new");
      assert.deepEqual(opened.map((c) => c.pid), [agent.child.pid, agent.child.pid], "both attempts on the agent the turn started on");
      await until(() => agent.exited, "the agent let go of to stop once the turn ended");
    } finally {
      agent?.kill();
      b.shutdown();
    }
  });

  // (fails before: yes — an agent let go of while its turn ran was no longer the bridge's: its shutdown left it
  // running, to outlive Filament)
  test("a shutdown stops an agent let go of whose turn still runs", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    const upstream = up("acp-letgo4");
    /** @type {any} */
    let agent = null;
    try {
      const running = turn(b, upstream, "keep me ~quiet");
      running.catch(() => {});
      await until(() => lines(join(dir, "acp-letgo4-prompts.jsonl")).some((p) => p.text === "keep me ~quiet"), "the prompt to reach the agent");
      agent = [...b.procs.values()][0];
      b.letGo("acp-letgo4");
      assert.equal(agent.exited, false, "let go of, it runs the turn on");
      b.shutdown();
      assert.equal(agent.exited, true, "the shutdown stopped it");
      await running.then(
        () => {},
        () => {},
      );
    } finally {
      agent?.kill();
      b.shutdown();
    }
  });

  // (fails before: yes — the sweep dropped the chat and closed its session: the next message opened a new session,
  // seeded with Filament's whole copy of the chat, which the agent's own compactions never shortened)
  test("a harness chat idle past its limit keeps its session: the agent closes it, and the next message opens it again, unseeded", async () => {
    const stateFile = join(dir, "acp-rest.json");
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet, stateFile }));
    /** @type {any[]} */
    const ops = [];
    /** @type {any} */ (b).onOp = (/** @type {string} */ title, /** @type {any} */ o) => ops.push({ title, sub: o?.sub });
    const upstream = up("acp-rest");
    const calls = join(dir, "acp-rest-calls.jsonl");
    /** @param {any} body */
    const harness = (body) => b.run({ upstream, modelId: "fake-a", format: "anthropic", body, headers: HARNESS, conversationId: "chain:c25", signal: null, onEvent: () => {} });
    try {
      await harness(bodyOf("one"));
      const [key, chat] = chatOf(b, "acp-rest");
      const session = chat.sessionId;
      await until(() => savedChat(stateFile, key)?.harness === true, "the chat saved as a harness chat's, for a restart");
      assert.equal(b.sweep(Date.now() + 2 * HOUR), 0, "idle past its limit, the chat is not dropped");
      assert.equal(b.convs.get(key), chat, "it keeps its record");
      await until(() => lines(calls).some((c) => c.method === "session/close" && c.sessionId === session), "its agent to close the session");
      b.sweep(Date.now() + 3 * HOUR);
      const out = await harness(seeded());
      assert.deepEqual([out.sessionId, out.seeded, out.reused], [session, false, true], "the next message goes on in the same session, unseeded");
      const said = lines(calls);
      assert.equal(said.filter((c) => c.method === "session/new").length, 1, "no second session was started");
      assert.equal(said.filter((c) => c.method === "session/close").length, 1, "closed once, however many sweeps found it idle");
      assert.ok(said.some((c) => c.method === "session/load" && c.sessionId === session), "the session was opened again in the agent");
      assert.deepEqual(ops.filter((o) => o.sub === "idle"), [], "nothing was forgotten");
      assert.equal(b.sweep(Date.now() + CHAT_KEPT_MS + HOUR), 1, "a chat unused past the long limit is let go");
      assert.equal(b.convs.has(key), false);
      assert.deepEqual(ops.filter((o) => o.sub === "idle").map((o) => /^forgot an idle chat's agent session on acp-rest \(/.test(o.title)), [true], "and the ops log says so");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — the bridge could let go of one chat's session only by forgetting the chat: a sub-agent's
  // agent held its session open until the chat idled out, and Claude Code a process in the sub-agent's worktree)
  test("a sub-agent's exchange ended: its agent closes the session, the chat keeps it, and the follow-up opens it again, unseeded; an agent that closes none holds it open", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    const closes = up("acp-sub");
    const holds = { ...up("acp-sub-open"), acp: { ...up("acp-sub-open").acp, env: { FAKE_ACP_CALLS: join(dir, "acp-sub-open-calls.jsonl"), FAKE_ACP_ALLOW_LOAD: "1" } } };
    /** @param {any} upstream */
    const at = (upstream) => ({ upstream, format: "anthropic", cwdHint: dir, conversationId: "subagent:sa_00000001" });
    /** @param {any} upstream @param {any} body */
    const say = (upstream, body) => b.run({ ...at(upstream), modelId: "fake-a", body, signal: null, onEvent: () => {} });
    try {
      const first = await say(closes, bodyOf("one"));
      await b.restByRequest({ ...at(closes), body: bodyOf("one") });
      const calls = join(dir, "acp-sub-calls.jsonl");
      assert.ok(lines(calls).some((c) => c.method === "session/close" && c.sessionId === first.sessionId), "closed in the agent by the time the rest settles");
      const [, chat] = chatOf(b, "acp-sub");
      assert.deepEqual([chat.sessionId, chat.procKey], [first.sessionId, null], "the chat keeps its session, held by no process");
      await b.restByRequest({ ...at(closes), body: bodyOf("one") });
      const out = await say(closes, seeded());
      assert.deepEqual([out.sessionId, out.seeded, out.reused], [first.sessionId, false, true], "the follow-up goes on in the same session, unseeded");
      const said = lines(calls);
      assert.deepEqual(["session/new", "session/close", "session/load"].map((m) => said.filter((c) => c.method === m).length), [1, 1, 1], "one session, closed once and opened again");
      // An agent that declares no close: nothing to let go of, and its process holds the session as it did.
      const open = await say(holds, bodyOf("one"));
      await b.restByRequest({ ...at(holds), body: bodyOf("one") });
      const [, held] = chatOf(b, "acp-sub-open");
      assert.ok(held.procKey, "still held by its process");
      const next = await say(holds, seeded());
      assert.deepEqual([next.sessionId, next.reused], [open.sessionId, true]);
      assert.deepEqual(lines(join(dir, "acp-sub-open-calls.jsonl")).filter((c) => c.method === "session/close" || c.method === "session/load"), [], "neither closed nor opened again");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: no — a guard: the chat of a client that names no compaction is the client's, and is dropped as it
  // was)
  test("an outside client's chat idle past its limit is dropped, and its session closed", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    const upstream = up("acp-outside");
    const calls = join(dir, "acp-outside-calls.jsonl");
    try {
      await turn(b, upstream, "hello");
      const [key, chat] = chatOf(b, "acp-outside");
      assert.equal(b.sweep(Date.now() + 2 * HOUR), 1);
      assert.equal(b.convs.has(key), false);
      await until(() => lines(calls).some((c) => c.method === "session/close" && c.sessionId === chat.sessionId), "its agent to close the session");
    } finally {
      b.shutdown();
    }
  });
});

describe("the idle sweep's rule", () => {
  const made = Date.now();
  /** @param {Partial<{ harness: boolean, idleMs: number }>} [o] */
  const chat = (o = {}) => ({ lastUsed: made, idleMs: HOUR, ...o });

  // (fails before: yes — there was no rule apart from the sweeps: every chat idle past its limit was dropped)
  test("a harness chat rests where an outside client's is dropped, and goes only once unused past the long limit", () => {
    assert.equal(idleStep(chat(), made + HOUR, false), "keep", "idle exactly its limit is not past it");
    assert.equal(idleStep(chat(), made + HOUR + 1, false), "drop", "an outside client's, past its limit");
    assert.equal(idleStep(chat({ harness: true }), made + HOUR + 1, false), "rest", "a harness chat's, past its limit");
    assert.equal(idleStep(chat({ harness: true }), made + CHAT_KEPT_MS, false), "rest", "unused exactly the long limit is not past it");
    assert.equal(idleStep(chat({ harness: true }), made + CHAT_KEPT_MS + 1, false), "drop", "and past it, let go");
    assert.equal(idleStep(chat({ harness: true }), made + CHAT_KEPT_MS + 1, true), "keep", "a chat with work on it is never idle");
    assert.equal(idleStep(chat(), made + CHAT_KEPT_MS + 1, true), "keep");
    assert.equal(idleStep({ lastUsed: made }, made + 4 * HOUR, false), "keep", "a record with no limit of its own has four hours");
    assert.equal(idleStep({ lastUsed: made }, made + 4 * HOUR + 1, false), "drop");
    assert.equal(CHAT_KEPT_MS, 30 * 24 * HOUR);
  });
});

describe("a chat map's save cut short", () => {
  /** node:fs as the bridges import it, whose writes the test cuts. */
  const fs = createRequire(import.meta.url)("node:fs");
  /**
   * Every write cut short until `restore`, as a crash or a full disk cuts one: the start of what it was given lands in
   * its file, then it fails.
   */
  const cutWrites = () => {
    const real = fs.writeFileSync;
    fs.writeFileSync = (/** @type {any} */ file, /** @type {any} */ data) => {
      real(file, String(data).slice(0, 20));
      throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
    };
    syncBuiltinESMExports();
    return {
      restore() {
        fs.writeFileSync = real;
        syncBuiltinESMExports();
      },
    };
  };
  /** A chat as each bridge's map holds one. @param {string} id */
  const chat = (id) => ({ sessionId: `s-${id}`, agentId: `a-${id}`, upstreamId: id, cwd: tmpdir(), turns: 1, lastUsed: Date.now(), idleMs: HOUR });

  // (fails before: yes — the bug hunt of 10-30, AGT-2: each bridge wrote its map over its file in place, so a save cut
  // short left the file torn, and at the next start every chat lost its agent session at once)
  test("leaves the map its file held whole: the ACP agents', Codex's and Cursor's, each chat in it reopened at the next start", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-kept-cut-"));
    /** Each map, saved whole with one chat, then a save with one more cut short; what the next start reads. */
    const maps = {
      acp: (/** @type {string} */ stateFile) => {
        const first = new SessionMap({ stateFile, log: quiet });
        first.set("one", chat("acp"));
        first.flush();
        first.set("two", chat("acp"));
        const cut = cutWrites();
        try {
          first.flush();
        } finally {
          cut.restore();
        }
        const again = new SessionMap({ stateFile, log: quiet });
        again.load();
        return [...again.keys()];
      },
      codex: (/** @type {string} */ stateFile) => {
        const first = new CodexBridge({ log: quiet, stateFile });
        first.convs.set("one", /** @type {any} */ (chat("codex")));
        first.shutdown();
        const second = new CodexBridge({ log: quiet, stateFile });
        second.convs.set("two", /** @type {any} */ (chat("codex")));
        const cut = cutWrites();
        try {
          second.shutdown();
        } finally {
          cut.restore();
        }
        const again = new CodexBridge({ log: quiet, stateFile });
        const keys = [...again.convs.keys()];
        again.shutdown();
        return keys;
      },
      cursor: (/** @type {string} */ stateFile) => {
        const first = new CursorSdkBridge(/** @type {any} */ ({ log: quiet, loader: SDK, stateFile }));
        first.convs.set("one", chat("cursor"));
        first.shutdown();
        const second = new CursorSdkBridge(/** @type {any} */ ({ log: quiet, loader: SDK, stateFile }));
        second.convs.set("two", chat("cursor"));
        const cut = cutWrites();
        try {
          second.shutdown();
        } finally {
          cut.restore();
        }
        const again = new CursorSdkBridge(/** @type {any} */ ({ log: quiet, loader: SDK, stateFile }));
        const keys = [...again.convs.keys()];
        again.shutdown();
        return keys;
      },
    };
    try {
      for (const [name, kept] of Object.entries(maps)) assert.deepEqual(kept(join(dir, `${name}-sessions.json`)), ["one"], `${name}'s map`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Codex's chats", () => {
  /** @type {string} */ let dir;
  /** @type {CodexBridge} */ let bridge;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-kept-codex-"));
    bridge = new CodexBridge({ log: quiet });
  });
  after(() => {
    bridge.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });
  /** @param {string} id */
  const up = (id) => ({
    id,
    name: id,
    type: "codex",
    acp: { command: process.execPath, args: [join(FIXTURES, "fake-codex-app-server.mjs")], env: { FAKE_CODEX_CALLS: join(dir, `${id}.jsonl`) }, cwdDefault: dir, permissions: "allow-all", sessionIdleMinutes: 60 },
  });
  /** @param {CodexBridge} b @param {any} upstream @param {string} text @param {{ signal?: AbortSignal, onEvent?: (ev: any) => void }} [o] */
  const turn = (b, upstream, text, { signal, onEvent = () => {} } = {}) =>
    b.run({ upstream, modelId: "gpt-6-astra", format: "anthropic", body: bodyOf(text), conversationId: "chat", signal, onEvent });

  // (fails before: yes — two hours into the turn the sweep dropped the chat, unloaded its thread and stopped Codex's
  // process under it)
  test("a chat whose turn runs is never idle: the sweep keeps it, its thread and Codex's process, however long the turn has run", async () => {
    const upstream = up("cx-live");
    const stop = new AbortController();
    const said = saying();
    const running = turn(bridge, upstream, "~slow", { signal: stop.signal, onEvent: said.onEvent });
    running.catch(() => {});
    await said.heard;
    const [key, chat] = chatOf(bridge, "cx-live");
    const codex = bridge.procs.get("cx-live");
    bridge.sweep(Date.now() + 2 * HOUR);
    assert.equal(bridge.convs.get(key), chat, "the chat is kept");
    assert.equal(bridge.procs.get("cx-live"), codex, "Codex's process runs on");
    stop.abort();
    assert.equal((await running).stopReason, "cancelled", "the turn ends as its stop ends it");
    assert.deepEqual(lines(join(dir, "cx-live.jsonl")).filter((m) => m.method === "thread/unsubscribe"), [], "its thread was never let go of");
  });

  // (fails before: yes — a failed turn left the chat idle from before it ran: the next sweep dropped it and unloaded the
  // thread a "continue" goes on in, and the state file kept it so for a restart)
  test("a chat is idle from its failed turn's end: the sweep after the failure keeps it, and a restart reads it so", async () => {
    const stateFile = join(dir, "codex-sessions.json");
    const upstream = up("cx-failed");
    const first = new CodexBridge({ log: quiet, stateFile });
    /** @type {CodexBridge | null} */
    let again = null;
    try {
      await turn(first, upstream, "hello");
      const [key] = chatOf(first, "cx-failed");
      await until(() => savedChat(stateFile, key), "the chat saved");
      first.shutdown();
      idleOnDisk(stateFile, key);
      again = new CodexBridge({ log: quiet, stateFile });
      await assert.rejects(turn(again, upstream, "~fail"));
      again.sweep(Date.now());
      assert.ok(again.convs.has(key), "the chat is kept");
      await until(() => savedChat(stateFile, key)?.lastUsed > Date.now() - HOUR, "the failure's end saved, for a restart to read");
    } finally {
      first.shutdown();
      again?.shutdown();
    }
  });

  // (fails before: yes — the shutdown wrote nothing: a save still waiting was lost with the process, and a chat whose
  // turn ran read idle from before the turn)
  test("a shutdown writes every chat at once, one whose turn runs used until then", async () => {
    const stateFile = join(dir, "codex-down.json");
    const b = new CodexBridge({ log: quiet, stateFile });
    try {
      await turn(b, up("cx-done"), "hello");
      const said = saying();
      const running = turn(b, up("cx-busy"), "~slow", { onEvent: said.onEvent });
      running.catch(() => {});
      await said.heard;
      await downAndAfter(b, stateFile, ["cx-done", "cx-busy"], running);
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — Codex's app-server counted as busy only once the turn's thread had opened: Connect, or an
  // install finishing, stopped it under a turn still opening its thread, and the turn failed)
  test("an app-server let go of while a turn opens its thread runs the turn to its end, then stops; the chat's thread resumes in the next", async () => {
    const b = new CodexBridge({ log: quiet });
    const upstream = up("cx-letgo");
    upstream.acp.env.FAKE_CODEX_SLOW_START_MS = "600";
    const calls = join(dir, "cx-letgo.jsonl");
    /** @type {any} */
    let codex = null;
    try {
      const running = turn(b, upstream, "hello");
      await until(() => lines(calls).some((m) => m.method === "thread/start"), "the thread to be opening");
      codex = b.procs.get("cx-letgo");
      b.letGo("cx-letgo");
      assert.equal((await running).stopReason, "end_turn", "the turn ran to its end");
      await until(() => codex?.exited, "the app-server let go of to stop once its turn ended");
      assert.equal((await turn(b, upstream, "again")).stopReason, "end_turn");
      assert.ok(lines(calls).some((m) => m.method === "thread/resume"), "the chat's thread resumed in the next app-server");
    } finally {
      codex?.kill();
      b.shutdown();
    }
  });

  // (fails before: yes — the same, on an app-server another chat had started)
  test("an app-server let go of while a second chat's turn opens its thread runs that turn to its end, then stops", async () => {
    const b = new CodexBridge({ log: quiet });
    const upstream = up("cx-letgo2");
    upstream.acp.env.FAKE_CODEX_SLOW_START_MS = "300";
    const calls = join(dir, "cx-letgo2.jsonl");
    /** @type {any} */
    let codex = null;
    try {
      await turn(b, upstream, "hello");
      codex = b.procs.get("cx-letgo2");
      const running = b.run({ upstream, modelId: "gpt-6-astra", format: "anthropic", body: bodyOf("a second chat"), conversationId: "second", onEvent: () => {} });
      await until(() => lines(calls).filter((m) => m.method === "thread/start").length === 2, "the second chat's thread to be opening");
      b.letGo("cx-letgo2");
      assert.equal((await running).stopReason, "end_turn", "the turn ran to its end");
      await until(() => codex?.exited, "the app-server let go of to stop once its turn ended");
    } finally {
      codex?.kill();
      b.shutdown();
    }
  });

  // (fails before: yes — the app-server let go of while the turn's first attempt opened its thread was stopped under
  // it, and the turn failed)
  test("a turn refused for its earlier conversation and run again bare keeps to the app-server it started on, let go of meanwhile, which stops after it", async () => {
    const b = new CodexBridge({ log: quiet });
    const upstream = up("cx-letgo3");
    Object.assign(upstream.acp.env, { FAKE_CODEX_SLOW_START_MS: "300", FAKE_CODEX_OVERFLOW_SEEDED: "1" });
    const calls = join(dir, "cx-letgo3.jsonl");
    /** @type {any} */
    let codex = null;
    try {
      const running = b.run({ upstream, modelId: "gpt-6-astra", format: "anthropic", body: seeded(), conversationId: "seeded", onEvent: () => {} });
      await until(() => lines(calls).some((m) => m.method === "thread/start"), "the thread to be opening");
      codex = b.procs.get("cx-letgo3");
      b.letGo("cx-letgo3");
      const out = await running;
      assert.deepEqual([out.stopReason, out.seeded], ["end_turn", false], "run again bare, to its end");
      assert.equal(lines(calls).filter((m) => m.method === "thread/start").length, 2, "both attempts on the app-server the turn started on");
      await until(() => codex?.exited, "the app-server let go of to stop once the turn ended");
      assert.equal(b.procs.size, 0, "no other app-server started");
    } finally {
      codex?.kill();
      b.shutdown();
    }
  });

  // (fails before: yes — an app-server let go of while its turn ran was no longer the bridge's: its shutdown left it
  // running, to outlive Filament)
  test("a shutdown stops an app-server let go of whose turn still runs", async () => {
    const b = new CodexBridge({ log: quiet });
    const upstream = up("cx-letgo4");
    /** @type {any} */
    let codex = null;
    try {
      const said = saying();
      const running = turn(b, upstream, "~slow", { onEvent: said.onEvent });
      running.catch(() => {});
      await said.heard;
      codex = b.procs.get("cx-letgo4");
      b.letGo("cx-letgo4");
      assert.equal(codex.exited, false, "let go of, it runs the turn on");
      b.shutdown();
      assert.equal(codex.exited, true, "the shutdown stopped it");
      await running.then(
        () => {},
        () => {},
      );
    } finally {
      codex?.kill();
      b.shutdown();
    }
  });

  // (fails before: yes — the sweep dropped the chat and unloaded its thread: the next message started a new thread,
  // handed Filament's whole copy of the chat)
  test("a harness chat idle past its limit keeps its thread: Codex unloads it, and the next message resumes it, unseeded", async () => {
    const stateFile = join(dir, "codex-rest.json");
    const b = new CodexBridge({ log: quiet, stateFile });
    const upstream = up("cx-rest");
    const calls = join(dir, "cx-rest.jsonl");
    /** @param {any} body */
    const harness = (body) => b.run({ upstream, modelId: "gpt-6-astra", format: "anthropic", body, headers: HARNESS, conversationId: "chain:c25", signal: undefined, onEvent: () => {} });
    try {
      await harness(bodyOf("one"));
      const [key, chat] = chatOf(b, "cx-rest");
      const thread = chat.sessionId;
      await until(() => savedChat(stateFile, key)?.harness === true, "the chat saved as a harness chat's, for a restart");
      assert.equal(b.sweep(Date.now() + 2 * HOUR), 0, "idle past its limit, the chat is not dropped");
      assert.equal(b.convs.get(key), chat, "it keeps its record");
      await until(() => lines(calls).some((m) => m.method === "thread/unsubscribe" && m.params?.threadId === thread), "Codex to unload the thread");
      b.sweep(Date.now() + 3 * HOUR);
      const out = await harness(seeded());
      assert.deepEqual([out.sessionId, out.seeded, out.reused], [thread, false, true], "the next message goes on in the same thread, unseeded");
      const said = lines(calls);
      assert.equal(said.filter((m) => m.method === "thread/start").length, 1, "no second thread was started");
      assert.equal(said.filter((m) => m.method === "thread/unsubscribe").length, 1, "unloaded once, however many sweeps found it idle");
      assert.ok(said.some((m) => m.method === "thread/resume" && m.params?.threadId === thread), "the thread was resumed");
      assert.equal(b.sweep(Date.now() + CHAT_KEPT_MS + HOUR), 1, "a chat unused past the long limit is let go");
      assert.equal(b.convs.has(key), false);
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — the bridge had no way to let go of one chat's thread before the idle sweep, so a sub-agent's
  // thread stayed loaded in Codex's process, which held the sub-agent's worktree folder; `b.restByRequest is not a
  // function`)
  test("a sub-agent's exchange ended: Codex unloads its thread, the chat keeps it, and the follow-up resumes it, unseeded", async () => {
    const b = new CodexBridge({ log: quiet });
    const upstream = up("cx-sub");
    const calls = join(dir, "cx-sub.jsonl");
    const at = { upstream, format: "anthropic", cwdHint: dir, conversationId: "subagent:sa_00000001" };
    /** @param {any} body */
    const say = (body) => b.run({ ...at, modelId: "gpt-6-astra", body, signal: undefined, onEvent: () => {} });
    try {
      const first = await say(bodyOf("one"));
      await b.restByRequest({ ...at, body: bodyOf("one") });
      assert.ok(lines(calls).some((m) => m.method === "thread/unsubscribe" && m.params?.threadId === first.sessionId), "unloaded in Codex by the time the rest settles");
      const [, chat] = chatOf(b, "cx-sub");
      assert.equal(chat.sessionId, first.sessionId, "the chat keeps its thread");
      await b.restByRequest({ ...at, body: bodyOf("one") });
      const out = await say(seeded());
      assert.deepEqual([out.sessionId, out.seeded, out.reused], [first.sessionId, false, true], "the follow-up goes on in the same thread, unseeded");
      const said = lines(calls);
      assert.deepEqual(["thread/start", "thread/unsubscribe", "thread/resume"].map((m) => said.filter((c) => c.method === m).length), [1, 1, 1], "one thread, unloaded once and resumed");
      await b.restByRequest({ ...at, conversationId: "subagent:sa_none", body: bodyOf("one") });
      assert.equal(lines(calls).filter((m) => m.method === "thread/unsubscribe").length, 1, "a chat the bridge does not know: nothing to let go of");
    } finally {
      b.shutdown();
    }
  });
});

describe("Cursor's chats", () => {
  /** @type {string} */ let dir;
  /** @type {CursorSdkBridge} */ let bridge;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-kept-cursor-"));
    bridge = new CursorSdkBridge(/** @type {any} */ ({ log: quiet, loader: SDK }));
  });
  after(() => {
    bridge.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });
  /** @param {string} id */
  const up = (id) => ({ id, name: id, type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: dir, permissions: "allow-all", sessionIdleMinutes: 60 } });
  /** @param {CursorSdkBridge} b @param {any} upstream @param {string} text @param {{ signal?: AbortSignal, onEvent?: (ev: any) => void }} [o] */
  const turn = (b, upstream, text, { signal, onEvent = () => {} } = {}) =>
    b.run({ upstream, modelId: "grok-4.6", format: "anthropic", body: bodyOf(text), conversationId: "chat", signal, onEvent });

  // (fails before: yes — two hours into the turn the sweep dropped the chat and the agent it runs on)
  test("a chat whose turn runs is never idle: the sweep keeps it and its agent, however long the turn has run", async () => {
    const upstream = up("cur-live");
    const stop = new AbortController();
    const said = saying();
    const running = turn(bridge, upstream, "~hang", { signal: stop.signal, onEvent: said.onEvent });
    running.catch(() => {});
    await said.heard;
    const [key, chat] = chatOf(bridge, "cur-live");
    const agent = bridge.agents.get(chat.agentId);
    bridge.sweep(Date.now() + 2 * HOUR);
    assert.equal(bridge.convs.get(key), chat, "the chat is kept");
    assert.equal(bridge.agents.get(chat.agentId), agent, "its agent is kept");
    stop.abort();
    assert.equal((await running).stopReason, "cancelled", "the turn ends as its stop ends it");
  });

  // (fails before: yes — the sweep took an idle chat's agent out of the map unclosed, from a chat still holding it too)
  test("an idle chat the sweep drops lets go of its agent: closed once no other chat holds it", async () => {
    await turn(bridge, up("cur-idle"), "hello");
    const [key, chat] = chatOf(bridge, "cur-idle");
    const agent = bridge.agents.get(chat.agentId);
    let closed = 0;
    agent.close = () => void closed++;
    const other = `${key}|other`;
    bridge.convs.set(other, { ...chat, lastUsed: Date.now() + 2 * HOUR }); // a second chat on the agent, /resume's way
    bridge.sweep(Date.now() + 2 * HOUR);
    assert.equal(bridge.convs.has(key), false, "the idle chat is dropped");
    assert.equal(bridge.agents.get(chat.agentId), agent, "the agent the other chat holds stays");
    assert.equal(closed, 0);
    bridge.convs.get(other).lastUsed = Date.now();
    bridge.sweep(Date.now() + 2 * HOUR);
    assert.equal(bridge.agents.has(chat.agentId), false);
    assert.equal(closed, 1, "the last chat's agent is closed");
  });

  // (fails before: yes — the sweep dropped the chat with its agent: the next message made a new agent, handed
  // Filament's whole copy of the chat)
  test("a harness chat idle past its limit keeps its agent: closed, and the next message resumes it, unseeded", async () => {
    const stateFile = join(dir, "sdk-rest.json");
    const b = new CursorSdkBridge(/** @type {any} */ ({ log: quiet, stateFile, loader: SDK }));
    const upstream = up("cur-rest");
    /** @param {any} body */
    const harness = (body) => b.run({ upstream, modelId: "grok-4.6", format: "anthropic", body, headers: HARNESS, conversationId: "chain:c25", signal: undefined, onEvent: () => {} });
    try {
      await harness(bodyOf("one"));
      const [key, chat] = chatOf(b, "cur-rest");
      const agentId = chat.agentId;
      let closed = 0;
      b.agents.get(agentId).close = () => void closed++;
      await until(() => savedChat(stateFile, key)?.harness === true, "the chat saved as a harness chat's, for a restart");
      assert.equal(b.sweep(Date.now() + 2 * HOUR), 0, "idle past its limit, the chat is not dropped");
      assert.equal(b.convs.get(key), chat, "it keeps its record");
      assert.deepEqual([b.agents.has(agentId), closed], [false, 1], "its agent is closed");
      b.sweep(Date.now() + 3 * HOUR);
      assert.equal(closed, 1, "closed once, however many sweeps found it idle");
      const out = await harness(seeded());
      assert.deepEqual([out.sessionId, out.seeded, out.reused], [agentId, false, true], "the next message goes on in the same agent, unseeded");
      assert.equal(b.agents.has(agentId), true, "resumed");
      assert.equal(b.sweep(Date.now() + CHAT_KEPT_MS + HOUR), 1, "a chat unused past the long limit is let go");
      assert.equal(b.convs.has(key), false);
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — a chat forgotten kept its agent open in the map for the life of the process)
  test("a chat forgotten lets go of its agent, as one the sweep drops", async () => {
    const upstream = up("cur-forget");
    await turn(bridge, upstream, "hello");
    const [key, chat] = chatOf(bridge, "cur-forget");
    let closed = 0;
    bridge.agents.get(chat.agentId).close = () => void closed++;
    assert.equal(bridge.forgetByRequest({ upstream, format: "anthropic", body: bodyOf("hello"), cwdHint: null, conversationId: "chat" }), true);
    assert.equal(bridge.convs.has(key), false);
    assert.equal(bridge.agents.has(chat.agentId), false);
    assert.equal(closed, 1);
  });

  // (fails before: no — a guard the mutation pass asked for: a chat forgotten stayed in the state file, for a restart)
  test("a chat forgotten is gone from the state file too", async () => {
    const stateFile = join(dir, "sdk-forget.json");
    const b = new CursorSdkBridge(/** @type {any} */ ({ log: quiet, stateFile, loader: SDK }));
    try {
      await turn(b, up("cur-forget-saved"), "hello");
      const [key] = chatOf(b, "cur-forget-saved");
      await until(() => savedChat(stateFile, key), "the chat saved");
      assert.equal(b.forgetConversation(key), true);
      await until(() => !savedChat(stateFile, key), "and saved gone");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — a failed turn left the chat idle from before it ran: the next sweep dropped it and the agent a
  // "continue" goes on in, and the state file kept it so for a restart)
  test("a chat is idle from its failed turn's end: the sweep after the failure keeps it, and a restart reads it so", async () => {
    const stateFile = join(dir, "sdk-sessions.json");
    const upstream = up("cur-failed");
    const first = new CursorSdkBridge(/** @type {any} */ ({ log: quiet, stateFile, loader: SDK }));
    /** @type {CursorSdkBridge | null} */
    let again = null;
    try {
      await turn(first, upstream, "hello");
      const [key] = chatOf(first, "cur-failed");
      await until(() => savedChat(stateFile, key), "the chat saved");
      first.shutdown();
      idleOnDisk(stateFile, key);
      again = new CursorSdkBridge(/** @type {any} */ ({ log: quiet, stateFile, loader: SDK }));
      await assert.rejects(turn(again, upstream, "~fail"));
      again.sweep(Date.now());
      assert.ok(again.convs.has(key), "the chat is kept");
      await until(() => savedChat(stateFile, key)?.lastUsed > Date.now() - HOUR, "the failure's end saved, for a restart to read");
    } finally {
      first.shutdown();
      again?.shutdown();
    }
  });

  // (fails before: yes — the shutdown wrote nothing: a save still waiting was lost with the process, and a chat whose
  // turn ran read idle from before the turn)
  test("a shutdown writes every chat at once, one whose turn runs used until then", async () => {
    const stateFile = join(dir, "sdk-down.json");
    const b = new CursorSdkBridge(/** @type {any} */ ({ log: quiet, stateFile, loader: SDK }));
    const stop = new AbortController();
    try {
      await turn(b, up("cur-done"), "hello");
      const said = saying();
      const running = turn(b, up("cur-busy"), "~hang", { signal: stop.signal, onEvent: said.onEvent });
      running.catch(() => {});
      await said.heard;
      await downAndAfter(b, stateFile, ["cur-done", "cur-busy"], running, () => stop.abort());
    } finally {
      stop.abort();
      b.shutdown();
    }
  });
});
