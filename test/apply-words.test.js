// @ts-check
// Apply in its own words (the Designer's of 10-27, on the owner's "what does that apply button even do behind the
// scene"): what the agents band, an agent's thread, its card and its mark say of a sub-agent's work, from one module.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as words from "../src/ui/harness/lib/apply-words.js";
import { appliedWhen, byWords, choiceEffect, choiceLabel, choicesFor, effectLine, howApplyWorks, kindWords, markersWords, nowWords, rebaseWords, resultLine, shortFolder, waitsWords, whereWords, writingFile } from "../src/ui/harness/lib/apply-words.js";

const clock = () => "14:02";
const F = "H:\\filament";
/** @param {Record<string, string>} m */
const came = (m) => Object.entries(m).map(([path, how]) => ({ path, how: /** @type {any} */ (how) }));

// (fails before: yes — no such words: Apply was a hover title and a toast)
test("the effect line says what an Apply would write, merge, delete and leave, before the press", () => {
  assert.equal(effectLine({ folder: F, came: came({ "a.js": "took", "src/lib/now.js": "merged", "c.js": "took" }), conflicts: [] }),
    "Apply writes 3 files into H:\\filament: 2 as it left them, 1 merged with your edits (now.js). Nothing is staged or committed.");
  assert.equal(effectLine({ folder: F, came: came({ "a.js": "took" }), conflicts: [] }), "Apply writes 1 file into H:\\filament. Nothing is staged or committed.");
  assert.equal(effectLine({ folder: F, came: came({ "a.js": "took", "old.js": "deleted", "e.js": "same" }), conflicts: [] }),
    "Apply writes 1 file into H:\\filament, and deletes old.js. 1 is already the same in your folder. Nothing is staged or committed.");
  assert.equal(effectLine({ folder: F, came: came({ "old.js": "deleted" }), conflicts: [] }), "Apply deletes old.js from H:\\filament. Nothing is staged or committed.");
  // (fails before: yes — the Designer's of 10-27, built 10-28: "Can't apply as it stands — 1 of 3 files overlaps your
  // edits. Nothing was written.")
  assert.equal(effectLine({ folder: F, came: came({ "lib/now.js": "took", "c.js": "took" }), conflicts: [{ path: "lib/list.js", why: "2 changes overlap yours", kind: "lines" }] }),
    "Can't apply as it stands — 1 of 3 files overlaps your edits. Nothing would be written.");
  assert.equal(effectLine({ folder: F, came: [], conflicts: [{ path: "a.js", why: "1 change overlaps yours" }, { path: "b.png", why: "a binary file both you and the sub-agent changed", kind: "binary" }], pressed: true }),
    "Can't apply as it stands — its 2 files can't come in cleanly. Nothing was written.");
  assert.equal(effectLine({ folder: F, came: [], conflicts: [{ path: "a.js", why: "1 change overlaps yours", kind: "lines" }] }), "Can't apply as it stands — its file overlaps your edits. Nothing would be written.");
});

// (fails before: yes — 10-29: a stuck Apply never said which of its other files the folder held already, so a change
// brought in by hand read as all of it waiting)
test("a stuck Apply says how many of its other files are already the same in your folder", () => {
  assert.equal(effectLine({ folder: F, came: came({ "a.js": "same", "b.js": "same", "c.js": "took" }), conflicts: [{ path: "lib/list.js", why: "2 changes overlap yours", kind: "lines" }] }),
    "Can't apply as it stands — 1 of 4 files overlaps your edits, and 2 are already the same in your folder. Nothing would be written.");
  assert.equal(effectLine({ folder: F, came: came({ "a.js": "same" }), conflicts: [{ path: "lib/list.js", why: "1 change overlaps yours", kind: "lines" }], pressed: true }),
    "Can't apply as it stands — 1 of 2 files overlaps your edits, and 1 is already the same in your folder. Nothing was written.");
});

// (fails before: yes — an Apply took no choices: nothing said how a chosen file would come)
test("with the developer's choices the effect line names each chosen file's way: taken as its, with markers, kept as yours", () => {
  assert.equal(effectLine({ folder: F, came: came({ "a.js": "took", "b.js": "took", "lib/now.js": "kept" }), conflicts: [] }),
    "Apply writes 2 files into H:\\filament: 2 as it left them; now.js kept as yours (its change to it dropped). Nothing is staged or committed.");
  assert.equal(effectLine({ folder: F, came: came({ "a.js": "took", "lib/now.js": "replaced", "lib/list.js": "markers" }), conflicts: [] }),
    "Apply writes 3 files into H:\\filament: 1 as it left it, now.js taken as its, your edits replaced, list.js with conflict markers for you to resolve. Nothing is staged or committed.");
  assert.equal(effectLine({ folder: F, came: came({ "lib/now.js": "kept" }), conflicts: [] }), "Apply writes nothing: now.js kept as yours (its change to it dropped). Nothing is staged or committed.");
  assert.equal(resultLine({ at: 1, by: "owner", files: 3, came: { took: 1, merged: [], deleted: 0, same: 0, kept: ["now.js"], markers: ["list.js"] } }, clock),
    "Applied 14:02 by you — 3 files: 1 as it left it, 1 with conflict markers, 1 kept as yours. Nothing staged.");
});

// (fails before: yes — a file that stopped an Apply said only its why: no kind, no choices)
test("each kind of overlap in words, its choices and what each does", () => {
  const lines = { path: "src/lib/now.js", why: "2 changes overlap yours", kind: /** @type {const} */ ("lines"), overlaps: 2 };
  assert.deepEqual([kindWords(lines), choicesFor(lines).map((c) => choiceLabel("lines", c))], ["2 changes overlap yours", ["Keep yours", "Take its", "Both, with markers"]]);
  assert.equal(choiceEffect(lines, "its", "14:02"), "Your edits to now.js since 14:02 are replaced.");
  assert.equal(choiceEffect(lines, "yours"), "Its change to now.js is dropped.");
  assert.match(choiceEffect(lines, "both"), /^now\.js is written with both — git's conflict markers \(<<<<<<<\) around each overlap — for you to resolve\. Your agent is told to leave it alone\.$/);
  const deleted = { path: "old.js", why: "the sub-agent deleted it; you changed it since", kind: /** @type {const} */ ("deleted") };
  assert.deepEqual([kindWords(deleted), choicesFor(deleted).map((c) => choiceLabel("deleted", c)), choiceEffect(deleted, "its")], ["it deleted it; you changed it since", ["Keep yours", "Delete it"], "old.js is deleted, and your edits to it with it."]);
  const gone = { path: "g.js", why: "x", kind: /** @type {const} */ ("gone") };
  assert.deepEqual([choicesFor(gone).map((c) => choiceLabel("gone", c)), choiceEffect(gone, "yours")], [["Keep it deleted", "Take its"], "g.js stays deleted; its change to it is dropped."]);
  const binary = { path: "logo.png", why: "a binary file both you and the sub-agent changed", kind: /** @type {const} */ ("binary") };
  assert.deepEqual([kindWords(binary), choicesFor(binary)], ["a binary file you both changed", ["yours", "its"]]);
  const place = { path: "sub/x.txt", why: "a link or a submodule: apply it by hand", kind: /** @type {const} */ ("place") };
  assert.deepEqual([kindWords(place), choicesFor(place).map((c) => choiceLabel("place", c))], ["a link or a submodule: apply it by hand", ["Keep yours, apply it by hand"]]);
  assert.deepEqual(choicesFor({ ...lines, choices: ["yours"] }), ["yours"], "the server's own offer stands");
  assert.equal(rebaseWords("GLM 5.3"), "It redoes its change on your folder as it is now: a fresh copy with its change brought in and the overlaps marked, which it resolves and checks. Its work then waits again. One more run on GLM 5.3.");
  assert.equal(markersWords(["a.js"]), "1 file has conflict markers");
});

test("the result line takes the toast's place: when, who, how many and how", () => {
  assert.equal(resultLine({ at: 1, by: "owner", files: 3, came: { took: 2, merged: ["now.js"], deleted: 0, same: 0 } }, clock),
    "Applied 14:02 by you — 3 files: 2 as it left them, 1 merged with your edits. Nothing staged.");
  assert.equal(resultLine({ at: 1, by: "agent", files: 1, came: { took: 1, merged: [], deleted: 0, same: 0 } }, clock), "Applied 14:02 by your agent — 1 file. Nothing staged.");
  assert.equal(resultLine({ at: 1, by: "graph", files: 2, came: null }, clock), "Applied 14:02 by Filament, its check passed — 2 files. Nothing staged.");
  assert.deepEqual(["owner", "agent", "command", "graph"].map((b) => byWords(b)), ["you", "your agent", "your command", "Filament, its check passed"]);
  // (fails before: yes — the Hunter's of 10-28: an apply past a failed check was said to have passed it)
  assert.equal(resultLine({ at: 1, by: "graph", reason: "the flaky test is known", files: 2, came: null }, clock), "Applied 14:02 by Filament, past a failed check — 2 files. Nothing staged.");
});

test("where it works and what it does now, for its row's second line", () => {
  /** @param {Record<string, any>} over @returns {any} */
  const row = (over) => ({ id: "sa_1", status: "done", may: "edit", work: null, progress: null, ...over });
  const copy = { pending: 3, added: 40, removed: 12, applied: 0, open: true, folder: "H:\\filament\\.git\\filament-worktrees\\sa_ab98c676", lastApplied: null, files: [] };
  assert.deepEqual(whereWords(row({ work: copy })), { words: "its copy …\\filament-worktrees\\sa_ab98c676", folder: copy.folder });
  assert.deepEqual(whereWords(row({})).words, "your folder (shared)");
  assert.deepEqual([whereWords(row({ may: "read" })).words, whereWords(row({ may: "copy" })).words], ["reads only", "a throwaway copy, nothing kept"]);
  assert.equal(shortFolder("/home/me/p/.git/filament-worktrees/sa_1"), "…/filament-worktrees/sa_1");

  assert.equal(nowWords(row({ status: "running", work: copy, progress: { round: 3, tool: { name: "edit", args: '{"path":"src/lib/now.js"}' } } }), clock), "writing now.js · 3 files so far");
  assert.equal(nowWords(row({ status: "running", progress: { round: 2, tool: { name: "read", args: "a.js" } } }), clock), "round 2");
  assert.equal(nowWords(row({ work: copy }), clock), "3 files wait (+40 −12)");
  assert.equal(nowWords(row({ work: { ...copy, pending: 0, lastApplied: { at: 1, files: 3, by: "owner" } } }), clock), "applied 14:02 by you · 3 files");
  assert.equal(nowWords(row({ work: { ...copy, pending: 0, lastApplied: { at: 1, files: 2, by: "graph" } } }), clock), "applied 14:02 by Filament · 2 files");
  // The file first, the line being cut from its right (the Designer's of 10-28).
  assert.equal(nowWords(row({ work: { ...copy, pending: 0, lastApplied: { at: 1, files: 2, by: "owner", marked: ["src/a.js"] } } }), clock), "a.js has conflict markers · applied 14:02 by you");
  assert.equal(nowWords(row({ work: { ...copy, pending: 0, lastApplied: { at: 1, files: 2, by: "owner", marked: ["a.js", "lib/cart.js"] } } }), clock), "a.js and cart.js have conflict markers · applied 14:02 by you");
  assert.equal(nowWords(row({ work: { ...copy, pending: 0 } }), clock), "changed nothing");
  assert.equal(nowWords(row({ status: "failed" }), clock), "failed");
  assert.deepEqual([writingFile({ name: "write", args: "notes/plan.md" }), writingFile({ name: "bash", args: "npm test" })], ["plan.md", ""]);
});

// (fails before: yes — 10-29: a change brought over by hand could only read as applied by Filament, or as waiting)
test("a mark as applied in words: its result line says nothing was written; its row's and its copy's lines say marked", async () => {
  const { subState, copyFacts } = await import("../src/ui/harness/panes/changes-places.js");
  assert.equal(resultLine({ at: 1, by: "owner", files: 18, came: null, hand: true }, clock), "Marked as applied 14:02 by you — 18 files, in your folder already. Filament wrote nothing.");
  assert.equal(resultLine({ at: 1, by: "agent", files: 1, hand: true }, clock), "Marked as applied 14:02 by your agent — 1 file, in your folder already. Filament wrote nothing.");
  assert.equal(appliedWhen({ at: 1, by: "graph" }, clock), "applied 14:02 by Filament");
  assert.equal(appliedWhen({ at: 1, by: "owner", hand: true }, clock, { who: false }), "marked applied 14:02");
  /** @param {Record<string, any>} over @returns {any} */
  const row = (over) => ({ id: "sa_1", status: "done", may: "edit", progress: null, work: { pending: 0, added: 0, removed: 0, applied: 1, open: true, files: [], lastApplied: { at: 1, files: 18, by: "owner", hand: true } }, ...over });
  assert.equal(nowWords(row({}), clock), "marked applied 14:02 by you · 18 files");
  assert.equal(subState(row({}), 0, clock), "marked applied 14:02 by you");
  assert.equal(copyFacts(row({}), 0, 0, 0, clock), "marked applied 14:02");
  assert.equal(copyFacts(row({ work: { ...row({}).work, lastApplied: { at: 1, files: 2, by: "owner" } } }), 0, 0, 0, clock), "applied 14:02");
});

// (fails before: yes — the owner's of 10-30: work Filament finds in the folder whole had only a mark's words, "by filament")
test("work Filament found in your folder, in words: found there, brought in another way, nothing written", () => {
  assert.equal(resultLine({ at: 1, by: "found", files: 16, came: { took: 0, merged: [], deleted: 0, same: 16 }, hand: true }, clock), "Found in your folder 14:02 — 16 files, brought in another way. Filament wrote nothing.");
  assert.equal(appliedWhen({ at: 1, by: "found", hand: true }, clock), "found in your folder 14:02");
  /** @type {any} */
  const row = { id: "sa_1", status: "done", may: "edit", progress: null, work: { pending: 0, added: 0, removed: 0, applied: 1, open: true, files: [], lastApplied: { at: 1, files: 16, by: "found", hand: true } } };
  assert.equal(nowWords(row, clock), "found in your folder 14:02 · 16 files");
});

test("the card's and the mark's line, and How Apply works in five points naming its copy", () => {
  assert.deepEqual([waitsWords(3), waitsWords(1)], ["3 files wait in its copy · Review ›", "1 file waits in its copy · Review ›"]);
  const how = howApplyWorks("H:\\filament\\.git\\filament-worktrees\\sa_1");
  assert.equal(how.length, 5);
  assert.match(how[0], /^Its copy is a git worktree of your folder as it was when the agent started — your uncommitted changes included — at H:\\filament\\\.git\\filament-worktrees\\sa_1, on no branch\.$/);
  assert.match(how[2], /git merge-file/);
  assert.match(how[3], /nothing at all is written/);
  assert.match(how[4], /Your git index and HEAD are never touched/);
});

// (fails before: yes — finding 3 of the review of 11-11: the Changes box had no words for what stayed in a copy on
// another machine, and said "changed nothing" of one whose only file stayed there)
test("what stayed in its copy on another machine, in the Changes box: by why, count and name, and never 'changed nothing' over it", () => {
  const w = /** @type {any} */ (words);
  const left = [
    { path: ".env.local", why: "a secret's file by its name" },
    { path: "data/a.bin", why: "larger than 100 MB" },
    { path: "data/b.bin", why: "larger than 100 MB" },
    { path: "data/c.bin", why: "larger than 100 MB" },
    { path: "data/d.bin", why: "larger than 100 MB" },
  ];
  assert.equal(w.leftWords(left), "a secret's file by its name: 1 (.env.local); larger than 100 MB: 4 (data/a.bin, data/b.bin, data/c.bin and 1 more)");
  assert.equal(w.leftWords([]), "");
  assert.equal(w.leftNote(left.slice(0, 1), "Workstation"), "Stayed in its copy on Workstation, not brought here — a secret's file by its name: 1 (.env.local).");
  assert.equal(w.leftNote([], "Workstation"), "");
  assert.equal(w.nothingWords({ there: true, machine: "Workstation", left: left.slice(0, 1) }), "It worked in its own copy on Workstation, and nothing it changed came back here.");
  assert.equal(w.nothingWords({ there: true, machine: "Workstation", left: [] }), "It worked in its own copy on Workstation and changed nothing.");
  assert.equal(w.nothingWords({}), "It worked in its own git worktree and changed nothing.");
});
