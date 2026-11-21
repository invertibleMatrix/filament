// HarnessV3 Step 2, Phase 2D: the session-start choice (D15) — what a new chat holds until its first send, as the
// exact `POST /api/sessions` body ensureSession sends. Pure: the builder, not the DOM. A new chat starts from your
// defaults and the Start board's held changes: there are no presets (the owner's of 11-07).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sessionStartBody, chipStanding } from "../src/ui/harness/session-start.js";
import { flattenLayer, nestLayer } from "../src/ui/lib/settings/editor.js";

describe("the switch on an unborn chat (chipStanding)", () => {
  // (fails before: yes — HarnessV4_Settings_Plan HS-D48: the composer's one switch kept the mode shown for the chat
  // before, so a chat selected again showed another's mode, and its first send carried that one, not the one picked)
  test("the mode picked for the chat, with no note; else the board's held mode, else New chats start in — each saying whose", () => {
    assert.deepEqual(chipStanding({ permTouched: true, pickedPerm: "auto", heldPerm: "read-only" }, "ask"), { mode: "auto", note: null });
    assert.deepEqual(chipStanding({ heldPerm: "auto" }, "ask"), { mode: "auto", note: "from your held changes until you change it" });
    assert.deepEqual(chipStanding({}, "ask"), { mode: "ask", note: "from Settings › Permissions until you change it" });
    assert.deepEqual(chipStanding({}, null), { mode: "edit", note: "from Settings › Permissions until you change it" }, "before your defaults are read: Filament's own");
    assert.deepEqual(chipStanding({ permTouched: false, pickedPerm: "auto" }, "read-only"), { mode: "read-only", note: "from Settings › Permissions until you change it" }, "Use the default took the touch back");
  });
});

describe("Phase 2D: the first send's body (sessionStartBody)", () => {
  // (fails before: yes — the switch's mode was sent whether or not the person picked it, so the chat was pinned to the
  // browser's remembered mode and "New chats start in" never reached it; HarnessV4_Settings_Plan HS-D48, HC-52)
  test("no choice held: no settings and no mode — the chat follows New chats start in; a picked mode travels", () => {
    const body = sessionStartBody({}, "C:\\x", "agent/m", "hello", "edit");
    assert.deepEqual(body, { cwd: "C:\\x", model: "agent/m", title: "hello" });
    assert.deepEqual(sessionStartBody({ permTouched: true }, "C:\\x", "agent/m", "hello", "auto").settings, { loop: { permissions: "auto" } });
    assert.equal("settings" in sessionStartBody({}, "C:\\x", "agent/m", "", ""), false);
    assert.equal("preset" in body, false, "no preset: a new chat starts from your defaults");
  });

  test("the board's held changes ride nested under settings", () => {
    const body = sessionStartBody({ held: { "context.view.keepRawTurns": 2, "loop.permissions": "ask" } }, "C:\\x", "agent/m", "hello", "read-only");
    assert.deepEqual(body.settings, { context: { view: { keepRawTurns: 2 } }, loop: { permissions: "ask" } });
  });

  test("the permission rule (D15): an untouched picker sends no loop.permissions; a picked one sends exactly that, never over the board's own", () => {
    assert.equal("settings" in sessionStartBody({}, "C:\\x", "agent/m", "", "read-only"), false, "untouched: nothing to send");
    assert.deepEqual(sessionStartBody({ permTouched: true }, "C:\\x", "agent/m", "", "edit").settings, { loop: { permissions: "edit" } });
    assert.deepEqual(sessionStartBody({ permTouched: true, held: { "loop.permissions": "ask" } }, "C:\\x", "agent/m", "", "edit").settings, { loop: { permissions: "ask" } }, "the board's change of the same knob holds");
  });

  test("nestLayer: dotted paths become the nested settings object, objects kept whole — flattenLayer's inverse", () => {
    const nested = { context: { strategy: "fold" }, loop: { tools: { bash: false } } };
    assert.deepEqual(nestLayer({ "context.strategy": "fold", "loop.tools": { bash: false } }), nested);
    assert.deepEqual(nestLayer(flattenLayer(nested)), nested, "the two round-trip");
    assert.deepEqual(nestLayer({}), {});
  });
});
