// @ts-check
// HarnessV3-Tools TL3 (TL-D7): write overwrites an existing file only as the calling agent last saw it — never one it has
// not read, written or edited in this session, nor one that changed since. The one tool path that could destroy the
// developer's work without a trace. edit is not guarded: its exact oldText is the proof of what it changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, utimesSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHand as runHandRaw, HAND_TOOLS, SIGHTINGS_LIMIT, SIGHTING_AGENTS_LIMIT, createSightingsKeeper } from "../src/adapters/tools/hands.js";
import { removeDirs } from "./helpers/wait.js";

/** hands.js is untyped JS: its options are real, the inferred signature just does not know them. @type {(name: string, input: any, o: any) => Promise<string>} */
const runHand = /** @type {any} */ (runHandRaw);
const root = mkdtempSync(join(tmpdir(), "filament-write-guard-"));
test.after(() => removeDirs(root));
/** @param {string} name @param {string | Buffer} text */
const put = (name, text) => (writeFileSync(join(root, name), text), name);
const content = (/** @type {string} */ name) => readFileSync(join(root, name), "utf8");
/** One agent's hands: what it reads, writes and edits is seen through the same map. */
const agent = (/** @type {Map<string, any>} */ seen = new Map()) => ({
  seen,
  read: (/** @type {string} */ path) => runHand("read", { path }, { root, seen }),
  write: (/** @type {string} */ path, /** @type {string} */ text) => runHand("write", { path, content: text }, { root, seen }),
  edit: (/** @type {string} */ path, /** @type {string} */ oldText, /** @type {string} */ newText) =>
    runHand("edit", { path, edits: [{ oldText, newText }] }, { root, seen }),
});

// (fails before: write overwrote whatever was there)
test("an existing file the agent has not read is not overwritten; after a read it is, and again after its own write", async () => {
  const a = agent();
  put("notes.md", "the developer's notes\n");
  await assert.rejects(() => a.write("notes.md", "mine"), /notes\.md already exists and you have not read it in this session: read it first/);
  assert.equal(content("notes.md"), "the developer's notes\n", "nothing written");
  await a.read("notes.md");
  assert.match(await a.write("notes.md", "mine\n"), /Successfully wrote to notes\.md/);
  assert.equal(content("notes.md"), "mine\n");
  await a.write("notes.md", "mine again\n");
  assert.equal(content("notes.md"), "mine again\n", "its own write is a sighting of what it wrote");
});

test("a new file needs no read, and neither does the one it then becomes", async () => {
  const a = agent();
  await a.write("sub/new.txt", "one");
  await a.write("sub/new.txt", "two");
  assert.equal(content("sub/new.txt"), "two");
});

// (fails before: a file someone else wrote after the agent's read was overwritten all the same)
test("a file that changed since the agent saw it is not overwritten: in size alone, or in time alone", async () => {
  const a = agent();
  // A whole millisecond survives the file system's round trip: the time stays exactly as it was, only the size moves.
  const fixed = new Date("2026-01-01T00:00:00.000Z");
  utimesSync(join(root, put("grown.txt", "v1")), fixed, fixed);
  await a.read("grown.txt");
  utimesSync(join(root, put("grown.txt", "v1 and the developer's line")), fixed, fixed);
  assert.equal(statSync(join(root, "grown.txt")).mtimeMs, fixed.getTime());
  await assert.rejects(() => a.write("grown.txt", "mine"), /grown\.txt changed since you last read it .*read it again/);
  assert.equal(content("grown.txt"), "v1 and the developer's line");
  await a.read("grown.txt");
  await a.write("grown.txt", "mine");
  assert.equal(content("grown.txt"), "mine", "read again, it is written");

  put("same.txt", "abcd");
  await a.read("same.txt");
  put("same.txt", "wxyz");
  const later = new Date(statSync(join(root, "same.txt")).mtimeMs + 5000);
  utimesSync(join(root, "same.txt"), later, later);
  await assert.rejects(() => a.write("same.txt", "mine"), /changed since you last read it/, "same size, a later time");
  assert.equal(content("same.txt"), "wxyz");
});

test("an edit is not guarded, and counts as seeing the file", async () => {
  const a = agent();
  put("e.js", "const x = 1;\n");
  await a.edit("e.js", "1", "2");
  assert.equal(content("e.js"), "const x = 2;\n", "edit's exact oldText is the proof of what it changes");
  await a.write("e.js", "const x = 3;\n");
  assert.equal(content("e.js"), "const x = 3;\n");
});

test("each agent's sightings are its own; a call without them guards nothing", async () => {
  const a = agent();
  const b = agent();
  put("shared.txt", "base");
  await a.read("shared.txt");
  await assert.rejects(() => b.write("shared.txt", "b's"), /have not read it/, "a's read is not b's");
  await a.write("shared.txt", "a's");
  assert.equal(content("shared.txt"), "a's");
  await runHand("write", { path: "shared.txt", content: "unguarded" }, { root });
  assert.equal(content("shared.txt"), "unguarded");
});

test("a read that shows nothing of the file is no sighting: a binary or too-big file", async () => {
  const a = agent();
  put("bin.dat", Buffer.from([0x50, 0x4b, 0x00, 0x01]));
  await assert.rejects(() => a.read("bin.dat"), /binary/);
  await assert.rejects(() => a.write("bin.dat", "text"), /have not read it/);
  put("big.log", "x".repeat(11 * 1024 * 1024));
  await assert.rejects(() => a.read("big.log"), /too big|MB/);
  await assert.rejects(() => a.write("big.log", "short"), /have not read it/);
});

test("on Windows a path is the same file in any case", { skip: process.platform !== "win32" && "Windows only" }, async () => {
  const a = agent();
  put("Case.txt", "c");
  await a.read("CASE.TXT");
  await a.write("case.txt", "written");
  assert.equal(content("Case.txt"), "written");
});

test("an agent's sightings are bounded: past the limit the least recently seen goes, and asks for a read again", async () => {
  const a = agent();
  put("old.txt", "o");
  put("fresh.txt", "f");
  put("new.txt", "n");
  await a.read("old.txt");
  await a.read("fresh.txt");
  for (let i = 0; i < SIGHTINGS_LIMIT - 2; i++) a.seen.set(`elsewhere-${i}`, { size: 0, mtimeMs: 0 });
  await a.read("old.txt"); // seen again: the most recent now
  await a.read("new.txt"); // one past the limit
  assert.equal(a.seen.size, SIGHTINGS_LIMIT);
  await a.write("old.txt", "O");
  await assert.rejects(() => a.write("fresh.txt", "F"), /have not read it/, "the least recently seen was dropped");
});

test("the turn layer's keeper: one map per agent across its turns, the least recently used agent dropped past the limit", () => {
  const of = createSightingsKeeper(2);
  const a = of("a");
  const b = of("b");
  assert.equal(of("a"), a, "the same agent, the same map");
  of("c");
  assert.equal(of("a"), a, "used last, kept");
  assert.notEqual(of("b"), b, "least recently used, dropped: it starts again empty");
  const all = createSightingsKeeper();
  const first = all("first");
  for (let i = 0; i < SIGHTING_AGENTS_LIMIT - 1; i++) all(`agent-${i}`);
  assert.equal(all("first"), first, `${SIGHTING_AGENTS_LIMIT} agents are kept`);
  for (let i = 0; i < SIGHTING_AGENTS_LIMIT; i++) all(`more-${i}`);
  assert.notEqual(all("first"), first);
});

test("the write tool says so", () => {
  assert.match(String(HAND_TOOLS.find((t) => t.name === "write")?.description), /read it first/);
});

// (fails before: yes — the E26 closing drive, 10-22: a builder's follow-up could not write the file it had written,
// "part2.txt changed since you last read it": its copy, checked out again for the follow-up, had rewritten it — CRLF,
// as git's settings on the machine say — and the guard read a new time and size as someone's change)
test("a file written again as it was — the same text, its line endings aside — has not changed: a later time or size alone does not stop the write", async () => {
  const a = agent();
  await a.write("restored.txt", "part 2\n");
  const later = new Date(statSync(join(root, "restored.txt")).mtimeMs + 5000);
  utimesSync(join(root, put("restored.txt", "part 2\r\n")), later, later);
  assert.match(await a.write("restored.txt", "part 2\nsecond line\n"), /Successfully wrote/, "the checkout's CRLF of its own text");
  assert.equal(content("restored.txt"), "part 2\nsecond line\n");
  await a.read("restored.txt");
  utimesSync(join(root, put("restored.txt", "part 2\nsecond line\n")), later, later);
  await a.write("restored.txt", "three\n");
  assert.equal(content("restored.txt"), "three\n", "a read's sighting compares the same way: written again unchanged, later");
  utimesSync(join(root, put("restored.txt", "three, and the developer's\r\n")), later, later);
  await assert.rejects(() => a.write("restored.txt", "mine"), /changed since you last read it/, "a change of its text still stops it");
  assert.equal(content("restored.txt"), "three, and the developer's\r\n");
});
