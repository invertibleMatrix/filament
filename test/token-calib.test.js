// @ts-check
// The token estimator's two halves: the class-weighted heuristic (core/tokens.js) and the self-calibration that
// learns each upstream+model's real ratio from the usage its replies already state (services/token-calib.js).
// Calibration is inert until initTokenCalib names a file — these tests opt in with a temp path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { estimateTokens, estimateBodyTokens, estimateBodyParts } from "../src/core/tokens.js";
import {
  initTokenCalib,
  calibFactor,
  observeRatio,
  observeCountedModel,
  totalInputOf,
  calibSnapshot,
  forgetTokenCalib,
  disposeTokenCalib,
} from "../src/services/token-calib.js";

test("the heuristic classes text instead of dividing by four", () => {
  // Prose stays near the old chars÷4 (that rate was honest for prose); code and JSON count denser because their
  // symbols are their own tokens; CJK is ~1 char/token.
  const prose = "The quick brown fox jumps over the lazy dog.";
  assert.ok(Math.abs(estimateTokens(prose) - Math.ceil(prose.length / 4)) <= 2, "prose ≈ chars/4");
  const code = 'const cfg = {"port": 8080, "host": "127.0.0.1"};';
  assert.ok(estimateTokens(code) > code.length / 4, "code counts denser than chars/4");
  assert.ok(estimateTokens("こんにちは世界") >= 6, "CJK ≈ 1 char/token");
  assert.equal(estimateTokens(null), 0);
  assert.equal(estimateTokens(""), 0);
});

test("estimateBodyTokens: images and framing are fixed, text is what a factor scales", () => {
  const body = {
    system: "You are helpful.",
    messages: [
      { role: "user", content: [{ type: "text", text: "hello " + "x".repeat(400) }] },
      { role: "user", content: [{ type: "image", source: { type: "base64", data: "A".repeat(400000) } }] },
    ],
  };
  const { text, fixed } = estimateBodyParts(body, "request");
  assert.equal(fixed, 1500 + 8, "one image at 1,500 tokens plus two messages' framing");
  assert.ok(text > 100, "the text part is the words");
  const plain = estimateBodyTokens(body, "request");
  assert.equal(plain, text + fixed);
  assert.equal(estimateBodyTokens(body, "request", 1.8), Math.round(text * 1.8) + fixed, "the factor scales text only");
  assert.equal(estimateBodyTokens(body, "request", null), plain, "null factor = the heuristic");
});

test("calibration: plausible ratios learn, mismatches and noise are discarded, three samples gate the factor", () => {
  const dir = mkdtempSync(join(tmpdir(), "calib-"));
  const file = join(dir, "token-calib.json");
  try {
    initTokenCalib({ file });
    assert.equal(calibFactor("up", "model-a"), null, "cold start: no factor");

    // Two observations are not enough.
    observeRatio("up", "model-a", () => 1000, 1500);
    observeRatio("up", "model-a", () => 1000, 1500);
    assert.equal(calibFactor("up", "model-a"), null, "under three samples the heuristic stands");

    observeRatio("up", "model-a", () => 1000, 1500);
    assert.equal(calibFactor("up", "model-a"), 1.5, "a consistent ratio is served exactly");

    // An implausible raw ratio (a usage summed over different bodies than the estimate) is discarded whole.
    observeRatio("up", "model-a", () => 1000, 5);
    observeRatio("up", "model-a", () => 1000, 99000);
    assert.equal(calibFactor("up", "model-a"), 1.5, "mismatches never touch the average");

    // The EWMA moves toward a new steady ratio and stays inside the observed band.
    for (let i = 0; i < 40; i++) observeRatio("up", "model-a", () => 1000, 2900);
    const f1 = calibFactor("up", "model-a");
    assert.ok(f1 != null && Math.abs(f1 - 2.9) < 0.01, "converges to the truth");

    // Tiny bodies carry more noise than signal.
    observeRatio("up", "model-b", () => 10, 30);
    observeRatio("up", "model-b", () => 10, 30);
    observeRatio("up", "model-b", () => 10, 30);
    assert.equal(calibFactor("up", "model-b"), null, "small bodies never learn");

    // Normalised usage: input excludes the cached parts, so all three sum to the tokenized prompt.
    assert.equal(totalInputOf({ input: 100, cacheRead: 40, cacheWrite: 10 }), 150);
    assert.equal(totalInputOf({}), null);
    assert.equal(totalInputOf(null), null);

    // Round-trip: dispose flushes, a fresh init over the same file serves what was learned.
    disposeTokenCalib();
    const onDisk = JSON.parse(readFileSync(file, "utf8"));
    assert.ok(onDisk["up::model-a"]?.n >= 40, "the file carries the samples");
    initTokenCalib({ file });
    const f2 = calibFactor("up", "model-a");
    assert.ok(f2 != null && Math.abs(f2 - 2.9) < 0.01, "learned ratios survive a restart");
    assert.ok(calibSnapshot().some((e) => e.key === "up::model-a"));
  } finally {
    disposeTokenCalib();
    rmSync(dir, { recursive: true, force: true });
    initTokenCalib({}); // back to inert for any test that runs after this one
  }
});

// The body's estimate is counted only for a reply calibration reads: every reply hands it over, and counting a whole
// body stringifies and hashes every tool block in it.
test("calibration counts the body's estimate only for a reply it learns from", () => {
  const dir = mkdtempSync(join(tmpdir(), "calib-lazy-"));
  const file = join(dir, "token-calib.json");
  let counted = 0;
  const estimate = () => (counted++, 1000);
  try {
    initTokenCalib({});
    observeRatio("up", "model-l", estimate, 1500);
    assert.equal(counted, 0, "calibration off: nothing counted");
    initTokenCalib({ file, uncalibrated: (id) => id === "agent-up" });
    observeRatio("agent-up", "model-l", estimate, 1500);
    assert.equal(counted, 0, "an upstream never calibrated: nothing counted");
    observeRatio("up", "model-l", estimate, 5);
    assert.equal(counted, 0, "a reply too small to read: nothing counted");
    for (let i = 0; i < 3; i++) observeRatio("up", "model-l", estimate, 1500);
    assert.equal(counted, 3, "a reply it reads: counted once each");
    assert.equal(calibFactor("up", "model-l"), 1.5, "and learned from as before");
  } finally {
    disposeTokenCalib();
    rmSync(dir, { recursive: true, force: true });
    initTokenCalib({});
  }
});

// (fails before: yes — nothing could say an upstream is never calibrated, so a coding agent's turns taught the estimator
// a "factor": what the agent holds of its own context over Filament's estimate of its own copy, two different texts)
test("an upstream that is never calibrated: nothing is learned from it, and a factor on file from before is neither served nor kept", () => {
  const dir = mkdtempSync(join(tmpdir(), "calib-never-"));
  const file = join(dir, "token-calib.json");
  try {
    writeFileSync(file, JSON.stringify({ "agent-up::opus": { f: 1.82, n: 9, at: 1 }, "api-up::opus": { f: 0.73, n: 9, at: 1 } }));
    initTokenCalib({ file, uncalibrated: (id) => id.toLowerCase() === "agent-up" });
    assert.equal(calibFactor("Agent-Up", "opus"), null, "a factor on file from before is not served");
    assert.equal(calibFactor("api-up", "opus"), 0.73, "another upstream's is");
    assert.deepEqual(calibSnapshot().map((e) => e.key).filter((k) => k.endsWith("::opus")), ["api-up::opus"], "nor kept");
    for (let i = 0; i < 5; i++) observeRatio("agent-up", "sonnet", () => 1000, 1500);
    assert.equal(calibFactor("agent-up", "sonnet"), null);
    assert.equal(calibSnapshot().some((e) => e.key.startsWith("agent-up::")), false, "nothing is learned from it");
    disposeTokenCalib();
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, "utf8"))).filter((k) => k.startsWith("agent-up::")), [], "and the file follows");
  } finally {
    disposeTokenCalib();
    rmSync(dir, { recursive: true, force: true });
    initTokenCalib({});
  }
});

// (fails before: yes — HarnessV4_Tasks C19: a coding agent's model was served no factor at all, so its session's copy
// was weighed on the plain estimate, a quarter high for the owner's Opus; the store had no word of which model an
// agent's own name stands for)
test("a coding agent's model borrows the factor of the model its turns were counted under, from the upstream that learned it best", () => {
  const dir = mkdtempSync(join(tmpdir(), "calib-borrow-"));
  const file = join(dir, "token-calib.json");
  /** @type {string[]} */
  const logged = [];
  const agent = (/** @type {string} */ id) => id.toLowerCase() === "agent-c19";
  const start = (uncalibrated = agent) => initTokenCalib({ file, uncalibrated, log: (_l, m) => logged.push(m) });
  /** A turn's counts: the session's model read the conversation, a helper wrote more and read little. @param {string} model */
  const turn = (model) => [{ model: "c19-helper", input: 300, output: 90, cacheRead: 0, cacheWrite: 0 }, { model, input: 10, output: 20, cacheRead: 50_000, cacheWrite: 0 }];
  const row = () => calibSnapshot().find((e) => e.key === "agent-c19::opus");
  try {
    writeFileSync(file, JSON.stringify({
      "api-c19::c19-opus-5-5": { f: 0.73, n: 9, at: 1 },
      "resold-c19::c19-opus-5-5": { f: 0.9, n: 3, at: 1 },
      "api-c19::c19-haiku": { f: 0.92, n: 2, at: 1 },
      "api-c19::c19-helper": { f: 2.5, n: 50, at: 1 },
    }));
    start();
    assert.equal(calibFactor("agent-c19", "opus"), null, "no turn has named a model yet: the plain estimate");
    observeCountedModel("api-c19", "anything", turn("c19-opus-5-5"));
    assert.equal(calibSnapshot().some((e) => e.key === "api-c19::anything"), false, "an upstream that is calibrated learns its own: no name is kept for it");

    observeCountedModel("Agent-C19", "Opus", turn("C19-Opus-5-5"));
    assert.equal(calibFactor("agent-c19", "opus"), 0.73, "the model that read the most names it (not the helper, which wrote more), from the upstream with the most replies");
    assert.deepEqual({ ...row(), at: 0 }, { key: "agent-c19::opus", as: "c19-opus-5-5", from: "api-c19::c19-opus-5-5", f: 0.73, n: 9, at: 0 });
    assert.ok(logged.includes("estimator ×0.73 for agent-c19::opus, borrowed from api-c19::c19-opus-5-5: the model its turns were counted under (observability.tokenCalibration)"), logged.join("\n"));
    assert.equal(calibFactor("agent-c19", "sonnet"), null, "another model of the agent's has its own name to learn");

    // One turn on another model moves nothing; a second running does. That model's factor has two replies: not served.
    observeCountedModel("agent-c19", "opus", turn("c19-haiku"));
    assert.equal(calibFactor("agent-c19", "opus"), 0.73, "one turn retried on another model changes nothing");
    observeCountedModel("agent-c19", "opus", turn("c19-opus-5-5"));
    observeCountedModel("agent-c19", "opus", turn("c19-haiku"));
    assert.equal(calibFactor("agent-c19", "opus"), 0.73, "nor do two that were not running");
    observeCountedModel("agent-c19", "opus", turn("c19-haiku"));
    assert.deepEqual([calibFactor("agent-c19", "opus"), row()?.as, row()?.from, row()?.f, row()?.n], [null, "c19-haiku", null, null, 0], "two turns running rename it; a model under three replies lends nothing");
    observeCountedModel("agent-c19", "opus", turn("c19-opus-5-5"));
    observeCountedModel("agent-c19", "opus", turn("c19-opus-5-5"));
    assert.equal(calibFactor("agent-c19", "opus"), 0.73);
    for (const none of [null, [], [{ input: 5 }]]) observeCountedModel("agent-c19", "opus", /** @type {any} */ (none));
    assert.equal(row()?.as, "c19-opus-5-5", "a turn that names no model says nothing");

    // Kept across a restart, in the same file; gone when the upstream is no agent's any more, or on Forget.
    disposeTokenCalib();
    assert.deepEqual({ ...JSON.parse(readFileSync(file, "utf8"))["agent-c19::opus"], at: 0 }, { as: "c19-opus-5-5", next: null, at: 0 });
    start();
    assert.equal(calibFactor("agent-c19", "opus"), 0.73, "the name is on file");
    assert.equal(forgetTokenCalib("agent-c19::opus"), true);
    assert.deepEqual([calibFactor("agent-c19", "opus"), row()], [null, undefined]);
    observeCountedModel("agent-c19", "opus", turn("c19-opus-5-5"));
    disposeTokenCalib();
    start(() => false);
    assert.equal(calibFactor("agent-c19", "opus"), null);
    assert.equal(row(), undefined, "an upstream that is calibrated now keeps no name: it learns its own factor");
  } finally {
    disposeTokenCalib();
    rmSync(dir, { recursive: true, force: true });
    initTokenCalib({});
  }
});

test("calibration is inert until the server initializes it", () => {
  initTokenCalib({});
  observeRatio("up", "model-x", () => 1000, 2000);
  observeRatio("up", "model-x", () => 1000, 2000);
  observeRatio("up", "model-x", () => 1000, 2000);
  assert.equal(calibFactor("up", "model-x"), null, "no file: nothing observed, nothing served");
});
