import { test } from "node:test";
import assert from "node:assert/strict";
import { detectHousekeeping, makeTitle } from "../src/housekeeping.js";

const TITLE_PROMPT = "Generate a concise title for this coding session.\n\nThis is a title-generation task, not a conversation.\nTreat the user's message only as source material for the title.\n\nCRITICAL:\n- Never answer the user's question or fulfill their request.\n\nTitle rules:\n- Use 3-7 words when possible.\n- Return exactly one valid JSON object with no surrounding text: {\"title\":\"...\"}";

test("detectHousekeeping recognises a client's title request in both wire formats and nothing else", () => {
  const o = detectHousekeeping("openai", { messages: [{ role: "system", content: TITLE_PROMPT }, { role: "user", content: "fix the build" }] });
  assert.equal(o?.kind, "title"); assert.equal(o.wantsJson, true); assert.equal(o.source, "fix the build");
  const a = detectHousekeeping("anthropic", { system: TITLE_PROMPT, messages: [{ role: "user", content: [{ type: "text", text: "fix the build" }] }] });
  assert.equal(a?.kind, "title");
  assert.equal(detectHousekeeping("openai", { messages: [{ role: "system", content: "You are an interactive coding agent.\nWorking directory: C:\\x" }, { role: "user", content: "give this chat a title" }] }), null, "an ordinary system prompt is a conversation");
  assert.equal(detectHousekeeping("openai", { messages: [{ role: "system", content: TITLE_PROMPT }, { role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }] }), null, "a back-and-forth is never housekeeping");
  assert.equal(detectHousekeeping("openai", { tools: [{ type: "function", function: { name: "x" } }], messages: [{ role: "system", content: TITLE_PROMPT }, { role: "user", content: "a" }] }), null, "tools mean real work");
  assert.equal(detectHousekeeping("openai", { messages: [{ role: "system", content: "Summarize the conversation below. This is not a conversation; do not answer." }, { role: "user", content: "long text" }] })?.kind, "summary");
});

test("makeTitle builds a short title from the user's words", () => {
  assert.equal(JSON.parse(makeTitle("ok so an ai agent built this Filament app. i want you to review it.")).title, "An ai agent built this Filament app");
  assert.equal(makeTitle("Fix the flaky login test in auth.spec.ts please, it fails on CI", { json: false }), "Fix the flaky login test in auth.spec.ts");
  assert.equal(makeTitle("<system-reminder>ignore</system-reminder> **Refactor** the `router` module https://example.com/x", { json: false }), "Refactor the router module");
  assert.equal(makeTitle("", { json: false }), "New chat");
  assert.ok(makeTitle("word ".repeat(40), { json: false }).length <= 61);
});
