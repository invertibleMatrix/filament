// @ts-check
// BUG-08 (FILAMENT Bug Tracker, 2026-09-30): a foreground sub-agent stopped together with its parent turn was drawn
// "Cut off" (error tone), sometimes with "the client disconnected": the loop handed it the turn's stop as its
// hang-up signal, so its own request was aborted and its loop ended "aborted", its report lost. The parent's stop now
// reaches it as a stop of its own — its loop cuts what it runs and ends "stopped" in its words, its report kept —
// while a real hang-up still takes it down with the turn.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { until, removeDirs } from "./helpers/wait.js";

const CHILD = "You are a sub-agent run by Filament";
const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((b) => b?.type === "text").map((b) => b.text).join("\n"));
/** @template T @param {Promise<T>} p @param {number} ms @param {string} what @returns {Promise<T>} */
const within = (p, ms, what) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} did not happen within ${ms} ms`)), ms).unref())]);

describe("a foreground sub-agent stopped with its parent", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let folder;
  before(async () => {
    folder = mkdtempSync(join(tmpdir(), "filament-stop-sub-"));
    up = await fakeUpstream(async (call) => {
      const system = JSON.stringify(call.body?.system ?? "");
      const messages = call.body?.messages || [];
      const last = messages.at(-1);
      const answered = Array.isArray(last?.content) && last.content.some((b) => b?.type === "tool_result");
      const blocks = (b, stop = "end_turn") => anthropicReply("", { model: call.body?.model || "m-1", stop, blocks: b, usage: { input_tokens: 5, output_tokens: 3 } });
      if (system.includes(CHILD))
        return answered
          ? blocks([{ type: "text", text: "CHILD REPORT" }])
          : blocks([{ type: "text", text: "Sleeping." }, { type: "tool_use", id: "toolu_b1", name: "bash", input: { command: `node -e "setTimeout(()=>{},15000)"` } }], "tool_use");
      if (answered) return blocks([{ type: "text", text: "PARENT DONE" }]);
      if (/run a slow child/.test(textOf(last)))
        return blocks([{ type: "text", text: "Launching." }, { type: "tool_use", id: "toolu_a1", name: "agent", input: { run_in_background: false, description: "Slow child", prompt: "sleep long" } }], "tool_use");
      return blocks([{ type: "text", text: "PLAIN" }]);
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

  // (fails before: the sub-agent ended "aborted" — "Cut off" — because the turn's stop reached it as a hang-up)
  test("the parent's stop stops the sub-agent in its own words: \"stopped\", never \"aborted\"", async () => {
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1" } });
    assert.equal(s.status, 200, await s.clone().text());
    const id = String((await s.json()).id);
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "run a slow child", stream: true } });
    assert.equal(res.status, 200);
    const parentRun = String(res.headers.get("x-filament-request-id") || "");
    assert.ok(parentRun);
    const body = res.text();
    const eventsOf = async (runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=500`)).json()).events || [];
    const subsOf = async () => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json()).subagents || [];
    // The child is running its long command.
    const childRun = await until(async () => {
      const sa = (await subsOf())[0];
      if (!sa?.runId) return null;
      return (await eventsOf(sa.runId)).some((e) => e.type === "tool-start" && e.name === "bash") ? sa.runId : null;
    }, "the sub-agent's command to start");
    const t0 = Date.now();
    const stop = await shim.api(`/api/runs/${encodeURIComponent(parentRun)}/steer`, { method: "POST", body: { kind: "stop", text: "", from: "harness" } });
    assert.equal(stop.status, 200, await stop.text());
    await within(body, 8000, "the parent's end after the stop");
    assert.ok(Date.now() - t0 < 8000, "the child's command was cut, not waited out");
    const sa = await until(async () => {
      const x = (await subsOf())[0];
      return x && x.status !== "running" ? x : null;
    }, "the sub-agent to settle");
    assert.equal(sa.status, "stopped", `the sub-agent ended stopped, not cut off: ${sa.status}`);
    const childEv = await eventsOf(childRun);
    assert.equal(childEv.at(-1)?.status, "stopped", "its own run ended stopped");
    const bashEnd = childEv.find((e) => e.type === "tool-end" && e.name === "bash");
    assert.match(String(bashEnd?.preview || ""), /Command stopped with the turn/, "its command was killed by its own stop");
    const parentEv = await eventsOf(parentRun);
    const end = parentEv.find((e) => e.type === "subagent-end");
    assert.equal(end?.status, "stopped", "the parent's timeline says the sub-agent was stopped");
    assert.equal(parentEv.at(-1)?.status, "stopped", "and the parent ended stopped");
  });
});
