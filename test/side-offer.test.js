// @ts-check
// Phase 5: the side-by-side card. The main agent's tasks call that leaves ready tasks of its own able to run at once says
// so, and to suggest them; its `parallel` puts them on a card in the transcript after its turn (the owner's of 11-10: the
// agent puts it, never Filament by itself), kept with the graph, so a reload neither loses it nor brings back one
// ignored. /parallel, which asked for a re-plan, is gone. Accept is the graph's side run, whose tasks start as forks of the planner where that pays, as
// its own tasks do, and fresh in a coding agent's chat; Ignore clears the card. Copies of a repository are checked out
// one at a time, and the newest checkout's time is kept for the card's one line on a slow one.
// (fails before: yes — there was no card, side tasks never forked, and checkouts ran all at once)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { getEventListeners } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tg from "../src/core/task-graph.js";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { lastCheckout, takeTaskWorktree } from "../src/adapters/git/worktree.js";
import * as offerWords from "../src/ui/harness/lib/side-offer.js";
import * as offerCard from "../src/ui/harness/conversation/side-offer.js";
import { deliveredWords, parallelEl } from "../src/ui/harness/conversation/turn.js";
import { placeBoundary } from "../src/ui/harness/conversation/history.js";
import { prettyModel } from "../src/ui/harness/lib/families.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const { SLOW_CHECKOUT_MS, acceptBody, sideFolderOf, slowCheckoutWords } = offerWords;
const { sideActions, sideOfferRow } = offerCard;

/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));

const T0 = Date.UTC(2026, 10, 3, 9, 0);
/** @type {import("../src/core/task-graph.js").Crew} */
const AGENT = "agent";
/** @param {any} r @returns {any} */
const ok = (r) => (assert.ok(r.ok, JSON.stringify(r)), r);
/** api and ui ready and apart; docs needs api. */
const ADD = {
  action: "add",
  goal: "Ship the card",
  tasks: [
    { id: "api", name: "The route", writes: ["src/http/a.js"], check: ["node -e 0"], steps: ["Write the route"] },
    { id: "ui", name: "The card", writes: ["src/ui/card.js"], check: ["node -e 0"], steps: ["Draw the card"] },
    { id: "docs", name: "The docs", needs: ["api"], writes: ["docs/GUIDE.md"], steps: ["Say it"] },
  ],
};
const graph = () => ok(tg.applyTasks(null, ADD, { at: T0, crew: AGENT })).graph;
/** @type {import("../src/core/task-graph.js").SidePick[]} */
const PICKS = [{ id: "api", model: "m-main", folder: "copy" }, { id: "ui", model: "m-main", folder: "copy" }];

/**
 * The agent's suggestion of `ids` (the owner's of 11-10): its tasks call after turn `turn`.
 * @param {any} g @param {string[]} [ids] @param {number} [at] @param {number} [turn]
 */
const suggest = (g, ids = ["api", "ui"], at = T0 + 1, turn = 2) => ok(tg.applyTasks(g, { action: "parallel", ids }, { at, crew: AGENT, turn })).graph;

describe("the card in the graph", () => {
  // (fails before: yes — the owner's of 11-10: Filament offered the card by itself at a turn's end, which "could actually
  // be dangerous": the card is the agent's to put)
  test("the agent puts the card: a call's answer names the tasks that can run side by side, and its parallel suggests them", () => {
    const added = ok(tg.applyTasks(null, ADD, { at: T0, crew: AGENT }));
    assert.deepEqual(tg.sideBySide(added.graph), ["api", "ui"]);
    assert.ok(added.text.endsWith("\nThe graph lets api and ui run side by side: none needs another's work. Whether they should is your call — truly independent, each worth a sub-agent of its own, none you are working on yourself. If so, suggest them to the person: {\"action\":\"parallel\",\"ids\":[\"api\",\"ui\"]} puts a card in the chat that starts each on a sub-agent on their Accept, or by itself after 60 seconds; a builder you launch for one yourself is held on a card the same way. If not, do them yourself, in order."), added.text);
    assert.equal("offer" in added.graph, false, "no card by itself");
    const r = ok(tg.applyTasks(added.graph, { action: "parallel", ids: ["ui", "api"] }, { at: T0 + 1, crew: AGENT, turn: 2 }));
    // (fails before: yes — the review of ef73c2a9d: "start none of them yourself" held them for good where the person
    // ignored the card, which the agent never heard)
    // (fails before: yes — the owner's of 11-14: the answer said nothing of the card's 60 seconds, and let the agent take
    // up their work while it stood)
    assert.equal(r.text, "Suggested api and ui to the person on a card in the chat: its Accept starts each on a sub-agent, its Ignore keeps them yours, and with no answer it answers itself in 60 seconds. Do none of their work until it is answered — go on with your other work, or end your turn where none is left: the answer is told to you.");
    assert.match(ok(tg.applyTasks(r.graph, { action: "show" }, { at: T0 + 1, crew: AGENT })).text, /\nA card in the chat suggests api and ui to the person: leave them until they Accept or Ignore it\.(\n|$)/, "a show says it while it stands");
    // It answers itself 60 seconds after it is put (the plan of 11-14): no model named here, so its tasks stay the agent's then.
    const answers = { until: T0 + 1 + tg.SIDE_ANSWER_MS, onTimeout: "decline", why: "no model is known for them to run on" };
    assert.deepEqual(r.graph.offer, { ids: ["api", "ui"], at: T0 + 1, turn: 2, model: null, ...answers }, "in the graph's order");
    const card = { ids: ["api", "ui"], at: T0 + 1, turn: 2, ...answers, tasks: [{ id: "api", name: "The route", writes: ["src/http/a.js"] }, { id: "ui", name: "The card", writes: ["src/ui/card.js"] }] };
    assert.deepEqual(tg.sideOfferOf(r.graph), card);
    assert.deepEqual(tg.graphView(r.graph)?.offer, card, "the pages hear it with the graph");
    assert.deepEqual(suggest(added.graph, /** @type {any} */ ("api, ui")).offer.ids, ["api", "ui"], "ids as one string");
    assert.equal(tg.offerIgnored(r.graph, T0 + 99), null, "another card's Ignore");
    const ignored = /** @type {any} */ (tg.offerIgnored(r.graph, T0 + 1));
    assert.deepEqual(["offer" in ignored, tg.graphView(ignored)?.offer], [false, undefined]);
  });

  test("a suggestion is refused in words: one task, a task that is none, one that cannot run side by side, a plan that waits, Parallelize tasks on, a lead, no graph", () => {
    const g = graph();
    /** @param {any} graph @param {any} input @param {any} [o] */
    const no = (graph, input, o = {}) => {
      const r = tg.applyTasks(graph, { action: "parallel", ...input }, { at: T0 + 1, crew: AGENT, ...o });
      assert.equal(r.ok, false, JSON.stringify(r));
      return /** @type {any} */ (r).error;
    };
    assert.match(no(g, { ids: ["api"] }), /^name two or more ready tasks of yours that can run at once\nThe call: \{"action":"parallel","ids":\["api"\]\}$/);
    assert.match(no(g, { ids: ["api", "nope"] }), /^nope is no task in the graph/);
    assert.match(no(g, { ids: ["api", "docs"] }), /^docs is not a ready task of yours: a card offers your own tasks whose needs are done and that have not started/);
    assert.match(no({ ...g, planning: { at: T0 } }, { ids: ["api", "ui"] }), /^the plan waits for the person's Approve: suggest nothing to start until it goes/);
    assert.match(no(g, { ids: ["api", "ui"] }, { planning: true }), /^the plan waits for the person's Approve: suggest nothing to start in this turn/);
    assert.match(no(g, { ids: ["api", "ui"] }, { parallel: true }), /^Parallelize tasks is on — the person's consent: no card asks them\. Start the tasks that can run at once yourself, now: by: sub-agent/);
    assert.match(no(g, { ids: ["api", "ui"] }, { parallel: true, solo: true }), /yourself, now: Filament's agent tool, one each, the task in task$/);
    assert.match(no(g, { ids: ["api", "ui"] }, { crew: [{ tag: "builder" }] }), /^action must be one of add, start, done, change, drop, close, show, keep, read, find, merge/);
    // (fails before: yes — the review of 67038d835, its finding 10: under Parallelize tasks, or in a planning turn, a
    // lead heard the agent's refusal — "Start the tasks that can run at once yourself" — of an action it does not have)
    for (const o of [{ parallel: true }, { planning: true }]) assert.match(no(g, { ids: ["api", "ui"] }, { crew: [{ tag: "builder" }], ...o }), /^action must be one of add, start, done, change, drop, close, show, keep, read, find, merge/, JSON.stringify(o));
    assert.match(no(null, { ids: ["api", "ui"] }), /graph/);
  });

  // (fails before: yes — the owner's of 11-10: "only the agent should be able to judge itself about the parallelism";
  // the suggestion was refused for any task outside the set the graph's walk found)
  // (fails before: yes — FabeleHelper's of 11-10: a coding agent's task could carry no goal or steps, so the card's Accept
  // briefed its sub-agent with the task's name alone; and a suggestion of a task with no steps went through)
  test("a coding agent's own task carries goal and steps, the card's sub-agent briefed with them; one with no steps is refused on a card, in words", () => {
    const solo = { at: T0, crew: AGENT, solo: true };
    const g = ok(tg.applyTasks(null, { action: "add", goal: "Ship", tasks: [{ id: "api", name: "The route", writes: ["src/http/a.js"], goal: "The route answers 200", steps: ["Write it", "Test it"] }, { id: "ui", name: "The card", writes: ["src/ui/card.js"] }] }, solo)).graph;
    assert.deepEqual([g.tasks[0].goal, g.tasks[0].steps], ["The route answers 200", ["Write it", "Test it"]]);
    const bare = tg.applyTasks(g, { action: "parallel", ids: ["api", "ui"] }, { ...solo, turn: 1 });
    assert.equal(bare.ok, false);
    assert.match(bare.ok ? "" : bare.error, /^ui has no steps: a sub-agent the card starts would get its name alone — give it goal and steps \(tasks change\), then suggest again\n/);
    const given = ok(tg.applyTasks(g, { action: "change", tasks: [{ id: "ui", goal: "The card shows", steps: ["Draw it"] }] }, solo)).graph;
    const offered = ok(tg.applyTasks(given, { action: "parallel", ids: ["api", "ui"] }, { ...solo, turn: 1 })).graph;
    // The card's Accept: the picks carry no brief of their own.
    const run = /** @type {any} */ (tg.sideRun(offered, PICKS, { at: T0 + 1, crew: AGENT, starts: "now" }));
    assert.ok(run.ok, JSON.stringify(run));
    assert.deepEqual(run.graph.tasks.map((/** @type {any} */ t) => [t.id, t.by, t.goal, t.steps]), [
      ["api", "sub-agent", "The route answers 200", ["Write it", "Test it"]],
      ["ui", "sub-agent", "The card shows", ["Draw it"]],
    ]);
  });

  // (fails before: yes — the review of 67038d835, its finding 2: the answer that said api and ui may run side by side
  // printed the parallel call with both, and the graph refused that very call: ui has no steps)
  test("the graph's own words offer no call it refuses: the call names the tasks that have steps, and the words say what the others lack", () => {
    const solo = { at: T0, crew: AGENT, solo: true };
    const MAY = "run side by side: none needs another's work. Whether they should is your call — truly independent, each worth a sub-agent of its own, none you are working on yourself.";
    const CARD = "puts a card in the chat that starts each on a sub-agent on their Accept, or by itself after 60 seconds; a builder you launch for one yourself is held on a card the same way";
    const api = { id: "api", name: "The route", writes: ["src/http/a.js"], steps: ["Write it"] };
    const ui = { id: "ui", name: "The card", writes: ["src/ui/card.js"] };
    // One of two has no steps: no call can be taken yet, so none is printed.
    const two = ok(tg.applyTasks(null, { action: "add", goal: "Ship", tasks: [api, ui] }, solo));
    assert.equal(two.text.split("\n").at(-1), `The graph lets api and ui ${MAY} If so, ui has no steps, which the sub-agent a card starts is briefed with: give it goal and steps (tasks change), then suggest them to the person with parallel and their ids, which ${CARD}. If not, do them yourself, in order.`);
    // Two of three have steps: the call names those two, and is taken as it is printed.
    const three = ok(tg.applyTasks(null, { action: "add", goal: "Ship", tasks: [api, { ...ui, steps: ["Draw it"] }, { id: "db", name: "The table", writes: ["src/db.js"] }] }, solo));
    assert.equal(three.text.split("\n").at(-1), `The graph lets api, ui and db ${MAY} If so, suggest api and ui to the person: {"action":"parallel","ids":["api","ui"]} ${CARD}. db has no steps, which the sub-agent a card starts is briefed with: give it goal and steps (tasks change) first to suggest it too. If not, do them yourself, in order.`);
    for (const said of [two.text, three.text]) {
      const call = /\{"action":"parallel"[^}]*\}/.exec(said)?.[0];
      if (call) assert.deepEqual(ok(tg.applyTasks(three.graph, JSON.parse(call), { ...solo, turn: 1 })).graph.offer.ids, ["api", "ui"], "the call it printed is taken");
    }
    assert.ok(!two.text.includes('"action":"parallel"'), two.text);
  });

  // (fails before: yes — the same review's finding 6: a start, a done and a drop read T1 as t1, and parallel alone
  // answered that "API and Ui are no tasks in the graph")
  test("parallel reads its ids as every action reads them: API is api", () => {
    const r = ok(tg.applyTasks(graph(), { action: "parallel", ids: ["API", "Ui", "api"] }, { at: T0 + 1, crew: AGENT, turn: 2 }));
    assert.deepEqual(r.graph.offer.ids, ["api", "ui"]);
    assert.deepEqual(suggest(graph(), /** @type {any} */ ("API, UI")).offer.ids, ["api", "ui"], "ids as one string");
  });

  test("the agent judges: a ready task of its own the graph never named — it names no writes — may go on its card", () => {
    const g = ok(tg.applyTasks(null, { action: "add", goal: "Look", tasks: [{ id: "look", name: "Read the logs", steps: ["Read them"] }, { id: "api", name: "The route", writes: ["src/http/a.js"], steps: ["Write it"] }] }, { at: T0, crew: AGENT })).graph;
    assert.deepEqual(tg.sideBySide(g), [], "the graph names none: look says no writes");
    assert.deepEqual(suggest(g, ["api", "look"]).offer.ids, ["look", "api"], "in the graph's order");
    // (fails before: yes — the review of ef73c2a9d: one meant to change files ran read-only on Accept, unsaid)
    const r = ok(tg.applyTasks(g, { action: "parallel", ids: ["api", "look"] }, { at: T0 + 1, crew: AGENT, turn: 2 }));
    assert.match(r.text, / look names no writes, so on Accept it runs read-only: it reads and reports, changing nothing\. If it changes files, name them \(change, writes\): the card shows it as it stands\.$/);
    // (fails before: yes — the review of ef73c2a9d: ids as one string split on the letter s)
    assert.deepEqual(suggest(g, /** @type {any} */ ("look api")).offer.ids, ["look", "api"], "ids as one string, apart by spaces");
  });

  // (fails before: yes — the review of ef73c2a9d: a card stood through a re-plan, and came back where it stood once the
  // plan went, the agent never suggesting it again)
  test("a planning turn's change lets the card go: once the plan goes, the agent suggests again", () => {
    const offered = suggest(graph());
    const r = ok(tg.applyTasks(offered, { action: "change", tasks: [{ id: "docs", name: "The docs, whole" }] }, { at: T0 + 2, crew: AGENT, planning: true }));
    assert.ok(r.graph.planning, "it waits for the person's Approve");
    assert.equal("offer" in r.graph, false);
    assert.equal(tg.sideOfferOf(tg.planGo(r.graph)), null, "approved: no card by itself");
  });

  test("the card stands while each of its tasks is ready and the agent's own; the side run that takes them lets it go", () => {
    const offered = suggest(graph());
    const started = ok(tg.applyTasks(offered, { action: "start", ids: ["api"] }, { at: T0 + 2, crew: AGENT })).graph;
    assert.deepEqual([tg.sideOfferOf(started), tg.graphView(started)?.offer], [null, undefined], "the agent started one itself");
    const claimed = ok(tg.sideRun(offered, PICKS, { at: T0 + 2, crew: AGENT, starts: "now" })).graph;
    assert.equal("offer" in claimed, false, "its Accept, or the Plan page's sheet");
  });

  // (fails before: yes — the owner's of 11-06: a card stood while its plan was reworked, and its Accept, pressed hours
  // later on a page that had not heard the graph, started whatever was ready then — the card named nowhere)
  test("the card leaves while the plan waits for the person's Approve; its Accept names it, and starts nothing once it stands no more", () => {
    const offered = suggest(graph());
    const planning = { ...offered, planning: { at: T0 + 2 } };
    assert.equal(tg.sideOfferOf(planning), null, "a plan reworked: the card leaves");
    assert.match(String(tg.cardGone(planning, T0 + 1)), /^that card is gone: the plan is being reworked and waits for your Approve — nothing started$/);
    const held = tg.sideRun(planning, PICKS, { at: T0 + 3, crew: AGENT, starts: "now", card: T0 + 1 });
    assert.deepEqual([held.ok, /** @type {any} */ (held).gone], [false, true]);
    assert.deepEqual(tg.sideOfferOf({ ...planning, planning: null })?.ids, ["api", "ui"], "the plan approved: it stands again");
    // Its own card, while it stands: its tasks go.
    assert.equal(tg.cardGone(offered, T0 + 1), null);
    ok(tg.sideRun(offered, PICKS, { at: T0 + 3, crew: AGENT, starts: "now", card: T0 + 1 }));
    // Another card's Accept, one for a task it does not offer: nothing.
    const other = tg.sideRun(offered, PICKS, { at: T0 + 3, crew: AGENT, starts: "now", card: T0 });
    assert.deepEqual([other.ok, /** @type {any} */ (other).gone], [false, true]);
    assert.match(/** @type {any} */ (other).error, /^that card is gone: its tasks were started, changed or ignored since, or another card took its place — nothing started/);
    const outside = tg.sideRun(offered, [...PICKS, { id: "docs", model: "m-main", folder: "copy" }], { at: T0 + 3, crew: AGENT, starts: "now", card: T0 + 1 });
    assert.deepEqual([outside.ok, /** @type {any} */ (outside).error], [false, "the card offers api and ui, not docs — nothing started"]);
    // The agent went on and started one itself: the card's Accept starts neither, the other one either.
    const started = ok(tg.applyTasks(offered, { action: "start", ids: ["api"] }, { at: T0 + 4, crew: AGENT })).graph;
    const late = tg.sideRun(started, [PICKS[1]], { at: T0 + 5, crew: AGENT, starts: "now", card: T0 + 1 });
    assert.deepEqual([late.ok, /** @type {any} */ (late).gone], [false, true]);
    // The Plan page's sheet names no card: the person picked those tasks there, now.
    ok(tg.sideRun(started, [PICKS[1]], { at: T0 + 5, crew: AGENT, starts: "now" }));
  });

  // (fails before: yes — the hunt of side-card: Ignore took a card gone since — its tasks started, its plan reworked —
  // from a page that had not heard the graph)
  test("Ignore takes only the card that stands: one whose tasks started, or whose plan is reworked, refuses it — nothing ignored", () => {
    const offered = suggest(graph());
    const started = ok(tg.applyTasks(offered, { action: "start", ids: ["api"] }, { at: T0 + 2, crew: AGENT })).graph;
    assert.equal(tg.offerIgnored(started, T0 + 1), null, "its tasks started since");
    assert.equal(tg.cardGone(started, T0 + 1, "nothing ignored"), "that card is gone: its tasks were started, changed or ignored since, or another card took its place — nothing ignored; the Plan shows them as they are now");
    const planning = { ...offered, planning: { at: T0 + 2 } };
    assert.equal(tg.offerIgnored(planning, T0 + 1), null, "its plan reworked");
    assert.equal(tg.cardGone(planning, T0 + 1, "nothing ignored"), "that card is gone: the plan is being reworked and waits for your Approve — nothing ignored");
    assert.deepEqual(tg.sideOfferOf({ ...planning, planning: null })?.ids, ["api", "ui"], "approved: it stands again, nothing marked ignored");
    assert.equal(tg.cardGone(offered, T0 + 1), null, "its own card, standing: not gone");
    assert.deepEqual(/** @type {any} */ (tg.offerIgnored(offered, T0 + 1)).told.filter((/** @type {string} */ m) => m.startsWith("ignored:")), ["ignored:api", "ignored:ui"]);
  });

  // (fails before: yes — the hunt of side-card: Ignore kept the tasks off the card alone; the agent's next tasks answer, the
  // Plan and the standing block still said to give them to sub-agents)
  test("tasks ignored on a card are never said to run side by side — the agent's answers, the standing block — until the agent suggests them again", () => {
    const ignored = /** @type {any} */ (tg.offerIgnored(suggest(graph()), T0 + 1));
    assert.deepEqual(ignored.told.filter((/** @type {string} */ m) => m.startsWith("ignored:")), ["ignored:api", "ignored:ui"]);
    const task = (/** @type {string} */ id) => ({ action: "add", tasks: [{ id, name: id.toUpperCase(), writes: [`${id}.js`], check: ["node -e 0"] }] });
    const one = ok(tg.applyTasks(ignored, task("x"), { at: T0 + 2, crew: AGENT }));
    assert.equal(one.text.includes("can run side by side"), false, `x alone beside the ignored: ${one.text}`);
    const two = ok(tg.applyTasks(one.graph, task("y"), { at: T0 + 3, crew: AGENT }));
    assert.match(two.text, /\nThe graph lets x and y run side by side: none needs another's work/);
    assert.equal(tg.graphView(two.graph)?.offer, undefined, "no card by itself");
    assert.match(String(tg.whereText(two.graph, { crew: AGENT })), /\n- Side by side now: x, y\n/);
    // The person asked again in words: the agent suggests them, and they are ignored no more.
    const back = suggest(two.graph, ["api", "ui"], T0 + 4, 4);
    assert.deepEqual(back.offer.ids, ["api", "ui"]);
    assert.deepEqual(back.told.filter((/** @type {string} */ m) => m.startsWith("ignored:")), [], "ignored no more");
    assert.match(String(tg.whereText(back, { crew: AGENT })), /\n- Side by side now: api, ui, x, y\n/);
    const more = ok(tg.applyTasks(back, task("z"), { at: T0 + 5, crew: AGENT }));
    assert.match(more.text, /\nThe graph lets api, ui, x, y and z run side by side/, "the agent's answers say them again");
  });

  test("a suggestion's answer says its card alone, the set counted as said; a coding agent's answers suggest it too; Parallelize tasks on says to run them now", () => {
    const added = ok(tg.applyTasks(null, ADD, { at: T0, crew: AGENT }));
    const r = ok(tg.applyTasks(added.graph, { action: "parallel", ids: ["api", "ui"] }, { at: T0 + 1, crew: AGENT, turn: 1 }));
    assert.equal(r.text.includes("can run side by side"), false, r.text);
    assert.ok(r.graph.told.includes("side:api,ui"), "counted as said");
    const coder = ok(tg.applyTasks(null, ADD, { at: T0, crew: AGENT, solo: true }));
    assert.match(coder.text, /The graph lets api and ui run side by side: none needs another's work\. Whether they should is your call[^\n]* If so, suggest them to the person: \{"action":"parallel"/);
    const on = ok(tg.applyTasks(null, ADD, { at: T0, crew: AGENT, parallel: true }));
    assert.match(on.text, /The graph lets api and ui run side by side: none needs another's work\. Whether they should is your call[^\n]* If so, Parallelize tasks is on, so run them at once now: change them to by: sub-agent/);
  });
});

/**
 * A session in memory and a registry that records the launches. `forkPays`: the registry's word on a fork while no
 * turn runs; `refuseFork`: it refuses a fork's launch. `switches.parallel`: Parallelize tasks, which a test turns on.
 * @param {{ forkPays?: boolean, refuseFork?: boolean }} [o]
 */
function rig({ forkPays = false, refuseFork = false } = {}) {
  const switches = { parallel: false };
  /** @type {Map<string, any>} */
  const chains = new Map([["c1", { id: "c1", meta: { graph: graph() } }]]);
  /** @type {any[]} */
  const launches = [];
  /** @type {any[]} */
  const published = [];
  /** @type {string[]} */
  const notices = [];
  /** @type {any[]} */
  const tells = [];
  let n = 0;
  const registry = {
    /** @param {any} spec */
    launch: (spec) => {
      if (spec.view === "fork" && refuseFork) return { ok: false, error: "a fork copies the main agent's newest request, which Filament holds only while a turn runs" };
      launches.push(spec);
      return { ok: true, id: `sa_${++n}`, done: new Promise(() => {}), tree: Promise.resolve(true) };
    },
    room: () => ({ max: 4, running: 0, cwd: "/p", worktree: true }),
    turnOpen: () => false,
    /** @param {string} _c @param {() => void} go */
    afterTurn: (_c, go) => go(),
    /** @param {string} _c @param {{ text: string }} m */
    notice: (_c, m) => void notices.push(m.text),
    /** @param {string} _c @param {any} d */
    tell: (_c, d) => void tells.push(d),
    slots: () => 4,
    stop: () => ({ ok: true }),
    guard: () => {},
    resumable: () => null,
    forkPays: () => forkPays,
  };
  const archive = {
    /** @param {string} id @param {readonly string[]} keys */
    metaOf: (id, keys) => {
      const c = chains.get(id);
      return c ? Object.fromEntries(keys.filter((k) => c.meta?.[k] !== undefined).map((k) => [k, c.meta[k]])) : null;
    },
    /** @param {string} id @param {any} patch */
    mergeMeta: (id, patch) => {
      const c = chains.get(id);
      c.meta = structuredClone({ ...c.meta, ...patch });
      return c.meta;
    },
    openGraphs: () => [],
    // The chat's turn now: the agent's suggestion stands after it.
    newestTurnN: () => 2,
  };
  let t = T0;
  const runner = createGraphRunner({ archive, registry: /** @type {any} */ (registry), events: { publish: (topic, e) => void published.push([topic, e]) }, crew: () => AGENT, log: () => {}, now: () => t++, parallel: () => switches.parallel });
  return { runner, launches, published, notices, tells, switches, g: () => chains.get("c1").meta.graph };
}

describe("the runner", () => {
  test("the agent's suggestion keeps the card with the graph after the turn it came in, and the pages hear it; Ignore by its own card alone; the side run lets it go", () => {
    const r = rig();
    assert.equal(r.runner.offered("c1"), null, "no card by itself");
    const said = ok(r.runner.apply("c1", { action: "parallel", ids: ["api", "ui"] }, { crew: AGENT }));
    assert.match(said.text, /^Suggested api and ui to the person on a card in the chat/);
    const card = /** @type {any} */ (r.runner.offered("c1"));
    assert.deepEqual([card.ids, card.turn, card.tasks.map((/** @type {any} */ t) => t.writes)], [["api", "ui"], 2, [["src/http/a.js"], ["src/ui/card.js"]]]);
    assert.deepEqual(r.published.at(-1)?.[1].graph.offer, card, "the pages hear of it with the graph");
    assert.deepEqual(r.runner.ignoreOffer("c1", card.at + 1), { ok: false, error: "that card is gone: its tasks were started, changed or ignored since, or another card took its place — nothing ignored; the Plan shows them as they are now" });
    const out = ok(r.runner.ignoreOffer("c1", card.at));
    assert.equal(out.view.offer, undefined);
    assert.equal(r.runner.offered("c1"), null);
    // (fails before: yes — the review of ef73c2a9d: the agent, told to leave them while the card stood, never heard it went)
    // (fails before: yes — the nudge map of 11-10: told as a notice, which wakes nothing, it sat idle after ending its
    // turn for the answer)
    assert.deepEqual(r.notices, []);
    assert.deepEqual(r.tells.map((d) => [d.text, d.wakes, d.about]), [["[Filament: the person ignored the card that suggested api and ui: they stay yours — do them yourself, as you planned; suggest them again only if the person asks]", true, "card"]], "told by the way that wakes it, as the card's answer");
    ok(r.runner.apply("c1", { action: "parallel", ids: ["api", "ui"] }, { crew: AGENT }));
    assert.deepEqual(r.runner.offered("c1")?.ids, ["api", "ui"], "suggested again: it stands again");
    ok(r.runner.sideRun("c1", PICKS, { starts: "now" }));
    assert.deepEqual([r.runner.offered("c1"), "offer" in r.g()], [null, false], "Accepted: the card goes");
    assert.deepEqual(r.notices, ["[Filament: the developer started api and ui on sub-agents; leave them — their reports come to you]"], "the Plan page's sheet promised the agent nothing: its word waits for the next message");
  });

  // (fails before: yes — the review of 67038d835, its finding 10: under Parallelize tasks the note still said "suggest
  // them again only if the person asks", where a suggestion is refused)
  test("an Ignore under Parallelize tasks says what holds there: no card can suggest its tasks again", () => {
    const r = rig();
    ok(r.runner.apply("c1", { action: "parallel", ids: ["api", "ui"] }, { crew: AGENT }));
    const card = /** @type {any} */ (r.runner.offered("c1"));
    r.switches.parallel = true;
    ok(r.runner.ignoreOffer("c1", card.at));
    assert.deepEqual(r.tells.map((d) => d.text), ["[Filament: the person ignored the card that suggested api and ui: they stay yours — do them yourself, as you planned; Parallelize tasks is on, so no card can suggest them again]"]);
    assert.equal(r.runner.apply("c1", { action: "parallel", ids: ["api", "ui"] }, { crew: AGENT }).ok, false, "as the note says");
    assert.equal(tg.ignoredNote(["api"], true), "[Filament: the person ignored the card that suggested api: it stays yours — do it yourself, as you planned; Parallelize tasks is on, so no card can suggest it again]");
  });

  // (fails before: yes — the nudge map of 11-10: the suggestion's answer tells the agent to end its turn, "an Accept or
  // an Ignore is told to you", and the Accept came as a notice, which wakes no ended turn)
  test("the card's Accept is told by the way that wakes the agent, a chat with no turn running too, as the card's answer", () => {
    const r = rig();
    ok(r.runner.apply("c1", { action: "parallel", ids: ["api", "ui"] }, { crew: AGENT }));
    const card = /** @type {any} */ (r.runner.offered("c1"));
    ok(r.runner.sideRun("c1", PICKS, { starts: "now", card: card.at }));
    assert.deepEqual(r.notices, []);
    assert.deepEqual(r.tells.map((d) => [d.text, d.wakes, d.about]), [["[Filament: the developer started api and ui on sub-agents; leave them — their reports come to you]", true, "card"]]);
  });

  // (fails before: yes — the hunt of side-card)
  test("Ignore from a page that had not heard the graph: refused once the agent started a task of the card — nothing marked", () => {
    const r = rig();
    ok(r.runner.apply("c1", { action: "parallel", ids: ["api", "ui"] }, { crew: AGENT }));
    const card = /** @type {any} */ (r.runner.offered("c1"));
    ok(r.runner.apply("c1", { action: "start", ids: ["api"] }, { crew: AGENT }));
    const late = r.runner.ignoreOffer("c1", card.at);
    assert.deepEqual([late.ok, /** @type {any} */ (late).error], [false, "that card is gone: its tasks were started, changed or ignored since, or another card took its place — nothing ignored; the Plan shows them as they are now"]);
    assert.deepEqual((r.g().told || []).filter((/** @type {string} */ m) => m.startsWith("ignored:")), [], "nothing marked");
  });

  test("side tasks start as forks of the planner where that pays — the running turn's word, else the registry's — and from their briefs where it does not, where the fork is refused, or in a coding agent's chat", () => {
    /** @param {any[]} launches */
    const how = (launches) => launches.map((l) => [l.task.id, l.view ?? "brief", l.model]);
    const pays = rig({ forkPays: true });
    ok(pays.runner.sideRun("c1", PICKS, { starts: "now" }));
    assert.deepEqual(how(pays.launches), [["api", "fork", "m-main"], ["ui", "fork", "m-main"]], "no turn runs: the registry's word on the last turn's request");
    const not = rig({ forkPays: false });
    ok(not.runner.sideRun("c1", PICKS, { starts: "now" }));
    assert.deepEqual(how(not.launches), [["api", "brief", "m-main"], ["ui", "brief", "m-main"]]);
    const refused = rig({ forkPays: true, refuseFork: true });
    ok(refused.runner.sideRun("c1", PICKS, { starts: "now" }));
    assert.deepEqual(how(refused.launches), [["api", "brief", "m-main"], ["ui", "brief", "m-main"]], "the fork refused, its brief");
    const turn = rig({ forkPays: false });
    turn.runner.attach("c1", { runId: "r1", cwd: "/p", mode: null, model: "m-main", thinking: null, team: null, forkable: () => true });
    ok(turn.runner.sideRun("c1", PICKS, { starts: "now" }));
    assert.deepEqual(how(turn.launches), [["api", "fork", "m-main"], ["ui", "fork", "m-main"]], "a running turn's own word, as its tasks hear it");
    const coder = rig({ forkPays: true });
    coder.runner.attach("c1", { runId: "r1", cwd: "/p", mode: null, model: "claude-code", thinking: null, team: null });
    ok(coder.runner.sideRun("c1", PICKS, { starts: "now" }));
    assert.deepEqual(how(coder.launches), [["api", "brief", "m-main"], ["ui", "brief", "m-main"]], "a coding agent's turn forks nothing");
  });
});

describe("the registry's word on a fork while no turn runs", () => {
  /** @param {{ agentOf?: (name: string) => any, tokens?: number }} [o] */
  const registry = ({ agentOf = () => null, tokens = 1_000 } = {}) => {
    const reg = createSubagentRegistry({
      now: () => T0,
      config: () => ({ agentLoop: { subagents: { slots: [{ upstream: "u", model: "m-main", n: 4 }] } } }),
      log: () => {},
      events: { publish: () => {} },
      runs: null,
      context: /** @type {any} */ ({
        card: () => null,
        settings: () => ({ model: { name: "m-main" }, subagents: { pool: [{ model: "m-main" }], most: 10, view: "none", ask: [] }, loop: { permissions: "edit" } }),
        session: () => ({ cwd: tmpdir(), model: "m-main", projectId: "p1" }),
        agentOf,
      }),
    });
    const snap = { body: { model: "m-main", tools: [{ name: "report" }], messages: [] }, headers: {}, sentAt: T0, ttlMs: 300_000, cached: true, tokens };
    const d = reg.openTurn({ chainId: "c1", runId: "turn-1", cwd: tmpdir(), mode: "edit", model: "m-main", thinking: null, fork: null, cache: () => snap });
    return { reg, d };
  };

  test("the turn's newest request is kept before what waited for its end runs: a side run started at the turn's end forks from it", () => {
    const { reg, d } = registry();
    assert.equal(reg.forkPays("c1"), false, "nothing kept while the turn runs");
    /** @type {boolean | null} */
    let seen = null;
    reg.afterTurn("c1", () => void (seen = reg.forkPays("c1")));
    d.close();
    assert.equal(seen, true);
    assert.equal(reg.forkPays("c1"), true);
  });

  test("never in a coding agent's chat, nor past half a fork's line", () => {
    const coder = registry({ agentOf: () => ({ id: "claude" }) });
    coder.d.close();
    assert.equal(coder.reg.forkPays("c1"), false);
    const big = registry({ tokens: 900_000 });
    big.d.close();
    assert.equal(big.reg.forkPays("c1"), false);
  });
});

describe("copies of a repository, one checkout at a time", () => {
  /** @param {string} cwd @param {string[]} args */
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();

  /**
   * A repository with enough files that a checkout takes a while: two at once would overlap. → its folder, its HEAD,
   * and whether a copy's checkout is under way (git's `locked` beside its record while `worktree add` runs).
   * @param {number} side  folders, and files in each
   */
  const bigRepo = (side) => {
    const dir = mkdtempSync(join(tmpdir(), "filament-side-wt-"));
    made.push(dir);
    git(dir, "init", "-q");
    git(dir, "config", "core.autocrlf", "false");
    for (let i = 0; i < side; i++) {
      mkdirSync(join(dir, `d${i}`));
      for (let j = 0; j < side; j++) writeFileSync(join(dir, `d${i}`, `f${j}.txt`), `${i}-${j}\n`.repeat(20));
    }
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "init");
    const records = join(dir, ".git", "worktrees");
    return { dir, head: git(dir, "rev-parse", "HEAD"), checkingOut: (/** @type {string} */ id) => existsSync(join(records, id, "locked")) };
  };
  /** Whether two copies' checkouts ever ran at once, watched until `stop`. @param {() => boolean} both */
  const watchBoth = (both) => {
    let seen = false;
    const t = setInterval(() => {
      if (both()) seen = true;
    }, 1);
    return () => (clearInterval(t), seen);
  };

  test("two copies taken at once check out one after the other, and the newest checkout's time is kept for the repository", async () => {
    const r = bigRepo(40);
    assert.equal(await lastCheckout(r.dir), null, "none checked out yet");
    const stop = watchBoth(() => r.checkingOut("wa") && r.checkingOut("wb"));
    const [a, b] = await Promise.all([takeTaskWorktree(r.dir, { id: "wa", commit: r.head, base: r.head }), takeTaskWorktree(r.dir, { id: "wb", commit: r.head, base: r.head })]);
    assert.equal(stop(), false, "never two checkouts at once");
    assert.ok(a.ok && b.ok, JSON.stringify([a, b]));
    const took = await lastCheckout(r.dir);
    assert.ok(took && took.ms >= 0 && took.at > 0, JSON.stringify(took));
  });

  // (fails before: yes — the review of 11-03: a copy stopped while it waited let go of the queue, and the next copy's
  // checkout ran beside the one under way)
  // (fails before: yes — it let 400 ms pass before it looked, and a checkout of 400 to 500 ms was over by then on a quiet
  // machine: it failed there, and where it passed the third came too late to run beside the first, so it passed with
  // the queue let go too)
  test("a copy stopped while it waits for its turn leaves the next one waiting for the checkout under way", async () => {
    const r = bigRepo(70);
    const stops = { wa: new AbortController(), wb: new AbortController() };
    const took = { wa: takeTaskWorktree(r.dir, { id: "wa", commit: r.head, base: r.head, signal: stops.wa.signal }), wb: takeTaskWorktree(r.dir, { id: "wb", commit: r.head, base: r.head, signal: stops.wb.signal }) };
    const first = /** @type {"wa" | "wb"} */ (await until(() => (r.checkingOut("wa") ? "wa" : r.checkingOut("wb") ? "wb" : null), "a checkout under way", { timeoutMs: 60_000 }));
    const waits = first === "wa" ? "wb" : "wa";
    // The other is in the queue once it listens for its stop, which a taking does nowhere before its turn's wait: stopped
    // there, as the first's checkout begins. No stretch of time is let pass: a checkout may be over in it, and the
    // third must come while the first has its files still to write.
    await until(() => getEventListeners(stops[waits].signal, "abort").length > 0, "the other to wait for its turn", { timeoutMs: 60_000 });
    assert.ok(r.checkingOut(first) && !r.checkingOut(waits), "one checks out, the other waits");
    stops[waits].abort();
    assert.deepEqual(await took[waits], { ok: false, error: "it was stopped while its copy was made", kind: "failed" });
    assert.ok(r.checkingOut(first), "the first still checks out as the third comes");
    const stop = watchBoth(() => r.checkingOut(first) && r.checkingOut("wc"));
    const third = await takeTaskWorktree(r.dir, { id: "wc", commit: r.head, base: r.head });
    assert.equal(stop(), false, "the third waited for the first");
    assert.ok(third.ok && (await took[first]).ok);
  });
});

describe("the page", () => {
  test("the card's folders and its Accept's body, and its line on a slow checkout", () => {
    assert.equal("parallelWordsOf" in offerWords, false, "the box reads no /parallel");
    assert.equal(slowCheckoutWords(null), "");
    assert.equal(slowCheckoutWords(SLOW_CHECKOUT_MS - 1), "");
    assert.equal(slowCheckoutWords(34_400), "The last copy of this folder took 34 s to check out, and copies are made one at a time: these may take a while to start.");
    assert.match(slowCheckoutWords(180_000), /took 3 minutes to check out/);
    assert.deepEqual([sideFolderOf({ writes: ["a.js"] }, { repo: true, worktree: true }), sideFolderOf({ writes: ["a.js"] }, { repo: false, worktree: true }), sideFolderOf({ writes: [] }, { repo: true, worktree: true })], ["copy", "yours", "yours"]);
    const offer = { at: T0, tasks: [{ id: "api", writes: ["a.js"] }, { id: "look", writes: [] }] };
    assert.deepEqual(acceptBody(offer, "m-main", { repo: true, worktree: true, turn: false }), { starts: "now", offer: T0, tasks: [{ id: "api", model: "m-main", folder: "copy" }, { id: "look", model: "m-main", folder: "yours" }] });
    // (fails before: yes — the review of side-now: mid-turn the card's Accept waited for the turn's end, which the sheet no
    // longer does, so a turn that built a whole plan held them for hours)
    assert.equal(acceptBody(offer, "m-main", { repo: true, worktree: true, turn: true }).starts, "now", "mid-turn: now, as the sheet starts them");
  });

  // (fails before: yes — the review of 11-03: every writer went to its own copy in a repository, whatever the chat said)
  test("a chat whose editing sub-agents work in its folder starts the card's writers there too, as the Plan page's sheet does", () => {
    assert.equal(sideFolderOf({ writes: ["a.js"] }, { repo: true, worktree: false }), "yours");
    assert.deepEqual(acceptBody({ at: T0, tasks: [{ id: "api", writes: ["a.js"] }] }, "m-main", { repo: true, worktree: false, turn: false }).tasks, [{ id: "api", model: "m-main", folder: "yours" }]);
  });

  // (fails before: yes — the review of 11-03: the card took the chat's model alone, where the sheet falls back on the box's)
  test("the card's model is the chat's, else the box's in the chat shown, as the side-run sheet's", () => {
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    assert.match(app, /sideActions\.model = \(chainId\) => \{\s+const chat = chatByChain\(chainId\);\s+return baseModelOf\(chat\?\.model \|\| \(chat && chat === chatOf\(state\.currentId\) \? composer\.modelName\(\) : ""\) \|\| ""\);\s+\};/);
  });

  test("a /parallel message of before 11-10's row still says so, and its line is no message from agents", () => {
    const doc = stubDocument();
    try {
      assert.equal(/** @type {any} */ (parallelEl({ parallel: true }))?.textContent, "/parallel · for your agent to re-plan");
      assert.equal(parallelEl({}), null);
      assert.equal(deliveredWords({ deliveries: 1, parallel: true }), "");
      assert.equal(deliveredWords({ deliveries: 2, parallel: true }), "with 1 message from agents");
    } finally {
      doc.restore();
    }
  });

  test("the card's row stands after the turn that offered it, once", () => {
    const turns = [{ n: 1, boundaries: [], boundariesAfter: [] }, { n: 2, boundaries: [], boundariesAfter: [] }];
    const mark = { type: "side", at: T0, afterTurn: 1, ids: ["api", "ui"], tasks: [] };
    assert.equal(placeBoundary(turns, mark), turns[1]);
    assert.equal(placeBoundary(turns, { ...mark }), null, "the feed's and the read's are one row");
    assert.equal(turns[1].boundaries.length, 1);
  });

  describe("the card", () => {
    /** @type {ReturnType<typeof stubDocument>} */
    let doc;
    before(() => {
      doc = stubDocument();
    });
    after(() => {
      Object.assign(sideActions, { offer: null, watch: null, model: null, facts: null, accept: null, ignore: null, said: null });
      doc.restore();
    });
    const settle = () => new Promise((r) => setImmediate(r));
    const MARK = { type: /** @type {const} */ ("side"), at: T0, afterTurn: 2, turn: 2, ids: ["api", "ui"], tasks: [{ id: "api", name: "The route", writes: ["src/http/a.js"] }, { id: "ui", name: "The card", writes: ["src/ui/card.js"] }] };
    /** @param {any} el @param {string} words */
    const press = (el, words) => el.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === words);

    test("its tasks, their files, the model and where each works; a slow checkout said in a line; Accept starts them all through the side run, and the card goes", async () => {
      /** @type {any[]} */
      const did = [];
      /** @type {Set<() => void>} */
      const watchers = new Set();
      let now = { known: false, at: /** @type {number | null} */ (null) };
      Object.assign(sideActions, {
        offer: () => now,
        watch: (/** @type {() => void} */ fn) => (watchers.add(fn), () => watchers.delete(fn)),
        model: () => "claude-opus-5-5",
        facts: async () => ({ max: 4, running: 0, turn: false, repo: true, worktree: true, checkoutMs: 34_000 }),
        accept: async (/** @type {string} */ c, /** @type {any} */ body) => (did.push(["accept", c, body]), { ok: true, started: ["api", "ui"], later: false, refused: [] }),
        ignore: async (/** @type {string} */ c, /** @type {number} */ at) => void did.push(["ignore", c, at]),
        said: (/** @type {string} */ w) => void did.push(["said", w]),
      });
      const row = /** @type {any} */ (sideOfferRow(MARK, "c1"));
      await settle();
      const text = row.textContent;
      for (const words of ["Your agent suggests running two tasks in parallel","apiThe routewrites a.js · own copy", "uiThe cardwrites card.js · own copy", `On ${prettyModel("claude-opus-5-5")}, your agent's model. Each result comes to your agent as a report, and your agent applies it.`, "The last copy of this folder took 34 s to check out, and copies are made one at a time"])
        assert.ok(text.includes(words), `${words} in ${text}`);
      assert.equal(press(row, "Accept").hasAttribute("disabled"), false);
      press(row, "Accept").dispatch("click");
      await settle();
      assert.deepEqual(did, [["accept", "c1", { starts: "now", offer: T0, tasks: [{ id: "api", model: "claude-opus-5-5", folder: "copy" }, { id: "ui", model: "claude-opus-5-5", folder: "copy" }] }], ["said", "Started api and ui on sub-agents"]]);
      assert.ok(row.classList.contains("hidden"), "answered: it goes");
      // Another card: one the graph heard since offers another, and it leaves.
      const other = /** @type {any} */ (sideOfferRow({ ...MARK, at: T0 + 5 }, "c1"));
      assert.equal(other.classList.contains("hidden"), false);
      now = { known: true, at: T0 + 9 };
      for (const fn of watchers) fn();
      assert.ok(other.classList.contains("hidden"), "a newer card took its place");
    });

    test("Ignore clears it; one gone already leaves too, and another refusal is said on the card", async () => {
      /** @type {any[]} */
      const did = [];
      /** @type {string[]} */
      const toasts = [];
      let refusal = /** @type {any} */ (null);
      Object.assign(sideActions, {
        offer: () => ({ known: true, at: T0 }),
        watch: () => () => {},
        model: () => "m-main",
        facts: async () => ({ max: 4, running: 0, turn: false, repo: false, worktree: true, checkoutMs: null }),
        accept: async () => ({}),
        ignore: async (/** @type {string} */ c, /** @type {number} */ at) => {
          did.push([c, at]);
          if (refusal) throw refusal;
        },
        said: (/** @type {string} */ w) => void toasts.push(w),
      });
      // Another chat's card: the room read for the card before is that card's.
      const row = /** @type {any} */ (sideOfferRow(MARK, "c2"));
      await settle();
      assert.ok(row.textContent.includes("writes a.js · your folder"), "no git repository: no copy");
      assert.equal(row.textContent.includes("took"), false, "no slow checkout known: no line");
      press(row, "Ignore").dispatch("click");
      await settle();
      assert.deepEqual([did, row.classList.contains("hidden")], [[["c2", T0]], true]);
      assert.deepEqual(toasts, [], "cleared: nothing to say");
      refusal = Object.assign(new Error("HTTP 409"), { status: 409, body: { error: "that card is gone: its tasks were started, changed or ignored since, or another card took its place — nothing ignored; the Plan shows them as they are now" } });
      const gone = /** @type {any} */ (sideOfferRow(MARK, "c2"));
      press(gone, "Ignore").dispatch("click");
      await settle();
      assert.ok(gone.classList.contains("hidden"));
      // (fails before: yes — the hunt of side-card: the card left in silence, as if its Ignore had taken)
      assert.deepEqual(toasts, ["that card is gone: its tasks were started, changed or ignored since, or another card took its place — nothing ignored; the Plan shows them as they are now"], "gone: it says nothing was ignored, once");
      refusal = Object.assign(new Error("Filament is not reachable"), { status: 0 });
      const kept = /** @type {any} */ (sideOfferRow(MARK, "c2"));
      press(kept, "Ignore").dispatch("click");
      await settle();
      assert.deepEqual([kept.classList.contains("hidden"), kept.textContent.includes("Not cleared: Filament is not reachable")], [false, true]);
    });

    // (fails before: yes — the owner's of 11-06: the card said nothing of whether the agent waited on it, and an Accept
    // pressed after the card stood no more said its refusal on a card that stayed)
    // (fails before: yes — the owner's of 11-14: the card said the agent went on with its work, and nothing of its 60 seconds)
    test("it says the agent does none of its tasks' work until it is answered, and that it answers itself in 60 seconds; an Accept refused because its card stands no more leaves, its words said once; another refusal stays on the card", async () => {
      /** @type {any[]} */
      const did = [];
      let refusal = /** @type {any} */ (Object.assign(new Error("HTTP 409"), { status: 409, body: { error: "that card is gone: its tasks were started, changed or ignored since, or another card took its place — nothing started; the Plan shows them as they are now", gone: true } }));
      Object.assign(sideActions, {
        offer: () => ({ known: false, at: null }),
        watch: () => () => {},
        model: () => "m-main",
        facts: async () => ({ max: 4, running: 0, turn: false, repo: false, worktree: true, checkoutMs: null }),
        accept: async (/** @type {string} */ _c, /** @type {any} */ body) => {
          did.push(body.offer);
          throw refusal;
        },
        ignore: async () => {},
        said: (/** @type {string} */ w) => void did.push(w),
      });
      const row = /** @type {any} */ (sideOfferRow(MARK, "c-late"));
      await settle();
      assert.ok(row.textContent.includes("Your agent does none of these tasks' work until you answer: it goes on with work of its own. With no answer, the card answers itself in 60 seconds, and it leaves as soon as any of these tasks is started, dropped or re-planned."), row.textContent);
      press(row, "Accept").dispatch("click");
      await settle();
      await settle();
      assert.deepEqual(did, [T0, "that card is gone: its tasks were started, changed or ignored since, or another card took its place — nothing started; the Plan shows them as they are now"], "the card named; its words said once");
      assert.ok(row.classList.contains("hidden"), "it leaves");
      refusal = Object.assign(new Error("only 1 sub-agent may run at once in this chat"), { status: 409, body: { error: "only 1 sub-agent may run at once in this chat" } });
      const kept = /** @type {any} */ (sideOfferRow(MARK, "c-late"));
      await settle();
      press(kept, "Accept").dispatch("click");
      await settle();
      await settle();
      assert.deepEqual([kept.classList.contains("hidden"), kept.textContent.includes("Nothing started: only 1 sub-agent may run at once in this chat")], [false, true]);
    });

    /**
     * The app's side of a card whose chat's room the test moves: each read takes the next of `reads` (the last stands
     * after), and what Accept asked is kept.
     * @param {any[]} reads @param {{ model?: string }} [o]
     */
    const moving = (reads, { model = "m-main" } = {}) => {
      /** @type {any[]} */
      const accepted = [];
      /** @type {Set<() => void>} */
      const watchers = new Set();
      let n = 0;
      Object.assign(sideActions, {
        offer: () => ({ known: true, at: T0 }),
        watch: (/** @type {() => void} */ fn) => (watchers.add(fn), () => watchers.delete(fn)),
        model: () => model,
        facts: async () => ({ max: 4, running: 0, turn: false, repo: true, worktree: true, checkoutMs: null, ...reads[Math.min(n++, reads.length - 1)] }),
        accept: async (/** @type {string} */ _c, /** @type {any} */ body) => (accepted.push(body), { ok: true, started: ["api", "ui"], later: body.starts === "turn", refused: [] }),
        ignore: async () => {},
        said: () => {},
      });
      return { accepted, reads: () => n, heard: () => watchers.forEach((fn) => fn()) };
    };

    // (fails before: yes — the review of 11-03: a card drawn while the chat's room was full kept Accept off until the
    // chat was drawn again, and Accept decided from the read the card was drawn with)
    test("a room full when the card was drawn leaves Accept on: its press reads the room again, and says so where it is full still", async () => {
      const app = moving([{ running: 4 }, { running: 4 }, { running: 1 }]);
      const row = /** @type {any} */ (sideOfferRow(MARK, "c3"));
      await settle();
      assert.ok(row.textContent.includes("4 at once here · 4 run · none fits now — wait for one to finish"), row.textContent);
      assert.equal(press(row, "Accept").hasAttribute("disabled"), false, "the room may have room by the press");
      press(row, "Accept").dispatch("click");
      await settle();
      assert.deepEqual([app.reads(), app.accepted.length], [2, 0], "read again at the press, and full still: nothing asked");
      assert.ok(row.textContent.includes("Nothing started: 4 at once here · 4 run · none fits now — wait for one to finish"));
      press(row, "Accept").dispatch("click");
      await settle();
      assert.deepEqual([app.reads(), app.accepted.length, row.classList.contains("hidden")], [3, 1, true], "a sub-agent ended since: both start");
    });

    // (fails before: yes — the review of side-now: a turn begun since the card was drawn held them until it ended, where
    // the Plan page's sheet starts them now)
    test("a turn begun since the card was drawn: Accept starts them now, as the sheet does", async () => {
      const app = moving([{ turn: false }, { turn: true }]);
      const row = /** @type {any} */ (sideOfferRow(MARK, "c4"));
      await settle();
      press(row, "Accept").dispatch("click");
      await settle();
      assert.deepEqual(app.accepted, [{ starts: "now", offer: T0, tasks: [{ id: "api", model: "m-main", folder: "copy" }, { id: "ui", model: "m-main", folder: "copy" }] }]);
    });

    // (fails before: yes — the review of 11-03: the room was read once, when the row was built)
    test("the graph heard again reads the room again, at most every couple of seconds, and the card says what it found", async () => {
      const app = moving([{ running: 4 }, { running: 0 }]);
      const row = /** @type {any} */ (sideOfferRow(MARK, "c5"));
      await settle();
      assert.ok(row.textContent.includes("none fits now"));
      app.heard();
      app.heard();
      await settle();
      assert.equal(app.reads(), 1, "not again at once");
      await new Promise((r) => setTimeout(r, Number(/** @type {any} */ (offerCard).REFRESH_MS) + 200 || 200));
      await settle();
      assert.equal(app.reads(), 2, "once, for both");
      assert.equal(row.textContent.includes("none fits now"), false, row.textContent);
    });

    // (fails before: yes — the review of 11-03: with no model, Accept was off and nothing said why)
    test("a chat that names no model: the card says why Accept is off", async () => {
      moving([{}], { model: "" });
      const row = /** @type {any} */ (sideOfferRow(MARK, "c6"));
      await settle();
      assert.ok(row.textContent.includes(String(/** @type {any} */ (offerWords).NO_MODEL_WORDS)), row.textContent);
      assert.ok(press(row, "Accept").hasAttribute("disabled"));
    });
  });
});

describe("end to end: the agent's suggestion through a real Filament", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** The newest user message's text blocks. @param {any} body @returns {string[]} */
  const lastTexts = (body) => {
    const last = [...(body?.messages || [])].reverse().find((/** @type {any} */ m) => m.role === "user");
    return Array.isArray(last?.content) ? last.content.filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => String(b.text)) : [String(last?.content ?? "")];
  };
  /** Whether a request's newest message carries a tool's result. @param {any} body @param {string} id */
  const resultOf = (body, id) => (body?.messages?.at(-1)?.content || []).some?.((/** @type {any} */ b) => b?.type === "tool_result" && b.tool_use_id === id);
  /** The words of a tool's result in the newest request that carries it. @param {string} id */
  const resultText = (id) => {
    const call = [...up.received].reverse().find((c) => resultOf(c.body, id));
    const b = (call?.body?.messages?.at(-1)?.content || []).find((/** @type {any} */ x) => x?.type === "tool_result" && x.tool_use_id === id);
    return typeof b?.content === "string" ? b.content : (b?.content || []).filter((/** @type {any} */ x) => x.type === "text").map((/** @type {any} */ x) => x.text).join("");
  };
  /** @param {any[]} blocks @param {string} [stop] */
  const reply = (blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks });
  /** The agent's suggestion, as a tasks call. @param {string} id */
  const suggestCall = (id) => reply([{ type: "tool_use", id, name: "tasks", input: { action: "parallel", ids: ["api", "ui"] } }], "tool_use");
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-parallel-e2e-"));
    made.push(root);
    up = await fakeUpstream(async (call) => {
      const body = call.body || {};
      const tools = (body.tools || []).map((/** @type {any} */ t) => t.name);
      if (!tools.length) return anthropicReply("A title", { model: "brain-model" });
      // A side task's sub-agent: it reports, and is done.
      if (!tools.includes("ask")) {
        if (tools.includes("report") && !resultOf(body, "rep")) return reply([{ type: "tool_use", id: "rep", name: "report", input: { status: "done", did: "Done.", met: true, evidence: "looked", left: "" } }], "tool_use");
        return reply([{ type: "text", text: "Done." }]);
      }
      const texts = lastTexts(body);
      if (resultOf(body, "sug") || resultOf(body, "sug2")) return reply([{ type: "text", text: "Suggested api and ui." }]);
      // The work laid out, then the tasks that can run side by side suggested, as its answer says.
      if (resultOf(body, "plan")) return suggestCall("sug");
      if (texts.some((t) => t.includes("split the card work")))
        return reply([{ type: "tool_use", id: "plan", name: "tasks", input: { action: "add", goal: "Ship the card", tasks: ADD.tasks.map(({ check, ...t }) => t) } }], "tool_use");
      // The person's own words, never Filament's note of an Ignore, which says when to suggest again.
      if (texts.some((t) => t.trim() === "suggest them again")) return suggestCall("sug2");
      return reply([{ type: "text", text: "ok" }]);
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        // brain-words takes no tools: its row on the Upstreams page says so.
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-words": { tools: false } } }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
    made.push(shim.dataDir);
  });
  /** A new chat on `model`: its turns' path. @param {string} model */
  const chat = async (model) => {
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model, preset: "plain", settings: { loop: { permissions: "auto" } } } });
    assert.equal(created.status, 200, await created.clone().text());
    return `/api/sessions/${encodeURIComponent(String((await created.json()).id))}`;
  };
  /** A turn of the chat at `path`, its reply whole. @param {string} path @param {Record<string, any>} body */
  const send = async (path, body) => {
    const r = await shim.api(`${path}/turns`, { method: "POST", body: { stream: false, ...body } });
    assert.equal(r.status, 200, await r.clone().text());
    return r;
  };

  // (fails before: yes — the owner's of 11-09: Parallelize tasks on is the person's consent, so no card asks them; the
  // owner's of 11-10: the agent's suggestion is refused then, and it starts them itself)
  test("Parallelize tasks on: the tasks answer says to start them now, the agent's suggestion is refused, and no card is drawn", async () => {
    const on = await shim.api("/api/config/fields", { method: "PATCH", body: { set: { "experimental.parallelizeTasks": true } } });
    assert.equal(on.status, 200, await on.clone().text());
    try {
      up.reset();
      const path = await chat("agent/brain-model");
      await send(path, { content: "split the card work" });
      assert.match(resultText("plan"), /\nThe graph lets api and ui run side by side: none needs another's work\. Whether they should is your call[^\n]* If so, Parallelize tasks is on, so run them at once now: change them to by: sub-agent/);
      assert.match(resultText("sug"), /Parallelize tasks is on — the person's consent: no card asks them/);
      const transcript = async () => (await shim.api(`${path}/transcript`)).json();
      await until(async () => (await transcript()).turns.some((/** @type {any} */ t) => t.n === 1 && t.status !== "open"), "the turn on record");
      const cards = ((await transcript()).boundaries || []).filter((/** @type {any} */ b) => b.type === "side");
      assert.deepEqual([cards, (await (await shim.api(path)).json()).inForce?.graph?.offer], [[], undefined]);
    } finally {
      await shim.api("/api/config/fields", { method: "PATCH", body: { set: { "experimental.parallelizeTasks": false } } });
    }
  });

  // (fails before: yes — the owner's of 11-10: /parallel is gone; the box sends it as typed, with no line ahead of it)
  test("/parallel is no command any more: the message goes as typed, with no Filament line ahead of it", async () => {
    up.reset();
    const r = await send(await chat("agent/brain-model"), { content: "/parallel", parallel: true });
    assert.equal(r.headers.get("x-filament-parallel"), null);
    assert.equal(up.received.some((c) => lastTexts(c.body).some((t) => t.startsWith("[Filament: the person typed /parallel"))), false);
  });

  // (fails before: yes — the review of 11-03: on Filament's loop, a model that takes no tools was told to use its flow tool)
  test("a model that takes no tools: /flow's line says it has none", async () => {
    const path = await chat("agent/brain-words");
    up.reset();
    await send(path, { content: "plan the release", flow: true });
    const flow = up.received.map((c) => lastTexts(c.body)[0] || "").find((t) => t.startsWith("[Filament: the developer typed /flow"));
    assert.match(String(flow), /this chat's model takes no tools, so you cannot draw it\. Say so: the person draws it by hand in the Agents tab, under Flows, or runs this chat on a model that takes tools; you may describe/);
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
  });

  test("the agent's answer says to suggest them, its suggestion draws the card after its turn, Ignore clears it for good, a suggestion again brings it back, Accept starts the tasks", async () => {
    const path = await chat("agent/brain-model");
    const transcript = async () => (await shim.api(`${path}/transcript`)).json();
    const cards = async () => ((await transcript()).boundaries || []).filter((/** @type {any} */ b) => b.type === "side");
    const graphNow = async () => (await (await shim.api(path)).json()).inForce?.graph;

    up.reset();
    await send(path, { content: "split the card work" });
    assert.match(resultText("plan"), /\nThe graph lets api and ui run side by side: none needs another's work\. Whether they should is your call[^\n]* If so, suggest them to the person: \{"action":"parallel","ids":\["api","ui"\]\}/);
    assert.match(resultText("sug"), /^Suggested api and ui to the person on a card in the chat/);
    await until(async () => (await cards()).length === 1, "the card after the turn");
    const [card] = await cards();
    assert.deepEqual([card.ids, card.afterTurn, card.tasks.map((/** @type {any} */ t) => t.writes[0])], [["api", "ui"], 1, ["src/http/a.js", "src/ui/card.js"]]);
    const facts = await (await shim.api(`${path}/graph/side-run`)).json();
    assert.deepEqual([facts.repo, facts.checkoutMs], [false, null], "no git: no copies, no checkout known");

    // Ignore: refused for another card; for its own, gone for good — a read does not bring it back, nor a turn's end.
    assert.equal((await shim.api(`${path}/graph/side-offer/ignore`, { method: "POST", body: { at: card.at + 1 } })).status, 409);
    const ignored = await shim.api(`${path}/graph/side-offer/ignore`, { method: "POST", body: { at: card.at } });
    assert.equal(ignored.status, 200, await ignored.clone().text());
    assert.equal((await ignored.json()).graph.offer, undefined);
    assert.deepEqual(await cards(), []);
    await send(path, { content: "carry on" });
    await until(async () => (await transcript()).turns.some((/** @type {any} */ t) => t.n === 2 && t.status !== "open"), "the second turn on record");
    assert.deepEqual([await cards(), (await graphNow())?.offer], [[], undefined], "no turn's end offers it by itself");
    assert.ok(up.received.some((c) => JSON.stringify(c.body?.messages || []).includes("the person ignored the card that suggested api and ui: they stay yours")), "the agent hears of the Ignore");

    // The person asks again in words: the agent suggests them, and the card comes back after that turn.
    await send(path, { content: "suggest them again" });
    await until(async () => (await cards()).length === 1, "the card after the third turn");
    const again = (await cards())[0];
    assert.equal(again.afterTurn, 3);

    // An Accept that names the card ignored before — a page that had not heard the graph since —: nothing starts.
    const stale = await shim.api(`${path}/graph/side-run`, { method: "POST", body: { starts: "now", offer: card.at, tasks: [{ id: "api", model: "brain-model", folder: "yours" }, { id: "ui", model: "brain-model", folder: "yours" }] } });
    assert.equal(stale.status, 409);
    assert.deepEqual(await stale.json(), { error: "that card is gone: its tasks were started, changed or ignored since, or another card took its place — nothing started; the Plan shows them as they are now", gone: true });
    assert.equal((await cards()).length, 1, "the card that stands, stands");
    // Accept: the side run claims them, the card goes, and their sub-agents report.
    const accepted = await shim.api(`${path}/graph/side-run`, { method: "POST", body: { starts: "now", offer: again.at, tasks: [{ id: "api", model: "brain-model", folder: "yours" }, { id: "ui", model: "brain-model", folder: "yours" }] } });
    assert.equal(accepted.status, 200, await accepted.clone().text());
    const out = await accepted.json();
    assert.deepEqual([out.started, out.graph.offer], [["api", "ui"], undefined]);
    assert.deepEqual(await cards(), []);
    await until(async () => {
      const g = await graphNow();
      return ["api", "ui"].every((t) => g?.tasks.find((/** @type {any} */ x) => x.id === t)?.state !== "running");
    }, "both side tasks reported", { timeoutMs: 30_000 });
  });
});
