// @ts-check
// HarnessV3-TaskGraph G1, end to end on a native session. The graph is always on (the owner's word of 10-29): the
// tasks tool rides beside plan and the prompt has its section from a session's first turn — no note, no switch. The
// tasks calls keep the graph with the session: the run hears each change, the session's answer draws it, a restart
// keeps it, and a summary of the session's turns brings it back. A turn that resumes has it too; a sub-agent never has
// the graph, and a team's lead has it as its own tracker. `/graph` shows it, and no form of the command switches it.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { PROMPT } from "../src/app/agent/prompt.js";
import { HAND_TOOLS } from "../src/adapters/tools/hands.js";
import { COMPACTION_SYSTEM } from "../src/app/sessions/compaction.js";
import { WHERE_ROOM, applyTasks, showText, whereText } from "../src/core/task-graph.js";
import { RUN_EVENT_FIELDS, RUN_EVENT_TYPE_LIST } from "../src/services/runs.js";

const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
const said = (/** @type {string} */ t) => reply([{ type: "text", text: t }]);
const textOf = (/** @type {any} */ content) => (typeof content === "string" ? content : (content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join(""));
const sysOf = (/** @type {any} */ b) => (Array.isArray(b?.system) ? b.system.map((/** @type {any} */ x) => x?.text ?? "").join("\n") : String(b?.system || ""));
const toolNames = (/** @type {any} */ b) => (b?.tools || []).map((/** @type {any} */ t) => t.name);
/** The text blocks of the request's newest user message. @param {any} b */
const newestTexts = (b) => {
  const m = [...(b?.messages || [])].reverse().find((/** @type {any} */ x) => x.role === "user");
  return typeof m?.content === "string" ? [m.content] : (m?.content || []).filter((/** @type {any} */ c) => c?.type === "text").map((/** @type {any} */ c) => c.text);
};
/** What a tool call answered in a request: its tool_result block, or null. @param {any} body @param {string} id */
const resultIn = (body, id) => {
  for (const m of body?.messages || []) for (const b of Array.isArray(m.content) ? m.content : []) if (b?.type === "tool_result" && b.tool_use_id === id) return b;
  return null;
};
const isSub = (/** @type {any} */ call) => sysOf(call.body).includes(PROMPT.subagentRole);
const isLead = (/** @type {any} */ call) => sysOf(call.body).includes(String(PROMPT.leadRole));
const isSummary = (/** @type {any} */ call) => sysOf(call.body).includes(COMPACTION_SYSTEM.slice(0, 40));
const ADD = { action: "add", goal: "Ship the parser", tasks: [{ id: "t1", name: "Map the parser" }, { id: "t2", name: "Fix the parser", needs: ["t1"] }] };
/** The graph these calls leave, as the session keeps it (the times aside: no words carry them). @param {any[]} calls */
const graphAfter = (calls) =>
  calls.reduce((/** @type {any} */ g, c) => {
    const r = applyTasks(g, c, { at: 1, crew: "agent" });
    assert.ok(r.ok, r.ok ? "" : r.error);
    return r.graph;
  }, null);

describe("the task graph, end to end on a native session", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  /** The app's settings, at its start and at a restart on the same data. @param {any} cfg */
  const configure = (cfg) => {
    cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
    cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
    cfg.memory.autopilot = { enabled: false };
    cfg.memory.capture = { turns: true, learn: false };
    cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
  };
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-task-graph-turn-"));
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({ memory: true, keep: true, configure });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    for (const dir of [shim.dataDir, root]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  });
  /** @param {any} [settings] @param {string} [model] */
  const create = async (settings = undefined, model = "agent/brain-model") => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model, preset: "plain", ...(settings ? { settings } : {}) } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return String((await r.json()).id);
  };
  /** @param {string} id @param {string} content */
  const turn = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    const json = await r.json();
    const runId = String(r.headers.get("x-filament-request-id"));
    return { text: textOf(json.content), runId, rec: await shim.record(runId) };
  };
  /** The session's graph as its answer draws it. @param {string} id */
  const graphOf = async (id) => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}`)).json()).inForce.graph;
  /** The session's own loop's model calls since the last reset: a sub-agent's, a summary's and a lead's are not. */
  const loopCalls = () => up.received.filter((/** @type {any} */ c) => !isSub(c) && !isSummary(c) && toolNames(c.body).includes("ask"));
  const chainMeta = (/** @type {string} */ id) => /** @type {any} */ (shim.app).memory.archive.getChain(id).meta;

  // (fails before: yes — the owner's words of 10-23, "by default all the tools we have right now needs to be enabled
  // for every new session": the graph was off by default, TG-D3; and since 10-29 it is always on, with no switch)
  test("always on in a new chat: the tool right after plan and the section from its first turn; no note, there being no switch", async () => {
    const id = await create();
    brain = () => said("Hello.");
    up.reset();
    await turn(id, "/graph");
    const r = await turn(id, "hello");
    const [c] = loopCalls();
    const names = toolNames(c.body);
    assert.equal(names[names.indexOf("plan") + 1], "tasks", "tasks rides right after plan");
    assert.ok(sysOf(c.body).includes(`${PROMPT.headGraph}\n${PROMPT.graph}`) && sysOf(c.body).includes(PROMPT.planOnGraph));
    assert.deepEqual(newestTexts(c.body), ["hello"], "a command's turn before it, and no note");
    assert.equal(r.rec.agent.graph, true);
    assert.ok(r.rec.changes.includes("agent: the session's task graph is on: the tasks tool rides beside plan"), r.rec.changes.join("\n"));
    assert.ok(!r.rec.changes.some((/** @type {string} */ l) => l.includes("switched")), r.rec.changes.join("\n"));
    assert.equal(chainMeta(id).taskGraphSeen, undefined, "no mark of a switch");
  });

  // (fails before: no — a guard: an outside client's request ran under the knobs its session chose, so the graph's
  // default never reached it; with the switch gone the graph is still a harness chat's own turn's alone, V4-D105)
  test("an outside client's request has no graph: it is proxied as sent, not reshaped", async () => {
    brain = () => said("Outside.");
    up.reset();
    const r = await shim.post("/v1/messages", { model: "brain-model", max_tokens: 300, messages: [{ role: "user", content: "hello from outside" }] }, { "x-session-id": "graph-outside", "x-filament-cwd": root });
    assert.equal(textOf((await r.json()).content), "Outside.");
    const [c] = up.received;
    assert.ok(c && !toolNames(c.body).includes("tasks") && !toolNames(c.body).includes("plan"), toolNames(c?.body).join(","));
    assert.ok(!sysOf(c.body).includes(PROMPT.headGraph) && !sysOf(c.body).includes(PROMPT.plan));
  });

  // (fails before: yes — nothing kept a graph: a tasks call was answered as a tool not offered)
  test("the tasks calls keep the graph with the session: the run hears each change, the answer draws it, a restart keeps it", async () => {
    const id = await create();
    let round = 0;
    brain = () => {
      round++;
      if (round === 1) return reply([toolUse("g1", "tasks", ADD)], "tool_use");
      if (round === 2) return reply([toolUse("g2", "tasks", { action: "start", id: "t1" }), toolUse("g3", "tasks", { action: "show", id: "t9" })], "tool_use");
      return said("Planned.");
    };
    up.reset();
    const r = await turn(id, "plan the parser");
    assert.equal(r.text, "Planned.");
    const calls = loopCalls();
    assert.deepEqual(newestTexts(calls[0].body), ["plan the parser"], "no note: the graph has no switch");
    assert.equal(resultIn(calls[1].body, "g1")?.content, "Added t1, t2. 0 of 2 done · ready: t1. Critical path still to go: t1 → t2.");
    assert.equal(resultIn(calls[2].body, "g2")?.content, "Started t1: yours, so you do it now. 0 of 2 done · running: t1.");
    const refused = resultIn(calls[2].body, "g3");
    assert.equal(refused?.is_error, true);
    assert.match(textOf(refused?.content), /t9 is no task in the graph/);
    // The run's events: one per change, the refusal none.
    const { events } = await (await shim.api(`/api/runs/${encodeURIComponent(r.runId)}/events?since=0&limit=500`)).json();
    const graphs = events.filter((/** @type {any} */ e) => e.type === "graph");
    assert.deepEqual(graphs.map((/** @type {any} */ e) => e.graph.tasks.map((/** @type {any} */ t) => t.state).join(",")), ["waiting,waiting", "running,waiting"]);
    // The run log's vocabulary names it (fails before: yes — the loop published a type the registry did not have).
    assert.ok(RUN_EVENT_TYPE_LIST.includes("graph"));
    assert.match(RUN_EVENT_FIELDS.graph, /^round, graph — agent: the session's task graph/);
    const drawn = await graphOf(id);
    // The turn ended with t1 running and nothing at work on it: the graph kept after the run's last word marks it so,
    // for the next turn's start to say (d-idle).
    const last = graphs[1].graph;
    assert.deepEqual(drawn, { ...last, rev: last.rev + 1, tasks: last.tasks.map((/** @type {any} */ t) => (t.id === "t1" ? { ...t, idle: true } : t)) }, "the session's answer draws what the run last said, t1 marked left idle");
    assert.deepEqual([drawn.goal, drawn.counts], ["Ship the parser", { total: 2, waiting: 1, ready: 0, running: 1, paused: 0, checking: 0, review: 0, merging: 0, done: 0, failed: 0, dropped: 0 }]);
    // A restart on the same data: the graph is the session's, and the next turn reads it.
    const dataDir = shim.dataDir;
    await shim.stop();
    shim = await startApp({ memory: true, keep: true, dataDir, configure });
    assert.deepEqual(await graphOf(id), drawn);
    round = 0;
    brain = () => (++round === 1 ? reply([toolUse("g4", "tasks", { action: "show" })], "tool_use") : said("Still there."));
    up.reset();
    await turn(id, "where were we");
    const shown = textOf(resultIn(loopCalls()[1].body, "g4")?.content);
    assert.equal(shown, showText(graphAfter([ADD, { action: "start", id: "t1" }]), "agent"));
  });

  // (fails before: yes — nothing kept the graph with a pause: the resumed turn had no tasks tool)
  test("a resumed turn has the graph, from the process that asked and after a restart", async () => {
    for (const restart of [false, true]) {
      const id = await create();
      let round = 0;
      brain = () => (++round === 1 ? reply([toolUse("b1", "bash", { command: `echo r > r-${restart}.txt` })], "tool_use") : said("Written."));
      up.reset();
      assert.match((await turn(id, "write the file")).text, /May I run this command\?/);
      if (restart) {
        const dataDir = shim.dataDir;
        await shim.stop();
        shim = await startApp({ memory: true, keep: true, dataDir, configure });
      }
      const r = await turn(id, "yes");
      assert.equal(r.text, "Written.");
      if (restart) assert.ok(r.rec.changes.includes("agent: resumed from the archived pause (this process kept no paused turn of it)"), r.rec.changes.join("\n"));
      const resumed = /** @type {any} */ (loopCalls().at(-1));
      assert.ok(toolNames(resumed.body).includes("tasks"), `the resumed turn has the tasks tool${restart ? " after a restart" : ""}`);
      assert.ok(sysOf(resumed.body).includes(PROMPT.headGraph));
      // (fails before: yes, after a restart — the archived pause kept no `supervise`, so the answer's request swapped
      // the reading tasks and wait tools for the plain ones and lost the prompt's lines on looks: the provider wrote the
      // whole chat to its cache again, and once more on the next turn)
      const asked = /** @type {any} */ (loopCalls()[0]);
      assert.deepEqual(JSON.stringify(resumed.body.tools), JSON.stringify(asked.body.tools), `the tools the question went out with${restart ? ", after a restart" : ""}`);
      assert.equal(sysOf(resumed.body), sysOf(asked.body), `the system prompt the question went out with${restart ? ", after a restart" : ""}`);
    }
  });

  // (fails before: no — a guard the mutation pass asked for: no change met a session that could not keep it)
  test("a change the session cannot keep is the call's refusal: the graph and the page are as they were", async () => {
    const id = await create();
    const archive = /** @type {any} */ (shim.app).memory.archive;
    const real = archive.mergeMeta;
    archive.mergeMeta = (/** @type {string} */ chain, /** @type {any} */ patch) => {
      if (patch && "graph" in patch) throw new Error("disk full");
      return real.call(archive, chain, patch);
    };
    let round = 0;
    brain = () => (++round === 1 ? reply([toolUse("g1", "tasks", ADD)], "tool_use") : said("Tried."));
    try {
      up.reset();
      const r = await turn(id, "plan the parser");
      const refused = resultIn(loopCalls()[1].body, "g1");
      assert.equal(refused?.is_error, true);
      assert.match(textOf(refused?.content), /the graph could not be kept with the session — it is as it was/);
      const { events } = await (await shim.api(`/api/runs/${encodeURIComponent(r.runId)}/events?since=0&limit=500`)).json();
      assert.equal(events.filter((/** @type {any} */ e) => e.type === "graph").length, 0, "the page hears no change");
    } finally {
      archive.mergeMeta = real;
    }
    assert.equal(await graphOf(id), null);
  });

  // (fails before: no — a guard the plan asked for: the graph is the session's own agent's; a sub-agent rides the
  // session's chain under its own prompt and tools)
  test("a sub-agent never has the graph", async () => {
    const id = await create({ subagents: { worktree: false } });
    /** @type {any[]} */
    const subs = [];
    brain = (call) => {
      if (isSub(call)) {
        subs.push(call);
        return said("SUB DONE");
      }
      return resultIn(call.body, "a1") ? said("MAIN DONE") : reply([toolUse("a1", "agent", { run_in_background: false, description: "Look", prompt: "List the folder.", subagent_type: "reviewer" })], "tool_use");
    };
    up.reset();
    assert.equal((await turn(id, "have a look")).text, "MAIN DONE");
    assert.ok(subs.length >= 1);
    for (const s of subs) {
      assert.ok(!toolNames(s.body).includes("tasks"), toolNames(s.body).join(","));
      assert.ok(!sysOf(s.body).includes(PROMPT.headGraph));
    }
    assert.ok(loopCalls().every((c) => toolNames(c.body).includes("tasks")), "the main agent has it throughout");
  });

  // (fails before: yes — a lead had no tasks tool)
  test("a team's lead has the tasks tool beside its own, and its own graph section (G3)", async () => {
    const id = await create({ engine: { mode: "team", team: "builders" } }, "brain-model");
    brain = () => said("LEAD ANSWER");
    up.reset();
    const r = await turn(id, "what is here");
    assert.equal(r.text, "LEAD ANSWER");
    const lead = up.received.filter(isLead);
    assert.equal(lead.length, 1);
    assert.deepEqual(toolNames(lead[0].body), [...HAND_TOOLS.map((t) => t.name), "lsp", "ask", "plan", "tasks", "agent", "worker", "wait", "envelope", "visual_guide", "show_visual", "artifact", "web_fetch", "web_search", "browser", "skill", "filament_recall"]);
    assert.ok(sysOf(lead[0].body).includes(`${PROMPT.headGraph}\n${PROMPT.leadGraph}`));
    assert.equal(r.rec.agent.graph, true);
  });

  // (fails before: yes — a summary of the session's turns brought back its files and plan, never the graph)
  test("a summary of the session's turns brings the graph back after it while it has open tasks", async () => {
    const id = await create();
    let round = 0;
    brain = () => (++round === 1 ? reply([toolUse("g1", "tasks", ADD)], "tool_use") : said("Planned."));
    await turn(id, "plan the parser");
    // A turn long enough that its summary leaves the chat smaller, where its planner stands and all.
    brain = () => said(`Second. ${"The parser's callers, one by one. ".repeat(300)}`);
    await turn(id, "second");
    brain = (call) => (isSummary(call) ? said("<summary>\nTHE SUMMARY\n</summary>") : said("After."));
    const c = await shim.api(`/api/sessions/${encodeURIComponent(id)}/compact`, { method: "POST", body: {} });
    assert.equal(c.status, 200, await c.clone().text());
    const row = /** @type {any} */ (shim.app).memory.archive.getCompactions(id).at(-1);
    assert.equal(row?.detail?.attached?.graph, true);
    up.reset();
    await turn(id, "after");
    const [n] = loopCalls();
    const block = textOf(n.body.messages[0].content.slice(1));
    // It ends with where the agent stands (HarnessV4_TaskGraphPlus_Plan E41 P1 case 3).
    assert.ok(block.startsWith(`[Filament brought these back after the summary: the task graph as it stood, and your reply that ended turn 2, which the person's message after the summary answers. Any of turns 1–2 comes back word for word with filament_recall({ turn: n }), and filament_recall with no arguments lists them, newest first, with how each answer ended.]\n\n<tasks>\n${showText(chainMeta(id).graph, "agent", null, { back: true })}\n\n${whereText(chainMeta(id).graph, { crew: "agent", room: WHERE_ROOM.back })}\n</tasks>\n\n<last-reply turn="2">\n…`), block.slice(0, 600));
    assert.ok(block.endsWith("The parser's callers, one by one.\n</last-reply>"), "the second turn's reply, its end");
  });

  // (fails before: yes — /graph was no command: the words went to the model; and until 10-29 its forms switched the graph;
  // and, the owner's rules of 10-31, an outside client's chat answered it as Filament's, and `@mem graph` was its alias)
  test("/graph from the chat: the graph as the agent reads it, answered by Filament, and no form switches it; an outside client's goes to its model as typed", async () => {
    const id = await create();
    brain = () => said("MODEL");
    up.reset();
    assert.equal(
      (await turn(id, "/graph")).text,
      [
        "**Task graph** — the agent has the tasks tool beside its checklist, and puts each piece of work on whichever fits.",
        "No graph yet: the agent starts one when the work has pieces that depend on each other or could run in parallel.",
      ].join("\n"),
    );
    for (const arg of ["off", "on", "default", "help"]) assert.equal((await turn(id, `/graph ${arg}`)).text, `\`/graph ${arg}\` is no form of the command — \`/graph\` alone shows this session's task graph.`);
    assert.equal(up.received.length, 0, "no command reached the model");
    let round = 0;
    brain = () => (++round === 1 ? reply([toolUse("g1", "tasks", ADD)], "tool_use") : said("Planned."));
    await turn(id, "plan the parser");
    const shown = ["The graph, as the agent reads it:", "```text", showText(graphAfter([ADD]), "agent"), "```"].join("\n");
    assert.equal((await turn(id, "/graph")).text.split("\n").slice(1).join("\n"), shown);
    // An outside client's chat is a plain proxy with memory: its /graph goes to its model as typed.
    brain = () => said("MODEL");
    up.reset();
    const r = await shim.post("/v1/messages", { model: "brain-model", max_tokens: 300, messages: [{ role: "user", content: "/graph" }] }, { "x-session-id": "graph-straight", "x-filament-cwd": root });
    assert.equal(textOf((await r.json()).content), "MODEL");
    assert.ok(up.received.some((/** @type {any} */ c) => JSON.stringify(c.body?.messages?.at(-1)).includes("/graph")), "the words went to the model as typed");
  });
});