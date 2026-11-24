// @ts-check
// The owner's of 11-10, Fable52: Claude Code, handed a compaction line of 80,000 tokens (40% of its 200K window),
// compacted three times within three turns each and failed with "Autocompact is thrashing … use /clear to start fresh"
// — words for its own terminal, where a chat of Filament's has no /clear. The turn now says it in Filament's words: the
// line it was handed, its share of the window, and how to raise it; the agent's own words under them.
// (fails before: yes — the agent's words were the turn's, /clear and all)
import "./helpers/clean-env.js";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/server.js";
import { defaultConfig } from "../src/config.js";
import { thrashWords, classifyFailure } from "../src/adapters/agents/acp/failures.js";
import { houseAuth } from "../src/services/house.js";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-acp-agent.mjs");
const SAID = "Autocompact is thrashing: the context refilled to the limit within 3 turns of the previous compact, 3 times in a row. A file being read or a tool output is likely too large for the context window. Try reading in smaller chunks, or use /clear to start fresh.";

test("thrashWords: the line handed and its share of the window, how to raise it on a chat's turn, the agent's words under them; null for another failure", () => {
  const e = { message: `Internal error: ${SAID}` };
  assert.deepEqual(thrashWords(e, { who: "Claude Code", line: 80_000, window: 200_000 }), {
    said: "Claude Code stopped: it compacted its context again and again, and each time it filled up again within a few turns. It makes room at 80,000 tokens, 40% of its 200,000-token window: what this work reads after a compaction doesn't fit under that. Raise Your line in the Context popover, or pick the model in a larger window, then send again.",
    detail: `Claude Code said: Internal error: ${SAID}`,
  });
  assert.equal(
    thrashWords(e, { who: "Claude Code", line: 400_000, window: 1_000_000 })?.said.split(": what this work")[1],
    " reads after a compaction doesn't fit under that. Raise Your line in the Context popover, then send again.",
    "a 1M window has no larger one to pick",
  );
  assert.equal(
    thrashWords(e, { who: "Claude Code", line: 80_000, window: 200_000, chat: false })?.said.endsWith("doesn't fit under that."),
    true,
    "a sub-agent's line is its own: nothing to raise",
  );
  assert.equal(
    thrashWords({ message: "Internal error", data: { details: SAID } }, { who: "Claude Code" })?.said,
    "Claude Code stopped: it compacted its context again and again, and each time it filled up again within a few turns. A file it read or a tool's output is likely too large for its window: ask for the work in smaller parts.",
    "no line handed: in its details too",
  );
  assert.equal(thrashWords({ message: "Prompt is too long: 212000 tokens > 200000 maximum" }, { who: "Claude Code", line: 80_000 }), null);
  assert.equal(classifyFailure(e).kind, "overflow", "still a context failure, which the banner offers room for");
});

describe("a coding agent's compaction that keeps refilling, through the app", () => {
  /** @type {any} */
  let app;
  let port = 0;
  const dataDir = mkdtempSync(join(tmpdir(), "filament-agent-thrash-"));
  const projDir = join(dataDir, "project");
  before(async () => {
    mkdirSync(projDir);
    const cfg = defaultConfig();
    cfg.server.port = 0; cfg.server.loopbackTrust = "legacy";
    cfg.server.inboundKeys = ["k"];
    cfg.observability.logFile = "";
    cfg.memory.enabled = false;
    cfg.upstreams = [
      { id: "thrasher", name: "Thrasher", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_FAIL_SAID: SAID }, cwdDefault: projDir, permissions: "allow-all", hints: false } },
    ];
    cfg.routes = [{ match: "thrasher/*", upstream: "thrasher", upstreamModel: "{1}", format: "auto" }];
    writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
    app = createApp(/** @type {any} */ ({ dataDir, overrides: { port: 0, heartbeatMs: 1000 } }));
    port = (await app.start()).port;
  });
  after(async () => {
    await app.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("the turn's failure says the line it was handed, and the agent's words go under it", async () => {
    const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      // A harness turn is a house call: the line is a header only Filament itself sends.
      headers: { "content-type": "application/json", ...houseAuth(), "x-filament-conversation": "thrash-1", "x-filament-compaction": "0", "x-filament-compaction-line": "80000" },
      body: JSON.stringify({ model: "thrasher/m", messages: [{ role: "system", content: `Working directory: ${projDir}` }, { role: "user", content: "read everything" }] }),
    });
    const body = await r.json();
    assert.equal(r.status, 502, JSON.stringify(body));
    assert.match(body.error.message, /Thrasher stopped: it compacted its context again and again, and each time it filled up again within a few turns\. It makes room at 80,000 tokens/);
    assert.match(body.error.message, /Raise Your line in the Context popover/);
    assert.doesNotMatch(body.error.message, /\/clear/, "no word of a terminal's");
    assert.match(String(body.error.detail), /^Thrasher said: .*Autocompact is thrashing/);
  });
});
