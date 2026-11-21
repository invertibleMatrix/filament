// @ts-check
// BUG-07 (FILAMENT Bug Tracker, 2026-09-30): a turn the developer stopped was drawn as finished — "Worked for 14s", no
// "Stopped" — and the composer's queue sent the next message at once, because a stop steer never aborts the page's
// read; after a reload the turn looked normal, because the loop's own stop stamped nothing. The loop now says whose
// stop ended the turn (`stoppedBy`), the turn stamps the archive like a cut reply does, and the page reads the record.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";
import { endedStatus } from "../src/ui/harness/lib/labels.js";

const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
const reply = (content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } };
/** @param {Partial<import("../src/app/agent/loop.js").LoopArgs>} over */
const args = (over) =>
  /** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
    model: "m",
    messages: [{ role: "user", content: "go" }],
    system: "s",
    tools: toolSetFor({ delegateRead: false }),
    modeNow: () => "auto",
    root: tmpdir(),
    readerModel: "",
    maxTokens: 100,
    call: async () => reply([{ type: "text", text: "Done." }]),
    costOf: () => 0,
    runHand: async (name) => `${name} ran`,
    delegateRead: null,
    mailbox: { read: () => [] },
    permissions: null,
    tree: null,
    onEvent: () => {},
    previewChars: 0,
    sink,
    signal: null,
    resume: null,
    ...over,
  });

describe("who stopped the turn", () => {
  test("a developer's stop ends the turn stopped and names whose it was", async () => {
    let read = 0;
    const out = await runAgentTurn(args({
      call: async () => reply([toolUse("b1", "bash", { command: "echo hi" })]),
      // The stop arrives while the model decides: preflight hears it before any tool runs.
      mailbox: { read: () => (read++ === 0 ? [{ kind: "stop", text: "", from: "harness" }] : []) },
    }));
    assert.equal(out.status, "stopped");
    assert.equal(out.stoppedBy, "harness");
    assert.match(String(out.final.at(-1)?.text), /the developer stopped this turn/);
  });

  test("a call the developer's stop cut is not told to memory's observers; one that failed on its own is (HarnessV3-Memory M5-4)", async () => {
    const stop = new AbortController();
    /** @type {any[]} */
    const heard = [];
    let round = 0;
    const out = await runAgentTurn(args({
      call: async () => reply(round++ === 0 ? [toolUse("b1", "bash", { command: "npm test" }), toolUse("b2", "bash", { command: "npm run e2e" })] : [{ type: "text", text: "Done." }]),
      runHand: async (name, input) => {
        if (input.command === "npm run e2e") stop.abort();
        throw Object.assign(new Error(`${input.command} failed`), { exitCode: 1 });
      },
      mailbox: { read: () => (stop.signal.aborted ? [{ kind: "stop", text: "", from: "harness" }] : []), stopSignal: stop.signal },
      observe: (e) => heard.push([e.id, e.ok, e.exitCode]),
    }));
    assert.equal(out.status, "stopped");
    assert.deepEqual(heard, [["b1", false, 1]]);
  });

  test("the loop's own stop at the window is no one's: no stoppedBy, so nothing stamps it as the developer's", async () => {
    const out = await runAgentTurn(args({
      messages: [{ role: "user", content: "x ".repeat(4000) }],
      compact: { usable: 0, target: 0, window: 50, source: "operator", fixed: 0, summarize: async () => ({ text: "", by: "none" }) },
    }));
    assert.equal(out.status, "stopped");
    assert.equal(out.stoppedBy, undefined);
  });
});

describe("how the page reads a turn that just ended", () => {
  test("the record decides between stopped and done; the page's own abort, errors and pauses stand", () => {
    assert.equal(endedStatus("done", { agent: { status: "stopped", stoppedBy: "harness" } }), "stopped", "stopped from another surface: the read ended normally");
    assert.equal(endedStatus("stopped", { agent: { status: "stopped", stoppedBy: "harness" } }), "stopped");
    assert.equal(endedStatus("stopped", { agent: { status: "done" } }), "done", "the stop landed after the turn had finished");
    assert.equal(endedStatus("stopped", { agent: { status: "done" } }, { aborted: true }), "stopped", "the page stopped reading: that is a stop");
    assert.equal(endedStatus("done", { agent: { status: "stopped" } }), "done", "the loop's own stop (the window) is not the developer's");
    assert.equal(endedStatus("done", null), "done", "no record: as the page saw it");
    assert.equal(endedStatus("done", {}), "done", "no run (a plain model turn): as the page saw it");
    assert.equal(endedStatus("error", { agent: { status: "stopped", stoppedBy: "harness" } }), "error");
    assert.equal(endedStatus("paused", { agent: { status: "paused" } }), "paused");
  });

  // (fails before: yes — the page read the loop's run alone, so a coding agent's turn stopped from another surface
  // read finished, and the queue sent the next message at once)
  test("a coding agent's turn is read from its run on the record (HarnessV3-ACP AC1-5)", () => {
    assert.equal(endedStatus("done", { acp: { run: { status: "stopped", stoppedBy: "harness" } } }), "stopped");
    assert.equal(endedStatus("stopped", { acp: { run: { status: "done" } } }), "done", "the stop came after its end");
  });
});
