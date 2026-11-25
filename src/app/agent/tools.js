// @ts-check
// The agent loop's toolset and its permission gate. The hands come from hands.js byte for byte; `ask`, `plan`,
// `agent`, `wait` and `delegate_read` are the loop's own, with `visual_guide` and `show_visual` (visuals.js) and
// `artifact` (artifacts.js), and a team's lead (HarnessV3-AtHome P2) has its own `agent`,
// `worker` and `wait`. Every offered set is a frozen module constant chosen once per configuration
// (whether delegated reads are available, the session's switches) — never by the permission mode, which the gate
// enforces at call time — so the tool bytes never drift between ticks or turns; a tool array that changes is the
// classic silent prompt-cache killer.
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { HAND_TOOLS, isHandTool, isCommandHand, editsIn } from "../../adapters/tools/hands.js";
import { WEB_FETCH_TOOL, WEB_SEARCH_TOOL, isWebTool } from "../../adapters/tools/web-hands.js";
import { isMcpTool } from "../../adapters/tools/mcp-client.js";
import { MCP_DOOR } from "../../core/mcp-door.js";
import { SKILL_TOOL_NAME } from "./skills.js";
import { recallToolDef } from "../memory-tools.js";
import { clip, durationWords } from "../../core/text.js";
import { COMMAND, LEAD_ACTIONS, MAX_ITEMS, PLAN_DEPTHS, READS_ACTIONS, REPORT_STATUSES, TASK_ACTIONS, TASK_BY, asMeant } from "../../core/task-graph.js";
import { redactAndCap, redactSecrets } from "../../core/redact.js";
import { SHIPPED_MEMBERS } from "../../core/roster.js";
import { SUBAGENT_VIEWS } from "../../services/session-settings.js";
import { SUBAGENT_EFFORTS } from "../../core/schema.js";
import { OWN_WORKERS, SHIPPED_CARDS } from "../../services/agent-cards.js";
import { TOOL_TEXT, TEAM_TEXT, PERMISSION_MODES, LEAD_HANDS } from "./prompt.js";
import { SHIPPED_ROSTER_WORDS, rosterKey, rosterWords } from "./roster-words.js";
import { describeRule, denialText, searchesOf } from "./rules.js";
import { CHECK_MAX } from "./grants.js";
import { capPatch, lineDiff, unifiedPatch } from "../acp-render.js";
import { envelopeSummary } from "./envelopes.js";
import { canonicalOf, lspSubject } from "../../core/tool-vocab.js";
import { SHOW_VISUAL, SHOW_VISUAL_TOOL, VISUAL_GUIDE, VISUAL_GUIDE_TOOL } from "./visuals.js";
import { ARTIFACT, ARTIFACT_TOOL } from "./artifacts.js";
import { SPACE, SPACE_TOOL } from "./space.js";
import { draftWhere, spaceFields } from "../../core/space.js";
import { besideAction } from "../../core/beside.js";
import { BESIDE_TEAM, BESIDE_TOOL } from "./beside-tool.js";
import { FLOW_NAME, FLOW_TOOL } from "./flow-tool.js";
import { THREAD, THREAD_TOOL } from "./thread-tool.js";
import { CRAFT_NAME, CRAFT_TOOL } from "./craft-tool.js";
import { COME_BACK, COME_BACK_TOOL } from "./come-back.js";
import { RUN_CHECK, RUN_CHECK_TOOL } from "./run-check.js";
import { MCP_RESOURCES } from "./mcp-resources.js";
import { BROWSER, BROWSER_TOOL } from "./browser-tool.js";
import { LSP, LSP_TOOL } from "./lsp-tool.js";
import { linkRisk, linkWords } from "./link-guard.js";
import { actingSteps, browserArgWords } from "../../core/browser.js";

/** @typedef {import("./prompt.js").PermissionMode} PermissionMode */

export const ASK_TOOL = Object.freeze({
  name: "ask",
  description: TOOL_TEXT.ask,
  input_schema: {
    type: "object",
    required: ["question"],
    properties: {
      question: {
        type: "string",
        description: "The question as chat text, with your recommendation.",
      },
      options: {
        type: "array",
        minItems: 2,
        maxItems: 4,
        description:
          "When the answer is one of a few: 2–4 choices the developer can pick with one click. Put your recommendation first and end its label with \"(recommended)\". They can always answer in their own words instead.",
        items: {
          type: "object",
          required: ["label"],
          properties: {
            label: { type: "string", description: "1–5 words: the answer as the developer would pick it." },
            description: { type: "string", description: "What choosing it means: the trade-off, or what happens next." },
          },
        },
      },
    },
  },
});

/** The most choices a question offers (TL-D11); fewer than two is no choice. */
const ASK_OPTIONS_MAX = 4;

/**
 * An `ask` call read the one way the loop, its reply and the transcript read it (HarnessV3-Tools TL-D11): the question,
 * and its choices — each a label and what choosing it means, whitespace squashed, labels unique (case-blind), at most
 * four, a bare string taken as a label. None at all when fewer than two are left: one is no choice.
 * @param {any} input
 * @returns {{ question: string, options: { label: string, description: string }[] }}
 */
export function askOf(input) {
  const question = String(input?.question || "").trim() || "(the model asked a question without text)";
  /** @type {{ label: string, description: string }[]} */
  const options = [];
  const seen = new Set();
  for (const o of Array.isArray(input?.options) ? input.options : []) {
    const label = clip(typeof o === "string" ? o : String(o?.label ?? ""), 80);
    if (!label || seen.has(label.toLowerCase()) || options.length === ASK_OPTIONS_MAX) continue;
    seen.add(label.toLowerCase());
    options.push({ label, description: typeof o === "string" ? "" : clip(String(o?.description ?? ""), 300) });
  }
  return { question, options: options.length >= 2 ? options : [] };
}

/**
 * The reply a question ends its turn with: what every client reads, and the archive keeps. The choices are numbered
 * under it — the harness draws them as rows; any other client's developer types one, or their own words.
 * @param {{ question: string, options: { label: string, description: string }[] }} ask
 */
export const askText = ({ question, options }) =>
  options.length
    ? `${question}\n\n${options.map((o, i) => `${i + 1}. ${o.label}${o.description ? ` — ${o.description}` : ""}`).join("\n")}\n\nAnswer with one of these, or in your own words.`
    : question;
export const PLAN_TOOL = Object.freeze({
  name: "plan",
  description: TOOL_TEXT.plan,
  input_schema: {
    type: "object",
    required: ["items"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          required: ["text", "status"],
          properties: {
            text: { type: "string", description: "One checklist item, in the developer's language." },
            status: { type: "string", enum: ["pending", "doing", "done", "blocked"] },
          },
        },
      },
      // The task the list is the steps of (core/task-graph.js `stepsTask`): named, nothing is worked out.
      task: { type: "string", description: "The id of a running task you added with the tasks tool: these items are its steps, not tasks of their own." },
    },
  },
});
/**
 * Filament's checklist as a coding agent is offered it, over Filament's MCP server (the owner's tool plan of 11-08): the
 * loop's plan, called by its own name there, which no /plan, plan mode or Plan page shares, in place of the agent's own
 * todo tool. A call draws the same Todo card.
 */
export const CODER_CHECKLIST_TOOL = Object.freeze({ name: "checklist", description: TOOL_TEXT.coderChecklist, input_schema: PLAN_TOOL.input_schema });
/**
 * The loop's line for work of more than one step kept on neither a checklist nor a graph (loop.js `UNPLANNED_LINE`), for a
 * coding agent, by the names its tools have: Filament's checklist and tasks (acp-turn.js `unplannedAt`).
 */
export const CODER_UNPLANNED_LINE = "[Filament: this work has more than one step — you changed a second file, and keep neither a checklist nor a task graph. Before you go on, put its steps on Filament's checklist, or, where the work branches, on your task graph with Filament's tasks tool.]";
const CHECKLIST_STATUSES = new Set(["pending", "doing", "done", "blocked"]);
/** The task a plan or a checklist call names as the one its items are the steps of (`task`): "" where it names none. @param {any} input */
export const stepsTaskOf = (input) => (typeof input?.task === "string" ? input.task.trim() : "");
/**
 * A checklist call read as the loop reads its plan's: each item's text and status, a status it does not know pending,
 * and the task it names (`stepsTaskOf`).
 * @param {any} input @returns {{ ok: true, items: { text: string, status: string }[], task: string, text: string } | { ok: false, error: string }}
 */
export function checklistOf(input) {
  const items = Array.isArray(input?.items) ? input.items : null;
  if (!items) return { ok: false, error: "checklist needs items: [{ text, status }]" };
  const list = items.map((it) => ({ text: String(it?.text || ""), status: CHECKLIST_STATUSES.has(String(it?.status)) ? String(it.status) : "pending" }));
  return { ok: true, items: list, task: stepsTaskOf(input), text: `Checklist recorded: ${list.length} item${list.length === 1 ? "" : "s"} (${list.filter((p) => p.status === "done").length} done).` };
}
/** A coding agent's tasks actions, said at its action field, where it picks one (the owner's tool plan of 11-08). */
const CODER_ACTIONS =
  "add: new tasks, with goal when the add starts a graph. start: tasks whose needs are done, as work on each begins; several at once only where sub-agents or commands work them meanwhile. pause: leave a running task with a checkpoint, handed back whole when you start it again. done: a finished task, with summary, and evidence where it has acceptance and no check. change: fields of tasks not yet finished, or the goal. drop: tasks, with the reason. close: the graph, with its outcome. show: the graph, or one task. keep: a note, files or a picture kept on disk behind a task or the graph, so a compaction loses none; forget takes them away. read: what is kept: a note or a text file in parts, an image as an image. find: the lines of the tasks and of what is kept behind them that hold every word. offer: a card asking the person whether to plan first; then end your reply. parallel: two or more ready tasks you judge truly independent, suggested to the person on a card whose Accept starts each on a sub-agent.";
/**
 * The task graph's tool (HarnessV3-TaskGraph), offered to the session's own agent or its team's lead, in the words of
 * whoever plans (`crew`): the agent's tasks name who does each — the agent, a sub-agent or an explorer —
 * with its goal and steps, and a send-back its note and whether a new worker takes it (G2, HarnessV3-FailurePoints §6);
 * a team's lead's name its worker's role, a writer's may ask for a review, and a failed one's change may merge as it
 * stands (G3). A coding agent's (`solo`, HarnessV3-ACP AC4-5) are all its own: who does a task, its goal and steps,
 * and a send-back's note are none of its fields. `reads`: the agent reads along with its graph's sub-agents
 * (HarnessV3-TaskGraph-v2 TG2-D20), and has `note`: a line to the one working on a task now. `team`: a lead plans,
 * and a task's `by` is one of its team's members, by tag, in the words written for them (roster-words.js) — a team
 * no member of which reviews has no `review` field. Under the agent and a lead alike a task may be Filament's own (V2-3):
 * by command, with its run and items — never a coding agent's. Under every planner a task may name the open thread of
 * memory it finishes (HarnessV4_GraphThreads E28): its done closes it; and the Hunter whose finding it takes up
 * (`found_by`, 11-02): it hangs off the task the hunt was fired from.
 * @param {string} description @param {{ tags: readonly string[], words: Readonly<import("./roster-words.js").RosterWords> } | null} team
 * @param {boolean} [solo] @param {boolean} [reads]
 */
const tasksTool = (description, team, solo = false, reads = false) => {
  return Object.freeze({
    name: "tasks",
    description,
    input_schema: {
      type: "object",
      required: ["action"],
      properties: {
        // A coding agent's actions are said here, where it picks one (the owner's tool plan of 11-08); the agent's and a
        // lead's tool text says them.
        action: { type: "string", enum: [...(team ? LEAD_ACTIONS : reads ? READS_ACTIONS : TASK_ACTIONS)], ...(solo ? { description: CODER_ACTIONS } : {}) },
        goal: { type: "string", description: "add: what the work is for, in a sentence; required when the add starts a graph. change: the goal restated." },
        tasks: {
          type: "array",
          description: solo ? "add: the new tasks. change: each an id and the fields that change; a running task's needs too. done, start and drop: several in one call, each an id with its own summary and evidence, note or reason." : "add: the new tasks. change: each an id and the fields that change. done, start and drop: several in one call, each an id with its own summary and evidence, note or reason.",
          items: {
            type: "object",
            required: ["id"],
            properties: {
              id: { type: "string", description: "Your own short id: a letter, then letters, digits, - or _ (t1, parser-fix)." },
              name: { type: "string", description: "A few words naming the task." },
              needs: { type: "array", items: { type: "string" }, description: "The ids of the tasks it builds on: it starts once they are done." },
              writes: { type: "array", items: { type: "string" }, description: solo ? "The files or globs it changes, relative to the working folder. Two tasks that could run at once may write the same file." : "The files or globs it changes, relative to the working folder." },
              // An add's new task's (g1): the existing tasks that need it from now, checked with the add as one graph.
              needed_by: { type: "array", items: { type: "string" }, description: "add: the ids of existing tasks that then need this new one." },
              acceptance: { type: "string", description: "What shows it done." },
              check: {
                type: "array",
                items: { type: "string" },
                maxItems: 5,
                description: solo
                  ? "One to five commands that prove it done; Filament runs them in a copy of the folder once you mark it done, so done means they passed. [] takes it away."
                  : team
                    ? "One to five commands that prove it done, which Filament runs itself in its worker's worktree once it reports, before its change goes in. Only for a worker that changes files; [] takes it away."
                    : "One to five commands that prove it done, which Filament runs itself: a sub-agent's in its worktree once it reports, before its change goes in; yours in a copy of your folder once you mark it done. Only for a task whose change is kept (yours or a sub-agent's); [] takes it away.",
              },
              ...(solo
                ? {
                    // Its own task's brief, should the person run it side by side (FabeleHelper's of 11-10).
                    goal: { type: "string", description: "What must be true when it is done: with steps, the brief of a sub-agent should it run side by side." },
                    steps: { type: "array", items: { type: "string" }, description: "What to do, in order: one step per item, at most 20. A task you suggest to run side by side (parallel) needs them." },
                  }
                : team
                ? {
                    by: { type: "string", enum: [...team.tags, COMMAND], description: `${team.words.byField} Or command: Filament runs the task's run itself (no model, no worker) once for each item, several at once; for mechanical work such as a mutation pass, test shards, a typecheck or builds.` },
                    goal: { type: "string", description: "What must be true when it is done." },
                    steps: { type: "array", items: { type: "string" }, description: "What to do, in order: one step per item, at most 20." },
                    ...(team.words.reviewTaskField ? { review: { type: "boolean", description: team.words.reviewTaskField } } : {}),
                  }
                : {
                    by: { type: "string", enum: [...TASK_BY, COMMAND], description: "Who does it: you (the default), a sub-agent (it changes the files in writes), an explorer (it reads and reports, with no tests and no builds, and names no writes), or command: Filament runs its run itself (no model) once for each item, several at once; for mechanical work such as a mutation pass, test shards, a typecheck or builds." },
                    goal: { type: "string", description: "A sub-agent's or an explorer's task: what must be true when it is done." },
                    steps: { type: "array", items: { type: "string" }, description: "A sub-agent's or an explorer's task: what to do, in order: one step per item, at most 20." },
                  }),
              ...(solo
                ? {}
                : {
                    run: { type: "array", items: { type: "string" }, maxItems: 5, description: "by command: one to five commands, in order, which Filament runs itself in a copy of the folder, once for each item, {item} filled in. A run passes when each command exits 0; one that starts \"! \" passes when it fails. Filament puts no clock on a run: a command that may hang carries its own limit." },
                    items: { type: "array", items: { type: "string" }, maxItems: MAX_ITEMS, description: "by command: what fills {item} in run, one run each, up to 500, each one plain word (letters, digits and . _ - / : @ + = ,): mutant ids, test files, build targets." },
                  }),
              thread: { type: "string", description: "The open memory thread this task finishes, by its id (i98): once the task is done, Filament closes the thread with the task's summary. \"\" takes it away." },
              found_by: { type: "string", description: "The bug hunt whose finding this task takes up, by the id its report gives (sa_4ff20533): the task then needs the task the hunt was sent from, and the Plan page marks it as that hunt's finding. \"\" takes the mark away." },
              // A step's sub-task (the owner's plan mode of 11-06): the agent's and a coding agent's, never a lead's.
              ...(team ? {} : { under: { type: "string", description: "The step this task is a sub-task of, by its id (one level): it starts after the step's needs; the step takes no check and is done once its sub-tasks are. Lay out steps first, then add each step's sub-tasks as you reach it. \"\" takes it out." } }),
            },
          },
        },
        ids: { type: "array", items: { type: "string" }, description: solo ? "start: tasks whose needs are done, as work on each begins (several at once only where sub-agents or commands work them meanwhile), or done ones to reopen. drop: the tasks; one another needs loses that need. parallel: the ready tasks you suggest to run at once." : team ? "start, drop: the tasks." : "start, drop, parallel: the tasks." },
        id: { type: "string", description: solo ? "pause: the running task you leave on purpose. done: the task that is done. show: one task whole (left out: the graph). keep, read: the task it is kept behind (left out: the graph itself). find: the one task to look in (left out: all)." : `${team ?"merge: the failed task whose change goes in as it stands. done: the task that is done. show: one task whole (leave it out for the whole graph)." : reads ? "pause: your running task you leave on purpose. done: the task that is done. note: the task whose sub-agent reads your note. show: one task whole (leave it out for the whole graph)." : "pause: your running task you leave on purpose. done: the task that is done. show: one task whole (leave it out for the whole graph)."} keep, read: the task it is kept behind (leave it out for the graph itself). find: the one task to look in (leave it out for all).` },
        words: { type: "string", description: "find: what to look for; each line found holds every word and says where it is." },
        // A plan offered on a card under the reply (the owner's plan mode of 11-06): the agent's and a coding agent's.
        ...(team
          ? {}
          : {
              depth: { type: "string", enum: [...PLAN_DEPTHS], description: "offer: the plan you suggest: light (a few tasks, a line each), standard (each task with its needs, writes and check) or deep (the code mapped widely first, the ways weighed). The person chooses on the card." },
              side_by_side: { type: "boolean", description: "offer: whether you suggest its tasks run in parallel, each on a sub-agent." },
            }),
        title: { type: "string", description: "keep: the note's title, which you read it back by; a note of the same title is replaced. read: a note's title or a file's name (left out: the list of what is kept)." },
        text: { type: "string", description: "keep: the note's words, whole, up to 200,000 characters." },
        files: { type: "array", items: { type: "string" }, maxItems: 20, description: "keep: paths of files to copy in (a screenshot, a document, any file up to 10 MB) from your folder or the folders you may work in." },
        picture: { type: "string", description: "keep: a picture an agent of this chat drew, by its name as its report gives it: its code is kept as a file." },
        forget: { type: "array", items: { type: "string" }, description: "keep: the titles of notes, or the names of files, to take away." },
        from: { type: "integer", minimum: 0, description: "read: where a long note's or text file's next part starts, as its last part said." },
        summary: { type: "string", description: "done: what was done, in a line or two." },
        evidence: { type: "string", description: "done: what shows its acceptance holds (a test's output, a command you ran, what you saw). Needed where the task has acceptance and no check." },
        // A lead plans and pauses nothing of its own (E41 P1): its tasks are its workers'.
        ...(team ? {} : { checkpoint: { type: "string", description: "pause: where the task stands (what is done, what is next, what to re-read on the way back), kept behind it and handed back whole when you start it again. Up to 200,000 characters." } }),
        reason: { type: "string", description: team ? "drop: why the tasks go. close: the outcome, in a sentence. merge: why its change goes in as it stands." : "drop: why the tasks go. close: the outcome, in a sentence." },
        ...(solo
          ? {}
          : {
              note: { type: "string", description: team ? "start, sending a failed task back or starting one the developer stopped again: a note for its worker, what to do differently." : reads ? "note: your line to the sub-agent working on the task now: what to do instead, and why. start, sending a failed sub-agent's task back or starting one the developer stopped again: a note for its sub-agent, what to do differently." : "start, sending a failed sub-agent's task back or starting one the developer stopped again: a note for its sub-agent, what to do differently." },
              fresh: { type: "boolean", description: team ? "start, sending a failed task back or starting one the developer stopped again: true for a new worker, which starts from the folder as it stands with the earlier try in its brief. Left out, the task's last worker goes on where it stopped, in its own conversation." : "start, sending a failed sub-agent's task back or starting one the developer stopped again: true for a new sub-agent, which starts from your folder as it stands with the earlier try in its brief. Left out, the task's last sub-agent goes on where it stopped, in its own conversation." },
            }),
      },
    },
  });
};
/** The agent's tasks: who does each task, the agent or a sub-agent Filament starts (G2). */
export const TASKS_TOOL = tasksTool(TOOL_TEXT.tasks, null);
/** The agent's tasks when it reads along with its graph's sub-agents (V2-0c): `note` reaches the one working on a task. */
export const TASKS_READS_TOOL = tasksTool(TOOL_TEXT.tasksReads, null, false, true);
/** A team's lead's tasks: each names the member that does it, whose worker Filament starts (G3) — here the four that ship. */
export const LEAD_TASKS_TOOL = tasksTool(TOOL_TEXT.leadTasks, { tags: SHIPPED_MEMBERS, words: SHIPPED_ROSTER_WORDS });
/** A coding agent's tasks, over Filament's MCP server (HarnessV3-ACP AC4-5): all its own. */
export const CODER_TASKS_TOOL = tasksTool(TOOL_TEXT.coderTasks, null, true);
/** The report that ends a graph task's sub-agent (HarnessV3-TaskGraph G2-4) — a team's worker, a reviewer (G3) —
 *  offered to that sub-agent alone. */
export const REPORT_TOOL = Object.freeze({
  name: "report",
  description: TOOL_TEXT.report,
  input_schema: {
    type: "object",
    required: ["status", "did", "met", "evidence"],
    properties: {
      status: { type: "string", enum: [...REPORT_STATUSES], description: "done: the goal is met and the acceptance check passes. blocked: something outside your task stops you; say what in left. failed: you could not do it." },
      did: { type: "string", description: "What you did, whole (for a task that changes nothing, what you found): your report is read, not your work." },
      met: { type: "boolean", description: "Whether the acceptance check passed." },
      evidence: { type: "string", description: "The check you ran and what it showed." },
      left: { type: "string", description: "What is left, if anything." },
      // A writing task with no check takes these as its check (HarnessV3-TaskGraph-v2 TG2-D63).
      checked: { type: "array", items: { type: "string" }, maxItems: 5, description: "Only where your task changes files and has no check: one to five commands that prove it done, each exactly as you ran it. Filament runs them again in your worktree as the task's check." },
    },
  },
});
/**
 * A team's worker asks its lead (HarnessV3-TaskGraph-v2 TG2-D49, TG2-D58): offered to every team's worker, whether its
 * lead reads along or not. The call waits in place for the answer. `plan` carries its plan while its lead reviews it
 * (TG2-D50), three minutes at most: a call takes a question or a plan, so neither is required alone.
 */
export const ASK_LEAD_TOOL = Object.freeze({
  name: "ask_lead",
  description: TOOL_TEXT.askLead,
  input_schema: {
    type: "object",
    properties: {
      question: { type: "string", description: "The choice your brief leaves open, or the problem you are stuck on: what you found or tried, and why it changes the result." },
      options: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" }, description: "The ways you see, your pick first: the one you go on with if no answer comes." },
      plan: { type: "string", description: "Only while your lead reviews your plan: the plan itself (the files you will change, the steps in order, how you will prove it done), alone, without question or options. Your lead's go to it lets your changes and commands run." },
    },
  },
});
/** The same over Filament's MCP server, for a coding agent's worker: its call holds within its client's patience, and
 *  `ask` alone waits again for the question it names. */
export const ASK_LEAD_OWN_TOOL = Object.freeze({
  name: "ask_lead",
  description: TOOL_TEXT.askLeadOwn,
  input_schema: {
    type: "object",
    properties: {
      ...ASK_LEAD_TOOL.input_schema.properties,
      ask: { type: "integer", minimum: 1, description: "Alone: the number of a question you already asked, to go on waiting for its answer. Not the question's words." },
    },
  },
});
/** The most ways a question to the lead names, and the fewest that are a choice. */
const LEAD_OPTIONS = Object.freeze({ min: 2, max: 4 });
/**
 * An ask_lead call read the one way both seats read it (TG2-D49): a new question — its words and its options, the
 * worker's pick first — or its plan, alone (`plan`, TG2-D50: what its lead's go is for, the registry's to judge whether
 * one is under review), or, for a coding agent (`coder`), `ask` alone, the number of the question it waits on again.
 * What does not read is refused in the call's words.
 * @param {any} input @param {{ coder?: boolean }} [o]
 * @returns {{ ok: true, q: { question: string, options: string[], plan?: true }, n: null } | { ok: true, q: null, n: number } | { ok: false, error: string }}
 */
export function leadQuestionOf(input, { coder = false } = {}) {
  const question = typeof input?.question === "string" ? input.question.trim() : "";
  const plan = typeof input?.plan === "string" ? input.plan.trim() : "";
  if (coder && input?.ask != null) {
    if (question || plan || input?.options != null) return { ok: false, error: "ask goes alone, to go on waiting for a question you asked — a new question takes question, a plan plan" };
    return { ok: true, q: null, n: Math.floor(Number(input.ask)) || 0 };
  }
  if (plan) {
    if (question || input?.options != null) return { ok: false, error: "plan goes alone: say an open question inside your plan, or ask it in a call of its own" };
    return { ok: true, q: { question: plan, options: [], plan: true }, n: null };
  }
  if (!question) return { ok: false, error: "question is required: the choice or the problem, what you found or tried, and why it changes the result — or plan, your plan, while your lead reviews it" };
  const said = input?.options;
  if (said != null && (!Array.isArray(said) || said.length < LEAD_OPTIONS.min || said.length > LEAD_OPTIONS.max || said.some((o) => typeof o !== "string" || !o.trim())))
    return { ok: false, error: "options must be a list of two to four non-empty strings, your pick first" };
  return { ok: true, q: { question, options: (said || []).map((/** @type {string} */ o) => o.trim()) }, n: null };
}
/**
 * What a worker reads of its question to its lead (TG2-D49): its answer — its lead's, or the developer's — or, with
 * none, its lead's turn having ended (TG2-D58), its pick to go on with; for a coding agent whose call held as long as it
 * may, how long it has waited, and to call again. Its plan, sent while its lead reviews it (TG2-D50): a go lets it
 * change files and run commands, any other answer is a correction and they still wait, and no answer in 3 minutes lets
 * it go on with its plan. A question while its plan is still to come (`held`) says so after its answer, or after none:
 * its plan goes in plan.
 * @param {import("./subagents.js").LeadAnswer} r
 */
export function leadAnswerWords(r) {
  if (!r.ok) return r.error;
  const whose = r.how === "answered" && r.by === "lead" ? "Your lead" : "The developer";
  const toCome = r.how !== "later" && r.held ? " Your changes and commands still wait for your plan: send it with ask_lead's plan." : "";
  if (r.how === "answered" && r.plan)
    return `${whose} answered your plan (ask ${r.n}): "${r.text}". ${r.go ? "You may change files and run commands now." : `That is no go: your changes and commands still wait. Follow ${r.by === "lead" ? "its" : "their"} words, then send your plan again with ask_lead.`}`;
  if (r.how === "answered") return `${whose} answered your question (ask ${r.n}): "${r.text}"${toCome ? `.${toCome}` : ""}`;
  if (r.how === "later") return `No answer yet (ask ${r.n}, ${durationWords(r.waited)} ${r.plan ? "of 3 min" : "so far"}): call ask_lead again with ask ${r.n} alone to go on waiting — your lead's answer comes the moment it lands.`;
  if (r.how === "none" && r.plan) return `No answer from your lead in 3 minutes (ask ${r.n}): go on with your plan — your changes and commands run now — and say in your report that your lead did not review it.`;
  if (r.how === "none") return `Your lead's turn ended before it answered (ask ${r.n}): ${r.options.length ? `go on with your pick — ${r.options[0]} — and` : "go on with what you judge best, and"} say in your report that your lead did not answer.${toCome}`;
  return "No answer: the turn is being stopped.";
}
/**
 * What a worker whose lead reviews its plan reads of a change or a command it asked for before its lead's go
 * (HarnessV3-TaskGraph-v2 TG2-D50): Filament's loop answers the call so, and a coding agent hears it as Filament's note.
 */
export const PLAN_HELD = "Not run: your lead reviews your plan before you change anything — send it with ask_lead's plan; this runs once your lead answers go, or 3 minutes after your plan with no answer. Your reads run meanwhile.";
/**
 * A saved agent a session names for its agent (services/agent-cards.js): its tag, its name, the line that says what it
 * is good for, what it may do, and the card it was copied from.
 * @typedef {import("../../services/agent-cards.js").Askable} Askable
 */
/** What a worker does with its tools, by what its card lets it do, as a tool's text says it. */
const MAY_DOES = Object.freeze({
  read: "read-only; it searches and reads, never changes anything",
  copy: "{tools} in its own copy of the project, under this session's permission mode; nothing it changes there is kept",
  edit: "{tools} under this session's permission mode",
});
/**
 * What a session's agent launches by a word of its tool (AG-6, AG-80): Builder and Reviewer always — each as the copy of
 * it the session names, where it names one, which then takes its place (a copy of a copy too, by its `root`: the bug
 * round of 10-23) — then the other saved agents the session names, each asked by its tag and run as its card says (one
 * kind of agent, HarnessV4_OneAgent_Plan OA1). Builder and Reviewer themselves hold their places as they stand: as the session
 * names them, or as `places` gives them where what they may do is set on them (HarnessV4_ShippedAgents_Plan SA1,
 * agent-cards.js `placesOf`), else as they ship.
 * @param {readonly Askable[]} [asks] @param {readonly Askable[]} [places]
 * @returns {{ own: { base: string, tag: string, name: string, may: string }[], named: Askable[] }}
 */
export function launchKinds(asks = [], places = []) {
  const own = OWN_WORKERS.map((base) => {
    const copy = asks.find((a) => a.from === base) || asks.find((a) => a.root === base);
    if (copy) return { base, tag: copy.tag, name: copy.name, may: copy.may };
    const standing = asks.find((a) => a.tag === base) || places.find((a) => a.tag === base);
    return standing ? { base, tag: base, name: standing.name, may: standing.may } : { base, tag: base, name: SHIPPED_CARDS[base].name, may: SHIPPED_CARDS[base].may };
  });
  return { own, named: asks.filter((a) => !own.some((o) => o.tag === a.tag)) };
}
/**
 * The card in Builder's or Reviewer's place a word of the tool's kind field launches, as its tag: nothing named is
 * Builder's place, and `builder` and `reviewer` are whoever holds those places in the session. Null for any other word — a saved
 * agent's tag is asked by its tag.
 * @param {readonly Askable[]} asks @param {string} word
 */
export function workerFor(asks, word) {
  const { own } = launchKinds(asks);
  const w = String(word || "").toLowerCase();
  if (!w) return own[0].tag;
  return own.find((o) => o.base === w || o.tag === w)?.tag ?? null;
}
/**
 * The kind field's own words: who holds Builder's place and Reviewer's, each with what it does.
 * @param {ReturnType<typeof launchKinds>["own"]} own @param {string} tools  whose tools a worker's are, as the reader knows them
 */
const ownWords = (own, tools) => own.map((o, i) => `${o.tag}${i ? "" : " (the default)"}: ${/** @type {Record<string, string>} */ (MAY_DOES)[o.may].replace("{tools}", tools)}.`).join(" ");
/** What a sub-agent is never offered: nobody answers its questions, its checklist would overwrite the launcher's, and
 *  a sub-agent launches none of its own — the omission is the recursion cap. Its envelope tool it keeps: it writes the
 *  agent that launched it, and answers that agent's letters (app/letters.js). */
export const SUBAGENT_OFF = Object.freeze(["ask", "plan", "agent", "wait"]);
/**
 * The loop's tools each of an agent's own switches takes away (HarnessV4_ShippedAgents_Plan SA2, agent-cards.js
 * `CARD_TOOLS`): the shell in every form, the browser, the web, visuals with their guide and artifacts, the Space.
 * `mcp` takes the chat's MCP servers, which have no names here (turn.js).
 */
export const CARD_TOOL_NAMES = Object.freeze({
  shell: Object.freeze(["bash", "bash_background", "bash_output", "bash_kill", "powershell", RUN_CHECK]),
  browser: Object.freeze([BROWSER]),
  web: Object.freeze(["web_fetch", "web_search"]),
  mcp: Object.freeze([]),
  visuals: Object.freeze([SHOW_VISUAL, VISUAL_GUIDE, ARTIFACT]),
  space: Object.freeze([SPACE]),
});
/** The loop's tools a card goes without, by its switches. @param {readonly string[] | null | undefined} toolsOff @returns {string[]} */
export const cardOffTools = (toolsOff) => (toolsOff || []).flatMap((g) => /** @type {Record<string, readonly string[]>} */ (CARD_TOOL_NAMES)[g] || []);
/**
 * A fork's refusals for the tools its card goes without (SA2): a fork is offered the main agent's tools byte for byte —
 * that is what shares the provider's cache — so each is refused in words when it is called, the chat's MCP tools among
 * them where the card goes without those.
 * @param {{ name?: string, toolsOff?: readonly string[] } | null | undefined} card @param {readonly { name: string }[]} [sent]
 * @returns {Record<string, string>}
 */
export function cardRefusals(card, sent = []) {
  const off = card?.toolsOff || [];
  if (!off.length) return {};
  // The resources tool is the MCP servers' too: a card without MCP goes without it.
  const names = [...cardOffTools(off), ...(off.includes("mcp") ? sent.map((t) => t.name).filter((n) => isMcpTool(n) || n === MCP_DOOR || n === MCP_RESOURCES) : [])];
  const words = `Not run: ${card?.name || "this agent"} goes without this tool — the developer switched it off on its card. Carry on without it.`;
  return Object.fromEntries(names.map((n) => [n, words]));
}
/**
 * The report a graph task's agent ends its task with, in the hands of another: the main agent, which carries it while
 * its graph is on so that a task's fork inherits it with the rest of its tools — the bytes the provider caches (the
 * owner's words of 10-26) —, and a fork that does no task of the graph. Each is answered in these words, and neither is
 * asked for a report as it ends (loop.js `reports`).
 */
export const REPORT_NOT_YOURS = Object.freeze({
  main: "Not run: report is for the agent doing a task of your graph — it ends that task with it. Your own tasks are done with tasks.",
  fork: "Not run: report is for a task of the main agent's graph, and yours is not one — end with your final message, your report.",
});
/** A fork (subagents.js, view `fork`) is offered the main agent's own tool set byte for byte — that is what shares
 *  the provider's cache — so SUBAGENT_OFF's tools are in its set, and a call to one is answered with these words. */
export const FORK_REFUSALS = Object.freeze({
  ask: "Not run: you are a fork working as a sub-agent, and nobody can answer a question mid-task. Decide what you can, and put the open question in your report.",
  plan: "Not run: the checklist is the main agent's. As its fork, keep your own steps and carry on with the task.",
  tasks: "Not run: the task graph is the main agent's. As its fork, keep your own steps and carry on with the task.",
  agent: "Not run: a sub-agent launches none of its own — do the work yourself.",
  wait: "Not run: a sub-agent launches none of its own, so it has nothing to wait for — carry on with the task.",
  worker: "Not run: a sub-agent has no workers to follow up on — do the work yourself.",
  [BESIDE_TEAM]: "Not run: the teams beside this chat are the main agent's to send. As its fork, carry on with the task.",
  [THREAD]: "Not run: threads of this chat are the main agent's to start. As its fork, carry on with the task.",
  [FLOW_NAME]: "Not run: a flow beside this chat is the main agent's to draw. As its fork, carry on with the task.",
  [CRAFT_NAME]: "Not run: the skill this chat crafts is the main agent's to write. As its fork, carry on with the task.",
  [COME_BACK]: "Not run: coming back to this chat later is the main agent's to set. As its fork, carry on with the task.",
  // The browser is not among them: a fork drives the chat's browser in tabs of its own (HarnessV4_AgentTools_Plan AT-D6).
});
/**
 * The fields that name a sub-agent's model (HarnessV4_Tasks E23): as a person says it or as Filament lists it, who runs
 * it and how hard it thinks — and the models there are, as a call's answer: in a tool's text, that list would change
 * every session's prefix at each refresh (E23-D4). Every seat's agent tool takes them — the loop's, a coding agent's
 * and a lead's (D8, D9) — each in its own words.
 * `bound`: the main agent's seats, whose launch keeps to the list the person set (the owner's of 11-19,
 * subagents.js `agentChoice`): the model and the effort are left out unless the person asks for one, and a model named
 * picks a row of that list, at its effort, in its order — for a launch here: one on another machine runs on a model that
 * answers there.
 * @param {{ who: string, left: string, list: string, self?: string, first?: string, effortLeft?: string, bound?: boolean }} w
 *   whom a launch starts; what one that names no model runs on; whom the list is for; whose effort one that names none
 *   runs at last (the main agent's, or a lead's own); who of several serving a model runs it where the launch names
 *   none; and what effort one that names none runs at, where a seat says it in its own words (a coding agent's has no
 *   team)
 */
const modelFields = ({ who, left, list, self = "the main agent's", first = "the first of them, in the developer's order, that can run it now", effortLeft = "", bound = false }) =>
  Object.freeze({
    model: {
      type: "string",
      description: bound
        ? `The model ${who} runs on: leave it out unless the person asks for a model. Left out: ${left}. Where the person set that list, a model named for a launch here only picks one of its rows, on that row's account at its effort, and one off it is refused. Name it as you'd say it (Kimi K3, GPT Sol) or as list_models names it; a name two models match, or one that cannot run now, is refused with the reason.`
        : `The model ${who} runs on, as you'd say it (Kimi K3, GPT Sol) or as list_models names it. Left out: ${left}. A name two models match, or one that cannot run now, is refused with the reason.`,
    },
    provider: {
      type: "string",
      description: `Who runs that model where several serve it: a provider (OpenRouter, Moonshot) or a coding agent (Codex, Claude Code). Left out: ${first}; the launch's answer names the others.${bound ? " For a launch here on a list the person set, its order decides instead." : ""}`,
    },
    effort: {
      type: "string",
      enum: [...SUBAGENT_EFFORTS],
      description: `How hard ${who} thinks: low to max (it runs at the highest level its model takes at or below the one named; the launch's answer says which), or model for its model's own default. Left out: ${effortLeft || `the one its team names, else the one set for that model in the list it runs from, else ${self} effort`}.${bound ? " Where the person set an effort on the list's rows, a launch here runs at it: leave effort out, as another is refused." : ""}`,
    },
    list_models: {
      type: "boolean",
      description: `true, instead of a launch: the models ${list} can run on now, by provider and coding agent, each with whether it can run and why not, its efforts, its price or plan, and its free seats. model and provider narrow the list.`,
    },
  });
/** The loop's: a sub-agent of the session's. */
const SUBAGENT_MODEL_FIELDS = modelFields({ who: "it", left: "this chat's models for its kind where it sets any, else its card's where its kind names them, else this chat's list for agents, which is the main agent's model where the chat sets none; of that one list, the first that can run and has room", list: "a sub-agent", bound: true });
/** A coding agent's: what this chat or its card sets, its own model last, as the loop's main agent's (the owner's of 11-06). */
const CODER_MODEL_FIELDS = modelFields({ who: "it", left: "what this chat sets for its kind on its Agents tab, else its card's models, else this chat's list for agents, which is your own model and account where it sets none", list: "a sub-agent", self: "your own", first: "the account you run on where it serves that model, else the first that can run it now", effortLeft: "what this chat sets for that model, else your own effort", bound: true });
/** A lead's: a worker of its team. The brief's fields are not read for a list. */
const WORKER_MODEL_FIELDS = (() => {
  const f = modelFields({ who: "the worker", left: "its own where its team names one, else its team's models for its workers, else this chat's for its kind, else its card's, else your workers' list, which is your own model where none is set (as your instructions name them); of that one list, the first that can run and has room", list: "a worker", self: "your own", first: "your own account where you run on a coding agent's that serves it, else the first of them in the developer's order that can run it now" });
  return Object.freeze({ ...f, list_models: { ...f.list_models, description: `${f.list_models.description} Nothing is launched, and the brief's fields are not read.` } });
})();
/**
 * A saved agent the developer's newest message names in plain words (the owner's 10-19 list: "the main agent spawns
 * these when asked in plain words"), by its name or tag: one field of the agent tool, the same bytes in every session —
 * Filament keeps whom the message named, so nothing of it rides in the tool.
 */
const SAVED_AGENT_FIELD = Object.freeze({ type: "string", description: TOOL_TEXT.agentSaved });
/**
 * A follow-up that first brings the folder as it stands now into the sub-agent's worktree (the owner's list of 11-08:
 * edits made after its launch never reached it). Both agent tools take it, in the same words.
 */
const SYNC_FIELD = Object.freeze({ type: "boolean", description: TOOL_TEXT.agentSync });
/**
 * The agent's own stop of a sub-agent, as the developer's Stop is (the owner's of 11-11: asked to stop one, the agent
 * sent it a message asking it to stop, read only at its next step). Both agent tools take it, in the same words.
 */
const STOP_FIELD = Object.freeze({ type: "boolean", description: TOOL_TEXT.agentStop });
/**
 * Files and the person's pictures handed with a launch or a follow-up (attach.js; the owner's of 11-17: a picture reached
 * no sub-agent, a file one only as a path). Both agent tools take it, in the same words.
 */
const ATTACH_FIELD = Object.freeze({ type: "array", items: { type: "string" }, description: TOOL_TEXT.agentAttach });
/**
 * What an apply does with the files where a sub-agent's change overlaps edits in the folder (the owner's of 11-09: an
 * apply that overlaps refused with no way on). Both agent tools take it, in the same words.
 */
const OVERLAP_FIELD = Object.freeze({
  type: "string",
  enum: ["markers", "mine", "send_back"],
  description:
    "With apply_changes: what to do with the files where its change overlaps edits in your folder, which otherwise stop the whole apply. markers: apply it all, each of those files written with git's conflict markers for you to resolve. mine: apply the rest and keep your version of those files; the result says how to read its change to them. send_back: apply nothing, and it redoes its change on your folder as it stands, its report coming again. A task graph's change takes them too; given none, it goes back by itself, twice at most.",
});
export const AGENT_TOOL = Object.freeze({
  name: "agent",
  description: TOOL_TEXT.agent,
  input_schema: {
    type: "object",
    required: ["description"],
    properties: {
      description: { type: "string", description: "A short (3-5 word) description of the task, shown to the developer." },
      prompt: {
        type: "string",
        description: "The whole task for the sub-agent (a launch and a follow-up need it): what to do, where to look, and what to report back. It sees nothing of your conversation unless context says otherwise.",
      },
      subagent_type: {
        type: "string",
        enum: launchKinds().own.map((o) => o.tag),
        description: ownWords(launchKinds().own, "your tools"),
      },
      saved_agent: SAVED_AGENT_FIELD,
      model: SUBAGENT_MODEL_FIELDS.model,
      provider: SUBAGENT_MODEL_FIELDS.provider,
      effort: SUBAGENT_MODEL_FIELDS.effort,
      run_in_background: {
        type: "boolean",
        description: "true (the default): launch it and keep working; its report reaches you as a message when it finishes, or waits sealed for the envelope tool where Filament's line says so, and this turn does not end before it does — to wait for it, call wait. false: wait for the report as this tool's result.",
      },
      agent_id: {
        type: "string",
        description: "Continue a sub-agent you launched earlier in this session instead of starting a new one: prompt is your follow-up, and it keeps everything it already read and did; one still at work reads it as a message at its next step. To stop it instead, stop: true. subagent_type and context are ignored.",
      },
      stop: STOP_FIELD,
      apply_changes: {
        type: "boolean",
        description: "With agent_id: apply the changes that sub-agent made in its own git worktree to your folder, instead of a follow-up (no prompt needed). A file changed here meanwhile is merged with its change; where changes overlap, overlap says what happens, and left out nothing is applied and the result names the files. A task graph's sub-agent's work waits for this apply — Filament never writes it into your folder itself — and the tasks that need it wait too: the call answers once the change is in, and Filament's check of your folder with it reaches you as a message.",
      },
      overlap: OVERLAP_FIELD,
      mark_applied: {
        type: "boolean",
        description: "With agent_id: say that sub-agent's changes are in your folder already — you brought them in yourself, as after an apply that was refused — so they no longer wait to be applied. Nothing is written; the developer sees the mark, and can undo it.",
      },
      sync: SYNC_FIELD,
      context: {
        type: "string",
        enum: Object.keys(SUBAGENT_VIEWS),
        description: "What it sees of this session, from its last compaction on. Left out: none — the task alone, the default and almost always right: a sub-agent handed your conversation takes on your view of it, while one handed only its task answers apart from you and costs nothing to brief, so put the facts it needs in the prompt instead. Only where the task is about the conversation itself: folded — every turn folded to its words with one line per tool call · window — your context window as it stands, this turn to its newest round included · fork — a copy of you: this whole conversation as it stands, this turn included, on your model (read from the provider's cache, but carried on each of its rounds). Except window and fork, the current turn's work is never included.",
      },
      changes: {
        type: "string",
        description: TOOL_TEXT.agentChanges,
      },
      attach: ATTACH_FIELD,
      list_models: SUBAGENT_MODEL_FIELDS.list_models,
    },
  },
});
/**
 * The agent tool's fields for a sub-agent on another machine (the remote-agents plan's s-tools), after its own: offered
 * only where this Filament keeps a machine for its agents, so a Filament with none sends the tool it always sent.
 */
const MACHINE_FIELDS = Object.freeze({
  machine: { type: "string", description: "Another machine paired for Filament's agents, by its name or id: the sub-agent runs there. With list_models, the models that answer there, by name alone: model narrows them by name, provider not at all." },
  cwd: { type: "string", description: "With machine: the folder there it works in. Left out: its own copy of this chat's folder there, or, where that machine makes none, its clone of this project there, found by its git remote." },
  list_machines: { type: "boolean", description: "true, instead of a launch: list the machines paired for Filament's agents, each with whether it answers now, what it has to work with (system, CPUs and load, memory, GPU, coding agents, models) and its clones of this project. With list_models, both lists." },
});
/**
 * A background command's fields for one on another machine (the remote-agents plan's c-tools), after its own —
 * bash_background's and a coding agent's background_command's —: offered only where this Filament keeps a machine for
 * its agents, as the agent tool's are. Its cwd left out is the clone there, which a launch's copy is not.
 */
export const COMMAND_MACHINE_FIELDS = Object.freeze({
  machine: { type: "string", description: "Another machine paired for Filament's agents, by its name or id: the command runs there." },
  cwd: { type: "string", description: "With machine: the folder there it runs in. Left out: its clone of this project there, found by its git remote." },
});
/** bash_background as the loop offers it where this Filament keeps a machine for its agents: machine and cwd after its own. */
const BASH_BACKGROUND_THERE = (() => {
  const own = /** @type {any} */ (HAND_TOOLS.find((t) => t.name === "bash_background"));
  return Object.freeze({
    ...own,
    description: `${own.description} ${TOOL_TEXT.commandMachine}`,
    input_schema: { ...own.input_schema, properties: { ...own.input_schema.properties, ...COMMAND_MACHINE_FIELDS } },
  });
})();
/**
 * Whether this Filament keeps a machine for its agents (services/machines, an agents' device): its agent tool then takes
 * `machine`. The store reads its file anew at each call, so a turn reads it once, as its tools are built.
 * @param {import("../../services/machines/index.js").Machines | null | undefined} machines
 */
export const keepsAgentsMachine = (machines) => !!machines && machines.list().some((m) => m.device.scope === "agent");
/** @param {readonly Askable[]} asks */
const askKey = (asks) => asks.map((a) => `${a.tag}\u0001${a.name}\u0001${a.goodFor}\u0001${a.may}\u0001${a.from || ""}`).join("\u0002");
/** What a card's level lets it do, as a tool's text says it after its line. */
const LEVEL_WORDS = Object.freeze({ read: "reads only", copy: "runs things in its own copy, keeps nothing", edit: "edits in its own copy" });
/** Who may be asked, as a tool's text lists them, each with its level. @param {readonly Askable[]} asks */
const askLines = (asks) => asks.map((a) => `\`${a.tag}\` (${a.name}): ${a.goodFor.replace(/[.\s]+$/, "")} (${/** @type {Record<string, string>} */ (LEVEL_WORDS)[a.may] || a.may}).`).join(" ");
/** One tool per distinct list, frozen: the same list sends the same bytes. @type {Map<string, any>} */
const ASK_TOOLS = new Map();
/**
 * What a tool's text says of the saved agents a session names, after its own: one list, under the words that say how.
 * Empty where the session names none.
 * @param {ReturnType<typeof launchKinds>} kinds @param {string} askWords  how one is asked, in the tool's words
 * @returns {string[]}
 */
const namedLines = (kinds, askWords) => (kinds.named.length ? [`${askWords} ${askLines(kinds.named)}`] : []);
/** What the kind field says of the tags beside its own words. @param {ReturnType<typeof launchKinds>} kinds */
const tagWords = (kinds) => (kinds.named.length ? " Or a saved agent's tag, to ask it as its card says." : "");
/**
 * The agent tool of a session that names saved agents for its agent (AG-6): the same tool, its kind field taking their
 * tags beside its own two words — a copy of Builder or Reviewer in that card's place (AG-80) — its text listing each
 * with its line. `machines`: this Filament keeps a machine for its agents, and the tool takes `machine` (MACHINE_FIELDS).
 * With nobody named, Builder and Reviewer as they ship (`places`) and no machine, it is the tool itself.
 * @param {readonly Askable[]} [asks] @param {readonly Askable[]} [places] @param {boolean} [machines]
 */
export function agentToolFor(asks = [], places = [], machines = false) {
  if (!asks.length && !places.length && !machines) return AGENT_TOOL;
  const key = `loop${machines ? "+m" : ""}|${askKey(asks)}${places.length ? `\u0003${askKey(places)}` : ""}`;
  let tool = ASK_TOOLS.get(key);
  if (!tool) {
    const props = AGENT_TOOL.input_schema.properties;
    const kinds = launchKinds(asks, places);
    tool = Object.freeze({
      ...AGENT_TOOL,
      description: [machines ? `${TOOL_TEXT.agent} ${TOOL_TEXT.agentMachine}` : TOOL_TEXT.agent, ...namedLines(kinds, TOOL_TEXT.agentAsk)].join("\n\n"),
      input_schema: {
        ...AGENT_TOOL.input_schema,
        properties: {
          ...props,
          subagent_type: { ...props.subagent_type, enum: [...kinds.own, ...kinds.named].map((a) => a.tag), description: `${ownWords(kinds.own, "your tools")}${tagWords(kinds)}` },
          ...(machines ? MACHINE_FIELDS : {}),
        },
      },
    });
    ASK_TOOLS.set(key, tool);
  }
  return tool;
}
/** The model's own pause for its background sub-agents (HarnessV3-Responsiveness R5): the loop answers it the moment a
 *  report lands, the developer types, or the time is up — the proper form of the sleep-and-poll a model reaches for. */
export const WAIT_MAX_SECONDS = 600;
export const WAIT_DEFAULT_SECONDS = 300;
export const WAIT_TOOL = Object.freeze({
  name: "wait",
  description: TOOL_TEXT.wait,
  input_schema: {
    type: "object",
    properties: {
      seconds: { type: "number", description: `The longest to wait, in seconds (default ${WAIT_DEFAULT_SECONDS}, at most ${WAIT_MAX_SECONDS}).` },
    },
  },
});
/** Another agent's result that landed while the agent worked waits sealed (HarnessV4_Envelopes_Plan EN2): this opens the
 *  oldest, in the order they arrived (EN-D2). Offered wherever `wait` is, whatever the chat's switch says, so the
 *  switch never moves the tools' bytes: under *Whole* nothing is sealed, and it says so. */
export const ENVELOPE = "envelope";
export const ENVELOPE_TOOL = Object.freeze({
  name: ENVELOPE,
  description: TOOL_TEXT.envelope,
  input_schema: {
    type: "object",
    properties: {
      count: { type: "number", description: "How many to open, oldest first (default 1)." },
      all: { type: "boolean", description: "true: open every sealed one, oldest first." },
      picture: { type: "string", description: "A picture another agent drew, by the name its report gives (or its id): opens that picture alone, its code whole." },
      to: { type: "string", description: "Write a letter: to another chat by its id, as its tag [title](chat:<id>) carries it (one the person tagged in this chat, one that wrote to you, a thread linked to this chat, or the chat your watcher may guide while it is switched on; its agent finds it sealed and opens it when it chooses); inside this chat, to a running sub-agent of yours by its id (sa_…), which reads it whole at its next step; or, as a sub-agent, to \"lead\", the agent that launched you, which finds it sealed. With subject and text." },
      subject: { type: "string", description: "A letter's subject, in one line: what its reader sees before opening it." },
      text: { type: "string", description: "A letter's words, or your reply's." },
      reply: { type: "boolean", description: "true: the letter asks for a reply, which comes back to you as a letter." },
      wait: { type: "number", description: "As a sub-agent writing \"lead\" with reply: true: seconds to wait for the reply, which then comes as this call's result unless a message comes first (at most 600)." },
      answer: { type: "string", description: "Reply to a letter that asked for one, by the id its last line gives (lt_…), with text." },
      dismiss: { type: "array", items: { type: "string" }, description: "Lines of what is still open that no longer hold, by the ids in brackets that end them: Filament stops saying each until what it names changes. A call of its own." },
    },
  },
});
/**
 * A coding agent's own chat's envelope, and a lead's, beside its agent tool (the owner's prompt pass of 11-08): the same
 * tool less what only a sub-agent's does, writing "lead" and waiting for its reply, which never applies to a session
 * that is no sub-agent. The loop keeps the whole one: a sub-agent's fork shares its main agent's tools byte for byte.
 */
export const ENVELOPE_MAIN_TOOL = Object.freeze({
  ...ENVELOPE_TOOL,
  input_schema: {
    type: "object",
    properties: (({ wait: _wait, ...rest }) => ({
      ...rest,
      to: { type: "string", description: "Write a letter: to another chat by its id, as its tag [title](chat:<id>) carries it (one the person tagged in this chat, one that wrote to you, a thread linked to this chat, or the chat your watcher may guide while it is switched on; its agent finds it sealed and opens it when it chooses); or, inside this chat, to a running sub-agent of yours by its id (sa_…), which reads it whole at its next step. With subject and text." },
    }))(ENVELOPE_TOOL.input_schema.properties),
  },
});
/**
 * A coding agent's sub-agent's envelope (the owner's tool plan of 11-08, Fable's review): it opens what reached it and
 * writes to the agent that launched it, which is all a sub-agent's does; the same tool, a third of the words.
 */
export const ENVELOPE_SUB_TOOL = (() => {
  const { subject, text, reply, answer } = ENVELOPE_TOOL.input_schema.properties;
  const to = { type: "string", description: "\"lead\": the agent that launched you, which finds your letter sealed. With subject and text." };
  return Object.freeze({ name: ENVELOPE, description: TOOL_TEXT.envelopeSub, input_schema: { type: "object", properties: { to, subject, text, reply, answer } } });
})();
/** A fork that weighs the person's message aside (steer-fork.js) is refused besides FORK_REFUSALS: its words go only in its verdict. */
export const WEIGH_REFUSALS = Object.freeze({
  [ENVELOPE]: "Not run: you weigh the person's message while the agent works on undisturbed — what it should know goes in your final message's Letter: line, and no envelope is yours to open.",
});

/** A list of non-empty strings, as a brief carries its files, steps and what not to touch. @param {string} description */
const textList = (description) => ({ type: "array", items: { type: "string" }, description });
/**
 * A brief launched as two or three workers at once, the first whose check passes the lead's worker (HarnessV3-TaskGraph-v2
 * TG2-D53): the field of every lead's agent tool, in both seats.
 */
export const ATTEMPTS_FIELD = Object.freeze({
  type: "integer",
  enum: Object.freeze([2, 3]),
  description:
    "2 or 3: that many workers take this brief at once, each in a worktree of its own, for a task worth trying more than once. Filament runs each one's check when it reports: the first that passes is your worker, and you hear its report alone; the others are stopped and their work dropped. If none passes, you hear each. Needs check; never with plan_review, nor for a worker that changes nothing. You do not read along with them.",
});
/**
 * The agent tool of a team's lead: a worker launched as one of its team's members (`role`, the member's tag) from a
 * brief's parts — never a bare prompt, never a fork. A team no member of which reviews has no `review` field.
 * @param {string} description @param {readonly string[]} tags @param {Readonly<import("./roster-words.js").RosterWords>} words
 */
const teamAgentTool = (description, tags, words) =>
  Object.freeze({
    name: "agent",
    description,
    input_schema: {
      type: "object",
      required: ["role", "description", "goal", "steps", "acceptance"],
      properties: {
        role: {
          type: "string",
          enum: [...tags],
          description: words.roleField,
        },
        description: { type: "string", description: "A short (3-5 word) description of the task, shown to the developer." },
        model: WORKER_MODEL_FIELDS.model,
        provider: WORKER_MODEL_FIELDS.provider,
        effort: WORKER_MODEL_FIELDS.effort,
        goal: { type: "string", description: "What must be true when the task is done, and why it matters." },
        read_first: textList("The files or folders the worker reads before it plans, relative to the working folder: the code to imitate, the interfaces to keep."),
        files: textList("The files the task is about, relative to the working folder."),
        steps: { ...textList("What to do, in order: one step per item."), minItems: 1 },
        acceptance: { type: "string", description: "The check that proves the task done: a command and its expected result, or what to look for." },
        // Where no member changes files, none has a worktree to run commands in: no check, may_run nor attempts to
        // give (a Bug Hunter's lead gave them to its hunters, and the five launches were refused, 10-19).
        ...(words.check
          ? {
              check: {
                ...textList("One to five commands that prove the task done, as they run in the worker's folder (npm test, node test/money.test.js). The worker may run them without asking, and Filament runs them itself once it reports: a failing check goes back to the worker, twice at most, before you hear."),
                minItems: 1,
                maxItems: CHECK_MAX,
              },
              may_run: textList("Other commands the worker may run in its own worktree without anyone's answer, each a command and its first words at least (npm run lint, npm run typecheck): the same followed by more words runs too. Never an install, nor a step that cannot be undone."),
            }
          : {}),
        dont_touch: textList("What the worker must leave alone: files, folders, or things not to do."),
        context: {
          type: "string",
          enum: Object.keys(SUBAGENT_VIEWS).filter((v) => v !== "fork"),
          description: "What it sees of this session ahead of its brief, from its last compaction on. Left out: none, the brief alone (the default, and almost always right: a worker handed the conversation takes on its view of it, while one handed only its brief works apart from it, so put the facts it needs in the brief instead). Only for a task about the conversation itself: folded (every turn folded to its words, one line per tool call) or window (this session's context window as it stands, the running turn included). Only window includes the current turn's work.",
        },
        // Its plan reviewed before it changes anything (HarnessV3-TaskGraph-v2 TG2-D50): in every lead's tools, and
        // refused at launch where the lead does not read along.
        plan_review: {
          type: "boolean",
          description: "true: the worker reads and plans first, then sends you its plan with ask_lead, and its changes and commands wait for your go. Answer it with go: true to let it start, or with your corrections and no go. With no answer in 3 minutes it goes on with its plan. Only where you read along with your workers.",
        },
        ...(words.check ? { attempts: ATTEMPTS_FIELD } : {}),
        ...(words.reviewField ? { review: { type: "string", description: words.reviewField } } : {}),
        list_models: WORKER_MODEL_FIELDS.list_models,
      },
    },
  });
/** A lead's agent tool for the four members every shipped team has. */
export const TEAM_AGENT_TOOL = teamAgentTool(TOOL_TEXT.teamAgent, SHIPPED_MEMBERS, SHIPPED_ROSTER_WORDS);
/**
 * A team's lead's agent tool where the session names saved agents it may ask (HarnessV4_Tasks E15 step 3, L-52; one
 * kind of agent, OA1): the same tool, its role field taking their tags beside its members'. A question needs no steps
 * and no acceptance check, so only the role, the few words and the goal are required; a worker's brief is still checked
 * whole (team-tools.js `checkBrief`). Builder's and Reviewer's places are the session's agent's own, not a lead's; a tag
 * of one of its members is that member, launched with a brief, never asked.
 * `members`: the team's, where they are not the four that ship.
 * @param {readonly Askable[]} [named] @param {readonly Member[] | null} [members]
 */
export function teamAgentToolFor(named = [], members = null) {
  const base = leadToolsOf(members).agent;
  const props = base.input_schema.properties;
  const asks = launchKinds(named).named.filter((a) => !props.role.enum.includes(a.tag));
  if (!asks.length) return base;
  const key = `lead|${rosterMark(members)}|${askKey(asks)}`;
  let tool = ASK_TOOLS.get(key);
  if (!tool) {
    tool = Object.freeze({
      ...base,
      description: `${base.description}\n\n${TOOL_TEXT.teamAgentAsk} ${askLines(asks)}`,
      input_schema: {
        ...base.input_schema,
        required: ["role", "description", "goal"],
        properties: {
          ...props,
          role: { ...props.role, enum: [...props.role.enum, ...asks.map((a) => a.tag)], description: `${props.role.description} Or a saved agent's tag, to ask it as its card says.` },
          steps: { ...props.steps, description: `${props.steps.description} A worker's brief needs them.` },
          acceptance: { ...props.acceptance, description: `${props.acceptance.description} A worker's brief needs it.` },
        },
      },
    });
    ASK_TOOLS.set(key, tool);
  }
  return tool;
}
/** What every lead's worker tool takes, in this order: the reads and the answers of each follow. */
const WORKER_PROPERTIES = Object.freeze({
  agent_id: { type: "string", description: "The worker's id, as its launch answered it." },
  prompt: {
    type: "string",
    description: "To a running worker, your message: what to change, check or keep in mind, read at its next step. To one that reported, your follow-up: what to fix, what to do next, or what to answer; it keeps everything it already read and did.",
  },
  stop: { type: "boolean", description: "Stop a running worker now, with no prompt: its report so far arrives as a message." },
  correction: { type: "boolean", description: "With prompt, to a worker that reported: its work fell short of its brief, and your prompt says what and what to do instead." },
  apply_changes: {
    type: "boolean",
    description: "Instead of a follow-up (no prompt needed): apply the changes the worker made in its own git worktree to your folder. A file changed here meanwhile is merged with its change; if any change overlaps, nothing is applied and the result names the files, unless overlap sends it back. A task graph's worker's change waits for this apply, and the tasks that need it wait too: the call answers once the change is in, and Filament's check of the folder with it reaches you as a message.",
  },
  overlap: {
    type: "string",
    enum: ["send_back"],
    description: "With apply_changes, where the worker's change overlaps edits in your folder, which otherwise stop the whole apply: send_back sends it back to redo its change on the folder as it stands, its report coming again as a message. A task graph's change takes it too, and goes back by itself, twice at most.",
  },
  reason: { type: "string", description: "With apply_changes, for a change whose check Filament saw fail: why it goes in anyway." },
});
/**
 * A team's lead reaches a worker it launched: a message to it or its stop while it runs; a follow-up, or the apply of its
 * changes, once it reported — and its answer to a question the worker asked it (HarnessV3-TaskGraph-v2 TG2-D58), which
 * reached it as a message with its number.
 */
export const WORKER_TOOL = Object.freeze({
  name: "worker",
  description: TOOL_TEXT.worker,
  input_schema: {
    type: "object",
    required: ["agent_id"],
    properties: {
      ...WORKER_PROPERTIES,
      answer: { type: "string", description: "With ask, and nothing else, to a running worker that asked you a question: your answer, what to do and why." },
      ask: { type: "integer", minimum: 1, description: "With answer: the number of the question you answer, as it came (ask 2)." },
    },
  },
});
/** A team's lead waits for its workers as the loop waits for its background sub-agents, in its own words. */
export const TEAM_WAIT_TOOL = Object.freeze({ name: "wait", description: TOOL_TEXT.teamWait, input_schema: WAIT_TOOL.input_schema });
/**
 * A lead that reads along answers a worker that waits for the developer's answer on a call (HarnessV3-TaskGraph-v2
 * TG2-D41), and a question the worker asked it (TG2-D49): its look shows the question, by the number its answer names
 * (TG2-D42).
 */
const ANSWER_PROPERTY = Object.freeze({
  type: "string",
  description: "With ask (and allow or go where they fit, nothing else), to a running worker that waits: to its call, what to do; to its question to you, your answer; to its plan, your words on it.",
});
/** A lead's yes to its worker's waiting call, never read from its words (the owner's rule: nothing reads words for a yes). */
const ALLOW_PROPERTY = Object.freeze({ type: "boolean", description: "With answer, to a worker's call that waits: true runs it. Left out, the call is not run, and the worker reads your answer." });
/** A lead's go to its worker's plan (TG2-D50), never read from its words. */
const GO_PROPERTY = Object.freeze({ type: "boolean", description: "With answer, to a worker's plan: true lets it change files and run commands. Left out, your answer is its corrections, and it sends its plan again." });
const ASK_PROPERTY = Object.freeze({ type: "integer", minimum: 1, description: "With answer: the number of the question you answer, as your look shows it (ask 2)." });
/** Who a lead that reads along reaches: one worker, or every worker of its running now (TG2-D46). */
const ALL_PROPERTY = Object.freeze({ type: "string", description: "The worker's id, as its launch answered it, or all, with prompt alone: a message to every worker of yours running now." });
/** The worker tool of a lead that reads along (HarnessV3-TaskGraph-v2 §12, TG2-D14 and D17): two reads of a running worker more, its answer, and one message to all. */
export const WORKER_READS_TOOL = Object.freeze({
  name: "worker",
  description: TOOL_TEXT.workerReads,
  input_schema: {
    type: "object",
    required: ["agent_id"],
    properties: {
      ...WORKER_PROPERTIES,
      agent_id: ALL_PROPERTY,
      show_trail: { type: "boolean", description: "With no prompt, a running worker's rounds whole: what it said and called. It replaces the trail of that worker you asked for before." },
      from_round: { type: "integer", minimum: 1, description: "With show_trail: the round to start from. Left out, its first." },
      show_changes: { type: "boolean", description: "With no prompt, what a worker has changed in its own git worktree, as a patch: so far while it runs, and once it reported the change that waits to be applied. It replaces the one of that worker you asked for before." },
      answer: ANSWER_PROPERTY,
      ask: ASK_PROPERTY,
      allow: ALLOW_PROPERTY,
      go: GO_PROPERTY,
    },
  },
});
/** Its wait: a look at its workers follows, in place of the watch. */
export const TEAM_WAIT_READS_TOOL = Object.freeze({ name: "wait", description: TOOL_TEXT.teamWaitReads, input_schema: WAIT_TOOL.input_schema });
/**
 * The same for a coding agent in the lead's seat (V2-0b, TG2-D28): its conversation is its own, so a trail or a patch it
 * asks for again replaces nothing, and a look reaches it in its wait's answer. Its agent compacts that conversation by
 * itself, so it has a third read: a worker's brief and its reports whole (`show_report`, HarnessV3-TaskGraph-v2 TG2-D56).
 */
export const WORKER_READS_OWN_TOOL = Object.freeze({
  name: "worker",
  description: TOOL_TEXT.workerReadsOwn,
  input_schema: {
    type: "object",
    required: ["agent_id"],
    properties: {
      ...WORKER_PROPERTIES,
      agent_id: ALL_PROPERTY,
      show_trail: { type: "boolean", description: "With no prompt, a running worker's rounds whole: what it said and called." },
      from_round: { type: "integer", minimum: 1, description: "With show_trail: the round to start from. Left out, its first." },
      show_changes: { type: "boolean", description: "With no prompt, what a worker has changed in its own git worktree, as a patch: so far while it runs, and once it reported the change that waits to be applied." },
      answer: ANSWER_PROPERTY,
      ask: ASK_PROPERTY,
      allow: ALLOW_PROPERTY,
      go: GO_PROPERTY,
      show_report: { type: "boolean", description: "With no prompt, a worker's brief and its reports whole, each follow-up and its report too, and its change where one waits: the way back to what a compaction of your context left out." },
    },
  },
});
export const TEAM_WAIT_OWN_TOOL = Object.freeze({ name: "wait", description: TOOL_TEXT.teamWaitOwn, input_schema: WAIT_TOOL.input_schema });
/** The wait of the session's agent that reads along with its graph's sub-agents (V2-0c): a look at them follows. */
export const WAIT_READS_TOOL = Object.freeze({ name: "wait", description: TOOL_TEXT.waitReads, input_schema: WAIT_TOOL.input_schema });

/** @typedef {import("../../core/roster.js").Member} Member */
/**
 * A lead's tools that name its team's members, and its own tools with them in place: every hand (HarnessV4_Tasks
 * decision 9), then ask, plan, the team's agent, worker and wait — `readsOwn`, the same for a lead that reads along with its workers
 * (`engine.supervise`), whose worker and wait say so; `workerReadsOwn`, the worker of a coding agent that leads and
 * reads along (agent-tools.js lists it).
 * @typedef {{ agent: any, worker: any, workerReads: any, workerReadsOwn: any, tasks: any, own: readonly any[], readsOwn: readonly any[] }} LeadTools
 */
/** The members a team's agent tool was written for — null for the four that ship. @type {WeakMap<object, readonly Member[] | null>} */
const ROSTER_OF = new WeakMap();
/** @type {Map<string, LeadTools>} */
const LEAD_TOOLS = new Map();
/**
 * A list of members as a short word, "" for the four that ship: what its frozen tools are kept under.
 * @param {readonly Member[] | null | undefined} members
 */
const rosterMark = (members) => {
  const key = members ? rosterKey(members) : "";
  return key ? createHash("sha256").update(key).digest("hex").slice(0, 16) : "";
};
/**
 * The tools of the lead of a team with these members, frozen once per list: the four that ship have the module's own
 * constants, any other list the same tools in the words written from its cards (roster-words.js).
 * @param {readonly Member[] | null | undefined} members @returns {LeadTools}
 */
export function leadToolsOf(members) {
  const mark = rosterMark(members);
  let t = LEAD_TOOLS.get(mark);
  if (!t) {
    const words = mark && members ? rosterWords(members) : SHIPPED_ROSTER_WORDS;
    const worker = mark ? Object.freeze({ ...WORKER_TOOL, description: TEAM_TEXT.worker(words) }) : WORKER_TOOL;
    const workerReads = mark ? Object.freeze({ ...WORKER_READS_TOOL, description: TEAM_TEXT.workerReads(words) }) : WORKER_READS_TOOL;
    const workerReadsOwn = mark ? Object.freeze({ ...WORKER_READS_OWN_TOOL, description: TEAM_TEXT.workerReadsOwn(words) }) : WORKER_READS_OWN_TOOL;
    const agent = mark && members ? teamAgentTool(TEAM_TEXT.agent(words), members.map((m) => m.tag), words) : TEAM_AGENT_TOOL;
    const tasks = mark && members ? tasksTool(TEAM_TEXT.tasks(words), { tags: members.map((m) => m.tag), words }) : LEAD_TASKS_TOOL;
    ROSTER_OF.set(agent, mark && members ? members : null);
    const own = Object.freeze([...HAND_TOOLS.filter((h) => LEAD_HANDS.includes(h.name)), LSP_TOOL, ASK_TOOL, PLAN_TOOL, agent, worker, TEAM_WAIT_TOOL, ENVELOPE_TOOL, VISUAL_GUIDE_TOOL, SHOW_VISUAL_TOOL, ARTIFACT_TOOL, SPACE_TOOL]);
    const readsOwn = Object.freeze(own.map((o) => (o === worker ? workerReads : o === TEAM_WAIT_TOOL ? TEAM_WAIT_READS_TOOL : o)));
    t = Object.freeze({ agent, worker, workerReads, workerReadsOwn, tasks, own, readsOwn });
    LEAD_TOOLS.set(mark, t);
  }
  return t;
}

/**
 * What a session gives its coding agent of Filament's sub-agents (HarnessV4_Tasks E12 step 2, E15 step 3): the saved
 * agents its agent may ask, and Builder and Reviewer where what they may do is set on them (`places`,
 * HarnessV4_ShippedAgents_Plan SA1). No model: a launch's falls back to the agent's own (the owner's of 11-06), so a
 * change to the chat's list changes neither the tool nor the session's words. `held`: the session's own sub-agent tool
 * is held back beside it (Claude Code's, toolset.js `CLAUDE_OWN_AGENTS`), which its words say plainly; it is the
 * agent's, so a chat keeps it while its session does and `launchKey` leaves it out. `machines`: this Filament keeps a
 * machine for its agents (`keepsAgentsMachine`), and the tool takes `machine`.
 * @typedef {{ asks: readonly Askable[], places?: readonly Askable[], held?: boolean, machines?: boolean }} LaunchOffer
 */
/**
 * The offer as one word: a session opened under one word has that word's tools, so a changed word says the session
 * takes other tools now.
 * @param {LaunchOffer} o
 */
export const launchKey = ({ asks, places = [], machines = false }) => createHash("sha256").update(`\u0003${askKey(asks)}${places.length ? `\u0003${askKey(places)}` : ""}${machines ? "\u0004m" : ""}`).digest("hex").slice(0, 16);
/**
 * A lead's tools as one word, the same way: whom it may ask, and — where its team's members are not the four that
 * ship — who they are, since its agent, worker and tasks tools name them.
 * @param {readonly Askable[]} asks @param {readonly Member[] | null | undefined} members
 */
export const leadLaunchKey = (asks, members) => {
  const mark = rosterMark(members);
  const word = asks.length ? launchKey({ asks }) : "";
  return mark ? createHash("sha256").update(`${word}\u0003${mark}`).digest("hex").slice(0, 16) : word;
};
/**
 * Filament's agent tool in a coding agent's own chat: Builder and Reviewer on the model a launch names, else on this
 * chat's and their cards' models, else the agent's own — never as a fork (the agent's request is not Filament's to
 * copy) — and the named agents' tags beside them.
 * @param {LaunchOffer} o
 */
export function coderAgentToolFor({ asks, places = [], held = false, machines = false }) {
  const key = `coder${held ? "-held" : ""}${machines ? "+m" : ""}|\u0003${askKey(asks)}${places.length ? `\u0003${askKey(places)}` : ""}`;
  let tool = ASK_TOOLS.get(key);
  if (!tool) {
    const props = AGENT_TOOL.input_schema.properties;
    const kinds = launchKinds(asks, places);
    const named = namedLines(kinds, TOOL_TEXT.coderAsk);
    const fields = CODER_MODEL_FIELDS;
    tool = Object.freeze({
      name: AGENT_TOOL.name,
      // The tool's own words, the same whoever the session names (the owner's tool plan of 11-08): the saved agents it
      // may ask are said at subagent_type, where one is picked.
      description: `${held ? TOOL_TEXT.coderOwnHeld : TOOL_TEXT.coderOwn} ${TOOL_TEXT.coderAgent}${machines ? ` ${TOOL_TEXT.agentMachine}` : ""}`,
      input_schema: {
        type: "object",
        required: ["description"],
        properties: {
          description: props.description,
          prompt: CODER_FIELDS.prompt,
          subagent_type: {
            type: "string",
            enum: [...kinds.own, ...kinds.named].map((a) => a.tag),
            description: `${ownWords(kinds.own, "Filament's file and shell tools")}${named.length ? ` ${named.join(" ")}` : ""}`,
          },
          saved_agent: SAVED_AGENT_FIELD,
          model: fields.model,
          provider: fields.provider,
          effort: fields.effort,
          run_in_background: CODER_FIELDS.run_in_background,
          agent_id: props.agent_id,
          stop: STOP_FIELD,
          apply_changes: CODER_FIELDS.apply_changes,
          overlap: OVERLAP_FIELD,
          mark_applied: CODER_FIELDS.mark_applied,
          sync: SYNC_FIELD,
          // The graph task a launch is for (the Designer's of 10-27, built 10-28), or a follow-up's (11-09): its box on the Plan page shows who works on it.
          task: CODER_FIELDS.task,
          context: { ...TEAM_AGENT_TOOL.input_schema.properties.context, description: CODER_FIELDS.context },
          changes: props.changes,
          attach: ATTACH_FIELD,
          list_models: fields.list_models,
          ...(machines ? MACHINE_FIELDS : {}),
        },
      },
    });
    ASK_TOOLS.set(key, tool);
  }
  return tool;
}
/**
 * A coding agent's agent tool's own fields (the owner's tool plan of 11-08): how the report comes back, the brief, an
 * apply, the graph task a launch is for (10-28) and what it sees, each said once here rather than in the tool's text.
 */
const CODER_FIELDS = Object.freeze({
  prompt: { type: "string", description: "The whole task (a launch and a follow-up need it): the goal, where to look, and what to report back. The sub-agent cannot ask anyone anything and sees nothing of your conversation beyond context, so give it everything it needs." },
  run_in_background: {
    type: "boolean",
    description: "true: the call answers at once, and the report reaches you as a message from Filament when it finishes, or waits sealed for the envelope tool where Filament's line says so; your turn does not end before it does. Use it on each launch when you start several in one reply. false (the default): the report is this call's result, unless the job outlasts the call, which then answers that it runs on.",
  },
  apply_changes: {
    type: "boolean",
    description: "With agent_id and no prompt: apply the changes that sub-agent made in its own git worktree to your folder. A file changed here meanwhile is merged with its change; where changes overlap, overlap says what happens, and left out nothing is applied and the result names the files. A task graph's sub-agent's change waits for this apply, as do the tasks that need it. The call answers once the change is in, and Filament's check of your folder with it reaches you as a message.",
  },
  mark_applied: { type: "boolean", description: "With agent_id: that sub-agent's changes are already in your folder (you brought them in yourself, as after a refused apply), so they stop waiting to be applied. Nothing is written; the person sees the mark and can undo it." },
  task: { type: "string", description: "With a task graph: the id of your task this launch or follow-up works on, one whose needs are done. The task stays yours (you apply its change and mark it done); its box on the Plan page shows who works on it, on which model and where, and a task that waited to start runs from now." },
  context:
    "What it sees of this session ahead of its brief, from its last compaction on. Left out: none, the brief alone (the default, and almost always right: put the facts it needs in the brief). Only for a task about the conversation itself: folded (every turn folded to its words, one line per tool call) or window (your context window as it stands, the running turn included). Only window includes the current turn's work.",
});
/** A coding agent's wait for Filament's sub-agents: it answers with their reports, since nothing else hands them over meanwhile. */
export const CODER_WAIT_TOOL = Object.freeze({ name: "wait", description: TOOL_TEXT.coderWait, input_schema: WAIT_TOOL.input_schema });

/**
 * The seconds a command spends doing nothing but sleep, when sleeping is all it does: `sleep N[smh]`, Windows'
 * `timeout /t N`, PowerShell's `Start-Sleep`, and the `ping -n N 127.0.0.1` idiom — alone, with output redirects at
 * most. A command that also does work is not a plain sleep and gets null: only the plain form is refused while a
 * sub-agent runs (the loop's `wait` guard), so a build that sleeps between steps is never touched.
 * @param {unknown} command @returns {number | null}
 */
export function plainSleepSeconds(command) {
  const c = String(command ?? "")
    .trim()
    .replace(/(?:\s*\d?>>?\s*(?:&\d|nul|\/dev\/null|\$null))+$/i, "")
    .trim();
  const UNIT = /** @type {Record<string, number>} */ ({ "": 1, s: 1, m: 60, h: 3600, d: 86400 });
  let m = /^sleep\s+(\d+(?:\.\d+)?)([smhd]?)$/i.exec(c);
  if (m) return Number(m[1]) * UNIT[m[2].toLowerCase()];
  m = /^timeout(?:\.exe)?\s+\/t\s+(\d+)(?:\s+\/nobreak)?$/i.exec(c);
  if (m) return Number(m[1]);
  m = /^(?:powershell(?:\.exe)?\s+(?:-\w+\s+)*?(?:-c(?:ommand)?\s+)?["']?)?start-sleep\s+(?:(-m(?:illiseconds)?)\s+|-s(?:econds)?\s+)?(\d+(?:\.\d+)?)["']?$/i.exec(c);
  if (m) return m[1] ? Number(m[2]) / 1000 : Number(m[2]);
  m = /^ping(?:\.exe)?\s+-[nc]\s+(\d+)\s+(?:127\.0\.0\.1|localhost|::1)$/i.exec(c);
  if (m) return Math.max(0, Number(m[1]) - 1);
  return null;
}
/** A plain sleep this long or longer is refused while a background sub-agent runs. */
export const SLEEP_REFUSE_SECONDS = 5;
/** What the model is told instead of the sleep's output. */
export const SLEEP_REFUSAL =
  "Not run: this command only sleeps, and a sub-agent you launched in the background is still running — a sleep delays its report instead of waiting for it. Call wait: it returns the moment a report or a message from the developer arrives. Or end your reply, and Filament brings you the report when it lands.";
/** Why, in the card's words: the refusal names neither a rule nor a hook, and it is not the permission mode's. */
export const SLEEP_REFUSAL_REASON = "it only sleeps while a background sub-agent runs; the model was pointed at wait";

export const DELEGATE_READ_TOOL = Object.freeze({
  name: "delegate_read",
  description: TOOL_TEXT.delegateRead,
  input_schema: {
    type: "object",
    required: ["paths", "question"],
    properties: {
      paths: {
        type: "array",
        items: { type: "string" },
        description: "Files to read, relative to the working folder (at most 20).",
      },
      question: { type: "string", description: "The one question the reader answers about those files." },
    },
  },
});

/** @type {Map<string, readonly any[]>} */
const SETS = new Map();
/**
 * The coding agent's own tools: every hand and the language server's (`lsp`, the owner's LSP of 11-04, offered with
 * a server or none), then the loop's, then its visuals (HarnessV4_Visuals_Plan VS-D1), its artifacts
 * (HarnessV4_Artifacts_Plan AF-D1), its project's Space (proposal_ux §4.14), the team tool that fires teams beside its
 * chat (team_v2_plan §5.5), the flow tool that designs a flow beside it (HarnessV4_OneAgent_Plan OA3) and the thread
 * tool that starts a chat linked to it (agent/thread-tool.js) — last, so a chat not offered them sends the set it always
 * sent.
 */
const LOOP_OWN = [...HAND_TOOLS, LSP_TOOL, ASK_TOOL, PLAN_TOOL, AGENT_TOOL, WAIT_TOOL, ENVELOPE_TOOL, VISUAL_GUIDE_TOOL, SHOW_VISUAL_TOOL, ARTIFACT_TOOL, SPACE_TOOL, BESIDE_TOOL, FLOW_TOOL, THREAD_TOOL];
/** The same for an agent that reads along with its graph's sub-agents (V2-0c): its wait says a look follows. */
const LOOP_READS_OWN = LOOP_OWN.map((t) => (t === WAIT_TOOL ? WAIT_READS_TOOL : t));
/**
 * A team's lead's own tools: every hand, then the loop's with the team's agent, worker and wait, then its visuals and
 * its artifacts.
 */
const LEAD_OWN = leadToolsOf(null).own;
/** The same for a lead that reads along with its workers (`engine.supervise`): its worker and its wait say so. */
const LEAD_READS_OWN = leadToolsOf(null).readsOwn;
/**
 * One frozen set per kind of agent and configuration: its own tools — with its task graph's (`tasks`) right after plan
 * where it plans on one — then the report, for a graph task's sub-agent, and ask_lead, for a team's worker
 * (`askLead`, HarnessV3-TaskGraph-v2 TG2-D49, TG2-D58), then a cheaper read, the web and the browser when the session
 * offers them, less the tools it switched off. `asks`: the saved agents the session's agent may ask (HarnessV4_Tasks
 * E15 step 3) — its agent tool then lists them. `browser`: the session's switch `plugins.browser` (HarnessV4_Browser_Plan
 * BR-D5), last of all, so a set without it is the bytes it always was — then `craft`, a crafter chat's craft tool
 * (agent/craft-tool.js), after it for the same reason, and `comeBack`, a harness chat's own agent's come_back
 * (agent/come-back.js), after them, and `runCheck`, run_check of a sub-agent that only reads and holds its task's check
 * (agent/run-check.js, x20), last. `places`: Builder and Reviewer where what they may do is set on them
 * (HarnessV4_ShippedAgents_Plan SA1) — the agent tool says each one's level as it stands. `machines`: this Filament
 * keeps a machine for its agents, and the loop's agent tool takes `machine` (`agentToolFor`), and so does
 * bash_background (`BASH_BACKGROUND_THERE`, c-tools) — each while it is on.
 * @param {string} kind @param {readonly any[]} own @param {any} tasks
 * @param {{ delegateRead: boolean, disabled?: readonly string[], web?: { fetch?: boolean, search?: boolean } | null, graph?: boolean, report?: boolean, askLead?: boolean, asks?: readonly Askable[], places?: readonly Askable[], browser?: boolean, craft?: boolean, comeBack?: boolean, runCheck?: boolean, machines?: boolean }} args
 */
function frozenSet(kind, own, tasks, { delegateRead, disabled = [], web = null, graph = false, report = false, askLead = false, asks = [], places = [], browser = false, craft = false, comeBack = false, runCheck = false, machines = false }) {
  const off = new Set(disabled);
  // Visuals are switched off by show_visual: its guide serves nothing without it.
  if (off.has(SHOW_VISUAL)) off.add(VISUAL_GUIDE);
  const fetchOn = !!web?.fetch;
  const searchOn = !!web?.search;
  const browserOn = browser && !off.has(BROWSER);
  const craftOn = craft && !off.has(CRAFT_NAME);
  const comeBackOn = comeBack && !off.has(COME_BACK);
  const runCheckOn = runCheck && !off.has(RUN_CHECK);
  const machinesOn = machines && !off.has(AGENT_TOOL.name);
  const commandsThere = machines && !off.has(BASH_BACKGROUND_THERE.name);
  const key = `${kind}|${delegateRead ? "d" : "-"}|${[...off].sort().join(",")}|${fetchOn ? "f" : "-"}${searchOn ? "s" : "-"}${graph ? "g" : "-"}${report ? "r" : "-"}${askLead ? "l" : "-"}${browserOn ? "b" : "-"}${craftOn ? "c" : "-"}${comeBackOn ? "w" : "-"}${runCheckOn ? "x" : "-"}${machinesOn ? "m" : "-"}${commandsThere ? "k" : "-"}|${askKey(asks)}${places.length ? `|${askKey(places)}` : ""}`;
  let set = SETS.get(key);
  if (!set) {
    const named = asks.length || places.length || machinesOn ? own.map((t) => (t === AGENT_TOOL ? agentToolFor(asks, places, machinesOn) : ROSTER_OF.has(t) ? teamAgentToolFor(asks, ROSTER_OF.get(t)) : t)) : own;
    const mine = commandsThere ? named.map((t) => (t.name === BASH_BACKGROUND_THERE.name ? BASH_BACKGROUND_THERE : t)) : named;
    set = Object.freeze(
      [
        ...(graph ? mine.flatMap((t) => (t === PLAN_TOOL ? [t, tasks] : [t])) : mine),
        ...(report ? [REPORT_TOOL] : []),
        ...(askLead ? [ASK_LEAD_TOOL] : []),
        ...(delegateRead ? [DELEGATE_READ_TOOL] : []),
        ...(fetchOn ? [WEB_FETCH_TOOL] : []),
        ...(searchOn ? [WEB_SEARCH_TOOL] : []),
        ...(browserOn ? [BROWSER_TOOL] : []),
        ...(craftOn ? [CRAFT_TOOL] : []),
        ...(comeBackOn ? [COME_BACK_TOOL] : []),
        ...(runCheckOn ? [RUN_CHECK_TOOL] : []),
      ].filter((t) => !off.has(t.name)),
    );
    SETS.set(key, set);
  }
  return set;
}
/**
 * The frozen toolset for one configuration. `disabled` names tools the session switched off (`loop.tools`, HarnessV2
 * §5.2); they are left out of the set, and the set is still one frozen constant per distinct choice. `web` names
 * the web hands the session switched on (`plugins.web`, §5.7); they come after the loop's own tools. The set no
 * longer knows the permission mode: every mode offers every hand (read-only included) and the gate refuses or
 * pauses at call time, so a mode flipped mid-task changes neither these tools nor the system prompt — nothing
 * the provider cached moves. `graph`: the session's task graph is on (HarnessV3-TaskGraph), and tasks rides after plan.
 * `report`: the run is a graph task's sub-agent's, which ends with its report (G2-4). `askLead`: the run is a team's
 * worker, which may ask its lead a question (TG2-D49, TG2-D58). `asks`: the saved agents the session's agent
 * may ask, which its agent tool lists. `supervise`: with the graph on, the agent reads along with its graph's
 * sub-agents (HarnessV3-TaskGraph-v2 TG2-D20) — its tasks has note, and its wait says a look follows; without the
 * graph it moves nothing. `places`: Builder and Reviewer where what they may do is set on them (SA1). `craft`: the chat is
 * a crafter chat, whose main agent has the craft tool. `comeBack`: the agent is a harness chat's own, which may come
 * back to it later (agent/come-back.js). `runCheck`: a sub-agent that only reads, holding the check of the graph task
 * it looks at (agent/run-check.js, x20). `machines`: this Filament keeps a machine for its agents, and the agent tool
 * and bash_background take `machine`.
 * @param {{ delegateRead: boolean, disabled?: readonly string[], web?: { fetch?: boolean, search?: boolean } | null, graph?: boolean, report?: boolean, askLead?: boolean, asks?: readonly Askable[], places?: readonly Askable[], supervise?: boolean, browser?: boolean, craft?: boolean, comeBack?: boolean, runCheck?: boolean, machines?: boolean }} args
 */
export const toolSetFor = ({ supervise = false, ...args }) => (supervise && args.graph ? frozenSet("loop-reads", LOOP_READS_OWN, TASKS_READS_TOOL, args) : frozenSet("loop", LOOP_OWN, TASKS_TOOL, args));
/**
 * A team's lead's toolset (HarnessV3-AtHome AH-O3), frozen per configuration the same way: every hand — since
 * HarnessV4_Tasks decision 9 (PT-D11), where AH-O3 gave it read, grep and glob alone; its workers still do most of the
 * work — then ask, plan (and its own tasks, with the task graph on) and the team's agent, worker and wait. `supervise`: the lead reads along with its workers, and its worker and wait are that lead's.
 * `members`: its team's, where they are not the four that ship — its agent, worker and tasks then name them.
 * @param {{ delegateRead: boolean, disabled?: readonly string[], web?: { fetch?: boolean, search?: boolean } | null, graph?: boolean, asks?: readonly Askable[], supervise?: boolean, members?: readonly Member[] | null, browser?: boolean }} args
 */
export const leadToolSetFor = ({ supervise = false, members = null, ...args }) => {
  const mark = rosterMark(members);
  if (!mark) return supervise ? frozenSet("lead-reads", LEAD_READS_OWN, LEAD_TASKS_TOOL, args) : frozenSet("lead", LEAD_OWN, LEAD_TASKS_TOOL, args);
  const t = leadToolsOf(members);
  return frozenSet(`${supervise ? "lead-reads" : "lead"}:${mark}`, supervise ? t.readsOwn : t.own, t.tasks, args);
};

/**
 * The loop's tool arguments for a session (HarnessV3 Step 3 D7): what the loop will actually send, derived once —
 * the loop and the sessions service (composing another window's turns through the adapter) both call this, so the
 * vocabulary the composer rebuilds against is the one the request carries. `disabled` and `web` arrive as the loop
 * resolves them (the operator config and the document merged); `recall` counts when the session offers the memory
 * tools. MCP tools are discovered only when the loop starts, so they are never here — another window's MCP call
 * folds rather than ride a tool this derivation cannot name. `lead` derives a team's lead's set instead; `graph` adds
 * the task graph's tool (the session's own agent's, or its lead's) and, on the loop's own set, report — refused in words
 * (REPORT_NOT_YOURS), it is there so a task of its graph may start as its fork, whose tools are its own byte for byte
 * (the owner's words of 10-26); `report`, the report a graph task's sub-agent ends with;
 * `askLead`, the ask_lead of a team's worker (TG2-D49, TG2-D58); `asks`, the saved agents the session's
 * agent may ask; `supervise`, a lead that reads along with its workers (`engine.supervise`), or the agent with its
 * graph's sub-agents; `members`, a lead's team's, where they are not the four that ship; `browser`, the session's
 * browser switch (HarnessV4_Browser_Plan BR-D5); `places`, Builder and Reviewer where what they may do is set on them
 * (HarnessV4_ShippedAgents_Plan SA1) — the agent's own agent tool says it; a lead launches its team's members. `craft`,
 * a crafter chat's main agent (agent/craft-tool.js); `comeBack`, a harness chat's own agent, which may come back to it
 * later (agent/come-back.js); `runCheck`, a sub-agent that only reads and holds its task's check (agent/run-check.js);
 * `machines`, this Filament keeps a machine for its agents (`keepsAgentsMachine`) — the agent's own agent tool and
 * bash_background take `machine`, a lead's none.
 * @param {{ delegateRead?: boolean, disabled?: readonly string[], web?: { fetch?: boolean, search?: boolean } | null, recall?: boolean, lead?: boolean, graph?: boolean, report?: boolean, askLead?: boolean, asks?: readonly Askable[], places?: readonly Askable[], supervise?: boolean, members?: readonly Member[] | null, browser?: boolean, craft?: boolean, comeBack?: boolean, runCheck?: boolean, machines?: boolean }} [args]
 * @returns {any[]}
 */
export function loopToolArgs({ delegateRead = false, disabled = [], web = null, recall = false, lead = false, graph = false, report = false, askLead = false, asks = [], places = [], supervise = false, members = null, browser = false, craft = false, comeBack = false, runCheck = false, machines = false } = {}) {
  const set = lead ? leadToolSetFor({ delegateRead, disabled, web, graph, asks, supervise, members, browser }) : toolSetFor({ delegateRead, disabled, web, graph, report: report || graph, askLead, asks, places, supervise, browser, craft, comeBack, runCheck, machines });
  return recall ? [...set, recallToolDef("anthropic")] : [...set];
}
export const isLoopTool = (name) =>
  isHandTool(name) || isWebTool(name) || isMcpTool(name) || name === MCP_DOOR || name === MCP_RESOURCES || name === SKILL_TOOL_NAME || name === "ask" || name === "plan" || name === "tasks" || name === "report" || name === "ask_lead" || name === "agent" || name === "worker" || name === "wait" || name === ENVELOPE || name === "delegate_read" || name === VISUAL_GUIDE || name === SHOW_VISUAL || name === ARTIFACT || name === SPACE || name === BESIDE_TEAM || name === FLOW_NAME || name === THREAD || name === CRAFT_NAME || name === COME_BACK || name === RUN_CHECK || name === BROWSER || name === LSP;

/** @param {unknown} v */
export const permissionMode = (v) =>
  PERMISSION_MODES.includes(/** @type {any} */ (v)) ? /** @type {PermissionMode} */ (v) : "edit";

/** What one hand does, for the permission gate and the event summary: reads, writes, or runs a command. */
const MUTATES = new Set(["write", "edit"]);
/**
 * Whether a call changes something or runs a command, as the gate tells them apart: a write or an edit, a command in
 * any spelling, an MCP tool its server does not vouch for as read-only (`kind`), a browser call that acts on a page
 * (`input`: click, type, press, select, evaluate — the E27 hunt of 10-23). What a plan's review holds until the lead's
 * go (HarnessV3-TaskGraph-v2 TG2-D50) — a command that only reads among them: the worker reads with its reads.
 * @param {string} name @param {"read" | "mutate"} [kind] @param {any} [input]
 */
export const changesOrRuns = (name, kind = undefined, input = undefined) =>
  MUTATES.has(name) || isCommandHand(name) || (isMcpTool(name) && kind !== "read") || (name === BROWSER && actingSteps(input).length > 0);
/**
 * Whether a call brings another's change into the folder: a sub-agent's or a worker's applied (`apply_changes`), or a
 * failed task's merged as it stands (a lead's `tasks` merge). Not a write of the agent's own, so no gate holds it as one,
 * but what failed in the folder may pass after it (core/drift.js, d-fails).
 * @param {string} name @param {any} [input]
 */
export const bringsChanges = (name, input = undefined) =>
  ((name === "agent" || name === "worker") && input?.apply_changes === true) || (name === "tasks" && input?.action === "merge");
/**
 * Whether a call that ran starts the count of a command's failed runs again (core/drift.js, d-fails): it changes
 * something or runs a command (`changesOrRuns`), or brings another's change into the folder (`bringsChanges`) — what
 * failed may pass after it, and "nothing changed between" would be false. One rule for Filament's loop and for a coding
 * agent's calls (acp-turn.js `sawWork`): written in each, the two had moved apart, and a coding agent that applied a
 * sub-agent's change between two failed runs was told nothing changed (the review of 11-11). A coding agent's call to
 * one of Filament's own tools is asked under that tool's name here, any other under its own.
 * @param {string} name @param {"read" | "mutate"} [kind] @param {any} [input]
 */
export const changesWhatFailed = (name, kind = undefined, input = undefined) => changesOrRuns(name, kind, input) || bringsChanges(name, input);
/**
 * A path segment that opens a repository's `.git`. Windows opens it by other names too, as git itself guards against:
 * with trailing dots or spaces, by its short name (`GIT~1`), or as a stream of the folder (`.git::$INDEX_ALLOCATION`).
 */
const GIT_SEGMENT = /^(?:\.git|git~\d+)[. ]*(?::.*)?$/i;
/**
 * Whether a write or an edit lands in a repository's own `.git` — its folder, or the file a worktree has. Git keeps the
 * commands it runs by itself there (hooks, filters, the fsmonitor), and Filament's snapshots run `git add`: a write
 * there is a command in all but name (the bug report's H2). A path inside the folder the call works in (`root`) is
 * read below it: a sub-agent's worktree is itself inside its repository's `.git` (`filament-worktrees`), and the files
 * it works on there are no git's. Its own `.git` file, or a path that climbs out, is read whole.
 * @param {any} input @param {string} [root]
 */
const intoGit = (input, root = "") => {
  const path = String(input?.path ?? input?.file_path ?? "");
  const full = root && path ? resolve(root, path) : path;
  const below = root && path ? relative(root, full) : "";
  const inside = !!below && !isAbsolute(below) && !/^\.\.(?:[\\/]|$)/.test(below);
  return (inside ? below : full).split(/[\\/]+/).some((s) => GIT_SEGMENT.test(s));
};
/**
 * Whether a write or an edit lands outside the folder the call works in (HarnessV4_SpacesPlugins_Plan A2b, SP-D5),
 * read as the fence reads it first — by the path, case-insensitive on Windows. Such a write asks in Edit and Ask modes
 * instead of the fence's flat refusal, runs in Full access, and is never learned.
 * @param {any} input @param {string} [root]
 */
export const outsideRoot = (input, root = "") => {
  const path = String(input?.path ?? input?.file_path ?? "");
  if (!root || !path) return false;
  const below = relative(resolve(root), resolve(root, path));
  return !!below && (isAbsolute(below) || /^\.\.(?:[\\/]|$)/.test(below));
};
/** The hands that run a command to its end inside the call: their output streams to the card, their exit code is its. */
export const FOREGROUND_SHELLS = new Set(["bash", "powershell"]);

/**
 * The permission gate: what happens to a hand call under a mode, before it runs. The loop's own tools run in every
 * mode — `agent` included: its sub-agent runs under the same mode (read-only stays read-only), so the gate judges
 * the sub-agent's own calls, not the launch. `run` runs it, `ask` pauses the
 * turn on a question the developer answers in chat, `refuse` answers the model in words without running anything.
 * A learned permission (WP-L: a confirmed `permission` memory item for this call's shape in this project) turns
 * an ask into a run, said as `learned`. It never overrides read-only: the developer chose that mode for the session.
 * An MCP tool (§5.7) runs free when its server vouches for it as read-only (`kind` "read"); otherwise it is judged
 * like a command — nobody but the server knows what it does. A foreground bash command that only reads runs without
 * asking in every mode, said as `readOnly`: the loop's `readOnly` reads it (HarnessV3-Launch LD-D11 — asking before
 * `wc -c` taught the developer to click Allow without reading), and a PowerShell script the same, by PowerShell's own
 * reader (HarnessV4_Tasks C10). Edit mode alone ran one until HarnessV3-AtHome AH-F2:
 * read-only is the mode for looking, and an Ask session's sub-agents, whom nobody can answer, could not look at all.
 * One the reader does not pass is refused or asked about with its reason (`why`). Full access runs it unread. A write
 * into a repository's `.git` asks in Edit mode and Full access too, and is never learned: git runs what it finds there,
 * and Filament reads every place an agent writes in (HarnessV4_Git_Plan GW-D11).
 * @param {PermissionMode} mode
 * @param {string} name
 * @param {any} input
 * @param {((name: string, input: any) => boolean) | null} [learned]  whether a confirmed rule covers the call
 * @param {"read" | "mutate"} [kind]  an MCP tool's nature, from its annotations
 * @param {((command: string, name: string, input: any) => import("../../adapters/tools/read-only-commands.js").Verdict) | null} [readOnly]
 *   whether a foreground command only reads, and if not why: bash's by read-only-commands.js, PowerShell's by
 *   read-only-powershell.js — the caller picks by the call's `name`
 * @param {string} [root]  the folder the call works in, below which a path is read for `.git` (`intoGit`)
 * @returns {{ verdict: "run", learned?: true, readOnly?: true, grant?: string[], kept?: string[] } | { verdict: "ask", question: string, why?: string, outside?: true, sends?: true, links?: true } | { verdict: "refuse", text: string, why?: string }}
 *   `grant` is never the gate's own: the grants a worker's brief gives that turned its ask into a run, in the worker's
 *   own worktree (grants.js, HarnessV3-TaskGraph-v2 TG2-D44), as the loop and the session's switch say it; nor is
 *   `kept`: the commands the chat keeps always allowed that did the same for its own seat (chat-always.js); `sends` and
 *   `links` (a link made into the folder, or a deep delete through one), an ask no rule turns into a run (`ruled`)
 */
export function gate(mode, name, input, learned = null, kind = undefined, readOnly = null, root = "") {
  // A press of a button that sends — it leaves this machine — asks in every mode but read-only, whatever was learned,
  // unless the person let agents press that button (the Space Apps plan of 10-29).
  if (sendsAlways(input)) return mode === "read-only" ? { verdict: "refuse", text: readOnlyRefusal(name) } : { verdict: "ask", sends: true, question: permissionQuestion(name, input, null, root) };
  // An app's tool that reads (the owner's of 11-05) runs in every mode: the person kept it as one that reads, its command
  // whole and each argument checked. The rules still judge it after, as the command it runs.
  if (input?.press?.tool === true && input.press.effect === "reads") return { verdict: "run", readOnly: true };
  const mcp = isMcpTool(name);
  if (!isHandTool(name) && !mcp) return { verdict: "run" };
  if (mcp && kind === "read") return { verdict: "run" };
  const mutates = MUTATES.has(name);
  // A command is a command in every spelling: in the background, and in PowerShell (HarnessV3-Tools TL-D5).
  const command = isCommandHand(name) || mcp;
  if (!mutates && !command) return { verdict: "run" };
  const git = mutates && intoGit(input, root);
  // A link made into the folder from outside it, or a deep delete of a folder holding a link out of it, asks in every
  // mode and is never learned or allowed by a rule (the owner's list of 11-08, agent/link-guard.js).
  const link = command && !mcp && !input?.press ? linkRisk(name, String(input?.command ?? ""), root) : null;
  if (mode === "auto" && !git && !link) return { verdict: "run" };
  // A dashboard's button pressed by an agent (`press`, HarnessV4_AgentsSpace_Plan SA-D4) changes something: a press is
  // never read as a command that only reads.
  const reads = FOREGROUND_SHELLS.has(name) && readOnly && !input?.press ? readOnly(String(input?.command ?? ""), name, input) : null;
  if (reads?.ok) return { verdict: "run", readOnly: true };
  const why = reads && !reads.ok ? reads.why : null;
  if (mode === "read-only") return { verdict: "refuse", text: readOnlyRefusal(name, { why }), ...(why ? { why } : {}) };
  // A write outside the chat's folder asks, where the fence refused it flatly (A2b): a yes lets that write alone through.
  const outside = mutates && !git && outsideRoot(input, root);
  if (mode === "edit" && mutates && !git && !outside) return { verdict: "run" };
  if (link) return { verdict: "ask", links: true, question: permissionQuestion(name, input, null, root, linkWords(link)) };
  if (!git && !outside && learned && learned(name, input)) return { verdict: "run", learned: true };
  return { verdict: "ask", question: permissionQuestion(name, input, why, root), ...(why ? { why } : {}), ...(outside ? { outside: true } : {}) };
}

/**
 * Whether a call is an agent's press of a button that sends (the Space Apps plan of 10-29), which the person did not let
 * agents press unasked: the space tool's stand-in for the press says both, from the runner (`pressOf`).
 * @param {any} input
 */
export const sendsAlways = (input) => input?.press?.effect === "sends" && input.press.allowed !== true;

/**
 * The gate's verdict under the rules that cover the call (§5.2): deny refuses whatever the mode says; a read-only
 * refusal stands whatever the rule says; allow turns an ask into a run; ask turns a run into an ask; a `gate` hit (an
 * allow that reaches only part of a command) leaves the gate's verdict, and `note` says why. `review`
 * (HarnessV4_Space_Plan SG-D13) asks as ask does, in every mode, an ask of the gate's too, and says so (`review`): the
 * card asks with a second look first. A command `reads` tells only reads is no risky move: the gate decides it. The
 * loop judges its calls by it, and a harness session's coding agent's requests (HarnessV3-ACP AC3-2).
 * @param {ReturnType<typeof gate>} g @param {import("./rules.js").RuleHit | null} hit @param {string} name @param {any} input
 * @param {string} [root]  the folder the call works in, as the gate read it
 * @param {((command: string) => boolean) | null} [reads]  whether a command only reads, read as its hand runs it
 * @returns {ReturnType<typeof gate> & { rule?: import("./rules.js").Rule, rules?: import("./rules.js").Rule[], note?: string, review?: true }}
 */
export function ruled(g, hit, name, input, root = "", reads = null) {
  if (!hit) return g;
  const { rule, subject } = hit;
  if (hit.verdict === "gate") return g.verdict === "refuse" ? g : { ...g, note: `the rule ${describeRule(rule)} does not run \`${subject}\` — ${hit.why}; the gate decides` };
  if (hit.verdict === "deny") return { verdict: "refuse", rule, text: denialText(name, rule, subject) };
  if (g.verdict === "refuse") return g;
  if (hit.verdict === "review") {
    if (isCommandHand(name) && !input?.press && reads?.(String(input?.command ?? ""))) return { ...g, note: `the rule ${describeRule(rule)} leaves \`${subject}\` to the gate — it only reads` };
    const question = g.verdict === "ask" ? g.question : input?.press || FOREGROUND_SHELLS.has(name) || name === "write" || name === "edit" ? permissionQuestion(name, input, null, root) : `May I run ${name} (${argSummary(name, input)})?`;
    return { verdict: "ask", rule, review: true, question: `${question} A rule of this session asks for a second look first.`, ...(g.verdict === "ask" && g.why ? { why: g.why } : {}) };
  }
  // A button that sends asks whatever a rule allows: only the person's tick on that button lets an agent press it unasked.
  // So does a link made into the folder, or a deep delete through one (agent/link-guard.js).
  if (hit.verdict === "allow") return g.verdict === "ask" && !("sends" in g && g.sends) && !("links" in g && g.links) ? { verdict: "run", rule, rules: hit.rules } : g;
  if (g.verdict !== "run") return g;
  const question = input?.press || FOREGROUND_SHELLS.has(name) || name === "write" || name === "edit"
    ? permissionQuestion(name, input, null, root)
    : `May I run ${name} (${argSummary(name, input)})? A rule of this session asks first — answer /allow to run it, or say what to do instead.`;
  return { verdict: "ask", rule, question };
}

/** Why the reader did not pass a command, as the model and the developer read it (AH-F2). @param {string} why @param {string} [what] */
const cannotTell = (why, what = "this command") => `Filament cannot tell that ${what} only reads inside the working folder: ${why}`;

/**
 * Read-only's refusal of a hand, in the words the model reads. After a yes the mode no longer allows (the session went
 * read-only while the question waited — HarnessV3-AtHome AH-F1), the yes is said first. A bash command read-only runs
 * when it only reads (AH-F2): `why` is the reader's reason this one does not.
 * @param {string} name @param {{ yes?: boolean, why?: string | null }} [o]
 */
export function readOnlyRefusal(name, { yes = false, why = null } = {}) {
  const lead = yes ? "the developer said yes, but this session is read-only now" : "this session is read-only";
  if (why) return `Not run: ${lead}, and ${cannotTell(why)}. Say precisely what you would run and why instead.`;
  const mcp = isMcpTool(name);
  const what = isCommandHand(name) || mcp ? (mcp ? "call" : "run") : "change";
  return `Not run: ${lead}, so ${name} is not available. Say precisely what you would ${what} and why instead.`;
}

/**
 * A sub-agent's refusal of a call the gate or a rule would ask about, when nobody can answer it: one the session's
 * agent launched never asks, one that started by itself has nobody waiting on it (HarnessV4_Tasks E15, AG-262), and
 * a team's worker, or one the developer launched, asks only in a session whose page can answer. `why`: the reader's
 * reason, when that is what asks (AH-F2). `who`: a worker's refusal sends the call to its lead, who can take it to
 * the developer; one that started by itself says it in its answer, where the developer reads it. A worker's words
 * name the approval alone: its questions still reach its lead (TG2-D58).
 * @param {string} name @param {string | null} [why] @param {Unanswered} [who]
 */
export const unattendedAsk = (name, why = null, who = "subagent") => {
  const what = why ? `${cannotTell(why)}. It` : name;
  if (who === "worker") return `Not run: ${what} needs the developer's approval, and in this session Filament cannot ask them for it. Say in your report exactly what you would have run and why — your lead will take it to the developer.`;
  if (who === "self") return `Not run: ${what} needs the developer's approval in this session, and you started by yourself: nobody is asked for you. Say in your answer exactly what you would have run and why — the developer reads it there.`;
  return `Not run: ${what} needs the developer's approval in this session, and a sub-agent cannot ask for it. Say in your report exactly what you would have run and why — the agent that launched you can do it.`;
};

/**
 * Whose refusal it is where nobody answers a sub-agent's call: a team's worker's, one that started by itself, or a
 * sub-agent's that somebody launched.
 * @typedef {"worker" | "self" | "subagent"} Unanswered
 */
/** @param {{ team?: unknown, self?: boolean }} host @returns {Unanswered} */
export const unansweredAs = (host) => (host.team ? "worker" : host.self ? "self" : "subagent");
/** Why such a call was refused, as its request's record says it. @type {Readonly<Record<Unanswered, string>>} */
export const NOBODY_ANSWERS = Object.freeze({
  worker: "nobody can approve a worker's call in this session",
  subagent: "nobody can answer inside a sub-agent",
  self: "nobody is asked for an agent that started by itself",
});

/**
 * The hands a permission mode lets a sub-agent use (HarnessV3-Memory M7-1: the tools its brief names the pitfalls of):
 * every hand the gate runs some call of in that mode — read-only refuses the writes and the commands, but not a bash
 * command that only reads (AH-F2), so bash is in every mode's.
 * @param {PermissionMode} mode @returns {string[]}
 */
export const handsIn = (mode) => HAND_TOOLS.map((t) => t.name).filter((name) => gate(mode, name, {}, null, undefined, () => ({ ok: true })).verdict !== "refuse");

/**
 * @param {string} name @param {any} input @param {string | null} [why]  the reader's reason a bash command asks (AH-F2)
 * @param {string} [root]  the folder the call works in (`intoGit`)
 * @param {string | null} [risk]  what a command makes or deletes that always asks (`linkWords`)
 */
export function permissionQuestion(name, input, why = null, root = "", risk = null) {
  // A dashboard's button pressed by an agent (HarnessV4_AgentsSpace_Plan SA-D4) asks with the button's sentence, and
  // what it runs exactly.
  const p = input?.press;
  if (p?.tool === true) return `May I run the tool “${p.label}” of “${p.dashboard}”?${p.says ? ` It says: ${p.says}` : ""} It runs \`${p.runs}\`${p.folder ? ` in ${p.folder}` : ""}${sendsAlways(input) ? ". It sends: it leaves this machine, so an agent's call of it always asks you" : ""} — answer /allow to run it, or say what to do instead.`;
  if (p) return `May I press “${p.label}” on “${p.dashboard}”?${p.says ? ` It says: ${p.says}` : ""} It runs \`${p.runs}\`${p.folder ? ` in ${p.folder}` : ""}${sendsAlways(input) ? ". It sends: it leaves this machine, so an agent's press of it always asks you" : ""} — answer /allow to press it, or say what to do instead.`;
  const what = argSummary(name, input);
  // A link made into the folder, or a deep delete through one, asks in every mode, saying why (agent/link-guard.js).
  const said = risk ? `${risk.charAt(0).toUpperCase()}${risk.slice(1)}, so Filament asks in every mode. Answer` : null;
  if (name === "bash") return `May I run this command? \`${what}\` — ${said || (why ? `${cannotTell(why, "it")}. Answer` : "answer")} /allow to run it, or say what to do instead.`;
  if (name === "powershell") return `May I run this PowerShell script? \`${what}\` — ${said || (why ? `${cannotTell(why, "it")}. Answer` : "answer")} /allow to run it, or say what to do instead.`;
  if (name === "bash_background")
    return `May I start this command in the background? \`${what}\` — ${said || "it keeps running across turns; answer"} /allow to start it, or say what to do instead.`;
  if (isMcpTool(name)) return `May I call ${name}${what ? ` with \`${what}\`` : ""}? Its server does not vouch for it as read-only — answer /allow to run it, or say what to do instead.`;
  const verb = name === "write" ? "write" : "edit";
  if (intoGit(input, root))
    return `May I ${verb} ${what}? It is in the repository's .git folder, where git keeps the commands it runs by itself (hooks, filters) — answer /allow to ${verb} it, or say what to do instead.`;
  if (outsideRoot(input, root))
    return `May I ${verb} ${what}? It is outside this chat's folder (${root}) — answer /allow to ${verb} this one, or say what to do instead.`;
  return `May I ${verb} ${what}? Answer /allow to ${verb} it, or say what to do instead.`;
}

/** How much of a command a card shows (HarnessV3-Views V6-9): all of it, up to a length nobody reads on a card — a
 *  heredoc that writes a file can run long. */
export const COMMAND_SHOWN = 20_000;

/**
 * A command as a card shows it (HarnessV3-Views V6-9): whole, its lines kept — the question's copy is cut at 160
 * characters onto one line — and redacted as the stored bodies are; past COMMAND_SHOWN characters, cut with how much
 * was left out. Null for a call that runs no command.
 * @param {string} name @param {any} input @returns {string | null}
 */
export function shownCommand(name, input) {
  if (!isCommandHand(name)) return null;
  return redactAndCap(String(input?.command ?? ""), COMMAND_SHOWN);
}

/** How much of a change a card shows (HarnessV3-ACP, AC3's drive D5): its lines, its characters, a line's characters,
 *  and the files of one request. It rides the run's `ask` event, which the run log keeps whole only under 256 KB a
 *  line. */
export const CHANGE_SHOWN = Object.freeze({ lines: 300, chars: 20_000, row: 1_000, files: 8 });
/** The largest file a write is shown against: past it, the write shows as its own text alone. */
const CHANGE_READ_BYTES = 1_048_576;

/** @typedef {import("../../core/types.js").FileChange} FileChange */

/**
 * A file as it stands, for a change shown against it: whether it is there, and its text — none past CHANGE_READ_BYTES,
 * for a file that is not text, or one that cannot be read.
 * @param {string} abs @returns {{ exists: boolean, text: string | null }}
 */
const fileNow = (abs) => {
  try {
    const st = statSync(abs, { throwIfNoEntry: false });
    if (!st) return { exists: false, text: null };
    if (!st.isFile() || st.size > CHANGE_READ_BYTES) return { exists: true, text: null };
    const buf = readFileSync(abs);
    return { exists: true, text: buf.subarray(0, 8192).includes(0) ? null : buf.toString("utf8").replace(/^\uFEFF/, "") };
  } catch {
    return { exists: true, text: null };
  }
};

/** A text's lines as a diff reads them: its line ends one way, and no line after its last one's end. Null for none.
 *  @param {string | null} t */
const bodyOf = (t) => {
  if (t == null || t === "") return null;
  const lf = t.replace(/\r\n/g, "\n");
  return lf.endsWith("\n") ? lf.slice(0, -1) : lf;
};

/**
 * An edit's ops among the file's own lines: each text it replaces found as written — the first time, or every time
 * where it replaces every one —, the lines each touches diffed, the file's other lines unchanged around them. Null when
 * one is not found as written, or two overlap: the edit then shows on its own (the hand may still place it, by its
 * looser match).
 * @param {string} text @param {{ oldText: string, newText: string, replaceAll: boolean }[]} edits
 * @returns {{ t: string, line: string }[] | null}  each line, kept ("="), removed ("-") or added ("+")
 */
function placedOps(text, edits) {
  const norm = text.replace(/\r\n/g, "\n");
  /** @type {{ from: number, to: number, put: string }[]} */
  const spans = [];
  for (const e of edits) {
    const old = e.oldText.replace(/\r\n/g, "\n");
    const put = e.newText.replace(/\r\n/g, "\n");
    let at = norm.indexOf(old);
    if (at < 0) return null;
    while (at >= 0) {
      spans.push({ from: at, to: at + old.length, put });
      at = e.replaceAll ? norm.indexOf(old, at + old.length) : -1;
    }
  }
  spans.sort((x, y) => x.from - y.from);
  for (let k = 1; k < spans.length; k++) if (spans[k].from < spans[k - 1].to) return null;
  const starts = [0];
  for (let i = 0; i < norm.length; i++) if (norm[i] === "\n") starts.push(i + 1);
  /** The line an offset is on. @param {number} at */
  const lineAt = (at) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= at) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  // The lines each span touches — through the line its end is on, so a text that ends a line takes the next one whole
  // — joined where two share a line or meet, so a run of changed lines reads as one.
  /** @type {{ l0: number, l1: number, spans: typeof spans }[]} */
  const regions = [];
  for (const s of spans) {
    const l0 = lineAt(s.from);
    const l1 = lineAt(s.to) + 1;
    const last = regions.at(-1);
    if (last && l0 <= last.l1) {
      last.l1 = Math.max(last.l1, l1);
      last.spans.push(s);
    } else regions.push({ l0, l1, spans: [s] });
  }
  const lines = norm.split("\n");
  const end = norm.endsWith("\n") ? lines.length - 1 : lines.length;
  /** @type {{ t: string, line: string }[]} */
  const ops = [];
  let line = 0;
  for (const r of regions) {
    for (; line < r.l0; line++) ops.push({ t: "=", line: lines[line] });
    const from = starts[r.l0];
    const was = lines.slice(r.l0, r.l1).join("\n");
    let made = "";
    let at = from;
    for (const s of r.spans) {
      made += norm.slice(at, s.from) + s.put;
      at = s.to;
    }
    made += norm.slice(at, from + was.length);
    // A region through the file's end takes its last line end on both sides: no line after it.
    const tail = was.endsWith("\n") && made.endsWith("\n") ? 1 : 0;
    ops.push(...lineDiff(was.slice(0, was.length - tail), made.slice(0, made.length - tail)));
    line = r.l1;
  }
  for (; line < end; line++) ops.push({ t: "=", line: lines[line] });
  return ops;
}

/**
 * A change as a card shows it (HarnessV3-ACP, AC3's drive D5): the file and what the call does to it, as one unified
 * patch, redacted as the stored bodies are and cut to CHANGE_SHOWN. A write (`content`) is shown against the file as it
 * stands — a new file's every line added; an edit (`edits`) as each text it replaces and its replacement, among the
 * file's own lines where each is found as written; a patch an agent wrote itself (Codex's `patch`) as it is; a deletion
 * (`deleted`) as the file's every line removed; a call that says no more than its file, as the file alone. Null for a
 * call that writes no file.
 * @param {string} name @param {any} input @param {string} root  the session's folder
 * @returns {FileChange | null}
 */
export function shownChange(name, input, root) {
  if (name !== "write" && name !== "edit") return null;
  const path = String(input?.path ?? input?.file_path ?? "");
  if (!path) return null;
  const abs = resolve(root || ".", path);
  const inside = root ? relative(root, abs) : "";
  const file = (inside && !inside.startsWith("..") && !isAbsolute(inside) ? inside : abs).split(sep).join("/");
  const now = fileNow(abs);
  const edits = typeof input?.content === "string" ? [] : editsIn(input);
  const every = edits.some((e) => e.replaceAll);
  const created = typeof input?.content === "string" && !now.exists;
  const deleted = input?.deleted === true;
  /** @type {{ patch: string, added: number, removed: number }} */
  let made = { patch: "", added: 0, removed: 0 };
  if (typeof input?.patch === "string") {
    let added = 0;
    let removed = 0;
    for (const l of input.patch.split("\n")) {
      if (l.startsWith("+") && !l.startsWith("+++")) added++;
      else if (l.startsWith("-") && !l.startsWith("---")) removed++;
    }
    made = { patch: input.patch, added, removed };
  } else if (typeof input?.content === "string")
    made = unifiedPatch(lineDiff(created ? null : bodyOf(now.text), bodyOf(input.content)), { file, created });
  else if (deleted && now.text != null) made = unifiedPatch(lineDiff(bodyOf(now.text), null), { file });
  else if (edits.length) {
    const ops = (now.text != null && placedOps(now.text, edits)) || edits.flatMap((e) => lineDiff(bodyOf(e.oldText), bodyOf(e.newText)));
    made = unifiedPatch(ops, { file });
  }
  const cut = capPatch(made.patch, { file, maxLines: CHANGE_SHOWN.lines, maxChars: CHANGE_SHOWN.chars, maxRow: CHANGE_SHOWN.row, shown: redactSecrets });
  return { file, patch: cut.patch, added: made.added, removed: made.removed, created, deleted, every, omitted: cut.omitted };
}

/**
 * A change as its call made it, read after it ran (HarnessV4_Four_Plan E22, FO-D1): what the input says, the file
 * unread — it has moved on since (FO-D4). An edit is each text it replaced and its replacement, a hunk of its own; a
 * write is the text it wrote, every line added, what the file held before not in the call (`wrote`, FO-D5). Redacted
 * and cut as a card's change (CHANGE_SHOWN). Null for a call that changes no file, and for one whose input holds no
 * change: Codex's names its file alone (FO-D10).
 * @param {string} name  the call's name, in any vocabulary @param {any} input
 * @returns {{ file: string, patch: string, added: number, removed: number, wrote: boolean, every: boolean, omitted: number } | null}
 */
export function madeChange(name, input) {
  const c = canonicalOf(name, input);
  if (!c || (c.kind !== "write" && c.kind !== "edit")) return null;
  const file = String(c.fields.path ?? "").replace(/\\/g, "/");
  if (!file) return null;
  const wrote = c.kind === "write";
  /** @type {{ oldText: string, newText: string, replaceAll?: boolean }[]} */
  const edits = wrote ? [] : (c.fields.edits || []).filter((/** @type {any} */ e) => typeof e?.oldText === "string" && typeof e?.newText === "string");
  if (wrote ? typeof c.fields.content !== "string" : !edits.length) return null;
  const made = wrote ? unifiedPatch(lineDiff(null, bodyOf(c.fields.content)), { file, created: true }) : editHunks(file, edits);
  const cut = capPatch(made.patch, { file, maxLines: CHANGE_SHOWN.lines, maxChars: CHANGE_SHOWN.chars, maxRow: CHANGE_SHOWN.row, shown: redactSecrets });
  return { file, patch: cut.patch, added: made.added, removed: made.removed, wrote, every: edits.some((e) => e.replaceAll), omitted: cut.omitted };
}

/**
 * Edits as one patch, each a hunk of its own, one after another: the file's places unknown, each one's lines are
 * numbered on from the one before's, with a line between that is in neither, so two never join.
 * @param {string} file @param {{ oldText: string, newText: string }[]} edits
 */
function editHunks(file, edits) {
  /** @type {string[]} */
  const rows = [];
  let added = 0;
  let removed = 0;
  let olds = 0;
  let news = 0;
  for (const e of edits) {
    const ops = lineDiff(bodyOf(e.oldText), bodyOf(e.newText));
    const one = unifiedPatch(ops, { file });
    added += one.added;
    removed += one.removed;
    for (const l of one.patch.split("\n").slice(2)) {
      const m = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(l);
      if (m) rows.push(`@@ -${Number(m[1]) + olds},${m[2]} +${Number(m[3]) + news},${m[4]} @@`);
      else if (l) rows.push(l);
    }
    olds += ops.filter((op) => op.t !== "+").length + 1;
    news += ops.filter((op) => op.t !== "-").length + 1;
  }
  return { patch: rows.length ? `--- ${file}\n+++ ${file}\n${rows.join("\n")}\n` : "", added, removed };
}

/**
 * What a card says beside a command it shows whole (V6-9), so neither says it twice: what the question says besides
 * the command — the reader's reason a bash command is not known to only read, or that a background command keeps
 * running. Null when it says nothing more.
 * @param {string} name @param {string | null} [why]  the reader's reason (AH-F2)
 */
export function commandReason(name, why = null) {
  if (name === "bash_background") return "It starts in the background and keeps running across turns.";
  return why ? `${cannotTell(why, "it")}.` : null;
}

/**
 * The command a client that draws no card allows a waiting call with: its message is the command alone. The harness's
 * card says it by its press instead (`allow` on the turn, a house header). Nothing reads the person's words for a yes:
 * any other message answers the call "Not run", and the agent reads it.
 */
export const ALLOW_COMMAND = "/allow";
/** Whether a message is the /allow command, alone. @param {string} text */
export const isAllowCommand = (text) => String(text || "").trim().toLowerCase() === ALLOW_COMMAND;

/**
 * The useful half of a tool call for the run's timeline: the path or pattern for the file tools, the clipped
 * command for bash, the question for ask, the item count for plan. Never the file content or the edit text; a
 * command or a question may quote a credential, so those two pass through the same redaction the stored bodies do.
 * @param {string} name @param {any} input
 */
export function argSummary(name, input) {
  const inp = input || {};
  // An MCP tool's arguments are whatever its server defined: the JSON, clipped and redacted.
  if (isMcpTool(name)) return redactSecrets(clip(Object.keys(inp).length ? JSON.stringify(inp) : "", 160));
  switch (name) {
    case "bash":
    case "bash_background": // a command is a command in every spelling — the developer approves the same text
    case "powershell":
      return redactSecrets(clip(inp.command, 160));
    case "bash_output":
    case "bash_kill":
      return clip(inp.id, 40);
    case "grep":
    case "glob":
      return `${clip(inp.pattern, 80)}${inp.path ? ` in ${clip(inp.path, 80)}` : ""}`;
    case "web_fetch":
      return redactSecrets(clip(inp.url, 200));
    case "web_search":
      // Every search it runs, so an ask shows each of them (`queries`), never the first alone.
      return redactSecrets(clip(searchesOf(inp).join(" · "), searchesOf(inp).length > 1 ? 400 : 160));
    // What it lists or reads of the MCP servers' resources: the address it reads, else the server it lists.
    case MCP_RESOURCES:
      return redactSecrets(clip(`${String(inp.action ?? "")}${inp.uri ? ` ${inp.uri}` : inp.server ? ` ${inp.server}` : ""}`, 200));
    case BROWSER:
      return redactSecrets(clip(browserArgWords(inp), 200));
    // Of which place, file or name it asks the language server: its card's subject, under the ask as its title.
    case LSP:
      return clip(lspSubject(inp), 160);
    case "plan":
      return `${Array.isArray(inp.items) ? inp.items.length : 0} items`;
    // The skill it loads, by name (HarnessV4_SpacesPlugins_Plan B4); what it lists, reads or finds in its folder (S1-5).
    case "skill": {
      const act = String(inp.action ?? "").toLowerCase();
      const what = act === "find" ? String(inp.words ?? "") : act === "read" || act === "list" ? String(inp.path ?? "") : "";
      return clip(`${String(inp.name ?? "")}${act && act !== "load" ? ` ${act}${what ? ` ${what}` : ""}` : ""}`, 120);
    }
    // A letter, an answer to one, a picture, or how many sealed envelopes it opens (envelopes.js).
    case "envelope":
      return envelopeSummary(inp);
    case "tasks": {
      // Read as the graph runs it (E40's asMeant): tasks as JSON text or one alone, ids as text (the Hunter on E40).
      const m = /** @type {Record<string, any>} */ (asMeant(inp, { crew: "agent" }).input);
      const n = Array.isArray(m.tasks) ? m.tasks.length : 0;
      const ids = Array.isArray(m.ids) ? m.ids : m.id != null && m.id !== "" ? [m.id] : [];
      const what = (m.action === "add" || m.action === "change") && n ? ` ${n} task${n === 1 ? "" : "s"}` : ids.length ? ` ${ids.join(", ")}` : "";
      // A keep or a read of what is kept behind a task (E33): the note's title, and what else it keeps.
      if (m.action === "keep" || m.action === "read") {
        const files = Array.isArray(m.files) ? m.files.length : 0;
        const more = [typeof m.title === "string" && m.title.trim() ? ` "${m.title.trim()}"` : "", files ? ` +${files} file${files === 1 ? "" : "s"}` : "", typeof m.picture === "string" && m.picture.trim() ? ` +picture ${m.picture.trim()}` : "", Array.isArray(m.forget) && m.forget.length ? ` −${m.forget.length}` : ""].join("");
        return redactSecrets(clip(`${m.action}${what || " the graph"}${more}`, 120));
      }
      return clip(`${m.action || "?"}${what}`, 120);
    }
    case "report":
      return `${clip(inp.status, 20) || "?"}${inp.met === true ? ", acceptance met" : inp.met === false ? ", acceptance not met" : ""}`;
    case "ask":
      return redactSecrets(clip(inp.question, 200));
    case "ask_lead":
      // A coding agent's call that waits again names its question by its number (TG2-D49); a plan, sent as one while its
      // lead reviews it (TG2-D50), says so.
      if (inp.question == null && inp.plan == null && inp.ask != null) return `ask ${clip(String(inp.ask), 10)}, again`;
      return redactSecrets(typeof inp.plan === "string" && inp.plan.trim() ? `plan: ${clip(inp.plan, 194)}` : clip(inp.question, 200));
    case "delegate_read":
      return `${Array.isArray(inp.paths) ? inp.paths.length : 0} files: ${clip(inp.question, 120)}`;
    // A visual by its title, never its code; its guide by the kinds it was read for (HarnessV4_Visuals_Plan VS-D9).
    case SHOW_VISUAL:
      return clip(inp.title, 80);
    case VISUAL_GUIDE:
      return clip((Array.isArray(inp.kinds) ? inp.kinds : [inp.kinds]).filter((k) => k != null && k !== "").join(", "), 80);
    // An artifact by its action and its title or name, never its page (HarnessV4_Artifacts_Plan AFC-52).
    case ARTIFACT: {
      const what = inp.title || inp.id || (inp.action === "guide" ? inp.type || "page" : inp.action === "list" ? inp.query : "");
      return clip(`${inp.action || "?"}${what ? ` ${what}` : ""}`, 100);
    }
    // The Space by its action and what it names: a task, a line's first words, the guide's topic, where a task or a
    // draft goes; a guided action's fields read as the tool reads them, in `with` or beside `action` (E39).
    case SPACE: {
      const w = spaceFields(inp) ?? inp;
      const action = String(w.action ?? "").trim().toLowerCase();
      // An app's tool by the app and the tool (the owner's of 11-05); a watcher's guidance by its first words.
      const guidance = action === "routine" && typeof w.guidance === "string" && w.guidance.trim() ? `guidance ${clip(w.guidance.replace(/\s+/g, " ").trim(), 80)}` : "";
      const what = action === "log" ? clip(w.text, 80) : action === "guide" ? w.topic || "" : action === "app" && w.tool ? `${w.name ?? w.app ?? "?"} ${w.tool}` : guidance || w.title || w.id || "";
      const to = action === "draft" ? draftWhere(w) : w.to;
      return redactSecrets(clip(`${action || "?"}${what ? ` ${what}` : ""}${to ? ` → ${to}` : ""}`, 120));
    }
    // A team beside by its action, the team and the first words of what it was asked; its action as the tool takes it
    // (core/beside.js `besideAction`: any case, and `fire` as send).
    case BESIDE_TEAM: {
      const action = besideAction(inp.action);
      return redactSecrets(clip(action === "send" ? `send ${clip(inp.team, 40) || "?"}: ${clip(inp.ask, 80)}` : action || "?", 130));
    }
    // A flow by its action and its title, or how many steps it draws.
    case FLOW_NAME:
      return redactSecrets(clip(`${inp.action || "?"}${inp.title ? ` ${clip(inp.title, 80)}` : Array.isArray(inp.steps) ? ` ${inp.steps.length} steps` : ""}`, 120));
    // A thread by its title, or its brief's first line: its card's subject while it starts.
    case THREAD:
      return redactSecrets(clip(String(inp.title ?? "").trim() || String(inp.brief ?? "").trim().split("\n")[0], 120));
    // The skill a crafter chat crafts, by its action and what it acts on.
    case CRAFT_NAME:
      return redactSecrets(clip(`${inp.action || "?"}${inp.name ? ` ${clip(inp.name, 64)}` : inp.path ? ` ${clip(inp.path, 80)}` : inp.words ? ` ${clip(inp.words, 80)}` : Array.isArray(inp.paths) ? ` ${inp.paths.length} path${inp.paths.length === 1 ? "" : "s"}` : ""}`, 120));
    case "agent":
      // Its stop of a sub-agent is no task: whom it stops, as a lead's worker tool says its own.
      if (inp.stop === true && inp.agent_id) return `${clip(inp.agent_id, 40)}: stop it`;
      return redactSecrets(clip(inp.description || inp.prompt, 120));
    case "worker":
      // A lead that reads along: its answer to the worker's waiting call, and its reads (TG2-D41, TG2-D14, TG2-D56).
      // Its answer names the question by its number, a call's or one the worker asked it (TG2-D49).
      if (typeof inp.answer === "string" && inp.answer.trim()) return `${clip(inp.agent_id, 40)}: answer${inp.ask != null && String(inp.ask).trim() ? ` ask ${clip(String(inp.ask).trim().replace(/^ask\s*/i, ""), 10)}` : ""} — ${redactSecrets(clip(inp.answer, 120))}`;
      if (inp.show_trail === true) return `${clip(inp.agent_id, 40)}: read its rounds`;
      if (inp.show_changes === true) return `${clip(inp.agent_id, 40)}: read its change`;
      if (inp.show_report === true) return `${clip(inp.agent_id, 40)}: read its brief and reports`;
      // One message to every worker running now (TG2-D46).
      if (String(inp.agent_id ?? "").trim().toLowerCase() === "all") return `every worker running now: ${redactSecrets(clip(inp.prompt, 120))}`;
      return `${clip(inp.agent_id, 40)}: ${inp.stop === true ? "stop it" : inp.apply_changes === true ? "apply its changes" : `${inp.correction === true ? "a correction — " : ""}${redactSecrets(clip(inp.prompt, 120))}`}`;
    default:
      // A memory tool by what it looks for or keeps: its query, its words, the chat it loads, the memory it acts on —
      // its pill said the tool's own name while it ran.
      if (/^filament_memory_/.test(name)) return redactSecrets(clip(inp.query ?? inp.text ?? inp.session ?? inp.id ?? "", 160));
      return clip(inp.path || inp.file_path || "", 160);
  }
}
