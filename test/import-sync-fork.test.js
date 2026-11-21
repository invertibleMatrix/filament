// An imported chat is the harness's, and Sync never writes into a chat the person went on with here
// (HarnessV4_Import_Plan, step 6: IM-58 to IM-62, cases 113 to 134). The writer is driven as an importer drives it —
// a chat, its turns, its compactions, its close — on a made-up archive; then once through Claude Code's importer, on
// a made-up file that grows. Everything is made up, in a temp folder.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive } from "../src/archive.js";
import { Sink, importClaudeCode, chatStates, claudeCodeSource } from "../src/memory-import.js";

const dir = mkdtempSync(join(tmpdir(), "filament-import-sync-"));
let seq = 0;
/** @type {Archive[]} */
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

const T0 = Date.parse("2026-10-01T09:00:00Z");
const MIN = 60_000;
const CWD = join(dir, "proj");
mkdirSync(CWD, { recursive: true });
const KEY = "cu:chat-1";

/** A turn as an importer hands it to the writer; `answer` undefined: no answer yet. @param {string} words @param {string | undefined} answer @param {number} i */
const turn = (words, answer, i) => ({
  user: { role: "user", content: words },
  work: [],
  ...(answer === undefined ? {} : { final: { role: "assistant", content: [{ type: "text", text: answer }] } }),
  at: T0 + i * MIN,
  workAt: T0 + i * MIN,
  endAt: T0 + i * MIN + 1000,
  model: "glm-5",
  meta: { format: "anthropic" },
});
/** The agent's copy of the chat: its turns in order, each answered unless named in `open`. @param {number} n @param {number[]} [open] */
const agentCopy = (n, open = []) => Array.from({ length: n }, (_, k) => turn(`agent ${k + 1}`, open.includes(k + 1) ? undefined : `answer ${k + 1}`, k + 1));

/**
 * One read of the chat, as an importer makes it: the chat, its turns, the agent's compactions (each `{ toTurn, text }`,
 * a place in the agent's turns), its close with its title and mark.
 * @param {Archive} a @param {any[]} turns @param {{ key?: string, title?: string, compactions?: { toTurn: number, text: string }[], mark?: number, after?: number }} [o]
 */
function read(a, turns, { key = KEY, title = "Fix the parser", compactions = [], mark = turns.length, after = 0 } = {}) {
  const sink = new Sink(a, { agent: "Cursor" });
  const chain = sink.chain(key, { cwd: CWD, title, meta: { import: "cursor", sessionId: key.slice(3) }, startedAt: T0 });
  const w = sink.writer(chain, { after });
  for (const t of turns) w.put(t);
  const ns = w.end();
  for (const c of compactions) sink.compaction(chain, { fromTurn: 1, toTurn: ns[c.toTurn - 1], text: c.text, kind: "plain", method: "own", detail: { by: "Cursor" } });
  sink.close(chain, { at: T0 + turns.length * MIN, title, mark });
  return { sink, chain, ns, stats: sink.stats };
}
/** The person goes on with a chat in the harness: a turn of theirs, answered. @param {Archive} a @param {any} chain @param {string} words */
function goOn(a, chain, words) {
  const r = a.beginTurn(chain.id, { client: "harness", window: "harness", userMessage: { role: "user", content: words } });
  a.finishTurn(r.turnId, { finalMessage: { role: "assistant", content: [{ type: "text", text: `ok: ${words}` }] } });
}
/** @param {Archive} a @param {string} hash */
const said = (a, hash) => {
  const m = a.getMessage(hash).message;
  return typeof m.content === "string" ? m.content : m.content.map((/** @type {any} */ b) => b.text ?? "").join("");
};
/** A chat's turns as the words that opened them. @param {Archive} a @param {any} c */
const wordsOf = (a, c) => a.getTurns(c.id).map((t) => said(a, t.user_hash));
/** @param {Archive} a @param {string} key */
const byKey = (a, key) => a.chainsWithKeyPrefix(key).find((c) => c.key === key) || null;
/** Every chat whose key starts with the chat's: the chat and its forks. @param {Archive} a */
const family = (a, key = KEY) => a.chainsWithKeyPrefix(key).map((c) => c.key).sort();

test("a chat an import makes is the harness's own: its client, its native mark, its turns, and how far the agent's copy reaches (IM-58)", () => {
  const a = openArchive();
  read(a, agentCopy(2));
  const c = byKey(a, KEY);
  assert.deepEqual([c.client, c.meta.native, c.meta.import, c.meta.importedThrough], ["harness", true, "cursor", 2]);
  assert.deepEqual(a.getTurns(c.id).map((t) => t.meta.client), ["harness", "harness"], "every turn the harness's: no \"from Cursor\" under it");
  assert.deepEqual(a.windowsOf(c.id), { harness: { client: "harness" } }, "one window, the harness's: never \"shared\" by its import");
});

test("Sync on a chat nobody went on with here: the agent's new turns join it, as before (case 122)", () => {
  const a = openArchive();
  read(a, agentCopy(2));
  const r = read(a, agentCopy(3));
  const c = byKey(a, KEY);
  assert.deepEqual(wordsOf(a, c), ["agent 1", "agent 2", "agent 3"]);
  assert.deepEqual([c.meta.importedThrough, r.stats.newChains, r.stats.newTurns], [3, 0, 1]);
  assert.deepEqual(family(a), [KEY], "no fork");
});

test("a chat the person went on with, read again with nothing new: nothing written, no fork (cases 123, 127)", () => {
  const a = openArchive();
  read(a, agentCopy(2));
  const c = byKey(a, KEY);
  goOn(a, c, "mine 1");
  a.setTitle(c.id, "My own name for it");
  const r = read(a, agentCopy(2), { title: "The agent's new name" });
  assert.deepEqual(wordsOf(a, c), ["agent 1", "agent 2", "mine 1"]);
  assert.deepEqual(r.ns, [1, 2], "the turns it has, by their numbers");
  assert.deepEqual([r.stats.newChains, r.stats.newTurns, r.stats.messages], [0, 0, 0]);
  assert.deepEqual(family(a), [KEY]);
  assert.equal(byKey(a, KEY).title, "My own name for it", "the person's chat keeps its name");
});

test("a chat the person went on with keeps its last activity through every Sync; one nobody went on with takes the agent's (the sidebar's order)", () => {
  const a = openArchive();
  read(a, agentCopy(2));
  assert.equal(byKey(a, KEY).last_at, T0 + 2 * MIN, "an imported chat: the agent's last activity");
  const later = T0 + 600 * MIN;
  const was = a.now;
  a.now = () => later;
  goOn(a, byKey(a, KEY), "mine 1");
  a.now = was;
  read(a, agentCopy(2));
  assert.equal(byKey(a, KEY).last_at, later, "nothing new: the person's time stays, not the agent's start");
  read(a, agentCopy(3));
  assert.equal(byKey(a, KEY).last_at, later, "the agent's copy grown: its turns go to the fork, the chat keeps the person's time");
  assert.equal(byKey(a, `${KEY}~2`).last_at, T0 + 3 * MIN, "the fork: the agent's last activity");
  const b = openArchive();
  read(b, agentCopy(2));
  read(b, agentCopy(3));
  assert.equal(byKey(b, KEY).last_at, T0 + 3 * MIN, "a chat nobody went on with: brought up to the agent's");
});

test("Sync on a chat the person went on with, the agent's copy grown: a fork of the turns both have, then the agent's; the chat untouched (cases 124, 129, 130, 132)", async () => {
  const a = openArchive();
  read(a, agentCopy(2));
  const c = byKey(a, KEY);
  goOn(a, c, "mine 1");
  const before = a.getTurns(c.id).map((t) => [t.id, t.user_hash, t.final_hash, t.meta_json]);
  const r = read(a, agentCopy(3), { title: "Fix the parser, renamed", compactions: [{ toTurn: 3, text: "Cursor's summary of turns 1 to 3" }], mark: 99 });
  // the chat: as it was, whole
  const chat = byKey(a, KEY);
  assert.deepEqual(a.getTurns(chat.id).map((t) => [t.id, t.user_hash, t.final_hash, t.meta_json]), before, "not a byte of its turns");
  assert.deepEqual(a.getCompactions(chat.id), [], "no compaction: the agent's is the fork's");
  assert.equal(chat.title, "Fix the parser", "its name, not the agent's new one");
  assert.equal(chat.meta.mark, 99, "Import's list reads the chat as read now");
  assert.deepEqual(chat.meta.syncForks, [`${KEY}~2`]);
  // the fork
  const fork = byKey(a, `${KEY}~2`);
  assert.deepEqual([fork.kind, fork.client, fork.meta.native, fork.meta.import, fork.meta.syncOf, fork.meta.importedThrough], ["fork", "harness", true, "cursor", { chat: chat.id, at: 2 }, 3]);
  assert.equal(fork.title, "Fix the parser, renamed (went on in Cursor)", "named for what it is, with the agent's name for the chat");
  assert.deepEqual(wordsOf(a, fork), ["agent 1", "agent 2", "agent 3"]);
  assert.deepEqual(a.getTurns(fork.id).slice(0, 2).map((t) => t.user_hash), a.getTurns(chat.id).slice(0, 2).map((t) => t.user_hash), "the same messages, none copied");
  assert.deepEqual(a.getCompactions(fork.id).map((x) => [x.from_turn, x.to_turn, x.method]), [[1, 3, "own"]]);
  assert.deepEqual(r.ns, [1, 2, 3]);
  assert.deepEqual([r.stats.newChains, r.stats.newTurns], [1, 1]);
  // Import's list: the chat was read as big as the agent's copy is now
  const states = await chatStates({ prefix: "cu:", chats: () => [{ id: "chat-1", key: KEY, mark: 99 }] }, { archive: a, where: "" });
  assert.deepEqual(states.map((s) => [s.state, s.chain]), [["imported", chat.id]]);
});

test("later Syncs write into the same fork; a fork the person went on with gets a fork of its own (cases 125, 126)", () => {
  const a = openArchive();
  read(a, agentCopy(2));
  goOn(a, byKey(a, KEY), "mine 1");
  read(a, agentCopy(3));
  const r = read(a, agentCopy(4));
  const fork = byKey(a, `${KEY}~2`);
  assert.deepEqual(wordsOf(a, fork), ["agent 1", "agent 2", "agent 3", "agent 4"]);
  assert.deepEqual([fork.meta.importedThrough, r.stats.newChains, r.stats.newTurns], [4, 0, 1]);
  assert.deepEqual(family(a), [KEY, `${KEY}~2`]);
  goOn(a, fork, "mine in the fork");
  read(a, agentCopy(5));
  const forkOfFork = byKey(a, `${KEY}~2~4`);
  assert.deepEqual(wordsOf(a, forkOfFork), ["agent 1", "agent 2", "agent 3", "agent 4", "agent 5"]);
  assert.deepEqual(wordsOf(a, byKey(a, `${KEY}~2`)), ["agent 1", "agent 2", "agent 3", "agent 4", "mine in the fork"], "the fork the person went on with, untouched");
  assert.deepEqual(wordsOf(a, byKey(a, KEY)), ["agent 1", "agent 2", "mine 1"]);
  assert.equal(forkOfFork.title, "Fix the parser (went on in Cursor)", "one \"(went on in Cursor)\", not two");
});

test("a fork the person deleted is not made again; the chat stays untouched (case 131)", () => {
  const a = openArchive();
  read(a, agentCopy(2));
  goOn(a, byKey(a, KEY), "mine 1");
  read(a, agentCopy(3));
  a.deleteChain(byKey(a, `${KEY}~2`).id);
  const r = read(a, agentCopy(4), { compactions: [{ toTurn: 4, text: "a later summary" }] });
  assert.deepEqual(family(a), [KEY]);
  assert.deepEqual(wordsOf(a, byKey(a, KEY)), ["agent 1", "agent 2", "mine 1"]);
  assert.deepEqual(a.getCompactions(byKey(a, KEY).id), []);
  assert.deepEqual([r.stats.newChains, r.stats.newTurns], [0, 0]);
});

test("the last turn both have had no answer when it came in, and the agent answered it later: the fork starts before it and has it answered (case 128)", () => {
  const a = openArchive();
  read(a, agentCopy(2, [2]));
  const c = byKey(a, KEY);
  assert.deepEqual(a.getTurns(c.id).map((t) => t.ended_at != null), [true, false], "turn 2 came in with no answer");
  goOn(a, c, "mine 1");
  read(a, agentCopy(3));
  assert.deepEqual(a.getTurns(c.id).map((t) => t.ended_at != null), [true, false, true], "the person's chat keeps turn 2 as it was");
  const fork = byKey(a, `${KEY}~1`);
  assert.deepEqual(wordsOf(a, fork), ["agent 1", "agent 2", "agent 3"]);
  assert.deepEqual(a.getTurns(fork.id).map((t) => (t.final_hash ? said(a, t.final_hash) : null)), ["answer 1", "answer 2", "answer 3"]);
});

test("a chat imported before this step that the person went on with: the turns tell, and the agent's go to a fork, never after the person's (case 134, IM-62)", () => {
  const a = openArchive();
  // As an earlier import wrote it: the agent named as the client, no native mark, no importedThrough.
  const old = a.chainForKey(KEY, { cwd: CWD, client: "cursor", meta: { import: "cursor", sessionId: "chat-1" } });
  for (const t of agentCopy(2)) {
    const r = a.beginTurn(old.id, { client: "cursor", userMessage: t.user, model: "glm-5" });
    a.finishTurn(r.turnId, { finalMessage: t.final });
  }
  goOn(a, old, "mine 1");
  read(a, agentCopy(3));
  assert.deepEqual(wordsOf(a, byKey(a, KEY)), ["agent 1", "agent 2", "mine 1"], "nothing written after the person's turn");
  const fork = byKey(a, `${KEY}~2`);
  assert.deepEqual(wordsOf(a, fork), ["agent 1", "agent 2", "agent 3"]);
  assert.deepEqual([fork.client, fork.meta.native ?? null], ["cursor", null], "a fork is what its chat is: an earlier import's");
  assert.deepEqual(a.getTurns(fork.id).map((t) => t.meta.client), ["cursor", "cursor", "cursor"]);
  // one nobody went on with grows as before, and from then on keeps how far the agent's copy reaches
  const b = openArchive();
  const old2 = b.chainForKey(KEY, { cwd: CWD, client: "cursor", meta: { import: "cursor" } });
  for (const t of agentCopy(2)) b.finishTurn(b.beginTurn(old2.id, { client: "cursor", userMessage: t.user }).turnId, { finalMessage: t.final });
  read(b, agentCopy(3));
  assert.deepEqual([wordsOf(b, byKey(b, KEY)), byKey(b, KEY).meta.importedThrough, family(b)], [["agent 1", "agent 2", "agent 3"], 3, [KEY]]);
});

test("an agent's own fork chat the person went on with: its Sync fork starts after the turns it took (case 133)", () => {
  const a = openArchive();
  const SRC = "cx:source";
  read(a, agentCopy(2), { key: SRC });
  const sink = new Sink(a, { agent: "Codex" });
  const FK = "cx:the-fork";
  assert.equal(sink.fork(FK, byKey(a, SRC), 2, { meta: { import: "codex" } }), true);
  const own = [turn("fork 1", "fork answer 1", 10)];
  read(a, own, { key: FK, after: 2 });
  const f = byKey(a, FK);
  assert.deepEqual([wordsOf(a, f), f.meta.native, f.meta.importedThrough], [["agent 1", "agent 2", "fork 1"], true, 3]);
  goOn(a, f, "mine in the agent's fork");
  read(a, [...own, turn("fork 2", "fork answer 2", 11)], { key: FK, after: 2 });
  assert.deepEqual(wordsOf(a, byKey(a, `${FK}~3`)), ["agent 1", "agent 2", "fork 1", "fork 2"]);
  assert.deepEqual(wordsOf(a, byKey(a, FK)), ["agent 1", "agent 2", "fork 1", "mine in the agent's fork"]);
  // the next Sync finds that fork again and lines its turns up after the ones it took: nothing twice
  read(a, [...own, turn("fork 2", "fork answer 2", 11), turn("fork 3", "fork answer 3", 12)], { key: FK, after: 2 });
  assert.deepEqual(wordsOf(a, byKey(a, `${FK}~3`)), ["agent 1", "agent 2", "fork 1", "fork 2", "fork 3"]);
});

test("a dry run counts as before and writes nothing", () => {
  const a = openArchive();
  const sink = new Sink(a, { dryRun: true, agent: "Cursor" });
  const chain = sink.chain(KEY, { cwd: CWD });
  const w = sink.writer(chain);
  for (const t of agentCopy(3)) w.put(t);
  assert.deepEqual(w.end(), [1, 2, 3]);
  assert.deepEqual([sink.stats.newTurns, family(a)], [3, []]);
});

// Claude Code's importer end to end: a chat imported, gone on with here, then its file grows.
test("Claude Code: a chat gone on with here and grown in Claude Code comes in as a fork; the chat is untouched", async () => {
  const a = openArchive();
  const root = join(dir, "cc");
  const slug = join(root, "H--proj");
  mkdirSync(slug, { recursive: true });
  const SID = "cccccccc-0000-4000-8000-000000000001";
  const file = join(slug, `${SID}.jsonl`);
  let n = 0;
  const line = (/** @type {number} */ i, /** @type {any} */ o) => JSON.stringify({ parentUuid: null, isSidechain: false, userType: "external", cwd: CWD, sessionId: SID, version: "2.1.0", uuid: `u-${++n}`, timestamp: new Date(T0 + i * MIN).toISOString(), ...o }) + "\n";
  const ask = (/** @type {number} */ i, /** @type {string} */ words) => line(i, { type: "user", message: { role: "user", content: words } });
  const answer = (/** @type {number} */ i, /** @type {string} */ words) => line(i, { type: "assistant", requestId: `r${i}`, message: { id: `m${i}`, type: "message", role: "assistant", model: "claude-opus-4-1", content: [{ type: "text", text: words }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } } });
  writeFileSync(file, ask(1, "one") + answer(2, "first") + ask(3, "two") + answer(4, "second") + line(4, { type: "custom-title", customTitle: "Survey" }));
  await importClaudeCode({ archive: a, root });
  const chat = byKey(a, `cc:${SID}`);
  assert.deepEqual([chat.client, chat.meta.native, chat.meta.importedThrough], ["harness", true, 2]);
  goOn(a, chat, "mine");
  appendFileSync(file, ask(5, "three") + answer(6, "third"));
  const where = join(root);
  assert.deepEqual((await chatStates(claudeCodeSource, { archive: a, where })).map((s) => s.state), ["grown"]);
  const r = await importClaudeCode({ archive: a, root });
  assert.deepEqual([r.newChains, r.newTurns], [1, 1]);
  assert.deepEqual(wordsOf(a, byKey(a, `cc:${SID}`)), ["one", "two", "mine"]);
  const fork = byKey(a, `cc:${SID}~2`);
  assert.deepEqual([wordsOf(a, fork), fork.title, fork.kind], [["one", "two", "three"], "Survey (went on in Claude Code)", "fork"]);
  assert.deepEqual((await chatStates(claudeCodeSource, { archive: a, where })).map((s) => s.state), ["imported"], "read: Import's list says so");
  assert.equal(byKey(a, `cc:${SID}`).meta.mark, statSync(file).size);
});
