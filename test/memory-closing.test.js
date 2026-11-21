// @ts-check
// Memory closing ends its own work in flight, cleanly (HarnessV3-Memory M7-D70). At the live leg's third run's close,
// Filament stopped while a curator pass waited on its model: the pass's next write found the database closed ("the pass
// over … failed: database is not open"), its run stayed open with no call counted, and the call went on, paid for,
// with nowhere to file its answer. The same befalls a learning run, and either one when a setting reopens memory.
// A Filament killed mid-pass closes nothing: its pass is ended when memory next opens (HarnessV3-Readiness RD1 e).
import { test } from "node:test";
import assert from "node:assert/strict";
import { hostname } from "node:os";
import { world } from "./fixtures/memory-world.mjs";
import { KEY_PROMPT, PASS_OWNER, ownerGone } from "../src/services/memory/curator.js";

/**
 * A model that never answers: each call is kept, and fails once its stop is heard. A call with no stop of its own fails
 * by itself after three seconds, so a pass or a run that cannot be cut ends (and its test fails) rather than hanging.
 */
function waiting() {
  /** @type {any[]} */
  const calls = [];
  let wake = () => {};
  const fn = (/** @type {any} */ a) =>
    new Promise((_, reject) => {
      calls.push(a);
      wake();
      if (a.signal) a.signal.addEventListener("abort", () => reject(new DOMException("This operation was aborted", "AbortError")), { once: true });
      else setTimeout(() => reject(new Error("no stop: the call ran on")), 3000);
    });
  /** Resolves once `n` calls have come. @param {number} n */
  const until = async (n) => {
    while (calls.length < n) await within(new Promise((r) => (wake = () => r(null))), `call ${calls.length + 1} never came`);
  };
  return Object.assign(fn, { calls, until });
}
/** A wait that fails after five seconds rather than hanging the file. @param {Promise<any>} p @param {string} what */
const within = (p, what) => {
  /** @type {any} */
  let t;
  return Promise.race([p, new Promise((_, reject) => (t = setTimeout(() => reject(new Error(what)), 5000)))]).finally(() => clearTimeout(t));
};
/** A log that keeps what memory warned of. @param {string[]} into */
const warnings = (into) => (/** @type {string} */ level, /** @type {string} */ msg) => void (level === "warn" || level === "error" ? into.push(msg) : 0);

// (fails before: yes — the live leg's third run's close: the pass's run had no call counted until it ended, and it never did)
test("M7-D70: a pass whose call is in flight when the curator stops is ended at once with the call it made, `cut`, its call aborted; an answer that comes anyway writes nothing, and the pass behind it skips", async () => {
  /** @type {{ a: any, answer: (v: any) => void }[]} */
  const asked = [];
  let called = () => {};
  const first = new Promise((r) => (called = () => r(null)));
  // This model hears no stop: it answers when the test says.
  const callModel = (/** @type {any} */ a) =>
    new Promise((resolve) => {
      asked.push({ a, answer: (v) => resolve(JSON.stringify(v)) });
      called();
    });
  await world({ models: { summarizer: "judge" }, callModel }, async (w) => {
    const { sit } = await w.session("open").send("hello");
    const projectId = sit.project.id;
    const port = await w.svc.brain.fileLearned({ projectId, chainId: "c1", kind: "fact", text: "the api server listens on port 3000", importance: 0.7 });
    await w.settle();
    /** @type {any[]} */
    const ops = [];
    w.svc.onCuratorOp = (/** @type {string} */ title, /** @type {any} */ o) => ops.push({ title, ...o });
    const pass = w.svc.curator.run(projectId, { reason: "asked" });
    await within(first, "the pass made no call");
    const [going] = w.svc.archive.curator.list({ projectId, limit: 1 });
    assert.deepEqual([going.calls, going.ended_at], [1, null], "the call is on the pass's run while it goes");
    const behind = w.svc.curator.run(projectId, { reason: "asked" });
    w.svc.curator.stop();
    assert.equal(asked[0].a.signal?.aborted, true, "its call is aborted");
    const ended = w.svc.archive.curator.get(going.id);
    assert.deepEqual([ended.calls, ended.ended_at != null, ended.detail?.cut, ended.error], [1, true, "memory closed", null], JSON.stringify(ended));
    const said = ops.at(-1);
    assert.deepEqual([said.title, said.sub, said.detail.cut], [`curated project ${projectId} (cut short: memory closed): 0 actions, 0 questions, 1 model call`, "done", "memory closed"], JSON.stringify(said));
    asked[0].answer({ slots: [{ n: 1, subject: "api", attribute: "port", value: "3000" }] });
    const r = await pass;
    assert.deepEqual([r.run, r.cut, r.calls], [`r${going.id}`, "memory closed", 1], JSON.stringify(r));
    assert.ok(!w.svc.archive.items.get(port.id).slot, "the answer that came after the cut keyed nothing");
    assert.deepEqual(w.svc.archive.items.events(port.id).filter((/** @type {any} */ e) => e.by === "curator"), [], "nor noted anything");
    assert.deepEqual(await behind, { skipped: "memory is closed" });
    assert.deepEqual([asked.length, w.svc.archive.curator.get(going.id)], [1, ended], "no call after the cut, and its run as the cut left it");
  });
});

// (fails before: yes — the learner's run and the curator's pass hit the closed database: warnings, an error counted, and the pass's run left with no call)
test("M7-D70: memory closing mid-learning and mid-pass warns nothing and counts no error; the pass's run keeps its call, and the session's turns wait for its next run", async () => {
  /** @type {string[]} */
  const warned = [];
  const model = waiting();
  await world({ models: { summarizer: "cheap" }, callModel: model, log: warnings(warned) }, async (w) => {
    const one = await w.session("one").send("the api listens on port 3000");
    const two = await w.session("two").send("the tests run with bun test");
    const projectId = one.sit.project.id;
    await w.svc.brain.fileLearned({ projectId, chainId: one.prep.chain, kind: "fact", text: "the api server listens on port 3000", importance: 0.7 });
    await w.settle();
    // Both sessions idle for an hour: the learner's tick reads them.
    w.svc.archive.db.prepare("UPDATE chains SET last_at = ? WHERE id IN (?, ?)").run(Date.now() - 3_600_000, one.prep.chain, two.prep.chain);
    const learner = w.svc.learner;
    const errors = learner.stats.errors;
    const tick = learner.tick(); // session one, then session two
    await model.until(1);
    const pass = w.svc.curator.run(projectId, { reason: "turn" });
    await model.until(2);
    assert.deepEqual(warned, [], "nothing amiss before the close");
    w.svc.stop();
    await tick;
    const passed = await pass;
    assert.equal(model.calls.length, 2);
    assert.ok(model.calls.every((a) => a.signal?.aborted), "both calls are aborted");
    assert.deepEqual([passed.cut, passed.calls], ["memory closed", 1], JSON.stringify(passed));
    assert.deepEqual([learner.recent[0]?.chain, learner.recent[0]?.skipped, learner.recent[0]?.error], [one.prep.chain, "memory closed", undefined], JSON.stringify(learner.recent[0]));
    assert.deepEqual([learner.stats.errors - errors, warned], [0, []], "no error counted, no warning");
    // Open again: the cut pass's run kept its call, and session one's turns wait for its next run.
    await w.withEngine(async () => {
      w.svc.start();
      await w.svc.engineStart;
    });
    const [run] = w.svc.archive.curator.list({ projectId, limit: 1 });
    assert.deepEqual([run.calls, run.ended_at != null, run.detail?.cut], [1, true, "memory closed"], JSON.stringify(run));
    assert.ok(!w.svc.archive.getChain(one.prep.chain).meta?.learnedThrough, "the cursor did not move");
  });
});

// (fails before: yes — the reading's call ran on, and its end was counted as an error, with a warning)
test("M7-D70: a report's reading cut by memory closing ends \"memory closed\", with no warning and no error counted", async () => {
  /** @type {string[]} */
  const warned = [];
  const model = waiting();
  await world({ models: { summarizer: "cheap" }, callModel: model, log: warnings(warned) }, async (w) => {
    const first = await w.session("parent").send("look into the API server");
    const learner = w.svc.learner;
    const errors = learner.stats.errors;
    w.svc.observe({ type: "subagent.report", chain: first.prep.chain, turn: first.prep.turn, id: "sa_0000abcd", agentType: "explore", model: "brain-model", task: "Find where the API server takes its port.", report: "The API server reads its port from config/server.json.", calls: [] });
    await model.until(1);
    w.svc.stop();
    await learner.settled();
    assert.equal(model.calls[0].signal?.aborted, true, "its call is aborted");
    const row = learner.recent.find((/** @type {any} */ x) => x.reason === "subagent");
    assert.deepEqual([row?.skipped, row?.error], ["memory closed", undefined], JSON.stringify(row));
    assert.deepEqual([learner.stats.errors - errors, warned], [0, []], "no error counted, no warning");
  });
});

// (fails before: yes — M7-D70's mutation pass: a step failing after the cut could add to what the cut had said)
test("M7-D70: the run counts each call as it is made; the cut says the errors as it found them, and a step failing after adds none", async () => {
  /** @type {((v: any) => void)[]} */
  const held = [];
  let called = () => {};
  const second = new Promise((r) => (called = () => r(null)));
  // Keying answers at once, in no JSON; the next call waits and hears no stop.
  const callModel = (/** @type {any} */ a) =>
    a.system === KEY_PROMPT
      ? Promise.resolve({ text: "no idea", usage: null })
      : new Promise((resolve) => {
          held.push((v) => resolve(JSON.stringify(v)));
          called();
        });
  await world({ models: { summarizer: "judge" }, callModel }, async (w) => {
    const { sit } = await w.session("open").send("hello");
    const projectId = sit.project.id;
    await w.svc.brain.fileLearned({ projectId, chainId: "c1", kind: "fact", text: "the api server listens on port 3000", importance: 0.7 });
    await w.settle();
    /** @type {number[]} */
    const counted = [];
    const count = w.svc.archive.curator.count;
    w.svc.archive.curator.count = (/** @type {number} */ id, /** @type {number} */ calls) => (counted.push(calls), count(id, calls));
    const pass = w.svc.curator.run(projectId, { reason: "asked" });
    await within(second, "the pass made no second call");
    assert.deepEqual(counted, [1, 2], "keying on the run as it went out, then the call going");
    w.svc.curator.stop();
    held[0]({}); // an answer after the cut: its step fails after the cut
    const r = await pass;
    assert.deepEqual([r.calls, r.errors], [2, { key: "the model answered no JSON" }], JSON.stringify(r));
    assert.deepEqual(w.svc.curator.recent[0].errors, { key: "the model answered no JSON" }, "the dashboard's row as the cut said it");
  });
});

// (fails before: yes — M7-D70's mutation pass: a pass that had ended stayed the pass going, and a later stop ended it again as cut)
test("M7-D70: a pass that ended is never cut by a later stop", async () => {
  const callModel = async () => JSON.stringify({});
  await world({ models: { summarizer: "judge" }, callModel }, async (w) => {
    const { sit } = await w.session("open").send("hello");
    const projectId = sit.project.id;
    await w.svc.brain.fileLearned({ projectId, chainId: "c1", kind: "fact", text: "the api server listens on port 3000", importance: 0.7 });
    await w.settle();
    const r = await w.svc.curator.run(projectId, { reason: "asked" });
    assert.ok(r.calls > 0 && !r.cut, JSON.stringify(r));
    const run = w.svc.archive.curator.get(Number(r.run.slice(1)));
    w.svc.curator.stop();
    assert.deepEqual([w.svc.archive.curator.get(run.id), w.svc.curator.recent.length], [run, 1], "its run and its row as it ended");
  });
});

// (fails before: yes — HarnessV3-Readiness RD1 e: a pass's row named no owner, so a pass a killed Filament left open
// could not be told from one running, and stayed open for good)
test("RD1 e: a running pass names its owner — this host, this process and its own id — and its end overwrites it", async () => {
  const model = waiting();
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { sit } = await w.session("open").send("hello");
    const projectId = sit.project.id;
    await w.svc.brain.fileLearned({ projectId, chainId: "c1", kind: "fact", text: "the api server listens on port 3000", importance: 0.7 });
    await w.settle();
    assert.deepEqual([PASS_OWNER.host, PASS_OWNER.pid], [hostname(), process.pid]);
    assert.match(PASS_OWNER.instance, /^[0-9a-f]{16}$/);
    const pass = w.svc.curator.run(projectId, { reason: "asked" });
    await model.until(1);
    const [running] = w.svc.archive.curator.list({ projectId });
    assert.deepEqual([running.ended_at, running.detail], [null, { owner: PASS_OWNER }], "while it runs, its row says whose it is");
    w.svc.curator.stop();
    await pass;
    const ended = w.svc.archive.curator.get(running.id);
    assert.equal(ended.detail.owner, undefined, "its end overwrites the owner");
    assert.equal(ended.detail.cut, "memory closed");
  });
});

// (fails before: yes — RD1 e: there was no rule)
test("RD1 e: whose pass is gone, by rule", () => {
  const me = { host: "h", pid: 10, instance: "a" };
  const alive = (/** @type {number} */ pid) => pid === 20;
  assert.equal(ownerGone({ host: "h", pid: 10, instance: "a" }, me, alive), false, "this process's own pass");
  assert.equal(ownerGone({ host: "h", pid: 10, instance: "b" }, me, alive), true, "an earlier process with this pid");
  assert.equal(ownerGone({ host: "h", pid: 20, instance: "c" }, me, alive), false, "a live pid, a reused one too");
  assert.equal(ownerGone({ host: "h", pid: 30, instance: "c" }, me, alive), true, "no process has the pid");
  assert.equal(ownerGone({ host: "x", pid: 30, instance: "c" }, me, alive), false, "another host's");
});

// (fails before: no — L4's mutation pass: nothing held the default check's reading of a process it may not signal)
test("RD1 e: a pid whose process this one may not signal (EPERM) is alive; only ESRCH says none", (t) => {
  const me = { host: "h", pid: 10, instance: "a" };
  /** @type {string} */
  let code = "EPERM";
  t.mock.method(process, "kill", () => {
    throw Object.assign(new Error(`kill ${code}`), { code });
  });
  assert.equal(ownerGone({ host: "h", pid: 30, instance: "c" }, me), false, "another user's process answers EPERM: it runs");
  code = "ESRCH";
  assert.equal(ownerGone({ host: "h", pid: 30, instance: "c" }, me), true, "no such process");
});

// (fails before: yes — RD1 e: memory's open left every open pass as it was, the dead Filament's with the rest)
test("RD1 e: memory's open ends a pass whose owner is gone as \"Filament stopped\", with its calls and actions; another host's and a live process's are left open", async () => {
  // A pid no process can have: far above the ids systems hand out (Linux's ceiling is 2^22). An exited child's pid will
  // not do: the system hands it to a later process, and under the full suite's load one had it by the time memory opened.
  const dead = 2 ** 30;
  assert.throws(() => process.kill(dead, 0), { code: "ESRCH" });
  await world({ models: { summarizer: "judge" }, callModel: async () => JSON.stringify({}) }, async (w) => {
    const { sit } = await w.session("open").send("hello");
    const projectId = sit.project.id;
    const item = await w.svc.brain.fileLearned({ projectId, chainId: "c1", kind: "fact", text: "the api server listens on port 3000", importance: 0.7 });
    await w.settle();
    const cur = w.svc.archive.curator;
    const host = hostname();
    const open = (/** @type {any} */ owner) => cur.start({ projectId, reason: "learned", model: "judge", owner });
    const killed = open({ host, pid: dead, instance: "0123456789abcdef" });
    cur.count(killed, 2);
    w.svc.archive.items.setStatus(item.id, "confirmed", { by: "curator", reason: "checked", run: killed });
    const restarted = open({ host, pid: process.pid, instance: "fedcba9876543210" }); // an earlier Filament with this pid
    const elsewhere = open({ host: `${host}-other`, pid: dead, instance: "0000000000000000" });
    const live = open({ host, pid: process.ppid, instance: "1111111111111111" });
    /** @type {any[]} */
    const ops = [];
    w.svc.onCuratorOp = (/** @type {string} */ title, /** @type {any} */ o) => ops.push({ title, ...o });
    w.svc.stop();
    await w.withEngine(async () => {
      w.svc.start();
      await w.svc.engineStart;
    });
    const row = (/** @type {number} */ id) => w.svc.archive.curator.get(id);
    assert.ok(row(killed).ended_at, "the killed Filament's pass is ended");
    assert.deepEqual([row(killed).calls, row(killed).actions, row(killed).error, row(killed).detail], [2, 1, null, { cut: "Filament stopped" }], "with the calls and actions it counted");
    assert.ok(row(restarted).ended_at, "a pass of an earlier process with this pid is ended: that process is gone");
    assert.deepEqual([row(elsewhere).ended_at, row(live).ended_at], [null, null], "another host's and a live process's are left");
    assert.deepEqual(
      ops.filter((o) => /Filament stopped/.test(o.title)).map((o) => [o.title, o.sub, o.detail.run, o.detail.cut]),
      [
        [`curated project ${projectId} (cut short: Filament stopped): 1 action, 0 questions, 2 model calls`, "done", killed, "Filament stopped"],
        [`curated project ${projectId} (cut short: Filament stopped): 0 actions, 0 questions, 0 model calls`, "done", restarted, "Filament stopped"],
      ],
      "each said as an operation, as a cut pass is",
    );
  });
});
