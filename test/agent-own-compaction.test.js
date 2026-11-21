// @ts-check
// HarnessV3-ACP AC5-5: a coding agent compacts its own session, asked by Filament — Claude Code's `/compact` through its
// ACP adapter, Codex's `thread/compact/start` — told what to keep where it takes instructions, and forked first where
// it can be, so Undo brings the session from before back. The words for it, then each bridge against its fake, then
// through the app: Compact now under the way own, the line under it, a typed `/compact`, and a message sent while it
// runs.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURES, FAKE_ACP_AGENT, startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { AcpBridge } from "../src/adapters/agents/acp/bridge.js";
import { CodexBridge } from "../src/adapters/agents/codex/bridge.js";
import { COMPACTION_HEADER } from "../src/adapters/agents/compactions.js";
import { ownInstruction } from "../src/app/sessions/compactor.js";
import { agentHeld } from "../src/app/sessions/agent-line.js";
import { openWords } from "../src/app/agent/still-open.js";

/** The first message after the agent's own compaction, with nothing open: recall's list of the turns named (the owner's of 11-08). */
const AFTER = openWords([], "lost");
/** The fake agent's echo of that message, which says its tail. @param {number} n */
const echoAfter = (n) => new RegExp(`\\becho\\(${n}\\): [^\\n]*with how each answer ended\\.\\]$`);
import { compactionFacts, compactionWords, turnPhaseWords } from "../src/ui/harness/lib/labels.js";

const quiet = () => {};
const CODEX = join(FIXTURES, "fake-codex-app-server.mjs");
/** JSON lines of a file, oldest first. @param {string} file */
const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
/** A harness turn's request: the person's words, naming the chat's newest compaction. @param {string} text @param {number} base */
const asked = (text, base) => ({ format: "anthropic", body: { model: "m", max_tokens: 100, messages: [{ role: "user", content: text }] }, headers: { [COMPACTION_HEADER]: String(base) } });
/**
 * A bridge's turn, with the words the agent said in it.
 * @param {{ run: (o: any) => Promise<any> }} bridge @param {any} o
 */
async function said(bridge, o) {
  let words = "";
  const r = await bridge.run({ ...o, onEvent: (/** @type {any} */ ev) => (words += ev.type === "text" ? ev.text : "") });
  return { ...r, said: words };
}

let dir = "";
before(() => {
  dir = mkdtempSync(join(tmpdir(), "filament-agent-own-compaction-"));
});
after(async () => {
  await removeDirs(dir);
});

describe("what the agent is told, and the words for it", () => {
  test("what to keep: the person's words, on one line", () => {
    assert.equal(ownInstruction(""), "");
    assert.equal(ownInstruction("  the plan\n and the tests "), "the plan and the tests");
  });

  test("what the agent holds after its own compaction: what it said it holds after, from then; a compaction of Filament's since starts a fresh session", () => {
    const turn = { startedAt: 1000, endedAt: 2000, meta: { facts: { upstream: "ag", context: { held: 180_000, window: 200_000, source: "agent" } } } };
    const o = { turns: [turn], upstream: "ag", window: null };
    const own = { created_at: 3000, method: "own", detail: { before: 180_000, after: 18_000 } };
    assert.deepEqual(agentHeld({ ...o, compactions: [own] }), { held: 18_000, window: 200_000, estimated: false, endedAt: 3000 });
    assert.deepEqual(agentHeld({ ...o, compactions: [{ ...own, detail: { before: 180_000 } }] }), { held: 0, window: 200_000, estimated: false, endedAt: 3000, unsaid: true }, "an after it did not say: unsaid, nothing counted until its next turn");
    assert.equal(agentHeld({ ...o, compactions: [own, { created_at: 3500, method: "summary" }] }), null);
  });

  test("the page's: the boundary, its figures, and a message waiting for it", () => {
    assert.equal(compactionWords({ fromTurn: 1, toTurn: 4, method: "own" }), "turns 1–4 compacted by the agent, in its own session: it handed no summary over, so Filament's copy keeps the turns until Filament summarizes them");
    assert.equal(compactionFacts({ detail: { before: 120_000, after: 18_000, exact: true, model: "ag/fake-a", how: "agent-own", ms: 31_000 } }), " · 120k → 18k · 31.0 s · ag/fake-a");
    assert.equal(compactionFacts({ detail: { before: 120_000, exact: true, model: "cx/gpt-6-astra", how: "agent-own", ms: 4200 } }), " · at 120k · 4.2 s · cx/gpt-6-astra", "Codex names no after");
    assert.equal(turnPhaseWords({ kind: "compacting", method: "own" }), "compacting first — the agent is compacting its own context; your message goes to it once that's done");
  });
});

describe("an ACP agent: Claude Code's /compact", () => {
  /** @type {AcpBridge} */ let bridge;
  before(() => {
    bridge = new AcpBridge(/** @type {any} */ ({ log: quiet, stateFile: join(dir, "acp-sessions.json") }));
  });
  after(() => bridge.shutdown());
  /** As Claude's adapter is: it publishes `/compact` and says how its compaction went. @param {string} id @param {Record<string, string>} [env] */
  const upstream = (id, env = {}) => ({
    id,
    name: id,
    type: "acp",
    acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(dir, `${id}-calls.jsonl`), FAKE_ACP_LOG: join(dir, `${id}-prompts.jsonl`), FAKE_ACP_CLAUDE: "1", FAKE_ACP_OWN_COMPACT: "1", FAKE_ACP_SESSION_CAPS: "resume,close,fork,delete", ...env }, cwdDefault: dir, permissions: "allow-all" },
  });
  /** @param {any} up @param {string} text @param {number} base */
  const turn = (up, text, base) => said(bridge, { upstream: up, modelId: "fake-a", conversationId: "chat", ...asked(text, base) });
  /** The chat's session, once the agent published its commands in it. @param {any} up */
  const opened = async (up) => {
    const one = await turn(up, "one", 0);
    const two = await turn(up, "two", 0);
    await until(() => bridge.commandsOf(up.id, two.sessionId).length, "the agent's commands");
    assert.equal(two.sessionId, one.sessionId);
    return two;
  };

  test("forked first, then its /compact, told what to keep: the figures it says, listed by `record` before it answers; the next message goes on in the compacted session and lets the fork go", async () => {
    const up = upstream("own");
    const calls = () => lines(join(dir, "own-calls.jsonl"));
    const where = { upstream: up, conversationId: "chat", base: 0 };
    assert.equal(bridge.compacts(where), null, "no session to compact");
    const two = await opened(up);
    assert.equal(bridge.compacts(where), "fork");
    /** @type {any[]} */ const listed = [];
    /** @type {any[]} */ const events = [];
    const facts = await bridge.compactOwn({ ...where, keep: "the plan", fork: true, record: (f) => (listed.push(f), 7), onEvent: (ev) => events.push(ev) });
    // (fails before: yes — HarnessV4_Tasks C28: the summary the agent kept went no further than the page's row)
    assert.deepEqual(facts, { tokensBefore: 120_000, tokensAfter: 18_000, ms: 31_000, usage: { input: 30, output: 900, cacheRead: 119_000, cacheWrite: 0, total: 119_930, cacheSeen: true }, forked: true, instructed: true, summary: "Kept: one | two (keeping the plan)" });
    assert.deepEqual(listed, [facts]);
    assert.deepEqual(events.map((e) => e.state || "figures"), ["started", "completed", "figures"]);
    const fork = calls().find((c) => c.method === "session/fork");
    assert.equal(fork?.from, two.sessionId);
    assert.deepEqual(calls().filter((c) => c.method === "own compact").map((c) => [c.sessionId, c.told]), [[two.sessionId, "the plan"]], "compacted in the session itself, told what to keep");
    assert.equal(calls().some((c) => c.method === "session/resume"), false, "the fork is never opened");
    assert.deepEqual([bridge.compacts(where), bridge.compacts({ ...where, base: 7 })], [null, "fork"], "the session stands on its compaction now");

    const three = await turn(up, "three", 7);
    assert.equal(three.sessionId, two.sessionId);
    assert.match(three.said, /^echo\(2\): three/, "the session holds what its compaction kept, and the message");
    await until(() => calls().some((c) => c.method === "session/delete" && c.sessionId === fork.sessionId), "the fork deleted: the compaction can no longer be undone");
  });

  test("the summary it kept comes with its end, as ACP's compaction updates say it (claude-agent-acp 0.87, AC5-7)", async () => {
    const up = upstream("kept", { FAKE_ACP_COMPACT_CHUNKS: "1" });
    await opened(up);
    /** @type {any[]} */ const events = [];
    await bridge.compactOwn({ upstream: up, conversationId: "chat", base: 0, keep: "the plan", fork: true, record: () => 4, onEvent: (ev) => events.push(ev) });
    assert.match(String(events.find((e) => e.state === "completed")?.summary), /^Kept: .*one.*two.* \(keeping the plan\)$/);
  });

  // (fails before: yes — claude-agent-acp 0.87 says its compaction to a client that declares no compaction updates as
  // its call named `compact`, the figures in `rawOutput`, and Filament read only 0.76's mark: the /compact "ended
  // without a compaction")
  test("so it is read as the adapter says it to a client that declares no compaction updates (0.87): its call named `compact`", async () => {
    const up = upstream("named", { FAKE_ACP_COMPACT_FORM: "tool" });
    await opened(up);
    /** @type {any[]} */ const events = [];
    const facts = await bridge.compactOwn({ upstream: up, conversationId: "chat", base: 0, keep: "", fork: true, record: () => 5, onEvent: (ev) => events.push(ev) });
    assert.deepEqual([facts.tokensBefore, facts.tokensAfter, facts.ms], [120_000, 18_000, 31_000]);
    assert.deepEqual(events.filter((e) => e.state).map((e) => e.state), ["started", "completed"]);
  });

  test("and as 0.76 said it: its call marked `_meta.contextCompaction`", async () => {
    const up = upstream("marked", { FAKE_ACP_COMPACT_FORM: "0.76" });
    await opened(up);
    const facts = await bridge.compactOwn({ upstream: up, conversationId: "chat", base: 0, keep: "", fork: true, record: () => 6 });
    assert.deepEqual([facts.tokensBefore, facts.tokensAfter, facts.ms], [120_000, 18_000, 31_000]);
  });

  test("an undo brings the session from before back: the fork opened as it was, the compacted session let go; the fork is the chat's session from then, closed when let go", async () => {
    const up = upstream("undo");
    const calls = () => lines(join(dir, "undo-calls.jsonl"));
    const where = { upstream: up, conversationId: "chat", base: 0 };
    const two = await opened(up);
    const facts = await bridge.compactOwn({ ...where, keep: "", fork: true, record: () => 3 });
    assert.equal(facts.instructed, false);
    assert.deepEqual(calls().filter((c) => c.method === "own compact").map((c) => c.told), [""], "told nothing to keep");
    const fork = calls().find((c) => c.method === "session/fork");
    const back = await turn(up, "three", 0);
    assert.equal(back.sessionId, fork.sessionId);
    assert.ok(calls().some((c) => c.method === "session/resume" && c.sessionId === fork.sessionId), "reopened");
    assert.match(back.said, /^echo\(3\): three/, "with the chat as it was before the compaction");
    await until(() => calls().some((c) => c.method === "session/close" && c.sessionId === two.sessionId), "the compacted session let go");
    assert.equal(calls().some((c) => c.method === "session/delete"), false, "the fork is the chat's session now");
    // (fails before: no — a guard the mutation pass asked for: no session an undo brought back was let go after)
    const four = await turn(up, "four", 9);
    assert.notEqual(four.sessionId, fork.sessionId, "a compaction of Filament's since: a fresh session");
    await until(() => calls().some((c) => c.method === "session/close" && c.sessionId === fork.sessionId), "the session the undo brought back, let go");
    assert.equal(calls().some((c) => c.method === "session/delete"), false, "closed, as the chat's sessions are: never deleted");
  });

  // (fails before: yes — the developer's Hunter of 11-01 on 1c8b72028: the attach set the session it held onto the
  // compaction the undo named, so its next turn went on in the compacted session and deleted the fork the undo brings
  // back)
  test("a /resume of the session the chat holds, after an undo of its compaction, leaves the move to the turn and names it: back to the session from before, the fork kept", async () => {
    const up = upstream("heldundo", { FAKE_ACP_ALLOW_LOAD: "1" });
    const calls = () => lines(join(dir, "heldundo-calls.jsonl"));
    /** The chat's `/resume sess_old1`. @param {number} base */
    const attach = (base) => bridge.attach({ upstream: up, modelId: "fake-a", cwdHint: null, conversationId: "chat", sessionId: "sess_old1", ...asked("/resume sess_old1", base) });
    assert.equal((await attach(0)).ok, true);
    const two = await opened(up);
    assert.equal(two.sessionId, "sess_old1");
    await bridge.compactOwn({ upstream: up, conversationId: "chat", base: 0, keep: "", fork: true, record: () => 3 });
    const fork = calls().find((c) => c.method === "session/fork");
    // Undo: the chat's newest compaction is the one before from here.
    const mark = calls().length;
    const at = await attach(0);
    assert.equal(at.ok, true, JSON.stringify(at));
    // (fails before: yes — the review of f98dc6d68: the attach answered with the session the chat held, and the command
    // said it attached that one, while the chat's next turn went on in the session from before and let it go)
    assert.deepEqual([at.session.sessionId, at.undone], [fork.sessionId, "sess_old1"], "the session the chat's turn goes on in, and the one let go");
    assert.deepEqual(calls().slice(mark).filter((c) => /^session\/(close|resume|load|new|fork|delete)$/.test(c.method)), [], "nothing opened, closed or deleted: the chat holds it");
    const back = await turn(up, "three", 0);
    assert.equal(back.sessionId, fork.sessionId, "the session from before the compaction, as the undo left the chat");
    assert.match(back.said, /^echo\(3\): three/, "with the chat as it was before the compaction");
    assert.equal(calls().some((c) => c.method === "session/delete"), false, "the fork kept");
  });

  test("where the agent forks no session: compacted in place; an undo then starts a fresh session", async () => {
    const up = upstream("inplace", { FAKE_ACP_SESSION_CAPS: "resume,close" });
    const calls = () => lines(join(dir, "inplace-calls.jsonl"));
    const where = { upstream: up, conversationId: "chat", base: 0 };
    const two = await opened(up);
    assert.equal(bridge.compacts(where), "session");
    assert.equal((await bridge.compactOwn({ ...where, keep: "", fork: true, record: () => 4 })).forked, false);
    assert.deepEqual(calls().filter((c) => c.method === "session/fork"), []);
    assert.notEqual((await turn(up, "three", 0)).sessionId, two.sessionId);
  });

  test("a compaction that fails: the agent's words, nothing listed, the fork deleted, the chat going on in its session", async () => {
    const up = upstream("fails", { FAKE_ACP_OWN_COMPACT: "fail" });
    const calls = () => lines(join(dir, "fails-calls.jsonl"));
    const where = { upstream: up, conversationId: "chat", base: 0 };
    const two = await opened(up);
    let listed = 0;
    await assert.rejects(bridge.compactOwn({ ...where, keep: "", fork: true, record: () => ++listed }), { message: "Not enough messages to compact." });
    assert.equal(listed, 0);
    const fork = calls().find((c) => c.method === "session/fork");
    await until(() => calls().some((c) => c.method === "session/delete" && c.sessionId === fork.sessionId), "the fork deleted");
    assert.equal((await turn(up, "three", 0)).sessionId, two.sessionId);
  });

  test("a stop while it compacts: its prompt cancelled, nothing listed, the fork deleted", async () => {
    const gate = join(dir, "acp-gate");
    const up = upstream("stops", { FAKE_ACP_OWN_COMPACT_GATE: gate });
    const calls = () => lines(join(dir, "stops-calls.jsonl"));
    const where = { upstream: up, conversationId: "chat", base: 0 };
    await opened(up);
    const stop = new AbortController();
    let listed = 0;
    const going = bridge.compactOwn({ ...where, keep: "", fork: true, record: () => ++listed, signal: stop.signal });
    await until(() => calls().some((c) => c.method === "own compact"), "the agent compacting");
    stop.abort();
    await assert.rejects(going, { message: "stopped while the agent compacted" });
    assert.equal(listed, 0);
    const fork = calls().find((c) => c.method === "session/fork");
    await until(() => calls().some((c) => c.method === "session/delete" && c.sessionId === fork.sessionId), "the fork deleted");
  });

  // (fails before: yes — HarnessV4_Tasks B9: a stop that cut the wait for the fork dropped the fork's answer, so the
  // session the agent then forked stayed in it, held by nothing)
  test("a stop while the agent forks: nothing asked of the session, and the fork it then makes is deleted", async () => {
    const gate = join(dir, "fork-gate");
    const up = upstream("forkstop", { FAKE_ACP_FORK_GATE: gate });
    const calls = () => lines(join(dir, "forkstop-calls.jsonl"));
    const where = { upstream: up, conversationId: "chat", base: 0 };
    await opened(up);
    const stop = new AbortController();
    let listed = 0;
    const going = bridge.compactOwn({ ...where, keep: "", fork: true, record: () => ++listed, signal: stop.signal });
    await until(() => calls().some((c) => c.method === "fork asked"), "the agent asked to fork");
    stop.abort();
    await assert.rejects(going);
    writeFileSync(gate, "");
    const fork = await until(() => calls().find((c) => c.method === "session/fork"), "the fork made after the stop");
    await until(() => calls().some((c) => c.method === "session/delete" && c.sessionId === fork.sessionId), "the fork deleted");
    assert.deepEqual([listed, calls().some((c) => c.method === "own compact")], [0, false], "nothing listed, nothing asked of the session");
  });

  // (fails before: yes — the agent's own compaction was no work on its process: an account signed out or removed
  // meanwhile stopped the process under it)
  test("an agent let go of while it compacts: it ends its compaction, then stops once the fork it made is deleted (the bug report's P3)", async () => {
    const gate = join(dir, "letgo-gate");
    // (fails before: no — a guard the mutation pass asked for: the agent answered the delete as it heard it, so an
    // agent stopped before its answer had still heard it)
    const up = upstream("letgo", { FAKE_ACP_OWN_COMPACT: "fail", FAKE_ACP_OWN_COMPACT_GATE: gate, FAKE_ACP_DELETE_MS: "300" });
    const calls = () => lines(join(dir, "letgo-calls.jsonl"));
    const where = { upstream: up, conversationId: "chat", base: 0 };
    await opened(up);
    const proc = [...bridge.procs.values()].find((p) => p.key.startsWith("letgo|"));
    const going = bridge.compactOwn({ ...where, keep: "", fork: true, record: () => 1 });
    await until(() => calls().some((c) => c.method === "own compact"), "the agent compacting");
    bridge.letGo(up.id);
    assert.equal(bridge.running(up.id), true, "its account is neither signed out nor removed meanwhile");
    writeFileSync(gate, "");
    await assert.rejects(going, { message: "Not enough messages to compact." });
    await until(() => proc.exited, "the agent stopped");
    const fork = calls().find((c) => c.method === "session/fork");
    assert.ok(calls().some((c) => c.method === "session/delete" && c.sessionId === fork.sessionId), "once the fork it made was deleted");
    assert.equal(bridge.running(up.id), false);
  });

  test("none where the agent says nothing of its compaction, publishes no /compact, or the chat's next message leaves the session", async () => {
    const silent = upstream("silent", { FAKE_ACP_CLAUDE: "" });
    const plain = upstream("plain", { FAKE_ACP_OWN_COMPACT: "" });
    for (const up of [silent, plain]) {
      await opened(up);
      assert.equal(bridge.compacts({ upstream: up, conversationId: "chat", base: 0 }), null, up.id);
    }
    const up = upstream("leaves");
    await opened(up);
    assert.equal(bridge.compacts({ upstream: up, conversationId: "chat", base: 5 }), null, "a compaction of Filament's since: the next message starts a fresh session");
    await assert.rejects(bridge.compactOwn({ upstream: up, conversationId: "chat", base: 5, keep: "", fork: true, record: () => 1 }), /nothing to compact in it/);
  });
});

describe("Codex: thread/compact/start", () => {
  /** @type {CodexBridge} */ let bridge;
  before(() => {
    bridge = new CodexBridge({ log: quiet, stateFile: join(dir, "codex-sessions.json") });
  });
  after(() => bridge.shutdown());
  /** @param {string} id @param {Record<string, string>} [env] */
  const upstream = (id, env = {}) => ({ id, name: id, type: "codex", acp: { command: process.execPath, args: [CODEX], env: { FAKE_CODEX_CALLS: join(dir, `${id}.jsonl`), ...env }, cwdDefault: dir, permissions: "allow-all" } });
  /** @param {any} up @param {string} text @param {number} base */
  const turn = (up, text, base) => said(bridge, { upstream: up, modelId: "gpt-6-astra", conversationId: "chat", ...asked(text, base) });
  /** What the fake heard, by method. @param {any} up @param {string} method */
  const heard = (up, method) => lines(join(dir, `${up.id}.jsonl`)).filter((m) => m.method === method);
  /** The thread the fork made, as Filament let go of it at once. @param {any} up @param {string} thread */
  const forkOf = (up, thread) => heard(up, "thread/unsubscribe").find((m) => m.params.threadId !== thread)?.params.threadId;

  test("forked first — kept on disk, let go of at once — then its compaction, a turn of its own, told nothing; the next message goes on in the compacted thread and deletes the fork", async () => {
    const up = upstream("cx");
    const where = { upstream: up, conversationId: "chat", base: 0 };
    assert.equal(bridge.compacts(where), null, "no thread to compact");
    await turn(up, "one", 0);
    const two = await turn(up, "two", 0);
    assert.equal(bridge.compacts(where), "fork");
    /** @type {any[]} */ const listed = [];
    /** @type {any[]} */ const events = [];
    const { ms, ...facts } = await bridge.compactOwn({ ...where, keep: "the plan", fork: true, record: (f) => (listed.push(f), 5), onEvent: (ev) => events.push(ev) });
    assert.ok(ms >= 0);
    assert.deepEqual(facts, { tokensBefore: 912, tokensAfter: 0, usage: { input: 2000, output: 2400, cacheRead: 118_000, cacheWrite: 0, total: 122_400, cacheSeen: true }, forked: true, instructed: false }, "what it held before, from its last turn; Codex names no after");
    assert.equal(listed.length, 1);
    assert.deepEqual(events.map((e) => e.state), ["started", "completed"]);
    const [fork] = heard(up, "thread/fork");
    assert.deepEqual(fork.params, { threadId: two.sessionId, cwd: two.cwd, ephemeral: false, excludeTurns: true });
    const forkId = forkOf(up, two.sessionId);
    assert.ok(forkId, "the fork let go of at once");
    assert.deepEqual(heard(up, "thread/compact/start").map((m) => m.params), [{ threadId: two.sessionId }]);

    const three = await turn(up, "three", 5);
    assert.equal(three.sessionId, two.sessionId);
    await until(() => heard(up, "thread/delete").some((m) => m.params.threadId === forkId), "the fork deleted");
  });

  test("an undo brings the thread from before back", async () => {
    const up = upstream("cxundo");
    const where = { upstream: up, conversationId: "chat", base: 0 };
    await turn(up, "one", 0);
    const two = await turn(up, "two", 0);
    await bridge.compactOwn({ ...where, keep: "", fork: true, record: () => 2 });
    const forkId = forkOf(up, two.sessionId);
    const back = await turn(up, "three", 0);
    assert.equal(back.sessionId, forkId);
    assert.ok(heard(up, "thread/resume").some((m) => m.params.threadId === forkId), "reopened");
    assert.deepEqual(heard(up, "thread/delete"), [], "the fork is the chat's thread now");
  });

  test("a compaction that fails: Codex's error, nothing listed, the fork deleted, the chat going on in its thread", async () => {
    const up = upstream("cxfail", { FAKE_CODEX_COMPACT: "fail" });
    const where = { upstream: up, conversationId: "chat", base: 0 };
    const one = await turn(up, "one", 0);
    let listed = 0;
    await assert.rejects(bridge.compactOwn({ ...where, keep: "", fork: true, record: () => ++listed }), /stream disconnected before completion/);
    assert.equal(listed, 0);
    const forkId = forkOf(up, one.sessionId);
    await until(() => heard(up, "thread/delete").some((m) => m.params.threadId === forkId), "the fork deleted");
    assert.equal((await turn(up, "two", 0)).sessionId, one.sessionId);
  });

  test("a stop while it compacts: its turn interrupted, nothing listed", async () => {
    const gate = join(dir, "codex-gate");
    const up = upstream("cxstop", { FAKE_CODEX_COMPACT_GATE: gate });
    const where = { upstream: up, conversationId: "chat", base: 0 };
    await turn(up, "one", 0);
    const stop = new AbortController();
    let listed = 0;
    const going = bridge.compactOwn({ ...where, keep: "", fork: false, record: () => ++listed, signal: stop.signal });
    await until(() => heard(up, "thread/compact/start").length, "Codex compacting");
    stop.abort();
    await assert.rejects(going, { message: "stopped while Codex compacted" });
    assert.equal(listed, 0);
    assert.equal(heard(up, "turn/interrupt").length, 1);
  });

  // (fails before: yes — with no clock on the compaction (HarnessV3-FailurePoints §4 B), nothing ended its wait once
  // the app-server had ended: the compaction waited for Codex's answer for ever)
  test("the app-server ends while Codex compacts: the compaction fails in the process's words, nothing listed", async () => {
    const up = upstream("cxgone", { FAKE_CODEX_COMPACT_GATE: join(dir, "cxgone-gate-never") });
    const where = { upstream: up, conversationId: "chat", base: 0 };
    await turn(up, "one", 0);
    let listed = 0;
    const going = bridge.compactOwn({ ...where, keep: "", fork: false, record: () => ++listed });
    await until(() => heard(up, "thread/compact/start").length, "Codex compacting");
    /** @type {any} */ (bridge.procs.get(up.id)).child.kill();
    await assert.rejects(going, /agent process exited/);
    assert.equal(listed, 0);
  });

  // (fails before: yes — Codex's compaction was no work on the app-server: an account signed out or removed meanwhile
  // stopped the app-server under it)
  test("an app-server let go of while Codex compacts: it ends the compaction, then stops once the thread it made is deleted (the bug report's P3)", async () => {
    const gate = join(dir, "cxletgo-gate");
    // (fails before: no — a guard the mutation pass asked for: Codex answered the delete as it heard it, so an
    // app-server stopped before its answer had still heard it)
    const up = upstream("cxletgo", { FAKE_CODEX_COMPACT: "fail", FAKE_CODEX_COMPACT_GATE: gate, FAKE_CODEX_DROP_MS: "300" });
    const where = { upstream: up, conversationId: "chat", base: 0 };
    const one = await turn(up, "one", 0);
    const proc = bridge.procs.get(up.id);
    assert.ok(proc, "the app-server runs");
    const going = bridge.compactOwn({ ...where, keep: "", fork: true, record: () => 1 });
    await until(() => heard(up, "thread/compact/start").length, "Codex compacting");
    bridge.letGo(up.id);
    assert.equal(bridge.running(up.id), true, "its account is neither signed out nor removed meanwhile");
    writeFileSync(gate, "");
    await assert.rejects(going, /stream disconnected before completion/);
    await until(() => proc.exited, "the app-server stopped");
    assert.ok(heard(up, "thread/delete answered").some((m) => m.params.threadId === forkOf(up, one.sessionId)), "once the thread it made was deleted");
    assert.equal(bridge.running(up.id), false);
  });
});

describe("through the app", () => {
  const SUMMARY = "SUMMARY: the turns so far, condensed.";
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  let projDir = "";
  let gate = "";
  /** @param {string} id */
  const calls = (id) => lines(join(root, `${id}-calls.jsonl`));
  /** @param {string} id */
  const prompts = (id) => lines(join(root, `${id}-prompts.jsonl`));
  /** How Filament's own model answers while a test scripts it (a loop turn that uses a tool); else the summary. @type {((call: any) => any) | null} */
  let loopScript = null;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-agent-own-compaction-app-"));
    projDir = join(root, "project");
    gate = join(root, "gate");
    mkdirSync(projDir);
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    // Filament's own writer, for the compactions the agent does not make.
    up = await fakeUpstream((call) => loopScript?.(call) || anthropicReply(SUMMARY, { model: "m-1", usage: { input_tokens: 10, output_tokens: 5 } }));
    /** @param {string} id @param {Record<string, string>} [env] */
    const agent = (id, env = {}) => ({
      id,
      name: id,
      type: "acp",
      acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(root, `${id}-calls.jsonl`), FAKE_ACP_LOG: join(root, `${id}-prompts.jsonl`), FAKE_ACP_CLAUDE: "1", FAKE_ACP_OWN_COMPACT: "1", FAKE_ACP_SESSION_CAPS: "resume,close,fork,delete", ...env }, cwdDefault: projDir, permissions: "allow-all", hints: false },
    });
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [
          agent("own"),
          agent("ownfails", { FAKE_ACP_OWN_COMPACT: "fail" }),
          agent("owngate", { FAKE_ACP_OWN_COMPACT_GATE: gate }),
          agent("plain", { FAKE_ACP_CLAUDE: "", FAKE_ACP_OWN_COMPACT: "" }),
          { id: "cx", name: "Codex", type: "codex", acp: { command: process.execPath, args: [CODEX], env: { FAKE_CODEX_CALLS: join(root, "cx.jsonl") }, cwdDefault: projDir, permissions: "allow-all" } },
          { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } },
        ];
        cfg.routes = [
          ...["own", "ownfails", "owngate", "plain", "cx"].map((id) => ({ match: `${id}/*`, upstream: id, upstreamModel: "{1}", enabled: true })),
          { match: "m-1", upstream: "m", upstreamModel: "{model}", enabled: true },
        ];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(root);
  });
  /** @param {string} path @param {any} [init] */
  const json = async (path, init) => (await shim.api(path, init)).json();
  /** @param {string} id */
  const at = (id) => `/api/sessions/${encodeURIComponent(id)}`;
  /** A session on `model`, its compaction model Filament's writer. @param {string} model @param {any} [compaction] */
  // Each session makes room by itself at the line (Automatic) unless a test says otherwise: asking first is the
  // default (HarnessV4_Tasks C26).
  const open = async (model, compaction = {}) => String((await json("/api/sessions", { method: "POST", body: { cwd: projDir, model, preset: "plain", settings: { context: { compaction: { model: "m-1", mode: "auto", ...compaction } } } } })).id);
  /** The turn's reply, its words, and its record. @param {string} id @param {string} content */
  const say = async (id, content) => {
    const res = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(res.status, 200, await res.clone().text());
    const reply = await res.json();
    const text = (reply.content || []).filter((/** @type {any} */ b) => b.type === "text").map((/** @type {any} */ b) => b.text).join("");
    return { reply, text, rec: await shim.record(String(res.headers.get("x-filament-request-id"))) };
  };
  /** Compact now. @param {string} id @param {any} body */
  const compact = (id, body) => shim.api(`${at(id)}/compact`, { method: "POST", body });
  /** The session's compaction rows. @param {string} id */
  const rows = (id) => /** @type {any} */ (shim.app.memory.archive).getCompactions(id);
  /** What the turn's composition said of the compaction and the agent. @param {any} rec */
  const composed = (rec) => (rec.changes || []).filter((/** @type {string} */ x) => /^compose: (agent|compaction):/.test(x));
  /** The sessions an agent was asked to compact, and what it was told. @param {string} id */
  const compacted = (id) => calls(id).filter((c) => c.method === "own compact");

  test("Compact now, the way own: the agent compacts its session itself, forked first, told nothing to keep; its row, its figures, Undo; the next message goes on in the compacted session and lets the fork go", async () => {
    const id = await open("own/fake-a");
    await say(id, "one");
    await say(id, "two");
    /** @type {any[]} */
    const said = [];
    const off = shim.app.events.subscribe("compactions", (/** @type {any} */ p) => p?.type === "compaction-progress" && p.chainId === id && said.push(p.progress));
    const res = await compact(id, { way: "own" });
    off();
    const done = await res.json();
    assert.equal(res.status, 200, JSON.stringify(done));
    // (fails before: yes — HarnessV4_Tasks U3-5: the agent compacting its own session outside a turn said nothing while
    // it ran; only Filament's own writing had a job) who compacts, that it is the agent's own, that it can be stopped
    assert.deepEqual([said[0]?.door, said[0]?.own, said[0]?.stoppable], ["manual", true, true], JSON.stringify(said));
    assert.ok(said.some((p) => /^\S.* compacts its own session$/.test(p?.step || "")), JSON.stringify(said));
    assert.equal(said.at(-1), null, "and its end");
    assert.deepEqual([done.compaction.method, done.compaction.kind, done.compaction.fromTurn, done.compaction.toTurn], ["own", "manual", 1, 2]);
    const { attached, ...detail } = done.compaction.detail;
    assert.deepEqual(detail, { before: 120_000, after: 18_000, exact: true, model: "own/fake-a", by: "own", how: "agent-own", ms: 31_000, forked: true });
    // (fails before: yes — the review of cb2d2d1f0: a summary handed over on request kept no block, so what starts from
    // the copy lost what a summary of Filament's brings back) Here, the reply that ended turn 2.
    assert.ok(attached?.hash && attached.tokens > 0, JSON.stringify(attached));
    assert.equal(done.note, "compaction: turns 1–2 compacted on request by the agent itself (own/fake-a), in its own session — 120,000 → 18,000 tokens; Filament's copy of the chat starts from its summary; a fork keeps the session from before, for Undo");
    // (fails before: yes — HarnessV4_Tasks C28: the row kept no summary, so Filament's copy kept every turn)
    assert.ok(done.compaction.chars > 0 && /^Kept: /.test(String(done.boundary.text || "")), JSON.stringify(done.boundary));
    assert.equal(done.boundary.undoable, true);
    const [session] = calls("own").filter((c) => c.method === "session/new").map((c) => c.sessionId);
    assert.deepEqual(compacted("own").map((c) => [c.sessionId, c.told]), [[session, ""]]);
    const ops = (await json("/api/ops?kinds=compaction&limit=20")).ops || [];
    const d = ops.find((/** @type {any} */ o) => o.detail?.chainId === id)?.detail || {};
    assert.deepEqual([d.how, d.method, d.trigger, d.forked, d.inputTokens, d.outputTokens, d.cacheReadTokens, d.cacheWriteTokens], ["agent-own", "own", "manual", true, 30, 900, 119_000, 0], "what it cost, as the agent counted it");
    const again = await compact(id, { way: "own" });
    assert.deepEqual([again.status, (await again.json()).error], [409, "nothing to compact: the agent compacted its own context after turn 2, and no turn has finished since"]);

    const fork = calls("own").find((c) => c.method === "session/fork")?.sessionId;
    const { text } = await say(id, "three");
    assert.deepEqual([prompts("own").at(-1)?.sessionId, prompts("own").at(-1)?.text], [session, `three\n\n${AFTER}`], "the compacted session");
    assert.match(text, echoAfter(2));
    await until(() => calls("own").some((c) => c.method === "session/delete" && c.sessionId === fork), "the fork deleted");
  });

  test("an undo of it before the next message brings the session from before back", async () => {
    const id = await open("own/fake-a");
    await say(id, "one");
    await say(id, "two");
    const known = new Set(calls("own").map((c) => c.sessionId));
    const done = await (await compact(id, { way: "own" })).json();
    const undone = await json(`${at(id)}/compactions/${done.compaction.id}/undo`, { method: "POST", body: {} });
    assert.equal(undone.undone?.method, "own", JSON.stringify(undone));
    const fork = calls("own").find((c) => c.method === "session/fork" && !known.has(c.sessionId))?.sessionId;
    const { text } = await say(id, "three");
    assert.equal(prompts("own").at(-1)?.sessionId, fork);
    assert.match(text, /\becho\(3\): three$/, "the session as it was before the compaction");
  });

  // (fails before: yes — the archive gave the undone compaction's id to the next one, so the chat stood on the session
  // the undo had let go, and the fork from before was deleted)
  test("an undo, then Compact now on Filament's copy before the next message: a fresh session from it, never the session the undo let go", async () => {
    const id = await open("own/fake-a");
    // Turns a summary makes smaller: Filament writes none that leaves the chat no smaller (HarnessV4_Tasks C30 item 7).
    const long = "the turn's words, long enough that a summary of them is shorter. ".repeat(20);
    await say(id, `one ${long}`);
    await say(id, `two ${long}`);
    const known = new Set(calls("own").map((c) => c.sessionId));
    const done = await (await compact(id, { way: "own" })).json();
    await json(`${at(id)}/compactions/${done.compaction.id}/undo`, { method: "POST", body: {} });
    const res = await compact(id, { way: "ours", method: "summary" });
    const ours = await res.json();
    assert.equal(res.status, 200, JSON.stringify(ours));
    assert.notEqual(ours.compaction.id, done.compaction.id, "an id is never given twice");
    await say(id, "three");
    const fresh = calls("own").filter((c) => c.method === "session/new" && !known.has(c.sessionId)).map((c) => c.sessionId);
    assert.equal(fresh.length, 1, "one fresh session");
    assert.equal(prompts("own").at(-1)?.sessionId, fresh[0], "the next message starts it, from Filament's compaction");
  });

  test("the plan's word on the session, which the page draws (AC5-8): the way Compact now takes and the ways the agent has, until when its cache is warm, what it holds against the line; after its own compaction, what it said it holds; after one of Filament's, nothing", async () => {
    const id = await open("own/fake-a");
    const preview = () => json(`${at(id)}/compose?dry=1&compaction=1`);
    assert.deepEqual((await preview()).compaction.agent, { chosen: "suggested", way: "ours", suggested: true, weighed: false, own: null, self: null, opens: false, share: null, warmUntil: 0, held: null, window: null, estimated: false, unsaid: false, over: false }, "before its first turn: nothing it holds, Filament's methods");
    await say(id, "one ~holds 1000");
    await say(id, "two ~holds 180000");
    const a = (await preview()).compaction.agent;
    // (the suggestion takes the agent's own compaction where it has one: HarnessV4_Tasks U3-6, decision 15 — it was Self)
    assert.deepEqual({ ...a, warmUntil: 0, share: null }, { chosen: "suggested", way: "own", suggested: true, weighed: true, own: "fork", self: "fork", opens: false, share: null, warmUntil: 0, held: 180_000, window: 200_000, estimated: false, unsaid: false, over: true });
    // (HarnessV4_Tasks C33) Its first turn began a session new to it: what it counted first (1,000), less the message.
    assert.ok(a.share > 900 && a.share < 1000, `its own share, ${a.share}`);
    // (fails before: yes — the plan called the cache cold five minutes after a turn, while the card that asks before a
    // send called the same cache warm for an hour)
    assert.ok(a.warmUntil > Date.now() + 59 * 60_000 && a.warmUntil <= Date.now() + 60 * 60_000, "warm for the hour a cache lasts at the most, from its turn's end: the clock the cold question asks by");
    const done = await (await compact(id, { way: "own" })).json();
    const after = await preview();
    assert.deepEqual([after.current.compactedSince, after.current.agentHeld], [true, { held: 18_000, window: 200_000 }], "the meter reads what it said it holds after");
    assert.deepEqual([after.compaction.agent.held, after.compaction.agent.over], [18_000, false]);
    await json(`${at(id)}/compactions/${done.compaction.id}/undo`, { method: "POST", body: {} });
    const sum = await compact(id, { method: "summary" });
    assert.equal(sum.status, 200, await sum.clone().text());
    const ours = await preview();
    assert.deepEqual([ours.current.agentHeld, ours.compaction.agent.weighed, ours.compaction.agent.way], [null, false, "ours"], "its next turn starts a fresh session from Filament's composition");
  });

  test("at the compaction line, the way own: no fork; the turn goes on in the session the agent compacted", async () => {
    const id = await open("own/fake-a", { agent: "own" });
    const known = new Set(calls("own").map((c) => c.sessionId));
    await say(id, "one ~holds 1000");
    await say(id, "two ~holds 180000");
    const { rec, text } = await say(id, "three");
    assert.deepEqual(composed(rec), [
      "compose: compaction: turns 1–2 compacted at the compaction line by the agent itself (own/fake-a), in its own session — 120,000 → 18,000 tokens; Filament's copy of the chat starts from its summary",
      "compose: agent: the agent's context holds 180,000 of its 200,000-token window, past the 170,000-token compaction line — the agent's own compaction (context.compaction.agent: own); this turn goes on in the session it compacted",
    ], (rec.changes || []).join("\n"));
    assert.deepEqual(calls("own").filter((c) => c.method === "session/fork" && !known.has(c.sessionId)), []);
    const [session] = calls("own").filter((c) => c.method === "session/new" && !known.has(c.sessionId)).map((c) => c.sessionId);
    assert.equal(prompts("own").at(-1)?.sessionId, session);
    assert.match(text, echoAfter(2));
    assert.deepEqual(rows(id).map((/** @type {any} */ r) => [r.method, r.kind, r.detail?.forked ?? false]), [["own", "plain", false]]);
  });

  // HarnessV4_Tasks U3-7 (UX-12). (fails before: yes — and that failure is the proof of today's inheritance: a fresh
  // agent session started from the composition under the session's view, `context.strategy`, which no page shows in
  // an agent's session — a preset or the global layer could fold that start unseen. A coding agent's own turns are
  // kept as text, which no view folds; the turns of Filament's loop, with their tool results, are what a view shapes.)
  test("a fresh agent session's start carries the earlier turns as the session chose (context.carry)", async () => {
    /** The seed an agent's fresh session gets after a turn of Filament's loop that read a file. @param {any} context */
    const seedOf = async (context) => {
      const made = await json("/api/sessions", { method: "POST", body: { cwd: projDir, model: "agent/m-1", preset: "plain", settings: { context: { compaction: { model: "m-1" }, ...context } } } });
      assert.ok(made.id, `the session: ${JSON.stringify(made).slice(0, 300)}`);
      const id = String(made.id);
      let n = 0;
      loopScript = () => (n++ === 0
        ? anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id: "t1", name: "read", input: { path: "README.md" } }], usage: { input_tokens: 5, output_tokens: 3 } })
        : anthropicReply("The readme says hello.", { model: "m-1", usage: { input_tokens: 5, output_tokens: 3 } }));
      try {
        await say(id, "read the readme");
      } finally {
        loopScript = null;
      }
      // Before the switch nothing is fresh; once the session's model is the agent, the preview says its agent holds
      // none of the chat (HarnessV4_Tasks U3-10), with what its start weighs; after its turn it has counted.
      const preview = async () => (await json(`${at(id)}/compose?dry=1&compaction=1`)).current;
      assert.equal((await preview()).freshStart, undefined, "Filament's loop holds the chat itself");
      const moved = await shim.api(`${at(id)}/settings`, { method: "PATCH", body: { patch: { model: { name: "plain/fake-a" } } } });
      assert.equal(moved.status, 200, await moved.clone().text());
      const fresh = await preview();
      assert.deepEqual(fresh.freshStart, { why: "switch" });
      assert.ok(fresh.whole > 0 && fresh.window > 0, JSON.stringify({ whole: fresh.whole, window: fresh.window }));
      const res = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content: "two", stream: false, settingsPatch: { model: { name: "plain/fake-a" } }, sendAsIs: true } });
      assert.equal(res.status, 200, `the switched turn: ${await res.clone().text()}`);
      assert.equal((await preview()).freshStart, undefined, "the agent answered: it holds the chat now");
      said = composed(await shim.record(String(res.headers.get("x-filament-request-id"))));
      return String(prompts("plain").at(-1)?.text || "");
    };
    /** What the switched turn's record says of its start. @type {string[]} */
    let said = [];
    // (fails before: yes — HarnessV4_Tasks C28: unless chosen the start was Whole, every turn with its tool output)
    const words = await seedOf({});
    // Said where the switch happens: the turn's own record names the form its fresh session carried — and, where the form
    // left a file's read out, that the file is handed over as it stands (the owner's of 11-08), as after a summary.
    const handed = /^compose: agent: the chat moved from m-1: its first prompt is handed what stands \(~\d+ tokens: 1 file\)$/;
    assert.equal(said[0], "compose: agent: another model answered last, so this turn starts a fresh agent session from Filament's copy of the chat, earlier turns carried as Words (context.carry)");
    assert.ok(said.length === 2 && handed.test(said[1]), said.join("\n"));
    assert.match(words, /read the readme[\s\S]*⚙ \[Filament left this turn's 1 tool call out: read — filament_recall\(\{ turn: \d+ \}\) brings its output back\][\s\S]*The readme says hello\./, "Words: the turn's words and its calls counted");
    const [carried, handover = ""] = words.split("[Filament handed these over");
    assert.ok(!/hello agent/.test(carried), "what the tool read stays out of the turn");
    assert.match(handover, /README\.md[\s\S]*hello agent/, "the file it read, handed over as it stands");
    const whole = await seedOf({ carry: "plain" });
    assert.deepEqual(said, ["compose: agent: another model answered last, so this turn starts a fresh agent session from Filament's copy of the chat, earlier turns carried as Whole (context.carry)"], "Whole: the turn shows its own read, and nothing is handed over");
    assert.match(whole, /read the readme[\s\S]*hello agent[\s\S]*The readme says hello\./, "chosen outright: Whole, the earlier turn with what its tool read");
    assert.ok(!whole.includes("[Filament handed these over"), whole.slice(-600));
    const folded = await seedOf({ carry: "fold" });
    assert.equal(said[0], "compose: agent: another model answered last, so this turn starts a fresh agent session from Filament's copy of the chat, earlier turns carried as Folded (context.carry)");
    assert.ok(said.length === 2 && handed.test(said[1]), said.join("\n"));
    assert.match(folded, /read the readme[\s\S]*\[Filament folded this turn: 1 tool call shown one line each[\s\S]*The readme says hello\./, "chosen outright: Folded");
    assert.ok(!/\[tool result:/.test(folded) && /\[tool result:/.test(whole), "the tool's result is a line of the fold, not a message of its own");
  });

  // (fails before: yes — HarnessV4_Tasks U3-6, decision 15: with nothing set the agent wrote Filament's summary (Self), and
  // the turn started a fresh agent session from it)
  test("at the compaction line with nothing set: the suggestion is the agent's own compaction, and the turn goes on in its session", async () => {
    const id = await open("own/fake-a");
    const known = new Set(calls("own").map((c) => c.sessionId));
    await say(id, "one ~holds 1000");
    await say(id, "two ~holds 180000");
    const { rec, text } = await say(id, "three");
    assert.deepEqual(composed(rec), [
      "compose: compaction: turns 1–2 compacted at the compaction line by the agent itself (own/fake-a), in its own session — 120,000 → 18,000 tokens; Filament's copy of the chat starts from its summary",
      "compose: agent: the agent's context holds 180,000 of its 200,000-token window, past the 170,000-token compaction line — suggested: the agent's own compaction; this turn goes on in the session it compacted",
    ], (rec.changes || []).join("\n"));
    const [session] = calls("own").filter((c) => c.method === "session/new" && !known.has(c.sessionId)).map((c) => c.sessionId);
    assert.equal(prompts("own").at(-1)?.sessionId, session, "no fresh session: the one it compacted");
    assert.match(text, echoAfter(2));
    assert.deepEqual(rows(id).map((/** @type {any} */ r) => [r.method, r.kind]), [["own", "plain"]]);
    // Compact now with nothing named takes it too, forked first for Undo.
    const other = await open("own/fake-a");
    await say(other, "one ~holds 1000");
    await say(other, "two ~holds 120000");
    const done = await (await compact(other, {})).json();
    assert.deepEqual([done.compaction.method, done.compaction.detail?.forked ?? false], ["own", true], JSON.stringify(done).slice(0, 300));
  });

  test("an own compaction that fails: at the line, Filament makes room on its copy and says why; Compact now naming the way says why too", async () => {
    const id = await open("ownfails/fake-a", { agent: "own" });
    await say(id, "one ~holds 1000");
    await say(id, "two ~holds 180000");
    const { rec } = await say(id, "three");
    assert.deepEqual(composed(rec), [
      "compose: compaction: turns 1–2 summarized at the compaction line by m-1; nothing learned from them now: memory is off: nothing learns",
      "compose: agent: the agent's context holds 180,000 of its 200,000-token window, past the 170,000-token compaction line — the agent's own compaction failed: Not enough messages to compact, so Filament made room on its copy instead; this turn starts a fresh agent session from the compaction",
    ], (rec.changes || []).join("\n"));
    await say(id, "four");
    const named = await compact(id, { way: "own" });
    assert.deepEqual([named.status, (await named.json()).error], [502, "the agent's own compaction failed: Not enough messages to compact"], "a way named for this once: no other");
    const chosen = await (await compact(id, {})).json();
    assert.match(chosen.note, /^compaction: turns 1–4 summarized on request by m-1.* — the agent's own compaction failed: Not enough messages to compact, so Filament made room on its copy instead$/, chosen.note);
  });

  test("a way the session cannot take now is refused, saying why", async () => {
    const plain = await open("plain/fake-a");
    await say(plain, "one");
    const own = await compact(plain, { way: "own" });
    assert.deepEqual([own.status, await own.json()], [409, { error: "the agent cannot compact this session its own way now: it has no compaction of its own that Filament can ask for, or holds no open session of this chat", lacks: "own" }]);
    const bad = await compact(plain, { way: "theirs" });
    assert.deepEqual([bad.status, (await bad.json()).error], [400, "way must be one of own, self, ours"]);
    const both = await compact(plain, { way: "own", method: "summary" });
    assert.deepEqual([both.status, (await both.json()).error], [400, "a method is Filament's, on its copy: name way ours with it, or no way"]);
    const api = String((await json("/api/sessions", { method: "POST", body: { cwd: projDir, model: "m-1", preset: "plain" } })).id);
    await say(api, "one");
    const notAgent = await compact(api, { way: "own" });
    assert.deepEqual([notAgent.status, (await notAgent.json()).error], [400, "way is for a coding agent's session"]);
  });

  test("/compact typed in the chat: the agent compacts its own context, told what to keep, listed with Undo; an agent with none says what the harness can do instead", async () => {
    const id = await open("own/fake-a");
    await say(id, "one");
    await say(id, "two");
    const { text } = await say(id, "/compact the plan");
    assert.equal(text, "✓ own compacted its context\n**Compacted.** own compacted its own context (turns 1–2) — 120.0k → 18.0k tokens, in 31.0s. Until your next message, Undo on its row in the conversation brings back the session from before it.", "its mark as the agent said it, then the answer");
    assert.equal(compacted("own").at(-1)?.told, "the plan");
    const [row] = rows(id);
    assert.deepEqual([row.method, row.kind, row.detail.forked], ["own", "manual", true]);
    const undone = await json(`${at(id)}/compactions/${row.id}/undo`, { method: "POST", body: {} });
    assert.equal(undone.undone?.id, row.id, "its own turn is no message past it");

    const plain = await open("plain/fake-a");
    await say(plain, "one");
    const none = await say(plain, "/compact");
    assert.match(none.text, /^plain has no compaction of its own that Filament can ask for now\. .* Compact now makes room on Filament's copy of the chat instead — your next message then starts a fresh session from it — or send `\/new` to start an empty one\.$/, none.text);
    assert.deepEqual(rows(plain), []);
  });

  // (fails before: yes — the record of a /compact the agent performed said "acp: chat command /compact answered by
  // Filament, agent not called", and so did the record of a refused one)
  test("/compact typed in the chat: its record says Filament asked the agent to compact, and of a refusal only that nothing was compacted", async () => {
    const id = await open("own/fake-a");
    await say(id, "one");
    await say(id, "two");
    /** @param {any} rec */
    const noted = (rec) => (rec.changes || []).filter((/** @type {string} */ x) => x.startsWith("acp: chat command"));
    const done = await say(id, "/compact");
    assert.match(done.text, /\*\*Compacted\.\*\* own compacted its own context/, done.text);
    assert.deepEqual(noted(done.rec), ["acp: chat command /compact answered by Filament, which asked own to compact its own context"], (done.rec.changes || []).join("\n"));
    const again = await say(id, "/compact");
    assert.equal(again.text, "**Not compacted:** nothing to compact: the agent compacted its own context after turn 2, and no turn has finished since.");
    assert.deepEqual(noted(again.rec), ["acp: chat command /compact answered by Filament: not compacted — nothing to compact: the agent compacted its own context after turn 2, and no turn has finished since"], (again.rec.changes || []).join("\n"));
  });

  test("Codex, typed /compact with words: it takes no instructions for its compaction, and the answer says so", async () => {
    const id = await open("cx/gpt-6-astra");
    await say(id, "one");
    await say(id, "two");
    const { text } = await say(id, "/compact the plan");
    assert.match(text, /^✓ Codex compacted its context\n\*\*Compacted\.\*\* Codex compacted its own context \(turns 1–2\) — at 912 tokens, in [\d.]+s\. Until your next message, Undo on its row in the conversation brings back the session from before it\. Codex takes no instructions for its compaction: what you asked it to keep was not passed on\.$/, text);
    const [row] = rows(id);
    assert.deepEqual([row.method, row.detail.before, row.detail.after, row.detail.forked, row.detail.untold], ["own", 912, undefined, true, true]);
  });

  // (fails before: yes — Codex names no figure after its compaction, so the agent was taken to hold 0 tokens: the
  // meter estimated a fresh session the agent never starts, and the instrument drew an empty bar)
  test("after Codex's own compaction, which names no figure after it: nothing counted until its next turn, never 0 held", async () => {
    const id = await open("cx/gpt-6-astra");
    await say(id, "one");
    await say(id, "two");
    const done = await compact(id, { way: "own" });
    assert.equal(done.status, 200, await done.clone().text());
    const after = await json(`${at(id)}/compose?dry=1&compaction=1`);
    const a = after.compaction.agent;
    assert.deepEqual([after.current.agentHeld, a.weighed, a.held, a.unsaid, a.over], [{ held: null, window: a.window }, true, null, true, false]);
    assert.ok(a.window > 0, "its window, as it named it");
    await say(id, "three");
    const next = (await json(`${at(id)}/compose?dry=1&compaction=1`)).compaction.agent;
    assert.deepEqual([next.unsaid, next.held > 0], [false, true], "its next turn counts again");
  });

  /** A first message long enough that a summary of its turn makes the copy smaller (a summary is guessed at 1,000 tokens or more). */
  const LONG_ONE = `one ${"word ".repeat(1500)}`.trim();

  // (fails before: yes — HarnessV4_Tasks C29: after Codex's own compaction Filament's copy kept every turn, whatever
  // it grew to)
  test("Codex compacts on Compact now and hands no summary over: Filament's model writes the copy's in the background, and the answer says so; Codex's row keeps its Undo, the copy's has none", async () => {
    const id = await open("cx/gpt-6-astra");
    await say(id, LONG_ONE);
    await say(id, "two");
    const res = await compact(id, { way: "own" });
    const done = await res.json();
    assert.equal(res.status, 200, JSON.stringify(done));
    assert.match(done.note, /^compaction: turns 1–2 compacted on request by the agent itself .*; m-1 now writes one for the copy, in the background$/);
    const [own, copy, ...more] = await until(async () => (rows(id).length > 1 ? rows(id) : null), "the copy's row");
    assert.deepEqual(more, []);
    assert.deepEqual([own.method, copy.method, copy.kind, copy.from_turn, copy.to_turn, copy.detail.copy, copy.detail.by, copy.detail.model], ["own", "summary", "plain", 1, 1, "agent", "Codex", "m-1"]);
    await until(async () => !(await json("/api/sessions/holders")).compacting.length, "the copy's summary over");
    const marks = (await json(`${at(id)}/transcript`)).boundaries.filter((/** @type {any} */ b) => b.type === "compaction").map((/** @type {any} */ b) => [b.method, b.afterTurn, b.undoable]);
    assert.deepEqual(marks.sort(), [["own", 2, true], ["summary", 1, false]]);
    // Codex's compaction taken back: its row goes, the copy's summary of turn 1 stays what the copy starts from.
    const undo = await shim.api(`${at(id)}/compactions/${own.id}/undo`, { method: "POST" });
    assert.equal(undo.status, 200, await undo.clone().text());
    assert.deepEqual(rows(id).map((/** @type {any} */ r) => [r.method, r.detail.copy]), [["summary", "agent"]]);
  });

  // (fails before: yes — the copy's summary was written whatever the turns weighed: on a live Codex session two
  // turns of ≈300 tokens became a summary of ≈900, at a model call)
  test("Codex compacts on Compact now over a copy of a few words: no summary is written for the copy, and the answer says why", async () => {
    const id = await open("cx/gpt-6-astra");
    await say(id, "one");
    await say(id, "two");
    const res = await compact(id, { way: "own" });
    const done = await res.json();
    assert.equal(res.status, 200, JSON.stringify(done));
    assert.match(done.note, /^compaction: turns 1–2 compacted on request by the agent itself .*so Filament's copy keeps the turns as they were.*; no summary is written for the copy yet: the turns it would stand for weigh ≈\d+ tokens there, no more than a summary would \(≈1,000\) — Filament writes the copy's summary once they weigh more$/);
    assert.deepEqual((await json("/api/sessions/holders")).compacting, []);
    assert.deepEqual(rows(id).map((/** @type {any} */ r) => r.method), ["own"]);
  });

  // (fails before: yes — the stop of Compact now, let go of as it ended, took the copy's with it: its row's Stop was
  // refused as if nothing were being written)
  test("the copy's summary after Compact now: it stops from its row, and an undo of Codex's compaction ends it — nothing is written either way", async () => {
    /** @type {(() => void)[]} */
    const letGo = [];
    loopScript = () => new Promise((done) => letGo.push(() => done(anthropicReply(SUMMARY, { model: "m-1", usage: { input_tokens: 10, output_tokens: 5 } }))));
    try {
      const writing = async (/** @type {string} */ id) => (await json("/api/sessions/holders")).compacting.filter((/** @type {any} */ c) => c.chainId === id).map((/** @type {any} */ c) => [c.progress.door, c.progress.stoppable]);
      // Stopped from its row.
      const a = await open("cx/gpt-6-astra");
      await say(a, LONG_ONE);
      await say(a, "two");
      assert.equal((await compact(a, { way: "own" })).status, 200);
      await until(() => letGo.length === 1, "the copy's summary asked for");
      assert.deepEqual(await writing(a), [["copy", true]]);
      const stopped = await shim.api(`${at(a)}/compact/stop`, { method: "POST" });
      assert.deepEqual([stopped.status, await stopped.json()], [200, { ok: true, copy: true }]);
      await until(async () => !(await writing(a)).length, "its end");
      assert.deepEqual(rows(a).map((/** @type {any} */ r) => r.method), ["own"]);
      // Codex's compaction undone while it writes.
      const b = await open("cx/gpt-6-astra");
      await say(b, LONG_ONE);
      await say(b, "two");
      assert.equal((await compact(b, { way: "own" })).status, 200);
      await until(() => letGo.length === 2, "the copy's summary asked for");
      const [own] = rows(b);
      const undo = await shim.api(`${at(b)}/compactions/${own.id}/undo`, { method: "POST" });
      assert.equal(undo.status, 200, await undo.clone().text());
      await until(async () => !(await writing(b)).length, "its end");
      assert.deepEqual(rows(b), []);
    } finally {
      for (const go of letGo) go();
      loopScript = null;
    }
  });

  test("a message sent while the agent compacts on Compact now waits for it, said as such, then goes to the compacted session", async () => {
    const id = await open("owngate/fake-a");
    await say(id, "one");
    await say(id, "two");
    const compacting = compact(id, { way: "own" });
    await until(() => compacted("owngate").length, "the agent compacting");
    const sending = say(id, "three");
    await until(async () => (await json(`${at(id)}/transcript?limit=1`)).live?.phase?.method === "own", "the message waiting, said as compacting");
    assert.equal(prompts("owngate").some((p) => p.text === "three"), false, "not sent meanwhile");
    writeFileSync(gate, "");
    assert.equal((await compacting).status, 200);
    const { text } = await sending;
    assert.match(text, echoAfter(2), "it went to the session the agent compacted");
    const [session] = calls("owngate").filter((c) => c.method === "session/new").map((c) => c.sessionId);
    assert.deepEqual(prompts("owngate").map((p) => [p.sessionId === session, p.text.startsWith("/compact") ? "/compact" : p.text]), [[true, "one"], [true, "two"], [true, "/compact"], [true, `three

${AFTER}`]]);
  });
});
