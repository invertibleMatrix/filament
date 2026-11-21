// @ts-check
// A side run asked while the planner's turn waits on a question it paused on (the decision of 11-02): a pause is no
// end, so the side-run sheet offers Start when the agent's turn ends as it does while the turn runs, that its default,
// and a run set for the turn's end is held through the pause and goes at the end of the answer's turn — or once the
// question is let go unanswered — never at once from the paused turn's half-finished edits.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

// (fails before: yes — the registry ran what waited for the turn's end at once after the paused close: ["side"])
test("the registry holds what waits for a turn's end through its pause: it goes at the end of the answer's turn, or once the question is let go", () => {
  /** The sessions whose turn's question waits for the person's answer. */
  const asking = new Set();
  const reg = createSubagentRegistry({
    now: () => 0,
    config: () => ({ agentLoop: { subagents: {} } }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    context: /** @type {any} */ ({
      settings: () => ({ subagents: { pool: [], view: "none", ask: [] }, loop: { permissions: "edit" } }),
      session: () => ({ cwd: tmpdir(), model: "m", projectId: null }),
      view: async () => null,
      brief: async () => null,
      modelProblem: () => null,
      mark: (/** @type {any} */ _c, /** @type {any} */ m) => ({ ...m, afterTurn: 1 }),
      asking: (/** @type {string} */ id) => asking.has(id),
    }),
  });
  const open = (/** @type {string} */ runId) => reg.openTurn({ chainId: "c1", runId, cwd: tmpdir(), mode: "edit", model: "m", thinking: null, fork: null });
  /** What went, in order. @type {string[]} */
  const went = [];
  const gone = () => [...went];
  // The planner's turn pauses on its question.
  open("turn-1").close({ paused: true });
  asking.add("c1");
  reg.afterTurn("c1", () => went.push("side"));
  assert.deepEqual(gone(), [], "held through the pause");
  assert.equal(reg.turnOpen("c1"), true, "the turn is open while its question waits");
  // The answer's turn takes the question, runs and ends: what waited goes with its end.
  asking.delete("c1");
  const answer = open("turn-2");
  assert.equal(reg.turnOpen("c1"), true);
  assert.deepEqual(gone(), [], "not while the answer's turn runs");
  answer.close();
  assert.deepEqual(gone(), ["side"], "at the end of the answer's turn");
  assert.equal(reg.turnOpen("c1"), false);
  // Another pause, its question let go unanswered: what waited goes then.
  open("turn-3").close({ paused: true });
  asking.add("c1");
  reg.afterTurn("c1", () => went.push("again"));
  assert.deepEqual(gone(), ["side"]);
  asking.delete("c1");
  reg.pauseLetGo("c1");
  assert.deepEqual(gone(), ["side", "again"], "once the question is let go");
  // With no turn and no question, at once.
  reg.afterTurn("c1", () => went.push("now"));
  assert.deepEqual(gone(), ["side", "again", "now"]);
});

describe("the side-run sheet's read while a question waits", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-side-paused-"));
    writeFileSync(join(root, "notes.txt"), "hello\n");
    const answered = (/** @type {any} */ call) => JSON.stringify(call.body?.messages?.at(-1) || {}).includes('"tool_use_id":"c1"');
    up = await fakeUpstream(async (call) =>
      answered(call)
        ? anthropicReply("", { model: "brain-model", blocks: [{ type: "text", text: "The check printed checked." }] })
        : anthropicReply("", { model: "brain-model", stop: "tool_use", blocks: [{ type: "tool_use", id: "c1", name: "bash", input: { command: `node -e "console.log('checked')"` } }] }),
    );
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

  // (fails before: yes — the read said no turn runs while the question waited: turn false, so the sheet offered no
  // Start when the turn ends and its run started at once)
  test("the read says the turn is open while its question waits, as while it runs", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    const at = `/api/sessions/${encodeURIComponent(String((await r.json()).id))}`;
    const say = async (/** @type {string} */ content) => {
      const t = await shim.api(`${at}/turns`, { method: "POST", body: { content, stream: false } });
      assert.equal(t.status, 200, await t.clone().text());
      return JSON.stringify(await t.json());
    };
    const read = async () => (await shim.api(`${at}/graph/side-run`)).json();
    assert.equal((await read()).turn, false, "no turn yet");
    assert.match(await say("run the check"), /May I run this command\?/);
    assert.equal((await read()).turn, true, "its question waits: the turn is open");
    assert.match(await say("yes"), /The check printed checked\./);
    assert.equal((await read()).turn, false, "answered, the turn ended");
  });
});
