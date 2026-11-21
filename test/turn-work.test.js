// A turn's work, read apart from its transcript (HarnessV4_Import_Plan, step 1b: a long chat opens). A session of long
// turns holds hundreds of megabytes of work, so the page's transcript holds the work back: the archive counts each
// turn's tool legs and calls as the work is written, a stretch of the work is cut to what a page draws, and the page
// lays each call after the words that led to it. The parts at their own level; the routes on a chat read from a
// coding agent's files are in import-sources.test.js.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive } from "../src/services/memory/archive.js";
import { INPUT_PREVIEW_CHARS, WORK_PAGE, isModelMessage, saidOf, tallyOfWork, toolsOfTurn, workSteps } from "../src/core/tool-vocab.js";
import { heldWords, takeWork, transcriptTurns, withReadWork } from "../src/ui/harness/conversation/history.js";
import { heldTranscript } from "./helpers/held-transcript.js";

const dir = mkdtempSync(join(tmpdir(), "filament-turn-work-"));
/** @type {Archive[]} */
const opened = [];
after(() => {
  for (const a of opened) a.close();
  rmSync(dir, { recursive: true, force: true });
});
let seq = 0;
const open = () => {
  const a = new Archive({ file: join(dir, `w${++seq}.db`) });
  opened.push(a);
  return a;
};

const user = (/** @type {string} */ text) => ({ role: "user", content: [{ type: "text", text }] });
const use = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input = {}) => ({ type: "tool_use", id, name, input });
const result = (/** @type {string} */ id, /** @type {string} */ content, /** @type {Record<string, any>} */ o = {}) => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content, ...o }] });
const says = (/** @type {any[]} */ ...content) => ({ role: "assistant", content });
const text = (/** @type {string} */ t) => ({ type: "text", text: t });
const thought = (/** @type {string} */ t) => ({ type: "thinking", thinking: t, signature: "sig" });

/** Two rounds of a loop in Anthropic's shape: thought, words and two reads; then an edit that failed. */
const LOOP = [
  says(thought("Both files first."), text("Reading."), use("a", "read", { path: "a.js" }), use("b", "read", { path: "b.js" })),
  { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: "AAA" }, { type: "tool_result", tool_use_id: "b", content: "BBB" }] },
  says(text("Now the edit."), use("c", "edit", { path: "a.js", old: "A", new: "B" })),
  result("c", "no such text", { is_error: true }),
];

describe("a turn's work counted as a page heads it", () => {
  // (fails before: yes — nothing counted a turn's work but the page, from the work whole)
  test("tool legs and calls in every shape a client speaks: Anthropic's blocks, a provider-run call, OpenAI's tool_calls, a Responses call item", () => {
    assert.deepEqual(tallyOfWork(LOOP), { legs: 2, calls: 3 });
    assert.deepEqual(tallyOfWork([says({ type: "server_tool_use", id: "s", name: "web_search", input: {} })]), { legs: 1, calls: 1 });
    assert.deepEqual(tallyOfWork([{ role: "assistant", content: null, tool_calls: [{ id: "d" }, { id: "e" }] }, { role: "tool", tool_call_id: "d", content: "x" }]), { legs: 1, calls: 2 });
    assert.deepEqual(tallyOfWork([{ type: "function_call", call_id: "f", name: "shell", arguments: "{}" }, { type: "function_call_output", call_id: "f", output: "x" }]), { legs: 1, calls: 1 });
    assert.deepEqual(tallyOfWork([says(text("words alone")), { role: "assistant", content: "a string" }]), { legs: 0, calls: 0 }, "a reply that called nothing is no leg");
    assert.deepEqual([tallyOfWork([]), tallyOfWork(/** @type {any} */ (null))], [{ legs: 0, calls: 0 }, { legs: 0, calls: 0 }]);
    assert.deepEqual([LOOP.map(isModelMessage), isModelMessage({ type: "function_call" }), isModelMessage({ role: "tool" })], [[true, false, true, false], true, false]);
  });

  // (fails before: yes — the archive kept no count: reading one meant opening every message of the work)
  test("the archive keeps the count on the turn as the work is written: added to leg by leg, never twice for a leg sent again, and made anew when the work is replaced", () => {
    const a = open();
    const chain = a.chainForKey("k:tally", { cwd: "C:\\x" });
    const { turnId } = a.beginTurn(chain.id, { requestId: "r1", model: "m", upstream: "u", userMessage: user("fix it") });
    const tally = () => a.getTurn(turnId).meta.tally;
    assert.equal(tally(), undefined, "a turn that did no work has none");
    a.addWork(turnId, LOOP.slice(0, 2));
    assert.deepEqual(tally(), { legs: 1, calls: 2 });
    a.addWork(turnId, LOOP);
    assert.deepEqual(tally(), { legs: 2, calls: 3 }, "the leg it already held adds nothing");
    a.addWork(turnId, []);
    assert.deepEqual(tally(), { legs: 2, calls: 3 });
    a.setWork(turnId, [...LOOP.slice(2), ...LOOP.slice(2)]);
    assert.deepEqual([tally(), a.getTurn(turnId).work.length], [{ legs: 1, calls: 1 }, 2], "replaced: counted from what is kept, each message once");
    a.setWork(turnId, []);
    assert.deepEqual(tally(), { legs: 0, calls: 0 });
  });

  // (fails before: yes — a turn's body opened every message of its work to say how many there were)
  test("a turn's body says how many messages its work has, and a stretch of the work opens those messages alone", () => {
    const a = open();
    const chain = a.chainForKey("k:stretch", { cwd: "C:\\x" });
    const { turnId } = a.beginTurn(chain.id, { requestId: "r1", model: "m", upstream: "u", userMessage: user("fix it") });
    a.addWork(turnId, LOOP);
    a.finishTurn(turnId, { finalMessage: says(text("Done.")), requestId: "r1" });
    let openedMessages = 0;
    const getMessage = a.getMessage.bind(a);
    a.getMessage = (/** @type {any[]} */ ...args) => (openedMessages++, getMessage(...args));
    const [body] = a.turnBodies(chain.id);
    assert.deepEqual([body.workCount, openedMessages], [4, 0], "counted from the row");
    assert.deepEqual(a.turnWork(turnId, { from: 1, to: 3 }), { total: 4, messages: LOOP.slice(1, 3) });
    assert.equal(openedMessages, 2);
    assert.deepEqual(a.turnWork(turnId), { total: 4, messages: LOOP });
    assert.deepEqual(a.turnWork(turnId, { from: 9, to: 12 }), { total: 4, messages: [] }, "past the work's end");
    assert.throws(() => a.turnWork(999_999), /no turn/);
  });
});

describe("a stretch of work cut to what a page draws", () => {
  // (fails before: yes — the page was sent every message whole: each call's input, each result, twice over in its cards)
  test("what the model said, whole; each call a bare mark; nothing of what a call returned", () => {
    assert.deepEqual(LOOP.map(saidOf), [
      { role: "assistant", content: [{ type: "thinking", thinking: "Both files first." }, { type: "text", text: "Reading." }, { type: "tool_use" }, { type: "tool_use" }] },
      null,
      { role: "assistant", content: [{ type: "text", text: "Now the edit." }, { type: "tool_use" }] },
      null,
    ]);
    assert.deepEqual(saidOf({ role: "assistant", content: "a string is one text" }), { role: "assistant", content: [{ type: "text", text: "a string is one text" }] });
    assert.deepEqual(saidOf({ role: "assistant", content: null, tool_calls: [{ id: "d", function: { name: "bash", arguments: "{\"command\":\"ls\"}" } }] }), { role: "assistant", content: [], tool_calls: [{}] });
    assert.deepEqual(saidOf({ type: "function_call", call_id: "f", name: "shell", arguments: "{}" }), { type: "function_call" });
    assert.deepEqual([saidOf({ role: "tool", tool_call_id: "d", content: "x" }), saidOf(null)], [null, null]);
    // The page's own count of the cut work is the archive's count of the work whole.
    const cut = LOOP.map(saidOf).filter(Boolean);
    assert.deepEqual(tallyOfWork(cut), tallyOfWork(LOOP));
  });

  // (fails before: yes — a turn's cards came as one list beside its work, with nothing saying which words led to which)
  test("each message of the model's with the calls it made as cards, each with what it returned; a long string of a call's input is cut and says so", () => {
    const steps = workSteps(LOOP, "anthropic");
    assert.deepEqual(steps.map((s) => [/** @type {any} */ (s).content.filter((/** @type {any} */ b) => b.type !== "tool_use").map((/** @type {any} */ b) => b.text ?? b.thinking), /** @type {any} */ (s).tools.map((/** @type {any} */ c) => [c.id, c.name, c.result, c.isError])]), [
      [["Both files first.", "Reading."], [["a", "read", "AAA", false], ["b", "read", "BBB", false]]],
      [["Now the edit."], [["c", "edit", "no such text", true]]],
    ]);
    assert.deepEqual(steps.flatMap((s) => /** @type {any} */ (s).tools), toolsOfTurn(LOOP, "anthropic"), "the cards are the transcript's own, short inputs untouched");
    const words = workSteps([says(text("No calls here."))], "anthropic");
    assert.deepEqual(words, [{ role: "assistant", content: [{ type: "text", text: "No calls here." }] }], "a reply that called nothing carries no cards");
    // OpenAI's shape: the calls ride on the message, each result is a message of its own.
    const oa = workSteps([{ role: "assistant", content: "Listing.", tool_calls: [{ id: "d", type: "function", function: { name: "bash", arguments: "{\"command\":\"ls\"}" } }] }, { role: "tool", tool_call_id: "d", content: "a.js" }], "openai");
    assert.deepEqual(oa.map((s) => [/** @type {any} */ (s).content, /** @type {any} */ (s).tool_calls, /** @type {any} */ (s).tools.map((/** @type {any} */ c) => [c.id, c.input, c.result])]), [[[{ type: "text", text: "Listing." }], [{}], [["d", { command: "ls" }, "a.js"]]]]);
    // A file written whole: the head of it, and how long it is.
    const long = "x".repeat(INPUT_PREVIEW_CHARS + 6000);
    const [w] = workSteps([says(use("w", "write", { path: "big.txt", content: long, lines: [long, "short"], n: 3 })), result("w", "ok")], "anthropic");
    const input = /** @type {any} */ (w).tools[0].input;
    assert.equal(input.content, `${"x".repeat(INPUT_PREVIEW_CHARS)}\n… (10,000 characters in all: the first 4,000 are shown)`);
    assert.deepEqual([input.path, input.lines[0] === input.content, input.lines[1], input.n], ["big.txt", true, "short", 3], "every long string, wherever it sits; nothing else changes");
    assert.equal(toolsOfTurn([says(use("w", "write", { content: long }))], "anthropic")[0].input.content, long, "the transcript's whole-work cards keep the input whole");
    assert.equal(WORK_PAGE, 300);
  });
});

describe("the page: a turn whose work is held back", () => {
  const TR = {
    turns: [
      { n: 1, turnId: 11, requestIds: ["r1"], open: false, user: user("fix it"), work: LOOP, final: says(text("Fixed.")) },
      { n: 2, turnId: 12, requestIds: ["r2"], open: false, user: user("thanks"), work: [], final: says(text("Welcome.")) },
    ],
  };
  /** A stretch of turn 1's work as the route answers it. @param {number} from @param {number} to */
  const stretch = (from, to) => ({ n: 1, total: LOOP.length, from, next: to < LOOP.length ? to : null, work: workSteps(LOOP.slice(from, to), "anthropic") });
  const shape = (/** @type {any} */ t) => t.held.parts.map((/** @type {any} */ p) => (p.block ? `${p.block.type}:${p.block.text}` : p.tools.map((/** @type {any} */ c) => c.id).join("+")));

  // (fails before: yes — a turn was its work or nothing: the page had no turn whose work was still to come)
  test("until its work is read the turn is its answer, headed by the archive's counts; each stretch joins in order, a call after the words that led to it", () => {
    const [t, plain] = transcriptTurns(heldTranscript(TR));
    assert.equal(plain.held, null, "a turn that did no work has nothing to read");
    assert.deepEqual([plain.toolLegs, plain.toolCalls], [0, 0]);
    assert.deepEqual([t.blocks.map((/** @type {any} */ b) => b.text), t.toolLegs, t.toolCalls, t.held.total, t.held.next], [["Fixed."], 2, 3, 4, 0]);
    const answer = t.blocks[0];
    assert.deepEqual(heldWords(t.held), { text: "Reading this turn's work…", action: "" });
    assert.equal(takeWork(t, stretch(2, 4)), false, "a stretch that is not the next one is not taken");
    assert.equal(takeWork(t, stretch(0, 2)), true);
    assert.deepEqual(shape(t), ["thinking:Both files first.", "text:Reading.", "a+b"]);
    assert.deepEqual([t.blocks.map((/** @type {any} */ b) => b.text), t.blocks.at(-1) === answer], [["Both files first.", "Reading.", "Fixed."], true], "the answer is the block it was: drawn once");
    assert.deepEqual(heldWords(t.held), { text: "2 of 4 steps of this turn's work are shown.", action: "Show more" });
    assert.deepEqual(heldWords({ ...t.held, reading: Promise.resolve() }), { text: "Reading more of this turn's work…", action: "" });
    assert.deepEqual(heldWords({ ...t.held, failed: "HTTP 500" }), { text: "This turn's work could not be read: HTTP 500", action: "Try again" });
    assert.equal(takeWork(t, stretch(0, 2)), false, "the same stretch twice adds nothing");
    const said = t.held.parts[1].block;
    assert.equal(takeWork(t, stretch(2, 4)), true);
    assert.deepEqual(shape(t), ["thinking:Both files first.", "text:Reading.", "a+b", "text:Now the edit.", "c"]);
    assert.equal(t.held.parts[1].block, said, "what was read stays the block it was");
    assert.deepEqual([t.held.next, heldWords(t.held), t.toolLegs, t.toolCalls], [null, null, 2, 3]);
  });

  test("calls with no words between them share one box, across a stretch's end too; a turn the archive never counted is counted once its work is read whole", () => {
    const quiet = [says(text("Three reads.")), says(use("a", "read")), result("a", "A"), says(use("b", "read")), result("b", "B"), says(use("c", "read")), result("c", "C"), says(text("Then:"), use("d", "edit")), result("d", "ok")];
    const [t] = transcriptTurns(heldTranscript({ turns: [{ ...TR.turns[0], work: quiet }] }, { counted: false }));
    assert.deepEqual([t.toolLegs, t.toolCalls], [undefined, undefined]);
    takeWork(t, { from: 0, total: 9, next: 3, work: workSteps(quiet.slice(0, 3), "anthropic") });
    assert.deepEqual([shape(t), t.toolLegs], [["text:Three reads.", "a"], undefined], "not counted from a part of the work");
    takeWork(t, { from: 3, total: 9, next: null, work: workSteps(quiet.slice(3), "anthropic") });
    assert.deepEqual(shape(t), ["text:Three reads.", "a+b+c", "text:Then:", "d"]);
    assert.deepEqual([t.toolLegs, t.toolCalls], [4, 4]);
  });

  // (fails before: yes — nothing carried a turn's read work over the page's next reading of the session)
  test("the page's next reading of the session keeps what it had read of a turn, and starts over for a turn that grew", () => {
    const was = transcriptTurns(heldTranscript(TR));
    takeWork(was[0], stretch(0, 2));
    const again = withReadWork(transcriptTurns(heldTranscript(TR)), was);
    assert.deepEqual([shape(again[0]), again[0].held.next, again[0].blocks.map((/** @type {any} */ b) => b.text)], [["thinking:Both files first.", "text:Reading.", "a+b"], 2, ["Both files first.", "Reading.", "Fixed."]]);
    assert.equal(again[0].held.parts, was[0].held.parts, "the same parts: a box drawn once stays drawn");
    takeWork(again[0], stretch(2, 4));
    assert.deepEqual([again[0].held.next, again[0].toolCalls], [null, 3]);
    const whole = withReadWork(transcriptTurns(heldTranscript(TR)), again);
    assert.deepEqual([whole[0].held.next, shape(whole[0]).length, heldWords(whole[0].held)], [null, 5, null], "read whole, it is whole at once");
    const grown = withReadWork(transcriptTurns(heldTranscript({ turns: [{ ...TR.turns[0], work: [...LOOP, says(text("More."))] }, TR.turns[1]] })), again);
    assert.deepEqual([grown[0].held.next, grown[0].held.parts, grown[0].held.total], [0, [], 5], "more work than was read: read again from its start");
    assert.deepEqual(withReadWork(transcriptTurns(heldTranscript(TR)), null).map((/** @type {any} */ t) => t.held?.next ?? null), [0, null]);
    assert.deepEqual(withReadWork(transcriptTurns(heldTranscript(TR)), transcriptTurns(heldTranscript(TR)))[0].held.next, 0, "nothing read is nothing to keep");
  });

  // The timeline and the conductor cannot be loaded here (they need a browser): their wiring is read from the source.
  test("the page asks for the work held back, reads a turn's first stretch as its row nears the screen, and lays the archive's cards among the words", () => {
    const src = (/** @type {string} */ f) => readFileSync(new URL(`../src/ui/harness/${f}`, import.meta.url), "utf8");
    const app = src("app.js");
    // (What was read of an ended turn's run comes with it too, `withReadRuns`: chat-open-path.)
    // (Its turns put together whole first where it read those written since its last read, `transcriptWhole`:
    // transcript-since.)
    assert.match(app, /const sent = await api\(`\/sessions\/\$\{encodeURIComponent\(chainId\)\}\/transcript\?work=held\$\{writtenSince\(held, chainId\)\}`\);\n[\s\S]{0,800}?const tr = read\.tr;\n[\s\S]{0,400}?const turns = withReadRuns\(withReadWork\(transcriptTurns\(tr\), chat\.turns\), chat\.turns, /);
    const timeline = src("conversation/timeline.js");
    assert.match(timeline, /if \(turn\.history && unread\(turn\.held\)\) whenNear\(v\.root, \(\) => \(unread\(turn\.held\) \? heldWork\(c, turn\) : undefined\)\);/, "through the queue a run's cards are read through, once the row is near");
    assert.match(timeline, /return !!held && held\.next === 0 && !held\.failed && !held\.reading;/, "a failed read is not tried again by itself");
    assert.match(timeline, /held\.reading = api\(`\/sessions\/\$\{encodeURIComponent\(String\(c\.chainId\)\)\}\/turns\/\$\{Number\(turn\.n\)\}\/work\?from=\$\{held\.next\}`\)\s+\.then\(\(page\) => void takeWork\(turn, page\), \(e\) => \{ held\.failed = String\(e\?\.message \|\| e\); \}\)/, "a failure is kept with its cause, for the row to say");
    assert.match(timeline, /const more = heldRow\(c, turn\);\s+if \(more\) turn\.segments\.push\(\{ kind: "held", el: more \}\);/, "the row is a segment of the fold: its header stands while the work is read");
    assert.match(timeline, /w\.action \? h\("button", \{ class: "tool-note link", type: "button", onclick: \(\) => void heldWork\(c, turn\) \}, w\.action\) : null/);
    assert.match(timeline, /if \(!al\) return void archiveCards\(turn\);/, "a turn with no run of its own");
    assert.match(timeline, /const hnd = drawn\.get\(b\) \|\| \(b\.type === "thinking" \? thinkEl\(b, \{ isFirst: firstThink \}\) : blockEl\(b\)\);/, "a block drawn once is not drawn again when more work joins");
    assert.match(timeline, /if \(p\.drawn !== p\.tools\.length\)\s+Object\.assign\(p, \{ drawn: p\.tools\.length, el: h\("div", \{ class: "cards" \}, \.\.\.archivedRows\(p\.tools, \{ key: `\$\{turn\.turnId \?\? turn\.n\}-\$\{i\}`, turnAt: turnAtOf\(turn\) \}\)\) \}\);/, "a box is drawn once, and again only when calls joined it");
    assert.match(src("conversation/turn.js"), /return \{ el: det, body, setState, setSkip, recount, part \};/);
    // Find searches what is drawn: opening it reads the work of the drawn turns that had not, and searches again.
    assert.match(timeline, /readWork\(\) \{\s+const c = chat;\s+findOpen = true;\s+const turns = \[\.\.\.view\.keys\(\)\]\.filter\(\(turn\) => unread\(turn\.held\)\);\s+const cards = fileCardsIn\(inner\)\.map\(\(st\) => st\.read\.then\(\(\) => st\.readWhole\(\)\)\);\s+const runs = \[\.\.\.view\.keys\(\)\]\.filter\(\(turn\) => turn\.runId && \(turn\.runRead \|\| subsApart\(turn\.aligned\)\.length\)\);\s+return Promise\.all\(\[\s+Promise\.all\(turns\.map\(\(turn\) => cardQueue\.run\(\(\) => heldWork\(c, turn\)\)\.catch\(\(\) => \{\}\)\)\)\.then\(\(\) => turns\.length\),/);
    assert.match(timeline, /if \(held\.reading\) return held\.reading;/, "a read on its way is waited for, not started twice");
    // …and, once those are drawn, the answers their cards read in their agents' cards' form (the store's `cardsHeard`).
    assert.match(app, /createFind\(shell\.convFrame, \{ root: \(\) => shell\.convFrame\.querySelector\("\.transcript"\), prepare: \(\) => transcript\.readWork\(\)\.then\(\(n\) => subagentStore\.cardsHeard\(\)\.then\(\(heard\) => n \+ \(heard \? 1 : 0\)\)\), reveal: \(needle\) => transcript\.revealWork\(needle\), letGo: \(\) => transcript\.foldWork\(\) \}\);/);
    assert.match(src("find.js"), /cb\.prepare\?\.\(\)\.then\(\(brought\) => \{ if \(brought && !bar\.classList\.contains\("hidden"\)\) search\(\); \}, \(\) => \{\}\);/);
    assert.match(timeline, /v\.fold\?\.recount\(\);/);
  });
});
