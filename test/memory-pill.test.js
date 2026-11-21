// @ts-check
// A memory tool's pill opens on a press to show what the tool returned (the owner's of 10-28: "when memory tool is used
// i should be able to click that chip or pill and it should expand and show the content of that tool output"). It was
// a row with no card: nothing to open. And while it ran it said the tool's own name, not what it looked for.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { alignEvents } from "../src/ui/harness/lib/labels.js";
import { archivedRows, roundRows } from "../src/ui/harness/conversation/tools/render.js";
import { argSummary } from "../src/app/agent/tools.js";
import { createAgentRun } from "../src/app/agent-run.js";
import { cardOf } from "../src/core/tool-vocab.js";

/** @type {ReturnType<typeof stubDocument>} */
let doc;
before(() => {
  doc = stubDocument();
});
after(() => doc.restore());

// (fails before: yes — the pill was a plain row, its result nowhere on the page)
test("a recall's pill opens on what memory returned, a JSON answer laid out", () => {
  const result = JSON.stringify({ facts: [{ id: "i3", text: "Deploys go through staging first" }] });
  const row = /** @type {any} */ (archivedRows([{ id: "m1", name: "filament_memory_search", input: { query: "deploy" }, result }])[0]);
  assert.equal(row.tagName, "DETAILS", "a pill that opens");
  assert.equal(row.open, false, "folded until pressed");
  assert.match(row.querySelector("summary").textContent, /Recalled[\s\S]*deploy/);
  const out = row.querySelector(".term-out")?.textContent || "";
  assert.match(out, /Deploys go through staging first/);
  assert.match(out, /\n {2}"facts": \[/, "laid out, one key a line");
});

// (fails before: yes — live, the pill said "filament_memory_search", and opened on nothing once it ended)
test("live, the pill says what it looks for as it runs, and opens on memory's answer once it ended", () => {
  const input = { query: "how we deploy" };
  assert.equal(argSummary("filament_memory_search", input), "how we deploy");
  assert.equal(argSummary("filament_memory_load", { session: "lx29n81a" }), "lx29n81a");
  assert.equal(argSummary("filament_memory_confirm", { id: "i89" }), "i89");
  /** @type {any[]} */
  const events = [{ type: "tool-start", round: 1, name: "filament_memory_search", args: argSummary("filament_memory_search", input), id: "s1", ts: Date.now() }];
  const [running] = roundRows(alignEvents(events).byRound.get(1), { live: true });
  assert.match(running.textContent, /Recalling[\s\S]*how we deploy/);
  assert.doesNotMatch(running.textContent, /filament_memory_search/);
  assert.equal(running.tagName, "DIV", "while it runs there is nothing to show yet");
  events.push({ type: "tool-end", round: 1, name: "filament_memory_search", ok: true, ms: 40, id: "s1", chars: 31, preview: "Deploys go through staging first" });
  const [done] = roundRows(alignEvents(events).byRound.get(1), { live: true });
  assert.equal(done.tagName, "DETAILS");
  assert.equal(done.querySelector(".term-out")?.textContent, "Deploys go through staging first", "a plain answer as it came");
});

// (fails before: yes — the owner's drive of 10-29: a remember memory's tools were off for read "Remembered", Failed)
test("a memory call that failed or never ran is named by what it asked, not by what it would have done", () => {
  const off = "Not run: memory's tools are off in this chat. Go on without them.";
  for (const [name, input, said] of /** @type {[string, any, RegExp][]} */ ([["filament_memory_remember", { text: "Notes live in docs/", kind: "fact" }, /^Remember(?!ing|ed)/], ["filament_memory_search", { query: "notes" }, /^Recall(?!ing|ed)/]])) {
    const events = [
      { type: "tool-start", round: 1, name, args: argSummary(name, input), id: "x1", card: cardOf(name, input), ts: Date.now() },
      { type: "tool-end", round: 1, name, ok: false, ms: 0, id: "x1", chars: off.length, preview: off },
    ];
    const [row] = roundRows(alignEvents(events).byRound.get(1), { live: true });
    const head = row.querySelector("summary")?.textContent || row.textContent;
    assert.match(head.trim(), said, head);
    assert.doesNotMatch(head, /Remembered|Recalled/);
    assert.equal(row.querySelector(".term-out")?.textContent, off, "opened, why");
  }
  // One that ran says what it did.
  const ran = [
    { type: "tool-start", round: 1, name: "filament_memory_remember", args: "x", id: "x2", card: cardOf("filament_memory_remember", { text: "x" }), ts: Date.now() },
    { type: "tool-end", round: 1, name: "filament_memory_remember", ok: true, ms: 3, id: "x2", chars: 9, preview: '{"stored":true}' },
  ];
  const [done] = roundRows(alignEvents(ran).byRound.get(1), { live: true });
  assert.match((done.querySelector("summary")?.textContent || "").trim(), /^Remembered/);
});

// (fails before: yes — a remember's row carried its words' first line and nothing else)
test("a remember's pill opens on the whole words it kept, the rest of its input, then memory's answer", () => {
  const text = "How to ship: 1. run tsc\n2. run the full suite\n3. look at it on a throwaway";
  const [row] = archivedRows([{ id: "m3", name: "filament_memory_remember", input: { text, kind: "procedure" }, result: "Remembered as i104 (procedure)" }]);
  assert.equal(row.querySelector(".term-cmd")?.textContent, text, "the words its row cuts, whole");
  assert.equal(row.querySelector(".mem-given")?.textContent, "kind: procedure");
  assert.equal(row.querySelector(".term-out")?.textContent, "Remembered as i104 (procedure)");
});

// (fails before: yes — the owner's of 10-28, a screenshot: a coding agent's remember read "Remembered
// filament_memory_remember", and opened on `{"stored": true}` alone, the words it kept nowhere)
test("a coding agent's memory call over MCP reads as what it keeps, and opens on its input over its answer", () => {
  /** @type {any[]} */
  const events = [];
  const run = createAgentRun({ publish: (e) => events.push(e), sink: { breakBlock: () => 0 }, now: () => 1000 });
  const text = "Don't consult the Designer for small choices: decide and say what was decided.\nAsk only on a major design question.";
  const name = "mcp__filament__filament_memory_remember";
  run.take({ type: "tool", id: "r1", toolName: name, title: name, kind: "other", status: "in_progress", rawInput: { text, kind: "feedback" } });
  run.take({ type: "tool", id: "r1", toolName: name, status: "completed", content: [{ type: "content", content: { type: "text", text: '{"stored":true,"id":"i3464"}' } }] });
  const start = events.find((e) => e.type === "tool-start");
  assert.ok(start, "the call was drawn");
  assert.equal(start.card.subject, "Don't consult the Designer for small choices: decide and say what was decided.");
  assert.equal(start.card.whole, text, "the words kept whole on its card");
  assert.equal(start.card.given, "kind: feedback");
  const [row] = roundRows(alignEvents(events).byRound.get(start.round), { live: true });
  const head = row.querySelector("summary")?.textContent || "";
  assert.match(head, /Remembered[\s\S]*Don't consult the Designer/);
  assert.doesNotMatch(head, /filament_memory_remember/, "named by what it keeps, not the tool");
  assert.equal(row.querySelector(".term-cmd")?.textContent, text, "its input, whole");
  assert.equal(row.querySelector(".mem-given")?.textContent, "kind: feedback");
  assert.match(row.querySelector(".term-out")?.textContent || "", /"stored": true,\n {2}"id": "i3464"/, "then its answer, laid out");
});

// (a guard: the card keeps words now, and must keep no secret in them)
test("a memory call's words are redacted on its card, and a call with no input is named by its tool", () => {
  const card = cardOf("filament_memory_remember", { text: "The key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ for staging", kind: "fact" });
  assert.doesNotMatch(card.whole || "", /abcdefghijklmnopqrstuvwxyz0123456789/);
  assert.doesNotMatch(card.subject, /abcdefghijklmnopqrstuvwxyz0123456789/);
  assert.deepEqual(cardOf("filament_memory_search", null), { kind: "other", title: "filament_memory_search", subject: "filament_memory_search" });
});

test("a short query is not said twice, and a cut result says it is a preview", () => {
  const [row] = archivedRows([{ id: "m2", name: "filament_memory_grep", input: { text: "EADDRINUSE" }, result: '{"matches":[', resultChars: 4000 }]);
  assert.equal(row.querySelector(".term-cmd"), null, "the row already says it");
  assert.equal(row.querySelector(".term-out")?.textContent, '{"matches":[', "a cut JSON answer as it came");
  assert.match(row.querySelector(".pane-note")?.textContent || "", /Preview of 4000 characters/);
});
