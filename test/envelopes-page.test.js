// @ts-check
// HarnessV4_Envelopes_Plan EN5, the page: another agent's result that reached the agent sealed while it worked stands in
// the chat where it landed — a card with its number, who sent it and its subject — and says how it stands: opened at a
// step of its own run, by the envelope tool or as the agent waited; else as the chat knows it now, opened in a later
// turn, or still sealed. One sealed in an earlier turn is said where it opened, and Filament's word on the ones still
// sealed (the turn's one reminder, the list said again) is drawn where it was said. The envelope tool's own call has its
// row; the session's sealed list reaches the page's store; the switch is on the Context section (its own test, in
// context-how.test.js).
// (fails before: yes — the run's envelope events drew nothing, and a report opened from its envelope drew a second row)
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { alignEvents, envelopeFrom, envelopeWords, envelopeOpenedWords, envelopeNoteWords, settingChangeWords, mergedCell } from "../src/ui/harness/lib/labels.js";
import { roundRows } from "../src/ui/harness/conversation/tools/render.js";
import { argSummary } from "../src/app/agent/tools.js";
import { chipActions } from "../src/ui/harness/conversation/tools/layout.js";
import { cardsEl } from "../src/ui/harness/conversation/timeline.js";

const SCOUT = { agentId: "sa_1", description: "Map it", sender: 'your scout sa_1 ("Map it")' };
const TEAM = { agentId: "team_1", description: "the Bug Hunter team", sender: "the Bug Hunter team beside this chat", via: "team" };

/** A run that sealed two results at its first step, opened the scout's with the envelope tool at its second, opened
 *  one sealed in an earlier turn as it waited, reminded the agent once of the team's, and listed the sealed ones again
 *  after a compaction. */
const RUN = [
  { type: "round-start", round: 0 },
  { type: "envelope-sealed", round: 0, envelope: 1, ...SCOUT, subject: "Three files hold the parser" },
  { type: "envelope-sealed", round: 0, envelope: 2, ...TEAM, subject: "Two found in the parser" },
  { type: "round-start", round: 1 },
  { type: "tool-start", round: 1, id: "e1", name: "envelope", args: { count: 1 } },
  { type: "envelope-opened", round: 1, envelope: 1, ...SCOUT, by: "tool" },
  { type: "subagent-report", round: 1, agentId: "sa_1", description: "Map it", kind: "report", envelope: 1 },
  { type: "tool-end", round: 1, id: "e1", ok: true, preview: "parse.js, lex.js and read.js hold the parser" },
  { type: "round-start", round: 2 },
  { type: "envelope-opened", round: 2, envelope: 7, agentId: "sa_9", description: "Old one", sender: "", by: "wait" },
  { type: "subagent-report", round: 2, agentId: "sa_9", description: "Old one", kind: "report", envelope: 7 },
  { type: "envelope-reminder", round: 2, envelopes: [2] },
  { type: "round-start", round: 3 },
  { type: "envelope-list", round: 3, envelopes: [2, 3, 4], at: "compaction" },
  { type: "subagent-report", round: 3, agentId: "team_2", description: "the Verifier team", kind: "result" },
];

describe("the run's envelope events, aligned", () => {
  test("a card where each was sealed, marked where its own run opened it; one of an earlier turn said where it opened; the reminder and the list where they were said; no second row for a report opened from its envelope", () => {
    const a = alignEvents(RUN);
    const [first, second, third, fourth] = [0, 1, 2, 3].map((r) => a.byRound.get(r));
    assert.deepEqual(first.envelopes, [
      { n: 1, agentId: "sa_1", description: "Map it", sender: SCOUT.sender, subject: "Three files hold the parser", opened: { round: 1, by: "tool" } },
      { n: 2, agentId: "team_1", description: "the Bug Hunter team", sender: TEAM.sender, subject: "Two found in the parser", via: "team", opened: null },
    ]);
    assert.deepEqual([second.reports, second.opens, second.envelopes], [[], [], []], "the scout's report opened from its envelope: its card says so, no row of its own");
    assert.deepEqual(third.opens, [{ n: 7, agentId: "sa_9", description: "Old one", sender: "", by: "wait" }]);
    assert.deepEqual(third.reports, []);
    assert.deepEqual(third.envelopeNotes, [{ kind: "reminder", envelopes: [2] }]);
    assert.deepEqual(fourth.envelopeNotes, [{ kind: "list", at: "compaction", envelopes: [2, 3, 4] }]);
    assert.deepEqual(fourth.reports, [{ agentId: "team_2", kind: "result", description: "the Verifier team" }], "a team's result handed in whole draws its row");
    assert.deepEqual([...a.opened], [[1, { round: 1, by: "tool" }], [7, { round: 2, by: "wait" }]], "what this run opened, for the cards of earlier turns");
  });
});

describe("the envelopes' words", () => {
  test("its head, its subject and how it stands; where one sealed earlier opened; Filament's word on the sealed ones; the switch's change", () => {
    const scout = { n: 1, description: "Map it", subject: "Three files", opened: { round: 1, by: /** @type {const} */ ("tool") } };
    assert.deepEqual(envelopeWords(scout), { head: "Envelope 1 from “Map it”", subject: "Three files", state: "Opened at step 2", opened: true });
    const team = { n: 2, description: "the Bug Hunter team", via: /** @type {const} */ ("team"), subject: "Two found", opened: null };
    assert.deepEqual(envelopeWords(team), { head: "Envelope 2 from the Bug Hunter team", subject: "Two found", state: "Sealed", opened: false }, "not known yet: sealed");
    assert.equal(envelopeWords(team, { sealed: true }).state, "Sealed");
    assert.deepEqual([envelopeWords(team, { sealed: false }).state, envelopeWords(team, { sealed: false }).opened], ["Opened later", true]);
    assert.equal(envelopeWords(team, { sealed: false, later: { turn: 4, round: 0, by: "wait" } }).state, "Opened in turn 4, at step 1, as it waited");
    assert.equal(envelopeWords({ ...scout, opened: { round: 0, by: "wait" } }).state, "Opened at step 1, as it waited");
    assert.deepEqual([envelopeWords(team, { alone: true }).state, envelopeWords(team, { alone: true }).opened], ["Not opened in this run", false], "a thread's card knows only its run");
    assert.equal(envelopeWords(scout, { alone: true }).state, "Opened at step 2");
    assert.equal(envelopeFrom({ description: 'the flow "Ship it"', via: "flow" }), 'the flow "Ship it"');
    assert.equal(envelopeFrom({ description: "", via: "flow" }), "a flow");
    assert.equal(envelopeFrom({ description: "" }), "another agent");
    assert.equal(envelopeOpenedWords({ n: 7, description: "Old one", by: "wait" }), "The agent opened envelope 7, from “Old one”, as it waited: its report joined the conversation here");
    assert.equal(envelopeOpenedWords({ n: 3, description: "the Bug Hunter team", via: "team", by: "tool" }), "The agent opened envelope 3, from the Bug Hunter team: its report joined the conversation here");
    assert.equal(envelopeNoteWords({ kind: "reminder", envelopes: [2] }), "Filament told the agent once that envelope 2 is still sealed, as its turn would end");
    assert.equal(envelopeNoteWords({ kind: "reminder", envelopes: [2, 5] }), "Filament told the agent once that envelopes 2 and 5 are still sealed, as its turn would end");
    assert.equal(envelopeNoteWords({ kind: "list", at: "compaction", envelopes: [2, 3, 4] }), "Filament listed envelopes 2, 3 and 4 still sealed for the agent, after it compacted");
    assert.equal(envelopeNoteWords({ kind: "list", at: "start", envelopes: [2] }), "Filament listed envelope 2 still sealed for the agent, with your message");
    assert.equal(settingChangeWords("subagents.envelopes", "whole"), "Other agents' results reach your agent whole");
    assert.equal(settingChangeWords("subagents.envelopes", "sealed"), "Other agents' results reach your agent sealed while it works");
    assert.equal(settingChangeWords("subagents.envelopes", null), "Other agents' results: the default");
  });
});

describe("the cards on the page", () => {
  test("each card says how it stands, follows the store until it opens, and opens whoever sent it; the rows of an earlier turn's opening and of Filament's word", () => {
    const dom = stubDocument();
    const was = { ...chipActions };
    try {
      /** @type {Set<() => void>} */
      const watchers = new Set();
      /** @type {{ sealed: boolean | null, later: any }} */
      let now = { sealed: true, later: null };
      /** @type {string[]} */
      const went = [];
      Object.assign(chipActions, {
        envelopeState: () => now,
        watchSubagents: (/** @type {() => void} */ fn) => { watchers.add(fn); return () => watchers.delete(fn); },
        openSubagent: (/** @type {string} */ id) => went.push(`agent ${id}`),
        openTeam: (/** @type {string} */ id) => went.push(`team ${id}`),
        openFlow: (/** @type {string} */ id) => went.push(`flow ${id}`),
      });
      const a = alignEvents(RUN);
      const rows = cardsEl(a.byRound.get(0), { runId: "run-1" });
      /** @type {any[]} the stub's elements */
      const cards = rows.filter((r) => r.classList.contains("env-card"));
      assert.equal(cards.length, 2);
      const [scout, team] = cards;
      const text = (/** @type {any} */ el, /** @type {string} */ sel) => el.querySelector(sel)?.textContent;
      assert.deepEqual([text(scout, ".env-head"), text(scout, ".env-subject"), text(scout, ".env-state")], ["Envelope 1 from “Map it”", "Three files hold the parser", "Opened at step 2"]);
      assert.ok(scout.classList.contains("is-opened") && !scout.classList.contains("is-sealed"));
      assert.deepEqual([text(team, ".env-head"), text(team, ".env-state")], ["Envelope 2 from the Bug Hunter team", "Sealed"]);
      assert.ok(team.classList.contains("is-sealed"));
      assert.equal(team.getAttribute("title"), "From the Bug Hunter team beside this chat");
      assert.equal(watchers.size, 1, "only the one still sealed follows the store");
      // A later turn opened it: the store and the chat say so, and the card hears it.
      now = { sealed: false, later: { turn: 3, round: 1, by: "tool" } };
      for (const fn of watchers) fn();
      assert.equal(text(team, ".env-state"), "Opened in turn 3, at step 2");
      assert.ok(team.classList.contains("is-opened") && !team.classList.contains("is-sealed"));
      // Open goes to whoever sent it.
      scout.querySelector(".subagent-open").dispatch("click");
      team.querySelector(".subagent-open").dispatch("click");
      assert.deepEqual(went, ["agent sa_1", "team team_1"]);
      assert.equal(team.querySelector(".subagent-open").getAttribute("title"), "Open the team's chat: its result whole");
      // The third step: where one of an earlier turn opened, and the reminder.
      const third = cardsEl(a.byRound.get(2), { runId: "run-1" });
      const opened = third.find((r) => r.classList.contains("env-opened"));
      assert.equal(text(opened, ".sub-mark-text"), "The agent opened envelope 7, from “Old one”, as it waited: its report joined the conversation here");
      assert.equal(third.find((r) => r.classList.contains("env-note"))?.textContent, "Filament told the agent once that envelope 2 is still sealed, as its turn would end");
      // In an agent's thread its envelopes are numbered in a session of its own: the card knows only its run, and
      // follows no store of the open chat's.
      const before = watchers.size;
      const thread = cardsEl(alignEvents(RUN).byRound.get(0), { runId: "run-2", ownChat: false }).filter((r) => r.classList.contains("env-card"));
      assert.deepEqual(thread.map((c) => text(c, ".env-state")), ["Opened at step 2", "Not opened in this run"]);
      assert.equal(watchers.size, before, "a thread's card hears nothing of the open chat's store");
      // No page to follow (a card drawn outside the harness): it says what its own run knows.
      for (const k of /** @type {const} */ (["envelopeState", "watchSubagents", "openTeam", "openSubagent", "openFlow"])) chipActions[k] = null;
      const bare = cardsEl(alignEvents(RUN).byRound.get(0), { runId: "run-1" }).filter((r) => r.classList.contains("env-card"));
      assert.deepEqual(bare.map((c) => text(c, ".env-state")), ["Opened at step 2", "Sealed"]);
      assert.equal(bare[1].querySelector(".subagent-open"), null, "no way there: no Open");
    } finally {
      Object.assign(chipActions, was);
      dom.restore();
    }
  });

  test("the envelope tool's own row: how many it asked for, and what it read behind the row — Filament's tool and a coding agent's call of it", () => {
    const dom = stubDocument();
    try {
      /** @param {any[]} evs */
      const rowOf = (evs) => roundRows(alignEvents([{ type: "round-start", round: 0 }, ...evs]).byRound.get(0), { runId: "run-1" })[0];
      // The run's events carry the call's summary (agent/tools.js argSummary), as the drive of 10-24 showed: "" for the
      // oldest, a count, "all"; a coding agent's MCP call its JSON.
      // (fails before: yes — the summary was "", so a call that opened every one said "the oldest")
      assert.deepEqual([argSummary("envelope", {}), argSummary("envelope", { count: 1 }), argSummary("envelope", { count: 3 }), argSummary("envelope", { all: true })], ["", "", "3", "all"]);
      const done = rowOf([
        { type: "tool-start", id: "e1", name: "envelope", args: "" },
        { type: "tool-end", id: "e1", ok: true, preview: "parse.js holds the parser" },
      ]);
      assert.equal(done.querySelector(".tool-kind")?.textContent, "Opened envelopes");
      assert.equal(done.querySelector(".tool-primary")?.textContent, "the oldest");
      assert.ok(done.textContent.includes("What it read"), done.textContent);
      assert.ok(done.textContent.includes("parse.js holds the parser"));
      const running = rowOf([{ type: "tool-start", id: "e2", name: "envelope", args: argSummary("envelope", { count: 3 }) }]);
      assert.equal(running.querySelector(".tool-kind")?.textContent, "Opening envelopes");
      assert.equal(running.querySelector(".tool-primary")?.textContent, "the 3 oldest");
      const theirs = rowOf([
        { type: "tool-start", id: "e3", name: "mcp__filament__envelope", args: argSummary("mcp__filament__envelope", { all: true }) },
        { type: "tool-end", id: "e3", ok: true, preview: "both" },
      ]);
      assert.equal(theirs.querySelector(".tool-kind")?.textContent, "Opened envelopes");
      assert.equal(theirs.querySelector(".tool-primary")?.textContent, "every one still sealed");
    } finally {
      dom.restore();
    }
  });

  // The drive of 11-04: a main agent launched a helper and waited, the helper's letter came sealed (envelope 1); it
  // opened, answered and wrote back in one-call rounds, waited again, and the reply came (envelope 2). Rounds side by
  // side share a box, so the turn drew two boxes of several rounds, each with its own round's card; drawn with one map
  // of rows, as the timeline draws a turn.
  // (fails before: yes — a box of several rounds keyed its notes by no round, so the second box's card took the first's
  // row and moved it there: envelope 1's card left the page)
  test("two boxes of side-by-side rounds, an envelope each: each box keeps its own card", () => {
    const dom = stubDocument();
    try {
      const HELPER = { agentId: "sa_1", description: "Config helper", sender: 'your sub-agent sa_1 ("Config helper")', via: "agent" };
      /** @param {number} round @param {string} name */
      const call = (round, name) => [{ type: "round-start", round }, { type: "tool-start", round, id: `t${round}`, name, args: "" }, { type: "tool-end", round, id: `t${round}`, ok: true, preview: "ok" }];
      const a = alignEvents([
        ...call(1, "agent"),
        ...call(2, "wait"),
        { type: "envelope-sealed", round: 2, envelope: 1, ...HELPER, subject: "Which file?" },
        ...call(3, "envelope"),
        ...call(4, "envelope"),
        ...call(5, "wait"),
        { type: "envelope-sealed", round: 5, envelope: 2, ...HELPER, subject: "Re: Also c.js?" },
      ]);
      /** @type {import("../src/ui/harness/conversation/tools/render.js").DrawnRows} */
      const drawn = new Map();
      const draw = () => [[1, 2], [3, 4, 5]].map((rounds) => cardsEl(mergedCell(rounds.map((r) => a.byRound.get(r))), { runId: "run-1", drawn }).filter((r) => r.classList.contains("env-card")));
      const boxes = draw();
      assert.deepEqual(boxes.map((cards) => cards.map((c) => c.querySelector(".env-head")?.textContent)), [["Envelope 1 from “Config helper”"], ["Envelope 2 from “Config helper”"]]);
      assert.notEqual(boxes[0][0], boxes[1][0], "two cards, not one row moved between the boxes");
      // Drawn again, as every run event draws the turn: each box's card is the one it drew.
      const again = draw();
      assert.deepEqual([again[0][0] === boxes[0][0], again[1][0] === boxes[1][0]], [true, true]);
      assert.equal(again[0][0].querySelector(".env-head")?.textContent, "Envelope 1 from “Config helper”");
    } finally {
      dom.restore();
    }
  });
});

describe("the page's wiring", () => {
  test("the store reads the session's sealed list and looks again when it moves; the list route says it; the page's cards read the store and the later turns", () => {
    const src = (/** @type {string} */ p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
    const store = src("ui/harness/lib/subagents.js");
    assert.match(store, /envelopes = sealedOf\(r\?\.envelopes\);/);
    assert.match(store, /msg\?\.type === "subagent-envelopes"\) && chainId && msg\.chainId === chainId\) soon\(\);/);
    assert.match(store, /sealed: \(n\) => \(known \? envelopes\.some\(\(e\) => e\.n === Number\(n\)\) : null\),/);
    assert.match(src("http/admin/sessions.js"), /envelopes: reg\.envelopes \? reg\.envelopes\(r\.params\.id\) : \[\],/);
    assert.match(src("app/agent/subagents.js"), /const envelopesMoved = \(chainId\) => events\.publish\("subagents", \{ type: "subagent-envelopes", chainId \}\);/);
    const app = src("ui/harness/app.js");
    assert.match(app, /chipActions\.envelopeState = \(n\) => \{[\s\S]{0,200}t\.aligned\?\.opened\?\.get\?\.\(n\)[\s\S]{0,200}return \{ sealed: subagentStore\.sealed\(n\), later: null \};/);
    assert.match(app, /chipActions\.openTeam = \(id\) => \{ void openBesideChat\(id\); \};/);
    assert.match(app, /chipActions\.openFlow = \(id\) => openFlowRow\(id\);/);
    assert.match(src("ui/harness/subagent-viewer.js"), /cardsEl\(cell, \{[^}]*asksApart: false, steers: false, ownChat: false \}\)/, "an agent's thread: its cards know only its run");
  });
});
