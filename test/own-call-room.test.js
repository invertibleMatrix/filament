// Every call Filament makes itself asks for the most its model can write, inside its window (HarnessV3-FailurePoints
// §13). The settings assistant's turn is here; memory's calls are in memory-model-room, /trim's in trim, the forks' in
// subagents and compactor, the reader's in agent-loop, the ping's in server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Assistant } from "../src/app/assistant.js";
import { defaultConfig } from "../src/config.js";
import { callRoom } from "../src/core/routing.js";
import { estimateBodyTokens } from "../src/core/tokens.js";

// (fails before: yes — the assistant asked for 8,000 tokens whatever its model, and a reasoning model thinks inside them)
test("the settings assistant asks for the most its model can write, fitted to its window", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-own-room-"));
  try {
    const cfg = defaultConfig();
    /** @type {any[]} */
    const asks = [];
    const a = new Assistant(/** @type {any} */ ({
      getConfig: () => cfg,
      listModels: async () => ({ models: [] }),
      describeDiff: () => [],
      dataDir: dir,
      callModel: async (/** @type {any} */ b) => (asks.push(structuredClone(b)), { content: [{ type: "text", text: "Done." }], stop_reason: "end_turn" }),
    }));
    await a.turn({ message: "what routes do I have?", model: "glm-5.3" });
    assert.equal(asks.length, 1, "one call: the model answered without a tool");
    const { max_tokens, ...ask } = asks[0];
    assert.equal(max_tokens, callRoom(cfg, "glm-5.3", estimateBodyTokens(ask, "request")), "the ceiling, fitted to what the window leaves");
    assert.ok(max_tokens >= 32_000, `room for its thinking and its answer (got ${max_tokens})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
