// @ts-check
// HarnessV3-ACP AC6-1 and AC6-2: a sub-agent or a team's worker whose model is a coding agent runs as that agent. The
// words that tell the agent its part, its asker and how its turn ended, alone (app/agent-worker.js), and a turn that
// goes on within its request, its prompts joined into one (app/agent-followon.js); then on the live
// app, a team led by the loop whose workers run on a fake agent (fixtures/fake-acp-agent.mjs, Claude's shape): a Scout
// in the session's folder, told its part through the agent's system channel, its run under its lead's turn; a Builder
// in its own worktree whose work the lead applies, and whose follow-up goes on in the same agent session, how each
// did kept as a worker's outcome; a Tester whose command the switch asks about waits for the developer on its lead's
// timeline; a worker the lead messages, which hears whose message it is, and one it stops; a sub-agent of a plain
// session, whose command nobody can approve; a graph task's worker under a team's lead (a plain session's graph runs on
// its planner's own model, the owner's word of 10-26), which reports through Filament's tool, or is asked for its report
// once when its turn ends without it, and keeps the report it gave though its agent then fails;
// and a worker whose agent's login is billed by use, its spend on its card.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PROMPT, readAlongReport } from "../src/app/agent/prompt.js";
import { PLAN_HELD, unattendedAsk } from "../src/app/agent/tools.js";
import { NOBODY_TO_ASK, ROLE_BLOCK, SHIM, deniedWords, workerAsker, workerNote, workerStatus, workerWords } from "../src/app/agent-worker.js";
import { strayWords } from "../src/app/agent-permits.js";
import { taskWorktreePath } from "../src/adapters/git/worktree.js";
import { SUBAGENT_NOTES } from "../src/app/agent/subagents.js";
import { copyState } from "./helpers/copies.js";
import { ALWAYS_REASON, fromJudged } from "../src/adapters/agents/asks.js";
import { SHIPPED_TEAMS } from "../src/services/teams.js";
import { SHIPPED_CARDS, shippedCard } from "../src/services/agent-cards.js";
import { REPORT_ASK, REPORT_IN } from "../src/core/task-graph.js";
import { followedBody, joinTurns } from "../src/app/agent-followon.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { createAgentTurns } from "../src/app/agent-inbox.js";
import { houseAuth } from "../src/services/house.js";
import { FAKE_ACP_AGENT, FIXTURES, anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const FAKE_CODEX = join(FIXTURES, "fake-codex-app-server.mjs");
const FAKE_SDK = pathToFileURL(join(FIXTURES, "fake-cursor-sdk.mjs")).href;

// ---- the worker's part, its asker and its end, alone ----------------------------------------------------------------

/** The Builders team's own line for its Scout: Reviewer, seated under that name. */
const SCOUT_LINE = String(SHIPPED_TEAMS.builders.members.find((m) => m.name === "Scout")?.line);
const BUILDERS = { name: "Builders", role: "scout", words: SCOUT_LINE };
/** A shipped card, as a host carries it. @param {string} tag @returns {any} */
const card = (tag) => shippedCard(tag);

// (fails before: yes — a coding agent serving the developer's own launch read that nobody can approve a call for it)
test("a sub-agent the developer launched, served by a coding agent: its part says a call that needs approval waits for them; one the agent launched reads that it is refused", () => {
  const mine = workerWords({ id: "sa_9", card: card("builder"), readOnly: false, asks: true, team: null, task: null });
  const agents = workerWords({ id: "sa_9", card: card("builder"), readOnly: false, asks: false, team: null, task: null });
  assert.ok(mine.includes(PROMPT.attendedPermission) && !mine.includes(PROMPT.subagentPermission));
  assert.ok(agents.includes(PROMPT.subagentPermission) && !agents.includes(PROMPT.attendedPermission));
  assert.equal(mine.replace(PROMPT.attendedPermission, PROMPT.subagentPermission), agents);
});

// Since version 29 (HarnessV3-TaskGraph-v2 TG2-D58) every worker of a team may ask its lead: where it read that nobody
// could answer it, its ambiguity line and its report say to ask its lead.
test("a worker's part: Filament's instructions, its role and its team's words, how its permissions go, its lead's messages, its lead to ask, and its report", () => {
  const words = workerWords({ id: "sa_1", card: card("reviewer"), readOnly: false, asks: true, team: BUILDERS, task: null });
  const asking = (/** @type {string} */ line) => readAlongReport(line, PROMPT.workerAsksLead);
  assert.ok(words.startsWith(`<filament-context kind="${ROLE_BLOCK}">\nThese are Filament's instructions for this session, not background.\n${PROMPT.workerRole}\n${SHIPPED_CARDS.reviewer.thinks}\nTeam Builders asks of you: ${BUILDERS.words}\n`));
  for (const line of [PROMPT.workerPermission, PROMPT.workerSteering, PROMPT.workerAmbiguity, PROMPT.subagentCareAsk, asking(PROMPT.workerReport)]) assert.ok(words.includes(`${line}\n`) || words.endsWith(`${line}\n</filament-context>`), line);
  assert.ok(!words.includes(PROMPT.work) && !words.includes(PROMPT.craft), "never the loop's words for its own hands");
  assert.ok(!/obody can answer/.test(words), "someone can: its lead");
  // A worker on a graph task reports with the tool, and a task's reviewer in its own words.
  assert.ok(workerWords({ id: "sa_2", card: card("builder"), readOnly: false, asks: true, team: { ...BUILDERS,role: "builder" }, task: { id: "t1", review: false } }).includes(asking(PROMPT.workerTaskReport)));
  assert.ok(workerWords({ id: "sa_3", card: card("reviewer"), readOnly: false, asks: true, team: { ...BUILDERS,role: "reviewer" }, task: { id: "t1", review: true } }).includes(asking(PROMPT.reviewReport)));
  // A team that adds no words for the role says none.
  assert.ok(!workerWords({ id: "sa_4", card: card("builder"), readOnly: false, asks: true, team: { ...BUILDERS,role: "builder", words: " " }, task: null }).includes("asks of you"));
});

test("a plain sub-agent's part: its own role, the read-only line where a call holds it to reading, its permission words and its report — no lead to message it", () => {
  const held = workerWords({ id: "sa_1", card: card("builder"), readOnly: true, asks: false, team: null, task: null });
  for (const line of [PROMPT.subagentRole, PROMPT.subagentReadOnly, PROMPT.subagentPermission, PROMPT.subagentReport]) assert.ok(held.includes(line), line);
  assert.ok(!held.includes(PROMPT.workerSteering) && !held.includes(PROMPT.workerRole));
  const general = workerWords({ id: "sa_2", card: card("builder"), readOnly: false, asks: false, team: null, task: { id: "t1", review: false } });
  assert.ok(!general.includes(PROMPT.subagentReadOnly) && general.includes(PROMPT.taskReport));
  // (fails before: yes — a sub-agent had no card: Scout read the one read-only line, and no words of its own)
  const reviewer = workerWords({ id: "sa_3", card: card("reviewer"), readOnly: false, asks: false, team: null, task: null });
  assert.ok(reviewer.includes(`${PROMPT.subagentRole}\n${SHIPPED_CARDS.reviewer.thinks}\n`) && !reviewer.includes(PROMPT.subagentReadOnly), "its card's words say it only reads");
  // (fails before: yes — the owner's list of 11-08: a coding agent's reviewer whose test run was refused heard no reason,
  // since a refused request carries none, and kept trying)
  const reads = workerWords({ id: "sa_4", card: card("reviewer"), readOnly: false, asks: false, team: null, task: null, may: "read" });
  assert.ok(reads.includes(`${SHIPPED_CARDS.reviewer.thinks}\n${PROMPT.subagentReadsRun}\n`), "one that may only read hears what runs, whatever its card says");
  assert.ok(!workerWords({ id: "sa_5", card: card("builder"), readOnly: false, asks: false, team: null, task: null, may: "edit" }).includes(PROMPT.subagentReadsRun));
});

test("a worker's asker: a permission the switch asks about waits for the developer where they can answer; elsewhere it is refused in the loop's words; anything else nobody answers", async () => {
  /** @type {any[]} */
  const asked = [];
  /** @type {any} */
  let answer = { text: "yes", allow: true };
  const registry = { ask: async (/** @type {string} */ id, /** @type {any} */ q) => (asked.push({ id, q }), answer) };
  const judged = fromJudged({ agent: "Fake", tool: "bash", words: "May I run this command? `rm -rf build`", command: "rm -rf build", reason: "it deletes files", offer: { itemId: 3, tool: "bash", shape: "rm -rf *" } });
  const worker = { id: "sa_1", card: card("builder"), readOnly: false, asks: true, team: { ...BUILDERS,role: "tester" }, task: null };
  const ask = workerAsker(registry, worker);
  assert.deepEqual(await ask(judged, "q1", null), { outcome: "answered", answers: { permission: { chosen: ["allow"] } } });
  assert.deepEqual(asked, [{ id: "sa_1", q: { tool: "bash", args: "rm -rf build", question: "May I run this command? `rm -rf build`", command: "rm -rf build", reason: "it deletes files", offer: { itemId: 3, tool: "bash", shape: "rm -rf *" } } }]);
  answer = { text: "No — clean it with the script instead." };
  assert.deepEqual(await ask(judged, "q2", null), { outcome: "answered", answers: { permission: { chosen: ["deny"], words: "No — clean it with the script instead." } } });
  // (fails before: yes — its agent hears a no as a reject alone, so the developer's words, and its lead's, were lost;
  // HarnessV3-TaskGraph-v2 TG2-D41) The words of a no are told, for its turn to say; its lead's answer is in its name.
  /** @type {[string, string][]} */
  const told = [];
  const telling = workerAsker(registry, worker, (words, from) => told.push([words, from]));
  answer = { text: "No — clean it with the script instead." };
  await telling(judged, "q2b", null);
  answer = { text: "no — keep the build folder", by: "lead" };
  assert.deepEqual(await telling(judged, "q2c", null), { outcome: "answered", answers: { permission: { chosen: ["deny"], words: "no — keep the build folder" } }, by: "lead" });
  answer = { text: "yes", allow: true, by: "lead" };
  assert.deepEqual(await telling(judged, "q2d", null), { outcome: "answered", answers: { permission: { chosen: ["allow"] } }, by: "lead" });
  assert.deepEqual(told, [
    ["The developer said no to your bash call (rm -rf build), so it was not run: No — clean it with the script instead.", "developer"],
    ["Your lead said no to your bash call (rm -rf build), so it was not run: no — keep the build folder", "lead"],
  ]);
  assert.equal(deniedWords("edit", "", "not that file", "lead"), "Your lead said no to your edit call, so it was not run: not that file");
  answer = { text: "Switched to Full access", modeSwitch: true };
  assert.deepEqual(await ask(judged, "q3", null), { outcome: "switched" });
  answer = null;
  assert.equal(await ask(judged, "q4", null), null, "a wait its stop ended: no answer");
  // An edit shows the files it changes, as the loop's worker shows its call.
  const change = (/** @type {string} */ file) => ({ file, patch: "", added: 1, removed: 0, created: true, deleted: false, every: false, omitted: 0 });
  answer = { text: "yes", allow: true };
  asked.length = 0;
  await ask(fromJudged({ agent: "Fake", tool: "edit", words: "May I edit a.txt?", changes: [change("a.txt"), change("b.txt")], changesLeft: 3 }), "q9", null);
  assert.deepEqual(asked.map((x) => x.q), [{ tool: "edit", args: "a.txt, b.txt, 3 more", question: "May I edit a.txt?" }]);
  answer = null;
  // Where nobody can answer — a worker of a session no page answers, a plain sub-agent — the loop's words refuse it.
  asked.length = 0;
  assert.deepEqual(await workerAsker(registry, { ...worker, asks: false })(judged, "q5", null), { outcome: "answered", answers: { permission: { chosen: ["deny"], words: unattendedAsk("bash", null, "worker") } }, reason: NOBODY_TO_ASK.worker });
  assert.deepEqual(await workerAsker(registry, { ...worker, asks: false, team: null })(judged, "q6", null), { outcome: "answered", answers: { permission: { chosen: ["deny"], words: unattendedAsk("bash", null, "subagent") } }, reason: NOBODY_TO_ASK.subagent });
  // One that started by itself (AG-262): nobody launched it, so its words send the call to the developer's reading.
  assert.deepEqual(await workerAsker(registry, { ...worker, asks: false, team: null, self: true })(judged, "q7", null), { outcome: "answered", answers: { permission: { chosen: ["deny"], words: unattendedAsk("bash", null, "self") } }, reason: NOBODY_TO_ASK.self });
  assert.equal(NOBODY_TO_ASK.self, "it started by itself, and nobody is asked for it");
  assert.deepEqual(asked, [], "nobody was asked");
  // A question has nobody to answer it mid-task; a link is declined.
  const question = /** @type {any} */ ({ kind: "question", from: "elicitation", agent: "Fake", title: "Which?", detail: "", call: null, questions: [], plan: null, link: null, judged: null });
  assert.deepEqual(await ask(question, "q7", null), { outcome: "skipped", reason: "nobody could be asked here" });
  assert.deepEqual(await ask({ ...question, kind: "link", link: { url: "https://x", id: "l" } }, "q8", null), { outcome: "declined" });
});

// (fails before: yes — the second read of 11-10: a sub-agent's agent that offers only to always allow a call asked as a
// plain Allow, its question's words drawn nowhere, so a yes kept a session-long grant in that agent unsaid)
test("a worker's agent that offers only to always allow it: its ask says so, beside any reason it had", async () => {
  /** @type {any[]} */
  const asked = [];
  const registry = { ask: async (/** @type {string} */ id, /** @type {any} */ q) => (asked.push(q), { text: "yes", allow: true }) };
  const worker = { id: "sa_1", card: card("builder"), readOnly: false, asks: true, team: { ...BUILDERS, role: "tester" }, task: null };
  const ask = workerAsker(registry, worker);
  await ask(fromJudged({ agent: "Qoder", tool: "bash", words: "May I run make?", command: "make", always: true }), "q1", null);
  await ask(fromJudged({ agent: "Qoder", tool: "bash", words: "May I run rm?", command: "rm x", reason: "it deletes files", always: true }), "q2", null);
  await ask(fromJudged({ agent: "Qoder", tool: "bash", words: "May I run ls?", command: "ls" }), "q3", null);
  assert.deepEqual(asked.map((q) => [q.always, q.reason]), [[true, ALWAYS_REASON], [true, `it deletes files; ${ALWAYS_REASON}`], [undefined, undefined]]);
});

test("a message to a worker's agent says whose it is, as the loop's worker hears one", () => {
  assert.equal(workerNote({ text: "Check the docs too.", from: "lead" }), "Message from your team's lead, relayed by Filament (1 message). Acknowledge what you heard in your next reply before acting on it:\n- Check the docs too.");
  assert.equal(workerNote({ text: "Hurry.", from: "harness" }), "Message from the developer, relayed by Filament (1 message). Acknowledge what you heard in your next reply before acting on it:\n- Hurry.");
  // Filament's own word — why a call was refused, or since TG2-D59 that it is stuck — under its own head, nobody's
  // message relayed.
  assert.equal(workerNote({ text: "That file is in your worktree.", from: SHIM }), "Word from Filament, which runs this session and answers your permission requests (1 message). Acknowledge what you heard in your next reply before acting on it:\n- That file is in your worktree.");
});

test("how a worker's agent turn ended, in the registry's words", () => {
  const ended = (/** @type {any} */ o) => workerStatus({ stopped: false, hungUp: false, stopReason: "end_turn", ...o });
  assert.deepEqual(
    [ended({}), ended({ stopped: true, stopReason: "cancelled" }), ended({ hungUp: true }), ended({ stopReason: "refusal" }), ended({ stopReason: "cancelled" }), ended({ stopReason: "max_tokens" }), ended({ stopReason: "max_turn_requests" }), ended({ stopReason: null })],
    ["done", "stopped", "aborted", "failed", "failed", "budget-stopped", "budget-stopped", "done"],
  );
});

// (fails before: no — a guard the mutation pass asked for: a next prompt that dropped what the agent had said, and a
// joined turn that kept only the later prompt's output tokens or lines added, passed every test)
test("a turn that goes on within its request: the next prompt follows the turn so far as the archive keeps it, and the turn the record keeps adds up both prompts", () => {
  const body = { model: "coder-1", messages: [{ role: "user", content: "run t2" }] };
  const soFar = { work: [{ role: "assistant", content: [{ type: "text", text: "Looking." }] }, { role: "user", content: [{ type: "text", text: "and the docs" }] }], final: [{ type: "text", text: "Looked at both." }] };
  assert.deepEqual(followedBody(body, soFar, "Report, please.").messages, [{ role: "user", content: "run t2" }, ...soFar.work, { role: "assistant", content: soFar.final }, { role: "user", content: "Report, please." }]);
  assert.deepEqual(followedBody(body, { work: [], final: [] }, "Report, please.").messages, [{ role: "user", content: "run t2" }, { role: "user", content: "Report, please." }], "an agent that said nothing adds no empty answer");
  const usage = (/** @type {number} */ n) => ({ input: n, output: n + 1, cacheRead: n + 2, cacheWrite: n + 3, total: 4 * n + 6 });
  const a = { reused: false, seeded: true, resumed: false, stopReason: "end_turn", notes: ["a"], structured: [], usage: usage(10), modelUsage: [{ model: "m", input: 10, output: 11, cacheRead: 12, cacheWrite: 13 }], linesAdded: 3, linesRemoved: 1 };
  const b = { reused: true, seeded: false, resumed: true, stopReason: "max_tokens", notes: ["b"], structured: [{ kind: "plan" }], usage: usage(20), modelUsage: [{ model: "m", input: 20, output: 21, cacheRead: 22, cacheWrite: 23 }, { model: "n", input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }], linesAdded: 5 };
  assert.deepEqual(joinTurns(a, b), {
    reused: false, seeded: true, resumed: false, stopReason: "max_tokens", notes: ["a", "b"], structured: [{ kind: "plan" }],
    usage: { input: 30, output: 32, cacheRead: 34, cacheWrite: 36, total: 132 },
    modelUsage: [{ model: "m", input: 30, output: 32, cacheRead: 34, cacheWrite: 36 }, { model: "n", input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }],
    linesAdded: 8, linesRemoved: 1,
  });
});

// (fails before: no — a guard the mutation pass asked for: a report from a session that works on no task of the
// graph's went in, and passed every test)
test("a graph task's report: offered to a run on a task, and taken there; one from a session on no task is refused, one that does not read says why, and one after its run ended has nothing to report to", async () => {
  const tools = createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => null, turns: createAgentTurns(), subagents: () => null, membersOf: () => null });
  const at = { chain: "c1", turn: null, graph: false, report: true, team: false, cwd: "/w", upstream: "cli" };
  assert.deepEqual([tools.list(at).map((t) => t.name), tools.list({ ...at, report: false })], [["report"], []]);
  const report = { status: "done", did: "Mapped a.txt.", met: true, evidence: "a.txt is listed" };
  /** @type {any[]} */
  const told = [];
  const emit = (/** @type {any} */ ev) => told.push(ev);
  assert.deepEqual(await tools.call("report", report, { ...at, report: false, emit }), { text: "Not run: this session works on no task of the graph's.", isError: true });
  assert.deepEqual(await tools.call("report", { ...report, did: "" }, { ...at, emit }), { text: "report needs did: what you did, in a few lines", isError: true });
  assert.deepEqual(await tools.call("report", report, { ...at, emit: null }), { text: "Not run: your task's run has ended, so there is nothing to report to.", isError: true });
  assert.equal(told.length, 0, "nothing reached a run");
  assert.deepEqual(await tools.call("report", report, { ...at, emit }), { text: REPORT_IN });
  assert.deepEqual(told.map((e) => [e.type, e.report.did, e.report.met]), [["task-report", "Mapped a.txt.", true]]);
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

const SCOUT = { role: "scout", description: "Map the folder", goal: "know what is here", steps: ["List the files"], acceptance: "every file is named" };
const BUILD = { role: "builder", description: "Write the out file", goal: "out.txt greets", files: ["out.txt"], steps: ["~writefile"], acceptance: "out.txt holds the greeting" };
const TEST = { role: "tester", description: "Clean the build", goal: "the build folder is gone", steps: ["~permbash"], acceptance: "build is gone" };
const STEER = { role: "tester", description: "Wait for word", goal: "hear the lead", steps: ["~steerable"], acceptance: "the lead's word is heard" };
const HANG = { role: "tester", description: "Work on and on", goal: "never finish", steps: ["hang"], acceptance: "it is stopped" };
const TOLD = "Check the docs folder too.";
const REPORTED = { status: "done", did: "Mapped a.txt.", met: true, evidence: "a.txt is listed" };
const REPORTS = { id: "t1", name: "Map with a report", by: "scout", goal: "the files are known", steps: [`~mcpcall report ${JSON.stringify(REPORTED)}`], acceptance: "each file is listed" };
const SILENT = { id: "t2", name: "Map without one", by: "scout", goal: "the files are known", steps: ["List the files"], acceptance: "each file is listed" };
// A graph task's sub-agent that gives its report, then its agent dies.
const CRASHES = { id: "t1", name: "Report, then crash", by: "scout", goal: "the files are known", steps: [`~mcpcall report ${JSON.stringify(REPORTED)} ~crash`], acceptance: "each file is listed" };
// A graph task's sub-agent that works until the developer's word comes into its turn, then ends without its report.
const HEARS = { id: "t1", name: "Hear the developer", by: "scout", goal: "the files are known", steps: ["~steerable"], acceptance: "each file is listed" };
// The same, for the developer's command sent before their words: its agent's own, which waits for its turn's end.
const HOLDS = { id: "t1", name: "Hold the developer's command", by: "scout", goal: "the files are known", steps: ["~steerable"], acceptance: "each file is listed" };
// A graph task's sub-agent whose agent fails its prompt after a call, the first time its words are sent.
const FAILS = { id: "t1", name: "Fail after a call", by: "scout", goal: "the files are known", steps: ["~failonce b2 List the files"], acceptance: "each file is listed" };
// A worker whose turn says what it was worth at the API's prices.
const PRICED = { role: "scout", description: "Map it at a price", goal: "know what is here", steps: ["~priced"], acceptance: "every file is named" };
// A graph task's sub-agent whose turn spends and ends without its report, and whose agent fails the prompt that asks it.
const SPENDS = { id: "t1", name: "Spend, then fail when asked", by: "scout", goal: "the files are known", steps: ["~priced ~failsecond List the files"], acceptance: "each file is listed" };
// The same on Codex's and Cursor's fakes.
const FAILS_NEXT = { id: "t1", name: "Spend, then fail when asked", by: "scout", goal: "the files are known", steps: ["~nextfails List the files"], acceptance: "each file is listed" };
// A graph task's sub-agent whose turn spends and ends without its report, and whose agent spends again answering the
// prompt that asks it.
const PRICED_TWICE = { id: "t1", name: "Spend, and again when asked", by: "scout", goal: "the files are known", steps: ["~priced ~pricesecond List the files"], acceptance: "each file is listed" };
// A graph task's sub-agent that loads a skill with Filament's tool, compacts its own context with no step after, and
// ends without its report.
const COMPACTS = { id: "t1", name: "Compact, then end", by: "scout", goal: "the files are known", steps: ["~skillfirst filament-setup ~compactthen List the files"], acceptance: "each file is listed" };

/** @param {any} b */
const sysOf = (b) => (Array.isArray(b?.system) ? b.system.map((/** @type {any} */ x) => x?.text ?? "").join("\n") : String(b?.system || ""));
/** @param {any} content */
const textOf = (content) => (typeof content === "string" ? content : (content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join(""));
/** A JSONL file's lines, parsed. @param {string} file */
const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

before(async () => {
  folder = mkdtempSync(join(tmpdir(), "filament-agent-workers-"));
  logs = mkdtempSync(join(tmpdir(), "filament-agent-workers-logs-"));
  const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: folder, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(folder, "a.txt"), "one\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  up = await fakeUpstream(async (call) => {
    const b = call.body || {};
    const all = JSON.stringify(b.messages || []);
    const model = String(b.model || "");
    const blocks = (/** @type {any[]} */ list, stop = "end_turn") => anthropicReply("", { model, stop, blocks: list, usage: { input_tokens: 5, output_tokens: 3 } });
    const say = (/** @type {string} */ text) => blocks([{ type: "text", text }]);
    const use = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => blocks([{ type: "tool_use", id, name, input }], "tool_use");
    const reported = (/** @type {string} */ role) => new RegExp(`\\[Filament: your ${role} (sa_[0-9a-f]{8})`).exec(all);
    const launched = (/** @type {string} */ role) => new RegExp(`Launched ${role} (sa_[0-9a-f]{8})`).exec(all);
    // The graphs below are a team's lead's (the owner's word of 10-26: under a plain session's agent a graph task runs on
    // the planner's own model, so a task's agent on a coding agent is a crew's). A graph on an agent: it waits for both
    // tasks' ends.
    if (all.includes("run the graph on an agent")) {
      if (!all.includes("toolu_graph")) return use("toolu_graph", "tasks", { action: "add", goal: "Map it on an agent", tasks: [REPORTS, SILENT] });
      return say(all.includes("[Filament: task t1 ") && all.includes("[Filament: task t2 ") ? "GRAPH DONE" : "Waiting for the graph.");
    }
    // A graph whose task's agent dies after its report.
    if (all.includes("run the crashing graph")) {
      if (!all.includes("toolu_crashgraph")) return use("toolu_crashgraph", "tasks", { action: "add", goal: "Report, then fail", tasks: [CRASHES] });
      return say(all.includes("[Filament: task t1 ") ? "CRASH GRAPH DONE" : "Waiting for the graph.");
    }
    // A graph whose task's agent fails after a call: it waits for the task's end,
    // and for its second once the developer sent the task back.
    if (all.includes("run the failing graph")) {
      if (!all.includes("toolu_failgraph")) return use("toolu_failgraph", "tasks", { action: "add", goal: "Fail, then go again", tasks: [FAILS] });
      return say(all.split("[Filament: task t1 ").length - 1 >= (all.includes("see the new try through") ? 2 : 1) ? "FAIL GRAPH DONE" : "Waiting for the graph.");
    }
    // A graph whose task's agent hears the developer, then gives no report.
    if (all.includes("run the heard graph")) {
      if (!all.includes("toolu_heardgraph")) return use("toolu_heardgraph", "tasks", { action: "add", goal: "Hear the developer", tasks: [HEARS] });
      return say(all.includes("[Filament: task t1 ") ? "HEARD GRAPH DONE" : "Waiting for the graph.");
    }
    // The same on Codex's and Cursor's fakes.
    if (all.includes("run the next-failing graph")) {
      if (!all.includes("toolu_nextgraph")) return use("toolu_nextgraph", "tasks", { action: "add", goal: "Spend, then fail", tasks: [FAILS_NEXT] });
      return say(all.includes("[Filament: task t1 ") ? "NEXT GRAPH DONE" : "Waiting for the graph.");
    }
    // A graph whose task's agent spends, gives no report, and spends again answering the prompt that asks for it.
    if (all.includes("run the twice-priced graph")) {
      if (!all.includes("toolu_twicegraph")) return use("toolu_twicegraph", "tasks", { action: "add", goal: "Spend twice", tasks: [PRICED_TWICE] });
      return say(all.includes("[Filament: task t1 ") ? "TWICE GRAPH DONE" : "Waiting for the graph.");
    }
    // A graph whose task's agent spends, gives no report, and fails the prompt that asks for it.
    if (all.includes("run the spending graph")) {
      if (!all.includes("toolu_spendgraph")) return use("toolu_spendgraph", "tasks", { action: "add", goal: "Spend, then fail", tasks: [SPENDS] });
      return say(all.includes("[Filament: task t1 ") ? "SPEND GRAPH DONE" : "Waiting for the graph.");
    }
    // A graph whose task's agent compacts its own context, takes no step after, and gives no report.
    if (all.includes("run the compacting graph")) {
      if (!all.includes("toolu_compactgraph")) return use("toolu_compactgraph", "tasks", { action: "add", goal: "Compact, then end", tasks: [COMPACTS] });
      return say(all.includes("[Filament: task t1 ") ? "COMPACT GRAPH DONE" : "Waiting for the graph.");
    }
    if (all.includes("run the holding graph")) {
      if (!all.includes("toolu_holdgraph")) return use("toolu_holdgraph", "tasks", { action: "add", goal: "Hold the developer's command", tasks: [HOLDS] });
      return say(all.includes("[Filament: task t1 ") ? "HOLDING GRAPH DONE" : "Waiting for the graph.");
    }
    if (sysOf(b).includes(String(PROMPT.leadRole))) {
      if (all.includes("scout with an agent")) return reported("scout") ? say("LEAD SAW THE AGENT SCOUT") : launched("scout") ? use("toolu_wait_sc", "wait", { seconds: 60 }) : use("toolu_scout", "agent", SCOUT);
      if (all.includes("build with an agent")) {
        if (all.includes("Applied the changes of sub-agent")) return say("LEAD DONE: out.txt is in.");
        if (all.includes("toolu_wait_more")) return use("toolu_apply", "worker", { agent_id: /** @type {RegExpExecArray} */ (reported("builder"))[1], apply_changes: true });
        if (all.includes("took your follow-up")) return use("toolu_wait_more", "wait", { seconds: 60 });
        const built = reported("builder");
        if (built) return use("toolu_more", "worker", { agent_id: built[1], prompt: "Say it once more." });
        return launched("builder") ? use("toolu_wait_b", "wait", { seconds: 60 }) : use("toolu_build", "agent", BUILD);
      }
      // A Builder whose agent asks to write a file in the developer's folder, by its full path.
      if (all.includes("stray with an agent"))
        return reported("builder")
          ? say("LEAD HEARD THE STRAY BUILDER")
          : launched("builder")
            ? use("toolu_wait_st", "wait", { seconds: 60 })
            : use("toolu_stray", "agent", { role: "builder", description: "Write past the worktree", goal: "stray.txt greets", files: ["stray.txt"], steps: [`~permwrite ${folder.split("\\").join("/")}/stray.txt ~hears`], acceptance: "stray.txt holds the greeting" });
      // And one whose agent, with its shell, writes a file there, and tries the same command once more.
      if (all.includes("reach with an agent"))
        return reported("builder")
          ? say("LEAD HEARD THE REACHING BUILDER")
          : launched("builder")
            ? use("toolu_wait_re", "wait", { seconds: 60 })
            : use("toolu_reach", "agent", { role: "builder", description: "Run past the worktree", goal: "reach.txt greets", files: ["reach.txt"], steps: [`~permbash echo hi > ${folder.split("\\").join("/")}/reach.txt ~hears ~again`], acceptance: "reach.txt holds the greeting" });
      // And one whose lead reviews its plan, whose agent asks to write before it sends one, twice (TG2-D50).
      if (all.includes("hold with an agent"))
        return reported("builder")
          ? say("LEAD HEARD THE HELD BUILDER")
          : launched("builder")
            ? use("toolu_wait_hd", "wait", { seconds: 60 })
            : use("toolu_hold", "agent", { role: "builder", description: "Write before its plan", goal: "notes.md holds notes", files: ["notes.md"], steps: ["~permwrite ~hears ~again"], acceptance: "notes.md holds notes", plan_review: true });
      // The lead answers its Tester's waiting call itself, once a look shows it waiting: no, with what to do instead.
      // Or yes, where the team works in Autonomous mode, as these sessions do.
      if (all.includes("answer the agent") || all.includes("allow the agent")) {
        const yes = all.includes("allow the agent");
        if (reported("tester")) return say(yes ? "LEAD ALLOWED THE TESTER" : "LEAD ANSWERED THE TESTER");
        const on = launched("tester");
        // `its always`: its agent offers only to always allow the call.
        if (!on) return use("toolu_ans", "agent", { ...TEST, description: "Clean on the lead's word", steps: [yes ? (all.includes("its always") ? "~permalways" : "~permbash") : "~permbash ~hears"] });
        if (all.includes("toolu_answer")) return use("toolu_wait_an2", "wait", { seconds: 60 });
        // It answers the question its newest look shows, by the number the look gives it (TG2-D42).
        const asks = [...all.matchAll(/waiting for the developer's answer \(ask (\d+)\)/g)];
        if (asks.length) return use("toolu_answer", "worker", { agent_id: on[1], answer: yes ? "yes" : "no — keep the build folder; list it instead", ask: Number(asks.at(-1)?.[1]), ...(yes ? { allow: true } : {}) });
        return use(`toolu_wait_an${(all.match(/toolu_wait_an/g) || []).length}`, "wait", { seconds: 60 });
      }
      // And one whose agent asks to read a file in the developer's folder, by its full path.
      if (all.includes("peek with an agent"))
        return reported("builder")
          ? say("LEAD HEARD THE PEEKING BUILDER")
          : launched("builder")
            ? use("toolu_wait_pk", "wait", { seconds: 60 })
            : use("toolu_peek", "agent", { role: "builder", description: "Read past the worktree", goal: "peek.txt greets", files: ["peek.txt"], steps: [`~permread ${folder.split("\\").join("/")}/README.md ~hears`], acceptance: "peek.txt holds the greeting" });
      if (all.includes("scout on a paid agent")) return reported("scout") ? say("LEAD SAW THE PAID SCOUT") : launched("scout") ? use("toolu_wait_p", "wait", { seconds: 60 }) : use("toolu_paid", "agent", PRICED);
      if (all.includes("test with an agent")) return reported("tester") ? say("LEAD HEARD THE TESTER") : launched("tester") ? use("toolu_wait_t", "wait", { seconds: 60 }) : use("toolu_test", "agent", TEST);
      // The lead messages its worker, and stops one, once the agent is at its task: its run is there to reach.
      if (all.includes("message the agent")) {
        if (reported("tester")) return say("LEAD HEARD BACK");
        const on = launched("tester");
        if (!on) return use("toolu_steer", "agent", STEER);
        if (all.includes("toolu_msg")) return use("toolu_wait_m2", "wait", { seconds: 60 });
        await until(async () => promptsWith(`Your task: ${STEER.description}`).length > 0, "the agent to take its task", { timeoutMs: 20_000 });
        return blocks([{ type: "tool_use", id: "toolu_msg", name: "worker", input: { agent_id: on[1], prompt: TOLD } }, { type: "tool_use", id: "toolu_wait_m", name: "wait", input: { seconds: 60 } }], "tool_use");
      }
      if (all.includes("stop the agent")) {
        if (reported("tester")) return say("LEAD STOPPED IT");
        const on = launched("tester");
        if (!on) return use("toolu_hang", "agent", HANG);
        if (all.includes("toolu_stop")) return use("toolu_wait_x", "wait", { seconds: 60 });
        await until(async () => promptsWith(`Your task: ${HANG.description}`).length > 0, "the agent to take its task", { timeoutMs: 20_000 });
        return use("toolu_stop", "worker", { agent_id: on[1], stop: true });
      }
      return say("LEAD ANSWER");
    }
    // The plain session's agent: a sub-agent whose command nobody can approve.
    // The same, its agent offering only to always allow the call.
    if (all.includes("build it with a sub-agent")) return all.includes("toolu_subalways") ? say("AGENT HEARD THE BUILDER") : use("toolu_subalways", "agent", { run_in_background: false, description: "Build it", prompt: "~permalways" });
    if (all.includes("clean it with a sub-agent")) return all.includes("toolu_sub") ? say("AGENT HEARD THE SUB-AGENT") : use("toolu_sub", "agent", { run_in_background: false, description: "Clean the build", prompt: "~permbash" });
    return say("MODEL ANSWER");
  });
  shim = await startApp({ memory: true, keep: true, configure, overrides: { cursorSdkLoader: () => import(FAKE_SDK) } });
});
after(async () => {
  await shim.stop();
  await up.close();
  // Waited for: on Windows a worker's process can hold the folder a moment after the stop (the full suites of 10-25
  // and 10-27: EPERM within 40 ms — rmSync's own maxRetries never retried).
  await removeDirs(folder, logs, shim.dataDir);
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
      acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_STEERING: "1", FAKE_ACP_CALLS: join(logs, "calls.jsonl"), FAKE_ACP_LOG: join(logs, "prompts.jsonl"), FAKE_ACP_TICK_DIR: join(logs, "ticks") }, cwdDefault: dataDir, permissions: "allow-all", clientBridge: "full" },
    },
    // Claude's adapter on an API key: its turns are billed by use.
    {
      id: "paid",
      name: "paid",
      type: "acp",
      enabled: true,
      acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_AUTH: "key", FAKE_ACP_CALLS: join(logs, "calls.jsonl"), FAKE_ACP_LOG: join(logs, "prompts.jsonl") }, cwdDefault: dataDir, permissions: "allow-all", clientBridge: "full" },
    },
  ];
  // An agent that closes a session it is asked to, and opens one again without its history (Claude Code's, Codex's).
  cfg.upstreams.push({
    id: "closer",
    name: "closer",
    type: "acp",
    enabled: true,
    acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_SESSION_CAPS: "close,resume", FAKE_ACP_CALLS: join(logs, "closer-calls.jsonl"), FAKE_ACP_LOG: join(logs, "closer-prompts.jsonl") }, cwdDefault: dataDir, permissions: "allow-all", clientBridge: "full" },
  });
  // An agent nobody is signed in to: its login is read from its own folder, which holds none.
  cfg.upstreams.push({
    id: "out",
    name: "out",
    type: "acp",
    enabled: true,
    acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_HOME_LOGIN: "1", CLAUDE_CONFIG_DIR: join(logs, "no-login") }, cwdDefault: dataDir, permissions: "allow-all", clientBridge: "full" },
  });
  // Workers on Codex and on Cursor's SDK.
  cfg.upstreams.push(
    { id: "cxw", name: "cxw", type: "codex", enabled: true, acp: { command: process.execPath, args: [FAKE_CODEX], env: {}, cwdDefault: dataDir, permissions: "allow-all" } },
    { id: "curw", name: "curw", type: "cursor-sdk", enabled: true, apiKey: "ck-test", acp: { cwdDefault: dataDir, permissions: "allow-all" } },
  );
  cfg.routes = [
    { match: "cxw-*", upstream: "cxw", upstreamModel: "gpt-6-astra", enabled: true },
    { match: "curw-*", upstream: "curw", upstreamModel: "composer-2.5", enabled: true },
    { match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true },
    { match: "coder-*", upstream: "cli", upstreamModel: "{model}", enabled: true },
    { match: "closer-*", upstream: "closer", upstreamModel: "{model}", enabled: true },
    { match: "out-*", upstream: "out", upstreamModel: "{model}", enabled: true },
    { match: "paid-*", upstream: "paid", upstreamModel: "{model}", enabled: true },
    // A worker's agent with a provider as its route's backup.
    { match: "backedw-*", upstream: "cli", upstreamModel: "{model}", enabled: true, fallbacks: [{ upstream: "m", upstreamModel: "m-1" }] },
  ];
  cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
  cfg.memory.autopilot = { enabled: false };
}

/** A harness session in the repository, its workers on the fake agent. @param {any} [settings] */
const newSession = async (settings = { engine: { mode: "team", team: "builders" }, subagents: { pool: [{ model: "coder-1", seats: 4 }] } }) => {
  const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1", preset: "plain", settings } });
  assert.equal(r.status, 200, await r.clone().text());
  return String((await r.json()).id);
};
/** One harness turn, answered whole. @param {string} id @param {string} content */
const turn = async (id, content) => {
  const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
  assert.equal(r.status, 200, await r.clone().text());
  return { text: textOf((await r.json()).content), id: String(r.headers.get("x-filament-request-id")) };
};
/** The session's sub-agents. @param {string} id */
const subagentsOf = async (id) => /** @type {any[]} */ ((await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json()).subagents);
/** A run, through the run's route. @param {string} runId */
const runOf = async (runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}`)).json()).run;
/** A run's events so far. @param {string} runId */
const runEvents = async (runId) => /** @type {any[]} */ ((await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0`)).json()).events || []);
/** The fake agent's prompts whose words carry `marker`. @param {string} marker */
const promptsWith = (marker) => lines(join(logs, "prompts.jsonl")).filter((p) => String(p.text).includes(marker));

test("a Scout whose model is a coding agent runs as that agent: in an agent session of its own, in the session's folder, told its part through the agent's system channel; its run hangs off its lead's turn, and its report reaches the lead", async () => {
  const id = await newSession();
  const mark = up.received.length;
  const t = await turn(id, "scout with an agent");
  assert.equal(t.text, "LEAD SAW THE AGENT SCOUT");

  const [sa] = await subagentsOf(id);
  assert.deepEqual([sa.engine, sa.model, sa.card.tag, sa.may, sa.team?.role, sa.status], ["acp", "coder-1", "reviewer", "read", "scout", "done"]);
  // The agent heard the brief in a session of its own, in the session's folder (a Scout changes nothing: no worktree).
  const [prompt] = promptsWith("Your task: Map the folder");
  assert.equal(prompt.cwd, folder);
  assert.ok(prompt.text.startsWith("Your task: Map the folder"), `its brief alone, nothing of its session's conversation:
${prompt.text}`);
  const opened = lines(join(logs, "calls.jsonl")).find((c) => c.method === "session/new" && c.sessionId === prompt.sessionId);
  const system = String(opened?.system || "");
  assert.ok(system.includes(`<filament-context kind="${ROLE_BLOCK}">`) && system.includes(SHIPPED_CARDS.reviewer.thinks) && system.includes(`Team Builders asks of you: ${SCOUT_LINE}`), "its part rode the agent's system channel");
  // Its run: a sub-agent's, under the lead's turn, the agent's own events on it.
  const run = await runOf(String(sa.runId || sa.exchanges?.at(-1)?.runId));
  assert.deepEqual([run.kind, run.parentId, run.meta?.engine, run.meta?.subagent, run.meta?.card], ["subagent", t.id, "acp", sa.id, "reviewer"]);
  // (fails before: no — a guard the mutation pass asked for: a worker's own calls that never reached its card on its
  // lead's run passed every test)
  const onLead = await runEvents(t.id);
  const card = onLead.find((e) => e.type === "subagent-start" && e.agentId === sa.id);
  assert.ok(card && onLead.some((e) => e.type === "subagent-tool-start" && e.parent === card.parent), "its agent's call, on its card on the lead's run");
  // The report: the agent's closing words, in the lead's next request.
  const lead = up.received.slice(mark).filter((c) => sysOf(c.body).includes(String(PROMPT.leadRole)));
  assert.match(JSON.stringify(lead.at(-1)?.body.messages), /\[Filament: your scout sa_[0-9a-f]{8} .*echo\(1\): /);
  // Nothing of its conversation is the session's: one turn, the lead's.
  const archive = /** @type {any} */ (shim.app).memory.archive;
  assert.equal(archive.getTurns(archive.getChain(id).id).length, 1);
});

test("a Builder on a coding agent works in its own worktree, which its lead applies; its follow-up goes on in the same agent session; and how each exchange went is kept as a worker's outcome", async (ctx) => {
  // Memory keeps a run's outcome where its autopilot is on (M7-D51).
  const autopilot = /** @type {any} */ (shim.app).config.memory.autopilot;
  Object.assign(autopilot, { enabled: true, tools: false });
  ctx.after(() => Object.assign(autopilot, { enabled: false }));
  const id = await newSession();
  const t = await turn(id, "build with an agent");
  assert.equal(t.text, "LEAD DONE: out.txt is in.");

  const [sa] = await subagentsOf(id);
  assert.deepEqual([sa.engine, sa.team?.role, sa.status, sa.work?.applied, sa.exchanges.length], ["acp", "builder", "done", 1, 2]);
  const worktree = String(await taskWorktreePath(folder, sa.id));
  const [built] = promptsWith(`Your task: ${BUILD.description}`);
  const [more] = promptsWith("Say it once more.");
  assert.equal(built.cwd.replace(/\\/g, "/"), worktree.replace(/\\/g, "/"), "it worked in its own worktree");
  assert.deepEqual([more.sessionId, more.cwd], [built.sessionId, built.cwd], "its follow-up went on in its agent session");
  assert.ok(built.text.startsWith(SUBAGENT_NOTES.workerWorktree), `its worktree's note and its brief, nothing of its session's conversation:
${built.text}`);
  assert.match(String(sa.exchanges[0].report), /^wrote echo\(1\): /);
  assert.match(String(sa.exchanges[1].report), /^echo\(2\): /);
  // Its write went through Filament's hands into the worktree; the lead's apply brought it into the folder.
  assert.equal(readFileSync(join(folder, "out.txt"), "utf8"), "hello from agent");
  assert.equal(copyState(worktree), "parked", "its copy is parked for its next question");

  const rows = /** @type {any} */ (shim.app.memory).archive.outcomes.list({ since: 0, kind: "worker" }).filter((/** @type {any} */ o) => o.agent === "builder");
  assert.deepEqual(rows.map((/** @type {any} */ o) => [o.request_id, o.model, o.ended]).sort(), sa.exchanges.map((/** @type {any} */ x) => [x.runId, "coder-1", "done"]).sort());
});

// (fails before: yes — the session's switch ran a Builder's write to a file in the developer's folder, so its change
// landed past the apply, and it was never told where its worktree is: HarnessV3-TaskGraph-v2 §12.18, V2-0b's drive)
test("a Builder on a coding agent is held to its worktree: it is told the folder by name, a file it asks to write in the developer's folder is refused, on its record, and it hears from Filament where the same file is", async () => {
  const id = await newSession();
  const t = await turn(id, "stray with an agent");
  assert.equal(t.text, "LEAD HEARD THE STRAY BUILDER");
  const [sa] = await subagentsOf(id);
  assert.deepEqual([sa.engine, sa.team?.role, sa.status], ["acp", "builder", "done"]);
  const slashed = (/** @type {string} */ p) => p.split("\\").join("/");
  const worktree = slashed(String(await taskWorktreePath(folder, sa.id)));
  const [built] = promptsWith("Your task: Write past the worktree");
  assert.equal(slashed(built.cwd), worktree, "it worked in its own worktree");
  // Its worktree's note, then the folder by name, then its brief.
  assert.ok(slashed(built.text).startsWith(`${SUBAGENT_NOTES.workerWorktree}\n${slashed(SUBAGENT_NOTES.agentWorktree(built.cwd, folder))}\nYour task: Write past the worktree`), built.text);
  assert.equal(
    SUBAGENT_NOTES.agentWorktree("W:/t", "P:/proj"),
    "[Filament: your worktree is W:/t. It holds the project's files at the same paths as the developer's folder, P:/proj: where the conversation above or your brief names a file there, the one you read, change and run things on is at the same path under your worktree. Your own tools take full paths: a change to a file outside your worktree is refused (the system temp folder aside, for scratch files of your own), and so is a read or a command in the developer's folder.]",
  );
  // The write was refused, whatever the session's mode or rules: nobody was asked. Its agent heard only a no: the
  // word that says where the same file is came from Filament, queued at the agent, which took it at its next step.
  const stray = `${slashed(folder)}/stray.txt`;
  const word = strayWords({ path: stray }, built.cwd, folder);
  assert.ok(word.includes(`The same file is ${join(built.cwd, "stray.txt")} `), word);
  assert.equal(sa.exchanges[0].report, `permwrite: reject heard:${workerNote({ text: word, from: SHIM })}`);
  assert.deepEqual(lines(join(logs, "calls.jsonl")).filter((c) => String(c.words).includes("stray.txt")).map((c) => [c.method, c.words]), [["queued prompt", workerNote({ text: word, from: SHIM })]], "said once");
  const rec = await (await shim.api(`/api/requests/${encodeURIComponent(sa.exchanges[0].runId)}`)).json();
  const judged = [...new Set([...((rec.request || rec).priorChanges || []), ...((rec.request || rec).changes || [])].filter((/** @type {string} */ c) => c.startsWith("permission: ")).map(slashed))];
  // (The scripted agent titles every write "Write notes.md"; the file it asked for is the one the refusal names.)
  assert.deepEqual(judged, [`permission: cli asked to write notes.md — refused: ${stray} is outside the worktree it works in (${worktree}), and its change is read from there`], judged.join("\n"));
  assert.ok(!(await runEvents(t.id)).some((e) => e.type === "subagent-ask"), "no question went to the developer");
  assert.equal(existsSync(join(folder, "stray.txt")), false);
});

// (fails before: yes — nothing held a worker's changes for its plan: the switch ran its write in Autonomous mode, and its
// agent read nothing of its lead's review — HarnessV3-TaskGraph-v2 TG2-D50, case 46)
test("a Builder on a coding agent whose lead reviews its plan: Filament's note is right ahead of its brief, a write it asks for before its plan is refused each time with nobody asked, on its record, and it hears from Filament why, once", async () => {
  const id = await newSession();
  const t = await turn(id, "hold with an agent");
  assert.equal(t.text, "LEAD HEARD THE HELD BUILDER");
  const [sa] = await subagentsOf(id);
  assert.deepEqual([sa.engine, sa.team?.role, sa.status], ["acp", "builder", "done"]);
  const slashed = (/** @type {string} */ p) => p.split("\\").join("/");
  const [built] = promptsWith("Your task: Write before its plan");
  // Its worktree's note, the folder by name, then Filament's note on its plan's review, right ahead of its brief.
  assert.ok(slashed(built.text).startsWith(`${SUBAGENT_NOTES.workerWorktree}\n${slashed(SUBAGENT_NOTES.agentWorktree(built.cwd, folder))}\n${SUBAGENT_NOTES.planReview}\nYour task: Write before its plan`), built.text);
  // It asked twice and was refused twice, nobody asked; the hold's words came from Filament, once.
  assert.equal(sa.exchanges[0].report, `permwrite: reject heard:${workerNote({ text: PLAN_HELD, from: SHIM })}`);
  assert.deepEqual(lines(join(logs, "calls.jsonl")).filter((c) => String(c.words).includes("Not run: your lead reviews your plan")).map((c) => [c.method, c.words]), [["queued prompt", workerNote({ text: PLAN_HELD, from: SHIM })]], "said once");
  const rec = await (await shim.api(`/api/requests/${encodeURIComponent(sa.exchanges[0].runId)}`)).json();
  const all = (rec.request || rec).changes?.length ? (rec.request || rec).changes : (rec.request || rec).priorChanges || [];
  const refused = "permission: cli asked to write notes.md — refused: its plan waits for its lead's review (plan_review)";
  assert.deepEqual(all.filter((/** @type {string} */ c) => c.startsWith("permission: ")), [refused, refused], all.join("\n"));
  assert.ok(!(await runEvents(t.id)).some((e) => e.type === "subagent-ask"), "no question went to the developer");
});

// (fails before: yes — the switch asked the developer about the command as about any, and their yes wrote the file in
// their folder, past the apply: HarnessV3-TaskGraph-v2 §12.18, TG2-D38)
test("a Builder on a coding agent whose command writes a file in the developer's folder: refused each time it tries with nobody asked, on its record, and it hears from Filament where its command belongs, once", async () => {
  const id = await newSession();
  const t = await turn(id, "reach with an agent");
  assert.equal(t.text, "LEAD HEARD THE REACHING BUILDER");
  const [sa] = await subagentsOf(id);
  assert.deepEqual([sa.engine, sa.team?.role, sa.status], ["acp", "builder", "done"]);
  const slashed = (/** @type {string} */ p) => p.split("\\").join("/");
  const [built] = promptsWith("Your task: Run past the worktree");
  const command = `echo hi > ${slashed(folder)}/reach.txt`;
  const word = strayWords({ command }, built.cwd, folder);
  // It asked twice and was refused twice; the word, the same both times, was said to it once.
  assert.equal(sa.exchanges[0].report, `permbash: reject heard:${workerNote({ text: word, from: SHIM })}`);
  assert.deepEqual(lines(join(logs, "calls.jsonl")).filter((c) => String(c.words).includes("Filament refused your command")).map((c) => [c.method, c.words]), [["queued prompt", workerNote({ text: word, from: SHIM })]], "said once");
  const rec = await (await shim.api(`/api/requests/${encodeURIComponent(sa.exchanges[0].runId)}`)).json();
  const all = (rec.request || rec).changes?.length ? (rec.request || rec).changes : (rec.request || rec).priorChanges || [];
  const judged = all.filter((/** @type {string} */ c) => c.startsWith("permission: "));
  const refused = `permission: cli asked to run \`${command}\` — refused: its command reaches the developer's folder (${folder}), outside the worktree it works in (${built.cwd}): its commands run on its worktree's files`;
  assert.deepEqual(judged, [refused, refused], judged.join("\n"));
  assert.ok(!(await runEvents(t.id)).some((e) => e.type === "subagent-ask"), "no question went to the developer");
  assert.equal(existsSync(join(folder, "reach.txt")), false);
});

// (fails before: yes — the switch ran a worker's read of the developer's folder, so it read the developer's copy, not
// its own with its changes: HarnessV3-TaskGraph-v2 §12.18, TG2-D39)
test("a Builder on a coding agent that asks to read a file in the developer's folder: refused with nobody asked, on its record, and it hears from Filament where the same file is", async () => {
  const id = await newSession();
  const t = await turn(id, "peek with an agent");
  assert.equal(t.text, "LEAD HEARD THE PEEKING BUILDER");
  const [sa] = await subagentsOf(id);
  assert.deepEqual([sa.engine, sa.team?.role, sa.status], ["acp", "builder", "done"]);
  const slashed = (/** @type {string} */ p) => p.split("\\").join("/");
  const [built] = promptsWith("Your task: Read past the worktree");
  const asked = `${slashed(folder)}/README.md`;
  const word = strayWords({ path: asked, read: "file" }, built.cwd, folder);
  assert.equal(word, `Filament refused your read of ${asked}: that is the developer's folder, and you work in your own worktree, where your own changes are. The same file is ${join(built.cwd, "README.md")} — read that one.`);
  assert.equal(sa.exchanges[0].report, `permread: reject heard:${workerNote({ text: word, from: SHIM })}`);
  const rec = await (await shim.api(`/api/requests/${encodeURIComponent(sa.exchanges[0].runId)}`)).json();
  const judged = [...new Set([...((rec.request || rec).priorChanges || []), ...((rec.request || rec).changes || [])].filter((/** @type {string} */ c) => c.startsWith("permission: ")))];
  assert.deepEqual(judged, [`permission: cli asked to read README.md — refused: ${asked} is the developer's folder, outside the worktree it works in (${built.cwd}), which holds the same files with its own changes`], judged.join("\n"));
  assert.ok(!(await runEvents(t.id)).some((e) => e.type === "subagent-ask"), "no question went to the developer");
});

// (fails before: yes — a lead could not answer its worker's question, and a no's words never reached a coding agent,
// which hears a reject alone: HarnessV3-TaskGraph-v2 TG2-D41)
test("a Tester on a coding agent whose lead answers its waiting call from a look: the lead's no refuses it, in the lead's name on the record and the lead's timeline, and its agent hears the lead's words", async () => {
  const id = await newSession();
  const t = await turn(id, "answer the agent");
  assert.equal(t.text, "LEAD ANSWERED THE TESTER");
  const [sa] = await subagentsOf(id);
  assert.deepEqual([sa.engine, sa.team?.role, sa.status], ["acp", "tester", "done"]);
  const said = "no — keep the build folder; list it instead";
  assert.equal(sa.exchanges[0].report, `permbash: reject heard:${workerNote({ text: deniedWords("bash", "rm -rf build", said, "lead"), from: "lead" })}`);
  const rec = await (await shim.api(`/api/requests/${encodeURIComponent(sa.exchanges[0].runId)}`)).json();
  const judged = [...new Set([...((rec.request || rec).priorChanges || []), ...((rec.request || rec).changes || [])].filter((/** @type {string} */ c) => c.startsWith("permission: ")))];
  assert.ok(judged.some((c) => /request to .*rm -rf build.* — its lead declined$/.test(c)), judged.join("\n"));
  const end = (await runEvents(t.id)).find((e) => e.type === "subagent-ask-end" && e.agentId === sa.id);
  assert.deepEqual([end?.answered, end?.by, end?.allowed, end?.words], [true, "lead", false, said]);
});

// (fails before: yes — TG2-D41: a lead could not answer, and a yes was the person's alone, counted towards their
// always-allow)
test("a Tester on a coding agent whose lead says yes to its waiting call, the team in Autonomous mode: the call runs, its record says the lead allowed it, and nothing is learned", async () => {
  const id = await newSession();
  const t = await turn(id, "allow the agent");
  assert.equal(t.text, "LEAD ALLOWED THE TESTER");
  const [sa] = await subagentsOf(id);
  assert.equal(sa.exchanges[0].report, "permbash: allow-once");
  const rec = await (await shim.api(`/api/requests/${encodeURIComponent(sa.exchanges[0].runId)}`)).json();
  const judged = [...new Set([...((rec.request || rec).priorChanges || []), ...((rec.request || rec).changes || [])].filter((/** @type {string} */ c) => c.startsWith("permission: ")))];
  assert.ok(judged.some((c) => /request to .*rm -rf build.* — ran: its lead allowed it$/.test(c)), judged.join("\n"));
  assert.ok(!judged.some((c) => c.includes("always-allow")), judged.join("\n"));
  const events = await runEvents(t.id);
  assert.deepEqual([events.find((e) => e.type === "subagent-ask-end" && e.agentId === sa.id)?.allowed, events.some((e) => e.type === "permission-offer")], [true, false]);
});

// (fails before: yes — the re-read's finding 17: nothing drove an agent that offers only to always allow its call to its
// lead's yes, so the note that says whose yes the agent keeps its always on was never read)
test("a Tester on a coding agent that offers only to always allow its call, its lead saying yes: the call runs, and its record says the agent keeps that always on its lead's yes", async () => {
  const id = await newSession();
  const t = await turn(id, "allow the agent its always");
  assert.equal(t.text, "LEAD ALLOWED THE TESTER");
  const [sa] = await subagentsOf(id);
  assert.match(sa.exchanges[0].report, /^permalways: allow-with-updates/);
  const rec = await (await shim.api(`/api/requests/${encodeURIComponent(sa.exchanges[0].runId)}`)).json();
  const judged = [...new Set([...((rec.request || rec).priorChanges || []), ...((rec.request || rec).changes || [])].filter((/** @type {string} */ c) => c.startsWith("permission: ")))];
  assert.ok(judged.some((c) => /request to .*make.* — ran: its lead allowed it$/.test(c)), judged.join("\n"));
  assert.ok(judged.includes("permission: cli keeps this always-allow for the rest of its session, on its lead's yes"), judged.join("\n"));
  assert.ok(!judged.some((c) => c.includes("the person's yes")), "nobody else's yes is said");
});

test("a Tester on a coding agent: the command the switch asks about waits for the developer on its lead's timeline, and the developer's yes runs it", async () => {
  const id = await newSession();
  const S = `/api/sessions/${encodeURIComponent(id)}`;
  const pending = turn(id, "test with an agent");
  const tester = await until(async () => (await subagentsOf(id)).find((s) => s.team?.role === "tester" && s.progress?.asking && s.runId) || null, "the Tester's agent to wait for the developer's answer", { timeoutMs: 30_000 });
  assert.deepEqual([tester.engine, tester.progress.asking.tool, tester.progress.asking.args], ["acp", "bash", "rm -rf build"]);
  const yes = await shim.api(`${S}/subagents/${encodeURIComponent(tester.id)}/answer`, { method: "POST", body: { answer: "yes", allow: true } });
  assert.equal(yes.status, 200, await yes.clone().text());
  const t = await pending;
  assert.equal(t.text, "LEAD HEARD THE TESTER");
  const [sa] = await subagentsOf(id);
  assert.equal(sa.exchanges[0].report, "permbash: allow-once");
  // The lead's timeline: the Tester's question and its answer.
  const events = await runEvents(t.id);
  const ask = events.find((e) => e.type === "subagent-ask" && e.agentId === tester.id);
  const end = events.find((e) => e.type === "subagent-ask-end" && e.agentId === tester.id);
  assert.deepEqual([ask?.parent, ask?.tool, ask?.args, end?.answered], ["toolu_test", "bash", "rm -rf build", true]);
});

test("a worker on a coding agent that its lead messages hears whose message it is, in its running turn", async () => {
  const id = await newSession();
  const t = await turn(id, "message the agent");
  assert.equal(t.text, "LEAD HEARD BACK");
  const [sa] = await subagentsOf(id);
  assert.equal(sa.exchanges[0].report, `heard:${workerNote({ text: TOLD, from: "lead" })}`, "its closing words");
  // (fails before: yes — the message went by `_session/steering`, which interrupts Claude's work at once:
  // HarnessV3-FailurePoints §7.2)
  const calls = lines(join(logs, "calls.jsonl")).filter((c) => String(c.words).includes(TOLD));
  assert.deepEqual(calls.map((c) => c.method), ["queued prompt"], "queued at its agent while it worked, once, and nothing interrupted it");
});

test("a worker on a coding agent that its lead stops: its agent's turn is cancelled, and the lead hears it stopped as it asked", async () => {
  const id = await newSession();
  const t = await turn(id, "stop the agent");
  assert.equal(t.text, "LEAD STOPPED IT");
  const [sa] = await subagentsOf(id);
  assert.deepEqual([sa.engine, sa.status], ["acp", "stopped"]);
  const run = await runOf(String(sa.runId));
  assert.equal(run.status, "stopped", "its agent's turn ended at the stop");
  // (fails before: no — a guard the mutation pass asked for: the worker's end lost who stopped it, so its lead heard it
  // stopped as by someone else, and passed every test)
  const heard = up.received.map((c) => JSON.stringify(c.body?.messages || [])).filter((m) => m.includes("stop the agent")).at(-1) || "";
  assert.ok(heard.includes(`(\\"${HANG.description}\\") was stopped as you asked.`), heard.slice(-600));
});

// (fails before: no — a guard the mutation pass asked for: a worker's spend on an agent billed by use was kept as $0,
// and passed every test)
test("a worker whose agent's login is billed by use: what its turn cost is its spend, on its card", async () => {
  // The agent says who it runs as beside its first turns: asked first, so the worker's turn knows how it is billed.
  const checked = await shim.api("/api/agent-accounts/paid/check", { method: "POST" });
  assert.equal((await checked.json()).agent?.account?.identity?.billing, "metered");
  const id = await newSession({ engine: { mode: "team", team: "builders" }, subagents: { pool: [{ model: "paid-1", seats: 4 }] } });
  const t = await turn(id, "scout on a paid agent");
  assert.equal(t.text, "LEAD SAW THE PAID SCOUT");
  const [sa] = await subagentsOf(id);
  assert.deepEqual([sa.engine, sa.status, sa.exchanges[0].spentUsd], ["acp", "done", 0.0309]);
});

// (fails before: no — a guard for the review of sa_94fe0839, which feared the agent's failed end said before a backup
// served the request: a sub-agent's run has no other candidate, its agent's turn the last, so its end is said once)
test("a sub-agent whose coding agent fails before its first word on a route with a provider backup ends failed, said once: its run asks no backup", async () => {
  const id = await newSession({ subagents: { pool: [{ model: "backedw-1", seats: 4 }] } });
  const at = `/api/sessions/${encodeURIComponent(id)}/subagents`;
  const launched = await shim.api(at, { method: "POST", body: { prompt: "~quietspend List the files", description: "Fail quietly", worker: "reviewer", deliver: false } });
  assert.equal(launched.status, 200, await launched.clone().text());
  const sid = String((await launched.json()).subagent.id);
  const sub = await until(async () => {
    const x = (await subagentsOf(id)).find((s) => s.id === sid);
    return x && x.status !== "running" ? x : null;
  }, "its exchange to end");
  const ex = sub.exchanges[0];
  assert.deepEqual([sub.status, ex.error], ["failed", "Internal error: the model's server failed mid-turn"], "its agent's end, the run's one");
  const got = await shim.record(String(ex.runId));
  const rec = got.request || got;
  assert.deepEqual([rec.upstream, rec.attempt, rec.failover ?? null], ["cli", 1, null], "no backup asked");
  assert.equal(/** @type {any} */ (shim.app).usage.records.some((/** @type {any} */ r) => r.parentRequest === rec.id), false, "nothing handed on");
});

// (fails before: yes — the review of b1f4c556b: a failed turn's report said $0 and 0 tokens, and its run's end said
// neither tokens nor a cost, though its record kept what it spent)
test("a sub-agent on a coding agent billed by use whose turn fails after it spent: its report and its run's end say what it spent", async () => {
  const checked = await shim.api("/api/agent-accounts/paid/check", { method: "POST" });
  assert.equal((await checked.json()).agent?.account?.identity?.billing, "metered");
  const id = await newSession({ subagents: { pool: [{ model: "paid-1", seats: 4 }] } });
  const at = `/api/sessions/${encodeURIComponent(id)}/subagents`;
  const launched = await shim.api(at, { method: "POST", body: { prompt: "~spentfail", description: "Spend, then fail", worker: "reviewer", deliver: false } });
  assert.equal(launched.status, 200, await launched.clone().text());
  const sid = String((await launched.json()).subagent.id);
  const sub = await until(async () => {
    const x = (await subagentsOf(id)).find((s) => s.id === sid);
    return x && x.status !== "running" ? x : null;
  }, "its exchange to end");
  const ex = sub.exchanges[0];
  assert.deepEqual([sub.engine, sub.status, ex.spentUsd, ex.tokensIn, ex.tokensOut], ["acp", "failed", 0.0123, 2900, 40], "its report: what its turn cost, and its tokens");
  const run = await runOf(String(sub.runId));
  assert.deepEqual([run.status, run.summary?.inputTokens, run.summary?.outputTokens, run.summary?.childCostUsd], ["error", 600, 40, 0.0123], "its run's end");
});

test("a plain session's sub-agent on a coding agent: nobody can approve its command mid-task, so the switch's question is refused in the loop's words", async () => {
  const id = await newSession({ subagents: { pool: [{ model: "coder-1", seats: 4 }] } });
  const t = await turn(id, "clean it with a sub-agent");
  assert.equal(t.text, "AGENT HEARD THE SUB-AGENT");
  const [sa] = await subagentsOf(id);
  assert.deepEqual([sa.engine, sa.team, sa.status, sa.exchanges[0].report], ["acp", null, "done", "permbash: reject"]);
  const run = await runOf(String(sa.runId));
  assert.deepEqual([run.kind, run.parentId], ["subagent", t.id]);
  // (fails before: yes — the record said "the person declined" of a question nobody was put; found by E15 step 1's
  // drive, a sub-agent on Codex)
  const rec = await shim.record(String(sa.runId));
  const notes = [...(rec.priorChanges || []), ...(rec.changes || [])].map(String);
  assert.ok(notes.some((n) => /^permission: .*'s request to .* — refused: a sub-agent has nobody to ask \(edit mode\)$/.test(n)), notes.join("\n"));
  assert.ok(!notes.some((n) => /the person declined/.test(n)), "nobody was asked");
});

// (fails before: yes — the re-read's finding 17: nothing drove an agent that offers only to always allow its call where
// nobody can be asked, so the words that say why it was refused — its offer, not the mode — were never read)
test("a plain session's sub-agent on a coding agent that offers only to always allow its call: refused with nobody asked, in words that say it offered only an always", async () => {
  const id = await newSession({ subagents: { pool: [{ model: "coder-1", seats: 4 }] } });
  const t = await turn(id, "build it with a sub-agent");
  assert.equal(t.text, "AGENT HEARD THE BUILDER");
  const [sa] = await subagentsOf(id);
  assert.deepEqual([sa.engine, sa.status], ["acp", "done"]);
  assert.match(sa.exchanges[0].report, /^permalways: reject/);
  const end = (await runEvents(String(sa.runId))).find((e) => e.type === "tool-end" && e.id === "ca1");
  assert.equal(end?.refused, true, JSON.stringify(end));
  assert.match(String(end?.reason), /^Filament, as the agent offered only an always-allow and a sub-agent has nobody to ask/);
  const rec = await shim.record(String(sa.runId));
  const notes = [...(rec.priorChanges || []), ...(rec.changes || [])].map(String);
  assert.ok(notes.some((n) => /^permission: .*'s request to .*make.* — refused: a sub-agent has nobody to ask \(edit mode\)$/.test(n)), notes.join("\n"));
  assert.ok(!notes.some((n) => /declined|keeps this always-allow/.test(n)), "nobody was asked, and no always is kept");
});

// (fails before: yes — the agent's session stayed open after the exchange, for hours: Claude Code keeps a process per
// open session, standing in the sub-agent's worktree, so on Windows the folder could not go and the follow-up failed
// on it; found by E15 step 1's drive)
test("a sub-agent on a coding agent that closes sessions: its exchange ends with its agent session closed and its copy parked, and its follow-up opens the same session again in the same folder", async () => {
  const id = await newSession({ subagents: { pool: [{ model: "closer-1", seats: 4 }] } });
  const at = `/api/sessions/${encodeURIComponent(id)}/subagents`;
  const calls = () => lines(join(logs, "closer-calls.jsonl"));
  const launched = await shim.api(at, { method: "POST", body: { prompt: "~writefile", description: "Write the out file", deliver: false } });
  assert.equal(launched.status, 200, await launched.clone().text());
  const sid = String((await launched.json()).subagent.id);
  const sub = async () => /** @type {any} */ ((await subagentsOf(id)).find((s) => s.id === sid));
  await until(async () => (await sub()).status !== "running", "its exchange to end");
  const first = await sub();
  assert.deepEqual([first.engine, first.status, first.shares, first.work?.open], ["acp", "done", null, false]);
  assert.match(String(first.exchanges[0].report), /^wrote echo\(1\): /);
  const worktree = String(await taskWorktreePath(folder, sid));
  const [wrote] = lines(join(logs, "closer-prompts.jsonl"));
  assert.equal(wrote.cwd.replace(/\\/g, "/"), worktree.replace(/\\/g, "/"), "it worked in its own worktree");
  assert.deepEqual(calls().filter((c) => c.sessionId === wrote.sessionId).map((c) => c.method).filter((m) => /^session\/(new|close|resume|load)$/.test(m)), ["session/new", "session/close"], "its agent closed the session as the exchange ended");
  assert.equal(copyState(worktree), "parked", "and its copy parked for its next question");

  const more = await shim.api(`${at}/${sid}/follow-up`, { method: "POST", body: { prompt: "Say it once more." } });
  assert.equal(more.status, 200, await more.clone().text());
  await until(async () => (await sub()).exchanges.length === 2 && (await sub()).status !== "running", "its follow-up to end");
  const second = await sub();
  assert.deepEqual([second.status, second.exchanges[1].status, second.exchanges[1].error ?? null], ["done", "done", null]);
  const [, again] = lines(join(logs, "closer-prompts.jsonl"));
  assert.deepEqual([again.sessionId, again.cwd], [wrote.sessionId, wrote.cwd], "the follow-up went on in its agent session, in its worktree checked out again");
  assert.deepEqual(calls().filter((c) => c.sessionId === wrote.sessionId).map((c) => c.method).filter((m) => /^session\/(new|close|resume|load)$/.test(m)), ["session/new", "session/close", "session/resume", "session/close"], "opened again without a new session, and closed with the follow-up's end");
  assert.equal(copyState(worktree), "parked");
});

// (fails before: no — a guard: E15 step 1's drive could not show it live, every account on the owner's machine
// being signed in)
test("a sub-agent on a coding agent nobody is signed in to: its exchange fails in the words that say where to sign in", async () => {
  const id = await newSession({ subagents: { pool: [{ model: "out-1", seats: 4 }] } });
  const at = `/api/sessions/${encodeURIComponent(id)}/subagents`;
  const launched = await shim.api(at, { method: "POST", body: { prompt: "hello", description: "Signed out", worker: "reviewer", deliver: false } });
  assert.equal(launched.status, 200, await launched.clone().text());
  const sid = String((await launched.json()).subagent.id);
  const sub = await until(async () => {
    const x = (await subagentsOf(id)).find((s) => s.id === sid);
    return x && x.status !== "running" ? x : null;
  }, "its exchange to end");
  assert.deepEqual([sub.engine, sub.status, sub.exchanges[0].report || ""], ["acp", "failed", ""]);
  assert.match(String(sub.exchanges[0].error), /^out is not signed in\. Sign in under Settings → Coding agents in Filament's harness/);
});

test("a graph task's sub-agent on a coding agent reports through Filament's report tool, as the loop's does; one whose turn ends without its report is asked for it once, in the same agent session, and its task fails", async () => {
  const id = await newSession({ engine: { mode: "team", team: "builders" }, subagents: { pool: [{ model: "coder-1", seats: 1 }] } });
  const t = await turn(id, "run the graph on an agent");
  assert.ok(t.text.endsWith("GRAPH DONE"), t.text);
  const g = /** @type {any} */ (shim.app).memory.archive.getChain(id).meta.graph;
  assert.deepEqual(g.tasks.map((/** @type {any} */ x) => [x.id, x.state]), [["t1", "done"], ["t2", "failed"]]);
  assert.deepEqual([g.tasks[0].report?.status, g.tasks[0].report?.did, g.tasks[0].report?.met], ["done", REPORTED.did, true], "the report its agent gave through the tool");
  const subs = await subagentsOf(id);
  assert.deepEqual(subs.map((s) => [s.task, s.engine]).sort(), [["t1", "acp"], ["t2", "acp"]]);
  assert.ok(String(subs.find((s) => s.task === "t1").exchanges[0].report).startsWith(`mcp:${REPORT_IN} `), "the tool answered as the loop's does");
  // The report was asked of the one that gave none, once, in its own agent session — never of the one that gave it.
  const [silent] = promptsWith(`Your task: t2 — ${SILENT.name}`);
  // (fails before: no — a guard the mutation pass asked for: sub-agents that shared their session's agent session
  // passed every test)
  assert.notEqual(promptsWith("Your task: t1 — ")[0]?.sessionId, silent.sessionId, "each sub-agent in an agent session of its own");
  // (fails before: no — a guard the mutation pass asked for: a sub-agent handed its session's task graph passed every
  // test) — a task's sub-agent reports on its task; the graph is its lead's.
  const system = String(lines(join(logs, "calls.jsonl")).find((c) => c.method === "session/new" && c.sessionId === silent.sessionId)?.system || "");
  assert.ok(system.includes(`<filament-context kind="${ROLE_BLOCK}">`) && !system.includes(`<filament-context kind="tasks">`), "its part, and none of the graph's");
  const asked = lines(join(logs, "prompts.jsonl")).filter((p) => String(p.text).includes(REPORT_ASK));
  assert.deepEqual(asked.map((p) => p.sessionId), [silent.sessionId]);
  assert.ok((await shim.record(String(subs.find((s) => s.task === "t2").runId))).changes.includes("acp: asked cli for its task's report — its turn would have ended without one"));
});

// (fails before: yes — the re-review of 11-11, finding 8: the prompt that asks for the report went without what comes
// back after the agent's compaction, which then waited for a turn that a task's sub-agent never has)
test("a graph task's sub-agent on a coding agent that compacted with no step after and gave no report: the prompt that asks for it carries what comes back first", async () => {
  const id = await newSession({ engine: { mode: "team", team: "builders" }, subagents: { pool: [{ model: "coder-1", seats: 1 }] } });
  const t = await turn(id, "run the compacting graph");
  assert.ok(t.text.endsWith("COMPACT GRAPH DONE"), t.text);
  const [sa] = await subagentsOf(id);
  const [first] = promptsWith(`Your task: t1 — ${COMPACTS.name}`);
  const asked = lines(join(logs, "prompts.jsonl")).filter((p) => p.sessionId === first.sessionId && String(p.text).includes(REPORT_ASK));
  assert.equal(asked.length, 1, "asked once");
  const text = String(asked[0].text);
  assert.ok(text.startsWith("[Filament: You compacted your context just now, and its summary may have left out what stands: here are the skills you had loaded. ") && text.includes("\n\n<skills>\n- filament-setup\n</skills>"), text);
  assert.ok(text.endsWith(`\n\n${REPORT_ASK}`), text);
  const notes = (await shim.record(String(sa.exchanges[0].runId))).changes;
  assert.ok(notes.includes("acp: what comes back after cli's compaction went with the prompt that asked for its task's report"), notes.join("\n"));
});

// (fails before: yes — the review of b1f4c556b: the failed turn's record kept the failing prompt's facts alone, so the
// first prompt's tokens, joined into the turn's result, were dropped and the record kept 0)
test("a graph task's sub-agent on a coding agent whose report, asked for, fails: its record keeps what its first prompt spent", async () => {
  const id = await newSession({ engine: { mode: "team", team: "builders" }, subagents: { pool: [{ model: "coder-1", seats: 1 }] } });
  const t = await turn(id, "run the spending graph");
  assert.ok(t.text.endsWith("SPEND GRAPH DONE"), t.text);
  const [sa] = await subagentsOf(id);
  assert.deepEqual([sa.engine, sa.status], ["acp", "failed"]);
  const got = await shim.record(String(sa.exchanges[0].runId));
  const rec = got.request || got;
  assert.deepEqual([rec.status, rec.tokens.input, rec.tokens.output, rec.tokens.cacheRead, rec.tokens.cacheWrite], ["error", 10, 46, 100, 2000], "its first prompt's spend");
});

// (fails before: yes — with each prompt's run its own cost, the turn joined kept the later prompt's alone, 0.0309 of the
// two prompts' 0.0618; no against the running total booked whole, which held both)
test("a graph task's sub-agent on Claude asked for its report books both its prompts' runs: each one's own cost, added", async () => {
  const id = await newSession({ engine: { mode: "team", team: "builders" }, subagents: { pool: [{ model: "coder-1", seats: 1 }] } });
  const t = await turn(id, "run the twice-priced graph");
  assert.ok(t.text.endsWith("TWICE GRAPH DONE"), t.text);
  const [sa] = await subagentsOf(id);
  const got = await shim.record(String(sa.exchanges[0].runId));
  const rec = got.request || got;
  assert.deepEqual([rec.tokens.input, rec.tokens.output, rec.listCost], [20, 92, 0.0618], "both prompts' tokens, and both runs' cost");
});

/** A graph of one task run on `model`, by the lead's words `run`: the failed sub-agent's record. @param {string} model @param {string} run @param {string} done */
const failedTaskRecord = async (model, run, done) => {
  const id = await newSession({ engine: { mode: "team", team: "builders" }, subagents: { pool: [{ model, seats: 1 }] } });
  const t = await turn(id, run);
  assert.ok(t.text.endsWith(done), t.text);
  const [sa] = await subagentsOf(id);
  assert.equal(sa.status, "failed");
  const got = await shim.record(String(sa.exchanges[0].runId));
  return got.request || got;
};

// (fails before: yes — the review of b1f4c556b: its failure's close booked the failing prompt's facts alone, so Codex's and
// Cursor's sub-agents kept none of what their first prompt spent; restored, that close gives 0 here)
test("a graph task's sub-agent on Codex or on Cursor whose report, asked for, fails: its record keeps what its first prompt spent", async () => {
  for (const [model, want] of /** @type {const} */ ([["cxw-1", [900, 0, 12]], ["curw-1", [120, 100, 30]]])) {
    const rec = await failedTaskRecord(model, "run the next-failing graph", "NEXT GRAPH DONE");
    assert.deepEqual([rec.status, rec.tokens.input, rec.tokens.cacheRead, rec.tokens.output], ["error", ...want], `${model}'s first prompt's spend`);
  }
});

/**
 * The worker's agent makes its next call: what the developer typed waits in Filament for it (HarnessV4_Tasks C34). It
 * has made it once the file is gone.
 */
const nextCall = async () => {
  mkdirSync(join(logs, "ticks"), { recursive: true });
  writeFileSync(join(logs, "ticks", "tick"), "");
  await until(() => !existsSync(join(logs, "ticks", "tick")) || null, "the agent's next call");
};

// (fails before: no — a guard the mutation pass asked for: the developer's note, which a task's agent hears wrapped in
// whose it is, was looked for in the history in its wrapping, so the prompt asking for the report handed the note back
// to the agent as another assistant's turn, and passed every test)
test("a graph task's sub-agent on a coding agent that took the developer's note mid-task is asked for its report without the note handed back", async () => {
  const id = await newSession({ engine: { mode: "team", team: "builders" }, subagents: { pool: [{ model: "coder-1", seats: 1 }] } });
  const pending = turn(id, "run the heard graph");
  const sa = await until(async () => (await subagentsOf(id)).find((s) => s.task === "t1" && s.runId) || null, "the task's sub-agent to run", { timeoutMs: 30_000 });
  await until(async () => promptsWith(`Your task: t1 — ${HEARS.name}`).length > 0, "its agent to take its task", { timeoutMs: 20_000 });
  const r = await shim.api(`/api/runs/${encodeURIComponent(String(sa.runId))}/steer`, { method: "POST", body: { kind: "note", text: TOLD, from: "harness" } });
  assert.equal(r.status, 200, await r.clone().text());
  await nextCall();
  assert.ok((await pending).text.endsWith("HEARD GRAPH DONE"));
  const [task] = promptsWith(`Your task: t1 — ${HEARS.name}`);
  const asked = lines(join(logs, "prompts.jsonl")).filter((p) => p.sessionId === task.sessionId && String(p.text).includes(REPORT_ASK));
  assert.equal(asked.length, 1);
  assert.ok(!asked[0].text.includes("Meanwhile"), asked[0].text);
});

// (fails before: yes — the command stood first in the queue and ended the deliveries there: the developer's words after
// it never reached the task's agent, which went on waiting for them; and each prompt of the turn's after its first,
// the report's ask among them, said the command held once more)
test("a graph task's sub-agent on a coding agent holds the developer's command for its run's end, said once across its prompts, and takes the words sent after it", async () => {
  const id = await newSession({ engine: { mode: "team", team: "builders" }, subagents: { pool: [{ model: "coder-1", seats: 1 }] } });
  const pending = turn(id, "run the holding graph");
  const sa = await until(async () => (await subagentsOf(id)).find((s) => s.task === "t1" && s.runId) || null, "the task's sub-agent to run", { timeoutMs: 30_000 });
  await until(async () => promptsWith(`Your task: t1 — ${HOLDS.name}`).length > 0, "its agent to take its task", { timeoutMs: 20_000 });
  const runId = String(sa.runId);
  /** The developer's note to the task's run; its id. @param {string} text */
  const note = async (text) => {
    const r = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "note", text, from: "harness" } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).message.id);
  };
  // A first word, taken and answered: by then the agent has published its commands, as it does once its session opens.
  const first = await note("Look at the tests first ~again");
  await nextCall();
  await until(async () => (await runEvents(runId)).some((e) => e.type === "round-start" && e.round === 2) || null, "its agent to answer the first word");
  const held = await note("/review the diff");
  const words = await note(TOLD);
  await nextCall();
  await until(async () => (await runEvents(runId)).some((e) => e.type === "steer-read" && e.ids.includes(words)), "its agent to take the words");
  assert.ok((await pending).text.endsWith("HOLDING GRAPH DONE"));
  const reads = (await runEvents(runId)).filter((e) => e.type === "steer-read" || e.type === "steer-unread").map((e) => [e.type, e.ids]);
  assert.deepEqual(reads, [["steer-read", [first]], ["steer-read", [words]], ["steer-unread", [held]]], "the command waits for the run's end");
  const rec = await shim.record(runId);
  assert.ok(rec.changes.includes("acp: asked cli for its task's report — its turn would have ended without one"), rec.changes.join("\n"));
  const said = rec.changes.filter((/** @type {string} */ c) => c === "acp: /review is cli's own command: sent while it worked, it waits for the turn's end and goes as the next message, as typed");
  assert.equal(said.length, 1, rec.changes.join("\n"));
});

// (fails before: no — a guard the mutation pass asked for: a run named for no sub-agent waiting went on as a plain
// turn, and passed every test)
test("a run named for a sub-agent the registry is not waiting for is refused: nothing reaches the agent", async () => {
  const before = lines(join(logs, "prompts.jsonl")).length;
  // As the registry posts a sub-agent's run: Filament's own call, with the house key alone.
  const headers = { "content-type": "application/json", ...houseAuth(), "x-filament-subagent": "sa_nobody", "x-filament-subagent-of": "owner" };
  const r = await fetch(`${shim.url}/v1/messages`, { method: "POST", headers, body: JSON.stringify({ model: "coder-1", max_tokens: 100, messages: [{ role: "user", content: "who waits?" }] }) });
  assert.equal(r.status, 409);
  assert.match(JSON.stringify(await r.json()), /no sub-agent sa_nobody is waiting for its run/);
  assert.equal(lines(join(logs, "prompts.jsonl")).length, before);
});

// (fails before: no — a guard the mutation pass asked for: a sub-agent's run that failed lost the report its agent had
// given, and passed every test) — last here: its agent's process dies.
// (fails before: yes — HarnessV4_Tasks B2: a coding agent's worker kept none of its tool calls in Filament's copy of its
// conversation, and a failed one none of its words: its task's try said nothing of what it did, and the worker that
// took the task next was briefed with how it ended alone)
test("a graph task's sub-agent on a coding agent that fails after a call: its try keeps the call and its last words, and the next worker's brief says them", async () => {
  const id = await newSession({ engine: { mode: "team", team: "builders" }, subagents: { pool: [{ model: "coder-1", seats: 1 }] } });
  const t = await turn(id, "run the failing graph");
  assert.ok(t.text.endsWith("FAIL GRAPH DONE"), t.text);
  const [first] = await subagentsOf(id);
  assert.deepEqual([first.task, first.engine, first.status, first.exchanges[0].toolCalls], ["t1", "acp", "failed", 2]);
  const tried = /** @type {any} */ (shim.app).memory.archive.getChain(id).meta.graph.tasks[0];
  assert.deepEqual([tried.state, tried.report?.calls, tried.report?.callsMade, tried.report?.words], ["failed", ["Read README.md", "Edit src/app.js"], 2, "half done"]);
  // The developer sends it back to a new sub-agent, which starts with the next turn.
  const sent = await shim.api(`/api/sessions/${encodeURIComponent(id)}/graph/tasks/t1/start`, { method: "POST", body: { fresh: true } });
  assert.deepEqual([sent.status, (await sent.json()).waits], [200, "turn"]);
  const again = await turn(id, "see the new try through");
  assert.ok(again.text.endsWith("FAIL GRAPH DONE"), again.text);
  const [brief] = promptsWith("An earlier try at this task ended");
  assert.ok(brief && brief.sessionId !== promptsWith(`Your task: t1 — ${FAILS.name}`)[0].sessionId, "a new sub-agent, in an agent session of its own");
  assert.match(String(brief.text), /An earlier try at this task ended: [^\n]+\nIts last words: half done\nIts tool calls:\n- Read README\.md\n- Edit src\/app\.js\n/);
});

test("a graph task's sub-agent whose agent dies after giving its report: its run fails in the failure's words, and its task keeps the report", async () => {
  const id = await newSession({ engine: { mode: "team", team: "builders" }, subagents: { pool: [{ model: "coder-1", seats: 1 }] } });
  const t = await turn(id, "run the crashing graph");
  assert.ok(t.text.endsWith("CRASH GRAPH DONE"), t.text);
  const [sa] = await subagentsOf(id);
  assert.deepEqual([sa.task, sa.status], ["t1", "failed"]);
  assert.match(String(sa.exchanges[0].error), /agent process exited \(code 3\)/);
  const g = /** @type {any} */ (shim.app).memory.archive.getChain(id).meta.graph;
  assert.deepEqual([g.tasks[0].report?.did, g.tasks[0].report?.met], [REPORTED.did, true], "the report its agent gave before it died");
});
