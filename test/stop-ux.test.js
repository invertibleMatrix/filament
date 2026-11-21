// @ts-check
// BUG-09 (FILAMENT Bug Tracker, 2026-09-30): the stop's surfaces said the wrong things once a stop became immediate.
// The bubble read "stop — Waiting for the run's next step…" (its text "stop" live, nothing after a reload); a command
// the stop killed was a red "Failed" card ending "Command exited with code ?"; the Stop button kept spinning and
// ignored a second click. A stop is an action: a fixed chip, "Stopping…" → "Stopped"; a cut command is a soft
// "Stopped" whose output stays; the button stands down until the turn ends.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { steerWords, alignEvents, toolLabel } from "../src/ui/harness/lib/labels.js";
import { statusOf, factsOf, refusedWhy } from "../src/ui/harness/conversation/tools/layout.js";
import { archivedStubs, stoppedResult } from "../src/ui/harness/conversation/tools/render.js";

describe("the stop bubble", () => {
  test("a stop is a fixed chip with its own states; a stop that found the turn over is no failure", () => {
    assert.deepEqual(steerWords({ kind: "stop", text: "" }), { tone: "pending", action: true, text: "■ Stop", state: "Stopping…" });
    assert.deepEqual(steerWords({ kind: "stop", text: "stop", read: true }), { tone: "read", action: true, text: "■ Stop", state: "Stopped" }, "the same chip live and after a reload");
    assert.equal(steerWords({ kind: "stop", unread: true }).state, "Nothing to stop — the turn had already finished");
    assert.equal(steerWords({ kind: "stop", undelivered: true }).state, "Not delivered: no run was listening");
    assert.equal(steerWords({ kind: "compact" }).state, "Compacting at the loop's next step…");
    assert.equal(steerWords({ kind: "compact", read: true }).state, "Taken up by the loop");
  });
  test("a note and a veto keep their words", () => {
    assert.deepEqual(steerWords({ kind: "note", text: "also check the logs" }), { tone: "pending", action: false, text: "also check the logs", state: "Waiting for the run's next step…" });
    assert.equal(steerWords({ kind: "veto", text: "not that file", read: true }).state, "veto — Conversation steered");
  });
});

describe("a command the stop cut", () => {
  test("its card is a soft Stopped, live and after a reload; a real failure stays Failed", () => {
    const aligned = alignEvents([
      { type: "tool-start", round: 1, id: "b1", name: "bash", args: "node -e …" },
      { type: "tool-end", round: 1, id: "b1", name: "bash", ok: false, stopped: true, ms: 900, chars: 80 },
      { type: "tool-start", round: 1, id: "b2", name: "bash", args: "false" },
      { type: "tool-end", round: 1, id: "b2", name: "bash", ok: false, ms: 20, chars: 10 },
    ]);
    const tools = aligned.byRound.get(1)?.tools;
    assert.equal(tools?.get("b1")?.state, "stopped");
    assert.equal(tools?.get("b2")?.state, "failed");
    assert.deepEqual(statusOf({ state: "stopped" }), { word: "Stopped", title: "stopped with the turn — its output so far is below", soft: true });
    assert.equal(statusOf({ state: "failed" })?.soft, undefined, "only a real failure is destructive");
    assert.equal(toolLabel("bash", { command: "npm test" }, "stopped").startsWith("Stopped"), true);
    const stubs = archivedStubs([
      { name: "bash", isError: true, result: "Error: Command stopped with the turn after 3 seconds\n(no output)\n\n(the process was stopped with the turn)" },
      { name: "write", isError: true, result: "Not run: the developer stopped the turn before it ran." },
      { name: "bash", isError: true, result: "Error: boom\n\nCommand exited with code 1" },
    ]);
    assert.deepEqual(stubs.map((s) => s.state), ["stopped", "stopped", "failed"]);
    assert.equal(stoppedResult("Error: Command timed out after 600 seconds"), false, "a timeout is not the developer's stop");
  });
});

describe("a call that never ran (backlog A3: a refused sleep read \"304 chars\")", () => {
  test("has no size and no time, and a refusal with a reason says it in place of the permission mode", () => {
    const aligned = alignEvents([
      { type: "tool-start", round: 1, id: "s1", name: "bash", args: "sleep 30" },
      { type: "tool-end", round: 1, id: "s1", name: "bash", ok: false, ms: 3, chars: 304, refused: true, reason: "it only sleeps while a background sub-agent runs; the model was pointed at wait" },
      { type: "tool-start", round: 1, id: "p1", name: "write", args: "a.txt" },
      { type: "tool-end", round: 1, id: "p1", name: "write", ok: false, ms: 0, chars: 0, refused: true },
    ]);
    const tools = aligned.byRound.get(1)?.tools;
    const sleep = tools?.get("s1");
    assert.equal(factsOf(sleep), "", "the 304 chars were the refusal's own words");
    assert.equal(factsOf(tools?.get("p1")), "", "nor \"0 chars\" on a permission refusal");
    assert.equal(statusOf(sleep)?.title, "not run: it only sleeps while a background sub-agent runs; the model was pointed at wait");
    // The command card's facts line says why too (the sleep is a bash call: its card is the command card).
    assert.equal(refusedWhy(sleep), "it only sleeps while a background sub-agent runs; the model was pointed at wait");
    assert.equal(refusedWhy({ state: "refused", rule: "bash(rm *)", reason: "x" }), "rule bash(rm *)", "a rule names itself first");
    assert.equal(refusedWhy({ state: "refused", hook: "guard.sh" }), "hook guard.sh");
    assert.equal(refusedWhy({ state: "refused" }), "", "the permission mode's refusal: the status says it");
    assert.equal(refusedWhy({ state: "done", reason: "x" }), "", "a call that ran has no refusal");
    // ...and the command card puts it on its facts line (the drawing needs a DOM, so its source says it).
    const render = readFileSync("src/ui/harness/conversation/tools/render.js", "utf8");
    assert.match(render, /const why = refusedWhy\(t\);\s*\n\s*const rest = \[code, facts, why\]\.filter\(Boolean\);/);
    assert.equal(statusOf(tools?.get("p1"))?.title, "refused by the permission mode");
    assert.equal(factsOf({ state: "declined", chars: 0, ms: 45000 }), "", "the wait for an answer is not the call's time");
    assert.equal(factsOf({ state: "vetoed", chars: 12 }), "");
    assert.equal(factsOf({ state: "done", chars: 304, ms: 1500 }), "304 chars · 1.5s", "a call that ran keeps its facts");
    assert.equal(factsOf({ state: "stopped", chars: 80 }), "80 chars", "a stopped call ran: its output so far counts");
  });
});

describe("the Stop button stands down (source contract: the page boots a DOM at import)", () => {
  test("a stop sent puts the button in Stopping…, and the turn's end resets it", () => {
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    const at = app.indexOf("async function stopCurrent");
    const block = app.slice(at, at + 3200);
    assert.match(block, /composer\.setStopping\(true, !!chat\.compactAfter\)/, "sending a stop stands the button down");
    const composer = readFileSync("src/ui/harness/composer/composer.js", "utf8");
    assert.match(composer, /const setStopping = \(on, compacts = false\) => \{[\s\S]*?stopBtn\.disabled = on;[\s\S]*?stopBtn\.classList\.toggle\("stopping", on\)/);
    assert.match(composer, /stopBtn\.classList\.toggle\("hidden", !on\);\s*\n\s*setStopping\(false\);/, "every live state change resets it");
    const aqua = readFileSync("src/ui/harness/aqua.css", "utf8");
    assert.match(aqua, /\.composer-shell \.stop\.stopping::before \{ animation: none;/, "the ring rests");
  });

  // (fails before: yes — with no turn of its own the page returned without a word: a turn it had lost its hold of ran on
  // under every press of Stop, and a stop the server had nothing to take read as one that landed)
  test("Stop with no turn of the page's asks the session's stop, and says what it found", () => {
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    const at = app.indexOf("async function stopCurrent");
    const block = app.slice(at, app.indexOf("const FORCE_OFFER_MS"));
    assert.doesNotMatch(block, /if \(!live\) return;/, "no silent way out");
    // The chat's own session: a turn the page lost its hold of is found there by its run.
    assert.match(block, /if \(!live\) \{[\s\S]*?const chainId = chat\?\.chainId;\s*if \(!chainId\) return;\s*try \{\s*const out = await api\(`\/sessions\/\$\{encodeURIComponent\(String\(chainId\)\)\}\/stop`, \{ method: "POST" \}\);/);
    assert.match(block, /offerForceForRun\(chat, runToForce\(out\)\);\s*toast\(stopReached\(out\) \? `Stopping the turn running in this session[^`]*` : NOTHING_TO_STOP\);\s*if \(!stopReached\(out\) && chatOf\(state\.currentId\) === chat\) composer\.setLive\(false, null, "done"\);\s*hydrate\(chat\)\.catch\(\(\) => \{\}\);/);
    // The page's own turn with no run id yet: a stop that reached nothing is said before the page stops reading.
    assert.match(block, /if \(out\?\.stopped === "steered"\) return offerForceLater\(chat, live\);\s*if \(out && !stopReached\(out\)\) toast\(NOTHING_TO_STOP\);\s*live\.aborter\.abort\(\);/);
    assert.match(readFileSync("src/ui/harness/lib/stops.js", "utf8"), /export const stopReached = \(out\) => !!out\?\.stopped;/);
    assert.match(app, /const NOTHING_TO_STOP = "No turn is running in this session: there was nothing to stop";/);
  });
});
