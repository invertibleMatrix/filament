import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Archive, textOfMessage, messageKind, ftsExpression, SCHEMA_VERSION } from "../src/archive.js";

const dir = mkdtempSync(join(tmpdir(), "filament-archive-")); let seq = 0; const opened = [];
// A ticking clock makes ordering deterministic; every archive is closed before the temp dir goes (Windows holds open files).
let clock = 1_757_900_000_000; const now = () => (clock += 1000);
const open = (opts = {}) => { const a = new Archive({ file: opts.file || join(dir, `a${++seq}.db`), now, ...opts }); opened.push(a); return a; };
after(() => { for (const a of opened) a.close(); rmSync(dir, { recursive: true, force: true }); });

const user = (text) => ({ role: "user", content: [{ type: "text", text }] });
const final = (text) => ({ role: "assistant", content: [{ type: "text", text }] });
const call = (id, cmd) => ({ role: "assistant", content: [{ type: "text", text: "Let me look." }, { type: "tool_use", id, name: "bash", input: { cmd } }] });
const result = (id, out) => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content: out }] });
// A finished turn: user message, one tool-loop leg, final answer. Returns the turn id.
function turn(a, chainId, text, answer, { work = true, req = `r${++seq}` } = {}) {
  const { turnId } = a.beginTurn(chainId, { requestId: req, model: "m", upstream: "u", userMessage: user(text) });
  if (work) { a.addWork(turnId, [call("t" + turnId, "ls " + text.slice(0, 5)), result("t" + turnId, "out " + text.slice(0, 5))]); a.beginTurn(chainId, { requestId: req + "b", userMessage: user(text) }); }
  a.finishTurn(turnId, { finalMessage: final(answer), requestId: req + "c" });
  return turnId;
}

test("schema is created once, survives reopen, and records its version", () => {
  const file = join(dir, "schema.db"); const a = new Archive({ file, now }); a.close();
  const b = open({ file }); assert.equal(b.schemaMetaGet("version"), SCHEMA_VERSION);
  const tables = b.db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index') ORDER BY name").all().map((r) => r.name);
  for (const t of ["projects", "chains", "turns", "messages", "compactions", "links", "items", "injections", "injection_ids", "blocks", "trim_slices", "fts_text", "schema_meta", "fts_tri", "chains_project", "turns_chain", "items_project", "injections_request"]) assert.ok(tables.includes(t), t);
  assert.equal(b.db.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
  assert.deepEqual(b.counts(), { projects: 0, chains: 0, turns: 0, messages: 0, bytes: 0, items: 0, compactions: 0, trimSlices: 0, injections: 0 });
  assert.throws(() => new Archive({ file, key: randomBytes(31) }), /32-byte/);
});

test("chainForKey creates project and chain on first sight and refreshes them later", () => {
  const a = open();
  const c1 = a.chainForKey("k1", { cwd: "C:\\src\\filament", client: "claude-code", model: "opus" });
  assert.ok(c1.isNew); assert.match(c1.id, /^[0-9a-z]{8}$/); assert.equal(c1.project_id.length, 12); assert.equal(c1.turns, 0); assert.equal(c1.state, null);
  assert.equal(a.getProject(c1.project_id).name, "filament");
  const again = a.chainForKey("k1", { cwd: "C:\\src\\filament", model: "sonnet" });
  assert.equal(again.id, c1.id); assert.equal(again.isNew, false); assert.equal(again.model, "sonnet"); assert.equal(again.client, "claude-code"); assert.ok(again.last_at > c1.last_at);
  const c2 = a.chainForKey("k2", { cwd: "C:\\src\\filament" }); const c3 = a.chainForKey("k3", {});
  assert.equal(c2.project_id, c1.project_id); assert.equal(c3.project_id, "none"); assert.equal(a.counts().projects, 2);
  assert.equal(a.chainForKey("k4", { project: "explicit", cwd: "/x" }).project_id, "explicit");
  // state, title, briefing, blocks round-trip; blocks live in their own uncapped table (message hash → text, nth)
  a.setState(c1.id, { status: "open", summary: "s", open: ["a"], done: [], next: [] }); a.setTitle(c1.id, "Title"); a.setBriefing(c1.id, "brief"); a.setBlock(c1.id, "h1", "block");
  const g = a.getChain(c1.id); assert.equal(g.state.status, "open"); assert.ok(g.state.updatedAt); assert.equal(g.title, "Title"); assert.equal(g.briefing, "brief");
  assert.deepEqual(a.blocksFor(c1.id), { h1: { text: "block", nth: 1, kind: "turn" } });
  a.setBlock(c1.id, "h2", "second", 3, "rule"); assert.deepEqual(a.blocksFor(c1.id).h2, { text: "second", nth: 3, kind: "rule" }, "setBlock keeps the occurrence and kind a block was created for");
  a.chainForKey("k2", {}); // touch k2 → newest
  assert.deepEqual(a.chainsForProject(c1.project_id).map((c) => c.id), [c2.id, c1.id]);
  assert.deepEqual(a.recentChains({ limit: 2 }).map((c) => c.id), [c2.id, a.getChain(a.chainForKey("k4", {}).id).id]);
  assert.equal(a.chainsForProject(c1.project_id)[1].state.summary, "s");
  assert.equal(a.getChain("nope"), null);
});

test("tool-loop legs join the open turn; work keeps order without duplicates; messages dedupe across turns and chains", () => {
  const a = open(); const c = a.chainForKey("k", { cwd: "/p" });
  const t1 = a.beginTurn(c.id, { requestId: "r1", model: "m", upstream: "u", userMessage: user("fix the bug") });
  assert.deepEqual([t1.n, t1.isNew], [1, true]);
  a.addWork(t1.turnId, [call("a", "ls"), result("a", "files")]);
  const leg = a.beginTurn(c.id, { requestId: "r2", userMessage: user("fix the bug") });
  assert.deepEqual(leg, { turnId: t1.turnId, n: 1, isNew: false });
  a.addWork(t1.turnId, [call("a", "ls"), result("a", "files"), call("b", "cat"), result("b", "body")]); // replayed leg + new work
  const tr = a.getTurn(t1.turnId); assert.deepEqual(tr.requestIds, ["r1", "r2"]); assert.equal(tr.work.length, 4); assert.equal(tr.model, "m");
  assert.deepEqual(tr.work.map((h) => a.getMessage(h).kind), ["tool_use", "tool_result", "tool_use", "tool_result"]);
  assert.equal(a.getMessage(tr.work[3]).message.content[0].content, "body");
  const f = a.finishTurn(t1.turnId, { finalMessage: final("done"), requestId: "r3", outputChars: 4 });
  const done = a.getTurn(t1.turnId); assert.equal(done.final_hash, f.hash); assert.ok(done.ended_at); assert.equal(done.output_chars, 4); assert.deepEqual(done.requestIds, ["r1", "r2", "r3"]); assert.equal(done.input_chars, 11);
  assert.equal(a.getChain(c.id).turns, 1);
  // the same text after the turn closed is a new turn, not a leg
  const t2 = a.beginTurn(c.id, { requestId: "r4", userMessage: user("fix the bug") }); assert.deepEqual([t2.n, t2.isNew], [2, true]);
  const before = a.counts().messages;
  const t3 = a.beginTurn(c.id, { requestId: "r5", userMessage: user("next thing") }); assert.equal(t3.n, 3);
  a.addWork(t3.turnId, [call("a", "ls"), result("a", "files")]); // identical bodies as turn 1 → no new rows
  const other = a.chainForKey("k2", { cwd: "/q" }); a.beginTurn(other.id, { requestId: "r6", userMessage: user("fix the bug") });
  assert.equal(a.counts().messages, before + 1, "only 'next thing' was new");
  assert.deepEqual(a.getTurns(c.id).map((t) => t.n), [1, 2, 3]); assert.deepEqual(a.getTurns(c.id, { from: 2, to: 2 }).map((t) => t.n), [2]);
  assert.throws(() => a.addWork(999, []), /no turn/);
  const p = a.putMessage("user", user("fix the bug")); assert.equal(p.isNew, false); assert.equal(p.kind, "text"); assert.equal(p.hash, done.user_hash);
});

test("textOfMessage and messageKind understand both wire formats", () => {
  assert.equal(textOfMessage("plain"), "plain"); assert.equal(textOfMessage({ role: "user", content: "hi" }), "hi");
  assert.equal(textOfMessage(user("a")), "a"); assert.equal(textOfMessage(result("t", "out")), "out");
  assert.equal(textOfMessage({ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: [{ type: "text", text: "x" }, { type: "image", source: {} }] }, { type: "text", text: "y" }] }), "x\ny");
  assert.equal(textOfMessage({ role: "user", content: [{ type: "image", source: { data: "…" } }] }), "");
  assert.equal(textOfMessage({ role: "assistant", content: [{ type: "thinking", thinking: "secret" }, { type: "text", text: "shown" }] }), "shown");
  assert.equal(textOfMessage({ role: "tool", content: "sunny" }), "sunny"); assert.equal(textOfMessage({ type: "function_call_output", output: "42" }), "42");
  assert.equal(textOfMessage(null), ""); assert.equal(textOfMessage({ _filament_truncated: true, bytes: 9, head: "{" }), "");
  assert.equal(messageKind(user("a")), "text"); assert.equal(messageKind(call("t", "ls")), "tool_use"); assert.equal(messageKind(result("t", "o")), "tool_result");
  assert.equal(messageKind({ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "o" }, { type: "text", text: "and also" }] }), "text", "a user message with text is text");
  assert.equal(messageKind({ role: "assistant", content: [{ type: "thinking", thinking: "…" }] }), "thinking");
  assert.equal(messageKind({ role: "assistant", content: [{ type: "thinking", thinking: "…" }, { type: "text", text: "ok" }] }), "text");
  assert.equal(messageKind({ role: "user", content: [{ type: "image", source: {} }] }), "image");
  assert.equal(messageKind({ role: "assistant", content: null, tool_calls: [{ function: { name: "f" } }] }), "tool_use");
  assert.equal(messageKind({ role: "tool", content: "sunny" }), "tool_result"); assert.equal(messageKind({ role: "user", content: "q" }), "text");
  assert.equal(messageKind({ type: "function_call", name: "f" }), "tool_use"); assert.equal(messageKind({ type: "reasoning", summary: [] }), "thinking");
  assert.equal(messageKind({ role: "assistant", content: "" }), "other"); assert.equal(messageKind(42), "other");
});

test("oversize messages are stored truncated with a marker, once", () => {
  const a = open({ caps: { messageBytes: 200, inputChars: 4000 } });
  const big = user("x".repeat(1000)); const p = a.putMessage("user", big);
  assert.ok(p.truncated); assert.equal(p.bytes, JSON.stringify(big).length); assert.equal(p.kind, "text");
  const m = a.getMessage(p.hash); assert.ok(m.truncated); assert.equal(m.message._filament_truncated, true); assert.equal(m.message.bytes, p.bytes);
  assert.equal(m.message.head, JSON.stringify(big).slice(0, 200)); assert.equal(m.bytes, p.bytes);
  assert.equal(a.putMessage("user", big).isNew, false); assert.equal(a.counts().messages, 1);
  const small = a.putMessage("user", user("small")); assert.equal(small.truncated, false); assert.equal(a.getMessage(small.hash).message.content[0].text, "small");
  // a multi-byte character straddling the cap is dropped rather than left as a broken half
  const b = open({ caps: { messageBytes: 12, inputChars: 4000 } }); const u = b.putMessage("user", { role: "user", content: "ééééééé" });
  assert.ok(!b.getMessage(u.hash).message.head.includes("\uFFFD"));
});

// (fails before: yes — the owner's word of 10-30 on PDFs in the box, and a bug found driving it: a message over the cap
// because of the picture sent with it was kept as a marker, so the chat's next turn sent "(no text)" in its place)
test("a message large for its pictures or PDFs is kept whole; the cap counts its words and calls", () => {
  const a = open({ caps: { messageBytes: 200, inputChars: 4000 } });
  const b64 = Buffer.alloc(900, 7).toString("base64");
  const kept = [
    { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: b64 } }, { type: "text", text: "look" }] },
    { role: "user", content: [{ type: "document", title: "r.pdf", source: { type: "base64", media_type: "application/pdf", data: b64 } }, { type: "text", text: "read" }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "shot" }, { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } }] }] },
    { role: "user", content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } }, { type: "text", text: "an OpenAI client's" }] },
    { role: "user", content: [{ type: "file", file: { filename: "r.pdf", file_data: `data:application/pdf;base64,${b64}` } }] },
  ];
  for (const m of kept) {
    const p = a.putMessage("user", m);
    assert.equal(p.truncated, false, JSON.stringify(m).slice(0, 80));
    assert.deepEqual(a.getMessage(p.hash).message, m);
  }
  // Words past the cap are cut as before, pictures beside them or not.
  const wordy = { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: b64 } }, { type: "text", text: "x".repeat(300) }] };
  assert.equal(a.putMessage("user", wordy).truncated, true);
  assert.equal(a.putMessage("user", user("y".repeat(300))).truncated, true);
});

test("encryption: bodies are unreadable on disk, decrypt with the key, fail with another key", () => {
  const key = randomBytes(32), other = randomBytes(32); const file = join(dir, "enc.db");
  const a = new Archive({ file, key, now }); const c = a.chainForKey("k", { cwd: "/p" });
  const { turnId } = a.beginTurn(c.id, { requestId: "r", userMessage: user("the secret plan") }); a.finishTurn(turnId, { finalMessage: final("the secret answer") });
  const raw = a.db.prepare("SELECT body FROM messages").all().map((r) => Buffer.from(r.body).toString("latin1"));
  assert.ok(raw.every((s) => !s.includes("secret"))); assert.ok(raw.every((s) => Buffer.from(s, "latin1").length > 28));
  assert.equal(textOfMessage(a.getMessage(a.getTurn(turnId).user_hash).message), "the secret plan");
  a.close();
  const b = open({ file, key }); assert.equal(textOfMessage(b.getMessage(b.getTurn(turnId).final_hash).message), "the secret answer");
  assert.equal(b.render(c.id, { view: "chat" }).text.includes("the secret answer"), true);
  b.close(); opened.pop();
  const w = new Archive({ file, key: other, now }); opened.push(w); assert.equal(w.getChain(c.id).id, c.id, "metadata still readable"); assert.throws(() => w.getMessage(b.getTurn ? w.getTurn(turnId).user_hash : ""), /decrypt/);
  assert.throws(() => new Archive({ file, key: null, now }), /encrypted archive/);
  // plaintext archive: readable on disk, refuses a key later
  const p = open(); p.putMessage("user", user("visible")); assert.ok(Buffer.from(p.db.prepare("SELECT body FROM messages").get().body).toString("utf8").includes("visible"));
  assert.throws(() => new Archive({ file: p.file, key, now }), /plaintext archive/);
});

test("searchInputs: FTS over inputs and final answers, code-like tokens, project filter, ranking, fallback", () => {
  const a = open(); const c = a.chainForKey("k", { cwd: "/p" }); const d = a.chainForKey("k2", { cwd: "/other" }); a.setTitle(c.id, "Cleanup");
  const t1 = turn(a, c.id, "please run rm -rf ./dist then rebuild", "Ran rm -rf ./dist and rebuilt.");
  const t2 = turn(a, c.id, "there is a crash in usage.js:227 when the log rotates", "Fixed usage.js line 227 (rotation).");
  const t3 = turn(a, d.id, "usage.js is fine here, unrelated project", "Nothing to do.");
  turn(a, c.id, "übergröße mit Umlauten", "ok");
  const rm = a.searchInputs("rm -rf"); assert.ok(rm.length >= 1); assert.equal(rm[0].turnId, t1); assert.match(rm[0].snippet, /\[rm\]/); assert.equal(rm[0].title, "Cleanup"); assert.equal(rm[0].projectId, c.project_id); assert.ok(rm[0].at);
  const hits = a.searchInputs("usage.js:227"); assert.equal(hits[0].turnId, t2, "the exact code token ranks first"); assert.ok(hits.every((h) => h.chainId === c.id), "the phrase does not match the other project");
  assert.deepEqual([...new Set(a.searchInputs("usage.js").map((h) => h.turnId))].sort(), [t2, t3].sort());
  assert.ok(a.searchInputs("usage.js", { project: d.project_id }).every((h) => h.chainId === d.id));
  assert.equal(a.searchInputs("rotation")[0].role, "assistant", "final answers are indexed too");
  assert.equal(a.searchInputs("crash rotates usage")[0].turnId, t2, "more matching words rank higher");
  assert.equal(a.searchInputs("umlauten")[0].n, 3);
  assert.deepEqual(a.searchInputs("   "), []); assert.deepEqual(a.searchInputs("zzzznotthere"), []);
  assert.equal(ftsExpression("rm -rf usage.js:227 \"q\" ---"), '"rm" OR "-rf" OR "usage.js:227" OR """q"""'); assert.equal(ftsExpression("--- ???"), null);
  assert.deepEqual(a.searchInputs("???"), [], "punctuation-only queries take the substring path without error");
  assert.equal(a.searchInputs("./")[0].chainId, c.id, "substring fallback still finds literal punctuation");
  assert.ok(a.searchInputs("(", { limit: 1 }).length <= 1);
  // finishing a turn twice does not double-index; the index can be turned off
  a.finishTurn(t2, { finalMessage: final("Fixed usage.js line 227 (rotation).") }); assert.equal(a.searchInputs("rotation").length, 1);
  const q = open({ index: false }); const qc = q.chainForKey("k", {}); turn(q, qc.id, "findable words", "answer words"); assert.deepEqual(q.searchInputs("findable"), []);
});

test("render: full drops oldest turns to the budget, chat keeps the newest, summary uses summaries, ranges apply", () => {
  const a = open({ caps: { messageBytes: 1048576, inputChars: 60 } }); const c = a.chainForKey("k", { cwd: "/p" }); a.setTitle(c.id, "T");
  const ids = [1, 2, 3, 4].map((i) => turn(a, c.id, `question ${i} ` + "q".repeat(300), `answer ${i} ` + "a".repeat(300)));
  const all = a.render(c.id, { view: "full", budgetTokens: 100000 });
  assert.equal(all.turns, 4); assert.equal(all.dropped, 0); assert.equal(all.messages.length, 16, "user + 2 work + final per turn"); assert.equal(all.messages[0].content[0].text.startsWith("question 1"), true); assert.equal(all.messages.at(-1).content[0].text.startsWith("answer 4"), true);
  assert.equal(all.title, "T"); assert.deepEqual([all.from, all.to, all.total], [1, 4, 4]);
  const perTurn = all.tokens / 4;
  const two = a.render(c.id, { view: "full", budgetTokens: Math.ceil(perTurn * 2.5) });
  assert.equal(two.turns, 2); assert.equal(two.dropped, 2); assert.deepEqual([two.from, two.to], [3, 4]); assert.equal(two.messages[0].content[0].text.startsWith("question 3"), true); assert.ok(two.tokens <= perTurn * 2.5);
  const one = a.render(c.id, { view: "full", budgetTokens: 1 }); assert.equal(one.turns, 1); assert.equal(one.to, 4); assert.ok(one.tokens > 1, "the newest turn is kept even over budget");
  const chat = a.render(c.id, { view: "chat", budgetTokens: 100000 });
  assert.equal(chat.turns, 4); assert.match(chat.text, /^### Turn 1 \(\d{4}-\d\d-\d\d \d\d:\d\d\)\nUser: question 1 q+…\nAssistant: answer 1 a+\n\n### Turn 2/); assert.ok(chat.text.includes("Assistant: answer 4"));
  assert.ok(!chat.text.includes("Let me look"), "work is not part of the chat view"); assert.ok(chat.text.indexOf("Turn 1") < chat.text.indexOf("Turn 4"), "oldest to newest");
  const tiny = a.render(c.id, { view: "chat", budgetTokens: 5 }); assert.equal(tiny.turns, 1); assert.ok(tiny.text.includes("### Turn 4")); assert.ok(tiny.text.startsWith("(3 earlier turns omitted)")); assert.ok(!tiny.text.includes("Turn 3"));
  const range = a.render(c.id, { view: "chat", fromTurn: 2, toTurn: 3 }); assert.deepEqual([range.from, range.to, range.total, range.dropped], [2, 3, 2, 0]);
  a.setTurnSummary(ids[1], "Turn two summarised.");
  const sum = a.render(c.id, { view: "summary" }); assert.ok(sum.text.includes("Assistant: Turn two summarised.")); assert.ok(sum.text.includes("Assistant: answer 3 " + "a".repeat(300) + " (work: 1 tool calls)"));
  const long = turn(a, c.id, "long one", "L".repeat(1000), { work: false }); const s2 = a.render(c.id, { view: "summary", fromTurn: 5 }); assert.ok(s2.text.endsWith("Assistant: " + "L".repeat(400) + " … " + "L".repeat(400)), "an answer's head and end (the owner's of 11-08)"); assert.ok(!s2.text.includes("(work:"));
  const openTurn = a.beginTurn(c.id, { requestId: "x", userMessage: user("unanswered") }); assert.ok(a.render(c.id, { view: "chat", fromTurn: 6 }).text.includes("Assistant: (no final answer recorded)"));
  assert.equal(a.render("missing"), null); assert.throws(() => a.render(c.id, { view: "weird" }), /unknown view/); assert.ok(long && openTurn);
  // A turn Filament answered itself (`meta.command`) is about Filament, not the conversation: no view carries it.
  const cmd = turn(a, c.id, "@mem status", "**Memory status** (Filament)", { work: false }); a.mergeTurnMeta(cmd, { command: true });
  const afterCmd = a.render(c.id, { view: "chat", fromTurn: 5 });
  assert.ok(afterCmd.text.includes("Turn 5") && !afterCmd.text.includes("Memory status") && !afterCmd.text.includes("@mem status"), "the command turn is left out of the chat view");
  assert.equal(afterCmd.total, 2, "turn 5 and the open turn 6; the command turn 7 does not count");
  const full = a.render(c.id, { view: "full", fromTurn: 5 });
  assert.equal(full.total, 2); assert.equal(full.messages.some((m) => textOfMessage(m).includes("@mem status")), false, "nor of the full view");
});

// (fails before: yes — the owner's of 11-10, chat Fable52: one turn of 157 calls was bigger than any budget, the full
// view kept it whole, and filament_memory_load refused every ask for it — "already pulled 0 tokens … ask for less" — so
// nothing could be handed over from it)
test("render: full cuts one turn bigger than the budget to its message and its newest work, saying what was left out", () => {
  const a = open({ caps: { messageBytes: 1048576 } }); const c = a.chainForKey("k", { cwd: "/p" });
  const { turnId } = a.beginTurn(c.id, { requestId: "big", model: "m", upstream: "u", userMessage: user("hand this over") });
  const work = [];
  for (let i = 0; i < 40; i++) work.push(call(`c${i}`, `step ${i}`), result(`c${i}`, `out ${i} ` + "x".repeat(2000)));
  a.addWork(turnId, work);
  a.finishTurn(turnId, { finalMessage: final("handed over"), requestId: "big-end" });
  const whole = a.render(c.id, { view: "full", budgetTokens: 1_000_000 });
  assert.equal(whole.messages.length, 82, "the turn whole where it fits: its message, 80 of work, its answer");
  const cut = a.render(c.id, { view: "full", budgetTokens: 4000 });
  assert.equal(cut.turns, 1); assert.deepEqual([cut.from, cut.to], [1, 1]);
  assert.ok(cut.tokens <= 4000, `within the budget: ${cut.tokens}`);
  assert.equal(textOfMessage(cut.messages[0]), "hand this over", "its message first");
  assert.equal(textOfMessage(cut.messages.at(-1)), "handed over", "its newest message last");
  const left = whole.messages.length - (cut.messages.length - 1);
  assert.ok(left > 0 && cut.cut?.left === left, JSON.stringify(cut.cut));
  assert.match(textOfMessage(cut.messages[1]), new RegExp(`^\\(Filament: ${left} earlier messages of turn 1's work left out to fit the 4,000-token budget`), "said where it was cut");
  // Two turns, the newest over the budget: the newest alone, cut.
  turn(a, c.id, "a later one", "done");
  assert.equal(a.render(c.id, { view: "full", budgetTokens: 4000, toTurn: 1 }).cut?.left, left, "a range's newest turn is cut the same way");
  // (fails before: yes — the review of 11-10: a message bigger than the budget on its own was kept whole, so the load
  // still refused it)
  const d = a.chainForKey("k2", { cwd: "/p" });
  const pasted = `PASTED ${"y".repeat(40_000)}`;
  const big = a.beginTurn(d.id, { requestId: "paste", model: "m", upstream: "u", userMessage: user(pasted) });
  a.finishTurn(big.turnId, { finalMessage: final("read it"), requestId: "paste-end" });
  const kept = a.render(d.id, { view: "full", budgetTokens: 4000 });
  assert.ok(kept.tokens <= 4000, `within the budget: ${kept.tokens}`);
  assert.match(textOfMessage(kept.messages[0]), /^PASTED y+\n…\(Filament: the rest of this message left out to fit the 4,000-token budget\)$/, "its start, and that the rest went");
  assert.equal(textOfMessage(kept.messages.at(-1)), "read it", "its answer still comes");
  assert.deepEqual(kept.cut, { turn: 1, left: 0, message: true });
});

test("compactions: stored encrypted, compact view = newest summary + turns after it", () => {
  const a = open({ key: randomBytes(32) }); const c = a.chainForKey("k", { cwd: "/p" });
  for (const i of [1, 2, 3, 4]) turn(a, c.id, `q${i}`, `a${i}`, { work: false });
  assert.equal(a.render(c.id, { view: "compact" }).text, a.render(c.id, { view: "chat" }).text, "no compaction → chat");
  const first = a.addCompaction(c.id, { fromTurn: 1, toTurn: 1, summaryText: "old summary", kind: "compaction", method: "summary" });
  const comp = a.addCompaction(c.id, { fromTurn: 1, toTurn: 2, summaryText: "Turns one and two: settled q1 and q2.", kind: "compaction", method: "summary" });
  assert.ok(comp.id > first.id); assert.equal(a.getCompactions(c.id).length, 2); assert.equal(a.getMessage(comp.hash).role, "system");
  const v = a.render(c.id, { view: "compact" });
  assert.ok(v.text.startsWith("### Summary of turns 1-2\nTurns one and two: settled q1 and q2.\n\n### Turn 3")); assert.ok(!v.text.includes("old summary")); assert.ok(!v.text.includes("User: q2")); assert.ok(v.text.includes("User: q4"));
  assert.deepEqual([v.view, v.turns, v.from, v.to], ["compact", 2, 3, 4]); assert.ok(v.tokens >= Math.ceil(("### Summary of turns 1-2\nTurns one and two: settled q1 and q2.").length / 4));
  assert.equal(a.render(c.id, { view: "compact", fromTurn: 4 }).turns, 1);
  assert.equal(a.counts().compactions, 2);
});

// (fails before: yes — the compact view took the newest row whatever it was: a fold's, which carries no summary, headed
// it with an empty one and left out the turns it marked; a /trim now preview no window adopted stood as the summary)
test("the compact view's head is the summary the composer sends, the one reaching furthest: a fold's row after it is none, nor a /trim now preview", () => {
  const a = open(); const c = a.chainForKey("k-head", { cwd: "/p" });
  for (const i of [1, 2, 3, 4]) turn(a, c.id, `q${i}`, `a${i}`, { work: false });
  a.addCompaction(c.id, { fromTurn: 1, toTurn: 2, summaryText: "Turns one and two: settled.", kind: "compaction", method: "summary" });
  a.addCompaction(c.id, { fromTurn: 3, toTurn: 3, summaryText: null, kind: "compaction", method: "fold" });
  const v = a.render(c.id, { view: "compact" });
  assert.ok(v.text.startsWith("### Summary of turns 1-2\nTurns one and two: settled.\n\n### Turn 3"), v.text.slice(0, 200));
  assert.deepEqual([v.from, v.to], [3, 4]);
  a.addCompaction(c.id, { fromTurn: 1, toTurn: 4, summaryText: "a preview no window adopted", kind: "trim", method: "trim", detail: { door: "now" } });
  assert.equal(a.render(c.id, { view: "compact" }).text, v.text, "a preview is no compaction");
  a.addCompaction(c.id, { fromTurn: 1, toTurn: 1, summaryText: "Turn one alone.", kind: "trim", method: "trim" });
  assert.equal(a.render(c.id, { view: "compact" }).text, v.text, "nor a summary written after it that reaches fewer turns");
  const early = a.chainForKey("k-head-0", { cwd: "/p" });
  turn(a, early.id, "q1", "a1", { work: false });
  a.addCompaction(early.id, { fromTurn: 1, toTurn: 0, summaryText: "a bundle made before any turn finished", kind: "trim", method: "trim" });
  assert.ok(a.render(early.id, { view: "compact" }).text.startsWith("### Turn 1"), "a summary that stands for no turn heads nothing");
});

// (fails before: yes — the refusal named trim among the methods, which nothing writes now, and left out own)
test("a compaction row names its method, and the refusal says the methods written now", () => {
  const a = open(); const c = a.chainForKey("k-method", { cwd: "/p" });
  assert.throws(() => a.addCompaction(c.id, { fromTurn: 1, toTurn: 1, summaryText: "s", kind: "trim", method: "" }), /names its method \(summary, fold or own\)/);
});

test("chainsForProject: a project's chains newest first, of the kinds named, else every one", () => {
  const a = open();
  const mine = a.chainForKey("p-mine", { cwd: "/kinds" });
  const tick = a.chainForKey("p-tick", { cwd: "/kinds", kind: "tick" });
  const fork = a.chainForKey("p-fork", { cwd: "/kinds", kind: "fork" });
  assert.deepEqual(a.chainsForProject(mine.project_id).map((x) => x.id), [fork.id, tick.id, mine.id]);
  assert.deepEqual(a.chainsForProject(mine.project_id, { kinds: ["interactive", "fork"] }).map((x) => x.id), [fork.id, mine.id]);
  assert.deepEqual(a.chainsForProject(mine.project_id, { kinds: ["interactive", "fork"], limit: 1 }).map((x) => x.id), [fork.id]);
});

test("links upsert by (src, dst, type)", () => {
  const a = open(); a.link("chainA", "chainB", "sibling"); a.link("chainA", "chainB", "sibling", 0.5); a.link("turn:1", "chainA", "mentions", 2);
  assert.deepEqual(a.linksFor("chainA").map((l) => [l.src, l.dst, l.type, l.weight]), [["turn:1", "chainA", "mentions", 2], ["chainA", "chainB", "sibling", 0.5]]);
  assert.equal(a.linksFor("nothing").length, 0);
});

test("items: dedupe on project + kind + normalised text, filters, status and memory id", () => {
  const a = open(); const p = "proj";
  const i1 = a.items.add({ projectId: p, chainId: "c", turnId: 1, kind: "preference", text: "Use tabs, not spaces." });
  assert.equal(i1.deduped, false);
  assert.deepEqual(a.items.add({ projectId: p, kind: "preference", text: "  use   TABS, not spaces  " }), { id: i1.id, deduped: true });
  assert.equal(a.items.add({ projectId: p, kind: "rule", text: "Use tabs, not spaces." }).deduped, false, "another kind is another item");
  assert.equal(a.items.add({ projectId: "other", kind: "preference", text: "Use tabs, not spaces." }).deduped, false, "another project too");
  const i4 = a.items.add({ projectId: null, kind: "fact", text: "global fact", status: "confirmed", importance: 0.9, memoryId: "m1" });
  assert.equal(a.items.add({ kind: "fact", text: "global fact" }).id, i4.id, "null project dedupes with null project");
  assert.deepEqual(a.items.list({ projectId: p }).map((i) => i.id).sort(), [i1.id, i1.id + 1]);
  assert.equal(a.items.list({ projectId: p, kind: "rule" }).length, 1); assert.equal(a.items.list({ status: "confirmed" })[0].id, i4.id); assert.equal(a.items.list().length, 4); assert.equal(a.items.list({ limit: 2 }).length, 2);
  assert.ok(a.items.setStatus(i1.id, "dismissed")); assert.equal(a.items.get(i1.id).status, "dismissed"); assert.ok(a.items.get(i1.id).updated_at > a.items.get(i1.id).created_at);
  assert.throws(() => a.items.setStatus(i1.id, "maybe"), /status/); assert.throws(() => a.items.add({ projectId: p, kind: "fact", text: "x", status: "bogus" }), /status/); assert.throws(() => a.items.add({ projectId: p, kind: "fact" }), /needs kind and text/);
  a.items.setMemoryId(i1.id, "mem-9"); assert.equal(a.items.get(i1.id).memory_id, "mem-9"); assert.equal(a.items.setStatus(999, "confirmed"), false);
  assert.equal(a.items.list({ projectId: p })[0].id, i1.id, "most recently updated first");
});

test("injections: log, mark used, recent, never-used streaks", () => {
  const a = open();
  const id = a.injections.add({ requestId: "r1", chainId: "c", turnId: 1, kind: "turn", ids: ["m1", "m2", 7], tokens: 120 }); assert.equal(typeof id, "number");
  a.injections.add({ requestId: "r2", chainId: "c", turnId: 2, kind: "turn", ids: ["m1"], tokens: 40 });
  a.injections.add({ requestId: "r3", chainId: "c", turnId: 3, kind: "briefing", ids: ["m1", "m10"], tokens: 40 });
  a.injections.add({ requestId: "r4", chainId: "c", turnId: 4, kind: "turn", ids: ["m1"], tokens: 40 });
  const rec = a.injections.recent(2); assert.deepEqual(rec.map((r) => r.request_id), ["r4", "r3"]); assert.deepEqual(rec[1].ids, ["m1", "m10"]); assert.equal(rec[0].used, null);
  assert.equal(a.injections.neverUsedCount("m1"), 0, "nothing judged yet");
  assert.equal(a.injections.markUsed("r4", false), 1); assert.equal(a.injections.markUsed("r3", false), 1); assert.equal(a.injections.markUsed("r1", true, ["m1"]), 1); assert.equal(a.injections.markUsed("nope", false), 0);
  assert.equal(a.injections.neverUsedCount("m1"), 2, "r4, r3 unused; r2 unjudged is skipped; r1 echoed m1, which stops the streak");
  assert.equal(a.injections.neverUsedCount("m10"), 1); assert.equal(a.injections.neverUsedCount("m"), 0, "no partial id matches");
  // (fails before: the request's verdict credited every id in it — m2 and 7 rode on m1's echo, HarnessV3-Memory F4)
  assert.equal(a.injections.neverUsedCount("m2"), 1, "r1 was used, but not m2"); assert.equal(a.injections.neverUsedCount(7), 1);
  a.injections.markUsed("r2", false); assert.equal(a.injections.neverUsedCount("m1"), 3);
  a.injections.markUsed("r3", true, ["m10"]); assert.equal(a.injections.neverUsedCount("m1"), 3, "a neighbour's echo credits no one else"); assert.equal(a.injections.neverUsedCount("m10"), 0);
  a.injections.markUsed("r3", true, ["m1", "m10"]); assert.equal(a.injections.neverUsedCount("m1"), 1);
  assert.equal(a.injections.recent(1)[0].used, false); assert.equal(a.counts().injections, 4);
});

/** A claim's one anchor, as the check stores it. @param {number} id */
const anchorRow = (id) => [{ path: `/p/f${id}.js`, name: `f${id}.js`, kind: "file", hash: "h", size: 1, mtime: 1, head: null, symbols: [], state: "ok" }];

// (fails before: yes — the bug hunt of 10-30, MEMC-2: every turn's errata check joined every row its session ever
// logged, so a long session's turns slowed with its log)
test("the claims a session was shown are read from the rows it logged since its last check, never its whole log again", () => {
  const a = open();
  const [x, y] = ["x is a claim", "y is a claim"].map((text) => a.items.add({ projectId: "p", kind: "fact", text }).id);
  for (const id of [x, y]) a.anchors.add(id, anchorRow(id));
  a.injections.add({ requestId: "w1", chainId: "c-log", kind: "turn", ids: [`i${x}`, "e:row-1"] });
  assert.deepEqual(a.anchors.shownIn("c-log"), [x]);
  // The rows read already go behind the archive's back: a check that read the whole log again would lose x.
  a.db.exec("DELETE FROM injection_ids");
  a.injections.add({ requestId: "w2", chainId: "c-log", kind: "turn", ids: [`i${y}`] });
  assert.deepEqual(a.anchors.shownIn("c-log"), [x, y], "the second check read the row logged since, and kept what the first found");
  assert.deepEqual(a.anchors.pathsShownIn("c-log").sort(), [`/p/f${x}.js`, `/p/f${y}.js`]);
});

// (fails before: no — a guard: what a check keeps between turns answers as the session's whole log does, through new
// rows, new anchors, a retired claim, a write rolled back after a check inside it, and a deleted session)
test("the claims a session was shown, kept between its checks, answer as its whole log does", () => {
  const a = open();
  const whole = (/** @type {string} */ chain) =>
    a.db.prepare("SELECT DISTINCT a.item_id AS id FROM injections i JOIN injection_ids j ON j.injection_id = i.id JOIN item_anchors a ON a.item_id = CAST(substr(j.memory_id, 2) AS INTEGER) WHERE i.chain_id = ? AND j.memory_id GLOB 'i[0-9]*' ORDER BY a.item_id").all(chain).map((r) => Number(r.id));
  const wholePaths = (/** @type {string} */ chain) =>
    a.db.prepare("SELECT DISTINCT a.path FROM injections i JOIN injection_ids j ON j.injection_id = i.id JOIN item_anchors a ON a.item_id = CAST(substr(j.memory_id, 2) AS INTEGER) JOIN items c ON c.id = a.item_id WHERE i.chain_id = ? AND j.memory_id GLOB 'i[0-9]*' AND c.status NOT IN ('dismissed', 'superseded')").all(chain).map((r) => String(r.path)).sort();
  const same = (/** @type {string} */ chain, /** @type {string} */ why) => {
    assert.deepEqual(a.anchors.shownIn(chain), whole(chain), why);
    assert.deepEqual(a.anchors.pathsShownIn(chain).sort(), wholePaths(chain), why);
  };
  const c = a.chainForKey("k-shown", { cwd: "/p" });
  const ids = [1, 2, 3, 4, 5].map((n) => a.items.add({ projectId: c.project_id, kind: "fact", text: `claim number ${n}` }).id);
  a.anchors.add(ids[0], anchorRow(ids[0])); a.anchors.add(ids[1], anchorRow(ids[1]));
  same(c.id, "nothing shown yet");
  a.injections.add({ requestId: "g1", chainId: c.id, kind: "briefing", ids: [`i${ids[0]}`, `i${ids[2]}`] });
  same(c.id, "a first showing");
  a.anchors.add(ids[2], anchorRow(ids[2]));
  same(c.id, "a claim shown before it had anchors, anchored since");
  a.injections.add({ requestId: "g2", chainId: c.id, kind: "turn", ids: [`i${ids[1]}`, `i${ids[3]}`] });
  a.injections.add({ requestId: "g3", chainId: "another", kind: "turn", ids: [`i${ids[4]}`] });
  a.anchors.add(ids[3], anchorRow(ids[3])); a.anchors.add(ids[4], anchorRow(ids[4]));
  same(c.id, "more rows, another session's left out");
  a.items.setStatus(ids[1], "dismissed");
  same(c.id, "a retired claim's files are not looked at");
  assert.throws(() => a.transaction(() => {
    a.injections.add({ requestId: "g4", chainId: c.id, kind: "turn", ids: [`i${ids[4]}`] });
    a.anchors.shownIn(c.id);
    throw new Error("rolled back");
  }), /rolled back/);
  a.injections.add({ requestId: "g5", chainId: c.id, kind: "turn", ids: [`i${ids[0]}`] });
  same(c.id, "a write rolled back after a check inside it: its row id is given out again");
  a.deleteChain(c.id);
  same(c.id, "a deleted session was shown nothing");
});

// (fails before: yes — the archive marked its transaction open before BEGIN ran: a BEGIN that threw left it marked, and
// every later write of the process ran with no transaction, a failure in it half-written)
test("a transaction that could not begin leaves none open: the next one is still all or none", () => {
  const a = open();
  const exec = a.db.exec;
  let refused = 0;
  a.db.exec = (sql) => {
    if (sql === "BEGIN IMMEDIATE" && !refused) {
      refused++;
      throw new Error("database is locked");
    }
    return exec.call(a.db, sql);
  };
  try {
    assert.throws(() => a.transaction(() => a.chainForKey("k-begin-1", { cwd: "/p" })), /database is locked/);
  } finally {
    delete a.db.exec;
  }
  assert.equal(refused, 1, "the first BEGIN was refused");
  assert.equal(a.chainIdForKey("k-begin-1"), null, "nothing written by the transaction that never began");
  assert.throws(() => a.transaction(() => {
    a.chainForKey("k-begin-2", { cwd: "/p" });
    throw new Error("rolled back");
  }), /rolled back/);
  assert.equal(a.chainIdForKey("k-begin-2"), null, "the next transaction's write is rolled back with it");
  a.transaction(() => a.chainForKey("k-begin-3", { cwd: "/p" }));
  assert.ok(a.chainIdForKey("k-begin-3"), "and one that commits writes");
});

// (fails before: yes — the bug hunt of 10-30, MEMC-6: a view read and decrypted every message of every turn, then kept
// the newest that fit its budget)
test("render: a view reads the turns its budget keeps and the one it stops at, never the turns before", () => {
  const a = open({ key: randomBytes(32) }); const c = a.chainForKey("k-lazy", { cwd: "/p" });
  for (let i = 1; i <= 30; i++) turn(a, c.id, `question ${i} ` + "q".repeat(200), `answer ${i} ` + "a".repeat(200));
  const perTurn = a.render(c.id, { view: "full", budgetTokens: 100000 }).tokens / 30;
  /** @type {string[]} */
  const read = [];
  const getMessage = a.getMessage.bind(a);
  a.getMessage = (/** @type {string} */ hash) => (read.push(hash), getMessage(hash));
  const two = a.render(c.id, { view: "full", budgetTokens: Math.ceil(perTurn * 2.5) });
  assert.deepEqual([two.turns, two.dropped, two.from, two.to], [2, 28, 29, 30]);
  assert.equal(read.length, 3 * 4, "the two turns kept and turn 28, where the budget stopped: user, two work messages and the final each");
  read.length = 0;
  const chat = a.render(c.id, { view: "chat", budgetTokens: 5 });
  assert.deepEqual([chat.turns, chat.to], [1, 30]);
  assert.equal(read.length, 2 * 2, "the turn kept and the one before it: the user's message and the final each");
});

test("backupTo writes an openable copy and counts add up", async () => {
  const key = randomBytes(32); const a = open({ key }); const c = a.chainForKey("k", { cwd: "/p" });
  turn(a, c.id, "hello there", "general kenobi"); a.items.add({ projectId: c.project_id, kind: "fact", text: "f" }); a.addCompaction(c.id, { fromTurn: 1, toTurn: 1, summaryText: "s", method: "summary" });
  const counts = a.counts(); assert.deepEqual([counts.projects, counts.chains, counts.turns, counts.messages, counts.items, counts.compactions], [1, 1, 1, 5, 1, 1]); assert.ok(counts.bytes > 100);
  const file = join(dir, "backups", "copy.db"); const r = await a.backupTo(file);
  assert.equal(r.file, file); assert.ok(r.bytes > 0); assert.ok(existsSync(file));
  const b = open({ file, key }); assert.deepEqual(b.counts(), counts); assert.equal(textOfMessage(b.getMessage(b.getTurn(1).final_hash).message), "general kenobi");
  assert.equal(b.db.prepare("SELECT value FROM schema_meta WHERE key = 'encrypted'").get().value, "1");
  b.close(); turn(a, c.id, "second", "two"); const r2 = await a.backupTo(file); assert.ok(r2.bytes >= r.bytes, "an existing target is replaced");
  const b2 = new DatabaseSync(file); assert.equal(b2.prepare("SELECT COUNT(*) AS n FROM turns").get().n, 2); b2.close();
  a.close(); a.close(); // idempotent
});

// (fails before: yes — HarnessV4_Tasks U3-11: a compaction's row was written once; a figure known only after the fact
// (what its calls cost, once their records finished) had nowhere to go)
test("a compaction's detail takes figures after the fact: merged over what the row kept, nothing for a row that is gone", () => {
  const a = open();
  const chain = a.chainForKey("cost-chain", { cwd: "/p" });
  const { id } = a.addCompaction(chain.id, { fromTurn: 1, toTurn: 2, summaryText: "S", method: "summary", detail: { before: 100, after: 40, model: "m", ms: 9 } });
  const bare = a.addCompaction(chain.id, { fromTurn: 3, toTurn: 4, summaryText: "T", method: "summary" });
  assert.equal(a.mergeCompactionDetail(id, { cost: { paid: 0.04, list: 0.04, calls: 2 } }), true);
  assert.deepEqual(a.getCompactions(chain.id)[0].detail, { before: 100, after: 40, model: "m", ms: 9, cost: { paid: 0.04, list: 0.04, calls: 2 } });
  assert.equal(a.mergeCompactionDetail(bare.id, { cost: { paid: null, list: 0.01, calls: 1 } }), true);
  assert.deepEqual(a.getCompactions(chain.id)[1].detail, { cost: { paid: null, list: 0.01, calls: 1 } }, "a row that kept no figures takes them");
  assert.equal(a.mergeCompactionDetail(9999, { cost: { paid: 1, list: 1, calls: 1 } }), false, "no such row: nothing is written");
  assert.equal(a.getCompactions(chain.id).length, 2);
});
