// @ts-check
// HarnessV3-TaskGraph G1: what the graph adds. It is always on (the owner's word of 10-29): no setting, command or
// words switch it, and it adds the tasks tool beside plan — for the agent and for a team's lead — and the prompt's
// section on choosing between the graph and the checklist. A turn with no graph — a sub-agent's, a fork's — has the
// tools and the prompt byte for byte as they were before the graph existed. The loop runs a tasks call against the
// session's graph, answers a refusal in its words, tells the page each change, and brings the graph back after a
// fold's summary while it has open tasks.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { KNOBS, applyPatch, parseKnobText } from "../src/services/session-settings.js";
import { FORK_REFUSALS, LEAD_TASKS_TOOL, TASKS_TOOL, argSummary, isLoopTool, loopToolArgs } from "../src/app/agent/tools.js";
import { PROMPT, PROMPT_VERSION, TOOL_TEXT, systemPromptFor } from "../src/app/agent/prompt.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { TASK_ACTIONS, applyTasks, graphView, openGraphText } from "../src/core/task-graph.js";
import { graphCommandReply } from "../src/app/commands/graph.js";
import { reattachBlock } from "../src/app/sessions/reattach.js";
import { asV104Prompt, asV104Tools, asV109Tools, asV86Prompt, asOldRoster, asOldRosterTools, asV54Prompt, asV36, asV37, asV38, asV42, asV43, asV52, asV52Prompt, asV67Tools, asV72Tools, asV73Tools, asV95Tools, asV96Prompt, asV97Prompt, asV98Prompt, asV96Tools, asV98Tools, asV99Tools, asV101Tools, asV102Tools, asV102Prompt, asV75Tools, asV76Prompt, asV79Tools, asV83WebSearch, asV91Tools, asV94Tools, asV111Tools, asV116Tools, asV116Prompt } from "./helpers/team.js";

const sha = (/** @type {string} */ s) => createHash("sha256").update(s).digest("hex");
const names = (/** @type {readonly any[]} */ set) => set.map((t) => t.name).join(",");
/** The hands differ by platform (powershell on Windows; bash's words): the loop's own tools are what the graph touches. */
const HANDS = new Set(["read", "write", "edit", "bash", "bash_background", "bash_output", "bash_kill", "powershell", "grep", "glob"]);
const own = (/** @type {readonly any[]} */ set) => JSON.stringify(set.filter((t) => !HANDS.has(t.name)));

// No dash in a tool's words (version 94, the owner's tool plan of 11-08): the loop's own tools these sets carry, each
// text as version 94 words it and as version 93 did — the tool's own description ("") or one field's.
const V94_WORDS = Object.freeze([
  ["agent", "", "Launch a sub-agent for one task: another agent — on the model you name, else as the developer chose for this session — with its own context and your tools except ask, plan and agent, working until the task is done. In the background (the default) you keep working and the report arrives as a message when it finishes — this turn does not end before it does; to wait for it, call wait (never sleep or poll). With run_in_background: false its final report is this tool's result. agent_id continues a sub-agent you launched earlier in this session, in the context it already has (\"check again\"), with prompt as your follow-up. Use it for searches across many files and for independent pieces of work; several agent calls in one reply run at the same time. The sub-agent cannot ask anyone anything and sees nothing of your conversation beyond the context view you choose (fork: all of it, as a copy of you), so the prompt must carry everything it needs: the goal, where to look, and what to report back. A sub-agent that changes files may work in its own git worktree, copied from your folder as it stands at launch, uncommitted changes included (what you change here after that does not reach it): its report then lists the files it changed, and they reach your folder only when you apply them — agent_id with apply_changes: true.", "Launch a sub-agent for one task: another agent — on the model you name, else as the developer chose for this session — with its own context and your tools except ask, plan and agent, working until the task is done. In the background (the default) you keep working and the report arrives as a message when it finishes — this turn does not end before it does; to wait for it, call wait (never sleep or poll). With run_in_background: false its final report is this tool's result. agent_id continues a sub-agent you launched earlier in this session, in the context it already has (\"check again\"), with prompt as your follow-up. Use it for searches across many files and for independent pieces of work; several agent calls in one reply run at the same time. The sub-agent cannot ask anyone anything and sees nothing of your conversation beyond the context view you choose (fork: all of it, as a copy of you), so the prompt must carry everything it needs: the goal, where to look, and what to report back. A sub-agent that changes files may work in its own git worktree: its report then lists the files it changed, and they reach your folder only when you apply them — agent_id with apply_changes: true."],
  ["agent", "subagent_type", "builder (the default): your tools under this session's permission mode. reviewer: read-only; it searches and reads, never changes anything.", "builder (the default): your tools under this session's permission mode. reviewer: read-only — search and read, never change anything."],
  ["agent", "changes", "Hand it a change as a patch ahead of your prompt, so you need not paste it: running (what this turn has changed up to its last finished round, for a review of your own work), turn (what the turn before this one changed), uncommitted (everything uncommitted in the folder) or since:<ref> (everything since a commit, tag or branch, as since:v1.2). With agent_id it rides ahead of your follow-up. Left out: none, unless its card says otherwise.", "Hand it a change as a patch, ahead of your prompt, so that you need not paste it: running — what you have changed in the turn you are in now, up to its last finished round: the one for a review of your own work · turn — what the turn before this one changed, never this one's · uncommitted — everything uncommitted in the folder · since:<ref> — everything since a commit, tag or branch (since:v1.2). With agent_id it rides ahead of your follow-up (\"check again\"). Left out, it sees none unless its card says otherwise."],
  ["filament_recall", "", "Bring back what Filament left out of this conversation's history to save room: an earlier turn in full (its tool calls and their results, verbatim) by its number, or one tool result by the pointer written in its place (r: plus eight hex digits, as in 'result r:2f9a1c3d' or '→ superseded … (r:…)'). Use it when a folded turn, a stub line or a pointer stands where you need the actual text, instead of running a tool again. Returns the archived text; nothing is re-run. Not long-term memory: that is filament_memory_search.", "Bring back what Filament left out of this conversation's history to save room: an earlier turn in full (its tool calls and their results, verbatim) by turn number, or one tool result by the pointer written in its place (r: plus eight hex digits, as in 'result r:2f9a1c3d' or '→ superseded … (r:…)'). Use it when a folded turn, a stub line or a pointer stands where you need the actual text. Returns the archived text; nothing is re-run."],
  ["filament_recall", "turn", "The turn's number, to bring it back whole.", "The turn number to bring back whole."],
  ["filament_recall", "result", "A result pointer: r: and eight hex digits.", "A result pointer, r: followed by eight hex digits."],
  ["agent", "", "Launch a worker for one task, in the background: a sub-agent of Filament's in one role, with the session's hands and MCP servers: scout (reads and searches, changes nothing), builder (changes code), tester (writes and runs tests) or reviewer (reads a change or files and judges them, changes nothing). It sees nothing of your conversation beyond the context view you choose, so brief it completely: the goal and why, what to read first, the files, the steps in order, the acceptance check that proves it done (with check, the commands that prove it, which Filament runs itself once the worker reports), the other commands it may run, and what not to touch. Filament writes its task from these fields. Its report arrives as a message when it finishes, and this turn does not end before it does; to wait for it, call wait. A builder and a tester work in their own git worktree when the folder is a repository: their changes reach your folder only when you apply them (worker with apply_changes: true). A reviewer's review names the builder or tester whose change, not applied yet, it reads ahead of its brief. Several agent calls in one reply launch at once.", "Launch a worker for one task, in the background: a sub-agent of Filament's in one role, with the session's hands and MCP servers — scout (reads and searches, changes nothing), builder (changes code), tester (writes and runs tests) or reviewer (reads a change or files and judges them, changes nothing). It sees nothing of your conversation beyond the context view you choose, so brief it completely: the goal and why, what to read first, the files, the steps in order, the acceptance check that proves it done — with check, the commands that prove it, which Filament runs itself once the worker reports — the other commands it may run, and what not to touch. Filament writes its task from these fields. Its report arrives as a message when it finishes, and this turn does not end before it does; to wait for it, call wait. A builder and a tester work in their own git worktree when the folder is a repository: their changes reach your folder only when you apply them (worker with apply_changes: true). A reviewer's review names the builder or tester whose change, not applied yet, it reads ahead of its brief. Several agent calls in one reply launch at once."],
  ["agent", "check", "One to five commands that prove the task done, as they run in the worker's folder (npm test, node test/money.test.js). The worker may run them without asking, and Filament runs them itself once it reports: a failing check goes back to the worker, twice at most, before you hear.", "One to five commands that prove the task done, as they run in the worker's folder (npm test, node --test test/money.test.js). The worker may run them without asking, and Filament runs them itself once it reports: a failing check goes back to the worker, twice at most, before you hear."],
  ["agent", "may_run", "Other commands the worker may run in its own worktree without anyone's answer, each a command and its first words at least (npm run lint, npm run typecheck): the same followed by more words runs too. Never an install, nor a step that cannot be undone.", "Other commands the worker may run in its own worktree without anyone's answer, each a command and its first words at least (npx tsc --noEmit, npm run lint): the same followed by more words runs too. Never an install, nor a step that cannot be undone."],
  ["agent", "context", "What it sees of this session ahead of its brief, from its last compaction on. Left out: none, the brief alone (the default, and almost always right: a worker handed the conversation takes on its view of it, while one handed only its brief works apart from it, so put the facts it needs in the brief instead). Only for a task about the conversation itself: folded (every turn folded to its words, one line per tool call) or window (this session's context window as it stands, the running turn included). Only window includes the current turn's work.", "What it sees of this session ahead of its brief, from its last compaction on. Left out: none — the brief alone, the default and almost always right: a worker handed the conversation takes on its view of it, while one handed only its brief works apart from it, so put the facts it needs in the brief instead. Only where the task is about the conversation itself: folded — every turn folded to its words with one line per tool call · window — this session's context window as it stands, the turn running now to its newest round included. Except window, the current turn's work is never included."],
  ["agent", "attempts", "2 or 3: that many workers take this brief at once, each in a worktree of its own, for a task worth trying more than once. Filament runs each one's check when it reports: the first that passes is your worker, and you hear its report alone; the others are stopped and their work dropped. If none passes, you hear each. Needs check; never with plan_review, nor for a member that changes nothing. You do not read along with them.", "2 or 3: that many workers take this brief at once, each in a worktree of its own — for a task worth trying more than once. Filament runs each one's check when it reports: the first that passes is your worker, and you hear its report alone; the others are stopped and their work dropped. If none passes, you hear each. Needs check; never with plan_review, nor for a member that changes nothing. You do not read along with them."],
  ["worker", "", "Reach a worker you launched in this session, by its agent_id. While it runs, prompt is a message it reads at its next step, as it works, and stop: true stops it; its report so far arrives as a message. Once it reported, prompt is a follow-up it takes in the context it already has, in the background like its launch: add correction: true when its work fell short, saying what and what to do instead. Or apply_changes: true, with no prompt, applies the changes a builder or a tester made in its own git worktree to your folder. A worker that asked you a question waits for your answer: answer, with ask (the number of its question) and nothing else.", "Reach a worker you launched in this session, by its agent_id. While it runs, prompt is a message it reads at its next step, as it works, and stop: true stops it — its report so far arrives as a message. Once it reported, prompt is a follow-up it takes in the context it already has, in the background like its launch: add correction: true when its work fell short, saying what and what to do instead. Or apply_changes: true, with no prompt, applies the changes a builder or a tester made in its own git worktree to your folder. A worker that asked you a question waits for your answer: answer, with ask — the number of its question — and nothing else."],
  ["worker", "prompt", "To a running worker, your message: what to change, check or keep in mind, read at its next step. To one that reported, your follow-up: what to fix, what to do next, or what to answer; it keeps everything it already read and did.", "To a running worker, your message: what to change, check or keep in mind, read at its next step. To one that reported, your follow-up: what to fix, what to do next, or what to answer — it keeps everything it already read and did."],
  ["worker", "answer", "With ask, and nothing else, to a running worker that asked you a question: your answer, what to do and why.", "With ask, and nothing else, to a running worker that asked you a question: your answer — what to do, and why."],
  ["wait", "", "Wait for your workers: returns the moment one of them reports (its report arrives as a message), one asks you a question (it arrives as a message too), the developer sends you a message, or the seconds pass (default 300, at most 600), and lists the workers still running, each with its round, newest tool, context window, compactions and newest words, or the answer it waits for (yours, or the developer's). With no worker running it returns at once.", "Wait for your workers: returns the moment one of them reports (its report arrives as a message), one asks you a question (it arrives as a message too), the developer sends you a message, or the seconds pass (default 300, at most 600) — and lists the workers still running, each with its round, newest tool, context window, compactions and newest words, or the answer it waits for — yours, or the developer's. With no worker running it returns at once."],
]);
/**
 * A tool set as version 93 worded it, before the owner's tool plan of 11-08 took the dashes out of the loop's own tool
 * texts: each text above as it was then. It must carry at least one as version 94 words it.
 * @param {readonly any[]} set
 */
const asV93Tools = (set) => {
  let moved = false;
  const back = set.map((t) => {
    let tool = t;
    for (const [name, field, now, then] of V94_WORDS) {
      if (tool?.name !== name) continue;
      if (!field && tool.description === now) tool = { ...tool, description: then };
      const p = field ? tool.input_schema?.properties?.[field] : null;
      if (p && p.description === now) tool = { ...tool, input_schema: { ...tool.input_schema, properties: { ...tool.input_schema.properties, [field]: { ...p, description: then } } } };
    }
    if (tool !== t) moved = true;
    return tool;
  });
  assert.ok(moved, "the set carries the loop's tools as version 94 words them");
  return back;
};

// (fails before: yes — engine.taskGraph was a setting, `/graph on` and `/graph off` switched it, and its default could be
// set off for an agent and for a team)
test("the task graph has no switch: no setting, no layer's write and no form of /graph turns it off", () => {
  assert.equal(KNOBS["engine.taskGraph"], undefined, "no setting");
  assert.deepEqual(parseKnobText("engine.taskGraph", "off"), { error: 'There is no setting called "engine.taskGraph". /settings all lists every setting.' }, "`/set engine.taskGraph off` names no setting");
  for (const at of /** @type {const} */ (["session", "project", "global"])) {
    const r = applyPatch({}, { patch: { engine: { taskGraph: false } } }, { at });
    assert.deepEqual([r.errors.length > 0, r.changes], [true, []], `the ${at} layer refuses it`);
    assert.match(r.errors.join("; "), /engine\.taskGraph/);
  }
  const graph = /** @type {any} */ (applyTasks(null, { action: "add", goal: "Ship the parser", tasks: [{ id: "t1", name: "Fix the parser" }] }, { at: 1, crew: "agent" })).graph;
  let writes = 0;
  const memory = {
    docFor: () => ({ effective: { engine: { mode: "agent" } }, sources: {} }),
    archive: { getChain: () => ({ id: "c1", meta: { graph } }) },
    patchSessionSettings: () => void writes++,
    archiveWhy: () => "",
  };
  /** @param {string} arg */
  const say = (arg) => graphCommandReply(memory, "c1", { arg }).text;
  for (const arg of ["off", "on", "help"]) assert.equal(say(arg), `\`/graph ${arg}\` is no form of the command — \`/graph\` alone shows this session's task graph.`);
  assert.equal(writes, 0, "no write");
  assert.match(say(""), /^\*\*Task graph\*\* — the agent has the tasks tool beside its checklist, and puts each piece of work on whichever fits\.\nThe graph, as the agent reads it:\n/);
});

describe("what the graph adds", () => {
  // (fails before: yes — there was no tasks tool)
  // The agent's own set carries report too since version 49 (the owner's words of 10-26): a task started as its fork
  // ends with it, on the bytes the provider caches (subagent-task.test.js).
  test("with the graph, tasks rides beside plan, agent and wait — the agent's set and a team's lead's — the agent's report after its own, and nothing else moves", () => {
    for (const args of [{}, { delegateRead: true, web: { fetch: true, search: true }, recall: true }, { lead: true }, { lead: true, delegateRead: true, web: { fetch: true, search: false } }]) {
      const off = loopToolArgs(args);
      const on = loopToolArgs({ ...args, graph: true });
      assert.ok(!off.some((t) => t.name === "tasks"), "without the graph: no tasks");
      const lead = !!(/** @type {any} */ (args).lead);
      assert.deepEqual(on.filter((t) => t.name !== "tasks" && (lead || t.name !== "report")), off, "with it: everything it had, as it was");
      assert.equal(on.some((t) => t.name === "report"), !lead, "the agent's carries report, a lead's none");
      const at = on.findIndex((t) => t.name === "tasks");
      assert.equal(on[at - 1].name, "plan", "tasks comes right after plan");
      assert.equal(on[at], /** @type {any} */ (args).lead ? LEAD_TASKS_TOOL : TASKS_TOOL, "a lead's names its team's roles (G3)");
    }
    assert.equal(names(loopToolArgs({ graph: true }).filter((t) => !HANDS.has(t.name))), "lsp,ask,plan,tasks,agent,wait,envelope,visual_guide,show_visual,artifact,space,team,flow,thread,report");
    assert.equal(names(loopToolArgs({ lead: true, graph: true }).filter((t) => !HANDS.has(t.name))), "lsp,ask,plan,tasks,agent,worker,wait,envelope,visual_guide,show_visual,artifact,space");
    // Every hand the agent has, a lead has since HarnessV4_Tasks decision 9 (read, grep and glob alone before).
    assert.equal(names(loopToolArgs({ lead: true, graph: true }).filter((t) => HANDS.has(t.name))), names(loopToolArgs({ graph: true }).filter((t) => HANDS.has(t.name))));
    // A plan switched off leaves tasks where it was.
    assert.equal(names(loopToolArgs({ graph: true, disabled: ["plan"] }).filter((t) => !HANDS.has(t.name))), "lsp,ask,tasks,agent,wait,envelope,visual_guide,show_visual,artifact,space,team,flow,thread,report");
    assert.deepEqual(TASKS_TOOL.input_schema.properties.action.enum, [...TASK_ACTIONS]);
    assert.equal(TASKS_TOOL.description, TOOL_TEXT.tasks);
    assert.equal(isLoopTool("tasks"), true);
    // A fork carries the main agent's tools byte for byte: its call is answered in words.
    assert.equal(FORK_REFUSALS.tasks, "Not run: the task graph is the main agent's. As its fork, keep your own steps and carry on with the task.");
    assert.equal(argSummary("tasks", { action: "add", goal: "g", tasks: [{ id: "t1" }, { id: "t2" }] }), "add 2 tasks");
    assert.equal(argSummary("tasks", { action: "start", ids: ["t2", "t3"] }), "start t2, t3");
    assert.equal(argSummary("tasks", { action: "done", id: "t1", summary: "x" }), "done t1");
    assert.equal(argSummary("tasks", { action: "change", goal: "g" }), "change");
    assert.equal(argSummary("tasks", { action: "show" }), "show");
    assert.equal(argSummary("tasks", {}), "?");
  });

  // (fails before: no — a guard the plan asked for: with no graph, the tools and the prompt are what they were
  // before the graph existed — their bytes, pinned here as they stood at G1's start; the agent's own three prompts
  // pinned again as HarnessV4_Tasks E15 step 3 changed the agent tool's line on purpose: when not to split, the count;
  // the agent's three tool sets pinned again as step 4 named the agent tool's two kinds helper and scout, and gave
  // the tool the change it hands over (`changes`), on purpose; the agent's own three prompts pinned once more as
  // step 4 added the three recipes after the agent tool's line — the lead's and a sub-agent's did not move; the lead's
  // three pinned again as version 26 gave its lines and tools a brief's new fields, its check and its message to all,
  // on purpose: HarnessV3-TaskGraph-v2 §13; the lead's two tool sets once more as version 27 gave its agent tool
  // plan_review, on purpose, TG2-D50 — without it they are version 26's 12f7b8a0… and 807a6c1f…; and the lead's three
  // once more as version 29 had it plan the whole work first and answer its workers' questions, its worker tool with
  // answer and ask, on purpose, TG2-D57 and D58 — without it they are version 27's 622feda7…, 55b6dc6a… and 3a84eb95…;
  // and the lead's two tool sets once more as version 31 gave its agent tool attempts, on purpose, TG2-D53 — without
  // that field they are version 30's 618be524… and e2ae0e04… byte for byte; and the lead's prompt once more as version
  // 37 gave a lead hands of its own, on purpose, HarnessV4_Tasks decision 9 — with version 36's words (asV36) it is
  // ae2985ff… byte for byte, and its tool sets, weighed without the hands, did not move; and every tool set once more
  // as version 38 gave every agent tool its model fields, on purpose, HarnessV4_Tasks E23 — without them (asV37) they
  // are version 37's byte for byte;
  // the tools are weighed with the visuals off, as HarnessV4_Visuals_Plan E16 added them after the rest: they are
  // pinned in visuals.test.js; the artifact tool and the Space's with them, which E18 and proposal_ux §4.14 added; a
  // sub-agent's prompt weighed without the subject line version 43 asked its report for, HarnessV4_Envelopes_Plan EN1:
  // asV42, envelopes.test.js; and every tool set weighed without the envelope tool version 44 put after wait, EN2:
  // asV43, envelopes-loop.test.js; and the agent's own sets weighed without the mark_applied field version 68 gave its
  // agent tool, 10-29: asV67Tools, mark-applied.test.js; the set with filament_recall weighed with its words before
  // version 74 took the digests out of them, 10-31: asV73Tools; and the prompt that carried the digest instruction
  // weighed without it, which version 74 took out with the digests, 10-31 — without it, HEAD's prompt byte for byte;
  // and every set's apply_changes as version 75 had it, before a graph task's work waited for its apply, 11-02: asV75Tools;
  // and a lead's lines with the one on the mode that held its orders, which version 77 took out, 11-03: asV76Prompt;
  // and every set without the lsp tool version 80 put after the hands, 11-04: asV79Tools; and a lead's with its
  // worker tool's answer and plan_review as version 91 worded them, before its yes and go were fields: asV91Tools; and
  // every set as version 93 worded the loop's own tools, before the owner's tool plan of 11-08 took their dashes out:
  // asV93Tools)
  test("with no graph — a sub-agent's, a fork's — the tools and the prompt are byte for byte what they were", () => {
    const noVisuals = (/** @type {any} */ a) => ({ ...a, disabled: [...(a.disabled || []), "show_visual", "artifact", "space", "team", "flow", "thread"] });
    const tools = [
      // The agent's three moved once more with the words of its tool's `changes` field (whose turn each source is).
      // Every set weighed without the window view version 39 gave every agent tool's context (asV38).
      [{}, "95a0f81bd935660be6812d81b95bdbde26157ae41a6d7b9aa3fd09e13044159c"],
      [{ delegateRead: true, web: { fetch: true, search: true }, recall: true }, "632858f55845bd75ab94bd1795d9ccf43901d2280791281acad6a105b5dd5d9a"],
      [{ disabled: ["plan", "bash"] }, "44276a5e1d653c192258a75497e69dc9d6ec038c84db13752c306fc42fa1bbff"],
      [{ lead: true }, "6c1337ef68f4dd0643e1fc982c85cd36ca33317d26da18d5c10d401e86565487"],
      [{ lead: true, delegateRead: true, web: { fetch: true, search: false } }, "18d7b0871bfb2630ce22f83f1f9e224f980b6fdbbb3c4c4576be921bc96a8dd1"],
    ];
    for (const [args, hash] of tools) {
      // The agent's own sets weighed as version 52 had its agent tool, before its launches ran in the background by default
      // and before it could mark a sub-agent's change as applied (version 68).
      // The agent's own sets weighed too with its tool's own two kinds as Helper and Scout, the cards that shipped before
      // the roster shrink of 11-03 (asOldRosterTools).
      const v52 = (/** @type {any[]} */ set) => (/** @type {any} */ (args).lead ? set : asV67Tools(asV52(set)));
      // And the agent's own sets as version 96 had its tool's background field, before the prompt pass of 11-08 (asV96Tools).
      const v96 = (/** @type {any[]} */ set) => (/** @type {any} */ (args).lead ? set : asV96Tools(set));
      const v73 = (/** @type {any[]} */ set) => (/** @type {any} */ (args).recall ? asV73Tools(set) : set);
      const roster = (/** @type {any[]} */ set) => (/** @type {any} */ (args).lead ? set : asOldRosterTools(set));
      // And with web_search as version 83 had it, before it took several searches at once (asV83WebSearch).
      const web = (/** @type {any[]} */ set) => (/** @type {any} */ (args).web?.search ? asV83WebSearch(set) : set);
      // And a lead's with its worker tool's answer and plan_review as version 91 worded them, before its yes and go were
      // fields (asV91Tools, the memory plan's a2).
      const v91 = (/** @type {any[]} */ set) => (/** @type {any} */ (args).lead ? asV91Tools(set) : set);
      // And every set as version 93 worded the loop's own tools, before the owner's tool plan of 11-08 took the dashes out
      // of them (asV93Tools); the agent's own sets first as version 94 had its agent tool, before its follow-up took sync.
      const v94 = (/** @type {any[]} */ set) => (/** @type {any} */ (args).lead ? set : asV94Tools(set));
      // And the set with filament_recall as version 95 worded it, before it listed the chat's turns (asV95Tools).
      const v95 = (/** @type {any[]} */ set) => (/** @type {any} */ (args).recall ? asV95Tools(set) : set);
      // And every set that carries a text version 99 moved as version 98 had it, before the loop's tool texts were said where
      // they are used (asV98Tools): the agent's own tool and its wait, and web_fetch; a lead's without the web, weighed
      // here with no hands, carries none.
      const v98 = (/** @type {any[]} */ set) => (/** @type {any} */ (args).lead && !(/** @type {any} */ (args).web?.fetch) ? set : asV98Tools(set));
      // And every set as version 99 had its agent tool or a lead's worker tool, before an apply that overlaps the folder's
      // edits offered a way on, overlap beside apply_changes (asV99Tools); and the agent's own sets as version 102 had its
      // agent tool's agent_id, before a follow-up to one at work went as a message (asV102Tools, first of all).
      const v102 = (/** @type {any[]} */ set) => (/** @type {any} */ (args).lead ? set : asV102Tools(set));
      // And a lead's sets as version 104 had its agent tool, before it said a worker's report may wait sealed (asV104Tools,
      // the bug hunt of 11-08, first of all).
      const v104 = (/** @type {any[]} */ set) => (/** @type {any} */ (args).lead ? asV104Tools(set) : set);
      // And every set with the plan tool as version 111 had it, before its one doing at a time (asV111Tools, a spinner
      // says work goes on, the owner's of 11-10, first of all).
      const v111 = (/** @type {any[]} */ set) => (/** @type {any} */ (args).disabled?.includes("plan") ? set : asV111Tools(set));
      // And the agent's own sets as version 116 had its agent tool, before it named thread among what a sub-agent goes
      // without (asV116Tools, th3, first of all).
      const v116 = (/** @type {any[]} */ set) => (/** @type {any} */ (args).lead ? set : asV116Tools(set));
      assert.equal(sha(own(asV43(asV38(asV37(v52(asV72Tools(v73(asV75Tools(roster(web(asV79Tools(v91(asV93Tools(v94(v95(v96(v98(asV99Tools(asV101Tools(v102(v104(asV109Tools(v111(v116(loopToolArgs(noVisuals(args))))))))))))))))))))))))))), hash, JSON.stringify(args));
      assert.equal(sha(own(asV43(asV38(asV37(v52(asV72Tools(v73(asV75Tools(roster(web(asV79Tools(v91(asV93Tools(v94(v95(v96(v98(asV99Tools(asV101Tools(v102(v104(asV109Tools(v111(v116(loopToolArgs({ ...noVisuals(args), graph: false })))))))))))))))))))))))))), hash);
      assert.deepEqual(loopToolArgs(/** @type {any} */ (args)).filter((t) => t.name !== "visual_guide" && t.name !== "show_visual" && t.name !== "artifact" && t.name !== "space" && t.name !== "team" && t.name !== "flow" && t.name !== "thread"), loopToolArgs(noVisuals(args)), "the visuals, the artifact tool, the Space's, the team tool, the flow tool and the thread tool add themselves and move nothing");
    }
    const prompts = [
      [{ root: "/p", delegateRead: false }, "2a83fdd7aec842553565abeb1048fb8c563722ce0e2b430339fdf5431b6f428c"],
      [{ root: "/p", delegateRead: true, web: { fetch: true, search: true }, mcp: [{ name: "docs", tools: 2 }], environment: "# Environment\nx" }, "ef13e885b2c9d30755c8870696ebc0bc5621a692e3b7bab6b5be4840cd7ee25e"],
      [{ root: "/p", delegateRead: false, toolsOff: ["plan", "ask"] }, "01f9fd7ebf9ad598ddb294946beb245bdc63df23ec230ca66e79449283e1f6a6"],
      [{ root: "/p", delegateRead: false, lead: { name: "Architect", persona: "You lead." } }, "64bd2024269ef08189def2fd16e1f07893a6305bed2b911dac2d598ba1fe6914"],
      [{ root: "/p", delegateRead: false, subagent: true, toolsOff: ["ask", "plan", "agent", "wait"] }, "61a3d83d03380d21c8eab6237a96da87c581cb31c58ee931f59781694e6531c2"],
    ];
    for (const [args, hash] of prompts) {
      // Each weighed without version 55's line on reads side by side (asV54Prompt); the agent's own with its three ways
      // its sub-agents pay naming the cards that shipped before the roster shrink (asOldRoster), and with the session's
      // count version 87 took from its agent line (asV86Prompt); all but a sub-agent's, and one with no plan tool, with its
      // planning words as version 97 had them (asV97Prompt, the owner's of 11-08); the agent's own with its line on the agent
      // tool as version 98 had it (asV98Prompt); a lead's with its agent line as version 104 had it, before it said a
      // worker's report may wait sealed (asV104Prompt, the bug hunt of 11-08); the agent's own with that line as version 116
      // had it, before it named thread (asV116Prompt, th3, first of all).
      const as = (/** @type {string} */ s) => (/** @type {any} */ (args).subagent ? asV42(asV54Prompt(s)) : /** @type {any} */ (args).lead ? asV54Prompt(asV76Prompt(asV97Prompt(asV102Prompt(asV104Prompt(s))))) : asV52Prompt(asV54Prompt(asOldRoster(asV86Prompt(asV96Prompt(/** @type {any} */ (args).toolsOff?.includes("plan") ? asV98Prompt(asV116Prompt(s)) : asV97Prompt(asV98Prompt(asV116Prompt(s)))))))));
      assert.equal(sha(as(systemPromptFor(/** @type {any} */ (args)))), hash, JSON.stringify(args));
      assert.equal(sha(as(systemPromptFor({ .../** @type {any} */ (args), graph: false }))), hash);
    }
    assert.equal(sha(asV36(asV76Prompt(asV97Prompt(asV102Prompt(asV104Prompt(systemPromptFor({ root: "/p", delegateRead: false, lead: { name: "Architect", persona: "You lead." } }))))))), "1966dff04720be2448eb3cb3735f39789e8a8123118bc1934847b84edcdfdade", "version 36's, but for a lead's own hands");
  });

  // (fails before: yes — the prompt had no graph section)
  test("with the graph, the prompt gains its section and the checklist's line names the choice; version 15, 16 since G2, 17 since G3, 18 since FailurePoints step 5, 24 since the lead reads along, 25 since it answers a worker's call, 26 since a team briefs, checks and answers as a real team does, 27 since a lead looks when something is new and reviews plans, 29 since a lead plans the whole work first and every worker of its team may ask it, 30 since a look holds no worker's thinking, 31 since a lead may launch a brief as attempts, 32 since a model that takes no tools told why it has none (HarnessV4_Tasks E4), 33 since a task's check Filament runs itself (V2-1), 36 since the agent's checklist is on its graph (V2-5), 69 since the graph is always on and its words name no switch", () => {
    assert.equal(PROMPT_VERSION, 129);
    const off = systemPromptFor({ root: "/p", delegateRead: false });
    const on = systemPromptFor({ root: "/p", delegateRead: false, graph: true });
    assert.ok(off.includes(PROMPT.plan) && !on.includes(PROMPT.plan), "the checklist's line gives way to the one that puts it on the graph");
    assert.ok(on.includes(PROMPT.planOnGraph) && !on.includes(PROMPT.planOrGraph));
    assert.equal(on, off.replace(PROMPT.plan, PROMPT.planOnGraph).replace(`\n\n${PROMPT.headCare}`, `\n\n${PROMPT.headGraph}\n${PROMPT.graph}\n${PROMPT.graphSubagents}\n\n${PROMPT.headCare}`), "the section follows the tools; nothing else moves");
    assert.match(PROMPT.graph, /Your checklist is on your task graph: each item you give the plan tool is a task of yours there/);
    assert.match(PROMPT.graph, /Beyond your checklist, work that branches goes on it, its steps as sub-tasks under a step; nothing else has to\./);
    // With plan switched off the section stands alone; a lead gets it beside its own tools.
    const noPlan = systemPromptFor({ root: "/p", delegateRead: false, toolsOff: ["plan"], graph: true });
    assert.ok(!noPlan.includes(PROMPT.planOnGraph) && !noPlan.includes(PROMPT.planOrGraph) && noPlan.includes(PROMPT.graph));
    const lead = systemPromptFor({ root: "/p", delegateRead: false, lead: { name: "Architect", persona: "You lead." }, graph: true });
    assert.ok(lead.includes(`${PROMPT.headGraph}\n${PROMPT.leadGraph}`) && lead.includes(PROMPT.planOrGraph));
  });
});

describe("the loop runs tasks against the session's graph", () => {
  const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } };
  const answer = (/** @type {any[]} */ content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
  const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
  /** The tool results in the request's newest message. @param {any[]} msgs */
  const lastResults = (msgs) => (Array.isArray(msgs.at(-1)?.content) ? msgs.at(-1).content.filter((/** @type {any} */ c) => c?.type === "tool_result") : []);
  /** A graph the way turn.js keeps one: every change kept, the view handed back. */
  const store = () => {
    /** @type {any} */
    let graph = null;
    let at = 100;
    return {
      get: () => graph,
      apply: (/** @type {any} */ input) => {
        const r = applyTasks(graph, input, { at: at++, crew: "agent" });
        if (!r.ok) return r;
        graph = r.graph;
        return { ok: true, text: r.text, view: graphView(r.graph), changed: r.changed };
      },
      check: () => null,
      open: () => null,
    };
  };
  /** @param {any[][]} replies @param {any} graph @param {any[]} events */
  const run = (replies, graph, events) => {
    let n = 0;
    /** @type {any[][]} */
    const seen = [];
    const out = runAgentTurn(/** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
      model: "m",
      messages: [{ role: "user", content: "plan it" }],
      system: "s",
      tools: loopToolArgs({ graph: !!graph }),
      modeNow: () => "edit",
      root: tmpdir(),
      readerModel: "",
      maxTokens: 100,
      call: async (/** @type {any} */ { body }) => {
        seen.push(lastResults(body.messages));
        return answer(replies[n++] || [{ type: "text", text: "Planned." }]);
      },
      costOf: () => 0,
      runHand: async () => {
        throw new Error("no hand runs here");
      },
      delegateRead: null,
      graph,
      mailbox: { read: () => [] },
      permissions: null,
      tree: null,
      onEvent: (/** @type {any} */ e) => events.push(e),
      previewChars: 0,
      sink,
      signal: null,
      resume: null,
    }));
    return { out, seen };
  };

  // (fails before: yes — the loop had no tasks branch: a tasks call was "not available")
  test("a tasks call: its words are the result, a refusal is an error in its words, and each change goes out as a graph event", async () => {
    const g = store();
    /** @type {any[]} */
    const events = [];
    const { out, seen } = run(
      [
        [toolUse("a1", "tasks", { action: "add", goal: "Ship it", tasks: [{ id: "t1", name: "Map it", needs: [] }, { id: "t2", name: "Fix it", needs: ["t1"] }] }), toolUse("a2", "tasks", { action: "start", ids: ["t2"] })],
        [toolUse("a3", "tasks", { action: "show" }), toolUse("a4", "tasks", { action: "start", ids: ["t1"] })],
      ],
      g,
      events,
    );
    const r = await out;
    assert.equal(r.status, "done");
    assert.equal(seen[1][0].content, "Added t1, t2. 0 of 2 done · ready: t1. Critical path still to go: t1 → t2.");
    assert.notEqual(seen[1][0].is_error, true);
    assert.equal(seen[1][1].is_error, true, "a refusal is an error the model reads");
    assert.match(String(seen[1][1].content), /t2 can't start yet: it needs t1 \(waiting\) done first/);
    assert.match(String(seen[2][0].content), /^The task graph — Ship it\n/);
    assert.equal(seen[2][1].content, "Started t1: yours, so you do it now. 0 of 2 done · running: t1.");
    const graphs = events.filter((e) => e.type === "graph");
    assert.deepEqual(graphs.map((e) => [e.round, e.graph.tasks.map((/** @type {any} */ t) => t.state).join(",")]), [[1, "waiting,waiting"], [2, "running,waiting"]], "only the changes: the refusal and show send none");
    assert.deepEqual(graphs[1].graph, graphView(g.get()));
    const cards = events.filter((e) => e.type === "tool-start" && e.name === "tasks").map((e) => e.args);
    assert.deepEqual(cards, ["add 2 tasks", "start t2", "show", "start t1"]);
  });

  // (fails before: yes — tasks was no loop tool: its call was answered unavailable with nothing said on the record)
  test("with no graph, a tasks call is answered as a tool not offered here, and nothing is kept", async () => {
    /** @type {any[]} */
    const events = [];
    const { out, seen } = run([[toolUse("a1", "tasks", { action: "show" })]], null, events);
    const r = await out;
    assert.equal(r.status, "done");
    assert.equal(seen[1][0].content, "That tool is not available here; use the tools you were given or answer in text.");
    assert.ok(r.notes.includes("agent: tasks was called but is not offered in this session"), r.notes.join("\n"));
    assert.equal(events.filter((e) => e.type === "graph").length, 0);
  });

  // (fails before: yes — a fold inside the turn brought back the files and the plan, never the graph)
  test("a fold inside the turn brings the graph back after its summary, as it stood, while it has open tasks", async () => {
    const g = store();
    /** @type {any[]} */
    const events = [];
    /** @type {any[]} */
    const bodies = [];
    /** @type {(string | null)[]} */
    const opened = [];
    let n = 0;
    let asked = false;
    const replies = [
      [toolUse("a1", "tasks", { action: "add", goal: "Ship it", tasks: [{ id: "t1", name: "Map it" }, { id: "t2", name: "Fix it", needs: ["t1"] }] })],
      [toolUse("a2", "tasks", { action: "start", id: "t1" })],
    ];
    const out = await runAgentTurn(/** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
      model: "m",
      messages: [{ role: "user", content: "plan it" }],
      system: "s",
      tools: loopToolArgs({ graph: true }),
      modeNow: () => "edit",
      root: tmpdir(),
      readerModel: "",
      maxTokens: 100,
      call: async (/** @type {any} */ { body }) => {
        bodies.push(structuredClone(body));
        return answer(replies[n++] || [{ type: "text", text: "Planned." }]);
      },
      costOf: () => 0,
      runHand: async () => {
        throw new Error("no hand runs here");
      },
      delegateRead: null,
      // The developer's Compact, taken once both rounds are in: the older one folds, the newest stays whole.
      compact: {
        usable: 1e9,
        target: 0,
        window: 1e9,
        source: null,
        fixed: 0,
        summarize: async () => ({ text: "SUMMARY OF ROUND 1", by: "m" }),
        reattach: (/** @type {any} */ o) => reattachBlock({ ...o, root: "", rules: [], redact: null, window: 200_000 }),
      },
      graph: {
        apply: g.apply,
        check: g.check,
        open: () => {
          opened.push(openGraphText(g.get(), "agent"));
          return opened.at(-1) ?? null;
        },
      },
      mailbox: { read: () => (n === 2 && !asked ? ((asked = true), [{ kind: "compact", text: "", from: "harness" }]) : []) },
      permissions: null,
      tree: null,
      onEvent: (/** @type {any} */ e) => events.push(e),
      previewChars: 0,
      sink,
      signal: null,
      resume: null,
    }));
    assert.equal(out.status, "done");
    assert.equal(opened.length, 1, "the fold asked for the graph once");
    const text = /** @type {string} */ (opened[0]);
    assert.match(text, /^The task graph — Ship it\n/);
    const head = bodies[2].messages.find((/** @type {any} */ m) => m.role === "user" && /^\[Filament compacted round/.test(String(m.content?.[0]?.text || "")));
    assert.equal(head?.content?.[1]?.text, `[Filament brought these back after the summary: the task graph as it stood.]\n\n<tasks>\n${text}\n</tasks>`);
    const comp = events.find((e) => e.type === "compaction");
    assert.deepEqual(comp?.attached, { shown: 0, named: 0, plan: false, graph: true });
  });
});
