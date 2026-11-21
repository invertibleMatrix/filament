// @ts-check
// HarnessV4_Tasks E13-1, the pure parts of what a side agent sees: a running turn's work as its run log holds it
// (core/run-work.js `runningWork`, BW-6) — the newest round whole, the earlier ones apart to be folded, and at a later
// look only the rounds that moved (BW-7) — and the starts' table (services/subagent-starts.js, BW-4).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CALL_CUT, CALL_OPEN, callWaits, compactionWords, newestCompaction, runningWork, workOfRun } from "../src/core/run-work.js";
import { CATCH_UP_TASK, SUBAGENT_STARTS, startFields } from "../src/services/subagent-starts.js";
import { SUBAGENT_VIEWS } from "../src/services/session-settings.js";

/** A run's events, numbered as the run log numbers them. @param {any[]} list */
const numbered = (list) => list.map((e, i) => ({ n: i + 1, ...e }));
const LOG = numbered([
  { type: "run-start" },
  { type: "round-start", round: 1 },
  { type: "round-text", round: 1, text: "Reading the notes." },
  { type: "tool-start", round: 1, id: "c1", name: "read", args: "notes.txt" },
  { type: "tool-end", round: 1, id: "c1", name: "read", ok: true, preview: "NOTES-BODY" },
  { type: "round-start", round: 2 },
  { type: "tool-start", round: 2, id: "c2", name: "bash", args: "npm test" },
  { type: "tool-end", round: 2, id: "c2", name: "bash", ok: false, preview: "1 failing" },
  { type: "round-start", round: 3 },
  { type: "round-text", round: 3, text: "Fixing the test." },
  { type: "tool-start", round: 3, id: "c3", name: "edit", args: "a.js" },
]);
/** Every tool_result of some messages, as [call, words, failed]. @param {any[]} messages */
const results = (messages) => messages.flatMap((m) => (m.role === "user" ? m.content : [])).filter((b) => b.type === "tool_result").map((b) => [b.tool_use_id, b.content, !!b.is_error]);
/** Every call of some messages, by id. @param {any[]} messages */
const callsOf = (messages) => messages.flatMap((m) => (m.role === "assistant" ? m.content : [])).filter((b) => b.type === "tool_use").map((b) => b.id);

describe("a running turn's work, from its run log (E13-1, BW-6)", () => {
  test("the newest round stands apart from the earlier ones, and a call still running says so", () => {
    const w = runningWork(LOG);
    assert.deepEqual(callsOf(w.older), ["c1", "c2"], "the earlier rounds, to be folded");
    assert.deepEqual(callsOf(w.newest), ["c3"], "the newest round, whole");
    assert.deepEqual(results(w.older), [["c1", "NOTES-BODY", false], ["c2", "1 failing", true]]);
    // (fails before: a call with no end read "Filament stopped before this call finished", the words of a cut turn)
    assert.deepEqual(results(w.newest), [["c3", CALL_OPEN, false]], "its call has no end yet: it runs, it did not fail");
    assert.equal(w.newest[0].content[0].text, "Fixing the test.");
    assert.deepEqual([w.rounds, w.tools, w.event], [3, 3, 11]);
    // A round that has begun and said nothing yet (its model call is in flight) is nothing to show: the round before
    // it is still the newest. (fails before: round 3 was folded with the others, and nothing was shown whole)
    const thinking = runningWork([...LOG, { n: 12, type: "round-start", round: 4 }]);
    assert.deepEqual([callsOf(thinking.older), callsOf(thinking.newest), thinking.rounds], [["c1", "c2"], ["c3"], 3]);
  });

  test("a later look carries only the rounds that moved since, and nothing when none did", () => {
    const first = runningWork(LOG);
    assert.deepEqual(runningWork(LOG, { since: first.event }), { older: [], newest: [], rounds: 0, tools: 0, event: 11 });
    // A thinking model, a state change, a new round's start: nothing to show.
    const quiet = [...LOG, { n: 12, type: "turn-state", from: "acting", to: "planning" }, { n: 13, type: "round-thinking", round: 3, thinking: "hm" }];
    assert.deepEqual(runningWork(quiet, { since: first.event }), { older: [], newest: [], rounds: 0, tools: 0, event: 13 });
    const later = [...LOG, { n: 12, type: "tool-end", round: 3, id: "c3", name: "edit", ok: true, preview: "edited" }, { n: 13, type: "round-start", round: 4 }, { n: 14, type: "round-text", round: 4, text: "Running it again." }];
    const w = runningWork(later, { since: first.event });
    assert.deepEqual(callsOf(w.older), ["c3"], "round 3 moved: its call ended");
    assert.deepEqual(results(w.older), [["c3", "edited", false]]);
    assert.deepEqual(w.newest, [{ role: "assistant", content: [{ type: "text", text: "Running it again." }] }]);
    assert.deepEqual([w.rounds, w.tools, w.event], [2, 1, 14]);
    assert.ok(!JSON.stringify(w).includes("NOTES-BODY"), "rounds 1 and 2 are not said twice");
  });

  test("a log with no round yet shows nothing; the cut turn's own rebuild is as it was", () => {
    assert.deepEqual(runningWork(numbered([{ type: "run-start" }, { type: "round-start", round: 1 }])), { older: [], newest: [], rounds: 0, tools: 0, event: 2 });
    assert.deepEqual(runningWork([]), { older: [], newest: [], rounds: 0, tools: 0, event: 0 });
    const cut = workOfRun(LOG);
    assert.deepEqual(results(cut.work).at(-1), ["c3", CALL_CUT, true], "a turn a restart cut off still says its call was cut");
    assert.deepEqual([cut.rounds, cut.tools], [3, 3]);
  });
});

// (fails before: yes — the owner's words of 10-19: "the context window only contains the content since last
// compaction"; a reader beside a turn was shown its rounds from the turn's start, those a compaction took included)
describe("a running turn from its newest compaction on", () => {
  // Round 2 ended, then the work up to it was folded or compacted, then round 3 ran.
  const at = (/** @type {any} */ e) => [...LOG.slice(0, 8), { n: 9, type: "compaction", round: 2, ...e }, ...LOG.slice(8).map((x) => ({ ...x, n: x.n + 1 }))];
  test("the newest compaction that took anything: Filament's fold of the turn's rounds, or the agent's own", () => {
    assert.deepEqual(newestCompaction(at({ fromRound: 1, toRound: 2, tokensBefore: 9, tokensAfter: 3, summary: " Read the notes; the test fails. ", by: "glm-5.3-flash" })), { at: 9, own: false, round: 2, fromRound: 1, toRound: 2, by: "glm-5.3-flash", summary: "Read the notes; the test fails." });
    assert.deepEqual(newestCompaction(at({ own: true, by: "Claude Code", summary: "So far: notes read." })), { at: 9, own: true, round: 2, fromRound: 0, toRound: 0, by: "Claude Code", summary: "So far: notes read." });
    // What took nothing: the earlier turns giving way (the turn's rounds stay whole), a fold that stood down or folded
    // nothing, an agent's that failed, the overflow recovery's own mark beside its fold's.
    for (const e of [{ earlier: true, fromTurn: 1, toTurn: 3, method: "trim" }, { stoodDown: true }, { manual: true, result: "little" }, { own: true, result: "failed", error: "no room" }, { why: "overflow-refusal", cleared: 2, folded: true }, { manual: true, result: "compacted" }])
      assert.equal(newestCompaction(at(e)), null, JSON.stringify(e));
    assert.equal(newestCompaction(LOG), null);
    const twice = [...at({ fromRound: 1, toRound: 1, summary: "one" }), { n: 13, type: "compaction", round: 3, fromRound: 2, toRound: 3, summary: "two" }];
    assert.deepEqual([newestCompaction(twice)?.at, newestCompaction(twice)?.summary], [13, "two"], "the newest stands for the older one too");
  });

  test("its words: who made room, and the summary that stands for what went — or that the log kept none", () => {
    assert.equal(compactionWords(/** @type {any} */ (newestCompaction(at({ fromRound: 1, toRound: 2, summary: "Read the notes.", by: "glm-5.3-flash" })))),
      "[Filament summarized this turn's rounds up to round 2 here to make room (glm-5.3-flash wrote it): they are gone from the agent's window, and this summary stands for them:]\n\nRead the notes.");
    assert.equal(compactionWords(/** @type {any} */ (newestCompaction(at({ own: true, by: "Claude Code" })))),
      "[Claude Code compacted its own context here, in round 2 of this turn: the earlier turns and this turn's work before this point are gone from its window; the run's log kept no summary of them.]");
  });

  test("the rounds before it are gone from what a reader is shown; those after stand as before", () => {
    const events = at({ fromRound: 1, toRound: 2, summary: "Read the notes." });
    const cut = /** @type {any} */ (newestCompaction(events));
    const w = runningWork(events, { since: cut.at });
    assert.deepEqual([callsOf(w.older), callsOf(w.newest), w.rounds], [[], ["c3"], 1]);
    assert.ok(!JSON.stringify(w).includes("NOTES-BODY"), "round 1's result is the summary's now");
  });
});

describe("the starts' table (E13-1, BW-4)", () => {
  test("four starts, each a row of the launch's own fields; Catch me up brings its own task", () => {
    assert.deepEqual(Object.keys(SUBAGENT_STARTS), ["ask", "job", "review", "catchup"]);
    assert.deepEqual(
      Object.values(SUBAGENT_STARTS).map((s) => [s.name, s.view, s.running, s.changes, s.worker, s.may, s.worktree, s.deliver]),
      [
        // ("Teams, improved and kept" of 11-03: Ask and Catch me up read, as the Reviewer; a job in a copy is the Builder's)
        ["Ask", "folded", true, null, "reviewer", "read", false, false],
        // (U13 W3: Start…'s quick starts, as it names them)
        ["Try it in a copy", "folded", true, null, "builder", "edit", true, false],
        // (fails before: yes — the owner's word of 10-31: a reviewer judges the change apart from the reasoning behind it)
        ["Review my last change", "none", false, "turn", "reviewer", "read", false, false],
        ["Catch me up", "folded", true, null, "reviewer", "read", false, false],
      ],
    );
    // (fails before: yes — HarnessV4_Tasks E15 step 7, AG-206: no start brought a question of its own)
    assert.deepEqual(
      Object.values(SUBAGENT_STARTS).map((s) => [s.id, s.task ?? null, s.since ?? null, s.asks ?? false]),
      [["ask", null, null, false], ["job", null, null, false], ["review", null, null, false], ["catchup", CATCH_UP_TASK, "message", true]],
      "its question, what it reads — the session since your last message — and that it answers as its card in the chat",
    );
    assert.match(CATCH_UP_TASK, /^Catch me up\. In five lines, what happened in this session since my last message/);
    for (const s of Object.values(SUBAGENT_STARTS)) assert.ok(s.view in SUBAGENT_VIEWS, `${s.id}'s view is one a launch takes`);
  });

  test("a start only sets the row: what the launch names itself wins; an unknown start is refused in words", () => {
    assert.deepEqual(startFields("ask"), { ok: true, start: "ask", row: SUBAGENT_STARTS.ask, fields: { view: "folded", running: true, changes: null, worker: "reviewer", may: "read", worktree: false, deliver: false } });
    const r = startFields("ASK", { view: "window", worktree: undefined, deliver: true, model: "glm" });
    assert.deepEqual(r, { ok: true, start: "ask", row: SUBAGENT_STARTS.ask, fields: { view: "window", running: true, changes: null, worker: "reviewer", may: "read", worktree: false, deliver: true } }, "a named field wins; one left undefined does not; a field no start has is not the table's to carry");
    assert.deepEqual(startFields("watch"), { ok: false, error: "start must be one of ask, job, review, catchup" });
    assert.deepEqual(startFields(null), { ok: true, start: null, row: null, fields: {} }, "no start: nothing is set");
  });
});

// (fails before: yes — HarnessV4_Tasks E15 step 2, the plan's case 31: a coding agent's call that waited for the
// developer's permission read "(still running …)" to an agent asked about it)
describe("a running turn that waits for the developer", () => {
  const ASK = "Allow this command? npm publish";
  const WAITING = numbered([
    { type: "run-start" },
    { type: "round-start", round: 1 },
    { type: "round-text", round: 1, text: "Publishing." },
    { type: "tool-start", round: 1, id: "c1", name: "bash", args: "npm publish" },
    { type: "ask", round: 1, kind: "permission", tool: "bash", question: ASK, waits: true, id: "q1", call: "c1" },
  ]);

  test("a call a permission waits on says so, with what is asked; answered, it runs again; a cut turn's is cut", () => {
    const w = runningWork(WAITING);
    assert.deepEqual(results(w.newest), [["c1", `(waiting for the developer's answer when Filament read the turn's log: ${ASK})`, false]]);
    assert.equal(callWaits(ASK), results(w.newest)[0][1]);
    assert.equal(w.event, 5);
    const answered = runningWork([...WAITING, { n: 6, type: "ask-end", round: 1, id: "q1", call: "c1", outcome: "accepted", words: [] }]);
    assert.deepEqual(results(answered.newest), [["c1", CALL_OPEN, false]]);
    assert.deepEqual(results(workOfRun(WAITING).work), [["c1", CALL_CUT, true]], "a turn cut off while it waited: its call never finished");
  });

  test("a question of the agent's own stands on a call of its own, which says it waits; a later look is told when it began to", () => {
    const own = numbered([
      { type: "run-start" },
      { type: "round-start", round: 1 },
      { type: "tool-start", round: 1, id: "ask:q2", name: "ask", args: "Which database?" },
      { type: "ask", round: 1, kind: "question", tool: "ask", question: "Which database?", waits: true, id: "q2" },
    ]);
    assert.deepEqual(results(runningWork(own).newest), [["ask:q2", "(waiting for the developer's answer when Filament read the turn's log.)", false]], "its target says the question: it is not said twice");
    // Shown the call while it ran, a later look carries the round again once it waits — and nothing after that.
    assert.deepEqual(results(runningWork(WAITING, { since: 4 }).newest).map((r) => r[0]), ["c1"]);
    assert.deepEqual(runningWork(WAITING, { since: 5 }).newest, []);
    // A question that does not wait in its run (Filament's own loop ends its turn to ask) leaves the call as it is.
    const paused = [...WAITING.slice(0, 4), { n: 5, type: "ask", round: 1, kind: "permission", tool: "bash", question: ASK }];
    assert.deepEqual(results(runningWork(paused).newest), [["c1", CALL_OPEN, false]]);
  });
});
