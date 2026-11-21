// @ts-check
// Send without it (the filament-agent plan's D6), the page's side: while a turn waits on the summary Filament writes
// before its request, its live fold offers a way past it — one press lets the summary go, and the turn goes on folded
// (the service's skipWait, POST /sessions/:id/wait/skip; tested in sessions-api.test.js and memory-waits.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { workFold } from "../src/ui/harness/conversation/turn.js";
import { skipWaitWords } from "../src/ui/harness/lib/labels.js";

// (fails before: yes — the fold said "compacting first — summarizing the history" and offered nothing but the Stop)
test("the live fold offers Send without it while the turn waits on a summary: pressed once, its click never opens or closes the fold", () => {
  const doc = stubDocument();
  try {
    /** @type {string[]} */
    const asked = [];
    const turn = { status: "streaming", phase: { kind: "compacting", method: "summary", since: 1, skippable: true } };
    const fold = workFold(turn, { onSkip: () => asked.push("skip") });
    const btn = /** @type {any} */ (fold.el).querySelector(".work-skip");
    assert.ok(btn && !btn.classList.contains("hidden"), "shown while the summary is written");
    assert.equal(btn.textContent, "Send without it");
    let prevented = 0;
    let stopped = 0;
    btn.dispatch("click", { currentTarget: btn, preventDefault: () => prevented++, stopPropagation: () => stopped++ });
    assert.deepEqual([asked, btn.disabled, prevented, stopped], [["skip"], true, 1, 1], "asked once; the header's own click never hears it");
    fold.setSkip(false);
    assert.ok(btn.classList.contains("hidden") && !btn.disabled, "gone with the phase, ready for the next");
    const folding = workFold({ status: "streaming", phase: { kind: "compacting", method: "fold", since: 1 } }, { onSkip: () => {} });
    assert.ok(/** @type {any} */ (folding.el).querySelector(".work-skip").classList.contains("hidden"), "fold calls no model: nothing to let go");
    assert.equal(/** @type {any} */ (workFold(turn).el).querySelector(".work-skip"), null, "a page that wires no skip draws none");
  } finally {
    doc.restore();
  }
});

// (fails before: yes — HarnessV4_Tasks U1: over memory's recall and its capture the button was there (the phase says
// `skippable`), under the summary's tooltip: "Stop writing the summary… the older turns are folded instead")
test("Send without it says what it lets go, by the wait: the summary, memory's recall", () => {
  const doc = stubDocument();
  try {
    const summary = "Stop writing the summary and send your message now: the older turns are folded instead, which needs no model";
    const recall = "Send your message now, without what memory would recall for it";
    assert.deepEqual([skipWaitWords({ kind: "compacting" }), skipWaitWords({ kind: "recalling" }), skipWaitWords(null), skipWaitWords(false)], [summary, recall, summary, summary]);
    const turn = { status: "streaming", phase: { kind: "recalling", method: null, since: 1, skippable: true } };
    const fold = workFold(turn, { onSkip: () => {} });
    const btn = /** @type {any} */ (fold.el).querySelector(".work-skip");
    assert.deepEqual([btn.classList.contains("hidden"), btn.title], [false, recall], "drawn over a recall, in its words");
    // The turn's next wait: the same button, the next wait's words; a phase it cannot be sent without hides it.
    fold.setSkip({ kind: "compacting", method: "summary", skippable: true });
    assert.deepEqual([btn.classList.contains("hidden"), btn.title], [false, summary]);
    fold.setSkip({ kind: "agent", step: "starting" });
    assert.equal(btn.classList.contains("hidden"), true);
    fold.setSkip(null);
    assert.equal(btn.classList.contains("hidden"), true);
  } finally {
    doc.restore();
  }
});

test("the page's wiring: the fold gets the skip, the phase shows and hides it, the press posts the route", () => {
  const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  assert.match(timeline, /workFold\(turn, \{ onSkip: cb\.onSkipWait \? \(\) => cb\.onSkipWait\?\.\(chat, turn\) : null \}\)/);
  assert.match(timeline, /phase\(turn, phase\) \{[\s\S]{0,200}fold\?\.setSkip\?\.\(turn\.phase\);/);
  assert.match(app, /onSkipWait: \(chat\) => \{[\s\S]{0,120}api\(`\/sessions\/\$\{encodeURIComponent\(String\(chat\.chainId\)\)\}\/wait\/skip`, \{ method: "POST" \}\)\.catch\(\(e\) => toast\(errText\(e\), "err"\)\);/);
});
