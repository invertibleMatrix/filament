// @ts-check
// A compaction is undoable until the next message (HarnessV3-Compaction §3.3): once a turn has run on it, it is past
// taking back (the decision of 11-02). A failed try's retry goes on in the try's row, which keeps its first start, so a
// compaction made between the failure and the retry read as made after the newest start: its Undo stood on its row
// after the retry had been composed from it, and taking it back rewrote the history the retry's answer stands on. The
// retry is that later turn: its start is the turn's newest.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

/** @param {string} id @param {string} name @param {any} input */
const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
/** @param {any[]} blocks @param {string} [stop] */
const reply = (blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
/** @param {any} m */
const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("\n"));
/** The calls a request's newest message answers. @param {any} call */
const answersTo = (call) => (Array.isArray(call.body?.messages?.at(-1)?.content) ? call.body.messages.at(-1).content : []).filter((/** @type {any} */ b) => b?.type === "tool_result").map((/** @type {any} */ b) => b.tool_use_id);
/** What an undo says once a message went since. */
const PAST = "only the newest compaction Filament made here can be undone, and only until the next message is sent";

describe("a compaction a retried turn ran on", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** The flaky check's first try fails after its read; the retry answers. */
  let flaky = true;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-undo-retry-"));
    writeFileSync(join(root, "notes.txt"), "hello\n");
    up = await fakeUpstream(async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (!call.body?.tools?.length) return reply([{ type: "text", text: "A summary of the chat so far." }]);
      const done = answersTo(call);
      const last = textOf(call.body.messages.at(-1));
      if (done.includes("r2")) return flaky ? ((flaky = false), { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "the provider refused this one" } } }) : reply([{ type: "text", text: "Checked." }]);
      if (done.includes("r1")) return reply([{ type: "text", text: `The notes say hello. ${"Read with care, line by line. ".repeat(300)}` }]);
      if (/flaky check/.test(last)) return reply([toolUse("r2", "read", { path: "notes.txt" })], "tool_use");
      if (/read the notes/.test(last)) return reply([toolUse("r1", "read", { path: "notes.txt" })], "tool_use");
      return reply([{ type: "text", text: "Fresh words." }]);
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
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
    await removeDirs(shim.dataDir, root);
  });

  // (fails before: yes — the compaction still read as undoable after the retry ran on it: its row's undoable true, and
  // the undo answered 200, taking back the history the retry's answer was composed from)
  test("the retry is a later turn: the compaction it ran on is past undoing", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    const at = `/api/sessions/${encodeURIComponent(String((await r.json()).id))}`;
    const say = async (/** @type {string} */ content) => {
      const t = await shim.api(`${at}/turns`, { method: "POST", body: { content, stream: false } });
      assert.equal(t.status, 200, await t.clone().text());
      return textOf(await t.json());
    };
    await say("read the notes");
    // A turn that fails after its read, a compaction, then the same message again: the retry goes on in the failed
    // try's row, which started before the compaction.
    await (await shim.api(`${at}/turns`, { method: "POST", body: { content: "flaky check", stream: false } })).text();
    const made = await shim.api(`${at}/compact`, { method: "POST", body: {} });
    assert.equal(made.status, 200, await made.clone().text());
    const cid = (await made.json()).boundary.id;
    const before = (await (await shim.api(`${at}/transcript`)).json()).boundaries.find((/** @type {any} */ b) => b.type === "compaction" && b.id === cid);
    assert.equal(before?.undoable, true, "undoable until the next message");
    assert.equal(await say("flaky check"), "Checked.");
    const tr = await (await shim.api(`${at}/transcript`)).json();
    assert.deepEqual(tr.turns.map((/** @type {any} */ t) => t.n), [1, 2], "the retry went on in the failed try's turn");
    const row = tr.boundaries.find((/** @type {any} */ b) => b.type === "compaction" && b.id === cid);
    assert.equal(row?.undoable, false, "the retry ran on it");
    const undo = await shim.api(`${at}/compactions/${cid}/undo`, { method: "POST", body: {} });
    assert.deepEqual([undo.status, (await undo.json()).error], [409, PAST]);
  });
});
