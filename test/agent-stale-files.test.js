// The loop is told when a file it read changed, as Claude Code tells it (the owner's word of 10-27: "It doesn't notice
// when you change a file. Also make it work like claude"): before a request, each file the agent read whose bytes moved
// since is named once with what changed, its lines numbered as they are now; the agent may then write it without
// reading it again; a file gone is said gone; one only touched says nothing.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs, { mkdirSync, mkdtempSync, rmSync, writeFileSync, unlinkSync, utimesSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHand, changedSightings, forgetSighting, sightFile } from "../src/adapters/tools/hands.js";
import { staleNames, staleNote } from "../src/app/agent/stale.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";

const dir = mkdtempSync(join(tmpdir(), "stale-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const later = (/** @type {string} */ p) => utimesSync(p, new Date(), new Date(Date.now() + 5_000));

// (fails before: yes — nothing compared the files an agent read with what they hold now; only its write was refused)
test("a file read and changed since is named once, with the lines that changed; then the agent may write it", async () => {
  const seen = new Map();
  const p = join(dir, "a.js");
  const words = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  writeFileSync(p, words.join("\n"));
  await runHand("read", { path: "a.js" }, { root: dir, seen });
  assert.deepEqual(await changedSightings(seen), [], "nothing moved yet");
  writeFileSync(p, [...words.slice(0, 5), "SIX", ...words.slice(6), "eleven"].join("\n"));
  later(p);
  const changes = await changedSightings(seen);
  assert.equal(changes.length, 1);
  const note = staleNote(changes, { root: dir });
  assert.match(note, /^Note: a file you read changed since/);
  assert.match(note, /- a\.js:/);
  assert.match(note, /-\s+\tsix/, note);
  assert.match(note, /\+\s+6\tSIX/, note);
  assert.match(note, /\+\s+11\televen/, note);
  assert.ok(!note.includes("\tone"), "lines far from a change are left out");
  assert.deepEqual(await changedSightings(seen), [], "named once");
  // Told it, the agent holds it as it is: the write guard lets the write through.
  assert.match(String(await runHand("write", { path: "a.js", content: "new" }, { root: dir, seen })), /Successfully wrote/);
});

test("a file only touched says nothing; one deleted is said gone; the session's redaction holds", async () => {
  const seen = new Map();
  const t = join(dir, "t.txt");
  writeFileSync(t, "same");
  const g = join(dir, "g.txt");
  writeFileSync(g, "here");
  const s = join(dir, "s.env");
  writeFileSync(s, "KEY=old");
  for (const path of ["t.txt", "g.txt", "s.env"]) await runHand("read", { path }, { root: dir, seen });
  later(t);
  unlinkSync(g);
  writeFileSync(s, "KEY=sk-secret-123");
  later(s);
  const changes = await changedSightings(seen);
  assert.deepEqual(changes.map((c) => [c.abs.endsWith("g.txt") ? "g" : c.abs.endsWith("s.env") ? "s" : "?", !!c.gone]).sort(), [["g", true], ["s", false]]);
  const note = staleNote(changes, { root: dir, redact: (x) => x.replace(/sk-[\w-]+/g, "[redacted]") });
  assert.match(note, /- g\.txt was deleted\./);
  assert.ok(!note.includes("sk-secret"), note);
  assert.match(note, /\[redacted\]/);
});

const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
const reply = (content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } };
const texts = (m) => (Array.isArray(m.content) ? m.content : [{ type: "text", text: String(m.content) }]).filter((b) => b.type === "text").map((b) => b.text);

test("the loop tells it with the turn's first request and at a round boundary, each once", async () => {
  const bodies = [];
  const said = ["Note: a file you read changed since — first", "Note: a file you read changed since — second"];
  let asked = 0;
  await runAgentTurn(/** @type {any} */ ({
    model: "m", messages: [{ role: "user", content: "go" }], system: "s", tools: toolSetFor({ delegateRead: false }), modeNow: () => "edit",
    root: dir, readerModel: "", maxTokens: 100, costOf: () => 0, delegateRead: null, mailbox: { read: () => [] }, permissions: null, tree: null,
    onEvent: () => {}, previewChars: 0, sink, signal: null, resume: null,
    runHand: async () => "ok",
    fileNews: () => said[asked++] ?? "",
    call: async ({ body }) => {
      bodies.push(structuredClone(body));
      return bodies.length === 1 ? reply([toolUse("r", "read", { path: "x" })]) : reply([{ type: "text", text: "Done." }]);
    },
  }));
  assert.ok(texts(bodies[0].messages.at(-1)).some((t) => t.endsWith("first")), JSON.stringify(bodies[0].messages.at(-1)));
  const second = bodies[1].messages.at(-1);
  assert.ok(texts(second).some((t) => t.endsWith("second")), JSON.stringify(second));
  assert.equal(JSON.stringify(bodies[1]).split("— first").length - 1, 1, "the first note is not told again");
});

// The Hunter's finds of 10-27 (sa_c313c595), each verified against the code before it was fixed.
// (fails before: yes — a file gone between the look at it and the read of it threw out of the note, and failed the turn)
test("a file gone, locked or refused between the look and the read fails no turn: gone is said gone, the rest looked at again", async () => {
  const seen = new Map();
  const p = join(dir, "racy.txt");
  writeFileSync(p, "first");
  await runHand("read", { path: "racy.txt" }, { root: dir, seen });
  writeFileSync(p, "second");
  later(p);
  // The look reads a moved file without blocking (fs/promises), so its read is what fails.
  const real = fs.promises.readFile;
  /** @param {string} code */
  const failing = (code) => {
    fs.promises.readFile = /** @type {any} */ (async (/** @type {any} */ f, /** @type {any[]} */ ...a) => {
      if (String(f) === p) throw Object.assign(new Error(`${code}: ${f}`), { code });
      return real(f, ...a);
    });
    syncBuiltinESMExports();
  };
  try {
    failing("EBUSY");
    assert.deepEqual(await changedSightings(seen), [], "locked this time: nothing said yet");
    failing("ENOENT");
    const gone = await changedSightings(seen);
    assert.deepEqual(gone.map((c) => [c.abs, c.gone]), [[p, true]], "gone between the look and the read: said gone");
  } finally {
    fs.promises.readFile = real;
    syncBuiltinESMExports();
  }
  // A lock that lifts: the change is named the next time.
  writeFileSync(p, "third");
  await runHand("read", { path: "racy.txt" }, { root: dir, seen });
  writeFileSync(p, "fourth");
  later(p);
  try {
    failing("EBUSY");
    assert.deepEqual(await changedSightings(seen), []);
  } finally {
    fs.promises.readFile = real;
    syncBuiltinESMExports();
  }
  assert.match(staleNote(await changedSightings(seen), { root: dir }), /- racy\.txt:\n[\s\S]*\+\s+1\tfourth/);
});

// (fails before: yes — the files past the note's room were counted, not named, and their sightings had moved: a write
// went through unread)
test("every changed file is named; one the note had no room to show must be read again before it is written", async () => {
  const seen = new Map();
  const names = ["w1.txt", "w2.txt", "w3.txt", "w4.txt"];
  const lines = (/** @type {string} */ tag) => Array.from({ length: 60 }, (_, i) => `${tag} line ${i} ${"x".repeat(60)}`).join("\n");
  for (const n of names) {
    writeFileSync(join(dir, n), lines("old"));
    await runHand("read", { path: n }, { root: dir, seen });
  }
  for (const n of names) {
    writeFileSync(join(dir, n), lines("new"));
    later(join(dir, n));
  }
  /** @type {string[]} */
  const left = [];
  const note = staleNote(await changedSightings(seen), { root: dir, left: (abs) => (left.push(abs), forgetSighting(seen, abs)) });
  assert.ok(left.length >= 1, "four whole diffs do not fit");
  for (const n of names) assert.ok(note.includes(n), `${n} is named: ${note.slice(-400)}`);
  assert.match(note, /…and \d+ more files? changed, too much to show here: [\s\S]* — read (it|them) again before you rely on (it|them) or write (it|them)\.$/);
  const unshown = left.map((abs) => abs.slice(dir.length + 1));
  await assert.rejects(runHand("write", { path: unshown[0], content: "mine" }, { root: dir, seen }), /read it first/);
  const shown = names.find((n) => !unshown.includes(n));
  assert.match(String(await runHand("write", { path: /** @type {string} */ (shown), content: "mine" }, { root: dir, seen })), /Successfully wrote/);
});

// (fails before: yes — a folder made in the file's place was said deleted)
test("a folder standing where the file was is said so, not called deleted", async () => {
  const seen = new Map();
  const p = join(dir, "becomes");
  writeFileSync(p, "a file");
  await runHand("read", { path: "becomes" }, { root: dir, seen });
  unlinkSync(p);
  mkdirSync(p);
  const changes = await changedSightings(seen);
  assert.deepEqual(changes.map((c) => [!!c.gone, !!c.notFile]), [[false, true]]);
  assert.match(staleNote(changes, { root: dir }), /- becomes is no longer a file: a folder or something else stands in its place\./);
});

// (fails before: yes — a line left out for the room did not mark its gap: the lines on either side read as neighbours)
test("a changed line too long to show leaves a gap mark where it stood", () => {
  const was = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`);
  const now = [...was];
  now[5] = "y".repeat(4_100);
  const note = staleNote([{ abs: join(dir, "long.txt"), was: was.join("\n"), now: now.join("\n") }], { root: dir });
  const body = note.split("\n");
  const removed = body.findIndex((l) => /^-\s+\tline 6$/.test(l));
  assert.ok(removed > 0, note);
  assert.equal(body[removed + 1], "     …", note);
  assert.match(body[removed + 2], /^ \s+7\tline 7$/);
  assert.match(note, /…and 1 more changed line: read the file to see them\./);
});

// (fails before: yes — only the newest 200 sightings were looked at: a file read before them was never named)
test("a file read long before the newest two hundred is still compared, in turn", async () => {
  const seen = new Map();
  const old = join(dir, "oldest.txt");
  writeFileSync(old, "at first");
  await runHand("read", { path: "oldest.txt" }, { root: dir, seen });
  mkdirSync(join(dir, "many"), { recursive: true });
  for (let i = 0; i < 260; i++) {
    writeFileSync(join(dir, "many", `${i}.txt`), String(i));
    await runHand("read", { path: `many/${i}.txt` }, { root: dir, seen });
  }
  writeFileSync(old, "changed after all");
  later(old);
  /** @type {string[]} */
  const named = [];
  for (let k = 0; k < 2 && !named.length; k++) named.push(...(await changedSightings(seen)).map((c) => c.abs));
  assert.deepEqual(named, [old]);
});

// (fails before: yes — the nudge map of 11-10, c-news: a coding agent's own reads left no sighting, and the names-only
// note it hears did not exist)
test("a coding agent's read, seen by Filament itself: what changed is named with its lines counted; one deleted, said gone", async () => {
  const seen = new Map();
  const p = join(dir, "coder.md");
  const q = join(dir, "gone.md");
  writeFileSync(p, "alpha\nbeta\ngamma\n");
  writeFileSync(q, "x\n");
  await sightFile(seen, p);
  await sightFile(seen, q);
  assert.deepEqual(await changedSightings(seen), [], "nothing moved yet");
  writeFileSync(p, "alpha\nBETA\ngamma\ndelta\n");
  later(p);
  unlinkSync(q);
  const note = staleNames(await changedSightings(seen), { root: dir });
  assert.match(note, /^Note: 2 files you read changed since — the developer, a formatter or a command made the change\./);
  assert.ok(note.includes("Read them again before you rely on what you read of them:\n"), note);
  assert.ok(note.includes("\n- coder.md: 2 lines added, 1 line removed.") && note.includes("\n- gone.md was deleted."), note);
  assert.ok(!note.includes("BETA"), "named, not shown");
  assert.equal(staleNames([]), "");
});

/**
 * `fs.promises[name]` as `wrap` makes it, for hands.js too, until the returned undo. @param {"stat" | "readFile"} name
 * @param {(real: (...a: any[]) => Promise<any>) => (...a: any[]) => Promise<any>} wrap
 */
const swapFs = (name, wrap) => {
  const fsAny = /** @type {any} */ (fs);
  const real = fsAny.promises[name];
  fsAny.promises[name] = wrap(real);
  syncBuiltinESMExports();
  return () => {
    fsAny.promises[name] = real;
    syncBuiltinESMExports();
  };
};

// (fails before: yes — the review of 11-11: a coding agent's own edit was seen without waiting, and a look that came
// before that sighting ended took the agent's edit for someone else's)
test("a sighting still being taken is waited for: the coding agent's own edit just before a look is no change", async () => {
  const seen = new Map();
  const p = join(dir, "own-edit.md");
  writeFileSync(p, "one\n");
  await sightFile(seen, p);
  // Its edit, and Filament's look at the file held up, as a slow disk holds it, while the next turn's look comes.
  writeFileSync(p, "one\ntwo\n");
  later(p);
  /** @type {() => void} */
  let release = () => {};
  const held = new Promise((r) => (release = () => r(undefined)));
  const undo = swapFs("stat", (real) => async (...a) => (await held, real(...a)));
  /** @type {Promise<void>} */
  let taking;
  try {
    taking = sightFile(seen, p);
  } finally {
    undo();
  }
  const looked = changedSightings(seen);
  setTimeout(release, 50);
  assert.deepEqual(await looked, []);
  await taking;
});

// (fails before: yes — the review of 11-11: the sighting kept the file's time from a look after its bytes were read,
// so a write landing between the two was taken as seen)
test("a write landing while Filament reads a file a coding agent read is told at the next look", async () => {
  const seen = new Map();
  const p = join(dir, "racing.md");
  writeFileSync(p, "first\n");
  const undo = swapFs("readFile", (real) => async (...a) => {
    const bytes = await real(...a);
    writeFileSync(p, "first\nsecond\n");
    later(p);
    return bytes;
  });
  try {
    await sightFile(seen, p);
  } finally {
    undo();
  }
  const note = staleNames(await changedSightings(seen), { root: dir });
  assert.ok(note.includes("\n- racing.md: 1 line added."), note);
});

// (fails before: yes — the same, in the look that tells a change: a write landing as the changed file was read was
// taken as told)
test("a write landing while a changed file is read for its note is told at the look after", async () => {
  const seen = new Map();
  const p = join(dir, "racing-told.md");
  writeFileSync(p, "first\n");
  await sightFile(seen, p);
  writeFileSync(p, "first\nsecond\n");
  later(p);
  const undo = swapFs("readFile", (real) => async (...a) => {
    const bytes = await real(...a);
    writeFileSync(p, "first\nsecond\nthird\n");
    utimesSync(p, new Date(), new Date(Date.now() + 10_000));
    return bytes;
  });
  /** @type {Awaited<ReturnType<typeof changedSightings>>} */
  let first;
  try {
    first = await changedSightings(seen);
  } finally {
    undo();
  }
  assert.deepEqual(first.map((c) => c.now), ["first\nsecond\n"]);
  assert.deepEqual((await changedSightings(seen)).map((c) => [c.was, c.now]), [["first\nsecond\n", "first\nsecond\nthird\n"]]);
});

// (fails before: yes — the review of 11-11: a sighting was kept by the path as its call spelled it, so a file a coding
// agent read by one spelling and edited by another had two, and its own edit left the read's behind: told to it as a
// change someone else made)
test("one file by two spellings is one sighting: a coding agent's own edit, spelled another way than its read, is no change", async () => {
  const seen = new Map();
  const p = join(dir, "spelled.md");
  const slashed = dir.replace(/\\/g, "/");
  writeFileSync(p, "one\n");
  // Its read names the file with forward slashes and by way of `./`; its edit, as the folder is named.
  await sightFile(seen, `${slashed}/./spelled.md`);
  writeFileSync(p, "one\ntwo\n");
  later(p);
  await sightFile(seen, p);
  assert.equal(seen.size, 1, [...seen.keys()].join("\n"));
  assert.deepEqual(await changedSightings(seen), [], "its own edit");
  // A change someone else makes is told once, whichever spelling saw the file last.
  writeFileSync(p, "one\ntwo\nthree\n");
  utimesSync(p, new Date(), new Date(Date.now() + 10_000));
  assert.deepEqual((await changedSightings(seen)).map((c) => c.now), ["one\ntwo\nthree\n"]);
  forgetSighting(seen, `${slashed}/sub/../spelled.md`);
  assert.equal(seen.size, 0, "and forgotten by any spelling");
});

// (fails before: yes — the review of 11-11: the agent a chat moved to was told "a file you read changed", of a file the
// agent before it read)
test("a file read before the chat moved to another agent: the note says so, never that the agent it moved to read it", () => {
  const changes = [{ abs: join(dir, "moved.md"), was: "one\n", now: "one\ntwo\n" }];
  const note = staleNames(changes, { root: dir, moved: true });
  assert.equal(note, "Note: a file read or written in this chat before it moved to you changed since — the developer, a formatter or a command made the change. It was made on purpose: take it into account, and don't undo it unless asked. Read it before you rely on what this chat says of it:\n- moved.md: 1 line added.");
  assert.match(staleNames([...changes, { abs: join(dir, "gone.md"), was: "x\n", now: null, gone: true }], { root: dir, moved: true }), /^Note: 2 files read or written in this chat before it moved to you changed since — .* Read them before you rely on what this chat says of them:\n- moved\.md: 1 line added\.\n- gone\.md was deleted\.$/);
});
