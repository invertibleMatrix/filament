// @ts-check
// HarnessV4_Space_Plan S6, the mock's screen 11: routines — what an agent of a project does by itself at a time the
// person switched on. A `when` read and said, its next time, the times missed; a routine's fields and its row's words
// (core); the store's routines — proposed by a chat, changed by it alone, switched on, paused, removed and put back, a
// run's start and end, a skip, Pause all kept across a restart —; the agents' space tool's `routine` and its read; the
// runner — a run at its time as a new chat, read-only or in a worktree, its end read from its chat, a time skipped while
// its last run runs or Pause all is on, the times missed while Filament was off —; and end to end: a chat's agent
// proposes one, the person switches it on and runs it.
// (fails before: yes — there were no routines)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EVERY_MIN_MS,
  ROUTINE_LIMITS,
  WHEN_FORM,
  atWords,
  firstLine,
  headWords,
  missedTimes,
  nextAt,
  nextOf,
  routineFields,
  routinesWords,
  rowWords,
  runBranch,
  runTitle,
  runWords,
  scheduleOf,
  tookWords,
  whenWords,
} from "../src/core/routines.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { SPACE_TOOL, spaceCall } from "../src/app/agent/space.js";
import { createRoutines } from "../src/app/routines.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { removeDirs, until } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
/** A folder of the test's own. @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-space-routines-${tag}-`));
  made.push(d);
  return d;
};

/** A moment of a day of 26–30 October 2026, local: Monday 26 is day 0. @param {number} day @param {number} h @param {number} [m] */
const at = (day, h, m = 0) => new Date(2026, 9, 26 + day, h, m).getTime();
const MON = 0;
const TUE = 1;
const WED = 2;
const THU = 3;
/** @param {string} when */
const sched = (when) => {
  const s = scheduleOf(when);
  assert.ok(s.ok, JSON.stringify(s));
  return s.s;
};
/** A routine as the store keeps one. @param {any} [o] @returns {import("../src/core/routines.js").Routine} */
const routine = (o = {}) => ({
  id: "r1",
  title: "Morning brief",
  when: "weekdays 09:00",
  task: "Read the open PRs and CI; say what needs the person.",
  writes: false,
  state: "on",
  paused: false,
  madeIn: "c1",
  madeBy: "Release",
  model: "agent/brain-model",
  at: at(MON, 8),
  onAt: at(MON, 8),
  upTo: null,
  last: null,
  skipped: null,
  ...o,
});
const FIELDS = { title: "Morning brief", when: "weekdays 09:00", task: "Read the open PRs and CI; say what needs the person.", writes: false };

describe("a routine's when, its times and its words (core)", () => {
  test("scheduleOf: a day and a time — weekdays, daily, days by name, weekends — or an every of 15 min to a day; each refusal in words", () => {
    assert.deepEqual(sched("weekdays 09:00"), { kind: "at", days: [1, 2, 3, 4, 5], at: 540 });
    assert.deepEqual(sched("Daily at 18:30"), { kind: "at", days: [0, 1, 2, 3, 4, 5, 6], at: 1110 });
    assert.deepEqual(sched("mon,thu 08:00"), { kind: "at", days: [1, 4], at: 480 });
    assert.deepEqual(sched("Thursdays and mon 8:00"), { kind: "at", days: [1, 4], at: 480 });
    assert.deepEqual(sched("Fridays 16:00"), { kind: "at", days: [5], at: 960 });
    assert.deepEqual(sched("weekends 10:15"), { kind: "at", days: [0, 6], at: 615 });
    assert.deepEqual(sched("07:05"), { kind: "at", days: [0, 1, 2, 3, 4, 5, 6], at: 425 }, "a time alone is daily");
    assert.deepEqual(sched("every 30m"), { kind: "every", ms: 1_800_000 });
    assert.deepEqual(sched("every 2 hours"), { kind: "every", ms: 7_200_000 });
    assert.equal(EVERY_MIN_MS, 900_000);
    /** @param {string} w */
    const no = (w) => {
      const s = scheduleOf(w);
      assert.equal(s.ok, false, w);
      return s.ok ? "" : s.error;
    };
    assert.equal(no(""), `has no when: ${WHEN_FORM}`);
    assert.equal(no("every 5m"), "runs every 5 min: every 15 min at least — a routine is an agent's work");
    assert.equal(no("every 30h"), 'runs every 30 h: a day at most; a day and a time say more ("daily 09:00")');
    assert.equal(no("someday 09:00"), `has "someday" for a day: ${WHEN_FORM}`);
    assert.equal(no("daily 25:00"), "has the time 25:00: a time of day, 00:00 to 23:59");
    assert.equal(no("at noon"), `has the when "at noon": ${WHEN_FORM}`);
    assert.equal(no("x".repeat(61)), `has a when of 61 characters: ${WHEN_FORM}`);
  });

  test("whenWords: as a row says it", () => {
    assert.deepEqual(
      ["weekdays 09:00", "mon,thu 08:00", "daily 18:30", "weekends 10:00", "mon,wed,fri 07:05", "every 30m", "every 2h", "every 90m"].map((w) => whenWords(sched(w))),
      ["weekdays at 09:00", "Mondays and Thursdays at 08:00", "daily at 18:30", "weekends at 10:00", "Mondays, Wednesdays and Fridays at 07:05", "every 30 min", "every 2 h", "every 1 h 30 min"],
    );
  });

  test("nextAt: the first time after a moment — a weekend passed over —; an every counts from the moment it was switched on", () => {
    const wd = sched("weekdays 09:00");
    assert.equal(nextAt(wd, at(MON, 8)), at(MON, 9));
    assert.equal(nextAt(wd, at(MON, 9)), at(TUE, 9), "the time itself is past");
    assert.equal(nextAt(wd, at(4, 10)), at(7, 9), "Friday after nine: Monday");
    const every = sched("every 30m");
    assert.equal(nextAt(every, at(MON, 9), at(MON, 8, 10)), at(MON, 9, 10));
  });

  test("missedTimes: the newest time missed — today's runs once, an earlier day's is said —; an every's on its own grid", () => {
    const wd = sched("weekdays 09:00");
    assert.deepEqual(missedTimes(wd, at(-3, 12), at(MON, 10)), { today: at(MON, 9), earlier: null }, "Friday noon to Monday ten: Monday's");
    assert.deepEqual(missedTimes(wd, at(-3, 8), at(-1, 12)), { today: null, earlier: at(-3, 9) }, "Friday eight to Sunday noon: Friday's, said missed");
    assert.deepEqual(missedTimes(wd, at(MON, 9), at(MON, 10)), { today: null, earlier: null });
    const every = sched("every 30m");
    assert.deepEqual(missedTimes(every, at(MON, 8, 40), at(MON, 10), at(MON, 8, 10)), { today: at(MON, 9, 40), earlier: null });
    assert.deepEqual(missedTimes(every, at(MON, 9, 40), at(MON, 10), at(MON, 8, 10)), { today: null, earlier: null });
  });

  test("routineFields: a new one needs a title, a when that reads and its words, and reads only unless it says; a change takes what it gives", () => {
    assert.deepEqual(routineFields({ title: "  Morning   brief ", when: " Weekdays  09:00 ", text: "Read the PRs.\n\n\n\nSay what waits." }, { create: true }), {
      ok: true,
      fields: { title: "Morning brief", when: "weekdays 09:00", task: "Read the PRs.\n\nSay what waits.", writes: false },
    });
    /** @param {any} input @param {boolean} [create] */
    const no = (input, create = true) => {
      const f = routineFields(input, { create });
      assert.equal(f.ok, false, JSON.stringify(input));
      return f.ok ? "" : f.error;
    };
    assert.equal(no(null), "a routine is a JSON object: { title, when, text, writes?, acts? }, or a watcher's: { title, trigger, text, wakes?, writes?, acts?, guides? }");
    assert.equal(no({ when: "daily 09:00", text: "x" }), 'a routine needs a title: what it is, in a few words ("Morning brief")');
    assert.equal(no({ title: "x".repeat(81), when: "daily 09:00", text: "x" }), `a routine's title is ${ROUTINE_LIMITS.title} characters at most; this one is 81`);
    assert.equal(no({ title: "B", when: "every 5m", text: "x" }), "this routine runs every 5 min: every 15 min at least — a routine is an agent's work");
    assert.equal(no({ title: "B", when: "daily 09:00", text: " " }), "a routine needs its words (text): what the agent does at each run");
    assert.equal(no({ title: "B", when: "daily 09:00", text: "x".repeat(4001) }), "a routine's words are 4000 characters at most; these are 4001");
    assert.equal(no({ title: "B", when: "daily 09:00", text: "x", writes: "yes" }), "writes is true or false: true runs it in a worktree of its own");
    assert.equal(no({}, false), "say what changes: title, when or trigger, text, writes, acts, wakes or guides");
    assert.deepEqual(routineFields({ when: "daily 08:00", writes: true }, { create: false }), { ok: true, fields: { when: "daily 08:00", writes: true } });
  });

  test("nextOf: a routine on and not paused has a next time, the first after the newest it handled", () => {
    assert.equal(nextOf(routine()), at(MON, 9));
    assert.equal(nextOf(routine({ upTo: at(MON, 9) })), at(TUE, 9));
    assert.equal(nextOf(routine({ paused: true })), null);
    assert.equal(nextOf(routine({ state: "proposed", onAt: null })), null);
    assert.equal(nextOf(routine({ when: "every 30m", onAt: at(MON, 8, 10), upTo: at(MON, 8, 40) })), at(MON, 9, 10));
  });

  test("a row's words: when and what it may do, its run under way or its last, a time it skipped or missed, its next time", () => {
    const now = at(MON, 8, 30);
    // What each press does is pinned with a watcher's, in watch-ui.test.js; a routine at times has none of a watcher's
    // parts (`watches`, `wakes`, `told`, `guides`, `heard`), and "not now" where it has no next time.
    const { press, ...words } = rowWords(routine(), { now });
    assert.deepEqual(words, {
      when: "weekdays at 09:00",
      may: "reads only",
      allowed: "Reads only: it changes no file and sends nothing; it may write drafts and lines in What happened",
      watches: null,
      wakes: null,
      told: "",
      guides: null,
      last: "",
      lastParts: null,
      heard: "",
      reviewed: "",
      tone: "",
      said: "",
      ran: "",
      why: "",
      skipped: "",
      next: "next: today 09:00",
      idle: "not now",
      nextAt: at(MON, 9),
      first: "today 09:00",
    });
    assert.equal(press.run, "Once, now: a new chat, as at its time");
    const running = routine({ upTo: at(MON, 9), last: { at: at(MON, 9), chain: "c9", by: "time", state: "running" } });
    const w = rowWords(running, { now: at(MON, 9, 5), live: { busy: true, asking: false } });
    assert.deepEqual([w.last, w.tone, w.next], ["now: running since today 09:00", "works", "next: tomorrow 09:00"]);
    const asks = rowWords(running, { now: at(MON, 9, 5), live: { busy: false, asking: true } });
    assert.deepEqual([asks.last, asks.tone], ["now: waits for you · since today 09:00", "asks"]);
    const done = routine({ last: { at: at(MON, 9), chain: "c9", by: "time", state: "done", ended: at(MON, 9) + 41_000, said: "3 PRs wait for you" } });
    assert.deepEqual([rowWords(done, { now }).last, rowWords(done, { now }).said], ["last: today 09:00 · done in 41 s", "3 PRs wait for you"]);
    const failed = routine({ writes: true, last: { at: at(MON, 9), chain: "", by: "you", state: "failed", ended: at(MON, 9), why: "GitHub · work: sign-in expired" } });
    assert.deepEqual([rowWords(failed, { now }).last, rowWords(failed, { now }).tone, rowWords(failed, { now }).may], ["last: today 09:00 (Run now) · failed: GitHub · work: sign-in expired", "bad", "in a lane of its own"]);
    const skipped = routine({ last: { at: at(MON, 8), chain: "c8", by: "time", state: "running" }, skipped: { at: at(MON, 9), why: "the 08:00 run was still under way" } });
    assert.equal(rowWords(skipped, { now: at(MON, 9, 1) }).skipped, "today 09:00 skipped: the 08:00 run was still under way");
    const missed = routine({ skipped: { at: at(-3, 9), why: "Filament was off", missed: true } });
    assert.equal(rowWords(missed, { now }).skipped, "missed Fri 09:00: Filament was off");
    assert.equal(rowWords(routine({ paused: true }), { now }).next, "paused: it runs when you resume it");
    assert.equal(rowWords(routine(), { now, pausedSince: at(MON, 8) }).next, "Pause all is on: nothing starts by itself");
    assert.equal(rowWords(routine({ state: "proposed", onAt: null }), { now }).next, "");
    assert.equal(atWords(at(-1, 18, 30), now), "yesterday 18:30");
    assert.deepEqual([tookWords(41_000), tookWords(185_000), tookWords(3_900_000)], ["41 s", "3 min", "1 h 5 min"]);
  });

  test("the head of what runs by itself: how many, and the soonest; Pause all says since when; nothing, nothing", () => {
    const now = at(MON, 8, 30);
    const on = [{ title: "Morning brief", nextAt: at(MON, 9) }];
    const watches = [{ title: "a watch of Deploys", nextAt: at(MON, 8, 40) }, { title: "a watch of Issues", nextAt: null }];
    assert.equal(headWords(on, watches, { now }), "Runs by itself: 1 routine and 2 watches · next: a watch of Deploys at 08:40");
    assert.equal(headWords(on, [], { now, pausedSince: at(MON, 8) }), "Paused since today 08:00: 1 routine, nothing starts by itself until you resume");
    assert.equal(headWords([], [], { now }), "");
  });

  // (fails before: yes — the guide's Routines paragraph quoted the sheet, the row and the head in words they do not say:
  // "Writes in a lane of its own, made at each run", "Writes in its Space's own folder, which is no git repository",
  // "now: running since 09:00" and "Paused since 14:20")
  test("the guide's Routines paragraph quotes what a routine that writes may do, its run under way and Pause all's head as Filament says them", () => {
    const guide = readFileSync("docs/GUIDE.md", "utf8").replace(/\r?\n/g, " ");
    const para = guide.slice(guide.indexOf("**Routines.** "), guide.indexOf("**Watchers.** "));
    assert.ok(para.length > 2000, "the paragraph is read");
    const writes = routine({ writes: true });
    const running = routine({ upTo: at(MON, 9), last: { at: at(MON, 9), chain: "c9", by: "time", state: "running" } });
    const said = [
      rowWords(routine(), { now: at(MON, 8, 30) }).allowed,
      rowWords(writes, { now: at(MON, 8, 30) }).allowed,
      rowWords(writes, { now: at(MON, 8, 30), inPlace: true }).allowed,
      rowWords(running, { now: at(MON, 9, 5), live: { busy: true, asking: false } }).last,
      headWords([{ title: "Morning brief", nextAt: null }], [], { now: at(MON, 14, 30), pausedSince: at(MON, 14, 20) }),
    ];
    assert.deepEqual(said, [
      "Reads only: it changes no file and sends nothing; it may write drafts and lines in What happened",
      "Writes in a lane of its own, a worktree made for each run: what it changed waits there for you, like any lane's",
      "Writes in its Space's folder, which is no git repository: what it changes is there at once, with no lane to look at first",
      "now: running since today 09:00",
      "Paused since today 14:20: 1 routine, nothing starts by itself until you resume",
    ]);
    assert.deepEqual(said.filter((s) => !para.includes(s)), [], "each is in the guide, word for word");
  });

  test("a run's words: what it is, why now, what it may do, then the routine's own; its chat's title; its branch; its first line", () => {
    const r = routine();
    assert.equal(
      runWords(r, { project: "app", when: "weekdays at 09:00", by: "time" }),
      "This is “Morning brief”, a routine of app's Space, run at its time (weekdays at 09:00): a chat of its own. You read only: change no file, and send nothing. What the person should see goes in your answer; anything that would go out is a draft (the space tool's draft), which only the person sends.\n\nRead the open PRs and CI; say what needs the person.",
    );
    assert.match(runWords({ ...r, writes: true }, { project: "app", when: "x", by: "you" }), /^This is “Morning brief”, a routine of app's Space, run now, as the person pressed Run now: a chat of its own\. You work in a git worktree of your own, made for this run: what you change waits there for the person, as any lane's does\. Push, deploy and send nothing\.\n\n/);
    assert.equal(runTitle("Morning brief", at(MON, 9)), "Morning brief · Mon 26 Oct");
    assert.equal(runBranch("Upkeep: deps & tests!", at(MON, 9)), "routine-upkeep-deps-tests-1026");
    assert.equal(runBranch("—", at(MON, 9)), "routine-run-1026");
    assert.equal(firstLine("## Brief\n\n- 3 PRs wait for you\n"), "Brief");
    assert.equal(firstLine(`${"x".repeat(250)}`).length, 200);
  });

  test("the agents' read of the routines: each with its id, whose, when, what it may do and how it stands", () => {
    const rows = [
      routine({ last: { at: at(MON, 9), chain: "c9", by: "time", state: "failed", why: "sign-in expired" } }),
      routine({ id: "r2", title: "Upkeep", when: "tue 08:00", writes: true, state: "proposed", onAt: null, madeIn: "c2", madeBy: "Deps" }),
      routine({ id: "r3", state: "removed", was: "on" }),
    ];
    assert.equal(
      routinesWords(rows, { nameOf: (c) => c, now: at(MON, 10), self: "c1" }),
      [
        "Routines: each runs by itself only once the person switched it on. One of yours is changed with its id.",
        '- r1 "Morning brief" (yours), weekdays at 09:00, reads only: on · last run today 09:00: failed (sign-in expired)',
        '- r2 "Upkeep" (by Deps), Tuesdays at 08:00, writes in a worktree of its own: proposed: it waits for the person\'s Switch on',
      ].join("\n"),
    );
    assert.equal(routinesWords([rows[2]], { nameOf: (c) => c, now: 0 }), "");
  });
});

describe("the store's routines", () => {
  test("proposed by a chat with its line; changed by that chat alone — one on goes back to Proposed —; switched on, paused, resumed, removed and put back, each said", () => {
    const clock = { at: at(MON, 8) };
    const store = createSpaceStore({ dir: null, now: () => clock.at });
    const by = { chain: "c1", byName: "Release", model: "agent/brain-model" };
    const r = store.routinePropose("p1", FIELDS, by);
    assert.deepEqual([r.id, r.state, r.madeIn, r.madeBy, r.model, r.onAt], ["r1", "proposed", "c1", "Release", "agent/brain-model", null]);
    const line = () => store.get("p1").log.at(-1);
    assert.deepEqual([line()?.by, line()?.text], [{ kind: "agent", chain: "c1" }, "Proposed a routine: “Morning brief”, weekdays at 09:00, reading only. It runs only once you switch it on, in Routines."]);
    /** @param {() => unknown} fn */
    const refusal = (fn) => {
      try {
        fn();
      } catch (/** @type {any} */ e) {
        return [e.status, e.message];
      }
      return null;
    };
    assert.deepEqual(refusal(() => store.routinePropose("p1", { when: "daily 08:00" }, { chain: "c2", byName: "Other", model: "" }, "r1")), [409, "r1 is Release's routine: propose one of your own."]);
    assert.deepEqual(refusal(() => store.routinePropose("p1", { when: "daily 08:00" }, by, "r9")), [404, 'There is no routine "r9" in this Space: its read lists them with their ids.']);
    assert.deepEqual(refusal(() => store.routinePause("p1", "r1", true)), [409, "“Morning brief” is not on: switch it on first."]);
    clock.at = at(MON, 8, 5);
    store.routineOn("p1", "r1");
    assert.deepEqual([store.get("p1").routines[0].state, store.get("p1").routines[0].onAt, line()?.by, line()?.text], ["on", at(MON, 8, 5), { kind: "filament" }, "You switched on “Morning brief”: weekdays at 09:00, reading only."]);
    assert.deepEqual(refusal(() => store.routineOn("p1", "r1")), [409, "“Morning brief” is on already."]);
    // What runs by itself is what you switched on (S6-D3).
    store.routinePropose("p1", { when: "daily 07:30" }, by, "r1");
    assert.deepEqual([store.get("p1").routines[0].state, store.get("p1").routines[0].when, store.get("p1").routines[0].onAt, line()?.text], ["proposed", "daily 07:30", null, "Changed the routine “Morning brief”: it is off until you switch it on again, in Routines."]);
    store.routinePropose("p1", { title: "Morning brief, short" }, by, "r1");
    assert.equal(line()?.text, "Changed its proposed routine “Morning brief, short”: daily at 07:30.");
    store.routineOn("p1", "r1");
    store.routinePause("p1", "r1", true);
    assert.equal(line()?.text, "You paused the routine “Morning brief, short”: it runs no more until you resume it.");
    clock.at = at(MON, 11);
    store.routinePause("p1", "r1", false);
    assert.deepEqual([store.get("p1").routines[0].paused, store.get("p1").routines[0].upTo, line()?.text], [false, at(MON, 11), "You resumed the routine “Morning brief, short”: daily at 07:30."]);
    store.routineRemove("p1", "r1");
    assert.deepEqual([store.get("p1").routines[0].state, store.get("p1").routines[0].was, line()?.text], ["removed", "on", "You removed the routine “Morning brief, short”: nothing of it runs. Add to this Space… puts it back."]);
    assert.deepEqual(refusal(() => store.routinePropose("p1", { when: "daily 08:00" }, by, "r1")), [409, "r1 was removed by the person: propose a new one if it is still wanted."]);
    clock.at = at(MON, 12);
    store.routineBack("p1", "r1");
    assert.deepEqual([store.get("p1").routines[0].state, store.get("p1").routines[0].upTo, line()?.text], ["on", at(MON, 12), "You put the routine “Morning brief, short” back: on, as it was."]);
    assert.deepEqual(refusal(() => store.routineBack("p1", "r1")), [409, "“Morning brief, short” is not removed."]);
    assert.equal(store.extended(clock.at), true, "Your Space shows once a Space has a routine");
  });

  // The owner's word of 10-31: the agents, and the models they run on, are the person's. A routine runs on its chat's
  // model as it proposed it until the person chooses one; theirs is said, kept in its file, and kept by a change of
  // its chat — which before took the chat's model now.
  // (fails before: yes — the person could not choose the model a routine runs on)
  test("the model it runs on, the person's to choose: said in What happened, kept in its file, kept by its chat's change; one removed is refused", () => {
    const clock = { at: at(MON, 8) };
    const dir = fresh("model");
    const store = createSpaceStore({ dir, now: () => clock.at });
    const by = { chain: "c1", byName: "Release", model: "agent/brain-model" };
    store.routinePropose("p1", FIELDS, by);
    const r = () => store.get("p1").routines[0];
    assert.deepEqual([r().model, r().modelBy], ["agent/brain-model", undefined], "its chat's, as it proposed it");
    store.routinePropose("p1", { when: "daily 07:30" }, { ...by, model: "agent/brain-new" }, "r1");
    assert.equal(r().model, "agent/brain-new", "none chosen yet: its chat's change brings its model now");
    store.routineOn("p1", "r1");
    store.routineModel("p1", "r1", "agent/brain-pick");
    const line = () => store.get("p1").log.at(-1);
    assert.deepEqual([r().model, r().modelBy, r().state, line()?.text], ["agent/brain-pick", "you", "on", "You chose the model “Morning brief” runs on: agent/brain-pick."], "on, as it was");
    store.routinePropose("p1", { when: "daily 08:00" }, { ...by, model: "agent/brain-other" }, "r1");
    assert.deepEqual([r().model, r().when], ["agent/brain-pick", "daily 08:00"], "its chat's change keeps the person's model");
    store.routineModel("p1", "r1", "");
    assert.deepEqual([r().model, r().modelBy, line()?.text], ["", "you", "You chose the model “Morning brief” runs on: this Space's model."], "\"\" follows the Space's model (11-04)");
    const lines = store.get("p1").log.length;
    store.routineModel("p1", "r1", "");
    assert.equal(store.get("p1").log.length, lines, "the same again says nothing");
    const again = createSpaceStore({ dir, now: () => clock.at }).get("p1").routines[0];
    assert.deepEqual([again.model, again.modelBy], ["", "you"], "kept in its file");
    store.routineRemove("p1", "r1");
    assert.throws(() => store.routineModel("p1", "r1", "m"), { status: 409, message: "“Morning brief” was removed: put it back first." });
  });

  test("a run's start and end: what it said in What happened; a failure once in Needs you, the newest's words, gone once a run ends well; a stale end let be; a skip on its row", () => {
    const clock = { at: at(MON, 9) };
    const store = createSpaceStore({ dir: null, now: () => clock.at });
    store.routinePropose("p1", FIELDS, { chain: "c1", byName: "Release", model: "m" });
    store.routineOn("p1", "r1");
    store.routineStarted("p1", "r1", { at: at(MON, 9), chain: "run1", by: "time" });
    assert.deepEqual([store.get("p1").routines[0].last, store.get("p1").routines[0].upTo], [{ at: at(MON, 9), chain: "run1", by: "time", state: "running" }, at(MON, 9)]);
    clock.at = at(MON, 9) + 41_000;
    assert.equal(store.routineEnded("p1", "r1", { at: at(MON, 9), chain: "other", by: "time", state: "done", said: "x" }), null, "not its newest run");
    store.routineEnded("p1", "r1", { at: at(MON, 9), chain: "run1", by: "time", state: "done", said: "3 PRs wait for you" });
    const log = store.get("p1").log.at(-1);
    assert.deepEqual([log?.by, log?.text], [{ kind: "filament", chain: "run1" }, "“Morning brief” ran (09:00, 41 s): 3 PRs wait for you"]);
    assert.deepEqual(store.get("p1").routines[0].last, { at: at(MON, 9), chain: "run1", by: "time", state: "done", ended: at(MON, 9) + 41_000, said: "3 PRs wait for you" });
    // Failed twice: one row, the newest's words (S6-D10).
    clock.at = at(TUE, 9, 1);
    store.routineStarted("p1", "r1", { at: at(TUE, 9), chain: "run2", by: "time" });
    store.routineEnded("p1", "r1", { at: at(TUE, 9), chain: "run2", by: "time", state: "failed", why: "GitHub · work: sign-in expired" });
    clock.at = at(WED, 10);
    store.routineEnded("p1", "r1", { at: at(WED, 10), chain: "", by: "you", state: "failed", why: "its chat could not be made: no model" });
    const rows = store.get("p1").needs.filter((n) => n.kind === "routine");
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].text, rows[0].why, rows[0].dashboard, rows[0].title, rows[0].routine], ["“Morning brief” failed: its chat could not be made: no model", "a routine of this Space, run by your Run now at 10:00", "", "Morning brief", { id: "r1", chain: "" }]);
    assert.ok(store.get("p1").log.some((e) => e.text === "“Morning brief” failed (09:00): GitHub · work: sign-in expired"));
    assert.equal(store.needCounts(clock.at).p1, 1, "the left bar counts it");
    clock.at = at(THU, 9, 1);
    store.routineStarted("p1", "r1", { at: at(THU, 9), chain: "run3", by: "time" });
    store.routineEnded("p1", "r1", { at: at(THU, 9), chain: "run3", by: "time", state: "stopped" });
    assert.equal(store.get("p1").log.at(-1)?.text, "“Morning brief”'s run (09:00) was stopped before it ended.");
    assert.equal(store.get("p1").needs.filter((n) => n.kind === "routine" && n.state === "open").length, 1, "a stop is no failure, nor an end that went well");
    store.routineStarted("p1", "r1", { at: at(4, 9), chain: "run4", by: "time" });
    store.routineEnded("p1", "r1", { at: at(4, 9), chain: "run4", by: "time", state: "done", said: "" });
    assert.equal(store.get("p1").needs.filter((n) => n.kind === "routine" && n.state === "open").length, 0, "a run that ends well takes the row away");
    assert.equal(store.get("p1").log.at(-1)?.text.endsWith(": it said nothing"), true);
    store.routineSkipped("p1", "r1", { at: at(7, 9), why: "Pause all was on" });
    assert.deepEqual([store.get("p1").routines[0].skipped, store.get("p1").routines[0].upTo], [{ at: at(7, 9), why: "Pause all was on" }, at(7, 9)]);
  });

  test("kept in its file: read back as it was; one on with no moment is Proposed again; one that does not read is dropped; Pause all kept across a restart; at most 40", () => {
    const dir = fresh("store");
    /** @type {any[]} */
    const heard = [];
    const store = createSpaceStore({ dir, now: () => 1000, events: { publish: (_t, p) => void heard.push(p) } });
    store.routinePropose("p1", FIELDS, { chain: "c1", byName: "Release", model: "m" });
    store.routineOn("p1", "r1");
    store.routineSkipped("p1", "r1", { at: 900, why: "Filament was off", missed: true });
    assert.deepEqual(createSpaceStore({ dir, now: () => 1000 }).get("p1").routines, store.get("p1").routines);
    const file = join(dir, "p1.json");
    const doc = JSON.parse(readFileSync(file, "utf8"));
    doc.routines.push({ ...doc.routines[0], id: "r8", onAt: null });
    doc.routines.push({ id: "r9", title: "Broken" });
    doc.routines.push({ ...doc.routines[0], id: "r10", state: "removed", was: "on" });
    writeFileSync(file, JSON.stringify(doc));
    const back = createSpaceStore({ dir, now: () => 1000 }).get("p1").routines;
    assert.deepEqual(back.map((r) => [r.id, r.state, r.was ?? "-"]), [["r1", "on", "-"], ["r8", "proposed", "-"], ["r10", "removed", "on"]]);
    assert.equal(store.pausedSince(), null);
    assert.equal(store.pauseAll(true), 1000);
    assert.deepEqual(heard.at(-1), { type: "space", project: "*", seq: 0 });
    assert.equal(createSpaceStore({ dir, now: () => 2000 }).pausedSince(), 1000, "kept across a restart");
    assert.equal(store.pauseAll(true), 1000, "on already: its moment stays");
    assert.equal(store.pauseAll(false), null);
    assert.equal(createSpaceStore({ dir, now: () => 2000 }).pausedSince(), null);
    assert.ok(!store.routinesAll().some((x) => x.project.startsWith("_")), "Pause all's file is no project's Space");
    const many = createSpaceStore({ dir: null, now: () => 1 });
    for (let i = 0; i < ROUTINE_LIMITS.routines; i++) many.routinePropose("p1", { ...FIELDS, title: `R${i}` }, { chain: "c1", byName: "x", model: "" });
    assert.throws(() => many.routinePropose("p1", FIELDS, { chain: "c1", byName: "x", model: "" }), { status: 409, message: "this Space holds 40 routines: the person removes one before another is proposed" });
  });
});

describe("the agents' space tool: routine", () => {
  test("proposes one, which waits for the person's Switch on; refused in words; changed by its id; its read lists the routines", () => {
    const store = createSpaceStore({ dir: null, now: () => at(MON, 8) });
    const where = { store, project: "p1", chain: "c1", name: null, nameOf: (/** @type {string} */ c) => (c === "c1" ? "Release" : "Other"), modelOf: () => "agent/brain-model" };
    const r = spaceCall({ action: "routine", title: "Morning brief", when: "weekdays 09:00", text: "Read the open PRs and CI; say what needs the person." }, where, at(MON, 8));
    assert.deepEqual(r, { ok: true, text: 'Routine r1 "Morning brief" (weekdays at 09:00, reading only) waits for the person\'s Switch on, on the card under this call and in the Space\'s Routines: nothing runs until they press it. Each run is a new chat of this project, its first message your text. It runs on agent/brain-model, the model you run on now, until the person chooses another on its sheet.', event: { type: "routine", project: "p1", routine: "r1", watcher: false, change: false, at: at(MON, 8) } });
    assert.deepEqual([store.get("p1").routines[0].model, store.get("p1").routines[0].madeBy], ["agent/brain-model", "Release"]);
    // With a model for the Space's agents (11-04), its runs start on that one, and the agent is told so.
    store.setDefaults({ model: "agent/space-model", effort: "high" });
    const second = spaceCall({ action: "routine", title: "Evening brief", when: "weekdays 18:00", text: "Say what is left for tomorrow." }, where, at(MON, 8));
    assert.ok(second.ok && second.text.endsWith("It runs on agent/space-model at high effort, the model the person set for this Space's agents."), JSON.stringify(second));
    store.setDefaults({ model: "" });
    assert.deepEqual(spaceCall({ action: "routine", title: "B", when: "every 5m", text: "x" }, where), { ok: false, error: 'Not written: this routine runs every 5 min: every 15 min at least — a routine is an agent\'s work. The call: {"action":"routine","with":{"title":"Morning brief","when":"weekdays 09:00","text":"Read the open PRs and CI; say what needs the person."}} — {"action":"guide","topic":"routine"} gives every field.' });
    store.routineOn("p1", "r1");
    const changed = spaceCall({ action: "routine", id: "r1", writes: true }, where);
    assert.ok(changed.ok && changed.text.includes("is changed and waits") && changed.text.includes("It was on: it is off now, until the person switches it on again."), JSON.stringify(changed));
    assert.deepEqual(spaceCall({ action: "routine", id: "r1", when: "daily 08:00" }, { ...where, chain: "c2" }), { ok: false, error: "r1 is Release's routine: propose one of your own." });
    const read = spaceCall({ action: "read" }, where, at(MON, 8));
    assert.ok(read.ok && read.text.includes('- r1 "Morning brief" (yours), weekdays at 09:00, writes in a worktree of its own: proposed: it waits for the person\'s Switch on'), read.ok ? read.text : read.error);
  });

  // What every project chat's request pays (case 20): since E39 the door names routine in a few words, and its guide
  // gives the rest — the forms of `when`, `writes`, a change by its id — only when an agent asks.
  test("the door names routine in a few words; its guide gives it whole (case 20, E39)", () => {
    const words = SPACE_TOOL.description;
    // Since the tool plan the door names it among the guided actions, and the guide's index says it in a few words.
    assert.match(words, /whose fields go in with: [\w, ]*\broutine\b[\w, ]*;/);
    assert.deepEqual(Object.keys(SPACE_TOOL.input_schema.properties).filter((k) => k === "when" || k === "writes"), [], "its fields ride `with`");
    assert.equal((words.match(/daily 18:30/g) || []).length, 0, "when's forms: in the guide");
    const index = /** @type {any} */ (spaceCall({ action: "guide" }, { store: createSpaceStore({ dir: null }), project: "p1", chain: "c1", name: null, nameOf: String })).text;
    assert.match(index, /\n- routine: work an agent does by itself at a time/);
    const guide = /** @type {any} */ (spaceCall({ action: "guide", topic: "routine" }, { store: createSpaceStore({ dir: null }), project: "p1", chain: "c1", name: null, nameOf: String })).text;
    assert.match(guide, /- when: "weekdays 09:00", "daily 18:30", "mon,thu 08:00", "every 2h" — this machine's clock; every 15 min at least\./);
    assert.match(guide, /- writes: true runs it in a worktree of its own \(in a Space of the person's own whose folder is no git repository, in that folder itself\);/);
    assert.match(guide, /- acts: the connections' tools that change things its runs may call without asking — archive, label, move an issue —, by their full names .* Never one that sends to people: a send stays a draft\./);
    assert.match(guide, /Nothing runs until the person presses Switch on/);
    // Proposed right in the chat (the owner's of 11-12): the guide says where the person presses it — the card under the
    // call first, the Space's pages beside it. (fails before: yes — it named the Space's pages alone)
    assert.match(guide, /presses Switch on — on the card Filament draws under your call in the chat, or in the Space's Routines or Watchers —/);
  });
});

/**
 * A world for the runner: a Space store on a clock, and stand-ins for the sessions, the turns and the worktrees — each
 * chat made counted, its facts set by the test.
 */
function worldOf() {
  const clock = { at: at(MON, 8) };
  const now = () => clock.at;
  const spaces = createSpaceStore({ dir: null, now });
  /** @type {any[]} */
  const created = [];
  /** @type {[string, any][]} */
  const posted = [];
  /** @type {[string, any][]} */
  const marked = [];
  /** @type {string[]} */
  const removed = [];
  /** @type {any[]} */
  const owned = [];
  /** @type {any[]} */
  const templated = [];
  /** What a failed start undid, in its order. @type {string[]} */
  const order = [];
  /** Each chat's facts, as the test sets them. @type {Map<string, any>} */
  const facts = new Map();
  let n = 0;
  const post = { status: 200, body: /** @type {any} */ (null) };
  /** @type {{ next: any }} */
  const own = { next: { ok: true, name: "routine-upkeep-1026", branch: "routine-upkeep-1026", folder: "/work/app-routine-upkeep-1026", cwd: "/work/app-routine-upkeep-1026", main: "/work/app", place: "/work/app" } };
  const routines = createRoutines({
    spaces,
    sessions: {
      create: (o) => {
        created.push(o);
        const id = `run${++n}`;
        facts.set(id, { busy: true, asking: false, last: null });
        return { id };
      },
      besideFacts: (id) => {
        const f = facts.get(id);
        if (!f) throw new Error("no such session");
        return f;
      },
    },
    mark: (id, m) => void marked.push([id, m]),
    postTurn: async (id, b) => (posted.push([id, b]), post),
    folderOf: (p) => (p === "p1" ? "/work/app" : null),
    places: {
      own: async (cwd, name) => (owned.push([cwd, name]), own.next),
      takeBack: async (m) => (order.push(`takeBack ${m.folder}`), null),
      template: (id, m) => void templated.push([id, m.folder]),
      untemplate: async (id, why) => void order.push(`untemplate ${id}: ${why}`),
    },
    remove: async (id) => (removed.push(id), order.push(`remove ${id}`)),
    nameOf: (p) => (p === "p1" ? "app" : p),
    now,
  });
  /** A routine proposed and switched on at the clock's moment. @param {any} [o] */
  const switchedOn = (o = {}) => {
    const r = spaces.routinePropose("p1", { ...FIELDS, ...o }, { chain: "c1", byName: "Release", model: "agent/brain-model" });
    spaces.routineOn("p1", r.id);
    return r.id;
  };
  /** A chat's turn ended with an answer. @param {string} id @param {string} text */
  const answered = (id, text) => facts.set(id, { busy: false, asking: false, last: { final: true, text, cut: false, failed: false, why: "", stopped: false } });
  const r1 = () => spaces.get("p1").routines[0];
  return { clock, spaces, created, posted, marked, removed, owned, templated, order, facts, post, own, routines, switchedOn, answered, r1 };
}

describe("the runner", () => {
  test("at its time a new chat of the project, read-only, its title the routine's and the day, its first message the routine's words; its end read from its chat as its turn lets go", async () => {
    const w = worldOf();
    w.switchedOn();
    await w.routines.start();
    assert.equal(w.created.length, 0, "not yet its time");
    w.clock.at = at(MON, 9);
    await w.routines.tick();
    assert.deepEqual(w.created, [{ cwd: "/work/app", model: "agent/brain-model", title: "Morning brief · Mon 26 Oct", settings: { loop: { permissions: "read-only" } } }]);
    assert.deepEqual(w.marked, [["run1", { routine: { project: "p1", id: "r1", title: "Morning brief", at: at(MON, 9), by: "time" } }]]);
    assert.deepEqual(w.posted, [["run1", { by: "routine", content: [{ type: "text", text: runWords(w.r1(), { project: "app", when: "weekdays at 09:00", by: "time" }) }] }]]);
    assert.deepEqual([w.r1().last?.state, w.r1().last?.chain, w.r1().upTo], ["running", "run1", at(MON, 9)]);
    await w.routines.tick();
    assert.equal(w.created.length, 1, "its time ran once");
    // A question waits for the person: it still runs (case 9).
    w.facts.set("run1", { busy: false, asking: true, last: null });
    w.routines.released("run1");
    assert.equal(w.r1().last?.state, "running");
    w.clock.at = at(MON, 9) + 41_000;
    w.answered("run1", "## 3 PRs wait for you\n\n- #412 …");
    w.routines.released("run1");
    assert.deepEqual([w.r1().last?.state, w.r1().last?.said, w.spaces.get("p1").log.at(-1)?.text], ["done", "3 PRs wait for you", "“Morning brief” ran (09:00, 41 s): 3 PRs wait for you"]);
    w.routines.released("run1");
    assert.equal(w.spaces.get("p1").log.filter((e) => e.text.startsWith("“Morning brief” ran")).length, 1, "its end written once");
    w.routines.stop();
  });

  test("a time while its last run still runs, or while Pause all is on, is skipped and said; Run now runs whatever Pause all says, and is refused while a run is under way", async () => {
    const w = worldOf();
    w.switchedOn();
    await w.routines.start();
    w.clock.at = at(MON, 9);
    await w.routines.tick();
    w.clock.at = at(TUE, 9);
    await w.routines.tick();
    assert.deepEqual([w.created.length, w.r1().skipped], [1, { at: at(TUE, 9), why: "the 09:00 run was still under way" }]);
    await assert.rejects(w.routines.runNow("p1", "r1"), { status: 409, message: "“Morning brief” is running now: open its run, or stop it there." });
    w.answered("run1", "done");
    w.spaces.pauseAll(true);
    w.clock.at = at(WED, 9);
    await w.routines.tick();
    assert.deepEqual([w.created.length, w.r1().skipped], [1, { at: at(WED, 9), why: "Pause all was on" }]);
    assert.equal(rowWords(w.r1(), { now: w.clock.at, pausedSince: w.spaces.pausedSince() }).skipped, "today 09:00 skipped: Pause all was on");
    w.clock.at = at(WED, 10);
    assert.equal(await w.routines.runNow("p1", "r1"), "run2");
    assert.deepEqual([w.r1().last?.by, w.r1().last?.at, w.r1().upTo], ["you", at(WED, 10), at(WED, 9)], "a press moves no time of its own");
    assert.match(w.posted[1][1].content[0].text, /run now, as the person pressed Run now/);
    w.routines.stop();
  });

  test("Run now on one proposed or removed is refused; one that writes works in a worktree of its own, its template copied; outside git, its failure says why, once in Needs you", async () => {
    const w = worldOf();
    const id = w.spaces.routinePropose("p1", FIELDS, { chain: "c1", byName: "Release", model: "m" }).id;
    await assert.rejects(w.routines.runNow("p1", id), { status: 409, message: "“Morning brief” is not on: its Switch on… says what it does first." });
    await assert.rejects(w.routines.runNow("p1", "r9"), { status: 404 });
    w.spaces.routinePropose("p1", { writes: true, title: "Upkeep" }, { chain: "c1", byName: "Release", model: "m" }, id);
    w.spaces.routineOn("p1", id);
    assert.equal(await w.routines.runNow("p1", id), "run1");
    assert.deepEqual(w.owned, [["/work/app", "routine-upkeep-1026"]]);
    assert.deepEqual([w.created[0].cwd, w.created[0].settings, w.templated], ["/work/app-routine-upkeep-1026", null, [["run1", "/work/app-routine-upkeep-1026"]]]);
    w.answered("run1", "Opened PR #415");
    w.routines.released("run1");
    w.own.next = { ok: false, outside: "it is not in a git repository" };
    await assert.rejects(w.routines.runNow("p1", id), { status: 502, message: "“Upkeep” could not start: it writes, and it is not in a git repository: a lane of its own needs git" });
    assert.equal(w.created.length, 1, "no chat for it");
    const row = w.spaces.get("p1").needs.find((n) => n.kind === "routine");
    assert.deepEqual([row?.text, row?.routine], ["“Upkeep” failed: it writes, and it is not in a git repository: a lane of its own needs git", { id, chain: "" }]);
    w.routines.stop();
  });

  test("a turn that could not start: its chat removed, the failure said; a project Filament does not know of: its failure", async () => {
    const w = worldOf();
    w.switchedOn();
    w.post.status = 409;
    w.post.body = { error: "brain-model cannot run now" };
    await assert.rejects(w.routines.runNow("p1", "r1"), { status: 502, message: "“Morning brief” could not start: its turn could not start: brain-model cannot run now" });
    assert.deepEqual([w.removed, w.r1().last?.chain, w.r1().last?.state], [["run1"], "", "failed"]);
    assert.deepEqual(w.order, ["remove run1"], "one that reads only: no worktree, no copy to stop");
    // One that writes: its template's copy ends before its chat goes and its worktree is taken back.
    // (fails before: yes — the worktree was taken back while its copy still ran, found by the Hunter on S6)
    w.spaces.routinePropose("p1", { writes: true }, { chain: "c1", byName: "Release", model: "m" }, "r1");
    w.spaces.routineOn("p1", "r1");
    w.order.length = 0;
    await assert.rejects(w.routines.runNow("p1", "r1"), { status: 502 });
    assert.deepEqual(w.order, ["untemplate run2: its routine's run could not start", "remove run2", "takeBack /work/app-routine-upkeep-1026"]);
    w.routines.stop();
  });

  test("at the start: a run the stop cut is read from its chat; today's missed time runs once; an earlier day's is said missed", async () => {
    const w = worldOf();
    w.clock.at = at(-3, 8);
    const brief = w.switchedOn();
    const friday = w.switchedOn({ title: "Friday report", when: "fridays 16:00" });
    const cut = w.switchedOn({ title: "Nightly", when: "daily 23:00" });
    w.spaces.routineStarted("p1", cut, { at: at(-1, 23), chain: "old1", by: "time" });
    w.facts.set("old1", { busy: false, asking: false, last: { final: false, text: "", cut: true, failed: false, why: "", stopped: false } });
    // Filament was off from Friday 08:00 to Monday 10:00.
    w.clock.at = at(MON, 10);
    await w.routines.start();
    const byId = (/** @type {string} */ id) => w.spaces.get("p1").routines.find((r) => r.id === id);
    assert.deepEqual([byId(cut)?.last?.state, byId(cut)?.last?.why], ["failed", "Filament stopped before it ended"]);
    assert.deepEqual(w.created.map((c) => c.title), ["Morning brief · Mon 26 Oct"], "Monday's 09:00, once");
    assert.equal(byId(brief)?.last?.at, at(MON, 9));
    assert.deepEqual(byId(friday)?.skipped, { at: at(-3, 16), why: "Filament was off", missed: true });
    assert.equal(rowWords(/** @type {any} */ (byId(friday)), { now: w.clock.at }).skipped, "missed Fri 16:00: Filament was off");
    assert.equal(byId(cut)?.skipped, null, "Sunday's 23:00 was its cut run's own; Monday's is to come");
    w.routines.stop();
  });

  test("its chat gone: the run failed, and said", async () => {
    const w = worldOf();
    w.switchedOn();
    w.spaces.routineStarted("p1", "r1", { at: at(MON, 7), chain: "gone1", by: "time" });
    w.clock.at = at(MON, 9);
    await w.routines.tick();
    assert.equal(w.spaces.get("p1").log.some((e) => e.text === "“Morning brief” failed (07:00): its chat is gone"), true);
    assert.equal(w.created.length, 1, "its time ran");
    w.routines.stop();
  });

  test("its chat deleted while it runs: the page's read ends it there, not at its next time", async () => {
    const w = worldOf();
    w.switchedOn();
    await w.routines.start();
    w.clock.at = at(MON, 9);
    await w.routines.tick();
    assert.equal(w.r1().last?.state, "running");
    // The chat deleted: nothing hears it — no turn lets go —; the page reads the Space.
    // (fails before: yes — it read "running", its Open opening nothing, until Tuesday 09:00; found by the Hunter on S6)
    w.facts.delete("run1");
    w.clock.at = at(MON, 11);
    const [{ r, live }] = w.routines.live("p1");
    assert.deepEqual([r.last?.state, r.last?.why, live], ["failed", "its chat is gone", null]);
    assert.equal(w.r1().last?.state, "failed", "written, not only answered");
    assert.equal(w.spaces.get("p1").needs.filter((n) => n.kind === "routine").length, 1, "once in Needs you");
    assert.equal(w.routines.live("p1")[0].r.last?.state, "failed", "a second read writes nothing more");
    w.routines.stop();
  });
});

describe("end to end: a chat's agent proposes a routine, the person switches it on and runs it", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = fresh("e2e");
  before(async () => {
    up = await fakeUpstream(async (call) => {
      const body = call.body || {};
      if (!body.tools?.length) return anthropicReply("A title", { model: "brain-model" });
      const said = JSON.stringify(body.messages || []);
      if (said.includes("a routine of ")) return anthropicReply("## 3 PRs wait for you\n\n- #412 needs a review", { model: "brain-model" });
      const last = body.messages?.at(-1);
      const parts = Array.isArray(last?.content) ? last.content : [];
      if (parts.some((/** @type {any} */ p) => p?.type === "tool_result")) return anthropicReply("Proposed: it waits for your Switch on.", { model: "brain-model" });
      return anthropicReply("", { model: "brain-model", stop: "tool_use", blocks: [{ type: "tool_use", id: "r1", name: "space", input: { action: "routine", title: "Morning brief", when: "weekdays 09:00", text: "Read the open PRs; say what needs the person." } }] });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
    made.push(shim.dataDir);
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
  });

  test("the proposal waits in Routines with its words; Switch on; Run now makes a read-only chat of the project whose answer is the row's last; Pause all; Remove and Put back", async () => {
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", title: "Release", settings: { loop: { permissions: "auto" } } } });
    assert.equal(s.status, 200, await s.clone().text());
    const id = String((await s.json()).id);
    const { projectId } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`)).json();
    assert.equal((await shim.api(`/api/space/${encodeURIComponent(projectId)}`, { method: "POST" })).status, 200, "its Space made from its menu (10-29)");
    const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "make me a morning brief", stream: false } });
    assert.equal(t.status, 200, await t.clone().text());
    const base = `/api/space/${encodeURIComponent(projectId)}`;
    const space = async () => (await shim.api(base)).json();
    await until(async () => (await space()).runs?.routines?.length === 1, "the proposal in Routines");
    const got = await space();
    const r = got.runs.routines[0];
    assert.deepEqual([r.id, r.state, r.madeIn, r.madeName, r.model, r.words.when, r.words.may, r.words.next], ["r2", "proposed", id, "Release", "agent/brain-model", "weekdays at 09:00", "reads only", ""]);
    assert.equal(got.runs.head, "", "nothing runs by itself yet");
    assert.ok(got.log.some((/** @type {any} */ e) => e.by.chain === id && e.text.startsWith("Proposed a routine: “Morning brief”")));
    const at1 = `${base}/routines/r2`;
    assert.equal((await shim.api(`${at1}/run`, { method: "POST", body: {} })).status, 409, "not on: no Run now");
    // Switch on is of what the sheet showed (the plan of 11-11, its w5): a routine's `at` that is not its own now — its
    // chat changed it since — is refused as moved, with the Space as it stands.
    // (fails before: yes — the route read no body: the press switched on whatever the routine had become)
    assert.equal(typeof r.at, "number", "the Space says when its chat last changed it");
    const stale = await shim.api(`${at1}/on`, { method: "POST", body: { at: r.at - 1 } });
    const staleBody = await stale.json();
    assert.deepEqual([stale.status, staleBody.moved, staleBody.error, staleBody.space?.runs?.routines?.[0]?.state], [409, true, "“Morning brief” was changed by its chat since you read it: read what it does now, then switch it on.", "proposed"]);
    assert.equal((await shim.api(`${at1}/on`, { method: "POST", body: { at: "then" } })).status, 400);
    const on = await shim.api(`${at1}/on`, { method: "POST", body: { at: r.at } });
    assert.equal(on.status, 200, await on.clone().text());
    const onBody = await on.json();
    assert.equal(onBody.space.runs.routines[0].state, "on");
    assert.match(onBody.space.runs.head, /^Runs by itself: 1 routine · next: Morning brief at /);
    // The model it runs on is the person's to choose (the owner's word of 10-31): kept and said, its runs start on it;
    // one no provider of theirs serves is refused, saying why.
    // (fails before: yes — there was no way to choose it: a routine ran on the model its chat proposed it on)
    const pick = await shim.api(`${at1}/model`, { method: "POST", body: { model: "agent/brain-pick" } });
    assert.equal(pick.status, 200, await pick.clone().text());
    const picked = (await pick.json()).space;
    assert.deepEqual([picked.runs.routines[0].model, picked.runs.routines[0].modelBy, picked.runs.routines[0].state], ["agent/brain-pick", "you", "on"], "on, as it was");
    assert.ok(picked.log.some((/** @type {any} */ e) => e.text === "You chose the model “Morning brief” runs on: agent/brain-pick."));
    const bad = await shim.api(`${at1}/model`, { method: "POST", body: { model: 7 } });
    assert.deepEqual([bad.status, (await bad.json()).error], [400, "model is a model's name, or \"\" for this Space's model"]);
    const cannot = await shim.api(`${at1}/model`, { method: "POST", body: { model: "zz-none" } });
    assert.equal(cannot.status, 409);
    assert.match((await cannot.json()).error, /^“zz-none” cannot run: ./);
    assert.equal((await space()).runs.routines[0].model, "agent/brain-pick", "a refusal changes nothing");
    const ran = await shim.api(`${at1}/run`, { method: "POST", body: {} });
    assert.equal(ran.status, 200, await ran.clone().text());
    const chain = String((await ran.json()).chain);
    await until(async () => (await space()).runs.routines[0].last?.state === "done", "the run's end");
    assert.ok(up.received.some((c) => c.body?.model === "brain-pick" && JSON.stringify(c.body?.messages || []).includes("a routine of ")), "its run, on the model chosen");
    const done = (await space()).runs.routines[0];
    assert.deepEqual([done.last.chain, done.last.by, done.last.said], [chain, "you", "3 PRs wait for you"]);
    assert.match(done.words.last, /^last: today \d\d:\d\d \(Run now\) · done in (\d+ s|under a second)$/);
    const settings = await (await shim.api(`/api/sessions/${encodeURIComponent(chain)}/settings`)).json();
    assert.deepEqual([settings.projectId, settings.effective?.loop?.permissions], [projectId, "read-only"], "a chat of the project, read-only");
    const listed = (await (await shim.api("/api/memory/sessions?limit=50")).json()).sessions;
    const row = listed.find((/** @type {any} */ x) => x.id === chain);
    assert.match(String(row?.title || ""), /^Morning brief · /, JSON.stringify(row));
    const meta = /** @type {any} */ (shim.app).memory.archive.getChain(chain)?.meta?.routine;
    assert.deepEqual([meta?.project, meta?.id, meta?.by], [projectId, "r2", "you"], "its chat names the routine (r2: the Space's making was its first change)");
    // A lane's chats say which is a routine's run, for the Space to put it after the person's own.
    // (fails before: yes — seen at S6's live look: the run led the main lane, the chat at work behind it)
    const inRoot = (/** @type {any} */ (shim.app).memory.chatsIn([root]).get(root) || []).map((/** @type {any} */ c) => [c.id, c.routine]);
    assert.deepEqual(inRoot.sort(), [[chain, "Morning brief"], [id, ""]].sort());
    const [first] = /** @type {any} */ (shim.app).memory.archive.turnBodies(chain);
    assert.match(JSON.stringify(first?.user ?? first), /This is “Morning brief”, a routine of [^"]+'s Space, run now, as the person pressed Run now: a chat of its own\. You read only/);
    assert.ok((await space()).log.some((/** @type {any} */ e) => e.by.chain === chain && /^“Morning brief” ran \(\d\d:\d\d, (\d+ s|under a second)\): 3 PRs wait for you$/.test(e.text)));
    // Your Space's Routines (case 16).
    const ys = await (await shim.api("/api/your-space?glance=0")).json();
    assert.deepEqual([ys.runs.routines.length, ys.runs.routines[0].project, ys.projects.some((/** @type {any} */ p) => p.id === projectId)], [1, projectId, true]);
    // Pause all (S6-D4).
    const paused = await shim.api("/api/spaces/pause", { method: "POST", body: { on: true } });
    assert.equal(paused.status, 200, await paused.clone().text());
    assert.ok((await paused.json()).pausedSince > 0);
    const ps = await space();
    assert.deepEqual([ps.runs.head.startsWith("Paused since "), ps.runs.routines[0].words.next], [true, "Pause all is on: nothing starts by itself"]);
    await shim.api("/api/spaces/pause", { method: "POST", body: { on: false } });
    // Remove and its way back.
    const gone = await shim.api(at1, { method: "DELETE" });
    assert.equal((await gone.json()).space.runs.routines[0].state, "removed");
    const back = await shim.api(`${at1}/back`, { method: "POST", body: {} });
    assert.equal((await back.json()).space.runs.routines[0].state, "on");
    // When you press Run: memory's procedures of the project.
    assert.deepEqual(await (await shim.api(`${base}/procedures`)).json(), { procedures: [] });
  });
});

describe("Pause all's button and its confirm, on the page (the bug hunt of 10-30, UISP-1)", () => {
  // (fails before: yes — a project's Space said "Pause all?" and named no Space, while the one switch paused every Space)
  test("in a project's Space and in Your Space, the button, its tip and its confirm say it pauses every Space; the press switches the one Pause all", async () => {
    const doc = stubDocument();
    // The confirm asks what had the focus; nothing in the stub page is an element of the browser's.
    const g = /** @type {any} */ (globalThis);
    const hadElement = g.HTMLElement;
    g.HTMLElement = class {};
    try {
      const { routinesPart } = await import("../src/ui/harness/space/routines.js");
      for (const all of [false, true]) {
        /** @type {boolean[]} */
        const asked = [];
        const part = routinesPart({ all, place: () => ({ id: "p1", name: "web", cwd: "/w" }), write: async () => ({}), pauseAll: async (on) => (asked.push(on), true), openChat: () => {}, openTab: () => {} });
        part.paint({ head: "Runs by itself: 1 routine · next: Brief at 09:00", pausedSince: null, routines: [], watches: [] });
        const btn = /** @type {any} */ (part.el.querySelector(".srt-pause"));
        assert.equal(btn.textContent, "Pause every Space", all ? "Your Space" : "a project's Space");
        assert.equal(btn.title, "Nothing starts by itself in any Space until you resume: no routine at its time, no dashboard's watch, no watcher on an event");
        btn.dispatch("click");
        const dialog = /** @type {any} */ (doc.document.body.querySelector(".zc-dialog"));
        assert.equal(dialog.querySelector(".zc-dialog-title").textContent, "Pause every Space?");
        assert.equal(
          dialog.querySelector(".zc-dialog-desc").textContent,
          `Every Space of this Filament pauses${all ? "" : ", not this one alone"}: nothing starts by itself — no routine at its time, no dashboard's watch, no watcher on an event — until you resume. A run under way goes on: its chat's Stop is there. A routine's times that come while paused are skipped and said; what a chat does, what moves in a folder and what a program posts then wakes no watcher, and a watcher's own program is stopped: Resume makes up none of it. A dashboard's watch and a watcher of a branch or a connection read again on Resume, and find what changed meanwhile.`,
        );
        dialog.querySelectorAll(".zc-dialog-foot button").find((/** @type {any} */ b) => b.textContent === "Pause every Space").dispatch("click");
        await new Promise((r) => setTimeout(r, 0));
        assert.deepEqual(asked, [true]);
        part.paint({ head: "Paused since 14:20: 1 routine, nothing starts by itself until you resume", pausedSince: 1, routines: [], watches: [] });
        assert.deepEqual([btn.textContent, btn.title], ["Resume", "Pause all goes off in every Space: what runs by itself goes on at its next times, nothing made up"]);
      }
    } finally {
      g.HTMLElement = hadElement;
      doc.restore();
    }
  });

  // (fails before: yes — by need, 11-12: Home's line sent the person to "a project's Space › Routine…", which a project
  // with no Space has not; Routine… is on a project's page either way, where it makes the Space)
  test("with no routine, the page says where one is asked for: Routine… here, in a Space; on a project's page, from Home", async () => {
    const doc = stubDocument();
    try {
      const { routinesPart } = await import("../src/ui/harness/space/routines.js");
      const none = (/** @type {boolean} */ all) => {
        const part = routinesPart({ all, place: () => ({ id: "p1", name: "web", cwd: "/w" }), write: async () => ({}), pauseAll: async () => true, openChat: () => {}, openTab: () => {} });
        part.paint({ head: "", pausedSince: null, routines: [], watches: [] });
        return /** @type {any} */ (part.el.querySelector(".srt-none")).textContent;
      };
      assert.equal(none(false), "No routine yet: Routine… asks an agent here for one; it runs only once you switch it on.");
      assert.equal(none(true), "No routine yet: Routine…, on a project's page, asks an agent of it for one.");
    } finally {
      doc.restore();
    }
  });
});
