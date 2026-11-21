// @ts-check
// What the mid-turn summary is written from keeps the developer's words whole (the Hunters' pass of 10-27 over the
// loop). The transcript a writer model reads cut every note to 500 characters, the developer's own messages among them,
// and every result to 1,000, a sub-agent's report among them: a summary written from it lost what they said past the
// cut. Bulk — a file read, a command's output — is still cut.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

/** @param {any} b */
const sysOf = (b) => (Array.isArray(b?.system) ? b.system.map((/** @type {any} */ x) => x?.text ?? "").join("\n") : String(b?.system || ""));
/** @param {any[]} blocks @param {string} [stop] */
const answer = (blocks, stop = "end_turn") => anthropicReply("", { model: "keep-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
/** @param {string} id @param {string} path */
const read = (id, path) => ({ type: "tool_use", id, name: "read", input: { path } });

/** @type {any} */ let up;
/** @type {any} */ let shim;
/** @type {string} */ let root;
let rounds = 0;
/** What the writer was given to summarize. @type {string[]} */
const transcripts = [];
// ≈2,600 characters: past the old 500-character cut, its last words the marker.
const MESSAGE = `please keep the old file names; ${"the reason is the deploy script reads them by name. ".repeat(48)}END-OF-THE-DEVELOPER-MESSAGE`;

before(async () => {
  root = mkdtempSync(join(tmpdir(), "filament-keep-words-"));
  for (const f of ["a", "b", "c"]) writeFileSync(join(root, `${f}.txt`), `MARKER-${f.toUpperCase()} ${"words ".repeat(3000)}TAIL-OF-${f.toUpperCase()}`);
  up = await fakeUpstream(async (/** @type {any} */ call) => {
    const b = call.body || {};
    if (sysOf(b).includes("compaction summaries")) {
      transcripts.push(JSON.stringify(b.messages));
      return answer([{ type: "text", text: "<summary>\nSUMMARY\n</summary>" }]);
    }
    rounds++;
    if (rounds === 1) {
      // The developer types while round 1 is decided: the message rides round 1's results.
      const { runs } = await (await shim.api("/api/runs?kind=agent-turn")).json();
      const live = runs.find((/** @type {any} */ x) => x.status === "running");
      await shim.api(`/api/runs/${live.id}/steer`, { method: "POST", body: { kind: "note", text: MESSAGE, from: "chat" } });
      return answer([read("k1", "a.txt")], "tool_use");
    }
    if (rounds === 2) return answer([read("k2", "b.txt")], "tool_use");
    if (rounds === 3) return answer([read("k3", "c.txt")], "tool_use");
    return answer([{ type: "text", text: "Done." }]);
  });
  shim = await startApp({
    memory: true,
    configure: (/** @type {any} */ cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "keep-model": { input: 1, output: 1, contextTokens: 100000 }, "keep-cheap": { input: 0.1, output: 0.1, contextTokens: 100000 } } }];
      cfg.routes = [{ match: "keep-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      cfg.memory.autopilot = { enabled: false };
    },
  });
});
after(async () => {
  await shim.stop();
  await up.close();
  await removeDirs(root);
});

// (fails before: yes — the transcript carried the message's first 500 characters, its end never)
test("the transcript a writer summarizes the turn's rounds from carries the developer's message whole, and still cuts a file read", async () => {
  const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "keep-model", preset: "plain", settings: { context: { compaction: { thresholdPercent: 10, model: "keep-cheap", writer: "model" } } } } });
  assert.equal(made.status, 200, await made.clone().text());
  const id = String((await made.json()).id);
  const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "read a, b and c", stream: false } });
  assert.equal(r.status, 200, await r.clone().text());
  const withMessage = transcripts.find((t) => t.includes("please keep the old file names"));
  assert.ok(withMessage, `a summary was written over the round the message came in (${transcripts.length} written)`);
  assert.ok(withMessage.includes("END-OF-THE-DEVELOPER-MESSAGE"), "the message reached the writer whole");
  assert.ok(!transcripts.some((t) => t.includes("TAIL-OF-A")), "a file read is still cut");
});
