// @ts-check
// A question a turn of Filament's loop paused on, left unanswered as the chat goes on with a coding agent (the decision
// of 11-02): only the loop's turn answers it, so the person's message to the agent ends its park — the question is left
// unanswered, and said so once, on the turn that asked and on the record of the turn that left it. It is not drawn
// again after each of the agent's turns, nothing waits on it — a compaction, the agent's own turns — and the loop, back
// in the chat, takes no later message as its answer.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply, FAKE_ACP_AGENT } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

/** @param {any[]} blocks @param {string} [stop] */
const reply = (blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
/** The command a loop turn asks permission for in Edit. */
const CHECK = { type: "tool_use", id: "c1", name: "bash", input: { command: `node -e "console.log('checked')"` } };
/** The calls a request's newest message answers. @param {any} call */
const answersTo = (call) => (Array.isArray(call.body?.messages?.at(-1)?.content) ? call.body.messages.at(-1).content : []).filter((/** @type {any} */ b) => b?.type === "tool_result").map((/** @type {any} */ b) => b.tool_use_id);
/** The text of a message. @param {any} m */
const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join(""));

describe("a loop's question left unanswered as the chat goes on with a coding agent", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-park-left-"));
  const projDir = join(root, "project");
  before(async () => {
    mkdirSync(projDir);
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    up = await fakeUpstream(async (call) =>
      answersTo(call).includes("c1") ? reply([{ type: "text", text: "The check printed checked." }]) : /run the check/.test(textOf(call.body?.messages?.at(-1))) ? reply([CHECK], "tool_use") : reply([{ type: "text", text: "Fresh words." }]),
    );
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "claude", name: "Claude Code", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1" }, cwdDefault: projDir, permissions: "allow-all", hints: false } },
          { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true },
        ];
        cfg.routes = [
          { match: "claude/*", upstream: "claude", upstreamModel: "{1}", enabled: true },
          { match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true },
        ];
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
  /** @param {string} id @param {string} content */
  const turn = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false, sendAsIs: true } });
    assert.equal(r.status, 200, await r.clone().text());
    return textOf(await r.json());
  };
  /** @param {string} id */
  const transcript = async (id) => (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
  /** @param {string} id @param {string} name */
  const model = async (id, name) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { model: { name } } } });
    assert.equal(r.status, 200, await r.clone().text());
  };

  // (fails before: yes — the park stood after Claude's turn: the transcript drew the permission again, paused.kind
  // "permission"; and with the session's park ended but the loop's own kept, the loop back in the chat resumed the
  // permission let go with the next message: "The check printed checked.")
  test("the person's message to Claude Code ends the park: said once, drawn no more, and the loop answers nothing with a later message", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "agent/brain-model", preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    const id = String((await r.json()).id);
    assert.match(await turn(id, "run the check"), /May I run this command\?/);
    assert.equal((await transcript(id)).paused?.kind, "permission", "the question is parked");
    // The chat moves to Claude Code, and the person writes to it.
    await model(id, "claude/haiku");
    assert.match(await turn(id, "leave the check, read the readme"), /echo/);
    const left = await transcript(id);
    assert.equal(left.paused, null, "the question waits no more");
    assert.deepEqual(left.turns.map((/** @type {any} */ t) => t.unanswered || null), [{ by: "Claude Code" }, null], "the turn that asked says so");
    // Its record says so, once.
    const notes = async (/** @type {any} */ t) => ((await (await shim.api(`/api/requests/${encodeURIComponent(t.requestIds.at(-1))}`)).json()).changes || []).filter((/** @type {string} */ c) => /left unanswered/.test(c));
    assert.deepEqual(await notes(left.turns[1]), ["compose: agent: the permission turn 1 waited on was left unanswered — this message went to Claude Code"], "the record of the turn that left it");
    // Nothing waits on it: a compaction is not refused for it.
    const compacted = await shim.api(`/api/sessions/${encodeURIComponent(id)}/compact`, { method: "POST", body: { method: "fold" } });
    assert.notEqual((await compacted.json()).error, "a question waits for your answer: answer it first, then compact");
    // Claude's next turn draws it no more, nor says it again.
    await turn(id, "and the notes");
    const again = await transcript(id);
    assert.equal(again.paused, null);
    assert.deepEqual(again.turns.filter((/** @type {any} */ t) => t.unanswered).map((/** @type {any} */ t) => t.n), [1]);
    assert.deepEqual(await notes(again.turns.at(-1)), [], "the next turn's record says nothing of it");
    // Back on the loop, the next message is a message of its own: no answer to the permission let go.
    await model(id, "agent/brain-model");
    assert.equal(await turn(id, "yes"), "Fresh words.");
    assert.equal((await transcript(id)).paused, null);
  });
});
