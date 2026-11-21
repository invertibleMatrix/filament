// Chats from other coding agents, as the harness's Import section asks for them (HarnessV4_Import_Plan, step 1): the
// line reader a big file is read with, where each of an agent's chats stands in Filament, what a Sync brings, Stop,
// the person's choices, and the routes. Everything is made up, in a temp folder.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive } from "../src/archive.js";
import {
  REACH_DAYS,
  chatStates,
  claudeCodeSource,
  forgetRemoved,
  importClaudeCode,
  importOverview,
  importState,
  noteEmpty,
  isImportKey,
  noteRemoved,
  pendingOf,
  readLines,
  setImportPrefs,
  unreadByMemory,
} from "../src/memory-import.js";
import * as sink from "../src/services/memory/import/sink.js";
import { transcriptTurns } from "../src/ui/harness/conversation/history.js";
import { commandAnswer } from "../src/ui/harness/conversation/turn.js";
import { startApp } from "./helpers/app.js";
import { pageTurns } from "./helpers/held-transcript.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";
import { PAST_A_LINE, writeWithLongLine } from "./helpers/long-line.js";
import { until } from "./helpers/wait.js";

const dir = mkdtempSync(join(tmpdir(), "filament-import-src-"));
let seq = 0;
const opened = [];
const openArchive = () => {
  const a = new Archive({ file: join(dir, `a${++seq}.db`) });
  opened.push(a);
  return a;
};
after(() => {
  for (const a of opened) {
    try {
      a.close();
    } catch {}
  }
  rmSync(dir, { recursive: true, force: true });
});

// ---- made-up Claude Code chats ---------------------------------------------------------------------------------------
const T0 = Date.parse("2026-09-01T10:00:00Z");
const DAY = 86_400_000;
/** The agents the section lists, in its order. */
const AGENTS = ["claude-code", "codex", "cursor"];
const ts = (i) => new Date(T0 + i * 60_000).toISOString();
const CWD_A = "C:\\proj\\alpha",
  CWD_B = "C:\\proj\\beta";
const SLUG_A = "C--proj-alpha",
  SLUG_B = "C--proj-beta";
const sidOf = (n) => `${String(n).repeat(8)}-0000-4000-8000-00000000000${n}`;
const S1 = sidOf(1),
  S2 = sidOf(2),
  S3 = sidOf(3);
const line = (sid, cwd, i, type, message, extra = {}) => ({
  parentUuid: null,
  isSidechain: false,
  cwd,
  sessionId: sid,
  version: "2.1.0",
  gitBranch: "main",
  uuid: `u-${sid}-${i}`,
  timestamp: ts(i),
  type,
  message,
  ...extra,
});
const said = (sid, cwd, i, content) => line(sid, cwd, i, "user", { role: "user", content });
const answered = (sid, cwd, i, content) =>
  line(sid, cwd, i, "assistant", { id: `m-${sid}-${i}`, role: "assistant", model: "claude-sonnet-5-5", content });
const words = (text) => [{ type: "text", text }];
/** `turns` question-and-answer pairs, the first at minute `from`. */
const chat = (sid, cwd, turns, from = 0) =>
  Array.from({ length: turns }, (_, t) => [
    said(sid, cwd, from + t * 2, `question ${from / 2 + t + 1} of ${sid.slice(0, 4)}`),
    answered(sid, cwd, from + t * 2 + 1, words(`answer ${from / 2 + t + 1}`)),
  ]).flat();
const jsonl = (lines) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
/** A home folder with Claude Code's projects under it. */
function homeOf(name) {
  const home = join(dir, name);
  const root = join(home, ".claude", "projects");
  mkdirSync(root, { recursive: true });
  const file = (slug, sid) => join(root, slug, `${sid}.jsonl`);
  return {
    home,
    root,
    file,
    write(slug, sid, lines) {
      mkdirSync(join(root, slug), { recursive: true });
      writeFileSync(file(slug, sid), jsonl(lines));
    },
    append: (slug, sid, lines) => appendFileSync(file(slug, sid), jsonl(lines)),
    /** The file's last change, as the system tells it. */
    changedAt(slug, sid, ms) {
      utimesSync(file(slug, sid), new Date(ms), new Date(ms));
    },
  };
}
/** Three chats: two in alpha, one in beta. */
function threeChats(name) {
  const h = homeOf(name);
  h.write(SLUG_A, S1, chat(S1, CWD_A, 2));
  h.write(SLUG_A, S2, chat(S2, CWD_A, 1, 10));
  h.write(SLUG_B, S3, chat(S3, CWD_B, 3, 20));
  return h;
}
const states = async (source, o) => Object.fromEntries((await chatStates(source, o)).map((c) => [c.agentSession, c.state]));
const chainOf = (a, sid) => a.chainsWithKeyPrefix("cc:").find((c) => c.key === `cc:${sid}`) || null;
async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}

// ---- the line reader -------------------------------------------------------------------------------------------------
// (fails before: yes — a session file was read whole into one string, which a file of 1.4 GB cannot be; there was no
// reader that takes a line at a time)
test("readLines gives every line of a file read in small blocks, with the offset behind each", async () => {
  const f = join(dir, "lines.txt");
  const long = "x".repeat(50);
  writeFileSync(f, `a\nbb\n${long}\n\nlast with no newline`);
  const got = await collect(readLines(f, { block: 16 }));
  assert.deepEqual(
    got.map((g) => g.line),
    ["a", "bb", long, "", "last with no newline"],
    "a line longer than three blocks comes in one piece, an empty line is a line, and a last line without a newline is given",
  );
  assert.deepEqual(
    got.map((g) => g.pos),
    [2, 5, 56, 57, 77],
    "each line comes with the offset just behind it: the bytes read so far",
  );
  assert.equal(got.at(-1).pos, statSync(f).size);
});
// (fails before: yes — no reader; one that decoded block by block would break a character cut by a block's edge)
test("readLines keeps a character whole when a block's edge cuts it in two", async () => {
  const f = join(dir, "cut.txt");
  writeFileSync(f, "1234567é\nna\u00efve 日本語 tail\n");
  const got = await collect(readLines(f, { block: 8 }));
  assert.deepEqual(got.map((g) => g.line), ["1234567é", "na\u00efve 日本語 tail"]);
});
test("readLines gives nothing for an empty file, and one block is enough for a small one", async () => {
  const empty = join(dir, "empty.txt");
  writeFileSync(empty, "");
  assert.deepEqual(await collect(readLines(empty)), []);
  const small = join(dir, "small.txt");
  writeFileSync(small, "one\ntwo\n");
  assert.deepEqual(await collect(readLines(small)), [
    { line: "one", pos: 4 },
    { line: "two", pos: 8 },
  ]);
});

// (fails before: yes — MEMR-10: a line was held whole however long it was, so one past V8's string limit failed its
// chat's whole import)
test("readLines passes over a line past the most a line is read to, never holding it, and says which and how long; the lines after it come as ever", async () => {
  const f = join(dir, "long-lines.txt");
  writeFileSync(f, `a\n${"x".repeat(100)}\nb\n${"w".repeat(50)}\n${"z".repeat(70)}`);
  assert.deepEqual(await collect(readLines(f, /** @type {any} */ ({ block: 16, maxLine: 50 }))), [
    { line: "a", pos: 2 },
    { line: null, pos: 103, long: { line: 2, bytes: 100 } },
    { line: "b", pos: 105 },
    { line: "w".repeat(50), pos: 156 },
    { line: null, pos: 226, long: { line: 5, bytes: 70 } },
  ], "a line as long as the most is read; one past it, in the middle or last with no newline, is passed over and named");
});

// (fails before: yes — MEMR-10: a line of the chat past V8's string limit failed the whole chat; past 256 MiB a line is
// left out, named in the import's report, and the rest of the chat comes in)
test("a chat with a line past 256 MiB comes in without that line, and the import's report names it", async () => {
  assert.equal(/** @type {any} */ (sink).LINE_MAX_BYTES, 256 << 20, "the most a line is read to");
  const a = openArchive();
  const h = homeOf("huge");
  mkdirSync(join(h.root, SLUG_A), { recursive: true });
  const f = h.file(SLUG_A, S1);
  writeWithLongLine(f, jsonl(chat(S1, CWD_A, 1)), jsonl(chat(S1, CWD_A, 1, 10)));
  try {
    const r = await importClaudeCode({ archive: a, root: h.root });
    assert.deepEqual([r.errors, r.long], [[], [{ file: `${S1}.jsonl`, line: 3, bytes: PAST_A_LINE }]]);
    assert.equal(chainOf(a, S1).turns, 2, "the rest of the chat came in");
    assert.equal(chainOf(a, S1).meta.mark, statSync(f).size, "read to its end: no Sync takes it as grown");
  } finally {
    rmSync(f, { force: true });
  }
});

// ---- a big chat ------------------------------------------------------------------------------------------------------
// (fails before: yes — nothing read a chat by the megabyte block: this proves a line bigger than the block, a
// screenshot or a long command's output in a tool result, is not cut or lost on the way in)
test("a chat with a line longer than the read block comes in whole", async () => {
  const a = openArchive();
  const h = homeOf("big");
  const output = Array.from({ length: 30_000 }, (_, i) => `row ${i} of the listing`).join("\n");
  // Claude Code writes a command's output twice on the line: in the message, and beside it.
  const beside = { toolUseResult: { stdout: output.repeat(4), stderr: "" } };
  h.write(SLUG_A, S1, [
    said(S1, CWD_A, 0, "list everything"),
    answered(S1, CWD_A, 1, [{ type: "tool_use", id: "tu1", name: "Bash", input: { command: "ls -R" } }]),
    { ...said(S1, CWD_A, 2, [{ type: "tool_result", tool_use_id: "tu1", content: output }]), ...beside },
    answered(S1, CWD_A, 3, words("That is everything.")),
    ...chat(S1, CWD_A, 1, 4),
  ]);
  assert.ok(Buffer.byteLength(JSON.stringify(beside)) > 2 * (1 << 20), "the line is more than two blocks long");
  assert.ok(Buffer.byteLength(output) < a.caps.messageBytes, "the message itself is under what the archive keeps of one");
  const r = await importClaudeCode({ archive: a, root: h.root });
  assert.deepEqual(r.errors, []);
  assert.equal(r.newTurns, 2);
  const [first, second] = a.getTurns(chainOf(a, S1).id);
  const result = a.getMessage(first.work[1]).message.content[0];
  assert.equal(result.type, "tool_result");
  assert.equal(result.content, output, "the long result is the same text, to the last row");
  assert.equal(a.getMessage(first.final_hash).message.content[0].text, "That is everything.");
  assert.equal(a.getMessage(second.user_hash).message.content, "question 3 of 1111", "the turn after the long line is read too");
  assert.equal(chainOf(a, S1).meta.mark, statSync(h.file(SLUG_A, S1)).size, "the chain's mark is the file's size as it was read");
});
// (fails before: no — the archive's own rule for a message past its cap, the same for a turn Filament ran: a guard
// that an import neither loses the turn nor the turns after it)
test("a message past what the archive keeps of one is kept as its head with its true size, and the chat goes on", async () => {
  const a = openArchive();
  const h = homeOf("oversize");
  const output = "0123456789abcdef".repeat(100_000);
  h.write(SLUG_A, S1, [
    said(S1, CWD_A, 0, "print it all"),
    answered(S1, CWD_A, 1, [{ type: "tool_use", id: "tu1", name: "Bash", input: { command: "cat big" } }]),
    said(S1, CWD_A, 2, [{ type: "tool_result", tool_use_id: "tu1", content: output }]),
    answered(S1, CWD_A, 3, words("Printed.")),
    ...chat(S1, CWD_A, 1, 4),
  ]);
  const r = await importClaudeCode({ archive: a, root: h.root });
  assert.deepEqual(r.errors, []);
  const turns = a.getTurns(chainOf(a, S1).id);
  assert.equal(turns.length, 2);
  const kept = a.getMessage(turns[0].work[1]);
  assert.equal(kept.truncated, true);
  assert.equal(kept.kind, "tool_result");
  assert.ok(kept.bytes > output.length, "its true size is kept");
  assert.equal(a.getMessage(turns[0].final_hash).message.content[0].text, "Printed.");
});

// ---- where a chat stands -----------------------------------------------------------------------------------------------
// (fails before: yes — there was no list of an agent's chats and no state for one: an import took every file, and
// nothing told a new chat from one that had grown)
test("an agent's chats are listed without reading them, and each says where it stands: new, imported, grown, own, removed", async () => {
  const a = openArchive();
  const h = threeChats("states");
  const where = claudeCodeSource.where(h.home);
  assert.equal(where, h.root);
  assert.equal(claudeCodeSource.found(where), true);
  assert.equal(claudeCodeSource.found(join(dir, "nowhere")), false);

  const listed = await chatStates(claudeCodeSource, { archive: a, where });
  assert.equal(listed.length, 3);
  const one = listed.find((c) => c.agentSession === S1);
  assert.deepEqual(
    { id: one.id, key: one.key, cwd: one.cwd, preview: one.preview, startedAt: one.startedAt, bytes: one.bytes, mark: one.mark, state: one.state, chain: one.chain, turns: one.turns },
    {
      id: `${SLUG_A}/${S1}`,
      key: `cc:${S1}`,
      cwd: CWD_A,
      preview: "question 1 of 1111",
      startedAt: T0,
      bytes: statSync(h.file(SLUG_A, S1)).size,
      mark: statSync(h.file(SLUG_A, S1)).size,
      state: "new",
      chain: null,
      turns: null,
    },
  );
  assert.equal(one.lastAt, statSync(h.file(SLUG_A, S1)).mtimeMs, "a chat's last activity is its file's last change");

  // One chat chosen: only it comes in.
  const r = await importClaudeCode({ archive: a, root: h.root, only: new Set([`${SLUG_A}/${S1}`]) });
  assert.equal(r.files, 1);
  assert.equal(r.newChains, 1);
  assert.equal(a.chainsWithKeyPrefix("cc:").length, 1);
  assert.deepEqual(await states(claudeCodeSource, { archive: a, where }), { [S1]: "imported", [S2]: "new", [S3]: "new" });
  const imported = (await chatStates(claudeCodeSource, { archive: a, where })).find((c) => c.agentSession === S1);
  assert.equal(imported.chain, chainOf(a, S1).id);
  assert.equal(imported.turns, 2);

  // The agent goes on with the chat: its file grows, and so the chat has grown.
  h.append(SLUG_A, S1, chat(S1, CWD_A, 1, 4));
  assert.equal((await states(claudeCodeSource, { archive: a, where }))[S1], "grown");
  const again = await importClaudeCode({ archive: a, root: h.root, only: new Set([`${SLUG_A}/${S1}`]) });
  assert.equal(again.newChains, 0);
  assert.equal(again.newTurns, 1, "only the turn that was added is new");
  assert.equal(chainOf(a, S1).turns, 3);
  assert.equal((await states(claudeCodeSource, { archive: a, where }))[S1], "imported");

  // A chat Filament runs itself is a session already; one the person deleted after an import stays away.
  assert.deepEqual(await states(claudeCodeSource, { archive: a, where, ownIds: new Set([S2]), removed: [`cc:${S3}`] }), {
    [S1]: "imported",
    [S2]: "own",
    [S3]: "removed",
  });
  assert.equal((await states(claudeCodeSource, { archive: a, where, ownIds: new Set([S1]) }))[S1], "own", "own wins over imported");
});
// (fails before: yes — no preview: a list of chats had nothing to name one by)
test("a chat's preview is the first line the person typed, cut to a row's length, with secrets taken out", async () => {
  const a = openArchive();
  const h = homeOf("preview");
  h.write(SLUG_A, S1, [
    { type: "mode", mode: "default", sessionId: S1 },
    said(S1, CWD_A, 0, "<local-command-stdout>ok</local-command-stdout>"),
    said(S1, CWD_A, 1, [{ type: "tool_result", tool_use_id: "x", content: "not typed" }]),
    said(S1, CWD_A, 2, `\n\n  ${"long ".repeat(40)}\nsecond line`),
  ].map((l, i) => (i === 1 ? { ...l, isMeta: true } : l)));
  h.write(SLUG_A, S2, [said(S2, CWD_A, 0, "use the key sk-abcd1234567890abcdef please"), answered(S2, CWD_A, 1, words("ok"))]);
  h.write(SLUG_B, S3, [{ type: "mode", mode: "default", sessionId: S3 }]);
  const by = Object.fromEntries((await chatStates(claudeCodeSource, { archive: a, where: h.root })).map((c) => [c.agentSession, c]));
  assert.equal(by[S1].preview.length, 80);
  assert.ok(by[S1].preview.startsWith("long long") && by[S1].preview.endsWith("…"), "meta lines and tool results are passed over");
  assert.ok(!by[S2].preview.includes("1234567890abcdef"), "a key in the first message is not shown on the list");
  assert.ok(by[S2].preview.startsWith("use the key sk-abcd"));
  assert.equal(by[S3].preview, null, "a chat with no typed message has no preview");
  assert.equal(by[S3].cwd, null);
});

// ---- what a Sync brings ------------------------------------------------------------------------------------------------
// (fails before: yes — an import took everything, eleven gigabytes on the machine it was planned on; nothing chose
// by how lately a chat was active)
test("a Sync brings the new and the grown chats whose last activity is inside the reach", async () => {
  const a = openArchive();
  const h = threeChats("reach");
  const now = T0 + 100 * DAY;
  h.changedAt(SLUG_A, S1, now - 1 * DAY);
  h.changedAt(SLUG_A, S2, now - 10 * DAY);
  h.changedAt(SLUG_B, S3, now - 40 * DAY);
  const list = () => chatStates(claudeCodeSource, { archive: a, where: h.root });
  const ids = async (reachDays, chats = list()) => pendingOf(await chats, { reachDays, now }).map((c) => c.agentSession).sort();
  assert.deepEqual(await ids(7), [S1]);
  assert.deepEqual(await ids(30), [S1, S2]);
  assert.deepEqual(await ids(90), [S1, S2, S3]);
  assert.deepEqual(await ids(0), [S1, S2, S3], "0 reaches everything");
  // A chat last active exactly at the reach's edge is inside it.
  h.changedAt(SLUG_B, S3, now - 30 * DAY);
  assert.deepEqual(await ids(30), [S1, S2, S3]);
  // What is imported, Filament's own, or removed is not brought.
  await importClaudeCode({ archive: a, root: h.root, only: new Set([`${SLUG_A}/${S1}`]) });
  h.changedAt(SLUG_A, S1, now - 1 * DAY);
  assert.deepEqual(await ids(0), [S2, S3]);
  assert.deepEqual(await ids(0, chatStates(claudeCodeSource, { archive: a, where: h.root, ownIds: new Set([S2]), removed: [`cc:${S3}`] })), []);
});

// ---- Stop ------------------------------------------------------------------------------------------------------------
/** A stop that comes at the `n`th look: an import looks before each file and after each line. */
const stopAtLook = (n) => {
  let looks = 0;
  return {
    get aborted() {
      return ++looks >= n;
    },
  };
};
// (fails before: yes — an import could not be stopped: it ran to its end whatever the person did)
test("an import that is stopped keeps the turns it wrote, says so, and the next run goes on where it stopped", async () => {
  const a = openArchive();
  const h = homeOf("stop");
  h.write(SLUG_A, S1, chat(S1, CWD_A, 6));
  const where = h.root;
  await assert.rejects(
    importClaudeCode({ archive: a, root: where, signal: /** @type {any} */ (stopAtLook(8)) }),
    (e) => e.aborted === true && /stopped/.test(e.message),
    "a stop is said as a stop, not kept as one file's error",
  );
  const half = chainOf(a, S1);
  assert.ok(half, "the chat's chain is there");
  assert.ok(half.turns > 0 && half.turns < 6, `some turns are in (${half.turns}), not all`);
  assert.equal(half.meta.mark, undefined, "a chat cut short has no mark");
  assert.equal((await states(claudeCodeSource, { archive: a, where }))[S1], "grown", "so it stands as grown: the next run takes it");

  const rest = await importClaudeCode({ archive: a, root: where });
  assert.deepEqual(rest.errors, []);
  assert.equal(rest.newChains, 0);
  assert.equal(rest.newTurns, 6 - half.turns, "the turns already in are not made twice");
  assert.equal(chainOf(a, S1).turns, 6);
  assert.equal(a.getTurns(chainOf(a, S1).id).length, 6);
  assert.equal((await states(claudeCodeSource, { archive: a, where }))[S1], "imported");
});
// (fails before: yes — the archive keeps a message sent again before any answer as the same turn, and the import
// counted two: a second read of the file took every turn after it for a new one and wrote the rest of the chat
// again, a summary after it stood for one turn too many, and the failure of the first try stayed on the turn)
test("a message sent again before any answer is one turn, as Filament keeps one: a second read writes nothing twice, and a summary after it stands for the right turns", async () => {
  const a = openArchive();
  const h = homeOf("resent");
  const failed = (i) => line(S1, CWD_A, i, "assistant", { id: `e-${i}`, role: "assistant", model: "<synthetic>", content: words("API Error: 529 Overloaded") }, { isApiErrorMessage: true });
  const summary = (i) => line(S1, CWD_A, i, "user", { role: "user", content: "This session is being continued from a previous conversation. Summary: the thing was done." }, { isCompactSummary: true, isVisibleInTranscriptOnly: true });
  h.write(SLUG_A, S1, [
    said(S1, CWD_A, 0, "do the thing"), failed(1),
    said(S1, CWD_A, 2, "do the thing"), answered(S1, CWD_A, 3, words("done")),
    ...chat(S1, CWD_A, 1, 4),
    summary(6),
    ...chat(S1, CWD_A, 1, 8),
  ]);
  const dry = await importClaudeCode({ archive: a, root: h.root, dryRun: true });
  assert.equal(dry.newTurns, 3, "a dry run counts the turns a real one writes");
  const one = await importClaudeCode({ archive: a, root: h.root });
  assert.deepEqual([one.errors, one.newTurns, one.turns], [[], 3, 3]);
  const id = chainOf(a, S1).id;
  const told = () => a.getTurns(id).map((t) => [t.n, a.getMessage(t.user_hash).message.content, t.final_hash ? a.getMessage(t.final_hash).message.content[0].text : null, t.meta.failed ?? null]);
  const three = [[1, "do the thing", "done", null], [2, "question 3 of 1111", "answer 3", null], [3, "question 5 of 1111", "answer 5", null]];
  assert.deepEqual(told(), three, "the second try is the turn going on: its answer is the turn's, and the turn did not fail");
  assert.deepEqual(a.getCompactions(id).map((c) => [c.from_turn, c.to_turn]), [[1, 2]], "the summary stands for the two turns before it");
  // the same file read again, whole (a chat picked a second time; one stopped midway)
  const two = await importClaudeCode({ archive: a, root: h.root });
  assert.deepEqual([two.errors, two.newTurns, two.messages], [[], 0, 0]);
  assert.deepEqual(told(), three);
  // and grown by a turn
  h.append(SLUG_A, S1, chat(S1, CWD_A, 1, 10));
  const grown = await importClaudeCode({ archive: a, root: h.root });
  assert.equal(grown.newTurns, 1);
  assert.deepEqual(told(), [...three, [4, "question 6 of 1111", "answer 6", null]]);
  assert.equal(a.getCompactions(id).length, 1);
});
// (fails before: yes — a turn read before its answer was written opened with no model, and kept none when the
// answer came: the session's turn named nobody)
test("a turn read before its answer was written takes the model that answered it at the next read", async () => {
  const a = openArchive();
  const h = homeOf("late-model");
  h.write(SLUG_A, S1, [...chat(S1, CWD_A, 1), said(S1, CWD_A, 4, "and this?")]);
  await importClaudeCode({ archive: a, root: h.root });
  const id = chainOf(a, S1).id;
  assert.deepEqual(a.getTurns(id).map((t) => [t.model, !!t.final_hash]), [["claude-sonnet-5-5", true], [null, false]]);
  h.append(SLUG_A, S1, [answered(S1, CWD_A, 5, words("that too"))]);
  const grown = await importClaudeCode({ archive: a, root: h.root });
  assert.equal(grown.newTurns, 0);
  assert.deepEqual(a.getTurns(id).map((t) => [t.model, !!t.final_hash]), [["claude-sonnet-5-5", true], ["claude-sonnet-5-5", true]]);
});
// (fails before: yes — no stop)
test("a stop asked before an import starts writes nothing", async () => {
  const a = openArchive();
  const h = threeChats("stop0");
  await assert.rejects(importClaudeCode({ archive: a, root: h.root, signal: AbortSignal.abort() }), (e) => e.aborted === true);
  assert.equal(a.chainsWithKeyPrefix("cc:").length, 0);
});

// ---- the server answers while an import runs --------------------------------------------------------------------------
// (fails before: yes — a file's turns were written in one go on the server's thread: no other request, and no timer,
// ran until the file ended)
test("a long import lets other work run in between: a timer ticks while it writes", async () => {
  const a = openArchive();
  const h = homeOf("yield");
  h.write(SLUG_A, S1, chat(S1, CWD_A, 2000));
  let ticks = 0;
  const timer = setInterval(() => ticks++, 1);
  try {
    const r = await importClaudeCode({ archive: a, root: h.root });
    assert.equal(r.newTurns, 2000);
  } finally {
    clearInterval(timer);
  }
  assert.ok(ticks >= 2, `the timer ran ${ticks} time(s) during the import`);
});

// ---- the person's choices --------------------------------------------------------------------------------------------
// (fails before: yes — nothing kept a choice about imports)
test("the person's choices are kept in the archive, start at their defaults, and a value that is none is refused in words", () => {
  const a = openArchive();
  assert.deepEqual(importState(a), { reachDays: REACH_DAYS, on: [], learn: false, removed: [], empty: {}, last: null, read: null });
  assert.equal(REACH_DAYS, 30);
  setImportPrefs(a, { reachDays: 7 });
  setImportPrefs(a, { on: ["claude-code", "claude-code"], learn: true });
  assert.deepEqual(importState(a), { reachDays: 7, on: ["claude-code"], learn: true, removed: [], empty: {}, last: null, read: null });
  setImportPrefs(a, { reachDays: 0, on: [] });
  assert.equal(importState(a).reachDays, 0, "0 is everything, and it is kept as 0");
  assert.deepEqual(importState(a).on, []);
  assert.equal(importState(a).learn, true, "a choice not named stays as it was");
  const refused = (patch, words) =>
    assert.throws(
      () => setImportPrefs(a, patch),
      (e) => e.refused === true && words.test(e.message),
      JSON.stringify(patch),
    );
  refused({ reachDays: -1 }, /whole number of days/);
  refused({ reachDays: 1.5 }, /whole number of days/);
  refused({ reachDays: "soon" }, /whole number of days/);
  refused({ reachDays: 4000 }, /3650/);
  refused({ on: "claude-code" }, /a list of agents/);
  refused({ on: ["nobody"] }, /no such agent: nobody/);
  refused({ learn: "yes" }, /true or false/);
  assert.deepEqual(importState(a), { reachDays: 0, on: [], learn: true, removed: [], empty: {}, last: null, read: null }, "a refused change changes nothing");
});
// (fails before: yes — the owner's of 10-29: every agent was switched on until the person switched it off, so a Sync
// pressed by mistake brought every chat of Claude Code, Codex and Cursor into the left bar)
test("no agent is switched on for Sync until the person switches it on — an archive an older Filament wrote, with its `off` list, too", async () => {
  const a = openArchive();
  assert.ok((await importOverview({ archive: a, home: join(dir, "no-such-home") })).sources.every((s) => s.on === false), "a new archive: every agent off");
  // An older Filament kept the agents a Sync left out, `off: []` from its first run on: that was no choice of the person's.
  a.schemaMetaSet("imports", { reachDays: 7, off: [], learn: false, removed: ["cc:gone"], last: { by: "sync" } });
  assert.deepEqual(importState(a).on, []);
  assert.equal("off" in importState(a), false);
  assert.deepEqual([importState(a).reachDays, importState(a).removed, importState(a).last], [7, ["cc:gone"], { by: "sync" }], "the rest of what it kept stays");
  setImportPrefs(a, { learn: true });
  assert.equal("off" in a.schemaMetaGet("imports"), false, "the old list is gone at the next write");
  setImportPrefs(a, { on: ["codex"] });
  assert.deepEqual((await importOverview({ archive: a, home: join(dir, "no-such-home") })).sources.map((s) => [s.id, s.on]), AGENTS.map((id) => [id, id === "codex"]));
});
// (fails before: yes — a chat deleted in Filament came back at the next import)
test("only an import's chains are remembered as removed, and one asked for by name is forgotten", () => {
  const a = openArchive();
  assert.equal(isImportKey("cc:abc"), true);
  assert.equal(isImportKey("n:abc"), false);
  assert.equal(isImportKey(null), false);
  noteRemoved(a, ["n:harness-made", "cc:one", null, "cc:two"]);
  noteRemoved(a, ["cc:one", "f:fingerprint"]);
  assert.deepEqual(importState(a).removed, ["cc:two", "cc:one"], "each once, the newest last");
  forgetRemoved(a, ["cc:two", "cc:never-there"]);
  assert.deepEqual(importState(a).removed, ["cc:one"]);
});

// ---- the section's first read ----------------------------------------------------------------------------------------
// (fails before: yes — the dashboard's panel knew a count of files and nothing more)
test("the overview counts an agent's chats, their size, folders and states, what a Sync would bring, and what memory has not read", async () => {
  const a = openArchive();
  const h = threeChats("overview");
  const now = T0 + 100 * DAY;
  h.changedAt(SLUG_A, S1, now - 1 * DAY);
  h.changedAt(SLUG_A, S2, now - 2 * DAY);
  h.changedAt(SLUG_B, S3, now - 60 * DAY);
  const size = (slug, sid) => statSync(h.file(slug, sid)).size;
  const total = size(SLUG_A, S1) + size(SLUG_A, S2) + size(SLUG_B, S3);
  const first = await importOverview({ archive: a, home: h.home, folder: dir, now });
  assert.deepEqual(first.prefs, { reachDays: 30, on: [], learn: false });
  assert.deepEqual(first.reaches, [7, 30, 90, 0]);
  assert.equal(first.last, null);
  assert.equal(typeof first.free, "number", "the room left on the archive's drive");
  assert.deepEqual(first.unread, { chats: 0, passes: 0 });
  assert.deepEqual(first.sources.map((s) => s.id), AGENTS, "every agent, in the order the section lists them");
  assert.deepEqual(first.sources.filter((s) => s.id === "claude-code"), [
    {
      id: "claude-code",
      label: "Claude Code",
      where: h.root,
      found: true,
      on: false,
      chats: 3,
      bytes: total,
      projects: 2,
      states: { new: 3 },
      pending: { chats: 2, bytes: size(SLUG_A, S1) + size(SLUG_A, S2) },
    },
  ]);

  await importClaudeCode({ archive: a, root: h.root, only: new Set([`${SLUG_A}/${S1}`, `${SLUG_B}/${S3}`]) });
  h.changedAt(SLUG_A, S1, now - 1 * DAY);
  h.changedAt(SLUG_B, S3, now - 60 * DAY);
  setImportPrefs(a, { on: ["claude-code"], reachDays: 0 });
  const second = await importOverview({ archive: a, home: h.home, now });
  assert.equal(second.free, null, "no folder named, no room told");
  assert.equal(second.sources[0].on, true);
  assert.deepEqual(second.sources[0].states, { imported: 2, new: 1 });
  assert.deepEqual(second.sources[0].pending, { chats: 1, bytes: size(SLUG_A, S2) });
  assert.deepEqual(second.unread, { chats: 2, passes: 2 }, "two chats memory has not read, one pass each");

  // Memory read one to its end, and a long one takes a pass for every sixteen turns.
  a.mergeMeta(chainOf(a, S1).id, { learnedThrough: 2 });
  h.write(SLUG_A, sidOf(4), chat(sidOf(4), CWD_A, 33, 40));
  await importClaudeCode({ archive: a, root: h.root, only: new Set([`${SLUG_A}/${sidOf(4)}`]) });
  assert.deepEqual(unreadByMemory(a), { chats: 2, passes: 1 + 3 });

  const none = await importOverview({ archive: a, home: join(dir, "no-such-home"), now });
  assert.deepEqual(none.sources.filter((s) => s.id === "claude-code"), [
    { id: "claude-code", label: "Claude Code", where: join(dir, "no-such-home", ".claude", "projects"), found: false, on: true, chats: 0, bytes: 0, projects: 0, states: {}, pending: { chats: 0, bytes: 0 } },
  ]);
  assert.deepEqual(none.sources.map((s) => [s.id, s.found, s.chats]), AGENTS.map((id) => [id, false, 0]), "an agent with no folder is listed, with nothing");
});

// (fails before: yes — a file with no message of the person's made no session and stayed "new": every Sync read it
// again and the section's count of new chats never reached nothing)
test("a chat with no turn in it is remembered as empty: no Sync counts it as new again until its file grows", async () => {
  const a = openArchive();
  const h = homeOf("empty");
  h.write(SLUG_A, S1, chat(S1, CWD_A, 1));
  h.write(SLUG_A, S2, [{ type: "file-history-snapshot", sessionId: S2, messageId: "m", snapshot: { trackedFileBackups: {} } }]);
  const stand = async () => Object.fromEntries((await chatStates(claudeCodeSource, { archive: a, where: h.root, empty: importState(a).empty })).map((c) => [c.agentSession, c.state]));
  const out = await importClaudeCode({ archive: a, root: h.root });
  assert.deepEqual([out.newChains, out.empty], [1, [{ key: `cc:${S2}`, mark: statSync(h.file(SLUG_A, S2)).size }]]);
  assert.deepEqual((await importClaudeCode({ root: h.root, dryRun: true })).empty, [], "a dry run remembers nothing");
  assert.deepEqual(importState(a).empty, {}, "nothing is remembered until the run's end is noted");
  noteEmpty(a, out.empty);
  noteEmpty(a, [{ key: "mine:1", mark: 5 }]);
  assert.deepEqual(importState(a).empty, { [`cc:${S2}`]: statSync(h.file(SLUG_A, S2)).size }, "only an import's own chats are remembered");
  assert.deepEqual(await stand(), { [S1]: "imported", [S2]: "empty" });
  assert.deepEqual(pendingOf(await chatStates(claudeCodeSource, { archive: a, where: h.root, empty: importState(a).empty }), { reachDays: 0, now: Date.now() }), []);
  assert.deepEqual((await importOverview({ archive: a, home: h.home })).sources[0].states, { imported: 1, empty: 1 });
  h.append(SLUG_A, S2, chat(S2, CWD_A, 1, 10));
  assert.deepEqual(await stand(), { [S1]: "imported", [S2]: "new" }, "it grew: there may be a turn in it now");
  assert.equal((await importClaudeCode({ archive: a, root: h.root })).newChains, 1);
  assert.deepEqual(await stand(), { [S1]: "imported", [S2]: "imported" });
});

// ---- the routes ------------------------------------------------------------------------------------------------------
const json = async (res) => ({ status: res.status, body: await res.json() });
// (fails before: yes — MEMR-10: a run's report had no word for a line too long to read)
test("an import's report, as the section reads it, names each line too long to read with its agent, and keeps it for the last run", async () => {
  const h = homeOf("huge-run");
  mkdirSync(join(h.root, SLUG_A), { recursive: true });
  const f = h.file(SLUG_A, S1);
  writeWithLongLine(f, jsonl(chat(S1, CWD_A, 1)), jsonl(chat(S1, CWD_A, 1, 10)));
  const shim = await startApp({ memory: true, overrides: { importHome: h.home } });
  try {
    const memory = shim.app.memory;
    const r = await (await memory.importChosen({ source: "claude-code", chats: [`${SLUG_A}/${S1}`] })).done;
    assert.deepEqual([r.errors, r.long, r.newTurns], [[], [{ source: "claude-code", file: `${S1}.jsonl`, line: 3, bytes: PAST_A_LINE }], 2]);
    assert.deepEqual(importState(memory.archive).last.long, r.long, "kept for the section's last run");
  } finally {
    await shim.stop();
    rmSync(f, { force: true });
  }
});
// (fails before: yes — the routes did not exist; the harness had no way to ask for any of this)
test("the Import section's routes: overview, Sync, one at a time, the chats, a deleted chat stays away, a chosen one comes back", async () => {
  const h = threeChats("routes");
  const shim = await startApp({ memory: true, overrides: { importHome: h.home } });
  const memory = shim.app.memory;
  const get = (path) => shim.api(`/api/memory/import/${path}`).then(json);
  const send = (method, path, body) => shim.api(`/api/memory/import/${path}`, { method, body }).then(json);
  const finished = async (id) => until(async () => { const j = await (await shim.api(`/api/memory/jobs/${id}`)).json(); return j.status === "running" ? null : j; }, `job ${id} to end`);
  try {
    const before = await get("overview");
    assert.equal(before.status, 200);
    assert.equal(before.body.job, null);
    assert.deepEqual(before.body.prefs, { reachDays: 30, on: [], learn: false });
    assert.deepEqual(before.body.sources.map((s) => s.id), AGENTS);
    assert.deepEqual(
      { where: before.body.sources[0].where, chats: before.body.sources[0].chats, states: before.body.sources[0].states, pending: before.body.sources[0].pending.chats },
      { where: h.root, chats: 3, states: { new: 3 }, pending: 3 },
    );
    assert.ok("model" in before.body.learner, "the model that would read the chats for memory is named (null: none)");

    // (fails before: yes — the owner's of 10-29) No agent is switched on until the person does: a Sync brings nothing.
    assert.deepEqual(before.body.sources.map((s) => s.on), AGENTS.map(() => false));
    assert.equal((await (await memory.importSync()).done).chats, 0, "with no agent switched on, a Sync brings nothing");
    assert.equal(memory.archive.chainsWithKeyPrefix("cc:").length, 0);
    assert.deepEqual(await send("PUT", "prefs", { on: ["claude-code"] }), { status: 200, body: { prefs: { reachDays: 30, on: ["claude-code"], learn: false } } });

    // Sync, and a second one asked while the first runs is refused in words.
    const job = await memory.importSync();
    assert.equal(job.kind, "import-sync");
    assert.equal(job.status, "running");
    assert.equal(job.stoppable, true);
    await assert.rejects(memory.importSync(), (e) => e.refused === true && /an import is running/.test(e.message));
    await assert.rejects(memory.importChosen({ source: "claude-code", chats: [`${SLUG_A}/${S1}`] }), (e) => e.refused === true);
    // (fails before: yes — the console's Import started beside a Sync, two writers to the same sessions)
    assert.throws(() => memory.import({ source: "claude-code", root: h.root }), (e) => e.refused === true && /an import is running/.test(e.message), "the console's claude-code import is an import too");
    assert.deepEqual((await memory.importOverview()).job, { id: job.id, kind: "import-sync" }, "the section is told an import is under way");
    const done = await finished(job.id);
    assert.equal(done.status, "done");
    assert.deepEqual(
      { ...done.result, at: null },
      {
        by: "sync",
        at: null,
        reachDays: 30,
        chats: 3,
        newChats: 3,
        newTurns: 6,
        errors: [],
        sources: { "claude-code": { chats: 3, newChats: 3, newTurns: 6, errors: 0 } },
      },
    );

    // The chats are sessions of the harness's own (IM-58), with the agent's name kept for the title's hover, and the chat's own time.
    const listed = (await (await shim.api("/api/memory/sessions?limit=200&kind=interactive,fork")).json()).sessions;
    const mine = listed.filter((s) => s.importedFrom === "Claude Code");
    assert.ok(mine.every((s) => s.client === "harness"), "no client of its own");
    assert.equal(mine.length, 3);
    assert.deepEqual(mine.map((s) => s.turns).sort(), [1, 2, 3]);
    const c3 = chainOf(memory.archive, S3);
    assert.equal(c3.started_at, T0 + 20 * 60_000);
    assert.equal(c3.last_at, T0 + 25 * 60_000, "last active when the chat was, not when it was imported");
    assert.equal(c3.model, null, "the session names no model: the person picks one");
    assert.equal(memory.archive.getTurns(c3.id)[0].model, "claude-sonnet-5-5", "each turn keeps the model that answered it");

    const after = await get("overview");
    assert.equal(after.body.job, null);
    assert.deepEqual(after.body.sources[0].states, { imported: 3 });
    assert.equal(after.body.sources[0].pending.chats, 0);
    assert.equal(after.body.last.by, "sync");
    assert.equal(after.body.last.newChats, 3);
    assert.deepEqual(after.body.unread, { chats: 3, passes: 3 });

    // A second Sync has nothing to bring; it is a run all the same, and says so.
    const idle = await finished((await send("POST", "sync")).body.job.id);
    assert.equal(idle.result.chats, 0);
    assert.equal(idle.result.newTurns, 0);

    const chats = await get("chats?source=claude-code");
    assert.equal(chats.status, 200);
    assert.equal(chats.body.found, true);
    assert.equal(chats.body.chats.length, 3);
    assert.ok(chats.body.chats.every((c) => c.state === "imported" && c.chain && c.turns > 0));
    assert.ok(chats.body.chats.every((c, i, all) => i === 0 || all[i - 1].lastAt >= c.lastAt), "the newest first");

    // The person deletes one in Filament: it stays away at a Sync, and comes back when asked for by name.
    const gone = chainOf(memory.archive, S2).id;
    assert.equal((await shim.api(`/api/memory/sessions/${gone}/delete`, { method: "POST", body: {} })).status, 200);
    assert.equal(chainOf(memory.archive, S2), null);
    const afterDelete = await get("chats?source=claude-code");
    assert.equal(afterDelete.body.chats.find((c) => c.agentSession === S2).state, "removed");
    assert.equal((await get("overview")).body.sources[0].pending.chats, 0, "a Sync would not bring it");
    const kept = await finished((await send("POST", "sync")).body.job.id);
    assert.equal(kept.result.newChats, 0);
    assert.equal(chainOf(memory.archive, S2), null);
    const back = await send("POST", "chosen", { source: "claude-code", chats: [`${SLUG_A}/${S2}`] });
    assert.equal(back.status, 200);
    assert.equal(back.body.job.kind, "import-claude-code");
    const brought = await finished(back.body.job.id);
    assert.deepEqual({ by: brought.result.by, newChats: brought.result.newChats, newTurns: brought.result.newTurns }, { by: "browse", newChats: 1, newTurns: 1 });
    assert.equal((await get("chats?source=claude-code")).body.chats.find((c) => c.agentSession === S2).state, "imported");
    assert.deepEqual(importState(memory.archive).removed, []);

    // Several chats named at once, as a folder's "Import all" names them.
    h.write(SLUG_B, sidOf(5), chat(sidOf(5), CWD_B, 2, 60));
    const several = await finished((await send("POST", "chosen", { source: "claude-code", chats: [`${SLUG_B}/${S3}`, `${SLUG_B}/${sidOf(5)}`] })).body.job.id);
    assert.equal(several.result.chats, 2, "both chats are read");
    assert.equal(several.result.newChats, 1, "one of them is new");
  } finally {
    await shim.stop();
  }
});
// (fails before: yes — no choices, no routes; and a chat Filament ran itself would have come in a second time)
test("the Import section's routes: the choices, an agent switched off, a chat Filament runs itself, Stop, and what is refused", async () => {
  const h = threeChats("routes2");
  const shim = await startApp({ memory: true, overrides: { importHome: h.home } });
  const memory = shim.app.memory;
  const get = (path) => shim.api(`/api/memory/import/${path}`).then(json);
  const send = (method, path, body) => shim.api(`/api/memory/import/${path}`, { method, body }).then(json);
  try {
    // What is refused, in words.
    const refusals = [
      [await get("chats?source=nobody"), /no such agent: nobody/],
      [await get("chats"), /no such agent: none named/],
      [await send("POST", "chosen", { source: "claude-code" }), /name the chats to import/],
      [await send("POST", "chosen", { source: "claude-code", chats: [] }), /name the chats to import/],
      [await send("POST", "chosen", { source: "claude-code", chats: ["x/y"] }), /none of those chats/],
      [await send("POST", "chosen", { source: "nobody", chats: ["x/y"] }), /no such agent/],
      [await send("PUT", "prefs", { reachDays: -1 }), /whole number of days/],
      [await send("PUT", "prefs", { on: ["nobody"] }), /no such agent/],
    ];
    for (const [r, words] of refusals) {
      assert.equal(r.status, 400);
      assert.match(r.body.error, words);
    }
    assert.equal(memory.archive.chainsWithKeyPrefix("cc:").length, 0, "a refused request brings nothing in");

    // The choices.
    const prefs = await send("PUT", "prefs", { reachDays: 7, on: ["codex"] });
    assert.deepEqual(prefs, { status: 200, body: { prefs: { reachDays: 7, on: ["codex"], learn: false } } });
    const off = await get("overview");
    assert.equal(off.body.sources[0].on, false);
    const job = await memory.importSync();
    assert.equal((await job.done).chats, 0, "an agent switched off is left out of a Sync");
    assert.equal(memory.archive.chainsWithKeyPrefix("cc:").length, 0);
    await send("PUT", "prefs", { reachDays: 0, on: ["claude-code"] });

    // A chat one of Filament's own sessions runs in the agent is a session already: no Sync and no choice takes it.
    assert.ok(memory.agentSessionIds() instanceof Set, "the server hands memory the sessions its bridges run");
    Map.prototype.set.call(shim.app.acp.convs, "made-up", { sessionId: S1 });
    try {
      assert.equal(memory.agentSessionIds().has(S1), true);
      assert.equal((await get("chats?source=claude-code")).body.chats.find((c) => c.agentSession === S1).state, "own");
      assert.deepEqual((await get("overview")).body.sources[0].states, { own: 1, new: 2 });
      const own = await send("POST", "chosen", { source: "claude-code", chats: [`${SLUG_A}/${S1}`] });
      assert.equal(own.status, 400);
      const synced = await (await memory.importSync()).done;
      assert.equal(synced.newChats, 2);
      assert.equal(chainOf(memory.archive, S1), null, "Filament's own chat was passed over");
    } finally {
      Map.prototype.delete.call(shim.app.acp.convs, "made-up");
    }

    // Memory reads what comes in only when the person chose so.
    let read = 0;
    memory.backfillLearning = async () => ({ learned: ++read });
    await (await memory.importSync()).done;
    assert.equal(read, 0, "the switch is off: nothing is read");
    assert.equal(chainOf(memory.archive, S1).turns, 2);
    h.write(SLUG_A, sidOf(6), chat(sidOf(6), CWD_A, 1, 80));
    await (await memory.importChosen({ source: "claude-code", chats: [`${SLUG_A}/${sidOf(6)}`], learn: true })).done;
    assert.equal(read, 1, "asked for with this import: memory reads");
    await send("PUT", "prefs", { learn: true });
    await (await memory.importSync()).done;
    assert.equal(read, 1, "a run that brought no new turn reads nothing");
    h.append(SLUG_A, sidOf(6), chat(sidOf(6), CWD_A, 1, 82));
    assert.equal((await (await memory.importSync()).done).newTurns, 1);
    assert.equal(read, 2, "the switch is on: a Sync that brings a turn has memory read");
    assert.equal([...memory.jobs.values()].filter((j) => j.kind === "learn-backfill").length > 0, true, "the reading is a job of its own, seen and stoppable");
    assert.ok([...memory.jobs.values()].filter((j) => j.kind === "learn-backfill").every((j) => j.stoppable === true));
    await until(async () => (await memory.importOverview()).lastRead?.learned === 2, "how the reading ended to be kept for the section");
    assert.equal(typeof (await memory.importOverview()).lastRead.at, "number");

    // Stop: the job says stopped, and the next import is free to start.
    h.write(SLUG_A, sidOf(7), chat(sidOf(7), CWD_A, 3, 90));
    const stopped = await memory.importSync();
    const res = await shim.api(`/api/memory/jobs/${stopped.id}/stop`, { method: "POST", body: {} });
    assert.equal(res.status, 200);
    const { stopped: wasStopped } = await res.json();
    await stopped.done.catch(() => {});
    if (wasStopped) {
      assert.equal(stopped.status, "error");
      assert.equal(stopped.stopped, true, "a stop is the person's, not a failure");
    }
    const next = await memory.importSync();
    assert.equal((await next.done).errors.length, 0);
    assert.equal(chainOf(memory.archive, sidOf(7)).turns, 3, "the stopped chat is whole after the next run");
  } finally {
    await shim.stop();
  }
});
// (fails before: yes — no stop for an import's job)
test("an import's job stopped at once ends as stopped and writes nothing", async () => {
  const h = threeChats("routes3");
  const shim = await startApp({ memory: true, overrides: { importHome: h.home } });
  const memory = shim.app.memory;
  try {
    memory.importPrefs({ on: ["claude-code"] });
    const job = await memory.importSync();
    assert.equal(memory.stopJob(job.id), true);
    await assert.rejects(job.done, (e) => e.aborted === true);
    assert.equal(job.status, "error");
    assert.equal(job.stopped, true);
    assert.equal(memory.archive.chainsWithKeyPrefix("cc:").length, 0);
    assert.equal((await memory.importOverview()).job, null);
    assert.equal(importState(memory.archive).last, null, "a stopped run is not kept as the last run");
    assert.equal(memory.stopJob(job.id), false, "a job that ended has no stop");
    assert.equal((await (await memory.importSync()).done).newChats, 3);
  } finally {
    await shim.stop();
  }
});

// ---- the welcome tour's Your chats: the chats a Sync would bring, named; several agents' chosen chats in one run ----
const CWD_C = "C:\\proj\\gamma";
const codexId = (n) => `0199aaaa-0000-7000-8000-${String(n).padStart(12, "0")}`;
/**
 * A Codex chat of one turn of words under a home's `.codex/sessions`, in the lines Codex 0.154 writes
 * (test/import-codex.test.js makes them at length). → its file.
 */
function codexChat(home, id, question, answer = "Done.") {
  const day = join(home, ".codex", "sessions", "2026", "09", "02");
  mkdirSync(day, { recursive: true });
  let n = 0;
  const line = (type, payload) => JSON.stringify({ timestamp: new Date(T0 + n * 1000).toISOString(), type, payload, ordinal: n++ });
  const item = (it) => line("event_msg", { type: "item_completed", item: it });
  const file = join(day, `rollout-2026-09-02T08-00-00-${id}.jsonl`);
  writeFileSync(file, [
    line("session_meta", { id, session_id: id, timestamp: new Date(T0).toISOString(), cwd: CWD_C, originator: "codex_cli_rs", cli_version: "0.154.0", source: "cli", model_provider: "openai", base_instructions: { text: "You are Codex, a coding agent." } }),
    line("event_msg", { type: "task_started", turn_id: "t1", started_at: Math.floor(T0 / 1000) }),
    line("turn_context", { turn_id: "t1", cwd: CWD_C, model: "gpt-5.5", effort: "medium" }),
    line("response_item", { type: "message", role: "user", content: [{ type: "input_text", text: question }] }),
    item({ type: "UserMessage", id: "u1", content: [{ type: "text", text: question, text_elements: [] }] }),
    item({ type: "AgentMessage", id: "a1", content: [{ type: "Text", text: answer }], phase: "final_answer" }),
    line("response_item", { type: "message", role: "assistant", content: [{ type: "output_text", text: answer }], phase: "final_answer" }),
    line("event_msg", { type: "task_complete", turn_id: "t1", last_agent_message: null }),
  ].join("\n") + "\n");
  return file;
}
// (fails before: yes — the owner's of 11-12: the overview counted the chats a Sync would bring and named none, so the
// welcome tour's Your chats could bring all of them or none)
test("the overview names the chats a Sync would bring where it is asked to — the newest first, each with what it has a value for —, and is as it was where it is not", async () => {
  const a = openArchive();
  const h = threeChats("listed");
  const now = T0 + 100 * DAY;
  h.changedAt(SLUG_A, S1, now - 2 * DAY);
  h.changedAt(SLUG_A, S2, now - 1 * DAY);
  h.changedAt(SLUG_B, S3, now - 60 * DAY);
  const size = (slug, sid) => statSync(h.file(slug, sid)).size;
  const plain = await importOverview({ archive: a, home: h.home, now });
  const listed = await importOverview({ archive: a, home: h.home, now, list: true });
  assert.deepEqual(plain.sources.map((s) => Object.keys(s.pending)), AGENTS.map(() => ["chats", "bytes"]), "unasked: the counts alone, as before");
  assert.deepEqual(listed.sources[0].pending, {
    chats: 2,
    bytes: size(SLUG_A, S1) + size(SLUG_A, S2),
    list: [
      { id: `${SLUG_A}/${S2}`, cwd: CWD_A, preview: "question 6 of 2222", lastAt: now - 1 * DAY, bytes: size(SLUG_A, S2), state: "new" },
      { id: `${SLUG_A}/${S1}`, cwd: CWD_A, preview: "question 1 of 1111", lastAt: now - 2 * DAY, bytes: size(SLUG_A, S1), state: "new" },
    ],
  }, "the chats `pendingOf` counts: new or grown, inside the reach — the one of 60 days ago is not among them");
  assert.deepEqual(listed.sources.slice(1).map((s) => [s.found, s.pending]), [[false, { chats: 0, bytes: 0, list: [] }], [false, { chats: 0, bytes: 0, list: [] }]], "an agent not found lists none");
  const without = { ...listed, sources: listed.sources.map((s) => ({ ...s, pending: { chats: s.pending.chats, bytes: s.pending.bytes } })) };
  assert.deepEqual(without, plain, "nothing else of the answer moves");

  // A chat brought in and gone on with in its agent since is listed as grown, under the title it has in Filament; one
  // brought in whole is listed no more; and the reach is the person's.
  await importClaudeCode({ archive: a, root: h.root, only: new Set([`${SLUG_A}/${S1}`, `${SLUG_A}/${S2}`]) });
  a.setTitle(chainOf(a, S1).id, "Alpha, the plan");
  h.append(SLUG_A, S1, chat(S1, CWD_A, 1, 30));
  h.changedAt(SLUG_A, S1, now - 3 * DAY);
  h.changedAt(SLUG_A, S2, now - 1 * DAY);
  setImportPrefs(a, { reachDays: 0 });
  const later = (await importOverview({ archive: a, home: h.home, now, list: true })).sources[0];
  assert.deepEqual([later.states, later.pending.chats], [{ grown: 1, imported: 1, new: 1 }, 2]);
  assert.deepEqual(later.pending.list, [
    { id: `${SLUG_A}/${S1}`, cwd: CWD_A, title: "Alpha, the plan", preview: "question 1 of 1111", lastAt: now - 3 * DAY, bytes: size(SLUG_A, S1), state: "grown" },
    { id: `${SLUG_B}/${S3}`, cwd: CWD_B, preview: "question 11 of 3333", lastAt: now - 60 * DAY, bytes: size(SLUG_B, S3), state: "new" },
  ]);
});
// (fails before: yes — a chosen import took one agent's chats: the tour's choice over two agents would have been two
// runs, the second refused while the first ran)
test("the chats chosen of several agents come in as one run, agent by agent on one progress scale; what cannot be taken is refused in words, and one agent's chosen chats come in as they did", async () => {
  const h = threeChats("picks");
  const X1 = codexId(71), X2 = codexId(72);
  codexChat(h.home, X1, "Fix the parser");
  codexChat(h.home, X2, "a chat nobody chose");
  const shim = await startApp({ memory: true, overrides: { importHome: h.home } });
  const memory = shim.app.memory;
  const get = (path) => shim.api(`/api/memory/import/${path}`).then(json);
  const send = (method, path, body) => shim.api(`/api/memory/import/${path}`, { method, body }).then(json);
  const finished = async (id) => until(async () => { const j = await (await shim.api(`/api/memory/jobs/${id}`)).json(); return j.status === "running" ? null : j; }, `job ${id} to end`);
  const A1 = `${SLUG_A}/${S1}`, A2 = `${SLUG_A}/${S2}`, B3 = `${SLUG_B}/${S3}`;
  try {
    // The overview's route: the list where it is asked for, by `?list=1` alone.
    const plain = (await get("overview")).body;
    const listed = (await get("overview?list=1")).body;
    assert.deepEqual([plain.sources.map((s) => "list" in s.pending), (await get("overview?list=0")).body.sources.map((s) => "list" in s.pending)], [[false, false, false], [false, false, false]]);
    assert.deepEqual(listed.sources.map((s) => [s.id, s.pending.chats, s.pending.list.map((c) => c.id).sort()]), [["claude-code", 3, [A1, A2, B3].sort()], ["codex", 2, [X1, X2].sort()], ["cursor", 0, []]]);
    assert.deepEqual(listed.sources[1].pending.list.find((c) => c.id === X1), { id: X1, cwd: CWD_C, preview: "Fix the parser", lastAt: listed.sources[1].pending.list.find((c) => c.id === X1).lastAt, bytes: statSync(codexChat(h.home, X1, "Fix the parser")).size, state: "new" });

    // What is refused, in words — and nothing comes in.
    const refusals = [
      [{ picks: [] }, /name the chats to import/],
      [{ picks: "claude-code" }, /name the chats to import/],
      [{ picks: [{ source: "claude-code", chats: [] }, { source: "codex" }] }, /name the chats to import/],
      [{ picks: [{ source: "claude-code", chats: [A1] }, { source: "nobody", chats: ["x"] }] }, /no such agent: nobody/],
      [{ picks: [{ chats: [A1] }] }, /no such agent: none named/],
      [{ picks: [{ source: "claude-code", chats: [A1] }, { source: "cursor", chats: ["x"] }] }, /Cursor keeps no chats at /],
      [{ picks: [{ source: "claude-code", chats: ["x/y"] }, { source: "codex", chats: ["nothing"] }] }, /none of those chats is on its agent's list/],
    ];
    for (const [body, words] of refusals) {
      const r = await send("POST", "chosen", body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.match(r.body.error, words);
    }
    assert.deepEqual([memory.archive.chainsWithKeyPrefix("cc:").length, memory.archive.chainsWithKeyPrefix("cx:").length, (await get("overview")).body.job], [0, 0, null], "a refused request brings nothing in and starts no run");

    // Two agents' chosen chats: one job, and no other chat of either agent.
    const started = await send("POST", "chosen", { picks: [{ source: "codex", chats: [X1] }, { source: "claude-code", chats: [A1, B3] }, { source: "claude-code", chats: [B3, "x/gone"] }] });
    assert.deepEqual([started.status, started.body.job.kind, started.body.job.stoppable], [200, "import-chosen", true]);
    const done = await finished(started.body.job.id);
    assert.equal(done.status, "done");
    assert.deepEqual({ ...done.result, at: null }, {
      by: "browse",
      at: null,
      chats: 3,
      newChats: 3,
      newTurns: 6,
      errors: [],
      sources: { codex: { chats: 1, newChats: 1, newTurns: 1, errors: 0 }, "claude-code": { chats: 2, newChats: 2, newTurns: 5, errors: 0 } },
    }, "its result per agent, and in all");
    assert.deepEqual([memory.archive.chainsWithKeyPrefix("cc:").map((c) => c.key).sort(), memory.archive.chainsWithKeyPrefix("cx:").map((c) => c.key)], [[`cc:${S1}`, `cc:${S3}`], [`cx:${X1}`]], "the chats named, and no other");
    assert.equal(importState(memory.archive).last.by, "browse", "kept as a chosen import's end is");
    // One progress scale, by bytes: the agent named first fills its share of it, the next goes on from there.
    const steps = memory.job(started.body.job.id).progress.filter((p) => p.percent != null).map((p) => [p.step, p.percent]);
    const bytes = { codex: statSync(codexChat(h.home, X1, "Fix the parser")).size, claude: statSync(h.file(SLUG_A, S1)).size + statSync(h.file(SLUG_B, S3)).size };
    const share = Math.round((bytes.codex / (bytes.codex + bytes.claude)) * 100);
    assert.deepEqual([...new Set(steps.map(([step]) => step))], ["codex", "claude-code"], "agent by agent, in the order they were named");
    assert.ok(steps.every(([, pct], i) => i === 0 || steps[i - 1][1] <= pct), `the scale never goes back: ${JSON.stringify(steps)}`);
    assert.deepEqual([steps[0], steps.filter(([step]) => step === "codex").at(-1), steps.find(([step]) => step === "claude-code"), steps.at(-1)], [["codex", 0], ["codex", share], ["claude-code", share], ["claude-code", 100]]);

    // A chat Filament ran itself is not taken; one the person removed comes back, asked for by name.
    Map.prototype.set.call(shim.app.acp.convs, "made-up", { sessionId: S2 });
    try {
      const own = await send("POST", "chosen", { picks: [{ source: "claude-code", chats: [A2] }] });
      assert.deepEqual([own.status, /none of those chats/.test(own.body.error)], [400, true]);
      const beside = await finished((await send("POST", "chosen", { picks: [{ source: "claude-code", chats: [A2] }, { source: "codex", chats: [X2] }] })).body.job.id);
      assert.deepEqual([beside.result.sources, chainOf(memory.archive, S2)], [{ codex: { chats: 1, newChats: 1, newTurns: 1, errors: 0 } }, null], "the other agent's chat comes in; Filament's own is passed over");
    } finally {
      Map.prototype.delete.call(shim.app.acp.convs, "made-up");
    }
    assert.equal((await shim.api(`/api/memory/sessions/${chainOf(memory.archive, S1).id}/delete`, { method: "POST", body: {} })).status, 200);
    assert.deepEqual(importState(memory.archive).removed, [`cc:${S1}`]);
    const back = await finished((await send("POST", "chosen", { picks: [{ source: "claude-code", chats: [A1] }] })).body.job.id);
    assert.deepEqual([back.result.newChats, importState(memory.archive).removed, chainOf(memory.archive, S1)?.turns], [1, [], 2]);

    // It is an import as any other: one at a time, the section told it is under way; and memory reads what it brings
    // where the request says so, as one agent's does.
    let read = 0;
    memory.backfillLearning = async () => ({ learned: ++read });
    const running = await memory.importChosen({ picks: [{ source: "claude-code", chats: [A2] }], learn: true });
    await assert.rejects(memory.importChosen({ picks: [{ source: "codex", chats: [X2] }] }), (e) => e.refused === true && /an import is running/.test(e.message));
    assert.throws(() => memory.import({ source: "claude-code", root: h.root }), (e) => e.refused === true && /an import is running/.test(e.message));
    assert.equal((await running.done).newChats, 1);
    assert.equal(read, 1);

    // One agent's chosen chats, the body Browse sends: as it was — its job's kind, its refusals.
    h.write(SLUG_B, sidOf(5), chat(sidOf(5), CWD_B, 2, 60));
    const single = await send("POST", "chosen", { source: "claude-code", chats: [`${SLUG_B}/${sidOf(5)}`] });
    assert.deepEqual([single.status, single.body.job.kind], [200, "import-claude-code"]);
    const one = await finished(single.body.job.id);
    assert.deepEqual([one.result.by, one.result.sources, memory.job(single.body.job.id).progress.filter((p) => p.percent != null).at(-1).percent], ["browse", { "claude-code": { chats: 1, newChats: 1, newTurns: 2, errors: 0 } }, 100]);
    for (const [body, words] of [[{ source: "claude-code" }, /name the chats to import/], [{ source: "claude-code", chats: ["x/y"] }, /none of those chats is on the agent's list/], [{ source: "nobody", chats: ["x/y"] }, /no such agent: nobody/], [{}, /no such agent: none named/], [{ source: "cursor", chats: ["x"] }, /Cursor keeps no chats at /]]) {
      const r = await send("POST", "chosen", body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.match(r.body.error, words);
    }
  } finally {
    await shim.stop();
  }
});
// (fails before: yes — a chat read from Claude Code's files showed its `/model` as words the person typed and the
// command's output as a model's answer; and nothing on its row said where the chat came from)
test("an imported chat reads as Filament's own: a command its agent answered is a command turn that names the agent, on the route and on the page", async () => {
  const h = homeOf("routes5");
  h.write(SLUG_A, S1, [
    ...chat(S1, CWD_A, 1),
    said(S1, CWD_A, 4, "<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>sonnet</command-args>"),
    said(S1, CWD_A, 5, "<local-command-stdout>Set model to sonnet</local-command-stdout>"),
  ]);
  const shim = await startApp({ memory: true, overrides: { importHome: h.home } });
  try {
    shim.app.memory.importPrefs({ on: ["claude-code"] });
    await (await shim.app.memory.importSync()).done;
    const id = chainOf(shim.app.memory.archive, S1).id;
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    assert.deepEqual(tr.turns.map((t) => [t.command === true, t.commandBy ?? null]), [[false, null], [true, "Claude Code"]]);
    const turns = transcriptTurns(tr);
    assert.deepEqual(turns.map((t) => [t.command, t.commandBy]), [[false, null], [true, "Claude Code"]]);
    assert.deepEqual([turns[1].userText, turns[1].commandText, turns[1].blocks], ["/model sonnet", "Set model to sonnet", []], "the command as the person typed it, no tags; its output the answer, off the model's blocks");
    assert.ok(textOf(commandAnswer("Set model to sonnet", null, {}, { h: fakeH, by: turns[1].commandBy })).startsWith("Claude Code answered this — no model was called"));
    assert.ok(textOf(commandAnswer("Set model to sonnet", null, {}, { h: fakeH })).startsWith("Filament answered this — no model was called"), "a command of Filament's own says Filament");
    // The session names no model (Claude Code's is no route of Filament's): a message without one is refused in words,
    // and the page writes the composer's as the session's setting before its first message here.
    assert.equal(tr.model, null);
    const refused = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "and now?" } });
    assert.equal(refused.status, 400);
    assert.match(JSON.stringify(await refused.json()), /the session has no model/);
    const set = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { model: { name: "my-model" } } } });
    assert.equal(set.status, 200);
    assert.equal((await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json()).model, "my-model");
    assert.equal(chainOf(shim.app.memory.archive, S1).model, "my-model");
    assert.match(readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8"), /if \(!chat\.model && !\(await writeSessionSettings\(chat, \{ patch: \{ model: \{ name: model \} \} \}\)\)\) return null;\n\s*\/\/ The document is the one truth/);
    // Where it came from is said once, on the title's hover; its row in the sidebar names no agent (IM-59).
    assert.doesNotMatch(readFileSync(new URL("../src/ui/harness/sidebar.js", import.meta.url), "utf8"), /importedFrom/);
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    assert.match(app, /function paintImportedFrom\(chat\) \{\s+const from = chat\?\.chainId \? \(state\.sessions \|\| \[\]\)\.find\(\(\/\*\* @type \{any\} \*\/ s\) => s\.id === chat\.chainId\)\?\.importedFrom : null;\s+if \(from\) titleEl\.setAttribute\("title", `Imported from \$\{from\}`\);\s+else titleEl\.removeAttribute\("title"\);/);
    assert.match(app, /titleEl\.textContent = title;\s+paintImportedFrom\(chat\);/);
    assert.match(app, /onChanged: \(\) => \{\s+paintImportedFrom\(chatOf\(state\.currentId\)\);/, "again when the list arrives");
  } finally {
    await shim.stop();
  }
});

// (fails before: yes — a command its agent printed nothing for stood in the middle of the chat as a turn nobody
// answered)
test("a command the agent printed nothing for is a finished turn of the chat, and what it prints by a later read is its answer", async () => {
  const h = homeOf("routes6");
  const cmd = (i, name) => said(S1, CWD_A, i, `<command-name>${name}</command-name>\n<command-message>${name.slice(1)}</command-message>\n<command-args></command-args>`);
  h.write(SLUG_A, S1, [...chat(S1, CWD_A, 1), cmd(4, "/cost"), ...chat(S1, CWD_A, 1, 6), cmd(9, "/exit")]);
  const shim = await startApp({ memory: true, overrides: { importHome: h.home } });
  try {
    shim.app.memory.importPrefs({ on: ["claude-code"] });
    await (await shim.app.memory.importSync()).done;
    const id = chainOf(shim.app.memory.archive, S1).id;
    const read = async () => transcriptTurns(await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json());
    const first = await read();
    assert.deepEqual(
      first.map((t) => [t.userText, t.status, t.open, t.command, t.commandText]),
      [["question 1 of 1111", "done", false, false, null], ["/cost", "done", false, true, ""], ["question 4 of 1111", "done", false, false, null], ["/exit", "done", false, true, ""]],
    );
    assert.equal(textOf(commandAnswer(first[1].commandText, null, {}, { h: fakeH, by: first[1].commandBy })), "Claude Code answered this — no model was called", "the line that says who answered, and no words under it");
    h.append(SLUG_A, S1, [said(S1, CWD_A, 10, "<local-command-stdout>Bye!</local-command-stdout>")]);
    await (await shim.app.memory.importSync()).done;
    const again = await read();
    assert.deepEqual(again.map((t) => t.commandText), [null, "", null, "Bye!"]);
  } finally {
    await shim.stop();
  }
});

// (fails before: yes — memory's reading took every unread session, those made in Filament among them, so the count the
// section said was not the work done; it could not be stopped; nothing said why memory could read none; and a
// session's row did not say it came from another agent)
test("memory reads the imported chats alone when the section asks, a chat at a time, stopped between two; a session's row names the agent it came from", async () => {
  const h = threeChats("routes4");
  const shim = await startApp({ memory: true, overrides: { importHome: h.home } });
  const memory = shim.app.memory;
  try {
    memory.importPrefs({ on: ["claude-code"] });
    await (await memory.importSync()).done;
    // A session made here, unread by memory as well.
    const mine = memory.archive.chainForKey("mine:1", { client: "harness" });
    const { turnId } = memory.archive.beginTurn(mine.id, { userMessage: { role: "user", content: "made here" } });
    memory.archive.finishTurn(turnId, { finalMessage: { role: "assistant", content: [{ type: "text", text: "ok" }] } });
    const imported = [S1, S2, S3].map((sid) => chainOf(memory.archive, sid).id);

    // The row of an imported chat names the agent, in the server's words; one made here names none.
    const listed = (await (await shim.api("/api/memory/sessions?limit=200&kind=interactive,fork")).json()).sessions;
    assert.deepEqual(imported.map((id) => listed.find((s) => s.id === id).importedFrom), ["Claude Code", "Claude Code", "Claude Code"]);
    assert.equal(listed.find((s) => s.id === mine.id).importedFrom, null);
    // (fails before: no — the plan's case 46, pinned here) An imported chat carries no mark: an old chat is not
    // unread, not pinned, not archived by the import.
    assert.deepEqual(imported.map((id) => { const s = listed.find((x) => x.id === id); return [s.pinned, s.unread, s.archived]; }), [[false, false, false], [false, false, false], [false, false, false]]);

    // Why memory can read none is said; with a learner and a model, nothing is.
    const model = memory.summarizerModel();
    assert.equal((await memory.importOverview()).learner.why === null, !!model);
    if (!model) assert.match((await memory.importOverview()).learner.why, /^(memory's model is off|no model can answer yet|no model to call)/);
    const learner = memory.learner;
    memory.learner = null;
    assert.equal((await memory.importOverview()).learner.why, "memory is switched off");
    assert.deepEqual(await memory.backfillLearning({ imported: true }), { learned: 0 }, "with no learner nothing is read");

    // The learner, stood in for: it reads a chat when told, and waits where the test holds it.
    /** @type {string[]} */
    const read = [];
    /** @type {(() => void) | null} */
    let release = null;
    let hold = false;
    const standIn = { learnChain: async (/** @type {string} */ id) => { read.push(id); if (hold) await new Promise((r) => (release = r)); return {}; } };
    memory.learner = standIn;
    const progress = [];
    assert.deepEqual(await memory.backfillLearning({ imported: true, onProgress: (p) => progress.push(p) }), { learned: 3, considered: 3, nothing: 0, unread: [] });
    assert.deepEqual([...read].sort(), [...imported].sort(), "the imported chats, and no session made here");
    assert.deepEqual(progress.map((p) => [p.step, p.done, p.total, p.percent]), [["learn", 0, 3, 0], ["learn", 1, 3, 33], ["learn", 2, 3, 67]]);
    assert.ok(progress.every((p) => !/Turn \d/.test(JSON.stringify(p))), "progress carries ids, never words");
    read.length = 0;
    assert.equal((await memory.backfillLearning({})).considered, 4, "asked for all, memory reads every unread session");
    assert.ok(read.includes(mine.id));
    assert.equal((await memory.backfillLearning({ imported: true, limit: 2 })).considered, 2, "a click reads a batch");

    // A chat left unread is said with why, in words, and counted as the reading goes; one with nothing in it to
    // read is neither read nor left.
    const answers = [{ skipped: "bad json" }, { error: "HTTP 529: overloaded" }, { skipped: "nothing new" }];
    memory.learner = { learnChain: async () => answers.shift() };
    /** @type {number[]} */
    const soFar = [];
    assert.deepEqual(await memory.backfillLearning({ imported: true, onProgress: (p) => soFar.push(p.unread) }), {
      learned: 0,
      considered: 3,
      nothing: 1,
      unread: [{ why: "the model did not answer in the form memory reads", chats: 1 }, { why: "HTTP 529: overloaded", chats: 1 }],
    });
    assert.deepEqual(soFar, [0, 1, 2]);
    memory.learner = standIn;

    // Over the route: the reading is a job the section finds again, and Stop ends it between two chats.
    read.length = 0;
    hold = true;
    const started = await json(await shim.api("/api/memory/backfill", { method: "POST", body: { imported: true } }));
    assert.equal(started.status, 200);
    assert.equal(started.body.job.kind, "learn-backfill");
    assert.equal(started.body.job.stoppable, true);
    await until(() => read.length === 1, "the first chat to be read");
    assert.deepEqual((await memory.importOverview()).reading, { id: started.body.job.id });
    const second = await json(await shim.api("/api/memory/backfill", { method: "POST", body: { imported: true } }));
    assert.equal(second.status, 400, "one reading at a time");
    assert.match(JSON.stringify(second.body), /memory is reading already/);
    assert.deepEqual((await json(await shim.api(`/api/memory/jobs/${started.body.job.id}/stop`, { method: "POST", body: {} }))).body, { stopped: true });
    hold = false;
    /** @type {any} */ (release)?.();
    const job = memory.job(started.body.job.id);
    await assert.rejects(job.done, (e) => e.aborted === true);
    assert.equal(job.status, "error");
    assert.equal(job.stopped, true, "a stop is the person's, not a failure");
    assert.equal(read.length, 1, "the chat in hand was read to its end, and no other was begun");
    assert.equal((await memory.importOverview()).reading, null);
    memory.learner = learner;
  } finally {
    await shim.stop();
  }
});

// (fails before: no — the plan's cases 4, 10 and 11, which had no test of their own)
test("a file that cannot be read is named with its cause and the rest come in; a file gone or cut short at the agent afterwards takes nothing away", async () => {
  const a = openArchive();
  const h = threeChats("unreadable");
  // The first file read is done; one of the two still to come is taken away before its turn.
  /** @type {string | null} */
  let gone = null;
  const first = await importClaudeCode({
    archive: a,
    root: h.root,
    onProgress: (p) => {
      if (gone || p.done !== 1) return;
      gone = [S1, S2, S3].map((s) => `${s}.jsonl`).filter((n) => n !== p.message)[0];
      rmSync(h.file(gone.startsWith(S3) ? SLUG_B : SLUG_A, gone.replace(".jsonl", "")));
    },
  });
  assert.ok(gone, "a file was taken away mid-run");
  assert.deepEqual(first.errors.map((e) => e.file), [gone], "named");
  assert.match(first.errors[0].error, /ENOENT|no such file/i, "with its cause");
  const kept = [S1, S2, S3].filter((s) => `${s}.jsonl` !== gone);
  assert.deepEqual([S1, S2, S3].map((s) => !!chainOf(a, s)), [S1, S2, S3].map((s) => kept.includes(s)), "the other two came in");

  // Gone at the agent after its import: the session stays, whole, and the next run has nothing to say of it.
  const stays = kept[0];
  const slugOf = (/** @type {string} */ s) => (s === S3 ? SLUG_B : SLUG_A);
  const turnsOf = (/** @type {string} */ s) => a.getTurns(chainOf(a, s).id).map((t) => [t.n, t.final_hash]);
  const before = turnsOf(stays);
  rmSync(h.file(slugOf(stays), stays));
  const second = await importClaudeCode({ archive: a, root: h.root });
  assert.deepEqual([second.errors, second.newTurns], [[], 0]);
  assert.deepEqual(turnsOf(stays), before, "the session stays as it was");

  // Cut short at the agent (its newest lines gone): nothing is taken away, and nothing is written twice.
  const cut = kept[1];
  const was = turnsOf(cut);
  assert.ok(was.length >= 1);
  const lines = readFileSync(h.file(slugOf(cut), cut), "utf8").split("\n").filter(Boolean);
  writeFileSync(h.file(slugOf(cut), cut), lines.slice(0, 1).join("\n") + "\n");
  const third = await importClaudeCode({ archive: a, root: h.root });
  assert.deepEqual([third.errors, third.newTurns], [[], 0]);
  assert.deepEqual(turnsOf(cut), was, "every turn it had is still there");
});

// (fails before: no — the plan's cases 18 and 44, which had no test of their own)
test("a picture inside a chat comes in as it is, and the tasks' search finds an imported chat by its words", async () => {
  const h = homeOf("pictures");
  const png = { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==" } };
  h.write(SLUG_A, S1, [
    said(S1, CWD_A, 0, [png, { type: "text", text: "What does this screenshot of the zebra crossing show?" }]),
    answered(S1, CWD_A, 1, words("A pedestrian crossing with seven stripes.")),
  ]);
  h.write(SLUG_A, S2, chat(S2, CWD_A, 1, 10));
  const shim = await startApp({ memory: true, overrides: { importHome: h.home } });
  try {
    shim.app.memory.importPrefs({ on: ["claude-code"] });
    await (await shim.app.memory.importSync()).done;
    const a = shim.app.memory.archive;
    const id = chainOf(a, S1).id;
    const [turn] = a.turnBodies(id);
    assert.deepEqual(turn.user.content, [png, { type: "text", text: "What does this screenshot of the zebra crossing show?" }], "the picture is kept as it is, before the words");
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript?work=held`)).json();
    assert.deepEqual(tr.turns[0].user.content[0], png, "and the page is given it with the turn");
    // The tasks' search (the sidebar's): by a word of the person's, and by a word of the answer.
    const found = async (/** @type {string} */ q) => (await (await shim.api(`/api/memory/sessions?limit=50&q=${encodeURIComponent(q)}`)).json()).sessions.map((s) => s.id);
    assert.deepEqual(await found("zebra"), [id]);
    assert.deepEqual(await found("pedestrian stripes"), [id]);
    assert.deepEqual(await found("xylophone"), []);
  } finally {
    await shim.stop();
  }
});

// (fails before: yes — the transcript carried every turn's work whole: a chat of a coding agent's long turns was an
// answer of hundreds of megabytes, or none at all ("Invalid string length"), and a turn's cards stood in one box ahead
// of all its words)
test("a long chat opens: the transcript holds each turn's work back and says how it counts, the work is read a stretch at a time with no call cut from what it returned, and each call stands after the words that led to it", async () => {
  const h = homeOf("long1");
  const CALLS = 400;
  const big = "x".repeat(10_000);
  const lines = [said(S1, CWD_A, 0, "do the long thing")];
  for (let k = 0; k < CALLS; k++) {
    // every fourth reply says words before its call
    lines.push(answered(S1, CWD_A, 1 + k * 2, [...(k % 4 === 0 ? words(`step ${k}`) : []), { type: "tool_use", id: `c${k}`, name: "Write", input: { file_path: `f${k}.txt`, content: k === 1 ? big : "small" } }]));
    lines.push(said(S1, CWD_A, 2 + k * 2, [{ type: "tool_result", tool_use_id: `c${k}`, content: `wrote f${k}.txt` }]));
  }
  lines.push(answered(S1, CWD_A, 1 + CALLS * 2, words("All done.")), ...chat(S1, CWD_A, 1, 1000));
  h.write(SLUG_A, S1, lines);
  const shim = await startApp({ memory: true, overrides: { importHome: h.home } });
  try {
    shim.app.memory.importPrefs({ on: ["claude-code"] });
    await (await shim.app.memory.importSync()).done;
    const sid = encodeURIComponent(chainOf(shim.app.memory.archive, S1).id);
    const get = async (/** @type {string} */ path) => (await shim.api(path)).json();
    const WORK = CALLS * 2;

    // The transcript as the page asks for it: no work, no cards; how much work each turn has, and how it counts.
    const held = await get(`/api/sessions/${sid}/transcript?work=held`);
    assert.deepEqual(held.turns.map((t) => ["work" in t, "tools" in t, t.workCount, t.tally]), [[false, false, WORK, { legs: CALLS, calls: CALLS }], [false, false, 0, null]]);
    const whole = await get(`/api/sessions/${sid}/transcript`);
    assert.deepEqual(whole.turns.map((t) => [t.work.length, t.tools.length, "workCount" in t]), [[WORK, CALLS, false], [0, 0, false]], "asked for whole, it is whole");
    const sizes = [JSON.stringify(held.turns).length, JSON.stringify(whole.turns).length];
    assert.ok(sizes[0] < 3000 && sizes[1] > 150_000, `the turns held back are ${sizes[0]} characters, whole ${sizes[1]}`);
    const bare = await get(`/api/sessions/${sid}/transcript?work=0`);
    assert.deepEqual(bare.turns.map((t) => ["work" in t, t.workCount, "tally" in t]), [[false, WORK, false], [false, 0, false]]);

    // One stretch: 300 messages, each of the model's with its call and what the call returned.
    const first = await get(`/api/sessions/${sid}/turns/1/work`);
    assert.deepEqual([first.n, first.total, first.from, first.next, first.work.length], [1, WORK, 0, 300, 150]);
    assert.deepEqual(first.work[0].content, [{ type: "text", text: "step 0" }, { type: "tool_use" }]);
    assert.deepEqual(first.work[0].tools.map((c) => [c.id, c.name, c.input, c.result, c.isError]), [["c0", "Write", { file_path: "f0.txt", content: "small" }, "wrote f0.txt", false]]);
    assert.deepEqual(first.work[1].content, [{ type: "tool_use" }]);
    assert.equal(first.work[1].tools[0].input.content, `${"x".repeat(4000)}\n… (10,000 characters in all: the first 4,000 are shown)`, "a file written whole rides as its head");
    assert.ok(JSON.stringify(first).length < 120_000, `a stretch is ${JSON.stringify(first).length} characters`);
    // A stretch that would end on a call goes on to what the call returned; the next begins at the next reply.
    const mid = await get(`/api/sessions/${sid}/turns/1/work?from=1`);
    assert.deepEqual([mid.from, mid.next, mid.work.length, mid.work.at(-1).tools.map((c) => [c.id, c.result])], [1, 302, 150, [["c150", "wrote f150.txt"]]]);
    const last = await get(`/api/sessions/${sid}/turns/1/work?from=600`);
    assert.deepEqual([last.from, last.next, last.work.length], [600, null, 100]);
    assert.deepEqual(await get(`/api/sessions/${sid}/turns/1/work?from=${WORK}`), { n: 1, total: WORK, from: WORK, next: null, work: [] });
    assert.deepEqual(await get(`/api/sessions/${sid}/turns/2/work`), { n: 2, total: 0, from: 0, next: null, work: [] }, "a turn that did no work");
    for (const path of [`/api/sessions/${sid}/turns/9/work`, `/api/sessions/${sid}/turns/x/work`, `/api/sessions/nope/turns/1/work`]) assert.equal((await shim.api(path)).status, 404, path);

    // The page: the answer at once, headed by the counts; then the work in the order it happened.
    const [before] = transcriptTurns(held);
    assert.deepEqual([before.blocks.map((b) => b.text), before.toolLegs, before.toolCalls, before.held.total], [["All done."], CALLS, CALLS, WORK]);
    const [long, short] = await pageTurns((path) => shim.api(path), decodeURIComponent(sid));
    assert.deepEqual([long.held.next, long.toolLegs, long.toolCalls, short.held, short.blocks.map((b) => b.text)], [null, CALLS, CALLS, null, ["answer 501"]]);
    const order = long.held.parts.map((p) => (p.block ? p.block.text : p.tools.map((c) => c.id).join(",")));
    assert.deepEqual([order.length, order.slice(0, 4), order.slice(-2)], [200, ["step 0", "c0,c1,c2,c3", "step 4", "c4,c5,c6,c7"], ["step 396", "c396,c397,c398,c399"]]);
    assert.ok(order.every((o, i) => (i % 2 ? o.split(",").length === 4 : o === `step ${i * 2}`)), "each box holds the four calls its words led to, the one cut by a stretch's end too");
    assert.deepEqual(long.blocks.map((b) => b.text).slice(-2), ["step 396", "All done."]);
  } finally {
    await shim.stop();
  }
});
