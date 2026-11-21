import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryEngine, sidecarEnv, writeMnemosyneConfig } from "../src/memory-engine.js";
import { engineState } from "../src/memory-install.js";
import { stallWords } from "../src/ui/lib/engine.js";
import { removeDirs, until } from "./helpers/wait.js";

const FAKE = fileURLToPath(new URL("./fixtures/fake-sidecar.mjs", import.meta.url));
const SIDECAR = fileURLToPath(new URL("../sidecar/mnemosyne_sidecar.py", import.meta.url));
const BUSY_SIDECAR = fileURLToPath(new URL("./fixtures/busy-sidecar.py", import.meta.url));
const MODEL_SIDECAR = fileURLToPath(new URL("./fixtures/model-sidecar.py", import.meta.url));
/** A test's stretch of time, given more on a busy machine as every wait is (`FILAMENT_TEST_WAIT_SCALE`). @param {number} ms */
const scaled = (ms) => ms * (Number(process.env.FILAMENT_TEST_WAIT_SCALE) > 0 ? Number(process.env.FILAMENT_TEST_WAIT_SCALE) : 1);
/**
 * The watch's stretches in the tests of a stall. The watch counts a start's hello as a call in flight, so a stall must
 * outlast the slowest start: a fake engine's spawn to its hello took up to 0.5 s on an idle machine and 4.3 s beside
 * several full suites, where 400 and 600 ms took each slow start for a stall. Its looks are a twelfth of it: the watch
 * forgives this process's own lags up to three looks, and shorter looks reset a stall's count at each lag of a busy
 * machine.
 */
const STALL_MS = scaled(6000);
const PING_MS = STALL_MS / 12;
/** A wait that holds once a stall, or the start after one, has come. */
const STALLED = { timeoutMs: 60_000 };
/**
 * Spawns as the engine does, counting the pings each process answered.
 * @returns {{ spawnImpl: any, answered: () => number }}
 */
const countingPings = () => {
  /** @type {Set<number>} */
  const asked = new Set();
  let n = 0;
  const spawnImpl = (/** @type {any[]} */ ...a) => {
    const child = /** @type {any} */ (childProcess.spawn)(...a);
    const write = child.stdin.write.bind(child.stdin);
    child.stdin.write = (/** @type {any} */ s, /** @type {any[]} */ ...rest) => {
      const id = /^\{"id":(\d+),"op":"ping"/.exec(String(s))?.[1];
      if (id) asked.add(Number(id));
      return write(s, ...rest);
    };
    let held = "";
    child.stdout.on("data", (/** @type {any} */ d) => {
      const lines = (held + String(d)).split("\n");
      held = /** @type {string} */ (lines.pop());
      for (const l of lines) if (asked.has(Number(/"id":\s*(\d+)/.exec(l)?.[1]))) n++;
    });
    return child;
  };
  return { spawnImpl, answered: () => n };
};
// Every engine a test starts is stopped after it, passed or failed: a failed assertion that skipped its own
// `stop()` left the sidecar alive, and its pipes held this file open until something killed it — under the full
// suite that was a hang, not a failure.
/** @type {Set<MemoryEngine>} */
const live = new Set();
afterEach(async () => {
  for (const e of live) await e.stop();
  live.clear();
});
const track = (/** @type {MemoryEngine} */ e) => (live.add(e), e);
const engine = (env = {}, opts = {}) => track(new MemoryEngine({ command: process.execPath, args: [FAKE], env, writeConfig: false, ...opts }));
/** @param {number} pid */
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("engine: hello, recall/remember round trip, canonical, stats, status", async () => {
  const e = engine();
  const hello = await e.ensure();
  assert.equal(hello.version, "fake-3.15.1"); assert.equal(e.status().state, "ready"); assert.ok(e.status().pid);
  const r1 = await e.remember({ content: "The user edits in VS Code and runs PowerShell", source: "environment", importance: 0.8 });
  assert.ok(r1.id);
  const dup = await e.remember({ content: "The user edits in VS Code and runs PowerShell" }); assert.equal(dup.deduped, true);
  await e.remember({ content: "Never restart Filament while a chat is flowing", source: "rule", importance: 0.9, pin: true });
  const hits = await e.recall("which editor does the user use", { topK: 5 });
  assert.equal(hits[0].id, r1.id); assert.ok(hits[0].score > 0); assert.equal(hits[0].tier, "working");
  const c = await e.canonicalSet({ category: "identity", name: "name", body: "Alice" }); assert.equal(c.status, "created");
  assert.equal((await e.canonicalSet({ category: "identity", name: "name", body: "Alice" })).status, "unchanged");
  assert.equal((await e.canonical({ category: "identity" })).length, 1);
  assert.equal((await e.stats()).total_memories, 2);
  assert.equal((await e.forget(r1.id)).ok, true); assert.equal((await e.recall("VS Code")).length, 0);
  await e.stop(); assert.equal(e.status().state, "stopped");
});

test("engine: concurrent quick calls and a long op in flight do not block each other", async () => {
  // Proved by order, not by a wall-clock window: under the full suite's load ten calls could take longer than 250 ms
  // and the check failed with nothing wrong. A blocked engine answers the quick calls only after the long op ends.
  const e = engine({ FAKE_SIDECAR_SLOW_MS: "1500" });
  await e.ensure();
  let longDone = false;
  const long = e.reindex().then((s) => ((longDone = true), s));
  const quick = await Promise.all(Array.from({ length: 10 }, (_, i) => e.remember({ content: `fact number ${i}` })));
  assert.equal(quick.length, 10);
  assert.equal(longDone, false, "every quick call was answered while the long op still ran");
  const s = await long; assert.equal(s.reindexed, 10);
  await e.stop();
});

// (fails before: yes — stop() cleared the child before its exit event, so a long op in flight was never answered:
// its ten-minute timer held the caller and kept the process alive — the hang the full suite showed)
test("engine: a call in flight when the engine stops is answered at once, not at its timeout", async () => {
  const e = engine({ FAKE_SIDECAR_SLOW_MS: "60000" });
  await e.ensure();
  const long = e.reindex();
  long.catch(() => {}); // answered while the stop waits for the process to end: read below
  const t0 = Date.now();
  await e.stop();
  const late = new Promise((_, no) => setTimeout(() => no(new Error("still unanswered 10 s after stop()")), 10_000).unref());
  await assert.rejects(Promise.race([long, late]), /memory engine stopped while reindex was in flight/);
  assert.ok(Date.now() - t0 < 10_000, "answered by the stop, not by the ten-minute timer");
  assert.equal(e.status().state, "stopped");
});

// (fails before: yes — a quick call had twenty seconds, 200 ms here (the old `quickMs`, kept as that condition; nothing
// reads it now): "did not answer get within 0 s", and the engine was killed and started again for being slow —
// HarnessV3-FailurePoints §4 B)
// (fails before: yes — the kill was not waited for, so a stop settled while the process still ran and held its files:
// the release's engine, installed over it at start, met a venv still in use)
test("engine: a stop settles once its process has ended, one that never acknowledges the shutdown as well", async () => {
  const e = engine({ FAKE_SIDECAR_HANG_ON: "shutdown" });
  await e.ensure();
  const pid = /** @type {number} */ (e.status().pid);
  await Promise.all([e.stop(), e.stop()]);
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, "its process is gone when the stop settles");
  assert.equal(e.status().state, "stopped");
});

// (fails before: yes — the bug hunt of 10-30, low: taskkill has no clock, and the stop waited on it for as long as it
// ran: one that never finished held the stop for ever, and with it what waits on the stop — memory's restore, an
// install over the engine, Filament's own exit)
test("engine: a stop whose taskkill never finishes ends the engine directly, and settles", { skip: process.platform !== "win32" && "taskkill is Windows'" }, async (t) => {
  /** @type {string[]} */
  const lines = [];
  const e = engine({ FAKE_SIDECAR_HANG_ON: "shutdown" }, { log: (/** @type {string} */ level, /** @type {string} */ msg) => lines.push(`${level} ${msg}`) });
  await e.ensure();
  const pid = Number(e.status().pid);
  const cp = /** @type {any} */ (childProcess);
  const real = cp.spawn;
  /** @type {EventEmitter[]} */
  const taskkills = [];
  cp.spawn = function (/** @type {any[]} */ ...args) {
    if (args[0] !== "taskkill") return real.apply(this, args);
    const k = new EventEmitter();
    taskkills.push(k);
    return k;
  };
  syncBuiltinESMExports();
  let settled = false;
  try {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    void e.stop().then(() => (settled = true));
    for (let i = 0; i < 100 && !settled; i++) {
      t.mock.timers.tick(250);
      await new Promise((r) => setImmediate(r));
    }
  } finally {
    t.mock.timers.reset();
    cp.spawn = real;
    syncBuiltinESMExports();
    // A stop that never settled is let go here, before the file's own stop waits on it: its taskkill answers, and the
    // engine goes.
    if (!settled) {
      for (const k of taskkills) k.emit("exit", 0);
      if (alive(pid)) process.kill(pid);
    }
  }
  assert.equal(taskkills.length, 1, "taskkill was started");
  assert.equal(settled, true, "the stop settled though taskkill never finished");
  await until(() => !alive(pid), "the engine to end");
  assert.ok(lines.includes(`warn memory engine ${pid}: taskkill did not finish in 5 s; killing the engine directly`), lines.join(" | "));
});

// (fails before: yes — the Hunter's find: an engine memory had dropped started again for whoever still held it, a turn
// begun before or the learner, and ran beside the one memory opened, over the files an install was replacing)
test("engine: a closed engine never starts again: its process ends, and every call after says it is closed", async () => {
  const e = engine();
  await e.ensure();
  const pid = /** @type {number} */ (e.status().pid);
  await e.close();
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  await assert.rejects(e.ensure(), /memory engine closed: memory has opened another/);
  await assert.rejects(e.recall("anything"), /memory engine closed/);
  assert.equal(e.status().pid, null, "no process was started for them");
});

test("engine: a call the engine is slow to answer is waited for, and nothing restarts the engine for it; its stop answers it", async (t) => {
  const e = engine({ FAKE_SIDECAR_HANG_ON: "get" }, { quickMs: 200, backoffMs: [10, 10, 10] });
  await e.ensure(); const pid = e.status().pid;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let settled = false;
  const slow = e.get("m1").finally(() => (settled = true));
  slow.catch(() => {});
  t.mock.timers.tick(21_000); // past the twenty seconds a quick call had
  assert.equal((await e.stats()).total_memories, 0, "the engine answers the next call meanwhile");
  assert.equal(settled, false, "no clock ended the slow one");
  assert.deepEqual([e.status().state, e.status().pid, e.status().failures], ["ready", pid, 0], "the same engine, never restarted");
  t.mock.timers.reset();
  await e.stop();
  await assert.rejects(slow, /memory engine stopped while get was in flight/);
});

// (fails before: yes — HarnessV4_Tasks U1; HarnessV3-FailurePoints §14.3: nothing restarted an engine but its own
// crash, so one that hung on a call held that call, and each turn waiting on it, for as long as it hung)
test("engine: the person restarts one they see hung — the hung call ends saying so, a new process answers, and no failure is counted", async () => {
  /** @type {string[]} */
  const subs = [];
  const e = engine({ FAKE_SIDECAR_HANG_ON: "get" }, { backoffMs: [60_000, 60_000, 60_000] });
  e.onOp = (/** @type {string} */ title, /** @type {any} */ o) => { subs.push(`${o.sub}${o.sub === "restart" ? `:${o.detail.cut}` : ""}`); };
  await e.ensure();
  const pid = e.status().pid;
  const hung = e.get("m1");
  hung.catch(() => {});
  await until(() => e.status().pending === 1, "the call to be in flight");
  const out = await e.restart();
  await assert.rejects(hung, /^Error: the memory engine was restarted while get was in flight$/);
  assert.deepEqual(out, { cut: 1, pid });
  const st = e.status();
  assert.deepEqual([st.state, st.failures, st.backoffUntil, st.lastError, !!st.pid && st.pid !== pid], ["ready", 0, null, null, true], "another process, at once, and no failure of the engine's");
  assert.equal((await e.stats()).total_memories, 0, "the new engine answers");
  assert.deepEqual(subs, ["spawn", "ready", "restart:1", "spawn", "ready"], "said in the engine's operations, as its other turns of life are");
  // One that is not running starts; one backing off after its own failure is tried again at once, and says why it
  // did not come back.
  const idle = engine();
  assert.deepEqual(await idle.restart(), { cut: 0, pid: null });
  assert.equal(idle.status().state, "ready");
  const dead = engine({ FAKE_SIDECAR_FAIL_HELLO: "1" }, { backoffMs: [60_000, 60_000, 60_000] });
  await assert.rejects(() => dead.ensure(), /hello failed/);
  await assert.rejects(() => dead.ensure(), /backing off after 1 failure/);
  await assert.rejects(() => dead.restart(), /hello failed/);
  assert.equal(dead.status().failures, 1, "the restart's own try, counted from none");
  // A call whose engine went between its start and its send says so, in words — it read "Cannot read properties of
  // null (reading 'stdin')".
  const gone = engine();
  await gone.ensure();
  const late = gone.stats();
  late.catch(() => {});
  const back = gone.restart();
  await assert.rejects(late, /^Error: the memory engine stopped before stats was sent$/);
  assert.deepEqual((await back).cut, 0);
});

// (fails before: yes — MEMR-8: nothing watched whether the engine still answered, so one that stalled held each call,
// and each turn waiting on one, for as long as it stayed stalled, and nothing said so)
test("engine: one that answers nothing, not even a ping, has stalled: logged once, restarted as the person's Restart does it, each call in flight ending in words", async () => {
  /** @type {string[]} */
  const lines = [];
  /** @type {string[]} */
  const subs = [];
  const stallMs = STALL_MS;
  const e = engine({ FAKE_SIDECAR_FREEZE_ON: "get" }, { pingMs: PING_MS, stallMs, log: (/** @type {string} */ level, /** @type {string} */ msg) => lines.push(`${level} ${msg}`) });
  e.onOp = (/** @type {string} */ _t, /** @type {any} */ o) => void subs.push(o.sub);
  await e.ensure();
  const pid = e.status().pid;
  const frozen = e.get("m1");
  let ended = false;
  frozen.then(() => (ended = true), () => (ended = true));
  await until(() => ended, "the call the stalled engine held to end", STALLED);
  await assert.rejects(frozen, /^Error: the memory engine stopped answering for \d+ s, not even to a ping, and was restarted while get was in flight$/);
  await until(() => e.status().state === "ready" && e.status().pid !== pid, "another process to answer", STALLED);
  const st = e.status();
  assert.deepEqual([st.failures, st.lastError, st.stalled?.calls, st.stalled?.ops, st.stalled?.pid, st.stalled?.count], [0, null, 1, ["get"], pid, 1], JSON.stringify(st.stalled));
  assert.ok(Number(st.stalled?.quietMs) >= stallMs, `stalled after ${st.stalled?.quietMs} ms of silence, not before ${stallMs}`);
  assert.equal((await e.stats()).total_memories, 0, "the new engine answers");
  assert.deepEqual(lines.filter((l) => /stopped answering/.test(l)).length, 1, `logged once: ${lines.join(" | ")}`);
  assert.deepEqual(subs.filter((s) => s === "stall" || s === "restart"), ["stall", "restart"], "recorded in the engine's operations");
  assert.match(String(stallWords(st.stalled)), /^At .+ the engine answered nothing for \d+ s, not even a ping, with a call \(get\) in flight: Filament restarted it, and that call ended with an error\.$/);
});

// (fails before: yes — an engine that stalled each time it started was restarted at each stall, for ever: no stall
// counted as a failure, so it never backed off and never ended degraded)
test("engine: one that stalls again soon after each restart counts failures and backs off, and ends degraded, left stopped in words until the person restarts it", async () => {
  /** @type {string[]} */
  const subs = [];
  const e = engine({ FAKE_SIDECAR_FREEZE_ON: "get" }, { pingMs: PING_MS, stallMs: STALL_MS, backoffMs: [10, 10, 10] });
  e.onOp = (/** @type {string} */ _t, /** @type {any} */ o) => void subs.push(o.sub);
  /** @type {string[]} */
  const ended = [];
  // Every process the engine starts stalls on its first get; a get refused while the engine backs off is asked again.
  for (let stalls = 0; stalls < 6 && !e.status().stalled?.out; ) {
    try {
      await e.get("m1");
    } catch (/** @type {any} */ err) {
      if (/backing off/.test(err.message)) {
        await new Promise((r) => setTimeout(r, 20));
        continue;
      }
      ended.push(err.message);
    }
    stalls++;
  }
  const st = e.status();
  assert.deepEqual([st.state, st.failures, st.pid, st.stalled?.run, st.stalled?.out, st.stalled?.count], ["degraded", 3, null, 4, true, 4], JSON.stringify(st));
  assert.equal(ended.length, 4, ended.join(" | "));
  assert.match(ended[0], /^the memory engine stopped answering for \d+ s, not even to a ping, and was restarted while get was in flight$/);
  for (const [i, said] of ended.slice(1).entries())
    assert.match(said, new RegExp(`^the memory engine stopped answering for \\d+ s, not even to a ping, again soon after it was restarted for that \\(${i + 2} stalls in a row\\), and was stopped while get was in flight$`));
  const leftWords = String.raw`stopped answering each time it was started \(4 stalls in a row, the last for \d+ s\), so Filament left it stopped: memory goes on without it until it is restarted`;
  assert.match(String(st.lastError), new RegExp(`^${leftWords}$`));
  const left = new RegExp(`^Error: the memory engine ${leftWords}$`);
  // Left stopped past its backoff: nothing but the person's restart starts it.
  await new Promise((r) => setTimeout(r, 50));
  await assert.rejects(() => e.ensure(), left);
  await assert.rejects(() => e.stats(), left);
  assert.deepEqual(subs.filter((s) => ["stall", "restart", "failed", "degraded"].includes(s)), ["stall", "restart", "stall", "failed", "stall", "failed", "stall", "degraded"], "recorded in the engine's operations");
  assert.match(String(stallWords(st.stalled)), /^At .+ the engine answered nothing for \d+ s, not even a ping, with a call \(get\) in flight, again soon after Filament restarted it for that \(4 stalls in a row\): Filament left it stopped, and that call ended with an error\. Memory goes on without it, on the archive alone, until you restart it\. It has stalled 4 times since Filament started\.$/);
  // The person's restart starts it, and its next stall is a first one again: restarted, no failure counted.
  await e.restart();
  assert.deepEqual([e.status().state, e.status().failures, e.status().stalled?.out], ["ready", 0, false]);
  assert.equal((await e.stats()).total_memories, 0, "the engine answers");
  const pid = e.status().pid;
  await assert.rejects(e.get("m1"), /and was restarted while get was in flight$/);
  await until(() => e.status().state === "ready" && e.status().pid !== pid, "another process to answer", STALLED);
  assert.deepEqual([e.status().failures, e.status().stalled?.run], [0, 1]);
});

// (fails before: no — a guard: an engine at work on a long call answers its pings, and none is taken as stalled)
test("engine: a call it works on for long is waited for: the engine answers its pings, and nothing restarts it", async () => {
  const { spawnImpl, answered } = countingPings();
  const stallMs = STALL_MS;
  const e = engine({ FAKE_SIDECAR_HANG_ON: "get" }, { pingMs: PING_MS, stallMs, spawnImpl });
  await e.ensure();
  const pid = e.status().pid;
  const slow = e.get("m1");
  slow.catch(() => {});
  // An engine that answers is pinged once it has been quiet a look, so about every second look: answering through
  // three times the stretch a stall takes, one that had answered none would have been restarted three times over.
  await until(() => answered() >= Math.ceil((3 * stallMs) / (2 * PING_MS)), "the engine to answer its pings through three times a stall's stretch", STALLED);
  assert.deepEqual([e.status().pid, e.status().state, e.status().stalled, e.status().pending], [pid, "ready", null, 1], "the same engine, never taken as stalled, the call still in flight");
  await e.stop();
  await assert.rejects(slow, /memory engine stopped while get was in flight/);
});

const PYTHON = process.env.FILAMENT_TEST_PYTHON || "python";
const python3 = (() => {
  try {
    const r = childProcess.spawnSync(PYTHON, ["-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
    return r.status === 0 && String(r.stdout).trim() === "3";
  } catch {
    return false;
  }
})();
// (fails before: yes — MEMR-8: the sidecar read stdin on the thread that runs quick calls, so a ping waited behind a
// long one, and the engine at work on it would have been taken as stalled)
test("the sidecar answers a ping while its main thread is at work on a quick call: a long call is never taken as stalled", { skip: !python3 && `no Python 3 as ${PYTHON}` }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-busy-sidecar-"));
  const done = join(dir, "done");
  const { spawnImpl, answered } = countingPings();
  const stallMs = scaled(1500);
  const e = track(new MemoryEngine({ command: PYTHON, args: [BUSY_SIDECAR, SIDECAR], env: { MNEMOSYNE_DATA_DIR: dir }, writeConfig: false, pingMs: 50, stallMs, spawnImpl }));
  try {
    await e.ensure();
    const pid = e.status().pid;
    const got = e.get(done);
    got.catch(() => {});
    await until(() => answered() >= Math.ceil((2 * stallMs) / 100), "the busy engine to answer its pings through twice a stall's stretch", { timeoutMs: 30_000 });
    assert.deepEqual([e.status().pid, e.status().stalled], [pid, null], "the same engine, never taken as stalled");
    writeFileSync(done, "");
    assert.deepEqual(await got, { id: done, content: "worked", metadata_json: null }, "the call it worked on answers");
  } finally {
    await e.stop();
    await removeDirs(dir);
  }
});

// (fails before: yes — the engine kept its embedding model, and what ONNX Runtime held after a batch, until its process
// ended: about 1 GB after a release's first start made its vectors again, where 620 MB serve, and that while unused)
test("the sidecar lets its embedding model go once the vectors are made again, and once no embed asked for it a while; the next embed loads it again", { skip: !python3 && `no Python 3 as ${PYTHON}` }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-model-sidecar-"));
  /** The stand-in's loads of its model so far, as an embed of `id` answers them. @param {any} e @param {string} id */
  const loads = async (e, id) => (await e.get(id)).content;
  /** @param {string} idleS */
  const engineFor = (idleS) => track(new MemoryEngine({ command: PYTHON, args: [MODEL_SIDECAR, SIDECAR], env: { MNEMOSYNE_DATA_DIR: dir, FILAMENT_EMBEDDING_IDLE_S: idleS }, writeConfig: false }));
  try {
    // Never idle: only the vectors' making lets it go.
    const e = engineFor("0");
    try {
      await e.ensure();
      assert.equal(await loads(e, "a"), "loads=1");
      assert.equal(await loads(e, "b"), "loads=1", "kept between embeds");
      await e.reindex();
      assert.equal(await loads(e, "c"), "loads=2", "let go once the vectors were made again, and loaded by the next embed");
      assert.ok(e.status().stderr.includes("info\tembedding model let go: the vectors were made again"), JSON.stringify(e.status().stderr));
    } finally {
      await e.stop();
    }
    const idle = engineFor(String(scaled(0.4)));
    try {
      await idle.ensure();
      assert.equal(await loads(idle, "a"), "loads=1");
      await until(() => idle.status().stderr.some((/** @type {string} */ l) => /^info\tembedding model let go: unused for [\d.]+ s$/.test(l)), "the model let go once unused", { timeoutMs: 30_000 });
      assert.equal(await loads(idle, "b"), "loads=2", "loaded again by the next embed");
    } finally {
      await idle.stop();
    }
  } finally {
    await removeDirs(dir);
  }
});

test("engine: a crash mid-call rejects pending calls, backs off, and becomes degraded after three failures", async () => {
  const e = engine({ FAKE_SIDECAR_FAIL_HELLO: "1" }, { backoffMs: [5, 5, 5] });
  for (let i = 1; i <= 3; i++) { await assert.rejects(() => e.ensure()); await new Promise((r) => setTimeout(r, 10)); }
  assert.equal(e.status().state, "degraded"); assert.equal(e.status().failures, 3);
  const e2 = engine({ FAKE_SIDECAR_CRASH_ON: "stats" }, { backoffMs: [50, 50, 50] });
  await e2.ensure();
  await assert.rejects(() => e2.stats(), /exited/);
  await assert.rejects(() => e2.recall("x"), /backing off/);
  await new Promise((r) => setTimeout(r, 70));
  assert.equal((await e2.recall("anything")).length, 0, "works again after the backoff");
  await e2.stop();
});

test("sidecarEnv and config.yaml: paths inside the folders, secrets only in the environment", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-engine-"));
  const env = sidecarEnv({ memoryFolder: join(dir, "memory"), engineDir: join(dir, "engine"), base: "http://127.0.0.1:20300", apiKey: "sk-secret-123", model: "claude-haiku-4-5", llmEnabled: true, embeddings: false, bank: "work" });
  assert.equal(env.MNEMOSYNE_DATA_DIR, join(dir, "memory", "mnemosyne"));
  assert.equal(env.MNEMOSYNE_FASTEMBED_CACHE_DIR, join(dir, "engine", "cache", "fastembed"));
  assert.equal(env.MNEMOSYNE_LLM_BASE_URL, "http://127.0.0.1:20300/memory-engine/v1"); assert.equal(env.MNEMOSYNE_LLM_API_KEY, "sk-secret-123");
  assert.equal(env.MNEMOSYNE_NO_EMBEDDINGS, "1"); assert.equal(env.MNEMOSYNE_CROSS_SESSION, "1"); assert.equal(env.MNEMOSYNE_WM_TTL_HOURS, "87600"); assert.equal(env.PYTHONUTF8, "1"); assert.equal(env.MNEMOSYNE_BANK, "work");
  writeMnemosyneConfig(join(dir, "memory"), env);
  const yaml = readFileSync(join(dir, "memory", "mnemosyne", "config.yaml"), "utf8");
  assert.ok(yaml.includes("data_dir:")); assert.ok(yaml.includes("llm_base_url: \"http://127.0.0.1:20300/memory-engine/v1\"")); assert.ok(yaml.includes("cross_session: 1"));
  assert.ok(!yaml.includes("sk-secret-123") && !yaml.includes("llm_api_key"), "no secret in config.yaml");
  assert.ok(yaml.includes("no_embeddings: true"));
  const on = sidecarEnv({ memoryFolder: dir, engineDir: dir, embeddings: true }); assert.equal(on.MNEMOSYNE_NO_EMBEDDINGS, undefined); assert.equal(on.MNEMOSYNE_LLM_ENABLED, "false"); assert.equal(on.MNEMOSYNE_LLM_BASE_URL, undefined);
  rmSync(dir, { recursive: true, force: true });
});

// Real sidecar, only when a Python with mnemosyne is available (the managed engine or FILAMENT_MEMORY_PYTHON).
// Its first remember loads the embedding model: about 13 s alone and past the engine's 20 s quick limit under a full
// parallel suite, so every call gets two minutes here, as the hello does. The model comes from the managed engine's
// cache when it holds one: a fresh cache downloads it, and a download that stalls fails the test for the network's
// sake (the install's warm-up is what proves the download).
// The managed engine counts only when its install finished (HarnessV3-AtHome AH-D2), as the service has it.
const managed = engineState(join(process.env.APPDATA || tmpdir(), "filament"));
const managedEngine = managed.dir;
const realPython = process.env.FILAMENT_MEMORY_PYTHON || (managed.installed ? managed.venvPython : null);
const modelCache = process.env.MNEMOSYNE_FASTEMBED_CACHE_DIR || [join(managedEngine, "cache", "fastembed")].find((d) => existsSync(d));
test("engine: real Mnemosyne sidecar round trip", { skip: !realPython || !existsSync(realPython) ? "no Python with mnemosyne" : false }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-real-engine-"));
  const env = sidecarEnv({ memoryFolder: join(dir, "memory"), engineDir: join(dir, "engine"), embeddings: process.env.FILAMENT_MEMORY_EMBEDDINGS !== "0" });
  if (modelCache) env.MNEMOSYNE_FASTEMBED_CACHE_DIR = modelCache;
  const e = track(new MemoryEngine({ command: realPython, args: [SIDECAR], env, memoryFolder: join(dir, "memory") }));
  try {
    const hello = await e.ensure();
    assert.ok(hello.version); assert.ok(hello.dbPath.includes("mnemosyne"));
    const r = await e.remember({ content: "The user's startup received free xAI credits for grok-4.6 via the Responses API.", source: "fact", importance: 0.8, memoryType: "fact", metadata: { kind: "fact", via: "test" }, pin: true }); // memoryType is dropped on releases whose remember() lacks it
    assert.ok(r.id);
    const hits = await e.recall("grok credits", { topK: 5 }); assert.ok(hits.length >= 1); assert.equal(hits[0].id, r.id);
    const c = await e.canonicalSet({ category: "identity", name: "name", body: "Alice" }); assert.ok(["created", "unchanged", "updated"].includes(c.status));
    assert.equal((await e.canonical({ category: "identity" }))[0].name, "name");
    const st = await e.stats(); assert.ok(st.stats?.total_memories >= 0 || st.total_memories >= 0 || st.beam);
  } finally {
    // A failed call leaves no folder either. The engine goes first: Windows holds its db until the process exits.
    await e.stop();
    await removeDirs(dir);
  }
});

/**
 * A real sidecar on a folder of its own, embeddings off (the bug report's X2 is SQLite's, not the model's), its
 * script `args`; `run` gets it started, and it is stopped and its folder gone after.
 * @param {string[]} args @param {(e: MemoryEngine) => Promise<void>} run
 */
async function withRealEngine(args, run) {
  const dir = mkdtempSync(join(tmpdir(), "filament-real-engine-"));
  const env = sidecarEnv({ memoryFolder: join(dir, "memory"), engineDir: join(dir, "engine"), embeddings: false });
  const e = track(new MemoryEngine({ command: /** @type {string} */ (realPython), args, env, memoryFolder: join(dir, "memory") }));
  try {
    await e.ensure();
    await run(e);
  } finally {
    await e.stop();
    await removeDirs(dir);
  }
}
const noRealEngine = !realPython || !existsSync(realPython) ? "no Python with mnemosyne" : false;
/** What the sidecar said of a transaction a request left open. @param {MemoryEngine} e */
const leftOpen = (e) => e.stderrTail.filter((l) => /left a transaction open/.test(l));

// (fails before: yes — a remember that sent `valid` and changed no row left its UPDATE's transaction open on
// Mnemosyne's legacy connection: the next write waited out the 5 s busy timeout and failed, "database is locked")
test("engine: every write of the sidecar's own ends its transaction, so the next write goes through (the bug report's X2)", { skip: noRealEngine }, async () => {
  await withRealEngine([SIDECAR], async (e) => {
    const first = await e.remember({ content: "The deploy runs on Fridays.", source: "fact", valid: true });
    assert.ok(first.id && !first.revived, JSON.stringify(first));
    const t0 = Date.now();
    assert.ok((await e.remember({ content: "The staging database is Postgres 16.", source: "fact" })).id, "the next write went through");
    assert.ok(Date.now() - t0 < 4000, "without waiting out the busy timeout");
    const slept = await e.remember({ content: "A summary the engine wrote while it slept.", source: "sleep_summary" });
    await e.pin(first.id, false);
    await e.restore("no-such-memory");
    assert.deepEqual((await e.fence()).working, [slept.id]);
    assert.ok((await e.remember({ content: "The release train leaves at noon.", source: "fact" })).id);
    assert.deepEqual(leftOpen(e), [], "none of them left one open");
  });
});

// (fails before: yes — nothing ended a transaction the engine left open: every later write failed, "database is
// locked")
test("engine: a transaction Mnemosyne leaves open is logged and ended with its request, kept when it succeeded and undone when it failed, so it can't wedge the engine (X2)", { skip: noRealEngine }, async () => {
  await withRealEngine([fileURLToPath(new URL("./fixtures/leaky-sidecar.py", import.meta.url)), SIDECAR], async (e) => {
    const { id } = await e.remember({ content: "The deploy runs on Fridays.", source: "fact", importance: 0.6 });
    await e.stats();
    const t0 = Date.now();
    assert.ok((await e.remember({ content: "Written after the leak.", source: "fact" })).id);
    assert.ok(Date.now() - t0 < 4000, "without waiting out the busy timeout");
    assert.equal((await e.get(id)).importance, 0.99, "a request that succeeded keeps what it wrote");
    await assert.rejects(e.hygiene(), /planted/);
    assert.ok((await e.remember({ content: "Written after the failed one.", source: "fact" })).id);
    assert.equal((await e.get(id)).importance, 0.99, "one that failed has what it wrote undone");
    await e.diagnose();
    assert.ok((await e.remember({ content: "Written after the long one.", source: "fact" })).id);
    assert.deepEqual(leftOpen(e), [
      "warn\tstats left a transaction open on the engine's connection; it was committed",
      "warn\thygiene_audit left a transaction open on the engine's connection; it was rolled back",
      "warn\tdiagnose left a transaction open on the engine's connection; it was committed",
    ]);
  });
});

// (fails before: yes — HarnessV4_Tasks C15: the failure was told at the engine's exit, and what it wrote as it died
// reaches the client after that: "hello failed: memory engine exited (1)" and no word of why)
test("an engine that dies as it starts: the failure carries what it wrote as it died, read after its exit", async () => {
  /** @type {string[]} */
  const logged = [];
  const spawnImpl = () => {
    const child = Object.assign(new EventEmitter(), { pid: 4242, exitCode: /** @type {number | null} */ (null), signalCode: null, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
    setImmediate(() => {
      child.exitCode = 1;
      child.emit("exit", 1, null);
      // Its stderr comes after the exit, as a pipe's last bytes do.
      setTimeout(() => child.stderr.end("Traceback (most recent call last):\n  File \"mnemosyne_sidecar.py\", line 12\nRuntimeError: sqlite-vec is missing\n"), 20);
    });
    return child;
  };
  const e = track(new MemoryEngine({ command: "python", args: [], writeConfig: false, spawnImpl: /** @type {any} */ (spawnImpl), log: (/** @type {string} */ level, /** @type {string} */ m) => logged.push(`${level} ${m}`) }));
  await assert.rejects(() => e.ensure(), /^Error: hello failed: memory engine exited \(1\) \(Traceback \(most recent call last\): \|   File "mnemosyne_sidecar\.py", line 12 \| RuntimeError: sqlite-vec is missing\)$/);
  assert.ok(logged.some((l) => l.startsWith("warn memory engine stderr: Traceback")), logged.join("\n"));
  assert.equal(e.status().lastError, "hello failed: memory engine exited (1)", "the engine's own line stays words only: no traceback in the durable record");
});

// (fails before: yes — HarnessV4_Tasks C15: a fault of the fake's own ended it with Node's exit 1, the code a process
// ended from outside shows on Windows, and a flake that read "the fake memory engine exited 1" could not say which)
test("the fake engine's own fault ends it with its own code and its words: an exit 1 is never its doing", async () => {
  const e = engine({ FAKE_SIDECAR_THROW_ON: "hello" }, { backoffMs: [60_000] });
  await assert.rejects(() => e.ensure(), (/** @type {any} */ err) => /hello failed: memory engine exited \(9\)/.test(err.message) && /critical\tfake sidecar died: Error: thrown on hello/.test(err.message));
});

// (fails before: yes — the hunt of 10-28: every replacement at start stops an engine still saying hello, and each stop
// was counted and recorded as the engine's own failure, "hello failed: memory engine stopped while hello was in flight")
test("engine: one closed while it starts is no failure of its own: nothing counted or recorded, and its start says it was stopped", async () => {
  const e = engine({ FAKE_SIDECAR_HELLO_DELAY_MS: "3000" });
  /** @type {string[]} */
  const subs = [];
  e.onOp = (/** @type {string} */ _t, /** @type {any} */ o) => void subs.push(o.sub);
  const starting = e.ensure();
  starting.catch(() => {});
  for (let i = 0; i < 200 && !e.status().pid; i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(e.status().pid, "its process started");
  await e.close();
  await assert.rejects(starting, (/** @type {any} */ err) => err.stopped === true && /^memory engine stopped before it was ready$/.test(err.message));
  assert.deepEqual([e.status().failures, e.status().lastError], [0, null]);
  assert.deepEqual(subs.filter((s) => s === "failed" || s === "degraded"), []);
});
