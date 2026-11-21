// @ts-check
// What memory makes a turn wait on is said while it lasts, and the person may send the turn without it
// (HarnessV3-FailurePoints §5.1 item 3): its lookups are let go, and the turn is archived as ever. A turn waits on memory for `MEMORY_WAIT_MS` in all, then goes on without it, saying so; an engine that
// stopped answering, not even a ping, is restarted, and memory's status says so in words (MEMR-8).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryService } from "../src/memory-service.js";
import { MemoryEngine } from "../src/memory-engine.js";
import * as brain from "../src/services/memory/brain.js";
import { SessionTurns } from "../src/services/session-turns.js";
import { memoryPrepare } from "../src/app/pipeline/stages/memory-prepare.js";
import { runMemoryTools } from "../src/app/memory-tools.js";
import { durationWords } from "../src/core/text.js";
import { stallWords } from "../src/ui/lib/engine.js";
import { gate, removeDirs, until } from "./helpers/wait.js";

const FAKE = fileURLToPath(new URL("./fixtures/fake-sidecar.mjs", import.meta.url));
const CC_UA = { "user-agent": "claude-cli/2.1.258 (external, cli)" };
/** @param {string} cwd */
const sys = (cwd) => `You are Claude Code.\n<env>\nWorking directory: ${cwd}\nIs a git repo: yes\n</env>`;
/** A Claude Code request whose newest message is the last of `texts`. @param {string[]} texts @param {string} cwd */
const req = (texts, cwd) => {
  /** @type {any[]} */
  const messages = [];
  texts.forEach((t, i) => {
    messages.push({ role: "user", content: t });
    if (i < texts.length - 1) messages.push({ role: "assistant", content: `ok ${i}` });
  });
  return { format: "anthropic", body: { model: "claude-x", max_tokens: 100, system: sys(cwd), messages }, headers: CC_UA, model: "claude-x" };
};
/** A turn's `waiting`, read by the test: each wait's kind as it begins and ends, and a way to let the newest go. */
const watched = () => {
  /** @type {string[]} */
  const said = [];
  /** @type {AbortController | null} */
  let current = null;
  /** @type {import("../src/services/memory/brain.js").MemoryWaiting} */
  const waiting = ({ kind }) => {
    const ctl = new AbortController();
    current = ctl;
    said.push(kind);
    return { signal: ctl.signal, end: () => said.push(`end ${kind}`) };
  };
  return { said, waiting, letGo: () => /** @type {AbortController | null} */ (current)?.abort() };
};
/**
 * What `p` resolves with, once it has: a turn that never goes on fails at the wait's deadline, saying so.
 * @template T @param {Promise<T>} p @param {string} what @param {{ timeoutMs?: number }} [o]  the wait's deadline, `until`'s
 * @returns {Promise<T>}
 */
const settled = async (p, what, o) => {
  /** @type {{ value: T } | null} */
  let got = null;
  p.then((value) => (got = { value }));
  await until(() => got, what, o);
  return /** @type {{ value: T }} */ (/** @type {unknown} */ (got)).value;
};

describe("memory's waits on a turn's path", () => {
  /** @type {string} */ let dir;
  /** @type {any} */ let hung;
  /** @type {any} */ let quick;
  /** @type {any[]} */
  const services = [];
  /**
   * A memory service on the fake engine. @param {string} name @param {Record<string, string>} env
   * @param {{ pingMs?: number, stallMs?: number }} [watch]  the engine's watch, shorter than a real one's
   */
  const serviceOn = (name, env, watch = {}) => {
    const cfg = {
      server: { port: 20399, inboundKeys: ["k"] },
      memory: {
        enabled: true,
        folder: join(dir, name),
        engine: { embeddings: true, bank: "default" },
        autopilot: { enabled: true, mode: "conservative", briefingTokens: 1200, turnTokens: 300, minScore: 0.2, tools: true, cue: true },
        capture: { turns: true, learn: true },
        commands: { enabled: true, prefix: "@mem" },
        privacy: { encryptArchive: false },
        models: { summarizer: "auto" },
      },
    };
    const svc = /** @type {any} */ (new MemoryService(/** @type {any} */ ({ getConfig: () => cfg, dataDir: dir, log: () => {}, selfBase: () => "http://127.0.0.1:20399" })));
    svc.start();
    svc.store = new MemoryEngine(/** @type {any} */ ({ command: process.execPath, args: [FAKE], env, writeConfig: false, ...watch }));
    svc.brain.store = svc.store;
    services.push(svc);
    return svc;
  };
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-memory-waits-"));
    hung = serviceOn("hung", { FAKE_SIDECAR_HANG_ON: "recall" });
    quick = serviceOn("quick", {});
  });
  after(async () => {
    for (const s of services) {
      await s.store.stop();
      s.stop();
    }
    await removeDirs(dir);
  });

  // (fails before: yes — a lookup the engine was slow to answer held the turn until memory's clock gave up, and nothing
  // said it or let it go)
  test("a lookup the engine is slow to answer is said, and let go: the turn goes on without memory, archived", async () => {
    const w = watched();
    const sit = hung.situate(req(["the tray keeps restarting Filament twice again, like last time"], join(dir, "p1")));
    const prepping = hung.prepare(sit, { requestId: "w1", upstream: "anthropic", waiting: w.waiting });
    await until(() => w.said.includes("recalling"), "memory to say it recalls");
    w.letGo();
    const prep = await prepping;
    assert.deepEqual(w.said, ["recalling", "end recalling"], "one wait: once let go, no other lookup starts");
    for (const n of ["memory: the briefing was let go — the turn was sent without it", "memory: related memory was let go — the turn was sent without it"])
      assert.ok(prep.notes.includes(n), `${n}\n— in —\n${prep.notes.join("\n")}`);
    assert.equal(prep.turnN, 1, "the turn is archived as ever");
    assert.equal(hung.archive.getChain(prep.chain).meta?.briefingTries, undefined, "a briefing let go is no try");
  });

  // (fails before: yes — nothing said what memory made the turn wait on)
  test("waits the engine answers end on their own, each said while it lasted", async () => {
    const w = watched();
    const sit = quick.situate(req(["the tray keeps restarting Filament twice again, like last time"], join(dir, "p2")));
    const prep = await quick.prepare(sit, { requestId: "q1", upstream: "anthropic", waiting: w.waiting });
    // Memory's lookups alone: no turn waits on a capture, nothing being filed from a message by its words (the memory
    // plan's d3).
    assert.deepEqual([w.said.slice(0, 2), w.said.filter((s) => !/recalling$/.test(s))], [["recalling", "end recalling"], []], w.said.join(", "));
    assert.equal(w.said.filter((s) => s.startsWith("end ")).length * 2, w.said.length, "every wait ended");
    assert.ok(!prep.notes.some((/** @type {string} */ n) => /let go|unwaited/.test(n)), prep.notes.join("\n"));
  });

  // (fails before: yes — MEMR-8: a turn waited on memory with no clock: an engine that stopped answering held it for as
  // long as it did, and a turn with no lock to say the wait on had nothing to let it go)
  test("a turn waits on memory as long as a turn waits, then goes on without it: said, archived", async () => {
    const was = hung.brain.waitMs;
    hung.brain.waitMs = 300;
    try {
      const went = `memory took longer than ${durationWords(300)}, and the turn went on without it`;
      const w = watched();
      const prep = await settled(hung.prepare(hung.situate(req(["the tray keeps restarting Filament three times now, like before"], join(dir, "p4"))), { requestId: "w4", upstream: "anthropic", waiting: w.waiting }), "the turn to go on without memory");
      for (const n of [`memory: the briefing was let go — ${went}`, `memory: related memory was let go — ${went}`])
        assert.ok(prep.notes.includes(n), `${n}\n— in —\n${prep.notes.join("\n")}`);
      assert.deepEqual(w.said, ["recalling", "end recalling"], "one wait, ended by the clock; no other lookup started");
      assert.equal(prep.turnN, 1, "the turn is archived as ever");
      assert.equal(hung.archive.getChain(prep.chain).meta?.briefingTries, undefined, "a briefing let go is no try");
      // A turn with no lock to say its wait on (an outside client's leg, a dry run): the clock lets it go all the same.
      const bare = await settled(hung.prepare(hung.situate(req(["the tray keeps restarting Filament four times now, like before"], join(dir, "p5"))), { requestId: "w5", upstream: "anthropic" }), "a turn with no lock to go on without memory");
      assert.ok(bare.notes.includes(`memory: the briefing was let go — ${went}`), bare.notes.join("\n"));
    } finally {
      hung.brain.waitMs = was;
    }
    assert.deepEqual([was, brain.MEMORY_WAIT_MS], [60_000, 60_000], "a turn waits a minute in all");
  });

  // (fails before: yes — a memory tool call waited on the engine with no clock: a search the engine did not answer held
  // the model's turn for as long as it did not)
  test("a memory tool call waits as long as a turn waits on memory: past it, its result says so and the turn goes on, the engine's call unwaited", async () => {
    await hung.store.ensure();
    const was = hung.brain.waitMs;
    hung.brain.waitMs = 300;
    try {
      const scope = hung.scope({ role: "model", project: null, chain: null, client: "claude-code" });
      const before = hung.store.status().pending;
      const calls = [
        { id: "c1", name: "filament_memory_search", input: { query: "the tray keeps restarting" } },
        { id: "c2", name: "filament_memory_sessions", input: { query: "" } },
      ];
      const results = await settled(runMemoryTools(calls, { scope, trace: null }), "the model's memory calls to be answered");
      assert.deepEqual(JSON.parse(results[0].output), {
        error: `memory took longer than ${durationWords(300)} to answer, so the turn goes on without this call's result; the call goes on unwaited, and what it writes may still be written`,
      });
      assert.ok(results[0].ms >= 300 && results[0].ms < 5_000, `answered at the clock: ${results[0].ms} ms`);
      assert.deepEqual(Object.keys(JSON.parse(results[1].output)), ["sessions"], "a call memory answers in time is answered as ever");
      assert.equal(hung.store.status().pending, before + 1, "the engine's recall goes on, unwaited");
    } finally {
      hung.brain.waitMs = was;
    }
  });

  // (fails before: yes — MEMR-8: an engine that stopped answering stayed "ready", each turn waited on it again, and
  // memory's status said nothing)
  test("an engine that stops answering is restarted, and stopped when it stops again soon after: the turn waiting on its recalls goes on, and memory's status says what happened, in words", async () => {
    const scale = Number(process.env.FILAMENT_TEST_WAIT_SCALE) > 0 ? Number(process.env.FILAMENT_TEST_WAIT_SCALE) : 1;
    // The watch's stretches as memory-engine.test.js gives them: the watch counts a start's hello as a call in flight,
    // and a fake engine's start took up to 4.3 s beside several full suites, where 500 ms took a slow start — the
    // restart's above all — for a stall. Its looks are a twelfth of it: the watch forgives this process's own lags up to
    // three looks.
    const stallMs = 6000 * scale;
    const frozen = serviceOn("frozen", { FAKE_SIDECAR_FREEZE_ON: "recall" }, { pingMs: stallMs / 12, stallMs });
    const prep = await settled(frozen.prepare(frozen.situate(req(["the tray keeps restarting Filament five times now, like before"], join(dir, "p6"))), { requestId: "f1", upstream: "anthropic" }), "the turn to go on", { timeoutMs: 60_000 });
    assert.ok(!prep.notes.some((/** @type {string} */ n) => /let go|unwaited/.test(n)), `the restart and the stop freed the turn, not its clock: ${prep.notes.join("\n")}`);
    assert.equal(prep.turnN, 1, "the turn is archived as ever");
    const st = await frozen.status();
    const s = st.engine.stalled;
    // This engine stops answering at every recall: the turn's first recall ends with the restart, and its next with the
    // stop, as the restarted engine stalled again.
    assert.ok(s && s.count === 2 && s.run === 2 && s.out === false && s.ops.includes("recall") && s.quietMs >= stallMs, JSON.stringify(st.engine));
    assert.match(String(stallWords(s)), /^At .+ the engine answered nothing for \d+ s, not even a ping, with a call \(recall\) in flight, again soon after Filament restarted it for that \(2 stalls in a row\): Filament stopped it and counted a failure, to start it again after a pause, and that call ended with an error\. It has stalled 2 times since Filament started\.$/);
    assert.deepEqual(frozen.engineLive().stalled, s, "the Live tab's engine panel reads the same");
  });
});

// (fails before: yes — the session's lock had no way to say a memory wait, nor to let one go)
test("the session's lock says a memory wait while it lasts and lets it go once; a token that does not hold it waits unseen", async () => {
  const turns = new SessionTurns({});
  const got = await turns.acquire("k1", { window: "harness", client: "harness" });
  const w = turns.waiting("k1", String(got.token))({ kind: "recalling" });
  const phase = turns.holder("k1")?.phase;
  assert.deepEqual(phase && { kind: phase.kind, method: phase.method, skippable: phase.skippable }, { kind: "recalling", method: null, skippable: true });
  assert.equal(turns.sendWithout("k1"), true);
  assert.equal(w.signal.aborted, true);
  assert.equal(turns.sendWithout("k1"), false, "once");
  w.end();
  assert.equal(turns.holder("k1")?.phase, null);
  const stranger = turns.waiting("k1", "not-its-token")({ kind: "recalling" });
  assert.equal(turns.holder("k1")?.phase, null, "unseen");
  assert.equal(turns.sendWithout("k1"), false, "nothing lets it go");
  stranger.end();
});

// (fails before: no — a guard: a harness turn's memory waits are said on the lock the sessions service took, `pre.lock`,
// the one lock a request carries)
test("a harness turn says memory's waits on its own lock", async () => {
  const turns = new SessionTurns({});
  const got = await turns.acquire("k2", { window: "harness", client: "harness" });
  /** @type {string | null} */
  let seen = null;
  const memory = {
    prepare: async (/** @type {any} */ _sit, /** @type {any} */ o) => {
      const w = o.waiting({ kind: "recalling" });
      seen = turns.holder("k2")?.phase?.kind ?? null;
      w.end();
      return null;
    },
  };
  const ctx = /** @type {any} */ ({
    format: "anthropic",
    body: { model: "m", max_tokens: 10, messages: [{ role: "user", content: "hi" }] },
    pre: { lock: { turns, key: "k2", token: got.token } },
    rec: { id: "r1" },
    candidates: [],
    route: null,
    requested: { base: "m" },
    memory: { sit: { key: "k2" }, trace: null },
    flags: {},
    agent: null,
  });
  const deps = /** @type {any} */ ({ config: () => ({ upstreams: [] }), memory, destination: () => null, usage: null, toolsRefused: new Map(), teams: null });
  assert.equal(await memoryPrepare(ctx, deps), "continue");
  assert.equal(seen, "recalling");
  assert.equal(turns.holder("k2")?.phase, null);
});
