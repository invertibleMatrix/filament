// @ts-check
// A chat's own times, the keeper alone (app/watchers/own-times.js): what it holds of each chat as the bus and the
// hands' list say it — a command's time, one that waits for the person's answer, one that never ran, a helper's run
// with hooks, the turn rule, a background command's edges and the wait for its end, its bounds — and a chat's
// file-writing calls with the paths their starts say (`edits`, services/runs.js RUN_EVENT_FIELDS). Driven directly: no
// repository and no watcher. Whose a commit is, judged by these times, is git-watch.test.js's and
// watch-commit-own.test.js's.
// (fails before: yes, each — there was no keeper: the commit watch held these times where no other source could read
// them, and nothing kept a chat's file-writing calls)
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createEventBus } from "../src/services/events.js";
import { createOwnTimes } from "../src/app/watchers/own-times.js";

const T = 1_800_000_000_000;
const MIN = 60_000;
const A = resolve("/work/proj/src/a.js");
const B = resolve("/work/proj/b.txt");

/** A run begun, as the run log says it: a chat's own turn's unless `kind` says. @param {string} chain @param {Record<string, unknown>} [meta] */
const began = (chain, meta = {}, kind = "agent-turn") => ({ type: "run-start", kind, title: null, parentId: null, meta: { chain, ...meta } });
/** A run's end. */
const over = (status = "done") => ({ type: "run-end", status, summary: null });
/** A shell call's start, marked `command` as its engine says of one that could have made a commit. @param {string} id @param {Record<string, unknown>} [more] */
const runs = (id, more = { command: true }) => ({ type: "tool-start", round: 1, name: "bash", args: "", card: { kind: "shell", title: "Run", subject: "" }, id, ...more });
/** A file-writing call's start, with what it says it writes. @param {string} id @param {string[] | true} edits */
const writes = (id, edits) => ({ type: "tool-start", round: 1, name: "edit", args: "", card: { kind: "edit", title: "Edit", subject: "" }, id, edits });
/** A call's end. @param {string} id @param {Record<string, unknown>} [more] */
const ends = (id, more = {}) => ({ type: "tool-end", round: 1, name: "bash", ok: true, ms: 1, id, ...more });

describe("a chat's own times: its commands, as their runs say them", () => {
  test("a command's time is from its call's start to its end; a call not marked `command`, and one of a run no chat is known for, are none", () => {
    const own = createOwnTimes();
    own.runEvent("t1", began("c1"), T);
    own.runEvent("t1", runs("u1"), T + 100);
    assert.deepEqual(own.timesOf("c1"), [{ from: T + 100, to: null }], "running: no end yet");
    own.runEvent("t1", ends("u1"), T + 900);
    assert.deepEqual(own.timesOf("c1"), [{ from: T + 100, to: T + 900 }]);
    // Read as only reading by its engine: its start says no `command`.
    own.runEvent("t1", runs("u2", {}), T + 1000);
    own.runEvent("t1", ends("u2"), T + 1100);
    // A run whose start was never heard is of no chat.
    own.runEvent("t9", runs("u3"), T + 1200);
    assert.deepEqual(own.timesOf("c1"), [{ from: T + 100, to: T + 900 }]);
    assert.deepEqual(own.timesOf("c2"), [], "a chat never heard of has none");
  });

  test("a sub-agent's run is counted with the chat it is of, and a coding agent's own sub-agent's call with its agent's", () => {
    const own = createOwnTimes();
    own.runEvent("t1", began("c1"), T);
    own.runEvent("s1", began("c1", { subagent: "sa_1" }, "subagent"), T + 10);
    own.runEvent("s1", runs("u1"), T + 20);
    own.runEvent("t1", over(), T + 30);
    own.runEvent("s1", ends("u1"), T + 40);
    own.runEvent("t2", began("c1", {}, "coding-agent"), T + 50);
    own.runEvent("t2", { ...runs("k1"), type: "subagent-tool-start", parent: "task1" }, T + 60);
    own.runEvent("t2", { ...ends("k1"), type: "subagent-tool-end", parent: "task1" }, T + 70);
    assert.deepEqual(own.timesOf("c1"), [{ from: T + 20, to: T + 40 }, { from: T + 60, to: T + 70 }]);
  });

  test("one that waits for the person's answer runs nothing meanwhile: it begins as it is answered, and is none where it ends unanswered", () => {
    const own = createOwnTimes();
    own.runEvent("t1", began("c1"), T);
    own.runEvent("t1", runs("u1"), T + 100);
    own.runEvent("t1", { type: "ask", round: 1, kind: "permission", tool: "bash", question: "May I?", waits: true, id: "q1", call: "u1" }, T + 110);
    assert.deepEqual(own.timesOf("c1"), [], "asked: nothing runs yet");
    own.runEvent("t1", { type: "ask-end", round: 1, id: "q1", call: "u1", outcome: "answered", words: [] }, T + 5000);
    assert.deepEqual(own.timesOf("c1"), [{ from: T + 5000, to: null }], "answered: it runs from here");
    own.runEvent("t1", ends("u1"), T + 6000);
    assert.deepEqual(own.timesOf("c1"), [{ from: T + 5000, to: T + 6000 }]);
    // Asked, and ended with no answer heard: it never ran.
    own.runEvent("t1", runs("u2"), T + 7000);
    own.runEvent("t1", { type: "ask", round: 1, kind: "permission", tool: "bash", question: "May I?", waits: true, id: "q2", call: "u2" }, T + 7010);
    own.runEvent("t1", ends("u2", { ok: false }), T + 8000);
    assert.deepEqual(own.timesOf("c1"), [{ from: T + 5000, to: T + 6000 }]);
  });

  test("a call that ran nothing — refused, declined, vetoed, not run — is none; one its run's end finds running ended there", () => {
    const own = createOwnTimes();
    own.runEvent("t1", began("c1"), T);
    for (const [i, how] of ["refused", "declined", "vetoed", "notRun"].entries()) {
      own.runEvent("t1", runs(`n${i}`), T + 10 * i);
      own.runEvent("t1", ends(`n${i}`, { ok: false, [how]: true }), T + 10 * i + 1);
    }
    assert.deepEqual(own.timesOf("c1"), []);
    own.runEvent("t1", runs("u1"), T + 100);
    own.runEvent("t1", over("stopped"), T + 300);
    assert.deepEqual(own.timesOf("c1"), [{ from: T + 100, to: T + 300 }], "cut by its run's end");
    // Nothing of that run is heard past its end.
    own.runEvent("t1", runs("u2"), T + 400);
    assert.deepEqual(own.timesOf("c1"), [{ from: T + 100, to: T + 300 }]);
  });

  test("a helper's run whose session hooks run commands is its chat's time whole, from its start to its end", () => {
    const own = createOwnTimes();
    own.runEvent("s1", began("c1", { subagent: "sa_1", hooks: true }, "subagent"), T);
    assert.deepEqual(own.timesOf("c1"), [{ from: T, to: null }]);
    own.runEvent("s1", over(), T + 4000);
    assert.deepEqual(own.timesOf("c1"), [{ from: T, to: T + 4000 }]);
    // A helper's run with no such hooks is judged by its commands alone.
    own.runEvent("s2", began("c1", { subagent: "sa_2" }, "subagent"), T + 5000);
    own.runEvent("s2", over(), T + 6000);
    assert.deepEqual(own.timesOf("c1"), [{ from: T, to: T + 4000 }]);
  });
});

describe("a chat's own times: its turns, where its commands are not all said", () => {
  test("a turn no run of the chat's own is heard in is its time whole; one whose run is heard is none, unless its session hooks run commands", () => {
    const own = createOwnTimes();
    own.turnBegan("c1", T);
    assert.deepEqual(own.timesOf("c1"), [{ from: T, to: null }], "until its run starts");
    own.turnEnded("c1", T + 1000);
    assert.deepEqual(own.timesOf("c1"), [{ from: T, to: T + 1000 }], "no run heard: the turn rule");
    own.turnBegan("c1", T + 2000);
    own.runEvent("t1", began("c1"), T + 2010);
    assert.deepEqual(own.timesOf("c1"), [{ from: T, to: T + 1000 }], "its run heard: judged by its commands");
    // Its lock said again while it is at work — a phase of it — begins no turn.
    own.turnBegan("c1", T + 2500);
    own.runEvent("t1", over(), T + 2900);
    own.turnEnded("c1", T + 3000);
    assert.deepEqual(own.timesOf("c1"), [{ from: T, to: T + 1000 }]);
    own.turnBegan("c1", T + 4000);
    own.runEvent("t2", began("c1", { hooks: true }), T + 4010);
    own.turnEnded("c1", T + 5000);
    assert.deepEqual(own.timesOf("c1"), [{ from: T, to: T + 1000 }, { from: T + 4000, to: T + 5000 }], "its hooks' commands are unsaid: the turn whole");
    // A helper's run heard in a turn says nothing of the turn's own commands.
    own.turnBegan("c2", T);
    own.runEvent("s1", began("c2", { subagent: "sa_1" }, "subagent"), T + 10);
    assert.deepEqual(own.timesOf("c2"), [{ from: T, to: null }]);
  });

  test("the bus, as the server says it: the turns' lock taken and let go, and each run's events under its topic", () => {
    const own = createOwnTimes();
    const bus = createEventBus();
    const off = own.listen(bus);
    const t0 = Date.now();
    bus.publish("turns", { type: "turn", chainId: "c1", holder: { id: "turn-of-c1", window: "harness" } });
    assert.equal(own.timesOf("c1").length, 1, "its lock taken: a turn");
    bus.publish("run:t1", began("c1"));
    assert.deepEqual(own.timesOf("c1"), [], "its run heard");
    bus.publish("run:t1", runs("u1"));
    bus.publish("run:t1", writes("w1", [A]));
    bus.publish("run:t1", ends("u1"));
    bus.publish("run:t1", { ...ends("w1"), name: "edit" });
    bus.publish("turns", { type: "turn", chainId: "c1", holder: null });
    // Other topics, and other events of the turns', are none of its.
    bus.publish("turns", { type: "commands", chainId: "c1", commands: [] });
    bus.publish("spaces", { type: "turn", chainId: "c1", holder: { id: "x" } });
    const t1 = Date.now();
    const [time, ...more] = own.timesOf("c1");
    assert.ok(more.length === 0 && time.to != null && time.from >= t0 && time.from <= time.to && time.to <= t1, JSON.stringify(own.timesOf("c1")));
    assert.deepEqual(own.writesOf("c1").map((w) => w.paths), [[A]]);
    off();
    bus.publish("run:t1", runs("u2"));
    assert.equal(own.timesOf("c1").length, 1, "heard no more");
  });
});

describe("a chat's own times: its commands in the background, as the hands list them", () => {
  test("its first two minutes while it runs; once it ended, its last two as well — whole where it ran four or less; one on another machine is none", () => {
    const own = createOwnTimes();
    own.shells("c1", [{ id: "dev", startedAt: T }, { id: "far", startedAt: T, machine: "m1" }], T + 500);
    assert.deepEqual(own.timesOf("c1"), [{ from: T, to: T + 2 * MIN }], "running: its first two minutes");
    // Listed again as another starts: nothing begins twice.
    own.shells("c1", [{ id: "dev", startedAt: T }, { id: "script", startedAt: T + MIN }], T + MIN);
    own.shells("c1", [{ id: "dev", startedAt: T }], T + 4 * MIN);
    assert.deepEqual(own.timesOf("c1"), [{ from: T, to: T + 2 * MIN }, { from: T + MIN, to: T + 4 * MIN }], "three minutes: whole");
    own.shells("c1", [], T + 60 * MIN);
    assert.deepEqual(own.timesOf("c1"), [{ from: T, to: T + 2 * MIN }, { from: T + 58 * MIN, to: T + 60 * MIN }, { from: T + MIN, to: T + 4 * MIN }], "an hour: its first and last two minutes");
    own.shells("c2", [], T);
    assert.deepEqual(own.timesOf("c2"), [], "a chat with none listed is not kept for it");
  });

  test("the chats with a time since a moment, or a background command listed now: their times, and those commands by the key a wait for their end takes", async () => {
    const own = createOwnTimes({ holdMs: 60_000 });
    own.runEvent("t1", began("c1"), T);
    own.runEvent("t1", runs("u1"), T + 100);
    own.runEvent("t1", ends("u1"), T + 200);
    own.runEvent("t2", began("c2"), T);
    own.runEvent("t2", runs("u2"), T + 5000);
    own.shells("c3", [{ id: "dev", startedAt: T - 10 * MIN }], T);
    assert.deepEqual(own.chatsSince(T + 150).map((c) => [c.chain, c.times]), [["c1", [{ from: T + 100, to: T + 200 }]], ["c2", [{ from: T + 5000, to: null }]], ["c3", []]], "c3's first two minutes are long over, and it is listed");
    assert.deepEqual(own.chatsSince(T + 300).map((c) => c.chain), ["c2", "c3"], "c1's command ended before then");
    const [dev] = own.chatsSince(T + 300)[1].running;
    assert.deepEqual([own.chatsSince(T + 300)[0].running, dev.from], [[], T - 10 * MIN]);
    // A wait for its end is over as the hands list it no more.
    let ended = false;
    const wait = own.endOf([dev.key]).then(() => (ended = true));
    await new Promise((ok) => setImmediate(ok));
    assert.equal(ended, false, "still listed: the wait goes on");
    own.shells("c3", [], T + 1000);
    await wait;
    assert.deepEqual(own.chatsSince(T + 300).map((c) => [c.chain, c.times, c.running]), [["c2", [{ from: T + 5000, to: null }], []], ["c3", [{ from: T + 1000 - 2 * MIN, to: T + 1000 }], []]], "ended: its last two minutes, and listed no more");
    own.stop();
  });

  test("a wait for a background command's end lasts `holdMs` at most, and is over as the keeper stops", async () => {
    const brief = createOwnTimes({ holdMs: 30 });
    brief.shells("c1", [{ id: "dev", startedAt: T }], T);
    const [dev] = brief.chatsSince(T)[0].running;
    const t0 = Date.now();
    await brief.endOf([dev.key]);
    assert.ok(Date.now() - t0 >= 20, "it waited its hold out");
    assert.equal(brief.chatsSince(T)[0].running.length, 1, "and the command runs on");
    brief.stop();
    const long = createOwnTimes({ holdMs: 600_000 });
    long.shells("c1", [{ id: "dev", startedAt: T }], T);
    const key = long.chatsSince(T)[0].running[0].key;
    const waits = [long.endOf([key]), long.endOf([key, "c9\nshell\nnone"])];
    long.stop();
    await Promise.all(waits);
    await long.endOf([key]);
  });
});

describe("a chat's own times: what is kept, at most", () => {
  test("200 ended commands a chat, the oldest going first, never one that runs; and none that ended a day ago", () => {
    const own = createOwnTimes();
    own.runEvent("t1", began("c1"), T);
    own.runEvent("t1", runs("long"), T);
    for (let i = 0; i < 250; i++) {
      own.runEvent("t1", runs(`u${i}`), T + 10 * i + 1);
      own.runEvent("t1", ends(`u${i}`), T + 10 * i + 5);
    }
    const kept = own.timesOf("c1");
    assert.equal(kept.length, 200);
    assert.deepEqual(kept[0], { from: T, to: null }, "the one that runs stays");
    assert.deepEqual([kept[1].from, kept.at(-1)?.from], [T + 10 * 51 + 1, T + 10 * 249 + 1], "the newest 199 ended ones beside it");
    own.runEvent("t1", runs("next"), T + 3000 + 24 * 60 * MIN);
    assert.deepEqual(own.timesOf("c1"), [{ from: T, to: null }, { from: T + 3000 + 24 * 60 * MIN, to: null }], "those that ended a day before are gone");
  });

  test("20 turns a chat; 500 chats, the one heard of longest ago going first; 500 runs under way", () => {
    const own = createOwnTimes();
    for (let i = 0; i < 25; i++) {
      own.turnBegan("c1", T + 100 * i);
      own.turnEnded("c1", T + 100 * i + 50);
    }
    assert.deepEqual([own.timesOf("c1").length, own.timesOf("c1")[0].from], [20, T + 500]);
    for (let i = 2; i <= 500; i++) own.turnBegan(`c${i}`, T);
    assert.equal(own.timesOf("c1").length, 20, "500 chats: all kept");
    // The first chat is heard of again, so the second is the one heard of longest ago.
    own.turnBegan("c1", T + 5000);
    own.turnBegan("c501", T);
    assert.deepEqual([own.timesOf("c1").length, own.timesOf("c2"), own.timesOf("c3").length, own.timesOf("c501").length], [20, [], 1, 1]);
    const runsKept = createOwnTimes();
    for (let i = 0; i <= 500; i++) runsKept.runEvent(`t${i}`, began("c1"), T);
    runsKept.runEvent("t0", runs("u0"), T + 10);
    runsKept.runEvent("t500", runs("u500"), T + 20);
    assert.deepEqual(runsKept.timesOf("c1"), [{ from: T + 20, to: null }], "the run heard of longest ago is of no chat any more");
  });
});

describe("a chat's file-writing calls, with the paths their starts say", () => {
  test("a call that names its files is one from its start to its end, with them; it is no time of a command's", () => {
    const own = createOwnTimes();
    own.runEvent("t1", began("c1"), T);
    const said = [A, B];
    own.runEvent("t1", writes("w1", said), T + 100);
    assert.deepEqual(own.writesOf("c1"), [{ from: T + 100, to: null, paths: [A, B] }]);
    own.runEvent("t1", { ...ends("w1"), name: "edit" }, T + 150);
    assert.deepEqual(own.writesOf("c1"), [{ from: T + 100, to: T + 150, paths: [A, B] }]);
    assert.deepEqual(own.timesOf("c1"), [], "what lands while a chat edits is not its own by that");
    assert.deepEqual(own.chatsSince(T), [], "nor is the chat one with a time");
    // What is kept is the keeper's own: neither the list the event carried nor the one it gives changes it.
    said.push("x");
    own.writesOf("c1")[0].paths?.push("y");
    assert.deepEqual(own.writesOf("c1")[0].paths, [A, B]);
    assert.deepEqual(own.writesOf("c2"), []);
  });

  test("one whose paths are not said (`edits: true`) is kept with none: any path may be its own in its time; a call that says no `edits` is none", () => {
    const own = createOwnTimes();
    own.runEvent("t1", began("c1"), T);
    own.runEvent("t1", writes("w1", true), T + 100);
    own.runEvent("t1", ends("w1"), T + 200);
    // A read, and a command: neither says `edits`.
    own.runEvent("t1", { type: "tool-start", round: 1, name: "read", args: "", card: { kind: "read", title: "Read", subject: "a.js" }, id: "r1" }, T + 300);
    own.runEvent("t1", runs("u1"), T + 400);
    // A list that is not paths alone says no more than that the call writes.
    own.runEvent("t1", writes("w2", []), T + 500);
    own.runEvent("t1", { ...writes("w3", []), edits: [A, 7, ""] }, T + 600);
    assert.deepEqual(own.writesOf("c1"), [{ from: T + 100, to: T + 200, paths: null }, { from: T + 500, to: null, paths: null }, { from: T + 600, to: null, paths: null }]);
    assert.deepEqual(own.timesOf("c1"), [{ from: T + 400, to: null }], "the command's time alone");
  });

  test("one that wrote nothing — refused, declined, vetoed, not run — is none; one that waits for the person's answer begins as it is answered", () => {
    const own = createOwnTimes();
    own.runEvent("t1", began("c1"), T);
    for (const [i, how] of ["refused", "declined", "vetoed", "notRun"].entries()) {
      own.runEvent("t1", writes(`n${i}`, [A]), T + 10 * i);
      own.runEvent("t1", ends(`n${i}`, { ok: false, [how]: true }), T + 10 * i + 1);
    }
    assert.deepEqual(own.writesOf("c1"), []);
    own.runEvent("t1", writes("w1", [A]), T + 100);
    own.runEvent("t1", { type: "ask", round: 1, kind: "permission", tool: "edit", question: "May I?", waits: true, id: "q1", call: "w1" }, T + 110);
    assert.deepEqual(own.writesOf("c1"), [], "asked: nothing is written yet");
    own.runEvent("t1", { type: "ask-end", round: 1, id: "q1", call: "w1", outcome: "answered", words: [] }, T + 3000);
    own.runEvent("t1", ends("w1"), T + 3100);
    assert.deepEqual(own.writesOf("c1"), [{ from: T + 3000, to: T + 3100, paths: [A] }]);
    // Asked, then declined: none.
    own.runEvent("t1", writes("w2", [B]), T + 4000);
    own.runEvent("t1", { type: "ask", round: 1, kind: "permission", tool: "edit", question: "May I?", waits: true, id: "q2", call: "w2" }, T + 4010);
    own.runEvent("t1", { type: "ask-end", round: 1, id: "q2", call: "w2", outcome: "declined", words: [] }, T + 5000);
    own.runEvent("t1", ends("w2", { ok: false, declined: true }), T + 5001);
    assert.deepEqual(own.writesOf("c1").map((w) => w.paths), [[A]]);
  });

  test("one its run's end finds running ended there; a sub-agent's is its chat's; 200 ended ones a chat at most", () => {
    const own = createOwnTimes();
    own.runEvent("t1", began("c1"), T);
    own.runEvent("t1", writes("w1", [A]), T + 100);
    own.runEvent("s1", began("c1", { subagent: "sa_1" }, "subagent"), T + 110);
    own.runEvent("s1", writes("w1", [B]), T + 120);
    own.runEvent("t1", { ...writes("k1", true), type: "subagent-tool-start", parent: "task1" }, T + 130);
    own.runEvent("t1", over("stopped"), T + 300);
    assert.deepEqual(own.writesOf("c1"), [{ from: T + 100, to: T + 300, paths: [A] }, { from: T + 120, to: null, paths: [B] }, { from: T + 130, to: T + 300, paths: null }], "the run's own ended with it; another run's goes on");
    own.runEvent("s1", ends("w1"), T + 400);
    for (let i = 0; i < 250; i++) {
      own.runEvent("s1", writes(`e${i}`, [A]), T + 1000 + 10 * i);
      own.runEvent("s1", ends(`e${i}`), T + 1000 + 10 * i + 5);
    }
    const kept = own.writesOf("c1");
    assert.deepEqual([kept.length, kept[0].from, kept.at(-1)?.from], [200, T + 1000 + 10 * 50, T + 1000 + 10 * 249]);
  });
});
