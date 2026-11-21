// @ts-check
// HarnessV3-TaskGraph-v2 §12 (V2-0a), the pure parts a lead's look stands on: a worker's trail as its run log holds it
// (core/run-work.js `trailOf`, TG2-D14) — every round's words whole, shown once across looks, what came before counted,
// and never its thinking (§13.17 TG2-D60) — and the signs that make a look due at once (core/signs.js, TG2-D15).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runningWork, trailOf, workOfRun } from "../src/core/run-work.js";
import { newSignState, outsideWhy, signStep, signsOf } from "../src/core/signs.js";

/** A run's events, numbered as the run log numbers them. @param {any[]} list */
const numbered = (list) => list.map((e, i) => ({ n: i + 1, ...e }));
const card = (/** @type {string} */ kind, /** @type {string} */ subject) => ({ card: { kind, title: kind, subject } });
const LOG = numbered([
  { type: "run-start" },
  { type: "round-start", round: 1 },
  { type: "round-thinking", round: 1, thinking: "The brief wants integers. I will read the parser first." },
  { type: "round-text", round: 1, text: "Plan: read src/ledger.js, change parse(), prove it with npm test." },
  { type: "tool-start", round: 1, id: "c1", name: "read", args: "src/ledger.js", ...card("read", "src/ledger.js") },
  { type: "tool-end", round: 1, id: "c1", name: "read", ok: true, chars: 6120, preview: "FILE-BODY" },
  { type: "round-start", round: 2 },
  { type: "round-thinking", round: 2, thinking: "parse() uses floats. Switch to cents." },
  { type: "tool-start", round: 2, id: "c2", name: "edit", args: "src/ledger.js", ...card("edit", "src/ledger.js") },
  { type: "tool-end", round: 2, id: "c2", name: "edit", ok: true, chars: 40 },
  { type: "tool-start", round: 2, id: "c3", name: "bash", args: "npm test -- ledger", ...card("shell", "npm test -- ledger") },
]);

describe("a worker's trail, from its run log (TG2-D14)", () => {
  test("a round's words are whole, with each call by its target and how it ended — and none of its thinking", () => {
    const t = trailOf(LOG);
    assert.deepEqual(t.rounds.map((r) => r.n), [1, 2]);
    // (fails before: yes — TG2-D14 gave a round's thinking whole, which TG2-D60 took out of every trail: no lead reads a
    // worker's thinking)
    assert.ok(!JSON.stringify(t).includes("I will read the parser") && !JSON.stringify(t).includes("Switch to cents"), JSON.stringify(t));
    assert.deepEqual(t.rounds[0].said, ["Plan: read src/ledger.js, change parse(), prove it with npm test."]);
    assert.deepEqual(t.rounds[0].calls.map((c) => [c.name, c.args, c.kind, c.ended, c.chars, c.fresh]), [["read", "src/ledger.js", "read", "ok", 6120, true]]);
    assert.deepEqual(t.rounds[1].calls.map((c) => [c.name, c.ended]), [["edit", "ok"], ["bash", "running"]]);
    assert.deepEqual([t.rounds[0].continued, t.rounds[1].continued], [false, false]);
    assert.deepEqual(t.plan, { round: 1, text: "Plan: read src/ledger.js, change parse(), prove it with npm test." });
    assert.deepEqual([t.round, t.firstRound, t.event], [2, 1, 11]);
    assert.deepEqual(t.before, { from: 0, to: 0, reads: 0, changed: [], commands: [], others: 0, read: { lead: 0, developer: 0 } });
  });

  test("across two looks nothing is shown twice: a call that was running comes back by its end alone", () => {
    const first = trailOf(LOG);
    const later = [
      ...LOG,
      { n: 12, type: "tool-end", round: 2, id: "c3", name: "bash", ok: false, exitCode: 1, chars: 300, preview: "1 failing\n  expected 1050" },
      { n: 13, type: "steer", id: "m1", kind: "note", text: "keep amounts as integers", from: "lead", at: 1000 },
      { n: 14, type: "steer-read", ids: ["m1"], kinds: ["note"] },
      { n: 15, type: "round-start", round: 3 },
      { n: 16, type: "round-thinking", round: 3, thinking: "The lead wants integers; cents it is." },
      { n: 17, type: "round-text", round: 3, text: "Understood: integers." },
    ];
    const t = trailOf(later, { since: first.event });
    assert.deepEqual(t.rounds.map((r) => [r.n, r.continued]), [[2, true], [3, false]]);
    assert.deepEqual(t.rounds[0].said, [], "round 2 said nothing");
    assert.deepEqual(t.rounds[0].calls.map((c) => [c.id, c.fresh, c.ended, c.exit, c.preview]), [["c3", false, "failed", 1, "1 failing\n  expected 1050"]]);
    assert.deepEqual(t.rounds[0].read.map((m) => [m.text, m.from]), [["keep amounts as integers", "lead"]]);
    assert.deepEqual(t.rounds[1].said, ["Understood: integers."]);
    assert.ok(!JSON.stringify(t).includes("cents it is"), "its thinking is in no round (TG2-D60)");
    assert.ok(!JSON.stringify(t.rounds).includes("FILE-BODY") && !JSON.stringify(t.rounds).includes("I will read the parser"), "rounds 1 and 2 are not said again");
    // What the first look showed is counted, and the plan is still whole: a look stands without the one before it.
    assert.deepEqual(t.before, { from: 1, to: 2, reads: 1, changed: ["src/ledger.js"], commands: [{ command: "npm test -- ledger", runs: 1, exit: null }], others: 0, read: { lead: 0, developer: 0 } });
    assert.equal(t.plan?.text, "Plan: read src/ledger.js, change parse(), prove it with npm test.");
    // With nothing new, no round — and the same count.
    const still = trailOf(later, { since: 17 });
    assert.deepEqual(still.rounds, []);
    assert.deepEqual([still.before.from, still.before.to, still.before.read.lead], [1, 3, 1]);
    assert.deepEqual(still.before.commands, [{ command: "npm test -- ledger", runs: 1, exit: 1 }]);
  });

  // (fails before: yes — until TG2-D60 a first reply that only thought was the plan, from its thinking)
  test("a message not read yet is told apart, and a first reply that only thought has said no plan", () => {
    const t = trailOf(numbered([
      { type: "round-start", round: 1 },
      { type: "round-thinking", round: 1, thinking: "I will grep for parse." },
      { type: "tool-start", round: 1, id: "c1", name: "grep", args: "parse", ...card("search", "parse") },
      { type: "steer", id: "m1", kind: "note", text: "use the fixtures", from: "lead", at: 5000 },
      { type: "steer", id: "m2", kind: "note", text: "and be quick", from: "harness", at: 6000 },
    ]));
    assert.deepEqual(t.unread.map((m) => [m.text, m.from, m.sentAt]), [["use the fixtures", "lead", 5000], ["and be quick", "harness", 6000]]);
    assert.equal(t.plan, null);
  });

  test("a log that lost its start says from which round it holds the run", () => {
    const t = trailOf(LOG.slice(6));
    assert.deepEqual([t.firstRound, t.rounds.map((r) => r.n)], [2, [2]]);
  });

  test("the other readers of a run answer as before", () => {
    // (the trail's parts ride the same reading: a round that only thought is still nothing to a reader beside the turn)
    const quiet = [...LOG, { n: 12, type: "round-start", round: 3 }, { n: 13, type: "round-thinking", round: 3, thinking: "hm" }];
    assert.deepEqual(runningWork(quiet, { since: 11 }), { older: [], newest: [], rounds: 0, tools: 0, event: 13 });
    const w = workOfRun(LOG);
    assert.deepEqual([w.rounds, w.tools], [2, 3]);
    assert.ok(!JSON.stringify(w.work).includes("I will read the parser"), "a turn's work holds no thinking");
    assert.deepEqual(w.work[0].content.map((/** @type {any} */ b) => b.type), ["text", "tool_use"]);
  });
});

describe("the signs on a trail (TG2-D15)", () => {
  test("the plan once the run goes on from it, the first change, the same failure a third time, and a call that waits for the developer", () => {
    const fail = (/** @type {number} */ k) => [
      { type: "tool-start", round: 3, id: `t${k}`, name: "bash", args: "npm test" },
      { type: "tool-end", round: 3, id: `t${k}`, name: "bash", ok: false, exitCode: 1 },
    ];
    const signs = signsOf(numbered([...LOG, { type: "tool-end", round: 2, id: "c3", name: "bash", ok: false, exitCode: 1 }, ...fail(1), ...fail(2), ...fail(3), ...fail(4), { type: "ask", round: 3, kind: "permission", tool: "bash", waits: true }]));
    assert.deepEqual(signs.map((s) => [s.kind, s.round, s.at]), [["plan", 1, 5], ["change", 2, 9], ["failure", 3, 18], ["failure", 3, 20], ["asks", 3, 21]]);
    // A first reply the run ends on is no sign: it is the report.
    assert.deepEqual(signsOf(numbered([{ type: "round-start", round: 1 }, { type: "round-text", round: 1, text: "REPORT: done." }, { type: "run-end" }])), []);
    assert.deepEqual(signsOf(numbered([{ type: "round-text", round: 1, text: "I will look." }, { type: "round-start", round: 2 }])).map((s) => [s.kind, s.round, s.at]), [["plan", 1, 2]]);
    assert.equal(signs[1].words, "made its first change (src/ledger.js)");
    assert.equal(signs[2].words, "the same command failed a third time (`npm test`)");
    assert.equal(signs[3].words, "the same command failed 4 times (`npm test`)");
  });

  test("a write outside its files is named once for each path, and a list's entry that is no path names none", () => {
    const files = { files: ["src/ledger.js", "the tests for money"], dontTouch: ["src/api/", "anything public"] };
    assert.equal(outsideWhy(files, "src/ledger.js"), null);
    assert.equal(outsideWhy(files, "src/cli.js"), "wrote outside its files");
    assert.equal(outsideWhy(files, "src/api/routes.js"), "wrote to a file its brief said not to touch");
    assert.equal(outsideWhy({ writes: ["src/**/*.js"] }, "docs/a.md"), "wrote outside its task's writes");
    assert.equal(outsideWhy({ writes: ["src/**/*.js"] }, "src/a/b.js"), null);
    // A brief whose lists hold only words (no path) names no files, so nothing is outside them.
    assert.equal(outsideWhy({ files: ["the parser and its tests"] }, "src/cli.js"), null);
    assert.equal(outsideWhy(null, "src/cli.js"), null);
    const state = newSignState();
    const write = (/** @type {string} */ id, /** @type {string} */ path) => signStep(state, { type: "tool-start", round: 2, id, name: "edit", args: path, card: { kind: "edit", subject: path } }, files);
    assert.deepEqual(write("a", "src/cli.js").map((s) => s.kind), ["change", "outside"]);
    assert.deepEqual(write("b", "src/cli.js"), [], "the same path is said once");
    assert.deepEqual(write("c", "src/ledger.js"), []);
    assert.deepEqual(write("d", "src/api/x.js").map((s) => s.words), ["wrote to a file its brief said not to touch (src/api/x.js)"]);
  });

  test("a command that never ran, or that a stop cut, is no failure", () => {
    const state = newSignState();
    // Refused, stopped, never run, exit 0, and a timeout that left no exit: five ends, none a failure.
    for (const end of [{ exitCode: 2, refused: true }, { exitCode: 2, stopped: true }, { exitCode: 2, notRun: true }, { exitCode: 0 }, {}]) {
      signStep(state, { type: "tool-start", round: 1, id: "x", name: "bash", args: "make" });
      assert.deepEqual(signStep(state, { type: "tool-end", round: 1, id: "x", name: "bash", ok: false, ...end }), []);
    }
    assert.equal(state.fails.get("make") ?? 0, 0);
  });
});
