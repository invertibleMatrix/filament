// @ts-check
// HarnessV3-TaskGraph-v2 TG2-D56 (§13.16): a coding agent that leads a team compacts its own context mid-turn, and
// Filament tells it how its team stands — a line for each worker of the turn, oldest first, a change that waits with its
// report whole — while one of them runs or has a change waiting; a lead that reads along has a third read of a worker,
// show_report: its brief and its reports whole. First the words over a stub registry (team-tools.js), then the lead's
// turn over a scripted registry (agent-lead.js, agent-inbox.js, subagents.js), then the live app: a team led by a fake
// agent (fixtures/fake-acp-agent.mjs, Claude's shape) that compacts while its worker runs on the agent loop.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLeadTurn } from "../src/app/agent-lead.js";
import { noSuchSubagent } from "../src/app/agent/subagents.js";
import { ENDED_MOST, briefText, createTeamTools, endedWorkers, inputRefusal } from "../src/app/agent/team-tools.js";
import { PROMPT, TOOL_TEXT } from "../src/app/agent/prompt.js";
import { WORKER_READS_OWN_TOOL, WORKER_READS_TOOL, argSummary } from "../src/app/agent/tools.js";
import { BRIEF, TEAM, leadOf, running, watched } from "./helpers/team.js";
import { FAKE_ACP_AGENT, anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { until } from "./helpers/wait.js";

// ---- the words, over a stub registry --------------------------------------------------------------------------------

/** A running exchange's progress, at its round. @param {number} round @param {Record<string, unknown>} [more] */
const progress = (round, more = {}) => ({ round, tool: null, context: null, compactions: [], words: "", call: null, wait: null, spent: null, asking: null, check: null, bounce: null, ...more });
/** A brief as Filament lays one out, for a task of these words. @param {string} description @param {string} goal */
const brief = (description, goal) => briefText({ ...BRIEF, description, goal });
/** A change waiting in a worker's worktree: its files and lines. @param {number} pending @param {number} added @param {number} removed */
const work = (pending, added, removed, applied = 0) => ({ pending, added, removed, applied, files: [], open: false });

/** The session's sub-agents, as its surfaces see them (the registry's `get` and `detail`), and their reports whole. */
const SUBS = [
  { id: "sa_1", team: { role: "builder" }, description: "Fix the parser", status: "running", progress: progress(3), exchanges: [{ prompt: brief("Fix the parser", "parse() accepts an empty file"), by: "agent", status: "running" }] },
  {
    id: "sa_2",
    team: { role: "builder" },
    description: "Add the flag",
    status: "done",
    work: work(2, 14, 3),
    checked: { command: "npm test", exit: 0 },
    exchanges: [{ prompt: brief("Add the flag", "--flag parses"), by: "agent", status: "done", report: "## Summary\nAdded --flag to the parser.\n\nTests: `npm test` passes." }],
  },
  { id: "sa_3", team: { role: "scout" }, description: "Map the tests", status: "done", exchanges: [{ prompt: brief("Map the tests", "know where the tests are"), by: "agent", status: "done", report: "**The tests live in test/.**\nOne file per module." }] },
  { id: "sa_4", team: { role: "builder" }, description: "Rename the flag", status: "done", work: work(0, 0, 0, 1), exchanges: [{ prompt: brief("Rename the flag", "it reads --fast"), by: "agent", status: "done", report: "Renamed it." }] },
  { id: "sa_5", team: { role: "builder" }, description: "Try the cache", status: "stopped", exchanges: [{ prompt: brief("Try the cache", "a warm run is quicker"), by: "agent", status: "stopped", report: "Stopped before the cache." }] },
  { id: "sa_6", team: { role: "builder" }, description: "Speed it up", status: "failed", exchanges: [{ prompt: brief("Speed it up", "the parse is quicker"), by: "agent", status: "failed", error: "the provider refused the request" }] },
  {
    id: "sa_7",
    team: { role: "builder" },
    description: "Check the docs",
    status: "running",
    progress: progress(1),
    exchanges: [
      { prompt: brief("Check the docs", "the docs say --flag"), by: "agent", status: "done", report: "DOCS CHECKED." },
      { prompt: "Also the README.\nKeep it short.", by: "agent", status: "running" },
    ],
  },
  {
    id: "sa_8",
    team: { role: "builder" },
    description: "Fix the lexer",
    status: "done",
    work: work(1, 2, 0),
    checked: { command: "npm test", exit: 1 },
    exchanges: [
      { prompt: brief("Fix the lexer", "the lexer reads tabs"), by: "agent", status: "done", report: "FIRST TRY." },
      { prompt: "[Filament: you reported, and Filament ran your brief's check…]", by: "agent", status: "done", bounce: 1, report: "Tabs are read now." },
    ],
  },
  { id: "sa_9", team: null, asked: true, card: { tag: "critic", name: "Critic" }, description: "Is the plan sound?", status: "done", exchanges: [{ prompt: "Is the plan sound?", by: "agent", status: "done", report: "Sound, but split step 2." }] },
  { id: "sa_t", team: { role: "builder" }, task: "t1", description: "Task t1", status: "done", work: work(1, 4, 0), checked: { command: "npm test", exit: 0 }, exchanges: [{ prompt: brief("Task t1", "t1 is done"), by: "agent", status: "done", report: "T1 DONE." }] },
  { id: "sa_d", team: null, origin: "owner", description: "The developer's own", status: "running", progress: progress(1), exchanges: [{ prompt: "Look around.", by: "owner", status: "running" }] },
  { id: "sa_x", chainId: "another", team: { role: "builder" }, description: "Another session's", status: "running", progress: progress(1), exchanges: [{ prompt: brief("x", "y"), by: "agent", status: "running" }] },
];

/** A registry that holds SUBS as its surfaces see them — and `more` — the whole of each exchange's report included. @param {any[]} [more] */
const stubRegistry = (more = []) => {
  const byId = new Map([...SUBS, ...more].map((s) => [s.id, { chainId: "c1", origin: "agent", asked: false, card: { tag: "builder", name: "Builder" }, task: null, work: null, checked: null, progress: null, ...s }]));
  return /** @type {any} */ ({
    get: (/** @type {string} */ id) => byId.get(id) ?? null,
    detail: (/** @type {string} */ id) => byId.get(id) ?? null,
    report: (/** @type {string} */ id, n = -1) => byId.get(id)?.exchanges.at(n)?.report ?? null,
    now: () => 1_000_000,
    recall: () => {},
  });
};
/** A call of a lead's, as its turn hands one to the team's tools. @param {any} input @param {boolean} [reads] */
const callOf = (input, reads = true) => ({ chainId: "c1", lead: { runId: "r1", callId: "mcp:1" }, cwd: "/w", mode: null, model: "m-lead", thinking: null, team: TEAM, input, reads });
const CLOSING_READS = "worker with an agent_id and show_report: true gives that worker's brief and its reports whole, and show_trail: true a running one's rounds.";

// (fails before: yes — nothing said a lead's team after its own compaction: the summary Claude Code wrote held whatever
// it held of the workers, their ids and the change that waits)
test("the team as it stands: a line for each worker of the turn, oldest first — a running one's round and goal, a waiting change with its files, Filament's check and its report whole, how the others ended and their report's first line — and how to read more", () => {
  const tools = createTeamTools({ registry: stubRegistry() });
  const now = tools.teamNow({ chainId: "c1", ids: ["sa_1", "sa_2", "sa_3", "sa_5"], reads: true });
  assert.deepEqual(now, {
    workers: 4,
    text: [
      "Your team as it stands now — the 4 workers of this turn, oldest first:",
      '- builder sa_1 ("Fix the parser"): running — round 3. Its goal: parse() accepts an empty file.',
      '- builder sa_2 ("Add the flag"): reported, and its change waits for you to apply it — 2 files (+14 −3); Filament\'s check `npm test` passed. Its report is below, whole.',
      '- scout sa_3 ("Map the tests"): reported — "The tests live in test/."',
      '- builder sa_5 ("Try the cache"): was stopped — "Stopped before the cache."',
      "",
      'The report of builder sa_2 ("Add the flag"):',
      "## Summary\nAdded --flag to the parser.\n\nTests: `npm test` passes.",
      "",
      CLOSING_READS,
    ].join("\n"),
  });

  // Each other way a worker stands, in its own line: its change applied, a failure, a follow-up it works on, a check that
  // failed, a saved agent it asked.
  const lines = String(tools.teamNow({ chainId: "c1", ids: ["sa_4", "sa_6", "sa_7", "sa_8", "sa_9"], reads: true })?.text).split("\n");
  assert.deepEqual(lines.slice(0, 6), [
    "Your team as it stands now — the 5 workers of this turn, oldest first:",
    '- builder sa_4 ("Rename the flag"): reported, and its change is applied — "Renamed it."',
    '- builder sa_6 ("Speed it up"): failed (the provider refused the request).',
    '- builder sa_7 ("Check the docs"): running — round 1. On your follow-up: "Also the README."',
    '- builder sa_8 ("Fix the lexer"): reported, and its change waits for you to apply it — 1 file (+2 −0); Filament\'s check `npm test` failed (exit 1): apply it only with a reason, or follow up on it. Its report is below, whole.',
    '- Critic sa_9 ("Is the plan sound?"), whom you asked: answered — "Sound, but split step 2."',
  ]);
  assert.deepEqual(lines.slice(6), ["", 'The report of builder sa_8 ("Fix the lexer"):', "Tabs are read now.", "", CLOSING_READS], "the report it sent once its check's return was done");

  // (fails before: yes — a report still at the door was said whole here and again by the message behind it)
  // A report not delivered yet goes in right behind these words: they say it comes, and never say it.
  assert.deepEqual(String(tools.teamNow({ chainId: "c1", ids: ["sa_1", "sa_2", "sa_3"], reads: true, coming: ["sa_2", "sa_3", "sa_d"] })?.text).split("\n"), [
    "Your team as it stands now — the 3 workers of this turn, oldest first:",
    '- builder sa_1 ("Fix the parser"): running — round 3. Its goal: parse() accepts an empty file.',
    '- builder sa_2 ("Add the flag"): reported, and its change waits for you to apply it — 2 files (+14 −3); Filament\'s check `npm test` passed. Its report comes right after these words.',
    '- scout sa_3 ("Map the tests"): reported — its report comes right after these words.',
    "",
    CLOSING_READS,
  ]);

  // One worker; a lead that does not read along reaches them as it always has.
  assert.equal(
    tools.teamNow({ chainId: "c1", ids: ["sa_1"], reads: false })?.text,
    'Your team as it stands now — the one worker of this turn:\n- builder sa_1 ("Fix the parser"): running — round 3. Its goal: parse() accepts an empty file.\n\nTo reach any of them, call worker with its agent_id.',
  );
  // Nothing to say: no worker of the turn, or none of the lead's; a graph task's that ended is the graph's to say.
  assert.equal(tools.teamNow({ chainId: "c1", ids: [], reads: true }), null);
  assert.equal(tools.teamNow({ chainId: "c1", ids: ["sa_d", "sa_x", "sa_none"], reads: true }), null, "the developer's own, another session's and one gone are not the lead's");
  assert.equal(tools.teamNow({ chainId: "c1", ids: ["sa_t"], reads: true }), null, "a graph task's end is the graph's to say: its words carry it");
  assert.equal(tools.teamNow({ chainId: "c1", ids: ["sa_d", "sa_3", "sa_1"], reads: true })?.workers, 2);
});

// (fails before: yes — the owner's "Teams, improved and kept", 11-03: with none running and none with a change waiting,
// a lead's compaction heard nothing of its workers of the turn that ended — the summary held what it held of them)
test("every worker of the turn ended: the lead hears each — who, what it was given, how it ended, its report's first line — and how to reach it; the most recent ENDED_MOST, the rest by count and id", () => {
  const tools = createTeamTools({ registry: stubRegistry() });
  assert.deepEqual(String(tools.teamNow({ chainId: "c1", ids: ["sa_3", "sa_4", "sa_5", "sa_6", "sa_9"], reads: false })?.text).split("\n"), [
    "Your team as it stands now — the 5 workers of this turn, oldest first:",
    '- scout sa_3 ("Map the tests"): reported — "The tests live in test/."',
    '- builder sa_4 ("Rename the flag"): reported, and its change is applied — "Renamed it."',
    '- builder sa_5 ("Try the cache"): was stopped — "Stopped before the cache."',
    '- builder sa_6 ("Speed it up"): failed (the provider refused the request).',
    '- Critic sa_9 ("Is the plan sound?"), whom you asked: answered — "Sound, but split step 2."',
    "",
    "To reach any of them, call worker with its agent_id: a follow-up to one that ended asks it for more of what it found.",
  ]);
  assert.match(String(tools.teamNow({ chainId: "c1", ids: ["sa_3"], reads: true })?.text), new RegExp(`reported — "The tests live in test/."\\n\\n${CLOSING_READS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "a lead that reads along: show_report");
  // Past ENDED_MOST, the most recent are said and the ones before by id; one running is said wherever it stands.
  const many = Array.from({ length: ENDED_MOST + 2 }, (_, i) => ({ id: `sa_e${i + 1}`, team: { role: "scout" }, description: `Look ${i + 1}`, status: "done", exchanges: [{ prompt: "look", by: "agent", status: "done", report: `LOOKED ${i + 1}` }] }));
  const lines = String(createTeamTools({ registry: stubRegistry(many) }).teamNow({ chainId: "c1", ids: ["sa_e1", "sa_1", ...many.slice(1).map((x) => x.id)], reads: true })?.text).split("\n");
  assert.equal(lines[0], `Your team as it stands now — the ${ENDED_MOST + 3} workers of this turn, oldest first:`);
  assert.equal(lines[1], '- builder sa_1 ("Fix the parser"): running — round 3. Its goal: parse() accepts an empty file.');
  assert.deepEqual(lines.slice(2, 2 + ENDED_MOST), many.slice(2).map((x, i) => `- scout ${x.id} ("Look ${i + 3}"): reported — "LOOKED ${i + 3}"`));
  assert.equal(lines[2 + ENDED_MOST], "- and 2 more that ended earlier: sa_e1 and sa_e2");
  assert.deepEqual(lines.slice(3 + ENDED_MOST), ["", CLOSING_READS]);
  // (fails before: yes — the review of 11-03: the line named every one that ended before them, however many)
  // Past ENDED_MOST of those too, their count and the latest ENDED_MOST by id.
  const lots = Array.from({ length: 3 * ENDED_MOST + 3 }, (_, i) => ({ id: `sa_l${i + 1}`, team: { role: "scout" }, description: `Look ${i + 1}`, status: "done", exchanges: [{ prompt: "look", by: "agent", status: "done", report: `LOOKED ${i + 1}` }] }));
  const longer = String(createTeamTools({ registry: stubRegistry(lots) }).teamNow({ chainId: "c1", ids: lots.map((x) => x.id), reads: true })?.text).split("\n");
  const earlier = lots.slice(0, -ENDED_MOST);
  assert.equal(longer[1 + ENDED_MOST], `- and ${earlier.length} more that ended earlier, the latest ${ENDED_MOST} of them ${earlier.slice(-ENDED_MOST).map((x) => x.id).slice(0, -1).join(", ")} and ${earlier.at(-1)?.id}`);
  assert.ok(!longer.join("\n").includes("sa_l1,") && !longer.join("\n").includes("sa_l1 "), "the oldest by count alone");
});

// (fails before: yes — the same: a loop lead's fold brought back its workers running and those whose change waits, never
// those that ended)
test("a loop lead's workers of the turn that ended, for the block after Filament's fold: a line each, the most recent ENDED_MOST, and how to reach them; none running, waiting, a graph task's or another's", () => {
  const registry = stubRegistry();
  const lines = ['- scout sa_3 ("Map the tests"): reported — "The tests live in test/."', '- builder sa_6 ("Speed it up"): failed (the provider refused the request).', '- Critic sa_9 ("Is the plan sound?"), whom you asked: answered — "Sound, but split step 2."'];
  // (fails before: yes — the review of 11-03: a lead that reads along was sent to a follow-up, a paid run, for what
  // show_report reads free, as teamNow says)
  assert.deepEqual(endedWorkers(registry, { chainId: "c1", ids: ["sa_1", "sa_2", "sa_3", "sa_6", "sa_t", "sa_d", "sa_x", "sa_9"], reads: true }), [...lines, "worker with an agent_id and show_report: true gives that worker's brief and its reports whole."]);
  assert.deepEqual(endedWorkers(registry, { chainId: "c1", ids: ["sa_3", "sa_6", "sa_9"], reads: false }), [...lines, "To read more of what one of them found, follow it up: worker with its agent_id and prompt."], "one that does not read along: a follow-up");
  assert.deepEqual(endedWorkers(registry, { chainId: "c1", ids: ["sa_1", "sa_2", "sa_t"], reads: false }), [], "none ended with nothing left: nothing");
  const many = Array.from({ length: ENDED_MOST + 1 }, (_, i) => ({ id: `sa_e${i + 1}`, team: { role: "scout" }, description: `Look ${i + 1}`, status: "done", exchanges: [{ prompt: "look", by: "agent", status: "done", report: `LOOKED ${i + 1}` }] }));
  const bounded = endedWorkers(stubRegistry(many), { chainId: "c1", ids: many.map((x) => x.id), reads: false });
  assert.deepEqual([bounded.length, bounded[0], bounded.at(-2)], [ENDED_MOST + 2, '- scout sa_e2 ("Look 2"): reported — "LOOKED 2"', "- and 1 more that ended earlier: sa_e1"]);
});

// (fails before: yes — a lead read a running worker's rounds and a change, never a report it had heard once and lost)
test("show_report: a worker's brief and its reports whole, each follow-up and its report; a running one's newest ask has none yet; it goes alone, never to all, and steers rather than orders", async () => {
  const tools = createTeamTools({ registry: stubRegistry() });
  const shown = async (/** @type {string} */ id) => tools.worker(callOf({ agent_id: id, show_report: true }));
  const two = await shown("sa_2");
  assert.deepEqual([two.ok, two.agentId, two.note], [true, "sa_2", "agent: the brief and reports of builder sa_2, shown to its lead (1 report)"]);
  assert.equal(
    two.text,
    `[Filament: the brief and reports of builder sa_2 ("Add the flag"), whole.]\n\nYour brief:\n${brief("Add the flag", "--flag parses")}\n\nIts report:\n## Summary\nAdded --flag to the parser.\n\nTests: \`npm test\` passes.\n\nIts change waits for you to apply it: 2 files (+14 −3); Filament's check \`npm test\` passed.`,
  );
  assert.equal(
    (await shown("sa_7")).text,
    `[Filament: the brief and reports of builder sa_7 ("Check the docs"), whole.]\n\nYour brief:\n${brief("Check the docs", "the docs say --flag")}\n\nIts report:\nDOCS CHECKED.\n\nYour follow-up:\nAlso the README.\nKeep it short.\n\nIt is still at work on it (round 1): show_trail: true reads its rounds.`,
  );
  // A return Filament made after a failed check is the report's, not an ask of the lead's.
  assert.equal(
    (await shown("sa_8")).text,
    `[Filament: the brief and reports of builder sa_8 ("Fix the lexer"), whole.]\n\nYour brief:\n${brief("Fix the lexer", "the lexer reads tabs")}\n\nIts report, after Filament sent it back once for its check:\nTabs are read now.\n\nIts change waits for you to apply it: 1 file (+2 −0); Filament's check \`npm test\` failed (exit 1): apply it only with a reason, or follow up on it.`,
  );
  assert.equal((await shown("sa_5")).text, `[Filament: the brief and reports of builder sa_5 ("Try the cache"), whole.]\n\nYour brief:\n${brief("Try the cache", "a warm run is quicker")}\n\nIts report, after it was stopped:\nStopped before the cache.`);
  assert.equal((await shown("sa_6")).text, `[Filament: the brief and reports of builder sa_6 ("Speed it up"), whole.]\n\nYour brief:\n${brief("Speed it up", "the parse is quicker")}\n\nIts report, after it failed (the provider refused the request):\n(no report)`);
  assert.equal((await shown("sa_4")).text.split("\n\n").at(-1), "Its change is applied: it is in your folder.");
  assert.equal((await shown("sa_t")).text.split("\n\n").at(-1), "Its report:\nT1 DONE.", "a graph task's change is the graph's");
  assert.equal((await shown("sa_9")).text, "[Filament: your question to Critic sa_9 and its answer, whole.]\n\nYour question:\nIs the plan sound?\n\nIts answer:\nSound, but split step 2.");

  // Refused: one that is not the lead's, one gone, and a call whose parts do not go together.
  assert.deepEqual([(await shown("sa_d")).ok, (await shown("sa_d")).text], [false, "Nothing shown: sa_d is the developer's sub-agent, not one of your workers."]);
  assert.equal((await shown("sa_x")).text, `Nothing shown: ${noSuchSubagent("sa_x")}.`);
  assert.equal((await shown("sa_none")).text, `Nothing shown: ${noSuchSubagent("sa_none")}.`);
  assert.equal(inputRefusal("worker", { agent_id: "sa_2", show_report: true, prompt: "x" }, { reads: true })?.text, "Nothing shown: show_report reads a worker's brief and reports and goes alone, never with prompt — send that as its own worker call.");
  assert.equal(inputRefusal("worker", { agent_id: "sa_2", show_report: true, show_trail: true }, { reads: true })?.text, "Nothing shown: show_trail and show_report are two calls.");
  assert.equal(inputRefusal("worker", { agent_id: "sa_2", show_report: true, show_trail: true, show_changes: true }, { reads: true })?.text, "Nothing shown: show_trail, show_changes and show_report are three calls.");
  assert.equal(inputRefusal("worker", { agent_id: "sa_2", show_trail: true, show_changes: true }, { reads: true })?.text, "Nothing shown: show_trail and show_changes are two calls.", "the older words hold");
  assert.equal(inputRefusal("worker", { agent_id: "all", prompt: "x", show_report: true }, { reads: true })?.text, "Nothing sent: agent_id all sends a message, so it takes prompt alone — never show_report: stop, follow up on or answer each worker by its own agent_id.");
  assert.equal(inputRefusal("worker", { agent_id: "sa_2", answer: "go", ask: 1, show_report: true }, { reads: true })?.text, "Nothing answered: answer and ask go alone, never with show_report — send that as its own worker call.");
  // A lead that does not read along has no read of a worker: as version 18 answers a call with no prompt.
  assert.equal((await tools.worker(callOf({ agent_id: "sa_2", show_report: true }, false))).text, "Nothing sent: worker needs prompt — your message or follow-up — or stop: true, or apply_changes: true.");
  // The run's timeline names it.
  assert.equal(argSummary("worker", { agent_id: "sa_2", show_report: true }), "sa_2: read its brief and reports");
});

// (fails before: yes — a coding agent's worker tool had two reads, and its words said so)
test("a coding agent that leads and reads along has show_report in its worker tool and its lines; the loop's lead keeps version 27's two reads, byte for byte", () => {
  const own = WORKER_READS_OWN_TOOL.input_schema.properties;
  assert.deepEqual(Object.keys(own), [...Object.keys(WORKER_READS_TOOL.input_schema.properties), "show_report"]);
  assert.equal(/** @type {any} */ (own).show_report.type, "boolean");
  assert.equal(WORKER_READS_OWN_TOOL.description, TOOL_TEXT.workerReadsOwn);
  assert.equal(WORKER_READS_TOOL.description, TOOL_TEXT.workerReads);
  assert.ok(TOOL_TEXT.workerReadsOwn.includes("Three reads, each with no prompt") && TOOL_TEXT.workerReadsOwn.includes("show_report: true gives a worker's brief and its reports whole"), TOOL_TEXT.workerReadsOwn);
  assert.ok(TOOL_TEXT.workerReads.includes("Two reads, each with no prompt") && !TOOL_TEXT.workerReads.includes("show_report"));
  assert.ok(String(PROMPT.leadLooksOwn).includes("and with show_report: true its brief and its reports whole"), String(PROMPT.leadLooksOwn));
  assert.ok(!String(PROMPT.leadLooks).includes("show_report"), "the loop's lead keeps its own conversation's words");
});

// ---- the lead's turn, over a scripted registry ----------------------------------------------------------------------

// (fails before: yes — a lead's turn had no word for its agent's compaction, and the registry's door no list of the
// turn's workers)
// Its team as it stands, for the block that comes back after its compaction (acp-turn.js `backText`, the owner's of 11-10:
// one block): said as it stands when it goes in, a report still at the door said to come right behind it.
test("the lead's turn: its team as it stands, after the reports it took, while a worker runs and once every one ended; a report at the door said to come, never twice; nothing once the turn is over", async () => {
  const w = watched({ runlog: true });
  const l = leadOf(w.registry, w.dir, { looks: 30 });
  /** @type {string[]} */
  const notes = [];
  const lt = createLeadTurn({ registry: w.registry, door: /** @type {any} */ (l.door), chainId: "c1", runId: "lead-1", cwd: w.dir, model: "m-lead", team: TEAM, emit: () => {}, note: (t) => notes.push(t), mailbox: () => null, signal: new AbortController().signal });
  // No worker yet: nothing to say.
  assert.equal(lt.teamNow(), null);
  assert.deepEqual(notes, [], "the record says it once the block went in (acp-turn.js `backNow`)");

  // A builder at work, and a scout that reported.
  const built = await lt.call("agent", BRIEF);
  const builder = /** @type {string} */ (/^Launched builder (sa_[0-9a-f]{8})/.exec(built.text)?.[1]);
  const run1 = await w.run(1);
  run1.attach();
  const mapped = await lt.call("agent", { ...BRIEF, role: "scout", description: "Map the parser", goal: "know where parse() is" });
  const scout = /** @type {string} */ (/^Launched scout (sa_[0-9a-f]{8})/.exec(mapped.text)?.[1]);
  const run2 = await w.run(2);
  run2.attach();
  run2.finish({ status: "done", report: "MAPPED: parse() is in src/parse.js\nand its tests in test/." });
  await w.registry.settled(scout);
  assert.deepEqual(l.door.inbox.own?.(), [builder, scout], "the door's workers of the turn, oldest first");
  assert.ok(lt.take().some((t) => t.includes("MAPPED: parse() is in src/parse.js")), "the scout's report, taken");

  const said = String(lt.teamNow()?.text);
  assert.match(said, /^Your team as it stands now — the 2 workers of this turn, oldest first:\n/);
  assert.ok(said.includes(`\n- builder ${builder} ("Fix the parser"): running — starting. Its goal: parse() accepts an empty file.\n`), said);
  assert.ok(said.includes(`\n- scout ${scout} ("Map the parser"): reported — "MAPPED: parse() is in src/parse.js"\n`), said);
  assert.ok(said.endsWith(`\n\n${CLOSING_READS}`), said);
  assert.deepEqual(lt.take(), [], "nothing of it waits in the inbox: the block that comes back carries it");
  assert.equal(lt.teamNow()?.workers, 2, "how many it says, for the record's line once the block went in");

  // (fails before: yes — the report was said whole in the words on the team, and again by its own message behind them)
  // A report that landed while the agent compacted waits at the door: the words on the team say it comes, and it goes in
  // right behind them, once.
  const read = await lt.call("agent", { ...BRIEF, role: "scout", description: "Read the docs", goal: "know what the docs say" });
  const reader = /** @type {string} */ (/^Launched scout (sa_[0-9a-f]{8})/.exec(read.text)?.[1]);
  const run3 = await w.run(3);
  run3.attach();
  run3.finish({ status: "done", report: "DOCS READ: they say --flag." });
  await w.registry.settled(reader);
  assert.deepEqual(l.door.inbox.coming?.(), [reader], "its report, not taken yet");
  const comes = String(lt.teamNow()?.text);
  assert.ok(comes.includes(`\n- scout ${reader} ("Read the docs"): reported — its report comes right after these words.\n`), comes);
  assert.ok(!comes.includes("DOCS READ"), "never said twice");
  const behind = lt.take();
  assert.equal(behind.length, 1, behind.join("\n----\n"));
  assert.ok(behind[0].includes("DOCS READ: they say --flag."), behind[0]);
  assert.deepEqual(l.door.inbox.coming?.(), [], "taken");

  // (fails before: yes — the owner's "Teams, improved and kept", 11-03: once none ran, the compaction said nothing)
  // The builder reports: every worker of the turn ended, and the team says each, with how to reach it.
  run1.finish({ status: "done", report: "FIXED" });
  await w.registry.settled(builder);
  lt.take();
  const over = String(lt.teamNow()?.text);
  assert.ok(over.startsWith("Your team as it stands now — the 3 workers of this turn, oldest first:\n"), over);
  assert.ok(over.includes(`\n- builder ${builder} ("Fix the parser"): reported — "FIXED"\n- scout ${scout} ("Map the parser"): reported — "MAPPED: parse() is in src/parse.js"\n- scout ${reader} ("Read the docs"): reported — "DOCS READ: they say --flag."\n`), over);
  assert.ok(over.endsWith(`\n\n${CLOSING_READS}`), over);

  // A closed turn says nothing of its team.
  lt.close();
  assert.equal(lt.teamNow(), null);
});

// ---- on the live app ------------------------------------------------------------------------------------------------

/** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
let up;
/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
/** @type {string} */
let folder;
/** @type {string} */
let logs;

const HELD ={ role: "scout", description: "Map it, held", goal: "know what is here", steps: ["List the files"], acceptance: "every file is named" };
/** A second worker, held behind a gate of its own, so one still runs when the first has reported. */
const SECOND = { role: "scout", description: "Map the rest, held", goal: "know what else is here", steps: ["List the rest"], acceptance: "every other file is named" };
const PLAN = "PLAN: I will list every file.";
/** A door the script holds a reply behind until the test opens it. */
const gate = () => {
  /** @type {() => void} */
  let open = () => {};
  const passed = /** @type {Promise<void>} */ (new Promise((res) => (open = res)));
  return { open, passed };
};
let held = gate();
let heldSecond = gate();
/** The gates of the other held workers, by the task their brief names. @type {Map<string, ReturnType<typeof gate>>} */
const gates = new Map();
/** @param {string} task */
const gateOf = (task) => gates.get(task) || /** @type {ReturnType<typeof gate>} */ (gates.set(task, gate()).get(task));

/** @param {any} b */
const sysOf = (b) => (Array.isArray(b?.system) ? b.system.map((/** @type {any} */ x) => x?.text ?? "").join("\n") : String(b?.system || ""));
/** @param {any} body @param {string} id */
const answeredIn = (body, id) => (body?.messages || []).some((/** @type {any} */ m) => Array.isArray(m.content) && m.content.some((/** @type {any} */ b) => b?.type === "tool_result" && b.tool_use_id === id));
/** A JSONL file's lines, parsed. @param {string} file */
const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
/** The lead's prompts to the fake agent, in a session. @param {string} sessionId */
const promptsOf = (sessionId) => lines(join(logs, "prompts.jsonl")).filter((p) => p.sessionId === sessionId);

before(async () => {
  folder = mkdtempSync(join(tmpdir(), "filament-lead-compacted-"));
  writeFileSync(join(folder, "a.txt"), "one\n");
  logs = mkdtempSync(join(tmpdir(), "filament-lead-compacted-logs-"));
  up = await fakeUpstream(async (call) => {
    const b = call.body || {};
    const model = String(b.model || "");
    const blocks = (/** @type {any[]} */ list, stop = "end_turn") => anthropicReply("", { model, stop, blocks: list, usage: { input_tokens: 5, output_tokens: 3 } });
    if (!sysOf(b).includes(String(PROMPT.workerRole))) return blocks([{ type: "text", text: "MODEL ANSWER" }]);
    // The worker says its plan with its first call, and its report waits until the test opens its gate.
    if (!answeredIn(b, "toolu_h_glob")) return blocks([{ type: "text", text: PLAN }, { type: "tool_use", id: "toolu_h_glob", name: "glob", input: { pattern: "*" } }], "tool_use");
    const task = /Your task: ([^\n"\\]+)/.exec(JSON.stringify(b.messages || []))?.[1] ?? "";
    if (task === HELD.description || task === SECOND.description) {
      await (task === SECOND.description ? heldSecond.passed : held.passed);
      return blocks([{ type: "text", text: task === SECOND.description ? "SECOND REPORT: the rest is mapped." : "SCOUT REPORT: mapped after its lead's compaction." }]);
    }
    await gateOf(task).passed;
    return blocks([{ type: "text", text: `REPORT: ${task} is done.` }]);
  });
  shim = await startApp({ memory: true, keep: true, configure });
});
after(async () => {
  held.open();
  heldSecond.open();
  for (const g of gates.values()) g.open();
  await shim.stop();
  await up.close();
  for (const dir of [folder, logs, shim.dataDir]) rmSync(dir, { recursive: true, force: true });
});

/** @param {any} cfg @param {{ dataDir: string }} ctx */
function configure(cfg, { dataDir }) {
  cfg.upstreams = [
    { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } },
    {
      id: "cli",
      name: "cli",
      type: "acp",
      enabled: true,
      acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_MCP_CAPS: "http", FAKE_ACP_CALLS: join(logs, "calls.jsonl"), FAKE_ACP_LOG: join(logs, "prompts.jsonl") }, cwdDefault: dataDir, permissions: "allow-all", clientBridge: "full" },
    },
  ];
  cfg.routes = [
    { match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true },
    { match: "coder-*", upstream: "cli", upstreamModel: "{model}", enabled: true },
  ];
  cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
  cfg.memory.autopilot = { enabled: false };
}

/** The developer's note to a run. @param {string} runId @param {string} text */
const note = async (runId, text) => {
  const r = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "note", text } });
  assert.equal(r.status, 200, await r.clone().text());
};

// (fails before: yes — a coding agent that compacted while it led heard nothing of its team after: its next prompt was
// the next report)
// What comes back after it — its team among it, in one block (the owner's of 11-10) — goes with the next words Filament
// sends it anyway, or at its next call: never words of their own, which would be a model call for them alone.
test("a coding agent that compacts while it leads: Filament says its team as it stands in its next words, once; show_report reads the running worker's brief over Filament's MCP server", async () => {
  held = gate();
  const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "coder-1", preset: "plain", settings: { engine: { mode: "team", team: "builders", lookSeconds: 0 }, subagents: { pool: [{ model: "m-1", seats: 4 }] } } } });
  assert.equal(r.status, 200, await r.clone().text());
  const id = String((await r.json()).id);
  const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: `~mcpcall agent ${JSON.stringify(HELD)}`, stream: true, runEvents: true } });
  assert.equal(res.status, 200);
  const runId = String(res.headers.get("x-filament-request-id"));
  const first = /** @type {any} */ (await until(() => lines(join(logs, "prompts.jsonl")).find((p) => String(p.text).includes(`~mcpcall agent ${JSON.stringify(HELD)}`)) || null, "the lead's first prompt"));
  // The worker said its plan, and its look woke the lead: it waits for the worker now.
  await until(() => promptsOf(first.sessionId).some((p) => String(p.text).includes("[Filament: a look at your workers.")), "the look at the worker's plan");
  const [sa] = (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json()).subagents;
  assert.equal(sa.status, "running");

  // The developer's note makes the fake agent compact its context in the prompt that carries it, which ends with it: the
  // lead waits on its worker, and nothing more goes in until the next words do.
  await note(runId, "~compact");
  await until(() => promptsOf(first.sessionId).some((p) => String(p.text).includes("- ~compact")), "the lead's prompt with ~compact");
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(!promptsOf(first.sessionId).some((p) => String(p.text).includes("[Filament: You compacted your context just now")), "no prompt of its own");

  // A compaction that failed after its start, and one of a sub-agent of the agent's own, say nothing of the team: each
  // in a prompt of its own, while the worker still runs. The first carries what came back after the compaction before.
  for (const trigger of ["~compactfail", "~subcompact"]) {
    await note(runId, trigger);
    await until(() => promptsOf(first.sessionId).some((p) => String(p.text).includes(`- ${trigger}`)), `the lead's prompt with ${trigger}`);
  }
  const told = /** @type {any} */ (promptsOf(first.sessionId).find((p) => String(p.text).includes("[Filament: You compacted your context just now")));
  const text = String(told?.text);
  assert.ok(text.includes("- ~compactfail"), "with the next words that went in");
  assert.ok(text.indexOf("[Filament: You compacted your context just now") < text.indexOf("- ~compactfail"), "ahead of them");
  assert.ok(text.includes("[Filament: You compacted your context just now, and its summary may have left out what stands: here is your team as it stands now."), text);
  assert.ok(text.includes(`<team>\nYour team as it stands now — the one worker of this turn:\n- scout ${sa.id} ("Map it, held"): running — round `) && text.includes(". Its goal: know what is here.\n"), text);
  assert.ok(text.includes(`\n\n${CLOSING_READS}\n</team>`), text);

  // Its read of the running worker's brief.
  await note(runId, `~mcpcall worker ${JSON.stringify({ agent_id: sa.id, show_report: true })}`);
  await until(() => promptsOf(first.sessionId).some((p) => String(p.text).includes('"show_report":true')), "the lead's read of the worker");

  // (fails before: yes — a report that landed while the agent compacted went into its turn at once, to wait in its queue
  // and be read after the compaction, where the words on the team said it whole again)
  // A second worker; then a compaction that takes its time, and the first worker reports in the middle of it: nothing
  // goes into the agent's turn while it compacts, and once it has, the words on the team say its envelope comes — the
  // lead is at work, so the report waits sealed (HarnessV4_Envelopes_Plan EN3) — and its line goes in right behind them,
  // in the same message, once.
  await note(runId, `~mcpcall agent ${JSON.stringify(SECOND)}`);
  const second = /** @type {any} */ (await until(async () => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json()).subagents.find((/** @type {any} */ x) => x.description === SECOND.description && x.status === "running") || null, "the second worker to run"));
  await until(() => promptsOf(first.sessionId).some((p) => String(p.text).includes("[Filament: a look at your workers.") && String(p.text).includes(second.id)), "the look at the second worker's plan");
  const slowGate = join(logs, "slow-compaction-ends");
  const compactings = async () => ((await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events || []).filter((/** @type {any} */ e) => e.type === "compacting").length;
  const before = await compactings();
  await note(runId, `~slowcompact ${slowGate}`);
  await until(async () => (await compactings()) > before, "the slow compaction to start");
  const sentBefore = promptsOf(first.sessionId).length;
  const queuedBefore = lines(join(logs, "calls.jsonl")).filter((c) => c.method === "queued prompt").length;
  held.open();
  await until(async () => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json()).subagents.some((/** @type {any} */ x) => x.id === sa.id && x.status === "done"), "the first worker to report");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(promptsOf(first.sessionId).length, sentBefore, "no prompt while the agent compacts");
  assert.equal(lines(join(logs, "calls.jsonl")).filter((c) => c.method === "queued prompt").length, queuedBefore, "nor a word queued at it");
  writeFileSync(slowGate, "");
  const behind = /** @type {any} */ (await until(() => promptsOf(first.sessionId).find((p) => String(p.text).includes("Your team as it stands now — the 2 workers of this turn")) || null, "the words on the team after the slow compaction"));
  const words = String(behind.text);
  assert.ok(words.includes(`\n- scout ${sa.id} ("Map it, held"): reported — its envelope comes right after these words.\n- scout ${second.id} ("Map the rest, held"): running — `), words);
  const at = words.indexOf("[Filament: You compacted your context just now");
  const sealedLine = `, sealed — from your scout ${sa.id} ("Map it, held"): `;
  assert.ok(at >= 0 && words.indexOf(sealedLine) > at, "the envelope's line behind the words on the team");
  assert.equal(words.split(sealedLine).length, 2, "said once");
  assert.ok(!words.includes("SCOUT REPORT: mapped after its lead's compaction."), "its report waits sealed");

  heldSecond.open();
  const said = await res.text();
  assert.ok(said.includes(`mcp:[Filament: the brief and reports of scout ${sa.id} (\\"Map it, held\\"), whole.]\\n\\nYour brief:\\nYour task: Map it, held\\n\\nGoal: know what is here`), said);
  assert.ok(said.includes("It is still at work on it (round "), said);
  const prompts = promptsOf(first.sessionId).map((p) => String(p.text));
  assert.equal(prompts.filter((p) => p.includes("[Filament: You compacted your context just now")).length, 2, "once for each compaction it made");
  assert.equal(prompts.filter((p) => p.includes("SCOUT REPORT: mapped after its lead's compaction.")).length, 1, "the first worker's report, once");
  assert.ok(prompts.at(-1)?.includes("SECOND REPORT: the rest is mapped."), prompts.at(-1));
  // The record's notes: its changes hold the ones said before its prompts ended too.
  const notes = ((await shim.record(runId)).changes || []).map(String);
  assert.ok(notes.includes("acp: the agent compacted its context during this turn"), notes.join("\n"));
  assert.deepEqual(notes.filter((n) => n.startsWith("agent: the lead compacted")), ["agent: the lead compacted its context — Filament tells it how its worker of this turn stands", "agent: the lead compacted its context — Filament tells it how its 2 workers of this turn stand"]);
  assert.ok(notes.includes(`agent: the brief and reports of scout ${sa.id}, shown to its lead (no report yet)`), notes.join("\n"));
});

// (fails before: yes — nothing held what went into the agent's turn while it compacted, so nothing let go of it either)
test("what lands after a compaction ended goes into the lead's running turn: a compaction that failed lets go at once, and one whose end the agent never said lets go with its prompt", async () => {
  const third = { ...SECOND, description: "Third, held", goal: "know the third part" };
  const fourth = { ...SECOND, description: "Fourth, held", goal: "know the fourth part" };
  const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "coder-1", preset: "plain", settings: { engine: { mode: "team", team: "builders", lookSeconds: 0 }, subagents: { pool: [{ model: "m-1", seats: 4 }] } } } });
  assert.equal(r.status, 200, await r.clone().text());
  const id = String((await r.json()).id);
  const workers = async () => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json()).subagents;
  const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: `~mcpcall agent ${JSON.stringify(third)}`, stream: true, runEvents: true } });
  assert.equal(res.status, 200);
  const runId = String(res.headers.get("x-filament-request-id"));
  const first = /** @type {any} */ (await until(() => lines(join(logs, "prompts.jsonl")).find((p) => String(p.text).includes(`~mcpcall agent ${JSON.stringify(third)}`)) || null, "the lead's first prompt"));
  const saw = (/** @type {string} */ words) => promptsOf(first.sessionId).some((p) => String(p.text).includes(words));
  await until(() => saw("[Filament: a look at your workers."), "the look at the third worker's plan");
  await note(runId, `~mcpcall agent ${JSON.stringify(fourth)}`);
  const four = /** @type {any} */ (await until(async () => (await workers()).find((/** @type {any} */ x) => x.description === fourth.description && x.status === "running") || null, "the fourth worker to run"));
  await until(() => promptsOf(first.sessionId).filter((p) => String(p.text).includes("[Filament: a look at your workers.") && String(p.text).includes(four.id)).length > 0, "the look at the fourth worker's plan");
  /** The words queued at the agent while a prompt of its ran. */
  const queued = () => lines(join(logs, "calls.jsonl")).filter((c) => c.method === "queued prompt" && c.sessionId === first.sessionId).map((c) => String(c.words));

  // A compaction whose end the agent never said, its prompt over: the next prompt is not held for it.
  // A note goes in alone as the next prompt, or as a line of one with the words that waited beside it (a look): either
  // is the note heard — which, is the timing's (glob reads off the event loop since 10-27, and a look may go first).
  await note(runId, "~compacthang");
  await until(() => saw("~compacthang"), "the prompt left mid-compaction");
  const waitedA = join(logs, "waited-a");
  await note(runId, `~waitfor ${waitedA}`);
  await until(() => saw(`~waitfor ${waitedA}`), "the prompt that waits");
  gateOf(third.description).open();
  // The lead is at work: each report goes in as its envelope's line (HarnessV4_Envelopes_Plan EN3).
  await until(() => queued().some((w) => w.includes("[Filament: envelope ") && w.includes('("Third, held")')), "the third worker's envelope, into the running prompt");
  writeFileSync(waitedA, "");

  // A compaction that failed: what lands after it goes in at once, while the prompt runs on.
  const failedMarks = async () => ((await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events || []).filter((/** @type {any} */ e) => e.type === "compaction" && e.result === "failed").length;
  const marksBefore = await failedMarks();
  const waitedB = join(logs, "waited-b");
  await note(runId, `~compactfailwait ${waitedB}`);
  await until(async () => (await failedMarks()) > marksBefore, "the compaction to fail");
  gateOf(fourth.description).open();
  await until(() => queued().some((w) => w.includes("[Filament: envelope ") && w.includes('("Fourth, held")')), "the fourth worker's envelope, into the running prompt");
  writeFileSync(waitedB, "");
  await res.text();
  const notes = ((await shim.record(runId)).changes || []).map(String);
  assert.ok(!notes.some((n) => n.startsWith("agent: the lead compacted")), "no compaction ended well: nothing said of the team");
});
