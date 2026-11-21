// @ts-check
// HarnessV4_TaskGraphPlus_Plan E41 P2, the owner's words of 10-25: "Keep the agent on track … what if agent decides to do
// something else on purpose or by owner's request … it would just disturb the agent by nudging it. so i leave this upto
// you", "Enforce "done when" and checks before done", and "Push back on list-shaped plans. When an add is a pure chain,
// the answer says a checklist would do". Decided (GX-D1): nothing nudges mid-work — Filament says facts only where it
// already speaks, a tasks call's answer and "Where you are". A done proves its done-when (case 9); what each task changed
// comes from git, not the agent's say (case 11, GX-D4); a long run with no checkpoint is said in the block alone
// (case 13); a straight line of tasks is said once (case 14); a writer with no done-when is said once (case 15).
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { taskFolders } from "../src/adapters/git/changes.js";
import { createGraphNotes } from "../src/app/agent/graph-notes.js";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";
import { PROMPT, PROMPT_VERSION, TOOL_TEXT } from "../src/app/agent/prompt.js";
import { CODER_TASKS_TOOL, LEAD_TASKS_TOOL, TASKS_TOOL } from "../src/app/agent/tools.js";
import { CODER_GRAPH_TEXT } from "../src/app/agent-context.js";
import { applyPlan, applyTasks, changedText, checkpointKept, restartCut, showText, spanClosed, spanOpened, turnBegun, whereText } from "../src/core/task-graph.js";
import { createTaskNotes } from "../src/services/task-notes.js";
import { MEMBERS as LED } from "./helpers/roster.js";
import { until } from "./helpers/wait.js";

const T0 = Date.UTC(2026, 9, 25, 14, 0);
const AGENT = { crew: /** @type {const} */ ("agent") };
/** @param {number} [at] */
const at = (at = T0) => ({ at, crew: /** @type {const} */ ("agent") });
/** @param {any} r @returns {any} */
const ok = (r) => (assert.ok(r.ok, JSON.stringify(r)), r);
/** @param {any} r @returns {string} */
const no = (r) => (assert.ok(!r.ok, JSON.stringify(r)), r.error);
/** A graph walked through calls, each a minute after the last. @param {any[]} calls */
const walk = (calls) => calls.reduce((g, c, k) => ok(applyTasks(g, c, at(T0 + k * 60_000))).graph, /** @type {any} */ (null));
/** @param {any} g @param {string} id */
const taskOf = (g, id) => g.tasks.find((/** @type {any} */ t) => t.id === id);
const PROOF = "npm test: 41 passed, 0 failed (test/parse.test.js among them)";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});
/** @param {string} name */
const tempDir = (name) => {
  const d = mkdtempSync(join(tmpdir(), `filament-graph-track-${name}-`));
  made.push(d);
  return d;
};
/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8" }).trim();
/** A repository with one file committed. */
const repo = () => {
  const dir = tempDir("repo");
  git(dir, "init", "-q");
  writeFileSync(join(dir, "README.md"), "one\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "first");
  return dir;
};
/** git with its commits — and HEAD's reflog entries — dated `ms`. @param {string} cwd @param {number} ms @param {string[]} args */
const dated = (cwd, ms, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_DATE: new Date(ms).toISOString(), GIT_COMMITTER_DATE: new Date(ms).toISOString() } });
/** Another chat's worktree of the repository, on `branch`: its commits are in no reflog of the folder's HEAD. @param {string} dir @param {string} branch */
const worktreeOn = (dir, branch) => {
  const w = tempDir("other");
  git(dir, "worktree", "add", "-q", w, branch);
  return w;
};
/** A file written and committed in `cwd` at `ms`. @param {string} cwd @param {number} ms @param {string} file @param {string} message */
const commitAt = (cwd, ms, file, message) => {
  writeFileSync(join(cwd, file), `${message}\n`);
  git(cwd, "add", "-A");
  dated(cwd, ms, "commit", "-qm", message);
};
/**
 * Git's reads of a task's folder with each snapshot counted as it ends — so a test can wait for one that changes
 * nothing it can see — and, while `seen.fails`, refused as git refuses one it cannot take.
 */
const counted = () => {
  const seen = { snapshots: 0, fails: false };
  /** @param {string} folder */
  const snapshot = async (folder) => {
    const s = seen.fails ? { ok: /** @type {const} */ (false), error: "git could not read the folder" } : await taskFolders.snapshot(folder);
    seen.snapshots++;
    return s;
  };
  return { seen, folders: { ...taskFolders, snapshot } };
};
/** A check that ends once the test lets it: `wait` is what the rig's checks wait on, `open` lets them all end. */
const gated = () => {
  /** @type {() => void} */
  let open = () => {};
  /** @type {Promise<void>} */
  const ended = new Promise((d) => (open = d));
  return { wait: () => ended, open: () => open() };
};

describe("a done proves its done-when (cases 9–10)", () => {
  const ADD = { action: "add", goal: "Fix the parser", tasks: [{ id: "t1", name: "Fix the tokenizer", acceptance: "the tokenizer's tests pass" }, { id: "t2", name: "Tidy", needs: ["t1"] }] };

  // (fails before: yes — a done of a task with acceptance was taken on its summary alone)
  test("a task with acceptance and no check is refused without its evidence, with the call to copy; with it, done, the evidence kept and shown", () => {
    const g = walk([ADD, { action: "start", ids: ["t1"] }]);
    assert.equal(
      no(applyTasks(g, { action: "done", id: "t1", summary: "Fixed the quote." }, at())),
      't1 has acceptance — "the tokenizer\'s tests pass" — and no check, so its done needs evidence too: what shows that holds — a test\'s output, a command you ran, what you saw\nThe call: {"action":"done","id":"t1","summary":"what was done, in a line or two","evidence":"what shows its acceptance holds: a test\'s output, a command you ran, what you saw"}',
    );
    assert.match(no(applyTasks(g, { action: "done", id: "t1", summary: "Fixed.", evidence: "  " }, at())), /^t1 has acceptance/, "blank is none");
    assert.equal(no(applyTasks(g, { action: "done", id: "t1", summary: "Fixed.", evidence: "x".repeat(2001) }, at())), "evidence is up to 2,000 characters (this one has 2,001)");
    const r = ok(applyTasks(g, { action: "done", id: "t1", summary: "Fixed the quote.", evidence: PROOF }, at()));
    assert.deepEqual([taskOf(r.graph, "t1").state, taskOf(r.graph, "t1").evidence], ["done", PROOF]);
    assert.equal(r.text, 'Done: t1. Next of yours: t2 "Tidy" — start it as you take it up. 1 of 2 done.');
    const shown = ok(applyTasks(r.graph, { action: "show", id: "t1" }, at())).text;
    assert.ok(shown.includes(`Done: Fixed the quote.\nEvidence: ${PROOF}`), shown);
  });

  // (fails before: no — these are as they were; held so the rule touches only what it is for)
  test("no acceptance: done on its summary; a check: Filament runs it, no evidence asked; evidence given anyway is kept", () => {
    const plain = walk([ADD, { action: "start", ids: ["t1"] }, { action: "done", id: "t1", summary: "x", evidence: PROOF }, { action: "start", ids: ["t2"] }]);
    const t2 = ok(applyTasks(plain, { action: "done", id: "t2", summary: "Tidied." }, at()));
    assert.deepEqual([taskOf(t2.graph, "t2").state, "evidence" in taskOf(t2.graph, "t2")], ["done", false]);
    const checkedOne = walk([{ action: "add", goal: "G", tasks: [{ id: "c1", name: "Fix", acceptance: "tests pass", check: ["npm test"] }] }, { action: "start", ids: ["c1"] }]);
    const c = ok(applyTasks(checkedOne, { action: "done", id: "c1", summary: "Fixed." }, at()));
    assert.equal(taskOf(c.graph, "c1").state, "checking", "its check proves it (case 10)");
  });

  // (fails before: yes — a tick ended a task whose acceptance nothing had shown)
  test("the checklist: a tick does not end a task with acceptance and no check — it says how", () => {
    const listed = ok(applyPlan(null, [{ text: "Fix the tokenizer", status: "doing" }], at()));
    const given = ok(applyTasks(listed.graph, { action: "change", tasks: [{ id: "p1", acceptance: "the tokenizer's tests pass" }] }, at())).graph;
    const r = applyPlan(given, [{ text: "Fix the tokenizer", status: "done" }], at());
    assert.equal(taskOf(r.graph, "p1").state, "running");
    assert.ok(r.text.includes("p1 has acceptance and no check: tasks done with id p1, its summary and evidence — what shows that holds — ends it; a tick does not."), r.text);
  });

  // (fails before: yes — the tools said nothing of evidence)
  test("every planner's tool has evidence on done, in its field and its words; the graph's words say it; version 48", () => {
    for (const tool of [TASKS_TOOL, CODER_TASKS_TOOL, LEAD_TASKS_TOOL]) assert.match(String(/** @type {any} */ (tool.input_schema.properties).evidence?.description), /^done: what shows its acceptance holds/, tool.description.slice(0, 40));
    for (const words of [TOOL_TEXT.tasks, TOOL_TEXT.tasksReads, TOOL_TEXT.leadTasks]) assert.ok(words.includes("and evidence where the task has acceptance and no check: what shows that holds"), words.slice(0, 60));
    // A coding agent's actions are said at its action field (the owner's tool plan of 11-08).
    assert.ok(String(/** @type {any} */ (CODER_TASKS_TOOL.input_schema.properties.action).description).includes("done: a finished task, with summary, and evidence where it has acceptance and no check."));
    assert.ok(PROMPT.graph.includes("with evidence where it has acceptance and no check") && CODER_GRAPH_TEXT.includes("with evidence where it has acceptance and no check"));
    assert.equal(PROMPT_VERSION, 129);
  });
});

describe("an add that leaves a straight line, and a writer with no done-when (cases 14–15)", () => {
  const LINE = "t1 → t2 → t3 is one straight line. Give a task only the needs it truly waits on: tasks that don't wait on each other can then run side by side.";
  const CHECKLIST = " If the work is a straight list, your checklist keeps it with less.";

  // (fails before: yes — a chain was taken as any graph is, its critical path the only word)
  test("open tasks one straight line of three: said once a graph, in the critical path's place", () => {
    const r = ok(applyTasks(null, { action: "add", goal: "G", tasks: [{ id: "t1", name: "A" }, { id: "t2", name: "B", needs: ["t1"] }, { id: "t3", name: "C", needs: ["t2"] }] }, at()));
    assert.ok(r.text.endsWith(` ${LINE}${CHECKLIST}`), r.text);
    assert.ok(!r.text.includes("Critical path"), r.text);
    assert.deepEqual(r.graph.told, ["line"]);
    const more = ok(applyTasks(r.graph, { action: "add", tasks: [{ id: "t4", name: "D", needs: ["t3"] }] }, at()));
    assert.ok(more.text.endsWith(" Critical path still to go: t1 → t2 → t3 → t4."), `once a graph: ${more.text}`);
  });

  // (fails before: no — held: any other shape says what it said)
  test("two tasks, a fork, a task beside the line: no line; a long one is cut; a lead hears no checklist", () => {
    assert.ok(!ok(applyTasks(null, { action: "add", goal: "G", tasks: [{ id: "t1", name: "A" }, { id: "t2", name: "B", needs: ["t1"] }] }, at())).text.includes("straight line"));
    const fork = ok(applyTasks(null, { action: "add", goal: "G", tasks: [{ id: "t1", name: "A" }, { id: "t2", name: "B", needs: ["t1"] }, { id: "t3", name: "C", needs: ["t1"] }] }, at()));
    assert.ok(!fork.text.includes("straight line") && !fork.graph.told, fork.text);
    const beside = ok(applyTasks(null, { action: "add", goal: "G", tasks: [{ id: "t1", name: "A" }, { id: "t2", name: "B", needs: ["t1"] }, { id: "t3", name: "C", needs: ["t2"] }, { id: "x", name: "X" }] }, at()));
    assert.ok(!beside.text.includes("straight line"), beside.text);
    const long = ok(applyTasks(null, { action: "add", goal: "G", tasks: Array.from({ length: 7 }, (_, k) => ({ id: `t${k + 1}`, name: `S${k + 1}`, ...(k ? { needs: [`t${k}`] } : {}) })) }, at()));
    assert.ok(long.text.includes(" t1 → t2 → t3 → … → t7 (7 tasks) is one straight line."), long.text);
    const BRIEF = { goal: "Done", steps: ["Do it"], acceptance: "it passes" };
    const lead = ok(applyTasks(null, { action: "add", goal: "G", tasks: [{ id: "t1", name: "A", by: "scout", ...BRIEF }, { id: "t2", name: "B", needs: ["t1"], by: "builder", writes: ["a.js"], ...BRIEF }, { id: "t3", name: "C", needs: ["t2"], by: "builder", writes: ["b.js"], ...BRIEF }] }, { at: T0, crew: LED }));
    assert.ok(lead.text.endsWith(LINE), lead.text);
  });

  // (fails before: yes — a task that wrote files and said nothing that shows it done was taken in silence)
  test("a task of the agent's own that writes and says no done-when: said once, as it is added", () => {
    const one = ok(applyTasks(null, { action: "add", goal: "G", tasks: [{ id: "t1", name: "A", writes: ["src/a.js"] }, { id: "t2", name: "B", writes: ["src/b.js"], acceptance: "b's test passes" }, { id: "t3", name: "C", writes: ["src/c.js"], check: ["npm test"] }, { id: "t4", name: "Read" }] }, at()));
    assert.ok(one.text.startsWith("Added t1, t2, t3, t4. t1 writes files and says no done-when: give it acceptance or a check, so its done can prove it."), one.text);
    const two = ok(applyTasks(null, { action: "add", goal: "G", tasks: [{ id: "a", name: "A", writes: ["a.js"] }, { id: "b", name: "B", writes: ["b.js"] }] }, at()));
    assert.ok(two.text.includes(" a, b write files and say no done-when: give each acceptance or a check, so its done can prove it."), two.text);
    const sub = ok(applyTasks(null, { action: "add", goal: "G", tasks: [{ id: "s", name: "S", by: "sub-agent", writes: ["s.js"], goal: "g", steps: ["x"], acceptance: "it passes" }] }, at()));
    assert.ok(!sub.text.includes("done-when"), "a sub-agent's task carries its acceptance");
  });
});

describe("where you are says a task gone a few turns with no checkpoint (case 13)", () => {
  const ADD = { action: "add", goal: "Fix the parser", tasks: [{ id: "t1", name: "Find the bug" }, { id: "s1", name: "Map it", by: "explorer", goal: "A map", steps: ["Read"], acceptance: "A map" }] };
  const QUIET = "  t1 has run 3 turns with no checkpoint — keep one (tasks keep, or pause) before a compaction can lose where it stands";
  /** @param {any} g @param {number} n */
  const turns = (g, n) => Array.from({ length: n }).reduce((x) => turnBegun(/** @type {any} */ (x)) || x, g);

  // (fails before: yes — nothing counted the turns a task ran, and nothing said it)
  test("three turns begun while it runs, none kept: said under its line; a keep, a pause, a start count afresh", () => {
    const g = walk([ADD, { action: "start", ids: ["t1"] }]);
    const two = turns(g, 2);
    assert.equal(taskOf(two, "t1").quiet, 2);
    assert.ok(!String(whereText(two, AGENT)).includes("turns with no checkpoint"));
    const three = turns(g, 3);
    const where = String(whereText(three, AGENT));
    assert.ok(where.includes(`- On it: t1 "Find the bug" — running, since`), where);
    assert.ok(where.includes(`\n${QUIET}\n`), where);
    assert.equal("quiet" in taskOf(three, "s1"), false, "a sub-agent's task is its sub-agent's");
    assert.equal(taskOf(checkpointKept(three, "t1"), "t1").quiet, undefined, "a note kept behind it");
    assert.equal(checkpointKept(g, "t1"), null, "none counted: nothing to change");
    assert.equal("quiet" in taskOf(ok(applyTasks(three, { action: "done", id: "t1", summary: "Found." }, at())).graph, "t1"), false, "a done ends its count");
    const paused = ok(applyTasks(three, { action: "pause", id: "t1", checkpoint: "where it stands" }, at(T0 + 9 * 60_000))).graph;
    assert.equal(taskOf(paused, "t1").quiet, undefined);
    const back = turns(ok(applyTasks(paused, { action: "start", ids: ["t1"] }, at(T0 + 10 * 60_000))).graph, 3);
    assert.ok(String(whereText(back, AGENT)).includes("  t1 has run 3 turns since its last checkpoint — keep one"), "since the one it has");
    assert.equal(turnBegun(walk([ADD])), null, "nothing of the agent's own runs");
  });

  // (fails before: yes — the runner had no turn's begin)
  test("the runner: each begin counts, kept with the session; a keep behind the task counts afresh", () => {
    const r = rig();
    ok(r.runner.apply("c1", ADD, AGENT));
    ok(r.runner.apply("c1", { action: "start", ids: ["t1"] }, AGENT));
    r.runner.begin("c1", "agent");
    r.runner.begin("c1", "agent");
    const third = String(r.runner.begin("c1", "agent"));
    assert.ok(third.includes(QUIET), third);
    assert.equal(taskOf(r.graph(), "t1").quiet, 3, "kept");
    ok(r.runner.apply("c1", { action: "keep", id: "t1", title: "Where it stands", text: "Read parse.js to line 80." }, AGENT));
    assert.equal(taskOf(r.graph(), "t1").quiet, undefined);
    assert.ok(!String(r.runner.where("c1", "agent")).includes("no checkpoint"));
  });
});

describe("what the folder changed while a task ran, from git (case 11)", () => {
  // (fails before: no — the words as written; held)
  test("the words: the files; those beyond its writes as a fact; none changed; git could not tell", () => {
    /** @param {Record<string, any>} t */
    const one = (t) => ({ version: 1, goal: "G", tasks: [{ id: "t1", name: "A", needs: [], writes: [], ...t }], startedAt: T0, closed: null, held: null, rev: 1 });
    assert.equal(changedText(/** @type {any} */ (one({ writes: ["src/**"], changed: ["README.md", "src/a.js"] })), "t1"), "While t1 ran, the folder changed src/a.js, and README.md changed too, beyond its writes — if that was other work, nothing to do.");
    assert.equal(changedText(/** @type {any} */ (one({ writes: ["src/a.js"], changed: ["docs/x.md"] })), "t1"), "While t1 ran, docs/x.md changed too, beyond its writes — if that was other work, nothing to do.");
    assert.equal(changedText(/** @type {any} */ (one({ changed: ["a.js", "b.js"] })), "t1"), "While t1 ran, the folder changed a.js, b.js.", "no writes named: nothing is beyond them");
    assert.equal(changedText(/** @type {any} */ (one({ writes: ["a.js"] })), "t1"), "While t1 ran, no file in the folder changed.");
    assert.equal(changedText(/** @type {any} */ (one({})), "t1"), "", "a task that names no writes and changed nothing");
    assert.equal(changedText(/** @type {any} */ (one({})), "t1", "git is not installed or not on PATH"), "What the folder changed while t1 ran could not be read: git is not installed or not on PATH.");
    const many = changedText(/** @type {any} */ (one({ changed: Array.from({ length: 25 }, (_, k) => `f${String(k).padStart(2, "0")}.js`) })), "t1");
    assert.ok(many.endsWith("f19.js, and 5 more."), many);
  });

  // (fails before: yes — a task's done said nothing of what changed while it ran)
  test("a task of the agent's own in a repository: its done names what changed while it ran, beyond its writes once; kept on it; the repository untouched", async () => {
    const dir = repo();
    const refsBefore = git(dir, "for-each-ref");
    const r = rig({ folders: taskFolders });
    const o = { ...AGENT, cwd: dir };
    ok(r.runner.apply("c1", { action: "add", goal: "Fix the parser", tasks: [{ id: "t1", name: "Fix it", writes: ["src/a.js"], acceptance: "a.js parses" }] }, o));
    const started = ok(r.runner.apply("c1", { action: "start", ids: ["t1"] }, o));
    assert.equal(started.more, undefined, "a start says nothing more");
    await until(() => taskOf(r.graph(), "t1").base, "t1's base snapshotted");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "a.js"), "export const a = 1;\n");
    writeFileSync(join(dir, "notes.md"), "scratch\n");
    const done = ok(r.runner.apply("c1", { action: "done", id: "t1", summary: "Fixed a.js.", evidence: "node src/a.js ran clean" }, o));
    assert.ok(done.more, "the done waits for git's read");
    assert.equal(await done.more, "While t1 ran, the folder changed src/a.js, and notes.md changed too, beyond its writes — if that was other work, nothing to do.");
    const t1 = taskOf(r.graph(), "t1");
    assert.deepEqual([t1.changed, t1.base], [["notes.md", "src/a.js"], undefined]);
    assert.ok(ok(r.runner.apply("c1", { action: "show", id: "t1" }, o)).text.includes("Changed while it ran: notes.md, src/a.js"));
    assert.deepEqual([git(dir, "for-each-ref"), git(dir, "status", "--porcelain")], [refsBefore, "?? notes.md\n?? src/"], "no ref, no index change: the folder is the developer's");
  });

  // (fails before: yes — FabeleHelper's of 11-10: the agent's own merge of main moved HEAD over another's commit, and its
  // files were said as the task's, beyond its writes; and, its second read, one committed while the task ran was still)
  test("HEAD moved over another's work as the task ran: what a merge brought in is not the task's, committed before or while it ran; its own commit's is", async () => {
    const dir = repo();
    const main = git(dir, "rev-parse", "--abbrev-ref", "HEAD");
    git(dir, "checkout", "-qb", "feature");
    // Another chat's commits to main, in its own worktree: on the merge's other side, whatever their time.
    const other = worktreeOn(dir, main);
    commitAt(other, T0 - 86_400_000, "upstream.js", "upstream, a day before the task");
    commitAt(other, T0 + 1_800_000, "meanwhile.js", "upstream, as the task ran");
    const r = rig({ folders: taskFolders });
    const o = { ...AGENT, cwd: dir };
    ok(r.runner.apply("c1", { action: "add", goal: "G", tasks: [{ id: "t1", name: "Fix it", writes: ["src/a.js"], acceptance: "a.js parses" }] }, o));
    ok(r.runner.apply("c1", { action: "start", ids: ["t1"] }, o));
    await until(() => taskOf(r.graph(), "t1").base, "t1's base snapshotted");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "a.js"), "export const a = 1;\n");
    git(dir, "add", "-A");
    dated(dir, T0 + 3_600_000, "commit", "-qm", "the task's own");
    dated(dir, T0 + 3_600_000, "merge", "-q", "--no-edit", main);
    const done = ok(r.runner.apply("c1", { action: "done", id: "t1", summary: "Fixed.", evidence: "node src/a.js ran clean" }, o));
    assert.equal(await done.more, "While t1 ran, the folder changed src/a.js.");
    const t1 = taskOf(r.graph(), "t1");
    // (fails before: yes — the review of d81fdac5e: kept as changed and as brought in, past BROUGHT_KEPT a merge's files
    // counted as the task's) Not kept as the task's at all.
    assert.deepEqual([t1.changed, t1.brought], [["src/a.js"], undefined]);
  });

  // (fails before: yes — the task reflog-brought: on HEAD's own line and committed after the task began, another chat's
  // commit that a fast-forward or a rebase moved HEAD onto was said as the task's, beyond its writes)
  for (const [how, onto] of /** @type {const} */ ([
    ["a fast-forward", "merge"],
    ["a rebase", "rebase"],
  ]))
    test(`${how} onto another's commit made as the task ran: not the task's — HEAD's reflog says it made none of it; its own commit's is`, async () => {
      const dir = repo();
      const main = git(dir, "rev-parse", "--abbrev-ref", "HEAD");
      const first = git(dir, "rev-parse", "HEAD");
      git(dir, "checkout", "-qb", "feature");
      const other = worktreeOn(dir, main);
      const r = rig({ folders: taskFolders });
      const o = { ...AGENT, cwd: dir };
      ok(r.runner.apply("c1", { action: "add", goal: "G", tasks: [{ id: "t1", name: "Fix it", writes: ["src/a.js"], acceptance: "a.js parses" }] }, o));
      ok(r.runner.apply("c1", { action: "start", ids: ["t1"] }, o));
      await until(() => taskOf(r.graph(), "t1").base, "t1's base snapshotted");
      commitAt(other, T0 + 1_800_000, "meanwhile.js", "another chat's, as the task ran");
      if (onto === "merge") git(dir, "merge", "-q", "--ff-only", main);
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "a.js"), "export const a = 1;\n");
      git(dir, "add", "-A");
      git(dir, "commit", "-qm", "the task's own");
      if (onto === "rebase") git(dir, "rebase", "-q", main);
      assert.equal(git(dir, "rev-list", "--count", "--merges", `${main}..HEAD`), "0", "one line: no merge's other side");
      assert.match(git(dir, "log", "-g", "--format=%gs", "HEAD"), onto === "merge" ? /^merge \S+: Fast-forward$/m : /^rebase \(start\): checkout /m);
      // The task's own commit, rebased or not, is HEAD's own: its file is not brought, writes or none.
      const head = git(dir, "rev-parse", "HEAD");
      assert.deepEqual(await taskFolders.brought(dir, first, head, T0, head), { ok: true, files: ["meanwhile.js"] });
      const done = ok(r.runner.apply("c1", { action: "done", id: "t1", summary: "Fixed.", evidence: "node src/a.js ran clean" }, o));
      assert.equal(await done.more, "While t1 ran, the folder changed src/a.js.");
      assert.deepEqual(taskOf(r.graph(), "t1").changed, ["src/a.js"]);
    });

  // (fails before: no — held: with no reflog to read, the first-parent and time rules decide as they did)
  test("HEAD keeps no reflog: a commit off its first-parent line, or made before the span, is another's; one on its line made in it is the task's", async () => {
    const dir = repo();
    git(dir, "config", "core.logAllRefUpdates", "false");
    rmSync(join(dir, ".git", "logs"), { recursive: true, force: true });
    const main = git(dir, "rev-parse", "--abbrev-ref", "HEAD");
    const first = git(dir, "rev-parse", "HEAD");
    git(dir, "checkout", "-qb", "feature");
    git(dir, "checkout", "-q", main);
    commitAt(dir, T0 - 86_400_000, "before.js", "upstream, a day before the span");
    commitAt(dir, T0 + 1_800_000, "during.js", "upstream, in the span");
    git(dir, "checkout", "-q", "feature");
    git(dir, "merge", "-q", "--ff-only", main);
    git(dir, "checkout", "-q", main);
    commitAt(dir, T0 + 1_900_000, "aside.js", "upstream, in the span, merged");
    git(dir, "checkout", "-q", "feature");
    commitAt(dir, T0 + 3_600_000, "own.js", "the task's own");
    dated(dir, T0 + 3_600_000, "merge", "-q", "--no-edit", main);
    assert.equal(git(dir, "log", "-g", "--format=%H", "HEAD"), "", "no reflog");
    const head = git(dir, "rev-parse", "HEAD");
    assert.deepEqual(await taskFolders.brought(dir, first, head, T0, head), { ok: true, files: ["aside.js", "before.js"] });
  });

  // (fails before: yes — the review of 67038d835, its finding 3: what a merge brought was told a commit at a time, so a
  // file main's commit named was another's though the task resolved a conflict in it — dropped from what it changed)
  test("a conflict the task resolved in a file the merge brought is the task's change: brought in is told a file at a time", async () => {
    const dir = repo();
    const main = git(dir, "rev-parse", "--abbrev-ref", "HEAD");
    writeFileSync(join(dir, "package.json"), '{\n  "name": "x"\n}\n');
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "package.json");
    git(dir, "checkout", "-qb", "feature");
    writeFileSync(join(dir, "package.json"), '{\n  "name": "x",\n  "feature": true\n}\n');
    git(dir, "commit", "-qam", "the branch's own, before the task");
    const other = worktreeOn(dir, main);
    writeFileSync(join(other, "package.json"), '{\n  "name": "x",\n  "main": true\n}\n');
    writeFileSync(join(other, "upstream.js"), "1\n");
    git(other, "add", "-A");
    dated(other, T0 + 1_800_000, "commit", "-qm", "upstream, as the task ran");
    const r = rig({ folders: taskFolders });
    const o = { ...AGENT, cwd: dir };
    ok(r.runner.apply("c1", { action: "add", goal: "G", tasks: [{ id: "t1", name: "Fix it", writes: ["src/a.js"], acceptance: "a.js parses" }] }, o));
    ok(r.runner.apply("c1", { action: "start", ids: ["t1"] }, o));
    await until(() => taskOf(r.graph(), "t1").base, "t1's base snapshotted");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "a.js"), "export const a = 1;\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "the task's own");
    assert.throws(() => git(dir, "merge", "-q", "--no-edit", main), "the merge stops at package.json");
    writeFileSync(join(dir, "package.json"), '{\n  "name": "x",\n  "feature": true,\n  "main": true\n}\n');
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "main merged, its conflict resolved");
    const done = ok(r.runner.apply("c1", { action: "done", id: "t1", summary: "Fixed.", evidence: "node src/a.js ran clean" }, o));
    assert.equal(await done.more, "While t1 ran, the folder changed src/a.js, and package.json changed too, beyond its writes — if that was other work, nothing to do.");
    assert.deepEqual(taskOf(r.graph(), "t1").changed, ["package.json", "src/a.js"], "upstream.js came as main holds it: brought in");
  });

  // (fails before: yes — the same finding's other side: a file under the task's writes was its own whoever wrote it, so
  // a merge's files under `src/**` were all kept as what the task changed)
  test("a file under the task's writes that only the merge wrote is brought in, not the task's", async () => {
    const dir = repo();
    const main = git(dir, "rev-parse", "--abbrev-ref", "HEAD");
    git(dir, "checkout", "-qb", "feature");
    const other = worktreeOn(dir, main);
    mkdirSync(join(other, "src"));
    for (let k = 0; k < 30; k++) writeFileSync(join(other, "src", `m${String(k).padStart(2, "0")}.js`), `${k}\n`);
    git(other, "add", "-A");
    dated(other, T0 + 1_800_000, "commit", "-qm", "upstream, as the task ran: thirty files under src");
    const r = rig({ folders: taskFolders });
    const o = { ...AGENT, cwd: dir };
    ok(r.runner.apply("c1", { action: "add", goal: "G", tasks: [{ id: "t1", name: "Fix it", writes: ["src/**"], acceptance: "a.js parses" }] }, o));
    ok(r.runner.apply("c1", { action: "start", ids: ["t1"] }, o));
    await until(() => taskOf(r.graph(), "t1").base, "t1's base snapshotted");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "a.js"), "export const a = 1;\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "the task's own");
    git(dir, "merge", "-q", "--no-edit", main);
    // One of the merge's files the task then edits, uncommitted, is its change: the folder holds it as main does not.
    writeFileSync(join(dir, "src", "m07.js"), "7, as the task needs it\n");
    const done = ok(r.runner.apply("c1", { action: "done", id: "t1", summary: "Fixed.", evidence: "node src/a.js ran clean" }, o));
    assert.equal(await done.more, "While t1 ran, the folder changed src/a.js, src/m07.js.");
    assert.deepEqual(taskOf(r.graph(), "t1").changed, ["src/a.js", "src/m07.js"]);
  });

  // (fails before: yes — the same finding: what a task changed was kept whole, a merge's thousands of files or its own)
  test("a task keeps the first 200 files it changed, by path, and its words say more changed", () => {
    const g = walk([{ action: "add", goal: "G", tasks: [{ id: "t1", name: "A" }] }, { action: "start", ids: ["t1"] }]);
    const files = Array.from({ length: 250 }, (_, k) => `f${String(k).padStart(3, "0")}.js`);
    const closed = spanClosed(spanOpened(g, "t1", { repo: "/r", commit: "c0", folder: "/r" }), "t1", { files, end: null });
    const t = taskOf(closed, "t1");
    assert.deepEqual([t.changed.length, t.changed[199], t.changedMore], [200, "f199.js", true]);
    assert.equal(changedText(closed, "t1"), `While t1 ran, the folder changed ${files.slice(0, 20).join(", ")}, and 180 more. More than 200 files changed in all: these are the first 200 by path, all that is kept by name.`);
    assert.ok(ok(applyTasks(closed, { action: "show", id: "t1" }, at())).text.includes(", and 180 more — the first 200 by path of more than 200"), "show says it too");
    const few = spanClosed(spanOpened(g, "t1", { repo: "/r", commit: "c0", folder: "/r" }), "t1", { files: files.slice(0, 200), end: null });
    assert.deepEqual([taskOf(few, "t1").changed.length, "changedMore" in taskOf(few, "t1")], [200, false], "200 are kept whole");
  });

  // (fails before: yes — the review of 67038d835, its finding 9: HEAD's reflog was read down to the first entry dated
  // before the span, and an entry carries its commit's committer date — GIT_COMMITTER_DATE, a rebase that keeps its
  // dates: the read ended on the task's own commit, and the time rule called it another's)
  test("a commit the task made with a date before it began is the task's: the reflog is read by its order", async () => {
    const dir = repo();
    commitAt(dir, T0 - 86_400_000, "before.js", "the branch's tip, a day before the task");
    const first = git(dir, "rev-parse", "HEAD");
    const r = rig({ folders: taskFolders });
    const o = { ...AGENT, cwd: dir };
    ok(r.runner.apply("c1", { action: "add", goal: "G", tasks: [{ id: "t1", name: "Fix it", writes: ["src/a.js"], acceptance: "a.js parses" }] }, o));
    ok(r.runner.apply("c1", { action: "start", ids: ["t1"] }, o));
    await until(() => taskOf(r.graph(), "t1").base, "t1's base snapshotted");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "a.js"), "export const a = 1;\n");
    writeFileSync(join(dir, "notes.md"), "scratch\n");
    git(dir, "add", "-A");
    dated(dir, T0 - 3_600_000, "commit", "-qm", "the task's own, dated an hour before it began");
    const head = git(dir, "rev-parse", "HEAD");
    assert.deepEqual(await taskFolders.brought(dir, first, head, T0, head), { ok: true, files: [] });
    const done = ok(r.runner.apply("c1", { action: "done", id: "t1", summary: "Fixed.", evidence: "node src/a.js ran clean" }, o));
    assert.equal(await done.more, "While t1 ran, the folder changed src/a.js, and notes.md changed too, beyond its writes — if that was other work, nothing to do.");
  });

  // (fails before: the second, yes — the same finding: a pick's reflog entry ends in the commit's own subject, and one
  // that begins "Fast-forward (" was read as git's word for a move; the first held — a pick was the task's already)
  for (const subject of ["another chat's fix", "Fast-forward (the cursor) to the end"])
    test(`a cherry-pick of another's commit, "${subject}", is the task's: it wrote the commit`, async () => {
      const dir = repo();
      const main = git(dir, "rev-parse", "--abbrev-ref", "HEAD");
      const first = git(dir, "rev-parse", "HEAD");
      git(dir, "checkout", "-qb", "feature");
      const other = worktreeOn(dir, main);
      const r = rig({ folders: taskFolders });
      const o = { ...AGENT, cwd: dir };
      ok(r.runner.apply("c1", { action: "add", goal: "G", tasks: [{ id: "t1", name: "Fix it", writes: ["src/a.js"], acceptance: "a.js parses" }] }, o));
      ok(r.runner.apply("c1", { action: "start", ids: ["t1"] }, o));
      await until(() => taskOf(r.graph(), "t1").base, "t1's base snapshotted");
      commitAt(other, T0 + 1_800_000, "picked.js", subject);
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "a.js"), "export const a = 1;\n");
      git(dir, "add", "-A");
      git(dir, "commit", "-qm", "the task's own");
      git(dir, "cherry-pick", git(other, "rev-parse", "HEAD"));
      assert.equal(git(dir, "log", "-g", "-1", "--format=%gs", "HEAD"), `cherry-pick: ${subject}`);
      const head = git(dir, "rev-parse", "HEAD");
      assert.deepEqual(await taskFolders.brought(dir, first, head, T0, head), { ok: true, files: [] });
      const done = ok(r.runner.apply("c1", { action: "done", id: "t1", summary: "Fixed.", evidence: "node src/a.js ran clean" }, o));
      assert.equal(await done.more, "While t1 ran, the folder changed src/a.js, and picked.js changed too, beyond its writes — if that was other work, nothing to do.");
    });

  // (fails before: no — held: a pick git fast-forwards writes no commit, HEAD moves onto the other's as it stands)
  test("a cherry-pick git fast-forwards moves HEAD onto another's commit as it stands: brought in", async () => {
    const dir = repo();
    const main = git(dir, "rev-parse", "--abbrev-ref", "HEAD");
    const first = git(dir, "rev-parse", "HEAD");
    git(dir, "checkout", "-qb", "feature");
    const other = worktreeOn(dir, main);
    commitAt(other, T0 + 1_800_000, "picked.js", "another chat's fix");
    git(dir, "cherry-pick", "--ff", git(other, "rev-parse", "HEAD"));
    assert.equal(git(dir, "log", "-g", "-1", "--format=%gs", "HEAD"), "cherry-pick: fast-forward");
    const head = git(dir, "rev-parse", "HEAD");
    assert.deepEqual(await taskFolders.brought(dir, first, head, T0, head), { ok: true, files: ["picked.js"] });
  });

  // (fails before: no — held: an amend's entry is a commit's, and the commit it wrote is the task's)
  test("an amend of the commit the branch stood on is the task's: what it added to it is what the task changed", async () => {
    const dir = repo();
    commitAt(dir, T0 - 86_400_000, "tip.js", "the branch's tip, a day before the task");
    const first = git(dir, "rev-parse", "HEAD");
    const r = rig({ folders: taskFolders });
    const o = { ...AGENT, cwd: dir };
    ok(r.runner.apply("c1", { action: "add", goal: "G", tasks: [{ id: "t1", name: "Fix it", writes: ["src/a.js"], acceptance: "a.js parses" }] }, o));
    ok(r.runner.apply("c1", { action: "start", ids: ["t1"] }, o));
    await until(() => taskOf(r.graph(), "t1").base, "t1's base snapshotted");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "a.js"), "export const a = 1;\n");
    writeFileSync(join(dir, "notes.md"), "scratch\n");
    git(dir, "add", "-A");
    git(dir, "commit", "--amend", "-qm", "the tip, amended by the task");
    assert.equal(git(dir, "log", "-g", "-1", "--format=%gs", "HEAD"), "commit (amend): the tip, amended by the task");
    const head = git(dir, "rev-parse", "HEAD");
    assert.deepEqual(await taskFolders.brought(dir, first, head, T0, head), { ok: true, files: [] });
    const done = ok(r.runner.apply("c1", { action: "done", id: "t1", summary: "Fixed.", evidence: "node src/a.js ran clean" }, o));
    assert.equal(await done.more, "While t1 ran, the folder changed src/a.js, and notes.md changed too, beyond its writes — if that was other work, nothing to do.");
  });

  // (fails before: no — held: a reset's entry is a move, and what it moved HEAD onto is another's)
  test("a reset onto another's commits brings them in, and what the task writes after is its own", async () => {
    const dir = repo();
    const main = git(dir, "rev-parse", "--abbrev-ref", "HEAD");
    const first = git(dir, "rev-parse", "HEAD");
    git(dir, "checkout", "-qb", "feature");
    const other = worktreeOn(dir, main);
    const r = rig({ folders: taskFolders });
    const o = { ...AGENT, cwd: dir };
    ok(r.runner.apply("c1", { action: "add", goal: "G", tasks: [{ id: "t1", name: "Fix it", writes: ["src/a.js"], acceptance: "a.js parses" }] }, o));
    ok(r.runner.apply("c1", { action: "start", ids: ["t1"] }, o));
    await until(() => taskOf(r.graph(), "t1").base, "t1's base snapshotted");
    commitAt(other, T0 + 1_800_000, "meanwhile.js", "another chat's, as the task ran");
    commitAt(dir, T0 + 1_900_000, "dropped.js", "the task's own, which its reset leaves behind");
    git(dir, "reset", "-q", "--hard", main);
    assert.equal(git(dir, "log", "-g", "-1", "--format=%gs", "HEAD"), `reset: moving to ${main}`);
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "a.js"), "export const a = 1;\n");
    const head = git(dir, "rev-parse", "HEAD");
    assert.deepEqual(await taskFolders.brought(dir, first, head, T0, head), { ok: true, files: ["meanwhile.js"] });
    const done = ok(r.runner.apply("c1", { action: "done", id: "t1", summary: "Fixed.", evidence: "node src/a.js ran clean" }, o));
    assert.equal(await done.more, "While t1 ran, the folder changed src/a.js.");
    assert.deepEqual(taskOf(r.graph(), "t1").changed, ["src/a.js"]);
  });

  // (fails before: no — held: a detached HEAD keeps its reflog as a branch's does)
  test("a detached HEAD: its own commit is the task's, and what its merge brought is not", async () => {
    const dir = repo();
    const main = git(dir, "rev-parse", "--abbrev-ref", "HEAD");
    const first = git(dir, "rev-parse", "HEAD");
    git(dir, "checkout", "-q", "--detach");
    const other = worktreeOn(dir, main);
    const r = rig({ folders: taskFolders });
    const o = { ...AGENT, cwd: dir };
    ok(r.runner.apply("c1", { action: "add", goal: "G", tasks: [{ id: "t1", name: "Fix it", writes: ["src/a.js"], acceptance: "a.js parses" }] }, o));
    ok(r.runner.apply("c1", { action: "start", ids: ["t1"] }, o));
    await until(() => taskOf(r.graph(), "t1").base, "t1's base snapshotted");
    commitAt(other, T0 + 1_800_000, "meanwhile.js", "another chat's, as the task ran");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "a.js"), "export const a = 1;\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "the task's own");
    git(dir, "merge", "-q", "--no-edit", main);
    assert.equal(git(dir, "rev-parse", "--abbrev-ref", "HEAD"), "HEAD", "on no branch");
    const head = git(dir, "rev-parse", "HEAD");
    assert.deepEqual(await taskFolders.brought(dir, first, head, T0, head), { ok: true, files: ["meanwhile.js"] });
    const done = ok(r.runner.apply("c1", { action: "done", id: "t1", summary: "Fixed.", evidence: "node src/a.js ran clean" }, o));
    assert.equal(await done.more, "While t1 ran, the folder changed src/a.js.");
  });

  // (fails before: no — held: a pull's rebase names its steps as a rebase does, under the pull's own words)
  test("a pull --rebase: what it brought from the remote is not the task's, and its own commit, picked again, is", async () => {
    const origin = repo();
    const dir = tempDir("clone");
    git(origin, "clone", "-q", origin, dir);
    const first = git(dir, "rev-parse", "HEAD");
    const r = rig({ folders: taskFolders });
    const o = { ...AGENT, cwd: dir };
    ok(r.runner.apply("c1", { action: "add", goal: "G", tasks: [{ id: "t1", name: "Fix it", writes: ["src/a.js"], acceptance: "a.js parses" }] }, o));
    ok(r.runner.apply("c1", { action: "start", ids: ["t1"] }, o));
    await until(() => taskOf(r.graph(), "t1").base, "t1's base snapshotted");
    commitAt(origin, T0 + 1_800_000, "meanwhile.js", "another's, at the remote as the task ran");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "a.js"), "export const a = 1;\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "the task's own");
    git(dir, "pull", "-q", "--rebase");
    assert.match(git(dir, "log", "-g", "--format=%gs", "HEAD"), /^pull .*\(pick\): the task's own$/m);
    const head = git(dir, "rev-parse", "HEAD");
    assert.deepEqual(await taskFolders.brought(dir, first, head, T0, head), { ok: true, files: ["meanwhile.js"] });
    const done = ok(r.runner.apply("c1", { action: "done", id: "t1", summary: "Fixed.", evidence: "node src/a.js ran clean" }, o));
    assert.equal(await done.more, "While t1 ran, the folder changed src/a.js.");
  });

  // (fails before: no — held: a linked worktree keeps a reflog of its own HEAD, which the read asks for)
  test("the chat's folder a linked worktree: its own HEAD's reflog tells its commit from what its fast-forward brought", async () => {
    const dir = repo();
    const main = git(dir, "rev-parse", "--abbrev-ref", "HEAD");
    git(dir, "branch", "feature");
    const folder = worktreeOn(dir, "feature");
    const first = git(folder, "rev-parse", "HEAD");
    const r = rig({ folders: taskFolders });
    const o = { ...AGENT, cwd: folder };
    ok(r.runner.apply("c1", { action: "add", goal: "G", tasks: [{ id: "t1", name: "Fix it", writes: ["src/a.js"], acceptance: "a.js parses" }] }, o));
    ok(r.runner.apply("c1", { action: "start", ids: ["t1"] }, o));
    await until(() => taskOf(r.graph(), "t1").base, "t1's base snapshotted");
    commitAt(dir, T0 + 1_800_000, "meanwhile.js", "another chat's, in the repository's own folder");
    git(folder, "merge", "-q", "--ff-only", main);
    mkdirSync(join(folder, "src"));
    writeFileSync(join(folder, "src", "a.js"), "export const a = 1;\n");
    git(folder, "add", "-A");
    git(folder, "commit", "-qm", "the task's own");
    const head = git(folder, "rev-parse", "HEAD");
    assert.deepEqual(await taskFolders.brought(folder, first, head, T0, head), { ok: true, files: ["meanwhile.js"] });
    const done = ok(r.runner.apply("c1", { action: "done", id: "t1", summary: "Fixed.", evidence: "node src/a.js ran clean" }, o));
    assert.equal(await done.more, "While t1 ran, the folder changed src/a.js.");
  });

  // (fails before: yes — the same finding: the commits' files were read a line each, where git writes a name with a
  // tab, a quote or a newline in quotes, escaped — so it matched no file the folder changed. Windows keeps no such
  // file, so the commit is made in the index alone, and HEAD moved onto it with no checkout)
  test("a brought file whose name git would quote — a tab in it — is named as it is", async () => {
    const dir = repo();
    const main = git(dir, "rev-parse", "--abbrev-ref", "HEAD");
    const first = git(dir, "rev-parse", "HEAD");
    git(dir, "checkout", "-qb", "feature");
    const other = worktreeOn(dir, main);
    writeFileSync(join(other, "plain.js"), "1\n");
    git(other, "add", "-A");
    git(other, "-c", "core.protectNTFS=false", "update-index", "--add", "--cacheinfo", `100644,${git(other, "rev-parse", ":plain.js")},we\tird.js`);
    git(other, "-c", "core.protectNTFS=false", "commit", "-qm", "another chat's, a tab in a file's name");
    git(dir, "reset", "-q", "--soft", main);
    const head = git(dir, "rev-parse", "HEAD");
    assert.deepEqual(await taskFolders.brought(dir, first, head, T0, head), { ok: true, files: ["plain.js", "we\tird.js"] });
  });

  // (fails before: yes — nothing read the folder while a task ran)
  test("a pause closes its span and a start opens another: what changed while it was paused is not its", async () => {
    const dir = repo();
    const r = rig({ folders: taskFolders });
    const o = { ...AGENT, cwd: dir };
    ok(r.runner.apply("c1", { action: "add", goal: "G", tasks: [{ id: "t2", name: "B", writes: ["b*.js"], acceptance: "b loads" }] }, o));
    ok(r.runner.apply("c1", { action: "start", ids: ["t2"] }, o));
    await until(() => taskOf(r.graph(), "t2").base, "t2's base snapshotted");
    writeFileSync(join(dir, "b.js"), "1\n");
    ok(r.runner.apply("c1", { action: "pause", id: "t2", checkpoint: "b.js written; b2.js next" }, o));
    await until(() => !taskOf(r.graph(), "t2").base, "t2's span closed");
    assert.deepEqual(taskOf(r.graph(), "t2").changed, ["b.js"]);
    writeFileSync(join(dir, "other.js"), "someone else's\n");
    ok(r.runner.apply("c1", { action: "start", ids: ["t2"] }, o));
    await until(() => taskOf(r.graph(), "t2").base, "t2's base snapshotted");
    writeFileSync(join(dir, "b2.js"), "2\n");
    const done = ok(r.runner.apply("c1", { action: "done", id: "t2", summary: "Both written.", evidence: "node -e require ran" }, o));
    assert.equal(await done.more, "While t2 ran, the folder changed b.js, b2.js.");
    assert.deepEqual(taskOf(r.graph(), "t2").changed, ["b.js", "b2.js"]);
  });

  // (fails before: yes — the review of 67038d835, its finding 1: a done that waits for its check keeps the folder as it
  // stood then as the task's base, for a red check to read on from; a green one left it there, the task's next start
  // opened no span over it, and its second done said everything the folder changed since the first)
  test("a checked task reopened: its new round reads the folder from its own start, not from its first done", async () => {
    const dir = repo();
    const read = counted();
    const check = gated();
    const r = rig({ folders: read.folders, checks: check.wait });
    const o = { ...AGENT, cwd: dir };
    ok(r.runner.apply("c1", { action: "add", goal: "G", tasks: [{ id: "t1", name: "Fix it", writes: ["a*.js"], check: ["npm test"] }] }, o));
    ok(r.runner.apply("c1", { action: "start", ids: ["t1"] }, o));
    await until(() => taskOf(r.graph(), "t1").base, "t1's base snapshotted");
    writeFileSync(join(dir, "a.js"), "1\n");
    const first = ok(r.runner.apply("c1", { action: "done", id: "t1", summary: "Fixed." }, o));
    assert.equal(await first.more, "While t1 ran, the folder changed a.js.");
    assert.equal(taskOf(r.graph(), "t1").state, "checking", "its check runs on after git's read of the folder");
    check.open();
    await until(() => taskOf(r.graph(), "t1").state === "done", "t1's check passed");
    // Other work, once t1 was done: none of it is its next round's.
    writeFileSync(join(dir, "other.js"), "someone else's\n");
    const snapshots = read.seen.snapshots;
    ok(r.runner.apply("c1", { action: "start", ids: ["t1"] }, o));
    await until(() => read.seen.snapshots > snapshots, "the folder read as t1's second round began");
    writeFileSync(join(dir, "a2.js"), "2\n");
    const second = ok(r.runner.apply("c1", { action: "done", id: "t1", summary: "Fixed again." }, o));
    assert.equal(await second.more, "While t1 ran, the folder changed a2.js.");
    const t1 = taskOf(r.graph(), "t1");
    assert.deepEqual([t1.round, t1.changed, t1.earlier.done.changed], [2, ["a2.js"], ["a.js"]]);
  });

  // (fails before: yes — the same finding, in the core: a check a restart cut ends its task done with that base too)
  test("a base of the round before is replaced as the task's next round begins; one of this round stands", () => {
    const BASE = { repo: "/r", commit: "c0", folder: "/r", head: "h0", at: T0 };
    const running = spanOpened(walk([{ action: "add", goal: "G", tasks: [{ id: "t1", name: "A", check: ["npm test"] }] }, { action: "start", ids: ["t1"] }]), "t1", BASE);
    assert.equal(taskOf(running, "t1").base.round, 1, "a base says the round it is of");
    assert.equal(spanOpened(running, "t1", { ...BASE, commit: "c9" }), null, "one of this round stands");
    const checking = spanClosed(ok(applyTasks(running, { action: "done", id: "t1", summary: "Done." }, at())).graph, "t1", { files: ["a.js"], end: { ...BASE, commit: "c1", round: 1 }, round: 1 });
    assert.deepEqual([taskOf(checking, "t1").state, taskOf(checking, "t1").base.commit], ["checking", "c1"], "a red check reads on from there");
    const cut = /** @type {any} */ (restartCut(/** @type {any} */ (checking), T0)).graph;
    assert.deepEqual([taskOf(cut, "t1").state, taskOf(cut, "t1").base.commit], ["done", "c1"]);
    const again = ok(applyTasks(cut, { action: "start", ids: ["t1"] }, at())).graph;
    const opened = spanOpened(again, "t1", { ...BASE, commit: "c2" });
    assert.deepEqual([taskOf(opened, "t1").round, taskOf(opened, "t1").base.commit, taskOf(opened, "t1").base.round], [2, "c2", 2]);
  });

  // (fails before: yes — the same finding's failing path: the new round's snapshot could not be taken, so the base of
  // the round before stayed, and the done read everything since from it)
  test("a reopened task whose start could not be snapshotted reads nothing from the round before's base, and says nothing", async () => {
    const dir = repo();
    const read = counted();
    const check = gated();
    const r = rig({ folders: read.folders, checks: check.wait });
    const o = { ...AGENT, cwd: dir };
    ok(r.runner.apply("c1", { action: "add", goal: "G", tasks: [{ id: "t1", name: "Fix it", writes: ["a*.js"], check: ["npm test"] }] }, o));
    ok(r.runner.apply("c1", { action: "start", ids: ["t1"] }, o));
    await until(() => taskOf(r.graph(), "t1").base, "t1's base snapshotted");
    writeFileSync(join(dir, "a.js"), "1\n");
    await ok(r.runner.apply("c1", { action: "done", id: "t1", summary: "Fixed." }, o)).more;
    check.open();
    await until(() => taskOf(r.graph(), "t1").state === "done", "t1's check passed");
    writeFileSync(join(dir, "other.js"), "someone else's\n");
    read.seen.fails = true;
    const snapshots = read.seen.snapshots;
    ok(r.runner.apply("c1", { action: "start", ids: ["t1"] }, o));
    await until(() => read.seen.snapshots > snapshots, "the folder's read tried as t1's second round began");
    read.seen.fails = false;
    writeFileSync(join(dir, "a2.js"), "2\n");
    const second = ok(r.runner.apply("c1", { action: "done", id: "t1", summary: "Fixed again." }, o));
    assert.equal(await second.more, "");
    assert.deepEqual([taskOf(r.graph(), "t1").changed, taskOf(r.graph(), "t1").base], [undefined, undefined]);
  });

  // (fails before: yes — the review of 1d7591aa8: the roll-up opened a span on the step, and the last sub-task's done
  // said what changed "while s ran" too)
  test("a step runs as its sub-tasks do: no span of its own, and its last sub-task's done says only its own", async () => {
    const dir = repo();
    const r = rig({ folders: taskFolders });
    const o = { ...AGENT, cwd: dir };
    ok(r.runner.apply("c1", { action: "add", goal: "G", tasks: [{ id: "s", name: "Step", writes: ["src/**"] }, { id: "k", name: "K", under: "s", writes: ["k.js"], acceptance: "k loads" }] }, o));
    ok(r.runner.apply("c1", { action: "start", ids: ["k"] }, o));
    await until(() => taskOf(r.graph(), "k").base, "k's base snapshotted");
    await new Promise((d) => setTimeout(d, 50));
    assert.deepEqual([taskOf(r.graph(), "s").state, taskOf(r.graph(), "s").base], ["running", undefined]);
    writeFileSync(join(dir, "k.js"), "1\n");
    const done = ok(r.runner.apply("c1", { action: "done", id: "k", summary: "Written.", evidence: "node k.js ran" }, o));
    assert.equal(await done.more, "While k ran, the folder changed k.js.");
    assert.equal(taskOf(r.graph(), "s").state, "done");
  });

  // (fails before: yes — the review of 7d8059000: s, freed by dropping k, read as a step still, so its start opened no
  // span and its done said nothing of what changed)
  test("a step freed by dropping its sub-tasks is the planner's own again: its start opens a span, its done says what changed", async () => {
    const dir = repo();
    const r = rig({ folders: taskFolders });
    const o = { ...AGENT, cwd: dir };
    ok(r.runner.apply("c1", { action: "add", goal: "G", tasks: [{ id: "s", name: "Step", writes: ["s.js"] }, { id: "k", name: "K", under: "s" }] }, o));
    ok(r.runner.apply("c1", { action: "drop", ids: ["k"], reason: "s does it whole" }, o));
    ok(r.runner.apply("c1", { action: "start", ids: ["s"] }, o));
    await until(() => taskOf(r.graph(), "s").base, "s's base snapshotted");
    writeFileSync(join(dir, "s.js"), "1\n");
    const done = ok(r.runner.apply("c1", { action: "done", id: "s", summary: "Written." }, o));
    assert.equal(await done.more, "While s ran, the folder changed s.js.");
  });

  // (fails before: yes — the review of 7d8059000: t, under way, took a sub-task and kept its base for good)
  test("a running task of the planner's own that takes sub-tasks closes its span, what changed so far kept on it", async () => {
    const dir = repo();
    const r = rig({ folders: taskFolders });
    const o = { ...AGENT, cwd: dir };
    ok(r.runner.apply("c1", { action: "add", goal: "G", tasks: [{ id: "t", name: "T" }] }, o));
    ok(r.runner.apply("c1", { action: "start", ids: ["t"] }, o));
    await until(() => taskOf(r.graph(), "t").base, "t's base snapshotted");
    writeFileSync(join(dir, "t.js"), "1\n");
    ok(r.runner.apply("c1", { action: "add", tasks: [{ id: "k", name: "K", under: "t" }] }, o));
    await until(() => !taskOf(r.graph(), "t").base, "t's span closed");
    assert.deepEqual([taskOf(r.graph(), "t").state, taskOf(r.graph(), "t").changed], ["running", ["t.js"]]);
  });

  // (fails before: no — held: a folder git does not hold says nothing)
  test("a folder that is no repository: nothing kept, nothing said; a runner that reads no folders, none at all", async () => {
    const dir = tempDir("plain");
    const r = rig({ folders: taskFolders });
    const o = { ...AGENT, cwd: dir };
    ok(r.runner.apply("c1", { action: "add", goal: "G", tasks: [{ id: "t1", name: "A", writes: ["a.js"], acceptance: "a loads" }] }, o));
    ok(r.runner.apply("c1", { action: "start", ids: ["t1"] }, o));
    writeFileSync(join(dir, "a.js"), "1\n");
    const done = ok(r.runner.apply("c1", { action: "done", id: "t1", summary: "Done.", evidence: "it loads" }, o));
    assert.equal(await done.more, "");
    assert.equal(taskOf(r.graph(), "t1").changed, undefined);
    const bare = rig();
    ok(bare.runner.apply("c1", { action: "add", goal: "G", tasks: [{ id: "t1", name: "A" }] }, o));
    ok(bare.runner.apply("c1", { action: "start", ids: ["t1"] }, o));
    assert.equal(ok(bare.runner.apply("c1", { action: "done", id: "t1", summary: "Done." }, o)).more, undefined);
  });
});

/**
 * A session's graph kept in memory, its notes in a folder of the test's, and the runner over them. `checks`: the
 * registry runs a task's check, each passing once what `checks` gives has ended — a check outlasts git's read of the
 * folder, as one that runs a test suite does.
 * @param {{ folders?: any, checks?: (() => Promise<void>) | null }} [o]
 */
function rig({ folders = null, checks = null } = {}) {
  /** @type {Map<string, any>} */
  const chains = new Map([["c1", { id: "c1", meta: {} }]]);
  const store = createTaskNotes({ dir: join(tempDir("rig"), "task-notes"), now: () => T0 });
  const notes = createGraphNotes({ notes: store });
  /** @param {string} _chain @param {string[]} commands */
  const checkFolder = async (_chain, commands) => {
    await checks?.();
    return { ran: true, commands, runs: commands.map((command) => ({ command, exit: 0, ms: 5, output: "", stopped: false })), bounces: 0, stopped: false };
  };
  const registry = { slots: () => 4, tell: () => {}, stop: () => ({ ok: true }), resumable: () => null, launch: () => ({ ok: false, error: "no launches here" }), guard: () => {}, ...(checks ? { checkFolder, checkProblem: () => null } : {}) };
  const archive = {
    /** The meta's named keys, as the archive's `metaOf` reads them. @param {string} id @param {readonly string[]} keys */
    metaOf: (id, keys) => {
      const c = chains.get(id);
      return c ? Object.fromEntries(keys.filter((k) => c.meta?.[k] !== undefined).map((k) => [k, c.meta[k]])) : null;
    },
    mergeMeta: (/** @type {string} */ id, /** @type {Record<string, any>} */ patch) => {
      const c = chains.get(id);
      if (!c) return null;
      c.meta = structuredClone({ ...c.meta, ...patch });
      return c.meta;
    },
    openGraphs: () => [],
  };
  const runner = createGraphRunner({ archive, registry: /** @type {any} */ (registry), events: { publish: () => {} }, crew: () => "agent", log: () => {}, now: () => T0, notes, folders });
  return { runner, graph: () => chains.get("c1").meta.graph };
}

// The whole graph's words name nothing new of these: what changed is one task's, read with show and an id.
test("the whole graph's words are as they were", () => {
  const g = walk([{ action: "add", goal: "G", tasks: [{ id: "t1", name: "A" }] }, { action: "start", ids: ["t1"] }]);
  assert.ok(!showText(turnBegun(g) || g, "agent").includes("quiet"));
});
