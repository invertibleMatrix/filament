// @ts-check
// Memory at the moment of action in the harness loop (HarnessV3-Memory M5-3, M5-D4): a pitfall rides on the result of
// the call that walked into it, through the turn's memory handle, and the call that takes the right way gets nothing;
// a command that failed and then worked set up another way is learned (M5-4); an open thread rides on the result of
// the call that touched its file (M5-5).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { projectIdOf } from "../src/core/project-id.js";
import { until } from "./helpers/wait.js";

const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
/** What the model was handed for its last tool call, or null when the last message is no tool result. @param {any} call */
const lastResult = (call) => {
  const content = call.body.messages.at(-1).content;
  const r = Array.isArray(content) ? content.find((/** @type {any} */ c) => c?.type === "tool_result") : null;
  return r ? (typeof r.content === "string" ? r.content : JSON.stringify(r.content)) : null;
};

describe("pitfalls in the agent loop", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-pitfall-loop-"));
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        // brain-first on an upstream of its own: one its provider refuses walls no other model a run goes on to.
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }, { id: "a", name: "a", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-first", upstream: "a", upstreamModel: "{model}", enabled: true }, { match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: true };
        cfg.memory.capture = { ...cfg.memory.capture, learn: true }; // the miner learns as the learner does (M5-4)
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    rmSync(root, { recursive: true, force: true });
  });

  test("a call that walks into a pitfall carries its line; the call that takes the right way does not", async () => {
    const said = await shim.api("/api/memory/remember", { method: "POST", body: { text: "Never run `echo` bare in this repo; run it as `env FILAMENT_PITFALL=1 echo`.", kind: "rule", project: projectIdOf(root) } });
    assert.equal(said.status, 200);
    const { id } = await said.json();
    /** @type {string[]} */
    const seen = [];
    brain = (call) => {
      const result = lastResult(call);
      if (result != null) seen.push(result);
      if (seen.length === 0) return reply([toolUse("p1", "bash", { command: "echo bare" })], "tool_use");
      if (seen.length === 1) return reply([toolUse("p2", "bash", { command: "env FILAMENT_PITFALL=1 echo wrapped" })], "tool_use");
      return reply([{ type: "text", text: "done" }]);
    };
    const r = await shim.house("/v1/messages", { model: "agent/brain-model", max_tokens: 400, stream: false, messages: [{ role: "user", content: "say hi" }] }, { "x-filament-cwd": root, "x-session-id": "pitfall-loop" });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    assert.equal(seen.length, 2, JSON.stringify(seen));
    assert.match(seen[0], new RegExp(`\\n\\n\\[memory ${id} · user said\\] Never run \`echo\` bare in this repo; run it as \`env FILAMENT_PITFALL=1 echo\`\\.$`));
    assert.ok(!seen[1].includes("[memory"), seen[1]);
    const runId = r.headers.get("x-filament-request-id");
    const events = (await (await shim.api(`/api/runs/${runId}/events?since=0&limit=5000`)).json()).events;
    assert.deepEqual(
      events.filter((/** @type {any} */ e) => e.type === "tool-end").map((/** @type {any} */ e) => [e.id, e.memory ?? null]),
      [
        ["p1", [id]],
        ["p2", null],
      ],
    );
  });

  test("a command that failed and then worked set up another way is learned: seen in one session, armed by the next, reminded in a third", async () => {
    const bare = `node -e "process.exit(process.env.FILAMENT_MINE ? 0 : 3)"`;
    /** One loop turn in its own session: the bare command, then the wrapped one; what each result carried. @param {string} session */
    const turn = async (session) => {
      /** @type {string[]} */
      const seen = [];
      brain = (call) => {
        const result = lastResult(call);
        if (result != null) seen.push(result);
        if (seen.length === 0) return reply([toolUse(`${session}-1`, "bash", { command: bare })], "tool_use");
        if (seen.length === 1) return reply([toolUse(`${session}-2`, "bash", { command: `env FILAMENT_MINE=1 ${bare}` })], "tool_use");
        return reply([{ type: "text", text: "done" }]);
      };
      const r = await shim.house("/v1/messages", { model: "agent/brain-model", max_tokens: 400, stream: false, messages: [{ role: "user", content: "run the script" }] }, { "x-filament-cwd": root, "x-session-id": session });
      if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
      await /** @type {any} */ (shim.app.memory).observations.settled();
      return seen;
    };
    const mem = /** @type {any} */ (shim.app.memory);
    const claims = () => mem.archive.triggers.matching(projectIdOf(root), "bash", ["node"]);
    const first = await turn("mine-1");
    assert.equal(first.length, 2);
    const [claim, ...more] = claims();
    assert.equal(more.length, 0);
    assert.deepEqual([claim.kind, claim.status, claim.text], ["fact", "inferred", `\`${bare}\` failed here (exit 3); \`env FILAMENT_MINE=1 ${bare}\` worked.`]);
    assert.deepEqual(mem.archive.triggers.of(claim.id).map((/** @type {any} */ t) => [t.shape, t.unless, t.source]), [["node", "env FILAMENT_MINE=1", "seen"]]);
    const second = await turn("mine-2");
    assert.ok(!second[0].includes("[memory"), "not armed yet when the second session walked into it");
    assert.equal(mem.archive.items.events(claim.id).filter((/** @type {any} */ e) => e.action === "evidence").length, 1);
    const third = await turn("mine-3");
    assert.ok(third[0].endsWith(`\n\n[memory i${claim.id} · inferred] ${claim.text}`), third[0]);
    assert.ok(!third[1].includes("[memory"), "the right way is not reminded");
    assert.equal(claims().length, 1, "one claim, seen three times");
  });

  test("where memory stays out — a muted session, a quiet request — no reminder rides and the miner learns nothing (M6-7)", async () => {
    const said = await shim.api("/api/memory/remember", { method: "POST", body: { text: "Never run `whoami` bare here: use `env FILAMENT_WHO=1 whoami`.", kind: "rule", project: projectIdOf(root) } });
    assert.equal(said.status, 200);
    const { id, itemId } = await said.json();
    const mem = /** @type {any} */ (shim.app.memory);
    /** The calls a careless model makes: the pitfall, then a command that fails and works set up another way. @param {string} tag */
    const careless = (tag) => {
      const failing = `node -e "process.exit(process.env.FILAMENT_${tag} ? 0 : 3)"`;
      /** @type {string[]} */
      const seen = [];
      brain = (call) => {
        const result = lastResult(call);
        if (result != null) seen.push(result);
        if (seen.length === 0) return reply([toolUse(`${tag}-1`, "bash", { command: "whoami" })], "tool_use");
        if (seen.length === 1) return reply([toolUse(`${tag}-2`, "bash", { command: failing })], "tool_use");
        if (seen.length === 2) return reply([toolUse(`${tag}-3`, "bash", { command: `env FILAMENT_${tag}=1 ${failing}` })], "tool_use");
        return reply([{ type: "text", text: "done" }]);
      };
      return seen;
    };
    const learned = (/** @type {string} */ tag) => mem.archive.items.texts(["fact"]).filter((/** @type {any} */ it) => it.text.includes(`FILAMENT_${tag}`));
    const fired = () => mem.archive.items.events(itemId).filter((/** @type {any} */ e) => e.action === "fired").length;

    // A session whose memory is off (its own memory.enabled false — the Memory switch, since Plain keeps memory on):
    // the harness's own turn, through the loop.
    const s = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", settings: { memory: { enabled: false } } } })).json();
    const muted = careless("MUTED");
    const t = await shim.api(`/api/sessions/${s.id}/turns`, { method: "POST", body: { content: "check who I am", stream: false } });
    assert.equal(t.status, 200, await t.text());
    await mem.observations.settled();
    assert.equal(muted.length, 3, JSON.stringify(muted));
    assert.ok(muted.every((r) => !r.includes("[memory")), JSON.stringify(muted));
    assert.equal(fired(), 0, "a muted session fires nothing");
    assert.deepEqual(learned("MUTED"), [], "and teaches the miner nothing");

    // A request that asked memory to stay out.
    const quiet = careless("QUIET");
    const q = await shim.house("/v1/messages", { model: "agent/brain-model", max_tokens: 400, stream: false, messages: [{ role: "user", content: "check who I am" }] }, { "x-filament-cwd": root, "x-session-id": "quiet-loop", "x-filament-memory": "off" });
    if (q.status !== 200) assert.fail(`HTTP ${q.status}: ${await q.text()}`);
    await mem.observations.settled();
    assert.ok(quiet.every((r) => !r.includes("[memory")), JSON.stringify(quiet));
    assert.equal(fired(), 0, "a quiet request fires nothing");
    assert.deepEqual(learned("QUIET"), []);

    // The same calls where memory is on: the reminder rides, and the miner sees the way around the failure.
    const on = careless("HEARD");
    const r = await shim.house("/v1/messages", { model: "agent/brain-model", max_tokens: 400, stream: false, messages: [{ role: "user", content: "check who I am" }] }, { "x-filament-cwd": root, "x-session-id": "heard-loop" });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    await mem.observations.settled();
    assert.ok(on[0].includes(`[memory ${id} · user said]`), on[0]);
    assert.equal(fired(), 1);
    assert.equal(learned("HEARD").length, 1);
  });

  test("an open thread rides on the result of the call that read its file, once a session", async () => {
    writeFileSync(join(root, "notes.md"), "# Notes\n");
    const said = await shim.api("/api/memory/remember", { method: "POST", body: { text: "notes.md still needs a summary section.", kind: "thread", project: projectIdOf(root) } });
    assert.equal(said.status, 200);
    const { id } = await said.json();
    /** @type {string[]} */
    const seen = [];
    brain = (call) => {
      const result = lastResult(call);
      if (result != null) seen.push(result);
      if (seen.length < 2) return reply([toolUse(`n${seen.length + 1}`, "read", { path: "notes.md" })], "tool_use");
      return reply([{ type: "text", text: "done" }]);
    };
    const r = await shim.house("/v1/messages", { model: "agent/brain-model", max_tokens: 400, stream: false, messages: [{ role: "user", content: "summarise the notes" }] }, { "x-filament-cwd": root, "x-session-id": "thread-loop" });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    assert.equal(seen.length, 2);
    assert.ok(seen[0].endsWith(`\n\n[memory ${id} · user said · open thread on notes.md] notes.md still needs a summary section.`), seen[0]);
    assert.ok(!seen[1].includes("[memory"), "once a session");
  });

  /** Waits until a session's sub-agents have all reported. @param {string} id */
  const settledSubagents = (id) =>
    until(async () => {
      const { subagents } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json();
      return subagents.length && subagents.every((/** @type {any} */ s) => s.status !== "running") ? subagents : null;
    }, "the session's sub-agents to report");

  test("a sub-agent is its session's own work: where the session's memory is on, its calls carry their reminders and teach the miner; a muted session's sub-agent gets neither (M7-D3)", async () => {
    const said = await shim.api("/api/memory/remember", { method: "POST", body: { text: "Never run `hostname` bare here: use `env FILAMENT_HOST=1 hostname`.", kind: "rule", project: projectIdOf(root) } });
    assert.equal(said.status, 200);
    const { id, itemId } = await said.json();
    const mem = /** @type {any} */ (shim.app.memory);
    const fired = () => mem.archive.items.events(itemId).filter((/** @type {any} */ e) => e.action === "fired");
    const learned = (/** @type {string} */ tag) => mem.archive.items.texts(["fact"]).filter((/** @type {any} */ it) => it.text.includes(`FILAMENT_${tag}`));
    /**
     * A session's sub-agent, launched by the developer: the pitfall, then a command that fails and works set up another
     * way. What its results carried. @param {string} tag @param {any} settings  the session's own layer, or null
     */
    const launch = async (tag, settings) => {
      const s = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "brain-model", ...(settings ? { settings } : {}) } })).json();
      const failing = `node -e "process.exit(process.env.FILAMENT_${tag} ? 0 : 3)"`;
      /** @type {string[]} */
      const seen = [];
      brain = (call) => {
        const result = lastResult(call);
        if (result != null) seen.push(result);
        if (seen.length === 0) return reply([toolUse(`${tag}-1`, "bash", { command: "hostname" })], "tool_use");
        if (seen.length === 1) return reply([toolUse(`${tag}-2`, "bash", { command: failing })], "tool_use");
        if (seen.length === 2) return reply([toolUse(`${tag}-3`, "bash", { command: `env FILAMENT_${tag}=1 ${failing}` })], "tool_use");
        return reply([{ type: "text", text: "HOST REPORT" }]);
      };
      const r = await shim.api(`/api/sessions/${encodeURIComponent(s.id)}/subagents`, { method: "POST", body: { prompt: "say which host this is", description: "Host" } });
      assert.equal(r.status, 200, await r.clone().text());
      const [done] = await settledSubagents(s.id);
      assert.equal(done.status, "done", JSON.stringify(done));
      await mem.observations.settled();
      return { seen, session: String(s.id) };
    };

    const on = await launch("SUBON", null);
    assert.equal(on.seen.length, 3, JSON.stringify(on.seen));
    assert.ok(on.seen[0].includes(`[memory ${id} · user said]`), on.seen[0]);
    assert.deepEqual(fired().map((/** @type {any} */ e) => [e.detail.chain, e.detail.turn ?? null]), [[on.session, null]], "in its session; the developer's own launch has no turn behind it");
    assert.equal(learned("SUBON").length, 1, "the miner saw the way around the failure");

    const muted = await launch("SUBMUTE", { memory: { enabled: false } });
    assert.equal(muted.seen.length, 3, JSON.stringify(muted.seen));
    assert.ok(muted.seen.every((r) => !r.includes("[memory")), JSON.stringify(muted.seen));
    assert.equal(fired().length, 1, "a muted session's sub-agent fires nothing");
    assert.deepEqual(learned("SUBMUTE"), [], "and teaches the miner nothing");

    const autopilot = shim.app.config.memory.autopilot;
    autopilot.enabled = false;
    try {
      const off = await launch("SUBOFF", null);
      assert.equal(off.seen.length, 3, JSON.stringify(off.seen));
      assert.ok(off.seen.every((r) => !r.includes("[memory")), JSON.stringify(off.seen));
      assert.equal(fired().length, 1, "memory's autopilot off: its sub-agent fires nothing");
      assert.deepEqual(learned("SUBOFF"), [], "and teaches the miner nothing");
    } finally {
      autopilot.enabled = true;
    }
  });

  test("a sub-agent the turn launched opens with memory's brief — what came since the session's briefing, never what that briefing already carries — and what memory said to it is the launching turn's (M7-1, M7-D9)", async () => {
    const CHILD = "You are a sub-agent run by Filament";
    const mem = /** @type {any} */ (shim.app.memory);
    /** @param {string} text @param {string} [kind] */
    const remember = async (text, kind = "rule") => {
      const r = await shim.api("/api/memory/remember", { method: "POST", body: { text, kind, project: projectIdOf(root) } });
      assert.equal(r.status, 200);
      return r.json();
    };
    await remember("Always quote paths that hold spaces in this repo.");
    const s = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "brain-model" } })).json();
    /** @type {any[]} */
    const child = [];
    brain = (call) => {
      const result = lastResult(call);
      if (JSON.stringify(call.body?.system ?? "").includes(CHILD)) {
        child.push(call);
        return result == null ? reply([toolUse("pwd-1", "bash", { command: "pwd" })], "tool_use") : reply([{ type: "text", text: "PWD REPORT" }]);
      }
      if (!JSON.stringify(call.body.messages).includes("check the folder")) return reply([{ type: "text", text: "HI" }]);
      return result == null ? reply([toolUse("ag-1", "agent", { run_in_background: false, description: "Where am I", prompt: "Say which folder this is." })], "tool_use") : reply([{ type: "text", text: "MAIN DONE" }]);
    };
    /** @param {string} content */
    const turn = async (content) => {
      const t = await shim.api(`/api/sessions/${encodeURIComponent(s.id)}/turns`, { method: "POST", body: { content, stream: false } });
      assert.equal(t.status, 200, await t.clone().text());
      return t.text();
    };
    await turn("hello"); // the session's briefing is built here, the quoting rule in it
    const { id, itemId } = await remember("Never run `pwd` bare here: use `env FILAMENT_PWD=1 pwd`.", "fact");
    assert.match(await turn("check the folder"), /MAIN DONE/);
    await mem.observations.settled();
    assert.match(JSON.stringify(child[0].body.system), /Always quote paths that hold spaces/, "the session's briefing rides the sub-agent's requests");
    const opening = child[0].body.messages[0].content.map((/** @type {any} */ b) => b.text);
    assert.equal(opening.length, 2, "the brief, then the task");
    assert.ok(opening[0].startsWith("<memory>\nMemory for your task (Filament), for a sub-agent that starts without the session's conversation: what the user and past sessions established, beyond the session's briefing in your system prompt, which it does not repeat."), opening[0]);
    assert.match(opening[0], new RegExp(`\\nPitfalls of the tools you have \\(each is said again at the call that walks into it\\):\\n- \\[${id} fact · user said · [^\\]]+\\] Never run \`pwd\` bare here`), "a pitfall said since the briefing, of a tool it has");
    assert.ok(!opening[0].includes("Always quote paths"), "what the briefing carries is not said twice");
    assert.ok(opening[0].endsWith("\n</memory>"));
    assert.equal(opening[1], "Say which folder this is.");
    assert.ok(lastResult(child[1])?.includes(`[memory ${id} · user said]`), "the pitfall rides its call too");
    const [launching] = mem.archive.getTurns(String(s.id), { from: 2, to: 2 });
    assert.deepEqual(mem.archive.items.events(itemId).filter((/** @type {any} */ e) => e.action === "fired").map((/** @type {any} */ e) => [e.detail.chain, e.detail.turn]), [[String(s.id), launching.id]]);
    const view = await (await shim.api(`/api/memory/sessions/${encodeURIComponent(s.id)}/turns/2/memory`)).json();
    assert.deepEqual(view.shown.find((/** @type {any} */ c) => c.id === id)?.layers, ["brief"], JSON.stringify(view.shown));
    assert.deepEqual(view.reminders.map((/** @type {any} */ r) => [r.claim.id, r.kind, r.times]), [[id, "pitfall", 1]]);
  });

  // (fails before: yes, at 149af7f76's parent — the server handed memory's brief no model, so a sub-agent on a model
  // Memory settings exclude, from a chat they leave in, opened with the user's rules; the review of 149af7f76 found the
  // wiring pinned by no test)
  test("a sub-agent on a model Memory settings exclude opens with no brief, one on a model they take in with it: the server hands memory the model its calls go out on", async () => {
    const CHILD = "You are a sub-agent run by Filament";
    const RULE = "Never push without the owner's word.";
    const r = await shim.api("/api/memory/remember", { method: "POST", body: { text: RULE, kind: "rule", project: projectIdOf(root) } });
    assert.equal(r.status, 200);
    const s = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "brain-model" } })).json();
    /** @type {any[]} */
    const child = [];
    brain = (call) => {
      if (JSON.stringify(call.body?.system ?? "").includes(CHILD)) child.push(call);
      return reply([{ type: "text", text: "DONE" }]);
    };
    const capture = shim.app.config.memory.capture;
    const was = capture.excludeModels;
    capture.excludeModels = ["brain-out"];
    try {
      /** @type {Record<string, string>} */
      const opened = {};
      for (const model of ["brain-out", "brain-in"]) {
        const launched = await shim.api(`/api/sessions/${encodeURIComponent(s.id)}/subagents`, { method: "POST", body: { prompt: "How do the tests run here?", model, memory: true } });
        assert.equal(launched.status, 200, await launched.clone().text());
        const call = await until(() => child.find((c) => c.body.model === model) || null, `${model}'s first call`);
        opened[model] = call.body.messages[0].content.map((/** @type {any} */ b) => b.text).join("\n");
      }
      assert.ok(!opened["brain-out"].includes("<memory>"), "the excluded model: no brief");
      assert.ok(opened["brain-in"].includes(RULE), "a model memory takes in: the brief, the user's rule in it");
    } finally {
      capture.excludeModels = was;
    }
  });

  // (fails before: yes, with server.js's `leftOut` line taken out — the review of 9f9be41b7 found that wiring pinned by
  // no test: without it a sub-agent's run that went on to a model Memory settings exclude sent it the brief)
  test("a sub-agent whose run goes on to a model Memory settings exclude sends it no brief: the server asks memory of the model it goes on to", async () => {
    const CHILD = "You are a sub-agent run by Filament";
    const RULE = "Never force-push the release branch.";
    const r = await shim.api("/api/memory/remember", { method: "POST", body: { text: RULE, kind: "rule", project: projectIdOf(root) } });
    assert.equal(r.status, 200);
    const s = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "brain-model" } })).json();
    const card = await shim.api("/api/agents", { method: "POST", body: { tag: "failover-tester", name: "Failover tester", goodFor: "How the tests run", thinks: "You read the repo.", models: ["brain-first", "brain-out"] } });
    assert.equal(card.status, 200, await card.clone().text());
    /** @type {any[]} */
    const child = [];
    brain = (call) => {
      if (!JSON.stringify(call.body?.system ?? "").includes(CHILD)) return reply([{ type: "text", text: "HI" }]);
      child.push(call);
      if (call.body.model === "brain-first") return { status: 402, json: { type: "error", error: { type: "billing_error", message: "Insufficient balance" } } };
      return reply([{ type: "text", text: "DONE" }]);
    };
    const capture = shim.app.config.memory.capture;
    const was = capture.excludeModels;
    capture.excludeModels = ["brain-out"];
    try {
      const launched = await shim.api(`/api/sessions/${encodeURIComponent(s.id)}/subagents`, { method: "POST", body: { prompt: "How do the tests run here?", as: "failover-tester", memory: true } });
      assert.equal(launched.status, 200, await launched.clone().text());
      const out = await until(() => child.find((c) => c.body.model === "brain-out") || null, "brain-out's call");
      const text = (/** @type {any} */ c) => c.body.messages[0].content.map((/** @type {any} */ b) => b.text).join("\n");
      assert.ok(text(child.find((c) => c.body.model === "brain-first")).includes(RULE), "the model the brief was written for: the user's rule in it");
      assert.ok(!text(out).includes("<memory>"), "the excluded model the run went on to: no brief");
    } finally {
      capture.excludeModels = was;
    }
  });

  test("a sub-agent is a conversation of its own: an open thread said to the main loop is said again at the sub-agent's call, once there, on the launching turn (M7-3)", async () => {
    const CHILD = "You are a sub-agent run by Filament";
    const mem = /** @type {any} */ (shim.app.memory);
    writeFileSync(join(root, "plan.md"), "# Plan\n");
    const said = await shim.api("/api/memory/remember", { method: "POST", body: { text: "plan.md still needs a rollout section.", kind: "thread", project: projectIdOf(root) } });
    assert.equal(said.status, 200);
    const { id, itemId } = await said.json();
    const s = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "brain-model" } })).json();
    /** @type {string[]} */
    const main = [];
    /** @type {string[]} */
    const child = [];
    brain = (call) => {
      const result = lastResult(call);
      if (JSON.stringify(call.body?.system ?? "").includes(CHILD)) {
        if (result != null) child.push(result);
        return child.length < 2 ? reply([toolUse(`plan-c${child.length + 1}`, "read", { path: "plan.md" })], "tool_use") : reply([{ type: "text", text: "PLAN REPORT" }]);
      }
      if (!JSON.stringify(call.body.messages).includes("review the plan")) return reply([{ type: "text", text: "HI" }]);
      if (result != null) main.push(result);
      if (main.length === 0) return reply([toolUse("plan-m1", "read", { path: "plan.md" })], "tool_use");
      if (main.length === 1) return reply([toolUse("plan-ag", "agent", { run_in_background: false, description: "Plan", prompt: "Read plan.md and say what it lacks." })], "tool_use");
      return reply([{ type: "text", text: "MAIN DONE" }]);
    };
    const t = await shim.api(`/api/sessions/${encodeURIComponent(s.id)}/turns`, { method: "POST", body: { content: "review the plan", stream: false } });
    assert.equal(t.status, 200, await t.clone().text());
    assert.match(await t.text(), /MAIN DONE/);
    await mem.observations.settled();
    const line = `[memory ${id} · user said · open thread on plan.md] plan.md still needs a rollout section.`;
    assert.ok(main[0].endsWith(`\n\n${line}`), main[0]);
    assert.equal(child.length, 2, JSON.stringify(child));
    assert.ok(child[0].endsWith(`\n\n${line}`), `said again in the sub-agent's conversation: ${child[0]}`);
    assert.ok(!child[1].includes("[memory"), "once there");
    const [sub] = await settledSubagents(String(s.id));
    const [launching] = mem.archive.getTurns(String(s.id), { from: 1, to: 1 });
    assert.deepEqual(
      mem.archive.items.events(itemId).filter((/** @type {any} */ e) => e.action === "fired").map((/** @type {any} */ e) => e.detail),
      [
        { chain: String(s.id), turn: launching.id, file: "plan.md" },
        { chain: String(s.id), turn: launching.id, conversation: sub.id, file: "plan.md" },
      ],
    );
  });

  test("what a sub-agent the turn launched found is its finding, on the launching turn — read from its report and said by its own remember — and what the main agent remembers is the turn's (M7-2, M7-D20)", async () => {
    const CHILD = "You are a sub-agent run by Filament";
    const READS = "A coding session had an AI assistant";
    const mem = /** @type {any} */ (shim.app.memory);
    const models = shim.app.config.memory.models;
    shim.app.config.memory.models = { ...models, summarizer: "brain-learn" };
    writeFileSync(join(root, "registry.md"), "The widget registry lives in src/registry.js.\n");
    try {
      const s = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "brain-model" } })).json();
      /** The id of the call the last message answers, or null. @param {any} call */
      const answered = (call) => {
        const content = call.body.messages.at(-1).content;
        return (Array.isArray(content) ? content.find((/** @type {any} */ c) => c?.type === "tool_result") : null)?.tool_use_id ?? null;
      };
      /** @type {any[]} */
      const read = [];
      brain = (call) => {
        const system = JSON.stringify(call.body?.system ?? "");
        if (system.includes(READS)) {
          read.push(call);
          return reply([{ type: "text", text: JSON.stringify({ items: [{ kind: "fact", text: "The widget registry lives in src/registry.js." }] }) }]);
        }
        if (system.includes(CHILD)) {
          const was = answered(call);
          if (was == null) return reply([toolUse("mem-child", "filament_memory_remember", { text: "The widget tests live in test/widgets.", kind: "fact" })], "tool_use");
          if (was === "mem-child") return reply([toolUse("rd-child", "read", { path: "registry.md" })], "tool_use");
          return reply([{ type: "text", text: "The widget registry lives in src/registry.js." }]);
        }
        const was = answered(call);
        if (was == null) return reply([toolUse("mem-main", "filament_memory_remember", { text: "The widget code is in src/widgets.", kind: "fact" })], "tool_use");
        if (was === "mem-main") return reply([toolUse("ag-map", "agent", { run_in_background: false, description: "Map", prompt: "Map the widgets." })], "tool_use");
        return reply([{ type: "text", text: "MAIN DONE" }]);
      };
      const t = await shim.api(`/api/sessions/${encodeURIComponent(s.id)}/turns`, { method: "POST", body: { content: "map the widgets", stream: false } });
      assert.equal(t.status, 200, await t.clone().text());
      assert.match(await t.text(), /MAIN DONE/);
      await mem.observations.settled();
      await mem.learner.settled();
      const [launching] = mem.archive.getTurns(String(s.id), { from: 1, to: 1 });
      const filed = mem.archive.items.list({ chainId: String(s.id) }).map((/** @type {any} */ it) => [it.text, it.origin, it.turn_id]).sort();
      assert.deepEqual(filed, [
        ["The widget code is in src/widgets.", "model", launching.id],
        ["The widget registry lives in src/registry.js.", "subagent", launching.id],
        ["The widget tests live in test/widgets.", "subagent", launching.id],
      ]);
      const owner = shim.app.memory.scope({ role: "owner" });
      const finderOf = (/** @type {string} */ text) => owner.claim(`i${mem.archive.items.list({ chainId: String(s.id) }).find((/** @type {any} */ it) => it.text === text).id}`).finder;
      const fromReport = finderOf("The widget registry lives in src/registry.js.");
      assert.match(fromReport.agent, /^sa_[0-9a-f]{8}$/);
      assert.deepEqual(fromReport, { agent: fromReport.agent, type: "builder", model: "brain-model" });
      assert.deepEqual(finderOf("The widget tests live in test/widgets."), { agent: fromReport.agent, model: "brain-model" }, "its own remember names it too");
      assert.equal(read.length, 1, "its report was read once");
      const asked = [].concat(read[0].body.messages[0].content).map((/** @type {any} */ b) => (typeof b === "string" ? b : b.text)).join("");
      assert.ok(asked.includes('Its task:\nMap the widgets.\n\nThe calls it made, oldest first (1):\n- read {"path":"registry.md"}\n\nIts report:\nThe widget registry lives in src/registry.js.'), asked);
      const view = await (await shim.api(`/api/memory/sessions/${encodeURIComponent(s.id)}/turns/1/memory`)).json();
      assert.equal(view.said.length, 3, `the turn's memory lists all three as said this turn: ${JSON.stringify(view.said)}`);
    } finally {
      shim.app.config.memory.models = models;
    }
  });
});
