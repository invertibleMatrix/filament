// @ts-check
// Your agent's work pane reads a picked box's words whole where the chat's list carries them clipped (the list's heads,
// subagents.js `publicOf` `head`; the owner's of 11-17: the list carried each exchange's words to 4,000 characters, 2.28
// of its 2.48 MB, read again at each move of an agent). The box's detail showed what it was asked and its answer as the
// list held them, to 4,000 characters; with heads, a box whose words were cut reads its thread once — every box of the
// thread from that read — showing its first words and that it reads the rest meanwhile, then 4,000 characters as ever.
// A box whose words the list holds whole reads nothing.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { NOW, agentRow } from "./helpers/side-view.js";

/** @type {ReturnType<typeof stubDocument>} */
let doc;
/** @type {typeof import("../src/ui/harness/views/agent-work.js")} */
let pane;
/** @type {typeof import("../src/ui/harness/lib/agent-work.js")} */
let lib;
before(async () => {
  doc = stubDocument();
  pane = await import("../src/ui/harness/views/agent-work.js");
  lib = await import("../src/ui/harness/lib/agent-work.js");
});
after(() => doc.restore());

const S = 1000;
/** An ended ask of your agent's, its words as the list's heads carry them. @param {number} start @param {Record<string, any>} [o] */
const ask = (start, o = {}) => ({ prompt: `PROMPT ${start}`, description: `Task ${start}`, by: "agent", runId: null, status: "done", startedAt: NOW - start * S, endedAt: NOW - (start - 10) * S, delivery: "tool", report: `ANSWER ${start}`, spentUsd: 0.01, sentIn: { run: "turn-1", round: 3 }, ...o });
/** @param {string} id @param {string} name @param {any[]} exchanges */
const thread = (id, name, exchanges) => agentRow(id, { origin: "agent", card: { tag: name.toLowerCase(), name }, model: "m", status: "done", exchanges });
/** @param {any} el @param {string} id @returns {any} */
const box = (el, id) => el.querySelector(`[data-box="${id}"]`);
/** The detail's words, by part. @param {any} el */
const detail = (el) => ({ asked: el.querySelector('[data-key="asked-words"]')?.textContent ?? null, answer: el.querySelector('[data-key="answer-words"]')?.textContent ?? null, note: el.querySelector('[data-key="reading"]')?.textContent ?? null });
const tick = () => new Promise((r) => setImmediate(r));
/** The pane over rows, its thread reads answered by the test. @param {any[]} rows */
const paneOf = (rows) => {
  /** @type {{ thread: string, answer: (v: any) => void, fail: (e: any) => void }[]} */
  const reads = [];
  const p = pane.createWorkPane({
    work: () => lib.workOf({ rows, turns: [{ runId: "turn-1", n: 1, userText: "fix it" }] }),
    cards: () => [],
    openThread: () => {},
    now: () => NOW,
    whole: (thread) => new Promise((answer, fail) => reads.push({ thread, answer, fail })),
  });
  const el = /** @type {any} */ (p.el);
  doc.document.body.append(el);
  const chat = { chainId: "c1" };
  p.paint(chat);
  return { el, reads, paint: () => p.paint(chat) };
};

// (fails before: yes — the box's detail drew the list's words alone: no read, the head for the whole)
test("a picked box whose words the list cut reads its thread once, its first words and a note until they land, then 4,000 characters as ever; a box held whole reads nothing", async () => {
  const long = `W${"w".repeat(4999)}`;
  const v = paneOf([
    thread("s1", "Scout", [ask(100, { prompt: "HEAD OF THE ASK…", promptHead: true, report: "HEAD OF THE ANSWER…", reportHead: true }), ask(90, { report: "HEAD 2…", reportHead: true, sentIn: { run: "turn-1", round: 4 } })]),
    thread("b1", "Builder", [ask(50)]),
  ]);
  box(v.el, "b1#0").dispatch("click");
  assert.deepEqual(detail(v.el), { asked: "PROMPT 50", answer: "ANSWER 50", note: null }, "held whole: as the list has it");
  assert.equal(v.reads.length, 0, "and nothing read");
  box(v.el, "s1#0").dispatch("click");
  assert.deepEqual(detail(v.el), { asked: "HEAD OF THE ASK…", answer: "HEAD OF THE ANSWER…", note: "Reading its whole words…" }, "its first words, reading the rest");
  assert.deepEqual(v.reads.map((r) => r.thread), ["s1"]);
  v.paint();
  assert.equal(v.reads.length, 1, "read once, however often drawn");
  v.reads[0].answer([{ asked: "THE WHOLE ASK", answer: long }, { asked: "PROMPT 90", answer: "THE SECOND WHOLE" }]);
  await tick();
  assert.deepEqual(detail(v.el), { asked: "THE WHOLE ASK", answer: `${long.slice(0, 3999)}…`, note: null }, "whole, to 4,000 characters as the list ever showed it");
  box(v.el, "s1#1").dispatch("click");
  assert.deepEqual([detail(v.el).answer, v.reads.length], ["THE SECOND WHOLE", 1], "its thread's other box: from the same read");
  box(v.el, "s1#0").dispatch("click");
  assert.equal(v.reads.length, 1, "picked again: kept, not read again");
});

// (fails before: yes — no read at all)
test("a read that fails leaves the list's words with a word that they are its first, and the box's next pick reads again", async () => {
  const v = paneOf([thread("s1", "Scout", [ask(100, { prompt: "HEAD…", promptHead: true })])]);
  box(v.el, "s1#0").dispatch("click");
  v.reads[0].fail(new Error("gone"));
  await tick();
  assert.deepEqual(detail(v.el), { asked: "HEAD…", answer: "ANSWER 100", note: "These are its first words: the rest could not be read. Its thread has them whole." });
  v.paint();
  assert.equal(v.reads.length, 1, "not read again at each drawing");
  box(v.el, "s1#0").dispatch("click");
  box(v.el, "s1#0").dispatch("click");
  assert.equal(v.reads.length, 2, "its next pick reads again");
  v.reads[1].answer(null);
  await tick();
  assert.equal(detail(v.el).note, "These are its first words: the rest could not be read. Its thread has them whole.", "a thread Filament holds no longer: the same");
  assert.equal(lib.workOf({ rows: [thread("s1", "Scout", [ask(100, { promptHead: true })])], turns: [] }).steps[0].boxes[0].cut, true, "the box says its words were cut");
});
