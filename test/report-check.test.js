// @ts-check
// HarnessV3-TaskGraph-v2 TG2-D63 (§14.4): a writing task with no check takes its check from its worker's report. The
// report gains checked — one to five commands, each as the worker ran it — vetted at the call as a task's check is (a
// read-only session refuses none). At the end, a done report of a writing graph task with no check gives them to its
// worker as its check, once: Filament runs them in the worktree as V2-1 runs a task's check, red going back twice, and
// they stay the task's check — `checkBy: "worker"` — on its card, in the close's run and at the merge, until its planner
// changes it. The brief asks for them, the tasks call's answer says it, and the report tool's words move the prompt to
// version 34. The cases of the words, in order.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tg from "../src/core/task-graph.js";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { bounceText } from "../src/app/agent/check.js";
import { checkCommandsProblem, grantsProblem } from "../src/app/agent/grants.js";
import { REPORT_TOOL, TASKS_TOOL, TASKS_READS_TOOL, LEAD_TASKS_TOOL, CODER_TASKS_TOOL, SUBAGENT_OFF, loopToolArgs } from "../src/app/agent/tools.js";
import { PROMPT_VERSION, TOOL_TEXT } from "../src/app/agent/prompt.js";
import { membersOf } from "./helpers/roster.js";
import { until } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});

const AGENT = { crew: /** @type {const} */ ("agent") };
const LED = membersOf({ scout: "Map what exists.", builder: "Build against the contract.", tester: "", reviewer: "Review against the contract." });
/** @param {any} r @returns {any} */
const ok = (r) => (assert.ok(r.ok, JSON.stringify(r)), r);
const T1 = 1000;
/** @param {any} graph @param {string} id @returns {any} */
const task = (graph, id) => graph.tasks.find((/** @type {any} */ t) => t.id === id);
/** @param {string} command @param {number | null} exit @param {Record<string, any>} [more] */
const RUN = (command, exit, more = {}) => ({ command, exit, ms: 2000, output: exit === 0 ? "ok" : "FAIL format.test.js", stopped: false, ...more });
/** @param {any[]} runs @param {Record<string, any>} [more] @returns {any} */
const RAN = (runs, more = {}) => ({ ran: true, commands: runs.map((r) => r.command), runs, bounces: 0, stopped: false, ...more });

/** A writing sub-agent's task with no check. */
const NOCHECK = { id: "t2", name: "Format amounts", by: "sub-agent", writes: ["src/format.js", "test/format.test.js"], goal: "Amounts read as money", steps: ["Write format", "Test it"], acceptance: "its tests pass" };
const NAMED = ["node --test test/format.test.js"];
/** The graph with t2 — no check — running on sa-1. @param {any} [crew] @param {Record<string, any>} [more] */
const noCheckGraph = (crew = AGENT, more = {}) => /** @type {any} */ (tg.launched(ok(tg.applyTasks(null, { action: "add", goal: "Ship", tasks: [{ ...NOCHECK, ...more }] }, { at: T1, ...crew })).graph, "t2", "sa-1", T1 + 1, crew.crew === "agent" ? "sub-agent" : "builder"));
const FILES = [{ path: "src/format.js", added: 12, removed: 0 }];
const REPORT = { status: "done", did: "Wrote format and its tests.", met: true, evidence: "3/3 tests passing under node --test", left: "" };
/** A graph task's end. @param {Record<string, any>} [more] @returns {any} */
const END = (more = {}) => ({ agent: "sa-1", status: "done", stoppedBy: null, error: null, report: REPORT, words: "", files: FILES, shared: false, wrote: true, workError: null, ran: [], calls: [], written: [], spentUsd: 0.1, ms: 60_000, cut: false, check: null, provider: null, ...more });
/** @param {any} graph @param {string} id */
const merged = (graph, id) => /** @type {any} */ (tg.taskMerged(graph, id, FILES, T1 + 10));

// ---- case 17: the shape ---------------------------------------------------------------------------------------------

// (fails before: yes — checked was no field of the report: it was dropped unread)
test("the report reads checked: one to five one-line commands, trimmed — anything else refuses the report in words; none, or an empty list, is no field", () => {
  assert.deepEqual(ok(tg.readReport(REPORT)).report, REPORT, "no checked: the report as before");
  assert.deepEqual(ok(tg.readReport({ ...REPORT, checked: [] })).report, REPORT, "an empty list names none");
  assert.deepEqual(ok(tg.readReport({ ...REPORT, checked: [" node --test test/format.test.js ", "npx tsc --noEmit"] })).report, { ...REPORT, checked: ["node --test test/format.test.js", "npx tsc --noEmit"] });
  /** @param {any} checked */
  const refused = (checked) => /** @type {any} */ (tg.readReport({ ...REPORT, checked })).error;
  assert.equal(refused("npm test"), "checked is a list of commands, one to five — each exactly as you ran it — or leave it out");
  assert.equal(refused(["npm test", " "]), "checked is a list of commands, one to five — each exactly as you ran it — or leave it out");
  assert.equal(refused(["npm test", 3]), "checked is a list of commands, one to five — each exactly as you ran it — or leave it out");
  assert.equal(refused(["1", "2", "3", "4", "5", "6"]), "checked holds at most 5 commands — the ones that prove your task done");
  assert.equal(refused(["npm test\nnpm run lint"]), "a command of checked is one line: give each command its own entry");
  assert.equal(refused([`echo ${"x".repeat(600)}`]), "a command of checked is up to 500 characters (this one has 605)");
});

// ---- cases 1 to 7: the core takes it --------------------------------------------------------------------------------

// (fails before: yes — the end's taken commands were nobody's: the task stayed unchecked)
test("a writing task with no check takes the commands its report named: its check is them, by its worker; green, the end says they passed", () => {
  const r = /** @type {any} */ (tg.taskEnded(noCheckGraph(), "t2", END({ taken: NAMED, check: RAN([RUN(NAMED[0], 0)]) }), T1 + 9));
  assert.equal(r.state, "yours");
  const t = task(r.graph, "t2");
  assert.deepEqual([t.check, t.checkBy, t.verdict.kind], [NAMED, "worker", "passed"]);
  const told = tg.endText(merged(r.graph, "t2"), "t2", { crew: "agent" });
  assert.match(told, /^\[Filament: task t2 "Format amounts" is done: sub-agent sa-1 reported it done, and Filament ran the commands its report named as the task's check, which passed \(`node --test test\/format\.test\.js`, 2 s\), and its change is merged into your folder\./);
  // Flaky, said so.
  const fl = /** @type {any} */ (tg.taskEnded(noCheckGraph(), "t2", END({ taken: NAMED, check: RAN([RUN(NAMED[0], 0, { first: { exit: 1, ms: 3000 } })]) }), T1 + 9));
  assert.match(tg.endText(merged(fl.graph, "t2"), "t2", { crew: "agent" }), /Filament ran the commands its report named as the task's check, which passed, flaky: `node --test test\/format\.test\.js` failed \(exit 1, 3 s\), then passed \(exit 0, 2 s\) on a second run, and its change is merged/);
});

// (fails before: yes — the same)
test("red after two returns: the task fails on its check, and the commands stay its check, for whoever takes it next", () => {
  const r = /** @type {any} */ (tg.taskEnded(noCheckGraph(), "t2", END({ taken: NAMED, check: RAN([RUN(NAMED[0], 1, { first: { exit: 1, ms: 3000 } })], { bounces: 2 }) }), T1 + 9));
  assert.equal(r.state, "failed");
  const t = task(r.graph, "t2");
  assert.deepEqual([t.failures.cause, t.check, t.checkBy], ["check", NAMED, "worker"]);
  assert.match(t.why, /^Filament ran its check after it reported, and it failed after going back to its sub-agent twice/);
  // A new worker sent the task starts with them as its check.
  const fresh = ok(tg.applyTasks(r.graph, { action: "start", ids: ["t2"], fresh: true }, { at: T1 + 11, ...AGENT })).graph;
  assert.match(tg.briefText(fresh, "t2", "agent"), /\n\nIts check — the commands that prove it done: `node --test test\/format\.test\.js`\n\n/);
  assert.doesNotMatch(tg.briefText(fresh, "t2", "agent"), /in checked/, "its brief asks for none: it has one");
});

// (fails before: yes — the words said only that Filament ran none)
test("a report that named none: done, unchecked, and the words say its report named none", () => {
  const r = /** @type {any} */ (tg.taskEnded(noCheckGraph(), "t2", END(), T1 + 9));
  const t = task(r.graph, "t2");
  assert.deepEqual([t.check, "checkBy" in t], [[], false]);
  assert.match(tg.endText(merged(r.graph, "t2"), "t2", { crew: "agent" }), /reported it done with its acceptance check passed — unchecked: the task has no check, and its report named none — and its change is merged into your folder\./);
});

// (fails before: no — a guard: a check the task has, and a task that writes nothing, take none)
test("a task with its own check, an explorer's, and a report not done take none", () => {
  const own = /** @type {any} */ (tg.launched(ok(tg.applyTasks(null, { action: "add", goal: "Ship", tasks: [{ ...NOCHECK, check: ["npm test"] }] }, { at: T1, ...AGENT })).graph, "t2", "sa-1", T1 + 1, "sub-agent"));
  const o = /** @type {any} */ (tg.taskEnded(own, "t2", END({ taken: NAMED, check: RAN([RUN("npm test", 0)]) }), T1 + 9));
  assert.deepEqual([task(o.graph, "t2").check, "checkBy" in task(o.graph, "t2")], [["npm test"], false]);
  const ex = ok(tg.applyTasks(null, { action: "add", goal: "Map", tasks: [{ id: "x1", name: "Map it", by: "explorer", goal: "Know", steps: ["Look"], acceptance: "listed" }] }, { at: T1, ...AGENT })).graph;
  const xr = /** @type {any} */ (tg.taskEnded(/** @type {any} */ (tg.launched(ex, "x1", "sa-2", T1, "explorer")), "x1", END({ agent: "sa-2", files: [], taken: NAMED }), T1 + 1));
  assert.deepEqual(task(xr.graph, "x1").check, []);
  const blocked = /** @type {any} */ (tg.taskEnded(noCheckGraph(), "t2", END({ report: { ...REPORT, status: "blocked", left: "the spec" }, taken: NAMED }), T1 + 9));
  assert.deepEqual([blocked.state, task(blocked.graph, "t2").check], ["failed", []]);
});

// ---- cases 12, 13 and 16: kept on the task ---------------------------------------------------------------------------

// (fails before: yes — nobody named a check but the planner)
test("show says who named it; the close runs it; the planner's change of the check replaces it, and a change of another field keeps it", () => {
  const r = /** @type {any} */ (tg.taskEnded(noCheckGraph(), "t2", END({ taken: NAMED, check: RAN([RUN(NAMED[0], 0)]) }), T1 + 9));
  const done = merged(r.graph, "t2");
  const shown = /** @type {any} */ (tg.applyTasks(done, { action: "show", id: "t2" }, { at: T1, ...AGENT })).text;
  assert.match(shown, /\nCheck: `node --test test\/format\.test\.js` — named by its sub-agent\n/);
  assert.deepEqual(tg.closeRuns(done), [{ command: NAMED[0], tasks: ["t2"] }]);
  assert.equal(tg.graphView(done)?.tasks[0].checkBy, "worker", "the page reads who named it");
  // A task that failed on them is the planner's to change.
  const red = /** @type {any} */ (tg.taskEnded(noCheckGraph(), "t2", END({ taken: NAMED, check: RAN([RUN(NAMED[0], 1)], { bounces: 2 }) }), T1 + 9)).graph;
  const renamed = ok(tg.applyTasks(red, { action: "change", tasks: [{ id: "t2", name: "Format amounts well" }] }, { at: T1 + 11, ...AGENT })).graph;
  assert.deepEqual([task(renamed, "t2").check, task(renamed, "t2").checkBy], [NAMED, "worker"]);
  const changed = ok(tg.applyTasks(red, { action: "change", tasks: [{ id: "t2", check: ["npm test"] }] }, { at: T1 + 11, ...AGENT })).graph;
  assert.deepEqual([task(changed, "t2").check, "checkBy" in task(changed, "t2")], [["npm test"], false]);
  assert.doesNotMatch(/** @type {any} */ (tg.applyTasks(changed, { action: "show", id: "t2" }, { at: T1, ...AGENT })).text, /named by/);
  // Under a lead, in its words.
  const lr = /** @type {any} */ (tg.taskEnded(noCheckGraph({ crew: LED }, { by: "builder" }), "t2", END({ taken: NAMED, check: RAN([RUN(NAMED[0], 0)]) }), T1 + 9));
  assert.match(/** @type {any} */ (tg.applyTasks(merged(lr.graph, "t2"), { action: "show", id: "t2" }, { at: T1, crew: LED })).text, /\nCheck: `node --test test\/format\.test\.js` — named by its builder\n/);
});

// ---- case 14: the brief and the tasks call's answer ------------------------------------------------------------------

const ASK_AGENT =
  "Your task has no check: in checked, name the commands that prove it done — the tests you ran, each exactly as you ran it. Filament runs them again in your worktree before the agent hears your report, sends the task back to you if one fails, and keeps them as your task's check, guarding the project after your change goes in. Leave checked out only where no command can check your change.";

// (fails before: yes — the brief asked for no commands)
test("the brief of a writing task with no check asks for checked after the report's line — and only there", () => {
  const g = noCheckGraph();
  assert.ok(tg.briefText(g, "t2", "agent").endsWith(` ${ASK_AGENT}`), tg.briefText(g, "t2", "agent"));
  assert.ok(tg.briefText(noCheckGraph({ crew: LED }, { by: "builder" }), "t2", LED).endsWith(` ${ASK_AGENT.replace("the agent hears", "your lead hears")}`));
  const own = ok(tg.applyTasks(null, { action: "add", goal: "Ship", tasks: [{ ...NOCHECK, check: ["npm test"] }, { id: "x1", name: "Map it", by: "explorer", goal: "Know", steps: ["Look"], acceptance: "listed" }] }, { at: T1, ...AGENT })).graph;
  assert.doesNotMatch(tg.briefText(own, "t2", "agent"), /in checked/);
  assert.doesNotMatch(tg.briefText(own, "x1", "agent"), /in checked/);
});

// (fails before: yes — the answer said nothing of a check)
test("the tasks call's answer says which writing sub-agent tasks it added have no check, and how they get one", () => {
  const one = ok(tg.applyTasks(null, { action: "add", goal: "Ship", tasks: [NOCHECK, { id: "t3", name: "Own", needs: ["t2"] }, { id: "x1", name: "Map it", by: "explorer", goal: "Know", steps: ["Look"], acceptance: "listed" }] }, { at: T1, ...AGENT }));
  assert.match(one.text, /^Added t2, t3, x1\. t2 has no check: its sub-agent names the commands that prove it done in its report, and Filament runs them as its check\. /);
  const two = ok(tg.applyTasks(null, { action: "add", goal: "Ship", tasks: [NOCHECK, { ...NOCHECK, id: "t4", writes: ["src/b.js"] }] }, { at: T1, ...AGENT }));
  assert.match(two.text, /^Added t2, t4\. t2, t4 have no check: their sub-agents name the commands that prove them done in their reports, and Filament runs them as their check\. /);
  const led = ok(tg.applyTasks(null, { action: "add", goal: "Ship", tasks: [{ ...NOCHECK, by: "builder" }] }, { at: T1, crew: LED }));
  assert.match(led.text, /^Added t2\. t2 has no check: its worker names the commands that prove it done in its report, and Filament runs them as its check\. /);
  const checked = ok(tg.applyTasks(null, { action: "add", goal: "Ship", tasks: [{ ...NOCHECK, check: ["npm test"] }] }, { at: T1, ...AGENT }));
  assert.doesNotMatch(checked.text, /no check/);
});

// ---- case 18: the tool and the prompt --------------------------------------------------------------------------------

// (fails before: yes — the report had no checked, and the prompt was version 33)
test("the report tool has checked, its words say it, and the prompt is version 34 or later (35: V2-3) — no tasks tool has checked", () => {
  const c = /** @type {any} */ (REPORT_TOOL.input_schema.properties).checked;
  assert.deepEqual([c.type, c.items, c.maxItems], ["array", { type: "string" }, 5]);
  assert.deepEqual(REPORT_TOOL.input_schema.required, ["status", "did", "met", "evidence"], "optional");
  // Said at its own field since the owner's tool plan of 11-08, not in the tool's text.
  assert.equal(c.description, "Only where your task changes files and has no check: one to five commands that prove it done, each exactly as you ran it. Filament runs them again in your worktree as the task's check.");
  assert.doesNotMatch(TOOL_TEXT.report, /checked/);
  assert.equal(PROMPT_VERSION, 129);
  for (const tool of [TASKS_TOOL, TASKS_READS_TOOL, LEAD_TASKS_TOOL, CODER_TASKS_TOOL]) assert.doesNotMatch(JSON.stringify(tool), /checked/, tool.name);
});

// ---- the registry ----------------------------------------------------------------------------------------------------

/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
const PARSE = "exports.parse = (s) => s.split(',');\n";
const FIXED = "exports.parse = (s) => (s ? s.split(',') : []);\n";
const CHECK_JS = "const { parse } = require('./parse.js');\nconst n = parse('').length;\nconsole.log(n === 0 ? 'ok' : 'FAIL: ' + n);\nprocess.exit(n === 0 ? 0 : 1);\n";
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-named-"));
  made.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, "parse.js"), PARSE);
  writeFileSync(join(dir, "check.js"), CHECK_JS);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
};
/**
 * A registry over `dir`, each worker's run scripted by `runs` and finished with its task report, and each graph task's
 * end kept. @param {string} dir
 */
const registryOver = (dir) => {
  /** @type {any[]} */
  const ends = [];
  /** @type {((o: { host: any, body: any }) => any)[]} */
  const runs = [];
  /** @type {any[]} */
  const posts = [];
  const doc = { subagents: { pool: [{ model: "", seats: 8 }] }, loop: { permissions: "edit", rules: /** @type {any[]} */ ([]) } };
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    context: {
      settings: () => structuredClone(doc),
      session: () => ({ cwd: dir, model: "m-session", projectId: null, client: "harness" }),
      view: async () => null,
      brief: async () => null,
      modelProblem: () => null,
      mark: () => null,
      folderProblem: () => null,
      exchangeEnded: (/** @type {any} */ e) => ends.push(e),
    },
    call: async ({ body, headers = {} }) => {
      const id = String(headers["x-filament-subagent"]);
      const host = registry.hostOf(id);
      posts.push({ body, host });
      const runId = `run-${posts.length}`;
      registry.attach(id, runId);
      const script = runs.shift() || (() => ({}));
      const end = (await script({ host, body })) || {};
      registry.finish(id, { status: "done", error: null, report: "Reported.", stoppedBy: null, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: "Reported." }] }], rounds: 1, toolCalls: 2, tokensIn: 1, tokensOut: 1, spentUsd: 0.01, roundIds: [runId], taskReport: end.taskReport === undefined ? { ...REPORT, checked: ["node check.js"] } : end.taskReport });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: "Reported." }] }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  return { registry, ends, runs, posts, doc };
};
/** A writing graph task's worker over `dir`, launched as the runner launches one — with its task's check, or none. @param {ReturnType<typeof registryOver>} r @param {string} dir @param {string[]} [check] */
const graphWorker = (r, dir, check = []) =>
  r.registry.launch({ origin: "agent", chainId: "c1", prompt: "THE BRIEF OF t2", description: "t2: Fix the parser", worker: "builder", background: true, cwd: dir, mode: null, parentModel: "m", thinking: null, task: { id: "t2", review: false }, requestId: "turn-1", files: { writes: ["parse.js"] }, ...(check.length ? { grants: { check, mayRun: [] } } : {}) });
/** The words of a request's newest message. @param {any} post */
const lastWords = (post) => String(post.body.messages.at(-1).content.map((/** @type {any} */ c) => c.text).join("\n"));

// (fails before: yes — the report's commands were never run: the task ended unchecked)
test("a worker whose task has no check reports done naming checked: Filament runs them in its worktree, red goes back in its words, a later report's others change nothing, and the end hands them on", async () => {
  const dir = repo();
  const r = registryOver(dir);
  // It names node check.js, never fixes the parser, and names others the second and third time.
  r.runs.push(
    () => ({}),
    () => ({ taskReport: { ...REPORT, checked: ["echo fine"] } }),
    () => ({ taskReport: { ...REPORT, checked: ["echo third"] } }),
  );
  const l = graphWorker(r, dir);
  assert.equal(l.ok, true, l.ok ? "" : l.error);
  await until(() => r.ends.length === 1, "the task's end", { timeoutMs: 60_000 });
  assert.equal(r.posts.length, 3, "two returns, then its end");
  assert.match(lastWords(r.posts[1]), /^\[Filament: you reported, and Filament ran the commands your report named in checked — your task's check now — in your worktree before the agent heard of it\. It failed:\n\n\$ node check\.js\nexit 1 after \d+ s — the end of its output:\nFAIL: 1\n\n/);
  assert.match(lastWords(r.posts[1]), /Run the check yourself, then report again\. They stay your task's check whatever a later report names\.\]$/);
  assert.match(lastWords(r.posts[2]), /\n\$ node check\.js\nexit 1/, "the second report's echo fine is not its check");
  const end = r.ends[0].task;
  assert.deepEqual([end.taken, end.check.ran, end.check.bounces, end.check.commands], [["node check.js"], true, 2, ["node check.js"]]);
  // Its worktree grants them: it runs them without asking.
  assert.deepEqual(r.posts[1].host.grants?.check, ["node check.js"]);
});

// (fails before: yes — the same)
test("green: the end carries the commands taken and their verdict; a check the task has, a report not done, and a reader take none", async () => {
  const dir = repo();
  const r = registryOver(dir);
  r.runs.push(({ host }) => {
    writeFileSync(join(host.workdir, "parse.js"), FIXED);
    return {};
  });
  graphWorker(r, dir);
  await until(() => r.ends.length === 1, "the task's end", { timeoutMs: 60_000 });
  assert.deepEqual([r.posts.length, r.ends[0].task.taken, r.ends[0].task.check.runs[0].exit], [1, ["node check.js"], 0]);
  // Its task's own check: it runs, and the report's changes nothing.
  const own = registryOver(dir);
  own.runs.push(({ host }) => (writeFileSync(join(host.workdir, "parse.js"), FIXED), { taskReport: { ...REPORT, checked: ["echo other"] } }));
  graphWorker(own, dir, ["node check.js"]);
  await until(() => own.ends.length === 1, "the task's end", { timeoutMs: 60_000 });
  assert.deepEqual([own.ends[0].task.taken, own.ends[0].task.check.commands], [undefined, ["node check.js"]]);
  // Blocked: nothing taken, nothing run.
  const blocked = registryOver(dir);
  blocked.runs.push(() => ({ taskReport: { ...REPORT, status: "blocked", met: false, left: "the spec", checked: ["node check.js"] } }));
  graphWorker(blocked, dir);
  await until(() => blocked.ends.length === 1, "the task's end", { timeoutMs: 60_000 });
  assert.deepEqual([blocked.ends[0].task.taken, blocked.ends[0].task.check], [undefined, null]);
  // An explorer's report names none that counts.
  const reader = registryOver(dir);
  reader.registry.launch({ origin: "agent", chainId: "c1", prompt: "MAP IT", description: "x1: Map it", worker: "reviewer", background: true, cwd: dir, mode: null, parentModel: "m", thinking: null, task: { id: "x1", review: false }, requestId: "turn-1" });
  await until(() => reader.ends.length === 1, "the task's end", { timeoutMs: 60_000 });
  assert.deepEqual([reader.ends[0].task.taken, reader.ends[0].task.check], [undefined, null]);
});

// (fails before: yes — the same)
test("a read-only session: the commands are taken and not run — said in V2-1's words", async () => {
  const dir = repo();
  const r = registryOver(dir);
  r.doc.loop.permissions = "read-only";
  r.runs.push(() => ({}));
  graphWorker(r, dir);
  await until(() => r.ends.length === 1, "the task's end", { timeoutMs: 60_000 });
  assert.deepEqual([r.ends[0].task.taken, r.ends[0].task.check], [["node check.js"], { ran: false, words: "the session is read-only, so Filament runs no check in it" }]);
  assert.equal(r.registry.checkedProblem("c1", ["npm test"]), null, "nothing refused at the call either");
});

// (fails before: yes — the registry had no word on a report's commands)
test("the registry vets checked as a task's check: an install, a ;, the folder's path or the worktree's, a deny or an ask rule", () => {
  const dir = repo();
  const r = registryOver(dir);
  assert.equal(r.registry.checkedProblem("c1", ["node --test", "npx tsc --noEmit"]), null);
  assert.equal(r.registry.checkedProblem("c1", ["npm i"]), "report's checked: `npm i` installs packages, and your worktree uses the developer's folder's installed ones: leave it out — what the task needs installed, the developer installs");
  assert.match(String(r.registry.checkedProblem("c1", ["npm test; echo ok"])), /^report's checked: `npm test; echo ok` joins its parts with ;, where a part can fail and the check still pass/);
  assert.equal(r.registry.checkedProblem("c1", [`node ${join(dir, "check.js")}`]), `report's checked: \`node ${join(dir, "check.js")}\` names the developer's folder (${dir}): Filament runs it in your worktree, where the same files are at the same paths — use paths relative to your worktree`);
  assert.match(String(r.registry.checkedProblem("c1", [`node ${join(dir, ".git", "filament-worktrees", "sa_x", "check.js")}`])), /names the developer's folder/, "the worktree lies in the folder");
  r.doc.loop.rules = [{ tool: "bash", pattern: "npm test", verdict: "deny" }];
  assert.match(String(r.registry.checkedProblem("c1", ["npm test"])), /^report's checked: `npm test` is refused by this session's rule .+: leave it out$/);
  r.doc.loop.rules = [{ tool: "bash", pattern: "npm test", verdict: "ask" }];
  assert.match(String(r.registry.checkedProblem("c1", ["npm test"])), /^report's checked: `npm test` asks first by this session's rule .+, and Filament runs checked without asking: leave it out$/);
});

// (fails before: yes — a worker sent back kept the check it was launched with, whatever its planner changed since)
test("a worker its planner sends back runs its task's check as the task stands now: the planner's change replaces the commands it named, and a later report may name again where it has none", async () => {
  const dir = repo();
  const r = registryOver(dir);
  // It names node check.js, never fixes the parser: red three times, its end.
  for (let i = 0; i < 3; i++) r.runs.push(() => ({}));
  const l = /** @type {any} */ (graphWorker(r, dir));
  await until(() => r.ends.length === 1, "the first end", { timeoutMs: 60_000 });
  // The planner changes the check to one that passes, and sends it back.
  r.runs.push(() => ({ taskReport: { ...REPORT, checked: ["echo other"] } }));
  const back = r.registry.resumeTask(l.id, { chainId: "c1", prompt: "GO ON", requestId: "turn-2", check: ["node -e 0"] });
  assert.equal(back.ok, true, back.ok ? "" : back.error);
  await until(() => r.ends.length === 2, "the second end", { timeoutMs: 60_000 });
  const end = r.ends[1].task;
  assert.deepEqual([end.check.commands, end.taken], [["node -e 0"], undefined]);
  // check: [] — the task has none again: its report's commands are taken.
  r.runs.push(() => ({ taskReport: { ...REPORT, checked: ["node -e 1"] } }), () => ({ taskReport: { ...REPORT, checked: ["node -e 1"] } }), () => ({}));
  r.registry.resumeTask(l.id, { chainId: "c1", prompt: "GO ON AGAIN", requestId: "turn-3", check: [] });
  await until(() => r.ends.length === 3, "the third end", { timeoutMs: 60_000 });
  assert.deepEqual([r.ends[2].task.taken, r.ends[2].task.check.commands], [["node -e 1"], ["node -e 1"]]);
});

// ---- the runner ------------------------------------------------------------------------------------------------------

// (fails before: yes — a send-back named no check)
test("the runner sends a task back to its worker with the task's check as it stands", () => {
  /** @type {Map<string, any>} */
  const chains = new Map([["c1", { id: "c1", meta: {} }]]);
  /** @type {any[]} */
  const resumes = [];
  const registry = {
    launch: () => ({ ok: true, id: "sa-1", done: new Promise(() => {}) }),
    resumeTask: (/** @type {string} */ id, /** @type {any} */ o) => (resumes.push({ id, ...o }), { ok: true, id, done: new Promise(() => {}) }),
    slots: () => 4,
    tell: () => {},
    stop: () => ({ ok: true }),
    resumable: () => null,
    checkProblem: () => null,
    guard: () => {},
  };
  const archive = {
    /** The meta's named keys, as the archive's `metaOf` reads them. @param {string} id @param {readonly string[]} keys */
    metaOf: (id, keys) => {
      const c = chains.get(id);
      return c ? Object.fromEntries(keys.filter((k) => c.meta?.[k] !== undefined).map((k) => [k, c.meta[k]])) : null;
    },
    mergeMeta: (/** @type {string} */ id, /** @type {any} */ patch) => {
      const c = chains.get(id);
      c.meta = structuredClone({ ...c.meta, ...patch });
      return c.meta;
    },
    openGraphs: () => [],
  };
  let t = 2000;
  const runner = createGraphRunner({ archive, registry: /** @type {any} */ (registry), events: { publish: () => {} }, crew: () => "agent", log: () => {}, now: () => t++ });
  const r = /** @type {any} */ (tg.taskEnded(noCheckGraph(), "t2", END({ taken: NAMED, check: RAN([RUN(NAMED[0], 1)], { bounces: 2 }) }), T1 + 9));
  chains.get("c1").meta.graph = r.graph;
  runner.attach("c1", { runId: "turn-1", cwd: "/p", mode: null, model: "m", thinking: null, team: null });
  ok(runner.apply("c1", { action: "start", ids: ["t2"], note: "Fix the parser" }, AGENT));
  assert.deepEqual([resumes.length, resumes[0]?.check], [1, NAMED]);
});

// ---- case 15: at the call, in the loop and over MCP ------------------------------------------------------------------

// (fails before: yes — the loop read the report without a word on its commands)
test("the loop refuses a report whose checked the registry refuses, in its words; the next report reads", async () => {
  /** @type {any[][]} */
  const seen = [];
  const replies = [
    [{ type: "tool_use", id: "r1", name: "report", input: { ...REPORT, checked: ["npm i"] } }],
    [{ type: "tool_use", id: "r2", name: "report", input: { ...REPORT, checked: ["node --test"] } }],
    [{ type: "text", text: "Done." }],
  ];
  let n = 0;
  /** @type {string[][]} */
  const vetted = [];
  const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() {}, count() { return 0; } };
  const r = await runAgentTurn(/** @type {any} */ ({
    model: "m",
    messages: [{ role: "user", content: "THE BRIEF" }],
    system: "s",
    tools: loopToolArgs({ disabled: SUBAGENT_OFF, report: true }),
    modeNow: () => "edit",
    root: tmpdir(),
    readerModel: "",
    maxTokens: 100,
    call: async (/** @type {any} */ { body }) => {
      seen.push(structuredClone(body.messages));
      return { ok: true, status: 200, json: { content: replies[n++] || [{ type: "text", text: "Out." }], usage: { input_tokens: 10, output_tokens: 5 } }, id: null };
    },
    costOf: () => 0,
    runHand: async () => {
      throw new Error("no hand runs here");
    },
    delegateRead: null,
    unattended: "subagent",
    checkedVet: (/** @type {string[]} */ c) => (vetted.push(c), c.includes("npm i") ? "report's checked: `npm i` installs packages" : null),
    mailbox: { read: () => [] },
    permissions: null,
    tree: null,
    onEvent: () => {},
    previewChars: 0,
    sink,
    signal: null,
    resume: null,
  }));
  const first = seen[1].at(-1).content[0];
  assert.deepEqual([first.is_error, first.content], [true, "Error: report's checked: `npm i` installs packages"]);
  assert.deepEqual(r.report, { ...REPORT, checked: ["node --test"] });
  assert.deepEqual(vetted, [["npm i"], ["node --test"]]);
});

// (fails before: yes — over MCP too)
test("over Filament's MCP server, a coding agent's report is vetted the same, by its session", async () => {
  /** @type {any[]} */
  const asked = [];
  /** @type {any[]} */
  const emitted = [];
  const subagents = { checkedProblem: (/** @type {string} */ chain, /** @type {string[]} */ c) => (asked.push([chain, c]), c.includes("npm i") ? "report's checked: `npm i` installs packages" : null) };
  const tools = createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => null, turns: /** @type {any} */ ({ get: () => null }), subagents: () => /** @type {any} */ (subagents), membersOf: () => null });
  const ctx = /** @type {any} */ ({ cwd: "/w", upstream: "claude", chain: "c1", turn: null, graph: false, report: true, emit: (/** @type {any} */ e) => emitted.push(e) });
  assert.deepEqual(await tools.call("report", { ...REPORT, checked: ["npm i"] }, ctx), { text: "report's checked: `npm i` installs packages", isError: true });
  assert.equal(emitted.length, 0);
  ok({ ok: !("isError" in (await tools.call("report", { ...REPORT, checked: ["node --test"] }, ctx))) });
  assert.deepEqual(emitted, [{ type: "task-report", report: { ...REPORT, checked: ["node --test"] } }]);
  assert.deepEqual(asked, [["c1", ["npm i"]], ["c1", ["node --test"]]]);
});

// (fails before: yes — the D63 drive: a worker's `node -e "…; console.log(…)"` was refused as parts joined by ;, and so
// was any check or brief whose quoted program text held a ;, a |, a < or a >)
test("a mark or a redirect inside quotes is the program's text, not the shell's: the command is one — a substitution in double quotes is still the shell's", () => {
  const drive = `node -e "const { format } = require('./src/format'); console.log(format(12.5), format(12.5) === '12.50 USD');"`;
  assert.equal(checkCommandsProblem([drive]), null);
  assert.equal(checkCommandsProblem([`node -e 'if (1 > 0) process.exit(0)'`]), null);
  assert.equal(checkCommandsProblem([`grep -q "a|b" README.md`]), null);
  assert.equal(checkCommandsProblem([`node -e "say(\\"x; y\\")"`]), null, "an escaped quote keeps the quote open");
  assert.equal(checkCommandsProblem([`find test -name x -exec node {} \\;`]), null, "an escaped mark is a letter");
  assert.match(String(checkCommandsProblem([`node -e "a"; echo ok`])), /joins its parts with ;/);
  assert.match(String(checkCommandsProblem([`node -e 'a' | tail -5`])), /joins its parts with \|/);
  assert.match(String(checkCommandsProblem([`node -e "$(cat x)"`])), /redirects or substitutes/);
  assert.match(String(checkCommandsProblem([`echo "a" > out.txt`])), /redirects or substitutes/);
  // A brief's may_run reads quotes the same: one command.
  assert.equal(grantsProblem({ may_run: [`node -e "a; b"`] }, { tag: "builder", may: "edit" }), null);
  assert.match(String(grantsProblem({ may_run: [`node -e "a"; node -e "b"`] }, { tag: "builder", may: "edit" })), /is more than one command/);
});

// (fails before: yes — one set of words for every check)
test("the words that send a worker back say its report named the commands, and that they stay its check", () => {
  const c = RAN([RUN("node --test", 1)]);
  const named = bounceText(c, 1, { task: true, agent: true, named: true });
  assert.match(named, /^\[Filament: you reported, and Filament ran the commands your report named in checked — your task's check now — in your worktree before the agent heard of it\. It failed:/);
  assert.match(named, / They stay your task's check whatever a later report names\.\]$/);
  assert.equal(bounceText(c, 1, { task: true, agent: true }), bounceText(c, 1, { task: true, agent: true, named: false }), "a task's own: as before");
});
