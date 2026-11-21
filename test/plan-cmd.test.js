// @ts-check
// `/plan [words]` (the owner's of 11-05: "have this slash plan command and this is only gonna ask the agent to plan out
// the whole thing in todo or task graph based on the complexity... prepare the whole graph with s summary of the whole
// plan. maybe show a card asking that graph is ready to view which just opens the Plan tab... if users simply ask to plan
// out the whole thing in simple message then agent can go ahead and create a plan in task graph as well"). The line
// rides ahead of the message, the turn's end stamps what the plan left, and the card after the reply opens the Plan.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLAN_NOTE, planAskLine, planReadyOf } from "../src/core/task-graph.js";
import { PROMPT } from "../src/app/agent/prompt.js";
import { CODER_GRAPH_TEXT } from "../src/app/agent-context.js";
import { PLAN_WORD, planReadyWords, planWordsOf } from "../src/ui/harness/lib/plan-ask.js";
import { deliveredCounts, planEl, planReadyEl } from "../src/ui/harness/conversation/turn.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

/** @param {Partial<import("../src/core/task-graph.js").Task>} t @returns {any} */
const task = (t) => ({ id: "t", name: "t", state: "waiting", needs: [], writes: [], addedAt: 100, ...t });

describe("the words", () => {
  test("the line: plan it whole by its size, the summary kept behind the graph, nothing started, the reply ending with it", () => {
    const line = planAskLine();
    assert.match(line, /^\[Filament: the person typed \/plan\. Plan the work before any of it starts/);
    assert.match(line, /- Steps you take yourself one after another: on your checklist\./);
    assert.match(line, /- Work that branches \(a step with steps of its own\), or is otherwise complex: on your task graph — its goal; each task with the tasks it needs, the files it writes and the check that proves it done; a big part as a step, its pieces sub-tasks under it; and the plan's summary kept behind the graph \(keep, titled "Plan"\)\./);
    // Plan mode (11-06): the turn is read-only, and the card has Approve and Amend.
    assert.match(line, /This turn is read-only: read and search all you need, but change no file and start no task — the person approves the plan first\. End your reply with its summary/);
    assert.match(line, /Filament shows them a card that opens the Plan, with Approve and Amend\. Their words, if any, follow \/plan in their message below; where those say only how deep, or nothing, plan the work their message before it asks for\.\]$/);
    assert.equal(PLAN_NOTE, "Plan");
  });

  test("an agent with no task graph is told so, and plans in its reply", () => {
    assert.match(planAskLine({ off: "plain" }), /this chat is a plain chat, whose model runs no tools, so you have no checklist or task graph\. Plan it in your reply/);
    assert.match(planAskLine({ off: "words" }), /this chat's model takes no tools/);
    assert.match(planAskLine({ off: "agent" }), /takes no MCP server over HTTP/);
    assert.match(planAskLine({ off: "words" }), /start none of it\. Their words, if any, follow \/plan in their message below; where those say only how deep, or nothing, plan the work their message before it asks for\.\]$/);
  });

  // (fails before: yes — a plan asked for in plain words had no words of its own: the agent planned, then went on)
  test("version 85: the graph's words and a coding agent's say a plan asked for alone is made whole and nothing of it starts", () => {
    const words = `- Asked for a plan alone — /plan, or words like "plan it out" — make it whole: the checklist for a short job; for complex work, the graph's tasks with their needs, writes and checks, and the plan's summary kept behind the graph (keep, titled "${PLAN_NOTE}"). End your reply with that summary, and start none of it until the developer says go.`;
    assert.ok(PROMPT.graph.split("\n").includes(words), PROMPT.graph);
    assert.ok(CODER_GRAPH_TEXT.includes(`Asked for a plan alone (/plan, or words like "plan it out"), make it whole the same way, complex work's summary kept behind the graph (keep, titled "${PLAN_NOTE}"); end your reply with that summary, and start none of it until the person says go.`));
  });

  // (fails before: yes — the review of a91935390: the card counted the graph's every task not dropped, done ones and an
  // earlier plan's too, and said a plan was ready where the turn made none)
  test("what the plan made: the open tasks it added — the agent's own, its checklist's items —, or a re-plan's open tasks; never the work done before it", () => {
    const none = { tasks: 0, steps: 0, goal: "" };
    assert.deepEqual(planReadyOf(null), none);
    const old = [task({ id: "o1", state: "done", addedAt: 10 }), task({ id: "o2", addedAt: 10 })];
    const made = [task({ id: "a", addedAt: 200 }), task({ id: "b", state: "done", addedAt: 200 }), task({ id: "c", state: "dropped", addedAt: 200 }), task({ id: "p1", checklist: "read the code", addedAt: 200 }), task({ id: "lexer", checklist: "write the lexer", addedAt: 200 })];
    const g = /** @type {any} */ ({ goal: "Ship the parser", closed: null, rev: 7, tasks: [...old, ...made] });
    assert.deepEqual(planReadyOf(g, { since: 150, rev: 5 }), { tasks: 2, steps: 1, goal: "Ship the parser" }, "a, and lexer the checklist names; p1 a step");
    assert.deepEqual(planReadyOf({ ...g, tasks: old }, { since: 150, rev: 7 }), none, "it added nothing and changed nothing: it asked first, or planned in its reply");
    assert.deepEqual(planReadyOf({ ...g, tasks: old }, { since: 150, rev: 5 }), { tasks: 1, steps: 0, goal: "Ship the parser" }, "a re-plan of the open work on it: o2, never o1 done");
    assert.deepEqual(planReadyOf({ ...g, closed: { at: 1, reason: "done" } }, { since: 150, rev: 5 }), none);
  });

  // (fails before: yes — the walk of plan mode's screens, 11-06: the card said "6 tasks" where the graph beside it said
  // "0 of 5", its step counted beside its own sub-tasks)
  test("what the plan made counts a step by its sub-tasks, as the graph does; a step whose sub-tasks are dropped is a task again", () => {
    const made = [task({ id: "map", addedAt: 200 }), task({ id: "s1", addedAt: 200 }), task({ id: "p1", under: "s1", addedAt: 200 }), task({ id: "p2", under: "s1", addedAt: 200 }), task({ id: "docs", addedAt: 200 })];
    const g = /** @type {any} */ ({ goal: "OAuth sign-in", closed: null, rev: 3, tasks: made });
    assert.deepEqual(planReadyOf(g, { since: 150, rev: 1 }), { tasks: 4, steps: 0, goal: "OAuth sign-in" }, "map, p1, p2, docs");
    const freed = made.map((t) => (t.under ? { ...t, state: "dropped" } : t));
    assert.deepEqual(planReadyOf({ ...g, tasks: freed }, { since: 150, rev: 1 }), { tasks: 3, steps: 0, goal: "OAuth sign-in" }, "map, s1, docs");
  });

  // (fails before: yes — the review of a91935390: every /plan's row said "with 1 message from agents", its line counted)
  test("the row: the /plan's line is no agent's message", () => {
    assert.equal(deliveredCounts({ plan: true, deliveries: 1 }).messages, 0);
    assert.equal(deliveredCounts({ plan: true, deliveries: 2 }).messages, 1, "a report beside it is");
  });

  test("the box reads /plan and its words, alone at the start; the card's words say what the plan has", () => {
    assert.equal(PLAN_WORD, "/plan");
    assert.equal(planWordsOf("/plan"), "");
    assert.equal(planWordsOf("  /plan the export to PDF\nwith the fonts  "), "the export to PDF\nwith the fonts");
    assert.equal(planWordsOf("/PLAN it"), "it");
    assert.equal(planWordsOf("/planet"), null);
    assert.equal(planWordsOf("please /plan it"), null);
    assert.equal(planReadyWords({ tasks: 6, steps: 2 }), "Your plan is ready: 6 tasks on the task graph");
    assert.equal(planReadyWords({ tasks: 1 }), "Your plan is ready: 1 task on the task graph");
    assert.equal(planReadyWords({ steps: 3 }), "Your plan is ready: 3 steps on the checklist");
    assert.equal(planReadyWords({}), "Your plan is ready");
  });

  test("the row's mark and the card: View the plan opens the Plan; none where the turn stopped or left nothing", () => {
    const doc = stubDocument();
    try {
      assert.equal(/** @type {any} */ (planEl({ plan: true }))?.textContent, "/plan · for your agent to plan");
      assert.equal(planEl({}), null);
      let opened = 0;
      const card = /** @type {any} */ (planReadyEl({ planReady: { tasks: 4, steps: 0, goal: "Ship the parser" }, status: "done" }, () => opened++));
      assert.ok(card);
      assert.match(card.textContent, /View the plan/);
      assert.match(card.textContent, /Your plan is ready: 4 tasks on the task graph — Ship the parser/);
      card.querySelectorAll("button")[0].dispatch("click");
      assert.equal(opened, 1);
      assert.equal(planReadyEl({ planReady: { tasks: 4 }, status: "done", stopped: { by: "you" } }, () => {}), null);
      assert.equal(planReadyEl({ planReady: { tasks: 4 }, status: "error" }, () => {}), null);
      assert.equal(planReadyEl({ status: "done" }, () => {}), null);
      assert.equal(planReadyEl({ planReady: { tasks: 0, steps: 0 }, status: "done" }, () => {}), null, "a plan that made nothing");
    } finally {
      doc.restore();
    }
  });
});

describe("end to end: /plan through a real Filament", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  const ASK = "[Filament: the person typed /plan.";
  /** The newest user message's text blocks. @param {any} body @returns {string[]} */
  const lastTexts = (body) => {
    const last = [...(body?.messages || [])].reverse().find((/** @type {any} */ m) => m.role === "user");
    return Array.isArray(last?.content) ? last.content.filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => String(b.text)) : [String(last?.content ?? "")];
  };
  /** Whether a request's newest message carries a tool's result. @param {any} body @param {string} id */
  const resultOf = (body, id) => (body?.messages?.at(-1)?.content || []).some?.((/** @type {any} */ b) => b?.type === "tool_result" && b.tool_use_id === id);
  /** @param {any[]} blocks @param {string} [stop] */
  const reply = (blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks });
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-plan-e2e-"));
    up = await fakeUpstream(async (call) => {
      if (call.kind !== "anthropic") return undefined;
      const body = call.body || {};
      if (!(body.tools || []).length) return anthropicReply("A title", { model: "brain-model" });
      if (resultOf(body, "plan")) return reply([{ type: "text", text: "The plan: the lexer, then the parser on it. Open: which grammar." }]);
      if (lastTexts(body).some((t) => t.includes("the parser")))
        return reply([{ type: "tool_use", id: "plan", name: "tasks", input: { action: "add", goal: "Ship the parser", tasks: [{ id: "lexer", name: "Write the lexer", writes: ["src/lexer.js"] }, { id: "parser", name: "Write the parser", needs: ["lexer"], writes: ["src/parser.js"] }] } }], "tool_use");
      return reply([{ type: "text", text: "ok" }]);
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-words": { tools: false } } }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    await removeDirs(shim?.dataDir, root);
  });
  /** A new chat on `model`: its turns' path. @param {string} model */
  const chat = async (model) => {
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model, preset: "plain", settings: { loop: { permissions: "auto" } } } });
    assert.equal(created.status, 200, await created.clone().text());
    return `/api/sessions/${encodeURIComponent(String((await created.json()).id))}`;
  };
  /** A turn of the chat at `path`, its reply whole. @param {string} path @param {Record<string, any>} body */
  const send = async (path, body) => {
    const r = await shim.api(`${path}/turns`, { method: "POST", body: { stream: false, ...body } });
    assert.equal(r.status, 200, await r.clone().text());
    return r;
  };
  /** @param {string} path */
  const turns = async (path) => /** @type {any[]} */ ((await (await shim.api(`${path}/transcript`)).json()).turns || []);

  // (fails before: yes — there was no /plan: the words went to the agent as typed, and no card followed)
  test("the line rides ahead of the words, the head says so, and the turn's row says what the plan left for the card", async () => {
    const path = await chat("agent/brain-model");
    up.reset();
    const r = await send(path, { content: "/plan the parser", plan: true });
    assert.equal(r.headers.get("x-filament-plan"), "graph", "a card can follow");
    const asked = up.received.find((c) => lastTexts(c.body)[0]?.startsWith(ASK));
    assert.ok(asked, "Filament's line reached the agent");
    assert.deepEqual(lastTexts(asked.body).slice(-1), ["/plan the parser"], "the message as typed, after it");
    const t = (await turns(path)).at(-1);
    assert.equal(t.plan, true);
    assert.deepEqual(t.planReady, { tasks: 2, steps: 0, goal: "Ship the parser" });
    assert.equal(t.deliveries, 1, "one block of Filament's ahead of the words");
    // A /plan whose turn made nothing on the graph: no card.
    await send(path, { content: "/plan nothing yet", plan: true });
    const t2 = (await turns(path)).at(-1);
    assert.deepEqual([t2.plan, t2.planReady], [true, undefined]);
  });

  test("a message of the person's own makes no card, though it plans the same", async () => {
    const path = await chat("agent/brain-model");
    await send(path, { content: "plan out the parser" });
    const t = (await turns(path)).at(-1);
    assert.deepEqual([t.plan, t.planReady], [undefined, undefined]);
  });

  test("a model that takes no tools: the line says it has no task graph, and no card follows", async () => {
    const path = await chat("agent/brain-words");
    up.reset();
    await send(path, { content: "/plan", plan: true });
    const line = up.received.map((c) => lastTexts(c.body)[0] || "").find((x) => x.startsWith("[Filament: the person typed /plan"));
    assert.match(String(line), /this chat's model takes no tools, so you have no checklist or task graph\. Plan it in your reply/);
    const t = (await turns(path)).at(-1);
    assert.deepEqual([t.plan, t.planReady], [true, undefined]);
  });
});
