// @ts-check
// The idle wake (the owner's of 11-08: "if filament goes idle when you stop the turn, filament needs to wake it back up
// after let's say 5 minutes so that you are not stuck forever"; narrowed: "not wake up on open tasks but just when
// background command is running"): a chat's agent that ends its turn while a background command of its runs is told
// after the minutes set — once, only if the command still runs and nothing else came — and each idle wake in a row with
// nothing else between waits twice as long, to an hour. Anything that starts a turn first cancels it.
// (fails before: yes — nothing woke an agent that ended its turn while its command ran on and never ended)
import { test, describe, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { IDLE_WAKE_MAX_MIN, IDLE_WAKE_MIN, createIdleWaker, idleText, idleWaitMinutes, idleWakeMinutes } from "../src/app/sessions/idle-wake.js";
import { IDLE_WAKE_LINE, wakeLineFor } from "../src/app/sessions/wake.js";
import { dropIdleNotes, peekShellExits, tellLater, tellShellExits, wakeDue, wakeKindOf } from "../src/adapters/tools/hands.js";

const MIN = 60_000;
const T0 = 1_000_000;
/** @param {string} id @param {string} command @param {number} ago  minutes */
const cmd = (id, command, ago) => ({ id, command, startedAt: T0 - ago * MIN });

describe("the idle wake's minutes and words", () => {
  test("the setting: 5 where none is set or it does not read, 0 and below off, whole minutes from 1 to 60", () => {
    assert.equal(IDLE_WAKE_MIN, 5);
    assert.equal(IDLE_WAKE_MAX_MIN, 60);
    assert.deepEqual([undefined, null, "x", NaN, Infinity].map(idleWakeMinutes), [5, 5, 5, 5, 5]);
    assert.deepEqual([0, -3, "0"].map(idleWakeMinutes), [0, 0, 0]);
    assert.deepEqual([0.4, 1, "7", 7.6, 60, 500].map(idleWakeMinutes), [1, 1, 7, 8, 60, 60]);
  });

  test("each idle wake in a row waits twice as long as the one before, to an hour", () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map((n) => idleWaitMinutes(5, n)), [5, 10, 20, 40, 60, 60, 60]);
    assert.deepEqual([0, 1].map((n) => idleWaitMinutes(45, n)), [45, 60]);
    assert.equal(idleWaitMinutes(0, 2), 0, "off is off");
  });

  test("its words: how long the agent was idle, each command still running with its id and how long it has run, and when Filament checks in next", () => {
    assert.equal(
      idleText([cmd("bg_3f2a", "npm test", 12)], { idleMin: 5, nextMin: 10, now: T0 }),
      "[Filament: 5 min since your turn ended, your background command still runs with no end: `npm test` (bg_3f2a, running 12 min). If it keeps running, Filament checks in again in 10 min.]",
    );
    const many = idleText([cmd("b1", "npm test", 12), cmd("b2", "node scripts/desktop-drive.mjs --pictures out", 90), cmd("b3", "a`b", 0), cmd("b4", "x", 1), cmd("b5", "y", 1)], { idleMin: 20, nextMin: 40, now: T0 });
    assert.match(many, /^\[Filament: 20 min since your turn ended, your 5 background commands still run with no end: `npm test` \(b1, running 12 min\); `node scripts\/desktop-drive\.mjs --pictures out` \(b2, running 1 h 30 min\); `a'b` \(b3, running 1 min\); and 2 more\. /);
    const long = idleText([cmd("b1", `node ${"x".repeat(200)}\nsecond line`, 3)], { idleMin: 5, nextMin: 10, now: T0 });
    assert.match(long, /`node x{74}…` \(b1, running 3 min\)/, "one line, cut");
    assert.match(idleText([cmd("b1", "cd web &&\r\n  npm run dev", 3)], { idleMin: 5, nextMin: 10, now: T0 }), /: `cd web &&` \(b1, running 3 min\)\./, "its first line");
    // (fails before: yes — fxl1's left: it said "Nothing else came meanwhile." where a word queued for the agent rode the
    // same turn: what came beside it is the wake's line's to say, which knows what its turn carries)
    assert.doesNotMatch(idleText([cmd("bg_3f2a", "npm test", 12)], { idleMin: 15, nextMin: 10, now: T0 }), /came/);
  });
});

describe("the idle waker", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"], now: T0 }));
  afterEach(() => mock.timers.reset());

  /** @param {{ minutes?: () => unknown }} [o] */
  const rig = (o = {}) => {
    /** @type {Record<string, ReturnType<typeof cmd>[]>} */
    const runs = {};
    /** @type {Set<string>} */
    const blocked = new Set();
    /** The chats another wake is owed to that nothing sends. @type {Set<string>} */
    const owing = new Set();
    /** @type {{ chat: string, id: string, text: string, commands: any[] }[]} */
    const told = [];
    /** @type {[string, any][]} */
    const changes = [];
    let minutes = /** @type {unknown} */ (undefined);
    const w = createIdleWaker({
      minutes: o.minutes ?? (() => minutes),
      running: (chat) => runs[chat] ?? [],
      blocked: (chat) => blocked.has(chat) || (owing.has(chat) ? "owed" : false),
      tell: (chat, note) => void told.push({ chat, ...note }),
      changed: (chat, wake) => void changes.push([chat, wake]),
    });
    return { w, runs, blocked, owing, told, changes, set: (/** @type {unknown} */ m) => void (minutes = m) };
  };

  test("armed as a turn ends with a command running: told once after 5 min, not before; nothing armed where none runs", () => {
    const r = rig();
    r.runs.c1 = [cmd("bg_1", "npm test", 2)];
    assert.deepEqual(r.w.ended("c1"), { at: T0 + 5 * MIN, minutes: 5 });
    assert.deepEqual(r.w.next("c1"), { at: T0 + 5 * MIN, commands: r.runs.c1 });
    assert.deepEqual(r.changes, [["c1", { at: T0 + 5 * MIN, commands: r.runs.c1 }]], "the page told when it is due");
    assert.deepEqual(r.w.list(), [{ chainId: "c1", idleWake: { at: T0 + 5 * MIN, commands: r.runs.c1 } }]);
    mock.timers.tick(5 * MIN - 1);
    assert.equal(r.told.length, 0, "not before its time");
    mock.timers.tick(1);
    assert.equal(r.told.length, 1);
    assert.equal(r.told[0].chat, "c1");
    assert.match(r.told[0].id, /^idle-\d+$/);
    assert.equal(r.told[0].text, "[Filament: 5 min since your turn ended, your background command still runs with no end: `npm test` (bg_1, running 7 min). If it keeps running, Filament checks in again in 10 min.]");
    assert.equal(r.w.next("c1"), null, "spent");
    assert.deepEqual(r.changes.at(-1), ["c1", null]);
    mock.timers.tick(60 * MIN);
    assert.equal(r.told.length, 1, "once");
    assert.equal(r.w.ended("c2"), null, "a turn that ends with nothing running arms nothing");
    assert.equal(r.w.pending(), 0);
  });

  test("anything that starts a turn first cancels it — a command's end, a message, a report, a letter; one that ended meanwhile, or a chat that may not be woken, is not told", () => {
    const r = rig();
    r.runs.c1 = [cmd("bg_1", "npm test", 0)];
    r.w.ended("c1");
    mock.timers.tick(2 * MIN);
    r.w.began("c1");
    assert.equal(r.w.next("c1"), null);
    assert.deepEqual(r.changes.at(-1), ["c1", null]);
    mock.timers.tick(10 * MIN);
    assert.equal(r.told.length, 0, "cancelled");
    // The command ended before the time: its own end is what wakes the agent.
    r.w.ended("c1");
    r.runs.c1 = [];
    mock.timers.tick(5 * MIN);
    assert.equal(r.told.length, 0);
    // Of two, one ended meanwhile: the words name the one that still runs.
    r.runs.c1 = [cmd("bg_1", "npm test", 0), cmd("bg_2", "make", 0)];
    r.w.ended("c1");
    r.runs.c1 = [r.runs.c1[1]];
    mock.timers.tick(5 * MIN);
    assert.equal(r.told.length, 1);
    assert.match(r.told[0].text, /your background command still runs with no end: `make` \(bg_2, running \d+ min\)\./);
    assert.deepEqual(r.told[0].commands.map((c) => c.id), ["bg_2"]);
    r.told.length = 0;
    r.w.began("c1");
    // The person stopped, a question waits, something else is due or on its way: not told.
    r.runs.c1 = [cmd("bg_1", "npm test", 0)];
    r.w.ended("c1");
    r.blocked.add("c1");
    mock.timers.tick(5 * MIN);
    assert.equal(r.told.length, 0);
    r.blocked.delete("c1");
    // The person's Stop drops it; a later end arms it again.
    r.w.ended("c1");
    r.w.stopped("c1");
    mock.timers.tick(5 * MIN);
    assert.equal(r.told.length, 0);
    assert.equal(r.w.pending(), 0);
  });

  // (fails before: yes — the nudge map of 11-10: a block at its time let the check-in go for good, though the one before
  // promised "checks in again in 10 min"; the agent sat idle with its command running)
  test("a check-in its time found blocked is set again for the same wait, and keeps the promise once nothing blocks it", () => {
    const r = rig();
    r.runs.c1 = [cmd("bg_1", "npm test", 0)];
    r.w.ended("c1");
    mock.timers.tick(5 * MIN);
    assert.match(r.told[0].text, /Filament checks in again in 10 min\.\]$/);
    // The check-in's own turn ends: armed for the 10 min it promised.
    r.w.began("c1", { idle: true });
    assert.deepEqual(r.w.ended("c1"), { at: T0 + 15 * MIN, minutes: 10 });
    r.blocked.add("c1");
    mock.timers.tick(10 * MIN);
    assert.equal(r.told.length, 1, "blocked: not told");
    assert.deepEqual(r.w.next("c1"), { at: T0 + 25 * MIN, commands: r.runs.c1 }, "set again, the same wait");
    assert.deepEqual(r.changes.at(-1), ["c1", { at: T0 + 25 * MIN, commands: r.runs.c1 }], "the page told when it is due");
    r.blocked.delete("c1");
    mock.timers.tick(10 * MIN);
    assert.equal(r.told.length, 2, "told once nothing blocks it");
    // Its turn ended 20 min ago — the wait that was blocked, and the one it was set again for (the review of 11-11: it
    // said "10 min", the last wait alone).
    assert.match(r.told[1].text, /^\[Filament: 20 min since your turn ended, your background command still runs with no end: `npm test` \(bg_1, running 25 min\)\. If it keeps running, /);
    // A command that ended meanwhile: nothing set again — its own end wakes the agent.
    r.w.began("c1", { idle: true });
    r.w.ended("c1");
    r.blocked.add("c1");
    r.runs.c1 = [];
    mock.timers.tick(60 * MIN);
    assert.equal(r.w.pending(), 0);
  });

  // (fails before: yes — the review of 11-11: a wake owed that nothing sent — the waker gave up, the start's sweep let it
  // be — blocked every check-in, which was set again at the same wait for as long as the command ran: a write, a publish
  // and a log line each time, and the check-in it promised never came)
  test("a check-in blocked by another wake owed that nothing sends is set again twice, then told all the same; a stop or a question holds it for as long as it lasts", () => {
    const r = rig();
    r.runs.c1 = [cmd("bg_1", "npm run dev", 0)];
    r.owing.add("c1");
    r.w.ended("c1");
    mock.timers.tick(5 * MIN);
    assert.deepEqual([r.told.length, r.w.next("c1")?.at], [0, T0 + 10 * MIN], "the wake owed may be on its way still: set again");
    mock.timers.tick(5 * MIN);
    assert.deepEqual([r.told.length, r.w.next("c1")?.at], [0, T0 + 15 * MIN]);
    mock.timers.tick(5 * MIN);
    assert.equal(r.told.length, 1, "told all the same: its telling asks the waker again");
    // (fails before: yes — the review of 11-11: told past the wake that held it back, it still said "Nothing else came
    // meanwhile.", and "5 min since your turn ended" after two waits set again, 15 min after that turn ended)
    assert.equal(r.told[0].text, "[Filament: 15 min since your turn ended, your background command still runs with no end: `npm run dev` (bg_1, running 15 min). If it keeps running, Filament checks in again in 10 min.]");
    assert.equal(r.w.pending(), 0, "spent: nothing set again, nothing more written");
    // A turn between them starts the count again.
    r.w.began("c1");
    r.w.ended("c1");
    mock.timers.tick(10 * MIN);
    r.w.began("c1");
    r.w.ended("c1");
    mock.timers.tick(10 * MIN);
    assert.equal(r.told.length, 1, "two in a row, then a turn: still set again");
    r.w.cancel("c1");
    // The person's stop, a question waiting: held as long as it lasts.
    r.owing.delete("c1");
    r.blocked.add("c1");
    r.w.ended("c1");
    mock.timers.tick(30 * MIN);
    assert.deepEqual([r.told.length, r.w.pending()], [1, 1]);
  });

  test("a turn that ends again replaces the timer; two chats each their own", () => {
    const r = rig();
    r.runs.c1 = [cmd("bg_1", "npm test", 0)];
    r.runs.c2 = [cmd("bg_2", "make", 0)];
    r.w.ended("c1");
    mock.timers.tick(3 * MIN);
    r.w.ended("c1");
    r.w.ended("c2");
    mock.timers.tick(2 * MIN);
    assert.equal(r.told.length, 0, "the first timer replaced");
    mock.timers.tick(3 * MIN);
    assert.deepEqual(r.told.map((t) => t.chat).sort(), ["c1", "c2"]);
  });

  test("idle wakes in a row back off — 5, 10, 20, 40, 60, 60 min —; anything else that starts a turn starts again from 5", () => {
    const r = rig();
    r.runs.c1 = [cmd("bg_1", "sleep 99999", 0)];
    /** @type {number[]} */
    const waits = [];
    for (let i = 0; i < 6; i++) {
      const a = /** @type {any} */ (r.w.ended("c1"));
      waits.push(a.minutes);
      mock.timers.tick(a.minutes * MIN);
      // The idle wake's own turn begins: no reset.
      r.w.began("c1", { idle: true });
    }
    assert.deepEqual(waits, [5, 10, 20, 40, 60, 60]);
    assert.equal(r.told.length, 6);
    assert.match(r.told[0].text, /checks in again in 10 min\.\]$/);
    assert.match(r.told[4].text, /^\[Filament: 60 min since your turn ended, .* checks in again in 60 min\.\]$/);
    // A turn of the idle wake's own that ends with nothing running (the agent stopped the command): from 5 again.
    r.runs.c1 = [];
    assert.equal(r.w.ended("c1"), null);
    r.runs.c1 = [cmd("bg_1", "sleep 99999", 0)];
    assert.equal(/** @type {any} */ (r.w.ended("c1")).minutes, 5, "the streak ends with the command");
    r.w.began("c1", { idle: true });
    for (let i = 0; i < 2; i++) {
      mock.timers.tick(/** @type {any} */ (r.w.ended("c1")).minutes * MIN);
      r.w.began("c1", { idle: true });
    }
    r.w.began("c1");
    assert.equal(/** @type {any} */ (r.w.ended("c1")).minutes, 5, "a message, a report, a command's end: from 5 again");
    r.w.began("c1", { idle: true });
    r.runs.c1 = [];
    r.w.ended("c1");
    r.runs.c1 = [cmd("bg_9", "x", 0)];
    assert.equal(/** @type {any} */ (r.w.ended("c1")).minutes, 5, "a turn that ended with nothing running: from 5 again");
  });

  test("0 turns it off: nothing armed, and one armed before is not told", () => {
    const r = rig();
    r.runs.c1 = [cmd("bg_1", "npm test", 0)];
    r.set(0);
    assert.equal(r.w.ended("c1"), null);
    r.set(2);
    assert.equal(/** @type {any} */ (r.w.ended("c1")).minutes, 2);
    r.set(0);
    mock.timers.tick(2 * MIN);
    assert.equal(r.told.length, 0);
    r.set(500);
    assert.equal(/** @type {any} */ (r.w.ended("c1")).minutes, 60, "clamped to an hour");
    r.w.dispose();
    assert.equal(r.w.pending(), 0);
    mock.timers.tick(60 * MIN);
    assert.equal(r.told.length, 0, "a restart drops it");
  });
});

describe("the check-in told as a command's end is told (hands.js)", () => {
  // (fails before: yes — no kind said Filament's check-in, and the wake's words called it a command's end)
  test("kept untold with its own kind, it wakes the chat in its own words; the person's Stop takes it, and leaves an end beside it", () => {
    const session = "s-idle-hands";
    const owner = { session, agent: null };
    tellLater(owner, { id: "idle-1", command: "", code: null, kind: "idle", text: "[Filament: 5 min since your turn ended, …]" }, { now: false });
    assert.equal(wakeDue(session), true, "it wakes the chat");
    assert.equal(wakeKindOf(session), "idle");
    assert.equal(wakeLineFor(wakeKindOf(session)), IDLE_WAKE_LINE);
    tellLater(owner, { id: "bg_9", command: "make", code: 0, kind: "exit", text: "[Filament: background shell bg_9 (make) exited with code 0.]" }, { now: false });
    assert.equal(wakeKindOf(session), "mixed", "beside an end: what it waited on came");
    dropIdleNotes(session);
    assert.deepEqual(peekShellExits(owner).map((x) => x.id), ["bg_9"], "the Stop took the check-in alone");
    tellShellExits(owner, ["bg_9"]);
    dropIdleNotes(session);
    assert.equal(wakeDue(session), false, "nothing left: nothing kept");
  });
});
