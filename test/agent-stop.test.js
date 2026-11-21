// @ts-check
// The agent tool stops a sub-agent itself (ag-stop, the owner's of 11-11: asked to stop a sub-agent, the agent sent it a
// message asking it to stop, which it reads only at its next step, where the developer's own Stop halted it at once).
// `agent_id` with `stop: true`, on the loop's agent tool and a coding agent's, is a stop into its run, as the developer's
// is: no message is sent, its report so far comes as its report would, and the agent hears it "was stopped as you
// asked". What a stop cannot carry is refused in words, as is a stop of what is not the agent's to stop: one Filament
// started by itself, a flow's box. A graph task's sub-agent stopped this way sets its task aside, as the developer's Stop
// does. Against a scripted registry (helpers/team.js `watched`), a coding agent's turn and Filament's MCP door over it,
// and the graph runner wired as server.js wires it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAgentTurns } from "../src/app/agent-inbox.js";
import { createLaunchTurn } from "../src/app/agent-launch.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";
import { PROMPT_VERSION, TOOL_TEXT } from "../src/app/agent/prompt.js";
import { noSuchSubagent } from "../src/app/agent/subagents.js";
import { AGENT_TOOL, agentToolFor, argSummary, coderAgentToolFor } from "../src/app/agent/tools.js";
import * as tg from "../src/core/task-graph.js";
import { cardOf } from "../src/core/tool-vocab.js";
import { roundRows } from "../src/ui/harness/conversation/tools/render.js";
import { alignEvents, callWords } from "../src/ui/harness/lib/labels.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { watched } from "./helpers/team.js";
import { until } from "./helpers/wait.js";

/** The `stop` field's words, on both agent tools. */
const STOP_WORDS =
  "With agent_id: stop that sub-agent now, alone (no prompt). It stops at once, as the developer's Stop does, whatever it is doing, and no message is sent to it. What it did stays: its report so far comes as its report would, its changes stay where it made them, and a follow-up takes it up again in the context it has. Asked to stop one, stop it: a message asking it to stop is read only at its next step.";
/** The sentence both tools' texts carry, after the one on what agent_id continues. */
const STOP_LINE = "agent_id with stop: true stops one still at work, at once: never ask one to stop by a message, which it reads only at its next step.";
/** What a stop answers, by where its sub-agent's report so far goes. @param {string} who @param {string} id */
const ANSWER = (who, id) => ({
  message: `Stopping ${who} now, with no message sent to it. Its report so far arrives as a message. To take it up again in the context it has, call agent with agent_id "${id}" and a prompt.`,
  call: `Stopping ${who} now, with no message sent to it. Its report so far comes as its launching call's result. To take it up again in the context it has, call agent with agent_id "${id}" and a prompt.`,
  theirs: `Stopping ${who} now, with no message sent to it. Its report so far stays the developer's, who may send it on to you. To take it up again in the context it has, call agent with agent_id "${id}" and a prompt.`,
});
/** A stop steered into a run, as the agent's. @param {string} runId */
const STOP = (runId) => ({ runId, kind: "stop", text: "", from: "agent" });

/**
 * The agent's turn on a registry, and its agent tool's calls: the loop's, or a coding agent's (`coder`).
 * @param {ReturnType<typeof watched>} w @param {{ coder?: boolean }} [o]
 */
const turnOf = (w, { coder = false } = {}) => {
  const door = w.registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: w.dir, mode: "edit", model: "m-main", thinking: null, fork: null });
  let n = 0;
  /** @param {any} input */
  const call = (input) => door.subagents.run({ id: `tu-${++n}`, input: { description: "Fix the parser", ...(coder ? { run_in_background: true } : {}), ...input }, emit: () => {}, signal: /** @type {any} */ (null), coder });
  return { door, call };
};
/** A sub-agent's run, attached. @param {ReturnType<typeof watched>} w @param {string} id @param {number} n */
const attached = async (w, id, n) => {
  const r = await w.run(n);
  assert.equal(r.id, id);
  r.attach();
  await until(() => w.registry.get(id)?.runId === r.runId, "its run to attach");
  return r;
};
/** A sub-agent launched in the background, its run attached. @param {ReturnType<typeof watched>} w @param {ReturnType<typeof turnOf>} t @param {number} n @param {any} [more] */
const launched = async (w, t, n, more = {}) => {
  const out = await t.call({ prompt: "fix parse() for an empty file", ...more });
  assert.equal(out.ok, true, out.text);
  const r = await w.run(n);
  const id = r.id;
  r.attach();
  await until(() => w.registry.get(id)?.runId === r.runId, "its run to attach");
  return { id, r };
};
/** One the registry launched for someone else — the developer, Filament itself, a flow —, its run attached. @param {ReturnType<typeof watched>} w @param {number} n @param {any} spec */
const others = async (w, n, spec) => {
  const made = /** @type {any} */ (await w.registry.launch({ chainId: "c1", ...spec }));
  assert.equal(made.ok, true, made.error);
  return { id: String(made.id), r: await attached(w, String(made.id), n) };
};

// (fails before: yes — neither tool had the field, nor either tool's text the sentence)
test("both agent tools take stop after agent_id, in the same words; agent_id says so, and each tool's text says to stop one rather than ask it; version 122", () => {
  assert.equal(PROMPT_VERSION, 129);
  const loop = /** @type {any} */ (AGENT_TOOL.input_schema.properties);
  const coder = /** @type {any} */ (coderAgentToolFor({ asks: [] })).input_schema.properties;
  const machines = /** @type {any} */ (coderAgentToolFor({ asks: [], machines: true })).input_schema.properties;
  for (const props of [loop, coder, machines, /** @type {any} */ (agentToolFor([], [], true)).input_schema.properties]) {
    assert.deepEqual(props.stop, { type: "boolean", description: STOP_WORDS });
    const keys = Object.keys(props);
    assert.equal(keys[keys.indexOf("agent_id") + 1], "stop", "after agent_id");
    assert.ok(props.agent_id.description.endsWith(" one still at work reads it as a message at its next step. To stop it instead, stop: true. subagent_type and context are ignored."), props.agent_id.description);
  }
  assert.equal(coder.stop, loop.stop, "one field, shared");
  assert.ok(TOOL_TEXT.agent.includes(` agent_id continues a sub-agent you launched earlier in this session, in the context it already has ("check again"), with prompt as your follow-up. ${STOP_LINE} Use it for searches across many files`), TOOL_TEXT.agent);
  assert.ok(TOOL_TEXT.coderAgent.includes(` agent_id continues a sub-agent you launched, in the context it already has. ${STOP_LINE} One that changes files may work in its own git worktree`), TOOL_TEXT.coderAgent);
  assert.ok(/** @type {any} */ (coderAgentToolFor({ asks: [], machines: true })).description.length < 2048, "a coding agent's, with the machines' sentence, stays whole where Claude Code cuts a description");
});

for (const coder of [false, true]) {
  const whose = coder ? "a coding agent's" : "the loop's";
  // (fails before: yes — the owner's of 11-11: the tool had no stop, so `stop: true` beside an agent_id was a follow-up
  // with no words — "a message needs words" — and the agent wrote the sub-agent a message asking it to stop)
  test(`${whose} agent_id with stop: true stops a sub-agent at work at once, no message sent; the agent hears it was stopped as it asked, with its report so far, and a follow-up takes it up again`, async () => {
    const w = watched();
    const t = turnOf(w, { coder });
    const { id, r } = await launched(w, t, 1);
    const out = await t.call({ agent_id: id, stop: true });
    assert.deepEqual(out, { ok: true, text: ANSWER(`sub-agent ${id}`, id).message, spentUsd: 0, toolCalls: 0, roundIds: [], wrote: false, note: `agent: stopped sub-agent ${id} (Builder, m-main)` });
    assert.deepEqual(w.steers, [STOP(r.runId)], "a stop into its run, as the agent's — and nothing else");
    assert.equal(w.registry.get(id)?.exchanges.length, 1, "no follow-up of its own");
    r.finish({ status: "stopped", report: "I had read parse.js.", stoppedBy: "agent" });
    const o = await w.registry.settled(id);
    assert.deepEqual([o?.status, o?.stoppedBy], ["stopped", "agent"]);
    const [d] = t.door.inbox.take();
    assert.ok(d.text.startsWith(`[Filament: your background sub-agent ${id} ("Fix the parser") was stopped as you asked. You asked it:\nfix parse() for an empty file\n\nIts report:\nI had read parse.js.`), d.text);
    assert.ok(d.text.endsWith(`To ask it more in the same context, call agent with agent_id "${id}".]`), d.text);
    // Stopped, there is nothing to stop: in words that say how it ended, and the way on.
    await assert.rejects(t.call({ agent_id: id, stop: true }), { message: `sub-agent ${id} is not running — it was stopped as you asked: there is nothing to stop. To take it up again, follow it up: agent_id "${id}" with a prompt` });
    assert.equal(w.steers.length, 1);
    const again = await t.call({ agent_id: id, prompt: "Go on: log the count." });
    assert.equal(again.ok, true, again.text);
    assert.match(again.text, new RegExp(`^Sub-agent ${id} took your follow-up`));
    const next = await attached(w, id, 2);
    next.finish({ status: "done", report: "LOGGED" });
    await w.registry.settled(id);
    await assert.rejects(t.call({ agent_id: id, stop: true }), { message: `sub-agent ${id} is not running — it finished: there is nothing to stop. To take it up again, follow it up: agent_id "${id}" with a prompt` });
    t.door.close();
  });
}

// (fails before: yes — the same: with no stop, the call was a follow-up refused for its missing words, and the launch ran on)
test("a stop before the sub-agent's run exists cuts its request, and its end still says whose stop it was", async () => {
  const w = watched();
  const t = turnOf(w);
  const launch = await t.call({ prompt: "fix parse() for an empty file" });
  assert.equal(launch.ok, true, launch.text);
  const id = (await w.run(1)).id;
  const out = await t.call({ agent_id: id, stop: true });
  assert.deepEqual([out.ok, out.text], [true, ANSWER(`sub-agent ${id}`, id).message]);
  const o = await w.registry.settled(id);
  assert.deepEqual([o?.status, o?.error, o?.stoppedBy, w.steers], ["aborted", "stopped before it finished", "agent", []], "no run to steer: its request was cut");
  const [d] = t.door.inbox.take();
  assert.ok(d.text.startsWith(`[Filament: your background sub-agent ${id} ("Fix the parser") was stopped as you asked. You asked it:`), d.text);
  t.door.close();
});

// (fails before: yes — the same; and a launch's own call answered "[Filament: the sub-agent was stopped by the developer")
test("one whose launching call still waits: the stop says its report so far is that call's result, which says it was stopped as the agent asked", async () => {
  const w = watched();
  const t = turnOf(w);
  const waiting = t.call({ prompt: "fix parse() for an empty file", run_in_background: false });
  const r = await w.run(1);
  const id = r.id;
  r.attach();
  await until(() => w.registry.get(id)?.runId === r.runId, "its run to attach");
  const out = await t.call({ agent_id: id, stop: true });
  assert.deepEqual([out.ok, out.text], [true, ANSWER(`sub-agent ${id}`, id).call]);
  assert.deepEqual(w.steers, [STOP(r.runId)]);
  r.finish({ status: "stopped", report: "I had read parse.js.", stoppedBy: "agent" });
  const answer = await waiting;
  assert.equal(answer.ok, false);
  assert.ok(answer.text.startsWith("[Filament: the sub-agent was stopped as you asked; what it reported is below]\nI had read parse.js."), answer.text);
  assert.equal(answer.note, `agent: launched sub-agent ${id} (Builder, m-main) — was stopped by the agent after 2 rounds, 1 tool call`);
  assert.deepEqual(t.door.inbox.take(), [], "nothing more comes as a message");
  t.door.close();
});

// (fails before: yes — each of these was read as a follow-up or a launch: a message sent, a model listed, an apply made)
test("what a stop cannot carry is refused in words, each naming what to leave out, and nothing is stopped or sent", async () => {
  const w = watched();
  const t = turnOf(w, { coder: true });
  const { id } = await launched(w, t, 1);
  /** @param {string} fields */
  const alone = (fields) => `a stop stops the sub-agent and nothing more — leave ${fields} out: it is sent no words, and a follow-up or an apply is a call of its own once it stopped`;
  await assert.rejects(t.call({ stop: true }), { message: "stop needs agent_id: the sub-agent to stop" });
  await assert.rejects(t.call({ stop: true, agent_id: "  " }), { message: "stop needs agent_id: the sub-agent to stop" });
  await assert.rejects(t.call({ stop: true, prompt: "Stop now." }), { message: "stop needs agent_id: the sub-agent to stop" });
  /** @type {[Record<string, any>, string][]} */
  const cases = [
    [{ prompt: "Please stop." }, "prompt"],
    [{ apply_changes: true }, "apply_changes"],
    [{ mark_applied: true }, "mark_applied"],
    [{ sync: true }, "sync"],
    [{ changes: "uncommitted" }, "changes"],
    [{ overlap: "mine" }, "overlap"],
    [{ task: "t1" }, "task"],
    [{ model: "opus" }, "model"],
    [{ provider: "anthropic" }, "provider"],
    [{ effort: "high" }, "effort"],
    [{ saved_agent: "Product" }, "saved_agent"],
    [{ subagent_type: "reviewer" }, "subagent_type"],
    [{ context: "folded" }, "context"],
    [{ machine: "workstation" }, "machine"],
    [{ cwd: "/w" }, "cwd"],
    [{ list_models: true }, "list_models"],
    [{ list_machines: true }, "list_machines"],
    [{ prompt: "Stop, then apply.", apply_changes: true, overlap: "mine" }, "prompt, apply_changes and overlap"],
    [{ list_models: true, model: "opus", machine: "workstation" }, "model, list_models and machine"],
  ];
  for (const [more, fields] of cases) await assert.rejects(t.call({ agent_id: id, stop: true, ...more }), { message: alone(fields) }, fields);
  // What says nothing is no field given: a blank, a false, the call's own line and where a launch would run.
  await assert.rejects(t.call({ agent_id: "sa_nope", stop: true, prompt: "  ", apply_changes: false, list_models: false }), { message: noSuchSubagent("sa_nope") });
  // Another chat's is no sub-agent of this one's.
  const far = /** @type {any} */ (await w.registry.launch({ origin: "agent", chainId: "c2", prompt: "elsewhere", description: "Elsewhere", background: true }));
  assert.equal(far.ok, true, far.error);
  await assert.rejects(t.call({ agent_id: far.id, stop: true }), { message: noSuchSubagent(far.id) });
  assert.deepEqual(w.steers, [], "nothing steered");
  assert.deepEqual([w.registry.get(id)?.status, w.registry.get(far.id)?.status], ["running", "running"]);
  assert.deepEqual(t.door.inbox.take(), []);
  t.door.close();
});

// (fails before: yes — e74cea12b's left: `ENDED.stopped` read "was stopped by the developer" wherever no reader asked
// whose stop it was, so a sub-agent Filament stopped reached its agent as the developer's stop)
test("a sub-agent Filament stopped is said to the agent as Filament's stop — in its report's message and in a stop that finds it ended — never the developer's", async () => {
  const w = watched();
  const t = turnOf(w);
  const { id, r } = await launched(w, t, 1);
  r.finish({ status: "stopped", report: "I had read parse.js.", stoppedBy: "filament" });
  const o = await w.registry.settled(id);
  assert.deepEqual([o?.status, o?.stoppedBy], ["stopped", "filament"]);
  const [d] = t.door.inbox.take();
  assert.ok(d.text.startsWith(`[Filament: your background sub-agent ${id} ("Fix the parser") was stopped by Filament. You asked it:`), d.text);
  await assert.rejects(t.call({ agent_id: id, stop: true }), { message: `sub-agent ${id} is not running — it was stopped by Filament: there is nothing to stop. To take it up again, follow it up: agent_id "${id}" with a prompt` });
  t.door.close();
});

// (fails before: yes — the stop looked among the sub-agents the registry held, where a follow-up and an apply read the
// session's kept threads back first: after a restart it answered that there was no such sub-agent)
test("a sub-agent the session kept from before a restart is read back first: its stop says it runs no more and the way on, never that there is none", async () => {
  /** @type {Map<string, any>} */
  const threads = new Map();
  const keeps = {
    saveThread: (/** @type {string} */ _chain, /** @type {any} */ thread) => void threads.set(thread.id, structuredClone(thread)),
    loadThreads: () => [...threads.values()].map((x) => structuredClone(x)),
  };
  const before = watched({ extra: keeps });
  const t0 = turnOf(before);
  const { id, r } = await launched(before, t0, 1);
  r.finish({ status: "done", report: "PARSED" });
  await before.registry.settled(id);
  t0.door.close();
  assert.ok(threads.has(id), "its thread is kept with the session");
  // Filament restarted: a registry of its own, which holds nothing of the session until it reads what it kept.
  const w = watched({ extra: keeps });
  const t = turnOf(w);
  await assert.rejects(t.call({ agent_id: id, stop: true }), { message: `sub-agent ${id} is not running — it finished: there is nothing to stop. To take it up again, follow it up: agent_id "${id}" with a prompt` });
  assert.deepEqual(w.steers, []);
  t.door.close();
});

// (fails before: yes — its thread said "Your work on it was stopped by the developer" of every stop, the agent's own
// included: the one line that told the sub-agent who stopped it named the wrong one)
test("a sub-agent the agent stopped, taken up fresh after a restart, reads in its thread that the agent stopped its work — never the developer", async () => {
  /** @type {Map<string, any>} */
  const threads = new Map();
  // A session that gives a thread back without its conversation: what was said is all a fresh agent has of it.
  const keeps = {
    saveThread: (/** @type {string} */ _chain, /** @type {any} */ thread) => void threads.set(thread.id, structuredClone(thread)),
    loadThreads: () => [...threads.values()].map(({ convo: _gone, ...x }) => structuredClone(x)),
  };
  const before = watched({ extra: keeps });
  const t0 = turnOf(before);
  const { id, r } = await launched(before, t0, 1);
  assert.equal((await t0.call({ agent_id: id, stop: true })).ok, true);
  r.finish({ status: "stopped", report: "I had read parse.js.", stoppedBy: "agent" });
  await before.registry.settled(id);
  t0.door.close();
  // Filament restarted: its conversation is gone, and its next message starts it fresh on what its thread says.
  const w = watched({ extra: keeps });
  const t = turnOf(w);
  const again = await t.call({ agent_id: id, prompt: "Go on: log the count." });
  assert.equal(again.ok, true, again.text);
  const sent = JSON.stringify((await w.run(1)).body);
  assert.ok(sent.includes("Your work on it was stopped by the agent. What you had said by then:\\nI had read parse.js."), sent.slice(0, 2000));
  assert.ok(!sent.includes("stopped by the developer"), "the developer stopped nothing");
  t.door.close();
});

// (fails before: yes — the same: no stop of the agent's reached any sub-agent)
test("the developer's own sub-agent is the agent's to stop, its report going where the developer sent it; one Filament started by itself and a flow's box are not, each refused in words that say whose it is", async () => {
  const w = watched();
  const t = turnOf(w);
  // The developer's, whose report reaches the agent — and one they kept for themselves.
  const told = await others(w, 1, { origin: "owner", prompt: "audit the cache", description: "Audit the cache" });
  const kept = await others(w, 2, { origin: "owner", prompt: "audit the queue", description: "Audit the queue", deliver: false });
  const a = await t.call({ agent_id: told.id, stop: true });
  assert.deepEqual([a.ok, a.text, a.note], [true, ANSWER(`sub-agent ${told.id}`, told.id).message, `agent: stopped sub-agent ${told.id} (Builder, m-session)`]);
  const b = await t.call({ agent_id: kept.id, stop: true });
  assert.deepEqual([b.ok, b.text], [true, ANSWER(`sub-agent ${kept.id}`, kept.id).theirs]);
  assert.deepEqual(w.steers, [STOP(told.r.runId), STOP(kept.r.runId)]);
  told.r.finish({ status: "stopped", report: "Half the cache read.", stoppedBy: "agent" });
  kept.r.finish({ status: "stopped", report: "Half the queue read.", stoppedBy: "agent" });
  await w.registry.settled(told.id);
  await w.registry.settled(kept.id);
  const heard = t.door.inbox.take();
  assert.equal(heard.length, 1, "the one kept for the developer stays theirs");
  assert.ok(heard[0].text.startsWith(`[Filament: the developer ran sub-agent ${told.id} ("Audit the cache") alongside you; it was stopped as you asked. The developer's task for it:\naudit the cache\n\nIts report:\nHalf the cache read.`), heard[0].text);
  assert.equal(w.registry.get(kept.id)?.exchanges.at(-1)?.delivery, "held");
  // Not the agent's to stop: nothing is steered.
  const self = await others(w, 3, { origin: "self", as: "reviewer", prompt: "what the turn did", description: "Looks again", why: "the turn ended" });
  const box = await others(w, 4, { origin: "flow", as: "reviewer", may: "read", prompt: "[Filament: you are one box of a flow]\n\nYour part: the review", description: "Flow: Reviewer", deliver: false, waits: true });
  await assert.rejects(t.call({ agent_id: self.id, stop: true }), { message: `Reviewer (${self.id}) started by itself, for the developer: it is theirs to stop, not yours` });
  await assert.rejects(t.call({ agent_id: box.id, stop: true }), { message: `Reviewer (${box.id}) is a box of a flow, and its end is its flow's: it is the developer's to stop — or yours with the flow tool (box, do: stop) where you drive that flow in place` });
  assert.equal(w.steers.length, 2, "neither was stopped");
  assert.deepEqual([w.registry.get(self.id)?.status, w.registry.get(box.id)?.status], ["running", "running"]);
  for (const x of [self, box]) {
    x.r.finish({ status: "done", report: "LOOKED" });
    await w.registry.settled(x.id);
  }
  t.door.close();
});

// (fails before: yes — a coding agent's call of Filament's agent tool with stop: true answered "Error: a message needs words")
test("a coding agent's stop over Filament's MCP door: the call goes to its turn's door with no prompt asked for, answers in the stop's words, and a refusal comes back as the call's error", async () => {
  const w = watched();
  const door = w.registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: w.dir, mode: null, model: "coder-1", thinking: null, fork: null, emit: () => {}, round: () => 1 });
  /** @type {string[]} */
  const notes = [];
  const turn = createLaunchTurn({ registry: w.registry, door, chainId: "c1", emit: () => {}, note: (text) => notes.push(text), mailbox: () => null, signal: new AbortController().signal, stopSignal: new AbortController().signal });
  const turns = createAgentTurns();
  const tools = createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => ({ apply: () => ({ ok: true, text: "solo" }) }), turns, subagents: () => ({ offer: () => ({ asks: [] }), asks: () => [] }), membersOf: () => null });
  const at = { chain: "c1", turn: null, graph: false, report: false, cwd: w.dir, upstream: "cli", launch: true };
  const off = turns.open("c1", turn);
  const launch = await tools.call("agent", { description: "Fix the parser", prompt: "fix parse() for an empty file", run_in_background: true }, at);
  assert.equal(launch.isError, undefined, launch.text);
  const r = await w.run(1);
  const id = r.id;
  r.attach();
  await until(() => w.registry.get(id)?.runId === r.runId, "its run to attach");
  assert.deepEqual(await tools.call("agent", { stop: true }, at), { text: "Error: stop needs agent_id: the sub-agent to stop", isError: true });
  assert.deepEqual(await tools.call("agent", { agent_id: id, stop: true }, at), { text: ANSWER(`sub-agent ${id}`, id).message });
  assert.deepEqual(w.steers, [STOP(r.runId)]);
  assert.equal(notes.at(-1), `agent: stopped sub-agent ${id} (Builder, coder-1)`);
  r.finish({ status: "stopped", report: "I had read parse.js.", stoppedBy: "agent" });
  await w.registry.settled(id);
  await turn.arrival();
  const [said] = turn.take();
  assert.ok(said.includes(`sub-agent ${id} ("Fix the parser") was stopped as you asked.`) && said.includes("I had read parse.js."), said);
  off();
  turn.close();
});

/**
 * The graph runner over a scripted registry, wired as server.js wires them: a task's sub-agent's end reaches the runner.
 * `chains` is the session's record, as the archive keeps it; what the runner tells the planner is kept.
 */
const graphOver = () => {
  /** @type {any} */
  let graphs = null;
  const w = watched({ extra: { exchangeEnded: (/** @type {any} */ e) => graphs?.ended(e) } });
  const chains = new Map([["c1", { id: "c1", meta: /** @type {Record<string, any>} */ ({}) }]]);
  /** @type {any[]} */
  const told = [];
  const archive = {
    /** @param {string} id @param {readonly string[]} keys */
    metaOf: (id, keys) => {
      const c = chains.get(id);
      return c ? Object.fromEntries(keys.filter((k) => c.meta?.[k] !== undefined).map((k) => [k, c.meta[k]])) : null;
    },
    /** @param {string} id @param {Record<string, any>} patch */
    mergeMeta: (id, patch) => {
      const c = chains.get(id);
      if (!c) return null;
      // Kept as the archive keeps it: as JSON, read again.
      c.meta = JSON.parse(JSON.stringify({ ...c.meta, ...patch }));
      return c.meta;
    },
    openGraphs: () => [...chains.values()].filter((c) => c.meta.graph && !c.meta.graph.closed).map((c) => ({ id: c.id, graph: structuredClone(c.meta.graph) })),
  };
  graphs = createGraphRunner({ archive, registry: /** @type {any} */ ({ ...w.registry, tell: (/** @type {string} */ c, /** @type {any} */ d) => (told.push(d), w.registry.tell(c, d)) }), events: { publish: () => {} }, crew: () => "agent", log: () => {} });
  /** @param {string} id @returns {any} */
  const task = (id) => chains.get("c1")?.meta.graph?.tasks.find((/** @type {any} */ x) => x.id === id);
  return { w, graphs, told, task, graph: () => chains.get("c1")?.meta.graph };
};

// (fails before: yes — the tool had no stop; and a stop in the agent's name failed its task, "its run was stopped", with a
// failed task's choices, where the developer's Stop set it aside)
test("a graph task's sub-agent stopped by the agent tool sets its task aside: it waits, stopped by the agent, kept so through a save and a load; the planner hears it stopped it, and its sub-agent goes on after its next tasks call", async () => {
  const { w, graphs, told, task, graph } = graphOver();
  const t = turnOf(w);
  const add = graphs.apply("c1", { action: "add", goal: "Ship the parser", tasks: [{ id: "t1", name: "Map the parser", by: "explorer", goal: "Every caller of parse() is known", steps: ["Search for parse("], acceptance: "each caller is listed" }] }, { crew: "agent" });
  assert.ok(add.ok, add.ok ? "" : add.error);
  graphs.attach("c1", { runId: "turn-1", cwd: w.dir, mode: null, model: "m-main", thinking: null, team: null });
  await until(() => task("t1")?.state === "running" && !!task("t1").agent, "t1 to start");
  const agent = String(task("t1").agent);
  const r = await attached(w, agent, 1);
  const out = await t.call({ description: "Stop the map", agent_id: agent, stop: true });
  assert.deepEqual([out.ok, out.text], [true, `Stopping sub-agent ${agent} now, with no message sent to it. It works on task t1 of your task graph: the task waits again, and Filament's message on its end says how it goes on.`]);
  assert.deepEqual(w.steers, [STOP(r.runId)]);
  r.finish({ status: "stopped", report: "I was reading parse.js.", stoppedBy: "agent" });
  await w.registry.settled(agent);
  await until(() => task("t1")?.state === "waiting", "t1 set aside");
  const t1 = task("t1");
  assert.deepEqual([t1.stopped, t1.why, t1.failures, t1.earlier.agent, t1.earlier.why, t1.earlier.stopped], ["agent", "", null, agent, "stopped by the agent", "agent"]);
  const heard = String(told.filter((d) => d.task === "t1").at(-1)?.text);
  assert.equal(heard.split("\n")[0], `[Filament: you stopped sub-agent ${agent} on task t1 "Map the parser". The task waits again: after your next tasks call ${agent} goes on with it where it stopped, in its own conversation — or a new sub-agent takes it, with what this one did in its brief: tasks start with its id and fresh: true.`);
  assert.ok(!heard.includes("Your choices:"), "no failed task's choices");
  // As the archive kept it, read again: whose stop it was stays the agent's, in the graph's words and the planner's.
  const kept = JSON.parse(JSON.stringify(graph()));
  assert.equal(kept.tasks[0].stopped, "agent");
  assert.equal(tg.restartCut(kept, 9_000), null, "a restart cuts nothing of a task set aside");
  assert.match(tg.showText(kept, "agent"), /\n- t1 "Map the parser" — stopped by the agent · by explorer\n/);
  assert.equal(tg.endText(kept, "t1", { crew: "agent" }).split("\n")[0], heard.split("\n")[0]);
  // The agent's next tasks call lets it go: its own sub-agent goes on, told whose stop it was.
  const shown = graphs.apply("c1", { action: "show" }, { crew: "agent" });
  assert.ok(shown.ok && shown.text.includes(`Filament started t1 again on its sub-agent ${agent}, in its own conversation.`), shown.ok ? shown.text : shown.error);
  const next = await attached(w, agent, 2);
  const words = JSON.stringify(next.body.messages.at(-1));
  assert.ok(words.includes("[Filament: the agent stopped you on task t1. The task is yours again: go on from where you stopped"), words.slice(0, 600));
  next.finish({ status: "done", report: "MAPPED" });
  await w.registry.settled(agent);
  t.door.close();
});

// (fails before: yes — a stop read as a launch: its row "Agent", its task the sub-agent's id, and "an agent works on" it)
test("in the transcript a stop reads as a stop, never as a launch or a follow-up: its card, its line while it runs and its row — the loop's call and a coding agent's", () => {
  const input = { description: "Stop the parser fix", agent_id: "sa_1a2b3c4d", stop: true };
  assert.deepEqual(cardOf("agent", input), { kind: "subagent", title: "Stop sub-agent", subject: "sa_1a2b3c4d" });
  assert.deepEqual(cardOf("mcp__filament__agent", input), cardOf("agent", input), "a coding agent's call of Filament's tool");
  assert.deepEqual(cardOf("agent", { description: "Fix the parser", prompt: "fix it", agent_id: "sa_1a2b3c4d" }), { kind: "subagent", title: "agent", subject: "Fix the parser" }, "a follow-up as it was");
  assert.deepEqual(cardOf("Agent", { ...input, prompt: "x" }).title, "Agent", "another client's own tool is no stop of Filament's");
  assert.equal(argSummary("agent", input), "sa_1a2b3c4d: stop it");
  assert.equal(argSummary("agent", { description: "Fix the parser", prompt: "fix it" }), "Fix the parser", "a launch as it was");
  assert.equal(callWords({ name: "agent", card: cardOf("agent", input) }), "stopping sub-agent sa_1a2b3c4d");
  assert.equal(callWords({ name: "agent", card: cardOf("agent", { description: "Fix the parser", prompt: "fix it" }) }), "an agent works on “Fix the parser”");
  const dom = stubDocument();
  try {
    /** @param {any[]} evs */
    const rowOf = (evs) => roundRows(alignEvents([{ type: "round-start", round: 0 }, ...evs]).byRound.get(0), { runId: "run-1" })[0];
    /** @param {any} row */
    const said = (row) => [row.querySelector(".tool-kind")?.textContent, row.querySelector(".tool-primary")?.textContent];
    const start = { type: "tool-start", id: "s1", name: "agent", args: argSummary("agent", input), card: cardOf("agent", input) };
    assert.deepEqual(said(rowOf([start])), ["Stopping sub-agent", "sa_1a2b3c4d"]);
    const answer = ANSWER("sub-agent sa_1a2b3c4d", "sa_1a2b3c4d").message;
    const stopped = rowOf([start, { type: "tool-end", id: "s1", ok: true, preview: answer }]);
    assert.deepEqual(said(stopped), ["Stopped sub-agent", "sa_1a2b3c4d"]);
    assert.ok(stopped.textContent.includes("Filament's answer") && stopped.textContent.includes(answer), stopped.textContent);
    assert.ok(!stopped.textContent.includes("Task"), "no launch's card");
    const refused = rowOf([start, { type: "tool-end", id: "s1", ok: false, preview: "Error: sub-agent sa_1a2b3c4d is not running" }]);
    assert.deepEqual(said(refused), ["Stop sub-agent", "sa_1a2b3c4d"], "one that stopped nothing is named by what it asked");
    const theirs = rowOf([{ ...start, id: "s2", name: "mcp__filament__agent" }, { type: "tool-end", id: "s2", ok: true, preview: answer }]);
    assert.deepEqual(said(theirs), ["Stopped sub-agent", "sa_1a2b3c4d"]);
  } finally {
    dom.restore();
  }
});
