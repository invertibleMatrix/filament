// @ts-check
// A coding agent's own share of its context — its prompt and tools, which its every fresh session holds — fitted over
// its fresh sessions' starts (HarnessV4_Tasks C33; the owner's look of 10-24). A start's first count is the agent's own
// part plus what Filament sent, which Filament knows by its estimate alone: on a big seed the estimate's error lands in
// the agent's share (the owner's chat said "plus its own ≈78.6K" from a 114K seed, measured once).
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentOwn, disposeTokenCalib, forgetTokenCalib, initTokenCalib, observeAgentStart, ownFit } from "../src/services/token-calib.js";
import { removeDirs } from "./helpers/wait.js";

/** A start whose agent holds `own` of its own and counts what Filament sent `scale` times Filament's estimate. */
const start = (/** @type {number} */ sent, own = 40_000, scale = 1.5) => ({ first: Math.round(own + scale * sent), sent });

describe("the fit (ownFit)", () => {
  // (fails before: yes — the share was one start's first count less the estimate: 78.6K)
  test("a big seed alone books the estimate's shortfall as the agent's; with a small start beside it the line tells the two apart", () => {
    const seed = start(76_400);
    assert.deepEqual(ownFit([seed]), { own: 154_600 - 76_400, scale: null, n: 1 }, "one start: all the fit can say");
    assert.deepEqual(ownFit([seed, start(3_000)]), { own: 40_000, scale: 1.5, n: 2 });
    assert.deepEqual(ownFit([start(3_000), start(2_000), start(76_400), start(51_000)]), { own: 40_000, scale: 1.5, n: 4 });
  });

  test("with no spread to fit, the start where Filament sent least: its error is the least", () => {
    assert.deepEqual(ownFit([start(3_000), start(4_000)]), { own: Math.round(44_500 - 3_000), scale: null, n: 2 }, "a thousand tokens apart is no line");
    assert.deepEqual(ownFit([start(70_000), start(76_400)]), { own: 145_000 - 70_000, scale: null, n: 2 }, "two big seeds: a tenth apart is no line either");
  });

  test("a line the starts cannot hold — a scale no estimate is off by, an own part past a first count — gives way to the least-sent start", () => {
    // The agent's own part grew between them (servers added, a longer memory index): 40K, then 150K.
    const grew = [start(3_000), start(60_000, 150_000)];
    const fit = ownFit(grew);
    assert.equal(fit?.scale, null, `a scale of ${((240_000 - 44_500) / 57_000).toFixed(2)} stays out`);
    assert.equal(fit?.own, 44_500 - 3_000);
    assert.deepEqual(ownFit([{ first: 50_000, sent: 0 }, { first: 51_000, sent: 40_000 }]), { own: 50_000, scale: null, n: 2 }, "a scale under a half");
    assert.equal(ownFit([]), null);
    assert.equal(ownFit([{ first: 0, sent: 10 }]), null, "a start with no count is none");
  });
});

describe("the starts, kept by agent and folder", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-own-fit-"));
  const file = join(dir, "token-calib.json");
  after(async () => {
    disposeTokenCalib(file);
    await removeDirs(dir);
  });

  test("kept across chats in one folder, apart for another folder or agent, on disk, the newest twelve; Forget drops them", () => {
    initTokenCalib({ file, uncalibrated: () => true });
    observeAgentStart("Claude", "H:\\proj\\", 154_600, 76_400);
    assert.deepEqual(agentOwn("claude", "h:/proj"), { own: 78_200, scale: null, n: 1 }, "one spelling of the folder, any case or slash");
    observeAgentStart("claude", "H:\\proj", 44_500, 3_000);
    assert.deepEqual(agentOwn("claude", "H:\\proj"), { own: 40_000, scale: 1.5, n: 2 });
    assert.equal(agentOwn("claude", "H:\\other"), null, "another folder holds other instruction files");
    assert.equal(agentOwn("codex", "H:\\proj"), null);
    observeAgentStart("claude", "H:\\proj", 0, 10);
    assert.equal(agentOwn("claude", "H:\\proj")?.n, 2, "a start with no count is not kept");
    disposeTokenCalib(file);
    const kept = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(kept["claude::own::h:/proj"].starts.map((/** @type {any} */ s) => [s.first, s.sent]), [[154_600, 76_400], [44_500, 3_000]]);
    initTokenCalib({ file, uncalibrated: () => true });
    assert.deepEqual(agentOwn("claude", "H:\\proj"), { own: 40_000, scale: 1.5, n: 2 }, "read back after a restart, though the agent's upstream is never calibrated");
    for (let i = 0; i < 14; i++) observeAgentStart("claude", "H:\\proj", 44_500 + i, 3_000);
    assert.equal(agentOwn("claude", "H:\\proj")?.n, 12);
    assert.equal(forgetTokenCalib("claude::own::h:/proj"), true);
    assert.equal(agentOwn("claude", "H:\\proj"), null);
  });

  test("nothing is kept or read before the store has a file", () => {
    disposeTokenCalib(file);
    observeAgentStart("claude", "H:\\proj", 44_500, 3_000);
    assert.equal(agentOwn("claude", "H:\\proj"), null);
  });
});
