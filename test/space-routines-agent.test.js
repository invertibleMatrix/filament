// @ts-check
// E42 AS4, SA-D3 and SA-D10 (HarnessV4_AgentsSpace_Plan cases 17, 18, 21d): an agent of the project stops what runs by
// itself and starts a routine that is on, and what it did says who did it. A routine paused with its line — any routine
// on, its row and What happened naming the chat; resuming it is the person's, whose Resume says whose pause it ends.
// Run now of one that is on: its run as the person's, its row "started by" the chat, its first message naming it —
// never from a routine's own run, nor while it or Pause all is paused. Pause all with its line, for every Space: its
// head names the chat, kept across a restart; switching it off is the person's. In Filament's loop and a coding agent's
// call alike (both call `spaceRun`).
// (fails before: yes — an agent could only propose a routine: it could not pause one, run one now, nor Pause all)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { headWords, routinesWords, rowWords, runWords } from "../src/core/routines.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { needsWords, readerNames } from "../src/core/space.js";
import { createRoutines } from "../src/app/routines.js";
import { spaceCall, spaceGuide, spaceRun } from "../src/app/agent/space.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { removeDirs } from "./helpers/wait.js";

const dirs = /** @type {string[]} */ ([]);
after(() => removeDirs(...dirs));
const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), "filament-sra-"));
  dirs.push(d);
  return d;
};

/** Monday 26 October 2026, local. @param {number} h @param {number} [m] */
const at = (h, m = 0) => new Date(2026, 9, 26, h, m).getTime();
const FIELDS = { title: "Morning brief", when: "weekdays 09:00", task: "Read the open PRs and CI; say what needs the person.", writes: false };
const NAMES = /** @type {Record<string, string>} */ ({ c1: "Release", c2: "Deploy fixer" });
/** @param {any} r */
const words = (r) => (r.ok ? r.text : r.error);

/** A Space with Morning brief on, the routines' runner on stand-ins. */
function worldOf({ dir = /** @type {string | null} */ (null) } = {}) {
  const clock = { at: at(8) };
  const now = () => clock.at;
  const spaces = createSpaceStore({ dir, now });
  /** @type {[string, any][]} */
  const posted = [];
  /** @type {[string, any][]} */
  const marked = [];
  let n = 0;
  const routines = createRoutines({
    spaces,
    sessions: { create: () => ({ id: `run${++n}` }), besideFacts: () => ({ busy: true, asking: false, last: null }) },
    mark: (id, m) => void marked.push([id, m]),
    postTurn: async (id, b) => (posted.push([id, b]), { status: 200, body: null }),
    folderOf: () => "/work/app",
    nameOf: () => "app",
    now,
  });
  const r = spaces.routinePropose("p1", FIELDS, { chain: "c1", byName: "Release", model: "m" });
  spaces.routineOn("p1", r.id);
  /** @type {string[]} */
  const armed = [];
  /** @type {any[]} */
  const pausedAll = [];
  /** Where a chat's call stands. @param {Record<string, any>} [o] @returns {import("../src/app/agent/space.js").SpaceAt} */
  const atOf = (o = {}) => ({
    store: spaces, project: "p1", chain: "c2", name: null, nameOf: (c) => NAMES[c] || c, on: () => true,
    routines: { runNow: routines.runNow, arm: () => void armed.push("arm") },
    runOf: () => null,
    dashboards: /** @type {any} */ ({ pauseAll: (/** @type {boolean} */ on, /** @type {any} */ by) => (pausedAll.push([on, by]), spaces.pauseAll(on, by)) }),
    ...o,
  });
  const r1 = () => spaces.get("p1").routines[0];
  return { clock, spaces, routines, posted, marked, armed, pausedAll, atOf, r1 };
}
const call = (/** @type {Record<string, any>} */ w) => ({ action: "routine", with: w });

describe("a routine paused by an agent (case 17)", () => {
  test("with its line: any routine on; its row and What happened say who and why; the timer set again", async () => {
    const w = worldOf();
    assert.equal(words(await spaceRun(call({ id: "r1", pause: "" }), w.atOf())), 'Not changed: say why, in a line: {"action":"routine","with":{"id":"r1","pause":"CI is red on main; each run would fail"}}.');
    const r = await spaceRun(call({ id: "r1", pause: "CI is red on main; each run would fail" }), w.atOf());
    assert.equal(words(r), "“Morning brief” is paused: it runs no more until the person resumes it. Its row says you paused it, with your line, and so does What happened.");
    assert.deepEqual([w.r1().paused, w.r1().pausedBy], [true, { chain: "c2", byName: "Deploy fixer", line: "CI is red on main; each run would fail" }]);
    assert.deepEqual(w.armed, ["arm"]);
    const line = w.spaces.get("p1").log.at(-1);
    assert.deepEqual([line?.by, line?.text], [{ kind: "agent", chain: "c2" }, "Paused the routine “Morning brief”: CI is red on main; each run would fail"]);
    assert.equal(rowWords(w.r1(), { now: w.clock.at }).next, "paused by Deploy fixer: CI is red on main; each run would fail — it runs when you resume it");
    assert.ok(routinesWords(w.spaces.get("p1").routines, { nameOf: String, now: w.clock.at, self: "c2" }).includes(": on, paused by you: CI is red on main; each run would fail"));
  });

  test("a second pause refused naming who; resuming is the person's; their Resume says whose pause it ends", async () => {
    const w = worldOf();
    await spaceRun(call({ id: "r1", pause: "CI is red" }), w.atOf());
    assert.equal(words(await spaceRun(call({ id: "r1", pause: "again" }), w.atOf({ chain: "c1" }))), "Not changed: “Morning brief” is paused already, by Deploy fixer: CI is red.");
    assert.equal(words(await spaceRun(call({ id: "r1", resume: true }), w.atOf())), "Not changed: resuming “Morning brief” is the person's — it lets it run by itself again. Say in your answer why it may go on.");
    assert.equal(words(await spaceRun(call({ id: "r9", pause: "x" }), w.atOf())), 'Not changed: There is no routine "r9" in this Space.');
    w.spaces.routinePause("p1", "r1", false);
    assert.equal(w.spaces.get("p1").log.at(-1)?.text, "You resumed the routine “Morning brief”, which Deploy fixer had paused: CI is red");
    assert.equal(w.r1().pausedBy, undefined);
    w.spaces.routinePause("p1", "r1", true);
    assert.equal(rowWords(w.r1(), { now: w.clock.at }).next, "paused: it runs when you resume it", "yours reads as today");
    assert.equal(words(await spaceRun(call({ id: "r1", pause: "x" }), w.atOf())), "Not changed: “Morning brief” is paused already, by the person.");
  });

  test("kept across a restart, as it was said", async () => {
    const dir = fresh();
    const w = worldOf({ dir });
    await spaceRun(call({ id: "r1", pause: "CI is red" }), w.atOf());
    assert.deepEqual(createSpaceStore({ dir, now: () => w.clock.at }).get("p1").routines[0].pausedBy, { chain: "c2", byName: "Deploy fixer", line: "CI is red" });
  });
});

describe("Run now by an agent (case 17, SA-D10)", () => {
  test("one on runs at once, as the person's Run now: its row and its run's first message name the chat, and What happened", async () => {
    const w = worldOf();
    const r = await spaceRun(call({ id: "r1", run: true }), w.atOf());
    assert.equal(words(r), "“Morning brief” runs now, as the person's Run now runs it: a new chat of this project, reading only. Its row says you started it; what it answers comes to What happened as it ends.");
    assert.deepEqual(w.r1().last, { at: w.clock.at, chain: "run1", by: "agent", startedBy: { chain: "c2", byName: "Deploy fixer" }, state: "running", on: "m" }, "with the model it runs on (11-04)");
    assert.deepEqual(w.marked[0][1].routine.startedBy, { chain: "c2", byName: "Deploy fixer" });
    assert.equal(w.posted[0][1].content[0].text, runWords(w.r1(), { project: "app", when: "weekdays at 09:00", by: "agent", byName: "Deploy fixer" }));
    assert.match(w.posted[0][1].content[0].text, /^This is “Morning brief”, a routine of app's Space, run now, as Deploy fixer pressed Run now: a chat of its own\./);
    assert.equal(rowWords(w.r1(), { now: w.clock.at, live: { busy: true, asking: false } }).last, "now: running since today 08:00 · started by Deploy fixer");
    const line = w.spaces.get("p1").log.at(-1);
    assert.deepEqual([line?.by, line?.text], [{ kind: "agent", chain: "c2" }, "Ran the routine “Morning brief” now, with its Run now."]);
    // Its end keeps who started it: the row and a failure's Needs you row say so.
    w.spaces.routineEnded("p1", "r1", { at: w.clock.at, chain: "run1", by: "agent", state: "failed", why: "GitHub said 401" });
    assert.equal(rowWords(w.r1(), { now: w.clock.at }).last, "last: today 08:00 (Run now by Deploy fixer) · failed: GitHub said 401");
    assert.equal(w.spaces.get("p1").needs.at(-1)?.why, "a routine of this Space, run by Deploy fixer's Run now at 08:00");
    assert.equal(w.spaces.get("p1").routines[0].last?.startedBy?.byName, "Deploy fixer");
  });

  // (fails before: yes — round 6's lead 2 of the 11-02 privacy round: the run's first message named the chat by its name
  // then: "…run now, as Deploy fixer pressed Run now: a chat of its own."; and, the failure's row keeping no parts, the
  // other chat read "(why: a routine of this Space, run by Deploy fixer's Run now at 08:00)")
  test("a run another chat's agent started names that chat to the run's own agent as an untitled chat, where its words are none of that agent's; and so does its failure's row of Needs you, read back", async () => {
    const dir = fresh();
    const spaces = createSpaceStore({ dir, now: () => at(8) });
    /** @type {any[]} */
    const posted = [];
    const routines = createRoutines({
      spaces,
      sessions: { create: () => ({ id: "run1" }), besideFacts: () => ({ busy: true, asking: false, last: null }) },
      mark: () => {},
      postTurn: async (_id, b) => (posted.push(b), { status: 200, body: null }),
      folderOf: () => "/work/app",
      nameOf: () => "app",
      apart: (c) => c === "c2",
      now: () => at(8),
    });
    const r = spaces.routinePropose("p1", FIELDS, { chain: "c1", byName: "Release", model: "m" });
    spaces.routineOn("p1", r.id);
    await routines.runNow("p1", r.id, { chain: "c2", byName: "Deploy fixer" });
    assert.match(posted[0]?.content?.[0]?.text, /^This is “Morning brief”, a routine of app's Space, run now, as an untitled chat pressed Run now: a chat of its own\./);
    assert.equal(spaces.get("p1").routines[0].last?.startedBy?.byName, "Deploy fixer", "the person's pages keep its name");
    spaces.routineEnded("p1", r.id, { at: at(8), chain: "run1", by: "agent", state: "failed", why: "GitHub said 401" });
    const needs = createSpaceStore({ dir, now: () => at(8) }).get("p1").needs;
    assert.equal(needs.at(-1)?.why, "a routine of this Space, run by Deploy fixer's Run now at 08:00", "the person's page reads its name");
    const c1 = readerNames({ nameOf: (c) => NAMES[c] || c, apart: (c) => c === "c2" }, "c1");
    assert.match(needsWords(needs, { ...c1, now: at(8), self: "c1" }), /\(why: a routine of this Space, run by an untitled chat's Run now at 08:00\)/);
  });

  test("refused in words: from a routine's own run, while it or Pause all is paused, one not on, one running", async () => {
    const w = worldOf();
    assert.equal(words(await spaceRun(call({ id: "r1", run: true }), w.atOf({ runOf: () => ({ title: "Nightly sweep" }) }))), "Not run: this chat is a run of the routine “Nightly sweep”, and no run starts another. Say in your answer what should run.");
    // Nor from a turn a watcher woke in the chat that proposed it (the plan of 11-11, its w5): that turn is the watcher's run.
    // (fails before: yes — the agent of a chat a watcher had woken could press Run now, and one watcher's turn started a run)
    assert.equal(words(await spaceRun(call({ id: "r1", run: true }), w.atOf({ runOf: () => ({ title: "Supervisor", hosted: true }) }))), "Not run: this turn is the watcher “Supervisor”'s, woken in this chat, and no run starts another. Say in your answer what should run.");
    assert.equal(w.posted.length, 0, "nothing started");
    await spaceRun(call({ id: "r1", pause: "CI is red" }), w.atOf({ chain: "c1" }));
    assert.equal(words(await spaceRun(call({ id: "r1", run: true }), w.atOf())), "Not run: “Morning brief” is paused, by Release: CI is red. Resuming it is the person's; their Run now runs it still.");
    w.spaces.routinePause("p1", "r1", false);
    w.spaces.pauseAll(true);
    assert.equal(words(await spaceRun(call({ id: "r1", run: true }), w.atOf())), "Not run: Pause all is on: nothing starts by itself until the person resumes. Their Run now runs it still.");
    w.spaces.pauseAll(false);
    const p = w.spaces.routinePropose("p1", { ...FIELDS, title: "Weekly" }, { chain: "c1", byName: "Release", model: "m" });
    assert.equal(words(await spaceRun(call({ id: p.id, run: true }), w.atOf())), "Not run: “Weekly” is not on: its Switch on… says what it does first.");
    await spaceRun(call({ id: "r1", run: true }), w.atOf());
    assert.equal(words(await spaceRun(call({ id: "r1", run: true }), w.atOf())), "Not run: “Morning brief” is running now: open its run, or stop it there.");
    assert.equal(w.posted.length, 1, "one run started");
    assert.equal(words(await spaceRun(call({ id: "r1", run: true }), w.atOf({ routines: null }))), "Not run: routines are not wired in this Filament.");
    assert.deepEqual(spaceCall(call({ id: "r1", run: true }), w.atOf()), { ok: false, error: "Not run: Run now starts a chat, and is answered by Filament's own call of the tool." });
  });
});

// The plan of 11-11, its w5: Run now of a watcher that wakes the chat that proposed it is a turn of Filament's in that
// chat — started by the chat whose agent pressed it, said so to both —, never a new chat; and never from that chat itself.
// (fails before: yes — the runner dropped who pressed it: its row said "you", its first message "the person pressed Run now",
// and the tool answered "a new chat of this project")
describe("Run now by an agent, of a watcher that wakes its chat", () => {
  /** A watcher of c1's that wakes c1, on, over stand-ins. */
  function watcherWorld() {
    const spaces = createSpaceStore({ dir: null, now: () => at(8) });
    /** @type {[string, any][]} */
    const posted = [];
    let busy = false;
    const routines = createRoutines({
      spaces,
      sessions: { create: () => ({ id: "run1" }), besideFacts: () => ({ busy, asking: false, last: { n: 2, final: true, text: "x", cut: false, failed: false, why: "", stopped: false } }) },
      mark: () => {},
      postTurn: async (id, b) => (posted.push([id, b]), (busy = true), { status: 200, body: null }),
      folderOf: () => "/work/app",
      nameOf: () => "app",
      chatName: (c) => NAMES[c] || c,
      now: () => at(8),
    });
    const r = spaces.routinePropose("p1", { title: "Supervisor", when: "", task: "Read its turn.", writes: false, trigger: /** @type {any} */ ({ kind: "turn", chat: "c2", turns: "changed", every: 1 }), wakes: "chat" }, { chain: "c1", byName: "Release", model: "m" });
    spaces.routineOn("p1", r.id);
    /** @param {Record<string, any>} [o] @returns {import("../src/app/agent/space.js").SpaceAt} */
    const atOf = (o = {}) => ({ store: spaces, project: "p1", chain: "c2", name: null, nameOf: (c) => NAMES[c] || c, on: () => true, routines: { runNow: routines.runNow, arm: () => {} }, runOf: () => null, dashboards: /** @type {any} */ ({}), ...o });
    return { spaces, posted, atOf, r: () => spaces.get("p1").routines[0] };
  }

  test("it looks now: a turn in the chat that proposed it, by the chat that pressed it; the tool says so", async () => {
    const w = watcherWorld();
    const r = await spaceRun(call({ id: "r1", run: true }), w.atOf());
    // (fails before: yes — the review of w5's fixes: it said "what it answers stays in that chat", though What happened
    // says how its turn ended, with its answer's first line)
    assert.equal(words(r), "“Supervisor” looks now, as the person's Run now has it look: a turn of Filament's in the chat that proposed it (Release), with what it heard since its last look. Its row says you started it; its answer is in that chat, and how it ended comes to What happened.");
    assert.deepEqual([w.posted.length, w.posted[0][0], w.posted[0][1].by], [1, "c1", "watch"]);
    assert.match(w.posted[0][1].content[0].text, /woke this chat, as Deploy fixer pressed Run now./);
    assert.deepEqual([w.r().last?.by, w.r().last?.startedBy, w.r().last?.chain], ["agent", { chain: "c2", byName: "Deploy fixer" }, "c1"]);
    assert.equal(w.spaces.get("p1").log.at(-1)?.text, "Ran the watcher “Supervisor” now, with its Run now.");
  });

  test("never from the chat it wakes: that turn holds the chat", async () => {
    const w = watcherWorld();
    // (fails before: yes — the review of w5's fixes: it promised "What it hears reaches you once this turn ends", which
    // nothing makes sure: its hour's cap, Pause all or a pause may hold it. What is sure is said: what waits now.)
    assert.equal(words(await spaceRun(call({ id: "r1", run: true }), w.atOf({ chain: "c1" }))), "Not run: “Supervisor” wakes this chat, in a turn of its own, and this turn holds the chat: its turn cannot begin before this one ends. Nothing it heard waits now.");
    assert.equal(w.posted.length, 0);
    w.spaces.watchHeard("p1", "r1", [1, 2].map((i) => ({ id: `turn:c2:${i}`, kind: "turn", at: at(8) + i, chain: "c2", summary: `Turn ${i} of Deploy fixer ended: 1 file changed` })));
    assert.equal(words(await spaceRun(call({ id: "r1", run: true }), w.atOf({ chain: "c1" }))), "Not run: “Supervisor” wakes this chat, in a turn of its own, and this turn holds the chat: its turn cannot begin before this one ends. What it heard waits: 2 events.");
    assert.equal(w.posted.length, 0);
  });

  // (fails before: yes — the review of w5's fixes: the store had no pause of Filament's own for a watcher, and one
  // paused with no chat's line read "paused, by the person")
  test("a watcher Filament paused — the chat it wakes can never take its turn — says so, and why, to an agent's Run now and to its pause", async () => {
    const w = watcherWorld();
    assert.equal(w.spaces.watchPaused("p1", "r1", "the chat it wakes (Release) is gone"), true);
    assert.equal(words(await spaceRun(call({ id: "r1", run: true }), w.atOf())), "Not run: “Supervisor” is paused, by Filament: the chat it wakes (Release) is gone. Resuming it is the person's; their Run now runs it still.");
    assert.equal(words(await spaceRun(call({ id: "r1", pause: "It fails each time." }), w.atOf())), "Not changed: “Supervisor” is paused already, by Filament: the chat it wakes (Release) is gone.");
    assert.equal(w.posted.length, 0);
  });

  // (fails before: yes — the tool answered a watcher's pause in a routine's words: "it runs no more", and its resume
  // "it lets it run by itself again"; a watcher runs at no time: it listens)
  test("a watcher paused by an agent listens no more, and resuming it — the person's — lets it listen again", async () => {
    const w = watcherWorld();
    assert.equal(words(await spaceRun(call({ id: "r1", resume: true }), w.atOf())), "Not changed: resuming “Supervisor” is the person's — it lets it listen again. Say in your answer why it may go on.");
    assert.equal(words(await spaceRun(call({ id: "r1", pause: "It reviews a chat that is done." }), w.atOf())), "“Supervisor” is paused: it listens no more until the person resumes it. Its row says you paused it, with your line, and so does What happened.");
    assert.deepEqual([w.r().paused, w.spaces.get("p1").log.at(-1)?.text], [true, "Paused the watcher “Supervisor”: It reviews a chat that is done."]);
    assert.equal(rowWords(w.r(), { now: at(8) }).next, "paused by Deploy fixer: It reviews a chat that is done. — it listens again once you resume it", "its row says who, and why");
  });
});

describe("Pause all by an agent (case 18)", () => {
  test("with its line: nothing starts by itself, in every Space; its head names the chat; switching it off is the person's", async () => {
    const dir = fresh();
    const w = worldOf({ dir });
    assert.equal(words(await spaceRun(call({ pauseAll: true }), w.atOf())), 'Not changed: say why, in a line: {"action":"routine","with":{"pauseAll":"the deploy key leaked; nothing should run until it is rotated"}}.');
    w.clock.at = at(14, 20);
    const r = await spaceRun(call({ pauseAll: "the deploy key leaked" }), w.atOf());
    // (fails before: yes — it named no watcher among what it holds back, and Routines' head alone, though Watchers'
    // says it too)
    assert.equal(words(r), "Pause all is on: no routine's time, no watcher's wake and no watch's look starts by itself, in any Space of this Filament, until the person resumes. The heads of Routines and Watchers say you switched it on, with your line, and so does What happened.");
    assert.deepEqual(w.pausedAll, [[true, { chain: "c2", byName: "Deploy fixer", line: "the deploy key leaked" }]], "through the dashboards' runner: its watches stop too");
    assert.deepEqual(w.armed, ["arm"]);
    assert.deepEqual([w.spaces.pausedSince(), w.spaces.pausedAllBy()], [at(14, 20), { chain: "c2", byName: "Deploy fixer", line: "the deploy key leaked" }]);
    assert.equal(headWords([{ title: "Morning brief", nextAt: null }], [], { now: at(14, 30), pausedSince: w.spaces.pausedSince(), pausedBy: w.spaces.pausedAllBy() }),
      "Deploy fixer paused all at today 14:20: the deploy key leaked · 1 routine, nothing starts by itself until you resume");
    assert.equal(w.spaces.get("p1").log.at(-1)?.text, "Switched Pause all on, in every Space: the deploy key leaked");
    assert.ok(routinesWords(w.spaces.get("p1").routines, { nameOf: String, now: at(14, 30), self: "c1", pausedSince: w.spaces.pausedSince(), pausedBy: w.spaces.pausedAllBy() })
      .includes("Pause all is on since today 14:20, by Deploy fixer: the deploy key leaked: nothing starts by itself, in any Space, until the person resumes."));
    assert.equal(words(await spaceRun(call({ pauseAll: "again" }), w.atOf({ chain: "c1" }))), "Not changed: Pause all is on already, since 14:20, by Deploy fixer: the deploy key leaked.");
    assert.equal(words(await spaceRun(call({ pauseAll: false }), w.atOf())), "Not changed: switching Pause all off is the person's — it lets everything run by itself again. Say in your answer why it may.");
    assert.equal(words(await spaceRun(call({ resumeAll: true }), w.atOf())), "Not changed: switching Pause all off is the person's — it lets everything run by itself again. Say in your answer why it may.");
    // Kept across a restart; the person's switch off forgets who.
    const again = createSpaceStore({ dir, now: () => at(15) });
    assert.deepEqual([again.pausedSince(), again.pausedAllBy()?.byName], [at(14, 20), "Deploy fixer"]);
    again.pauseAll(false);
    assert.deepEqual([again.pausedSince(), again.pausedAllBy()], [null, null]);
    again.pauseAll(true);
    assert.equal(again.pausedAllBy(), null, "the person's Pause all names no one");
    assert.equal(headWords([{ title: "x", nextAt: null }], [], { now: at(15), pausedSince: again.pausedSince(), pausedBy: again.pausedAllBy() }), "Paused since today 15:00: 1 routine, nothing starts by itself until you resume");
  });
});

describe("the guide, and a coding agent's call", () => {
  test("the routine topic gives pause, Run now and Pause all; a coding agent pauses one as Filament's loop does", async () => {
    const g = /** @type {any} */ (spaceGuide("routine")).text;
    assert.ok(g.includes('{"action":"routine","with":{"id":"r4","pause":"CI is red on main; each run would fail"}}: paused, with your line on why'), g);
    assert.ok(g.includes('- {"action":"routine","with":{"id":"r4","run":true}}: Run now'), g);
    assert.ok(g.includes('{"action":"routine","with":{"pauseAll":"the deploy key leaked; nothing should run until it is rotated"}}: Pause all'), g);
    const w = worldOf();
    const tools = createAgentTools(/** @type {any} */ ({
      memory: null, memoryToolsOn: () => false, graphs: () => null, turns: { get: () => null }, subagents: () => null, membersOf: () => null,
      space: { store: w.spaces, projectOf: () => "p1", nameOf: (/** @type {string} */ c) => NAMES[c] || c, on: () => true, routines: { runNow: w.routines.runNow, arm: () => {} }, runOf: () => null },
    }));
    const r = await tools.call("space", call({ id: "r1", pause: "CI is red" }), /** @type {any} */ ({ cwd: "/r", chain: "c2", permit: null }));
    assert.equal(r.isError, undefined, r.text);
    assert.equal(w.r1().pausedBy?.byName, "Deploy fixer");
    const ran = await tools.call("space", call({ id: "r1", run: true }), /** @type {any} */ ({ cwd: "/r", chain: "c2", permit: null }));
    assert.equal(ran.text, "Not run: “Morning brief” is paused, by you: CI is red. Resuming it is the person's; their Run now runs it still.");
  });
});
