// @ts-check
// The briefing's budget is the whole briefing (the memory plan's d2): its header, the line on memory's tools and the
// legends count in `memory.autopilot.briefingTokens` beside its lines — they rode outside it, some 700 tokens a session
// over what the setting said. And what the model reads of memory says what it is for, not how to keep it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { world } from "./fixtures/memory-world.mjs";
import { MEMORY_PURPOSE } from "../src/services/memory/brain.js";
import { memoryToolDefs } from "../src/app/memory-tools.js";

const BLOCK = /<filament-memory kind="briefing">\n([\s\S]*?)\n<\/filament-memory>/;

// (fails before: yes — with a budget of 600 tokens the briefing came to some 900: its header and tools' paragraph rode
// outside the budget, and the legends after it)
test("a briefing holds to its budget, its header, tools' line and legends counted", async () => {
  await world({}, async (w) => {
    w.cfg.memory.autopilot = { ...(w.cfg.memory.autopilot || {}), briefingTokens: 600, tools: true };
    const s0 = w.session("seed");
    for (let i = 0; i < 30; i++) await s0.remember(`the parser module ${i} reads its tokens from src/parser/part-${i}.js before the lexer runs`);
    const { r } = await w.session("fresh").send("how does the parser module read its tokens before the lexer?");
    const text = BLOCK.exec(String(r.body.system))?.[1] || "";
    assert.ok(text.includes("Memory tools (filament_memory_*)"), "the tools' line rides");
    assert.ok(/parser module \d+ reads its tokens/.test(text), "memories fill the room left");
    assert.ok(text.length <= 600 * 4, `${text.length} characters, past the budget's ${600 * 4}`);
  });
});

test("the briefing and the remember tool say what memory is for; the briefing's tools line is one sentence", async () => {
  await world({}, async (w) => {
    w.cfg.memory.autopilot = { ...(w.cfg.memory.autopilot || {}), tools: true };
    const s = w.session("seed");
    await s.remember("the api listens on port 3000");
    const { r } = await w.session("fresh").send("which port does the api listen on?");
    const text = BLOCK.exec(String(r.body.system))?.[1] || "";
    assert.ok(text.includes(MEMORY_PURPOSE));
    const tools = text.split("\n").find((l) => l.startsWith("Memory tools"));
    assert.ok(tools && tools.length < 600 && !/filament_memory_\w+\(/.test(tools), "one sentence, no tool's arguments repeated");
  });
  // The remember tool says it in its own words, not the briefing's sentence (the tool plan of 11-08).
  const remember = memoryToolDefs("anthropic").find((t) => t.name === "filament_memory_remember");
  assert.ok(remember?.description.includes("long-term memory, which later sessions start from"), remember?.description);
  assert.ok(remember?.description.includes("Keep what a later session could not re-read from the code or git: the user's rules, corrections and decisions with their reason, and the pitfalls you hit"), remember?.description);
  const search = memoryToolDefs("anthropic").find((t) => t.name === "filament_memory_search");
  assert.doesNotMatch(JSON.stringify(search?.input_schema), /better than full sentences/, "the search takes a sentence: recall asks by meaning too (c2)");
});
