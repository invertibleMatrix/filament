// @ts-check
// How models did, end to end (HarnessV3-Memory M7-4, M7-D48..D57): native sessions against a scripted upstream. A
// harness turn that edits and tests is one outcome, with its own calls' tokens and cost; the user's next message that
// pushes back on it marks it once the learner reads the session and says so (the memory plan's d4); a turn paused on its own question and resumed after a restart is one outcome with
// both halves in it; a sub-agent's exchange that reads and fails is its own; where memory stays out — a muted session,
// memory's autopilot off, a request that asked it to — nothing is kept.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
const reply = (/** @type {string} */ model, /** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model, stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
const words = (/** @type {string} */ model, /** @type {string} */ text) => reply(model, [{ type: "text", text }]);
/** The ids of the tool results a call's conversation holds. @param {any} call */
const answered = (call) => new Set(call.body.messages.flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content.filter((/** @type {any} */ c) => c?.type === "tool_result").map((/** @type {any} */ c) => c.tool_use_id) : [])));
/** The newest words a person typed in a call's conversation (a tool result's message carries none). @param {any} call */
const newest = (call) => {
  const msgs = call.body.messages;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m?.role !== "user") continue;
    const t = typeof m.content === "string" ? m.content : (m.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("");
    if (t) return t;
  }
  return "";
};
/** What one call costs at the test's price — 1000 a million tokens, in and out — for 30 in and 7 out. */
const CALL_USD = 0.037;
const near = (/** @type {number | null} */ a, /** @type {number} */ b) => a != null && Math.abs(a - b) < 1e-9;
/** An outcome as these tests read it. @param {any} o */
const seen = (o) => ({ kind: o.kind, agent: o.agent, model: o.model, did: o.did, counts: o.counts, ended: o.ended, corrected: o.corrected, rounds: o.rounds, calls: o.calls, tokens: [o.tokens_in, o.tokens_out] });
const counts = (/** @type {any} */ o = {}) => ({ tests: 0, edited: 0, ran: 0, delegated: 0, read: 0, other: 0, ...o });

describe("how models did, end to end", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {string} */
  let dataDir;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  const PRICE = { input: 1000, output: 1000 };
  const configure = (/** @type {any} */ cfg) => {
    cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-model": PRICE } }];
    cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
    cfg.memory.autopilot = { enabled: true };
    // The learner reads a session when asked to: it judges which turns pushed back on the reply before (d4).
    cfg.memory.capture = { ...cfg.memory.capture, learn: true };
    cfg.memory.models = { ...cfg.memory.models, summarizer: "brain-model" };
    cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
  };
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-outcomes-e2e-"));
    mkdirSync(join(root, "config"));
    writeFileSync(join(root, "config", "server.json"), '{ "port": 8080 }\n');
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({ memory: true, configure, keep: true });
    dataDir = shim.dataDir;
  });
  after(async () => {
    await shim.stop();
    await up.close();
    // A process just stopped may hold its folder a moment longer on Windows (EPERM): tried until it goes.
    await removeDirs(dataDir, root);
  });
  const mem = () => /** @type {any} */ (shim.app.memory);
  /** Every outcome kept, oldest first. */
  const outcomes = () => mem().archive.outcomes.list({ since: 0 });
  /** A muted session's own layer: memory off for it (Plain keeps memory on — HarnessV3-AtHome AH-D8). */
  const MUTED = { memory: { enabled: false } };
  /** A new session on `model`, with `settings` as its own layer when given. @param {string} model @param {any} [settings] */
  const create = async (model, settings = null) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model, ...(settings ? { settings } : {}) } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return String((await r.json()).id);
  };
  /** One harness turn on session `id`: its request and its reply's words. @param {string} id @param {string} content */
  const turn = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    const json = await r.json();
    return { rid: String(r.headers.get("x-filament-request-id")), text: (json.content || []).filter((/** @type {any} */ b) => b.type === "text").map((/** @type {any} */ b) => b.text).join("") };
  };
  /** A call's system prompt as text. @param {any} call */
  const systemOf = (call) => (typeof call.body.system === "string" ? call.body.system : (call.body.system || []).map((/** @type {any} */ b) => b.text ?? "").join(""));
  /**
   * The learner's verdict, as a model would give it: the turns whose person pushed back on the reply before ("no, …").
   * @param {any} call
   */
  const learned = (call) => words("brain-model", JSON.stringify({ title: "", turns: [], items: [], corrected: [...newest(call).matchAll(/### Turn (\d+) [^\n]*\nUser: no,/g)].map((m) => Number(m[1])) }));
  /** The model's script for the helper's turns, by what the person asked. @param {any} call */
  const helperScript = (call) => {
    if (systemOf(call).startsWith("You extract durable knowledge")) return learned(call);
    const asked = newest(call);
    const done = answered(call);
    if (asked.startsWith("add the helper and test it")) {
      if (!done.has("w1"))
        return reply("brain-model", [toolUse("w1", "write", { path: "helper.js", content: "exports.two = () => 2;\n" }), toolUse("w2", "write", { path: "helper.test.js", content: 'require("node:test")("two", () => {});\n' })], "tool_use");
      if (!done.has("t1")) return reply("brain-model", [toolUse("t1", "bash", { command: "node --test helper.test.js" })], "tool_use");
      return words("brain-model", "Added the helper; its test passes.");
    }
    if (asked.startsWith("no, the helper belongs in lib/")) {
      if (!done.has("q1")) return reply("brain-model", [toolUse("q1", "ask", { question: "Should I create lib/ at the root? I recommend yes." })], "tool_use");
      if (!done.has("w3")) return reply("brain-model", [toolUse("w3", "write", { path: "lib/helper.js", content: "exports.two = () => 2;\n" })], "tool_use");
      return words("brain-model", "Moved it to lib/helper.js.");
    }
    return words("brain-model", "Nothing to do.");
  };

  test("a harness turn that edits and tests is one outcome with its own calls' tokens and cost; the user's correction marks it once the learner reads it; a turn paused on its question and resumed after a restart is one outcome, both halves in it (M7-D48, M7-D50)", async () => {
    brain = helperScript;
    const id = await create("agent/brain-model");
    const first = await turn(id, "add the helper and test it");
    assert.equal(first.text, "Added the helper; its test passes.");
    const [o1, ...more] = outcomes();
    assert.equal(more.length, 0, "one outcome");
    assert.deepEqual(seen(o1), { kind: "turn", agent: null, model: "brain-model", did: "tests", counts: counts({ tests: 1, edited: 2 }), ended: "done", corrected: null, rounds: 3, calls: 3, tokens: [90, 21] });
    assert.ok(near(o1.usd, 3 * CALL_USD), `its own three calls' cost: ${o1.usd}`);
    assert.deepEqual([o1.chain_id, o1.request_id, o1.turn_id], [id, first.rid, mem().archive.turnOfRequest(id, first.rid)], "its session, its request, its turn");
    assert.ok(o1.turn_id != null && o1.ms > 0, "its time: three model calls and a test run");

    // The user corrects it; the turn that answers pauses on the model's own question: nothing is kept for it yet, and
    // nothing is marked by the message's words.
    const asked = await turn(id, "no, the helper belongs in lib/");
    assert.equal(asked.text, "Should I create lib/ at the root? I recommend yes.");
    assert.deepEqual(outcomes().map((/** @type {any} */ o) => [o.id, o.corrected]), [[o1.id, null]], "nothing marked as it arrives; the pause is no end");

    // A restart between the question and its answer: the first half's spend is kept with the pause on the chain.
    await shim.stop();
    shim = await startApp({ memory: true, configure, dataDir });
    const moved = await turn(id, "yes");
    assert.equal(moved.text, "Moved it to lib/helper.js.");
    const [, o2, ...none] = outcomes();
    assert.equal(none.length, 0, "one outcome for the paused turn, written at its end");
    assert.deepEqual(seen(o2), { kind: "turn", agent: null, model: "brain-model", did: "edited", counts: counts({ edited: 1, other: 1 }), ended: "done", corrected: null, rounds: 3, calls: 2, tokens: [90, 21] }, "the question's round and the two after it");
    assert.ok(near(o2.usd, 3 * CALL_USD), `both halves' cost: ${o2.usd}`);
    assert.deepEqual([o2.request_id, o2.turn_id], [moved.rid, mem().archive.turnOfRequest(id, moved.rid)], "on the turn that ended it");
    assert.ok(o2.ms > 0);

    // The learner reads the session: the turn that pushed back marks the reply it answered, once.
    await mem().learner.learnChain(id, { reason: "manual" });
    assert.deepEqual(outcomes().map((/** @type {any} */ o) => [o.id, o.corrected]), [[o1.id, "user"], [o2.id, null]], "the turn before is corrected by the user");
    assert.ok(outcomes()[0].corrected_at >= o1.at);
  });

  test("a turn that hands work to a sub-agent delegated; the sub-agent's exchange is its own outcome, on the turn that launched it; the turn's row holds only its own calls (M7-D48, M7-D56)", async () => {
    brain = (call) => {
      const done = answered(call);
      if (newest(call).includes("read the helper and report its exports"))
        return done.has("r9") ? words("brain-model", "It exports two.") : reply("brain-model", [toolUse("r9", "read", { path: "helper.js" })], "tool_use");
      if (!newest(call).startsWith("ask a sub-agent about the helper")) return words("brain-model", "Nothing to do.");
      if (!done.has("a1")) return reply("brain-model", [toolUse("a1", "agent", { run_in_background: false, description: "Read the helper", prompt: "read the helper and report its exports", subagent_type: "reviewer" })], "tool_use");
      return words("brain-model", "The helper exports two.");
    };
    const before = outcomes().length;
    const id = await create("agent/brain-model");
    const t = await turn(id, "ask a sub-agent about the helper");
    assert.equal(t.text, "The helper exports two.");
    const launched = mem().archive.turnOfRequest(id, t.rid);
    const [sub, own, ...more] = outcomes().slice(before);
    assert.equal(more.length, 0);
    assert.deepEqual(seen(sub), { kind: "subagent", agent: "reviewer", model: "brain-model", did: "read", counts: counts({ read: 1 }), ended: "done", corrected: null, rounds: 2, calls: 1, tokens: [60, 14] }, "the sub-agent's, as its run ended");
    assert.deepEqual([sub.chain_id, sub.turn_id], [id, launched], "on the turn that launched it");
    assert.notEqual(sub.request_id, t.rid, "on its own run");
    assert.deepEqual(seen(own), { kind: "turn", agent: null, model: "brain-model", did: "delegated", counts: counts({ delegated: 1 }), ended: "done", corrected: null, rounds: 2, calls: 1, tokens: [60, 14] }, "the turn's own two calls: never its sub-agent's");
    assert.ok(near(own.usd, 2 * CALL_USD) && near(sub.usd, 2 * CALL_USD), `${own.usd} ${sub.usd}`);
    assert.deepEqual([own.request_id, own.turn_id], [t.rid, launched]);
  });

  test("a sub-agent's exchange is its own outcome: it read, then its model call failed; a muted session's sub-agent keeps none (M7-D48)", async () => {
    const before = outcomes().length;
    brain = (call) => {
      if (!newest(call).includes("read the helper and say what it exports")) return words("brain-model", "Nothing to do.");
      if (!answered(call).has("r1")) return reply("brain-model", [toolUse("r1", "read", { path: "helper.js" })], "tool_use");
      return { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "the scripted model refuses" } } };
    };
    /** Launches the developer's sub-agent on a new session; waits for it to end. @param {any} settings */
    const launch = async (settings) => {
      const id = await create("brain-model", settings);
      const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`, { method: "POST", body: { prompt: "read the helper and say what it exports", description: "Reader" } });
      assert.equal(r.status, 200, await r.clone().text());
      const [sa] = await until(async () => {
        const { subagents } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json();
        return subagents.length && subagents.every((/** @type {any} */ s) => s.status !== "running") ? subagents : null;
      }, "the sub-agent to end");
      return { id, sa };
    };
    const { id, sa } = await launch(null);
    assert.equal(sa.status, "failed", JSON.stringify(sa));
    const [o, ...more] = outcomes().slice(before);
    assert.equal(more.length, 0);
    const x = sa.exchanges[0];
    assert.deepEqual(seen(o), { kind: "subagent", agent: "builder", model: "brain-model", did: "read", counts: counts({ read: 1 }), ended: "failed", corrected: null, rounds: x.rounds, calls: 1, tokens: [x.tokensIn, x.tokensOut] }, "what its exchange reports");
    assert.deepEqual([o.tokens_in, o.tokens_out], [30, 7], "the failed call spent nothing");
    assert.deepEqual([o.chain_id, o.request_id, o.turn_id], [id, sa.runId, null], "in its session, on its run; the developer's own launch has no turn behind it");
    await launch(MUTED);
    assert.equal(outcomes().length, before + 1, "a muted session's sub-agent keeps nothing");
  });

  test("where memory stays out nothing is kept: a muted session, memory's autopilot off, a request that asked it to (M7-D51)", async () => {
    brain = helperScript;
    const before = outcomes().length;
    await turn(await create("agent/brain-model", MUTED), "add the helper and test it");
    assert.equal(outcomes().length, before, "a muted session");
    const autopilot = shim.app.config.memory.autopilot;
    autopilot.enabled = false;
    try {
      await turn(await create("agent/brain-model"), "add the helper and test it");
    } finally {
      autopilot.enabled = true;
    }
    assert.equal(outcomes().length, before, "memory's autopilot off");
    const r = await shim.house("/v1/messages", { model: "agent/brain-model", max_tokens: 200, stream: false, messages: [{ role: "user", content: "add the helper and test it" }] }, { "x-filament-conversation": "quiet", "x-filament-cwd": root, "x-filament-memory": "off" });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    assert.equal(outcomes().length, before, "a request that asked memory to stay out");
  });

  test("how models did reads them back: each model and kind, held, corrected, failed, by what each run did (M7-D52)", async () => {
    const r = await shim.api("/api/memory/outcomes?days=1");
    assert.equal(r.status, 200);
    const { groups, runs } = await r.json();
    assert.equal(runs, outcomes().length);
    const by = Object.fromEntries(groups.map((/** @type {any} */ g) => [`${g.model} ${g.kind}`, [g.runs, g.held, g.corrected, g.failed, g.did.map((/** @type {any} */ d) => d.did)]]));
    assert.deepEqual(by, {
      "brain-model turn": [3, 2, 1, 0, ["tests", "edited", "delegated"]],
      "brain-model subagent": [2, 1, 0, 1, ["read"]],
    });
  });
});
