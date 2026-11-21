// @ts-check
// HarnessV3-AtHome P2 step 3: the lead and its workers. A team's lead is the agent loop with a prompt and tools of its
// own — it reads, plans and briefs, and its workers, sub-agents in a role, do the work. Here, pure and against scripted
// registries: the prompts and the tools, the brief, the team's tool handlers (plain JSON in, plain JSON out, no loop
// behind them), a Reviewer handed its Builder's diff in a real repository, and the engine's answers for a coding
// agent's name, which keeps its own turn.
import { test, after } from "node:test";
import { engine } from "../src/app/pipeline/stages/engine.js";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROMPT, PROMPT_VERSION, TOOL_TEXT, readAlongReport, systemPromptFor } from "../src/app/agent/prompt.js";
import { HAND_TOOLS } from "../src/adapters/tools/hands.js";
import {
  FORK_REFUSALS, SUBAGENT_OFF, TEAM_AGENT_TOOL, TEAM_WAIT_TOOL, WAIT_TOOL, WORKER_TOOL, argSummary, isLoopTool,
  leadToolSetFor, loopToolArgs,
} from "../src/app/agent/tools.js";
import { briefText, checkBrief, createTeamTools } from "../src/app/agent/team-tools.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { loopSystem } from "../src/app/agent/system.js";
import { codingAgentOf, engineFor, engineProblem, engineProblemFor } from "../src/app/engine.js";
import { startAnatomy } from "../src/app/sessions/draft-start.js";
import { defaultConfig } from "../src/config.js";
import { estimateTokens } from "../src/core/tokens.js";
import { cardOf, kindOfName } from "../src/core/tool-vocab.js";
import { OUTCOME_KINDS, countCalls } from "../src/services/memory/outcomes.js";
import { SUBAGENT_VIEWS, sessionEngineOf } from "../src/services/session-settings.js";
import { SHIPPED_CREW, SHIPPED_MEMBERS as TEAM_ROLES, memberCard } from "../src/core/roster.js";
import { SHIPPED_CARDS } from "../src/services/agent-cards.js";
import { OUTCOME_FILTERS, outcomeWords } from "../src/ui/lib/outcomes.js";
import { openingWords } from "../src/ui/harness/lib/subagents.js";
import { until } from "./helpers/wait.js";
import { MEMBERS, membersOf } from "./helpers/roster.js";
import { teamStore } from "./helpers/team.js";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});
/** A folder of its own. */
const folder = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-team-"));
  made.push(dir);
  return dir;
};
/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
/** A repository with one committed file. */
const repo = () => {
  const dir = folder();
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, "a.txt"), "one\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
};
/** A promise and the hand that settles it. */
const deferred = () => {
  /** @type {(v?: any) => void} */
  let resolve = () => {};
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
/** The text blocks of a request's first message. @param {any} body */
const firstTexts = (body) => body.messages[0].content.map((/** @type {any} */ b) => b.text);

/**
 * A registry over `dir` whose front door is a scripted host, served as turn.js serves a sub-agent's run: attach, the
 * work in the folder the run works in (its worktree, else the session's), finish before the reply. `serve` does the
 * work and answers with the report; `sub` is the session's `subagents` section.
 * @param {string} dir
 * @param {{ sub?: any, serve?: (o: { id: string, body: any, cwd: string, n: number }) => Promise<string> | string }} [o]
 */
const teamRegistry = (dir, { sub = {}, serve = () => "DONE" } = {}) => {
  /** @type {{ body: any, headers: Record<string, string>, cwd: string, host: any }[]} */
  const posts = [];
  let n = 0;
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    context: {
      settings: () => ({ subagents: { pool: [{ model: "", seats: 8 }], ...sub }, loop: { permissions: "edit" } }),
      session: () => ({ cwd: dir, model: "m-session", projectId: null }),
      view: async () => ({ text: "User: fix the parser\nAssistant: On it.", turns: 1 }),
      brief: async () => null,
      modelProblem: () => null,
      mark: () => null,
      folderProblem: () => null,
    },
    call: async ({ body, headers = {} }) => {
      const id = headers["x-filament-subagent"];
      const host = registry.hostOf(id);
      const cwd = host?.workdir || String(headers["x-filament-cwd"]);
      posts.push({ body, headers, cwd, host });
      const runId = `run-${++n}`;
      registry.attach(id, runId);
      const report = await serve({ id, body, cwd, n });
      registry.finish(id, { status: "done", error: null, report, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: report }] }], rounds: 1, toolCalls: 0, tokensIn: 1, tokensOut: 1, spentUsd: 0.25, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: report }] }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  /** The request a sub-agent's run went out as — a writing one opens its worktree first, so the order is no guide. @param {unknown} id */
  const postOf = (id) => /** @type {(typeof posts)[number]} */ (posts.find((p) => p.headers["x-filament-subagent"] === id));
  return { registry, posts, postOf };
};

/** The team's own words for its members: none for its tester. */
const WORDS = { scout: "Map what exists.", builder: "Build against the contract.", tester: "", reviewer: "Review against the contract." };
const TEAM = { key: "architect", name: "Architect", members: membersOf(WORDS) };
/** The tag of the card a shipped seat runs as: the Scout Reviewer, the Tester Builder. @param {string} role @returns {"builder" | "reviewer"} */
const seatTag = (role) => /** @type {any} */ (memberCard(/** @type {any} */ (SHIPPED_CREW.find((m) => m.tag === role))));
/** That card. @param {string} role */
const seatCard = (role) => SHIPPED_CARDS[seatTag(role)];
const BRIEF = {
  role: "builder",
  description: "Fix the parser",
  goal: "parse() accepts an empty file",
  files: ["src/parse.js"],
  steps: ["Read src/parse.js", "Return [] for an empty input"],
  acceptance: "node --test test/parse.test.js passes",
  dont_touch: ["src/lex.js"],
};
/**
 * The lead's turn on a registry — its door, as turn.js opens it for a lead — and the call its wrapper hands the team's
 * tools: plain JSON. `round` is the loop's round as the door reads it.
 * @param {ReturnType<typeof createSubagentRegistry>} registry @param {string} dir
 */
const leadTurn = (registry, dir) => {
  /** @type {any[]} */
  const events = [];
  const at = { round: 3 };
  const door = registry.openTurn({ chainId: "c1", runId: "lead-1", cwd: dir, mode: null, model: "m-lead", thinking: null, fork: null, emit: (e) => events.push(e), lead: true, round: () => at.round });
  /** @param {any} input @param {string} [callId] @param {string} [runId] */
  const call = (input, callId = "toolu_1", runId = "lead-1") => ({ chainId: "c1", lead: { runId, callId }, cwd: dir, mode: null, model: "m-lead", thinking: null, team: TEAM, input });
  return { door, events, at, call, tools: createTeamTools({ registry }) };
};

// ---------------------------------------------------------------------------------------------------
// The prompts
// ---------------------------------------------------------------------------------------------------

// (fails before: yes — PROMPT_VERSION was 11, and the loop had one prompt: a lead was a coding agent that works itself)
test("the lead's prompt: its role, its team's persona, how it leads — workers by default, its own hands where they are the better call — and none of a coding agent's own lines but its hands and care", () => {
  assert.equal(PROMPT_VERSION, 129, "a team's lead and its workers made version 12, the lead's watch and its workers' asks 13, Validate and Autonomous 14, the task graph 15, its sub-agents' tasks 16, a lead's graph 17, a send-back to the last worker 18, a saved agent's card 19, the agents a session's agent may ask 20, every launch as a card 21, three ways its sub-agents pay 22, a sub-agent the developer launched waits for their answer 23, a lead that reads along with its workers 24, its answer to a worker that waits 25, a team that briefs, checks and answers as a real team does 26, a lead that looks when something is new, workers that ask it and plans it reviews 27, a coding agent's third read of a worker it leads 28, a team that works as engineers with a senior lead 29, a lead that reads what its workers say and do, never what they think 30, a lead's brief launched as attempts 31, a model that takes no tools told why it has none (HarnessV4_Tasks E4) 32, a task's check Filament runs itself (HarnessV3-TaskGraph-v2 V2-1) 33, a writing task's check its worker's report names (TG2-D63) 34, a task Filament runs itself, no model (V2-3) 35, the agent's checklist on its graph (V2-5) 36, a lead's own hands (HarnessV4_Tasks decision 9) 37, a sub-agent named by its model, provider and effort (HarnessV4_Tasks E23) 38, a saved agent that starts apart and the context window (the owner's words of 10-19) 39, a crew's models as an order with no seats of their own (U13-D12) 40, the agent's browser (HarnessV4_Browser_Plan BR2) 41, one kind of agent (HarnessV4_OneAgent_Plan OA1) 42, a result sealed as an envelope (HarnessV4_Envelopes_Plan EN1) 43, the envelope tool (EN2) 44, a picture opened by its name (HarnessV4_DesignPass_Plan UX1) 45, notes and files kept behind the graph's tasks (HarnessV4_TaskNotes_Plan E33) 46, a task paused with its checkpoint (HarnessV4_TaskGraphPlus_Plan E41 P1) 47, a done that proves its done-when (E41 P2) 48, report on the agent's own set while its graph is on, for a task started as its fork (the owner's words of 10-26) 49, the MCP tools that load on demand (E49) 50, the skills list in a fixed budget and the skill tool finding skills by words (the owner's word of 10-27) 54, reads side by side (the owner's word of 10-27) 55, a coding agent's launch that names its graph task (the Designer's of 10-28) 56, the product named Filament 57, an app the artifact tool makes (the owner's of 10-29) 58; the space tool's app action 59, the page guide's shelf 60, more reads 61; local webhooks 62; app glances 63; the app frame 64; an app's SQLite 65; a Space's apps as rows of the left bar 66; an imported app's .filament-web/ 67; a sub-agent's change marked as applied (10-29) 68; the task graph always on (10-29) 69; the app guide's folder and starters, New app's words the person's (10-29) 70; the team tool's models (10-30) 71; the team tool's note and status (10-30) 72; a sub-agent's task alone by default (10-31) 73; filament_recall's words without digests (10-31) 74; a task's found_by (11-02) 75; a graph task's work waiting for its apply (11-02) 76; a lead's orders run at once (11-03) 77; Builders' one lead (11-04) 78; a short job's checklist and a complex one's graph (11-04) 79; the lsp tool after the hands (11-04) 80; letters between an agent and its sub-agents (11-04) 81; a sub-agent's wait for a letter's reply, the lsp tool's shorter words (11-04) 82; what makes work complex enough for the graph, a short job never on it (11-05) 83; web_search's several searches at once (11-05) 84; a plan asked for alone, made whole and none of it started (11-05) 85; a command past its timeout in the background (11-05) 86; no number of agents at once of Filament's own, so no sentence of it (11-05) 87; no tool's words left wrong to keep the cache: who runs on what, left out (11-05) 88; one list the first that sets any, a lead's worker's as a launch takes it (11-05) 89; no em dash in a coding agent's tools or the texts they share (the owner's tool plan of 11-08) 94; the prompt pass of 11-08, each fact once where it is used 97; work of more than one step on the checklist or the graph, never neither (11-08) 98; the loop's tool texts said where they are used (11-08) 99; an apply that overlaps the folder's edits offers a way on (11-09) 100; what is still open takes dismiss (11-09) 101; writes as a forecast (11-09) 102; a follow-up to a sub-agent at work sent as a message, the graph's words given their freedom (11-09) 103; a done task reopened by start, several done in one call, a drop cutting the needs on it (11-09) 104; a lead's graph line saying version 98's rule, a report waiting sealed in a lead's words, the envelope sealing unless the chat takes results whole (11-09) 105; main's 105 merged with builds' s-tools hunt and Chrome on this machine for the browser (11-09) 106; Parallelize tasks' line naming a chat whose sub-agents work in its folder (11-09) 107; Filament's co-author line on a commit while its switch is on (11-10) 108; a coding agent's wait for its background commands too (11-10) 109 (its words are test/lead-reads.test.js's and test/lead-asks.test.js's; these are the lead's with that switch off, and the co-author line's off too)");
  const lead = { name: "Architect", persona: "You lead as an architect: boundaries first." };
  const p = systemPromptFor({ root: "/w", delegateRead: false, lead, environment: "# Environment\n- the machine" });
  assert.ok(p.startsWith(`${PROMPT.leadRole}\nWorking folder: /w\n\n# Your team: Architect\nYou lead as an architect: boundaries first.\n\n${PROMPT.headLead}\n${PROMPT.lead}\n${PROMPT.ambiguity}\n\n`), p.slice(0, 800));
  for (const line of [PROMPT.hands, PROMPT.leadPermission, PROMPT.plan, PROMPT.ask, PROMPT.teamAgent, PROMPT.leadCraft, PROMPT.leadCare, PROMPT.careLook, PROMPT.careAsk, PROMPT.care, PROMPT.talk, PROMPT.steering, PROMPT.context])
    assert.ok(p.includes(line), `the lead's prompt carries: ${line.slice(0, 70)}`);
  assert.ok(p.endsWith(`${PROMPT.headContext}\n${PROMPT.context}\n\n${PROMPT.leadReport}\n\n# Environment\n- the machine`), "its report line, then the session's Environment");
  for (const never of [PROMPT.role, PROMPT.permission, PROMPT.work, PROMPT.agent, PROMPT.agentRecipes, PROMPT.craft, PROMPT.report, PROMPT.subagentRole])
    assert.ok(!p.includes(never), `not the coding agent's: ${never.slice(0, 70)}`);
  assert.match(PROMPT.lead, /taking over a session already under way/, "the handoff: a session's earlier turns are history, their calls not the lead's tools");
  // (fails before: yes — the lead's prompt named a mode that held its orders for the developer's approval)
  assert.ok(!/Validate|Autonomous|your orders/.test(String(PROMPT.lead)), "its orders run at once: no mode to name");
  // (fails before: yes — HarnessV4_Tasks decision 9: a lead's own tools only read, and its lines said so)
  assert.match(PROMPT.lead, /^- Workers do the work\. Each worker is a sub-agent of Filament's, launched with the agent tool /m, "workers by default");
  assert.match(PROMPT.lead, /^- Brief a worker by default\. Do a piece yourself only where that is the better call: it is smaller than its brief would be — a one-line fix, a rename, a command that confirms a report; it is the glue between your workers' changes once you applied them; or workers have failed it twice\. Never change a file a worker of yours is changing now: its change would clash with yours\.$/m, "and when its own hands are the better call");
  assert.match(PROMPT.leadRole, /You plan the work, brief workers to do it, check what they report, and guide them until the task is done — taking a piece into your own hands only where that is the better call — /);
  assert.match(PROMPT.leadPermission, /^Your tools and your workers' run behind the developer's permission mode\. A call of yours that needs approval pauses until the developer answers, and a refused one means they declined it — adjust, don't retry verbatim\. /);
  assert.deepEqual([PROMPT.leadCraft.split("\n").length, PROMPT.leadCraft.split("\n").filter((l) => PROMPT.craft.split("\n").includes(l)).length], [PROMPT.craft.split("\n").length, PROMPT.craft.split("\n").length - 1], "the solo loop's craft, its line on calls made together the lead's own");
  // The operator's overlay speaks to the developer's own agent; a lead's words are its team's.
  assert.equal(systemPromptFor({ root: "/w", delegateRead: false, lead, overlay: "You are Bob." }), systemPromptFor({ root: "/w", delegateRead: false, lead }));
  // (fails before: no — a guard the mutation pass asked for: the turn's record says the overlay is in force when the
  // loop's system text carries one, and a lead's never does)
  const led = loopSystem({ cfg: { agentLoop: { systemPrompt: "You are Bob." } }, doc: null, root: "/w", lead });
  assert.deepEqual([led.overlay, led.text.includes("You are Bob.")], ["", false]);
  // A hand switched off is named in the lead's own line, as the solo loop's is: every hand is its (decision 9).
  const off = systemPromptFor({ root: "/w", delegateRead: true, lead, toolsOff: ["grep", "bash"], web: { fetch: true } });
  assert.ok(off.includes(`${PROMPT.toolsOff} bash, grep.`), "grep and bash are both the lead's");
  assert.ok(off.includes(PROMPT.delegateRead) && off.includes(PROMPT.webFetch), "a cheaper read and the web when the session offers them");
});

// (fails before: yes — a sub-agent's prompt had no role, no team and no acceptance check)
test("each worker's prompt: a worker's role line, its role's own line and its team's words for it, a sub-agent's work and care, and a report against its acceptance check", () => {
  for (const role of TEAM_ROLES) {
    const words = WORDS[/** @type {keyof typeof WORDS} */ (role)];
    const p = systemPromptFor({ root: "/w", delegateRead: false, toolsOff: SUBAGENT_OFF, subagent: true, card: seatCard(role), worker: { team: "Architect", words } });
    const head = [PROMPT.workerRole, seatCard(role).thinks, ...(words ? [`Team Architect asks of you: ${words}`] : []), "Working folder: /w"].join("\n");
    // Since version 29 a worker asks its lead where its task is ambiguous in a way that changes the result (TG2-D58).
    assert.ok(p.startsWith(`${head}\n\n${PROMPT.headWork}\n${PROMPT.work}\n${PROMPT.workerAmbiguity}\n\n`), `${role}: ${p.slice(0, 600)}`);
    for (const line of [PROMPT.hands, PROMPT.craft, PROMPT.subagentCareAsk])
      assert.ok(p.includes(line), `${role} carries: ${line.slice(0, 60)}`);
    // (fails before: yes — a worker read a sub-agent's line, that nobody can approve its call, and nothing of its
    // lead's messages)
    assert.ok(p.includes(`${PROMPT.workerPermission}\n${PROMPT.workerSteering}\n`), `${role}: the developer's answer, then its lead's messages`);
    assert.ok(p.endsWith(readAlongReport(PROMPT.workerReport, PROMPT.workerAsksLead)), `${role}'s report is against its acceptance check, and it may ask its lead`);
    for (const never of [PROMPT.subagentRole, PROMPT.subagentReadOnly, PROMPT.subagentReport, PROMPT.subagentPermission, PROMPT.leadRole, PROMPT.headTalk, PROMPT.steering, PROMPT.agent, PROMPT.ask, PROMPT.plan])
      assert.ok(!p.includes(never), `${role} has none of: ${never.slice(0, 60)}`);
  }
  assert.match(seatCard("scout").thinks, /change nothing/);
  assert.match(SHIPPED_CARDS.reviewer.thinks, /change nothing/);
  assert.match(PROMPT.workerRole, /a change to review/, "what rides ahead of its brief is background");
  assert.match(PROMPT.workerReport, /acceptance check/);
  assert.match(PROMPT.workerPermission, /waits for the developer's answer where they can give one, and is refused where they cannot/);
  assert.match(PROMPT.workerSteering, /your team's lead/);
  assert.match(PROMPT.leadPermission, /your wait shows it waiting/);
});

// ---------------------------------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------------------------------

// (fails before: yes — every loop was offered the coding agent's hands, and agent launched a sub-agent from a prompt;
// then, until HarnessV4_Tasks decision 9, a lead's hands were read, grep and glob alone)
test("the lead's tools: every hand, then ask, plan, agent, worker and wait — frozen, one set per configuration", () => {
  const hands = HAND_TOOLS.map((t) => t.name);
  const set = leadToolSetFor({ delegateRead: false });
  assert.deepEqual(set.map((t) => t.name), [...hands, "lsp", "ask", "plan", "agent", "worker", "wait", "envelope", "visual_guide", "show_visual", "artifact", "space"]);
  assert.ok(["write", "edit", "bash", "bash_background"].every((n) => hands.includes(n)), "writing, editing and the shells among them");
  assert.ok(set.slice(0, hands.length).every((t, i) => t === HAND_TOOLS[i]), "the solo loop's hands, the same bytes");
  assert.ok(Object.isFrozen(set));
  assert.equal(leadToolSetFor({ delegateRead: false }), set, "the same bytes every tick");
  assert.deepEqual(leadToolSetFor({ delegateRead: true, disabled: ["glob"], web: { fetch: true, search: true } }).map((t) => t.name), [...hands.filter((n) => n !== "glob"), "lsp", "ask", "plan", "agent", "worker", "wait", "envelope", "visual_guide", "show_visual", "artifact", "space", "delegate_read", "web_fetch", "web_search"]);
  assert.deepEqual(loopToolArgs({ lead: true }).map((t) => t.name), set.map((t) => t.name), "the loop's one derivation knows the lead");
  assert.deepEqual(loopToolArgs({ lead: true, recall: true }).map((t) => t.name).at(-1), "filament_recall");
  assert.ok(!loopToolArgs({}).some((t) => t.name === "worker"), "a coding agent has no workers");
  // The agent tool of a team: a role and a brief, never a bare prompt.
  assert.equal(TEAM_AGENT_TOOL.name, "agent");
  assert.equal(TEAM_AGENT_TOOL.description, TOOL_TEXT.teamAgent);
  const s = TEAM_AGENT_TOOL.input_schema;
  assert.deepEqual(s.required, ["role", "description", "goal", "steps", "acceptance"]);
  assert.deepEqual(s.properties.role.enum, [...TEAM_ROLES]);
  assert.deepEqual([s.properties.steps.type, s.properties.steps.minItems, s.properties.files.type, s.properties.dont_touch.type], ["array", 1, "array", "array"]);
  assert.deepEqual(s.properties.context.enum, Object.keys(SUBAGENT_VIEWS).filter((v) => v !== "fork"), "a worker starts from its brief: it is never a fork");
  assert.equal(s.properties.review?.type, "string");
  assert.ok(!("prompt" in s.properties) && !("agent_id" in s.properties) && !("run_in_background" in s.properties) && !("subagent_type" in s.properties));
  assert.deepEqual([WORKER_TOOL.name, WORKER_TOOL.description, WORKER_TOOL.input_schema.required], ["worker", TOOL_TEXT.worker, ["agent_id"]]);
  // (fails before: yes — worker took agent_id, prompt and apply_changes: no stop, no correction; and since version 29,
  // TG2-D58, every lead answers its worker's question: answer and ask; and since version 100, the owner's of 11-09, its
  // apply that overlaps the folder's edits sends the change back with overlap)
  assert.deepEqual(Object.keys(WORKER_TOOL.input_schema.properties), ["agent_id", "prompt", "stop", "correction", "apply_changes", "overlap", "reason", "answer", "ask"]);
  assert.deepEqual(WORKER_TOOL.input_schema.properties.overlap.enum, ["send_back"]);
  assert.deepEqual(["stop", "correction", "apply_changes"].map((k) => WORKER_TOOL.input_schema.properties[k].type), ["boolean", "boolean", "boolean"]);
  assert.deepEqual([TEAM_WAIT_TOOL.name, TEAM_WAIT_TOOL.description, TEAM_WAIT_TOOL.input_schema], ["wait", TOOL_TEXT.teamWait, WAIT_TOOL.input_schema]);
  assert.match(TOOL_TEXT.teamAgent, /the goal and why, what to read first, the files, the steps in order, the acceptance check that proves it done \(with check, .*\), the other commands it may run, and what not to touch/);
  assert.equal(isLoopTool("worker"), true);
  assert.equal(argSummary("worker", { agent_id: "sa_12345678", prompt: "fix the test too" }), "sa_12345678: fix the test too");
  assert.equal(argSummary("worker", { agent_id: "sa_12345678", apply_changes: true }), "sa_12345678: apply its changes");
  // (fails before: yes — a stop read "sa_12345678: " with nothing after it, and a correction read as any follow-up)
  assert.equal(argSummary("worker", { agent_id: "sa_12345678", stop: true }), "sa_12345678: stop it");
  assert.equal(argSummary("worker", { agent_id: "sa_12345678", prompt: "say the major only", correction: true }), "sa_12345678: a correction — say the major only");
  // (fails before: yes — a lead's answer and its reads read as an empty message on its row: TG2-D41, seen on the page)
  assert.equal(argSummary("worker", { agent_id: "sa_12345678", answer: "no — keep the build folder" }), "sa_12345678: answer — no — keep the build folder");
  // (fails before: yes — TG2-D49: an answer may be to a question the worker asked its lead, so the row names its number)
  assert.equal(argSummary("worker", { agent_id: "sa_12345678", answer: "ISO dates", ask: 3 }), "sa_12345678: answer ask 3 — ISO dates");
  assert.equal(argSummary("ask_lead", { question: "Which date format?" }), "Which date format?");
  assert.equal(argSummary("ask_lead", { ask: 3 }), "ask 3, again");
  // (fails before: yes — TG2-D50, 2026-10-14: a plan sent as one drew an empty row, its words in no field the row read)
  assert.equal(argSummary("ask_lead", { plan: "Files: amounts.js. Steps: 1. parse. Proof: npm test." }), "plan: Files: amounts.js. Steps: 1. parse. Proof: npm test.");
  assert.equal(argSummary("worker", { agent_id: "sa_12345678", show_trail: true }), "sa_12345678: read its rounds");
  assert.equal(argSummary("worker", { agent_id: "sa_12345678", show_changes: true }), "sa_12345678: read its change");
  assert.deepEqual(TEAM_ROLES.map((r) => [r, seatCard(r).may]), [["scout", "read"], ["builder", "edit"], ["tester", "edit"], ["reviewer", "read"]], "each role is an agent's card, and its card says what it may do");
  assert.equal(FORK_REFUSALS.worker, "Not run: a sub-agent has no workers to follow up on — do the work yourself.");
  // A lead's calls are delegation in its outcome's counts.
  assert.equal(kindOfName("worker"), "subagent");
  assert.deepEqual(cardOf("worker", { agent_id: "sa_12345678", apply_changes: true }), { kind: "subagent", title: "worker", subject: "sa_12345678" }, "an apply's card names its worker");
  assert.equal(countCalls([{ name: "agent", input: BRIEF }, { name: "worker", input: { agent_id: "sa_12345678", prompt: "again" } }, { name: "read", input: { path: "a" } }]).delegated, 2);
});

// (fails before: yes — the brief was free text, its layout nobody's)
test("the brief: a launch's parts in one layout — task, goal, files, steps in order, the acceptance check, what not to touch — and the words that refuse one", () => {
  assert.equal(
    briefText(BRIEF),
    "Your task: Fix the parser\n\nGoal: parse() accepts an empty file\n\nFiles:\n- src/parse.js\n\nSteps:\n1. Read src/parse.js\n2. Return [] for an empty input\n\nAcceptance check: node --test test/parse.test.js passes\n\nDo not touch:\n- src/lex.js",
  );
  assert.equal(briefText({ ...BRIEF, files: [], dont_touch: undefined, steps: [" Look "] }), "Your task: Fix the parser\n\nGoal: parse() accepts an empty file\n\nSteps:\n1. Look\n\nAcceptance check: node --test test/parse.test.js passes", "an empty section is left out");
  assert.equal(checkBrief(BRIEF, MEMBERS), null);
  const refusals = [
    [{ ...BRIEF, agent_id: "sa_12345678" }, "agent launches a new worker — to message, stop or follow up on sa_12345678, or apply its changes, call worker with that agent_id"],
    [{ ...BRIEF, role: " " }, "role must be one of scout, builder, tester, reviewer"],
    [{ ...BRIEF, role: 7 }, "role must be one of scout, builder, tester, reviewer"],
    [{ role: "pm" }, "goal is required: your question to the agent you ask, whole"],
    [{ ...BRIEF, description: " " }, "description is required: three to five words naming the task"],
    [{ ...BRIEF, goal: undefined }, "goal is required: what must be true when the task is done"],
    [{ ...BRIEF, steps: [] }, "steps is required: what to do, in order, one non-empty step per item"],
    [{ ...BRIEF, steps: ["read", ""] }, "steps is required: what to do, in order, one non-empty step per item"],
    [{ ...BRIEF, steps: "read it" }, "steps is required: what to do, in order, one non-empty step per item"],
    [{ ...BRIEF, acceptance: "" }, "acceptance is required: the check that proves the task done"],
    [{ ...BRIEF, files: "src/parse.js" }, "files must be a list of non-empty strings"],
    [{ ...BRIEF, dont_touch: [3] }, "dont_touch must be a list of non-empty strings"],
    [{ ...BRIEF, review: "sa_12345678" }, "review is a reviewer's: it names the change a reviewer reads, and a builder takes none"],
  ];
  for (const [input, words] of refusals) assert.equal(checkBrief(input, MEMBERS), words);
  assert.equal(checkBrief(null, MEMBERS), "role must be one of scout, builder, tester, reviewer");
  assert.equal(checkBrief({ ...BRIEF, role: "reviewer", review: "sa_12345678" }, MEMBERS), null);
  // A role that is no worker's is a question to a saved agent: its goal is the question, and the launch says whether
  // the session names that agent.
  assert.equal(checkBrief({ role: "pm", goal: "Queue the fifth launch, or refuse it?" }, MEMBERS), null);
  assert.equal(checkBrief({ ...BRIEF, role: "manager" }, MEMBERS), null);
});

// ---------------------------------------------------------------------------------------------------
// The team's tool handlers: JSON in, JSON out, no loop behind them
// ---------------------------------------------------------------------------------------------------

// (fails before: yes — a sub-agent was launched only through the loop's door, from a prompt, by the turn's own call)
test("a launch per role: each worker runs on the session's pool as its role's type, from its brief alone, under the lead's turn — its report owed to the lead and worded for it", async () => {
  const dir = folder();
  const gate = deferred();
  const { registry, posts, postOf } = teamRegistry(dir, {
    sub: { pool: [{ model: "m-cheap", seats: 8 }] },
    serve: async ({ body }) => {
      await gate.promise;
      return `REPORT for ${firstTexts(body).at(-1).split("\n")[0]}`;
    },
  });
  const { door, events, at, call, tools } = leadTurn(registry, dir);
  /** @type {Record<string, any>} */
  const launched = {};
  for (const [n, role] of TEAM_ROLES.entries()) {
    const input = { ...BRIEF, role, description: `The ${role}'s task` };
    // The handlers take and give plain JSON: what crosses is what a wire would carry.
    const res = await tools.agent(JSON.parse(JSON.stringify(call(input, `toolu_${role}`))));
    assert.deepEqual(JSON.parse(JSON.stringify(res)), res);
    assert.equal(res.ok, true, res.text);
    launched[role] = res;
    const id = String(res.agentId);
    assert.match(id, /^sa_[0-9a-f]{8}$/);
    const explore = seatCard(role).may === "read";
    assert.equal(res.text, `Launched ${role} ${id} ("The ${role}'s task") in the background. Keep working: its report arrives as a message when it finishes, and this turn does not end before it does. To wait for it, call wait. To message or stop it while it works, or to ${explore ? "ask it more" : "follow up or apply its changes"} once it reports, call worker with agent_id "${id}". ${n + 1} running.`);
    assert.equal(res.note, `agent: launched ${role} ${id} (m-cheap) for team Architect in the background`);
    assert.deepEqual([res.wrote, res.spentUsd, res.toolCalls, res.roundIds], [false, 0, 0, []]);
  }
  await until(() => posts.length === 4, "every worker's run to go out");
  for (const role of TEAM_ROLES) {
    const id = launched[role].agentId;
    const { body, headers, host } = postOf(id);
    assert.equal(body.model, "agent/m-cheap", "workers run on the session's pool");
    assert.equal(headers["x-filament-subagent-of"], "lead-1", "the lead's turn launched it");
    assert.equal(headers["x-filament-permissions"], seatCard(role).may === "read" ? "read-only" : undefined, "a scout and a reviewer change nothing; a builder's and a tester's calls follow the session's mode");
    assert.deepEqual(firstTexts(body), [briefText({ ...BRIEF, role, description: `The ${role}'s task` })], "its brief, and nothing of the lead's conversation");
    // A seat under a name of the team's own carries it: the Scout and the Tester.
    const seat = role === seatTag(role) ? {} : { seat: `${role[0].toUpperCase()}${role.slice(1)}` };
    assert.deepEqual(host.team, { key: "architect", name: "Architect", role, place: seatTag(role), ...seat, words: WORDS[/** @type {keyof typeof WORDS} */ (role)] }, "the host writes its role's prompt from this");
    const seen = /** @type {any} */ (registry.get(id));
    assert.deepEqual([seen.engine, seen.team, seen.card.tag, seen.asked, seen.may, seen.origin, seen.background, seen.view], ["loop", { key: "architect", name: "Architect", role, place: seatTag(role), ...seat }, seatTag(role), false, seatCard(role).may, "agent", true, "none"]);
  }
  // Its events land on the lead's timeline under the call that launched it, at the round it was launched in.
  at.round = 5;
  assert.ok(door.inbox.owed(), "the lead's turn does not end before its workers report");
  gate.resolve();
  await door.inbox.owed();
  const start = events.find((e) => e.type === "subagent-start" && e.agentId === launched.builder.agentId);
  const end = events.find((e) => e.type === "subagent-end" && e.agentId === launched.builder.agentId);
  assert.deepEqual([start?.parent, start?.round, start?.background, end?.parent, end?.round], ["toolu_builder", 3, true, "toolu_builder", 3]);
  const reports = door.inbox.take();
  assert.equal(reports.length, 4);
  const builder = /** @type {any} */ (reports.find((d) => d.from === launched.builder.agentId));
  const id = launched.builder.agentId;
  assert.equal(builder.text, `[Filament: your builder ${id} ("The builder's task") finished. You asked it:\n${briefText({ ...BRIEF, description: "The builder's task" })}\n\nIts report:\nREPORT for Your task: The builder's task\n\nTo ask it more in the same context, call worker with agent_id "${id}".]`);
  assert.deepEqual([builder.spentUsd, builder.roundIds.length], [0.25, 1], "spent on the lead's turn, which launched it");
  door.close();
});

// (fails before: no — a guard the mutation pass asked for: an order that named the round its call was made in landed
// in the lead's round now, and passed every test)
test("an order the developer approved late lands its worker in the round its call was made in, though the lead has moved on", async () => {
  const dir = folder();
  const { registry } = teamRegistry(dir, { sub: { pool: [{ model: "m-cheap", seats: 8 }] } });
  const { door, events, at, call, tools } = leadTurn(registry, dir);
  at.round = 5;
  const late = await tools.agent({ ...call({ ...BRIEF, role: "scout", description: "Late" }, "toolu_late"), lead: { runId: "lead-1", callId: "toolu_late", round: 2 } });
  assert.equal(late.ok, true, late.text);
  await door.inbox.owed();
  const start = events.find((e) => e.type === "subagent-start" && e.agentId === late.agentId);
  assert.deepEqual([start?.parent, start?.round], ["toolu_late", 2]);
  door.close();
});

// (fails before: yes — no worker tool, and a launch named no team)
test("worker: a follow-up in the background under the lead's turn, an apply that has nothing to apply, and the words for an id it cannot reach or a call that says nothing to do", async () => {
  const dir = folder();
  const { registry, posts } = teamRegistry(dir, { serve: ({ n }) => (n === 1 ? "MAPPED" : "MAPPED AGAIN") });
  const { door, call, tools } = leadTurn(registry, dir);
  const scout = await tools.agent(call({ ...BRIEF, role: "scout", description: "Map the parser" }));
  const id = String(scout.agentId);
  await registry.settled(id);
  assert.equal(posts[0].body.model, "agent/m-lead", "no sub-agent model set: the lead's own");
  door.inbox.take();
  const again = await tools.worker(JSON.parse(JSON.stringify(call({ agent_id: ` ${id} `, prompt: "and the lexer" }, "toolu_3"))));
  assert.deepEqual(JSON.parse(JSON.stringify(again)), again);
  assert.equal(again.ok, true, again.text);
  assert.equal(again.text, `Scout ${id} took your follow-up in the background. Keep working: its report arrives as a message when it finishes, and this turn does not end before it does. To wait for it, call wait.`);
  assert.equal(again.note, `agent: a follow-up to scout ${id} (m-lead) in the background`);
  assert.ok(door.inbox.owed(), "a follow-up is owed to the lead too");
  await door.inbox.owed();
  assert.equal(posts[1].headers["x-filament-subagent-of"], "lead-1");
  assert.equal(posts[1].body.messages.at(-1).content.at(-1).text, "and the lexer", "in the context it already has");
  assert.match(door.inbox.take()[0].text, /^\[Filament: your scout sa_[0-9a-f]{8} \("Map the parser"\) finished\. You asked it:\nand the lexer\n\nIts report:\nMAPPED AGAIN\n\nTo ask it more in the same context, call worker with agent_id "sa_[0-9a-f]{8}"\.\]$/);
  const apply = await tools.worker(call({ agent_id: id, apply_changes: true }));
  assert.deepEqual([apply.ok, apply.text, apply.wrote], [false, `Nothing applied: sub-agent ${id} was read-only: it changed nothing. Your folder is as it was.`, false]);
  const words = [
    [{ prompt: "go on" }, "Nothing done: worker needs agent_id — the id the worker's launch answered with."],
    [{ agent_id: id }, "Nothing sent: worker needs prompt — your message or follow-up — or stop: true, or apply_changes: true."],
    [{ agent_id: "sa_00000000", prompt: "go on" }, "Nothing sent: no sub-agent sa_00000000 in this session (the person may have deleted it; a session keeps its newest 30, and every one whose work waits for the person's Apply)."],
  ];
  for (const [input, text] of words) {
    const r = await tools.worker(call(input));
    assert.deepEqual([r.ok, r.text], [false, text]);
  }
  assert.equal(posts.length, 2, "nothing more was sent");
  door.close();
});

// (fails before: no — a guard the mutation pass asked for: a worker's report that outlives its lead's turn waits for
// the session's next turn, which a lead reads)
test("a worker that reports after its lead's turn ended: the report waits for the session's next turn and names worker", async () => {
  const dir = folder();
  const gate = deferred();
  const { registry } = teamRegistry(dir, {
    serve: async () => {
      await gate.promise;
      return "MAPPED";
    },
  });
  const { door, call, tools } = leadTurn(registry, dir);
  const scout = await tools.agent(call({ ...BRIEF, role: "scout", description: "Map the parser" }));
  const id = String(scout.agentId);
  door.close();
  gate.resolve();
  await registry.settled(id);
  const queued = registry.peekQueued("c1");
  assert.equal(queued.length, 1);
  assert.ok(String(queued[0].text).endsWith(`To ask it more in the same context, call worker with agent_id "${id}".]`), queued[0].text);
});

// (fails before: yes — a launch had no lead to belong to)
test("a call from a lead whose turn is not the session's running one launches nothing, and a launch's refusals reach the lead in words", async () => {
  const dir = folder();
  const { registry, posts, postOf } = teamRegistry(dir, { sub: { view: "fork" } });
  const { door, call, tools } = leadTurn(registry, dir);
  const gone = await tools.agent(call(BRIEF, "toolu_1", "lead-0"));
  assert.deepEqual([gone.ok, gone.text], [false, "Not launched: the lead's turn lead-0 is not running in this session."]);
  const followed = await tools.worker(call({ agent_id: "sa_00000000", prompt: "x" }, "toolu_1", "lead-0"));
  assert.deepEqual([followed.ok, followed.text], [false, "Nothing sent: the lead's turn lead-0 is not running in this session."]);
  const bad = await tools.agent(call({ ...BRIEF, steps: [] }));
  assert.deepEqual([bad.ok, bad.text, bad.note], [false, "Not launched: steps is required: what to do, in order, one non-empty step per item.", "agent: a launch refused — steps is required: what to do, in order, one non-empty step per item"]);
  // A worker starts from its brief: the session's own choice of a fork is no worker's, and asking for one is refused.
  const forked = await tools.agent(call({ ...BRIEF, context: "fork" }));
  assert.deepEqual([forked.ok, forked.text], [false, "Not launched: a worker cannot be a fork: it starts from its brief — leave context out, or choose none, folded or window."]);
  // (fails before: no — a guard the mutation pass asked for: a view is one of the list, never a key every object has)
  const proto = await tools.agent(call({ ...BRIEF, context: "toString" }));
  assert.deepEqual([proto.ok, proto.text], [false, "Not launched: view must be one of none, folded, window."]);
  assert.equal(posts.length, 0, "nothing was launched");
  const plain = await tools.agent(call(BRIEF));
  assert.equal(plain.ok, true, plain.text);
  assert.equal(/** @type {any} */ (registry.get(String(plain.agentId))).view, "none", "the session's fork falls back to the brief alone");
  const viewed = await tools.agent(call({ ...BRIEF, role: "scout", context: "folded" }));
  assert.equal(viewed.ok, true, viewed.text);
  assert.match(viewed.note, /, folded view\) for team Architect/);
  await door.inbox.owed();
  assert.match(firstTexts(postOf(viewed.agentId).body)[0], /^<conversation view="folded" turns="1">/, "a view it was given rides ahead of its brief");
  door.close();
});

// (fails before: yes — a reviewer could not be handed a change, and a builder's apply was the agent tool's)
test("a Reviewer reads its Builder's change: the diff rides ahead of its brief while the folder still holds the files as they were; the lead applies the work through worker", async () => {
  const dir = repo();
  const gate = deferred();
  const { registry, posts } = teamRegistry(dir, {
    serve: async ({ body, cwd }) => {
      const brief = firstTexts(body).at(-1);
      if (/Your task: Add the note/.test(brief)) {
        writeFileSync(join(cwd, "note.txt"), "by the builder\n");
        writeFileSync(join(cwd, "plan.txt"), "step one\n");
        return "WROTE note.txt and plan.txt";
      }
      if (/Your task: Slow build/.test(brief)) await gate.promise;
      return "REVIEWED";
    },
  });
  const { door, call, tools } = leadTurn(registry, dir);
  const built = await tools.agent(call({ ...BRIEF, description: "Add the note" }));
  const builderId = String(built.agentId);
  await registry.settled(builderId);
  const report = door.inbox.take()[0].text;
  assert.match(report, /It worked in its own git worktree, so its changes are not in your folder yet: 2 files \(\+2 −0\) — note\.txt, plan\.txt\. To apply them, call worker with agent_id "sa_[0-9a-f]{8}" and apply_changes: true/, "the lead applies through worker");
  const review = { ...BRIEF, role: "reviewer", description: "Review the note", review: builderId.toUpperCase() };
  const reviewer = await tools.agent(call(review));
  assert.equal(reviewer.ok, true, reviewer.text);
  assert.match(reviewer.note, new RegExp(`^agent: launched reviewer sa_[0-9a-f]{8} \\(m-lead, reviewing ${builderId}\\) for team Architect in the background$`));
  await registry.settled(String(reviewer.agentId));
  const [change, brief] = firstTexts(posts[1].body);
  assert.ok(change.startsWith(`<change of="${builderId}" files="2">\nThe change ${builderId} made in its own git worktree, not applied yet: the folder you work in holds these files as they were before it. Background only — your task follows.\n\n`), change);
  assert.match(change, /\+by the builder\n[\s\S]*<\/change>$/);
  assert.equal(brief, briefText(review));
  assert.equal(posts[1].cwd, dir, "a reviewer reads in the session's folder");
  assert.equal(existsSync(join(dir, "note.txt")), false, "where the change is not yet");
  const detail = /** @type {any} */ (registry.detail(String(reviewer.agentId)));
  // (fails before: no — a guard the mutation pass asked for: the viewer counts the files of the change, not its blocks)
  assert.deepEqual(detail.opening.map((/** @type {any} */ b) => [b.kind, b.count]), [["review", 2]], "the viewer shows the change it was handed");
  // The lead applies the Builder's work: the change reaches the folder, and there is nothing left to review.
  const applied = await tools.worker(call({ agent_id: builderId, apply_changes: true }));
  assert.deepEqual([applied.ok, applied.wrote, applied.text], [true, true, `Applied the changes of sub-agent ${builderId} to your folder: 2 files (+2 −0) — note.txt, plan.txt.`]);
  assert.deepEqual([readFileSync(join(dir, "note.txt"), "utf8"), readFileSync(join(dir, "plan.txt"), "utf8")], ["by the builder\n", "step one\n"]);
  const late = await tools.agent(call(review));
  assert.deepEqual([late.ok, late.text], [false, `Not launched: ${builderId} has no change waiting to be applied (it changed nothing, or its work was applied) — brief the reviewer on the files instead, and leave review out.`]);
  const slow = await tools.agent(call({ ...BRIEF, description: "Slow build" }));
  const early = await tools.agent(call({ ...review, review: slow.agentId }));
  assert.deepEqual([early.ok, early.text], [false, `Not launched: ${slow.agentId} is still working: order its review once it reports.`]);
  gate.resolve();
  const unknown = await tools.agent(call({ ...review, review: "sa_00000000" }));
  assert.deepEqual([unknown.ok, unknown.text], [false, "Not launched: no work of sub-agent sa_00000000 waits in this session's repository — brief the reviewer on the files instead, and leave review out."]);
  await door.inbox.owed();
  door.close();
});

// ---------------------------------------------------------------------------------------------------
// The engine: a coding agent's name keeps its own turn, and a team needs its agent tool
// ---------------------------------------------------------------------------------------------------

// (fails before: yes — a coding agent's route under engine.mode team or agent reached the loop, which refused it (400))
test("a coding agent's name under a team: the team leads on the agent its route goes to first, never on one it only falls back to; under the agent loop it keeps its own turn, said on the record; a team whose session switched agent off cannot lead", () => {
  const teams = teamStore();
  const cfg = {
    experimental: { teams: true },
    agentLoop: { enabled: true },
    upstreams: [
      { id: "u", name: "u", type: "anthropic", baseUrl: "http://127.0.0.1:9", enabled: true },
      { id: "cli", name: "cli", type: "acp", command: "agent", enabled: true },
    ],
    routes: [
      { match: "brain-*", upstream: "u", upstreamModel: "{model}", enabled: true },
      { match: "coder-*", upstream: "cli", upstreamModel: "{model}", enabled: true },
      { match: "mix-*", upstream: "u", upstreamModel: "{model}", fallbacks: [{ upstream: "cli" }], enabled: true },
    ],
  };
  assert.deepEqual(["coder-one", "mix-one", "brain-model", "nothing-routes", ""].map((n) => codingAgentOf(cfg, n)), ["cli", "cli", null, null, null]);
  const arch = { mode: "team", team: "builders" };
  const fallsBack = `engine: "mix-one" falls back to the coding agent upstream "cli", which runs its own turns (a team leads on the agent loop with an API model on every model its route falls back to, or on a coding agent its route goes to first) — the request went to mix-one as named`;
  assert.deepEqual(engineFor(arch, cfg, { model: "coder-one", agent: null }, teams), { lead: { team: "builders" }, note: "engine: team Builders answers this session's turns (engine.team), its lead the coding agent coder-one" });
  assert.deepEqual(engineFor(arch, cfg, { model: "mix-one", agent: null }, teams), { note: fallsBack }, "the loop cannot fail over to an agent");
  assert.equal(engineFor(arch, cfg, { model: "brain-model", agent: null }, teams).agent?.team, "builders");
  assert.equal(engineFor(arch, cfg, { model: "mix-one", agent: { model: "mix-one" } }, teams).agent?.team, "builders", "a name the parse made the loop's keeps its lead");
  // A lead launches its workers with the agent tool: a session that switched it off has no team to lead it.
  // A team mode an older Filament saved is no part of it.
  assert.deepEqual(sessionEngineOf({ engine: arch, loop: { tools: { agent: false } } }), { mode: "team", team: "builders", agentOff: true });
  assert.deepEqual(sessionEngineOf({ engine: { ...arch, teamMode: "validate" }, loop: { tools: { bash: false } } }), { mode: "team", team: "builders", agentOff: false });
  const off = sessionEngineOf({ engine: arch, loop: { tools: { agent: false } } });
  assert.equal(engineProblem(off, cfg, teams), "engine.mode is team but this session switched the agent tool off (loop.tools.agent) — a team's lead launches its workers with it");
  assert.equal(engineProblem({ ...off, mode: "agent" }, cfg, teams), null, "the agent loop alone needs no agent tool");
  assert.deepEqual(engineFor(off, cfg, { model: "brain-model", agent: null }, teams), { note: "engine: engine.mode is team but this session switched the agent tool off (loop.tools.agent) — a team's lead launches its workers with it — the request went to brain-model as named" });
});

// (fails before: yes — since the review of b28b47713 a coding agent led no team in a chat memory leaves out, its turn
// there having run without the chat's surfaces, which rode memory's chain: the stage sent coder-one's turn as named, its
// note saying the agent "leads a team only in a chat memory works in, and memory leaves this chat out", the Memory
// setting's words after it where one was why. The turn rides the chat's session now, and memory keeps out of its team's
// work — test/team-agent-lead.test.js drives it)
test("in a chat memory leaves out, a team leads as in any chat: on the loop, and on the coding agent its route goes to first, whatever leaves the chat out", async () => {
  const teams = teamStore();
  const cfg = {
    experimental: { teams: true },
    agentLoop: { enabled: true },
    upstreams: [
      { id: "u", name: "u", type: "anthropic", baseUrl: "http://127.0.0.1:9", enabled: true },
      { id: "cli", name: "cli", type: "acp", command: "agent", enabled: true },
    ],
    routes: [
      { match: "brain-*", upstream: "u", upstreamModel: "{model}", enabled: true },
      { match: "coder-*", upstream: "cli", upstreamModel: "{model}", enabled: true },
    ],
  };
  const arch = { mode: "team", team: "builders" };
  assert.equal(engineProblemFor(arch, cfg, { model: "coder-one", agent: null }, teams), null);
  /**
   * A harness turn memory leaves out, on `model`: for a Memory setting, in its words, or for a reason of memory's own.
   * @param {string} model @param {() => string | null} excluded
   */
  const turnOn = async (model, excluded) => {
    /** @type {any} */
    const ctx = { memory: { sit: null, settingsOnly: { settings: { engine: arch }, composed: true }, excluded }, pre: { api: "session" }, house: false, body: { model }, agent: null };
    await engine(ctx, /** @type {any} */ ({ config: () => cfg, memory: {}, teams }));
    return { lead: ctx.lead || null, team: ctx.agent?.team || null, notes: ctx.notes || [] };
  };
  for (const excluded of [() => 'model "coder-one" is excluded in Memory settings', () => null]) {
    assert.deepEqual(await turnOn("coder-one", excluded), { lead: { team: "builders" }, team: null, notes: ["engine: team Builders answers this session's turns (engine.team), its lead the coding agent coder-one"] });
    assert.deepEqual(await turnOn("brain-model", excluded), { lead: null, team: "builders", notes: ["engine: team Builders answers this session's turns (engine.team), its lead on brain-model"] });
  }
});

// (fails before: yes — the review of 38673a79a: the engine read a situate that failed as memory leaving the chat out, so
// in a chat whose team a coding agent leads, that turn went to the agent as named, with no team, and its note said memory
// leaves the chat out. Until a coding agent led in a chat Memory settings leave out, one they left out went so too)
test("a turn whose situate failed is led by its chat's team: its coding agent leads, a Memory setting leaving the chat out or not", async () => {
  const teams = teamStore();
  const cfg = {
    experimental: { teams: true },
    agentLoop: { enabled: true },
    upstreams: [{ id: "cli", name: "cli", type: "acp", command: "agent", enabled: true }],
    routes: [{ match: "coder-*", upstream: "cli", upstreamModel: "{model}", enabled: true }],
  };
  const arch = { mode: "team", team: "builders" };
  /** A harness turn on coder-one whose situate failed, `excluded` saying why where Memory settings leave it out. @param {() => string | null} excluded */
  const turnOn = async (excluded) => {
    /** @type {any} */
    const ctx = { memory: { sit: null, settingsOnly: { settings: { engine: arch }, composed: true }, failed: true, excluded }, pre: { api: "session" }, house: false, body: { model: "coder-one" }, agent: null };
    await engine(ctx, /** @type {any} */ ({ config: () => cfg, memory: {}, teams }));
    return { lead: ctx.lead || null, notes: ctx.notes || [] };
  };
  const leads = { lead: { team: "builders" }, notes: ["engine: team Builders answers this session's turns (engine.team), its lead the coding agent coder-one"] };
  assert.deepEqual(await turnOn(() => null), leads);
  assert.deepEqual(await turnOn(() => 'model "coder-one" is excluded in Memory settings'), leads, "a chat Memory settings leave out: led as any chat");
});

// (fails before: yes — a team's draft weighed the loop's own prompt and tools; then, until HarnessV4_Tasks decision 9,
// a lead had no MCP server of the session's)
test("the New Task board weighs a team's lead as it will send: its prompt and its tools, the session's MCP servers among them", () => {
  const teams = teamStore();
  const cfg = {
    ...defaultConfig(),
    experimental: { ...defaultConfig().experimental, teams: true },
    agentLoop: { ...defaultConfig().agentLoop, enabled: true, readerModel: "" },
    upstreams: [{ id: "u", name: "u", type: "anthropic", baseUrl: "http://127.0.0.1:9", enabled: true }],
    routes: [{ match: "brain-*", upstream: "u", upstreamModel: "{model}", enabled: true }],
  };
  const cwd = folder();
  const mcp = [{ name: "notes", command: process.execPath, args: ["x.mjs"] }];
  const eff = { model: { name: "brain-model" }, engine: { mode: "team", team: "builders" }, plugins: { mcp } };
  const led = startAnatomy({ cfg, eff, cwd, projectId: "p1", teams });
  const solo = startAnatomy({ cfg, eff: { model: { name: "brain-model" }, plugins: { mcp } }, cwd, projectId: "p1", teams });
  assert.equal(led.engine.kind, "team");
  assert.deepEqual(led.tools.offered, [...HAND_TOOLS.map((t) => t.name), "lsp", "ask", "plan", "tasks", "agent", "worker", "wait", "envelope", "visual_guide", "show_visual", "artifact", "space"]);
  assert.deepEqual([led.tools.mcp, solo.tools.mcp], [["notes"], ["notes"]], "the session's MCP servers are its lead's as well as its workers'");
  const arch = /** @type {any} */ (teams.find("builders"));
  // A lead reads along with its workers where the session says nothing (HarnessV3-TaskGraph-v2 TG2-D21): the board
  // weighs that lead's prompt and tools, and the other's where the session says it does not — each with its task graph.
  const sys = loopSystem({ cfg, doc: eff, root: cwd, lead: { name: arch.name, persona: arch.persona }, supervise: true, graph: true });
  assert.ok(sys.text.includes(`# Your team: Builders\n${arch.persona}`));
  // The space tool rides in every project's chat from its first message (team_v2_plan TV2-D7), a lead's too; a draft of
  // no project has none.
  assert.equal(led.loopFixed, estimateTokens(sys.text) + estimateTokens(JSON.stringify(loopToolArgs({ lead: true, supervise: true, graph: true }))), "the lead's prompt and tools, as the loop will send them");
  const none = startAnatomy({ cfg, eff, cwd, projectId: "none", teams });
  assert.deepEqual([none.tools.offered.includes("space"), none.loopFixed], [false, estimateTokens(sys.text) + estimateTokens(JSON.stringify(loopToolArgs({ lead: true, supervise: true, graph: true, disabled: ["space"] })))], "no project: no Space");
  assert.notEqual(led.loopFixed, solo.loopFixed);
  const plain = startAnatomy({ cfg, eff: { ...eff, engine: { ...eff.engine, supervise: false } }, cwd, projectId: "p1", teams });
  const before = loopSystem({ cfg, doc: eff, root: cwd, lead: { name: arch.name, persona: arch.persona }, graph: true });
  assert.equal(plain.loopFixed, estimateTokens(before.text) + estimateTokens(JSON.stringify(loopToolArgs({ lead: true, graph: true }))), "a lead that does not read along");
});

// ---------------------------------------------------------------------------------------------------
// Memory and the surfaces
// ---------------------------------------------------------------------------------------------------

// (fails before: yes — an outcome was a turn's or a sub-agent's; a worker's run read as a plain sub-agent's)
test("a worker's exchange is an outcome of its own kind, filtered and named on the Outcomes panel; the viewer names the change a reviewer was handed", () => {
  assert.deepEqual(OUTCOME_KINDS, ["turn", "subagent", "worker"]);
  assert.deepEqual(OUTCOME_FILTERS.find((f) => f.value === "worker"), { value: "worker", label: "Team workers", noun: "team worker runs" });
  assert.equal(outcomeWords({ kind: "worker", model: "m", runs: 2, held: 1, done: 2, failed: 0, stopped: 0, corrected: 1, rounds: 3, ms: 1200, usdPerRun: 0.1, usd: 0.2, priced: 2, did: [] }).runs, "2 team worker runs");
  const viewer = readFileSync("src/ui/harness/subagent-viewer.js", "utf8");
  assert.deepEqual([openingWords({ kind: "review", count: 2 }), openingWords({ kind: "review", count: 1 })], ["The change it reviews · 2 files", "The change it reviews · 1 file"]);
  assert.match(viewer, /const patch = b\.kind === "review" \|\| b\.kind === "changes";[\s\S]{0,200}?: patch \? ICONS\.fileDiff : /);
});
