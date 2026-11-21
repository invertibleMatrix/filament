// @ts-check
// The Agents tab's first seconds (10-24): a running turn's mark gives the session view the settings' hash before the page
// has read the document. Read as "nothing set", Models for agents named the main agent's model and a new thread's note
// said it "runs on your agent's model" until the document came. settingsRead tells the two apart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { settingsRead, viewSettingsOf } from "../src/ui/harness/view-settings.js";

test("a hash alone is not the settings read; the document is, nothing set in it too", () => {
  assert.equal(settingsRead(undefined), false, "no view yet");
  assert.equal(settingsRead({ hash: "h1" }), false, "a turn's mark");
  assert.equal(settingsRead({}), false, "a write that failed paints back an empty part");
  const doc = { hash: "h1", flat: { "subagents.pool": [{ model: "zai/glm-5.3-flash" }] }, effective: { subagents: { pool: [{ model: "zai/glm-5.3-flash" }] } } };
  assert.equal(settingsRead(viewSettingsOf(doc)), true);
  // A chat that sets nothing of its own still has its document: "nothing set" is then the truth.
  assert.equal(settingsRead(viewSettingsOf({ hash: "h2", flat: {}, effective: {} })), true);
  // A later mark keeps what was read (applySessionView merges a part into the view).
  assert.equal(settingsRead({ ...viewSettingsOf(doc), hash: "h3" }), true);
});
