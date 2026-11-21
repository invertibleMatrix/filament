// @ts-check
// E41 P5's measure found it (the parallel arm, 10-25): an agent asked to hand six tasks to sub-agents in one `change`
// call; two of them could not change, the whole call was refused — "2 problems — all of them, so one call can fix
// them" — and the agent, reading nothing that said so, took the other four as changed. It started two of them as it
// thought sub-agents would (`tasks start`), each still its own work; `wait` answered "Nothing to wait for", and it ended
// its turn saying its sub-agents ran, with no one at work. Now a refused call that named several tasks says nothing of
// it changed; a start of the agent's own tasks says they are its to do; and a wait with none of its sub-agents running
// names the tasks that run as its own work.
// (fails before: yes — the refusal said nothing of what changed, the start "Started p3, p4." alone, the wait nothing
// of the graph)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyTasks, ownWorkText } from "../src/core/task-graph.js";
import { createLaunchTurn } from "../src/app/agent-launch.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

const AT = 1_000;
/** @param {any} g @param {any} input */
const ok = (g, input) => {
  const r = applyTasks(g, input, { at: AT, crew: "agent" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r;
};
/** A refused call: its words, the graph as it was. @param {any} g @param {any} input */
const no = (g, input) => {
  const before = JSON.stringify(g);
  const r = applyTasks(g, input, { at: AT, crew: "agent" });
  assert.equal(r.ok, false, "refused");
  assert.equal(JSON.stringify(g), before, "the graph is left as it was");
  return r.ok ? "" : r.error;
};
const BRIEF = { goal: "It is done", steps: ["Do it"], acceptance: "its test passes" };
/** Six tasks of the agent's own, two of them running: the checklist the measure's agent had. */
const six = () => {
  const g = ok(null, { action: "add", goal: "The ledger", tasks: ["money", "csv", "ledger", "report", "cli", "verify"].map((n, i) => ({ id: `p${i + 1}`, name: `Implement ${n}` })) }).graph;
  return ok(g, { action: "start", ids: ["p1", "p2"] }).graph;
};

describe("a refused call says that nothing of it changed", () => {
  test("several problems: nothing of the call changed, every problem listed", () => {
    const error = no(six(), { action: "change", tasks: ["p1", "p2", "p3", "p4", "p5", "p6"].map((id) => ({ id, by: "sub-agent", writes: [`src/${id}.js`], ...BRIEF, ...(id === "p1" || id === "p2" ? { needs: [`x${id}`] } : {}) })) });
    assert.match(error, /^2 problems, so nothing of this call changed — one call can fix them all:\n- p1 needs xp1, which is no task in the graph/);
    assert.match(error, /\n- p2 needs xp2, which is no task/);
  });
  test("one problem in a call that named several tasks: nothing of it changed", () => {
    const g = ok(six(), { action: "done", id: "p2", summary: "csv parses" }).graph;
    const error = no(g, { action: "change", tasks: ["p1", "p3"].map((id) => ({ id, by: "sub-agent", writes: [`src/${id}.js`], ...BRIEF, ...(id === "p1" ? { needs: ["x"] } : {}) })) });
    assert.match(error, /^Nothing of this call changed: p1 needs x, which is no task in the graph/);
  });
  test("one problem in a call that named one task reads as before", () => {
    const error = no(six(), { action: "change", tasks: [{ id: "p1", by: "sub-agent", writes: ["src/p1.js"], ...BRIEF, needs: ["x"] }] });
    assert.match(error, /^p1 needs x, which is no task in the graph/);
  });
  test("the same for a drop of several", () => {
    // A task that needs one dropped loses that need (11-09): a task the graph has not is the one problem here.
    const error = no(six(), { action: "drop", ids: ["p3", "p9"], reason: "not needed" });
    assert.match(error, /^Nothing of this call changed: p9 is no task in the graph/);
  });
});

describe("the agent's own work said as its own", () => {
  test("a start of its own tasks says they are its to do now", () => {
    const g = ok(null, { action: "add", goal: "g", tasks: [{ id: "p3", name: "Ledger" }, { id: "p4", name: "Report" }] }).graph;
    assert.match(ok(g, { action: "start", ids: ["p3", "p4"] }).text, /^Started p3, p4: yours, so you do them now\./);
    assert.match(ok(g, { action: "start", id: "p3" }).text, /^Started p3: yours, so you do it now\./);
  });
  test("ownWorkText: the tasks that run as the agent's own, or null", () => {
    assert.equal(ownWorkText(null), null);
    const g = ok(null, { action: "add", goal: "g", tasks: [{ id: "p3", name: "Implement src/ledger.js (sub-agent)" }, { id: "p4", name: "Report" }] }).graph;
    assert.equal(ownWorkText(g), null, "nothing runs");
    const one = ok(g, { action: "start", id: "p3" }).graph;
    assert.equal(ownWorkText(one), 'Your task graph\'s p3 "Implement src/ledger.js (sub-agent)" runs as your own work: no sub-agent does it. Do it now — or give it to a sub-agent with tasks change (by), and Filament starts it.');
    const two = ok(one, { action: "start", id: "p4" }).graph;
    assert.match(ownWorkText(two) || "", /^Your task graph's p3 "Implement src\/ledger\.js \(sub-agent\)", p4 "Report" run as your own work: no sub-agent does them\. Do them now — or give them to sub-agents with tasks change \(by\), and Filament starts them\.$/);
    assert.equal(ownWorkText(/** @type {any} */ ({ ...two, closed: { at: AT, reason: "done" } })), null, "a closed graph runs nothing");
    // (fails before: yes — a coding agent's wait was told tasks change (by), which its tasks tool refuses)
    assert.equal(ownWorkText(one, undefined, true), 'Your task graph\'s p3 "Implement src/ledger.js (sub-agent)" runs as your own work: no sub-agent does it. Do it now — or launch a sub-agent on it with Filament\'s agent tool, the task in task.');
    assert.match(ownWorkText(two, undefined, true) || "", /no sub-agent does them\. Do them now — or launch sub-agents on them with Filament's agent tool, each one's task in task\.$/);
  });
});

describe("a coding agent's wait (Filament's, over MCP) says the same", () => {
  test("nothing of Filament's running: its own running tasks named after it", async () => {
    const registry = createSubagentRegistry({
      config: () => ({ agentLoop: {} }),
      log: () => {},
      events: { publish: () => {} },
      runs: null,
      now: Date.now,
      context: {
        settings: () => ({ subagents: { pool: [{ model: "", seats: 4 }] }, loop: { permissions: "edit" } }),
        session: () => ({ cwd: tmpdir(), model: "m", projectId: "p1" }),
        view: async () => ({ text: "", turns: 0 }),
        brief: async () => null,
        modelProblem: () => null,
        mark: (/** @type {string} */ _c, /** @type {any} */ m) => ({ ...m, afterTurn: 1 }),
      },
      call: async () => {
        throw new Error("no launch here");
      },
    });
    const door = registry.openTurn({ chainId: "c9", runId: "turn-1", cwd: tmpdir(), mode: null, model: "coder-1", thinking: null, fork: null, emit: () => {}, round: () => 1 });
    const OWN = 'Your task graph\'s p3 "Ledger" runs as your own work: no sub-agent does it. Do it now — or launch a sub-agent on it with Filament\'s agent tool, the task in task.';
    const turn = createLaunchTurn({ registry, door, chainId: "c9", emit: () => {}, note: () => {}, mailbox: () => null, signal: new AbortController().signal, stopSignal: new AbortController().signal, ownWork: () => OWN });
    const got = await turn.call("wait", { seconds: 5 });
    assert.equal(got.text, `Nothing to wait for: none of Filament's sub-agents you launched is still running, no agent you asked is still thinking, and none of your background commands runs. ${OWN} A report that already arrived reaches you as a message from Filament.`);
    const none = createLaunchTurn({ registry, door, chainId: "c9", emit: () => {}, note: () => {}, mailbox: () => null, signal: new AbortController().signal, stopSignal: new AbortController().signal });
    assert.equal((await none.call("wait", { seconds: 5 })).text, "Nothing to wait for: none of Filament's sub-agents you launched is still running, no agent you asked is still thinking, and none of your background commands runs. A report that already arrived reaches you as a message from Filament.");
  });
});

describe("a wait with none of its sub-agents running names the agent's own work, end to end", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-own-work-"));
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(shim.dataDir, root);
  });
  /** @param {string} id @param {string} name @param {any} input */
  const use = (id, name, input) => ({ type: "tool_use", id, name, input });
  /** @param {any[]} blocks @param {string} [stop] */
  const reply = (blocks, stop = "tool_use") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
  /** The tool results in a request's newest message, by id. @param {any} body */
  const results = (body) => new Map((((body?.messages || []).at(-1)?.content) || []).filter((/** @type {any} */ b) => b?.type === "tool_result").map((/** @type {any} */ b) => [String(b.tool_use_id), JSON.stringify(b.content)]));

  test("its own running tasks, by id and name, after Nothing to wait for", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: {} } });
    assert.equal(r.status, 200, await r.clone().text());
    const id = String((await r.json()).id);
    brain = async (call) => {
      if (call.kind !== "anthropic") return undefined;
      const got = results(call.body);
      if (got.has("w1")) return reply([{ type: "text", text: "ok" }], "end_turn");
      if (got.has("s1")) return reply([use("w1", "wait", { seconds: 60 })]);
      if (got.has("a1")) return reply([use("s1", "tasks", { action: "start", ids: ["p3", "p4"] })]);
      return reply([use("a1", "tasks", { action: "add", goal: "The ledger", tasks: [{ id: "p3", name: "Ledger (sub-agent)" }, { id: "p4", name: "Report (sub-agent)" }] })]);
    };
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "plan it and wait for the sub-agents", stream: true } });
    assert.equal(res.status, 200);
    await res.text();
    const after = up.received.find((c) => c.kind === "anthropic" && results(c.body).has("w1"));
    const waited = after ? String(results(after.body).get("w1")) : "";
    assert.match(waited, /Nothing to wait for: no sub-agent you launched in the background is still running, and none of your background commands runs\./);
    assert.match(waited, /Your task graph's p3 \\"Ledger \(sub-agent\)\\", p4 \\"Report \(sub-agent\)\\" run as your own work: no sub-agent does them\./);
    const started = up.received.find((c) => c.kind === "anthropic" && results(c.body).has("s1"));
    assert.match(String(results(started?.body).get("s1")), /Started p3, p4: yours, so you do them now\./);
  });

  // (fails before: yes — the gap of 11-10 in Filament's own loop, which 109 left: with only its background command
  // running, wait answered at once "Nothing to wait for", and the end it did see said sub-agents ran where none did)
  test("its own background command alone: the wait waits for its end, which follows, and names no sub-agent", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: {} } });
    assert.equal(r.status, 200, await r.clone().text());
    const id = String((await r.json()).id);
    brain = async (call) => {
      if (call.kind !== "anthropic") return undefined;
      const got = results(call.body);
      if (got.has("w2")) return reply([{ type: "text", text: "ok" }], "end_turn");
      if (got.has("b1")) return reply([use("w2", "wait", { seconds: 60 })]);
      return reply([use("b1", "bash_background", { command: `node -e "setTimeout(()=>console.log('added 12 packages'),2000)"` })]);
    };
    const t0 = Date.now();
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "install, then wait for it", stream: true } });
    assert.equal(res.status, 200);
    await res.text();
    const after = up.received.find((c) => c.kind === "anthropic" && results(c.body).has("w2"));
    const waited = after ? String(results(after.body).get("w2")) : "";
    assert.doesNotMatch(waited, /Nothing to wait for/, waited);
    assert.match(waited, /Waited \d+ s: a background command of yours ended\. Its exit follows\./, waited);
    assert.doesNotMatch(waited, /sub-agents/, waited);
    assert.ok(Date.now() - t0 < 30_000, "the moment it ended, not when the wait ran out");
  });
});
