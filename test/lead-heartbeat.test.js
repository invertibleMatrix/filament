// @ts-check
// HarnessV3-TaskGraph-v2 §13.13, Phase 2's TG2-D48: looks on signs, and a heartbeat of 5 minutes. A look came after
// nearly every wait — with the pace at 30 s, and every wait asking for one when it ended, a time-out too — so a lead
// read the same picture again and again, and a Claude Code lead, whose wait holds 45 s, one every 45 s. Now the pace
// is five minutes, two more moments are signs that make a look due at once — a step that cannot be undone, and a
// compaction that may have taken a worker's brief — and a wait that only ran out of time shows a look only where one
// is due. A loop lead's time-out round leaves its conversation with the next look, as a quiet wait does. The pure parts
// here; the seats' waits in agent-lead-reads.test.js and lead-reads.test.js.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { KNOBS, lookSecondsOf } from "../src/services/session-settings.js";
import { newSignState, oneWayOf, signStep, signsOf } from "../src/core/signs.js";
import { newWatchState, watchStep } from "../src/core/watch.js";
import { LOOK_STUB, createLooks, isLook, newMark, noted, tidyLooks } from "../src/app/agent/looks.js";
import { PROMPT, TOOL_TEXT } from "../src/app/agent/prompt.js";

/** A run's events, numbered as the run log numbers them. @param {any[]} list */
const numbered = (list) => list.map((e, i) => ({ n: i + 1, ...e }));
const shell = (/** @type {string} */ id, /** @type {number} */ round, /** @type {string} */ command) => ({ type: "tool-start", round, id, name: "bash", args: command, card: { kind: "shell", title: "bash", subject: command } });
/** The signs one event shows on a fresh run, by their words. @param {any} e */
const wordsOf = (e) => signStep(newSignState(), { n: 5, ...e }).map((s) => s.words);

describe("the pace (TG2-D48)", () => {
  // (fails before: yes — the default was 30 s)
  test("its default is 300 s, five minutes: the setting, and a session that names none", () => {
    assert.equal(KNOBS["engine.lookSeconds"].default, 300);
    assert.ok(String(KNOBS["engine.lookSeconds"].doc).includes("The default, 300, is five minutes."), KNOBS["engine.lookSeconds"].doc);
    assert.deepEqual([lookSecondsOf(null), lookSecondsOf({ engine: {} }), lookSecondsOf({ engine: { lookSeconds: 0 } }), lookSecondsOf({ engine: { lookSeconds: 45 } })], [300, 300, 0, 45]);
  });
});

describe("two more signs (TG2-D48)", () => {
  // (fails before: yes — a step that cannot be undone was the watcher's sign alone)
  test("a step that cannot be undone: when the worker asks to run it, or starts it — once for each command", () => {
    const signs = signsOf(numbered([
      { type: "round-start", round: 1 },
      { type: "ask", round: 1, kind: "permission", tool: "bash", question: "May I run bash `git push origin main`?", command: "git push origin main", waits: true },
      shell("c1", 1, "git push origin main"),
      shell("c2", 2, "git reset --hard HEAD~1"),
      shell("c3", 2, "git status"),
      shell("c4", 3, "git reset --hard HEAD~1"),
    ]));
    assert.deepEqual(signs.map((s) => [s.kind, s.round, s.at, s.words]), [
      ["asks", 1, 2, "waits for the developer's answer (bash)"],
      ["one-way", 1, 2, "asks to run a step that cannot be undone: a push (`git push origin main`)"],
      ["one-way", 2, 4, "tried a step that cannot be undone: a hard reset (`git reset --hard HEAD~1`)"],
    ]);
    // A coding agent's call starts before its question: the start is the sign, and its question is the developer's.
    assert.deepEqual(signsOf(numbered([shell("c1", 1, "rm -rf build"), { type: "ask", round: 1, kind: "permission", tool: "Bash", question: "rm -rf build", waits: true }])).map((s) => s.words), [
      "tried a step that cannot be undone: a recursive delete (`rm -rf build`)",
      "waits for the developer's answer (Bash)",
    ]);
    // A call that only reads, or a change to a file, is no such step.
    assert.deepEqual(wordsOf(shell("c1", 1, "git log --oneline")), []);
    assert.deepEqual(wordsOf({ type: "ask", round: 1, kind: "permission", tool: "edit", question: "May I edit a.js?", waits: true }), ["waits for the developer's answer (edit)"]);
  });

  // (fails before: no — a guard: the list moved into core/signs.js, and the watcher and the grants read it there)
  test("one list of such steps: the watcher still names them, and oneWayOf reads as before", () => {
    assert.deepEqual([oneWayOf("git push"), oneWayOf("npm publish"), oneWayOf("git status")], ["a push", "a publish", null]);
    const state = newWatchState();
    assert.deepEqual(watchStep(state, shell("c1", 1, "git push --force")).map((s) => [s.kind, s.words]), [["one-way", "ran a step that cannot be undone: a push (`git push --force`)"]]);
  });

  // (fails before: yes — a compaction was in the watch line alone, and made no look due)
  test("a compaction that folded something, in words that say what is a summary now; one that folded nothing is none", () => {
    assert.deepEqual(wordsOf({ type: "compaction", round: 7, fromRound: 1, toRound: 6, tokensBefore: 90_000, tokensAfter: 20_000, by: "m-1" }), ["compacted its context: its rounds 1 to 6 are a summary now — its brief stays whole"]);
    assert.deepEqual(wordsOf({ type: "compaction", round: 2, fromRound: 1, toRound: 1, tokensBefore: 9, tokensAfter: 2 }), ["compacted its context: its round 1 is a summary now — its brief stays whole"]);
    assert.deepEqual(wordsOf({ type: "compaction", round: 7, fromRound: 1, toRound: 6, tokensBefore: 9, tokensAfter: 2, manual: true }), ["compacted its context on the developer's request: its rounds 1 to 6 are a summary now — its brief stays whole"]);
    assert.deepEqual(wordsOf({ type: "compaction", round: 4, why: "overflow-refusal", cleared: 3, folded: true }), ["compacted its context after its provider refused a round for size: its oldest rounds are a summary now — its brief stays whole"]);
    assert.deepEqual(wordsOf({ type: "compaction", round: 4, why: "overflow-refusal", cleared: 3, folded: false }), ["compacted its context after its provider refused a round for size: its old tool results were cleared"]);
    assert.deepEqual(wordsOf({ type: "compaction", round: 3, own: true, by: "Claude Code", tokensBefore: 150_000, tokensAfter: 30_000 }), ["compacted its own context: its brief and what it read may be only a summary now"]);
    // A fold that stood down, a Compact that found too little, one the agent failed, earlier turns that could not give way.
    for (const e of [{ stoodDown: true }, { manual: true, result: "little" }, { manual: true, result: "empty" }, { own: true, result: "failed", error: "x" }, { earlier: true, result: "none", error: "x" }]) assert.deepEqual(wordsOf({ type: "compaction", round: 3, ...e }), [], JSON.stringify(e));
    // Each one is a sign: a second fold is named again.
    const both = signsOf(numbered([{ type: "compaction", round: 4, fromRound: 1, toRound: 3 }, { type: "compaction", round: 8, fromRound: 4, toRound: 7 }]));
    assert.deepEqual(both.map((s) => [s.kind, s.round]), [["compacted", 4], ["compacted", 8]]);
  });

  // (fails before: yes — neither moment made a look due, so it waited for the pace)
  test("either makes a look due at once, whatever the pace", () => {
    for (const e of [shell("c1", 2, "git push"), { type: "compaction", round: 2, fromRound: 1, toRound: 1 }]) {
      const mark = newMark();
      let rang = 0;
      const looks = createLooks({ now: () => 1000, later: () => {}, seconds: () => 300, lean: false, workers: () => [{ id: "sa_1", role: "builder", description: "d", task: null, run: "r1", head: [], mark }], eventsOf: () => [], wake: () => rang++ });
      looks.take();
      assert.equal(looks.due(), false, "nothing new since the look");
      noted(mark, { n: 9, ...e });
      looks.ring();
      assert.deepEqual([looks.due(), rang], [true, 1], JSON.stringify(e));
    }
  });
});

describe("a time-out's round leaves with the next look (TG2-D48, TG2-D24)", () => {
  const LOOK_1 = "[Filament: a look at your workers. 1 is running.]\n\n## builder sa_1 — \"Fix it\"\nround 1";
  const LOOK_2 = "[Filament: a look at your workers, in place of the one before. Since it: 1 moved, 0 did not.]\n\n## builder sa_1 — \"Fix it\"\nround 2";
  const wait = (/** @type {string} */ id) => ({ role: "assistant", content: [{ type: "tool_use", id, name: "wait", input: { seconds: 300 } }] });
  const result = (/** @type {string} */ id, /** @type {string} */ text, /** @type {any[]} */ more = []) => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content: text }, ...more] });

  // (fails before: yes — a wait answered with no look was no quiet round: it stayed, and the next look stood after it)
  test("a wait that only ran out of time, with no look, and the quiet wait after it both leave once the next look stands in the first one's place", () => {
    const convo = [
      { role: "user", content: "fix the parser" },
      { role: "assistant", content: [{ type: "tool_use", id: "launch", name: "agent", input: {} }] },
      result("launch", "Launched builder sa_1.", [{ type: "text", text: LOOK_1 }]),
      wait("w1"),
      result("w1", "Waited 300 s: no report yet, and no look is due — Filament shows you one at once on a sign, else every 5 min while something is new.\n\nWorkers still running (1):\n- builder sa_1"),
      wait("w2"),
      result("w2", "Waited 40 s: your workers moved. A look follows as a message.", [{ type: "text", text: LOOK_2 }]),
    ];
    const t = tidyLooks(convo, { from: 1, own: 1 });
    assert.deepEqual(t, { lined: 1, left: 2 });
    assert.equal(convo.length, 3);
    assert.deepEqual(/** @type {any[]} */ (convo[2].content).map((b) => (b.type === "text" ? b.text : b.type)), ["tool_result", LOOK_2]);
    assert.equal(convo.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter(isLook).length, 1);
    assert.deepEqual(tidyLooks(convo, { from: 1, own: 1 }), { lined: 0, left: 0 }, "twice in a row it changes nothing");
  });

  // (fails before: no — a guard: words beside a wait, a report or a message keep their round)
  test("a time-out round with words of the lead's, or before the turn's own work, stays", () => {
    const said = [
      { role: "user", content: "fix the parser" },
      { role: "assistant", content: [{ type: "tool_use", id: "launch", name: "agent", input: {} }] },
      result("launch", "Launched.", [{ type: "text", text: LOOK_1 }]),
      { role: "assistant", content: [{ type: "text", text: "The builder reads first; I keep watching." }, { type: "tool_use", id: "w1", name: "wait", input: {} }] },
      result("w1", "Waited 300 s: no report yet, and no look is due — …"),
      wait("w2"),
      result("w2", "Waited 3 s: your workers moved. A look follows as a message.", [{ type: "text", text: LOOK_2 }]),
    ];
    assert.deepEqual(tidyLooks(said, { from: 1, own: 1 }), { lined: 1, left: 0 });
    assert.equal(said.length, 7);
    assert.equal(said[2].content[1].text, LOOK_STUB);
    const early = [
      { role: "user", content: "fix the parser" },
      wait("w1"),
      result("w1", "Waited 300 s: no report yet, and no look is due — …"),
      wait("w2"),
      result("w2", "Waited 3 s: your workers moved. A look follows as a message.", [{ type: "text", text: LOOK_2 }]),
    ];
    assert.deepEqual(tidyLooks(early, { from: 1, own: 3 }), { lined: 0, left: 0 }, "the turn's own work starts after them");
    assert.equal(early.length, 5);
    // Before the turn's first look nothing takes a time-out's place: it stays, so the rounds that leave stay the newest.
    const before = [
      { role: "user", content: "fix the parser" },
      { role: "assistant", content: [{ type: "tool_use", id: "launch", name: "agent", input: {} }] },
      result("launch", "Launched builder sa_1."),
      wait("w1"),
      result("w1", "Waited 300 s: no report yet, and no look is due — …"),
      wait("w2"),
      result("w2", "Waited 3 s: your workers moved. A look follows as a message.", [{ type: "text", text: LOOK_1 }]),
    ];
    assert.deepEqual(tidyLooks(before, { from: 1, own: 1 }), { lined: 0, left: 0 });
    assert.equal(before.length, 7);
  });
});

describe("the words (TG2-D48, prompt version 27)", () => {
  const SIGNS = "at once on a sign — a worker said its plan, made its first change, wrote outside its files, failed the same command a third time, tried a step that cannot be undone, compacted its context, or waits for an answer — else at the developer's pace while something is new";
  // (fails before: yes — both lines said a look came when the wait ended, whatever ended it)
  test("the leads' look lines name the signs and the pace; neither names a number", () => {
    assert.ok(String(PROMPT.leadLooks).startsWith(`- While your workers run, Filament shows you a look at them: ${SIGNS}, and when a report or a message ends your wait. For each worker it gives its plan as it said it`), PROMPT.leadLooks);
    assert.ok(String(PROMPT.leadLooksOwn).startsWith(`- While your workers run, Filament shows you a look at them: ${SIGNS}: as your wait's answer, between your own steps, or as your next message once your turn ended. For each worker it gives every round since your last look`), PROMPT.leadLooksOwn);
    assert.ok(String(PROMPT.graphLooks).includes("at once on a sign, else at the developer's pace while something is new, and when a report or a message ends your wait"), PROMPT.graphLooks);
    for (const line of [PROMPT.leadLooks, PROMPT.leadLooksOwn, PROMPT.graphLooks]) assert.ok(!/\b(30|300) s\b|five minutes|5 min/.test(String(line)), "the pace may change mid-turn: no number");
  });

  // (fails before: yes — the waits promised a look whatever ended them)
  test("the waits say a time-out with no look due lists the workers instead", () => {
    assert.ok(TOOL_TEXT.teamWaitReads.includes("A look (each worker still running, with every round since your last look) follows as a message, in place of the one before; a wait that only ran out of time, with no look due, lists the workers still running instead."), TOOL_TEXT.teamWaitReads);
    assert.ok(TOOL_TEXT.teamWaitOwn.includes("It answers with what came, and a look at the workers still running when one is due (what each said and did since your last look), or else a line for each."), TOOL_TEXT.teamWaitOwn);
    assert.ok(TOOL_TEXT.waitReads.includes("follows as a message, in place of the one before, unless the wait only ran out of time with no look due."), TOOL_TEXT.waitReads);
  });

  // (fails before: yes — the setting's list of signs was five)
  test("the setting names the new signs", () => {
    const doc = String(KNOBS["engine.supervise"].doc);
    assert.ok(doc.includes("it tried a step that cannot be undone, it compacted its context, it asks its lead or it waits for your answer"), doc);
  });
});
