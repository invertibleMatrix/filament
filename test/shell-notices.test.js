// @ts-check
// HarnessV3-Tools TL-D24 — background shells: a read that waits for a line, and exit notices.
// `bash_output` takes `until`, a regular expression: the read returns once a new line matches it (or the shell exits,
// or the wait ends), up to 300 s, and the turn's stop ends the wait. A background shell that exits before its agent
// has seen the exit is told once, in one line: to that agent's running turn at its next round boundary, else with its
// session's next turn. A sub-agent's shell that outlives the sub-agent's run is told to the session's main agent.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHand, disposeBackgroundShells, peekShellExits, tellShellExits, takeShellExits, attendShells, outputWaitMs, runningShellsOf, firstMatch, onUntoldLost, tellLater, UNTIL_TEST_MS, UNTIL_WAIT_MS } from "../src/adapters/tools/hands.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";
import { alignEvents, shellExitWords } from "../src/ui/harness/lib/labels.js";
import { transcriptTurns } from "../src/ui/harness/conversation/history.js";
import { deliveredWords } from "../src/ui/harness/conversation/turn.js";
import { postTurn, setInboundKey } from "../src/ui/harness/lib/api.js";
import { RUN_EVENT_FIELDS, RUN_EVENT_TYPE_LIST } from "../src/services/runs.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

after(() => disposeBackgroundShells());
const cwd = tmpdir();
const idOf = (/** @type {string} */ text) => (/bg_[0-9a-z]+/.exec(text) || [""])[0];
/** @param {string} name @param {any} input @param {any} [o] */
const run = async (name, input, o = {}) => String(await runHand(name, input, { root: cwd, ...o }));
/** A node one-liner, as the shell runs it. @param {string} js */
const node = (js) => `node -e "${js}"`;
/** A background shell started for `owner`; its id. @param {string} js @param {any} [owner] */
const start = async (js, owner) => {
  const out = await run("bash_background", { command: node(js), grace: 0.1 }, owner ? { owner } : {});
  const id = idOf(out);
  assert.match(out, /started/, out);
  return id;
};
/**
 * Waits until `owner` has `n` exits to be told of, and answers them.
 * @param {any} owner @param {number} [n] @returns {Promise<import("../src/adapters/tools/hands.js").ShellExit[]>}
 */
const exitsFor = async (owner, n = 1) => /** @type {any} */ (await until(() => (peekShellExits(owner).length >= n ? peekShellExits(owner) : null), `${n} exit(s) for ${owner.session}/${owner.agent}`, { timeoutMs: 15_000 }));
/**
 * Waits until Filament has taken in `text` from `owner`'s shell `id`, unread: printed while nobody read, however slowly
 * the shell's node started. @param {any} owner @param {string} id @param {string} text
 */
const printed = (owner, id, text) => until(() => runningShellsOf(owner.session).find((s) => s.id === id)?.out.includes(text), `${id} to print ${text}`);

// ---- until ----

// (fails before: yes — until was not read: the wait returned at "a", the first output)
test("until: the read waits past lines that don't match and returns at the one that does, with every line since", async () => {
  // The lines land after the start answered (its grace is 0.1 s): what it showed would count as read.
  const id = await start("setTimeout(()=>console.log('a'),500);setTimeout(()=>console.log('b'),800);setTimeout(()=>console.log('server READY on 3000'),1500);setInterval(()=>{},1000)");
  const t0 = Date.now();
  const out = await run("bash_output", { id, until: "READY on \\d+", wait: 20 });
  const took = Date.now() - t0;
  assert.match(out, new RegExp(`^\\[${id} still running — this line matched until: server READY on 3000\\]`), out);
  assert.match(out, /a\nb\nserver READY on 3000/, "what arrived before the line is shown with it");
  assert.ok(took < 8000, `returned at the line, not at the end of the wait (${took} ms)`);
  await run("bash_kill", { id });
});

// (fails before: yes — a read with until and no wait returned at once, without the line)
test("until: without a wait it waits 30 s by default; a line already printed but not read counts at once", async () => {
  const id = await start("setTimeout(()=>console.log('DONE 7'),900);setInterval(()=>{},1000)");
  const out = await run("bash_output", { id, until: "DONE" });
  assert.match(out, /still running — this line matched until: DONE 7/, out);
  const owner = { session: "U2", agent: null };
  const later = await start("setTimeout(()=>console.log('DONE early'),500);setInterval(()=>{},1000)", owner);
  await printed(owner, later, "DONE early");
  const t0 = Date.now();
  assert.match(await run("bash_output", { id: later, until: "DONE" }, { owner }), /matched until: DONE early/);
  assert.ok(Date.now() - t0 < 3000, "a line already there ends the wait at once");
  await run("bash_kill", { id });
  await run("bash_kill", { id: later }, { owner });
});

// (fails before: yes — no line matched said nothing, and the wait ended at the first output)
test("until: no line matched — said with the wait it took, and with the exit when the shell ended first", async () => {
  // The noise comes a moment after node is up, which the wait waits for: a start slower than the wait leaves no
  // noise inside it.
  const dir = mkdtempSync(join(tmpdir(), "filament-until-"));
  const started = await run("bash_background", { command: node("require('fs').writeFileSync('up','');setTimeout(()=>console.log('noise'),200);setInterval(()=>{},1000)"), grace: 0.1 }, { root: dir });
  const id = idOf(started);
  assert.match(started, /started/, started);
  await until(() => existsSync(join(dir, "up")), "node to be up");
  const t0 = Date.now();
  const out = await run("bash_output", { id, until: "never", wait: 1.5 });
  assert.ok(Date.now() - t0 >= 1400, "the noise did not end the wait");
  assert.match(out, new RegExp(`^\\[${id} still running — no line matched until in 2 s\\]\\nnoise`), out);
  await run("bash_kill", { id });
  await removeDirs(dir);
  const ended = await start("setTimeout(()=>{console.log('bye');process.exit(2)},300)");
  assert.match(await run("bash_output", { id: ended, until: "never", wait: 10 }), new RegExp(`^\\[${ended} exited with code 2 — no line matched until\\]\\nbye`));
});

// (fails before: yes — the unfinished last line was never tested)
test("until: a last line without a newline is tested once the shell has exited", async () => {
  const id = await start("setTimeout(()=>{process.stdout.write('ALL PASSED');process.exit(0)},300)");
  assert.match(await run("bash_output", { id, until: "PASSED", wait: 10 }), /exited with code 0 — this line matched until: ALL PASSED\]/);
});

// (fails before: yes — every wait was capped at 30 s, and with no wait given there was none)
test("the wait: none by default and 30 s at most; with until 30 s by default and 300 at most", () => {
  assert.deepEqual([outputWaitMs(undefined, false), outputWaitMs("", false), outputWaitMs(10, false), outputWaitMs(1000, false), outputWaitMs(-5, false)], [0, 0, 10_000, 30_000, 0]);
  assert.deepEqual([outputWaitMs(undefined, true), outputWaitMs("", true), outputWaitMs(120, true), outputWaitMs(1000, true), outputWaitMs(0, true), outputWaitMs("x", true)], [30_000, 30_000, 120_000, 300_000, 0, 0]);
});

// (fails before: yes — the redacted text was not what until was tested on)
test("until: a line is tested as the model reads it, redacted — a secret cannot be probed with a pattern", async () => {
  const redact = (/** @type {string} */ t) => t.replace(/SECRET-[A-Z]+/g, "[redacted]");
  const id = await start("setTimeout(()=>console.log('key SECRET-ABC'),200);setTimeout(()=>console.log('ready'),900);setInterval(()=>{},1000)");
  const out = await run("bash_output", { id, until: "SECRET-A|ready", wait: 10 }, { redact });
  assert.match(out, /this line matched until: ready\]/, out);
  assert.doesNotMatch(out, /ABC/);
  await run("bash_kill", { id });
});

// (fails before: yes — with the read's watch left on the shell, every later line was still tested for it; found by
// the TL11 mutation pass)
test("until: the read's watch ends with the read — later output is not tested for it", async () => {
  let calls = 0;
  const redact = (/** @type {string} */ t) => (calls++, t);
  const id = await start("setInterval(()=>console.log('tick'),100)");
  assert.match(await run("bash_output", { id, until: "never", wait: 0.5 }, { redact }), /no line matched until/);
  const then = calls;
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(calls, then, "nothing tested the ticks that came after the read");
  await run("bash_kill", { id });
});

// (fails before: yes — the stop did not reach the wait, which ran its full length)
test("until and wait: the turn's stop ends the wait; the shell keeps running", async () => {
  const id = await start("setInterval(()=>{},1000)");
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 300);
  const t0 = Date.now();
  const out = await run("bash_output", { id, wait: 20 }, { signal: ac.signal });
  assert.ok(Date.now() - t0 < 3000, `the stop ended the wait (${Date.now() - t0} ms)`);
  assert.match(out, new RegExp(`^\\[${id} still running — the turn's stop ended the wait\\]`), out);
  assert.match(await run("bash_output", { id }), /still running/, "the shell was not stopped");
  await run("bash_kill", { id });
});

// (fails before: yes — the model's pattern was tested on the proxy's own thread with no bound: one that backtracks
// without end on a line held every timer and request for seconds, and the wait went on to its end)
// (and, the review of 11-11: its times were the machine's — the thread stalled under 1 s by the clock, where a loaded
// machine has the test run again for up to `UNTIL_WAIT_MS`; each read over in 5 s and 3 s, with its shell's node still
// to start inside them. Now the line is there before the read starts, and the read is over before its wait is: only a
// test that was stopped says these words. How long one may hold the thread is `heldScan`'s rule, which the next test
// holds it to run by run)
test("until: a pattern that backtracks without end is stopped, and the wait ends saying so, not at its own end", async () => {
  const owner = { session: "U4", agent: null };
  const line = `${"a".repeat(29)}b`;
  // The line waits unread as the read starts, however slowly the shell's node started: the read's time is its own.
  const id = await start(`setTimeout(()=>console.log('ok'),200);setTimeout(()=>console.log('${line}'),500);setInterval(()=>{},1000)`, owner);
  await printed(owner, id, line);
  const t0 = Date.now();
  const out = await run("bash_output", { id, until: "(a+)+$", wait: 20 }, { owner });
  assert.match(out, new RegExp(`^\\[${id} still running — until's pattern ran past 250 ms on this output, so the wait stopped watching for it: use a simpler pattern\\]\\nok\\na{29}b`), out);
  assert.ok(Date.now() - t0 < 20_000, `the wait ended as the pattern was stopped, not at its own end (${Date.now() - t0} ms)`);
  await run("bash_kill", { id }, { owner });
  // The unfinished last line, tested once the shell has exited, is bounded the same way.
  const last = await start(`setTimeout(()=>{process.stdout.write('${line}');process.exit(0)},300)`, owner);
  await exitsFor(owner);
  assert.match(await run("bash_output", { id: last, until: "(a+)+$", wait: 10 }, { owner }), /^\[bg_[0-9a-z]+ exited with code 0 — until's pattern ran past 250 ms on this output/);
});

// (fails before: yes — the full suite's load: the vm's watchdog keeps its time on a clock, and a thread a loaded machine
// kept waiting for a CPU through it was taken for a pattern that backtracks without end, so a plain `READY on \d+` was
// refused with "use a simpler pattern")
test("until: a test the machine kept off the CPU past its time is tried again, for as long as its bound; one that spent its time on the CPU is stopped", { skip: typeof process.threadCpuUsage !== "function" && "no thread CPU time on this Node" }, () => {
  // The thread asleep, as one a loaded machine keeps waiting for a CPU: Atomics.wait spends no CPU while it waits.
  const asleep = (/** @type {number} */ ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  let sleeps = 0;
  const kept = { test: (/** @type {string} */ l) => (sleeps-- > 0 && asleep(400), l === "server READY on 3000") };
  /** What `firstMatch` answers a test asleep through its first `n` runs, and how long it took, in ms. @param {number} n */
  const keptOff = (n) => {
    sleeps = n;
    const began = Date.now();
    return { at: firstMatch(/** @type {any} */ (kept), ["a", "server READY on 3000"]), took: Date.now() - began };
  };
  /**
   * Tried again until the line matched — or, on a machine that keeps this very thread waiting, for the whole of its
   * bound, which is the promise kept: vm's watchdog is a thread of its own, and one the machine keeps off the CPU past
   * a test's time stops a run that had already ended (the review of 11-11: a quarter of the runs, beside three busy
   * loops a core). What these cases guard is a test given up sooner.
   * @param {{ at: number | null, took: number }} r @param {string} what
   */
  const triedAgain = (r, what) => assert.ok(r.at === 1 || (r.at === null && r.took >= UNTIL_WAIT_MS), `${what}: answered ${r.at} after ${r.took} ms`);
  triedAgain(keptOff(1), "the line that matches, once tried again");
  // (fails before: yes — FabeleHelper's of 11-10: the suite kept the thread off the CPU through three tries in a row, and
  // three were all a test had) Kept off it again and again, it is tried again for as long as it waits, within its bound.
  triedAgain(keptOff(3), "tried again past three");
  // (fails before: no — a guard the review of 11-11 asked for: with the bound taken out of `heldScan` nothing failed)
  // Kept off it past `UNTIL_WAIT_MS`, it is given up. Each run stopped lasts a test's time at least, so twice the runs
  // the bound has room for outlast it on any machine: the line that matches after them is never tried.
  const past = keptOff(2 * Math.ceil(UNTIL_WAIT_MS / UNTIL_TEST_MS));
  assert.equal(past.at, null, "given up at its bound");
  assert.ok(past.took >= UNTIL_WAIT_MS, `tried again for as long as its bound: ${past.took} ms`);
  // One that spends the time on the CPU, as a pattern that backtracks without end does, is stopped as before — by what
  // it spent, long before that bound: no run begins once the runs before it spent half a test's time on the CPU. (The
  // clock is no measure of it: beside three busy loops a core such a test held the thread up to 2.3 s, run again as
  // the rule has it.)
  /** What the thread had spent on the CPU as each run began, in ms. @type {number[]} */
  const spentAt = [];
  const spins = {
    test: () => {
      const cpu = process.threadCpuUsage();
      spentAt.push((cpu.user + cpu.system) / 1000);
      for (const end = Date.now() + 400; Date.now() < end; );
      return false;
    },
  };
  assert.equal(firstMatch(/** @type {any} */ (spins), ["a"]), null);
  const before = spentAt.map((ms) => ms - spentAt[0]);
  assert.ok(before.every((ms) => ms < UNTIL_TEST_MS / 2), `runs began with ${before.map(Math.round).join(", ")} ms spent by the runs before them`);
});

// (fails before: no — a guard the mutation pass asked for: nothing checked a line that matches after others that
// came with it, in the output waiting when the read starts and in a batch that lands during it)
test("until: a line that matches after others in the same batch counts", async () => {
  const owner = { session: "U3", agent: null };
  const early = await start("setTimeout(()=>process.stdout.write('one\\ntwo\\nREADY early\\n'),300);setInterval(()=>{},1000)", owner);
  await printed(owner, early, "READY early");
  assert.match(await run("bash_output", { id: early, until: "READY", wait: 5 }, { owner }), /this line matched until: READY early\]/);
  const later = await start("setTimeout(()=>process.stdout.write('three\\nfour\\nREADY later\\n'),500);setInterval(()=>{},1000)");
  assert.match(await run("bash_output", { id: later, until: "READY", wait: 5 }), /this line matched until: READY later\]/);
  await run("bash_kill", { id: early }, { owner });
  await run("bash_kill", { id: later });
});

// (fails before: yes — until was not read, so a malformed one was no error)
test("until: a pattern that does not compile is refused in words", async () => {
  const id = await start("setInterval(()=>{},1000)");
  await assert.rejects(run("bash_output", { id, until: "(unclosed" }), /until is a regular expression, and this one does not compile: .*Unterminated group/);
  await run("bash_kill", { id });
});

test("bash_output's description and schema name until and its longer wait", async () => {
  const t = toolSetFor({ delegateRead: false }).find((x) => x.name === "bash_output");
  assert.ok(t);
  assert.match(t.description, /Set until \(a regular expression\) to wait instead for a line that matches it/);
  assert.match(t.description, /reported to you once, at your next step/);
  assert.equal(t.input_schema.properties.until.type, "string");
  assert.match(t.input_schema.properties.wait.description, /with until, for the line \(default 30, max 300\)/);
});

// ---- exit notices ----

// (fails before: yes — there were no notices)
test("an exit nobody saw is told once, in one line: the shell, its command, its code, and its unread output", async () => {
  const owner = { session: "N1", agent: null };
  const id = await start("setTimeout(()=>{console.log('bye');process.exit(3)},400)", owner);
  const [x] = await exitsFor(owner);
  assert.equal(x.id, id);
  assert.equal(x.code, 3);
  assert.equal(x.command, node("setTimeout(()=>{console.log('bye');process.exit(3)},400)"));
  assert.equal(x.text, `[Filament: background shell ${id} (${x.command}) exited with code 3 — 4 characters of its output are unread: bash_output({ id: "${id}" }) reads them.]`);
  assert.deepEqual(peekShellExits({ session: "N1", agent: "subagent:z" }), [], "not another agent's");
  assert.deepEqual(peekShellExits({ session: "N2", agent: null }), [], "not another session's");
  assert.equal(takeShellExits(owner).length, 1);
  assert.deepEqual(takeShellExits(owner), [], "told once");
});

// (fails before: yes — there were no notices)
test("an exit already seen is not told: read by bash_output, finished within the start, or stopped by bash_kill", async () => {
  const owner = { session: "N3", agent: null };
  const read = await start("setTimeout(()=>process.exit(0),300)", owner);
  assert.match(await run("bash_output", { id: read, wait: 10 }, { owner }), /exited with code 0/);
  const quick = idOf(await run("bash_background", { command: node("process.exit(0)"), grace: 5 }, { owner }));
  const killed = await start("setInterval(()=>{},1000)", owner);
  assert.match(await run("bash_kill", { id: killed }, { owner }), /stopped/);
  // A shell whose exit lands after its read: the one exit that is told, so the wait has something to wait for.
  const late = await start("setTimeout(()=>process.exit(1),600)", owner);
  const exits = await exitsFor(owner);
  assert.deepEqual(exits.map((e) => e.id), [late], `only the unseen exit (read ${read}, quick ${quick}, killed ${killed})`);
  assert.match(exits[0].text, /exited with code 1 — all of its output was read\.\]$/);
  tellShellExits(owner, [late]);
  assert.deepEqual(peekShellExits(owner), []);
});

// (fails before: yes — there were no notices)
test("an exit told and then read: a read that sees an exit already queued takes it off the queue", async () => {
  const owner = { session: "N4", agent: null };
  const id = await start("setTimeout(()=>process.exit(0),300)", owner);
  await exitsFor(owner);
  assert.match(await run("bash_output", { id }, { owner }), /exited with code 0/);
  assert.deepEqual(peekShellExits(owner), [], "the read showed the exit");
});

// (fails before: yes — there were no notices)
test("a sub-agent is told of its own shells while its run lasts; after, its untold exits and every later one go to the main agent", async () => {
  const sub = { session: "N5", agent: "subagent:sa_1" };
  const main = { session: "N5", agent: null };
  const leave = attendShells(sub);
  const first = await start("setTimeout(()=>process.exit(0),300)", sub);
  await exitsFor(sub);
  assert.deepEqual(peekShellExits(main), [], "the running sub-agent's, not the main agent's");
  const second = await start("setTimeout(()=>process.exit(4),2500)", sub);
  leave();
  leave(); // a second call does nothing
  assert.deepEqual(peekShellExits(sub), []);
  const [moved] = peekShellExits(main);
  assert.equal(moved.id, first);
  assert.match(moved.text, new RegExp(`^\\[Filament: background shell ${first} \\(node -e .*\\), started by sub-agent sa_1, exited with code 0`));
  const both = await exitsFor(main, 2);
  assert.deepEqual(both.map((e) => e.id), [first, second], "an exit after the run ended is the main agent's too");
  assert.match(both[1].text, /, started by sub-agent sa_1, exited with code 4/);
  // The main agent reads the sub-agent's shell: the exit it was to be told of is seen, and leaves its queue.
  assert.match(await run("bash_output", { id: second }, { owner: main }), /exited with code 4/);
  assert.deepEqual(peekShellExits(main).map((e) => e.id), [first]);
  assert.equal(takeShellExits(main).length, 1);
});

// (fails before: yes — there were no notices)
test("two runs of the same agent at once: its exits stay its own until the last one ends", async () => {
  const sub = { session: "N6", agent: "subagent:sa_2" };
  const main = { session: "N6", agent: null };
  const a = attendShells(sub);
  const b = attendShells(sub);
  await start("setTimeout(()=>process.exit(0),300)", sub);
  await exitsFor(sub);
  a();
  assert.equal(peekShellExits(sub).length, 1, "one run still attends");
  b();
  assert.equal(peekShellExits(main).length, 1);
  takeShellExits(main);
});

// (fails before: yes — there were no notices)
test("at most 20 exits wait per agent: past it the oldest go", async () => {
  const owner = { session: "N7", agent: null };
  for (let i = 0; i < 20; i++) await start(`setTimeout(()=>process.exit(${i}),200)`, owner);
  // Shells started together may exit in another order than they started: the oldest is the first that exited.
  const oldest = (await exitsFor(owner, 20))[0].id;
  const last = await start("setTimeout(()=>process.exit(20),200)", owner);
  const all = /** @type {import("../src/adapters/tools/hands.js").ShellExit[]} */ (await until(() => {
    const now = peekShellExits(owner);
    return now.some((e) => e.id === last) ? now : null;
  }, "the 21st exit", { timeoutMs: 20_000 }));
  assert.equal(all.length, 20);
  assert.ok(!all.some((e) => e.id === oldest), "the oldest went");
  takeShellExits(owner);
});

// (fails before: yes — the nudge map of 11-10: past the cap the oldest went for good and silently: nothing logged, and the
// agent never heard that any went; the review of 11-11: then each item let go was heard, so a busy watch logged a line
// for every line it caught)
test("what the cap lets go is heard — the server logs it — once a run, until it is told, and said ahead of the next item told, once", () => {
  const owner = { session: "N7-lost", agent: null };
  /** @type {[string, string | null, number][]} */
  const heard = [];
  const off = onUntoldLost((session, agent, n) => void heard.push([session, agent, n]));
  try {
    for (let i = 0; i < 22; i++) tellLater(owner, { id: `bg_l${i}`, command: `step ${i}`, code: 0, text: `[Filament: step ${i} ended]` }, { wake: false });
    assert.deepEqual(heard, [["N7-lost", null, 1]], "heard as the first goes; the rest of the run is counted, not heard");
    const due = peekShellExits(owner);
    assert.deepEqual([due.length, due[0].id, due[1].id], [20, "bg_l2", "bg_l3"], "the newest 20 stay");
    assert.equal(due[0].text, `[Filament: 2 earlier background items — a command's end, a watch's lines, a come-back — went untold: more than 20 waited for you, and the oldest were let go. bash_output reads a shell's output by its id while Filament keeps it.]\n[Filament: step 2 ended]`);
    assert.equal(due[1].text, "[Filament: step 3 ended]", "said once, with the first");
    takeShellExits(owner);
    tellLater(owner, { id: "bg_after", command: "later", code: 0, text: "[Filament: later ended]" }, { wake: false });
    assert.deepEqual(takeShellExits(owner).map((x) => x.text), ["[Filament: later ended]"], "told: never said again");
    for (let i = 0; i < 21; i++) tellLater(owner, { id: `bg_r${i}`, command: `again ${i}`, code: 0, text: `[Filament: again ${i} ended]` }, { wake: false });
    assert.deepEqual(heard, [["N7-lost", null, 1], ["N7-lost", null, 1]], "told, the next run is heard again");
    takeShellExits(owner);
    // A sub-agent's let go goes with its items to the main agent as its run ends.
    const sub = { session: "N7-lost", agent: "subagent:sa_9" };
    const done = attendShells(sub);
    for (let i = 0; i < 21; i++) tellLater(sub, { id: `bg_s${i}`, command: `s ${i}`, code: 0, text: `[Filament: s ${i} ended]` }, { wake: false });
    assert.deepEqual(heard.at(-1), ["N7-lost", "subagent:sa_9", 1]);
    done();
    assert.match(takeShellExits(owner)[0].text, /^\[Filament: an earlier background item — a command's end, a watch's lines, a come-back — went untold:/);
  } finally {
    off();
  }
});

// ---- the loop's round boundary ----

const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
const reply = (/** @type {any[]} */ content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } };
/** @param {Partial<import("../src/app/agent/loop.js").LoopArgs>} over */
const loopArgs = (over) =>
  /** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
    model: "m", messages: [{ role: "user", content: "go" }], system: "s", tools: toolSetFor({ delegateRead: false }), modeNow: () => "edit", root: tmpdir(),
    readerModel: "", maxTokens: 100, call: async () => reply([{ type: "text", text: "Done." }]),
    costOf: () => 0, runHand: async (/** @type {string} */ name) => `${name} ran`, delegateRead: null, mailbox: { read: () => [] }, permissions: null,
    tree: null, onEvent: () => {}, previewChars: 0, sink, signal: null, resume: null, ...over,
  });
const EXIT = { id: "bg_x1", command: "npm run build", code: 1, text: "[Filament: background shell bg_x1 (npm run build) exited with code 1 — all of its output was read.]" };

// (fails before: yes — the loop took no shell news)
test("the loop tells a shell's exit at the round boundary: a text block after the results, an event, a note", async () => {
  let n = 0;
  let taken = 0;
  /** @type {any[]} */
  const events = [];
  const out = await runAgentTurn(loopArgs({
    call: async () => (++n === 1 ? reply([toolUse("r1", "read", { path: "a.txt" })]) : reply([{ type: "text", text: "Done." }])),
    // Nothing waits as the turn begins (its first ask); the shell exits while round one works.
    shellNews: () => (++taken === 2 ? [EXIT] : []),
    onEvent: (/** @type {any} */ e) => events.push(e),
  }));
  assert.equal(out.status, "done");
  const results = out.work[1].content;
  assert.deepEqual(results.map((/** @type {any} */ b) => b.type), ["tool_result", "text"]);
  assert.equal(results[1].text, EXIT.text);
  assert.deepEqual(events.filter((e) => e.type === "shell-exit").map(({ round, shells }) => ({ round, shells })), [{ round: 1, shells: [{ id: "bg_x1", command: "npm run build", code: 1 }] }]);
  assert.ok(out.notes.some((/** @type {string} */ s) => s === "agent: 1 background shell exit told at the round boundary"), out.notes.join("\n"));
});

// (fails before: yes — the loop took no shell news. The first version of this test put the stop in the second read,
// which is still the preflight's — the boundary was never reached; the TL11 mutation pass showed it)
test("a stop at the boundary leaves the exits untold, for the next turn", async () => {
  let reads = 0;
  let taken = 0;
  // The preflight reads the box twice (the stop first, then the rest); the boundary's first read hears the stop.
  const out = await runAgentTurn(loopArgs({
    call: async () => reply([toolUse("r1", "read", { path: "a.txt" })]),
    mailbox: { read: () => (++reads === 3 ? [{ kind: "stop", text: "enough" }] : []) },
    shellNews: () => (taken++ ? [EXIT] : []),
  }));
  assert.equal(out.status, "stopped");
  assert.deepEqual(out.work.at(-1).content.map((/** @type {any} */ b) => [b.tool_use_id, b.content]), [["r1", "read ran"]], "the tool ran: the stop came at the boundary");
  assert.equal(taken, 1, "asked as the turn began, and nothing taken at the boundary");
});

// (fails before: yes — HarnessV4_Tasks C11: the loop asked for exits at a round boundary alone. A harness session's
// typed message carries the ones that waited, but a client of the proxy sends its own message: its model answered
// round one without them, and a turn that called no tool never heard)
test("a turn that begins is told of the exits that waited, with its first request and ahead of its message; the client's own message is left as sent", async () => {
  /** @type {any[]} */
  const sent = [];
  /** @type {any[]} */
  const events = [];
  let taken = 0;
  const mine = [{ role: "user", content: "is the build done?" }];
  const out = await runAgentTurn(loopArgs({
    messages: mine,
    call: async (/** @type {any} */ c) => (sent.push(structuredClone(c.body.messages)), reply([{ type: "text", text: "It failed." }])),
    shellNews: () => (++taken === 1 ? [EXIT] : []),
    onEvent: (/** @type {any} */ e) => events.push(e),
  }));
  assert.equal(out.status, "done");
  assert.equal(sent.length, 1, "a turn with no tool call: one request, and it carried the exit");
  assert.deepEqual(sent[0].at(-1).content.map((/** @type {any} */ b) => b.text), [EXIT.text, "is the build done?"]);
  assert.deepEqual(mine, [{ role: "user", content: "is the build done?" }], "the caller's message is not written to");
  assert.deepEqual(events.filter((e) => e.type === "shell-exit").map(({ round, shells }) => ({ round, shells })), [{ round: 1, shells: [{ id: "bg_x1", command: "npm run build", code: 1 }] }]);
  assert.ok(out.notes.includes("agent: 1 background shell exit told with the turn's first request"), out.notes.join("\n"));
  assert.deepEqual(out.work, [], "the turn's own work holds no message of it: the lines rode the message that began the turn");
  // A message in blocks keeps its blocks, the lines ahead of them; the row lands in round one.
  taken = 0;
  sent.length = 0;
  await runAgentTurn(loopArgs({
    messages: [{ role: "user", content: [{ type: "text", text: "and now?" }] }],
    call: async (/** @type {any} */ c) => (sent.push(structuredClone(c.body.messages)), reply([{ type: "text", text: "Done." }])),
    shellNews: () => (++taken === 1 ? [EXIT, { ...EXIT, id: "bg_x2", text: "second" }] : []),
  }));
  assert.deepEqual(sent[0].at(-1).content, [{ type: "text", text: `${EXIT.text}\nsecond` }, { type: "text", text: "and now?" }]);
  const { byRound } = alignEvents([{ type: "shell-exit", round: 1, shells: [{ id: "bg_x1", command: "npm run build", code: 1 }] }, { type: "round-start", round: 1, blocksBefore: 0 }]);
  assert.deepEqual(byRound.get(1).reports, [{ kind: "shell", agentId: "bg_x1", description: "npm run build", code: 1 }], "told before the round starts, drawn in it");
});

// (fails before: yes — the hunt of 11-02 on Phase 4: an exit that came while a fold's summary was written waited for the
// next round boundary, so the round after the fold went out without it — and a turn that ended there never told it)
test("a shell that exits while a fold's summary is written is told with the round that follows the fold", async () => {
  /** @type {any[]} */
  const sent = [];
  /** @type {any[]} */
  const events = [];
  /** @type {any[]} */
  const exits = [];
  let n = 0;
  let asked = false;
  const out = await runAgentTurn(loopArgs({
    call: async (/** @type {any} */ c) => (sent.push(structuredClone(c.body.messages)), ++n <= 3 ? reply([toolUse(`r${n}`, "read", { path: `${n}.txt` })]) : reply([{ type: "text", text: "Done." }])),
    // The developer's Compact as round three runs: rounds one and two fold, the third stays whole.
    mailbox: { read: () => (n === 3 && !asked ? ((asked = true), [{ kind: "compact", text: "", from: "harness" }]) : []) },
    compact: { usable: 1e9, target: 0, window: 1e9, source: null, fixed: 0, summarize: async () => (exits.push(EXIT), { text: "SUMMARY OF ROUNDS 1-2", by: "m" }) },
    shellNews: () => exits.splice(0),
    onEvent: (/** @type {any} */ e) => events.push(e),
  }));
  assert.equal(out.status, "done", out.notes.join("\n"));
  assert.equal(sent.length, 4, "three rounds of reads, the fold, then the round that ends the turn");
  assert.ok(JSON.stringify(sent[3]).includes("SUMMARY OF ROUNDS 1-2"), "the round after the fold carries its summary");
  const newest = sent[3].at(-1).content;
  assert.deepEqual(newest.map((/** @type {any} */ b) => b.type), ["tool_result", "text"], "the kept round's result, then the exit");
  assert.equal(newest[1].text, EXIT.text);
  assert.deepEqual(events.filter((e) => e.type === "shell-exit").map(({ round, shells }) => ({ round, shells })), [{ round: 3, shells: [{ id: "bg_x1", command: "npm run build", code: 1 }] }]);
  assert.ok(out.notes.includes("agent: 1 background shell exit told after the summary"), out.notes.join("\n"));
});

// ---- the page ----

test("the shell-exit event is in the run vocabulary, and the page draws a row per shell in the round it was told", () => {
  assert.ok(RUN_EVENT_TYPE_LIST.includes("shell-exit"));
  assert.match(RUN_EVENT_FIELDS["shell-exit"], /^round, shells \[\{ id, command/);
  const { byRound } = alignEvents([
    { type: "round-start", round: 1, blocksBefore: 0 },
    { type: "shell-exit", round: 1, shells: [{ id: "bg_a", command: "npm test", code: 0 }, { id: "bg_b", command: "", code: null }] },
  ]);
  assert.deepEqual(byRound.get(1).reports, [{ kind: "shell", agentId: "bg_a", description: "npm test", code: 0 }, { kind: "shell", agentId: "bg_b", description: "", code: null }]);
  assert.equal(shellExitWords(byRound.get(1).reports[0]), "↳ Background shell bg_a (npm test) exited with code 0 — the agent heard of it here");
  assert.equal(shellExitWords(byRound.get(1).reports[1]), "↳ Background shell bg_b exited with code ? — the agent heard of it here");
});

test("under a message: what rode ahead of it, sub-agents' messages and shells' exits apart", () => {
  assert.equal(deliveredWords({}), "");
  assert.equal(deliveredWords({ deliveries: 2 }), "with 2 messages from agents");
  assert.equal(deliveredWords({ deliveries: 1, shellExits: 1 }), "with 1 background shell exit");
  assert.equal(deliveredWords({ deliveries: 3, shellExits: 2 }), "with 1 message from agents and 2 background shell exits");
  assert.equal(deliveredWords({ deliveries: 1, shellExits: 5 }), "with 1 background shell exit", "never more exits than deliveries");
  const [t] = transcriptTurns({ turns: [{ n: 1, turnId: 1, requestIds: [], user: { role: "user", content: [{ type: "text", text: "R" }, { type: "text", text: "X" }, { type: "text", text: "hello" }] }, deliveries: 2, shellExits: 1, work: [], final: null }] });
  assert.equal(t.userText, "hello", "the typed words alone");
  assert.deepEqual([t.deliveries, t.shellExits], [2, 1]);
});

// ---- end to end: a harness session, its turns, a sub-agent ----
const CHILD = "You are a sub-agent run by Filament";
/** @type {string} */ let root;
/** @type {any} */ let up;
/** @type {any} */ let shim;
/** @type {any[]} */ const asked = [];
/** @param {any} m */
const resultsOf = (m) => (Array.isArray(m?.content) ? m.content.filter((/** @type {any} */ b) => b?.type === "tool_result") : []);
/** @param {any} m */
const textsOf = (m) => (typeof m?.content === "string" ? [m.content] : (m?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => String(b.text)));
/** @param {any} c */
const contentText = (c) => (typeof c === "string" ? c : (c || []).map((/** @type {any} */ b) => b?.text || "").join(""));
const EXIT3 = node("setTimeout(()=>process.exit(3),700)");
const EXIT4 = node("setTimeout(()=>{console.log('bye');process.exit(4)},800)");
const EXIT5 = node("setTimeout(()=>process.exit(5),500)");
const EXIT6_LATE = node("setTimeout(()=>process.exit(6),6000)");
const PAUSE = node("setTimeout(()=>{},2000)");
/** How Filament's reminder of a sub-agent's shells still running at its end begins (loop.js `shellsReminder`). */
const SHELLS_LEFT = "[Filament: commands you started in the background still run:";
/** What the sub-agent heard while it worked, said again after the reminder. */
let childHeard = "nothing";

before(async () => {
  root = mkdtempSync(join(tmpdir(), "filament-shell-notices-"));
  up = await fakeUpstream((/** @type {any} */ call) => {
    if (call.kind !== "anthropic") return undefined;
    const body = call.body || {};
    const model = String(body.model || "");
    const msgs = body.messages || [];
    asked.push(msgs);
    const last = msgs.at(-1);
    const said = resultsOf(last).map((/** @type {any} */ r) => contentText(r.content)).join(" | ");
    const notes = textsOf(last).filter((t) => t.startsWith("[Filament: background shell")).join("\n");
    const say = (/** @type {string} */ text) => anthropicReply(text, { model });
    const use = (/** @type {any[][]} */ ...uses) => anthropicReply("", { model, stop: "tool_use", blocks: uses.map(([id, name, input]) => ({ type: "tool_use", id, name, input })) });
    // The sub-agent: two shells, one that ends while it works and one that outlives it; a pause; what it heard — said
    // again, its shell left running, when Filament reminds it of that shell at its end.
    if (JSON.stringify(body.system ?? "").includes(CHILD)) {
      if (textsOf(last).some((t) => t.startsWith(SHELLS_LEFT))) return say(`CHILD HEARD: ${childHeard}`);
      if (!resultsOf(last).length) return use(["c1", "bash_background", { command: EXIT5, grace: 0.1 }], ["c2", "bash_background", { command: EXIT6_LATE, grace: 0.1 }]);
      if (/started/.test(said)) return use(["c3", "bash", { command: PAUSE }]);
      childHeard = notes || "nothing";
      return say(`CHILD HEARD: ${childHeard}`);
    }
    const typed = textsOf([...msgs].reverse().find((/** @type {any} */ m) => m.role === "user" && !resultsOf(m).length)).at(-1) || "";
    if (resultsOf(last).length) {
      if (/^in turn/.test(typed)) return /started/.test(said) ? use(["p1", "bash", { command: PAUSE }]) : say(`HEARD: ${notes || "nothing"}`);
      if (/^sub/.test(typed)) return say(`MAIN SAW: ${said.slice(0, 300)}`);
      return say(`STARTED ${idOf(said)}`);
    }
    if (/^in turn/.test(typed)) return use(["b1", "bash_background", { command: EXIT3, grace: 0.1 }]);
    if (/^leave/.test(typed)) return use(["b2", "bash_background", { command: EXIT4, grace: 0.1 }]);
    if (/^sub/.test(typed)) return use(["a1", "agent", { description: "Shells", prompt: "start shells" }]);
    return say(`FIRST: ${textsOf(msgs.at(-1))[0]}`);
  });
  shim = await startApp({
    memory: true,
    configure: (cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
      cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.memory.autopilot = { enabled: false };
      cfg.memory.capture = { turns: true, learn: false };
      cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
    },
  });
});
after(async () => {
  await shim.stop();
  await up.close();
  await removeDirs(root);
});

const newSession = async () => {
  const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
  assert.equal(r.status, 200, await r.clone().text());
  return String((await r.json()).id);
};
/** One harness turn; its reply's words. @param {string} id @param {string} content */
const turn = async (id, content) => {
  const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
  const raw = await r.text();
  assert.equal(r.status, 200, raw);
  return textsOf(JSON.parse(raw)).join("\n");
};
const transcript = async (/** @type {string} */ id) => (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();

// (fails before: yes — the model heard nothing of the exit)
test("a running turn hears of its shell's exit at the next round boundary, and only there", async () => {
  const a = await newSession();
  const t = await turn(a, "in turn");
  assert.match(t, /HEARD: \[Filament: background shell bg_[0-9a-z]+ \(node -e .*\) exited with code 3 — all of its output was read\.\]/, t);
  assert.deepEqual(peekShellExits({ session: a, agent: null }), [], "told");
  const next = await turn(a, "hello");
  assert.doesNotMatch(next, /background shell/, "and not again with the next turn");
});

// (fails before: yes — the next turn carried nothing)
test("an exit while no turn runs rides ahead of the session's next message, once, and the transcript says so", async () => {
  const a = await newSession();
  const id = /STARTED (bg_[0-9a-z]+)/.exec(await turn(a, "leave one running"))?.[1] || "";
  assert.ok(id);
  await exitsFor({ session: a, agent: null });
  // A chat command is Filament's to answer, not the model's: the exit waits for a turn the model reads.
  const help = await shim.api(`/api/sessions/${encodeURIComponent(a)}/turns`, { method: "POST", body: { content: "/help", stream: false } });
  assert.equal(help.status, 200, await help.text());
  assert.equal(peekShellExits({ session: a, agent: null }).length, 1, "still to be told");
  const t = await turn(a, "hello");
  assert.equal(t, `FIRST: [Filament: background shell ${id} (${EXIT4}) exited with code 4 — 4 characters of its output are unread: bash_output({ id: "${id}" }) reads them.]`);
  const tr = await transcript(a);
  const two = tr.turns.at(-1);
  assert.deepEqual([two.deliveries, two.shellExits], [1, 1]);
  assert.equal(transcriptTurns(tr).at(-1)?.userText, "hello");
  assert.match(await turn(a, "again"), /FIRST: again/, "told once");
});

// HarnessV3-Readiness RD1 c: the page labelled what rode ahead of its message by a guess (the sub-agent store's
// queue, which holds no shells), so an exit notice read as the developer's own words until a reload. The turn's head
// says it now, counted where the queue is taken, and the page's send reads it.
// (fails before: yes — the head said nothing, and postTurn's marks had no counts)
test("RD1 c: the turn's head counts what rode ahead of its message, and the page's send reads it", async () => {
  const a = await newSession();
  assert.ok(idOf(await turn(a, "leave one running")));
  await exitsFor({ session: a, agent: null });
  const help = await shim.api(`/api/sessions/${encodeURIComponent(a)}/turns`, { method: "POST", body: { content: "/help", stream: false } });
  assert.equal(help.status, 200, await help.text());
  assert.deepEqual([help.headers.get("x-filament-deliveries"), help.headers.get("x-filament-shell-exits")], [null, null], "a command's turn carried nothing: the exit waits");
  const realFetch = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ ((/** @type {any} */ u, /** @type {any} */ init) => realFetch(typeof u === "string" && u.startsWith("/") ? shim.url + u : u, init));
  setInboundKey(shim.key);
  try {
    /** @param {string} content */
    const send = async (content) => {
      /** @type {any} */
      let marks = null;
      const r = await postTurn({ chainId: a, content, signal: new AbortController().signal, onHeaders: (_id, m) => { marks = m; }, onEvent: () => {} });
      assert.equal(r.status, 200, r.reply.error || "");
      return { marks, text: r.reply.blocks.filter((b) => b.type === "text").map((b) => b.text).join("") };
    };
    const one = await send("hello");
    assert.match(one.text, /^FIRST: \[Filament: background shell bg_[0-9a-z]+ /, one.text);
    assert.deepEqual([one.marks.deliveries, one.marks.shellExits], [1, 1], "the exit, counted as a delivery and as a shell's");
    assert.equal(deliveredWords(one.marks), "with 1 background shell exit", "the words the row draws from them");
    const two = await send("again");
    assert.deepEqual([two.marks.deliveries, two.marks.shellExits], [0, 0], "told once: the next turn carries nothing");
  } finally {
    globalThis.fetch = realFetch;
    setInboundKey("");
  }
});

// (fails before: yes — the page counted the sub-agent store's queue, guessed; nothing set the counts from the head)
test("RD1 c: the live user row takes its counts from the head and redraws its line; the guess is gone", () => {
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  assert.ok(!/riding/.test(app), "the page no longer guesses from the sub-agent store");
  // (and, the Hunter's find of 10-27: of the shells' items, a watch's lines and a come-back's note, said apart; and a
  // Cancel's word of the come-back, the person's own; and Filament's check-in on a command that ran on, 11-08)
  assert.ok(/if \(marks\.deliveries\) \{\s*turn\.deliveries = marks\.deliveries;\s*if \(marks\.asking\) turn\.asking = marks\.asking;\s*if \(marks\.shellExits\) turn\.shellExits = marks\.shellExits;\s*if \(marks\.shellWatch\) turn\.shellWatch = marks\.shellWatch;\s*if \(marks\.shellWake\) turn\.shellWake = marks\.shellWake;\s*if \(marks\.shellIdle\) turn\.shellIdle = marks\.shellIdle;\s*if \(marks\.shellCancel\) turn\.shellCancel = marks\.shellCancel;\s*transcript\.drawDelivered\(turn\);\s*\}/.test(app), "the head's counts reach the turn, and the row redraws");
  const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
  // (and, HarnessV4_OneAgent_Plan OA2: whom the message named for the main agent to use, swapped in with it; OA3: the
  // /flow mark beside it; the /parallel mark so too, and /plan's)
  assert.ok(/drawDelivered\(turn\) \{[\s\S]*?meta\.querySelector\("\.u-delivered"\)\?\.remove\(\);\s*meta\.querySelector\("\.u-use"\)\?\.remove\(\);\s*meta\.querySelector\("\.u-flow"\)\?\.remove\(\);\s*meta\.querySelector\("\.u-parallel"\)\?\.remove\(\);\s*meta\.querySelector\("\.u-plan"\)\?\.remove\(\);\s*const marks = \[useEl\(turn\), flowEl\(turn\), parallelEl\(turn\), planEl\(turn\), deliveredEl\(turn\)\]\.filter\(Boolean\);\s*const after = meta\.querySelector\("\.u-overrules"\) \|\| meta\.querySelector\("\.u-actions"\);\s*if \(marks\.length\) after\?\.after\(\.\.\.marks\);/.test(timeline), "the timeline swaps the line in place");
  const turnJs = readFileSync("src/ui/harness/conversation/turn.js", "utf8");
  assert.ok(/const delivered = deliveredEl\(turn\);/.test(turnJs), "the first drawing and the redraw share one builder");
});

// (fails before: yes — the turn was taken for a command by its first character, so the exit waited past it)
test("a message that only starts like a command is the model's: the exit rides ahead of it", async () => {
  const a = await newSession();
  const id = /STARTED (bg_[0-9a-z]+)/.exec(await turn(a, "leave one running"))?.[1] || "";
  assert.ok(id);
  await exitsFor({ session: a, agent: null });
  const t = await turn(a, "/tmp/out.txt came out empty — why?");
  assert.match(t, new RegExp(`^FIRST: \\[Filament: background shell ${id} \\(`), t);
  assert.deepEqual(peekShellExits({ session: a, agent: null }), [], "told");
});

// (fails before: yes — the sub-agent heard nothing, and the shell it left was nobody's to hear of)
test("a sub-agent hears of its own shell while it works; the one it left running is told to the main agent's next turn", async () => {
  const a = await newSession();
  const t = await turn(a, "sub shells");
  assert.match(t, /CHILD HEARD: \[Filament: background shell bg_[0-9a-z]+ \(node -e .*exit\(5\).*\) exited with code 5/, t);
  // At its end it was reminded once of the shell still running, by name, and ended again leaving it (g3b, 11-09).
  const reminded = asked.map((m) => m.at(-1)).flatMap((m) => textsOf(m)).filter((x) => x.startsWith(SHELLS_LEFT));
  assert.equal(reminded.length, 1, reminded.join("\n"));
  assert.match(reminded[0], /exit\(6\)/);
  assert.doesNotMatch(reminded[0], /exit\(5\)/, "the one that ended is not named");
  const [late] = await exitsFor({ session: a, agent: null });
  assert.match(late.text, /\(node -e .*exit\(6\).*\), started by sub-agent \S+, exited with code 6/);
  assert.match(await turn(a, "hello"), /FIRST: \[Filament: background shell bg_[0-9a-z]+ .*started by sub-agent/);
});
