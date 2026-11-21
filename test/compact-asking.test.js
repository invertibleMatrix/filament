// @ts-check
// Nothing is written into a chat's history between a question and its answer (the decision of 11-02): a turn that
// paused for the person's answer — a question, a permission, a lead's proposal — holds the session for a compaction as
// the `/compaction` card says, refused in words: answer it first. The server's rule, so every door has it — Compact
// now and Fold now, the card that asks before a message, a typed /compact — and Stop and compact's wait, which ends
// with the turn's lock and may find the turn paused rather than stopped. A compaction being written when a question
// is asked writes nothing.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { until, removeDirs, upstreamControls } from "./helpers/wait.js";

/** @param {string} id @param {string} name @param {any} input */
const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
/** @param {any[]} blocks @param {string} [stop] */
const reply = (blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
/** The words every door says while a question waits. */
const ASKING = "a question waits for your answer: answer it first, then compact";
/** The command a turn asks permission for in Edit: it runs nothing until the person says yes. */
const CHECK = toolUse("c1", "bash", { command: `node -e "console.log('checked')"` });
/** @param {any} m */
const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("\n"));
/** The calls a request's newest message answers. @param {any} call */
const answersTo = (call) => (Array.isArray(call.body?.messages?.at(-1)?.content) ? call.body.messages.at(-1).content : []).filter((/** @type {any} */ b) => b?.type === "tool_result").map((/** @type {any} */ b) => b.tool_use_id);
/** A summary's call carries no tools; a turn's does. @param {any} call */
const isSummary = (call) => !(call.body?.tools || []).length;

describe("a compaction while a question waits for the person's answer", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  const { hold, letGo } = upstreamControls();
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-compact-asking-"));
    writeFileSync(join(root, "notes.txt"), "hello\n");
    up = await fakeUpstream(async (call) => brain(call));
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
    letGo();
    await shim.stop();
    await up.close();
    await removeDirs(shim.dataDir, root);
  });

  /**
   * The model as these turns need it: a summary's call is answered with one; a turn reads the notes, then answers — or,
   * asked to run the check, asks for its command, and once that has run says so.
   * @param {any} call
   */
  const answer = (call) => {
    if (isSummary(call)) return reply([{ type: "text", text: "A summary of the chat so far." }]);
    if (answersTo(call).includes("c1")) return reply([{ type: "text", text: "The check printed checked." }]);
    // Long enough that a summary leaves the chat smaller.
    if (answersTo(call).includes("r1")) return reply([{ type: "text", text: `The notes say hello. ${"Read with care, line by line. ".repeat(300)}` }]);
    if (/run the check/.test(textOf(call.body?.messages?.at(-1)))) return reply([CHECK], "tool_use");
    return reply([toolUse("r1", "read", { path: "notes.txt" })], "tool_use");
  };
  /** A new chat whose first turn read the notes: something to compact. */
  const chat = async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    const id = String((await r.json()).id);
    brain = answer;
    await say(id, "read the notes");
    return { id, at: `/api/sessions/${encodeURIComponent(id)}` };
  };
  /** @param {string} id @param {string} content */
  const say = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    return textOf(await r.json());
  };
  /** The compactions a transcript holds, wherever its rows stand. @param {any} tr */
  const compactionsIn = (tr) => [...(tr.boundaries || []), ...(tr.turns || []).flatMap((/** @type {any} */ t) => [...(t.boundaries || []), ...(t.boundariesAfter || [])])].filter((/** @type {any} */ b) => b.type === "compaction");
  /** @param {string} at */
  const transcript = async (at) => (await shim.api(`${at}/transcript`)).json();

  // (fails before: yes — every door compacted between the question and its answer: Compact now answered 200 with a
  // summary of the turns, the question's among them, Fold now and a typed /compact likewise)
  test("Compact now, Fold now and a typed /compact are refused in words while a question waits; answered, the session compacts", async () => {
    const { id, at } = await chat();
    assert.match(await say(id, "run the check"), /May I run this command\?/);
    assert.equal((await transcript(at)).paused?.kind, "permission", "the question is parked");
    for (const body of [{}, { method: "fold" }]) {
      const r = await shim.api(`${at}/compact`, { method: "POST", body });
      assert.deepEqual([r.status, (await r.json()).error], [409, ASKING], JSON.stringify(body));
    }
    assert.equal(await say(id, "/compact"), `/compact did not compact the session — ${ASKING}.`);
    const asked = await transcript(at);
    assert.deepEqual(compactionsIn(asked), [], "nothing was written");
    assert.equal(asked.paused?.kind, "permission", "the question still waits");
    // Answered, the turn goes on to its end, and the session compacts as ever.
    assert.equal(await say(id, "yes"), "The check printed checked.");
    const made = await shim.api(`${at}/compact`, { method: "POST", body: {} });
    assert.equal(made.status, 200, await made.clone().text());
    assert.equal(compactionsIn(await transcript(at)).length, 1);
  });

  // (fails before: yes — the wait ended as the lock came free at the pause, and the summary was written inside the
  // paused turn: 200, a compaction of turns 1–2 under the question)
  test("Stop and compact: the wait that ends with the turn's lock finds the turn paused on a question, and is refused in words", async () => {
    const { id, at } = await chat();
    const asks = hold(reply([CHECK], "tool_use"));
    brain = (call) => (isSummary(call) ? answer(call) : asks.script(call));
    // The lock's listeners, counted: the compaction's wait is one of them.
    const turns = /** @type {any} */ (shim.app).sessionTurns;
    const subscribe = turns.onChange.bind(turns);
    let waits = 0;
    turns.onChange = (/** @type {string} */ key, /** @type {any} */ fn) => {
      waits++;
      const un = subscribe(key, fn);
      return () => (waits--, un());
    };
    try {
      const turn = shim.api(`${at}/turns`, { method: "POST", body: { content: "run the check", stream: false } });
      await asks.arrived;
      const compacting = shim.api(`${at}/compact`, { method: "POST", body: { onceTurnEnds: true } });
      await until(() => waits === 1, "the compaction to wait for the running turn");
      // The model asks for the command: the turn pauses on its question, and its lock comes free.
      asks.release();
      const paused = await turn;
      assert.match(textOf(await paused.json()), /May I run this command\?/);
      const r = await compacting;
      assert.deepEqual([r.status, (await r.json()).error], [409, ASKING]);
      assert.equal(waits, 0, "its wait is over");
      const tr = await transcript(at);
      assert.deepEqual([compactionsIn(tr), tr.paused?.kind], [[], "permission"], "nothing was written under the question");
    } finally {
      turns.onChange = subscribe;
      brain = answer;
    }
    assert.equal(await say(id, "yes"), "The check printed checked.");
  });

  // (fails before: yes — the summary being written landed under the question asked meanwhile: 200)
  test("a question asked while a summary is being written: the summary is not written, and says why", async () => {
    const { id, at } = await chat();
    const summary = hold(reply([{ type: "text", text: "A summary of the chat so far." }]));
    brain = (call) => (isSummary(call) ? summary.script(call) : answer(call));
    try {
      const compacting = shim.api(`${at}/compact`, { method: "POST", body: {} });
      await summary.arrived;
      assert.match(await say(id, "run the check"), /May I run this command\?/);
      summary.release();
      const r = await compacting;
      assert.deepEqual([r.status, (await r.json()).error], [409, "a question was asked while the compaction ran; nothing was written — answer it first, then compact"]);
      assert.deepEqual(compactionsIn(await transcript(at)), []);
    } finally {
      brain = answer;
    }
    assert.equal(await say(id, "yes"), "The check printed checked.");
  });
});
