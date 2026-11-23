// @ts-check
// HarnessV3-Views V3, the page: who works on a session, in the words the Team view, the dock, the Team widget and the
// conversation share (lib/team.js) — the team that leads, each card's state and order, the tab's badge, why a switch
// waits and what it costs, where the engine changes, the lead's orders — and the sub-agent store taking each running
// one's progress off the events feed. HarnessV3-TaskGraph G3: a team's tasks in those words — the tasks still to come,
// who plans the graph.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  leadWord, leadsWords, memberIcon, memberOf, runByLine, runByWords, teamOf, whoOf, whoOfTask, teamIcon, leadingTeam, cardState, cardOrder, teamBadge, teamWork, switchWait, rebuildCost, engineDividers, engineStamp,
  leadingSince, compactionCount, orderRows, leaderWaits, leaderState, newestWords, askWords, askKey, waitWords, timesWords, cardFigures,
} from "../src/ui/harness/lib/team.js";
import * as team from "../src/ui/harness/lib/team.js";
import { alignEvents, turnStateWords } from "../src/ui/harness/lib/labels.js";
import { endFromList, listEndsKey, mergeProgress, roundWords } from "../src/ui/harness/lib/subagents.js";
import { roundRows } from "../src/ui/harness/conversation/tools/render.js";
import { chipActions, statusOf } from "../src/ui/harness/conversation/tools/layout.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { readFileSync } from "node:fs";
import { SHIPPED_CREW } from "../src/core/roster.js";

/** The members every shipped team has, as the settings answer names them: Reviewer seated as the Scout, Builder, Builder seated as the Tester, Reviewer. */
const FOUR = [
  { tag: "scout", card: "reviewer", name: "Scout", may: "read", place: "reviewer" },
  { tag: "builder", name: "Builder", may: "edit", place: "builder" },
  { tag: "tester", card: "builder", name: "Tester", may: "edit", place: "builder" },
  { tag: "reviewer", name: "Reviewer", may: "read", place: "reviewer" },
];
/** A team of the developer's own: Product in charge of Builder, a Translator and a copy of Reviewer. */
const CREW = [
  { tag: "builder", name: "Builder", may: "edit", place: "builder" },
  { tag: "translator", name: "Translator", may: "copy", place: null },
  { tag: "proofreader", name: "Proofreader", may: "read", place: "reviewer" },
  { tag: "reader", name: "Reader", may: "read", place: null },
];
/** The four as the page draws a team's members: by tag, name, level and place — a seat's card is its place. */
const DRAWN = FOUR.map((m) => ({ tag: m.tag, name: m.name, may: m.may, place: m.place }));
// Builders, the one shipped team that builds, and a team of yours.
const TEAMS = [
  { key: "builders", name: "Builders", line: "Builds it with its workers: planned, run in parallel where it can, each claim checked", shipped: true, lead: { tag: "buildlead", name: "Builders" }, members: FOUR },
  { key: "my-crew", name: "My Crew", line: "We ship small.", shipped: false, lead: { tag: "product", name: "Product" }, members: CREW },
];
/** A sub-agent's card opened as Find opens one, with no press to remember: its calls' rows are drawn only while it
 *  stands open (render.js `placeCalls`). @param {any} el  the card's row */
const opened = (el) => {
  el.open = true;
  el.dispatch("toggle");
  return el;
};

/** A sub-agent row as the list route answers it. @param {Record<string, any>} o */
const row = (o) => ({ id: "sa_1", status: "running", startedAt: 1000, team: null, progress: null, exchanges: [{ startedAt: 1000, endedAt: null }], ...o });

describe("who leads, and the glyphs", () => {
  // (fails before: yes — there was no Team view to say who leads)
  test("a team leads while the engine names one: its name, line and glyph, its lead and its members; a problem is said; otherwise your agent", () => {
    assert.deepEqual(leadingTeam({ mode: "team", team: "builders", teams: TEAMS, problem: null }), { key: "builders", name: "Builders", line: "Builds it with its workers: planned, run in parallel where it can, each claim checked", icon: "wrench", problem: null, lead: { tag: "buildlead", name: "Builders" }, members: DRAWN });
    assert.deepEqual(leadingTeam({ mode: "team", team: "my-crew", teams: TEAMS, problem: "the agent loop is off" }), { key: "my-crew", name: "My Crew", line: "We ship small.", icon: "users", problem: "the agent loop is off", lead: { tag: "product", name: "Product" }, members: CREW });
    // (fails before: yes — step 6: a team the list had lost had no lead and no members for the page to draw)
    assert.deepEqual(leadingTeam({ mode: "team", team: "gone", teams: TEAMS }), { key: "gone", name: "gone", line: "", icon: "users", problem: null, lead: { tag: "", name: "gone" }, members: [] }, "a team the list no longer has names itself by its key");
    // A key Filament does not ship (the plan's p6) is its key and the server's words alone: nothing converted.
    const gone = "engine.team names `architect`, which is no team — Builders does Architect's work: pick Builders (/team lists them)";
    assert.deepEqual(leadingTeam({ mode: "team", team: "architect", teams: TEAMS, problem: gone }), { key: "architect", name: "architect", line: "", icon: "users", problem: gone, lead: { tag: "", name: "architect" }, members: [] });
    assert.equal(leadingTeam({ mode: "agent", team: "builders", teams: TEAMS }), null);
    assert.equal(leadingTeam({ mode: "team", team: null, teams: TEAMS }), null);
    assert.equal(leadingTeam(null), null);
    assert.deepEqual(engineStamp({ mode: "team", team: "builders", teams: TEAMS }), { kind: "team", team: "builders", name: "Builders" });
    assert.equal(engineStamp({ mode: "team", team: "builders", teams: TEAMS, problem: "no loop" }), null, "a team that cannot lead stamps nothing");
  });

  // (fails before: yes — step 6: a glyph was a role's, one of four words; a member of a team of yours had none)
  test("a member's glyph and the teams': its place's — a copy of Reviewer wears the eye — else by what it may do; shipped teams their own, a saved one people", () => {
    assert.deepEqual(FOUR.map(memberIcon), ["eye", "hammer", "hammer", "eye"], "each seat its card's: the Scout Reviewer's eye, the Tester Builder's hammer");
    assert.deepEqual(CREW.map(memberIcon), ["hammer", "hammer", "eye", "search"], "a copy changes files of its own: the hammer; one that only reads: the glass");
    assert.deepEqual([memberIcon(null), memberIcon({ place: "constructor", may: "read" })], ["hammer", "search"], "a place that is no shipped worker's, an inherited name too, gives no glyph");
    assert.deepEqual([memberOf(CREW, "translator")?.name, memberOf(CREW, "scout"), memberOf(null, "scout")], ["Translator", null, null]);
    // (the plan's p6) Builders wears its own; a key gone, people — BugHunters the bug, the Bug Hunter's and the
    // Verifier's keys gone with them.
    assert.deepEqual(["builders", "bughunters", "bug-hunter", "verifier", "architect", "my-crew", "constructor"].map(teamIcon), ["wrench", "bug", "users", "users", "users", "users", "users"]);
  });

  // (fails before: yes — step 6: a task's "who" was a role's word; a Translator's task read "translator" under the bot)
  test("who does a graph task: a member under its card's name and glyph; a shipped tag with no list at hand; a tag the team lost as written; else the agent's own", () => {
    assert.deepEqual(whoOfTask("translator", CREW), { word: "Translator", icon: "hammer", worker: true });
    assert.deepEqual(whoOfTask("proofreader", CREW), { word: "Proofreader", icon: "eye", worker: true });
    assert.deepEqual(["builder", "reviewer"].map((t) => whoOfTask(t)), [{ word: "Builder", icon: "hammer", worker: true }, { word: "Reviewer", icon: "eye", worker: true }]);
    // A seat's id is no card's tag: the Plan hands the view its team's members, and with none at hand the crew every
    // shipped team seats, as the settings answer gives it.
    assert.deepEqual(["scout", "tester"].map((t) => whoOfTask(t, FOUR)), [{ word: "Scout", icon: "eye", worker: true }, { word: "Tester", icon: "hammer", worker: true }]);
    // (fails before: yes — the review of 11-03: with no member list, a seat's id stood as written under the bot)
    assert.deepEqual(["scout", "tester"].map((t) => whoOfTask(t, null, SHIPPED_CREW)), [{ word: "Scout", icon: "eye", worker: true }, { word: "Tester", icon: "hammer", worker: true }], "its seat's name, its card's glyph");
    assert.deepEqual(whoOfTask("scout", CREW, SHIPPED_CREW), { word: "Scout", icon: "eye", worker: true }, "a kept task under a team of yours, as a shipped tag is");
    assert.deepEqual(["builder", "reviewer"].map((t) => whoOfTask(t, null, SHIPPED_CREW).word), ["Builder", "Reviewer"]);
    assert.deepEqual(["scout", "tester"].map((t) => whoOfTask(t)), [{ word: "scout", icon: "bot", worker: true }, { word: "tester", icon: "bot", worker: true }], "with neither at hand, as written");
    assert.deepEqual(whoOfTask("reviewer", CREW), { word: "Reviewer", icon: "eye", worker: true }, "a kept task under another team: its shipped tag still says who it was");
    assert.deepEqual(whoOfTask("auditor", CREW), { word: "auditor", icon: "bot", worker: true }, "a tag the team no longer has stands as written");
    assert.deepEqual([whoOfTask("explorer", CREW), whoOfTask("sub-agent", CREW), whoOfTask("you"), whoOfTask(undefined), whoOfTask("constructor")], [
      { word: "Explorer", icon: "search", worker: false }, { word: "Agent", icon: "bot", worker: false }, { word: "Agent", icon: "bot", worker: false },
      { word: "Agent", icon: "bot", worker: false }, { word: "constructor", icon: "bot", worker: true },
    ]);
  });

  // (fails before: yes — a card had no one to say it was: a team's worker read as any sub-agent)
  test("who a card says it is: a team's worker by its member's card; else the card it runs as, one that only reads under the glass", () => {
    assert.deepEqual(whoOf({ team: { team: "architect", role: "tester", place: "builder", seat: "Tester" }, card: { tag: "builder", name: "Builder" }, may: "edit" }), { word: "Tester", icon: "hammer", worker: true });
    // (fails before: yes — step 6: a member that is no shipped worker read as any sub-agent, under the bot)
    assert.deepEqual(whoOf({ team: { role: "translator", place: null }, card: { tag: "translator", name: "Translator" }, may: "copy" }), { word: "Translator", icon: "hammer", worker: true });
    assert.deepEqual(whoOf({ team: { role: "proofreader", place: "reviewer" }, card: { tag: "proofreader", name: "Proofreader" }, may: "read" }), { word: "Proofreader", icon: "eye", worker: true }, "a copy of Reviewer wears the eye");
    assert.deepEqual(whoOf({ team: { role: "builder" }, may: "edit" }), { word: "Builder", icon: "hammer", worker: true }, "a row read before its card, with no place stamped: its shipped tag says who it is");
    assert.deepEqual(whoOf({ team: { role: "reader" }, may: "read" }), { word: "reader", icon: "search", worker: true }, "and a tag that is no shipped worker's stands as written");
    // (fails before: yes — step 4: any sub-agent outside a team read "Explorer" or "Sub-agent", whatever card it ran as)
    assert.deepEqual(whoOf({ card: { tag: "reviewer", name: "Reviewer" }, may: "read", team: null }), { word: "Reviewer", icon: "search", worker: false });
    assert.deepEqual(whoOf({ may: "read" }), { word: "Explorer", icon: "search", worker: false }, "a row read before its card");
    assert.deepEqual(whoOf(null), { word: "Agent", icon: "bot", worker: false });
  });

  // (fails before: yes — step 6: nothing on the page said who runs a session a team leads)
  test("who runs it, in words: Run by the lead with its members; the lead's card's head; a team's card", () => {
    const [build, crew] = TEAMS.map((t) => teamOf(t, t.key));
    assert.equal(runByWords(build), "Run by Builders, with Scout, Builder, Tester, Reviewer");
    assert.equal(runByLine(build), "Run by Builders, with Scout, Builder, Tester, Reviewer. Builds it with its workers: planned, run in parallel where it can, each claim checked.");
    assert.equal(runByLine(crew), "Run by Product, with Builder, Translator, Proofreader, Reader. We ship small.", "a line that ends itself gets no second stop");
    assert.equal(runByLine(teamOf(null, "gone")), "Run by gone.", "a team the list lost: its key, no members, no line");
    assert.deepEqual([leadsWords(build), leadsWords(crew)], ["Builders leads Scout, Builder, Tester, Reviewer", "Product leads Builder, Translator, Proofreader, Reader"]);
    assert.deepEqual([leadWord(build), leadWord(crew)], ["Builders lead", "Product · My Crew lead"]);
  });
});

describe("the cards", () => {
  // (fails before: yes — a card's state had no word: the list knew running and ended, never asking)
  test("a card's state: asking while its call waits, running, done, a failure or a cut-off failed, any other end stopped", () => {
    assert.equal(cardState(row({ progress: { asking: { tool: "bash", args: "npm test", question: "?" } } })), "asking");
    assert.equal(cardState(row({ progress: { asking: null } })), "running");
    assert.equal(cardState(row({ status: "done" })), "done");
    assert.equal(cardState(row({ status: "failed" })), "failed");
    assert.equal(cardState(row({ status: "aborted" })), "failed");
    assert.equal(cardState(row({ status: "stopped" })), "stopped");
    assert.equal(cardState(row({ status: "budget-stopped" })), "stopped");
  });

  // (fails before: yes — the G3f drive: a task's builder, ended while a reviewer read its change, said done on its
  // card, and running again for the fix, while the Plan view said in review)
  test("a graph task's worker, once it ended, wears its task's state while the task is in review or failed; its own otherwise", () => {
    const ended = row({ id: "w2", status: "done", task: "t2" });
    /** @param {string} state @param {string} [agent] */
    const t2 = (state, agent = "w2") => ({ id: "t2", agent, state });
    assert.deepEqual(
      [cardState(ended, t2("review")), cardState(ended, t2("failed")), cardState(ended, t2("done")), cardState(ended, t2("review", "w9")), cardState(row({ id: "w2", task: "t2" }), t2("review")), cardState(ended)],
      ["review", "failed", "done", "done", "running", "done"],
    );
    assert.equal(team.STATE_WORDS.review, "in review");
  });

  // (fails before: yes — nothing ordered the cards)
  test("the order: asking first, then running, each as it started; then the newest four ended; older ones under Earlier", () => {
    const ended = (id, at) => row({ id, status: "done", endedAt: at, exchanges: [{ startedAt: 10, endedAt: at }] });
    const rows = [
      row({ id: "r2", startedAt: 30 }), ended("e1", 100), row({ id: "a1", startedAt: 50, progress: { asking: { tool: "bash" } } }), ended("e2", 200),
      row({ id: "r1", startedAt: 20 }), ended("e3", 300), ended("e4", 400), ended("e5", 500), row({ id: "a0", startedAt: 40, progress: { asking: { tool: "edit" } } }),
    ];
    const o = cardOrder(rows);
    assert.deepEqual(o.live.map((r) => r.id), ["a0", "a1", "r1", "r2"]);
    assert.deepEqual(o.done.map((r) => r.id), ["e5", "e4", "e3", "e2"]);
    assert.deepEqual(o.earlier.map((r) => r.id), ["e1"]);
    assert.deepEqual(cardOrder(rows, 2).earlier.map((r) => r.id), ["e3", "e2", "e1"]);
  });

  // (fails before: yes — the cards had no figures)
  test("a card's figures: the window its newest round filled, rounds, spend and time — live while it runs, its exchange's once over", () => {
    const live = row({ progress: { round: 7, context: { tokens: 34000, window: 100000, usable: 85000 }, spent: 0.09 }, exchanges: [{ startedAt: 1000, endedAt: null }] });
    assert.deepEqual(cardFigures(live, 162000), { fill: 0.34, rounds: 7, spent: 0.09, ms: 161000 });
    assert.deepEqual(cardFigures(row({ progress: { round: 0, context: { tokens: 900, window: null }, spent: null } }), 1500), { fill: null, rounds: null, spent: null, ms: 500 }, "no window, no ring; round 0 is none yet");
    const done = row({ status: "done", progress: null, exchanges: [{ startedAt: 1000, endedAt: 9000, rounds: 6, spentUsd: 0.05 }] });
    assert.deepEqual(cardFigures(done, 99999), { fill: null, rounds: 6, spent: 0.05, ms: 8000 });
    assert.deepEqual(cardFigures(row({ status: "stopped", exchanges: [] }), 5), { fill: null, rounds: null, spent: null, ms: null });
    assert.equal(cardFigures(row({ progress: { context: { tokens: 200, window: 100 } } }), 0).fill, 1, "a full window reads full, never past it");
  });

  // (fails before: yes — a worker's waiting call had no words in the page)
  test("a waiting call in words: a command is run, a file written or edited, any other tool used", () => {
    assert.deepEqual(askWords({ tool: "bash", args: "npm test -- parse" }), { verb: "wants to run", what: "npm test -- parse", whole: "npm test -- parse" });
    assert.deepEqual(askWords({ tool: "powershell", args: "Get-ChildItem" }).verb, "wants to run");
    assert.deepEqual(askWords({ tool: "write", args: "src/a.js" }).verb, "wants to write");
    assert.deepEqual(askWords({ tool: "edit", args: "src/a.js" }).verb, "wants to edit");
    assert.deepEqual(askWords({ tool: "web_fetch", args: "https://x" }), { verb: "wants to use web_fetch", what: "https://x", whole: "https://x" });
    // (fails before: yes — cp-place: a project's copy asked by Filament read "wants to use send a copy")
    assert.deepEqual(askWords({ tool: "send a copy", verb: "wants to send", args: "a copy of widgets to Studio: 3 files, 2 KB" }), { verb: "wants to send", what: "a copy of widgets to Studio: 3 files, 2 KB", whole: "a copy of widgets to Studio: 3 files, 2 KB" });
    assert.deepEqual([1, 2, 3].map(timesWords), ["once", "twice", "3 times"]);
  });

  // (fails before: yes — HarnessV3-Views V6-9: a command's words were its arguments, cut at 160 characters, and a
  // worker's cd into its own worktree took most of them)
  test("a waiting command in words: as it runs on the line, whole on hover", () => {
    const command = 'cd "/w/sa_1" && node --test test/a.test.js';
    assert.deepEqual(askWords({ tool: "bash", args: command, command, runs: "node --test test/a.test.js" }), { verb: "wants to run", what: "node --test test/a.test.js", whole: command });
    assert.deepEqual(askWords({ tool: "bash", args: "npm test", command: "npm test" }), { verb: "wants to run", what: "npm test", whole: "npm test" });
  });

  // (fails before: yes — nothing told one waiting call from the next, so a card's answers could not outlive a pulse)
  test("a waiting call is the same one while its tool, arguments, question and offer hold", () => {
    const a = { tool: "bash", args: "npm test", question: "Run it?", offer: { itemId: 3 } };
    assert.equal(askKey(a), askKey({ ...a, offer: { itemId: 3 } }));
    for (const other of [{ ...a, args: "npm ci" }, { ...a, question: "" }, { ...a, offer: null }, { ...a, tool: "powershell" }, { ...a, offer: { itemId: 4 } }])
      assert.notEqual(askKey(other), askKey(a), JSON.stringify(other));
    assert.notEqual(askKey({ tool: "a", args: "b c" }), askKey({ tool: "a b", args: "c" }), "the parts never run into each other");
  });

  // (fails before: yes — the decision waited under its turn: there was no line pointing at it)
  test("the line a turn keeps where its decision waited: a permission or an answer", () => {
    assert.equal(waitWords({ kind: "permission" }), "Waiting for your permission, below");
    assert.equal(waitWords({ kind: "ask" }), "Waiting for your answer, below");
  });
});

describe("the tab and the switch", () => {
  // (fails before: yes — the Team tab did not exist)
  test("the badge counts who is at work, its dot orange while one waits for you; nobody and nothing waiting is no badge", () => {
    const team = { key: "architect", name: "Architect", role: "builder" };
    const asking = row({ id: "a", team, progress: { asking: { tool: "bash" } } });
    assert.deepEqual(teamBadge({ live: true, paused: false, rows: [row({ team }), asking, row({ id: "d", team, status: "done" })], leads: true }), { text: "2", dot: "asks", words: "2 at work · 1 asks you" });
    assert.deepEqual(teamBadge({ live: true, paused: false, rows: [], leads: true }), { dot: "works", words: "the lead works" });
    assert.deepEqual(teamBadge({ live: false, paused: true, rows: [], leads: true }), { dot: "asks", words: "1 asks you" }, "the lead's own pause, nobody at work");
    assert.deepEqual(teamBadge({ live: false, paused: true, rows: [asking], leads: true })?.words, "1 at work · 2 ask you");
    assert.equal(teamBadge({ live: false, paused: false, rows: [row({ team, status: "done" })], leads: true }), null);
  });

  // (fails before: yes — the owner's words of 10-18: "the Team tab has this blue dots which also blinks when Chat
  // session is running. that should not blink unless team is doing any work. when i run a side agent it also shows up
  // as a team. the tab says Team 1")
  test("the badge is the team's and the graph's work alone: your agent's turn, its pause and an agent on the side light nothing", () => {
    assert.equal(teamBadge({ live: true, paused: false, rows: [], leads: false }), null, "your agent works with no team: the Chat tab says it");
    assert.equal(teamBadge({ live: false, paused: true, rows: [], leads: false }), null, "your agent's question is the Chat tab's");
    const side = [row({ id: "yours", origin: "owner" }), row({ id: "called", origin: "agent" }), row({ id: "self", origin: "self", progress: { asking: { tool: "bash" } } })];
    assert.equal(teamBadge({ live: true, paused: false, rows: side, leads: false }), null, "agents on the side are the Side tab's");
    assert.deepEqual(teamBadge({ live: true, paused: false, rows: [...side, row({ id: "t", origin: "agent", task: "t1" })], leads: false }), { text: "1", dot: "works", words: "1 at work" }, "an agent doing a task of the graph");
    assert.deepEqual(teamWork([...side, row({ id: "w", team: { key: "architect" } }), row({ id: "t", task: "t2" })]).map((r) => r.id), ["w", "t"]);
  });

  // (fails before: yes — a switch was taken whatever the session was doing)
  test("a switch waits for the session to be idle and for its workers to finish", () => {
    assert.equal(switchWait({ live: {}, turns: [] }, []), "A turn is running: switch once it ends");
    assert.equal(switchWait({ live: null, turns: [{}, { paused: { kind: "permission" } }] }, []), "A question waits for your answer: answer it first");
    // (fails before: yes — found by the Bug Hunter, 10-19) A command typed under the question is Filament's answer, not
    // the conversation's newest turn: the question still waits.
    assert.equal(switchWait({ live: null, turns: [{ paused: { kind: "question" } }, { command: true }] }, []), "A question waits for your answer: answer it first");
    assert.equal(switchWait({ live: null, turns: [{}] }, [row({ team: { key: "architect", role: "builder" } })]), "Workers are still at work: switch once they finish, or stop them");
    assert.equal(switchWait({ live: null, turns: [{ paused: null }] }, [row({}), row({ team: { key: "architect" }, status: "done" })]), null, "a plain sub-agent at work, a worker done: free");
  });

  // (fails before: yes — the sheet had no price to say)
  test("the rebuild's price: what the session holds, at the cache-write price less the cache-read one; unknown is null", () => {
    assert.deepEqual(rebuildCost(11000, { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }), { tokens: 11000, usd: (11000 * 3.45) / 1e6 });
    assert.deepEqual(rebuildCost(10000, { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 }), { tokens: 10000, usd: 0 }, "a card with no cache prices: no difference");
    assert.equal(rebuildCost(0, { cacheRead: 1, cacheWrite: 2 }), null);
    assert.equal(rebuildCost(5000, null), null);
    assert.equal(rebuildCost(5000, { input: 1 }), null);
  });
});

describe("the conversation under a team", () => {
  // (fails before: yes — the page drew no divider where the engine changed)
  test("dividers stand where the engine changes: a team's first turn, back to your agent, one team to another; a first team turn opens it", () => {
    const team = (key, name) => ({ engine: { kind: "team", team: key, name } });
    const t = [team("architect", "Architect"), team("architect", "Architect"), { command: true }, { engine: { kind: "loop" } }, {}, team("one-shot", "One-Shot"), team("architect", "Architect"), { command: true }, {}];
    const d = engineDividers(t);
    assert.deepEqual([...d.entries()].map(([turn, v]) => [t.indexOf(turn), v.words]), [
      [0, "Architect's lead leads this chat"],
      [3, "Your agent has this chat again"],
      [5, "One-Shot's lead took over this chat"],
      [6, "Architect's lead took over this chat"],
      [8, "Your agent has this chat again"],
    ]);
    // With the turns it took over (team_v2_plan §10 O4): a command's answer is no turn of the chat's.
    assert.deepEqual(d.get(t[5]), { to: "team", key: "one-shot", name: "One-Shot", words: "One-Shot's lead took over this chat", after: 4 });
    assert.equal(d.get(t[6])?.after, 5);
    assert.equal(engineDividers([{ engine: { kind: "loop" } }, {}]).size, 0, "your agent all along: none");
  });

  // (fails before: yes — the lead's launches were tool calls, with no role or live state)
  test("the lead's launches as order rows: member, worker and task in call order, the worker's state from the list, else its run's", () => {
    const al = alignEvents([
      { type: "round-start", round: 1 },
      { type: "tool-start", round: 1, name: "agent", args: "Lexer", id: "u1" },
      { type: "subagent-start", round: 1, parent: "u1", agentId: "sa_a", description: "Lexer: names and =", team: "architect", role: "builder" },
      { type: "tool-start", round: 1, name: "agent", args: "plain", id: "u2" },
      { type: "subagent-start", round: 1, parent: "u2", agentId: "sa_p", description: "a plain look" },
      { type: "round-start", round: 2 },
      { type: "tool-start", round: 2, name: "agent", args: "Map", id: "u3" },
      { type: "subagent-start", round: 2, parent: "u3", agentId: "sa_b", description: "Map the code", team: "architect", role: "scout", seat: "Scout", card: { tag: "reviewer", name: "Reviewer" } },
      { type: "subagent-end", round: 2, parent: "u3", agentId: "sa_b", status: "done", ok: true },
      { type: "tool-start", round: 2, name: "agent", args: "Docs", id: "u4" },
      { type: "subagent-start", round: 2, parent: "u4", agentId: "sa_t", description: "Docs in French", team: "my-crew", role: "translator" },
      { type: "tool-start", round: 2, name: "agent", args: "Read", id: "u5" },
      { type: "subagent-start", round: 2, parent: "u5", agentId: "sa_r", description: "Read it over", team: "my-crew", role: "proofreader" },
      { type: "tool-start", round: 2, name: "agent", args: "Test", id: "u6" },
      { type: "subagent-start", round: 2, parent: "u6", agentId: "sa_x", description: "Test the lexer", team: "architect", role: "tester", seat: "Tester", card: { tag: "builder", name: "Builder" } },
    ]);
    assert.equal(al.byRound.get(1).tools.get("u1").sub.role, "builder", "the launch event's role lands on its call");
    const rows = [
      row({ id: "sa_a", progress: { asking: { tool: "bash" } } }),
      row({ id: "sa_t", team: { key: "my-crew", role: "translator", place: null }, card: { tag: "translator", name: "Translator" }, may: "copy" }),
      row({ id: "sa_x", team: { key: "architect", role: "tester", place: "builder", seat: "Tester" }, card: { tag: "builder", name: "Builder" }, may: "edit" }),
    ];
    // (fails before: yes — step 6: a row said its role's word, one of four; a Translator's launch had no name and no glyph)
    // (fails before: yes — the roster shrink of 11-03: a seat the team names read as its card, the Scout and the Tester as
    // Reviewer and Builder, and a launch the list had not stamped wore the bot)
    assert.deepEqual(orderRows(al, rows), [
      { id: "u1", agentId: "sa_a", role: "builder", word: "Builder", icon: "hammer", task: "Lexer: names and =", state: "asking" },
      { id: "u3", agentId: "sa_b", role: "scout", word: "Scout", icon: "eye", task: "Map the code", state: "done" },
      { id: "u4", agentId: "sa_t", role: "translator", word: "Translator", icon: "hammer", task: "Docs in French", state: "running" },
      { id: "u5", agentId: "sa_r", role: "proofreader", word: "proofreader", icon: "bot", task: "Read it over", state: "running" },
      { id: "u6", agentId: "sa_x", role: "tester", word: "Tester", icon: "hammer", task: "Test the lexer", state: "running" },
    ], "a worker the list has stamped by its seat or card; one it has not by what the launch named, its seat first; one read before the list has it by its tag");
    assert.deepEqual(orderRows(null, []), []);
  });

  /** A turn some engine answered, by its stamp. @param {number} n @param {string | null} team @param {number | null} at */
  const stamped = (n, team, at) => ({ n, startedAt: at, engine: team ? { kind: "team", team, name: team } : null });

  // (fails before: yes — nothing said how long a team had led)
  test("since when the team leads: its stretch's first turn's start; none while another engine answered last", () => {
    const turns = [stamped(1, null, 100), stamped(2, "architect", 200), { n: 3, command: true, startedAt: 250 }, stamped(3, "architect", 300)];
    assert.equal(leadingSince(turns, "architect"), 200, "a command Filament answered breaks no stretch");
    assert.equal(leadingSince([...turns, stamped(4, null, 400)], "architect"), null, "your agent answered last");
    assert.equal(leadingSince([...turns, stamped(4, "methodical", 400)], "methodical"), 400);
    assert.equal(leadingSince(turns, "methodical"), null, "chosen, but it has answered nothing yet");
    assert.equal(leadingSince([stamped(1, "architect", null)], "architect"), null, "a turn that kept no start");
  });

  // (fails before: yes — Bug Hunter #13, 10-19: handed back to the same team with no turn between, the chat drew no
  // divider and "Leading for" counted from the first take-over)
  test("handed away and back between two of a team's turns: taken over again, and it leads since then", () => {
    const mark = (/** @type {number} */ after, /** @type {string | null} */ to) => ({ type: "engine", afterTurn: after, to });
    const back = [stamped(1, "architect", 100), { ...stamped(2, "architect", 200), boundariesAfter: [mark(2, null), mark(2, "architect")] }];
    assert.equal(leadingSince(back, "architect"), null, "chosen again, it has answered nothing since");
    // The server's marks stand before the next turn; the page's own after the turn they follow.
    const served = [stamped(1, "architect", 100), stamped(2, "architect", 200), { ...stamped(3, "architect", 300), boundaries: [mark(2, null), mark(2, "architect")] }];
    const later = [stamped(1, "architect", 100), { ...stamped(2, "architect", 200), boundariesAfter: [mark(2, null), mark(2, "architect")] }, stamped(3, "architect", 300)];
    for (const turns of [served, later]) {
      assert.deepEqual([...engineDividers(turns).entries()].map(([t, v]) => [t.n, v.words, v.after]), [[1, "architect's lead leads this chat", undefined], [3, "architect's lead took over this chat", 2]]);
      assert.equal(leadingSince(turns, "architect"), 300);
    }
    // Over a command's answer too; a switch that came back to its agent between two of its turns draws nothing.
    const over = [stamped(1, "architect", 100), { n: 2, command: true, boundariesAfter: [mark(2, null)] }, { ...stamped(3, "architect", 300), boundaries: [mark(2, "architect")] }];
    assert.deepEqual([...engineDividers(over).entries()].map(([t, v]) => [t.n, v.words]), [[1, "architect's lead leads this chat"], [3, "architect's lead took over this chat"]]);
    const agent = [stamped(1, null, 100), { ...stamped(2, null, 200), boundaries: [mark(1, "architect"), mark(1, null)] }];
    assert.equal(engineDividers(agent).size, 0);
  });

  // (fails before: yes — nothing counted a session's compactions for the leader's card)
  test("how often the conversation was compacted: each row once however many copies the page holds, and each fold of a run read", () => {
    const row1 = { type: "compaction", fromTurn: 1, toTurn: 3 };
    const folds = alignEvents([
      { type: "round-start", round: 1 }, { type: "compaction", round: 1, fromRound: 1, toRound: 1 },
      { type: "round-start", round: 2 }, { type: "compaction", round: 2, fromRound: 1, toRound: 2 }, { type: "compaction", round: 2 },
    ]);
    assert.equal(compactionCount([{ boundaries: [row1] }, { boundariesAfter: [{ ...row1 }] }, { boundaries: [{ type: "settings" }], aligned: folds }]), 3);
    assert.deepEqual([compactionCount([]), compactionCount(/** @type {any} */ (null))], [0, 0]);
  });
});

describe("the leader's card", () => {
  // (fails before: yes — nothing said what the leader does now)
  test("what it does now: your answer first, then working, waiting on its workers or sub-agents, or ready", () => {
    assert.deepEqual(leaderState({ live: false, paused: true, waits: false, atWork: 2, team: true }), { state: "asking", title: "Waiting for your answer", badge: "asks you" });
    assert.deepEqual(leaderState({ live: true, paused: false, waits: false, atWork: 0, team: true }).title, "Working on your message");
    assert.deepEqual(leaderState({ live: true, paused: false, waits: true, atWork: 2, team: true }).title, "Waiting on its workers");
    assert.deepEqual(leaderState({ live: true, paused: false, waits: true, atWork: 1, team: false }).title, "Waiting on its agents");
    assert.deepEqual(leaderState({ live: false, paused: false, waits: false, atWork: 1, team: true }), { state: "waiting", title: "Its workers are at work", badge: "waiting" });
    assert.deepEqual(leaderState({ live: false, paused: false, waits: false, atWork: 0, team: false }), { state: "ready", title: "Ready for your next message", badge: "ready" });
  });

  // (fails before: yes — nothing told a lead waiting on its workers from one at work)
  test("it waits on its workers when the loop says so, or while a launch or a worker call is open — not on a provider's retry", () => {
    assert.equal(leaderWaits(alignEvents([{ type: "turn-state", from: "acting", to: "waiting", why: "its background sub-agents" }])), true);
    assert.equal(leaderWaits(alignEvents([{ type: "turn-state", from: "acting", to: "waiting", why: "upstream 529", retry: { waitMs: 2000 } }])), false);
    assert.equal(leaderWaits(alignEvents([{ type: "round-start", round: 1 }, { type: "tool-start", round: 1, name: "worker", args: "wait", id: "w" }])), true);
    assert.equal(leaderWaits(alignEvents([{ type: "round-start", round: 1 }, { type: "tool-start", round: 1, name: "worker", args: "wait", id: "w" }, { type: "tool-end", round: 1, name: "worker", ok: true, id: "w" }])), false);
    assert.equal(leaderWaits(alignEvents([{ type: "round-start", round: 1 }, { type: "tool-start", round: 1, name: "read", args: "a", id: "r" }])), false);
    assert.equal(leaderWaits(null), false);
  });

  // (fails before: yes — the leader's newest words showed nowhere outside the conversation)
  test("its newest words: the last paragraph of its newest text, on one line, clipped", () => {
    assert.equal(newestWords([{ type: "text", text: "First.\n\nThe map is in:\n  tokens live in lex.js." }, { type: "thinking", thinking: "hm" }]), "The map is in: tokens live in lex.js.");
    assert.equal(newestWords([{ type: "text", text: "Older." }, { type: "text", text: "  " }]), "Older.");
    assert.equal(newestWords([]), "");
    const long = newestWords([{ type: "text", text: "x".repeat(500) }]);
    assert.equal(long.length, 360);
    assert.ok(long.endsWith("…"));
  });
});

describe("HarnessV4_Tasks U1: a worker's model call, said as it runs", () => {
  const at = 1_800_000_000_000;
  // (fails before: yes — the card showed a tool or the newest words, and nothing while a model call ran: six minutes of
  // thinking and a call that had hung looked the same, a card standing still)
  test("the running call in the watch's words: its time, what streamed, the newest byte; a wait as the server says it", () => {
    assert.equal(team.callLine({ call: { round: 2, began: at - 360_000, thinking: 39_200, text: 0, lastAt: at - 1000 } }, at), "model call 6 min · about 9,800 tokens of thinking so far · last byte 1 s ago");
    assert.equal(team.callLine({ call: { round: 1, began: at - 12_000, thinking: 400, text: 800, lastAt: at - 3000 } }, at), "model call 12 s · about 100 tokens of thinking and about 200 tokens of text so far · last byte 3 s ago");
    assert.equal(team.callLine({ call: { round: 1, began: at - 45_000, thinking: 0, text: 0, lastAt: null } }, at), "model call 45 s · nothing streamed yet", "a call with no byte yet says so");
    assert.equal(team.callLine({ call: { round: 3, began: at - 600_000, thinking: 4000, text: 0, lastAt: at - 480_000 } }, at), "model call 10 min · about 1,000 tokens of thinking so far · last byte 8 min ago", "a stuck call reads as one");
    assert.equal(team.callLine({ wait: "zai is busy: trying again in 20 s (try 2 of 10)", call: { round: 1, began: at - 5000, thinking: 0, text: 0, lastAt: null } }, at), "zai is busy: trying again in 20 s (try 2 of 10)", "the wait the call is in comes first");
    assert.equal(team.callLine({ round: 2, tool: { name: "bash", args: "npm test" }, call: null }, at), null, "between calls there is none");
    assert.equal(team.callLine(null, at), null);
  });

  // (fails before: yes — the card said nothing of Filament's check: a worker whose check ran for minutes stood still on
  // its last tool, and one Filament sent back looked like any; HarnessV3-TaskGraph-v2 TG2-D45)
  test("Filament's check on a worker's card, as the lead's watch says it: while it runs, and once it sent the worker back", () => {
    assert.equal(team.checkLine({ check: { command: "npm test", began: at - 40_000 } }, at), "Filament runs its check `npm test` · 40 s so far");
    assert.equal(team.checkLine({ check: { command: "npm test", began: at - 300_000 }, bounce: { command: "npm test", n: 1 } }, at), "Filament runs its check `npm test` · 5 min so far", "the check that runs comes first");
    assert.equal(team.checkLine({ bounce: { command: "npm test", n: 1 } }, at), "sent back by Filament: its check `npm test` failed (first time)");
    assert.equal(team.checkLine({ bounce: { command: "npm run build", n: 2 } }, at), "sent back by Filament: its check `npm run build` failed (second time)");
    assert.equal(team.checkLine({ round: 2, check: null, bounce: null }, at), null);
    assert.equal(team.checkLine(null, at), null);
  });
});

describe("HarnessV4_Tasks U1: a task's tries under its one card", () => {
  const at = 1_800_000_000_000;
  /** A worker's row for a graph task: its exchanges as [status, error, report]. @param {string} id @param {number} startedAt @param {[string, string | null, string?][]} xs @param {Record<string, any>} [more] */
  const worker = (id, startedAt, xs, more = {}) => ({ id, task: "t6", review: false, status: xs.at(-1)?.[0] || "done", startedAt, exchanges: xs.map(([status, error, report], i) => ({ status, error, report, startedAt: startedAt + i * 100_000, endedAt: status === "running" ? null : startedAt + i * 100_000 + 60_000 })), ...more });
  // (fails before: yes — each sub-agent that took a task was a card of its own: three tries at t6 read as three
  // workers, and nothing said they were one task failing again)
  test("the workers of one task are one card, the newest's, with the times it was worked before listed under it", () => {
    const w1 = worker("w1", at, [["failed", "round 2's model call to zai/glm-5.3 failed: 500 overloaded"]]);
    const w2 = worker("w2", at + 200_000, [["done", null, "Wrote the lexer.\nIts tests pass."], ["aborted", "Filament restarted before it finished"], ["running", null]]);
    const reviewer = { id: "w3", task: "t6", review: true, status: "done", startedAt: at + 300_000, exchanges: [{ status: "done", startedAt: at + 300_000, endedAt: at + 310_000 }] };
    const free = { id: "w4", task: null, review: false, status: "done", startedAt: at + 50_000, exchanges: [{ status: "done", startedAt: at + 50_000, endedAt: at + 60_000 }] };
    const other = { id: "w5", task: "t7", review: false, status: "running", startedAt: at + 10, exchanges: [{ status: "running", startedAt: at + 10, endedAt: null }] };
    const rows = [w2, reviewer, w1, free, other];
    const graph = { tasks: [{ id: "t6", state: "running", agent: "w2", earlier: { agent: "w2", why: "its acceptance check did not pass: an empty input throws" } }, { id: "t7", state: "running", agent: "w5", earlier: null }] };
    const got = team.taskTries(rows, graph);
    assert.deepEqual(got.rows.map((r) => r.id), ["w2", "w3", "w4", "w5"], "w1 is a try of w2's task, not a worker of its own; a reviewer and a row with no task keep their cards");
    assert.deepEqual([...got.tries.keys()], ["w2"], "a task worked once has none");
    assert.deepEqual(got.tries.get("w2"), [
      { agent: "w1", state: "failed", how: "failed", cause: "round 2's model call to zai/glm-5.3 failed: 500 overloaded", ms: 60_000 },
      { agent: "w2", state: "done", how: "ended", cause: "Wrote the lexer. Its tests pass.", ms: 60_000 },
      { agent: "w2", state: "failed", how: "cut off", cause: "Filament restarted before it finished", ms: 60_000 },
    ]);
    // The try the next one built on says why the task failed then, where it left no error of its own.
    const built = team.taskTries([worker("w1", at, [["done", null, "Wrote them."]]), worker("w2", at + 1, [["running", null]])], { tasks: [{ id: "t6", state: "running", agent: "w2", earlier: { agent: "w1", why: "its acceptance check did not pass: they pass on the old parser" } }] });
    assert.deepEqual(built.tries.get("w2"), [{ agent: "w1", state: "done", how: "ended", cause: "its acceptance check did not pass: they pass on the old parser", ms: 60_000 }]);
    // Sent back and not started yet, that try is the one the card still shows: the one before it keeps its own words.
    const waits = team.taskTries([worker("w1", at, [["stopped", null, "Half done."], ["done", null, "Wrote them."]])], { tasks: [{ id: "t6", state: "waiting", agent: "w1", resume: "w1", earlier: { agent: "w1", why: "its acceptance check did not pass" } }] });
    assert.deepEqual(waits.tries.get("w1"), [{ agent: "w1", state: "stopped", how: "stopped", cause: "Half done.", ms: 60_000 }]);
    assert.deepEqual(team.taskTries([free], null), { rows: [free], tries: new Map() }, "no graph, no task: the rows as they are");
  });

  // (fails before: yes — a task that failed the same way again looked like any failure: the count the graph keeps
  // reached the lead alone)
  test("a failure that repeats is called out; a first one is not", () => {
    assert.equal(team.repeatWords({ id: "t6", state: "failed", failures: { cause: "provider-error # overloaded", times: 3 } }), "t6 failed the same way 3 times in a row");
    assert.equal(team.repeatWords({ id: "t6", state: "failed", failures: { cause: "x", times: 1 } }), "");
    assert.equal(team.repeatWords({ id: "t6", state: "waiting", failures: { cause: "x", times: 3 } }), "", "sent back, it is no failure now");
    assert.equal(team.repeatWords({ id: "t6", state: "failed", failures: null }), "");
    assert.equal(team.repeatWords(null), "");
  });

  // (fails before: yes — there were no such words: only the planner sent a task back)
  test("the send-back's words: what each button does, what the door answered, and the message that starts the planner's turn", () => {
    assert.deepEqual(team.sendBackTitles("t6", "team"), {
      back: "Its worker goes on with t6 where it stopped, in its own conversation — what it did is there, and it reads what failed. The lead is told; with no turn running, a message to it starts one.",
      fresh: "A new worker takes t6 from the folder as it stands, with the earlier try in its brief. The lead is told; with no turn running, a message to it starts one.",
    });
    assert.match(team.sendBackTitles("t6", "agent").back, /^Its agent goes on with t6 .* The agent is told; /);
    assert.equal(team.sentBackWords("t6", { fresh: false, waits: null, resumes: "w2", crew: "team" }), "W2 goes on with t6");
    assert.equal(team.sentBackWords("t6", { fresh: true, waits: null, resumes: null, crew: "team" }), "A new worker takes t6");
    assert.equal(team.sentBackWords("t6", { fresh: false, waits: null, resumes: null, crew: "agent" }), "Its last agent can't go on with t6, so a new one takes it");
    assert.equal(team.sentBackWords("t6", { fresh: false, waits: "turn", resumes: "w2", crew: "team" }), "W2 goes on with t6 — with the session's next turn");
    assert.equal(team.sentBackWords("t6", { fresh: false, waits: "held", resumes: "w2", crew: "team" }), "W2 goes on with t6 — once the lead's next tasks call lets the graph go: it is held");
    assert.equal(team.sentBackWords("t6", { fresh: true, waits: "held", resumes: null, crew: "agent" }), "A new agent takes t6 — once the agent's next tasks call lets the graph go: it is held");
    assert.equal(team.sentBackWords("t6", { fresh: false, waits: "slot", resumes: "w2", crew: "team" }), "W2 goes on with t6 — once its needs are done and a slot is free");
    assert.equal(team.carryOnWords("t6", { resumes: "w2", crew: "team" }), "I sent t6 back to w2 — carry on.");
    assert.equal(team.carryOnWords("t6", { resumes: null, crew: "team" }), "I sent t6 back to a new worker — carry on.");
    assert.equal(team.carryOnWords("t6", { resumes: null, crew: "agent" }), "I sent t6 back to a new agent — carry on.");
    // (fails before: yes — B4: a task the developer stopped had no start of their own, so no words for one)
    assert.equal(team.carryOnWords("t6", { resumes: "w2", crew: "team", again: true }), "I started t6 again with w2 — carry on.");
    assert.equal(team.carryOnWords("t6", { resumes: null, crew: "team", again: true }), "I started t6 again with a new worker — carry on.");
    assert.deepEqual(team.sendBackTitles("t6", "team", true), {
      back: "Its worker goes on with t6 where it was stopped, in its own conversation — what it did is there. The lead is told; with no turn running, a message to it starts one.",
      fresh: "A new worker takes t6 from the folder as it stands, with the stopped try in its brief. The lead is told; with no turn running, a message to it starts one.",
    });
  });

  // (fails before: yes — the page had no send-back of its own)
  test("the page's wiring (source contract): the door, the graph it answers, and the turn that starts the work where none runs", () => {
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.match(app, /\/graph\/tasks\/\$\{encodeURIComponent\(id\)\}\/start`, \{ method: "POST", body: fresh \? \{ fresh: true \} : \{\} \}\)/);
    assert.match(app, /if \(out\.graph\) takeGraph\(chat, out\.graph\);/, "the click's own change draws, feed or no feed");
    assert.match(app, /const carries = out\.waits === "turn" && chatOf\(state\.currentId\) === chat && !composer\.live\(\)\.streaming && !asksYou\(newestOnRecord\(chat\.turns\)\);/, "only where no turn runs and nothing waits for an answer; a held graph is left to the developer");
    // Through `sendOrQueue` since the review of c2ee8d232: where a message waits on the chat's row, it waits in the queue.
    assert.match(app, /if \(carries\) void sendOrQueue\(carryOnWords\(id, \{ resumes: out\.resumes \|\| null, crew, again: out\.again === true \}\), \{ ours: true \}\);/);
    assert.match(app, /if \(!chainId \|\| sendingBack\.has\(key\)\) return;/, "a second click waits for the first's answer");
    assert.match(app, /sendBack: \(id, fresh\) => \{ sendTaskBack\(id, fresh\); \},/);
    assert.match(readFileSync("src/ui/harness/views/host.js", "utf8"), /sendBack: o\.team\.sendBack,/, "the Plan view's detail sends back through the same hand");
  });
});

describe("HarnessV4_Tasks U1: a sub-agent's card keeps its true state once its turn stopped hearing of it", () => {
  const at = 1_800_000_000_000;
  /** The session's row of a sub-agent with these exchanges. @param {Record<string, any>[]} xs */
  const rowOf = (xs) => /** @type {any} */ ({ id: "sa_1", status: xs.at(-1)?.status, exchanges: xs.map((x, i) => ({ startedAt: at + i * 1000, endedAt: x.status === "running" ? null : at + i * 1000 + 42_000, ...x })) });
  /** An agent call's row: Filament's own agent's stands with the line of what it drew under it (HarnessV4_Visuals_Plan VS-D50). @param {any} el */
  const rowIn = (el) => (el.classList.contains("sub-drew") ? el.children[0] : el);
  /** A turn's events: an agent call launched in the background, its sub-agent started — and no word of its end. */
  const LEFT = [
    { type: "tool-start", round: 1, id: "a1", name: "agent", args: "Map the parser" },
    { type: "subagent-start", round: 1, parent: "a1", agentId: "sa_1", description: "Map the parser", agent: "scout", card: { tag: "scout", name: "Scout" }, model: "glm-5.3", background: true, exchange: 0 },
    { type: "tool-end", round: 1, id: "a1", ok: true },
  ];

  // (fails before: yes — the bug report's L10: a sub-agent's events ride the turn that launched it only while that turn
  // runs, so a turn that paused, or ended before its background sub-agent, left the card "running" for good)
  test("the end the list knows, for the exchange the call launched; the events' own word stands where they told it", () => {
    const running = { state: "running", exchange: 0 };
    assert.deepEqual(endFromList(running, rowOf([{ status: "done", report: "Found 3 callers.", rounds: 4, tokensIn: 900, tokensOut: 100, ms: 41_500 }])), { state: "done", status: "done", ms: 41_500, rounds: 4, tokens: 1000, report: "Found 3 callers.", error: undefined, failure: null, asking: null });
    assert.deepEqual(endFromList(running, rowOf([{ status: "failed", error: "round 2's model call failed: 500" }])), { state: "failed", status: "failed", ms: 42_000, rounds: undefined, tokens: 0, report: undefined, error: "round 2's model call failed: 500", failure: null, asking: null });
    const parts = { head: "round 2's model call to glm-5.3 failed: Overloaded (HTTP 529).", more: "1 finished round is kept." };
    assert.deepEqual(endFromList(running, rowOf([{ status: "failed", error: `${parts.head} ${parts.more}`, failure: parts }]))?.failure, parts, "its failure's two parts, for the card");
    assert.equal(endFromList(running, rowOf([{ status: "stopped" }]))?.state, "stopped");
    assert.equal(endFromList(running, rowOf([{ status: "budget-stopped" }]))?.state, "failed", "as the run's own end reads it");
    assert.equal(endFromList(running, rowOf([{ status: "aborted" }]))?.status, "aborted");
    // (fails before: yes — the owner's report of 10-18: its card stood running for good)
    assert.deepEqual(endFromList(running, rowOf([{ status: "aborted", endedAt: null, error: "Filament restarted before it finished" }])),
      { state: "failed", status: "aborted", ms: 0, rounds: undefined, tokens: 0, report: undefined, error: "Filament restarted before it finished", failure: null, asking: null }, "a restart cut it before it ended: no end time, and ended all the same");
    assert.equal(endFromList(running, rowOf([{ status: "running" }])), null, "it still runs");
    assert.equal(endFromList({ state: "running", exchange: 1 }, rowOf([{ status: "done" }, { status: "running" }])), null, "a follow-up's card is its own exchange's");
    assert.equal(endFromList({ state: "running", exchange: 0 }, rowOf([{ status: "done" }, { status: "running" }]))?.state, "done", "and the launch's card its own");
    assert.equal(endFromList({ state: "done", exchange: 0 }, rowOf([{ status: "failed" }])), null, "the events told its end");
    assert.equal(endFromList(running, null), null, "the list knows no such sub-agent");
    assert.equal(endFromList({ state: "running" }, rowOf([{ status: "done" }])), null, "a call that names no exchange: a coding agent's own sub-agent, an older run");
    assert.equal(endFromList(null, rowOf([{ status: "done" }])), null);
  });

  // (fails before: yes — the run's start event named no exchange, so a card could not find its own in the list)
  test("the start event's exchange reaches the card's record; the key of a turn's list-told ends moves only when one does", () => {
    const al = alignEvents(LEFT);
    assert.deepEqual([al.byRound.get(1)?.tools.get("a1").sub.exchange, al.byRound.get(1)?.tools.get("a1").sub.state], [0, "running"]);
    assert.equal(alignEvents(LEFT.map(({ exchange, ...e }) => e)).byRound.get(1)?.tools.get("a1").sub.exchange, undefined);
    assert.equal(listEndsKey(al, () => rowOf([{ status: "running" }])), "");
    assert.equal(listEndsKey(al, () => null), "");
    assert.equal(listEndsKey(al, (id) => (id === "sa_1" ? rowOf([{ status: "done" }]) : null)), "sa_1:0:done");
    assert.equal(listEndsKey(null, () => null), "");
    assert.match(readFileSync("src/app/agent/subagents.js", "utf8"), /toParent\(sa, \{ type: "subagent-start", agentId: sa\.id,[^\n]*exchange: sa\.exchanges\.length - 1 \}\);/, "the server names the exchange it starts");
  });

  test("the card drawn: running while the list says so, then its end with its report — and the page draws the turn's cards again", () => {
    const doc = stubDocument();
    try {
      /** @type {any} */
      let row = rowOf([{ status: "running" }]);
      chipActions.subagentRow = (id) => (id === "sa_1" ? row : null);
      const draw = () => rowIn(roundRows(alignEvents(LEFT).byRound.get(1))[0]);
      /** @param {any} el */
      const seen = (el) => [el.classList.contains("running"), el.querySelector(".tool-secondary")?.textContent ?? null, el.querySelector(".tool-status")?.textContent ?? null];
      assert.deepEqual(seen(draw()), [true, "Starting · in the background", null]);
      row = rowOf([{ status: "done", report: "Found 3 callers.", tokensIn: 900, tokensOut: 100, ms: 41_500 }]);
      const ended = draw();
      assert.deepEqual(seen(ended), [false, "1,000 tokens · 41.5s", null]);
      assert.match(String(ended.querySelector(".sub-report")?.innerHTML), /Found 3 callers\./);
      row = rowOf([{ status: "failed", error: "round 2's model call failed: 500" }]);
      assert.deepEqual(seen(draw()), [false, "42.0s", "Failed"]);
      chipActions.subagentRow = null;
      assert.deepEqual(seen(draw())[0], true, "a card drawn outside the harness reads its run's events alone");
    } finally {
      chipActions.subagentRow = null;
      doc.restore();
    }
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.match(app, /chipActions\.subagentRow = \(id\) => subagentStore\.row\(id\);/);
    assert.match(app, /transcript\.paintOrders\(\);\n\s*transcript\.paintAgentEnds\(\);/, "each change of the session's list");
    const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
    assert.match(timeline, /const key = listEndsKey\(turn\.aligned, \(id\) => byId\.get\(id\) \|\| null, known, cb\.agentLogged \|\| null, cb\.agentCard \|\| null\);\n\s*if \(key === \(v\.agentEnds \|\| ""\)\) continue;\n\s*v\.agentEnds = key;\n\s*this\.placeCards\(turn\);/, "only a turn whose cards would change is drawn again");
  });

  // (fails before: yes — the list's head was the card's report: its words past the head were drawn nowhere)
  test("the card drawn from a list that carries its answer as a head: the head while its agent's cards' form is read, then the form's words, folded too, as the list's were before its heads", () => {
    const words = `Found the callers. ${"one more line of the report ".repeat(30)}DEEP-WORD past the head. ${"and more ".repeat(100)}`;
    const doc = stubDocument();
    try {
      const row = rowOf([{ status: "done", report: `${words.slice(0, 599)}…`, reportHead: true, tokensIn: 900, tokensOut: 100, ms: 41_500 }]);
      chipActions.subagentRow = (id) => (id === "sa_1" ? row : null);
      /** @type {any} */
      let form;
      chipActions.subagentCard = () => form;
      const draw = () => rowIn(roundRows(alignEvents(LEFT).byRound.get(1))[0]);
      const reading = draw();
      assert.equal(reading.classList.contains("running"), false, "ended while it is read: never running");
      assert.match(String(reading.querySelector(".sub-report")?.innerHTML), /Found the callers\./, "the head");
      assert.doesNotMatch(String(reading.querySelector(".sub-report")?.innerHTML), /DEEP-WORD/);
      form = { status: "done", report: words };
      const read = draw();
      assert.equal(read.open, false, "folded");
      assert.match(String(read.querySelector(".sub-report")?.innerHTML), /DEEP-WORD past the head/, "the form's words, where Find reads them");
    } finally {
      chipActions.subagentRow = null;
      chipActions.subagentCard = null;
      doc.restore();
    }
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.match(app, /chipActions\.subagentCard = \(id, exchange\) => subagentStore\.card\(id, exchange\);/);
    assert.match(app, /agentCard: \(id, exchange\) => subagentStore\.card\(id, exchange\),/);
    assert.match(app, /prepare: \(\) => transcript\.readWork\(\)\.then\(\(n\) => subagentStore\.cardsHeard\(\)\.then\(\(heard\) => n \+ \(heard \? 1 : 0\)\)\)/, "Find searches again once the forms on their way are drawn");
    assert.match(readFileSync("src/ui/harness/conversation/tools/render.js", "utf8"), /chipActions\.subagentLogged, chipActions\.subagentCard\);/);
  });

  // (fails before: yes — the S5 gap: Filament keeps a session's newest sub-agents and none across a restart, so a card
  // whose sub-agent it holds no longer had no row to take its end from, and read "running" for good)
  test("a sub-agent Filament holds no longer: once its run has ended and the session's list is known, its card says its end is unknown — never while the run goes on, never before the list answered", () => {
    const END = { type: "run-end", status: "done" };
    const subOf = (/** @type {any[]} */ evs) => alignEvents(evs).byRound.get(1)?.tools.get("a1").sub;
    const left = subOf([...LEFT, END]);
    assert.deepEqual([left.state, left.left, subOf(LEFT).left], ["running", true, undefined], "the run's end leaves it running: its events ride that run no longer");
    assert.equal(subOf([...LEFT, { type: "run-end", status: "paused" }]).left, true, "a paused run's too");
    assert.deepEqual(endFromList(left, null, true), { state: "stopped", status: "forgotten", asking: null, gone: true }, "what the events had told of it stands");
    assert.equal(endFromList(left, null), null, "the list not answered yet: no row says nothing");
    assert.equal(endFromList(subOf(LEFT), null, true), null, "its run still goes: the list may not have heard of it yet");
    assert.equal(endFromList(left, rowOf([{ status: "running" }]), true), null, "the list holds it, and it runs");
    assert.equal(endFromList(left, rowOf([{ status: "done" }]), true)?.state, "done", "its end, where the list has one");
    const al = alignEvents([...LEFT.slice(0, 2), { type: "subagent-tool-start", round: 1, parent: "a1", id: "y1", name: "grep", args: "parse", card: { kind: "search", title: "Search", subject: "parse" } }, LEFT[2], END]);
    assert.deepEqual([listEndsKey(al, () => null), listEndsKey(al, () => null, true)], ["", "sa_1:0:forgotten"], "the turn's cards are drawn again once the list is known");
    assert.equal(al.byRound.get(1)?.tools.get("a1").sub.tools.get("y1").state, "unfollowed", "the call it was making when its turn ended: it worked on, and this run heard no more");
    const doc = stubDocument();
    try {
      chipActions.subagentRow = () => null;
      chipActions.openSubagent = () => {};
      const draw = () => opened(rowIn(roundRows(al.byRound.get(1))[0]));
      /** @param {any} el */
      const seen = (el) => [el.classList.contains("running"), [...el.querySelectorAll(".tool-status")].map((s) => s.textContent), !!el.querySelector(".subagent-open")];
      assert.deepEqual(seen(draw()), [true, ["Not followed"], true], "before the list answers, as its run left it");
      chipActions.subagentsKnown = () => true;
      const gone = draw();
      assert.deepEqual(seen(gone), [false, ["End unknown", "Not followed"], false], "no conversation to open: Filament holds none");
      assert.equal(gone.querySelector(".tool-status")?.getAttribute("title"), "This turn never heard how it ended. Filament holds this agent no longer (a session keeps its newest threads and those whose work waits for your Apply, and a task graph's other agents only while Filament runs), and no log of its own run was found to say");
      assert.equal(gone.querySelector(".tool-status")?.classList.contains("soft"), true, "no failure of anything");
    } finally {
      chipActions.subagentRow = null;
      chipActions.openSubagent = null;
      chipActions.subagentsKnown = null;
      doc.restore();
    }
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.match(app, /chipActions\.subagentsKnown = \(\) => subagentStore\.known\(\);/);
    assert.match(app, /agentRows: \(\) => subagentStore\.rows\(\),\n\s*agentRowsKnown: \(\) => subagentStore\.known\(\),/);
    const store = readFileSync("src/ui/harness/lib/subagents.js", "utf8");
    assert.match(store, /rows = Array\.isArray\(r\?\.subagents\) \? r\.subagents : \[\];\n\s*own = Array\.isArray\(r\?\.own\) \? r\.own : \[\];\n\s*known = true;/, "known once the list was answered");
    assert.match(store, /chainId = next;\n\s*rows = \[\];\n\s*own = \[\];\n\s*known = false;/, "and not of another session");
    assert.match(store, /known: \(\) => known,/);
    assert.match(readFileSync("src/ui/harness/conversation/timeline.js", "utf8"), /const known = !!cb\.agentRowsKnown\?\.\(\);/);
  });

  // (fails before: yes — V4-D82: a sub-agent the registry holds no longer read "End unknown" though its own run's
  // log says how it ended; the turn's log named no run of it, and nothing asked that log)
  test("a sub-agent Filament holds no longer takes its end from its own run's log: the run its turn named, asked only once the list is known to hold no row of it; drawn as a held one's, with no conversation to open", () => {
    const END = { type: "run-end", status: "aborted" };
    const RUN = { type: "subagent-run", round: 1, parent: "a1", agentId: "sa_1", exchange: 0, run: "req-sub-1" };
    const subOf = (/** @type {any[]} */ evs) => /** @type {any} */ (alignEvents(evs).byRound.get(1)).tools.get("a1").sub;
    assert.deepEqual([subOf([...LEFT, RUN]).run, subOf(LEFT).run], ["req-sub-1", undefined], "the card keeps the run its turn's log named");
    const left = subOf([...LEFT, RUN, END]);
    const CUT = { status: "aborted", startedAt: at, endedAt: at + 8000, ms: 8000, rounds: 2, toolCalls: 1, tokensIn: 700, tokensOut: 50, report: "Reading the parser.", error: "Filament stopped before it finished (found open at the next start)", failure: null };
    /** @type {any[]} */
    const asked = [];
    const says = (/** @type {any} */ said) => (/** @type {any} */ s) => { asked.push(s.run); return said; };
    assert.deepEqual(endFromList(left, null, true, says({ end: CUT })), { state: "failed", status: "aborted", ms: 8000, rounds: 2, tokens: 750, report: "Reading the parser.", error: CUT.error, failure: null, asking: null, gone: true });
    assert.equal(endFromList(left, null, true, says({ end: { ...CUT, status: "done", error: null } }))?.state, "done");
    assert.equal(endFromList(left, null, true, says(undefined)), null, "while its log is read, the card stays as its run left it");
    assert.deepEqual(endFromList(left, null, true, says({ end: null })), { state: "stopped", status: "forgotten", asking: null, gone: true }, "a log that is gone, or shows no end");
    assert.deepEqual(endFromList(left, null, true, says({ end: null, unread: "HTTP 500" })), { state: "stopped", status: "forgotten", asking: null, gone: true, unread: "HTTP 500" });
    assert.deepEqual(endFromList(left, null, true, says(null)), { state: "stopped", status: "forgotten", asking: null, gone: true }, "its turn named no run of it");
    assert.equal(asked.length, 6);
    asked.length = 0;
    endFromList(left, null, false, says({ end: CUT }));
    endFromList(left, rowOf([{ status: "running" }]), true, says({ end: CUT }));
    endFromList(subOf([...LEFT, RUN]), null, true, says({ end: CUT }));
    assert.deepEqual(asked, [], "never asked before the list answered, while the list holds it, or while its turn's run goes on");
    assert.equal(endFromList(left, rowOf([{ status: "done" }]), true, says({ end: CUT }))?.gone, undefined, "the list's own end is not a gone one");
    const al = alignEvents([...LEFT, RUN, END]);
    assert.deepEqual([listEndsKey(al, () => null, true, () => undefined), listEndsKey(al, () => null, true, () => ({ end: CUT }))], ["", "sa_1:0:aborted"], "the turn's cards are drawn again when the log has answered");
    const doc = stubDocument();
    try {
      chipActions.subagentRow = () => null;
      chipActions.subagentsKnown = () => true;
      chipActions.openSubagent = () => {};
      /** @type {any} */
      let said;
      chipActions.subagentLogged = () => said;
      const draw = () => rowIn(roundRows(al.byRound.get(1))[0]);
      /** @param {any} el */
      const seen = (el) => [el.classList.contains("running"), el.querySelector(".tool-status")?.textContent ?? null, !!el.querySelector(".subagent-open")];
      assert.deepEqual(seen(draw())[0], true, "being read");
      said = { end: CUT };
      const cut = draw();
      assert.deepEqual(seen(cut), [false, "Cut off", false], "the word a held one's cut end takes, and no conversation to open");
      assert.equal(cut.querySelector(".tool-status")?.getAttribute("title"), CUT.error, "the cause, from its run's own end");
      assert.equal(cut.querySelector(".tool-secondary")?.textContent, "750 tokens · 8.0s");
      assert.match(String(cut.querySelector(".sub-report")?.innerHTML), /Reading the parser\./, "its newest words");
      said = { end: { ...CUT, status: "done", error: null, report: "Found 3 callers." } };
      const done = draw();
      assert.deepEqual(seen(done), [false, null, false], "one that had finished: no status word, as a held one's");
      assert.match(String(done.querySelector(".sub-report")?.innerHTML), /Found 3 callers\./);
      said = { end: null, unread: "HTTP 500" };
      const unread = /** @type {any} */ (roundRows(alignEvents([...LEFT, RUN, { type: "run-end", status: "done" }]).byRound.get(1))[0]);
      assert.equal(unread.querySelector(".tool-status")?.textContent, "End unknown");
      assert.match(String(unread.querySelector(".tool-status")?.getAttribute("title")), /no log of its own run was found to say: reading it failed \(HTTP 500\)$/, "a log that could not be read names why");
    } finally {
      chipActions.subagentRow = null;
      chipActions.subagentsKnown = null;
      chipActions.openSubagent = null;
      chipActions.subagentLogged = null;
      doc.restore();
    }
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.match(app, /chipActions\.subagentLogged = \(sub\) => subagentStore\.logged\(sub\);/);
    assert.match(app, /agentRowsKnown: \(\) => subagentStore\.known\(\),\n\s*agentLogged: \(sub\) => subagentStore\.logged\(sub\),/);
    // The store asks each run once, tells its listeners when the answer is in, and drops another session's answer.
    const store = readFileSync("src/ui/harness/lib/subagents.js", "utf8");
    const logged = store.slice(store.indexOf("    logged(sub) {"), store.indexOf("    refresh: load,"));
    assert.match(logged, /if \(!run \|\| !id \|\| !chainId\) return null;\n\s*const have = loggedEnds\.get\(run\);\n\s*if \(have\) return have;\n\s*if \(reading\.has\(run\)\) return undefined;\n\s*reading\.add\(run\);/);
    assert.match(logged, /\(e\) => \/\*\* @type \{LoggedEnd\} \*\/ \(e\?\.status === 404 \? \{ end: null \} : \{ end: null, unread: String\(e\?\.message \|\| e\) \}\),/, "a log that is gone is no failure; one that could not be read says why");
    assert.match(logged, /reading\.delete\(run\);\n\s*if \(chain !== chainId\) return;\n\s*loggedEnds\.set\(run, said\);\n\s*emit\(\);/);
    assert.match(store, /known = false;\n\s*loggedEnds\.clear\(\);/, "another session starts with none");
    assert.match(store, /end: \(id, run\) => api\(`\$\{base\}\/\$\{encodeURIComponent\(id\)\}\/end\?run=\$\{encodeURIComponent\(run\)\}`\),/);
  });

  // (fails before: yes — a call its run's log shows no end of read "running", with its spinner, on a turn a restart
  // had cut off: the next start writes that run's end, and the page settled nothing at it)
  test("a cut turn's cards: a call its run never ended reads cut off and stands alone, a coding agent's sub-agent with it; a paused run's open call still asks", () => {
    const CUT = [
      { type: "tool-start", round: 1, id: "c1", name: "Read", args: "src/a.js", card: { kind: "read", title: "Read", subject: "src/a.js" } },
      { type: "tool-end", round: 1, id: "c1", ok: true },
      { type: "tool-start", round: 1, id: "c2", name: "Bash", args: "npm run build", card: { kind: "shell", title: "Run", subject: "npm run build" } },
      { type: "tool-start", round: 1, id: "c3", name: "Task", args: "Map it", card: { kind: "subagent", title: "Task", subject: "Map it" } },
      { type: "subagent-start", round: 1, parent: "c3", description: "Map it" },
      { type: "subagent-tool-start", round: 1, parent: "c3", id: "x1", name: "Grep", args: "lexer", card: { kind: "search", title: "Search", subject: "lexer" } },
    ];
    const ENDED = [...CUT, { type: "run-end", status: "aborted", summary: { error: "Filament stopped before it finished (found open at the next start)" } }];
    /** @param {any[]} evs */
    const states = (evs) => { const ts = /** @type {any} */ (alignEvents(evs).byRound.get(1)).tools; return [ts.get("c1").state, ts.get("c2").state, ts.get("c3").state, ts.get("c3").sub.state, ts.get("c3").sub.status ?? null, ts.get("c3").sub.tools.get("x1").state]; };
    assert.deepEqual(states(CUT), ["done", "running", "running", "running", null, "running"], "while its run goes");
    assert.deepEqual(states(ENDED), ["done", "cut", "cut", "stopped", "cut", "cut"], "a coding agent's sub-agent has no life past its run");
    assert.deepEqual(states([...CUT, { type: "run-end", status: "paused" }]), ["done", "running", "running", "running", null, "running"], "a paused run's calls run on: the reply that continues it ends them");
    // Filament's own sub-agent, waited for when the run was cut: the call is cut, and its end is the list's to say.
    const own = /** @type {any} */ (alignEvents([LEFT[0], LEFT[1], { type: "subagent-tool-start", round: 1, parent: "a1", id: "y1", name: "grep", args: "parse" }, { type: "run-end", status: "aborted" }]).byRound.get(1)).tools.get("a1");
    assert.deepEqual([own.state, own.sub.state, own.sub.left, own.sub.tools.get("y1").state], ["cut", "running", true, "cut"]);
    assert.deepEqual([statusOf({ state: "cut" }), statusOf({ state: "unfollowed" })].map((s) => [s?.word, s?.soft]), [["Cut off", true], ["Not followed", true]], "neither is a failure");
    const doc = stubDocument();
    try {
      /** @param {any} el */
      const seen = (el) => [el.classList.contains("running"), el.querySelector(".tool-kind")?.textContent ?? null, el.querySelector(".tool-status")?.textContent ?? null];
      /** @param {any[]} evs */
      const rows = (evs) => roundRows(alignEvents(evs).byRound.get(1));
      assert.deepEqual(rows(CUT).map(seen), [[false, "Read", null], [true, "Run", null], [true, "Agent", null]]);
      const cut = rows(ENDED);
      assert.deepEqual(cut.map(seen), [[false, "Read", null], [false, "Run", "Cut off"], [false, "Agent", "Cut off"]], "nothing runs in a turn that ended, and the call it broke at is not folded into a group");
      assert.equal(cut[1].querySelector(".tool-status")?.getAttribute("title"), "Filament stopped while this call ran: its run ended without it, and its result was never recorded");
      assert.deepEqual(Array.from(opened(cut[2]).querySelectorAll(".tool-status"), (s) => s.getAttribute("title")), ["Filament stopped while this agent worked: its turn's run ended without it, and no report was recorded", "Filament stopped while this call ran: its run ended without it, and its result was never recorded"]);
      // The same two finished calls group; with the second cut, each stands alone.
      const two = (/** @type {boolean} */ ended) => [
        { type: "tool-start", round: 1, id: "r1", name: "read_file", card: { kind: "read", title: "Read", subject: "a.js" } }, { type: "tool-end", round: 1, id: "r1", ok: true },
        { type: "tool-start", round: 1, id: "r2", name: "read_file", card: { kind: "read", title: "Read", subject: "b.js" } }, ...(ended ? [{ type: "tool-end", round: 1, id: "r2", ok: true }] : []),
        { type: "run-end", status: "aborted" },
      ];
      assert.deepEqual([rows(two(true)).length, rows(two(false)).length], [1, 2]);
      // Filament's own sub-agent the cut run waited for: cut with it, once the list is known to hold it no longer.
      chipActions.subagentRow = () => null;
      chipActions.subagentsKnown = () => true;
      const waited = rows([LEFT[0], LEFT[1], { type: "run-end", status: "aborted" }])[0];
      assert.deepEqual(seen(waited), [false, "Scout", "Cut off"], "its launching call was cut: so was it — no 'End unknown'");
      // (fails before: yes — step 4: the row's kind was "Agent" or "Explore agent", never the card)
      assert.ok(!waited.querySelector(".tool-meta")?.textContent.includes("scout"), "the card's name is the row's kind, said once");
      // A coding agent's own helper has no card: its row keeps the kind its agent gives it.
      const theirs = rows([{ type: "tool-start", round: 1, id: "c9", name: "Task", args: "Look", card: { kind: "subagent", title: "Task", subject: "Look" } }, { type: "subagent-start", round: 1, parent: "c9", description: "Look", agent: "explore", model: "composer-2.5" }])[0];
      assert.equal(theirs.querySelector(".tool-kind")?.textContent, "Agent");
      assert.match(String(theirs.textContent), /explore · composer-2\.5/);
    } finally {
      chipActions.subagentRow = null;
      chipActions.subagentsKnown = null;
      doc.restore();
    }
  });
});

describe("HarnessV4_Tasks U1: the sub-agent view streams a round's thinking and words", () => {
  // (fails before: yes — the view followed the run's log alone, which keeps a round's thinking and words only at the
  // round's end: a long model call showed the one word Thinking until it was over)
  test("a round's own words are the run's blocks from its start on; the view follows the run with its words", () => {
    const blocks = [
      { type: "thinking", text: "first round's thought" },
      { type: "text", text: "first round's words" },
      { type: "thinking", text: "weighing the lexer" },
      { type: "text", text: "I'll read " },
    ];
    assert.deepEqual(roundWords(blocks, 2), { thinking: "weighing the lexer", text: "I'll read " }, "the second round's, not the first's");
    assert.deepEqual(roundWords(blocks, 0), { thinking: "first round's thought\n\nweighing the lexer", text: "first round's wordsI'll read " });
    assert.deepEqual(roundWords(blocks, 4), { thinking: "", text: "" }, "a round that has streamed nothing yet");
    assert.deepEqual(roundWords([], 0), { thinking: "", text: "" });
    const viewer = readFileSync("src/ui/harness/subagent-viewer.js", "utf8");
    assert.match(viewer, /const run = runOf\(next\);/, "its run, or one on another machine's run here");
    assert.match(viewer, /follow = o\.follow \? o\.follow\(hears\) : followRun\(run, \{ words: true, \.\.\.hears \}\);/, "the run's words are asked for");
    assert.match(viewer, /words = applyWords\(\/\*\* @type \{any\} \*\/ \(words\), w\);/, "and kept as they come");
    assert.match(viewer, /roundView\(r\)\.from = Number\.isInteger\(e\.blocksBefore\) \? e\.blocksBefore : null;/, "each round knows where its own begin");
    assert.match(viewer, /if \(own\.thinking && !v\.thought\) \{/, "its thinking streams until the log brings it whole");
    assert.match(viewer, /if \(said && !v\.said\) \{/, "and its words");
  });
});

describe("the store takes the feed's progress", () => {
  // (fails before: yes — a running sub-agent's progress reached the page only for a graph task's line)
  test("a running row takes its progress as it comes; another session's, an unlisted row's or an ended one's changes nothing", () => {
    const rows = /** @type {any[]} */ ([row({ id: "sa_1" }), row({ id: "sa_2", status: "done" })]);
    const progress = { round: 3, tool: { name: "read", args: "a.js" }, context: null, compactions: [], words: "Reading.", spent: 0.01, asking: null };
    assert.equal(mergeProgress(rows, "c1", { type: "subagent-progress", chainId: "c1", id: "sa_1", progress }), true);
    assert.deepEqual(rows[0].progress, progress);
    assert.equal(mergeProgress(rows, "c1", { type: "subagent-progress", chainId: "c2", id: "sa_1", progress: {} }), false);
    assert.equal(mergeProgress(rows, "c1", { type: "subagent-progress", chainId: "c1", id: "sa_9", progress: {} }), false);
    assert.equal(mergeProgress(rows, "c1", { type: "subagent-progress", chainId: "c1", id: "sa_2", progress: {} }), false);
    assert.equal(mergeProgress(rows, "c1", { type: "subagent", chainId: "c1", id: "sa_1" }), false);
    assert.equal(mergeProgress(rows, "", { type: "subagent-progress", chainId: "", id: "sa_1", progress: {} }), false);
    assert.deepEqual(rows[0].progress, progress);
  });
});

describe("HarnessV3-TaskGraph G3: a team's tasks in words", () => {
  // (fails before: yes — G3-7: a task still to come showed nowhere but the graph)
  test("the tasks still to come: each a sub-agent's or a worker's, waiting or ready, with what it waits on in the words of whoever plans", () => {
    const graph = {
      closed: null,
      held: null,
      tasks: [
        { id: "t1", name: "Map", by: "scout", state: "done", needs: [], ready: false, stopped: false },
        { id: "t2", name: "Fix", by: "builder", state: "waiting", needs: ["t1"], ready: true, stopped: false },
        { id: "t3", name: "Test", by: "tester", state: "waiting", needs: ["t1", "t2"], ready: false, stopped: false },
        { id: "t4", name: "Again", by: "builder", state: "waiting", needs: ["t1", "t2"], ready: false, stopped: true },
        { id: "t5", name: "Own", by: "you", state: "waiting", needs: [], ready: true, stopped: false },
        { id: "t6", name: "Running", by: "builder", state: "running", needs: [], ready: false, stopped: false },
      ],
    };
    assert.deepEqual(team.waitingTasks(graph, "team"), [
      { id: "t2", name: "Fix", by: "builder", state: "ready", line: "Filament starts it" },
      { id: "t3", name: "Test", by: "tester", state: "waiting", line: "needs t2" },
      { id: "t4", name: "Again", by: "builder", state: "waiting", line: "stopped by the developer" },
    ]);
    const held = { ...graph, held: { at: 1 } };
    assert.deepEqual([team.waitingTasks(held, "team")[0].line, team.waitingTasks(held, "agent")[0].line], ["held until the lead's next tasks call", "held until the agent's next tasks call"]);
    assert.deepEqual([team.waitingTasks(null, "team"), team.waitingTasks({ ...graph, closed: { at: 1, reason: "shipped" } }, "team")], [[], []]);
    // (fails before: yes — every stop read "stopped by the developer", its lead's and the agent's own with its agent
    // tool included, ag-stop)
    const whose = (/** @type {unknown} */ stopped) => team.waitingTasks({ closed: null, held: null, tasks: [{ id: "t1", name: "Again", by: "builder", state: "waiting", needs: [], ready: false, stopped }] }, "agent")[0].line;
    assert.deepEqual(["developer", "lead", "agent"].map(whose), ["stopped by the developer", "stopped by its lead", "stopped by your agent"], "the line names whose stop it was, as the Plan page's does");
    assert.deepEqual(["developer", "lead", "agent", true].map(team.stoppedWords), ["stopped by the developer", "stopped by its lead", "stopped by your agent", "stopped by the developer"]);
  });

  // (fails before: yes — the same: nothing said who plans the graph, in the page's words)
  test("who plans the graph: a team's lead while a team leads, else the agent — a team that cannot lead leaves it to the model; names in a list", () => {
    assert.equal(team.crewOf({ mode: "team", team: "builders", teams: TEAMS, problem: null }), "team");
    assert.equal(team.crewOf({ mode: "team", team: "builders", teams: TEAMS, problem: "the agent loop is off" }), "agent");
    assert.deepEqual([team.crewOf({ mode: "agent", team: null, teams: TEAMS }), team.crewOf(undefined)], ["agent", "agent"]);
    assert.deepEqual([team.listWords(["a"]), team.listWords(["a", "b"]), team.listWords(["a", "b", "c"])], ["a", "a and b", "a, b and c"]);
  });

  // (fails before: yes — the drive's Team view: the lead's card said Filament's closing note, its copy for clients that
  // draw no card, where the lead's own words belong)
  test("the lead's newest words leave Filament's closing note out, whether it closes the reply's words or stands alone", () => {
    const note = { kind: "ask", text: "Which parser should I keep?\n1. the old one\n2. the new one\nReply with the number of your choice." };
    assert.equal(newestWords([{ type: "text", text: `Map first.\n\nThen the fix, reviewed.\n\n${note.text}` }], note), "Then the fix, reviewed.", "as the archive keeps it: after the reply's words");
    assert.equal(newestWords([{ type: "text", text: "Map first, then the fix." }, { type: "text", text: note.text }], note), "Map first, then the fix.", "live: a block of its own");
    assert.equal(newestWords([{ type: "text", text: note.text }], note), "", "nothing but the note: no words of the lead's");
    assert.equal(newestWords([{ type: "text", text: `Done.\n\n${note.text}` }]), note.text.replace(/\s+/g, " "), "no note named: the words as they stand");
  });

  // (fails before: yes — the drive's conversation: a team's lead waiting for its workers said it waited for its
  // sub-agents)
  test("a lead's turn waits for its workers, in those words; the agent's for its sub-agents", () => {
    const wait = { to: "waiting", why: "waiting for sub-agents to report" };
    assert.deepEqual([turnStateWords(wait, true), turnStateWords(wait), turnStateWords({ to: "waiting", why: "the developer's paused launch" }, true)],
      ["waiting for its workers", "waiting for its agents", "waiting for your agent"]);
  });
});
