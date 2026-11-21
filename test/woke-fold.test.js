// @ts-check
// The lines under a turn's capsule (the owner's words of 11-03: "put this background command output as collapsible text
// on a single line and just show an arrow on the right side of that line"): a long one — a background command's end
// with its output's last lines, a coding agent's task summary — stands folded to one row, a chevron at its right; a
// press opens it whole, its line breaks kept, and the turn keeps it open through a redraw. A short line stays as it was.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { lift } from "./helpers/app-lift.js";
import { wokeRow, ownRow } from "../src/ui/harness/conversation/turn.js";
import { ICONS } from "../src/ui/harness/lib/icons.js";
import { transcriptTurns, withReadWork, mergedTurns } from "../src/ui/harness/conversation/history.js";
import { withReadRuns } from "../src/ui/harness/lib/turn-reads.js";

/** A command's end as the agent read it (commands.js `endText`), its output's last lines under its head. */
const ENDED = [
  "[Filament: your background command bg_7 ended — `cd H:\\work\\app && node --test test/a.test.js` exited with code 1 after 20 s.]",
  "The last 3 lines of its output:",
  "not ok 6 - the fold keeps its line breaks",
  "# tests 6",
  "# fail 1",
  "All of its output: C:\\Users\\me\\AppData\\Roaming\\Filament\\commands\\bg_7.log]",
].join("\n");
/** The time the agent set came: its line says the agent's note, short. */
const NOTE = "[Filament: the time you set has come — 10 min ago you asked to come back to this chat. Your note: Check the deploy]";

/** @param {any} row */
const linesOf = (row) => row.querySelectorAll(".own-task");
/** @param {any} line */
const chevOf = (line) => line.querySelector(".own-task-chev");

/**
 * A fresh reading of the chat's transcript as app.js `hydrate` makes its turns: each anew from the transcript, with
 * what the page kept of the same turn as drawn (`withReadWork`, `withReadRuns` with its `keptOfTurn`), merged with the
 * page's own (`mergedTurns`). @param {any} tr @param {any[]} drawn
 */
const readAgain = (tr, drawn) => {
  const { keptOfTurn } = lift(["keptOfTurn?"], { meterRecords: new WeakMap() });
  return mergedTurns(drawn, withReadRuns(withReadWork(transcriptTurns(tr), drawn), drawn, keptOfTurn));
};
/** A coding agent's own turn in the transcript: running (no reply yet), else ended. @param {any} own @param {boolean} open */
const ownTranscript = (own, open) => ({
  turns: [{ n: 1, turnId: 7, requestIds: ["r7"], open, own, user: { role: "user", content: [{ type: "text", text: "Claude Code went on by itself." }] }, work: [], final: open ? null : { role: "assistant", content: [{ type: "text", text: "Case 6 fails." }] } }],
});

describe("the lines under a turn's capsule fold to one row (woke-fold)", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => {
    doc = stubDocument();
  });
  after(() => {
    doc.restore();
    delete (/** @type {any} */ (globalThis)).getSelection;
  });

  // (fails before: yes — the notice drew as one plain line that wrapped over every line of the output: no fold, no chevron)
  test("a command's end with its output draws folded: one row, its words whole in it, the chevron at its right, a button not expanded", () => {
    const [line] = linesOf(wokeRow({ wakeExits: [ENDED] }));
    assert.deepEqual([line.className, line.getAttribute("role"), line.getAttribute("tabindex"), line.getAttribute("aria-expanded")], ["own-task tone-warn is-fold", "button", "0", "false"]);
    assert.deepEqual(line.children.map((/** @type {any} */ k) => k.className), ["own-task-ic", "own-task-words", "own-task-chev"], "the glyph at its left, the chevron at its right");
    assert.equal(chevOf(line).innerHTML, ICONS.chevronRight, "the page's own chevron, as its other folds have");
    assert.equal(chevOf(line).getAttribute("aria-hidden"), "true");
    assert.equal(line.querySelector(".own-task-words").textContent, ENDED.replace(/^\[Filament: /, "").replace(/\]$/, "").replace(/^./, (c) => c.toUpperCase()), "what the agent was told, unchanged");
    assert.equal(line.getAttribute("title"), null, "no tooltip it had not");
    const css = readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8");
    assert.match(css, /\.own-task\.is-fold:not\(\.open\) \.own-task-words \{ white-space: nowrap; overflow: hidden; text-overflow: ellipsis; \}/, "folded, its words cut at the row's width");
    assert.match(css, /\.own-task-chev \{[^}]*margin-left: auto;[^}]*color: var\(--color-foreground-subtlest\);/, "the chevron at the row's right, as quiet as the glyph");
    assert.match(readFileSync(new URL("../src/ui/harness/aqua.css", import.meta.url), "utf8"), /\.own-task-chev \{ color: var\(--aq-label-3\); \}/, "and in Aqua");
  });

  // (fails before: yes — the line heard no press: nothing to open, nothing to fold)
  test("a press opens it whole, its line breaks kept; another folds it; Enter and Space do the same; a press that ends a selection does not fold it", () => {
    const [line] = linesOf(wokeRow({ wakeExits: [ENDED] }));
    line.dispatch("click");
    assert.deepEqual([line.className, line.getAttribute("aria-expanded")], ["own-task tone-warn is-fold open", "true"]);
    assert.match(line.querySelector(".own-task-words").textContent, /20 s\.\]\nThe last 3 lines of its output:\nnot ok 6 - the fold keeps its line breaks\n# tests 6\n/, "the output's lines stay lines");
    assert.match(readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8"), /\.own-task\.is-fold\.open \.own-task-words \{ white-space: pre-wrap; \}/, "open, it wraps and keeps them");
    // Someone copying a path from the open line: the press that ends the selection leaves it open.
    /** @type {any} */ (globalThis).getSelection = () => "bg_7.log";
    line.dispatch("click");
    assert.equal(line.getAttribute("aria-expanded"), "true", "a selection's press is no fold");
    delete (/** @type {any} */ (globalThis)).getSelection;
    line.dispatch("click");
    assert.deepEqual([line.className, line.getAttribute("aria-expanded")], ["own-task tone-warn is-fold", "false"]);
    let held = 0;
    line.dispatch("keydown", { key: "Enter", preventDefault: () => held++ });
    assert.equal(line.getAttribute("aria-expanded"), "true", "Enter opens it");
    line.dispatch("keydown", { key: " ", preventDefault: () => held++ });
    assert.equal(line.getAttribute("aria-expanded"), "false", "Space folds it");
    assert.equal(held, 2, "the keys go no further: Space scrolls nothing");
    line.dispatch("keydown", { key: "a", preventDefault: () => held++ });
    assert.deepEqual([line.getAttribute("aria-expanded"), held], ["false", 2], "another key is not a press");
  });

  // (fails before: yes — a line of one row past 100 characters drew no fold either)
  test("a short line has no chevron and no fold; one past 100 characters, or holding a line break, has both", () => {
    const [note, code, crossed, broken] = linesOf(wokeRow({ wakeExits: [NOTE, "[Filament: background shell bg_1 (npm test) exited with code 0.]", `[Filament: ${"x".repeat(101)}]`, "[Filament: a watch caught:\nready]"] }));
    for (const line of [note, code]) {
      assert.equal(chevOf(line), null, line.textContent);
      assert.deepEqual([line.getAttribute("role"), line.getAttribute("tabindex"), line.getAttribute("aria-expanded"), line.classList.contains("is-fold")], [null, null, null, false]);
    }
    assert.deepEqual([note.className, note.textContent, note.getAttribute("title")], ["own-task tone-ok", "✓The agent's note: Check the deploy", "Check the deploy"], "the note's line as it was, whole on hover");
    note.dispatch("click");
    assert.equal(note.className, "own-task tone-ok", "a press on it does nothing");
    for (const line of [crossed, broken]) assert.deepEqual([line.classList.contains("is-fold"), line.getAttribute("aria-expanded"), !!chevOf(line)], [true, "false", true], line.textContent);
  });

  // (fails before: yes — a coding agent's own task line drew plain, its summary wrapping whole)
  test("a coding agent's own task line folds the same way", () => {
    const summary = "The suite failed:\nnot ok 6 - the fold keeps its line breaks\n# fail 1";
    const turn = { own: { agent: "Claude Code", tasks: [{ status: "failed", summary }, { status: "completed", summary: "The tests pass." }] } };
    const [long, short] = linesOf(ownRow(turn));
    assert.deepEqual([long.className, long.getAttribute("role"), long.getAttribute("aria-expanded"), long.getAttribute("title")], ["own-task tone-error is-fold", "button", "false", "The task failed"]);
    assert.equal(chevOf(long).innerHTML, ICONS.chevronRight);
    long.dispatch("click");
    assert.deepEqual([long.className, long.getAttribute("aria-expanded"), long.querySelector(".own-task-words").textContent], ["own-task tone-error is-fold open", "true", summary]);
    assert.deepEqual([short.className, short.textContent, chevOf(short)], ["own-task tone-ok", "✓The tests pass.", null]);
  });

  // (fails before: yes — the timeline draws a turn's row anew on each render, and every line came back folded)
  test("a redraw keeps an open line open: the turn keeps it by its place, and a fresh reading of the session carries it", () => {
    const turn = { woke: true, wakeExits: [ENDED, ENDED, NOTE] };
    linesOf(wokeRow(turn))[1].dispatch("click");
    const again = linesOf(wokeRow(turn));
    assert.deepEqual(again.map((/** @type {any} */ l) => l.getAttribute("aria-expanded")), ["false", "true", null], "the second line, open; the first, folded");
    assert.ok(again[1].classList.contains("open"));
    again[1].dispatch("click");
    assert.deepEqual(linesOf(wokeRow(turn)).map((/** @type {any} */ l) => l.getAttribute("aria-expanded")), ["false", "false", null], "folded again, it is drawn folded");
    const own = { own: { agent: "Claude Code", tasks: [{ status: "failed", summary: "a\nb" }] } };
    linesOf(ownRow(own))[0].dispatch("click");
    assert.equal(linesOf(ownRow(own))[0].getAttribute("aria-expanded"), "true", "a coding agent's own turn's too");
    // A hydrate makes every turn anew (app.js `hydrate`, lib/turn-reads.js `withReadRuns`): what the page keeps of a turn
    // goes onto its fresh copy — an ended one's here.
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    assert.match(app, /const turns = withReadRuns\(withReadWork\(transcriptTurns\(tr\), chat\.turns\), chat\.turns, keptOfTurn\);/);
    const ended = { agent: "Claude Code", tasks: [{ status: "failed", summary: "a\nb" }] };
    const drawn = transcriptTurns(ownTranscript(ended, false));
    linesOf(ownRow(drawn[0]))[0].dispatch("click");
    const read = readAgain(ownTranscript(ended, false), drawn);
    assert.notEqual(read[0], drawn[0], "the reading's copy of the turn");
    assert.equal(linesOf(ownRow(read[0]))[0].getAttribute("aria-expanded"), "true", "an ended turn's line, open through a reading");
  });

  // (fails before: yes — the hand-over to a reading's copy of a turn waited for its end, so a line opened while a coding
  // agent's own turn ran came back folded at a reading of it then: Reload session, say)
  test("a line opened while its turn runs stays open through a reading of the turn that runs still, and through the reading at its end", () => {
    const own = { agent: "Claude Code", tasks: [{ status: "failed", summary: "The suite failed:\nnot ok 6 - the fold keeps its line breaks\n# fail 1" }] };
    const drawn = transcriptTurns(ownTranscript(own, true));
    assert.equal(drawn[0].status, "open", "the turn runs");
    linesOf(ownRow(drawn[0]))[0].dispatch("click");
    const running = readAgain(ownTranscript(own, true), drawn);
    assert.deepEqual([running[0] !== drawn[0], running[0].status], [true, "open"], "the reading made the running turn anew");
    assert.equal(linesOf(ownRow(running[0]))[0].getAttribute("aria-expanded"), "true", "drawn open while it runs");
    const done = readAgain(ownTranscript(own, false), running);
    assert.deepEqual([done[0].status, linesOf(ownRow(done[0]))[0].getAttribute("aria-expanded")], ["done", "true"], "and once it has ended");
    linesOf(ownRow(done[0]))[0].dispatch("click");
    assert.equal(linesOf(ownRow(readAgain(ownTranscript(own, false), done)[0]))[0].getAttribute("aria-expanded"), "false", "folded again, a reading draws it folded");
  });
});
