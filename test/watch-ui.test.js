// @ts-check
// The plan of 11-11, its w8a: watchers on a page of their own, and a line over the box of a chat one watches or wakes.
// Space › Watchers lists the watchers alone — the Routines page none of them —, each row its eye, its title, and a
// small grid in Filament's words: what it watches, whom it wakes or tells, what it may guide, each chat's name a link;
// a switch that pauses and resumes one that is on, Switch on… on one proposed, the rest under ⋯. Its head says how
// many listen, with Pause every Space and Watcher…. The left bar and Home show it beside Routines. Over a chat's box:
// "Watched by …" where a watcher's trigger names the chat, "Watching …" where one wakes it, with Pause, Resume, or
// Open where there are several. The words are core's, said by the server: the row's parts, the line's, each press's.
// (fails before: yes — watchers were rows of the Routines page drawn as routines, and nothing over the box said a
// chat was watched)
// Its w8b: what a watcher wrote, read and woke, where it lands in the chat. A guidance turn's capsule names its
// watcher, and its words stand under it on a card — whose they are, how to weigh them, Open its chat and Pause —, the
// agent's whole block folded below; a guidance note in a running turn is the same card with its state. A turn a
// watcher read has a Reviewed chip in its footer, which the feed's `reviews` draws in place. A wake's capsule says
// which watcher woke the chat and what it heard, the chat it names a link. Ways in: Watch this chat… in the chat's
// menu, Watcher… in Add to this Space…; Pause all named on the line over the box and in one sentence both pages share.
// (fails before: yes — a guidance turn was a capsule over a fold of Filament's block, a note a dashed bubble, nothing
// said a turn was reviewed, and a wake's capsule named neither its watcher nor what it heard)
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as watchersCore from "../src/core/watchers.js";
import * as routinesCore from "../src/core/routines.js";
import { namedText } from "../src/core/space.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { gate, removeDirs, until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** What the page posted, in order. @type {{ url: string, method: string, body: any }[]} */
const posted = [];
/** What the stand-in server answers the page by its address: a body, or undefined for a 404. @type {(url: string, method: string) => any} */
let serve = () => undefined;
const realFetch = g.fetch;
// The page asks by a path; a test's own Filament is asked by its whole address, which the real fetch takes.
g.fetch = async (/** @type {any} */ url, /** @type {any} */ init = {}) => {
  if (typeof url !== "string" || /^https?:/i.test(url)) return realFetch(url, init);
  const method = String(init.method || "GET");
  if (method !== "GET") posted.push({ url, method, body: init.body ? JSON.parse(init.body) : null });
  const body = serve(url, method);
  return body === undefined
    ? new Response(JSON.stringify({ error: "not found" }), { status: 404 })
    : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
after(() => {
  g.fetch = realFetch;
});

/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));

/** A moment of Monday 26 October 2026, local. @param {number} h @param {number} [m] */
const at = (h, m = 0) => new Date(2026, 9, 26, h, m).getTime();
/** The day before it, a Sunday. @param {number} h @param {number} [m] */
const yesterday = (h, m = 0) => new Date(2026, 9, 25, h, m).getTime();
const NOW = at(10);
const NAMES = /** @type {Record<string, string>} */ ({ c1: "Lead", c2: "Build the login flow" });
/** @param {string} c */
const nameOf = (c) => NAMES[c] || "an untitled chat";
const LEAD = { chain: "c1", name: "Lead" };
const BUILD = { chain: "c2", name: "Build the login flow" };
/** A watcher on, as its Space keeps it. @param {any} [o] @returns {import("../src/core/routines.js").Routine} */
const watcher = (o = {}) => ({
  id: "r1", title: "Supervisor", when: "", task: "Read its turn; say where it drifted.", writes: false, trigger: { kind: "turn", chat: "c2", turns: "changed", every: 1 }, wakes: "new", state: "on", paused: false,
  madeIn: "c1", madeBy: "Lead", model: "m", at: at(9), onAt: at(9), upTo: null, last: null, skipped: null, seen: { from: at(9), at: null, ids: [] }, pending: null, ...o,
});
/** A routine at times. @param {any} [o] @returns {import("../src/core/routines.js").Routine} */
const timed = (o = {}) => ({ ...watcher({ id: "t1", title: "Morning brief", when: "daily 09:00", task: "Read what came in." }), trigger: undefined, wakes: undefined, seen: undefined, pending: undefined, ...o });
/** @param {any} [o] */
const row = (o) => routinesCore.rowWords(watcher(o), { now: NOW, nameOf });
/** A run of 09:10. @param {any} o */
const run = (o) => ({ at: at(9, 10), chain: "c9", by: "event", ...o });
const BY = { chain: "c1", byName: "Lead", model: "m", nameOf };
const NEEDS_WORDS = "a routine needs its words (text): what the agent does at each run";

describe("a watcher's words, in parts (core)", () => {
  // (fails before: yes — a trigger was said one way, the moment it wakes: "after each turn of …")
  test("what a trigger watches, each kind's own, the chat it names kept apart", () => {
    const { watchedParts } = watchersCore;
    /** @param {any} t */
    const said = (t) => namedText(watchedParts(t, nameOf));
    assert.deepEqual(watchedParts({ kind: "turn", chat: "c2", turns: "all", every: 1 }, nameOf), ["each turn of ", BUILD]);
    assert.equal(said({ kind: "turn", chat: "c2", turns: "changed", every: 1 }), "each turn of Build the login flow that changes files or marks tasks done");
    assert.equal(said({ kind: "turn", chat: "c2", turns: "all", every: 3 }), "every 3 turns of Build the login flow");
    // (fails before: yes — "a task of Build the login flow's graph done or blocked" read as a graph done or blocked)
    assert.equal(said({ kind: "task", chat: "c2", on: ["done", "blocked"] }), "each task done or blocked on Build the login flow's graph");
    assert.deepEqual(watchedParts({ kind: "task", chat: "c2", on: ["done"] }, nameOf), ["each task done on ", BUILD, "'s graph"]);
    assert.equal(said({ kind: "task", on: ["blocked"] }), "each task blocked on any chat's graph");
    assert.equal(said({ kind: "ask", afterMin: 10 }), "a question of any chat waiting 10 min for you");
    assert.equal(said({ kind: "shell", chat: "c2" }), "a failed command of Build the login flow");
    assert.equal(said({ kind: "subagent" }), "a sub-agent's report in any chat");
    assert.equal(said({ kind: "commit", branch: "main" }), "new commits on main");
    assert.equal(said({ kind: "commit", branch: "main", place: "/code/app" }), "new commits on main in /code/app");
    assert.equal(said({ kind: "connection", tool: "mcp__linear__list_issues", everyMin: 15 }), "something new in linear's list_issues, asked every 15 min");
  });

  // (fails before: yes — a row had one line, `may`; the page had no part to draw a chat's name as a link from)
  test("its row's parts by whom it wakes — what it watches, whom it wakes or tells under its label, what it may guide —, the one-line may kept", () => {
    // The chat that proposed it: a turn there, reading or working as that chat does.
    assert.deepEqual(row({ wakes: "chat" }).wakes, { label: "Wakes", parts: [LEAD, ", in a turn that only reads"] });
    assert.deepEqual(row({ wakes: "chat", writes: true }).wakes, { label: "Wakes", parts: [LEAD, ", in a turn that works as that chat does"] });
    // A new chat each time: as a routine's run.
    assert.deepEqual(row({}).wakes, { label: "Wakes", parts: ["a new chat each time, reading only"] });
    assert.deepEqual(row({ writes: true }).wakes, { label: "Wakes", parts: ["a new chat each time, in a lane of its own"] });
    assert.deepEqual(row({ acts: ["mcp__linear__update_issue"] }).wakes?.parts, ["a new chat each time, reading only · acts through linear's update_issue"]);
    assert.deepEqual(routinesCore.rowWords(watcher({ writes: true }), { now: NOW, nameOf, inPlace: true }).wakes?.parts, ["a new chat each time, writing in its Space's folder"]);
    // Only the person: told, nothing run.
    assert.deepEqual(row({ wakes: "you" }).wakes, { label: "Tells", parts: ["only you, in Needs you · runs nothing"] });
    assert.deepEqual(row({}).watches, ["each turn of ", BUILD, " that changes files or marks tasks done"]);
    assert.equal(row({}).guides, null, "none unless it guides");
    assert.deepEqual(row({ guides: true }).guides, ["guide ", BUILD, " · 3 for each message of yours there"]);
    assert.deepEqual(row({ wakes: "chat", guides: true }).guides, ["guide ", BUILD, " · 3 for each message of yours there"]);
    assert.equal(row({ wakes: "you", guides: true }).guides, null, "one that tells only you guides nobody");
    assert.equal(row({ guides: true }).may, "reads only · wakes a new chat each time · may guide Build the login flow", "its one line, as it was");
    // A routine at times has none of them.
    const brief = routinesCore.rowWords(timed(), { now: NOW, nameOf });
    assert.deepEqual([brief.watches, brief.wakes, brief.guides], [null, null, null]);
  });

  // (fails before: yes — the state's word was inside one sentence, `last`, and a watcher that never ran said nothing)
  test("how it stands: its last run with the one word of its state apart, and Nothing heard yet where it never ran", () => {
    const done = row({ last: run({ state: "done", ended: at(9, 10) + 41_000, said: "All green" }) });
    assert.deepEqual([done.last, done.lastParts], ["last: today 09:10 · done in 41 s", { head: "last: today 09:10 · ", word: "done", tail: " in 41 s", tone: "done" }]);
    const failed = row({ last: run({ state: "failed", ended: at(9, 11), why: "the chat it wakes is gone" }) });
    assert.deepEqual([failed.last, failed.lastParts], ["last: today 09:10 · failed: the chat it wakes is gone", { head: "last: today 09:10 · ", word: "failed", tail: ": the chat it wakes is gone", tone: "bad" }]);
    assert.deepEqual(row({ last: run({ state: "stopped", ended: at(9, 11) }) }).lastParts, { head: "last: today 09:10 · ", word: "stopped", tail: "", tone: "" });
    const running = routinesCore.rowWords(watcher({ last: run({ state: "running" }) }), { now: NOW, nameOf, live: { busy: true, asking: false } });
    assert.deepEqual([running.last, running.lastParts], ["now: running since today 09:10", { head: "now: ", word: "running", tail: " since today 09:10", tone: "works" }]);
    const asking = routinesCore.rowWords(watcher({ last: run({ state: "running" }) }), { now: NOW, nameOf, live: { busy: true, asking: true } });
    assert.deepEqual([asking.last, asking.lastParts], ["now: waits for you · since today 09:10", { head: "now: ", word: "waits for you", tail: " · since today 09:10", tone: "asks" }]);
    // Never ran: said so once it listens; one that heard and runs nothing says when.
    assert.deepEqual([row({}).lastParts, row({}).heard], [null, "Nothing heard yet"]);
    assert.equal(row({ wakes: "you", seen: { from: at(9), at: at(9, 30), ids: ["e1"] } }).heard, "last heard: today 09:30");
    assert.equal(row({ state: "proposed", seen: null }).heard, "", "one proposed does not listen yet");
    assert.equal(done.heard, "", "its run says more");
    assert.equal(routinesCore.rowWords(timed(), { now: NOW, nameOf }).heard, "", "a routine at times hears nothing");
  });

  // (fails before: yes — "done in 0 s")
  test("a run that took no second says so in words, a watcher's and a routine's", () => {
    const quick = row({ last: run({ state: "done", ended: at(9, 10) + 300 }) });
    assert.deepEqual([quick.last, quick.lastParts?.tail], ["last: today 09:10 · done in under a second", " in under a second"]);
    assert.equal(routinesCore.rowWords(timed({ last: run({ state: "done", by: "time", ended: at(9, 10) + 120 }) }), { now: NOW, nameOf }).last, "last: today 09:10 · done in under a second");
    assert.equal(row({ last: run({ state: "done", ended: at(9, 10) + 700 }) }).last, "last: today 09:10 · done in 1 s", "a second, rounded, is one");
    // What happened and an app's ask say a run's time by the same words.
    assert.deepEqual([routinesCore.tookWords(300), routinesCore.tookWords(700), routinesCore.tookWords(41_000)], ["under a second", "1 s", "41 s"]);
  });

  // (fails before: yes — a row said nothing of the turns its watcher read)
  test("its row counts the turns it reviewed today, and how many of them it guided; nothing where none", () => {
    const v = (/** @type {any} */ o) => ({ chain: "c2", turn: 3, watcher: "r1", title: "Supervisor", at: at(9, 20), guided: false, ...o });
    const reviews = [
      v({}),
      v({ turn: 4, at: at(9, 40), guided: true }),
      // The same turn read again: one turn.
      v({ turn: 4, at: at(9, 45) }),
      // Yesterday's, by the person's clock.
      v({ turn: 2, at: yesterday(9), guided: true }),
      // Another watcher's.
      v({ turn: 5, watcher: "r9", title: "Other", at: at(9, 50), guided: true }),
    ];
    assert.equal(routinesCore.rowWords(watcher(), { now: NOW, nameOf, reviews }).reviewed, "2 reviewed today · 1 guided");
    assert.equal(routinesCore.rowWords(watcher(), { now: NOW, nameOf, reviews: [v({})] }).reviewed, "1 reviewed today");
    assert.equal(routinesCore.rowWords(watcher(), { now: NOW, nameOf, reviews: [v({ at: yesterday(9) })] }).reviewed, "", "none today");
    assert.equal(row({}).reviewed, "", "none kept");
    assert.equal(routinesCore.rowWords(timed(), { now: NOW, nameOf, reviews }).reviewed, "", "a routine at times reviews no turn");
  });

  // (fails before: yes — no `reviewsByTurn`: nothing said a turn's reviews to its page)
  test("a chat's reviews by its turns' numbers: one for each watcher that read a turn — its newest read, guided where any was —, with the sentence its chip's tip says", () => {
    const { reviewsByTurn } = watchersCore;
    const v = (/** @type {any} */ o) => ({ chain: "c2", turn: 3, watcher: "r1", title: "Supervisor", at: at(9, 20), guided: false, ...o });
    const rows = [
      { project: "p1", v: v({}) },
      { project: "p1", v: v({ turn: 4, at: at(9, 40), guided: true }) },
      { project: "p1", v: v({ turn: 4, at: at(9, 45) }) },
      // Another Space's watcher of the same id is another watcher.
      { project: "p2", v: v({ turn: 4, title: "Reviewer", at: at(9, 50) }) },
    ];
    assert.deepEqual(reviewsByTurn(rows, NOW), {
      3: [{ watcher: "r1", project: "p1", title: "Supervisor", at: at(9, 20), guided: false, words: "“Supervisor” read this turn at 09:20 and sent nothing" }],
      4: [
        { watcher: "r1", project: "p1", title: "Supervisor", at: at(9, 45), guided: true, words: "“Supervisor” read this turn at 09:45 and wrote this chat guidance" },
        { watcher: "r1", project: "p2", title: "Reviewer", at: at(9, 50), guided: false, words: "“Reviewer” read this turn at 09:50 and sent nothing" },
      ],
    });
    assert.deepEqual(reviewsByTurn([], NOW), {});
    assert.equal(reviewsByTurn([{ project: "p1", v: v({ at: yesterday(9, 20) }) }], NOW)[3][0].words, "“Supervisor” read this turn at Sun 09:20 and sent nothing", "an earlier day's, by its day");
  });

  // (fails before: yes — no `guidanceParts`: a guidance turn's words were Filament's block and the reviewer's in one)
  test("a guidance message apart: Filament's block, the watcher's title as it names it, and the reviewer's words", () => {
    const { guidanceParts, GUIDE_HEAD, WAKE_END } = watchersCore;
    const text = "You drifted: the parser, not the lexer.\n\nGo back to the parser.";
    const words = routinesCore.guideWords({ id: "r1", title: "Supervisor" }, { project: "app", byName: "Lead", text });
    const parts = guidanceParts(/** @type {any} */ ({ role: "user", content: [{ type: "text", text: "[Filament: a line ahead of it.]" }, { type: "text", text: words }] }));
    assert.deepEqual([parts?.title, parts?.text], ["Supervisor", text]);
    assert.ok(parts?.head.startsWith(GUIDE_HEAD) && parts.head.endsWith(WAKE_END), "the head is Filament's block, whole");
    assert.equal(`${parts?.head}\n\n${parts?.text}`, words, "nothing of the message is lost between them");
    assert.equal(guidanceParts({ content: words })?.text, text, "a message of one string");
    // A title may hold what its block is written with.
    const odd = routinesCore.guideWords({ id: "r12", title: "The “strict” one (v2)" }, { project: "app", byName: "Lead", text: "Stop." });
    assert.deepEqual([guidanceParts({ content: odd })?.title, guidanceParts({ content: odd })?.text], ["The “strict” one (v2)", "Stop."]);
    assert.equal(guidanceParts({ content: "Make the login page." }), null, "the person's message is none");
    assert.equal(guidanceParts(null), null);
  });

  // (fails before: yes — no `wokeParts`: a wake's capsule said "A watcher woke this chat" of every watcher)
  test("what woke a chat, for its turn's capsule: the watcher, and what it heard by its trigger — one event or several, the chat a link's part; Run now says who pressed", () => {
    const { wokeParts } = watchersCore;
    const TURN = /** @type {const} */ ({ kind: "turn", chat: "c2", turns: "all", every: 1 });
    const e = (/** @type {any} */ o) => ({ id: "e1", kind: "turn", at: at(9, 30), chain: "c2", summary: "Turn 4 of Build the login flow ended: nothing changed", ...o });
    /** @param {any} t @param {any[]} events @param {number} [more] */
    const woke = (t, events, more = 0) => wokeParts("Supervisor", t, { events, more }, { nameOf });
    assert.deepEqual(woke(TURN, [e({})]), ["“Supervisor” woke this chat · a turn of ", BUILD, " ended"]);
    assert.deepEqual(woke(TURN, [e({}), e({ id: "e2" })], 1), ["“Supervisor” woke this chat · 3 turns of ", BUILD, " ended"]);
    assert.equal(namedText(woke({ kind: "task", chat: "c2", on: ["done", "blocked"] }, [e({ kind: "task" })])), "“Supervisor” woke this chat · a task of Build the login flow is done or blocked");
    // Of any chat: named where every event is one chat's, counted where they are several chats'.
    assert.equal(namedText(woke({ kind: "ask", afterMin: 10 }, [e({ kind: "ask" })])), "“Supervisor” woke this chat · a question of Build the login flow waits for you");
    assert.equal(namedText(woke({ kind: "shell" }, [e({ kind: "shell" }), e({ id: "e2", kind: "shell", chain: "c1" })])), "“Supervisor” woke this chat · 2 commands of 2 chats failed");
    assert.equal(namedText(woke({ kind: "subagent", chat: "c2" }, [e({ kind: "subagent" })])), "“Supervisor” woke this chat · a sub-agent of Build the login flow reported");
    assert.deepEqual(woke({ kind: "commit", branch: "main" }, [e({ kind: "commit", chain: undefined })]), ["“Supervisor” woke this chat · new commits on main"]);
    assert.deepEqual(woke({ kind: "connection", tool: "mcp__linear__list_issues", everyMin: 15 }, [e({ kind: "connection", chain: undefined })]), ["“Supervisor” woke this chat · linear's list_issues said something new"]);
    // Run now: the person's, or a chat's.
    assert.deepEqual(wokeParts("Supervisor", TURN, null, { nameOf, by: "you" }), ["“Supervisor” woke this chat · you pressed Run now"]);
    assert.deepEqual(wokeParts("Supervisor", TURN, null, { nameOf, by: "agent", startedBy: { chain: "c1", byName: "Lead" } }), ["“Supervisor” woke this chat · ", LEAD, " pressed Run now"]);
  });

  // (fails before: yes — the page said a routine's words of every watcher: Pause "It runs no more by itself", Put back
  // "on at its times", the sheet's "not now")
  test("what each press does, by what it is: a routine at times runs, a watcher listens — and one that tells only you has no Run now", () => {
    const routine = routinesCore.rowWords(timed(), { now: NOW, nameOf });
    assert.deepEqual(routine.press, {
      on: "Everything it will do: nothing runs until you switch it on",
      what: "Its words, its times, what it may do",
      run: "Once, now: a new chat, as at its time",
      pause: "It runs no more by itself until you resume it",
      resume: "It runs at its times again; the ones it was paused through are not made up",
      back: "As it was: on at its times, or proposed",
      remove: "Nothing of it runs; its Space's Add to this Space… puts it back",
      removed: "Nothing of it runs by itself any more; a run under way goes on, its chat's Stop there. Its Space's Add to this Space… puts it back as it was.",
      more: "Pause, Run now or Remove it from the ⋯ on its row",
      chose: "Your choice for this routine",
    });
    assert.equal(routine.idle, "not now");
    const LISTENS = {
      on: "Everything it will do: it listens only once you switch it on",
      what: "Its words, what it watches, what it may do",
      pause: "It listens no more until you resume it",
      resume: "It listens again; what happened while it was paused is not made up",
      back: "As it was: listening, or proposed",
      remove: "It listens no more; its Space's Add to this Space… puts it back",
      // (fails before: yes — its sheet said "Your choice for this routine" of the model the person chose for a watcher)
      chose: "Your choice for this watcher",
    };
    const RUNS = "It listens no more, and wakes nothing; a run under way goes on, its chat's Stop there. Its Space's Add to this Space… puts it back as it was.";
    const MORE = "Its switch pauses it; Run now and Remove are in the ⋯ on its row";
    assert.deepEqual(row({}).press, { ...LISTENS, run: "Once, now: a new chat, with what it heard", removed: RUNS, more: MORE });
    assert.deepEqual(row({ wakes: "chat" }).press, { ...LISTENS, run: "Once, now: a turn of its own in Lead, with what it heard", removed: RUNS, more: MORE });
    assert.deepEqual(row({ wakes: "you" }).press, { ...LISTENS, run: "", removed: "It listens no more, and tells you nothing. Its Space's Add to this Space… puts it back as it was.", more: "Its switch pauses it; Remove is in the ⋯ on its row" });
    assert.equal(row({}).idle, "listening", "on, nothing waiting: its sheet's When says it listens");
  });

  // (fails before: yes — the head counted a watcher as a routine: "Runs by itself: 1 routine")
  test("the head: how many listen, and Pause all in the Routines head's own words", () => {
    const { headWords, listenWords } = routinesCore;
    assert.equal(listenWords(0, { now: NOW }), "");
    assert.equal(listenWords(1, { now: NOW }), "Listening: 1 watcher");
    assert.equal(listenWords(3, { now: NOW }), "Listening: 3 watchers");
    assert.equal(listenWords(2, { now: NOW, pausedSince: at(9, 20) }), "Paused since today 09:20: 2 watchers, nothing starts by itself until you resume");
    assert.equal(listenWords(2, { now: NOW, pausedSince: at(9, 20), pausedBy: { chain: "c2", byName: "Docs", line: "CI is red" } }), "Docs paused all at today 09:20: CI is red · 2 watchers, nothing starts by itself until you resume");
    assert.equal(headWords([{ title: "Brief", nextAt: null }], [], { now: NOW, pausedSince: at(9, 20) }), "Paused since today 09:20: 1 routine, nothing starts by itself until you resume", "the Routines head's, the same sentence");
  });

  // (fails before: yes — "a routine needs its words (text): what the agent does at each run", for one that runs nothing)
  test("a watcher that tells only you needs no words; any other does, and a change cannot leave one without", () => {
    const { routineClash, routineFields } = routinesCore;
    /** @param {any} input @param {boolean} [create] */
    const refused = (input, create = true) => {
      const f = routineFields(input, { create });
      assert.equal(f.ok, false, JSON.stringify(input));
      return f.ok ? "" : f.error;
    };
    const told = routineFields({ title: "Deploy watch", trigger: { kind: "commit", branch: "main" }, wakes: "you" }, { create: true });
    assert.ok(told.ok, JSON.stringify(told));
    assert.equal(told.fields.task, "");
    assert.equal(refused({ title: "W", trigger: { kind: "commit", branch: "main" } }), NEEDS_WORDS, "one that wakes a new chat runs: it needs them");
    assert.equal(refused({ title: "W", trigger: { kind: "turn", chat: "c2" }, wakes: "chat", text: " " }), NEEDS_WORDS);
    assert.equal(refused({ title: "B", when: "daily 09:00" }), NEEDS_WORDS, "a routine at times, as it was");
    assert.deepEqual([routineClash({ trigger: { kind: "commit", branch: "main" }, wakes: "you", task: "" }), routineClash({ task: "" }), routineClash({ task: "x" })], [null, NEEDS_WORDS, null]);
    // The store asks it of the whole record: a change that would make it run asks for its words.
    const store = createSpaceStore({ dir: null, now: () => at(9) });
    assert.equal(store.routinePropose("p1", told.fields, BY).task, "");
    /** @param {() => unknown} fn */
    const refusal = (fn) => {
      try {
        fn();
      } catch (/** @type {any} */ e) {
        return [e.status, e.message];
      }
      return null;
    };
    assert.deepEqual(refusal(() => store.routinePropose("p1", { wakes: "new" }, BY, "r1")), [409, `“Deploy watch”: ${NEEDS_WORDS}.`]);
    assert.equal(store.routinePropose("p1", { wakes: "new", task: "Read the commits." }, BY, "r1").wakes, "new", "with its words, it may");
    const none = routineFields({ text: "" }, { create: false });
    assert.ok(none.ok, JSON.stringify(none));
    assert.deepEqual(refusal(() => store.routinePropose("p1", none.fields, BY, "r1")), [409, `“Deploy watch”: ${NEEDS_WORDS}.`], "nor may one that runs lose them");
  });

  // (fails before: yes — nothing said which watchers are a chat's)
  test("a chat's watchers: those whose trigger names it, then those that wake it, each with the line's short words", () => {
    const { chatWatchers } = routinesCore;
    const rows = [
      { project: "p1", r: watcher({ wakes: "chat", guides: true }) },
      { project: "p1", r: watcher({ id: "r2", title: "Deploy watch", trigger: { kind: "commit", branch: "main" }, wakes: "chat" }) },
      { project: "p1", r: watcher({ id: "r3", title: "Told", trigger: { kind: "task", chat: "c2", on: ["done", "blocked"] }, wakes: "you", paused: true }) },
      // One that watches the chat it wakes: said once, of the chat watched.
      { project: "p2", r: watcher({ title: "Self", madeIn: "c2", madeBy: "Build the login flow", trigger: { kind: "turn", chat: "c2", turns: "all", every: 3 }, wakes: "chat" }) },
      { project: "p1", r: watcher({ id: "r5", state: "removed" }) },
      { project: "p1", r: timed() },
      { project: "p1", r: watcher({ id: "r7", title: "Later", state: "proposed", seen: null }) },
    ];
    /** @param {string} chain */
    const of = (chain) => chatWatchers(rows, chain, { nameOf });
    // A watcher of the turns that change something says so: it hears no turn that only talks.
    // (fails before: yes — "reviews each turn", "wakes this chat after each turn" of one that hears only the turns that
    // change files or mark tasks done)
    assert.deepEqual(of("c2").map((w) => [w.project, w.id, w.role, w.state, w.paused, w.words.lead, w.words.name, w.words.does]), [
      ["p1", "r1", "watched", "on", false, "Watched by", "Supervisor", "reviews each turn that changes files, may guide"],
      ["p1", "r3", "watched", "on", true, "Watched by", "Told", "tells you of each task done or blocked"],
      ["p2", "r1", "watched", "on", false, "Watched by", "Self", "wakes this chat after every 3 turns"],
      ["p1", "r7", "watched", "proposed", false, "Watched by", "Later", "reviews each turn that changes files"],
    ]);
    assert.deepEqual(of("c1").map((w) => [w.id, w.title, w.role, w.words.lead, w.words.name, w.words.does]), [
      ["r1", "Supervisor", "watches", "Watching", "Build the login flow", "wakes this chat after each turn that changes files, may guide it"],
      ["r2", "Deploy watch", "watches", "Watching", "commits on main", "wakes this chat on each new commit"],
    ]);
    assert.equal(of("c1")[0].words.full, "“Supervisor”: after each turn of Build the login flow that changes files or marks tasks done · wakes Lead", "the whole of it, for the line's tip");
    assert.deepEqual(of("c9"), [], "a chat no watcher names");
    // Every turn, and every third: each said as it is, short.
    const { triggerShort } = watchersCore;
    /** @param {"changed" | "all"} turns @param {number} every */
    const short = (turns, every) => triggerShort({ kind: "turn", chat: "c2", turns, every });
    assert.deepEqual([short("all", 1), short("all", 3)], [{ each: "each turn", when: "after each turn" }, { each: "every 3 turns", when: "after every 3 turns" }]);
    assert.deepEqual([short("changed", 1), short("changed", 3)],
      [{ each: "each turn that changes files", when: "after each turn that changes files" }, { each: "every 3 turns that change files", when: "after every 3 turns that change files" }]);
  });

  // (fails before: yes — a chat's watcher said neither the chat to open for it nor that Pause all holds it)
  test("a chat's watcher names the chat to open for it — the one it wakes, else its newest run's —, and says where Pause all holds it", () => {
    const { chatWatchers } = routinesCore;
    const rows = [
      { project: "p1", r: watcher({ wakes: "chat", guides: true }) },
      { project: "p1", r: watcher({ id: "r2", title: "Night watch", guides: true, last: run({ state: "done", ended: at(9, 11) }) }) },
      { project: "p1", r: watcher({ id: "r3", title: "Fresh", guides: true }) },
      { project: "p1", r: watcher({ id: "r4", title: "Told", wakes: "you" }) },
    ];
    assert.deepEqual(chatWatchers(rows, "c2", { nameOf }).map((w) => [w.id, w.chat, "pausedAll" in w]), [["r1", "c1", false], ["r2", "c9", false], ["r3", "", false], ["r4", "", false]]);
    assert.deepEqual(chatWatchers(rows, "c2", { nameOf, pausedAll: true }).map((w) => w.pausedAll), [true, true, true, true]);
    assert.deepEqual(chatWatchers(rows, "c1", { nameOf, pausedAll: true }).map((w) => [w.role, w.pausedAll]), [["watches", true]], "the chat it wakes hears it too");
  });
});

/** A project as the person has one: a git repository. @param {string} root */
const repo = (root) => {
  const git = (/** @type {string[]} */ ...args) => execFileSync("git", ["-c", "user.email=ada@example.com", "-c", "user.name=Ada Lovelace", ...args], { cwd: root, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  writeFileSync(join(root, "README.md"), "app\n");
  git("add", ".");
  git("commit", "-q", "-m", "First");
};

describe("the server says them: the Space's read, the left bar's, a chat's transcript and the feed (a real Filament)", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  /** The calls held at the model until a test lets each go, by the name its words say (`HOLD:<name>`). @type {Map<string, ReturnType<typeof gate>>} */
  const gates = new Map();
  /** The held calls that reached the model. @type {Set<string>} */
  const arrived = new Set();
  /** @param {string} name */
  const gateOf = (name) => gates.get(name) || /** @type {ReturnType<typeof gate>} */ (gates.set(name, gate()).get(name));
  /** A chat of the project. */
  const chat = async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-watch-ui-"));
    made.push(root);
    repo(root);
    up = await fakeUpstream(async (/** @type {any} */ call) => {
      const last = (call.body?.messages || []).at(-1);
      const words = typeof last?.content === "string" ? last.content : Array.isArray(last?.content) ? last.content.map((/** @type {any} */ b) => b?.text || "").join("\n") : "";
      const hold = /HOLD:(\w+)/.exec(words);
      if (hold) {
        arrived.add(hold[1]);
        await gateOf(hold[1]).promise;
      }
      return anthropicReply("Okay.", { model: String(call.body?.model || "") });
    });
    shim = await startApp({
      memory: true,
      configure: (/** @type {any} */ cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-model": { input: 1, output: 1, contextTokens: 200000 } } }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    for (const held of gates.values()) held.open();
    await shim?.stop();
    await up?.close();
  });

  // (fails before: yes — the transcript had no `watchers`, the feed no word of them, the Space's read no `listening`,
  // and the left bar's read counted a watcher among the routines)
  test("a chat's transcript lists its watchers, the feed says the list again at each change of them; the Space's read counts who listens, the left bar's shows Watchers apart from Routines", async () => {
    const lead = await chat();
    const build = await chat();
    const project = String(shim.app.memory.archive?.getChain(lead)?.project_id || "");
    assert.ok(project, "the chat is of a project");
    const spaces = shim.app.spaces;
    spaces.make(project);
    /** @type {any[]} */
    const heard = [];
    const off = shim.app.events.subscribe("turns", (/** @type {any} */ p) => void (p?.type === "watchers" && heard.push(p)));
    /** The newest list the feed said of a chat. @param {string} chain */
    const said = (chain) => heard.filter((p) => p.chainId === chain).at(-1)?.watchers;
    try {
      const f = routinesCore.routineFields({ title: "Supervisor", text: "Read its turn.", trigger: { kind: "turn", chat: build, turns: "all" }, wakes: "chat", guides: true }, { create: true });
      assert.ok(f.ok, JSON.stringify(f));
      const id = spaces.routinePropose(project, f.fields, { chain: lead, byName: "Lead", model: "agent/brain-model", nameOf: () => "Lead" }).id;
      await until(() => said(build)?.[0]?.state === "proposed" || null, "the feed: proposed");
      spaces.routineOn(project, id);
      await until(() => said(build)?.[0]?.state === "on" && said(lead)?.[0]?.state === "on" ? true : null, "the feed: on, to both chats");
      /** @param {string} chain */
      const transcript = async (chain) => (await (await shim.api(`/api/sessions/${encodeURIComponent(chain)}/transcript`)).json()).watchers;
      const watched = await transcript(build);
      assert.deepEqual(watched.map((/** @type {any} */ w) => [w.id, w.project, w.title, w.state, w.paused, w.role, w.words.lead, w.words.name, w.words.does]),
        [[id, project, "Supervisor", "on", false, "watched", "Watched by", "Supervisor", "reviews each turn, may guide"]]);
      const watches = await transcript(lead);
      assert.deepEqual(watches.map((/** @type {any} */ w) => [w.id, w.role, w.words.lead, w.words.does]), [[id, "watches", "Watching", "wakes this chat after each turn, may guide it"]]);
      assert.deepEqual([said(build), said(lead)], [watched, watches], "the feed's list is the read's");
      // The Space's read: who listens, apart from what runs at times; the left bar's: Watchers, no Routines.
      const at = `/api/space/${encodeURIComponent(project)}`;
      const space = await (await shim.api(at)).json();
      assert.deepEqual([space.runs.head, space.runs.listening], ["", "Listening: 1 watcher"]);
      const w = space.runs.routines[0].words;
      assert.deepEqual([w.wakes.label, w.wakes.parts[0].chain, w.wakes.parts[1], w.watches[1].chain, w.guides[1].chain, w.heard, w.press.pause],
        ["Wakes", lead, ", in a turn that only reads", build, build, "Nothing heard yet", "It listens no more until you resume it"]);
      const bar = await (await shim.api("/api/spaces")).json();
      assert.deepEqual([bar.watchers[project], bar.routines[project]], [{ failed: false }, undefined]);
      // Paused, the press the row's switch and the line's Pause send: the feed says it to both chats.
      const n = heard.length;
      const paused = await shim.api(`${at}/routines/${encodeURIComponent(id)}/pause`, { method: "POST", body: { paused: true } });
      assert.equal(paused.status, 200, await paused.clone().text());
      await until(() => said(build)?.[0]?.paused === true && said(lead)?.[0]?.paused === true ? true : null, "the feed: paused");
      assert.deepEqual(heard.slice(n).map((p) => p.chainId).sort(), [build, lead].sort(), "once to each chat it names");
      assert.equal((await (await shim.api(at)).json()).runs.listening, "", "none listens while it is paused");
      // A change of the Space that moves no watcher says nothing of them.
      const quiet = heard.length;
      spaces.routinePropose(project, /** @type {any} */ ({ title: "Brief", when: "daily 09:00", task: "Read what came in.", writes: false }), { chain: lead, byName: "Lead", model: "agent/brain-model" });
      assert.equal(heard.length, quiet, "a routine at times is no chat's watcher");
      // Removed: each chat's list empties.
      const gone = await shim.api(`${at}/routines/${encodeURIComponent(id)}`, { method: "DELETE" });
      assert.equal(gone.status, 200, await gone.clone().text());
      await until(() => said(build)?.length === 0 && said(lead)?.length === 0 ? true : null, "the feed: none");
      assert.deepEqual(await transcript(build), []);
    } finally {
      off();
    }
  });

  // (fails before: yes — a transcript said `guided: true` and `watched: true` alone and nothing of a turn's reviews, the
  // feed had no `reviews`, and a watcher's row counted none)
  test("a watcher's wake reviews a turn and its guidance lands as a turn: the transcript says the reviews by turn, the guidance's parts and what woke the chat; the feed says the reviews to the chat they are of; its row counts them", async () => {
    const lead = await chat();
    const build = await chat();
    const project = String(shim.app.memory.archive?.getChain(lead)?.project_id || "");
    const spaces = shim.app.spaces;
    spaces.make(project);
    /** @type {any[]} */
    const heard = [];
    const off = shim.app.events.subscribe("turns", (/** @type {any} */ p) => void (p?.type === "reviews" && heard.push(p)));
    /** @param {string} chain */
    const transcript = async (chain) => /** @type {any} */ (await (await shim.api(`/api/sessions/${encodeURIComponent(chain)}/transcript`)).json());
    const TEXT = "You drifted: the parser, not the lexer.\n\nGo back to the parser.";
    try {
      // Its wake waits at the model (HOLD:f) until the test lets it go: its run is under way while it guides.
      const f = routinesCore.routineFields({ title: "Supervisor", text: "Read its turn. HOLD:f", trigger: { kind: "turn", chat: build, turns: "all" }, wakes: "chat", guides: true }, { create: true });
      assert.ok(f.ok, JSON.stringify(f));
      const id = spaces.routinePropose(project, f.fields, { chain: lead, byName: "Lead", model: "agent/brain-model", nameOf: () => "Lead" }).id;
      spaces.routineOn(project, id);
      const of = () => spaces.get(project).routines.find((/** @type {any} */ r) => r.id === id);
      // Each chat's page read it: no turn of either is reviewed yet.
      assert.deepEqual([(await transcript(build)).reviews, (await transcript(lead)).reviews], [{}, {}]);
      const said = await shim.api(`/api/sessions/${encodeURIComponent(build)}/turns`, { method: "POST", body: { stream: false, content: "Make the login page." } });
      assert.equal(said.status, 200, await said.clone().text());
      await until(() => arrived.has("f") || null, "the watcher's wake, at the model", { timeoutMs: 30_000 });
      // The woken chat's agent guides the chat it reviewed: a turn of Filament's own there.
      const sent = await /** @type {any} */ (shim.app).guidance.send({ project, from: lead, id, text: TEXT });
      assert.deepEqual([sent.ok, sent.how], [true, "turn"], JSON.stringify(sent));
      await until(() => spaces.guidance(project).at(-1)?.state === "read" || null, "the guidance turn, ended", { timeoutMs: 30_000 });
      gateOf("f").open();
      await until(() => of()?.last?.state === "done" || null, "the watcher's run, ended", { timeoutMs: 30_000 });
      await until(() => heard.length || null, "the feed's reviews");
      // The watched chat: its guidance turn's parts, from what its Space keeps; the turn the watcher read, by its number.
      const watched = await transcript(build);
      assert.deepEqual(watched.turns.map((/** @type {any} */ t) => [t.n, !!t.guided, t.guide ?? null]), [[1, false, null], [2, true, { watcher: id, project, title: "Supervisor", text: TEXT, chat: lead, paused: false }]]);
      assert.deepEqual(Object.keys(watched.reviews), ["1"]);
      const [review] = watched.reviews[1];
      assert.deepEqual([watched.reviews[1].length, review.watcher, review.project, review.title, review.guided, typeof review.at], [1, id, project, "Supervisor", true, "number"]);
      assert.match(review.words, /^“Supervisor” read this turn at (\w{3} )?\d\d:\d\d and wrote this chat guidance$/);
      // The feed said them to the chat they are of, as its transcript says them; the chat it woke has none.
      assert.deepEqual([[...new Set(heard.map((p) => p.chainId))], heard.at(-1).reviews], [[build], watched.reviews]);
      // The chat it woke: its turn says which watcher woke it and what it heard, the chat it names apart.
      const woken = await transcript(lead);
      const wake = woken.turns.find((/** @type {any} */ t) => t.watched);
      assert.deepEqual([wake.watch.id, wake.watch.project, wake.watch.title, wake.watch.words.length, wake.watch.words[0], wake.watch.words[1].chain, wake.watch.words[2]],
        [id, project, "Supervisor", 3, "“Supervisor” woke this chat · a turn of ", build, " ended"]);
      assert.ok(wake.watch.words[1].name, "the chat it names, by its name");
      assert.deepEqual(woken.reviews, {});
      // Its row on the Watchers page counts what it reviewed today.
      const at = `/api/space/${encodeURIComponent(project)}`;
      const row = (await (await shim.api(at)).json()).runs.routines.find((/** @type {any} */ r) => r.id === id);
      assert.equal(row.words.reviewed, "1 reviewed today · 1 guided");
      // Paused, by the write the card's Pause sends: the guidance turn says so.
      const paused = await shim.api(`${at}/routines/${encodeURIComponent(id)}/pause`, { method: "POST", body: { paused: true } });
      assert.equal(paused.status, 200, await paused.clone().text());
      assert.equal((await transcript(build)).turns[1].guide.paused, true);
      // The Space keeps that guidance no more: the card's words are split from the turn's message, with nothing to press.
      spaces.remove(project);
      const later = await transcript(build);
      assert.deepEqual([later.turns[1].guide, later.reviews], [{ title: "Supervisor", text: TEXT }, {}]);
    } finally {
      off();
    }
  });

  test("the feed carries it on the topic every page hears, and the page keeps the list with its chat", () => {
    const server = readFileSync("src/server.js", "utf8");
    assert.match(server, /publish: \(chainId, watchers\) => events\.publish\("turns", \{ type: "watchers", chainId, watchers \}\)/);
    assert.match(server, /publishReviews: \(chainId, reviews\) => events\.publish\("turns", \{ type: "reviews", chainId, reviews \}\)/);
    assert.match(server, /events\.subscribe\("space", \(\) => chatWatching\.moved\(\)\)/);
  });

  // (fails before: yes — `createChatWatchers` said a chat's watchers alone: no `reviews`, no `guide`, no `woke`)
  test("a chat that read its reviews is told when they move, and no other; a guidance turn's parts come from what its Space keeps, a wake's words from what its turn keeps", async () => {
    const { createChatWatchers } = await import("../src/app/chat-watchers.js");
    const v = (/** @type {any} */ o) => ({ chain: "c2", turn: 3, watcher: "r1", title: "Supervisor", at: at(9, 20), guided: false, ...o });
    /** One Space, as its store reads it. @type {any} */
    const space = {
      routines: [watcher({ wakes: "chat", guides: true })],
      reviews: [v({})],
      guidance: [{ id: "g1", watcher: "r1", title: "Supervisor", from: "c1", to: "c2", text: "Go back to the parser.", at: at(9, 30), state: "read", how: "turn", turn: 4 }],
    };
    /** @type {number | null} */
    let pausedAll = null;
    /** @type {any[]} */
    const heard = [];
    const told = createChatWatchers({
      spaces: { routinesAll: () => space.routines.map((/** @type {any} */ r) => ({ project: "p1", r })), projects: () => ["p1"], get: () => space, pausedSince: () => pausedAll },
      nameOf,
      publish: () => {},
      publishReviews: (chain, reviews) => void heard.push([chain, reviews]),
      now: () => NOW,
    });
    const R3 = { watcher: "r1", project: "p1", title: "Supervisor", at: at(9, 20), guided: false, words: "“Supervisor” read this turn at 09:20 and sent nothing" };
    const R4 = { watcher: "r1", project: "p1", title: "Supervisor", at: at(9, 45), guided: true, words: "“Supervisor” read this turn at 09:45 and wrote this chat guidance" };
    assert.deepEqual(told.reviews("c2"), { 3: [R3] }, "the transcript's, by its turns' numbers");
    told.moved();
    assert.deepEqual(heard, [], "nothing moved: nothing said");
    // A run ends: the turn it read is reviewed. The chat that read its reviews hears; one that read none hears nothing.
    space.reviews = [...space.reviews, v({ turn: 4, at: at(9, 45), guided: true }), v({ chain: "c7", turn: 1 })];
    told.moved();
    assert.deepEqual(heard, [["c2", { 3: [R3], 4: [R4] }]]);
    told.moved();
    assert.equal(heard.length, 1, "said once");
    // A chat with none that read so hears its first; one whose Space forgot them hears that they went.
    assert.deepEqual(told.reviews("c8"), {});
    space.reviews = [...space.reviews.filter((/** @type {any} */ x) => x.chain !== "c2"), v({ chain: "c8", turn: 2, at: at(9, 50) })];
    told.moved();
    assert.deepEqual(heard.slice(1).map((x) => [x[0], Object.keys(x[1])]).sort(), [["c2", []], ["c8", ["2"]]]);
    // A guidance turn's parts: its watcher, the chat that wrote it, its words, whether it is paused.
    assert.deepEqual(told.guide("c2", 4), { watcher: "r1", project: "p1", title: "Supervisor", text: "Go back to the parser.", chat: "c1", paused: false });
    assert.equal(told.guide("c2", 5), null, "a turn the Space keeps no guidance of");
    assert.equal(told.guide("c9", 4), null, "another chat's turn of that number");
    space.routines = [watcher({ wakes: "chat", guides: true, paused: true })];
    assert.equal(told.guide("c2", 4)?.paused, true);
    // Its watcher removed since: its words and the chat that wrote them, nothing of it to pause.
    space.routines = [watcher({ wakes: "chat", guides: true, state: "removed" })];
    assert.deepEqual(told.guide("c2", 4), { title: "Supervisor", text: "Go back to the parser.", chat: "c1" });
    // What woke a chat, as its turn keeps it: each chat by its name now.
    assert.deepEqual(told.woke({ id: "r1", project: "p1", title: "Supervisor", words: ["“Supervisor” woke this chat · a turn of ", { chain: "c2", name: "A name it had" }, " ended"] }),
      { id: "r1", project: "p1", title: "Supervisor", words: ["“Supervisor” woke this chat · a turn of ", BUILD, " ended"] });
    assert.deepEqual([told.woke(undefined), told.woke({ id: "r1" })], [null, null], "a turn that keeps none");
    // Pause all, said on each of a chat's watchers.
    space.routines = [watcher({ wakes: "chat", guides: true })];
    assert.equal("pausedAll" in told.of("c2")[0], false);
    pausedAll = at(9, 55);
    assert.equal(told.of("c2")[0].pausedAll, true);
  });

  // (fails before: yes — on a Filament that had said nothing on the feed yet, a chat that read its watcher in its
  // transcript was not told when the watcher went: `heard` was [], and its line stood)
  test("a chat told of its watcher by its transcript alone is told when the watcher goes", async () => {
    const { createChatWatchers } = await import("../src/app/chat-watchers.js");
    let rows = [{ project: "p1", r: watcher({ wakes: "chat" }) }];
    /** @type {any[]} */
    const heard = [];
    const told = createChatWatchers({ spaces: { routinesAll: () => rows }, nameOf, publish: (chain, list) => void heard.push([chain, list.length]) });
    assert.equal(told.of("c2").length, 1, "the transcript's list");
    rows = [{ project: "p1", r: watcher({ wakes: "chat", state: "removed" }) }];
    told.moved();
    assert.deepEqual(heard, [["c2", 0]], "the chat that read it hears it went; the one that read nothing has nothing to un-say");
  });
});

/** Every element under one, in order. @param {any} el @returns {any[]} */
const all = (el) => [el, ...[...(el.children || [])].flatMap(all)];

describe("Space › Watchers, on the page", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {Record<string, any>} */
  const had = {};
  /** @type {any[]} */
  const streams = [];
  const STUBS = {
    requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
    cancelAnimationFrame: (/** @type {any} */ id) => clearTimeout(id),
    // A sheet asks what had the focus; nothing in the stub page is an element of the browser's.
    HTMLElement: class {},
    // The events stream, one for the page: a test hands the page a message through it.
    EventSource: class {
      constructor() {
        streams.push(this);
      }
      addEventListener() {}
      close() {}
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { hash: "", replace(/** @type {string} */ u) { this.hash = u; } },
  };
  /** A message on the events stream, as the server sends one. @param {any} msg */
  const hear = (msg) => {
    for (const s of streams) s.onmessage?.({ data: JSON.stringify(msg) });
  };
  /** Every page drawn, stopped at the end so no tick outlives its test. @type {(() => void)[]} */
  const stops = [];
  before(() => {
    doc = stubDocument();
    for (const [k, v] of Object.entries(STUBS)) {
      had[k] = Object.prototype.hasOwnProperty.call(g, k) ? g[k] : undefined;
      g[k] = v;
    }
    // A toast's own timer: kept on the page here, so no test waits for one to go.
    g.window.setTimeout = () => 0;
  });
  after(() => {
    for (const stop of stops) stop();
    doc.restore();
    for (const k of Object.keys(STUBS)) {
      if (had[k] === undefined) delete g[k];
      else g[k] = had[k];
    }
  });
  beforeEach(() => {
    posted.length = 0;
    serve = () => undefined;
  });

  /** @param {any} root @param {string} sel */
  const texts = (root, sel) => root.querySelectorAll(sel).map((/** @type {any} */ e) => e.textContent);
  /** The newest of what the page shows over itself: a menu, a question's words. @param {string} sel @returns {any} */
  const newest = (sel) => doc.document.body.querySelectorAll(sel).at(-1);
  /** The newest menu's rows, opened from a button; a second press on the button closes it. @param {any} b @param {string} what */
  const menuOf = async (b, what) => {
    b.dispatch("click");
    await until(() => doc.document.body.querySelector(".zc-menu"), what);
    return /** @type {any[]} */ (newest(".zc-menu").querySelectorAll(".zc-menu-item"));
  };
  /** @param {any[]} items */
  const labels = (items) => items.map((i) => i.querySelector(".zc-menu-label-line").textContent);
  /** @param {any[]} items @param {string} label */
  const item = (items, label) => items.find((i) => i.querySelector(".zc-menu-label-line").textContent === label);
  const sheets = () => doc.document.body.querySelectorAll(".srt-sheet");
  /** The button of a dialog's foot that reads so. @param {string} label */
  const dialogButton = (label) => {
    const b = doc.document.body.querySelectorAll(".zc-dialog-foot .zc-btn").find((/** @type {any} */ x) => x.textContent === label);
    assert.ok(b, `the dialog's ${label}`);
    return b;
  };

  /** A routine as the Space's read gives it: as kept, with its project, its chat's name and Filament's words. @param {import("../src/core/routines.js").Routine} r @param {any} [o] */
  const said = (r, o = {}) => ({ ...r, project: "p1", madeName: nameOf(r.madeIn), words: routinesCore.rowWords(r, { now: NOW, nameOf, ...o }) });
  const W = {
    // Wakes the chat that proposed it, reading, and may guide the chat it watches.
    r1: said(watcher({ trigger: { kind: "turn", chat: "c2", turns: "all", every: 1 }, wakes: "chat", guides: true })),
    // Tells only you: no words of its own, nothing run.
    r2: said(watcher({ id: "r2", title: "Deploy watch", task: "", trigger: { kind: "commit", branch: "main" }, wakes: "you", seen: { from: at(9), at: at(9, 30), ids: ["e1"] } })),
    // Proposed.
    r3: said(watcher({ id: "r3", title: "Triage", trigger: { kind: "ask", afterMin: 10 }, wakes: "chat", state: "proposed", seen: null, at: at(9, 5) })),
    // Paused by Filament, its last run failed; its turn works as its chat does.
    r4: said(watcher({ id: "r4", title: "Fixer", wakes: "chat", writes: true, paused: true, pausedWhy: "the chat it wakes (Lead) is gone", last: run({ state: "failed", ended: at(9, 11), why: "the chat it wakes is gone" }) })),
    // A new chat each time, reading; its last run done.
    r5: said(watcher({ id: "r5", title: "Night watch", last: run({ state: "done", ended: at(9, 10) + 41_000, said: "All green" }) })),
    // A new chat each time, in a lane of its own; a run under way.
    r6: said(watcher({ id: "r6", title: "Lane fixer", writes: true, last: run({ state: "running" }), pending: { events: [{ id: "e2", kind: "turn", at: at(9, 40), summary: "a turn" }], more: 0 } }), { live: { busy: true, asking: false } }),
  };
  const T1 = said(timed());
  /** What runs by itself, as the Space's read says it. @param {any} [o] */
  const runsOf = (o = {}) => ({ head: "Runs by itself: 1 routine · next: Morning brief at 09:00", listening: "Listening: 4 watchers", pausedSince: null, routines: [T1, ...Object.values(W)], watches: [], ...o });

  /**
   * The Watchers part drawn by itself, with what the page hands it.
   * @param {{ all?: boolean, answer?: (path: string) => any }} [o]
   */
  const mount = async (o = {}) => {
    const { watchersPart } = await import("../src/ui/harness/space/watchers.js");
    const did = { wrote: /** @type {any[]} */ ([]), opened: /** @type {string[]} */ ([]), asked: /** @type {any[]} */ ([]), started: /** @type {any[]} */ ([]), paused: /** @type {boolean[]} */ ([]) };
    const part = watchersPart({
      all: !!o.all,
      place: () => ({ id: "p1", name: "web", cwd: "/w" }),
      write: async (project, method, path, body) => (did.wrote.push([project, method, path, body]), o.answer ? o.answer(path) : {}),
      pauseAll: async (on) => (did.paused.push(on), true),
      startWith: (cwd, words) => void did.started.push([cwd, words]),
      openChat: (chain) => void did.opened.push(chain),
      askChat: (chain, words) => void did.asked.push([chain, words]),
      openTab: () => {},
    });
    doc.document.body.append(part.el);
    /** @param {string} id */
    const rowOf = (id) => /** @type {any} */ (part.el.querySelector(`.swt-row[data-watcher="${id}"]`));
    return { part, did, el: /** @type {any} */ (part.el), rowOf };
  };

  // (fails before: yes — there was no Watchers part, and the Routines part listed every watcher under "On an event")
  test("the Watchers part lists the watchers alone, and the Routines part none of them; each page is there only where it has rows", async () => {
    const { watchersShown } = await import("../src/ui/harness/space/watchers.js");
    const { routinesPart, routinesShown } = await import("../src/ui/harness/space/routines.js");
    const { part, el } = await mount();
    assert.equal(el.hasAttribute("hidden"), true, "hidden until shown");
    part.paint(runsOf());
    part.show(true);
    assert.deepEqual([el.hidden, el.getAttribute("aria-label")], [false, "Watchers"]);
    assert.deepEqual(el.querySelectorAll(".swt-row").map((/** @type {any} */ r) => r.getAttribute("data-watcher")), ["r1", "r2", "r3", "r4", "r5", "r6"]);
    assert.equal(el.querySelector(".srt-row"), null, "no routine's row");
    const routines = routinesPart({ all: false, place: () => ({ id: "p1", name: "web", cwd: "/w" }), write: async () => ({}), pauseAll: async () => true, openChat: () => {}, openTab: () => {} });
    routines.paint(runsOf());
    const rel = /** @type {any} */ (routines.el);
    assert.deepEqual(rel.querySelectorAll(".srt-row").map((/** @type {any} */ r) => r.getAttribute("data-routine")), ["t1"], "the routine at times alone");
    assert.ok(!rel.querySelectorAll(".srt-sec").some((/** @type {any} */ s) => s.getAttribute("aria-label") === "On an event"), "no part for watchers there");
    // SG-D0: each page only where it has rows.
    assert.deepEqual([watchersShown(runsOf()), routinesShown(runsOf())], [true, true]);
    assert.deepEqual([watchersShown(runsOf({ routines: [T1] })), routinesShown(runsOf({ routines: Object.values(W) }))], [false, false], "a routine is no watcher, a watcher no routine");
    assert.equal(watchersShown(runsOf({ routines: [{ ...W.r1, state: "removed" }] })), false, "one removed shows no page");
    // One removed is listed on neither; nothing listed says so.
    part.paint(runsOf({ routines: [T1, { ...W.r1, state: "removed" }], listening: "" }));
    assert.deepEqual([el.querySelectorAll(".swt-row").length, el.querySelector(".swt-none").hidden], [0, false]);
  });

  // (fails before: yes — the dot read the last run alone: it stayed lit for one paused or proposed again, which runs
  // nothing and whose row says Paused or Proposed; `routinesFailed` was two copies of an expression)
  test("the dot is of what fails now: a failed last run counts while its watcher or routine is on, never once it is paused or proposed again", async () => {
    const { watchersFailed } = await import("../src/ui/harness/space/watchers.js");
    const { routinesFailed } = await import("../src/ui/harness/space/routines.js");
    const { standsFailed } = await import("../src/ui/harness/lib/space-view.js");
    /** One whose last run failed. @param {any} r @param {any} [more] */
    const bad = (r, more = {}) => ({ ...r, state: "on", paused: false, ...more, words: { ...r.words, tone: "bad" } });
    assert.deepEqual([watchersFailed(runsOf({ routines: [bad(W.r1)] })), routinesFailed(runsOf({ routines: [bad(T1)] }))], [true, true]);
    assert.deepEqual([watchersFailed(runsOf({ routines: [bad(T1)] })), routinesFailed(runsOf({ routines: [bad(W.r1)] }))], [false, false], "each its own kind's");
    for (const more of [{ state: "proposed" }, { paused: true }, { state: "removed" }]) {
      assert.deepEqual([watchersFailed(runsOf({ routines: [bad(W.r1, more)] })), routinesFailed(runsOf({ routines: [bad(T1, more)] }))], [false, false], JSON.stringify(more));
      assert.equal(standsFailed(bad(W.r1, more)), false, JSON.stringify(more));
    }
    // The page's own fixture: r4 is paused by Filament after a failed run, the others' last runs went well.
    assert.deepEqual([W.r4.words.tone, W.r4.paused, watchersFailed(runsOf())], ["bad", true, false]);
    assert.deepEqual([watchersFailed(null), routinesFailed(null), watchersFailed(runsOf({ routines: [] }))], [false, false, false]);
  });

  // (fails before: yes — a watcher's row was a routine's: one line "after each turn of … · wakes Lead · its turn held to reading")
  test("a row: its eye, its title and badge, then what it watches, whom it wakes or tells and what it may guide, each chat's name a link; one quiet line for how it stands", async () => {
    const { part, did, rowOf } = await mount();
    part.paint(runsOf());
    part.show(true);
    /** @param {string} id */
    const grid = (id) => rowOf(id).querySelectorAll(".swt-line").map((/** @type {any} */ l) => [l.querySelector(".swt-k").textContent, l.querySelector(".swt-v").textContent]);
    /** @param {string} id */
    const links = (id) => texts(rowOf(id), ".swt-chat");
    // Wakes its chat, reading, and guides.
    assert.deepEqual(grid("r1"), [
      ["Watches", "each turn of Build the login flow"],
      ["Wakes", "Lead, in a turn that only reads"],
      ["May", "guide Build the login flow · 3 for each message of yours there"],
    ]);
    assert.deepEqual(links("r1"), ["Build the login flow", "Lead", "Build the login flow"]);
    assert.deepEqual([rowOf("r1").getAttribute("class"), rowOf("r1").getAttribute("role"), rowOf("r1").getAttribute("data-key"), rowOf("r1").querySelector(".swt-t").textContent, rowOf("r1").querySelector(".swt-task").textContent],
      ["swt-row is-on", "listitem", "watcher:p1|r1", "Supervisor", "Read its turn; say where it drifted."]);
    assert.ok(rowOf("r1").querySelector(".swt-eye"), "its eye");
    assert.equal(rowOf("r1").querySelector(".swt-stands").textContent, "Nothing heard yet");
    // A chat's name opens that chat.
    const [watchedLink, wokenLink] = rowOf("r1").querySelectorAll(".swt-chat");
    assert.equal(watchedLink.getAttribute("title"), "Open Build the login flow");
    watchedLink.dispatch("click");
    wokenLink.dispatch("click");
    assert.deepEqual(did.opened, ["c2", "c1"]);
    // Tells only you: its label says so, no May, no words of its own to draw.
    assert.deepEqual(grid("r2"), [["Watches", "new commits on main"], ["Tells", "only you, in Needs you · runs nothing"]]);
    assert.deepEqual([links("r2"), rowOf("r2").querySelector(".swt-task"), rowOf("r2").querySelector(".swt-stands").textContent], [[], null, "last heard: today 09:30"]);
    // Proposed: its badge, nothing of how it stands.
    assert.deepEqual([rowOf("r3").getAttribute("class"), rowOf("r3").querySelector(".swt-badge").textContent, grid("r3"), rowOf("r3").querySelector(".swt-stands")],
      ["swt-row is-proposed", "Proposed", [["Watches", "a question of any chat waiting 10 min for you"], ["Wakes", "Lead, in a turn that only reads"]], null]);
    // Paused by Filament, its last run failed: the one word of its state carries the colour.
    assert.deepEqual([rowOf("r4").getAttribute("class"), rowOf("r4").querySelector(".swt-badge").textContent, grid("r4")[1]], ["swt-row is-paused", "Paused by Filament", ["Wakes", "Lead, in a turn that works as that chat does"]]);
    assert.deepEqual([rowOf("r4").querySelector(".swt-state").textContent, rowOf("r4").querySelector(".swt-state").getAttribute("class"), rowOf("r4").querySelector(".swt-stands").textContent],
      ["failed", "swt-state is-bad", "last: today 09:10 · failed: the chat it wakes is gone · paused by Filament: the chat it wakes (Lead) is gone — it listens again once you resume it"]);
    // A new chat each time, reading: its last run done, its answer's first line quoted.
    assert.deepEqual(grid("r5"), [["Watches", "each turn of Build the login flow that changes files or marks tasks done"], ["Wakes", "a new chat each time, reading only"]]);
    assert.deepEqual([rowOf("r5").querySelector(".swt-state").textContent, rowOf("r5").querySelector(".swt-state").getAttribute("class"), rowOf("r5").querySelector(".swt-said").textContent, rowOf("r5").querySelector(".swt-stands").textContent],
      ["done", "swt-state is-done", "“All green”", "last: today 09:10 · done in 41 s · “All green”"]);
    // In a lane of its own, a run under way, an event waiting for it.
    assert.deepEqual([grid("r6")[1], rowOf("r6").getAttribute("class"), rowOf("r6").querySelector(".swt-state").getAttribute("class"), rowOf("r6").querySelector(".swt-stands").textContent],
      [["Wakes", "a new chat each time, in a lane of its own"], "swt-row is-works", "swt-state is-works", "now: running since today 09:10 · 1 event waits for the run under way"]);
    // A failed run on one that listens: its row says so.
    part.paint(runsOf({ routines: [said(watcher({ last: run({ state: "failed", ended: at(9, 11), why: "sign-in expired" }) }))] }));
    assert.equal(rowOf("r1").getAttribute("class"), "swt-row is-bad");
    // Paused by the person: Paused.
    part.paint(runsOf({ routines: [said(watcher({ paused: true }))] }));
    assert.deepEqual([rowOf("r1").getAttribute("class"), rowOf("r1").querySelector(".swt-badge").textContent, rowOf("r1").querySelector(".swt-stands").textContent],
      ["swt-row is-paused", "Paused", "Nothing heard yet · paused: it listens again once you resume it"]);
  });

  // (fails before: yes — pausing a watcher was two presses in its ⋯, under a routine's words)
  test("a watcher that is on has a switch: one press pauses it, one resumes it, by the write its ⋯ sent; the row is drawn in place", async () => {
    const { part, did, rowOf } = await mount();
    part.paint(runsOf());
    part.show(true);
    /** @param {string} id */
    const sw = (id) => rowOf(id).querySelector(".set-switch");
    assert.deepEqual([sw("r1").getAttribute("role"), sw("r1").getAttribute("aria-checked"), sw("r1").classList.contains("on"), sw("r1").getAttribute("aria-label"), sw("r1").getAttribute("title")],
      ["switch", "true", true, "Supervisor listens", "It listens no more until you resume it"]);
    assert.deepEqual([sw("r4").getAttribute("aria-checked"), sw("r4").classList.contains("on"), sw("r4").getAttribute("title")], ["false", false, "It listens again; what happened while it was paused is not made up"]);
    assert.equal(sw("r3"), null, "one proposed has none: Switch on… is its press");
    sw("r1").dispatch("click");
    sw("r4").dispatch("click");
    await until(() => did.wrote.length === 2, "both writes");
    assert.deepEqual(did.wrote, [["p1", "POST", "/routines/r1/pause", { paused: true }], ["p1", "POST", "/routines/r4/pause", { paused: false }]]);
    // The Space's answer drawn: the switch is the element it was, off now.
    const was = sw("r1");
    const more = rowOf("r1").querySelector(".swt-more");
    part.paint(runsOf({ routines: [said(watcher({ trigger: { kind: "turn", chat: "c2", turns: "all", every: 1 }, wakes: "chat", guides: true, paused: true })), ...Object.values(W).slice(1)] }));
    assert.deepEqual([sw("r1") === was, rowOf("r1").querySelector(".swt-more") === more, sw("r1").getAttribute("aria-checked"), sw("r1").classList.contains("on")], [true, true, "false", false]);
    sw("r1").dispatch("click");
    await until(() => did.wrote.length === 3, "Resume");
    assert.deepEqual(did.wrote[2], ["p1", "POST", "/routines/r1/pause", { paused: false }], "the press is of the row as it stands now");
  });

  // (fails before: yes — a watcher's sheet said "· not now" of one that listens and "Pause, Run now or Remove it from
  // the ⋯", and its ⋯ a routine's "It runs no more by itself")
  test("Switch on… on one proposed opens its sheet; ⋯ holds the rest, in a watcher's words; What it does says it listens", async () => {
    const { part, did, rowOf } = await mount({ answer: (path) => (path.endsWith("/run") ? { chain: "c1" } : {}) });
    part.paint(runsOf());
    part.show(true);
    // One proposed: the primary button, and its sheet — nothing switched on by opening it.
    const go = rowOf("r3").querySelector(".swt-go");
    assert.deepEqual([go.textContent, go.getAttribute("class"), go.getAttribute("title")], ["Switch on…", "sm primary swt-go", "Everything it will do: it listens only once you switch it on"]);
    go.dispatch("click");
    const sheet = /** @type {any} */ (sheets().at(-1));
    assert.ok(sheet, "its sheet");
    assert.equal(sheet.querySelector(".sp-sheet-title").textContent, "Switch on “Triage”?");
    assert.deepEqual(texts(sheet, ".srt-sheet-v").slice(0, 3), ["Read its turn; say where it drifted.", "when a question of any chat waits 10 min for you", W.r3.words.allowed]);
    assert.equal(sheet.querySelector(".sdb-keep-foot .sp-quiet").textContent, "Its switch pauses it; Run now and Remove are in the ⋯ on its row once it is on.");
    assert.deepEqual(did.wrote, [], "nothing on, on opening it");
    sheet.querySelector(".srt-on").dispatch("click");
    await until(() => did.wrote.length === 1, "Switch on");
    assert.deepEqual(did.wrote[0], ["p1", "POST", "/routines/r3/on", { at: at(9, 5) }]);
    await until(() => sheets().length === 0, "taken: the sheet closed");
    assert.equal(rowOf("r1").querySelector(".swt-go"), null, "one on has its switch, no button");
    // ⋯ of one proposed: its Switch on…, then the rest.
    const proposed = await menuOf(rowOf("r3").querySelector(".swt-more"), "its ⋯");
    assert.deepEqual(labels(proposed), ["Switch on…", "Ask for a change…", "Remove"]);
    rowOf("r3").querySelector(".swt-more").dispatch("click");
    // ⋯ of one on that wakes its chat: Run now where it runs something — no Pause, its switch is that.
    const on = await menuOf(rowOf("r1").querySelector(".swt-more"), "its ⋯");
    assert.deepEqual(labels(on), ["Run now", "What it does", "Ask for a change…", "Remove"]);
    assert.deepEqual([item(on, "Run now").querySelector(".zc-menu-desc").textContent, item(on, "What it does").querySelector(".zc-menu-desc").textContent, item(on, "Remove").querySelector(".zc-menu-desc").textContent],
      ["Once, now: a turn of its own in Lead, with what it heard", "Its words, what it watches, what it may do", "It listens no more; its Space's Add to this Space… puts it back"]);
    item(on, "Run now").dispatch("click");
    await until(() => did.wrote.length === 2, "Run now");
    assert.deepEqual(did.wrote[1], ["p1", "POST", "/routines/r1/run", {}]);
    // What it does: on with nothing waiting, it listens; its foot says where each press is.
    const again = await menuOf(rowOf("r1").querySelector(".swt-more"), "its ⋯");
    item(again, "What it does").dispatch("click");
    const does = /** @type {any} */ (sheets().at(-1));
    assert.deepEqual([does.querySelector(".sp-sheet-title").textContent, texts(does, ".srt-sheet-v")[1], does.querySelector(".sdb-keep-foot .sp-quiet").textContent],
      ["What “Supervisor” does", "after each turn of Build the login flow · listening", "Its switch pauses it; Run now and Remove are in the ⋯ on its row."]);
    does.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === "Close").dispatch("click");
    // One that tells only you runs nothing: no Run now, and no words of its own in its sheet.
    const told = await menuOf(rowOf("r2").querySelector(".swt-more"), "its ⋯");
    assert.deepEqual(labels(told), ["What it does", "Ask for a change…", "Remove"]);
    item(told, "What it does").dispatch("click");
    const tells = /** @type {any} */ (sheets().at(-1));
    assert.deepEqual([texts(tells, ".sdb-keep-h"), tells.querySelector(".sdb-keep-foot .sp-quiet").textContent], [["When", "What it may do", "Made in"], "Its switch pauses it; Remove is in the ⋯ on its row."]);
    tells.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === "Close").dispatch("click");
    // A run under way: Open its run; a failed one: Fix…, and Open its last run.
    const running = await menuOf(rowOf("r6").querySelector(".swt-more"), "its ⋯");
    assert.deepEqual(labels(running), ["Open its run", "What it does", "Ask for a change…", "Remove"]);
    item(running, "Open its run").dispatch("click");
    assert.deepEqual(did.opened, ["c9"]);
    const failed = await menuOf(rowOf("r4").querySelector(".swt-more"), "its ⋯");
    assert.deepEqual(labels(failed), ["Run now", "What it does", "Fix…", "Ask for a change…", "Open its last run", "Remove"]);
    item(failed, "Ask for a change…").dispatch("click");
    assert.deepEqual(did.asked.map((a) => a[0]), ["c1"], "the chat that made it, its box begun");
    // Remove, behind its word: a watcher's.
    const last = await menuOf(rowOf("r1").querySelector(".swt-more"), "its ⋯");
    item(last, "Remove").dispatch("click");
    assert.equal(newest(".zc-dialog-desc").textContent, "It listens no more, and wakes nothing; a run under way goes on, its chat's Stop there. Its Space's Add to this Space… puts it back as it was.");
    dialogButton("Remove").dispatch("click");
    await until(() => did.wrote.length === 3, "Remove");
    assert.deepEqual(did.wrote[2], ["p1", "DELETE", "/routines/r1", undefined]);
    // Put back, in Add to this Space…: a watcher goes back to listening, a routine to its times.
    part.paint(runsOf({ routines: [{ ...W.r1, state: "removed" }, { ...T1, state: "removed" }] }));
    assert.deepEqual(part.backItems("p1").map((i) => [i.label, i.desc]), [["Put back “Supervisor”", "As it was: listening, or proposed"]]);
  });

  // (fails before: yes — the Routines head counted watchers among "routines", and nothing said how many listen)
  test("its head: how many listen, Pause every Space behind its word, and Watcher… — the Start, its box begun", async () => {
    const { part, did, el } = await mount();
    part.paint(runsOf());
    part.show(true);
    assert.deepEqual([el.querySelector(".srt-head-words").textContent, el.querySelector(".srt-head").getAttribute("class"), el.querySelector(".srt-pause").textContent, el.querySelector(".srt-pause").hidden],
      ["Listening: 4 watchers", "srt-head swt-head", "Pause every Space", false]);
    assert.ok(el.querySelector(".srt-head-dot"), "its dot");
    el.querySelector(".srt-pause").dispatch("click");
    assert.equal(newest(".zc-dialog-title").textContent, "Pause every Space?");
    dialogButton("Pause every Space").dispatch("click");
    await until(() => did.paused.length === 1, "Pause all");
    assert.deepEqual(did.paused, [true]);
    // Pause all on: the Routines head's words for it, and Resume.
    part.paint(runsOf({ pausedSince: at(9, 20), listening: "Paused since today 09:20: 4 watchers, nothing starts by itself until you resume" }));
    assert.deepEqual([el.querySelector(".srt-head-words").textContent, el.querySelector(".srt-head").getAttribute("class"), el.querySelector(".srt-pause").textContent],
      ["Paused since today 09:20: 4 watchers, nothing starts by itself until you resume", "srt-head swt-head is-paused", "Resume"]);
    el.querySelector(".srt-pause").dispatch("click");
    await until(() => did.paused.length === 2, "Resume");
    assert.deepEqual(did.paused, [true, false], "Resume asks nothing first");
    // None listening: said, and no Pause all to press.
    part.paint(runsOf({ listening: "", routines: [W.r3] }));
    assert.deepEqual([el.querySelector(".srt-head-words").textContent, el.querySelector(".srt-pause").hidden], ["No watcher listens yet.", true]);
    // Watcher…: what Routine… does, for a watcher.
    const makeBtn = el.querySelector(".swt-make");
    assert.deepEqual([makeBtn.textContent, makeBtn.hidden], ["Watcher…", false]);
    makeBtn.dispatch("click");
    assert.deepEqual(did.started, [["/w", "Make a watcher for web's Space — something that listens for an event and wakes an agent, or tells me, once I switch it on: "]]);
    // Home's, every project's: one is made in its project's Space.
    const home = await mount({ all: true });
    home.part.paint(runsOf());
    assert.equal(home.el.querySelector(".swt-make").hidden, true);
  });

  const MAIN = { path: "/r", name: "r", main: true, ok: true, branch: "main", base: "main", onBase: true, ahead: 0, behind: 0,
    uncommitted: { files: 2 }, chats: [{ id: "c20", name: "on main", home: true, atWork: false }], removable: false, why: "the repository's main folder", goes: null };

  // (fails before: yes — a Space showed its watchers under Routines; a watcher's row in Needs you opened Routines)
  test("a Space's page: Watchers beside Routines in its crumb's ⌄, each there only with rows; a watcher's row in Needs you opens Watchers", async () => {
    const { renderSpace } = await import("../src/ui/harness/space/space.js");
    const { h } = await import("../src/ui/lib/dom.js");
    /** @type {any[]} */
    let routines = [W.r1, W.r2];
    const needs = [
      { id: "n7", kind: "routine", text: "“Deploy watch” heard: 2 new commits on main", why: "A watcher that tells only you · 2 events, the newest at 09:30", dashboard: "", title: "Deploy watch", routine: { id: "r2", chain: "", told: 2, heard: "2 new commits on main" }, at: NOW, state: "open" },
      { id: "n8", kind: "routine", text: "“Supervisor” failed: sign-in expired", why: "a watcher of this Space, woken by what it watches at 09:10", dashboard: "", title: "Supervisor", routine: { id: "r1", chain: "c1" }, at: NOW, state: "open" },
      { id: "n9", kind: "routine", text: "“Morning brief” failed: sign-in expired", why: "a routine of this Space, run at its time, 09:00", dashboard: "", title: "Morning brief", routine: { id: "t1", chain: "c98" }, at: NOW, state: "open" },
      { id: "n10", kind: "ask", text: "Switch on “Supervisor”?", dashboard: "", title: "Supervisor", ask: { what: "on", chain: "c1", byName: "Lead", why: "it reviews each turn of the build", routine: "r1" }, at: NOW, state: "open" },
    ];
    const spaceOf = () => ({ project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [], gone: [], needs,
      runs: runsOf({ head: routines.some((r) => !r.trigger) ? "Runs by itself: 1 routine" : "", listening: "Listening: 2 watchers", routines }) });
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return { cwd: "/r", ok: true, error: null, name: "r", main: "/r", places: [MAIN], removed: [] };
      if (u === "/api/space/p1" && method === "GET") return spaceOf();
      if (u === "/api/space/p1/procedures") return { procedures: [] };
      return undefined;
    };
    const host = /** @type {any} */ (h("div", { class: "main-frame" }));
    doc.document.body.append(host);
    const space = renderSpace(host, { id: "p1" }, {
      project: (id) => (id === "p1" ? { id: "p1", name: "r", cwd: "/r" } : null),
      look: { chat: () => null, now: () => null, failed: () => false, modelName: (id) => id },
      openChat: () => {}, newChat: () => {}, startWith: () => {}, projectSettings: () => {}, onMoved: () => {}, onClose: () => {},
    });
    stops.push(space.stop);
    await until(() => host.querySelector(".sp-crumb-go").hidden === false, "a page besides the Board");
    /** ⌄'s rows, read and closed. */
    const pages = async () => {
      const rows = await menuOf(host.querySelector(".sp-crumb-go"), "⌄");
      const said = rows.map((/** @type {any} */ i) => i.querySelector(".zc-menu-text").textContent);
      host.querySelector(".sp-crumb-go").dispatch("click");
      return said;
    };
    assert.deepEqual(await pages(), ["Board", "Watchers"], "watchers alone: no Routines");
    space.show("@watchers");
    assert.deepEqual([host.querySelector(".sp-overview").hidden, host.querySelector(".swt").hidden, host.querySelector(".srt").hidden, host.querySelector(".sp-crumb-app").textContent], [true, false, true, "Watchers"], "Watchers over the Board");
    assert.deepEqual(host.querySelectorAll(".swt-row").map((/** @type {any} */ r) => r.getAttribute("data-watcher")), ["r1", "r2"]);
    // A routine at times comes: Routines beside it, each listing its own.
    routines = [T1, W.r1, W.r2];
    hear({ type: "space", project: "p1", seq: 2 });
    await until(async () => (await pages()).length === 3 || null, "Routines, there");
    assert.deepEqual(await pages(), ["Board", "Routines", "Watchers"]);
    space.show("@routines");
    assert.deepEqual([host.querySelector(".srt").hidden, host.querySelector(".swt").hidden, host.querySelectorAll(".srt-row").map((/** @type {any} */ r) => r.getAttribute("data-routine"))], [false, true, ["t1"]]);
    // Needs you: what a watcher heard, and a watcher's failed run, each with the chip Watchers, the page it opens; a
    // routine's failed run opens Routines.
    // (fails before: yes — a watcher's chip said Watcher, the thing, beside Routines, the page)
    host.querySelector(".sp-crumb-page").dispatch("click");
    /** @param {string} id */
    const chip = (id) => host.querySelector(`.sp-need[data-need="${id}"] .sp-need-src`);
    await until(() => chip("n7"), "its row in Needs you");
    assert.deepEqual([chip("n7").textContent, chip("n7").getAttribute("title"), chip("n8").textContent, chip("n9").textContent], ["Watchers", "Open this Space's Watchers", "Watchers", "Routines"]);
    assert.deepEqual([chip("n10").textContent, chip("n10").getAttribute("title")], ["Watchers", "Open this Space's Watchers"], "a chat's ask to switch a watcher on: the same chip");
    chip("n7").dispatch("click");
    assert.deepEqual([host.querySelector(".swt").hidden, host.querySelector(".srt").hidden], [false, true], "its chip: Watchers");
    chip("n9").dispatch("click");
    assert.deepEqual([host.querySelector(".swt").hidden, host.querySelector(".srt").hidden], [true, false], "a routine's: Routines");
    chip("n8").dispatch("click");
    assert.deepEqual([host.querySelector(".swt").hidden, host.querySelector(".srt").hidden], [false, true], "a watcher's failed run: Watchers");
    space.stop();
    host.remove();
  });

  /**
   * A Space's page of project p1, with what its Needs you holds; `started`: what was put in a Start's box.
   * @param {any[]} needs
   */
  const spacePage = async (needs) => {
    const { renderSpace } = await import("../src/ui/harness/space/space.js");
    const { h } = await import("../src/ui/lib/dom.js");
    const spaceOf = () => ({ project: "p1", seq: 1, logMore: 0, names: {}, waiting: [], tasks: [], log: [], syncs: [], dashboards: [], gone: [], needs, runs: runsOf({ head: "", listening: "", routines: [] }) });
    serve = (u, method) => {
      if (u === "/api/git/places?cwd=%2Fr") return { cwd: "/r", ok: true, error: null, name: "r", main: "/r", places: [MAIN], removed: [] };
      if (u === "/api/space/p1" && method === "GET") return spaceOf();
      if (u === "/api/space/p1/procedures") return { procedures: [] };
      if (u === "/api/space/p1/folder-apps") return { apps: [] };
      return undefined;
    };
    /** @type {any[]} */
    const started = [];
    const host = /** @type {any} */ (h("div", { class: "main-frame" }));
    doc.document.body.append(host);
    const space = renderSpace(host, { id: "p1" }, {
      project: (id) => (id === "p1" ? { id: "p1", name: "r", cwd: "/r" } : null),
      look: { chat: () => null, now: () => null, failed: () => false, modelName: (id) => id },
      openChat: () => {}, newChat: () => {}, startWith: (cwd, words) => void started.push([cwd, words]), projectSettings: () => {}, onMoved: () => {}, onClose: () => {},
    });
    stops.push(space.stop);
    await until(() => host.querySelector(".sp-lane-face"), "the Space, drawn");
    return { host, started, close: () => { space.stop(); host.remove(); } };
  };

  // (fails before: yes — Add to this Space… offered Routine… and no Watcher…: a Space with no watcher had no way to one
  // from that menu)
  test("Add to this Space… offers Watcher… after Routine…: the Start, its box begun, as the Watchers page's own button does", async () => {
    const { host, started, close } = await spacePage([]);
    try {
      const items = await menuOf(host.querySelector(".sp-add"), "Add to this Space…");
      const names = labels(items);
      assert.deepEqual(names.slice(names.indexOf("Routine…"), names.indexOf("Routine…") + 2), ["Routine…", "Watcher…"]);
      assert.equal(item(items, "Watcher…").querySelector(".zc-menu-desc").textContent, "Something that listens for an event and wakes an agent, or tells you, made in a chat: it listens only once you switch it on");
      item(items, "Watcher…").dispatch("click");
      assert.deepEqual(started, [["/r", "Make a watcher for r's Space — something that listens for an event and wakes an agent, or tells me, once I switch it on: "]]);
    } finally {
      close();
    }
  });

  // (fails before: yes — a held guidance of one line was said twice on its row: in its title, and whole under it)
  test("a guidance held for you says its words once: the line under its title only where the title cut them", async () => {
    const whole = "Go back to the parser.";
    const long = "You drifted: the parser, not the lexer.\nRead the person's first message again.";
    /** @param {string} id @param {string} text @param {string} first */
    const held = (id, text, first) => ({ id, kind: "routine", text: `“Supervisor” would guide Build the login flow again: “${first}”`, why: "3 sent since you last wrote there, the most Filament sends by itself", dashboard: "", title: "Supervisor",
      routine: { id: "r4", chain: "", guide: { id: `g-${id}`, to: "c2", name: "Build the login flow", text } }, at: NOW, state: "open" });
    const { host, close } = await spacePage([held("n8", whole, whole), held("n9", long, "You drifted: the parser, not the lexer.")]);
    /** @param {string} id */
    const need = (id) => host.querySelector(`.sp-need[data-need="${id}"]`);
    try {
      await until(() => need("n9"), "its rows in Needs you");
      assert.deepEqual([need("n8").querySelector(".sp-need-t").textContent, need("n8").querySelector(".sp-need-guide")?.textContent ?? null, !!need("n8").querySelector(".sp-need-guide-send")],
        ["“Supervisor” would guide Build the login flow again: “Go back to the parser.”", null, true], "its title says it whole: Send it, and no second copy");
      assert.equal(need("n9").querySelector(".sp-need-guide").textContent, long, "one its title cut: whole under it");
    } finally {
      close();
    }
  });

  // (fails before: yes — a watcher's failed run stood under "its routines' failed runs")
  test("Needs you's line says whose failed runs it holds: a watcher's are its watchers', a routine's its routines'", async () => {
    /** @param {string} id @param {string} title @param {Record<string, any>} routine */
    const failed = (id, title, routine) => ({ id, kind: "routine", text: `“${title}” failed: sign-in expired`, why: "a watcher of this Space, woken by what it watches at 09:10", dashboard: "", title, routine, at: NOW, state: "open" });
    const mine = failed("n8", "Supervisor", { id: "r1", chain: "c1", watcher: true });
    /** @param {any} host */
    const line = (host) => host.querySelector(".sp-needs-sec").querySelectorAll(".sp-sec-h .sp-quiet")[1].textContent;
    const one = await spacePage([mine]);
    try {
      await until(() => one.host.querySelector('.sp-need[data-need="n8"]'), "its row in Needs you");
      assert.equal(line(one.host), "its watchers' failed runs");
    } finally {
      one.close();
    }
    const heard = { id: "n7", kind: "routine", text: "“Deploy watch” heard: 2 new commits on main", why: "A watcher that tells only you · 2 events, the newest at 09:30", dashboard: "", title: "Deploy watch", routine: { id: "r2", chain: "", told: 2, heard: "2 new commits on main" }, at: NOW, state: "open" };
    const all = await spacePage([mine, failed("n9", "Morning brief", { id: "t1", chain: "c98" }), heard]);
    try {
      await until(() => all.host.querySelector('.sp-need[data-need="n9"]'), "its rows in Needs you");
      assert.equal(line(all.host), "its routines' failed runs, its watchers' failed runs and what its watchers heard");
    } finally {
      all.close();
    }
  });

  // (fails before: yes — Fix… and Ask for a change… said "a routine of" and "your routine" of a watcher)
  test("Fix… and Ask for a change… say watcher of one: its failure in the Start's box, its ask in the box of the chat that made it", async () => {
    const { routineFixWords, routineAskWords } = await import("../src/ui/harness/lib/space-view.js");
    const FIX = "“Fixer”, a watcher of web's Space, failed (today 09:10): the chat it wakes is gone. Find out why, and fix it — its words, what it watches, or what it needs; propose the watcher again where it changes: ";
    assert.equal(routineFixWords({ title: "Fixer", why: "the chat it wakes is gone", ran: "today 09:10", watcher: true }, "web"), FIX);
    assert.equal(routineFixWords({ title: "Morning brief", why: "sign-in expired", ran: "today 09:00" }, "web"),
      "“Morning brief”, a routine of web's Space, failed (today 09:00): sign-in expired. Find out why, and fix it — its words, its time, or what it needs; propose the routine again where it changes: ", "a routine's, as it was");
    assert.equal(routineAskWords(W.r4), "About your watcher r4 “Fixer” (change it with the space tool's routine and its id): ");
    assert.equal(routineAskWords(T1), "About your routine t1 “Morning brief” (change it with the space tool's routine and its id): ", "a routine's, as it was");
    const { part, did, rowOf } = await mount();
    part.paint(runsOf());
    part.show(true);
    item(await menuOf(rowOf("r4").querySelector(".swt-more"), "its ⋯"), "Fix…").dispatch("click");
    assert.deepEqual(did.started, [["/w", FIX]]);
    item(await menuOf(rowOf("r4").querySelector(".swt-more"), "its ⋯"), "Ask for a change…").dispatch("click");
    assert.deepEqual(did.asked, [["c1", "About your watcher r4 “Fixer” (change it with the space tool's routine and its id): "]]);
  });

  // (fails before: yes — a row said nothing of the turns its watcher read)
  test("a row's quiet line counts what it reviewed today, after its last run", async () => {
    const { part, rowOf } = await mount();
    const v = (/** @type {any} */ o) => ({ chain: "c2", turn: 3, watcher: "r5", title: "Night watch", at: at(9, 20), guided: false, ...o });
    const r5 = said(watcher({ id: "r5", title: "Night watch", last: run({ state: "done", ended: at(9, 10) + 41_000, said: "All green" }) }), { reviews: [v({}), v({ turn: 4, guided: true })] });
    part.paint(runsOf({ routines: [r5, W.r1] }));
    part.show(true);
    assert.deepEqual([rowOf("r5").querySelector(".swt-reviewed").textContent, rowOf("r5").querySelector(".swt-stands").textContent],
      ["2 reviewed today · 1 guided", "last: today 09:10 · done in 41 s · “All green” · 2 reviewed today · 1 guided"]);
    assert.equal(rowOf("r1").querySelector(".swt-reviewed"), null, "none where it reviewed none");
  });

  // (fails before: yes — Pause all's confirm and tip named routines and dashboards' watches alone, on the Watchers page too)
  test("Pause all says what it holds back — routines, dashboards' watches, watchers — in one sentence, on this page and on Routines", async () => {
    const { PAUSE_ALL_HOLDS } = await import("../src/ui/harness/lib/space-view.js");
    const { routinesPart } = await import("../src/ui/harness/space/routines.js");
    assert.equal(PAUSE_ALL_HOLDS, "no routine at its time, no dashboard's watch, no watcher on an event");
    const { part, el } = await mount();
    part.paint(runsOf());
    const routines = routinesPart({ all: false, place: () => ({ id: "p1", name: "web", cwd: "/w" }), write: async () => ({}), pauseAll: async () => true, openChat: () => {}, openTab: () => {} });
    routines.paint(runsOf());
    for (const btn of [el.querySelector(".srt-pause"), /** @type {any} */ (routines.el).querySelector(".srt-pause")]) {
      assert.equal(btn.title, `Nothing starts by itself in any Space until you resume: ${PAUSE_ALL_HOLDS}`);
      btn.dispatch("click");
      // (fails before: yes — it ended in a routine's words alone, "Times that come while paused are skipped and said;
      // Resume makes none of them up": a watcher has no times, and one of a branch or a connection does hear on Resume
      // what changed meanwhile, as a dashboard's watch finds it)
      // What moves in a folder and what a program posts are gone too, and a watcher's own program is stopped
      // (watch-words.test.js pins the sentence).
      assert.equal(newest(".zc-dialog-desc").textContent, `Every Space of this Filament pauses, not this one alone: nothing starts by itself — ${PAUSE_ALL_HOLDS} — until you resume. A run under way goes on: its chat's Stop is there. A routine's times that come while paused are skipped and said; what a chat does, what moves in a folder and what a program posts then wakes no watcher, and a watcher's own program is stopped: Resume makes up none of it. A dashboard's watch and a watcher of a branch or a connection read again on Resume, and find what changed meanwhile.`);
      dialogButton("Cancel").dispatch("click");
    }
  });

  // (fails before: yes — the left bar had Routines alone under a Space, shown for a Space of watchers only)
  test("the left bar: Watchers under a Space beside Routines, an eye, the dot where a run of one failed; a press opens its page", async () => {
    const { createSidebar } = await import("../src/ui/harness/sidebar.js");
    const { ICONS } = await import("../src/ui/harness/lib/icons.js");
    const now = Date.now();
    /** @type {any} */
    let spaces = { routines: { p1: { failed: false } }, watchers: { p1: { failed: true } } };
    serve = (u) =>
      u.endsWith("/api/spaces")
        ? { open: { p1: 0 }, needs: {}, extended: false, next: null, own: [], back: {}, apps: {}, ...spaces }
        : { sessions: [{ id: "c1", title: "Fix the build", when: now, project: "p1", cwd: "/code/app" }], projects: [{ id: "p1", name: "/code/app", cwd: "/code/app" }], runs: [] };
    const host = document.createElement("div");
    /** @type {any[]} */
    const opened = [];
    const bar = createSidebar(/** @type {any} */ (host), { onNew() {}, onSettings() {}, onHide() {}, onSelectChat() {}, onOpen() {}, onChanged() {},
      onSpace: (/** @type {string} */ id, /** @type {string | undefined} */ tab) => void opened.push(tab ? [id, tab] : [id]), onSpacePlaces() {}, onYourSpace() {} });
    await bar.load();
    const list = () => all(host).find((x) => x.className === "sess-list");
    const kids = () => all(list()).filter((x) => /^space-app-row\b/.test(String(x.className)));
    await until(() => kids().length === 2 || null, "its rows under the Space");
    assert.deepEqual(kids().map((r) => [r.getAttribute("data-tab"), r.querySelector(".sess-title").textContent, !!r.querySelector(".sdb-dot"), r.getAttribute("title"), r.getAttribute("aria-label")]), [
      ["@routines", "Routines", false, "What runs by itself, and what you run", null],
      ["@watchers", "Watchers", true, "What listens for events: a run failed", "Watchers, a run failed"],
    ]);
    assert.equal(kids()[1].querySelector(".space-app-ic").innerHTML, ICONS.eye, "an eye");
    // (fails before: yes — the bar told nobody which projects have a Space: Watch this chat… could not ask)
    assert.deepEqual([bar.hasSpace("p1"), bar.hasSpace("p2")], [true, false], "which projects have a Space, for the chat menu's Watch this chat…");
    kids()[1].dispatch("click");
    assert.deepEqual(opened, [["p1", "@watchers"]]);
    bar.atSpace("p1", "@watchers");
    assert.match(String(kids()[1].className), /\bcurrent\b/, "its row marked where the address names it");
    // Watchers alone: no Routines row.
    spaces = { routines: {}, watchers: { p1: { failed: false } } };
    hear({ type: "space", project: "p1", seq: 3 });
    await until(() => kids().length === 1 || null, "the bar, drawn again");
    assert.deepEqual(kids().map((r) => [r.getAttribute("data-tab"), !!r.querySelector(".sdb-dot"), r.getAttribute("title")]), [["@watchers", false, "What listens for events, and whom each wakes"]]);
  });

  // (fails before: yes — Home had Today | Routines, a watcher among the routines)
  test("Home: Watchers a tab beside Today and Routines, every project's, each row with its project's chip; its switch writes to its Space", async () => {
    const { renderYourSpace } = await import("../src/ui/harness/space/your-space.js");
    const { h } = await import("../src/ui/lib/dom.js");
    /** @type {any[]} */
    let routines = [W.r1];
    serve = (u, method) => {
      if (u === "/api/your-space" && method === "GET")
        return { projects: [{ id: "p1", name: "app", cwd: "/r" }], needs: [], dashboards: { p1: [] }, glance: [], extended: true, runs: runsOf({ head: routines.some((r) => !r.trigger) ? "Runs by itself: 1 routine" : "", listening: "Listening: 1 watcher", routines }) };
      if (u === "/api/space/p1/routines/r1/pause" && method === "POST") return { ok: true, space: {} };
      return undefined;
    };
    const host = /** @type {any} */ (h("div", { class: "main-frame" }));
    doc.document.body.append(host);
    const ys = renderYourSpace(host, { now: () => ({ needs: [], works: [], done: [] }), openRow: () => {}, openSpace: () => {}, openChat: () => {}, startWith: () => {}, onClose: () => {} });
    stops.push(ys.stop);
    const tabs = () => host.querySelectorAll(".ys-strip .sdb-tab").map((/** @type {any} */ t) => t.textContent);
    await until(() => !host.querySelector(".ys-strip").hidden, "its tabs, once read");
    assert.deepEqual(tabs(), ["Today", "Watchers"], "a watcher alone brings no Routines");
    host.querySelectorAll(".ys-strip .sdb-tab")[1].dispatch("click");
    assert.deepEqual([host.querySelector(".ys-cols").hidden, host.querySelector(".swt").hidden, host.querySelector(".srt").hidden], [true, false, true], "Watchers over Today");
    const row = host.querySelector('.swt-row[data-watcher="r1"]');
    assert.deepEqual([row.querySelector(".swt-t").textContent, host.querySelector(".swt-make").hidden], ["Supervisor app", true], "its project's chip; none is made here");
    row.querySelector(".set-switch").dispatch("click");
    await until(() => posted.some((p) => p.url === "/api/space/p1/routines/r1/pause"), "Pause, to its Space");
    assert.deepEqual(posted.find((p) => p.url === "/api/space/p1/routines/r1/pause")?.body, { paused: true });
    // A routine at times beside it: three tabs, each its own rows.
    routines = [T1, W.r1];
    hear({ type: "space", project: "p1", seq: 2 });
    await until(() => tabs().length === 3 || null, "Routines too");
    assert.deepEqual([tabs(), host.querySelector(".ys-strip .is-on")?.getAttribute("data-tab")], [["Today", "Routines", "Watchers"], "watchers"]);
    host.querySelectorAll(".ys-strip .sdb-tab")[1].dispatch("click");
    assert.deepEqual([host.querySelector(".srt").hidden, host.querySelector(".swt").hidden, host.querySelectorAll(".srt-row").map((/** @type {any} */ r) => r.getAttribute("data-routine"))], [false, true, ["t1"]]);
    ys.stop();
    host.remove();
  });

  test("its look: the theme's tokens alone, the teal of the watch capsule, labels small and upper-case, and a grid that wraps in a narrow pane", () => {
    const css = readFileSync("src/ui/harness/space/space.css", "utf8");
    const mine = css.split("\n").filter((l) => /\.swt\b|\.swt-/.test(l)).join("\n");
    assert.ok(mine.length > 400, "its rules stand beside the Routines'");
    assert.doesNotMatch(mine, /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/, "no raw colour");
    assert.doesNotMatch(mine, /font-size:\s*\d/, "no size of its own: the scale's");
    assert.match(mine, /\n?\.swt-k \{[^}]*font-size: calc\(var\(--ui-font-size\) - 3px\);[^}]*text-transform: uppercase;/, "labels: 11 px of the 14, upper-case");
    assert.match(mine, /\.swt-v \{[^}]*font-size: var\(--text-ui-sm\);/, "values in the meta size");
    assert.match(mine, /\.swt-row\.is-on \.swt-eye, \.swt-row\.is-works \.swt-eye, \.swt-row\.is-asks \.swt-eye \{ color: var\(--color-sys-teal-text\); \}/, "teal where it listens");
    assert.match(mine, /\.swt-row\.is-bad \.swt-eye \{ color: var\(--color-sys-red-text\); \}/, "the failed tone where its last run failed");
    assert.match(mine, /\.swt-state\.is-done \{ color: var\(--color-sys-green-text\); \}/);
    assert.match(mine, /\.swt-state\.is-bad \{ color: var\(--color-sys-red-text\); \}/);
    assert.match(css, /\.swt-list \{[^}]*container-type: inline-size;/);
    assert.match(css, /@container \(max-width: 480px\) \{\n  \.swt-line \{ grid-template-columns: 1fr;/, "a narrow pane: each label over its value");
  });

  // (fails before: yes — the Watchers page's band, and the Routines page's, stood flush under the top bar, its top edge cut)
  test("the Watchers and Routines pages stand under the top bar with the room an app's page has above its band; Home's, under its tabs, take none", () => {
    const css = readFileSync("src/ui/harness/space/space.css", "utf8");
    const room = /\n\.sdb-view \{[^}]*margin-top: (\d+px);/.exec(css)?.[1];
    assert.equal(room, "16px", "an app's page, under the top bar");
    assert.match(css, new RegExp(`\\n\\.srt, \\.swt \\{ margin-top: ${room}; \\}\\n`), "the same room over the band of each");
    assert.match(css, /\n\.your-space \.srt, \.your-space \.swt \{ margin-top: 0; \}\n/, "Home's tabs stand over its own, with their room");
  });
});

describe("what a watcher wrote, read and woke, where it lands in the chat (the page)", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {Record<string, any>} */
  const had = {};
  /** The page's watches for what nears the screen, each with what it watches. @type {any[]} */
  const observers = [];
  const STUBS = {
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    HTMLElement: class {},
    IntersectionObserver: class {
      /** @param {(entries: any[]) => void} heard */
      constructor(heard) {
        this.heard = heard;
        /** @type {Set<any>} */
        this.watched = new Set();
        observers.push(this);
      }
      /** @param {any} el */
      observe(el) {
        this.watched.add(el);
      }
      /** @param {any} el */
      unobserve(el) {
        this.watched.delete(el);
      }
      disconnect() {
        this.watched.clear();
      }
    },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    addEventListener: () => {},
    removeEventListener: () => {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { hash: "", origin: "http://filament.test", pathname: "/", replace(/** @type {string} */ u) { this.hash = u; } },
  };
  /** An element came near the screen: what waited for that runs. @param {any} el */
  const near = (el) => {
    for (const o of observers) if (o.watched.has(el)) o.heard([{ isIntersecting: true, target: el }]);
  };
  before(() => {
    doc = stubDocument();
    for (const [k, v] of Object.entries(STUBS)) {
      had[k] = Object.prototype.hasOwnProperty.call(g, k) ? g[k] : undefined;
      g[k] = v;
    }
    Object.assign(g.window, { setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, getSelection: () => ({ toString: () => "", removeAllRanges() {}, rangeCount: 0 }) });
  });
  after(() => {
    doc.restore();
    for (const k of Object.keys(STUBS)) {
      if (had[k] === undefined) delete g[k];
      else g[k] = had[k];
    }
  });
  beforeEach(() => {
    posted.length = 0;
    serve = () => undefined;
    doc.document.body.replaceChildren();
  });

  const TURN = "../src/ui/harness/conversation/turn.js";
  const TEXT = "You drifted: the parser, not the lexer.\n\nGo back to the parser.";
  /** Those words as the card draws them: a reply's paragraphs. */
  const DRAWN = "<p>You drifted: the parser, not the lexer.</p><p>Go back to the parser.</p>";
  /** The guidance as its chat's agent read it: Filament's block, then the reviewer's words. */
  const BLOCK = routinesCore.guideWords({ id: "r1", title: "Supervisor" }, { project: "app", byName: "Lead", text: TEXT });
  const SUB = "a watcher you switched on · advice: your word comes first";
  /** A guidance turn's parts, as its transcript says them where the Space keeps the guidance. */
  const GUIDE = { watcher: "r1", project: "p1", title: "Supervisor", text: TEXT, chat: "c1", paused: false };
  /** A chat's watcher as the server says it (core's `chatWatchers`). @param {any} [o] */
  const cw = (o = {}) => ({ id: "r1", project: "p1", title: "Supervisor", state: "on", paused: false, role: "watched", chat: "c1",
    words: { lead: "Watched by", name: "Supervisor", does: "reviews each turn, may guide", full: "“Supervisor”: after each turn of Build the login flow · wakes Lead" }, ...o });
  /** A review as the transcript and the feed say one. @param {any} [o] */
  const review = (o = {}) => ({ watcher: "r1", project: "p1", title: "Supervisor", at: at(14, 9), guided: false, words: "“Supervisor” read this turn at 14:09 and sent nothing", ...o });
  const GUIDED = review({ guided: true, words: "“Supervisor” read this turn at 14:09 and wrote this chat guidance" });
  const OTHER = review({ watcher: "r2", title: "Reviewer", at: at(14, 12), words: "“Reviewer” read this turn at 14:12 and sent nothing" });
  /** The buttons a person sees under an element, by their words. @param {any} el */
  const shownButtons = (el) => el.querySelectorAll("button").filter((/** @type {any} */ b) => !b.classList.contains("hidden")).map((/** @type {any} */ b) => b.textContent);

  /**
   * The page's hands for a guidance card, as app.js sets them: the shown chat's watchers, a change of them, a press.
   * @param {any[] | null} list
   */
  const hands = async (list) => {
    const { guideHands } = await import(TURN);
    /** @type {Set<() => void>} */
    const subs = new Set();
    const hd = {
      list,
      /** @type {any[]} */
      pressed: [],
      /** The feed said the chat's watchers again. @param {any[]} next */
      say(next) {
        hd.list = next;
        for (const fn of [...subs]) fn();
      },
      off() {
        guideHands.watchers = guideHands.watch = guideHands.press = null;
      },
    };
    guideHands.watchers = () => hd.list;
    guideHands.watch = (/** @type {() => void} */ fn) => (subs.add(fn), () => void subs.delete(fn));
    guideHands.press = (/** @type {any} */ x) => void hd.pressed.push([x.press, x.of.project, x.of.id]);
    return hd;
  };

  // (fails before: yes — a guidance turn was a capsule, "A watcher that reviews this chat sent guidance — Filament passed
  // it on", over a fold of Filament's whole block: the reviewer's words were read inside it or not at all)
  test("a guidance turn: its capsule names the watcher, and under it a card — whose words they are and how to weigh them, Open its chat and Pause, the reviewer's words —, what the agent read folded below", async () => {
    const { guidedRow } = await import(TURN);
    const { transcriptTurns } = await import("../src/ui/harness/conversation/history.js");
    const hd = await hands([cw()]);
    try {
      // The transcript's parts reach the turn as the server says them.
      const [, turn] = transcriptTurns({ turns: [
        { n: 1, turnId: 1, user: { role: "user", content: "Make the login page." }, final: { role: "assistant", content: "Made." }, requestIds: ["a"] },
        { n: 2, turnId: 2, guided: true, by: "guide", guide: GUIDE, user: { role: "user", content: [{ type: "text", text: BLOCK }] }, final: { role: "assistant", content: "Understood." }, requestIds: ["b"] },
      ] });
      assert.deepEqual([turn.guided, turn.guide, turn.guideText], [true, GUIDE, BLOCK]);
      const row = /** @type {any} */ (guidedRow(turn));
      doc.document.body.append(row);
      assert.deepEqual([row.getAttribute("class"), row.children.map((/** @type {any} */ c) => c.getAttribute("class"))], ["own-turn is-sync is-guided", ["boundary-row is-own is-sync", "guide-card", "sync-read"]]);
      const capsule = row.querySelector(".boundary-row");
      assert.equal(capsule.querySelector(".boundary-label").textContent, "Guidance from “Supervisor”");
      assert.ok(capsule.querySelector(".boundary-ic"), "its eye");
      assert.match(capsule.getAttribute("title"), /Its row in the Space's Watchers pauses it$/);
      const card = row.querySelector(".guide-card");
      assert.deepEqual([card.querySelector(".guide-title").textContent, card.querySelector(".guide-sub").textContent, card.querySelector(".guide-text").innerHTML], ["Supervisor", SUB, DRAWN]);
      const open = card.querySelector(".guide-open");
      const pause = card.querySelector(".guide-pause");
      const paused = card.querySelector(".guide-paused");
      assert.deepEqual([shownButtons(card), pause.getAttribute("title"), paused.classList.contains("hidden"), card.querySelector(".guide-state")], [["Open its chat", "Pause"], "It listens no more until you resume it", true, null]);
      // What the agent read, whole, folded and closed.
      const fold = row.querySelector("details.sync-read");
      assert.deepEqual([fold.hasAttribute("open"), fold.querySelector("summary").textContent, fold.querySelector(".sync-text").textContent], [false, "What the agent read", BLOCK]);
      // Pause: the write its row's switch on the Watchers page makes, through the page's press.
      pause.dispatch("click");
      assert.deepEqual(hd.pressed, [["pause", "p1", "r1"]]);
      // The feed says it is paused: the button it was, Resume now, beside Paused.
      hd.say([cw({ paused: true })]);
      assert.deepEqual([card.querySelector(".guide-pause") === pause, pause.textContent, pause.getAttribute("title"), paused.textContent, paused.classList.contains("hidden"), card.classList.contains("is-paused")],
        [true, "Resume", "It listens again; what happened while it was paused is not made up", "Paused", false, true]);
      pause.dispatch("click");
      assert.deepEqual(hd.pressed.at(-1), ["resume", "p1", "r1"]);
      // Its watcher removed since: nothing of it to pause; the chat that wrote the guidance still opens.
      hd.say([]);
      assert.deepEqual(shownButtons(card), ["Open its chat"]);
      // Open its chat: the chat that wrote it.
      serve = (u) => (u === "/api/memory/sessions/c1?budget=200" ? {} : undefined);
      open.dispatch("click");
      await until(() => g.location.hash === "#/task/c1" || null, "its chat, opened");
    } finally {
      hd.off();
    }
  });

  // (fails before: yes — no card: a guidance turn's words were inside the fold alone)
  test("a guidance turn its Space keeps no record of: the reviewer's words alone, as the server split them from its message — nothing to open or pause; a page with no parts at all draws the capsule over its fold", async () => {
    const { guidedRow } = await import(TURN);
    const { GUIDED_WORDS } = await import("../src/ui/harness/lib/labels.js");
    // A watcher of that title watches the chat, and is not taken for the one that wrote it.
    const hd = await hands([cw()]);
    try {
      const row = /** @type {any} */ (guidedRow({ guided: true, guideText: BLOCK, guide: { title: "Supervisor", text: TEXT } }));
      const card = row.querySelector(".guide-card");
      assert.deepEqual([row.querySelector(".boundary-label").textContent, card.querySelector(".guide-title").textContent, card.querySelector(".guide-sub").textContent, card.querySelector(".guide-text").innerHTML],
        ["Guidance from “Supervisor”", "Supervisor", SUB, DRAWN]);
      assert.deepEqual(shownButtons(card), [], "words only");
      assert.equal(row.querySelector(".sync-text").textContent, BLOCK, "its fold stays");
      const bare = /** @type {any} */ (guidedRow({ guided: true, guideText: BLOCK }));
      assert.deepEqual([bare.querySelector(".boundary-label").textContent, bare.querySelector(".guide-card"), bare.querySelector(".sync-text").textContent], [GUIDED_WORDS, null, BLOCK]);
    } finally {
      hd.off();
    }
  });

  // (fails before: yes — no card)
  test("a long guidance shows a dozen lines and Show all, measured once its card nears the screen; a short one has no button", async () => {
    const { guidedRow } = await import(TURN);
    const row = /** @type {any} */ (guidedRow({ guided: true, guideText: BLOCK, guide: { title: "Supervisor", text: TEXT } }));
    doc.document.body.append(row);
    const text = row.querySelector(".guide-text");
    const more = row.querySelector(".guide-more");
    assert.deepEqual([more.textContent, more.classList.contains("hidden")], ["Show all", true], "not measured yet");
    // Its dozen lines hold less than it has.
    Object.assign(text, { scrollHeight: 400, clientHeight: 220 });
    near(text);
    assert.equal(more.classList.contains("hidden"), false);
    more.dispatch("click");
    assert.deepEqual([text.classList.contains("open"), more.textContent, more.getAttribute("aria-expanded")], [true, "Show less", "true"]);
    more.dispatch("click");
    assert.deepEqual([text.classList.contains("open"), more.textContent, more.getAttribute("aria-expanded")], [false, "Show all", "false"]);
    const short = /** @type {any} */ (guidedRow({ guided: true, guideText: BLOCK, guide: { title: "Supervisor", text: "Stop." } }));
    doc.document.body.append(short);
    Object.assign(short.querySelector(".guide-text"), { scrollHeight: 22, clientHeight: 22 });
    near(short.querySelector(".guide-text"));
    assert.equal(short.querySelector(".guide-more").classList.contains("hidden"), true);
  });

  // An agent writes a guidance, lists and code among its words, as it writes a reply and a thread's brief: the card
  // reads them as a reply's (seen at the real supervisor trial of 11-11: Claude's "Add `// SPDX-License-Identifier:
  // MIT` as its very first line." stood on the card with its backticks).
  // (fails before: yes — the card held the words as plain text: no list, no code, the marks themselves)
  test("a guidance's words read as a reply's do: its code as code and its list as a list, never the marks; what it clamps is its height", async () => {
    const { guidedRow } = await import(TURN);
    const said = "The route is `/signin`, not `/login`.\n\n- rename the route\n- move its test";
    const row = /** @type {any} */ (guidedRow({ guided: true, guideText: BLOCK, guide: { title: "Supervisor", text: said } }));
    const text = row.querySelector(".guide-text");
    assert.equal(text.getAttribute("class"), "guide-text a-md");
    const html = String(text.innerHTML);
    assert.match(html, /<code[^>]*>\/signin<\/code>/);
    assert.match(html, /<li>rename the route<\/li>\s*<li>move its test<\/li>/);
    assert.doesNotMatch(html, /`/);
    // Words that would be markup are text, as in a reply.
    const sly = /** @type {any} */ (guidedRow({ guided: true, guideText: BLOCK, guide: { title: "Supervisor", text: "Stop <img src=x onerror=alert(1)> now" } }));
    assert.doesNotMatch(String(sly.querySelector(".guide-text").innerHTML), /<img/);
    const aqua = readFileSync("src/ui/harness/aqua.css", "utf8");
    assert.match(aqua, /\n\.guide-text \{[^}]*max-height: calc\(1\.72em \* 12\); overflow: hidden;/, "a dozen lines of height: a list or a block of code clamps as words do");
    assert.match(aqua, /\n\.guide-text\.open \{ max-height: none; overflow: visible; \}/);
    assert.doesNotMatch(aqua, /\.guide-text[^{]*\{[^}]*line-clamp/);
  });

  // (fails before: yes — a watcher's note in a running turn was a dashed bubble at the right, as the person's own are,
  // under one line of whose it is)
  test("a guidance note in a running turn: the same card among the work, its state at its right — waits to be read, then read —, none of the person's Edit and Delete", async () => {
    const { steerEl } = await import("../src/ui/harness/conversation/timeline.js");
    const hd = await hands([cw()]);
    try {
      const s = { id: "s1", kind: "note", text: TEXT, from: "watcher", title: "Supervisor", canTakeBack: true };
      const waiting = /** @type {any} */ (steerEl(s, false, false, { onBack() { throw new Error("a watcher's words are not the person's to take back"); } }));
      assert.equal(waiting.getAttribute("class"), "steer steer-guide pending steer-from-watcher");
      const card = waiting.querySelector(".guide-card");
      assert.deepEqual([card.querySelector(".guide-title").textContent, card.querySelector(".guide-sub").textContent, card.querySelector(".guide-text").innerHTML, card.querySelector(".guide-state").textContent],
        ["Supervisor", SUB, DRAWN, "waits to be read"]);
      assert.deepEqual([shownButtons(waiting), waiting.querySelector(".steer-text"), waiting.querySelector(".steer-foot")], [["Open its chat", "Pause"], null, null], "the card's own presses: no bubble, no Edit, no Delete");
      // Its watcher is the one of that title that watches this chat: Pause is its write.
      card.querySelector(".guide-pause").dispatch("click");
      assert.deepEqual(hd.pressed, [["pause", "p1", "r1"]]);
      // Read by the agent.
      const read = /** @type {any} */ (steerEl({ ...s, read: true }, false, false, null));
      assert.deepEqual([read.getAttribute("class"), read.querySelector(".guide-state").textContent], ["steer steer-guide read steer-from-watcher", "read"]);
      // Left unread as its turn ended: said short, whole on its tip.
      const unread = /** @type {any} */ (steerEl({ ...s, unread: true }, true, false, null));
      assert.deepEqual([unread.getAttribute("class"), unread.querySelector(".guide-state").textContent, unread.querySelector(".guide-state").getAttribute("title")],
        ["steer steer-guide unread steer-from-watcher", "not read", "The turn ended before the agent read this — Filament sends it on as a turn of its own"]);
      // Two watchers of that title watch the chat, or none: whose it is cannot be told, so nothing is offered.
      hd.say([cw(), cw({ id: "r2" })]);
      assert.deepEqual(shownButtons(steerEl(s, false, false, null)), []);
      hd.say([]);
      assert.deepEqual(shownButtons(steerEl(s, false, false, null)), []);
      // The person's own note beside it is the bubble it was.
      const mine = /** @type {any} */ (steerEl({ id: "s2", kind: "note", text: "and the docs", canTakeBack: true }, false, false, { onBack() {} }));
      assert.deepEqual([mine.getAttribute("class"), mine.querySelector(".steer-text").textContent, mine.querySelector(".guide-card"), shownButtons(mine)], ["steer pending", "and the docs", null, ["Edit", "Delete"]]);
    } finally {
      hd.off();
    }
  });

  // (fails before: yes — nothing in a turn's footer said a watcher read it)
  test("a turn a watcher read has a Reviewed chip at the far end of its footer's row, shown with no pointer on it: plain where it sent nothing, guided where it wrote, counted where several read it; its tip says who, when and what came of it", async () => {
    const { footerEl } = await import(TURN);
    const acts = { onCopy() {}, onFork() {}, onRetry() {}, onWatchRun() {} };
    /** @param {any[]} [reviews] */
    const done = (reviews) => ({ n: 3, status: "done", history: true, startedAt: at(14), endedAt: at(14, 5), blocks: [], ...(reviews ? { reviews } : {}) });
    /** @param {any[]} [reviews] @returns {any} */
    const chipOf = (reviews) => footerEl(done(reviews), acts).querySelector(".a-reviewed");
    /** @param {any} chip */
    const says = (chip) => [chip.getAttribute("class"), chip.querySelector(".a-reviewed-words").textContent, chip.getAttribute("title")];
    assert.deepEqual([chipOf(undefined), chipOf([])], [null, null], "a turn no watcher read");
    const plain = chipOf([review()]);
    assert.deepEqual([plain.tagName, !!plain.querySelector(".a-reviewed-ic"), ...says(plain)], ["BUTTON", true, "a-reviewed", "Reviewed", "“Supervisor” read this turn at 14:09 and sent nothing"]);
    assert.deepEqual(says(chipOf([GUIDED])), ["a-reviewed is-guided", "Reviewed · guided", "“Supervisor” read this turn at 14:09 and wrote this chat guidance"]);
    assert.deepEqual(says(chipOf([review(), OTHER])), ["a-reviewed", "Reviewed ×2", "“Supervisor” read this turn at 14:09 and sent nothing\n“Reviewer” read this turn at 14:12 and sent nothing"]);
    assert.deepEqual(says(chipOf([GUIDED, OTHER])).slice(0, 2), ["a-reviewed is-guided", "Reviewed ×2 · guided"], "guided where any of them wrote");
    // Beside the actions at the row's far end, never among them: the actions show only under the pointer, and a turn
    // says it was reviewed with no pointer on it (seen on the stage: the chip hid with Copy and Fork).
    // (fails before: yes — the chip was the action row's last child, and hid with it)
    const foot = /** @type {any} */ (footerEl(done([review()]), acts));
    assert.deepEqual(foot.querySelector(".a-row").children.map((/** @type {any} */ k) => k.getAttribute("class")), ["a-actions", "a-reviewed"]);
    assert.equal(foot.querySelector(".a-actions").querySelector(".a-reviewed"), null);
    assert.equal(foot.querySelector(".a-actions").children.at(-1).getAttribute("class"), "a-meta");
    assert.deepEqual(/** @type {any} */ (footerEl(done(), acts)).querySelector(".a-row").children.map((/** @type {any} */ k) => k.getAttribute("class")), ["a-actions"], "a turn no watcher read: the row with its actions alone");
    // A press on a guided one is the page's, which goes to the guidance; a plain one has its tip alone.
    let pressed = 0;
    const press = { ...acts, onReviewed: () => void pressed++ };
    /** @type {any} */ (footerEl(done([GUIDED]), press)).querySelector(".a-reviewed").dispatch("click");
    assert.equal(pressed, 1);
    /** @type {any} */ (footerEl(done([review()]), press)).querySelector(".a-reviewed").dispatch("click");
    assert.equal(pressed, 1, "nothing to go to");
  });

  // (fails before: yes — no `reviews` reached a turn, and nothing drew one that landed after its turn ended)
  test("the feed's reviews land on turns that ended: each turn's chip alone is drawn, its footer the element it was; a guided chip's press goes to the guidance after it, a turn or a note", async () => {
    const { createTimeline } = await import("../src/ui/harness/conversation/timeline.js");
    const { reviewsMoved, transcriptTurns } = await import("../src/ui/harness/conversation/history.js");
    // A transcript's reviews reach its turns by their numbers.
    const read = transcriptTurns({ reviews: { 2: [GUIDED] }, turns: [1, 2].map((n) => ({ n, turnId: n, user: { role: "user", content: `Message ${n}` }, final: { role: "assistant", content: "Done." }, requestIds: [`q${n}`] })) });
    assert.deepEqual(read.map((/** @type {any} */ x) => x.reviews ?? null), [null, [GUIDED]]);
    const hd = await hands([cw()]);
    const host = /** @type {any} */ (document.createElement("div"));
    doc.document.body.append(host);
    try {
      const tl = createTimeline(host, /** @type {any} */ ({ onRetry() {}, onFork() {}, onWatchRun() {} }));
      /** @param {number} n @param {any} [o] */
      const t = (n, o = {}) => ({ n, status: "done", past: false, history: true, userText: `Message ${n}`, blocks: [], steers: [], segments: [], startedAt: at(14, n), endedAt: at(14, n) + 30_000, ...o });
      /** @type {any} */
      const chat = { chainId: "c2", live: null, turns: [t(1), t(2), t(3, { guided: true, guideText: BLOCK, guide: GUIDE }), t(4)] };
      tl.render(chat);
      /** @param {number} n */
      const footOf = (n) => host.querySelector(`[data-turn='${n}'] .a-foot`);
      /** @param {number} n */
      const chipOf = (n) => footOf(n).querySelector(".a-reviewed");
      const ALL = [1, 2, 3, 4];
      assert.deepEqual(ALL.map((n) => chipOf(n)), [null, null, null, null]);
      const was = ALL.map((n) => [footOf(n), footOf(n).querySelector(".a-actions").children[0]]);
      // The feed: turn 2 was read, and its watcher wrote.
      const moved = reviewsMoved(chat.turns, { 2: [GUIDED] });
      assert.deepEqual(moved.map((/** @type {any} */ x) => x.n), [2], "the turn whose reviews moved, and no other");
      for (const x of moved) tl.drawReviews(x);
      assert.deepEqual(ALL.map((n) => chipOf(n)?.textContent ?? null), [null, "Reviewed · guided", null, null]);
      assert.deepEqual(ALL.map((n) => footOf(n) === was[n - 1][0] && footOf(n).querySelector(".a-actions").children[0] === was[n - 1][1]), [true, true, true, true], "each footer the element it was, its Copy too");
      assert.deepEqual(reviewsMoved(chat.turns, { 2: [GUIDED] }), [], "said again the same: nothing moved");
      // A second watcher read it, and another turn was read: the chip that stands says so, in place.
      const chip = chipOf(2);
      for (const x of reviewsMoved(chat.turns, { 2: [GUIDED, OTHER], 4: [review()] })) tl.drawReviews(x);
      assert.deepEqual([chipOf(2) === chip, chip.textContent, chip.getAttribute("title"), chipOf(4).textContent, chipOf(4).getAttribute("class")],
        [true, "Reviewed ×2 · guided", `${GUIDED.words}\n${OTHER.words}`, "Reviewed", "a-reviewed"]);
      // Its press: the guidance turn after it comes into view.
      /** @type {string[]} */
      const went = [];
      host.querySelector("[data-turn='3'] .guide-card").scrollIntoView = () => void went.push("the guidance turn's card");
      chip.dispatch("click");
      assert.deepEqual(went, ["the guidance turn's card"]);
      // One with no guidance after it on the page has its tip alone.
      for (const x of reviewsMoved(chat.turns, { 4: [GUIDED] })) tl.drawReviews(x);
      assert.deepEqual([chipOf(2), chipOf(4).textContent, footOf(2) === was[1][0]], [null, "Reviewed · guided", true], "its reviews gone: the chip goes, the footer stays");
      chipOf(4).dispatch("click");
      assert.deepEqual(went, ["the guidance turn's card"]);
      // A turn at work after it holds the watcher's note: the press goes to that card.
      chat.turns.push(t(5, { status: "streaming", history: false, endedAt: 0, steers: [{ id: "s1", kind: "note", text: TEXT, from: "watcher", title: "Supervisor" }] }));
      tl.render(chat);
      const note = host.querySelector("[data-turn='5'] .guide-card");
      assert.deepEqual([note.querySelector(".guide-state").textContent, note.querySelector(".guide-text").innerHTML], ["waits to be read", DRAWN], "the note's card, in the turn at work");
      note.scrollIntoView = () => void went.push("the note's card");
      chipOf(4).dispatch("click");
      assert.deepEqual(went, ["the guidance turn's card", "the note's card"]);
    } finally {
      hd.off();
    }
  });

  // (fails before: yes — "A watcher woke this chat — Filament sent what it heard", of every watcher; its tip said "A
  // watcher this chat proposed", untrue where the person asked for it, and sent the person to Routines)
  test("a wake's capsule says which watcher woke the chat and what it heard, in the server's words, the chat it names a link; what the agent read stays folded", async () => {
    const { watchedRow } = await import(TURN);
    const { transcriptTurns } = await import("../src/ui/harness/conversation/history.js");
    const { WATCHED_WORDS } = await import("../src/ui/harness/lib/labels.js");
    const words = watchersCore.wokeParts("Supervisor", { kind: "turn", chat: "c2", turns: "all", every: 1 }, { events: [{ id: "e1", kind: "turn", at: at(9, 30), chain: "c2", summary: "Turn 4 ended" }], more: 0 }, { nameOf });
    const WOKE = `${watchersCore.WAKE_HEAD} “Supervisor” heard what it watches. ${watchersCore.WAKE_END}`;
    const [turn] = transcriptTurns({ turns: [{ n: 1, turnId: 1, watched: true, by: "watch", watch: { id: "r1", project: "p1", title: "Supervisor", words }, user: { role: "user", content: [{ type: "text", text: WOKE }] }, final: { role: "assistant", content: "Looked." }, requestIds: ["a"] }] });
    assert.deepEqual([turn.watched, turn.watch, turn.watchText], [true, { id: "r1", project: "p1", title: "Supervisor", words }, WOKE]);
    const row = /** @type {any} */ (watchedRow(turn));
    assert.deepEqual([row.getAttribute("class"), row.querySelector(".boundary-row").getAttribute("class")], ["own-turn is-sync is-watched", "boundary-row is-own is-sync"]);
    const label = row.querySelector(".boundary-label");
    assert.equal(label.textContent, "“Supervisor” woke this chat · a turn of Build the login flow ended");
    assert.ok(label.querySelector(".boundary-ic"), "its eye");
    const link = label.querySelector("a");
    assert.deepEqual([link.getAttribute("class"), link.getAttribute("data-chat"), link.getAttribute("href"), link.getAttribute("title"), link.textContent],
      ["ref-chip is-chat", "c2", "#/task/c2", "Open Build the login flow", "Build the login flow"]);
    const tip = row.querySelector(".boundary-row").getAttribute("title");
    assert.match(tip, /^A watcher that wakes this chat heard what it watches: /);
    assert.match(tip, /Its row in the Space's Watchers pauses it$/);
    assert.doesNotMatch(tip, /this chat proposed|Routines/);
    const fold = row.querySelector("details.sync-read");
    assert.deepEqual([fold.hasAttribute("open"), fold.querySelector(".sync-text").textContent], [false, WOKE]);
    // A wake whose turn keeps no word of its watcher: the capsule's own words.
    const bare = /** @type {any} */ (watchedRow({ watched: true, watchText: WOKE }));
    assert.deepEqual([bare.querySelector(".boundary-label").textContent, bare.querySelector("a")], [WATCHED_WORDS, null]);
  });

  // (fails before: yes — nothing in a chat's menu led to a watcher of it)
  // (fails before: yes — it was on in a chat of a project that has no Space, whose agent is given no space tool to
  // propose a watcher with)
  // (moved on purpose, by need of 11-12: in a chat of a project with no Space it was off, sending the person to a menu;
  // now it is on, says that it makes the Space, and the press makes it before the box is filled — off only in a chat of
  // no project, and where the project's deleted Space still waits, which no press may make one over)
  test("Watch this chat… in the chat's menu puts the ask in the box, not sent; in a project with no Space it says it makes one; in a chat of no project, or where a deleted Space waits, it says why not", async () => {
    const { createHeader } = await import("../src/ui/harness/header.js");
    const { WATCH_CHAT_WORDS } = await import("../src/ui/harness/lib/space-view.js");
    assert.equal(WATCH_CHAT_WORDS, "Propose a watcher that reviews each turn of this chat against what I asked for, and guides it when it drifts. Use the space tool's supervisor example.");
    /** @type {true | "project" | "make" | "deleted"} */
    let watchable = true;
    let asked = 0;
    const noop = () => {};
    const hd = /** @type {any} */ (createHeader(/** @type {any} */ ({ onFork: noop, onReload: noop, onRenamed: noop, onArchived: noop, getChat: () => null, onToast: noop, platform: () => "win32", onOpenFolder: noop,
      watchable: () => watchable, onWatch: () => void asked++ })));
    doc.document.body.append(hd.el);
    hd.setChat({ chainId: "c2" });
    /** The chat menu's Watch this chat…, the menu opened. @returns {any} */
    const itemOf = () => {
      hd.el.querySelector(".c-title-btn").dispatch("keydown", { key: "Enter", preventDefault() {} });
      const rows = /** @type {any[]} */ (doc.document.body.querySelectorAll(".zc-menu").at(-1)?.querySelectorAll(".zc-menu-item") || []);
      return rows.find((i) => i.querySelector(".zc-menu-label-line")?.textContent === "Watch this chat…");
    };
    const on = itemOf();
    assert.ok(on, "in the chat's menu");
    assert.deepEqual([on.hasAttribute("disabled"), on.querySelector(".zc-menu-desc").textContent], [false, "the ask in the box, for you to send: its agent proposes the watcher, and you switch it on from its card under the call"]);
    on.dispatch("click");
    assert.equal(asked, 1);
    watchable = "project";
    const off = itemOf();
    assert.deepEqual([off.hasAttribute("disabled"), off.querySelector(".zc-menu-desc").textContent], [true, "not here: this chat is of no project, and a watcher lives in a project's Space"]);
    off.dispatch("click");
    assert.equal(asked, 1, "nothing asked");
    // A project whose deleted Space waits: a Space made now would stand in Bring back's way, so the press is off and says
    // the way on. (The menu stands open after a press on an item that is off: the title's key closes it first.)
    hd.el.querySelector(".c-title-btn").dispatch("keydown", { key: "Enter", preventDefault() {} });
    watchable = "deleted";
    const waits = itemOf();
    assert.deepEqual([waits.hasAttribute("disabled"), waits.querySelector(".zc-menu-desc").textContent], [true, "once this project's deleted Space is back, or a new one made (the project's ⋯ in the left bar): a watcher lives in one"]);
    waits.dispatch("click");
    assert.equal(asked, 1, "nothing asked");
    // A project with no Space: the press is on, and says that it makes the Space, where the watcher lives.
    hd.el.querySelector(".c-title-btn").dispatch("keydown", { key: "Enter", preventDefault() {} });
    watchable = "make";
    const none = itemOf();
    assert.deepEqual([none.hasAttribute("disabled"), none.querySelector(".zc-menu-desc").textContent], [false, "the ask in the box, for you to send: its agent proposes the watcher, and you switch it on from its card under the call. This makes the project's Space, where a watcher lives"]);
    none.dispatch("click");
    assert.equal(asked, 2, "asked: the page makes the Space, then fills the box");
    // The page's hands: whether the chat is of a project, and whether that project has a Space or a deleted one that
    // waits, as the left bar knows it; the Space made first where there is none (space/space.js `spaceForAsk`, which
    // test/space.test.js runs), and the box filled — after what stands in it, never sent — only once it is there, and
    // only while the chat that asked is still the one shown.
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.match(app, /\n    watchable: \(\) => \{\n      const p = projectOfChat\(chatOf\(state\.currentId\)\);\n      return !p \? "project" : sidebar\.hasSpace\(p\) \? true : sidebar\.spaceWaits\(p\) \? "deleted" : "make";\n    \},\n/);
    assert.match(app, /\n    onWatch: async \(\) => \{\n      const id = state\.currentId;\n      const p = projectOfChat\(chatOf\(id\)\);\n      \/\/ [^\n]+\n      if \(p && !sidebar\.hasSpace\(p\) && \(!\(await spaceForAsk\(p\)\) \|\| state\.currentId !== id\)\) return;\n      const draft = composer\.draft\(\)\.trim\(\);\n      composer\.fill\(draft \? `\$\{draft\}\\n\\n\$\{WATCH_CHAT_WORDS\}` : WATCH_CHAT_WORDS\);\n    \},\n/);
  });

  test("their look: the theme's tokens alone and the watcher's one teal; the card's words the answer's size, its head stacked in a narrow pane; the chip no louder than the footer's meta", () => {
    const aqua = readFileSync("src/ui/harness/aqua.css", "utf8");
    const mine = aqua.split("\n").filter((l) => /\.guide-|\.a-reviewed|\.is-watched|\.is-guided|\.steer-guide/.test(l)).join("\n");
    assert.ok(mine.length > 600, "its rules stand beside the brief's");
    assert.doesNotMatch(mine, /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/, "no raw colour");
    assert.doesNotMatch(mine, /font-size:\s*\d/, "no size of its own: the scale's");
    // (fails before: yes — `is-watched` and `is-guided` had no rule of their own)
    assert.match(aqua, /\n\.own-turn\.is-watched \.boundary-label, \.own-turn\.is-guided \.boundary-label \{ color: var\(--color-sys-teal-text\); background: color-mix\(in oklab, var\(--color-sys-teal\) 12%, transparent\);/, "one teal for both capsules");
    assert.match(aqua, /\n\.guide-card \{[^}]*border-left: 2px solid var\(--color-sys-teal\);[^}]*container-type: inline-size;/, "a teal rule at its left, and nothing filled");
    assert.doesNotMatch(aqua.match(/\n\.guide-card \{[^}]*\}/)?.[0] || "", /background/);
    assert.match(aqua, /\n\.guide-text \{[^}]*font-size: var\(--text-ui-base\);[^}]*color: var\(--aq-label\);[^}]*max-height: calc\(1\.72em \* 12\);/, "the answer's size and colour, a dozen lines");
    assert.match(aqua, /\n\.guide-sub, \.guide-state, \.guide-paused \{[^}]*font-size: var\(--text-ui-sm\);[^}]*color: var\(--aq-label-3\);/, "its second words in the meta size");
    assert.match(aqua, /@container \(max-width: 480px\) \{\n  \.guide-head \{ flex-direction: column;/, "a narrow pane: its buttons under its title");
    assert.match(aqua, /\n\.a-reviewed \{[^}]*font-size: var\(--text-ui-sm\);[^}]*color: var\(--aq-label-3\);[^}]*border: 1px solid var\(--aq-hairline\);/, "a muted outline, the meta's size");
    assert.match(aqua, /\n\.a-reviewed\.is-guided \{[^}]*color: var\(--color-sys-teal-text\);[^}]*border-color: color-mix\(in oklab, var\(--color-sys-teal\) 45%, transparent\);/, "teal where it guided");
    // It stays while the actions hide: at the far end of a row the actions share, which the pointer's rule never names.
    // (fails before: yes — there was no such row)
    assert.match(aqua, /\n\.a-reviewed \{[^}]*flex: none;[^}]*margin-left: auto;/, "at the row's far end");
    const base = readFileSync("src/ui/harness.css", "utf8");
    assert.match(base, /\n\.a-row \{ display: flex; align-items: center; gap: 8px; min-width: 0; \}\n\.a-row > \.a-actions \{ flex: 1 1 auto; min-width: 0; \}/, "the actions take what the chip leaves, their meta cut short first");
    assert.doesNotMatch(base, /\.a-row[^{]*\{[^}]*opacity/, "nothing hides the row");
    // The note's card takes the column, where a bubble keeps to the right; the dashed bubble is Filament's own alone.
    const css = readFileSync("src/ui/harness.css", "utf8");
    assert.match(css, /\n\.steer\.steer-guide \{ align-self: stretch; max-width: none; \}/);
    assert.match(css, /\n\.steer\.steer-from-filament \.steer-text \{ border-style: dashed; \}/);
  });

  test("the page wires them: the reviews from the chat's transcript and the feed's `reviews`, drawn on the turns they moved; a card's Pause the line's own press", () => {
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.match(app, /if \(\(Number\(chat\.reviewsAt\) \|\| 0\) < asked\) chat\.reviews = tr\.reviews \|\| \{\};/, "from the transcript, unless the feed said newer ones");
    assert.match(app, /if \(msg\?\.type === "reviews" && msg\.chainId\) setReviews\(String\(msg\.chainId\), msg\.reviews\);/, "and the feed's, whole, at each change");
    assert.match(app, /\n  const moved = reviewsMoved\(chat\.turns \|\| \[\], chat\.reviews\);\n  if \(chatOf\(state\.currentId\) === chat\) for \(const t of moved\) transcript\.drawReviews\(t\);\n/, "only the turns whose reviews moved");
    assert.match(app, /\nguideHands\.watchers = \(\) => chatOf\(state\.currentId\)\?\.watchers \?\? null;\n/);
    assert.match(app, /\nguideHands\.press = watchPress;\n/, "Pause and Resume: the write the line over the box sends");
    const service = readFileSync("src/app/sessions/service.js", "utf8");
    assert.match(service, /\n      reviews: chatWatching\?\.reviews\(chain\.id\) \|\| \{\},\n/, "the transcript's reviews, by turn");
  });
});

describe("the watchers' line over the box", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let dom;
  /** @type {typeof import("../src/ui/harness/conversation/watch-line.js")} */
  let line;
  before(async () => {
    dom = stubDocument();
    line = await import("../src/ui/harness/conversation/watch-line.js");
  });
  after(() => dom.restore());

  /** A chat's watcher as the server says it (core's `chatWatchers`). @param {any} [o] */
  const cw = (o = {}) => ({ id: "r1", project: "p1", title: "Supervisor", state: "on", paused: false, role: "watched",
    words: { lead: "Watched by", name: "Supervisor", does: "reviews each turn, may guide", full: "“Supervisor”: after each turn of Build the login flow · wakes Lead" }, ...o });
  /** One that wakes the chat. @param {any} [o] */
  const waking = (o = {}) => cw({ role: "watches", words: { lead: "Watching", name: "Build the login flow", does: "wakes this chat after each turn", full: "“Supervisor”: after each turn of Build the login flow · wakes Lead" }, ...o });

  // (fails before: yes — there was no line: no conversation/watch-line.js)
  test("what each line says: a watched chat, a watching chat, one paused, several, none — and only of watchers that are on", () => {
    const { watchLineOf } = line;
    /** @param {any[]} list @param {"watched" | "watches"} role */
    const said = (list, role) => {
      const l = watchLineOf(list, role);
      return l ? [`${l.lead}${l.name}${l.rest}`, l.press, l.of.id] : null;
    };
    assert.deepEqual(said([cw()], "watched"), ["Watched by Supervisor · reviews each turn, may guide", "pause", "r1"]);
    assert.deepEqual(watchLineOf([cw()], "watched"), { lead: "Watched by ", name: "Supervisor", rest: " · reviews each turn, may guide", tip: "“Supervisor”: after each turn of Build the login flow · wakes Lead", press: "pause", paused: false, of: cw() });
    assert.deepEqual(said([waking()], "watches"), ["Watching Build the login flow · wakes this chat after each turn", "pause", "r1"]);
    // Both hold of one chat: each line its own.
    const both = [cw(), waking({ id: "r2", title: "Deploy watch" })];
    assert.deepEqual([said(both, "watched"), said(both, "watches")], [["Watched by Supervisor · reviews each turn, may guide", "pause", "r1"], ["Watching Build the login flow · wakes this chat after each turn", "pause", "r2"]]);
    // Paused: by its title, with Resume.
    assert.deepEqual(said([cw({ paused: true })], "watched"), ["Supervisor is paused", "resume", "r1"]);
    assert.deepEqual(said([waking({ paused: true })], "watches"), ["Supervisor is paused", "resume", "r1"]);
    assert.equal(watchLineOf([cw({ paused: true })], "watched")?.paused, true);
    // Two or more: the first that listens and how many more, with Open.
    const two = [cw(), cw({ id: "r2", title: "Reviewer", words: { ...cw().words, name: "Reviewer" } })];
    assert.deepEqual(said(two, "watched"), ["Watched by Supervisor and 1 more", "open", "r1"]);
    assert.deepEqual(said([...two, cw({ id: "r3", title: "Third", paused: true })], "watched"), ["Watched by Supervisor and 2 more · 1 paused", "open", "r1"]);
    assert.deepEqual(said([cw({ paused: true }), two[1]], "watched"), ["Watched by Reviewer and 1 more · 1 paused", "open", "r2"], "the one that listens is named");
    assert.deepEqual(said([cw({ paused: true }), cw({ id: "r2", title: "Reviewer", paused: true })], "watched"), ["Supervisor and 1 more are paused", "open", "r1"]);
    assert.equal(watchLineOf(two, "watched")?.tip, `${two[0].words.full}\n${two[1].words.full}`, "each one's whole words on hover");
    // None: no watcher, none of this role, none on.
    assert.equal(said([], "watched"), null);
    assert.equal(said([cw()], "watches"), null);
    assert.equal(said([cw({ state: "proposed" })], "watched"), null, "one proposed does not watch yet");
    assert.equal(said(/** @type {any} */ (null), "watched"), null);
  });

  // (fails before: yes — under Pause all the line said "Watched by Supervisor · reviews each turn, may guide" and offered
  // Pause, of a watcher that hears nothing)
  test("under Pause all the line says its watcher does not listen, and offers Open — never Pause", () => {
    const { watchLineOf } = line;
    /** @param {any} [o] */
    const all = (o = {}) => cw({ pausedAll: true, ...o });
    /** @param {ReturnType<typeof watchLineOf>} l */
    const says = (l) => [`${l?.lead}${l?.name}${l?.rest}`, l?.press, l?.paused];
    assert.deepEqual(watchLineOf([all()], "watched"), { lead: "", name: "Supervisor", rest: " does not listen: Pause all is on", tip: cw().words.full, press: "open", paused: true, of: all() });
    assert.deepEqual(says(watchLineOf([all(), all({ id: "r2", title: "Reviewer" })], "watched")), ["Supervisor and 1 more do not listen: Pause all is on", "open", true]);
    assert.deepEqual(says(watchLineOf([waking({ pausedAll: true })], "watches")), ["Supervisor does not listen: Pause all is on", "open", true], "the chat it wakes, by its watcher's title");
    assert.deepEqual(says(watchLineOf([all({ paused: true })], "watched")), ["Supervisor does not listen: Pause all is on", "open", true], "one paused by itself too: Pause all holds it first");
    // Drawn: Open — the Space's Watchers, where Resume is.
    /** @type {any[]} */
    const pressed = [];
    const l = line.createWatchLine({ onPress: (x) => void pressed.push([x.press, x.of.project, x.of.id]) });
    const el = /** @type {any} */ (l.el);
    l.paint(watchLineOf([all()], "watched"));
    const go = el.querySelector(".watch-line-go");
    assert.deepEqual([el.querySelector(".watch-line-words").textContent, go.textContent, go.getAttribute("title"), el.classList.contains("is-paused")],
      ["Supervisor does not listen: Pause all is on", "Open", "Open this Space's Watchers", true]);
    go.dispatch("click");
    assert.deepEqual(pressed, [["open", "p1", "r1"]]);
  });

  test("the line drawn: hidden with nothing to say, its words in place, the one pill its press — Pause, Resume or Open", () => {
    /** @type {any[]} */
    const pressed = [];
    const l = line.createWatchLine({ onPress: (x) => void pressed.push([x.press, x.of.project, x.of.id]) });
    const el = /** @type {any} */ (l.el);
    assert.ok(el.classList.contains("hidden"), "nothing painted yet");
    assert.equal(el.getAttribute("role"), "status");
    l.paint(line.watchLineOf([cw()], "watched"));
    assert.ok(!el.classList.contains("hidden"));
    assert.deepEqual([el.querySelector(".watch-line-lead").textContent, el.querySelector(".watch-line-name").textContent, el.querySelector(".watch-line-what").textContent, el.querySelector(".watch-line-words").getAttribute("title")],
      ["Watched by ", "Supervisor", " · reviews each turn, may guide", "“Supervisor”: after each turn of Build the login flow · wakes Lead"]);
    assert.ok(el.querySelector(".watch-line-icon"), "its eye");
    const go = el.querySelector(".watch-line-go");
    assert.deepEqual([go.textContent, go.getAttribute("title")], ["Pause", "It listens no more until you resume it"]);
    go.dispatch("click");
    assert.deepEqual(pressed, [["pause", "p1", "r1"]]);
    // Paused: the same button, Resume now.
    l.paint(line.watchLineOf([cw({ paused: true })], "watched"));
    assert.deepEqual([el.querySelector(".watch-line-go") === go, go.textContent, go.getAttribute("title"), el.classList.contains("is-paused"), el.querySelector(".watch-line-words").textContent],
      [true, "Resume", "It listens again; what happened while it was paused is not made up", true, "Supervisor is paused"]);
    go.dispatch("click");
    assert.deepEqual(pressed.at(-1), ["resume", "p1", "r1"]);
    // Several: Open, the Space's Watchers.
    l.paint(line.watchLineOf([cw(), cw({ id: "r2", title: "Reviewer" })], "watched"));
    assert.deepEqual([go.textContent, go.getAttribute("title"), el.classList.contains("is-paused")], ["Open", "Open this Space's Watchers", false]);
    go.dispatch("click");
    assert.deepEqual(pressed.at(-1), ["open", "p1", "r1"]);
    // The same words touch nothing: it is asked as the chat is shown and at each word of the feed.
    const name = el.querySelector(".watch-line-name");
    let wrote = 0;
    Object.defineProperty(name, "textContent", { configurable: true, get: () => "Supervisor", set: () => { wrote++; } });
    l.paint(line.watchLineOf([cw(), cw({ id: "r2", title: "Reviewer" })], "watched"));
    assert.equal(wrote, 0, "the same words, nothing written");
    l.paint(null);
    assert.ok(el.classList.contains("hidden"));
  });

  test("its look: quiet as the browser's line, its eye the watchers' teal, the pill at the line's end; hidden where the browser's is", () => {
    const css = readFileSync("src/ui/harness.css", "utf8");
    assert.match(css, /\n\.watch-line \{ display: flex; align-items: center; gap: 8px; min-width: 0; padding: 4px 12px; font-size: var\(--text-ui-sm\); color: var\(--color-foreground-subtle\); \}/);
    assert.match(css, /\n\.conv-frame\.view-browser > \.dock \.watch-line \{ display: none; \}/, "where the browser's line is hidden");
    assert.match(css, /\n\.watch-line-icon \{ flex: none; display: inline-flex; color: var\(--color-sys-teal-text\); \}/);
    assert.match(css, /\n\.watch-line-words \{ flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; \}/);
    assert.match(css, /\n\.watch-line-go \{ flex: none;/, "the button keeps its own width");
    const mine = css.split("\n").filter((l) => /\.watch-line/.test(l)).join("\n");
    assert.doesNotMatch(mine, /#[0-9a-fA-F]{3,8}\b|\brgba?\(|font-size:\s*\d/, "tokens alone");
  });

  test("the page wires it: two lines over the box, the watched one first; the list from the chat's transcript and the feed's `watchers`; Pause and Resume the routine's own write, Open the Space's Watchers", () => {
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.match(app, /\nconst watchedLine = createWatchLine\(\{ onPress: watchPress \}\);\nconst watchingLine = createWatchLine\(\{ onPress: watchPress \}\);\ncomposer\.asks\.append\(watchedLine\.el, watchingLine\.el\);\n/, "over the box, the watched line first");
    assert.match(app, /\n  watchedLine\.paint\(watchLineOf\(list, "watched"\)\);\n  watchingLine\.paint\(watchLineOf\(list, "watches"\)\);\n/);
    assert.match(app, /if \(\(Number\(chat\.watchersAt\) \|\| 0\) < asked\) chat\.watchers = Array\.isArray\(tr\.watchers\) \? tr\.watchers : \[\];/, "from the transcript, unless the feed said a newer list");
    assert.match(app, /if \(msg\?\.type === "watchers" && msg\.chainId\) setWatchers\(String\(msg\.chainId\), msg\.watchers\);/, "and the feed's whole list at each change");
    assert.match(app, /paintBrowserLine\(\);\n  paintWatchLine\(\);/, "with the chat (selectChat)");
    assert.match(app, /await api\(`\/space\/\$\{encodeURIComponent\(of\.project\)\}\/routines\/\$\{encodeURIComponent\(of\.id\)\}\/pause`, \{ method: "POST", body: \{ paused: press === "pause" \} \}\);/, "the write its row's switch sends");
    assert.match(app, /location\.hash = routeFor\("space", \{ id: of\.project, tab: WATCHERS \}\);/, "Open: Space › Watchers");
    const service = readFileSync("src/app/sessions/service.js", "utf8");
    assert.match(service, /\n      watchers: chatWatchers\?\.\(chain\.id\) \|\| \[\],\n/, "the transcript's list");
  });
});
