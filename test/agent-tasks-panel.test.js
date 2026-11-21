// @ts-check
// HarnessV4_Tasks U1 — a panel of the coding agent's own tasks while they run (HarnessV3-FailurePoints §5.1 item 2,
// §14.3). In the `mx774dfh` session Claude started sub-agents and shells in the background, its turn ended, and the
// chat looked idle for minutes until Claude began a turn by itself. The server has said those tasks since the failure
// points' step 3 — the whole list at every change, and with the transcript — and nothing on the page read them. The
// floating status panel lists them now, and (E6) a sub-agent its agent lets Filament stop alone has its Stop there.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { agentTaskRows, agentTasksWord } from "../src/ui/harness/lib/agent-tasks.js";
import { stubDocument } from "./helpers/dom-stub.js";

const NOW = 1_800_000_000_000;
/** A task as the bridge says it. @param {Record<string, any>} o @returns {any} */
const task = (o) => ({ id: "t1", kind: "local_agent", description: "Map the parser", background: false, call: "toolu_1", subagent: null, since: NOW - 60_000, tokens: null, tools: null, lastTool: null, summary: null, ...o });

describe("the rows' words", () => {
  // (fails before: yes — nothing on the page read a coding agent's tasks)
  test("a row each, the oldest first: what it is, its kind and how it runs, what it has used, its last tool, how long, and its own word", () => {
    const rows = agentTaskRows([
      task({ id: "b", kind: "local_bash", description: "npm test", background: true, since: NOW - 4 * 60_000 }),
      task({ id: "a", subagent: "Explore", background: true, since: NOW - 3 * 3600_000, tokens: 12_340, tools: 5, lastTool: "Read", summary: "Reading   the\n lexer" }),
      task({ id: "c", kind: "local_workflow", description: "", since: NOW - 5000, tokens: 840, tools: 1 }),
      task({ id: "d", kind: "some_new_kind", description: "", since: 0 }),
    ], NOW);
    assert.deepEqual(rows, [
      { id: "d", name: "some new kind", meta: "some new kind", age: "", said: "", stop: false },
      { id: "a", name: "Map the parser", meta: "agent (Explore) · in the background · 12.3k tokens · 5 tool calls · last: Read", age: "3h", said: "Reading the lexer", stop: false },
      { id: "b", name: "npm test", meta: "shell · in the background", age: "4m", said: "", stop: false },
      { id: "c", name: "workflow", meta: "workflow · 840 tokens · 1 tool call", age: "just now", said: "", stop: false },
    ]);
    assert.equal(agentTaskRows([task({ stop: true })], NOW)[0].stop, true, "one Filament can stop alone says so (E6)");
    assert.deepEqual([agentTaskRows(null, NOW), agentTaskRows(undefined, NOW)], [[], []]);
    assert.deepEqual([agentTasksWord([]), agentTasksWord(null), agentTasksWord([task({})]), agentTasksWord([task({}), task({ id: "t2" })])], ["", "", "1 task running", "2 tasks running"]);
    assert.equal(agentTaskRows([task({ tokens: 250_000 })], NOW)[0].meta, "agent · 250k tokens");
  });
});

describe("the status panel's section", () => {
  test("the agent's tasks open the panel, are counted on its capsule and listed under the agent's name; none, and the section is gone", async () => {
    const doc = stubDocument();
    try {
      const { createStatusPanel } = await import("../src/ui/harness/conversation/status-panel.js");
      // The panel floats where Appearance says so; the capsule in the header is the default (proposal_ux D3).
      /** @type {any} */ (globalThis).localStorage = { getItem: (/** @type {string} */ k) => (k === "filament.harness.statusPanel" ? "auto" : null), setItem: () => {} };
      const panel = createStatusPanel({ onOpenPlan: () => {}, onGoal: () => {} });
      /** @type {any} */
      const el = panel.el;
      const tasks = [task({ id: "a", subagent: "Explore", background: true, tokens: 12_340, tools: 5, lastTool: "Read", summary: "Reading the lexer" }), task({ id: "b", kind: "local_bash", description: "npm test", background: true, since: NOW - 30_000 })];
      panel.set({ agentTasks: { who: "Claude Code", tasks } });
      assert.equal(el.classList.contains("hidden"), false, "something runs: the panel shows");
      assert.equal(el.querySelector(".sp-capsule").textContent, "2 tasks running");
      assert.equal(el.classList.contains("expanded"), true, "a task that starts opens the card, as a sub-agent that starts does");
      const head = el.querySelector(".sp-section-head");
      assert.equal(head.textContent, "Claude Code's tasks2 running");
      const rows = el.querySelectorAll(".sp-task");
      assert.deepEqual(rows.map((/** @type {any} */ r) => [r.querySelector(".sp-agent-name").textContent, r.querySelector(".sp-task-meta").textContent, r.querySelector(".sp-task-said")?.textContent ?? null]), [
        ["Map the parser", "agent (Explore) · in the background · 12.3k tokens · 5 tool calls · last: Read", "Reading the lexer"],
        ["npm test", "shell · in the background", null],
      ]);
      assert.equal(rows[0].querySelector(".sp-sub").classList.contains("tone-running"), true);
      assert.equal(rows[0].querySelectorAll("button").length, 0, "they are the agent's to run and to stop");
      // More than the panel lists: the rest are counted.
      panel.set({ agentTasks: { who: "Claude Code", tasks: Array.from({ length: 8 }, (_, i) => task({ id: `t${i}`, since: NOW - i * 1000 })) } });
      assert.deepEqual([el.querySelectorAll(".sp-task").length, el.querySelector(".sp-more").textContent], [6, "2 more"]);
      // They ended: the section and the panel go.
      panel.set({ agentTasks: null });
      assert.equal(el.classList.contains("hidden"), true);
    } finally {
      doc.restore();
      delete (/** @type {any} */ (globalThis)).localStorage;
    }
  });

  // (fails before: yes — HarnessV4_Tasks E6: the rows offered nothing, and a background sub-agent worked on until its
  // agent ended it, or the chat's whole agent was stopped)
  test("a sub-agent its agent lets Filament stop alone has its Stop, which names it; a shell has none", async () => {
    const doc = stubDocument();
    try {
      const { createStatusPanel } = await import("../src/ui/harness/conversation/status-panel.js");
      // The panel floats where Appearance says so; the capsule in the header is the default (proposal_ux D3).
      /** @type {any} */ (globalThis).localStorage = { getItem: (/** @type {string} */ k) => (k === "filament.harness.statusPanel" ? "auto" : null), setItem: () => {} };
      /** @type {string[]} */
      const stopped = [];
      const panel = createStatusPanel({ onOpenPlan: () => {}, onGoal: () => {}, onStopAgentTask: (id) => stopped.push(id) });
      /** @type {any} */
      const el = panel.el;
      panel.set({ agentTasks: { who: "Claude Code", tasks: [task({ id: "a7f00d", background: true, stop: true }), task({ id: "b", kind: "local_bash", description: "npm run dev", background: true, since: NOW - 30_000 })] } });
      const rows = el.querySelectorAll(".sp-task");
      const buttons = rows.map((/** @type {any} */ r) => r.querySelectorAll("button").map((/** @type {any} */ b) => [b.textContent, b.getAttribute("title")]));
      assert.deepEqual(buttons, [[["Stop", "Stop this agent now — Claude Code and its other work go on"]], []], "the shell is its agent's to stop");
      rows[0].querySelector("button").dispatch("click");
      assert.deepEqual(stopped, ["a7f00d"]);
    } finally {
      doc.restore();
      delete (/** @type {any} */ (globalThis)).localStorage;
    }
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.match(app, /api\(`\/sessions\/\$\{encodeURIComponent\(chat\.chainId\)\}\/agent-tasks\/\$\{encodeURIComponent\(id\)\}\/stop`, \{ method: "POST" \}\)/, "the page asks the server to stop it");
    assert.match(app, /onStopAgentTask: stopAgentTask,/);
  });

  test("the page feeds it: the transcript's list when the chat opens, each list the events feed says after, under the agent's name (source contract)", () => {
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.match(app, /chat\.agentTasks = Array\.isArray\(tr\.agentTasks\) \? tr\.agentTasks : \[\];/);
    // The feed's word, for the page's chat on that session, whoever holds it (live-topic-page.test.js drives it).
    assert.match(app, /if \(msg\?\.type === "agent-tasks" && msg\.chainId\) setAgentTasks\(String\(msg\.chainId\), msg\.tasks\);/);
    const set = app.slice(app.indexOf("function setAgentTasks("), app.indexOf("\n}\n", app.indexOf("function setAgentTasks(")));
    assert.match(set, /chat\.agentTasks = Array\.isArray\(list\) \? list : \[\];\n\s*chat\.agentTasksAt = Date\.now\(\);\n\s*if \(chatOf\(state\.currentId\) === chat\) paintStatus\(chat\);/);
    assert.match(app, /const agentTasks = chat\?\.agentTasks\?\.length \? \{ who: agentOf\(chat\.model\)\?\.agentName \|\| "The agent", tasks: chat\.agentTasks \} : null;[\s\S]{0,300}?plan, subagents: subagentStore\.rows\(\), subagentsQueued: subagentStore\.queued\(\), agentTasks,/);
    assert.match(app, /statusPanel\.set\(model\);\n\s*statusCapsule\.set\(model\);/, "the capsule and the floating panel draw the same model");
    // The server's doors, as the page reads them: the events feed's `turns`, with the chat's id, and the transcript.
    const server = readFileSync("src/server.js", "utf8");
    assert.match(server, /tasksOnFeed\(chain, \{ type: "agent-tasks", chainId: chain, sessionId, tasks \}\);/);
    assert.match(readFileSync("src/app/sessions/service.js", "utf8"), /agentTasks: agentTasks\?\.\(chain\.id\) \|\| \[\],/);
  });
});
