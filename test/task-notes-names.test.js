// @ts-check
// A task's index names nothing outside its folder (s-hands, the second read of 11-12, F2). What the task notes keep
// behind a task is listed in its `index.json`: a note by its number (`notes/<n>.md`), a file by its name
// (`files/<name>`), each read, written over and removed by that. Both were taken from the file as it stood, so a row
// whose number or name is a path reached outside the task's folder. Now a row is kept at the read only where its
// number is a whole number and its name is one the store makes (`fileName`), and one left out is said once in the log.
// Every folder here is a temp folder the test made.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTaskNotes, fileName } from "../src/services/task-notes.js";

/** @type {string} */
let root;
/** @type {string} */
let dir;
/** @type {string} */
let victim;
before(() => {
  root = mkdtempSync(join(tmpdir(), "filament-notes-names-"));
  dir = join(root, "task-notes");
  victim = join(root, "victim");
  mkdirSync(victim);
  writeFileSync(join(victim, "7.md"), "the note outside");
  writeFileSync(join(victim, "keep.txt"), "kept");
});
after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

const CHAT = "c1";
const GRAPH = 1000;
/** From a task's `notes/` or `files/` to the folder outside every chat's. */
const OUT = "../../../../../victim";
const victimStands = () => {
  assert.equal(readFileSync(join(victim, "7.md"), "utf8"), "the note outside", "the note outside is as it was");
  assert.equal(readFileSync(join(victim, "keep.txt"), "utf8"), "kept", "the file outside is as it was");
};
/** A store as Filament starts one, with a log that keeps its lines. */
const started = () => {
  /** @type {string[]} */
  const lines = [];
  return { lines, notes: createTaskNotes({ dir, now: () => 1, log: (level, msg) => void lines.push(`${level} ${msg}`) }) };
};

// (fails before: yes — fileName(" ..") was "..", a name that is the task's own folder)
test("a kept file's name is one plain name: spaces, capitals, dots and letters of other alphabets as keep has always made them; dots and spaces alone are none", () => {
  assert.equal(fileName("Écran — Capture d'été 2026.11.12 à 10.04.png"), "_cran _ Capture d__t_ 2026.11.12 _ 10.04.png");
  assert.equal(fileName(" .hidden Notes.TXT"), ".hidden Notes.TXT");
  for (const name of [" ..", " .", " . . ", "...", ""]) assert.equal(fileName(name), "file", JSON.stringify(name));
});

// (fails before: yes — the list showed the rows, `note` read the note outside, `file` answered its path, `forget`
// removed both files outside, and a keep under the row's title wrote over the note outside)
test("a row whose number or name is a path is not listed, and nothing outside is read, written over or removed by it; the real ones stand; said once", () => {
  const first = started().notes;
  assert.equal(first.keepNote(CHAT, GRAPH, "t1", { title: "Findings", text: "what the review found", by: "agent" }).ok, true);
  const shot = first.keepFile(CHAT, GRAPH, "t1", { name: "Écran — Capture d'été 2026.11.12 à 10.04.png", data: Buffer.from("png"), by: "agent" });
  const dotted = first.keepFile(CHAT, GRAPH, "t1", { name: " .hidden Notes.TXT", data: Buffer.from("txt"), by: "agent" });
  assert.ok(shot.ok && dotted.ok);
  // A row of each kind whose number or name is a path, beside them, as the file could hold them.
  const indexFile = join(dir, CHAT, String(GRAPH), "t1", "index.json");
  const ix = JSON.parse(readFileSync(indexFile, "utf8"));
  ix.notes.push({ title: "Outside", n: `${OUT}/7`, chars: 5, at: 1, by: "agent", first: "" }, { title: "Half", n: 2.5, chars: 1, at: 1, by: "agent", first: "" }, null);
  ix.files.push({ name: `${OUT}/keep.txt`, bytes: 4, at: 1, by: "agent" }, { name: "..", bytes: 1, at: 1, by: "agent" }, { name: "a\\b", bytes: 1, at: 1, by: "agent" }, { name: 5, bytes: 1, at: 1, by: "agent" });
  writeFileSync(indexFile, JSON.stringify(ix));

  // Filament starts again: the index is read from disk.
  const { notes, lines } = started();
  const listed = notes.list(CHAT, GRAPH, "t1");
  assert.deepEqual(listed.notes.map((n) => n.title), ["Findings"]);
  assert.deepEqual(listed.files.map((x) => x.name), ["_cran _ Capture d__t_ 2026.11.12 _ 10.04.png", ".hidden Notes.TXT"], "the files keep made are listed as they were");
  assert.deepEqual(notes.counts(CHAT, GRAPH).t1.titles, ["Findings", "_cran _ Capture d__t_ 2026.11.12 _ 10.04.png", ".hidden Notes.TXT"]);
  // Read, written over, removed: none of it reaches outside.
  assert.equal(notes.note(CHAT, GRAPH, "t1", "Outside"), null);
  assert.equal(notes.file(CHAT, GRAPH, "t1", `${OUT}/keep.txt`), null);
  assert.equal(notes.forget(CHAT, GRAPH, "t1", "Outside"), null);
  assert.equal(notes.forget(CHAT, GRAPH, "t1", `${OUT}/keep.txt`), null);
  victimStands();
  const kept = notes.keepNote(CHAT, GRAPH, "t1", { title: "Outside", text: "written here", by: "agent" });
  assert.deepEqual(kept, { ok: true, replaced: null }, "a note of that title is a new one, in the task's folder");
  victimStands();
  // The real ones read and go as before.
  assert.equal(notes.note(CHAT, GRAPH, "t1", "Findings")?.text, "what the review found");
  assert.equal(readFileSync(/** @type {any} */ (notes.file(CHAT, GRAPH, "t1", ".hidden Notes.TXT")).path, "utf8"), "txt");
  assert.equal(notes.forget(CHAT, GRAPH, "t1", "_cran _ Capture d__t_ 2026.11.12 _ 10.04.png"), "file");
  assert.equal(notes.forget(CHAT, GRAPH, "t1", "Findings"), "note");
  victimStands();
  // Said once each, however often the index is read, with no more than 64 characters of what it names.
  notes.list(CHAT, GRAPH, "t1");
  const said = lines.filter((l) => /index\.json/.test(l));
  assert.equal(said.length, 7, said.join(" | "));
  assert.match(said[0], /^warn task notes: c1\/1000\/t1\/index\.json lists a note whose number is none this store makes \(its title: "Outside"\)/);
  assert.ok(said.every((l) => !l.includes(`${"x".repeat(65)}`)));
  assert.ok(existsSync(join(victim, "keep.txt")));
});
