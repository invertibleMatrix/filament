// @ts-check
// HarnessV3-TaskGraph G2: a task of the graph done by a sub-agent, as the registry (app/agent/subagents.js) runs it. Its
// brief is its task, it is never a fork and takes no follow-up; its end — how the run went, its report, the commands it
// ran with their exits, its change — goes to the graph's runner, never to the main agent as a report; the runner
// tells the agent in the graph's words, counts the slots a session has left, and holds the turn while the graph works.
// G3: the runner goes on with a task's sub-agent in the conversation it has — the changes a review asked for, the
// change to read again — and a task's reviewer reads the change ahead of its brief.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as subagents from "../src/app/agent/subagents.js";
import { heldTime } from "./helpers/team.js";

const root = tmpdir();
/** @param {any[]} content @param {string | null} [id] */
const reply = (content, id = null) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id, upstream: "m", retryAfter: null, shouldRetry: null });
const REPORT = { status: "done", did: "Fixed it.", met: true, evidence: "npm test passes", left: "" };
/** A promise and the hand that settles it. */
const deferred = () => {
  /** @type {(v?: any) => void} */
  let resolve = () => {};
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

/**
 * A registry whose front door is a scripted host, served as turn.js serves one — attach, the run's events relayed,
 * finish before the reply, the conversation kept whole with the work `serve` gives and the host's reply in it — by
 * `serve`. Every exchange's end
 * the runner would hear lands in `ended`. `clock`: the registry's `now` and `later`, when the test holds time.
 * @param {(o: { id: string, body: any, relay: (e: any) => void, signal: AbortSignal | null }) => Promise<{ report?: string, status?: string, spentUsd?: number, error?: string | null, stoppedBy?: string | null, taskReport?: any, work?: any[] }>} serve
 * @param {Partial<import("../src/app/agent/subagents.js").SubagentContext>} [context]
 * @param {{ now?: () => number, later?: (fn: () => void, ms: number) => void }} [clock]
 */
function scripted(serve, context = {}, clock = {}) {
  /** @type {any[]} */
  const published = [];
  /** @type {any[]} */
  const ended = [];
  /** @type {any[]} */
  const posts = [];
  let n = 0;
  /** @type {ReturnType<typeof subagents.createSubagentRegistry>} */
  const registry = subagents.createSubagentRegistry({
    ...clock,
    // The main agent's model, m, runs two agents at once across Filament, as its row says (the owner's word of 11-05).
    config: () => ({ agentLoop: { subagents: { slots: [{ upstream: "u", model: "m", n: 2 }] } } }),
    log: () => {},
    events: { publish: (topic, e) => published.push({ topic, e }) },
    runs: null,
    context: {
      // The session's own view is a fork: a graph task's sub-agent gets none instead.
      settings: () => ({ subagents: { pool: [{ model: "" }], view: "fork" }, loop: { permissions: "edit" } }),
      session: () => ({ cwd: root, model: "m", projectId: "p1" }),
      view: async () => ({ text: "User: fix the parser", turns: 1 }),
      brief: async () => null,
      modelProblem: () => null,
      modelFacts: (/** @type {string} */ m) => ({ problem: context.modelProblem?.(m) || null, limit: null, at: { upstream: "u", model: m } }),
      mark: (_chainId, m) => ({ ...m, afterTurn: 1 }),
      exchangeEnded: (o) => ended.push(o),
      ...context,
    },
    call: async ({ body, headers = {}, signal = null }) => {
      posts.push({ body, headers });
      const id = headers["x-filament-subagent"];
      const runId = `run-${++n}`;
      registry.attach(id, runId);
      const r = await serve({ id, body, relay: (e) => registry.relay(id, e), signal });
      registry.finish(id, { status: r.status || "done", error: r.error ?? null, report: r.report ?? "", convo: [...body.messages, ...(r.work ?? []), { role: "assistant", content: [{ type: "text", text: r.report ?? "" }] }], rounds: 1, toolCalls: 0, tokensIn: 10, tokensOut: 5, spentUsd: r.spentUsd ?? 0, roundIds: [runId], stoppedBy: r.stoppedBy ?? null, taskReport: r.taskReport ?? null });
      return reply([{ type: "text", text: r.report ?? "" }], runId);
    },
  });
  return { registry, published, ended, posts };
}
/** A graph task's launch, as the runner makes it. @param {string} task @param {Record<string, any>} [more] @returns {any} */
const TASK = (task, more = {}) => ({ origin: "agent", chainId: "c1", prompt: `THE BRIEF OF ${task}`, description: `${task}: Fix the parser`, background: true, task: { id: task, review: false }, requestId: "turn-1", ...more });
/** @param {ReturnType<typeof subagents.createSubagentRegistry>} registry @param {Record<string, any>} [over] */
const openDoor = (registry, over = {}) => registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: root, mode: "edit", model: "m", thinking: null, fork: null, ...over });

// (fails before: yes — a launch had no task, and the registry told nobody of an exchange's end; and each command was
// kept from its call's input, which the loop never relays: blank in every live run; and, HarnessV3-Views V3, its live
// line went once per tool and round, without its progress whole; and, HarnessV3-FailurePoints §6 item 3 and §8 item 2,
// its end kept none of its tool calls, nor the files it wrote in the folder, where no git records them)
test("a graph task's sub-agent: its brief is its whole task, and its end — with the commands it ran — goes to the runner, never to the agent", async () => {
  const time = heldTime();
  const LEX = join(root, "src", "lex.js");
  const OUTSIDE = resolve(root, "..", "notes.md");
  const { registry, ended, published, posts } = scripted(async ({ relay }) => {
    // Relayed as the loop emits them: a call's input stays in the loop, and its args name it.
    relay({ type: "round-start", round: 1 });
    relay({ type: "tool-start", round: 1, name: "bash", args: "npm test", id: "c1" });
    relay({ type: "tool-end", round: 1, name: "bash", ok: false, id: "c1", exitCode: 1 });
    relay({ type: "tool-start", round: 1, name: "bash", args: "rm -rf /", id: "c2" });
    relay({ type: "tool-end", round: 1, name: "bash", ok: false, id: "c2", refused: true });
    relay({ type: "round-start", round: 2 });
    relay({ type: "tool-start", round: 2, name: "powershell", args: "Get-Item x", id: "c3" });
    relay({ type: "tool-end", round: 2, name: "powershell", ok: false, id: "c3" });
    relay({ type: "tool-start", round: 2, name: "write", args: "src/parse.js", id: "c4" });
    relay({ type: "tool-end", round: 2, name: "write", ok: true, id: "c4" });
    relay({ type: "tool-start", round: 2, name: "bash", args: "npm test", id: "c5" });
    relay({ type: "tool-end", round: 2, name: "bash", ok: true, id: "c5", exitCode: 0 });
    time.to(1500);
    for (const t of time.timers.splice(0)) t.fn();
    // Its conversation holds the calls themselves: these, and an edit by the folder's own path and a write outside it.
    /** @param {string} id @param {string} name @param {any} input */
    const use = (id, name, input) => ({ type: "tool_use", id, name, input });
    /** @param {string} id @param {boolean} [bad] */
    const result = (id, bad = false) => ({ type: "tool_result", tool_use_id: id, content: bad ? "it failed" : "ok", ...(bad ? { is_error: true } : {}) });
    const work = [
      { role: "assistant", content: [use("c1", "bash", { command: "npm test" }), use("c2", "bash", { command: "rm -rf /" })] },
      { role: "user", content: [result("c1", true), result("c2", true)] },
      { role: "assistant", content: [use("c3", "powershell", { command: "Get-Item x" }), use("c4", "write", { path: "src/parse.js", content: "x" }), use("c5", "bash", { command: "npm test" })] },
      { role: "user", content: [result("c3", true), result("c4"), result("c5")] },
      { role: "assistant", content: [use("c6", "edit", { path: LEX, old_string: "a", new_string: "b" }), use("c7", "write", { path: OUTSIDE, content: "x" }), use("c8", "write", { path: "src/nope.js", content: "x" })] },
      { role: "user", content: [result("c6"), result("c7"), result("c8", true)] },
    ];
    return { report: "Reported.", spentUsd: 0.5, taskReport: REPORT, work };
  }, {}, { now: time.now, later: time.later });
  const door = openDoor(registry);
  const r = registry.launch(TASK("t3"));
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.deepEqual([registry.get(r.id)?.task, registry.get(r.id)?.view, registry.get(r.id)?.background, registry.slots("c1")], ["t3", "none", true, 1]);
  const o = await r.done;
  assert.deepEqual([o.status, o.taskReport], ["done", REPORT]);
  assert.deepEqual(posts[0].body.messages, [{ role: "user", content: [{ type: "text", text: "THE BRIEF OF t3" }] }], "no view, no fork: the brief alone");
  assert.equal(ended.length, 1);
  const end = ended[0];
  assert.ok(end.task.ms >= 0);
  assert.deepEqual(
    { ...end, task: { ...end.task, ms: 0 } },
    {
      chainId: "c1",
      agentId: r.id,
      // No repository in this folder: it worked in the session's folder, and its write changed it. Its calls in their
      // card's words, a failed one marked; what it wrote there by the folder's own names — a file outside it as the call
      // named it, and a failed write's not at all. `writes`, the same files whole, and that it ran commands, for the
      // round of the turn that hears of it (fails before: yes — HarnessV4_Git_Plan GWC-13: they reached that round with
      // no name on them, so the turn's record could not tell its own files from its helper's).
      // How it ended, for the watchers (the plan of 11-11).
      ended: { exchange: 0, description: "t3: Fix the parser", ok: true, status: "done", report: "Reported.", helper: false },
      task: { id: "t3", review: false, exchange: 0, toolCalls: 0, roundIds: ["run-1"], launchedBy: "turn-1", unread: [], agent: r.id, status: "done", stoppedBy: null, error: null, report: REPORT, words: "Reported.", files: [], shared: true, wrote: true, workError: null, ran: [{ command: "npm test", exit: 1 }, { command: "Get-Item x", exit: null }, { command: "npm test", exit: 0 }], calls: ["Run npm test (failed)", "Run rm -rf / (failed)", "Run Get-Item x (failed)", "Write src/parse.js", "Run npm test", `Edit ${LEX}`, `Write ${OUTSIDE}`, "Write src/nope.js (failed)"], written: ["src/parse.js", "src/lex.js", OUTSIDE], writes: { by: r.id, paths: [join(root, "src", "parse.js"), LEX, OUTSIDE], command: true }, spentUsd: 0.5, ms: 0, cut: false, check: null, provider: null },
    },
  );
  assert.deepEqual([door.inbox.take(), registry.queued("c1"), registry.detail(r.id)?.exchanges[0].delivery, registry.slots("c1")], [[], 0, "task", 2], "nothing reached the agent: the runner tells it");
  // Its live line reaches the feed as its progress changes, its task named: the first change at once, the newest once
  // 500 ms have passed.
  const progress = published.filter((p) => p.e.type === "subagent-progress").map((p) => [p.topic, p.e.task, p.e.progress.round, p.e.progress.tool?.name ?? null]);
  assert.deepEqual(progress, [["subagents", "t3", 1, null], ["subagents", "t3", 2, "bash"]]);
  // Any other exchange's end is heard too — a slot frees — with no task; its progress names none.
  const plain = registry.launch({ origin: "agent", chainId: "c1", prompt: "look", background: true, worker: "reviewer", view: "none" });
  assert.ok(plain.ok);
  await plain.done;
  assert.deepEqual(ended[1], { chainId: "c1", agentId: plain.id, task: null, ended: { exchange: 0, description: "look", ok: true, status: "done", report: "Reported.", helper: false } });
  assert.deepEqual(published.filter((p) => p.e.type === "subagent-progress").slice(2).map((p) => [p.e.id, Object.hasOwn(p.e, "task")]), [[plain.id, false], [plain.id, false]]);
  door.close();
});

// (fails before: yes — a task launched as any sub-agent: a fork when asked, its follow-ups taken, its report sent on)
// A graph task is a fork only where its runner asks one of a turn that stands (the owner's words of 10-26): with no
// turn there is nothing to fork, and the session's own view of a fork leaves it its brief (`scripted`'s settings).
test("a graph task's sub-agent is a fork only of a turn that stands, and takes no follow-up; its report is the graph's, never sent on", async () => {
  const { registry } = scripted(async () => ({ report: "Reported.", taskReport: REPORT }));
  const fork = registry.launch(TASK("t3", { view: "fork" }));
  assert.match(fork.ok ? "" : fork.error, /^a fork copies the main agent's newest request, which Filament holds only while a turn runs/);
  assert.equal(registry.get(registry.launch(TASK("t4", { view: "folded" })).ok ? registry.list("c1")[0].id : "")?.view, "folded", "a view the runner names is kept");
  const r = registry.launch(TASK("t3"));
  assert.ok(r.ok);
  await r.done;
  const words = `sub-agent ${r.id} does task t3 of the task graph, and its report ends it — to have it change its work, failed or ready, send it back: tasks start with its id and a note, and it goes on where it stopped`;
  assert.deepEqual(registry.followUp(r.id, { prompt: "check again", chainId: "c1" }), { ok: false, error: words });
  const door = openDoor(registry);
  await assert.rejects(door.subagents.run({ id: "toolu_1", input: { run_in_background: false, agent_id: r.id, prompt: "check again", description: "Check" }, emit: () => {}, signal: null }), { message: words });
  assert.deepEqual(registry.send(r.id, "c1"), { ok: false, error: `that report of ${r.id} ended task t3 of the task graph, and the agent heard it as it ended` });
  door.close();
});

// (fails before: yes — no runner could tell a turn, count its slots, or hold it while the graph worked)
test("the runner's hands: slots under the model's limit, tell into the running turn or the next, kept across a restart; owes holds the turn", async () => {
  /** @type {any[]} */
  const saved = [];
  const gate = deferred();
  const { registry } = scripted(async () => (await gate.promise, { report: "Reported.", taskReport: REPORT }), { saveQueue: (_chainId, list) => saved.push(list) });
  assert.equal(registry.slots("c1"), 2);
  const a = registry.launch(TASK("t1"));
  const b = registry.launch(TASK("t2"));
  assert.ok(a.ok && b.ok);
  assert.equal(registry.slots("c1"), 0);
  assert.equal(registry.slots("c2"), 0, "a model's limit holds across every chat");
  const told = { text: "[Filament: task t1 is done]", from: a.id, description: "t1: Fix the parser", task: "t1", exchange: 0, spends: [{ launchedBy: "turn-1", spentUsd: 0.5, toolCalls: 3, roundIds: ["r1"] }], wrote: true };
  registry.tell("c1", told);
  assert.deepEqual(registry.peekQueued("c1"), [{ ...told, kind: "task" }], "no turn runs: it waits for the next");
  assert.deepEqual(saved.at(-1), [{ text: told.text, from: a.id, description: told.description, kind: "task", task: "t1", exchange: 0, wrote: true }]);
  const door = openDoor(registry);
  const arrived = door.inbox.arrival();
  assert.deepEqual(door.inbox.take(), [{ text: told.text, from: a.id, description: told.description, task: "t1", exchange: 0, wrote: true, kind: "task", spentUsd: 0.5, toolCalls: 3, roundIds: ["r1"] }], "the next turn opens with it: the turn that launched the task, whose spend it is");
  registry.tell("c1", { ...told, task: "t2", from: b.id });
  await arrived;
  const taken = door.inbox.take();
  assert.deepEqual(taken.map((d) => [d.kind, d.task]), [["task", "t2"]], "into the running turn, waking it");
  // (fails before: yes — HarnessV4_Tasks B12: a message a turn took and never gave its model had no way back: a
  // coding agent's turn that ended first lost it) Handed back, the turn's close leaves it to the session's next turn,
  // its spend counted once.
  door.inbox.back(taken);
  door.close();
  const next = openDoor(registry, { runId: "turn-2" });
  assert.deepEqual(next.inbox.take().map((d) => [d.kind, d.task, d.text, d.spentUsd, d.toolCalls]), [["task", "t2", told.text, 0, 0]], "the next turn hears it, and counts nothing twice");
  next.close();
  // A restart keeps a task's end like a report, and drops a launch notice.
  const later = scripted(async () => ({ report: "" }), { loadQueue: () => [{ ...told, kind: "task" }, { text: "launched", from: "sa_00000000", description: "x", kind: "notice", exchange: 0 }] });
  assert.deepEqual(later.registry.peekQueued("c1"), [{ text: told.text, from: a.id, description: told.description, kind: "task", task: "t1", exchange: 0, spends: [], wrote: true }]);
  // The turn may not end while the graph owes it: its own sub-agents and the graph's work, both.
  const graph = deferred();
  const owing = openDoor(registry, { owes: () => graph.promise });
  const owed = owing.inbox.owed();
  assert.ok(owed, "the graph's work holds the turn");
  let settled = false;
  owed?.then(() => (settled = true));
  gate.resolve();
  await Promise.all([a.ok && a.done, b.ok && b.done]);
  await new Promise((r) => setImmediate(r));
  assert.equal(settled, false, "the sub-agents are done, the graph is not");
  graph.resolve();
  await owed;
  owing.close();
  assert.equal(openDoor(registry, { owes: () => null }).inbox.owed(), null, "a graph that owes nothing holds nothing");
});

// (fails before: yes — a graph task's sub-agent has no parent tool call, so memory tied its brief and its report to no turn)
test("memory's lineage: a graph task's brief and report belong to the turn that launched it; the developer's own launch to none", async () => {
  /** @type {any[]} */
  const lineage = [];
  // Only a task's host has the report tool, so only its finish carries one.
  const { registry } = scripted(async ({ body }) => ({ report: "Reported.", taskReport: JSON.stringify(body.messages).includes("THE BRIEF") ? REPORT : null }), {
    brief: async ({ launchedBy }) => (lineage.push(["brief", launchedBy]), null),
    reported: ({ launchedBy, report }) => lineage.push(["reported", launchedBy, report]),
  });
  const r = registry.launch(TASK("t3"));
  assert.ok(r.ok);
  await r.done;
  assert.deepEqual(lineage, [["brief", "turn-1"], ["reported", "turn-1", "Fixed it."]], "its report is what it found: the report's did");
  lineage.length = 0;
  const own = registry.launch({ origin: "owner", chainId: "c1", prompt: "look", view: "none", requestId: "cmd-1" });
  assert.ok(own.ok);
  await own.done;
  assert.deepEqual(lineage, [["brief", null], ["reported", null, "Reported."]], "the developer's command is no turn of the agent's");
});

// (fails before: yes — a graph task's run was any sub-agent's: a restart's notice told the agent, and a cut one reported)
test("a restart: a graph task's cut end is the runner's — its run left open is no orphan of the registry's — and a stop says whose it was", async () => {
  const { registry, ended } = scripted(
    ({ signal }) =>
      new Promise((resolve) => {
        signal?.addEventListener("abort", () => resolve({ status: "aborted", error: "the client disconnected", report: "" }), { once: true });
      }),
  );
  const door = openDoor(registry);
  const r = registry.launch(TASK("t3"));
  assert.ok(r.ok);
  await new Promise((res) => setImmediate(res));
  const host = /** @type {any} */ (registry.hostOf(r.id));
  assert.deepEqual([host.task, host.brief.graphTask, host.brief.deliver], [{ id: "t3", review: false }, "t3", false]);
  assert.equal(registry.shutdown(), 1);
  await r.done;
  assert.deepEqual([ended[0].task.status, ended[0].task.cut, ended[0].task.error], ["aborted", true, "Filament restarted before it finished"]);
  // (fails before: no — a guard the mutation pass asked for: a stopping Filament's turn takes nothing from its inbox, so
  // what the registry delivered there shows as the door closes and hands it on to the next turn)
  door.close();
  assert.equal(registry.queued("c1"), 0, "the runner tells it, not the registry");
  assert.equal(registry.orphaned({ runId: "run-9", chainId: "c1", brief: { agentId: "sa_0badc0de", graphTask: "t3", task: "THE BRIEF", by: "agent", deliver: false } }), false);
  assert.equal(registry.queued("c1"), 0);
  // The developer's stop of its row: its end says it was theirs, even when the stop cut the request itself.
  const next = openDoor(registry);
  const s = registry.launch(TASK("t4"));
  assert.ok(s.ok);
  await new Promise((res) => setImmediate(res));
  assert.deepEqual(registry.stop(s.id), { ok: true });
  await s.done;
  assert.deepEqual([ended[1].task.status, ended[1].task.stoppedBy, ended[1].task.cut], ["aborted", "harness", false]);
  next.close();
});

// (fails before: yes — HarnessV3-TaskGraph G3-3: a graph task's sub-agent ended with its first report: the changes a
// review asked for had no way back to the worker that made them, nor its change to the reviewer that read it)
test("the runner goes on with a graph task's sub-agent in the conversation it has — never one that works, one of no task, another session's, or past the ceiling — and its end is the runner's, for the turn it ran in", async () => {
  /** @type {ReturnType<typeof deferred> | null} */
  let gate = null;
  const { registry, ended, posts } = scripted(async () => {
    await gate?.promise;
    return { report: "Reported.", spentUsd: 0.25, taskReport: REPORT };
  });
  const r = registry.launch(TASK("t2"));
  assert.ok(r.ok);
  await r.done;
  const ASKED = { chainId: "c1", prompt: "THE CHANGES ASKED", requestId: "turn-2" };
  assert.deepEqual(registry.resumeTask("sa_0badc0de", ASKED), { ok: false, error: subagents.noSuchSubagent("sa_0badc0de") });
  assert.deepEqual(registry.resumeTask(r.id, { ...ASKED, chainId: "c2" }), { ok: false, error: subagents.noSuchSubagent(r.id) }, "another session's");
  const plain = registry.launch({ origin: "agent", chainId: "c1", prompt: "look", background: true, worker: "reviewer", view: "none" });
  assert.ok(plain.ok);
  await plain.done;
  assert.deepEqual(registry.resumeTask(plain.id, ASKED), { ok: false, error: `sub-agent ${plain.id} does no task of the task graph` });
  gate = deferred();
  const a = registry.launch(TASK("t3"));
  const b = registry.launch(TASK("t4"));
  assert.ok(a.ok && b.ok);
  assert.deepEqual(registry.resumeTask(a.id, ASKED), { ok: false, error: `sub-agent ${a.id} is still working` });
  assert.deepEqual(registry.resumeTask(r.id, ASKED), { ok: false, error: "The limit is 2 at once, and 2 are running. Wait for one to report." });
  gate.resolve();
  await Promise.all([a.done, b.done]);
  gate = null;
  // It goes on: the conversation it has, the changes asked its newest words; a slot is its while it works.
  const sent = posts.length;
  const again = registry.resumeTask(r.id, ASKED);
  assert.ok(again.ok);
  assert.deepEqual([again.id, registry.get(r.id)?.status, registry.slots("c1")], [r.id, "running", 1]);
  assert.equal((await again.done).status, "done");
  assert.deepEqual(posts[sent].body.messages, [
    { role: "user", content: [{ type: "text", text: "THE BRIEF OF t2" }] },
    { role: "assistant", content: [{ type: "text", text: "Reported." }] },
    { role: "user", content: [{ type: "text", text: "THE CHANGES ASKED" }] },
  ]);
  assert.equal(posts[sent].headers["x-filament-subagent"], r.id);
  const end = ended.at(-1);
  assert.deepEqual([end.agentId, end.task.id, end.task.review, end.task.exchange, end.task.launchedBy, end.task.report, end.task.spentUsd], [r.id, "t2", false, 1, "turn-2", REPORT, 0.25]);
  assert.deepEqual(registry.detail(r.id)?.exchanges.map((x) => [x.prompt, x.by, x.delivery]), [["THE BRIEF OF t2", "agent", "task"], ["THE CHANGES ASKED", "agent", "task"]]);
  assert.deepEqual([registry.peekQueued("c1").map((d) => d.from), registry.slots("c1")], [[plain.id], 2], "the agent's own sub-agent's report waits for it; the runner tells the task's end");
});

// (fails before: yes — HarnessV3-FailurePoints §6 item 4: nothing said whether a failed task's sub-agent could go on
// with it, sent back; E15 step 8, AG-243: it was refused where a new worker would run on another model)
test("whether a graph task's sub-agent can go on with its task, sent back: one Filament holds, at rest, whose own model can still run an agent — else why not", async () => {
  /** @type {ReturnType<typeof deferred> | null} */
  let gate = null;
  /** @type {Record<string, any>} */
  let sub = {};
  /** @type {string | null} */
  let gone = null;
  const { registry } = scripted(
    async () => {
      await gate?.promise;
      return { report: "Reported.", taskReport: REPORT };
    },
    { settings: () => ({ subagents: { pool: [{ model: "" }], view: "fork", ...sub }, loop: { permissions: "edit" } }), modelProblem: (/** @type {string} */ m) => (m === gone ? "no route matches it" : null) },
  );
  const r = registry.launch(TASK("t2"));
  assert.ok(r.ok);
  await r.done;
  assert.equal(registry.resumable(r.id, "c1"), null, "the session's model, the one it ran on");
  // The session's pool names another model now: a new worker would run there, and this one goes on on its own.
  sub = { pool: [{ model: "agent/haiku" }] };
  assert.equal(registry.resumable(r.id, "c1"), null, "its own model, whatever a new worker would be given");
  // Its own model cannot run an agent any more.
  gone = "m";
  assert.equal(registry.resumable(r.id, "c1"), "it ran on m, which cannot run an agent now (no route matches it)");
  gone = null;
  sub = {};
  // Filament holds no such sub-agent of this session: a restart's registry, or another session's.
  const RESTARTED = "Filament restarted since it ran, and its conversation went with it";
  const restarted = scripted(async () => ({ report: "" })).registry;
  assert.deepEqual([registry.resumable(r.id, "c2"), registry.resumable("sa_0badc0de", "c1"), restarted.resumable(r.id, "c1")], [RESTARTED, RESTARTED, RESTARTED]);
  // One of no task, and one still at work.
  const plain = registry.launch({ origin: "agent", chainId: "c1", prompt: "look", background: true, worker: "reviewer", view: "none" });
  assert.ok(plain.ok);
  await plain.done;
  assert.equal(registry.resumable(plain.id, "c1"), "it does no task of the task graph");
  gate = deferred();
  const busy = registry.launch(TASK("t3"));
  assert.ok(busy.ok);
  assert.equal(registry.resumable(busy.id, "c1"), "it is still working");
  gate.resolve();
  await busy.done;
  assert.equal(registry.resumable(busy.id, "c1"), null);
});

// (fails before: yes — the same: a change reached a team's reviewer alone, and nothing told a review's row, live line
// or end from its task's own)
test("a graph task's reviewer reads the change ahead of its brief, as background — the block it reads again on the next round, its cut the same — and its row, its live line and its end say it reviews", async () => {
  const MET = { status: "done", did: "Read the change.", met: true, evidence: "npm test passes", left: "" };
  const { registry, ended, published, posts } = scripted(async ({ relay }) => {
    relay({ type: "round-start", round: 1 });
    return { report: "Read it.", taskReport: MET };
  });
  const change = { of: "sa_0badc0de", files: 1, diff: "THE DIFF\n\n" };
  const r = registry.launch(TASK("t2", { worker: "reviewer", description: "t2: review of Fix the parser", task: { id: "t2", review: true }, review: change }));
  assert.ok(r.ok);
  assert.deepEqual([registry.get(r.id)?.task, registry.get(r.id)?.review, registry.get(r.id)?.card.tag], ["t2", true, "reviewer"]);
  await r.done;
  const opening = `<change of="sa_0badc0de" files="1">\nThe change sa_0badc0de made in its own git worktree, not applied yet: the folder you work in holds these files as they were before it. Background only — your task follows.\n\nTHE DIFF\n</change>`;
  assert.deepEqual(posts[0].body.messages, [{ role: "user", content: [{ type: "text", text: opening }, { type: "text", text: "THE BRIEF OF t2" }] }]);
  assert.equal(subagents.changeBlock(change, `${subagents.changeNote("sa_0badc0de")} Background only — your task follows.`), opening, "the next round's block has the same maker");
  assert.deepEqual(published.filter((p) => p.e.type === "subagent-progress").map((p) => [p.e.task, p.e.review]), [["t2", true]]);
  assert.deepEqual([ended[0].task.id, ended[0].task.review, ended[0].task.report], ["t2", true, MET]);
  // A change past what a view carries is cut to its head, on every round alike.
  const long = { of: "sa_0badc0de", files: 3, diff: "x".repeat(200_001) };
  assert.equal(subagents.changeBlock(long, "THE NOTE"), `<change of="sa_0badc0de" files="3">\nTHE NOTE\n\n${"x".repeat(200_000)}\n…[Filament: the rest of the diff is left out]\n</change>`);
  const s = registry.launch(TASK("t5", { worker: "reviewer", task: { id: "t5", review: true }, review: long }));
  assert.ok(s.ok);
  await s.done;
  assert.equal(posts.at(-1).body.messages[0].content[0].text, subagents.changeBlock(long, `${subagents.changeNote("sa_0badc0de")} Background only — your task follows.`));
});

// (fails before: yes — the prune kept only a running sub-agent: a builder that waited, ended, for its review's changes
// was let go once 100 newer ones had ended, and the fix round could not reach it)
test("a sub-agent its session's task graph will still ask for outlives the registry's prune: the oldest the graph does not hold goes in its place", async () => {
  /** @type {Set<string>} */
  const held = new Set();
  let unreadable = false;
  const { registry, ended } = scripted(async () => ({ report: "Reported.", taskReport: REPORT }), {
    holds: (_chainId) => {
      if (unreadable) throw new Error("the archive is closed");
      return (/** @type {string} */ id) => held.has(id);
    },
  });
  /** @type {string[]} */
  const ids = [];
  for (let i = 1; i <= 101; i++) {
    const r = registry.launch(TASK(`t${i}`));
    assert.ok(r.ok, JSON.stringify(r));
    ids.push(r.id);
    if (i === 1) held.add(r.id);
    await r.done;
  }
  assert.deepEqual([registry.get(ids[0])?.status, registry.get(ids[1]), registry.get(ids[2])?.status], ["done", null, "done"], "101 ended: the builder stays, the next oldest goes");
  const fix = registry.resumeTask(ids[0], { chainId: "c1", prompt: "THE CHANGES ASKED", requestId: "turn-2" });
  assert.ok(fix.ok, JSON.stringify(fix));
  assert.equal((await fix.done).status, "done");
  // A graph that cannot be read keeps every sub-agent it may hold, and the end still reaches the runner.
  unreadable = true;
  const last = registry.launch(TASK("t102"));
  assert.ok(last.ok);
  await last.done;
  assert.deepEqual([ended.at(-1).task.id, registry.get(ids[0])?.status, registry.get(ids[2])?.status], ["t102", "done", "done"]);
});

// (fails before: yes — the owner's word of 10-26: a graph task's sub-agent took the first free model of the chat's list,
// a cheaper one than the planner's, so the work the planner laid out side by side was done by another model)
test("a graph task under the session's agent runs on the planner's own model, whatever the chat's list names; its room is that model's", async () => {
  let mainDown = false;
  const { registry } = scripted(async () => ({ report: "Reported.", taskReport: REPORT }), {
    settings: () => ({ subagents: { pool: [{ model: "agent/flash" }] }, loop: { permissions: "edit" } }),
    modelProblem: (/** @type {string} */ m) => (mainDown && /planner$/.test(m) ? "its provider is down" : null),
  });
  const r = registry.launch(TASK("t1", { parentModel: "agent/planner" }));
  assert.ok(r.ok, JSON.stringify(r));
  await r.done;
  assert.equal(registry.get(r.id)?.model, "planner", "the planner's model, not the list's");
  // Its review too: the reader of a change is the planner's model.
  const review = registry.launch(TASK("t1", { worker: "reviewer", parentModel: "agent/planner", task: { id: "t1", review: true }, review: { of: r.id, files: 1, diff: "+x", inFolder: false } }));
  assert.ok(review.ok, JSON.stringify(review));
  await review.done;
  assert.equal(registry.get(review.id)?.model, "planner");
  // Any other agent of the chat still takes the list's first.
  const other = registry.launch({ origin: "owner", chainId: "c1", prompt: "Look around", description: "a look", background: true, parentModel: "agent/planner" });
  assert.ok(other.ok, JSON.stringify(other));
  await other.done;
  assert.equal(registry.get(other.id)?.model, "flash");
  // The runner's room for the graph is the planner's model's: none while it cannot run, though the list's can.
  mainDown = true;
  assert.equal(registry.slots("c1", "workers", "agent/planner"), 0);
  assert.ok(registry.slots("c1", "workers") > 0, "the list's own room is untouched");
});

// (fails before: yes — the owner's words of 10-26: a graph task's sub-agent was never a fork, so its work began on a fresh
// conversation from its brief, and none of it read the planner's prefix from the provider's cache)
test("a graph task the runner starts as a fork runs on the planner's conversation, tools and model, told it is the graph's and to report; a team's worker never is one", async () => {
  /** @type {any[]} */
  const hosts = [];
  const { registry } = scripted(async ({ id }) => {
    hosts.push(registry.hostOf(id));
    return { report: "Reported.", taskReport: REPORT };
  });
  const MAIN = {
    model: "agent/planner",
    system: [{ type: "text", text: "THE PLANNER'S SYSTEM" }],
    tools: [{ name: "read", input_schema: { type: "object" } }, { name: "tasks", input_schema: { type: "object" } }, { name: "report", input_schema: { type: "object" } }],
    max_tokens: 4000,
    messages: [{ role: "user", content: [{ type: "text", text: "fix the parser" }] }, { role: "assistant", content: [{ type: "tool_use", id: "toolu_plan", name: "tasks", input: { action: "add" } }] }],
  };
  const door = openDoor(registry, { model: "agent/planner", fork: () => ({ body: structuredClone(MAIN), headers: {} }) });
  const r = registry.launch(TASK("t1", { parentModel: "agent/planner", view: "fork" }));
  assert.ok(r.ok, JSON.stringify(r));
  await r.done;
  const host = hosts[0];
  assert.equal(registry.get(r.id)?.model, MAIN.model, "the model of the planner's request, whose cache it reads");
  assert.deepEqual([host.fork?.system, host.fork?.tools.map((/** @type {any} */ t) => t.name)], [MAIN.system, ["read", "tasks", "report"]], "the planner's furniture as it was sent");
  assert.deepEqual(host.fork.messages[0], MAIN.messages[0], "its conversation first, byte for byte");
  const told = JSON.stringify(host.fork.messages.at(-1));
  assert.match(told, /which planned its work as a task graph and gave you one of its tasks/);
  assert.match(told, /end it with the report tool/);
  assert.match(told, /THE BRIEF OF t1/);
  assert.equal(host.task?.id, "t1", "its host knows it does a task: it is asked for its report");
  // A team's worker starts from its brief, a fork asked or not.
  const worker = registry.launch(TASK("t2", { view: "fork", team: { key: "architect", name: "Architect", role: "builder", line: "", members: [] } }));
  assert.match(worker.ok ? "" : worker.error, /^a worker cannot be a fork: it starts from its brief/);
  door.close();
});

// (fails before: yes — the owner's words of 10-26: nothing weighed whether a task's fork pays; every task started from
// its brief)
test("a task starts as the main agent's fork only while its request is cached, the cache's lifetime not past, and that request at most half the line", () => {
  const snap = { cached: true, tokens: 40_000, sentAt: 1_000, ttlMs: 300_000 };
  const pays = subagents.forkPays;
  assert.equal(pays(snap, 170_000, 2_000), true, "warm, and room for its own work");
  assert.equal(pays(snap, 80_000, 2_000), true, "half the line, to the token");
  assert.equal(pays(snap, 79_999, 2_000), false, "past half the line: a fork would start near its own");
  assert.equal(pays(snap, 0, 2_000), false, "a line of 0: nothing fits under it");
  assert.equal(pays(snap, 170_000, 301_000), false, "the cache's lifetime past: a fork would pay the whole conversation");
  assert.equal(pays({ ...snap, cached: false }, 170_000, 2_000), false, "read and wrote nothing from the cache");
  assert.equal(pays({ ...snap, cached: null, tokens: 0 }, 170_000, 2_000), false, "no reply measured yet");
  assert.equal(pays(null, 170_000, 2_000), false, "no request kept");
});

// (fails before: yes — the bug hunt of 11-02: with no window known a graph task's fork was weighed against a line of 0
// and a fork launched by name against none; there was no one line for both)
test("a fork's line is the side line of its window, of the window assumed where none is known", () => {
  const line = subagents.forkLineOf;
  assert.equal(line(1_000_000), 400_000, "a 1M window: the side line's most");
  assert.equal(line(200_000), 170_000, "85% of a smaller one");
  assert.equal(line(0), 108_800, "no window known: 85% of the assumed 128,000");
  assert.equal(line(null), 108_800);
  const snap = { cached: true, tokens: 54_000, reply: 400, sentAt: 1_000, ttlMs: 300_000 };
  assert.equal(subagents.forkPays(snap, line(0), 2_000), true, "54,400 with its reply: half the assumed line, to the token");
  assert.equal(subagents.forkPays({ ...snap, reply: 401 }, line(0), 2_000), false, "past half the assumed line");
});

// (fails before: yes — the bug hunt of 10-26: the reply a fork copies, its thinking among it, was not weighed; and a
// task waiting as a turn opens had nothing to weigh, the last turn's request kept or not)
test("a fork weighs the reply it copies too; a turn that has sent nothing forks the last turn's request, kept, only on its own model and with report", () => {
  const pays = subagents.forkPays;
  const snap = { cached: true, tokens: 40_000, sentAt: 1_000, ttlMs: 300_000 };
  assert.equal(pays({ ...snap, reply: 40_000 }, 160_000, 2_000), true, "80,000 with its reply: half the line");
  assert.equal(pays({ ...snap, reply: 40_001 }, 160_000, 2_000), false, "its thinking past half the line");
  const { registry } = scripted(async () => ({ report: "Reported.", taskReport: REPORT }));
  /** A last turn on `model`, its tools `tools`, kept as it closed. @param {string} model @param {string[]} tools */
  const kept = (model, tools) => {
    const body = { model, system: [], tools: tools.map((name) => ({ name, input_schema: { type: "object" } })), messages: [{ role: "user", content: "fix it" }] };
    openDoor(registry, { model, cache: () => ({ body, headers: {}, sentAt: Date.now(), ttlMs: 300_000, cached: true, tokens: 9_000, reply: 100 }) }).close();
  };
  kept("planner", ["read", "tasks", "report"]);
  assert.equal(registry.keptFork("c1", "planner")?.tokens, 9_000, "kept, on its own model, with report");
  assert.equal(registry.keptFork("c1", "other"), null, "another model's: the task runs on the planner's");
  kept("planner", ["read"]);
  assert.equal(registry.keptFork("c1", "planner"), null, "from before the graph was on: no report to end the task with");
  assert.equal(registry.keptFork("c2", "planner"), null, "another chat's");
});
