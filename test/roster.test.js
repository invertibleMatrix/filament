// @ts-check
// HarnessV4_Tasks E15 step 6: a team is a lead's card and the workers' cards it hands work to. The roster's rules
// (core/roster.js: who writes, who reviews, who takes a task another planner named, a worker's stamp, a team as the
// page lists it); the sentences a lead reads of its members (app/agent/roster-words.js: the four that ship keep the
// words written for them, any other list reads words written from its cards); the lead's tools frozen per list of
// members; and the task graph under a team of the developer's own — what it asks of a task, whom a kept task goes to,
// and what it refuses in the members' words. The four shipped teams' own words are pinned in task-graph-team.test.js
// and team-lead.test.js; here is everything that is true only of another list.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  SHIPPED_MEMBERS, builderOf, doesWords, isShippedRoster, memberOf, reviewerOf, reviews, scoutOf, teamRow, workerOf, writes,
} from "../src/core/roster.js";
import { SHIPPED_ROSTER_WORDS, rosterKey, rosterWords } from "../src/app/agent/roster-words.js";
import { LEAD_TASKS_TOOL, TEAM_AGENT_TOOL, WORKER_TOOL, launchKey, leadLaunchKey, leadToolsOf } from "../src/app/agent/tools.js";
import { createAgentTurns } from "../src/app/agent-inbox.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import * as tg from "../src/core/task-graph.js";
import { graphCrew, teamMembersOf } from "../src/services/session-settings.js";
import { MEMBERS as FOUR } from "./helpers/roster.js";
import { teamStore } from "./helpers/team.js";

/** @typedef {import("../src/core/roster.js").Member} Member */
/** @param {string} tag @param {string} name @param {"read" | "copy" | "edit"} may @param {string | null} place @param {string} goodFor @param {string} [line] @returns {Member} */
const M = (tag, name, may, place, goodFor, line = "") => ({ tag, name, goodFor, may, place, line, model: null });
const BUILDER = M("builder", "Builder", "edit", "builder", "Makes one change, and only that", "Plain words.");
const TRANSLATOR = M("translator", "Translator", "copy", null, "Turns a page into another language.");
const PROOF = M("proofreader", "Proofreader", "read", "reviewer", "Reads a change: what holds, what breaks, what is missing");
/** A team of the developer's own: one member that changes files, one that works in its own copy, one that reviews. */
const DOCS = Object.freeze([BUILDER, TRANSLATOR, PROOF]);
/** One with two members that change files and nobody to review. */
const PAIR = Object.freeze([FOUR[1], FOUR[2]]);
/** One with a single member, which changes nothing. */
const LOOK = Object.freeze([FOUR[0]]);

describe("the roster's rules (core/roster.js)", () => {
  // (fails before: yes — step 6: a team's four roles were words in a table; nothing asked a card what it may do)
  test("who the four that ship are, who writes, who reviews, and a member by its tag", () => {
    assert.deepEqual([...SHIPPED_MEMBERS], ["scout", "builder", "tester", "reviewer"]);
    assert.deepEqual([isShippedRoster(FOUR), isShippedRoster([...FOUR].reverse()), isShippedRoster(FOUR.slice(0, 3)), isShippedRoster(DOCS), isShippedRoster([])], [true, false, false, false, false],
      "the four, in their order: the lead then reads the words written for them");
    // (fails before: yes — "Teams, improved and kept" of 11-03: the four were four cards, matched by their tags alone)
    assert.equal(isShippedRoster(FOUR.map((m) => ({ ...m, card: undefined }))), false, "the four's ids on cards of those tags are another crew: the Scout and the Tester sit on Reviewer and Builder");
    assert.deepEqual(FOUR.map(writes), [false, true, true, false]);
    assert.deepEqual(DOCS.map(writes), [true, false, false], "a member that works in its own copy keeps nothing: it does not write");
    assert.deepEqual([writes(null), writes(undefined), reviews(null, DOCS)], [false, false, false]);
    assert.deepEqual(DOCS.map((m) => reviews(m, DOCS)), [false, false, true], "a copy of Reviewer under another tag reviews");
    // (fails before: yes — the same: the Scout sits in Reviewer's place, and the first in that place was the reviewer)
    assert.deepEqual(FOUR.map((m) => reviews(m, FOUR)), [false, false, false, true], "a seat named for other work reviews no change where Reviewer sits under its own name");
    const pair = [FOUR[0], { ...FOUR[0], tag: "checker", name: "Checker" }];
    assert.deepEqual(pair.map((m) => reviews(m, pair)), [true, true], "where every seat of Reviewer is named, each reviews");
    assert.deepEqual([memberOf(DOCS, "translator"), memberOf(DOCS, "scout"), memberOf(DOCS, undefined)], [TRANSLATOR, null, null]);
    assert.deepEqual([reviewerOf(FOUR)?.tag, reviewerOf(DOCS)?.tag, reviewerOf(PAIR)], ["reviewer", "proofreader", null], "a team without one has no review step");
    assert.deepEqual(DOCS.map(doesWords), ["changes files", "works in its own copy, and nothing it changes is kept", "changes nothing"]);
  });

  // (fails before: yes — step 6: a task the agent planned went to "builder" or "scout" by name, which another team may not have)
  test("who takes a task another planner named: the team's Builder where it changes files, else its first member that does; its Scout where it reads, else its first that changes none", () => {
    assert.deepEqual([builderOf(FOUR)?.tag, scoutOf(FOUR)?.tag], ["builder", "scout"]);
    // (fails before: yes — the review of 11-03: with no seat beside it in Reviewer's place, the explorer was the first
    // member that changes nothing — End user, the Translator — where the reviewer reads)
    assert.deepEqual([builderOf(DOCS)?.tag, scoutOf(DOCS)?.tag], ["builder", "proofreader"], "no Scout: the reviewer, which reads");
    const enduser = M("enduser", "End user", "read", "enduser", "Uses it as the person it is for would");
    assert.equal(scoutOf([BUILDER, FOUR[3], enduser])?.tag, "reviewer", "Reviewer explores, not End user");
    assert.equal(scoutOf([BUILDER, enduser])?.tag, "enduser", "no seat in Reviewer's place: the first member that changes nothing");
    const editor = M("editor", "Editor", "edit", null, "Edits prose");
    assert.equal(builderOf([PROOF, editor, M("fixer", "Fixer", "edit", null, "Fixes what breaks")])?.tag, "editor", "no Builder: the first member that edits, in the team's order");
    assert.equal(builderOf([FOUR[2], BUILDER])?.tag, "builder", "a Builder wins over a member listed before it");
    const reader = M("reader", "Reader", "read", "builder", "A copy of Builder that may only read");
    assert.equal(builderOf([reader, editor])?.tag, "editor", "Builder's place alone is not enough: it must edit");
    assert.deepEqual([builderOf(LOOK), scoutOf(PAIR)], [null, null], "no member can take it");
    const writer = M("spy", "Spy", "edit", "reviewer", "A copy of Reviewer that edits");
    assert.equal(scoutOf([writer, PROOF])?.tag, "proofreader", "a member that changes files never explores");
    // (fails before: yes — "Teams, improved and kept" of 11-03: a task to explore went to the member in Scout's place,
    // and one to change files to the first in Builder's)
    assert.equal(scoutOf([FOUR[3], FOUR[0]])?.tag, "scout", "the reviewer reviews: a reading task goes to the Scout's seat, listed after it");
    assert.equal(scoutOf([FOUR[3]])?.tag, "reviewer", "with no other reader, the reviewer reads");
    assert.equal(builderOf([FOUR[2], FOUR[1]])?.tag, "builder", "Builder under its own name before the Tester's seat, listed after it");
  });

  // (fails before: yes — step 6: a worker's stamp was its team and role; nothing said which shipped worker its card was)
  test("a worker's stamp: its team, its member's tag and place, and the team's own line for it; a team as the page lists it", () => {
    const team = { key: "docs", name: "Docs", line: "Is it worth building", shipped: false, lead: { tag: "pm", name: "PM" }, persona: "You think as a product manager.", members: DOCS };
    assert.deepEqual(workerOf(team, "builder"), { key: "docs", name: "Docs", role: "builder", place: "builder", words: "Plain words." });
    assert.deepEqual(workerOf(team, "proofreader"), { key: "docs", name: "Docs", role: "proofreader", place: "reviewer", words: "" });
    assert.deepEqual(workerOf(team, "gone"), { key: "docs", name: "Docs", role: "gone", place: null, words: "" }, "a tag the team no longer has: its tag alone");
    assert.deepEqual(teamRow(team), {
      // (the plan's p6: its check — none for a team that names none)
      key: "docs", name: "Docs", line: "Is it worth building", shipped: false, check: null, lead: { tag: "pm", name: "PM" },
      members: [
        { tag: "builder", name: "Builder", may: "edit", place: "builder" },
        { tag: "translator", name: "Translator", may: "copy", place: null },
        { tag: "proofreader", name: "Proofreader", may: "read", place: "reviewer" },
      ],
      // (fails before: yes — team_v2_plan §5.3: a team beside's fire card says its lead's model, read-only, its workers' models)
      leadModel: null,
      leadModels: [],
      readOnly: false,
      models: [],
    }, "no persona and no member's words: the page reads those where a team is opened");
  });
});

describe("the sentences that name a team's members (roster-words.js)", () => {
  // (fails before: yes — step 6, AG-171: there was one set of words, for four roles)
  test("the four that ship read the words written for them, the same object every time; any other list is kept under a word of its own", () => {
    assert.equal(rosterWords(FOUR), SHIPPED_ROSTER_WORDS);
    assert.equal(rosterWords([...FOUR]), SHIPPED_ROSTER_WORDS, "by its tags in order, not by the list's identity");
    assert.equal(rosterKey(FOUR), "");
    const key = rosterKey(DOCS);
    assert.ok(key && key === rosterKey([...DOCS]));
    assert.equal(rosterWords(DOCS), rosterWords([...DOCS]), "frozen once per list of members");
    assert.ok(Object.isFrozen(rosterWords(DOCS)));
    // Each thing the words are written from moves the word: the tag, the card's name and line, what it may do, its place.
    for (const change of [{ tag: "builder2" }, { name: "Maker" }, { goodFor: "Makes" }, { may: /** @type {"read"} */ ("read") }, { place: null }])
      assert.notEqual(rosterKey([{ ...BUILDER, ...change }, TRANSLATOR, PROOF]), key, JSON.stringify(change));
    assert.equal(rosterKey([{ ...BUILDER, line: "Other words.", model: "m-1" }, TRANSLATOR, PROOF]), key, "a team's own line and a card's model are no part of these sentences");
    assert.notEqual(rosterKey([...FOUR].reverse()), "", "the four in another order are another list");
    assert.notEqual(rosterKey([]), "", "an empty list is never taken for the four that ship");
  });

  // (fails before: yes — step 6: a team of yours had no words: its lead would have read of a scout it does not have)
  test("a team of yours: one line per member from its card, and the sentences that named a builder and a tester name the members that change files", () => {
    const w = rosterWords(DOCS);
    assert.equal(w.roles, [
      "as one of your team's workers, named by its tag:",
      "  - `builder` (Builder): Makes one change, and only that. It changes files.",
      "  - `translator` (Translator): Turns a page into another language. It works in its own copy, and nothing it changes is kept.",
      "  - `proofreader` (Proofreader): Reads a change: what holds, what breaks, what is missing. It changes nothing.",
    ].join("\n"), "a card's line that ends itself gets no second stop");
    assert.equal(w.worktree, "- `builder` works in its own git worktree when the folder is a repository: its changes reach the folder only when you apply them — worker with its agent_id and apply_changes: true. Apply only work whose report shows its acceptance check passed, or that another worker confirmed.");
    // HarnessV3-TaskGraph-v2 TG2-D46: a member changes files, so a check Filament runs is spoken of, and the claim says what it is not.
    assert.equal(w.check, "- Put the commands that prove a task done in check, and the others it needs in may_run: in the worker's own worktree they run without anyone's answer, and Filament runs the check itself once the worker reports — a failing one goes back to the worker, twice at most, before you hear. Where you can, have a failing test written first, and make it the check of the work that makes it pass.");
    assert.equal(w.claim, "- A report is a claim; a check Filament ran is not. Read every change before you apply it, and check what the report says beyond its check: read what changed, or have another worker read the diff or run the check.");
    assert.equal(w.graphBy, "the worker of your team that does it, by its tag");
    assert.equal(w.graphTask, "- Give every task its worker, a goal, its steps in order and its acceptance check, and a task of `builder` the files it writes. Filament starts its worker by itself once its needs are done and a slot is free, briefs it from these fields, your team's words for that worker and what the tasks it needs reported; a change that reports done with its check passed waits in its worktree until you apply it. With review: true `proofreader` reads that change first, and the changes it asks go back to the same worker, two rounds at most. You do not start or finish a task yourself.");
    assert.equal(w.toolRoles, "as one of your team's workers, with the session's hands and MCP servers: builder (changes files), translator (works in its own copy, and nothing it changes is kept), proofreader (changes nothing).");
    assert.equal(w.toolWorktree, "`builder` works in its own git worktree when the folder is a repository: its changes reach your folder only when you apply them (worker with apply_changes: true). A review, for `proofreader`, names the worker whose change, not applied yet, it reads ahead of its brief.");
    assert.equal(w.applies, "applies the changes a worker made in its own git worktree to your folder");
    assert.equal(w.tasksBy, "by (the tag of the worker that does it),");
    assert.equal(w.tasksWho, "`translator` and `proofreader` change nothing that is kept, and name no writes. `builder` changes the files its writes name; with review: true, `proofreader` reads the change before it merges, and the changes it asks go back to the same worker, two rounds at most.");
    assert.equal(w.tasksBrief, "in your team's words for that worker");
    assert.equal(w.roleField, "One of your team's workers, by its tag. `builder` (Builder): Makes one change, and only that. It changes files. `translator` (Translator): Turns a page into another language. It works in its own copy, and nothing it changes is kept. `proofreader` (Proofreader): Reads a change: what holds, what breaks, what is missing. It changes nothing.");
    assert.equal(w.reviewField, "For `proofreader` only: the agent_id of the worker whose change, made in its own worktree and not applied yet, it reads ahead of its brief.");
    assert.equal(w.byField, "The worker that does it, by its tag, required: builder (it changes the files in writes), translator (it names no writes), proofreader (it names no writes).");
    assert.equal(w.reviewTaskField, "A task of `builder`: true, and `proofreader` reads its change before it merges; the changes it asks go back to the same worker, two rounds at most.");
    assert.deepEqual(Object.keys(w).sort(), Object.keys(SHIPPED_ROSTER_WORDS).sort(), "the same parts as the four's: prompt.js and tools.js put each where its sentence stands");
  });

  // (fails before: yes — step 6: a team with no reviewer, or with nobody that changes files, could not be said)
  test("a team with no reviewer takes no review; a team where nobody changes files has nothing to apply; one member alone is checked by reading", () => {
    const pair = rosterWords(PAIR);
    assert.equal(pair.worktree, "- `builder` and `tester` work in their own git worktree when the folder is a repository: their changes reach the folder only when you apply them — worker with their agent_id and apply_changes: true. Apply only work whose report shows its acceptance check passed, or that another worker confirmed.");
    assert.ok(pair.graphTask.includes(", and a task of `builder` or `tester` the files it writes. ") && pair.graphTask.endsWith(" No worker of your team reviews, so no task takes a review. You do not start or finish a task yourself."), pair.graphTask);
    assert.equal(pair.toolWorktree, "`builder` and `tester` work in their own git worktree when the folder is a repository: their changes reach your folder only when you apply them (worker with apply_changes: true).");
    assert.equal(pair.tasksWho, "`builder` and `tester` change the files their writes name.");
    assert.deepEqual([pair.reviewField, pair.reviewTaskField], [null, null], "no such field: there is nobody to review");
    const look = rosterWords(LOOK);
    assert.equal(look.worktree, "- No worker of your team changes the project's files: there is nothing to apply, and what a worker reports is what its task yields.");
    assert.equal(look.claim, "- A report is a claim. Check it before anything builds on it: read what changed.");
    assert.equal(look.check, null, "nobody changes files: no worktree to run a check in");
    assert.equal(look.graphTask, "- Give every task its worker, a goal, its steps in order and its acceptance check. Filament starts its worker by itself once its needs are done and a slot is free, briefs it from these fields, your team's words for that worker and what the tasks it needs reported. You do not start or finish a task yourself.");
    assert.equal(look.toolWorktree, "No worker of your team changes the project's files.");
    assert.equal(look.tasksWho, "`scout` changes nothing that is kept, and names no writes.");
    assert.equal(look.byField, "The worker that does it, by its tag, required: scout (it names no writes).");
    assert.deepEqual([look.reviewField, look.reviewTaskField], [null, null]);
    // A reviewer with nobody whose change it could read: no review either.
    assert.deepEqual([rosterWords([TRANSLATOR, PROOF]).reviewField, rosterWords([TRANSLATOR, PROOF]).reviewTaskField], [null, null]);
  });
});

describe("a lead's tools, frozen per list of members", () => {
  // (fails before: yes — step 6: a lead's agent tool offered four roles whoever its team was)
  test("the four that ship keep the module's own tools; another list has the same tools in its own words, naming its members' tags", () => {
    const shipped = leadToolsOf(FOUR);
    assert.deepEqual([shipped.agent === TEAM_AGENT_TOOL, shipped.worker === WORKER_TOOL, shipped.tasks === LEAD_TASKS_TOOL], [true, true, true]);
    assert.equal(leadToolsOf(null), shipped, "no list named: the four's");
    assert.equal(leadToolsOf([...FOUR]), shipped);
    const docs = leadToolsOf(DOCS);
    assert.equal(leadToolsOf([...DOCS]), docs, "frozen once per list");
    assert.notEqual(docs.agent, TEAM_AGENT_TOOL);
    const props = /** @type {any} */ (docs.agent.input_schema.properties);
    assert.deepEqual(props.role.enum, ["builder", "translator", "proofreader"]);
    assert.equal(props.role.description, rosterWords(DOCS).roleField);
    assert.equal(props.review.description, rosterWords(DOCS).reviewField);
    assert.ok(docs.agent.description.includes(rosterWords(DOCS).toolRoles) && docs.agent.description.includes(rosterWords(DOCS).toolWorktree), docs.agent.description);
    assert.ok(docs.worker.description.includes("applies the changes a worker made in its own git worktree to your folder"), docs.worker.description);
    const task = /** @type {any} */ (docs.tasks.input_schema.properties.tasks.items.properties);
    // Beside the members, a task Filament runs itself (HarnessV3-TaskGraph-v2 V2-3).
    assert.deepEqual([task.by.enum, task.by.description.startsWith(`${rosterWords(DOCS).byField} Or command: Filament runs the task's run itself`), task.review.description], [["builder", "translator", "proofreader", "command"], true, rosterWords(DOCS).reviewTaskField]);
    assert.ok(docs.tasks.description.includes(rosterWords(DOCS).tasksWho), docs.tasks.description);
    // With nobody to review, neither tool has a review field.
    const pair = leadToolsOf(PAIR);
    assert.equal("review" in /** @type {any} */ (pair.agent.input_schema.properties), false);
    assert.equal("review" in /** @type {any} */ (pair.tasks.input_schema.properties.tasks.items.properties), false);
    // The rest of each tool is the four's: only the members' parts differ.
    const same = (/** @type {any} */ a, /** @type {any} */ b) => assert.deepEqual(Object.keys(a.input_schema.properties).sort(), Object.keys(b.input_schema.properties).sort());
    same(docs.agent, TEAM_AGENT_TOOL);
    same(docs.tasks, LEAD_TASKS_TOOL);
    assert.deepEqual(docs.own.map((t) => t.name), shipped.own.map((t) => t.name));
  });

  // (fails before: yes — step 6: a coding agent that leads opened its session under a word that knew nothing of its team's members)
  test("a lead's tools as one word: whom it may ask, and — for another list of members — who they are", () => {
    const pm = { tag: "pm", name: "PM", goodFor: "Is it worth building", kind: /** @type {"lead"} */ ("lead"), may: /** @type {"read"} */ ("read"), from: null };
    assert.equal(leadLaunchKey([], FOUR), "", "nothing offered beyond the four's own tools");
    assert.equal(leadLaunchKey([], null), "");
    assert.equal(leadLaunchKey([pm], FOUR), launchKey({ asks: [pm] }), "the four that ship add nothing to the word");
    const docs = leadLaunchKey([], DOCS);
    assert.ok(/^[0-9a-f]{16}$/.test(docs), docs);
    assert.equal(leadLaunchKey([], [...DOCS]), docs);
    assert.notEqual(leadLaunchKey([], PAIR), docs, "another team's members: another word, so the session takes other tools");
    assert.notEqual(leadLaunchKey([pm], DOCS), docs);
    assert.notEqual(leadLaunchKey([pm], DOCS), leadLaunchKey([pm], FOUR));
  });

  // (fails before: yes — the owner's first Bug Hunter run, 10-19: its lead gave its hunters check and may_run, which its
  // tool offered, and all five launches were refused; it launched them again without)
  test("a team no member of which changes files: its lead's agent tool has no check, may_run nor attempts to give", () => {
    const look = /** @type {any} */ (leadToolsOf(LOOK).agent.input_schema.properties);
    assert.deepEqual(["check", "may_run", "attempts"].map((k) => k in look), [false, false, false]);
    assert.ok(look.acceptance && look.steps && look.goal, "the brief's own parts stay");
    const docs = /** @type {any} */ (leadToolsOf(DOCS).agent.input_schema.properties);
    assert.deepEqual(["check", "may_run", "attempts"].map((k) => k in docs), [true, true, true], "one that changes files: as before");
  });
});

describe("a coding agent that leads a team of yours", () => {
  // (fails before: yes — step 6: Filament's tools for a coding agent that leads named four roles whoever its team was)
  test("Filament's tools for it name its team's members — its agent tool, its tasks — and the leads its session lets it ask beside them", () => {
    const pm = { tag: "pm", name: "PM", goodFor: "Is it worth building", kind: /** @type {"lead"} */ ("lead"), may: /** @type {"read"} */ ("read"), from: null };
    const helper = { tag: "translator", name: "Translator", goodFor: "Puts strings into German", kind: /** @type {"worker"} */ ("worker"), may: /** @type {"edit"} */ ("edit"), from: null };
    /** @type {Record<string, readonly Member[] | null>} */
    const answers = { c1: DOCS, c2: FOUR, c3: null };
    /** @type {string[]} */
    const read = [];
    const tools = createAgentTools({
      memory: null, memoryToolsOn: () => false, graphs: () => null, turns: createAgentTurns(),
      subagents: () => /** @type {any} */ ({ offer: () => null, asks: (/** @type {string} */ chain) => (chain === "c1" ? [pm, helper] : []) }),
      membersOf: (chain) => (read.push(chain), answers[chain]),
    });
    /** @param {string} chain @param {Record<string, any>} [ctx] */
    const list = (chain, ctx = {}) => tools.list(/** @type {any} */ ({ chain, turn: null, graph: true, report: false, cwd: "/w", upstream: "cli", team: true, ...ctx }));
    // The lead keeps the chat's checklist after its tasks (the owner's tool plan of 11-08).
    const [tasks, checklist, agent, worker, wait] = list("c1");
    assert.deepEqual([tasks.name, checklist.name, agent.name, worker.name, wait.name], ["tasks", "checklist", "agent", "worker", "wait"]);
    assert.deepEqual(agent.inputSchema.properties.role.enum, ["builder", "translator", "proofreader", "pm"], "its members, then the leads it may ask: a worker the session names is not a lead's to launch");
    assert.equal(agent.inputSchema.properties.role.description, `${rosterWords(DOCS).roleField} Or a saved agent's tag, to ask it as its card says.`);
    assert.deepEqual(agent.inputSchema.required, ["role", "description", "goal"]);
    assert.deepEqual(tasks.inputSchema.properties.tasks.items.properties.by.enum, ["builder", "translator", "proofreader", "command"]);
    assert.equal(worker.description, leadToolsOf(DOCS).worker.description);
    assert.equal(list("c1", { reads: true })[3].description, leadToolsOf(DOCS).workerReadsOwn.description, "one that reads along with its workers");
    // The four that ship, and a session whose team is not found: the module's own tools.
    for (const chain of ["c2", "c3"]) {
      const [t, , a] = list(chain);
      assert.deepEqual([a.description, a.inputSchema.properties.role.enum, t.description], [TEAM_AGENT_TOOL.description, ["scout", "builder", "tester", "reviewer"], LEAD_TASKS_TOOL.description], chain);
    }
    // A plain chat asks no team's members: its graph and its checklist.
    read.length = 0;
    assert.deepEqual(list("c1", { team: false }).map((t) => t.name), ["tasks", "checklist"]);
    assert.deepEqual(read, [], "who the members are is asked only where a team answers");
  });
});

describe("the task graph under a team of yours", () => {
  const BRIEF = { goal: "It is done", steps: ["Do it"], acceptance: "the check passes" };
  /** @param {any} g @param {any} input @param {tg.Crew} crew */
  const apply = (g, input, crew) => tg.applyTasks(g, input, { at: 1000, crew });
  /** A refusal's words. @param {any} g @param {any} input @param {tg.Crew} crew */
  const no = (g, input, crew) => {
    const r = apply(g, input, crew);
    assert.equal(r.ok, false, "refused");
    return r.ok ? "" : r.error;
  };
  /** @param {any} g @param {any} input @param {tg.Crew} crew @returns {any} */
  const ok = (g, input, crew) => {
    const r = apply(g, input, crew);
    assert.ok(r.ok, r.ok ? "" : r.error);
    return r;
  };
  const add = (/** @type {any[]} */ tasks, /** @type {tg.Crew} */ crew) => no(null, { action: "add", goal: "Ship the docs", tasks }, crew);

  // (fails before: yes — step 6: `by` was one of four words whoever the team's members were)
  test("a task names a member by its tag: who it may be, what a member that changes nothing may not name, and who reviews", () => {
    assert.equal(add([{ id: "t1", name: "Write it", ...BRIEF }], DOCS), "t1: by is required: the worker of your team that does the task, by its tag — builder, translator, proofreader — or command, for a task Filament runs itself");
    assert.equal(add([{ id: "t1", name: "Write it", by: "scout", ...BRIEF }], DOCS), "t1: by is who does the task — builder, translator, proofreader — or command, for a task Filament runs itself", "a shipped worker's tag is no word here unless the team has it");
    assert.equal(add([{ id: "t1", name: "Put it in French", by: "translator", writes: ["docs/fr.md"], ...BRIEF }], DOCS),
      "t1: a translator works in its own copy, and nothing it changes is kept, so it names no writes — give the task to a builder to change files");
    assert.equal(add([{ id: "t1", name: "Read it", by: "proofreader", writes: ["docs/a.md"], ...BRIEF }], DOCS),
      "t1: a proofreader changes nothing, so it names no writes — give the task to a builder to change files");
    assert.equal(add([{ id: "t1", name: "Look", by: "scout", writes: ["a.md"], ...BRIEF }], LOOK), "t1: a scout changes nothing, so it names no writes — no worker of your team changes files");
    assert.equal(add([{ id: "t1", name: "Put it in French", by: "translator", review: true, ...BRIEF }], DOCS), "t1: review is a builder's: a proofreader reads the change it makes before it merges");
    assert.equal(add([{ id: "t1", name: "Fix it", by: "builder", writes: ["a.js"], review: true, ...BRIEF }], PAIR), "t1: review needs a worker that reviews, and your team has none: leave review out");
    assert.equal(add([{ id: "t1", name: "Write it", by: "builder", ...BRIEF }], DOCS), "t1: a builder's task needs writes: the files it changes, so tasks that run at once stay apart");
    // What goes through: a copy member's task with no writes, a builder's with a review by the team's reviewer.
    const g = ok(null, { action: "add", goal: "Ship the docs", tasks: [
      { id: "t1", name: "Put it in French", by: "translator", ...BRIEF },
      { id: "t2", name: "Write it", by: "builder", writes: ["docs/a.md"], review: true, needs: ["t1"], ...BRIEF },
    ] }, DOCS).graph;
    assert.deepEqual(g.tasks.map((/** @type {any} */ t) => [t.id, t.by, t.review]), [["t1", "translator", false], ["t2", "builder", true]]);
    const shown = ok(g, { action: "show", id: "t2" }, DOCS).text;
    assert.ok(shown.includes("Review: a proofreader of your team reads its change before it merges, 2 rounds at most"), shown);
    assert.ok(ok(g, { action: "show", id: "t1" }, DOCS).text.includes("a translator of your team, which works in its own copy, and nothing it changes is kept"));
  });

  // (fails before: yes — step 6: a graph the agent planned, or another team's, went to roles the team that leads may not have)
  test("a kept task under another team: the member that takes it, or none — said where it is listed, and refused where it is started", () => {
    const kept = { by: /** @type {tg.TaskBy} */ ("sub-agent"), writes: ["a.js"] };
    const read = { by: /** @type {tg.TaskBy} */ ("explorer"), writes: [] };
    assert.deepEqual([tg.runsAs(kept, DOCS), tg.runsAs(read, DOCS), tg.runsAs(kept, PAIR), tg.runsAs(read, PAIR), tg.runsAs(kept, LOOK), tg.runsAs(read, LOOK)],
      ["builder", "proofreader", "builder", null, null, "scout"]);
    assert.deepEqual([tg.runsAs({ by: "tester", writes: ["t.js"] }, DOCS), tg.runsAs({ by: "scout", writes: [] }, DOCS), tg.runsAs({ by: "translator", writes: [] }, DOCS), tg.runsAs({ by: "you", writes: [] }, DOCS)],
      ["builder", "proofreader", "translator", "you"], "another team's member by what its task does; this team's own by its tag; the agent's own stays its own");
    assert.deepEqual([tg.runsAs({ by: "builder", writes: ["a.js"] }, "agent"), tg.runsAs({ by: "scout", writes: [] }, "agent"), tg.runsAs(kept, "agent")], ["sub-agent", "explorer", "sub-agent"],
      "back under the agent: a sub-agent where it changes files, an explorer where it reads");
    // The agent planned three tasks; a team with nobody that changes files now leads.
    const g = ok(null, { action: "add", goal: "Ship it", tasks: [
      { id: "t1", name: "Map it", by: "explorer", ...BRIEF },
      { id: "t2", name: "Fix it", by: "sub-agent", writes: ["a.js"], needs: ["t1"], ...BRIEF },
      { id: "t3", name: "Release", needs: ["t2"] },
    ] }, "agent").graph;
    /** One task whole, as the lead reads it. @param {string} id */
    const whole = (id) => ok(g, { action: "show", id }, LOOK).text;
    assert.ok(whole("t1").includes("By: an explorer as the agent planned it (a scout of your team does it under you) — Filament starts it"), whole("t1"));
    assert.ok(whole("t2").includes("By: a sub-agent as another planner named it (no worker of your team can take it: give it to one with tasks change, or drop it)"), whole("t2"));
    assert.ok(tg.showText(g, LOOK).includes("the agent's own: give it to a worker, or drop it"), tg.showText(g, LOOK));
    assert.ok(tg.showText(g, FOUR).includes("the agent's own: give it a role, or drop it"), "under the four that ship, the words written for them");
    assert.equal(no(g, { action: "start", ids: ["t2"] }, LOOK), "t2 is a sub-agent's task, and no worker of your team changes files — give it to a worker (tasks change with by), or drop it");
    assert.equal(no(g, { action: "start", ids: ["t3"] }, LOOK), "t3 is the agent's own task, and a lead does no work itself — give it to a worker (tasks change with by), and Filament starts its worker");
    assert.equal(no(g, { action: "start", ids: ["t3"] }, FOUR), "t3 is the agent's own task, and a lead does no work itself — give it a role (tasks change with by), and Filament starts its worker");
    // A team with nobody that changes none: a reading task has no taker.
    const reads = ok(null, { action: "add", goal: "Ship it", tasks: [{ id: "t1", name: "Map it", by: "explorer", ...BRIEF }] }, "agent").graph;
    reads.tasks[0].stopped = "developer";
    assert.equal(no(reads, { action: "start", ids: ["t1"] }, PAIR), "t1 is an explorer's task, and no worker of your team does a task that changes none — give it to a worker (tasks change with by), or drop it");
  });
});

describe("the members of the team that answers a session", () => {
  // (fails before: yes — step 6: who planned a graph was the word "team": the graph could not ask who the members were)
  test("a session a team answers reads that team's members; the agent's own session, or an engine that names no team there is, reads none", () => {
    const teams = teamStore();
    teams.create({ name: "Docs", lead: "product", members: [{ tag: "builder", line: "Plain words." }, { tag: "reviewer" }] });
    const docs = teamMembersOf({ engine: { mode: "team", team: "docs" } }, teams);
    assert.deepEqual(docs?.map((m) => [m.tag, m.name, m.may, m.place, m.line]), [["builder", "Builder", "edit", "builder", "Plain words."], ["reviewer", "Reviewer", "read", "reviewer", ""]]);
    assert.deepEqual(teamMembersOf({ engine: { mode: "team", team: "Docs" } }, teams), docs, "by its name as written");
    assert.equal(rosterWords(teamMembersOf({ engine: { mode: "team", team: "Docs" } }, teams) || []), rosterWords(docs || []), "read again from the cards each time, and the same words");
    assert.equal(isShippedRoster(teamMembersOf({ engine: { mode: "team", team: "builders" } }, teams) || []), true);
    assert.deepEqual([teamMembersOf({ engine: { mode: "model", team: "docs" } }, teams), teamMembersOf({ engine: { mode: "team", team: "gone" } }, teams), teamMembersOf({ engine: { mode: "team" } }, teams), teamMembersOf(null, teams), teamMembersOf({ engine: { mode: "team", team: "docs" } })],
      [null, null, null, null, null]);
    assert.deepEqual(graphCrew({ engine: { mode: "team", team: "docs" } }, teams), docs);
    assert.deepEqual([graphCrew({ engine: { mode: "team", team: "gone" } }, teams), graphCrew({}, teams), graphCrew(null)], ["agent", "agent", "agent"]);
  });
});
