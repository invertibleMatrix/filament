// @ts-check
// A search of a session's history (the filament-agent plan's Phase 4a): `filament_memory_grep` reads every message of
// every turn the views carry — the words, each call's name and input, each result's text — newest turn first, so an
// agent finds what has left its context; `current` names the session the call stands in, for a grep and for a load.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { messagePieces } from "../src/core/messages.js";
import { Archive } from "../src/services/memory/archive.js";
import { executeMemoryTool, memoryToolDefs } from "../src/app/memory-tools.js";
import { archivedRows } from "../src/ui/harness/conversation/tools/render.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { world } from "./fixtures/memory-world.mjs";

const dir = mkdtempSync(join(tmpdir(), "filament-grep-"));
// The archive untyped here, as in its sibling tests: the Archive class is on the untyped list until its JSDoc lands.
/** @type {any[]} */
const opened = [];
after(() => {
  for (const a of opened) a.close();
  rmSync(dir, { recursive: true, force: true });
});
const open = () => {
  const a = /** @type {any} */ (new Archive({ file: join(dir, `g${opened.length}.db`) }));
  opened.push(a);
  return a;
};
/** @param {string} text */
const user = (text) => ({ role: "user", content: [{ type: "text", text }] });
/** @param {string} text */
const said = (text) => ({ role: "assistant", content: [{ type: "text", text }] });
/** @param {string} id @param {string} cmd */
const ran = (id, cmd) => ({ role: "assistant", content: [{ type: "text", text: "Running it." }, { type: "tool_use", id, name: "bash", input: { cmd } }] });
/** @param {string} id @param {string} text */
const out = (id, text) => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content: text }] });
/** A turn: what opened it, its work, its reply (none: still open). @param {any} a @param {string} chainId @param {string} text @param {any[]} work @param {string | null} reply @param {Record<string, any>} [o] */
function turn(a, chainId, text, work, reply, o = {}) {
  const { turnId } = a.beginTurn(chainId, { userMessage: user(text), ...o });
  if (work.length) a.addWork(turnId, work);
  if (reply != null) a.finishTurn(turnId, { finalMessage: said(reply) });
  return turnId;
}

// (fails before: yes — nothing read a message whole: textOfMessage leaves out every call, so a search could not find a
// command that was run)
test("a message, piece by piece, in every wire shape: its words, each call with its input, each result — no thinking, no image", () => {
  const pieces = (/** @type {any} */ m) => messagePieces(m).map((p) => `${p.kind}:${p.text}`);
  const thinking = { type: "thinking", thinking: "hmm", signature: "s" };
  assert.deepEqual(pieces({ role: "assistant", content: [thinking, { type: "text", text: "Let me look." }, { type: "tool_use", id: "c1", name: "bash", input: { cmd: "ls" } }] }), ["text:Let me look.", 'call:bash {"cmd":"ls"}']);
  assert.deepEqual(pieces({ role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: [{ type: "text", text: "a.js" }, { type: "image", source: {} }] }, { type: "text", text: "go on" }] }), ["result:a.js", "text:go on"]);
  assert.deepEqual(pieces({ role: "assistant", content: "Reading.", tool_calls: [{ id: "c2", type: "function", function: { name: "read", arguments: '{"path":"b.js"}' } }] }), ["text:Reading.", 'call:read {"path":"b.js"}']);
  assert.deepEqual(pieces({ role: "tool", tool_call_id: "c2", content: "export {}" }), ["result:export {}"]);
  assert.deepEqual(pieces({ type: "function_call", call_id: "c3", name: "grep", arguments: '{"q":"x"}' }), ['call:grep {"q":"x"}']);
  assert.deepEqual(pieces({ type: "function_call_output", call_id: "c3", output: "no match" }), ["result:no match"]);
  assert.deepEqual(pieces({ type: "message", role: "assistant", content: [{ type: "output_text", text: "Done." }] }), ["text:Done."]);
  assert.deepEqual(pieces({ type: "reasoning", summary: [{ type: "summary_text", text: "why" }], content: [{ type: "reasoning_text", text: "why" }] }), []);
  assert.deepEqual([pieces("plain words"), pieces(null)], [["text:plain words"], []]);
});

// (fails before: yes — the archive had no search inside a session: only the FTS index of what the user typed and the
// replies, across sessions)
test("a session's grep: newest turn first, every part of a turn read, each place said; not a turn no view carries", () => {
  const a = open();
  const c = a.chainForKey("h:grep", { cwd: "C:\\proj", client: "test", model: "m" });
  turn(a, c.id, "start the server", [ran("c1", "npm start"), out("c1", "Error: listen EADDRINUSE: address already in\n  use :::20300\n    at Server.setupListenHandle")], "Port 20300 is taken by pid 125.");
  turn(a, c.id, "what was that error?", [user("steered: is it EADDRINUSE?")], "EADDRINUSE on 20300.");
  turn(a, c.id, "@mem eaddrinuse", [], "Filament's own answer", { command: true });
  const rewound = turn(a, c.id, "EADDRINUSE again?", [], "a dropped line");
  a.mergeTurnMeta(rewound, { rewound: { line: "a" } });
  turn(a, c.id, "[Filament: the background task ended] check eaddrinuse", [], "Checked.", { own: { tasks: ["b1"] } });
  const flaky = [1, 2, 3, 4, 5].flatMap((i) => [ran(`f${i}`, `npm test -- --run ${i}`), out(`f${i}`, `test ${i} is flaky; version 1.5`)]);
  turn(a, c.id, "run the tests", flaky, "Five flaky runs.");

  const r = a.grep(c.id, { text: "eaddrinuse" });
  assert.deepEqual(
    r.matches.map((m) => [m.turn, m.hits, m.places.map((p) => p.where)]),
    [[5, 1, ["filament"]], [2, 2, ["user", "assistant"]], [1, 1, ["result"]]],
    "newest first, a steer the user's; the turn Filament answered and the one rewound are not read; an agent's own turn opens with Filament's words",
  );
  assert.equal(r.matches[2].places[0].line, "Error: listen EADDRINUSE: address already in use :::20300 at Server.setupListenHandle", "the line around it, its whitespace squashed");
  assert.deepEqual([r.searched, r.more, r.session, r.text], [4, false, c.id, "eaddrinuse"]);
  assert.ok(r.tokens > 0, "what the answer costs, for the request's ceiling");

  assert.deepEqual(a.grep(c.id, { text: "address ALREADY in use" }).matches.map((m) => m.turn), [1], "any case, any whitespace between the words");
  assert.deepEqual(a.grep(c.id, { text: "npm start" }).matches.map((m) => [m.turn, m.places[0].where, m.places[0].line]), [[1, "call", 'bash {"cmd":"npm start"}']], "a call: its name and its input");
  assert.deepEqual(a.grep(c.id, { text: "1.5" }).matches.map((m) => m.turn), [6], "the words as written, not a pattern (pid 125 is no match)");

  const many = a.grep(c.id, { text: "flaky" }).matches[0];
  assert.deepEqual([many.turn, many.hits, many.places.length], [6, 6, 3], "every time counted, its first three places shown");
  assert.match(many.places[0].line, /^test 1 is flaky/);

  const page = a.grep(c.id, { text: "eaddrinuse", limit: 2 });
  assert.deepEqual([page.matches.map((m) => m.turn), page.more], [[5, 2], true], "a limit, and older turns that have them too");
  const rest = a.grep(c.id, { text: "eaddrinuse", toTurn: 1 });
  assert.deepEqual([rest.matches.map((m) => m.turn), rest.more], [[1], false], "going on below the last turn shown");
  assert.deepEqual(a.grep(c.id, { text: "eaddrinuse", fromTurn: 2, toTurn: 4 }).matches.map((m) => m.turn), [2]);

  const long = "x".repeat(300) + " NEEDLE " + "y".repeat(300);
  turn(a, c.id, long, [], "ok");
  const cut = a.grep(c.id, { text: "needle" }).matches[0].places[0].line;
  assert.equal(cut, `…${"x".repeat(79)} NEEDLE ${"y".repeat(119)}…`, "80 characters before, 120 after, marked where cut");

  assert.equal(a.grep("nope", { text: "x" }), null, "no such session");
  assert.throws(() => a.grep(c.id, { text: "  " }), /no text to look for/);
});

// (fails before: yes — there was no grep, and a load took only a session's id)
test("the tool: 'current' is the session the call stands in, for a grep (its default) and a load; standing in none, it says so", async () => {
  /** @type {any[]} */
  const asked = [];
  const found = { session: "ch1", title: null, text: "x", searched: 3, matches: [{ turn: 3, when: "2026-10-09 12:00", hits: 1, places: [] }, { turn: 2, when: "2026-10-09 11:00", hits: 2, places: [] }], more: true, tokens: 40 };
  const scope = (/** @type {string | null} */ chain) => ({
    chain,
    loadCeiling: () => 1000,
    grep: (/** @type {string} */ id, /** @type {any} */ o) => (asked.push(["grep", id, o]), found),
    load: (/** @type {string} */ id, /** @type {any} */ o) => (asked.push(["load", id, o.view]), { text: "### Turn 1", tokens: 10 }),
  });
  const r = JSON.parse(await executeMemoryTool(scope("ch1"), "filament_memory_grep", { text: "EADDRINUSE" }));
  assert.deepEqual(asked[0], ["grep", "ch1", { text: "EADDRINUSE", limit: 10, fromTurn: undefined, toTurn: undefined }]);
  assert.deepEqual([r.matches.length, r.more, r.next], [2, true, "older turns have it too: grep again with to_turn 1"]);
  assert.equal(r.tokens, undefined, "what it costs is Filament's count, not the model's to read");
  await executeMemoryTool(scope("ch1"), "filament_memory_grep", { text: "x", session: "ch9", limit: 99, to_turn: 7 });
  assert.deepEqual(asked[1], ["grep", "ch9", { text: "x", limit: 30, fromTurn: undefined, toTurn: 7 }]);
  assert.equal(await executeMemoryTool(scope("ch1"), "filament_memory_load", { session: "current", view: "full" }), "### Turn 1");
  await executeMemoryTool(scope("ch1"), "filament_memory_load", { session: "ch9" });
  assert.deepEqual(asked.slice(2), [["load", "ch1", "full"], ["load", "ch9", "chat"]]);
  for (const [name, input] of /** @type {[string, any][]} */ ([["filament_memory_grep", { text: "x" }], ["filament_memory_load", { session: "current" }]]))
    assert.match(JSON.parse(await executeMemoryTool(scope(null), name, input)).error, /this call stands in no session, so 'current' names none/);
  assert.equal(asked.length, 4, "nothing asked of memory for a session that is none");
  // One ceiling for a request's every load and grep.
  const tally = { loadedTokens: 980 };
  assert.match(JSON.parse(await executeMemoryTool(scope("ch1"), "filament_memory_grep", { text: "x" }, tally)).error, /already pulled 980 tokens of session history and its budget is 1000/);
  const fresh = { loadedTokens: 0 };
  await executeMemoryTool(scope("ch1"), "filament_memory_grep", { text: "x" }, fresh);
  assert.equal(fresh.loadedTokens, 40, "a grep counts what it brought");
  const def = memoryToolDefs("anthropic").find((d) => d.name === "filament_memory_grep");
  assert.deepEqual(def?.input_schema.required, ["text"]);
  assert.match(String(def?.description), /'current', the default/);
});

// (fails before: yes — the owner's of 11-10, chat Fable52: a load's answer was cut to 60,000 characters from its end, so a
// 30,000-token load, which the budget allows, lost its newest messages — what a handover needs most — without a word)
test("the tool: a load bigger than its answer's room keeps its start and its newest end, and says what was left out between", async () => {
  const text = `HEAD ${"a".repeat(80_000)} ${"b".repeat(80_000)} NEWEST`;
  const scope = { chain: "ch1", loadCeiling: () => 100_000, load: () => ({ text, tokens: 30_000 }) };
  const out = await executeMemoryTool(/** @type {any} */ (scope), "filament_memory_load", { session: "ch1", view: "full", budget_tokens: 30000 });
  assert.ok(out.startsWith("HEAD "), "its start");
  assert.ok(out.endsWith(" NEWEST"), "its newest end");
  assert.ok(out.length <= 120_000 + 200, `the room a 30,000-token budget asks: ${out.length}`);
  assert.match(out, /\n…\[\d[\d,]* characters left out here\]\n/, "where it was cut");
  const small = await executeMemoryTool(/** @type {any} */ (scope), "filament_memory_load", { session: "ch1", budget_tokens: 2000 });
  assert.ok(small.length <= 60_000 + 200 && small.endsWith(" NEWEST"), "a smaller ask keeps the room it had, and its end");
});

// (fails before: yes — a model's handle had no grep, and 'current' named no session)
test("through memory's own handle: a model's grep and load of 'current' read its session", async () => {
  await world({}, async (w) => {
    const s = w.session("grep-e2e");
    await s.send("deploy to staging", { reply: "Deployed build 4417 to staging." });
    const { prep } = await s.send("and prod?", { reply: "Not yet." });
    const scope = w.svc.scope({ role: "model", chain: prep.chain, turn: prep.turn });
    const found = JSON.parse(await executeMemoryTool(scope, "filament_memory_grep", { text: "build 4417" }));
    assert.deepEqual(found.matches.map((/** @type {any} */ m) => [m.turn, m.places[0].where]), [[1, "assistant"]]);
    assert.match(await executeMemoryTool(scope, "filament_memory_load", { session: "current" }), /Deployed build 4417[\s\S]*Not yet/);
  });
});

// (fails before: yes — a grep, and a sessions lookup, read as "Remembered")
test("the page: a grep, like a search, a sessions lookup and a load, is a read — Recalled, with its words", () => {
  const doc = stubDocument();
  try {
    const row = (/** @type {string} */ name, /** @type {any} */ input) => archivedRows([{ id: "m1", name, input, result: "{}" }])[0].textContent;
    assert.match(row("filament_memory_grep", { text: "EADDRINUSE" }), /Recalled[\s\S]*EADDRINUSE/);
    assert.match(row("filament_memory_sessions", { query: "deploy" }), /Recalled/);
    assert.match(row("filament_memory_load", { session: "current" }), /Recalled/);
    assert.match(row("filament_memory_remember", { text: "x" }), /Remembered/);
  } finally {
    doc.restore();
  }
});
