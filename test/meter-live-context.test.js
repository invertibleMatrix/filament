// @ts-check
// BUG-20 (FILAMENT Bug Tracker, 2026-09-30): during a long agent turn the context meter climbed from ~60% to
// 900K–1M of a 550K window, then fell to 83% the moment the turn stopped. While a turn ran, the meter showed the
// PREVIOUS turn's end state plus `liveOut` — every text and thinking block streamed in the whole turn, all rounds
// together (heldFigure, widgets/context.js). A long turn's thinking alone passes the window that way, and a mid-turn
// compaction never lowered it. The loop already measures the conversation it sends before every round (the figure
// its compaction line uses); each round-start now carries it, and the meter shows that plus only the output streamed
// since the round began.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { heldFigure } from "../src/ui/harness/widgets/context.js";
import { removeDirs } from "./helpers/wait.js";

const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
const reply = (blocks, stop = "end_turn") =>
  anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });

describe("the meter's live figure", () => {
  test("while a turn runs, the loop's own measure replaces the previous turn plus the whole turn's output", () => {
    const prev = { tokens: { input: 1000, cacheRead: 400000, cacheWrite: 0 } }; // the previous turn ended at ~401K
    // Before: 401,000 + everything streamed this turn (600K of thinking across rounds) = over the window.
    assert.equal(heldFigure({ rec: prev, liveOut: 600000 }).tokens, 1_001_000, "the old sum, kept when no live figure exists");
    // Now: the loop measured 180,000 at this round's start; 3,000 tokens streamed since then.
    const live = heldFigure({ rec: prev, liveOut: 603000, liveHeld: 180000, liveOutBase: 600000 });
    assert.deepEqual(live, { tokens: 183000, known: true });
    // A live figure never counts output streamed before its round began, and never goes negative.
    assert.equal(heldFigure({ rec: prev, liveOut: 5, liveHeld: 180000, liveOutBase: 9 }).tokens, 180000);
  });
  test("the page feeds the meter from each round-start, and a finished turn's record clears the live figure", async () => {
    const { readFileSync } = await import("node:fs");
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    assert.match(app, /if \(e\?\.type === "round-start" && Number\(e\.context\) > 0\) live\.meter = \{ tokens: Number\(e\.context\), base: live\.out \|\| 0 \};/);
    assert.match(app, /if \(chat\.live === live && chatOf\(state\.currentId\) === chat\) composer\.setLiveHeld\(live\.meter\.tokens, live\.meter\);/, "the turn's own figure, shown while its chat is");
    assert.equal((app.match(/meterHears\(chat, live, e\);/g) || []).length, 2, "the sending page's run events and a followed turn's alike");
    const composer = readFileSync(new URL("../src/ui/harness/composer/composer.js", import.meta.url), "utf8");
    assert.match(composer, /setRecord\(rec, usage\) \{ setFigures\(\{[^}]*liveHeld: 0/, "the turn's record takes over from the live figure");
  });
});

describe("each round says what the loop sends", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  let round = 0;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-meter-"));
    writeFileSync(join(root, "big.txt"), `BIG ${"lorem ipsum dolor sit amet ".repeat(1500)}`);
    up = await fakeUpstream(async () => {
      round++;
      return round === 1 ? reply([toolUse("r1", "read", { path: "big.txt" })], "tool_use") : reply([{ type: "text", text: "read it" }]);
    });
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-model": { input: 1, output: 1, contextTokens: 200000 } } }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    // Under a full run Windows may hold the folder a moment after the app stopped: removed once it lets go.
    await removeDirs(root);
  });

  // (fails before: round-start carried no size — the page could only add up the streamed output)
  test("round-start carries the measured conversation, and it grows by the tool result the round appended", async () => {
    const r = await shim.house(
      "/v1/messages",
      { model: "agent/brain-model", max_tokens: 400, stream: false, messages: [{ role: "user", content: "read big.txt" }] },
      { "x-filament-cwd": root, "x-session-id": "meter-1" },
    );
    assert.equal(r.status, 200);
    const id = r.headers.get("x-filament-request-id");
    const evts = (await (await shim.api(`/api/runs/${id}/events?since=0&limit=500`)).json()).events;
    const starts = evts.filter((e) => e.type === "round-start");
    assert.equal(starts.length, 2);
    for (const s of starts) assert.ok(Number(s.context) > 0, `round ${s.round} says what it sends: ${JSON.stringify(s)}`);
    const grew = starts[1].context - starts[0].context;
    assert.ok(grew > 5000, `round 2 carries the file round 1 read (grew ${grew} tokens)`);
    const rec = await shim.record(id);
    assert.ok(Math.abs(rec.context.estimate - starts[1].context) < 2000, `the record's end state is on the same scale (${rec.context.estimate} vs ${starts[1].context})`);
  });
});
