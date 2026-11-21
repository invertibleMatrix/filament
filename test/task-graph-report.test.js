// @ts-check
// HarnessV3-TaskGraph G2: who does a task, and the report that ends a sub-agent's. tasks names who does a task — the
// agent, a sub-agent or an explorer — with its goal and steps, and a send-back's note; the prompt's graph section says
// what Filament does with such a task. The report tool is offered to a graph task's sub-agent alone, whose prompt says
// so in place of a sub-agent's report line; the loop keeps the report for the run's result, answers one that does not
// read in its words, and asks once for one the run would end without. Version 16. A team's lead's graph is G3's
// (task-graph-team.test.js), which made version 17.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { LEAD_TASKS_TOOL, REPORT_TOOL, SUBAGENT_OFF, TASKS_TOOL, argSummary, isLoopTool, loopToolArgs, toolSetFor } from "../src/app/agent/tools.js";
import { PROMPT, PROMPT_VERSION, TOOL_TEXT, systemPromptFor } from "../src/app/agent/prompt.js";
import { SHIPPED_CARDS } from "../src/services/agent-cards.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { REPORT_ASK, REPORT_IN, REPORT_STATUSES, TASK_BY } from "../src/core/task-graph.js";
import { REPORT_NOT_YOURS } from "../src/app/agent/tools.js";
import { asV54Prompt, asV38Builder, asV42, asV79Tools, asV83WebSearch, asV98Tools } from "./helpers/team.js";

const sha = (/** @type {string} */ s) => createHash("sha256").update(s).digest("hex");
/** The hands differ by platform (powershell on Windows; bash's words): the loop's own tools are what G2 touches. */
const HANDS = new Set(["read", "write", "edit", "bash", "bash_background", "bash_output", "bash_kill", "powershell", "grep", "glob"]);
const own = (/** @type {readonly any[]} */ set) => JSON.stringify(set.filter((t) => !HANDS.has(t.name)));
const names = (/** @type {readonly any[]} */ set) => set.map((t) => t.name);
const REPORT = { status: "done", did: "Fixed parse() for empty input.", met: true, evidence: "npm test: 41 passed", left: "" };

describe("who does a task", () => {
  // (fails before: yes — a task had no by, goal or steps, and a send-back no note)
  test("tasks names who does a task — you, a sub-agent or an explorer — with its goal and steps, and a send-back's note", () => {
    const props = /** @type {any} */ (TASKS_TOOL.input_schema.properties);
    const item = props.tasks.items.properties;
    assert.deepEqual(Object.keys(item), ["id", "name", "needs", "writes", "needed_by", "acceptance", "check", "by", "goal", "steps", "run", "items", "thread", "found_by", "under"]);
    assert.deepEqual(item.by.enum, [...TASK_BY, "command"], "and a task Filament runs itself (HarnessV3-TaskGraph-v2 V2-3)");
    assert.equal(item.goal.type, "string");
    assert.deepEqual(item.steps.items, { type: "string" });
    assert.equal(props.note.type, "string");
    // (fails before: yes — HarnessV3-FailurePoints §6 item 2: a send-back always went to a new sub-agent)
    assert.equal(props.fresh.type, "boolean");
    assert.match(props.fresh.description, /Left out, the task's last sub-agent goes on where it stopped, in its own conversation\.$/);
    assert.equal(TASKS_TOOL.description, TOOL_TEXT.tasks);
    // (fails before: yes — the G2 drive's agent gave its explorer a `node --test` check, which an explorer, running only
    // what reads, could not run)
    // (and a fourth, a command task: HarnessV3-TaskGraph-v2 V2-3, TG2-D72)
    assert.match(TOOL_TEXT.tasks, /by says who does it: you \(the default\); a sub-agent, which changes the files in its writes; an explorer, a sub-agent that changes nothing, runs no tests or builds, and reports what it found — its acceptance is a check it can make by reading; or command, which Filament runs itself with no model/);
    assert.match(item.by.description, /an explorer \(it reads and reports, with no tests and no builds, and names no writes\)/);
    assert.match(TOOL_TEXT.tasks, /Filament starts it once its needs are done, and its report ends it/);
    // (and since version 104, a done task reopened by the same start)
    assert.match(TOOL_TEXT.tasks, /or a failed sub-agent's task to send it back, or a done task to reopen it for another round, with note for its sub-agent, which goes on where it stopped \(fresh: true for a new one\)/);
    // The agent's sets carry it; a team's lead's carries its own (G3).
    assert.equal(loopToolArgs({ graph: true }).find((t) => t.name === "tasks"), TASKS_TOOL);
    assert.equal(loopToolArgs({ lead: true, graph: true }).find((t) => t.name === "tasks"), LEAD_TASKS_TOOL);
  });

  // (fails before: yes — the graph's section said nothing of who does a task)
  test("the agent's graph section says what Filament does with a sub-agent's task; a lead's is its own", () => {
    const off = systemPromptFor({ root: "/p", delegateRead: false });
    const on = systemPromptFor({ root: "/p", delegateRead: false, graph: true });
    // The agent's plan line with the graph on gives the checklist first, the checklist on the graph (V2-5).
    assert.equal(on, off.replace(PROMPT.plan, PROMPT.planOnGraph).replace(`\n\n${PROMPT.headCare}`, `\n\n${PROMPT.headGraph}\n${PROMPT.graph}\n${PROMPT.graphSubagents}\n\n${PROMPT.headCare}`));
    assert.match(PROMPT.graphSubagents, /by: sub-agent/);
    assert.match(PROMPT.graphSubagents, /by: explorer, a sub-agent that reads, runs only what reads — no tests, no builds — and reports what it found/);
    assert.match(PROMPT.graphSubagents, /its acceptance check; an explorer's is one it can make by reading\./);
    assert.match(PROMPT.graphSubagents, /you do not start or finish it/);
    const lead = systemPromptFor({ root: "/p", delegateRead: false, lead: { name: "Architect", persona: "You lead." }, graph: true });
    assert.ok(lead.includes(`${PROMPT.headGraph}\n${PROMPT.leadGraph}\n\n`) && !lead.includes(PROMPT.graph) && !lead.includes(PROMPT.graphSubagents));
  });
});

describe("the report tool", () => {
  // (fails before: yes — there was no report tool)
  // The agent's own set with its graph on carries it too since version 49 (the owner's words of 10-26), refused in words
  // while it is the agent's: a task started as its fork ends with it, on the bytes the provider caches.
  test("offered to a graph task's sub-agent, and to the agent over its graph, right after their own tools; its schema asks what the report reads", () => {
    const plain = loopToolArgs({ disabled: SUBAGENT_OFF });
    const task = loopToolArgs({ disabled: SUBAGENT_OFF, report: true });
    assert.ok(!plain.some((t) => t.name === "report"));
    assert.deepEqual(task.filter((t) => t.name !== "report"), plain, "everything a sub-agent has, as it was");
    assert.equal(task.at(-1), REPORT_TOOL);
    const wide = loopToolArgs({ disabled: SUBAGENT_OFF, report: true, delegateRead: true, web: { fetch: true, search: true } });
    assert.deepEqual(names(wide).slice(names(wide).indexOf("report")), ["report", "delegate_read", "web_fetch", "web_search"]);
    assert.equal(toolSetFor({ delegateRead: false, disabled: SUBAGENT_OFF, report: true }), toolSetFor({ delegateRead: false, disabled: [...SUBAGENT_OFF].reverse(), report: true }), "one frozen set per choice");
    for (const args of [{}, { lead: true, graph: true }]) assert.ok(!loopToolArgs(args).some((t) => t.name === "report"), "never the agent's with its graph off, nor a lead's");
    const graph = loopToolArgs({ graph: true, delegateRead: true, web: { fetch: true, search: true } });
    assert.deepEqual(names(graph).slice(names(graph).indexOf("report") - 1), ["thread", "report", "delegate_read", "web_fetch", "web_search"], "the agent's, after its own");
    assert.deepEqual(REPORT_TOOL.input_schema.required, ["status", "did", "met", "evidence"]);
    assert.deepEqual(REPORT_TOOL.input_schema.properties.status.enum, [...REPORT_STATUSES]);
    assert.equal(REPORT_TOOL.input_schema.properties.met.type, "boolean");
    assert.equal(REPORT_TOOL.description, TOOL_TEXT.report);
    assert.equal(isLoopTool("report"), true);
    assert.equal(argSummary("report", { status: "done", met: true }), "done, acceptance met");
    assert.equal(argSummary("report", { status: "failed", met: false }), "failed, acceptance not met");
    assert.equal(argSummary("report", {}), "?");
  });

  // (fails before: yes — PROMPT_VERSION was 15, and a task's sub-agent had a sub-agent's report line)
  test("a task's sub-agent's prompt: its report line in place of a sub-agent's, and nothing else moves; version 16, 17 since G3, 18 since FailurePoints step 5, 24 since the lead reads along, 25 since it answers a worker's call, 27 since a reading lead's worker asks it, 29 since every worker of a team asks it, 30 since a sub-agent whose agent reads along is told its thinking is its own, 31 since a lead may launch a brief as attempts, 32 since a model that takes no tools told why it has none (HarnessV4_Tasks E4), 33 since a task's check Filament runs itself (V2-1)", () => {
    assert.equal(PROMPT_VERSION, 129);
    for (const card of [SHIPPED_CARDS.builder, SHIPPED_CARDS.reviewer]) {
      const plain = systemPromptFor({ root: "/p", delegateRead: false, toolsOff: SUBAGENT_OFF, subagent: true, card });
      assert.equal(systemPromptFor({ root: "/p", delegateRead: false, toolsOff: SUBAGENT_OFF, subagent: true, card, task: "work" }), plain.replace(PROMPT.subagentReport, PROMPT.taskReport));
    }
    assert.match(PROMPT.taskReport, /call report once/);
    assert.match(PROMPT.taskReport, /your report is what the agent reads/);
  });

  // (fails before: no — a guard the plan asked for: without report, a sub-agent's tools and prompt are what they were —
  // their bytes, pinned as they stood at G2's start; a team's worker's pinned again as HarnessV4_Tasks E15 step 4
  // wrote its role's line from its card on purpose: "a builder", where the line said "the team's builder"; and once
  // more as version 29 let every worker of a team ask its lead, on purpose: HarnessV3-TaskGraph-v2 TG2-D58 — without
  // it, it is version 28's 4f81d656…; the tools weighed with the visuals, artifacts and the Space off, as E16, E18 and
  // proposal_ux §4.14 added them after the rest, the team tool after them (team_v2_plan §5.5) and the flow tool after
  // it (HarnessV4_OneAgent_Plan OA3) and the thread tool after that (th3): pinned in visuals.test.js, artifacts.test.js,
  // space-server.test.js, teams-beside.test.js, flow-tool.test.js and thread-offer.test.js; the prompts weighed without the subject line version 43 asked every
  // report for, HarnessV4_Envelopes_Plan EN1: asV42, envelopes.test.js; the tools weighed without the lsp tool version
  // 80 put after the hands, the owner's LSP of 11-04: asV79Tools, lsp-tool.test.js; and without the envelope version 81
  // gave a sub-agent to write the agent that launched it, the owner's of 11-04: letters.test.js)
  test("without report, a sub-agent's tools and prompt are byte for byte what they were", () => {
    const tools = [
      [{ disabled: [...SUBAGENT_OFF, "envelope", "show_visual", "artifact", "space", "team", "flow", "thread"] }, "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"],
      [{ disabled: [...SUBAGENT_OFF, "envelope", "show_visual", "artifact", "space", "team", "flow", "thread"], delegateRead: true, web: { fetch: true, search: true } }, "f9eb1e452a272e5c687c5fb137f0bbcca1b9f390d879128c209f04b5f08b4dc8"],
    ];
    for (const [args, hash] of tools) {
      // And with web_search as version 83 had it, before it took several searches at once (asV83WebSearch); and the
      // texts as version 98 had them, before web_fetch said its budget in bytes and the shell's command said what it is
      // (asV98Tools).
      const web = (/** @type {any[]} */ set) => (/** @type {any} */ (args).web?.search ? asV83WebSearch(set) : set);
      assert.equal(sha(own(web(asV79Tools(asV98Tools(loopToolArgs(/** @type {any} */ (args))))))), hash, JSON.stringify(args));
      assert.equal(sha(own(web(asV79Tools(asV98Tools(loopToolArgs({ .../** @type {any} */ (args), report: false })))))), hash);
    }
    const prompts = [
      [{ root: "/p", delegateRead: false, subagent: true, readOnly: true, toolsOff: SUBAGENT_OFF }, "ad5635fde46397d307006dfb62a43d7ee07bec1358d27c2cb50959cd69218f32"],
      [{ root: "/p", delegateRead: true, subagent: true, toolsOff: SUBAGENT_OFF, web: { fetch: true, search: false }, environment: "# Environment\nx" }, "c188a90e95abd93f828557c48fe0a04f1bdc992f84c00f1b0cbad5a97f42a019"],
      [{ root: "/p", delegateRead: false, subagent: true, toolsOff: SUBAGENT_OFF, card: asV38Builder(SHIPPED_CARDS.builder), worker: { team: "Architect", words: "" } }, "618e650c135deb852254fca749431154caded15a38e9d6e385df85e9a00bb660"],
    ];
    for (const [args, hash] of prompts) {
      assert.equal(sha(asV42(asV54Prompt(systemPromptFor(/** @type {any} */ (args))))), hash, JSON.stringify(args));
      assert.equal(sha(asV42(asV54Prompt(systemPromptFor({ .../** @type {any} */ (args), task: null })))), hash);
    }
  });
});

describe("the loop keeps the report", () => {
  const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } };
  const answer = (/** @type {any[]} */ content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
  const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
  const said = (/** @type {string} */ t) => [{ type: "text", text: t }];
  /** The newest message of a request. @param {any[]} msgs */
  const newest = (msgs) => msgs.at(-1);
  /**
   * A sub-agent's run: a graph task's when `report`, its replies scripted, its mailbox holding what `mail` says once
   * so many replies came.
   * @param {any[][]} replies @param {{ report?: boolean, mail?: (replies: number) => any[], notCallable?: Record<string, string> | null }} [o]
   */
  const run = (replies, { report = true, mail = () => [], notCallable = null } = {}) => {
    let n = 0;
    /** @type {any[][]} */
    const seen = [];
    /** @type {any[]} */
    const events = [];
    const out = runAgentTurn(/** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
      model: "m",
      messages: [{ role: "user", content: "THE BRIEF" }],
      system: "s",
      tools: loopToolArgs({ disabled: SUBAGENT_OFF, report }),
      modeNow: () => "edit",
      root: tmpdir(),
      readerModel: "",
      maxTokens: 100,
      call: async (/** @type {any} */ { body }) => {
        seen.push(structuredClone(body.messages));
        return answer(replies[n++] || said("Out of words."));
      },
      costOf: () => 0,
      runHand: async () => {
        throw new Error("no hand runs here");
      },
      delegateRead: null,
      unattended: "subagent",
      mailbox: { read: () => mail(n) },
      notCallable,
      permissions: null,
      tree: null,
      onEvent: (/** @type {any} */ e) => events.push(e),
      previewChars: 0,
      sink,
      signal: null,
      resume: null,
    }));
    return { out, seen, events };
  };

  // (fails before: yes — the loop had no report branch: the call was answered as no tool here)
  test("a report call: its words answer it, one that does not read is the call's error in the report's words, and the result carries the latest", async () => {
    const { out, seen, events } = run([
      [toolUse("r1", "report", { ...REPORT, evidence: "" })],
      [toolUse("r2", "report", { ...REPORT, status: "failed", met: false })],
      [toolUse("r3", "report", REPORT)],
      said("Done."),
    ]);
    const r = await out;
    assert.equal(r.status, "done");
    const result = (/** @type {number} */ i) => newest(seen[i]).content[0];
    assert.deepEqual([result(1).is_error, result(1).content], [true, "Error: report needs evidence: the check you ran and what it showed"]);
    assert.notEqual(result(2).is_error, true);
    assert.equal(result(2).content, REPORT_IN);
    assert.equal(result(3).content, REPORT_IN);
    assert.equal(REPORT_IN, "Your report is in: Filament passes it on as you end. End your turn now — a last word is enough.");
    assert.deepEqual(r.report, REPORT, "the latest report stands");
    assert.equal(seen.length, 4, "reported, it is never asked for one");
    assert.deepEqual(events.filter((e) => e.type === "tool-start").map((e) => e.args), ["done, acceptance met", "failed, acceptance not met", "done, acceptance met"]);
  });

  // (fails before: yes — a sub-agent's run ended as its model ended it, with no report kept)
  test("a run offered report that would end without one is asked for it once: given, the result carries it; not given again, the run ends with none", async () => {
    const asked = run([said("All done."), [toolUse("r1", "report", REPORT)], said("Reported.")]);
    const r = await asked.out;
    assert.equal(r.status, "done");
    assert.deepEqual(newest(asked.seen[1]), { role: "user", content: [{ type: "text", text: REPORT_ASK }] });
    assert.deepEqual(asked.seen[1].at(-2), { role: "assistant", content: said("All done.") }, "its words stay in the conversation");
    assert.equal(REPORT_ASK, "[Filament: your task ends with your report, and you have not given it. Call report now — status, did, met and evidence, and left when something is left — then end your turn.]");
    assert.deepEqual(r.report, REPORT);
    assert.ok(r.notes.includes("agent: asked for the task's report — the run would have ended without one"), r.notes.join("\n"));
    assert.deepEqual(r.final, said("Reported."));
    const never = run([said("All done."), said("Still done.")]);
    const n = await never.out;
    assert.deepEqual([n.status, n.report, never.seen.length], ["done", null, 2], "asked once, never twice");
    assert.deepEqual(n.final, said("Still done."));
  });

  // (fails before: yes — the owner's words of 10-26: the main agent carries report while its graph is on, so a task's
  // fork inherits it with its tools; carried, it read as offered, and the main agent was asked for a report as it ended)
  test("a run that carries report refused in words is never asked for one, and a call to it is answered in those words", async () => {
    for (const words of [REPORT_NOT_YOURS.main, REPORT_NOT_YOURS.fork]) {
      const main = run([[toolUse("r1", "report", REPORT)], said("All done.")], { notCallable: { report: words } });
      const r = await main.out;
      assert.equal(r.status, "done");
      assert.ok(JSON.stringify(newest(main.seen[1])).includes(words), "its words answer the call");
      assert.deepEqual([r.report ?? null, main.seen.length], [null, 2], "no report kept, and none asked for");
    }
  });

  // (fails before: yes — a stop from the agent read as the developer's, stopping a turn)
  test("a task the agent's graph dropped: its sub-agent's run ends in the agent's words, the report so far kept", async () => {
    const blocked = { ...REPORT, status: "blocked", met: false, left: "the parser" };
    const { out } = run([[toolUse("r1", "report", blocked)], [toolUse("b1", "bash", { command: "npm test" })]], { mail: (n) => (n === 2 ? [{ kind: "stop", text: "", from: "agent" }] : []) });
    const r = await out;
    assert.deepEqual([r.status, r.stoppedBy], ["stopped", "agent"]);
    assert.match(String(r.final.at(-1)?.text), /^\(Filament: the agent stopped this task after 1 tool call;/);
    assert.equal(r.report?.status, "blocked");
  });

  // (fails before: yes — Filament's own stop read as the developer's, stopping a turn: the D53 drive's dropped attempts)
  test("a task Filament stopped — an attempt another passed before (TG2-D53) — ends in Filament's words, not the developer's", async () => {
    const { out } = run([[toolUse("r1", "report", REPORT)], [toolUse("b1", "bash", { command: "npm test" })]], { mail: (n) => (n === 2 ? [{ kind: "stop", text: "", from: "filament" }] : []) });
    const r = await out;
    assert.deepEqual([r.status, r.stoppedBy], ["stopped", "filament"]);
    assert.match(String(r.final.at(-1)?.text), /^\(Filament: Filament stopped this task after 1 tool call;/);
  });

  // (fails before: no — a guard the plan asked for: a run not offered report is the loop it was)
  test("a run not offered report is never asked for one, and its result carries none", async () => {
    const { out, seen } = run([said("All done.")], { report: false });
    const r = await out;
    assert.deepEqual([r.status, "report" in r, seen.length], ["done", false, 1]);
    const called = run([[toolUse("r1", "report", REPORT)], said("Done.")], { report: false });
    const c = await called.out;
    assert.equal(newest(called.seen[1]).content[0].content, "That tool is not available here; use the tools you were given or answer in text.");
    assert.ok(c.notes.includes("agent: report was called but is not offered in this session"));
    assert.equal("report" in c, false);
  });
});
