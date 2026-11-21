// @ts-check
// A wait that runs out of time while ends of the graph's tasks were held for its other workers (the review of 11-03,
// finding 5b): those ends ride the step, so the wait's words say they came — not "nothing arrived". Driven directly with
// a scripted model call and an inbox that holds two ends; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";

const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
const reply = (/** @type {any[]} */ content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } };

/**
 * The model's turn: it waits a second, then ends. The inbox owes a sub-agent's work that never ends while the turn
 * waits, holds `held` ends, and nothing arrives. What the wait answered.
 * @param {number} held
 */
const waited = async (held) => {
  let n = 0;
  let asked = 0;
  const inbox = {
    owed: () => (++asked === 1 ? new Promise(() => {}) : null),
    arrival: () => new Promise(() => {}),
    held: () => held,
    take: () => [],
    back() {},
    hold() {},
    sealed: () => [],
    who: "sub-agents",
  };
  const out = await runAgentTurn(/** @type {any} */ ({
    model: "m",
    messages: [{ role: "user", content: "go" }],
    system: "s",
    tools: toolSetFor({ delegateRead: false }),
    modeNow: () => "auto",
    root: tmpdir(),
    readerModel: "",
    maxTokens: 100,
    call: async () => (++n === 1 ? reply([toolUse("w1", "wait", { seconds: 1 })]) : reply([{ type: "text", text: "Done." }])),
    costOf: () => 0,
    runHand: async (/** @type {string} */ name) => `${name} ran`,
    delegateRead: null,
    mailbox: { read: () => [] },
    permissions: null,
    tree: null,
    onEvent: () => {},
    previewChars: 0,
    sink,
    signal: null,
    resume: null,
    inbox,
  }));
  assert.equal(out.status, "done", JSON.stringify(out).slice(0, 1500));
  return String(out.work[1].content[0].content);
};

// (fails before: yes — it said "nothing arrived … a report reaches you the moment it lands" while the held ends came in
// the same message)
test("a wait that runs out of time says the graph's held ends came, and that they follow; with none held, nothing arrived", async () => {
  assert.equal(await waited(2), "Waited 1 s: 2 tasks of your graph ended while its other sub-agents still run — their ends follow as a message. Filament wakes you once the rest are done, or as soon as one ends that another task waits on.");
  assert.equal(await waited(1), "Waited 1 s: a task of your graph ended while its other sub-agents still run — its end follows as a message. Filament wakes you once the rest are done, or as soon as one ends that another task waits on.");
  assert.equal(await waited(0), "Waited 1 s and nothing arrived; the sub-agents are still running. Call wait again, or carry on with other work — a report reaches you the moment it lands.");
});
