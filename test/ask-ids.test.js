// @ts-check
// A coding agent's questions are numbered by the run they wait on (HarnessV3-ACP AC2-4): the run's `ask` and `ask-end`
// pair by id, the chat's asks list (GET /sessions/:id/asks) leaves out an id that ended, and an answer settles the id
// it names. A run prompts its agent again — what its turn still owes, a report that wakes it — and each prompt is a
// turn of the bridge's own, so the run's count goes with every prompt (acp-turn.js `asks`).
import "./helpers/clean-env.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AcpBridge } from "../src/adapters/agents/acp/bridge.js";
import { removeDirs } from "./helpers/wait.js";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-acp-agent.mjs");
const root = mkdtempSync(join(tmpdir(), "filament-ask-ids-"));
const bridge = new AcpBridge(/** @type {any} */ ({ log: () => {}, stateFile: join(root, "acp-sessions.json") }));
after(async () => {
  bridge.shutdown();
  await removeDirs(root);
});

// (fails before: yes — the owner's of 11-10, "Filament server": each prompt numbered its questions from q1, so a later
// prompt's question took the id of an earlier one's, ended: the chat's asks listed none, no card showed, and the turn
// waited on a yes nobody could give)
test("a run's prompts number its agent's questions on from each other: no two of its asks share an id", async () => {
  const upstream = { id: "plain", name: "plain", type: "acp", acp: { command: process.execPath, args: [FAKE], cwdDefault: root, permissions: "allow-all", hints: false } };
  /** @type {string[]} */
  const ids = [];
  const asks = { n: 0 };
  /** One prompt of the run, its question answered at once. @param {string} text */
  const prompt = (text) =>
    bridge.run({
      upstream,
      modelId: "fake-a",
      format: "anthropic",
      body: { model: "plain/fake-a", max_tokens: 100, messages: [{ role: "user", content: text }] },
      conversationId: "chat",
      asks,
      asker: async () => ({ outcome: "answered", answers: { question_0: { chosen: ["Postgres"] } } }),
      onEvent: (/** @type {any} */ e) => void (e.type === "ask" && ids.push(e.id)),
    });
  await prompt("~elicit");
  await prompt("~elicit");
  assert.deepEqual(ids, ["q1", "q2"]);
});
