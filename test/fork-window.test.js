// @ts-check
// A fork keeps the window its session chose (the review of 10-27's settings fixes). A side agent works in its model's
// standard window, never the one its session chose; a fork is not one: it carries the main agent's whole request, so in
// the standard window a fork of a chat past it stopped at its first round, "the turn reached the … context window".
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

/** @type {string} */ let root;
/** @type {any} */ let up;
/** @type {any} */ let shim;
/** What the parent read back from its fork. @type {string | null} */
let forkResult = null;

before(async () => {
  root = mkdtempSync(join(tmpdir(), "filament-fork-window-"));
  up = await fakeUpstream((/** @type {any} */ call) => {
    if (call.kind !== "anthropic") return undefined;
    const model = String(call.body?.model || "");
    const msgs = call.body?.messages || [];
    const all = JSON.stringify(msgs);
    if (all.includes("from here on you are a sub-agent")) return anthropicReply("FORK REPORT", { model });
    const results = (msgs.at(-1)?.content || []).filter?.((/** @type {any} */ b) => b?.type === "tool_result") || [];
    if (results.length) {
      forkResult = JSON.stringify(results[0].content);
      return anthropicReply("PARENT DONE", { model });
    }
    if (all.includes("fork it")) return anthropicReply("", { model, stop: "tool_use", blocks: [{ type: "tool_use", id: "toolu_fw1", name: "agent", input: { run_in_background: false, description: "Forked look", prompt: "Look again.", context: "fork" } }] });
    return anthropicReply("ok", { model });
  });
  shim = await startApp({
    memory: true,
    configure: (cfg) => {
      // The model's standard window is 20,000 tokens; it offers 200,000 beside it.
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-model": { input: 1, output: 1, contextTokens: 20000, windows: [20000, 200000] } } }];
      cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.memory.autopilot = { enabled: false };
      cfg.memory.capture = { turns: true, learn: false };
      cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
    },
  });
});
after(async () => {
  await shim.stop();
  await up.close();
  await removeDirs(root);
});

// (fails before: yes — the fork measured its first round against the model's 20,000 and stopped there)
test("a fork of a chat on the larger window it chose runs in that window: its first round is not past it", async () => {
  const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { model: { window: 200000 } } } });
  assert.equal(made.status, 200, await made.clone().text());
  const id = String((await made.json()).id);
  // ≈30,000 tokens: past the standard window, well under the chosen one's line.
  const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: `fork it\n${"words ".repeat(20000)}`, stream: false } });
  assert.equal(t.status, 200, await t.clone().text());
  assert.ok(forkResult, "the parent read its fork's result");
  assert.match(String(forkResult), /FORK REPORT/, String(forkResult).slice(0, 400));
});
