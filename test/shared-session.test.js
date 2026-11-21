// @ts-check
// Two chats on one agent session, each of which resumed it (`/resume`): neither's message stops or takes the other's
// turn, and a turn takes the session (the agent's requests on it, its cancel, its settings, a load) only once the turn
// running on it has ended; a stop while it waits ends it at once (the bug report's H9 and L22). So with a Codex thread
// and a Cursor agent (X5); and Cursor's agents, which it keeps by folder, are listed and resumed in theirs (X6).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AcpBridge } from "../src/adapters/agents/acp/bridge.js";
import { CodexBridge } from "../src/adapters/agents/codex/bridge.js";
import { COMPACTION_HEADER } from "../src/adapters/agents/compactions.js";
import { CursorSdkBridge } from "../src/adapters/agents/cursor-sdk.js";
import { LiveTurn } from "../src/adapters/agents/turn-bridge.js";
import { answerAgentCommand, parseAgentCommand } from "../src/app/commands/acp.js";
import { FORK_SUMMARY_INSTRUCTION } from "../src/app/sessions/compactor.js";
import { FAKE_ACP_AGENT, FIXTURES } from "./helpers/app.js";
import { until } from "./helpers/wait.js";

const quiet = () => {};
/** @param {string} text */
const bodyOf = (text) => ({ model: "m", max_tokens: 100, messages: [{ role: "user", content: text }] });
/** The JSON lines a fake logged. @param {string} file @returns {any[]} */
const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
/** Whether a promise has settled, asked without waiting for it. @param {Promise<any>} p */
const settled = (p) => {
  let done = false;
  p.then(
    () => (done = true),
    () => (done = true),
  );
  return () => done;
};
const moment = () => new Promise((r) => setTimeout(r, 300));
const CODEX = join(FIXTURES, "fake-codex-app-server.mjs");
/**
 * What a turn says by `ms`, else "still waiting". @param {Promise<any>} p @param {number} [ms]
 * @returns {Promise<any>}
 */
const within = async (p, ms = 3000) => {
  /** @type {any} */
  let timer = null;
  const out = await Promise.race([p, new Promise((r) => (timer = setTimeout(() => r({ stopReason: "still waiting", ok: "still waiting" }), ms)))]);
  clearTimeout(timer);
  return out;
};

describe("two chats on one agent session", () => {
  /** @type {string} */ let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-shared-"));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));
  /** @param {string} id @param {Record<string, string>} [env] */
  const up = (id, env = {}) => ({
    id,
    name: id,
    type: "acp",
    acp: {
      command: process.execPath,
      args: [FAKE_ACP_AGENT],
      env: { FAKE_ACP_CALLS: join(dir, `${id}-calls.jsonl`), FAKE_ACP_LOG: join(dir, `${id}-prompts.jsonl`), FAKE_ACP_ALLOW_LOAD: "1", FAKE_ACP_CONFIG: "1", ...env },
      cwdDefault: dir,
      permissions: "allow-all",
    },
  });
  /**
   * A turn of chat `chat` on the session the two share (the agent's `sess_old1`, resumed).
   * @param {AcpBridge} b @param {any} upstream @param {string} chat @param {string} text
   * @param {{ signal?: AbortSignal | null, mode?: string | null, model?: string }} [o]
   */
  const turn = (b, upstream, chat, text, { signal = null, mode = null, model = "fake-a" } = {}) =>
    b.run({ upstream, modelId: model, format: "anthropic", body: bodyOf(text), conversationId: chat, resumeSessionId: "sess_old1", signal, mode, onEvent: () => {} });
  /**
   * Chat A's turn, running on the session until its stop, once its prompt is with the agent (held in an object: a
   * promise returned would be waited for).
   * @param {AcpBridge} b @param {any} upstream @param {AbortSignal} signal
   */
  const running = async (b, upstream, signal) => {
    const a = turn(b, upstream, "A", "keep me ~quiet", { signal });
    a.catch(() => {});
    await until(() => lines(join(dir, `${upstream.id}-prompts.jsonl`)).some((p) => String(p.text).includes("keep me ~quiet")), "chat A's prompt to reach the agent");
    return { a };
  };

  // (fails before: yes — a chat's message found the turn running on the session by the session's id, whichever chat's
  // it was: chat B's message stopped chat A's turn and took its undelivered words)
  test("a chat's message finds its own turn only, never the other chat's on the session they share", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    const upstream = up("sh-find");
    const stop = new AbortController();
    try {
      await turn(b, upstream, "B", "hello");
      const { a } = await running(b, upstream, stop.signal);
      /** @param {string} chat */
      const asks = (chat) => ({ upstream, format: "anthropic", body: bodyOf("and now"), cwdHint: undefined, conversationId: chat });
      assert.equal(b.turnForRequest(asks("B")), null, "chat B's message finds no turn of its own");
      assert.equal(b.turnForRequest(asks("A"))?.conv, b.peekByRequest(asks("A")), "chat A's finds its own");
      stop.abort();
      assert.equal((await a).stopReason, "cancelled");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — the waiting turn took the session before its lock: the agent's requests on it went to chat B's
  // turn, its cancel reached chat A's prompt, and chat B's mode was set under it)
  test("a chat's turn waits for the other's on the session they share: the agent's requests, a cancel and the mode stay the other's until it ends", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    const upstream = up("sh-wait");
    const stop = new AbortController();
    try {
      await turn(b, upstream, "B", "hello");
      const { a } = await running(b, upstream, stop.signal);
      const aDone = settled(a);
      const its = b.turns.get("sess_old1");
      const planned = () => lines(join(dir, "sh-wait-calls.jsonl")).some((c) => c.method === "session/set_mode" && c.modeId === "plan");
      const next = turn(b, upstream, "B", "plan it", { mode: "plan" });
      await moment();
      assert.equal(b.turns.get("sess_old1"), its, "the agent's requests on the session go to chat A's turn");
      assert.equal(planned(), false, "chat B's mode waits for chat A's turn to end");
      const waiting = [...b.live].find((t) => t !== its);
      await waiting?.cancel?.();
      await moment();
      assert.equal(aDone(), false, "a cancel of chat B's waiting turn leaves chat A's prompt be");
      stop.abort();
      assert.equal((await a).stopReason, "cancelled", "chat A's turn ran on to its own stop");
      assert.equal((await next).stopReason, "end_turn", "chat B's turn ran once it had ended");
      assert.equal(planned(), true, "with its mode, set then");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — a stop of the waiting chat went unheard until the other chat's turn ended)
  test("a stop of a chat waiting for the session ends its turn at once, and the other chat's runs on", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    const upstream = up("sh-stop");
    const stop = new AbortController();
    try {
      await turn(b, upstream, "B", "hello");
      const { a } = await running(b, upstream, stop.signal);
      const aDone = settled(a);
      const its = b.turns.get("sess_old1");
      const stopB = new AbortController();
      const next = turn(b, upstream, "B", "hello again", { signal: stopB.signal });
      await moment();
      stopB.abort();
      assert.equal((await within(next)).stopReason, "cancelled", "chat B's turn ended at its stop");
      assert.equal(b.turns.get("sess_old1"), its, "the agent's requests on the session still go to chat A's turn");
      assert.equal(aDone(), false, "chat A's turn runs on");
      stop.abort();
      assert.equal((await a).stopReason, "cancelled");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — the review of 11-01: the stopped turn, last in line for the session, let go of the lock as it
  // left, so the chat's next turn took it at once, under the other chat's running prompt)
  test("a stop of a chat waiting for the session leaves it with the other chat's turn: the chat's next turn waits for that one", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    const upstream = up("sh-stopheld");
    const stop = new AbortController();
    try {
      await turn(b, upstream, "B", "hello");
      const { a } = await running(b, upstream, stop.signal);
      const its = b.turns.get("sess_old1");
      const stopB = new AbortController();
      const waits = turn(b, upstream, "B", "hello again", { signal: stopB.signal });
      await moment();
      stopB.abort();
      assert.equal((await within(waits)).stopReason, "cancelled", "chat B's turn ended at its stop");
      assert.equal(b.sessionLocks.has("sess_old1"), true, "chat A's turn holds the session still");
      const next = turn(b, upstream, "B", "and again");
      assert.equal((await within(next, 1000)).stopReason, "still waiting", "chat B's next turn waits for chat A's");
      assert.equal(b.turns.get("sess_old1"), its, "the agent's requests on the session still go to chat A's turn");
      stop.abort();
      assert.equal((await a).stopReason, "cancelled");
      assert.equal((await next).stopReason, "end_turn", "chat B's next turn ran once chat A's had ended");
      await until(() => !b.sessionLocks.has("sess_old1") || null, "the lock to go once nobody holds it");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — the compaction's wait for the other chat's turn heard no stop, and the stop cancelled the
  // session under that turn, which then let the compaction fork the session)
  test("a stop of the agent's own compaction waiting for the other chat's turn ends it there: nothing forked or asked, and the other chat's turn runs on", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    const upstream = up("sh-own-stop", { FAKE_ACP_SESSION_CAPS: "fork,resume", FAKE_ACP_CLAUDE: "1", FAKE_ACP_OWN_COMPACT: "1" });
    const stop = new AbortController();
    try {
      await turn(b, upstream, "B", "hello");
      const { a } = await running(b, upstream, stop.signal);
      const aDone = settled(a);
      const stopC = new AbortController();
      const compacting = b.compactOwn({ upstream, conversationId: "B", keep: "", fork: true, signal: stopC.signal, record: () => 1 });
      compacting.catch(() => {});
      await moment();
      stopC.abort();
      await assert.rejects(within(compacting), /stopped before the agent was asked/);
      await moment();
      assert.equal(aDone(), false, "chat A's turn runs on");
      const calls = lines(join(dir, "sh-own-stop-calls.jsonl"));
      assert.deepEqual([calls.filter((c) => c.method === "session/fork").length, calls.filter((c) => c.method === "own compact").length], [0, 0]);
      stop.abort();
      assert.equal((await a).stopReason, "cancelled");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — the summary's wait for the other chat's turn heard no stop, and the stop cancelled the session
  // under that turn; then its read-only mode went out under that turn once the stop had ended the wait)
  test("a stop of Filament's summary waiting for the other chat's turn ends it there, nothing asked, and the other chat's turn runs on", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    const upstream = up("sh-sum-stop");
    const stop = new AbortController();
    try {
      await turn(b, upstream, "B", "hello");
      const { a } = await running(b, upstream, stop.signal);
      const aDone = settled(a);
      const prompts = () => lines(join(dir, "sh-sum-stop-prompts.jsonl")).length;
      const sent = prompts();
      const modes = () => lines(join(dir, "sh-sum-stop-calls.jsonl")).filter((c) => c.method === "session/set_mode").length;
      const switched = modes();
      const stopS = new AbortController();
      const writing = b.summarize({ upstream, conversationId: "B", instruction: FORK_SUMMARY_INSTRUCTION, signal: stopS.signal });
      writing.catch(() => {});
      await moment();
      stopS.abort();
      await assert.rejects(within(writing), /stopped before the agent was asked/);
      await moment();
      assert.equal(aDone(), false, "chat A's turn runs on");
      assert.equal(prompts(), sent, "the summary's prompt never went out");
      assert.equal(modes(), switched, "nor its mode: the session is chat A's turn's");
      stop.abort();
      assert.equal((await a).stopReason, "cancelled");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: no — a guard the mutation pass asked for: a turn taking its session was handed what another chat's
  // turn that ended on it left undelivered)
  test("a turn taking its session gets what its own chat's turn before it left undelivered, never another chat's", () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    const [chatA, chatB] = [{ id: "A" }, { id: "B" }];
    /** A turn of the chat's that ended with words not yet delivered. @param {any} conv @param {string} words */
    const left = (conv, words) => Object.assign(new LiveTurn(), { conv, done: true, buffer: [{ type: "text", text: words }] });
    /** @type {any[]} */
    const heard = [];
    try {
      b.turns.set("sess_old1", left(chatA, "chat A's last words"));
      b.takeSession("sess_old1", Object.assign(new LiveTurn(), { conv: chatB }), (ev) => heard.push(ev));
      assert.equal(heard.length, 0, "chat B hears none of chat A's");
      b.turns.set("sess_old1", left(chatB, "chat B's last words"));
      b.takeSession("sess_old1", Object.assign(new LiveTurn(), { conv: chatB }), (ev) => heard.push(ev));
      assert.deepEqual(heard, [{ type: "text", text: "chat B's last words" }], "its own chat's come first");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — a chat's resume loaded the session at once, under the other chat's running turn, whose updates
  // the load's replay then took for its own)
  test("a chat resuming the session another chat's turn runs on loads it once that turn has ended", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    const upstream = up("sh-load");
    const stop = new AbortController();
    const loads = () => lines(join(dir, "sh-load-calls.jsonl")).filter((c) => c.method === "session/load").length;
    try {
      const { a } = await running(b, upstream, stop.signal);
      assert.equal(loads(), 1, "chat A's own load");
      const next = turn(b, upstream, "B", "hello");
      await moment();
      assert.equal(loads(), 1, "no load under chat A's running turn");
      stop.abort();
      assert.equal((await a).stopReason, "cancelled");
      assert.equal((await next).stopReason, "end_turn", "chat B's turn ran on the session it resumed");
      assert.equal(loads(), 2, "loaded once chat A's turn had ended");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — the stop went unheard: the chat's turn waited for the other chat's to end)
  test("a stop of a chat whose resume waits for the other chat's turn ends its turn at once, and nothing is opened", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    const upstream = up("sh-stopload");
    const stop = new AbortController();
    const calls = () => lines(join(dir, "sh-stopload-calls.jsonl"));
    try {
      const { a } = await running(b, upstream, stop.signal);
      const aDone = settled(a);
      const opened = calls().length;
      const stopB = new AbortController();
      const next = turn(b, upstream, "B", "hello", { signal: stopB.signal });
      await moment();
      stopB.abort();
      const ended = await within(next);
      assert.equal(ended.stopReason, "cancelled", "chat B's turn ended at its stop");
      // (fails before: no — a guard the mutation pass asked for: the turn's note says the session was never asked for)
      assert.ok(ended.notes?.includes("acp: stopped before session sess_old was opened"), JSON.stringify(ended.notes));
      assert.deepEqual(calls().slice(opened), [], "the session was not loaded, nor a new one opened");
      assert.equal(aDone(), false, "chat A's turn runs on");
      stop.abort();
      assert.equal((await a).stopReason, "cancelled");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — the stop went unheard: the chat's turn waited for the other chat's to end)
  test("a stop of a chat whose session reopens in another agent process while the other chat's turn runs on it ends its turn at once, and the chat keeps its session", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    const upstream = up("sh-reopen");
    const stop = new AbortController();
    const calls = () => lines(join(dir, "sh-reopen-calls.jsonl"));
    try {
      await turn(b, upstream, "B", "hello", { model: "fake-b" });
      const { a } = await running(b, upstream, stop.signal);
      const aDone = settled(a);
      const opened = calls().length;
      const stopB = new AbortController();
      const next = turn(b, upstream, "B", "hello again", { signal: stopB.signal });
      await moment();
      stopB.abort();
      assert.equal((await within(next)).stopReason, "cancelled", "chat B's turn ended at its stop");
      assert.deepEqual(calls().slice(opened), [], "the session was not loaded, nor a new one opened");
      const conv = b.peekByRequest({ upstream, format: "anthropic", body: bodyOf("and now"), cwdHint: undefined, conversationId: "B" });
      assert.equal(conv?.sessionId, "sess_old1", "chat B keeps its session");
      assert.equal(aDone(), false, "chat A's turn runs on");
      stop.abort();
      assert.equal((await a).stopReason, "cancelled");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — the reviewer's probe of 11-02: each chat counted from the figure its own turn said last, while
  // Claude's running total is the session's in its process: chat B's second turn booked 0.0618 for a run of 0.0309)
  test("two chats taking turns on one Claude session each book their own run's cost: the running total's growth since either said it last", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    const upstream = up("sh-cost", { FAKE_ACP_CLAUDE: "1", FAKE_ACP_SESSION_CAPS: "resume,close" });
    try {
      /** @type {(number | null)[]} */
      const booked = [];
      for (const chat of ["A", "B", "A", "B"]) booked.push((await turn(b, upstream, chat, "~priced")).context?.cost ?? null);
      // Each chat's first turn opened the session for itself, its running total going on out of sight.
      assert.deepEqual(booked, [null, null, 0.0309, 0.0309]);
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — the command loaded the session at once, under the other chat's running turn)
  test("a /resume of the session a turn runs on says so at once and opens nothing; once the turn has ended the chat attaches", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    const upstream = up("sh-attach");
    const stop = new AbortController();
    const loads = () => lines(join(dir, "sh-attach-calls.jsonl")).filter((c) => c.method === "session/load").length;
    /** Chat C's `/resume sess_old1`. */
    const attach = () => b.attach({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf("/resume sess_old1"), cwdHint: null, conversationId: "C", sessionId: "sess_old1" });
    try {
      const { a } = await running(b, upstream, stop.signal);
      assert.deepEqual(await within(attach()), { ok: false, error: "a turn runs on that session now; send `/resume sess_old1` again once it has ended" });
      assert.equal(loads(), 1, "chat A's own load only");
      stop.abort();
      assert.equal((await a).stopReason, "cancelled");
      assert.equal((await attach()).ok, true, "once it has ended, the chat attaches");
      assert.equal(loads(), 2);
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — the developer's Hunter of 11-01 on 1c8b72028: the command said a turn ran on the session
  // before it saw the chat held it, so a chat compacted since kept its session on the compaction before, and its next
  // message let it go for a fresh one)
  test("a /resume of the session the chat holds, which the other chat's turn runs on, attaches at once: its next turn waits for that turn and goes on in the session", async () => {
    const b = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    const upstream = up("sh-held");
    const stop = new AbortController();
    const opens = () => lines(join(dir, "sh-held-calls.jsonl")).filter((c) => /^session\/(close|resume|load|new)$/.test(c.method));
    /** Chat B's request, naming the chat's newest compaction. @param {string} text @param {number} base */
    const asked = (text, base) => ({ upstream, modelId: "fake-a", format: "anthropic", body: bodyOf(text), cwdHint: null, conversationId: "B", headers: { [COMPACTION_HEADER]: String(base) } });
    try {
      assert.equal((await b.attach({ ...asked("/resume sess_old1", 0), sessionId: "sess_old1" })).ok, true);
      assert.equal((await b.run({ ...asked("hello", 0), onEvent: () => {} })).sessionId, "sess_old1");
      const { a } = await running(b, upstream, stop.signal);
      const mark = opens().length;
      // Compact now on Filament's copy: the chat's newest compaction is 6 from here.
      const at = await within(b.attach({ ...asked("/resume sess_old1", 6), sessionId: "sess_old1" }));
      assert.equal(at.ok, true, JSON.stringify(at));
      assert.deepEqual(opens().slice(mark), [], "nothing opened or closed: the chat holds it");
      const next = b.run({ ...asked("go on", 6), onEvent: () => {} });
      assert.equal((await within(next, 1000)).stopReason, "still waiting", "its next turn waits for chat A's");
      stop.abort();
      assert.equal((await a).stopReason, "cancelled");
      assert.equal((await next).sessionId, "sess_old1", "kept, not let go for a fresh one");
      assert.equal(lines(join(dir, "sh-held-prompts.jsonl")).at(-1)?.text, "go on", "its words alone, nothing seeded");
    } finally {
      b.shutdown();
    }
  });
});

describe("two chats on one Codex thread (the bug report's X5)", () => {
  /** @type {string} */ let dir;
  /** @type {CodexBridge} */ let b;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-shared-cx-"));
    b = new CodexBridge(/** @type {any} */ ({ log: quiet }));
  });
  after(() => {
    b.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });
  /** An upstream on the fake Codex, what it hears logged to `<dir>/<id>.jsonl`. @param {string} id */
  const up = (id) => ({ id, name: id, type: "codex", acp: { command: process.execPath, args: [CODEX], env: { FAKE_CODEX_CALLS: join(dir, `${id}.jsonl`) }, cwdDefault: dir, permissions: "allow-all" } });
  /**
   * A turn of chat `chat`. @param {any} upstream @param {string} chat @param {string} text
   * @param {{ signal?: AbortSignal | null, resume?: string | null }} [o]
   */
  const turn = (upstream, chat, text, { signal = null, resume = null } = {}) =>
    b.run({ upstream, modelId: "gpt-6-astra", format: "anthropic", body: bodyOf(text), conversationId: chat, signal, resumeSessionId: resume, onEvent: () => {} });
  /** What Filament sent the fake by `method`. @param {string} id @param {string} method */
  const sent = (id, method) => lines(join(dir, `${id}.jsonl`)).filter((m) => m.method === method);
  /** The messages the turns Filament started said. @param {string} id @returns {string[]} */
  const started = (id) => sent(id, "turn/start").map((m) => (m.params.input || []).map((/** @type {any} */ i) => i.text || "").join(""));
  /**
   * Chat A's turn on the thread chat B started and A resumed, running until its stop (held in an object: a promise
   * returned would be waited for). @param {any} upstream @param {AbortSignal} signal
   */
  const shared = async (upstream, signal) => {
    const first = await turn(upstream, "B", "hello");
    await turn(upstream, "A", "hi", { resume: first.sessionId });
    const a = turn(upstream, "A", "keep on ~steer", { signal });
    a.catch(() => {});
    await until(() => started(upstream.id).some((t) => t.includes("keep on ~steer")), "chat A's turn on the thread");
    return { a };
  };

  // (fails before: yes — chat B's message went out at once: Codex took it into chat A's running turn, which answered
  // it, and chat B's turn waited for an end that never came)
  test("a chat's turn waits for the other's on the thread they share: its message goes out once that turn has ended", async () => {
    const upstream = up("cx-wait");
    const stop = new AbortController();
    const { a } = await shared(upstream, stop.signal);
    const aDone = settled(a);
    const next = turn(upstream, "B", "second");
    await moment();
    assert.equal(started("cx-wait").filter((t) => t.includes("second")).length, 0, "chat B's message waits");
    assert.equal(aDone(), false, "chat A's turn runs on");
    stop.abort();
    assert.equal((await a).stopReason, "cancelled");
    const out = await within(next);
    assert.equal(out.stopReason, "end_turn");
    assert.match(out.text, /second/);
  });

  // (fails before: yes — chat B's turn went into chat A's, and its stop, naming a turn Codex never started, ended
  // nothing)
  test("a stop of a chat waiting for the thread ends its turn at once, nothing of it sent, and the other chat's runs on", async () => {
    const upstream = up("cx-stop");
    const stop = new AbortController();
    const { a } = await shared(upstream, stop.signal);
    const aDone = settled(a);
    const stopB = new AbortController();
    const next = turn(upstream, "B", "never mind", { signal: stopB.signal });
    await moment();
    stopB.abort();
    assert.equal((await within(next)).stopReason, "cancelled", "chat B's turn ended at its stop");
    assert.equal(started("cx-stop").filter((t) => t.includes("never mind")).length, 0, "nothing of it went out");
    assert.equal(aDone(), false, "chat A's turn runs on");
    // (fails before: no — a guard the mutation pass asked for: chat B's turn, stopped while it waited, went on to take
    // the thread, and chat A's messages no longer found its running turn)
    assert.ok(b.turnForRequest({ upstream, format: "anthropic", body: bodyOf("x"), conversationId: "A" }), "chat A's messages find its turn");
    stop.abort();
    assert.equal((await a).stopReason, "cancelled");
  });

  // (fails before: yes — Codex compacted the thread under the other chat's running turn)
  test("Codex's own compaction of a chat's thread waits for the other chat's turn on it", async () => {
    const upstream = up("cx-compact");
    const stop = new AbortController();
    const { a } = await shared(upstream, stop.signal);
    const compacting = b.compactOwn({ upstream, conversationId: "B", base: 0, keep: "", fork: false, record: () => 1 });
    compacting.catch(() => {});
    await moment();
    assert.equal(sent("cx-compact", "thread/compact/start").length, 0, "it waits for chat A's turn");
    stop.abort();
    assert.equal((await a).stopReason, "cancelled");
    assert.equal((await within(compacting)).forked, false);
    assert.equal(sent("cx-compact", "thread/compact/start").length, 1);
  });

  // (fails before: no — a guard the mutation pass asked for: the compaction, stopped while it waited, went on to fork
  // the thread under chat A's turn)
  test("a stop of Codex's own compaction waiting for the other chat's turn ends it there, the thread neither forked nor compacted", async () => {
    const upstream = up("cx-compact-stop");
    const stop = new AbortController();
    const { a } = await shared(upstream, stop.signal);
    const stopC = new AbortController();
    const compacting = b.compactOwn({ upstream, conversationId: "B", base: 0, keep: "", fork: true, signal: stopC.signal, record: () => 1 });
    compacting.catch(() => {});
    await moment();
    stopC.abort();
    await assert.rejects(within(compacting), /stopped before Codex was asked/);
    assert.deepEqual([sent("cx-compact-stop", "thread/fork").length, sent("cx-compact-stop", "thread/compact/start").length], [0, 0]);
    stop.abort();
    assert.equal((await a).stopReason, "cancelled");
  });
});

describe("two chats on one Cursor agent, and the agents Cursor keeps by folder (the bug report's X5, X6)", () => {
  /** @type {string} */ let dir;
  /** @type {CursorSdkBridge} */ let b;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-shared-sdk-"));
    b = new CursorSdkBridge(/** @type {any} */ ({ log: quiet, loader: () => import(pathToFileURL(join(FIXTURES, "fake-cursor-sdk.mjs")).href) }));
  });
  after(() => {
    b.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });
  /** An upstream on the fake SDK, its folder `folder`. @param {string} id @param {string} [folder] */
  const up = (id, folder = dir) => ({ id, name: id, type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: folder, permissions: "allow-all" } });
  /**
   * A turn of chat `chat`. @param {any} upstream @param {string} chat @param {string} text
   * @param {{ signal?: AbortSignal | null, resume?: string | null, cwdHint?: string | null }} [o]
   */
  const turn = (upstream, chat, text, { signal = null, resume = null, cwdHint = null } = {}) =>
    b.run({ upstream, modelId: "composer-2.5", format: "anthropic", body: bodyOf(text), conversationId: chat, signal, resumeSessionId: resume, cwdHint, onEvent: () => {} });
  /**
   * Chat A's turn on the agent chat B made and A resumed, running until its stop (held in an object: a promise returned
   * would be waited for). @param {any} upstream @param {AbortSignal} signal
   */
  const shared = async (upstream, signal) => {
    const first = await turn(upstream, "B", "hello");
    await turn(upstream, "A", "hi", { resume: first.sessionId });
    const a = turn(upstream, "A", "keep on ~hang", { signal });
    a.catch(() => {});
    await until(() => b.agents.get(first.sessionId)?._run?.status === "running" || null, "chat A's run on the agent");
    return { a };
  };

  // (fails before: yes — chat B's send found the agent busy and forced its way in, which expired chat A's run)
  test("a chat's turn waits for the other's on the agent they share: its message goes once that turn has ended", async () => {
    const upstream = up("sdk-wait");
    const stop = new AbortController();
    const { a } = await shared(upstream, stop.signal);
    const aDone = settled(a);
    const next = turn(upstream, "B", "second");
    await moment();
    assert.equal(aDone(), false, "chat A's run goes on");
    stop.abort();
    assert.equal((await a).stopReason, "cancelled");
    const out = await within(next);
    assert.equal(out.stopReason, "end_turn");
    assert.match(out.text, /second/);
  });

  // (fails before: yes — chat B's send expired chat A's run, and its stop came after)
  test("a stop of a chat waiting for the agent ends its turn at once, and the other chat's run goes on", async () => {
    const upstream = up("sdk-stop");
    const stop = new AbortController();
    const { a } = await shared(upstream, stop.signal);
    const aDone = settled(a);
    const stopB = new AbortController();
    const next = turn(upstream, "B", "never mind", { signal: stopB.signal });
    await moment();
    stopB.abort();
    assert.equal((await within(next)).stopReason, "cancelled", "chat B's turn ended at its stop");
    assert.equal(aDone(), false, "chat A's run goes on");
    // (fails before: no — a guard the mutation pass asked for: chat B's turn, stopped while it waited, went on to take
    // the agent, and chat A's messages no longer found its running turn)
    assert.ok(b.turnForRequest({ upstream, format: "anthropic", body: bodyOf("x"), conversationId: "A" }), "chat A's messages find its turn");
    stop.abort();
    assert.equal((await a).stopReason, "cancelled");
  });

  // (fails before: yes — the summary's send found the agent busy, and failed)
  test("Cursor's summary in a chat's agent waits for the other chat's turn on it", async () => {
    const upstream = up("sdk-summary");
    const stop = new AbortController();
    const { a } = await shared(upstream, stop.signal);
    const aDone = settled(a);
    const writing = b.summarize({ upstream, conversationId: "B", instruction: FORK_SUMMARY_INSTRUCTION });
    writing.catch(() => {});
    await moment();
    assert.equal(aDone(), false, "chat A's run goes on");
    stop.abort();
    assert.equal((await a).stopReason, "cancelled");
    assert.match((await within(writing)).text, /<summary>The agent heard \d+ message\(s\) before this one<\/summary>/);
  });

  // (fails before: no — a guard the mutation pass asked for: the summary, stopped while it waited, went on to send to
  // the agent under chat A's run)
  test("a stop of Cursor's summary waiting for the other chat's turn ends it there, and the other chat's run goes on", async () => {
    const upstream = up("sdk-summary-stop");
    const stop = new AbortController();
    const { a } = await shared(upstream, stop.signal);
    const aDone = settled(a);
    const stopS = new AbortController();
    const writing = b.summarize({ upstream, conversationId: "B", instruction: FORK_SUMMARY_INSTRUCTION, signal: stopS.signal });
    writing.catch(() => {});
    await moment();
    stopS.abort();
    await assert.rejects(within(writing), /stopped before Cursor was asked/);
    assert.equal(aDone(), false, "chat A's run goes on");
    stop.abort();
    assert.equal((await a).stopReason, "cancelled");
  });

  // (fails before: yes — the agents were listed with no folder: only those of the folder Filament runs in showed, so a
  // chat found none to resume, and one it resumed would have been looked for in the chat's own folder)
  test("a chat lists the agents of its folder, of its fellow chats' and of the upstream's; one it resumes works in its own", async () => {
    const [home, other, mine] = ["home", "other", "mine"].map((n) => join(dir, n));
    for (const f of [home, other, mine]) mkdirSync(f);
    const upstream = up("sdk-folders", home);
    /** @param {string} chat @param {string | null} cwdHint */
    const forget = (chat, cwdHint) => b.forgetByRequest({ upstream, format: "anthropic", body: bodyOf("x"), cwdHint, conversationId: chat });
    const made = await turn(upstream, "A", "hello");
    const held = await turn(upstream, "B", "hello", { cwdHint: other });
    const kept = await turn(upstream, "C", "hello", { cwdHint: mine });
    assert.deepEqual([forget("A", null), forget("C", mine)], [true, true]);
    const l = await b.listSessions(upstream, { format: "anthropic", body: bodyOf("/sessions"), cwdHint: mine });
    assert.deepEqual(
      l.sessions.map((/** @type {any} */ s) => `${s.sessionId} ${s.cwd}`).sort(),
      [`${made.sessionId} ${home}`, `${held.sessionId} ${other}`, `${kept.sessionId} ${mine}`].sort(),
    );
    const on = await turn(upstream, "D", "and on", { resume: made.sessionId, cwdHint: other });
    assert.deepEqual([on.sessionId, on.resumed, on.cwd], [made.sessionId, true, home]);
    // (fails before: no — a guard the mutation pass asked for: `/sessions`, a `/resume` and a turn's resume looked in
    // the folders Filament's chats work in and the upstream's, never the asking chat's own)
    const said = await answerAgentCommand(/** @type {any} */ ({}), /** @type {any} */ ({ cmd: parseAgentCommand("/sessions"), rec: {}, bridge: b, upstream, acp: upstream.acp, format: "anthropic", body: bodyOf("/sessions"), inboundHeaders: { "x-filament-cwd": mine }, route: { match: "sdk/*" }, modelId: "composer-2.5", agentName: "Cursor", conversationId: "F" }));
    assert.ok(String(said.reply).includes(` — ${mine}`), String(said.reply));
    const at = await b.attach({ upstream, format: "anthropic", body: bodyOf("/resume"), cwdHint: mine, conversationId: "F", sessionId: kept.sessionId });
    assert.deepEqual([at.ok, at.cwd], [true, mine], at.error);
    assert.equal(forget("F", mine), true);
    const back = await turn(upstream, "E", "again", { resume: kept.sessionId, cwdHint: mine });
    assert.deepEqual([back.sessionId, back.resumed, back.cwd], [kept.sessionId, true, mine]);
  });
});
