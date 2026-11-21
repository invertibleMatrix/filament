// @ts-check
// Pure helpers extracted into ui/components in Phase 5.2. The widgets that need a document
// (schemaForm, the drawer, the palette, the requests table) stay browser-verified with the pages.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isLeaf,
  flatten,
  getPath,
  setPath,
  defaultsOf,
  mergedRules,
} from "../src/ui/components/schema-form.js";
import { readFileSync } from "node:fs";
import { failReason, failStep, failoverTrail, phaseOf, liveCells, streamedOf, QUIET_WORDS } from "../src/ui/components/requests-table.js";

describe("ui/components/schema-form", () => {
  test("isLeaf, getPath, setPath and flatten agree on a nested object", () => {
    assert.equal(isLeaf({ type: "number", description: "n", default: 1 }), true);
    assert.equal(isLeaf({ _doc: "group", n: { type: "number", description: "n", default: 1 } }), false);
    const o = { a: { b: 1 } };
    assert.equal(getPath(o, "a.b"), 1);
    setPath(o, "a.c", 2);
    assert.deepEqual(flatten(o), { "a.b": 1, "a.c": 2 });
    setPath(o, "a.b", undefined);
    assert.equal("b" in o.a, false);
  });
  test("mergedRules overlays layers on schema defaults", () => {
    const schema = {
      thinking: { type: "enum", description: "t", default: "auto" },
      nested: { x: { type: "number", description: "x", default: 3 } },
    };
    assert.deepEqual(defaultsOf(schema), { thinking: "auto", nested: { x: 3 } });
    assert.deepEqual(mergedRules(schema, { nested: { x: 9 } }, { thinking: "off" }), {
      thinking: "off",
      nested: { x: 9 },
    });
  });
});

describe("ui/components/requests-table", () => {
  // (fails before: yes — a pending record with a first byte and no phase was read as in flight from its ttftMs)
  test("phaseOf reads the server's phase: the record says it, the table never infers it", () => {
    assert.equal(phaseOf({ status: "ok" }), null);
    assert.equal(phaseOf({ status: "pending", phase: "streaming" }), "streaming");
    assert.equal(phaseOf({ status: "pending", phase: "pending", ttftMs: 12 }), "pending");
    assert.equal(phaseOf({ status: "pending", ttftMs: 12 }), undefined);
  });
  // (fails before: yes — HarnessV4_Tasks U1; HarnessV3-FailurePoints §5.1 item 1, §14.4: the live list said the three
  // facts each second and the row drew its time and speed alone — a call quiet for minutes read as any other)
  test("a running row: what has streamed so far, how long since its newest byte, and quiet once none comes", () => {
    const live = { status: "pending", phase: "streaming", liveOutTokens: 9_812, liveThinkTokens: 9_800, sinceOutputMs: 900, stalled: false };
    assert.deepEqual(liveCells(live), { out: `~${(9812).toLocaleString()}`, outTitle: "streamed so far, thinking included: tokens estimated from the characters", think: `~${(9800).toLocaleString()}`, lastByte: "last byte 900 ms ago", quiet: "" });
    const stuck = liveCells({ ...live, liveThinkTokens: null, sinceOutputMs: 420_000, stalled: true });
    assert.deepEqual([stuck.think, stuck.lastByte, stuck.quiet], ["–", "last byte 420.0 s ago", "quiet 420.0 s"]);
    assert.deepEqual(liveCells({ status: "pending", phase: "pending", stalled: true, sinceOutputMs: null }), { out: "–", outTitle: "no byte of the reply yet", think: "–", lastByte: "no byte of the reply yet", quiet: "" });
    assert.deepEqual(liveCells({ status: "pending", phase: "streaming", sinceOutputMs: 10 }).out, "~0");
    assert.match(QUIET_WORDS, /^No byte of the reply has arrived for this long: /);
    // The page's side (source contract: the dashboard boots a DOM at import).
    const app = readFileSync("src/ui/app.js", "utf8");
    assert.match(app, /const cells = liveCells\(r\);\n\s*tr\.querySelector\("\.c-status"\)\?\.replaceChildren\(\.\.\.\[statusPill\(r\), cells\.quiet \? h\("span", \{ class: "pill warn", title: QUIET_WORDS \}, cells\.quiet\) : null,/);
    assert.match(app, /if \(tot\) \{ tot\.textContent = fmt\.ms\(r\.elapsedMs\); tot\.title = cells\.lastByte; \}\n\s*const out = tr\.querySelector\("\.c-out"\); if \(out\) \{ out\.textContent = cells\.out; out\.title = cells\.outTitle; \}\n\s*const think = tr\.querySelector\("\.c-think"\); if \(think\) think\.textContent = cells\.think;/);
  });
  // (fails before: yes — HarnessV4_Tasks U1; §5.1 item 4: the record of a call that failed mid-stream kept what had
  // streamed and no page read it — its row showed no output at all)
  test("a call that ended without its reply says what had streamed: on its row's cells and in its drawer", () => {
    assert.deepEqual(streamedOf({ status: "error", thinkingChars: 39_200, textChars: 480 }), { out: 9_920, thinking: 9_800, words: `About ${(9800).toLocaleString()} tokens of thinking and 120 tokens of text had streamed before it ended (estimated from the characters).` });
    assert.deepEqual(streamedOf({ status: "aborted", thinkingChars: 0, textChars: 41 }), { out: 11, thinking: 0, words: "About 11 tokens of text had streamed before it ended (estimated from the characters)." });
    assert.deepEqual(streamedOf({ status: "error", thinkingChars: 8 })?.words, "About 2 tokens of thinking had streamed before it ended (estimated from the characters).");
    assert.deepEqual([streamedOf({ status: "error" }), streamedOf({ status: "error", thinkingChars: 0, textChars: 0 }), streamedOf({ status: "ok", textChars: 900 }), streamedOf({ status: "pending", textChars: 900 }), streamedOf(null)], [null, null, null, null, null]);
    const table = readFileSync("src/ui/components/requests-table.js", "utf8");
    assert.match(table, /const kept = streamedOf\(r\);\n\s*const keptOut = kept && r\.tokens\?\.output == null;\n\s*const keptThink = !!kept\?\.thinking && r\.tokens\?\.thinking == null;/, "a usage that did come stands");
    assert.match(table, /h\("td", \{ class: "c-out", title: keptOut \? kept\.words : tip \}, keptOut \? `~\$\{fmt\.n\(kept\.out\)\}` : est \+ fmt\.n\(r\.tokens\?\.output\)\),/);
    assert.match(table, /h\("td", \{ class: "c-think", title: keptThink \? kept\.words : null \}, keptThink \? `~\$\{fmt\.n\(kept\.thinking\)\}` : fmt\.n\(r\.tokens\?\.thinking\)\),/);
    assert.match(readFileSync("src/ui/app.js", "utf8"), /streamedOf\(d\) \? h\("p", \{ class: "small muted" \}, streamedOf\(d\)\?\.words\) : null,/);
  });
  test("failReason prefers a recorded sentence over the status code", () => {
    assert.equal(failReason({ reason: "timed out" }), "timed out");
    assert.equal(failReason({ status: 429 }), "rate limit");
    assert.equal(failStep({ status: 404 }), "HTTP 404 (unknown model)");
  });
  test("failoverTrail prefers the structured field, then the change notes", () => {
    assert.equal(failoverTrail({}), null);
    const structured = failoverTrail({
      failover: { trail: [{ upstream: "a", status: 529 }], servedBy: "b" },
    });
    assert.ok(structured);
    assert.equal(structured.servedBy, "b");
    assert.equal(structured.trail.length, 1);
    // (fails before: yes — HarnessV4_Tasks B10: a trail nobody served read as served by the record's last upstream)
    assert.equal(failoverTrail({ upstream: "b", status: "error", failover: { trail: [{ upstream: "a", status: 529 }, { upstream: "b", status: null, reason: "ECONNREFUSED" }], servedBy: null } })?.servedBy, null);
    const notes = failoverTrail({ changes: ["failover: a cooled down"], upstream: "b", attempt: 2 });
    assert.ok(notes);
    assert.equal(notes.servedBy, "b");
    assert.equal(notes.trail[0].text, "a cooled down");
  });
});

// (fails before: yes — HarnessV4_Tasks U1, found in the live drive: a loop turn's row said "~0" and "quiet 19 s"
// while its model call streamed, and nothing of the tool it ran between calls)
test("a running turn's row: its model call's figures while one is in flight, and what it does between calls — never quiet for running a tool", async () => {
  const { liveCells } = await import("../src/ui/components/requests-table.js");
  const turn = { status: "pending", phase: "streaming", liveOutTokens: 42, liveThinkTokens: 9, sinceOutputMs: 400, stalled: false, now: { what: "model", model: "m", forMs: 4000 } };
  assert.deepEqual(liveCells(turn), { out: "~42", outTitle: "streamed so far by its model call in flight, thinking included: tokens estimated from the characters", think: "~9", lastByte: "last byte 400 ms ago", quiet: "" });
  const tool = liveCells({ ...turn, liveOutTokens: null, liveThinkTokens: null, sinceOutputMs: null, now: { what: "tool", name: "bash", args: "npm test", forMs: 60_000 } });
  assert.deepEqual(tool, { out: "–", outTitle: "no model call in flight — the turn runs bash", think: "–", lastByte: "no model call in flight — the turn runs bash", quiet: "" });
  assert.equal(liveCells({ ...turn, now: { what: "waiting", why: "waiting for its sub-agents", forMs: 1 } }).lastByte, "no model call in flight — waiting for its sub-agents");
  assert.equal(liveCells({ ...turn, now: { what: "working", forMs: 1 } }).outTitle, "no model call in flight — the turn works between calls");
  assert.equal(liveCells({ ...turn, stalled: true, sinceOutputMs: 8000 }).quiet, "quiet 8.0 s", "its call went quiet: so did it");
});
