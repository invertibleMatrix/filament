// @ts-check
// What a sub-agent of the loop's read, on its card and its run (HarnessV4_Tasks E15, step 1): every token its model
// was sent — the provider's uncached input and what it read from or wrote to its cache — as a coding agent's
// sub-agent counts them, so the two compare.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { until, removeDirs } from "./helpers/wait.js";

/** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
let up;
/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
/** @type {string} */
let folder;
before(async () => {
  folder = mkdtempSync(join(tmpdir(), "filament-sub-tokens-"));
  // A provider that caches: each of the sub-agent's two rounds read most of its prompt from the cache.
  up = await fakeUpstream(async (call) => {
    const answered = (call.body?.messages || []).some((/** @type {any} */ m) => Array.isArray(m?.content) && m.content.some((/** @type {any} */ b) => b?.type === "tool_result"));
    const usage = { input_tokens: 5, cache_read_input_tokens: 500, cache_creation_input_tokens: 40, output_tokens: 3 };
    if (answered) return anthropicReply("COUNTED", { model: "m-1", usage });
    return anthropicReply("", { model: "m-1", stop: "tool_use", usage, blocks: [{ type: "tool_use", id: "toolu_ls", name: "ls", input: { path: "." } }] });
  });
  shim = await startApp({
    memory: true,
    configure: (cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
      cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.agentLoop = { enabled: true, permissions: "auto", roots: [folder], readerModel: "" };
      cfg.memory.autopilot = { enabled: false };
    },
  });
});
after(async () => {
  await shim.stop();
  await up.close();
  await removeDirs(shim.dataDir, folder);
});

// (fails before: yes — the loop counted a round's uncached input alone: this sub-agent's card said 10 tokens in for
// the 1,090 its model was sent, where a coding agent's sub-agent counts its cache reads and writes)
test("a sub-agent of the loop's counts what its model read from and wrote to the cache, on its card and in its run's summary", async () => {
  const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1" } });
  assert.equal(s.status, 200, await s.clone().text());
  const id = String((await s.json()).id);
  const at = `/api/sessions/${encodeURIComponent(id)}/subagents`;
  const launched = await shim.api(at, { method: "POST", body: { prompt: "list the folder", description: "List", worker: "reviewer", deliver: false } });
  assert.equal(launched.status, 200, await launched.clone().text());
  const sid = String((await launched.json()).subagent.id);
  const sub = await until(async () => {
    const x = ((await (await shim.api(at)).json()).subagents || []).find((/** @type {any} */ a) => a.id === sid);
    return x && x.status !== "running" ? x : null;
  }, "the sub-agent to end");
  const [ex] = sub.exchanges;
  assert.deepEqual([sub.engine, ex.status, ex.report, ex.rounds], ["loop", "done", "COUNTED", 2]);
  assert.deepEqual([ex.tokensIn, ex.tokensOut], [2 * (5 + 500 + 40), 6], "both rounds, cache reads and writes with the uncached input");
  const run = (await (await shim.api(`/api/runs/${encodeURIComponent(ex.runId)}`)).json()).run;
  assert.deepEqual([run.summary?.inputTokens, run.summary?.outputTokens], [1090, 6], "its run's summary says the same");
});
