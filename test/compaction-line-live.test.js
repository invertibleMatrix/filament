// @ts-check
// A chat's compaction line, moved while a turn runs, is the line the loop folds at (the owner's report of 10-27: "i had
// set the compaction line to be 75% but it compacted at 85%"). The loop fixed the line from the settings the turn
// started with, while the page's meter drew the line as it stands now: a move made during a long turn showed at once
// and did nothing until the next message.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { until, gate, removeDirs } from "./helpers/wait.js";

/** @param {any} b */
const sysOf = (b) => (Array.isArray(b?.system) ? b.system.map((/** @type {any} */ x) => x?.text ?? "").join("\n") : String(b?.system || ""));
/** @param {any} m */
const lastText = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ c) => c?.type === "text").map((/** @type {any} */ c) => c.text).join("\n"));
/** @param {any[]} blocks @param {string} [stop] */
const answer = (blocks, stop = "end_turn") => anthropicReply("", { model: "line-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
/** @param {string} id @param {string} path */
const read = (id, path) => ({ type: "tool_use", id, name: "read", input: { path } });

/** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
let up;
/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
/** @type {string} */
let root;
/** @type {any[]} */
const rounds = [];
let summarized = 0;
const hold = gate();

before(async () => {
  root = mkdtempSync(join(tmpdir(), "filament-line-live-"));
  for (const f of ["a", "b", "c"]) writeFileSync(join(root, `${f}.txt`), `MARKER-${f.toUpperCase()} ${"words ".repeat(3000)}`);
  up = await fakeUpstream(async (call) => {
    const b = call.body || {};
    // The summarizer: the session's writer or a fork of the loop's own conversation.
    if (sysOf(b).includes("compaction summaries") || /^\[Filament: this turn has reached the compaction line\./.test(lastText(b.messages?.at(-1)))) {
      summarized++;
      return answer([{ type: "text", text: "<summary>\nSUMMARY-OF-EARLIER-ROUNDS\n</summary>" }]);
    }
    rounds.push(b);
    const n = rounds.length;
    if (n === 1) return answer([read("r1", "a.txt")], "tool_use");
    if (n === 2) return answer([read("r2", "b.txt")], "tool_use");
    if (n === 3) {
      await hold.promise; // the developer moves the line while round 3 is being decided
      return answer([read("r3", "c.txt")], "tool_use");
    }
    return answer([{ type: "text", text: "Done." }]);
  });
  shim = await startApp({
    memory: true,
    configure: (/** @type {any} */ cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "line-model": { input: 1, output: 1, contextTokens: 100000 } } }];
      cfg.routes = [{ match: "line-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      cfg.memory.autopilot = { enabled: false };
    },
  });
});
after(async () => {
  hold.open();
  await shim.stop();
  await up.close();
  await removeDirs(root);
});

// (fails before: yes — the loop kept the 90% it started with, and the turn ended with no compaction)
test("a line moved while the turn runs is the line the loop folds at, from its next round", async () => {
  const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "line-model", preset: "plain", settings: { context: { compaction: { thresholdPercent: 90 } } } } });
  assert.equal(made.status, 200, await made.clone().text());
  const id = String((await made.json()).id);
  const sent = shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "read a, b and c", stream: false } });
  await until(() => rounds.length === 3, "round 3's model call to be in flight");
  assert.equal(summarized, 0, "under the 90% line nothing folds");
  // 10% of 100,000 is 10,000 tokens: the system prompt, the tools and two files read are past it.
  const moved = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { context: { compaction: { thresholdPercent: 10 } } } } });
  assert.equal(moved.status, 200, await moved.clone().text());
  hold.open();
  const r = await sent;
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(rounds.length, 4);
  assert.equal(summarized, 1, "one summary, written as round 4 began at the new line");
  assert.ok(JSON.stringify(rounds[3].messages).includes("SUMMARY-OF-EARLIER-ROUNDS"), "round 4 carries it");
});
