// @ts-check
// The signs that an agent drifts from its work (core/drift.js; the owner's of 11-10: state signals only, no step counter),
// said to Filament's loop on a call's result and to a coding agent at its next step (checkpoint.js "action").
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changedSecond, driftChanged, failedAgain, failingLine, newDriftState, outsideLine } from "../src/core/drift.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";
import { changesWhatFailed, leadToolSetFor, toolSetFor } from "../src/app/agent/tools.js";
import { outsideOwnWrites } from "../src/core/task-graph.js";

test("the same command failing a third time in a row with nothing changed between is a sign once; a change, a pass or another command starts its count again", () => {
  const s = newDriftState();
  assert.deepEqual([failedAgain(s, "npm test", true), failedAgain(s, "npm  test", true), failedAgain(s, "npm test", true)], [false, false, true], "its blanks as one");
  assert.equal(failedAgain(s, "npm test", true), false, "once a turn");
  const t = newDriftState();
  const twice = () => [failedAgain(t, "npm test", true), failedAgain(t, "npm test", true)];
  twice();
  driftChanged(t);
  assert.equal(failedAgain(t, "npm test", true), false, "a file changed between");
  twice();
  failedAgain(t, "npm test", false);
  assert.deepEqual(twice(), [false, false], "a pass between");
  failedAgain(t, "npm install", true);
  assert.equal(failedAgain(t, "npm test", true), false, "another command between, which may have changed a file");
  assert.equal(failedAgain(t, "", true), false, "no command");
  assert.match(failingLine("npm test", "loop"), /^\(Filament: `npm test` failed a third time in a row, .*say so to the person\.\)$/);
  assert.match(failingLine("npm test", "coding"), /^\[Filament: `npm test` failed a third time/);
});

// (fails before: yes — the review of 11-11, d-fails: a run was counted by its command's words alone, so `npm test` failing
// once in each of three packages — Codex names the folder of each command — was one command failing a third time)
test("the same command failing in another folder is another run: three folders are no third time in a row, three runs in one are", () => {
  const s = newDriftState();
  assert.deepEqual(["packages/a", "packages/b", "packages/c"].map((where) => failedAgain(s, "npm test", true, where)), [false, false, false], "once in each of three folders");
  assert.deepEqual([failedAgain(s, "npm test", true, "packages/c"), failedAgain(s, "npm test", true, "packages/c")], [false, true], "three times in the last of them");
  const t = newDriftState();
  assert.deepEqual([failedAgain(t, "npm test", true, "packages/a"), failedAgain(t, "npm test", true, "packages/a"), failedAgain(t, "npm test", true)], [false, false, false], "a run that names no folder is not the one that named one");
  assert.deepEqual([failedAgain(t, "npm test", true), failedAgain(t, "npm test", true)], [false, true], "and counts by its command, as the loop's runs do");
});

// (fails before: yes — the review of 11-11, d-fails: the line said "with nothing changed between: run as it is, it will
// fail the same way" — what Filament cannot know: it sees its agent's calls, not a service that came up meanwhile)
test("the failing line says what Filament saw, and promises no outcome", () => {
  const words = "Filament: `npm test` failed a third time in a row, and nothing Filament saw changed between them. Before you run it again, find the cause — read what it said, and the code it names — and where you cannot, say so to the person.";
  assert.equal(failingLine("npm test", "loop"), `(${words})`);
  assert.equal(failingLine("npm  test ", "coding"), `[${words}]`);
  assert.doesNotMatch(failingLine("npm test", "coding"), /will fail|the same way|with nothing changed/);
});

// (fails before: no — a refactor's guard, the review of 11-11: the loop and a coding agent's turn each wrote the count of
// the files a turn changed, and now ask one function)
test("a turn's second changed file is its second, once: a file changed again is none, and past the second none is asked", () => {
  const changed = new Set();
  assert.equal(changedSecond(changed, "/p/a.txt"), false, "the first");
  assert.equal(changedSecond(changed, "/p/a.txt"), false, "the same file again");
  assert.equal(changedSecond(changed, ""), false, "no file");
  assert.equal(changedSecond(changed, "/p/b.txt"), true, "the second");
  assert.equal(changedSecond(changed, "/p/c.txt"), false, "past the second");
  assert.deepEqual([...changed], ["/p/a.txt", "/p/b.txt"], "and none is kept past it");
});

// (fails before: no — the rule's own rows; a coding agent's calls through it are coder-nudges.test.js's, which failed
// first: the review of 11-11 found the coding path counted a failed run a third time though a sub-agent's change was
// applied between)
test("what starts a failed command's count again is one rule: a change, a command, another server's tool not said to only read, a sub-agent's change applied, a task's merged", () => {
  for (const name of ["write", "edit", "bash", "powershell", "bash_background"]) assert.equal(changesWhatFailed(name), true, name);
  assert.equal(changesWhatFailed("mcp__github__create_issue", "mutate", {}), true, "another server's tool");
  assert.equal(changesWhatFailed("mcp__github__get_issue", "read", {}), false, "one said to only read");
  assert.equal(changesWhatFailed("agent", "mutate", { agent_id: "sa_1", apply_changes: true }), true, "a sub-agent's change applied");
  assert.equal(changesWhatFailed("worker", "mutate", { agent_id: "w1", apply_changes: true }), true, "a worker's");
  assert.equal(changesWhatFailed("tasks", "mutate", { action: "merge", id: "t1" }), true, "a task's merged");
  for (const [name, input] of /** @type {[string, any][]} */ ([["read", { path: "a.js" }], ["agent", { agent_id: "sa_1", prompt: "go on" }], ["tasks", { action: "show" }], ["filament_memory_search", { query: "x" }], ["background_command", { id: "bg_1" }]]))
    assert.equal(changesWhatFailed(name, "mutate", input), false, `${name} ${JSON.stringify(input)}`);
});

/**
 * A loop turn whose model makes the calls `script` gives, a command failing as `fails` says: the requests it sent.
 * `graph`: the turn's graph, as turn.js hands it; `tools`: the tools it offers, the agent's own unless given.
 * @param {{ calls: any[][], fails: (command: string) => boolean, graph?: any, root?: string, tools?: any }} o
 */
async function loopTurn({ calls, fails, graph = null, root = tmpdir(), tools = toolSetFor({ delegateRead: false }) }) {
  /** @type {any[]} */
  const sent = [];
  const out = await runAgentTurn(/** @type {any} */ ({
    model: "m",
    root,
    readerModel: "",
    maxTokens: 100,
    thinking: null,
    costOf: () => 0,
    runHand: async (/** @type {string} */ name, /** @type {any} */ input) => {
      if (name === "bash" && fails(String(input.command))) throw Object.assign(new Error(`${input.command} failed`), { exitCode: 1 });
      return `${name} ran`;
    },
    delegateRead: null,
    permissions: null,
    rules: [],
    hooks: null,
    mcpReadOnly: new Set(),
    previewChars: 200,
    messages: [{ role: "user", content: "make the tests pass" }],
    system: "s",
    tools,
    modeNow: () => "auto",
    mailbox: null,
    graph,
    tree: null,
    onEvent: () => {},
    sink: { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() {}, count() { return 0; } },
    signal: null,
    resume: null,
    call: async (/** @type {any} */ { body }) => {
      sent.push(structuredClone(body));
      const next = calls[sent.length - 1];
      const content = next ? next.map((c, i) => ({ type: "tool_use", id: `c${sent.length}_${i}`, name: c[0], input: c[1] })) : [{ type: "text", text: "Done." }];
      return { ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  }));
  /** The result the request `n` (1-based) carried for the call before it. @param {number} n */
  const result = (n) => {
    const last = sent[n - 1]?.messages?.at(-1);
    const b = (Array.isArray(last?.content) ? last.content : []).find((/** @type {any} */ x) => x?.type === "tool_result");
    return typeof b?.content === "string" ? b.content : JSON.stringify(b?.content ?? "");
  };
  return { out, sent, result };
}

// (fails before: yes — the owner's of 11-10, drift: the same failing command run again and again with nothing changed was
// said to nobody)
test("the loop: the third failed run of the same command in a row, with only reads between, carries the line on its result, once", async () => {
  const test3 = ["bash", { command: "npm test" }];
  const look = ["read", { path: "src/a.js" }];
  const { out, result } = await loopTurn({ calls: [[test3], [look], [test3], [test3], [test3]], fails: () => true });
  assert.equal(out.status, "done", JSON.stringify(out.notes));
  assert.ok(!result(4).includes("failed a third time"), result(4));
  assert.ok(result(5).endsWith(failingLine("npm test", "loop")), result(5));
  assert.ok(!result(6).includes("failed a third time"), "once");
  assert.ok(out.notes.includes("agent: `npm test` failed a third time in a row, and nothing Filament saw changed between them — Filament said so on its result"), out.notes.join("\n"));
  // A write between, or another command, which may have changed a file: no sign.
  for (const between of [["write", { path: "fix.txt", content: "x" }], ["bash", { command: "npm install" }]]) {
    const changed = await loopTurn({ calls: [[test3], [test3], [between], [test3]], fails: (c) => c === "npm test" });
    assert.ok(!changed.result(5).includes("failed a third time"), `${between[0]}: ${changed.result(5)}`);
  }
});

// (fails before: yes — the review of the drift signals, d-fails: a sub-agent's change applied, or a failed task's merged,
// into the folder between two failed runs read as nothing changed)
test("the loop: a sub-agent's change applied or a task's change merged between two failed runs starts the count again", async () => {
  const test3 = ["bash", { command: "npm test" }];
  // A lead's tools: the agent's apply, its worker's, and its tasks' merge of a failed task's change.
  const lead = { tools: leadToolSetFor({ delegateRead: false, graph: true }), graph: { apply: () => ({ ok: false, error: "nothing here" }), open: () => null, hasOpen: () => true } };
  for (const between of [["agent", { agent_id: "sa_1", apply_changes: true }], ["worker", { agent_id: "w1", apply_changes: true }], ["tasks", { action: "merge", id: "t1", reason: "its check is flaky" }]]) {
    const { sent, result } = await loopTurn({ calls: [[test3], [between], [test3], [between], [test3]], fails: () => true, ...lead });
    assert.ok(!JSON.stringify(sent).includes("not available here"), `${between[0]} is offered`);
    assert.ok(!result(6).includes("failed a third time"), `${between[0]}: ${result(6)}`);
  }
  // A follow-up, or a mark that the change is in already, writes nothing: the count goes on.
  for (const between of [["agent", { agent_id: "sa_1", prompt: "go on" }], ["agent", { agent_id: "sa_1", mark_applied: true }]]) {
    const { result } = await loopTurn({ calls: [[test3], [between], [test3], [between], [test3]], fails: () => true, ...lead });
    assert.ok(result(6).endsWith(failingLine("npm test", "loop")), `${JSON.stringify(between[1])}: ${result(6)}`);
  }
});

/**
 * A graph runner over one chat, "c1", its graph kept in memory: the runner, and its graph as kept. `atWork`: the chats
 * whose sub-agents work now. `kept`: what the chat keeps, for a second runner over the same chat — Filament started again.
 * @param {{ atWork?: () => string[], kept?: { meta: Record<string, any> } }} [o]
 */
function rig({ atWork = () => /** @type {string[]} */ ([]), kept = { meta: {} } } = {}) {
  const archive = {
    metaOf: (/** @type {string} */ id, /** @type {readonly string[]} */ keys) => (id === "c1" ? Object.fromEntries(keys.filter((k) => kept.meta[k] !== undefined).map((k) => [k, kept.meta[k]])) : null),
    mergeMeta: (/** @type {string} */ id, /** @type {Record<string, any>} */ patch) => (id === "c1" ? (kept.meta = structuredClone({ ...kept.meta, ...patch })) : null),
    openGraphs: () => [],
  };
  const registry = { slots: () => 4, tell: () => {}, stop: () => ({ ok: true }), resumable: () => null, launch: () => ({ ok: false, error: "no launches here" }), guard: () => {}, atWork };
  const runner = createGraphRunner({ archive, registry: /** @type {any} */ (registry), events: { publish: () => {} }, crew: () => "agent", log: () => {} });
  const AGENT = { crew: /** @type {const} */ ("agent") };
  /** @param {any} input */
  const apply = (input) => {
    const r = /** @type {any} */ (runner.apply("c1", input, AGENT));
    assert.ok(r.ok, JSON.stringify(r));
    return r;
  };
  return { runner, apply, kept, graph: () => kept.meta.graph };
}

const LEXER = { action: "add", goal: "Ship the lexer", tasks: [{ id: "t1", name: "Write the lexer", writes: ["src/lexer.js", "test/lexer.test.js"] }, { id: "t2", name: "Write the docs", writes: ["docs/**"] }, { id: "t3", name: "Look around" }] };

// (fails before: yes — the owner's of 11-10, drift: a change outside every open task's writes, while the agent's own
// task named its files, was said to nobody)
test("a file the planner changed outside every open task's writes, while its own task that named writes runs, is said once a task", () => {
  const folder = join(tmpdir(), "drift-folder");
  const r = rig();
  r.apply(LEXER);
  assert.equal(r.runner.outside("c1", "src/util.js", folder), null, "no task of its own runs");
  r.apply({ action: "start", ids: ["t3"] });
  assert.equal(r.runner.outside("c1", "src/util.js", folder), null, "its running task named no writes");
  r.apply({ action: "start", ids: ["t1"] });
  assert.equal(r.runner.outside("c1", join(folder, "src", "lexer.js"), folder), null, "within its writes");
  assert.equal(r.runner.outside("c1", "docs/lexer.md", folder), null, "an open task's writes name it: the work may have moved there");
  assert.equal(r.runner.outside("c1", join(folder, "..", "elsewhere.txt"), folder), null, "outside the folder");
  const said = r.runner.outside("c1", join(folder, "src", "util.js"), folder);
  assert.deepEqual(said, { path: "src/util.js", tasks: [{ id: "t1", name: "Write the lexer", writes: ["src/lexer.js", "test/lexer.test.js"] }] });
  assert.equal(r.runner.outside("c1", "src/more.js", folder), null, "once a task");
  assert.equal(
    outsideLine(/** @type {any} */ (said), "loop"),
    `(Filament: you changed src/util.js, which no open task's writes name, while you are on t1 "Write the lexer", whose writes are src/lexer.js, test/lexer.test.js. Where the work grew, name it in a task's writes or add a task for it (tasks change, tasks add); where it did not, go back to t1's own files.)`,
  );
  // A file a merge or an apply brought into its folder while it ran is no change of its own to judge.
  const g = r.graph();
  const brought = { ...g, tasks: g.tasks.map((/** @type {any} */ t) => (t.id === "t1" ? { ...t, brought: ["src/merged.js"] } : t)) };
  assert.deepEqual(outsideOwnWrites(brought, "src/merged.js"), []);
  assert.deepEqual(outsideOwnWrites(brought, "src/other.js").map((t) => t.id), ["t1"]);
});

// (fails before: yes — the same, for the loop)
test("the loop: a write outside every open task's writes carries the line on its result, once a task", async () => {
  const root = join(tmpdir(), "drift-loop");
  const r = rig();
  r.apply(LEXER);
  r.apply({ action: "start", ids: ["t1"] });
  const graph = { apply: () => ({ ok: false, error: "x" }), open: () => null, hasOpen: () => true, outside: (/** @type {string} */ f, /** @type {string} */ d) => r.runner.outside("c1", f, d) };
  const write = (/** @type {string} */ path) => [["write", { path, content: "x" }]];
  const { out, result } = await loopTurn({ calls: [write("src/lexer.js"), write("src/util.js"), write("src/more.js")], fails: () => false, graph, root });
  assert.ok(!result(2).includes("no open task's writes"), result(2));
  const line = outsideLine({ path: "src/util.js", tasks: [{ id: "t1", name: "Write the lexer", writes: ["src/lexer.js", "test/lexer.test.js"] }] }, "loop");
  assert.ok(result(3).endsWith(line), result(3));
  assert.ok(!result(4).includes("no open task's writes"), "once a task");
  assert.ok(out.notes.includes("agent: write changed src/util.js outside every open task's writes while on t1 — Filament said so on its result"), out.notes.join("\n"));
});

// (fails before: yes — the review of 11-11, d-writes: the runner kept which tasks were told by the chat and the task's id,
// for as long as Filament ran, so one told was told again once Filament started again)
test("a task told of a file outside the writes keeps that itself: a start of Filament tells it none again", () => {
  const folder = join(tmpdir(), "drift-folder");
  const r = rig();
  r.apply({ action: "add", goal: "Ship the lexer", tasks: [{ id: "t1", name: "Write the lexer", writes: ["src/lexer.js"] }] });
  r.apply({ action: "start", ids: ["t1"] });
  assert.deepEqual(r.runner.outside("c1", "src/util.js", folder)?.tasks.map((t) => t.id), ["t1"]);
  // Filament started again: a runner anew over what the chat keeps.
  assert.equal(rig({ kept: r.kept }).runner.outside("c1", "src/more.js", folder), null, "once a task, whichever runner");
  assert.equal(r.graph().tasks[0].outsideTold, true, "kept on the task");
  // A coding agent's line goes at its next step: unmarked until it went, then told by the tasks it named.
  const c = rig();
  c.apply({ action: "add", goal: "Ship the lexer", tasks: [{ id: "t1", name: "Write the lexer", writes: ["src/lexer.js"] }] });
  c.apply({ action: "start", ids: ["t1"] });
  assert.ok(c.runner.outside("c1", "src/util.js", folder, { mark: false }));
  assert.ok(c.runner.outside("c1", "src/util.js", folder, { mark: false }), "not told until its line went");
  c.runner.outsideSaid("c1", ["t1"]);
  assert.equal(c.runner.outside("c1", "src/util.js", folder, { mark: false }), null);
  assert.equal(rig({ kept: c.kept }).runner.outside("c1", "src/util.js", folder, { mark: false }), null, "nor once Filament started again");
});

// (fails before: yes — the review of 11-11, d-writes: told by the chat and the task's id, the chat's next graph's task
// that took the id of one told was never told)
test("a later graph's task that takes the id of one told of a file outside the writes is another task: it is told", () => {
  const folder = join(tmpdir(), "drift-folder");
  const r = rig();
  r.apply({ action: "add", goal: "Ship the lexer", tasks: [{ id: "t1", name: "Write the lexer", writes: ["src/lexer.js"] }] });
  r.apply({ action: "start", ids: ["t1"] });
  assert.deepEqual(r.runner.outside("c1", "src/util.js", folder)?.tasks.map((t) => t.id), ["t1"]);
  r.apply({ action: "done", id: "t1", summary: "Wrote it" });
  r.apply({ action: "close", reason: "The lexer is written." });
  r.apply({ action: "add", goal: "Ship the parser", tasks: [{ id: "t1", name: "Write the parser", writes: ["src/parser.js"] }] });
  r.apply({ action: "start", ids: ["t1"] });
  assert.deepEqual(r.runner.outside("c1", "src/util.js", folder), { path: "src/util.js", tasks: [{ id: "t1", name: "Write the parser", writes: ["src/parser.js"] }] });
});

// (fails before: yes — the owner's of 11-10, drift, d-idle: a turn that ended with a task of the planner's own running and
// nothing at work on it went unsaid; through the app, still-open-retold's test of both kinds)
test("a turn's end leaves the planner's running tasks idle only where nothing is at work: a sub-agent of its chat's, its commands", () => {
  const IDLE = "t1 was left running as your last turn ended, with nothing at work on it";
  let working = /** @type {string[]} */ ([]);
  const r = rig({ atWork: () => working });
  r.apply({ action: "add", goal: "Ship the lexer", tasks: [{ id: "t1", name: "Write the lexer" }] });
  r.apply({ action: "start", ids: ["t1"] });
  const where = () => String(r.runner.where("c1", "agent"));
  working = ["c1"];
  r.runner.turnEnded("c1");
  assert.ok(!where().includes(IDLE), "a sub-agent of its chat's at work");
  working = ["c2"];
  r.runner.turnEnded("c1", { commands: true });
  assert.ok(!where().includes(IDLE), "a command of its at work");
  // (fails before: yes — the review of the drift signals: come_back has the agent end its turn, and its task was idle)
  r.runner.turnEnded("c1", { comeBack: true });
  assert.ok(!where().includes(IDLE), "a come-back it set, which wakes it");
  r.runner.turnEnded("c1");
  assert.ok(where().includes(IDLE), "another chat's sub-agent is no work on its tasks");
  r.runner.turnEnded("c1", { commands: true });
  assert.ok(!where().includes(IDLE), "a later end with something at work clears the mark, unsaid");
  r.runner.turnEnded("c1");
  assert.ok(String(r.runner.begin("c1", "agent")).includes(IDLE), "the turn's start says it");
  assert.ok(!where().includes(IDLE), "once said, the mark goes");
  r.runner.turnEnded("c1");
  assert.ok(!where().includes(IDLE), "once a task");
});
