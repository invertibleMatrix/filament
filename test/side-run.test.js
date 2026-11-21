// @ts-check
// The developer's side run (the Designer's of 10-27, on the owner's "i leave everything to you. go ahead"): the Plan
// page's "Run them side by side…" starts the planner's own ready tasks on sub-agents itself — all or none — each on the
// model the developer chose, in its own copy or their folder. The graph claims them, so the planner is told once and a
// start, a change or a drop of one is refused in the claim's words; a launch asked for at the turn's end waits for it;
// a change in its copy waits there for its apply, holding no turn; a restart before a launch gives the task back. A
// coding agent's own launch names its task, and the task's box says who works on it.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as tg from "../src/core/task-graph.js";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";

const T0 = Date.UTC(2026, 9, 28, 14, 2);
/** @type {import("../src/core/task-graph.js").Crew} */
const AGENT = "agent";
/** @param {any} r @returns {any} */
const ok = (r) => (assert.ok(r.ok, JSON.stringify(r)), r);
/** The agent's suggestion of its ready tasks nowgap and cbshow (the owner's of 11-10): the Plan offers them then alone. @param {any} g */
const suggested = (g) => ok(tg.applyTasks(g, { action: "parallel", ids: ["nowgap", "cbshow"] }, { at: T0, crew: AGENT, turn: 1 })).graph;
/** A graph of the planner's own: nowgap and cbshow ready and apart, later needs nowgap. */
const graph = () =>
  ok(
    tg.applyTasks(
      null,
      {
        action: "add",
        goal: "Close the gaps",
        tasks: [
          { id: "nowgap", name: "Close the gap in Now", writes: ["src/ui/harness/lib/now.js"], acceptance: "Now shows it", check: ["npm test"], steps: ["Close it"] },
          { id: "cbshow", name: "Show the card", writes: ["src/ui/harness/card.js"], steps: ["Show it"] },
          { id: "later", name: "Then the docs", needs: ["nowgap"], writes: ["docs/x.md"] },
        ],
      },
      { at: T0, crew: AGENT },
    ),
  ).graph;
/** @type {import("../src/core/task-graph.js").SidePick} */
const PICK = { id: "nowgap", model: "Opus 5.5", folder: "copy" };
/** @param {any} g @param {string} id @returns {any} */
const task = (g, id) => g.tasks.find((/** @type {any} */ t) => t.id === id);

// (fails before: yes — there was no side run: the Plan page's button sent the agent a sentence, and the graph never
// learned which sub-agent took which task)
test("a side run claims the planner's own ready tasks: a start, a change and a drop of them are refused in the claim's words", () => {
  const r = ok(tg.sideRun(graph(), [PICK, { id: "cbshow", model: "GLM 5.3", folder: "yours" }], { at: T0, crew: AGENT, starts: "now" }));
  const t = task(r.graph, "nowgap");
  assert.deepEqual([t.by, t.state, t.goal, t.side.model, t.side.folder, t.side.pending], ["sub-agent", "waiting", "Close the gap in Now", "Opus 5.5", "copy", true], "its name is the goal where it had none");
  assert.deepEqual(task(r.graph, "cbshow").side.was, { goal: "", steps: ["Show it"], acceptance: "" }, "the brief as its planner left it");
  assert.deepEqual(tg.jobs(r.graph), [], "the runner leaves a claim's launch to the side run");
  assert.deepEqual(tg.sideBySide(r.graph), [], "nothing more to offer side by side");
  const words = "the developer started nowgap on a sub-agent; leave it — its report comes to you";
  for (const call of [{ action: "start", ids: ["nowgap"] }, { action: "change", tasks: [{ id: "nowgap", by: "you" }] }, { action: "drop", ids: ["nowgap"], reason: "mine" }]) {
    const no = tg.applyTasks(r.graph, call, { at: T0, crew: AGENT });
    assert.equal(no.ok, false);
    assert.match(/** @type {any} */ (no).error, new RegExp(words), call.action);
  }
  assert.equal(tg.sideNote(["nowgap", "cbshow"], false), "[Filament: the developer started nowgap and cbshow on sub-agents; leave them — their reports come to you]");
  assert.equal(tg.sideNote(["nowgap"], true), "[Filament: the developer gave nowgap to sub-agents, which start when your turn ends; leave it — its report comes to you]");
});

test("all or none: a task not ready, one the planner runs, one with no model, or a lead's graph — nothing is claimed", () => {
  const g = graph();
  const notReady = tg.sideRun(g, [PICK, { ...PICK, id: "later" }], { at: T0, crew: AGENT, starts: "now" });
  assert.deepEqual(notReady, { ok: false, error: "later can't start yet: it needs nowgap (waiting) done first" });
  const mine = ok(tg.applyTasks(g, { action: "start", ids: ["nowgap"] }, { at: T0, crew: AGENT })).graph;
  assert.deepEqual(tg.sideRun(mine, [PICK], { at: T0, crew: AGENT, starts: "now" }), { ok: false, error: "nowgap is running — only a task that waits to start goes to a sub-agent" }, "the planner started it first: the claim loses the race in words");
  assert.equal(tg.sideRun(g, [{ ...PICK, model: "" }], { at: T0, crew: AGENT, starts: "now" }).ok, false);
  assert.deepEqual(tg.sideRun(g, [PICK], { at: T0, crew: /** @type {any} */ ([{ tag: "builder" }]), starts: "now" }), { ok: false, error: "a team's lead plans this graph: its workers take its tasks" });
});

test("a ready change waits in its copy for its apply, holding no turn; the developer's apply makes the task done", () => {
  let g = ok(tg.sideRun(graph(), [PICK], { at: T0, crew: AGENT, starts: "now" })).graph;
  g = /** @type {any} */ (tg.launched(g, "nowgap", "sa_1", T0 + 1, "sub-agent"));
  assert.equal(task(g, "nowgap").side.pending, false);
  const files = [{ path: "src/ui/harness/lib/now.js", added: 4, removed: 1 }];
  const end = /** @type {any} */ ({ agent: "sa_1", status: "done", stoppedBy: null, error: null, report: { status: "done", did: "Closed it.", met: true, evidence: "npm test", left: "" }, words: "", files, shared: false, wrote: true, workError: null, ran: [], calls: [], written: [], spentUsd: 0, ms: 1, cut: false, check: { ran: true, commands: ["npm test"], runs: [{ command: "npm test", exit: 0, ms: 9, output: "", stopped: false }], bounces: 0, stopped: false } });
  const ended = /** @type {any} */ (tg.taskEnded(g, "nowgap", end, T0 + 2));
  assert.equal(ended.state, "yours");
  g = ended.graph;
  assert.deepEqual([task(g, "nowgap").state, task(g, "nowgap").step, tg.mergeNext(g), tg.busy(g)], ["merging", "yours", null, false], "nothing merges it, and no turn waits on it");
  assert.match(tg.endText(g, "nowgap", { crew: AGENT }), /task nowgap "Close the gap in Now" is ready: .* Its change waits in sa_1's own copy, not in your folder yet: apply it when you choose — agent with agent_id "sa_1" and apply_changes: true\. .* later needs it, and waits for its apply\. To have its sub-agent change it first, send it back with a note: tasks start with its id and note\. The developer may apply it themselves instead\./);
  assert.ok(tg.applyTasks(g, { action: "drop", ids: ["nowgap", "later"], reason: "not needed" }, { at: T0, crew: AGENT }).ok, "a waiting change may be dropped: it stays in its copy");
  const applied = /** @type {any} */ (tg.sideApplied(g, "sa_1", files, T0 + 3));
  assert.deepEqual([task(applied, "nowgap").state, task(applied, "nowgap").step, task(applied, "nowgap").merged], ["done", null, { files: 1, added: 4, removed: 1 }]);
  assert.equal(tg.sideApplied(applied, "sa_1", files, T0 + 4), null, "once");
});

test("a restart before a side run's launch gives the task back to its planner, its brief as it left it", () => {
  const g = ok(tg.sideRun(graph(), [{ ...PICK, goal: "Mine", steps: ["Do it"] }], { at: T0, crew: AGENT, starts: "turn" })).graph;
  assert.deepEqual(tg.sidePending(g), ["nowgap"]);
  const cut = /** @type {any} */ (tg.restartCut(g, T0 + 5));
  assert.deepEqual([cut.ids, cut.back], [[], ["nowgap"]]);
  const t = task(cut.graph, "nowgap");
  assert.deepEqual([t.by, t.goal, t.steps, t.acceptance, "side" in t], ["you", "", ["Close it"], "Now shows it", false]);
  assert.equal(tg.sideBackNote(["nowgap"]), "[Filament: a Filament restart came before the developer's side run of nowgap started, so it is yours again, as you left it]");
});

test("a coding agent's launch names its task: the task stays its own, and its box says who works on it", () => {
  const g = graph();
  assert.equal(tg.helperRefusal(g, "nope"), "nope is no task in your graph: name one of its open tasks, or leave task out");
  const took = /** @type {any} */ (tg.helperTook(g, "nowgap", { agent: "sa_9", model: "GLM 5.3", copy: true, at: T0 }));
  assert.deepEqual([task(took, "nowgap").by, task(took, "nowgap").state, task(took, "nowgap").helper], ["you", "running", { agent: "sa_9", model: "GLM 5.3", copy: true, at: T0 }]);
  const done = ok(tg.applyTasks(took, { action: "done", ids: ["nowgap"], summary: "in" }, { at: T0, crew: AGENT, solo: true })).graph;
  assert.equal(tg.helperRefusal(done, "nowgap"), "nowgap is being checked — task names one that is still to do", "its check runs: no launch is for it now");
});

// (fails before: yes — the review of 67038d835, its finding 5: a launch could name a task whose needs were not done; it
// kept the helper and waited still, so once its needs were done the graph said it could run side by side, a card took
// it, the Plan page's side run gave it a second sub-agent — and "Next of yours" never named it, its helper ended or not)
test("a helper is for a task that can start; a task with a helper at work is no one else's, and yours again once that helper ended", () => {
  const g = graph();
  const HELPER = { agent: "sa_9", model: "GLM 5.3", copy: true, at: T0 };
  assert.equal(tg.helperRefusal(g, "later"), "later can't start yet: it needs nowgap (waiting) done first — task names one that can start now, or leave task out");
  assert.equal(tg.helperTook(g, "later", HELPER), null, "nothing kept on it");
  // A ready task that carries a helper — a graph kept before this, or one stopped as its helper ran.
  const helped = structuredClone(g);
  task(helped, "cbshow").helper = HELPER;
  /** @type {(agent: string) => boolean} */
  const atWork = (agent) => agent === "sa_9";
  const ended = () => false;
  assert.deepEqual([tg.sideBySide(helped, new Set(), {}, atWork), tg.sideBySide(helped, new Set(), {}, ended)], [[], ["nowgap", "cbshow"]]);
  const card = tg.suggestSide(helped, ["nowgap", "cbshow"], { at: T0, turn: 1, helping: atWork });
  assert.deepEqual(card, { ok: false, error: "cbshow has the sub-agent sa_9 at work on it, launched for it: a card would start a second one on it — suggest it once that one has ended, or leave it out" });
  assert.ok(tg.suggestSide(helped, ["nowgap", "cbshow"], { at: T0, turn: 1, helping: ended }).ok, "its helper ended: it may go on a card");
  const run = tg.sideRun(helped, [{ ...PICK, id: "cbshow" }], { at: T0, crew: AGENT, starts: "now", helping: atWork });
  assert.deepEqual(run, { ok: false, error: "cbshow has the sub-agent sa_9 at work on it, which the agent launched for it — only a task nobody works on goes to a sub-agent here" });
  assert.ok(tg.sideRun(helped, [{ ...PICK, id: "cbshow" }], { at: T0, crew: AGENT, starts: "now", helping: ended }).ok);
  // What comes next of the agent's own: not one a helper works on now, and the first ready one once that helper ended.
  // Tasks that name no writes, so no set to run side by side is said beside it.
  const plain = ok(tg.applyTasks(null, { action: "add", goal: "g", tasks: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }] }, { at: T0, crew: AGENT })).graph;
  task(plain, "b").helper = HELPER;
  const started = ok(tg.applyTasks(plain, { action: "start", ids: ["a"] }, { at: T0, crew: AGENT })).graph;
  /** @param {(agent: string) => boolean} helping */
  const next = (helping) => /Next of yours: (\w+) /.exec(ok(tg.applyTasks(started, { action: "done", id: "a", summary: "in" }, { at: T0, crew: AGENT, helping })).text)?.[1];
  assert.deepEqual([next(atWork), next(ended)], ["c", "b"]);
  // The runner asks its registry whether that helper runs still — this one cannot say, so every helper named does.
  const r = rig();
  r.put(helped);
  assert.deepEqual(r.runner.sideRun("c1", [{ ...PICK, id: "cbshow" }], { starts: "now" }), run);
  assert.match(/** @type {any} */ (r.runner.apply("c1", { action: "parallel", ids: ["nowgap", "cbshow"] }, { crew: AGENT })).error, /^cbshow has the sub-agent sa_9 at work on it, launched for it: /);
});

/**
 * A session in memory and a registry that records what the side run asks of it. `resumable`: the registry's word on
 * whether a task's last worker can go on with it.
 * `refuse`: the registry's refusal of a launch, by its task, or null; `room`, the chat's room as the sheet reads it — a
 * test may change it; the runner reads none.
 * @param {{ max?: number, running?: number, turn?: boolean, resumable?: (agent: string) => string | null, refuse?: (task: string) => string | null }} [o]
 */
function rig({ max = 4, running = 0, turn = false, resumable = () => null, refuse = () => null } = {}) {
  const room = { max, running };
  /** @type {Map<string, any>} */
  const chains = new Map([["c1", { id: "c1", meta: { graph: graph() } }]]);
  /** @type {any[]} */
  const launches = [];
  /** @type {any[]} */
  const notices = [];
  /** @type {any[]} */
  const told = [];
  /** @type {(() => void)[]} */
  const after = [];
  let n = 0;
  const registry = {
    /** @param {any} spec */
    launch: (spec) => {
      const no = refuse(spec.task?.id);
      if (no) return { ok: false, error: no };
      launches.push(spec);
      return { ok: true, id: `sa_${++n}`, done: new Promise(() => {}), tree: Promise.resolve(true) };
    },
    room: () => ({ max: room.max, running: room.running, cwd: "/p", worktree: true }),
    turnOpen: () => turn,
    /** @param {string} chainId @param {() => void} go */
    afterTurn: (chainId, go) => void after.push(go),
    /** @param {string} chainId @param {any} d */
    notice: (chainId, d) => void notices.push(d.text),
    /** @param {string} chainId @param {any} d */
    tell: (chainId, d) => void told.push(d.text),
    slots: () => 4,
    stop: () => ({ ok: true }),
    guard: () => {},
    /** @param {string} agent */
    resumable: (agent) => resumable(agent),
  };
  const archive = {
    /** The meta's named keys, as the archive's `metaOf` reads them. @param {string} id @param {readonly string[]} keys */
    metaOf: (id, keys) => {
      const c = chains.get(id);
      return c ? Object.fromEntries(keys.filter((k) => c.meta?.[k] !== undefined).map((k) => [k, c.meta[k]])) : null;
    },
    /** @param {string} id @param {any} patch */
    mergeMeta: (id, patch) => {
      const c = chains.get(id);
      c.meta = structuredClone({ ...c.meta, ...patch });
      return c.meta;
    },
    openGraphs: () => [],
  };
  let t = T0;
  const runner = createGraphRunner({ archive, registry: /** @type {any} */ (registry), events: { publish: () => {} }, crew: () => AGENT, log: () => {}, now: () => t++ });
  return { runner, launches, notices, told, after, room, g: () => chains.get("c1").meta.graph, /** @param {any} g */ put: (g) => void (chains.get("c1").meta.graph = g) };
}

// (fails before: yes — the Hunter's of 10-28: two launches of a coding agent's could name one task — the second while
// the first's copy was being made, or while it worked — and both ran, the box keeping the second)
test("one helper a task: a coding agent's second launch for a task its first works on, or is launching for, is refused in words", async () => {
  const { tmpdir } = await import("node:os");
  const { createSubagentRegistry } = await import("../src/app/agent/subagents.js");
  const { createAgentCardStore } = await import("../src/services/agent-cards.js");
  const cards = createAgentCardStore({ dataDir: null });
  /** @type {Map<string, () => void>} */
  const gates = new Map();
  /** @type {string[][]} */
  const took = [];
  /** @type {any} */
  let reg = null;
  reg = createSubagentRegistry({
    now: () => T0,
    config: () => ({ agentLoop: { subagents: { slots: [{ upstream: "u", model: "glm", n: 4 }] } } }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    context: /** @type {any} */ ({
      card: (/** @type {string} */ tag) => cards.find(tag),
      settings: () => ({ subagents: { pool: [{ model: "glm" }], most: 10, view: "none", ask: [] }, loop: { permissions: "edit" } }),
      session: () => ({ cwd: tmpdir(), model: "m-main", projectId: "p1" }),
      view: async () => ({ text: "", turns: 1 }),
      brief: async () => null,
      modelProblem: () => null,
      modelFacts: (/** @type {string} */ name) => ({ problem: null, limit: null, at: { upstream: "u", model: name } }),
      agentOf: () => null,
      mark: (/** @type {any} */ _c, /** @type {any} */ m) => ({ ...m, afterTurn: 1 }),
      taskHelper: { refusal: () => null, took: (/** @type {string} */ _c, /** @type {string} */ id, /** @type {any} */ h) => void took.push([id, h.agent]) },
    }),
    call: async ({ body, headers = {} }) => {
      const id = /** @type {any} */ (headers)["x-filament-subagent"];
      reg.attach(id, `run-${id}`);
      await new Promise((res) => gates.set(id, () => res(undefined)));
      reg.finish(id, { status: "done", error: null, report: "Done.", convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: "Done." }] }], rounds: 1, toolCalls: 0, tokensIn: 1, tokensOut: 1, spentUsd: 0, roundIds: [`run-${id}`] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: "Done." }], usage: { input_tokens: 1, output_tokens: 1 } }, id: `run-${id}`, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  const d = reg.openTurn({ chainId: "c1", runId: "turn-1", cwd: tmpdir(), mode: "edit", model: "m-main", thinking: null, fork: null });
  const call = (/** @type {string} */ id, /** @type {any} */ input) => d.subagents.run({ id, input: { description: "Do it", prompt: "do the task", run_in_background: true, ...input }, emit: () => {}, signal: null, coder: true });
  const [first, second] = await Promise.allSettled([call("tu-1", { task: "nowgap" }), call("tu-2", { task: "nowgap" })]);
  assert.equal(first.status, "fulfilled", String(/** @type {any} */ (first).reason));
  assert.equal(second.status, "rejected", "launched at the same time: one takes it");
  assert.match(String(/** @type {any} */ (second).reason?.message), /^another launch is taking nowgap now — wait for it, or leave task out$|works on nowgap already/);
  const holder = reg.list("c1").find((/** @type {any} */ s) => s.status === "running")?.id;
  assert.ok(holder, "the first runs");
  await assert.rejects(call("tu-3", { task: "nowgap" }), { message: `${holder} works on nowgap already — follow up with it (agent_id ${holder}), or leave task out` });
  assert.ok(await call("tu-4", { task: "cbshow" }), "another task is another helper's");
  // Its helper done, the task may have another.
  for (let i = 0; i < 500 && !gates.has(holder); i++) await new Promise((res) => setTimeout(res, 10));
  /** @type {() => void} */ (gates.get(holder))();
  for (let i = 0; i < 500 && reg.get(holder)?.status === "running"; i++) await new Promise((res) => setTimeout(res, 10));
  assert.ok(await call("tu-5", { task: "nowgap" }), "a new helper once the first ended");
});

// (fails before: yes — the Hunter's of 10-28: Start now while a turn ran held that turn until every side run was done,
// though the planner was told to leave them and that their reports come to it)
test("a side run started now holds no turn of the planner's: its reports come when they come", () => {
  const r = rig();
  ok(r.runner.sideRun("c1", [PICK], { starts: "now" }));
  assert.equal(task(r.g(), "nowgap").state, "running");
  assert.equal(r.runner.owes("c1"), null, "the turn owes the developer's side run nothing");
  assert.equal(tg.busy(r.g()), true, "its sub-agent is at work all the same");
  assert.equal(tg.busy(r.g(), { side: false }), false);
});

// (fails before: yes — apply-seen, flakes3 of 11-11: the planner applied a side run's change, its merge and the folder's
// check ran ~15 min, and the planner's wait said nothing was running — the turn owed a merge it asked for nothing)
test("a side run's change the planner applies is the planner's: its turn owes the merge, as a merge of its own", () => {
  const r = rig();
  ok(r.runner.sideRun("c1", [PICK], { starts: "now" }));
  const files = [{ path: "src/ui/harness/lib/now.js", added: 4, removed: 1 }];
  const end = /** @type {any} */ ({ agent: "sa_1", status: "done", stoppedBy: null, error: null, report: { status: "done", did: "Closed it.", met: true, evidence: "e", left: "" }, words: "", files, shared: false, wrote: true, workError: null, ran: [], calls: [], written: [], spentUsd: 0, ms: 1, cut: false });
  const waits = /** @type {any} */ (tg.taskEnded(r.g(), "nowgap", end, T0 + 2)).graph;
  assert.deepEqual([task(waits, "nowgap").step, tg.busy(waits, { side: false })], ["yours", false], "waiting for its apply, it holds no turn");
  const asked = /** @type {any} */ (tg.applyAsked(waits, "sa_1")).graph;
  assert.deepEqual([task(asked, "nowgap").state, task(asked, "nowgap").step], ["merging", null]);
  assert.equal(tg.busy(asked, { side: false }), true, "its merge is the planner's");
  r.put(asked);
  assert.ok(r.runner.owes("c1"), "the turn that asked it waits on its verdict");
});

// (fails before: yes — the Hunter's of 10-28: a launch refused failed its task while the others ran, and the sheet said
// all had started)
test("a side run's refused launch gives its task back, the rest go; refused all, nothing is claimed and the planner hears nothing", async () => {
  const { sideStartedWords } = await import("../src/ui/harness/views/side-run-sheet.js");
  const some = rig({ refuse: (id) => (id === "cbshow" ? "no model of this session's pool can run an agent now" : null) });
  const out = ok(some.runner.sideRun("c1", [PICK, { id: "cbshow", model: "GLM 5.3", folder: "yours" }], { starts: "now" }));
  assert.deepEqual([out.started, out.refused], [["nowgap"], [{ id: "cbshow", why: "no model of this session's pool can run an agent now" }]]);
  const back = task(some.g(), "cbshow");
  assert.deepEqual([back.by, back.state, "side" in back, back.goal], ["you", "waiting", false, ""], "the planner's again, as it left it — not failed");
  assert.deepEqual(some.notices, ["[Filament: the developer started nowgap on sub-agents; leave it — its report comes to you]"], "told of the one that started");
  const none = rig({ refuse: () => "the chat's ceiling is reached" });
  assert.deepEqual(none.runner.sideRun("c1", [PICK], { starts: "now" }), { ok: false, error: "nowgap could not start: the chat's ceiling is reached" });
  assert.deepEqual([task(none.g(), "nowgap").by, "side" in task(none.g(), "nowgap"), none.notices], ["you", false, []]);
  // (fails before: yes — the owner's word of 11-05: the chat's room was read again at the turn's end, and none started
  // where not all fit) At the turn's end each launches, whatever the chat runs: a model's limit refuses one in its words.
  const mid = rig({ turn: true, max: 3, running: 1 });
  ok(mid.runner.sideRun("c1", [PICK, { id: "cbshow", model: "m", folder: "copy" }], { starts: "turn" }));
  mid.room.running = 3;
  for (const go of mid.after.splice(0)) go();
  assert.deepEqual([mid.launches.map((l) => l.task.id), task(mid.g(), "nowgap").by, task(mid.g(), "cbshow").by], [["nowgap", "cbshow"], "sub-agent", "sub-agent"]);
  assert.equal(sideStartedWords(["nowgap"], false, out.refused), "Started nowgap on sub-agents. cbshow did not start (no model of this session's pool can run an agent now) — it is your agent's again.");
});

// (fails before: yes — the review of 4f02eeb86: a side run's picker had no effort, and its launch none to run at)
test("a side run's task keeps the effort picked for it, and its launch runs at it; none, the main agent's; one no level is refused", () => {
  const r = rig();
  ok(r.runner.sideRun("c1", [{ ...PICK, effort: "high" }, { id: "cbshow", model: "GLM 5.3", folder: "yours" }], { starts: "now" }));
  assert.deepEqual(r.launches.map((l) => [l.task.id, l.effort]), [["nowgap", "high"], ["cbshow", undefined]]);
  assert.deepEqual([task(r.g(), "nowgap").side.effort, "effort" in task(r.g(), "cbshow").side], ["high", false]);
  const no = tg.sideRun(graph(), [{ ...PICK, effort: "turbo" }], { at: T0, crew: AGENT, starts: "now" });
  assert.equal(/** @type {any} */ (no).error, "nowgap: how hard it thinks is one of model, low, medium, high, xhigh, max");
});

test("the runner launches a side run at once — no turn of the planner's needed — each on its model, where it works, bound to its task", () => {
  const r = rig();
  const out = ok(r.runner.sideRun("c1", [PICK, { id: "cbshow", model: "GLM 5.3", folder: "yours" }], { starts: "now" }));
  assert.deepEqual([out.started, out.later], [["nowgap", "cbshow"], false]);
  assert.deepEqual(
    r.launches.map((l) => [l.task.id, l.model, l.parentModel, l.worktree, l.worker, l.origin, l.background, l.grants?.check]),
    [
      ["nowgap", "Opus 5.5", "Opus 5.5", true, "builder", "agent", true, ["npm test"]],
      ["cbshow", "GLM 5.3", "GLM 5.3", false, "builder", "agent", true, undefined],
    ],
  );
  assert.deepEqual(r.notices, ["[Filament: the developer started nowgap and cbshow on sub-agents; leave them — their reports come to you]"]);
  assert.deepEqual([task(r.g(), "nowgap").state, task(r.g(), "nowgap").agent, task(r.g(), "cbshow").agent], ["running", "sa_1", "sa_2"]);
  // Ready, waiting for its apply: done once an apply brings it in, the planner told.
  r.runner.ended({ chainId: "c1", task: /** @type {any} */ ({ id: "cbshow", review: false, exchange: 0, toolCalls: 1, roundIds: [], launchedBy: null, agent: "sa_2", status: "done", stoppedBy: null, error: null, report: { status: "done", did: "Shown.", met: true, evidence: "looked", left: "" }, words: "", files: [{ path: "src/ui/harness/card.js", added: 2, removed: 0 }], shared: false, wrote: true, workError: null, ran: [], calls: [], written: [], spentUsd: 0, ms: 1, cut: false }) });
  assert.equal(task(r.g(), "cbshow").step, "yours");
  assert.match(r.told.at(-1), /is ready: .*Its change waits in sa_2's own copy, not in your folder yet/);
  r.runner.applied({ chainId: "c1", agentId: "sa_2", files: [{ path: "src/ui/harness/card.js", added: 2, removed: 0 }] });
  assert.equal(task(r.g(), "cbshow").state, "done");
  assert.match(r.told.at(-1), /task cbshow "Show the card" is done/);
});

// (fails before: yes — the owner's word of 11-05: a side run was all or none by the chat's number)
test("no number of the chat's own: a side run starts whatever the chat runs; asked for at the turn's end, the launches wait for it", () => {
  const busy = rig({ max: 3, running: 3 });
  assert.deepEqual(ok(busy.runner.sideRun("c1", [PICK, { id: "cbshow", model: "m", folder: "copy" }], { starts: "now" })).started, ["nowgap", "cbshow"]);
  assert.deepEqual(busy.launches.map((l) => l.task.id), ["nowgap", "cbshow"]);
  const mid = rig({ turn: true });
  const out = ok(mid.runner.sideRun("c1", [PICK], { starts: "turn" }));
  assert.deepEqual([out.started, out.later, mid.launches.length, task(mid.g(), "nowgap").side.pending], [[], true, 0, true]);
  assert.deepEqual(mid.notices, ["[Filament: the developer gave nowgap to sub-agents, which start when your turn ends; leave it — its report comes to you]"]);
  const refused = mid.runner.apply("c1", { action: "start", ids: ["nowgap"] }, { crew: AGENT });
  assert.match(/** @type {any} */ (refused).error, /the developer gave nowgap to a sub-agent, which starts when your turn ends; leave it/);
  for (const go of mid.after.splice(0)) go();
  assert.deepEqual([mid.launches.map((l) => l.task.id), task(mid.g(), "nowgap").state], [["nowgap"], "running"]);
});

// ---- the page: the sheet, the offer, the boxes ----------------------------------------------------------------------

test("the sheet's words: the brief from the task or thin, what happens when done, the room, and the run's body", async () => {
  const { briefOf, whenDoneWords, roomWords, sideBody } = await import("../src/ui/harness/views/side-run-sheet.js");
  assert.deepEqual(briefOf({ goal: "Close it", steps: ["a", "b", "c"], acceptance: "Now shows it", writes: ["x.js"] }), { thin: false, words: "From the task: goal, 3 steps, done-when and its files" });
  assert.deepEqual(briefOf({ writes: ["x.js"] }), { thin: true, words: "Thin: only its name and files" });
  assert.equal(whenDoneWords({ writes: ["x.js"], check: ["npm test"] }, { folder: "copy" }), "Waits in its copy for its apply, your agent's or yours — its check first (npm test)");
  assert.equal(whenDoneWords({ writes: ["x.js"] }, { folder: "copy" }), "Waits in its copy for its apply, your agent's or yours");
  assert.equal(whenDoneWords({ writes: ["x.js"] }, { folder: "yours" }), "Its changes land in your folder as it makes them");
  assert.equal(whenDoneWords({ writes: [] }, { folder: "copy" }), "It reads only: its report goes to your agent");
  assert.deepEqual(roomWords({ max: 3, running: 1 }, 2), { fits: true, words: "3 at once here · 1 runs · both fit" });
  assert.deepEqual(roomWords({ max: 3, running: 2 }, 2), { fits: false, words: "3 at once here · 2 run · only 1 fits — untick 1" });
  // (fails before: yes — the look of 11-05: with no number of the chat's own every sheet said "0 run")
  assert.deepEqual([roomWords({ max: null, running: 0 }, 2), roomWords({ max: null, running: 2 }, 1)], [{ fits: true, words: "None at work · both start now" }, { fits: true, words: "2 at work · it starts now" }]);
  const t = { id: "nowgap", name: "Close", writes: ["x.js"], check: ["npm test"] };
  assert.deepEqual(sideBody([{ t, on: true, model: "Opus 5.5", effort: "low", folder: "copy", brief: null, editing: false }], { starts: "now" }).tasks, [{ id: "nowgap", model: "Opus 5.5", effort: "low", folder: "copy" }], "a row's effort goes with it");
  assert.deepEqual(sideBody([{ t, on: true, model: "Opus 5.5", folder: "copy", brief: { goal: "G", steps: "one\n\n two ", acceptance: "A" }, editing: false }, { t: { ...t, id: "off" }, on: false, model: "m", folder: "copy", brief: null, editing: false }], { starts: "turn" }), {
    starts: "turn",
    tasks: [{ id: "nowgap", model: "Opus 5.5", folder: "copy", goal: "G", steps: ["one", "two"], acceptance: "A" }],
  });
});

// (fails before: yes — the owner's of 11-06: mid-turn the sheet chose "when your agent's turn ends" for them, and a turn
// that ran for hours left the tasks unstarted; a side run starts now, always)
test("the sheet reads the room, starts the tasks now even mid-turn, and Run posts the ticked rows — a refusal said in the sheet", async () => {
  const { fakeH, textOf, buttonsOf } = await import("./helpers/fake-dom.js");
  const { modelSelects } = await import("./helpers/team-view.js");
  const { openSideRunSheet } = await import("../src/ui/harness/views/side-run-sheet.js");
  const pickers = modelSelects();
  /** @type {any[]} */
  const calls = [];
  let refuse = "";
  /** @type {any} */
  let shown = null;
  let closed = false;
  /** @type {any[]} */
  const went = [];
  const api = async (/** @type {string} */ path, /** @type {any} */ init) => {
    calls.push([init?.method || "GET", path, init?.body]);
    if (!init) return { max: 4, running: 1, turn: true, repo: true, worktree: true };
    if (refuse) throw new Error(refuse);
    return { ok: true, started: ["nowgap", "cbshow"], later: false, refused: [] };
  };
  const tasks = [{ id: "nowgap", name: "Close the gap in Now", writes: ["src/ui/harness/lib/now.js"], check: ["npm test"], goal: "", steps: [], acceptance: "" }, { id: "cbshow", name: "Show the card", writes: ["src/ui/harness/card.js"], check: [] }];
  openSideRunSheet(
    { chainId: "c1", ids: ["nowgap", "cbshow"], tasks, model: "Opus 5.5", models: () => [], started: (o) => void went.push(o) },
    { h: fakeH, dialog: /** @type {any} */ ((o) => ((shown = o), { close: () => (closed = true) })), menu: /** @type {any} */ (() => {}), api, modelSelect: /** @type {any} */ (pickers.make) },
  );
  await new Promise((r) => setImmediate(r));
  assert.equal(shown.title, "Run 2 tasks in parallel");
  const text = textOf(shown.body);
  for (const words of ["Each task goes to a sub-agent of its own. Your agent is told to leave them to them.", "nowgap", "writes now.js", "Thin: only its name and files", "Waits in its copy for its apply, your agent's or yours — its check first (npm test)", "Waits in its copy for its apply, your agent's or yours", "4 at once here · 1 runs · both fit", "Your agent is still working: each copy is your folder as it stands, its edits so far included."])
    assert.ok(text.includes(words), words);
  assert.ok(!text.includes("turn ends"), "no wait for the turn's end to choose");
  assert.deepEqual(pickers.made.map((p) => p.name), ["Opus 5.5"], "one picker for every task, on the chat agent's model");
  assert.ok(!text.includes("Wait for my Apply"), "every change in a copy waits for its apply: there is no choice to make");
  const run = buttonsOf(shown.body).find((b) => textOf(b) === "Run 2 tasks");
  refuse = "nowgap is running — only a task that waits to start goes to a sub-agent";
  run.dispatch("click");
  await new Promise((r) => setImmediate(r));
  assert.match(textOf(shown.body), /Nothing started: nowgap is running — only a task that waits to start goes to a sub-agent/);
  assert.equal(closed, false);
  refuse = "";
  buttonsOf(shown.body).find((b) => textOf(b) === "Run 2 tasks").dispatch("click");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls.at(-1), ["POST", "/sessions/c1/graph/side-run", { starts: "now", tasks: [{ id: "nowgap", model: "Opus 5.5", folder: "copy" }, { id: "cbshow", model: "Opus 5.5", folder: "copy" }] }]);
  assert.deepEqual([closed, went], [true, [{ ids: ["nowgap", "cbshow"], later: false, refused: [] }]]);
});

// (fails before: yes — the review of side-now: mid-turn the sheet said only what a copy is made of, also where every
// task worked in your folder, writing beside the agent)
test("mid-turn, a task in your folder is said to write beside your agent; a copy, what it is made of", async () => {
  const { fakeH, textOf } = await import("./helpers/fake-dom.js");
  const { modelSelects } = await import("./helpers/team-view.js");
  const { openSideRunSheet, YOURS_MID_WORDS } = await import("../src/ui/harness/views/side-run-sheet.js");
  const COPY_WORDS = "Your agent is still working: each copy is your folder as it stands, its edits so far included.";
  const tasks = [{ id: "nowgap", name: "Close the gap in Now", writes: ["src/ui/harness/lib/now.js"], check: [] }, { id: "look", name: "Look", writes: [], check: [] }];
  const sheet = async (/** @type {any} */ facts, list = tasks) => {
    /** @type {any} */
    let shown = null;
    openSideRunSheet(
      { chainId: "c1", ids: list.map((t) => t.id), tasks: list, model: "Opus 5.5", models: () => [], started: () => {} },
      { h: fakeH, dialog: /** @type {any} */ ((o) => ((shown = o), { close: () => {} })), menu: /** @type {any} */ (() => {}), api: async () => ({ max: 4, running: 0, ...facts }), modelSelect: /** @type {any} */ (modelSelects().make) },
    );
    await new Promise((r) => setImmediate(r));
    return textOf(shown.body);
  };
  const yours = await sheet({ turn: true, repo: true, worktree: false });
  assert.ok(yours.includes(`${YOURS_MID_WORDS} Its own copy keeps them apart.`), yours);
  assert.ok(!yours.includes(COPY_WORDS), "no copy to speak of");
  const plain = await sheet({ turn: true, repo: false, worktree: true });
  assert.ok(plain.includes(YOURS_MID_WORDS) && !plain.includes("Its own copy keeps them apart."), "outside git no copy is offered");
  const copy = await sheet({ turn: true, repo: true, worktree: true });
  assert.ok(copy.includes(COPY_WORDS) && !copy.includes(YOURS_MID_WORDS), copy);
  const between = await sheet({ turn: false, repo: true, worktree: false });
  assert.ok(!between.includes(YOURS_MID_WORDS) && !between.includes(COPY_WORDS), "between turns: nothing to say");
  for (const worktree of [true, false]) {
    const reads = await sheet({ turn: true, repo: true, worktree }, [tasks[1]]);
    assert.ok(!reads.includes(YOURS_MID_WORDS) && !reads.includes(COPY_WORDS), "a task that only reads writes beside no one");
  }
});

// (fails before: yes — the review of 4f02eeb86, the owner's word of 11-05 "include reasoning effort across every model
// picker": the sheet's Runs on had a model and no effort)
test("the sheet's Runs on says how hard every task thinks, beside its model; a pick goes with each ticked row", async () => {
  const { fakeH, textOf, buttonsOf } = await import("./helpers/fake-dom.js");
  const { modelSelects } = await import("./helpers/team-view.js");
  const { openSideRunSheet } = await import("../src/ui/harness/views/side-run-sheet.js");
  const pickers = modelSelects();
  /** @type {any[]} */
  const calls = [];
  /** @type {any[]} */
  let items = [];
  /** @type {any} */
  let shown = null;
  const api = async (/** @type {string} */ path, /** @type {any} */ init) => {
    calls.push([init?.method || "GET", path, init?.body]);
    return init ? { ok: true, started: ["nowgap"], later: false, refused: [] } : { max: null, running: 0, turn: false, repo: true, worktree: true };
  };
  const tasks = [{ id: "nowgap", name: "Close the gap in Now", writes: ["src/ui/harness/lib/now.js"], check: [], goal: "", steps: [], acceptance: "" }];
  openSideRunSheet(
    { chainId: "c1", ids: ["nowgap"], tasks, model: "Opus 5.5", models: () => [], started: () => {} },
    { h: fakeH, dialog: /** @type {any} */ ((o) => ((shown = o), { close: () => {} })), menu: /** @type {any} */ ((/** @type {any[]} */ x) => { items = x; }), api, modelSelect: /** @type {any} */ (pickers.make) },
  );
  await new Promise((r) => setImmediate(r));
  const chip = buttonsOf(shown.body).find((b) => b.attrs?.["aria-label"] === "How hard every task thinks");
  assert.ok(chip, "an effort chip beside every task's model");
  assert.equal(chip.querySelector(".ec-words").textContent, "Your agent's");
  chip.dispatch("click");
  items.find((x) => x.label === "High").onClick();
  buttonsOf(shown.body).find((b) => textOf(b) === "Run 1 task")?.dispatch("click");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls.at(-1)?.[2]?.tasks, [{ id: "nowgap", model: "Opus 5.5", effort: "high", folder: "copy" }]);
});

// (fails before: yes — the review of a8e034ded: a row's default was your agent's effort, so a row set back to it read as
// every task's and ran at your agent's)
test("a row's own effort goes back to every task's, as its model does: its chip says so, and its task runs at every task's", async () => {
  const { fakeH, textOf, buttonsOf } = await import("./helpers/fake-dom.js");
  const { modelSelects } = await import("./helpers/team-view.js");
  const { openSideRunSheet } = await import("../src/ui/harness/views/side-run-sheet.js");
  const pickers = modelSelects();
  /** @type {any[]} */
  const calls = [];
  /** @type {any[]} */
  let items = [];
  /** @type {any} */
  let shown = null;
  const api = async (/** @type {string} */ path, /** @type {any} */ init) => {
    calls.push([init?.method || "GET", path, init?.body]);
    return init ? { ok: true, started: ["nowgap", "cbshow"], later: false, refused: [] } : { max: null, running: 0, turn: false, repo: true, worktree: true };
  };
  const tasks = [
    { id: "nowgap", name: "Close the gap in Now", writes: ["src/ui/harness/lib/now.js"], check: [], goal: "", steps: [], acceptance: "" },
    { id: "cbshow", name: "Show the callback", writes: ["src/ui/harness/lib/cb.js"], check: [], goal: "", steps: [], acceptance: "" },
  ];
  openSideRunSheet(
    { chainId: "c1", ids: ["nowgap", "cbshow"], tasks, model: "Opus 5.5", models: () => [], started: () => {} },
    { h: fakeH, dialog: /** @type {any} */ ((o) => ((shown = o), { close: () => {} })), menu: /** @type {any} */ ((/** @type {any[]} */ x) => { items = x; }), api, modelSelect: /** @type {any} */ (pickers.make) },
  );
  await new Promise((r) => setImmediate(r));
  const chip = (/** @type {string} */ label) => buttonsOf(shown.body).find((b) => b.attrs?.["aria-label"] === label);
  chip("How hard every task thinks").dispatch("click");
  items.find((x) => x.label === "High").onClick();
  buttonsOf(shown.body).find((b) => b.attrs?.["aria-label"] === "Change nowgap")?.dispatch("click");
  assert.equal(chip("How hard nowgap thinks").querySelector(".ec-words").textContent, "Every task's");
  chip("How hard nowgap thinks").dispatch("click");
  const first = items.find((x) => x.type === "radio");
  assert.deepEqual([first.label, first.desc, first.checked], ["The default: Every task's", "As every task here thinks: high", true]);
  items.find((x) => x.label === "Low").onClick();
  assert.match(textOf(shown.body), /at low/);
  chip("How hard nowgap thinks").dispatch("click");
  items.find((x) => x.type === "radio").onClick();
  assert.equal(chip("How hard nowgap thinks").querySelector(".ec-words").textContent, "Every task's");
  buttonsOf(shown.body).find((b) => textOf(b) === "Run 2 tasks")?.dispatch("click");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls.at(-1)?.[2]?.tasks.map((/** @type {any} */ t) => [t.id, t.effort]), [["nowgap", "high"], ["cbshow", "high"]]);
});

// (fails before: yes — the Hunter's of 10-28: a Works in chosen while the room was read was set back when it came; Ask
// your agent with a row unticked still said the offer waited for all)
test("the sheet keeps a Works in chosen before the room's read lands, and Ask your agent names only the rows ticked", async () => {
  const { fakeH, textOf, buttonsOf } = await import("./helpers/fake-dom.js");
  const { modelSelects } = await import("./helpers/team-view.js");
  const { openSideRunSheet } = await import("../src/ui/harness/views/side-run-sheet.js");
  const { drawGraph } = await import("../src/ui/harness/views/task-graph.js");
  const pickers = modelSelects();
  /** @type {any[]} */
  const calls = [];
  /** @type {(f: any) => void} */
  let land = () => {};
  const api = (/** @type {string} */ path, /** @type {any} */ init) => {
    calls.push([init?.method || "GET", path, init?.body]);
    return init ? Promise.resolve({ ok: true, started: ["nowgap"], later: false, refused: [] }) : new Promise((r) => (land = r));
  };
  /** @type {any} */
  let shown = null;
  /** @type {any[]} */
  let menuItems = [];
  /** @type {any[]} */
  const asked = [];
  const tasks = [{ id: "nowgap", name: "Close the gap in Now", writes: ["src/ui/harness/lib/now.js"], check: ["npm test"] }, { id: "cbshow", name: "Show the card", writes: ["src/ui/harness/card.js"], check: [] }];
  openSideRunSheet(
    { chainId: "c1", ids: ["nowgap", "cbshow"], tasks, model: "Opus 5.5", models: () => [], ask: (text, ids) => void asked.push([text, ids]) },
    { h: fakeH, dialog: /** @type {any} */ ((o) => ((shown = o), { close: () => {} })), menu: /** @type {any} */ ((items) => void (menuItems = items)), api, modelSelect: /** @type {any} */ (pickers.make) },
  );
  // Before the room lands: nowgap to your folder, on its own row (the first Its own copy is every task's).
  buttonsOf(shown.body).find((b) => b.attrs["aria-label"] === "Change nowgap").dispatch("click");
  buttonsOf(shown.body).filter((b) => textOf(b) === "Its own copy")[1].dispatch("click");
  menuItems.find((i) => i.label === "Your folder").onClick();
  land({ max: 4, running: 0, turn: false, repo: true, worktree: true });
  await new Promise((r) => setImmediate(r));
  buttonsOf(shown.body).find((b) => textOf(b) === "Run 2 tasks").dispatch("click");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls.at(-1)[2].tasks.map((/** @type {any} */ t) => [t.id, t.folder]), [["nowgap", "yours"], ["cbshow", "copy"]], "the choice stands; the other row takes the room's");
  // Ask your agent with cbshow unticked: the sentence and the offer's mark name nowgap alone.
  /** @param {any} n @returns {any} */
  const tickOf = (n) => (n && typeof n === "object" ? (n.tag === "input" && n.attrs["aria-label"] === "Run cbshow" ? n : (n.kids || []).map(tickOf).find(Boolean)) : null);
  tickOf(shown.body).dispatch("change");
  buttonsOf(shown.body).find((b) => textOf(b) === "Ask your agent to run them instead").dispatch("click");
  assert.deepEqual(asked, [["Run nowgap in parallel on sub-agents.", ["nowgap"]]]);
  const offer = textOf(drawGraph(tg.graphView(suggested(graph())), { h: fakeH, now: T0, onSideBySide: () => {}, sideAsked: { ids: ["nowgap"], at: T0 } }).el);
  assert.match(offer, /Asked your agent \d\d:\d\d to run nowgap — waiting for it to start it/);
  assert.ok(offer.includes("Run them in parallel…"), "the offer's button stays for the rest");
});

// (fails before: yes — the owner's of 10-29, six tasks in Plan's Run them side by side…: "what the hell was i presented
// with" — each task drew the same four lines, Runs on, Works in, Brief and When done, and the sheet ran off the window)
test("six tasks: every task's choices once on top, a row a task with only what differs, Change opens a row's own; the sheet fits the window", async () => {
  const { fakeH, textOf, buttonsOf } = await import("./helpers/fake-dom.js");
  const { modelSelects } = await import("./helpers/team-view.js");
  const { openSideRunSheet } = await import("../src/ui/harness/views/side-run-sheet.js");
  const { readFileSync } = await import("node:fs");
  const pickers = modelSelects();
  /** @type {any[]} */
  const calls = [];
  const api = async (/** @type {string} */ path, /** @type {any} */ init) => {
    calls.push([init?.method || "GET", path, init?.body]);
    return init ? { ok: true, started: [], later: false, refused: [] } : { max: 8, running: 0, turn: false, repo: true, worktree: true };
  };
  /** @type {any} */
  let shown = null;
  /** @type {any[]} */
  let menuItems = [];
  const ids = ["shelf", "import", "glances", "sqlite", "reads", "pull"];
  const tasks = ids.map((id) => ({ id, name: `Do ${id}`, writes: [`src/${id}.js`], check: [] }));
  openSideRunSheet(
    { chainId: "c1", ids, tasks, model: "Opus 5.5", models: () => [] },
    { h: fakeH, dialog: /** @type {any} */ ((o) => ((shown = o), { close: () => {} })), menu: /** @type {any} */ ((items) => void (menuItems = items)), api, modelSelect: /** @type {any} */ (pickers.make) },
  );
  await new Promise((r) => setImmediate(r));
  /** Every node under `n` of the class. @param {any} n @param {string} cls @returns {any[]} */
  const ofClass = (n, cls) => (n && typeof n === "object" ? [...(String(n.attrs?.class || "").split(" ").includes(cls) ? [n] : []), ...(n.kids || []).flatMap((/** @type {any} */ k) => ofClass(k, cls))] : []);
  const text = textOf(shown.body);
  const count = (/** @type {string} */ w) => text.split(w).length - 1;
  assert.deepEqual([count("Runs on"), count("Works in"), count("Thin: only its name and files"), count("Waits in its copy for its apply, your agent's or yours")], [1, 1, 1, 1], "said once, for every task");
  assert.equal(ofClass(shown.body, "sr-row").length, 6, "a row a task");
  assert.equal(ofClass(shown.body, "sr-list").length, 1, "the rows in one list, which scrolls");
  assert.equal(pickers.made.length, 1, "one picker, every task's");
  // Change on a row: its own model and folder; every task's choice moves the others, never it.
  buttonsOf(shown.body).find((b) => b.attrs["aria-label"] === "Change sqlite").dispatch("click");
  assert.equal(pickers.made.length, 2, "its own picker, made when it opened");
  pickers.made[1].o.onChange("gpt-sol");
  buttonsOf(shown.body).filter((b) => textOf(b) === "Its own copy")[1].dispatch("click");
  menuItems.find((i) => i.label === "Your folder").onClick();
  pickers.made[0].o.onChange("kimi-k3");
  assert.match(textOf(shown.body), /writes sqlite\.js · on GPT Sol · in your folder/);
  buttonsOf(shown.body).find((b) => textOf(b) === "Run 6 tasks").dispatch("click");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls.at(-1)[2].tasks.map((/** @type {any} */ t) => [t.id, t.model, t.folder]), [["shelf", "kimi-k3", "copy"], ["import", "kimi-k3", "copy"], ["glances", "kimi-k3", "copy"], ["sqlite", "gpt-sol", "yours"], ["reads", "kimi-k3", "copy"], ["pull", "kimi-k3", "copy"]]);
  // It fits the window: its height bounded, the title in sight, the list the one part that scrolls.
  const css = readFileSync(new URL("../src/ui/harness/views/flow.css", import.meta.url), "utf8");
  assert.match(css, /\.zc-dialog\.sr-dialog \{ max-height: calc\(100dvh - 48px\);/);
  assert.match(css, /\.sr-sheet \{ flex: 1 1 auto; min-height: 0;/);
  assert.match(css, /\.sr-list \{ flex: 1 1 auto; min-height: 72px; overflow-y: auto;/);
});

test("the offer opens the sheet; a box says starting, its model and where, you ran it, and ready to apply", async () => {
  const { fakeH, textOf, buttonsOf, tipsOf } = await import("./helpers/fake-dom.js");
  const { drawGraph } = await import("../src/ui/harness/views/task-graph.js");
  /** What a drawing says: its words, and its tasks' tooltips (a task is one line, the rest in its tooltip). @param {any} v */
  const said = (v) => {
    const el = drawGraph(v, { h: fakeH, now: T0 + 60_000 }).el;
    return [textOf(el), ...tipsOf(el)].join("\n");
  };
  let g = ok(tg.sideRun(graph(), [PICK], { at: T0, crew: AGENT, starts: "turn" })).graph;
  const starting = said(tg.graphView(g));
  assert.ok(starting.includes("when the agent's turn ends · Opus 5.5"), starting);
  assert.ok(starting.includes("You ran it on a sub-agent — Opus 5.5, in its own copy"), starting);
  g = /** @type {any} */ (tg.launched(g, "nowgap", "sa_1", T0 + 1, "sub-agent"));
  const running = said(tg.graphView(g));
  assert.ok(running.includes("Opus 5.5 · its copy · started"), running);
  const files = [{ path: "src/ui/harness/lib/now.js", added: 4, removed: 1 }];
  g = /** @type {any} */ (tg.taskEnded(g, "nowgap", /** @type {any} */ ({ agent: "sa_1", status: "done", stoppedBy: null, error: null, report: { status: "done", did: "Closed.", met: true, evidence: "e", left: "" }, words: "", files, shared: false, wrote: true, workError: null, ran: [], calls: [], written: [], spentUsd: 0, ms: 1, cut: false }), T0 + 2)).graph;
  const waits = said(tg.graphView(g));
  assert.ok(waits.includes("Ready to apply"), "its pill");
  assert.ok(waits.includes("1 file wait in its copy for its apply · Review in Changes"), waits);
  // (fails before: yes — its card said it waited for your Apply and gave no way to it)
  /** @type {string[]} */
  const reviewed = [];
  const chosen = drawGraph(tg.graphView(g), { h: fakeH, now: T0 + 60_000, chosen: "nowgap", onReview: (id) => void reviewed.push(id) }).el;
  assert.match(textOf(chosen), /Ready to apply\|1 file in its copy\. Nothing goes into your folder until the agent applies them, or you do; the tasks that need it wait for that apply\./);
  buttonsOf(chosen).find((b) => textOf(b) === "Review in Changes ›").dispatch("click");
  assert.deepEqual(reviewed, ["sa_1"], "its row in Changes, on its Apply");
  // Applied, its line says so — the page's one word for a change going into your folder.
  const applied = /** @type {any} */ (tg.sideApplied(g, "sa_1", files, T0 + 3));
  assert.ok(applied, "its apply brought it in");
  assert.ok(said(tg.graphView(applied)).includes("\ndone · applied · 1 file (+4 −1)"));
  // The offer: its press opens the sheet; asked instead, it says so.
  const two = suggested(graph());
  /** @type {string[][]} */
  const opened = [];
  const offer = drawGraph(tg.graphView(two), { h: fakeH, now: T0, onSideBySide: (ids) => void opened.push(ids) }).el;
  buttonsOf(offer).find((b) => textOf(b) === "Run them in parallel…").dispatch("click");
  assert.deepEqual(opened, [["nowgap", "cbshow"]]);
  const asked = textOf(drawGraph(tg.graphView(two), { h: fakeH, now: T0, onSideBySide: () => {}, sideAsked: { ids: ["nowgap", "cbshow"], at: T0 } }).el);
  assert.match(asked, /Asked your agent \d\d:\d\d — waiting for it to start them/);
});

// (fails before: yes — a task whose change did not merge stood failed, its change in its copy with no way to it from
// the graph, and an apply of it with the developer's choices left the task failed)
test("a task whose change did not merge: its box says so with Resolve in Changes; applied with your choices it is done; sent back to rebase, its worker goes on with the note", async () => {
  const { fakeH, textOf, buttonsOf, tipsOf } = await import("./helpers/fake-dom.js");
  const { drawGraph } = await import("../src/ui/harness/views/task-graph.js");
  let g = ok(tg.sideRun(graph(), [PICK], { at: T0, crew: AGENT, starts: "now" })).graph;
  g = /** @type {any} */ (tg.launched(g, "nowgap", "sa_1", T0 + 1, "sub-agent"));
  const files = [{ path: "src/ui/harness/lib/now.js", added: 4, removed: 1 }];
  const end = /** @type {any} */ ({ agent: "sa_1", status: "done", stoppedBy: null, error: null, report: { status: "done", did: "Closed it.", met: true, evidence: "npm test", left: "" }, words: "", files, shared: false, wrote: true, workError: null, ran: [], calls: [], written: [], spentUsd: 0, ms: 1, cut: false, check: { ran: true, commands: ["npm test"], runs: [{ command: "npm test", exit: 0, ms: 9, output: "", stopped: false }], bounces: 0, stopped: false } });
  const ended = /** @type {any} */ (tg.taskEnded(g, "nowgap", end, T0 + 2));
  assert.equal(ended.state, "yours");
  const asked = /** @type {any} */ (tg.applyAsked(ended.graph, "sa_1"));
  const failed = /** @type {any} */ (tg.taskMergeFailed(asked.graph, "nowgap", "1 file does not come through cleanly — src/ui/harness/lib/now.js: 2 changes overlap yours", T0 + 3));
  assert.equal(task(failed, "nowgap").state, "failed");

  // A task is one line (the redesign of 11-05): Failed is its fact; why, its tooltip's.
  const box = drawGraph(tg.graphView(failed), { h: fakeH, now: T0 + 60_000 }).el;
  assert.ok(textOf(box).includes("nowgap|Close the gap in Now|Failed"), textOf(box));
  assert.ok(tipsOf(box).some((tip) => tip.includes("\nfailed · didn't apply: overlaps your edits · Resolve in Changes")), tipsOf(box).join("\n\n"));
  /** @type {string[]} */
  const reviewed = [];
  const card = drawGraph(tg.graphView(failed), { h: fakeH, now: T0 + 60_000, chosen: "nowgap", onReview: (id) => void reviewed.push(id) }).el;
  assert.match(textOf(card), /Its change didn't apply\|It waits in its copy\. Choose for each file that overlaps your edits, or send it back to rebase on your folder as it is now\./);
  buttonsOf(card).find((b) => textOf(b) === "Resolve in Changes ›").dispatch("click");
  assert.deepEqual(reviewed, ["sa_1"]);

  // Applied with the developer's choices: done, and said so.
  const applied = /** @type {any} */ (tg.sideApplied(failed, "sa_1", files, T0 + 4));
  assert.deepEqual([task(applied, "nowgap").state, task(applied, "nowgap").merged], ["done", { files: 1, added: 4, removed: 1 }]);
  assert.equal(task(applied, "nowgap").summary, "Closed it.\nIts change did not merge as it stood; the developer applied it with their own choices.");
  assert.equal(tg.sideApplied(applied, "sa_1", files, T0 + 5), null, "once");

  // Sent back to rebase: its worker goes on with it, reading what failed and the note.
  const back = /** @type {any} */ (tg.sentToRebase(failed, "sa_1", "[Filament: the developer sent your work back to rebase …]"));
  assert.equal(back.id, "nowgap");
  const t = task(back.graph, "nowgap");
  assert.deepEqual([t.state, t.resume, t.note, t.earlier.why], ["waiting", "sa_1", "[Filament: the developer sent your work back to rebase …]", "its change did not merge: 1 file does not come through cleanly — src/ui/harness/lib/now.js: 2 changes overlap yours"]);
  assert.deepEqual(tg.jobs(back.graph).find((j) => j.id === "nowgap"), { id: "nowgap", kind: "resume" }, "the runner gives it to its worker");
  const resume = tg.resumeText(back.graph, "nowgap", AGENT);
  assert.match(resume, /sent your work back to rebase/);
  // (fails before: yes — the Hunter's of 10-28: it read "your try … ended" and "Your worktree holds your change as you
  // left it", where its copy holds the developer's folder now)
  assert.match(resume, /^\[Filament: the developer sent your change on task nowgap back to rebase \(its change did not merge: /);
  assert.doesNotMatch(resume, /as you left it/);
  assert.equal(tg.sentToRebase(back.graph, "sa_1", "again"), null, "only a task whose change waits for you");

  // (fails before: yes — the Hunter's of 10-28: a task applied with markers left in read as done and clean)
  const marked = /** @type {any} */ (tg.sideApplied(failed, "sa_1", files, T0 + 4, ["src/ui/harness/lib/now.js"]));
  assert.equal(task(marked, "nowgap").summary, "Closed it.\nIts change did not merge as it stood; the developer applied it with their own choices.\nGit's conflict markers stand in src/ui/harness/lib/now.js, for the developer to resolve.");
});

// (fails before: yes — the Hunter's of 10-28: Send back to rebase on a side run's change that waits for your Apply
// failed, "no longer one whose change did not merge")
test("a side run's change that waits for your Apply goes back to its worker to rebase, as one that did not merge does", () => {
  let g = ok(tg.sideRun(graph(), [PICK], { at: T0, crew: AGENT, starts: "now" })).graph;
  g = /** @type {any} */ (tg.launched(g, "nowgap", "sa_1", T0 + 1, "sub-agent"));
  const files = [{ path: "src/ui/harness/lib/now.js", added: 4, removed: 1 }];
  const end = /** @type {any} */ ({ agent: "sa_1", status: "done", stoppedBy: null, error: null, report: { status: "done", did: "Closed it.", met: true, evidence: "e", left: "" }, words: "", files, shared: false, wrote: true, workError: null, ran: [], calls: [], written: [], spentUsd: 0, ms: 1, cut: false });
  const waits = /** @type {any} */ (tg.taskEnded(g, "nowgap", end, T0 + 2)).graph;
  assert.deepEqual([task(waits, "nowgap").state, task(waits, "nowgap").step], ["merging", "yours"]);
  assert.equal(tg.rebaseRefusal(waits, "sa_1", "nowgap", AGENT), null);
  const back = /** @type {any} */ (tg.sentToRebase(waits, "sa_1", "[Filament: the developer sent your work back to rebase …]"));
  assert.ok(back, "sent back");
  assert.deepEqual([task(back.graph, "nowgap").state, task(back.graph, "nowgap").resume], ["waiting", "sa_1"]);
  assert.deepEqual(tg.jobs(back.graph).find((j) => j.id === "nowgap"), { id: "nowgap", kind: "resume" });
  // One merging into the folder now is refused in its own words.
  const merging = structuredClone(waits);
  task(merging, "nowgap").step = null;
  assert.equal(tg.rebaseRefusal(merging, "sa_1", "nowgap", AGENT), "task nowgap's change is merging into your folder now — wait for its end");
});

// (fails before: yes — the Hunter's of 10-28: a task whose change did not merge went back to its worker on the folder as
// it was, a lead's merge of it met the same overlap again, its planner was told to apply it as it is, a restart left
// one sent back to rebase waiting for a worker none kept, and one applied with markers read as applied clean)
test("a task whose change did not merge: a new worker on its start, no merge as it stands, the developer's to resolve; a restart gives one sent back to rebase to them; markers named on its box", async () => {
  const { fakeH, tipsOf } = await import("./helpers/fake-dom.js");
  const { drawGraph } = await import("../src/ui/harness/views/task-graph.js");
  let g = ok(tg.sideRun(graph(), [PICK], { at: T0, crew: AGENT, starts: "now" })).graph;
  g = /** @type {any} */ (tg.launched(g, "nowgap", "sa_1", T0 + 1, "sub-agent"));
  const files = [{ path: "src/ui/harness/lib/now.js", added: 4, removed: 1 }];
  const end = /** @type {any} */ ({ agent: "sa_1", status: "done", stoppedBy: null, error: null, report: { status: "done", did: "Closed it.", met: true, evidence: "e", left: "" }, words: "", files, shared: false, wrote: true, workError: null, ran: [], calls: [], written: [], spentUsd: 0, ms: 1, cut: false });
  const failed = /** @type {any} */ (tg.taskMergeFailed(/** @type {any} */ (tg.taskEnded(g, "nowgap", end, T0 + 2)).graph, "nowgap", "1 file does not come through cleanly", T0 + 3));
  const said = tg.endText(failed, "nowgap", { crew: AGENT });
  assert.match(said, /It waits in its worker's copy: apply it again once the files it overlaps in the folder are as its change needs them, or the developer resolves it from Changes/);
  assert.match(said, /start it again — tasks start with its id and a note: a new sub-agent starts from the folder as it stands/);
  assert.doesNotMatch(said, /apply_changes: true to apply it as it is|its sub-agent goes on where it stopped/);
  // Its start: a new worker, said why.
  const started = /** @type {any} */ (tg.applyTasks(failed, { action: "start", ids: ["nowgap"] }, { at: T0 + 4, crew: AGENT, resumable: () => null }));
  assert.ok(started.ok, started.error);
  assert.equal(task(started.graph, "nowgap").resume, null, "not its last worker");
  assert.match(started.text, /its change did not merge, and sa_1's worktree holds the folder as it was before — a new one starts from the folder as it stands/);
  // A lead's merge as it stands: refused in words.
  const lead = /** @type {any} */ ([{ tag: "builder", role: "builder" }]);
  const merged = /** @type {any} */ (tg.applyTasks(failed, { action: "merge", id: "nowgap", reason: "it is fine" }, { at: T0 + 4, crew: lead }));
  assert.equal(merged.ok, false);
  assert.match(merged.error, /nowgap's change did not merge with the folder as it is — a merge as it stands meets the same overlap\./);
  // Sent back to rebase, then a restart before its worker went on: the developer's to resolve again.
  const back = /** @type {any} */ (tg.sentToRebase(failed, "sa_1", "N")).graph;
  const cut = /** @type {any} */ (tg.restartCut(back, T0 + 9));
  assert.deepEqual(cut.ids, ["nowgap"]);
  const t = task(cut.graph, "nowgap");
  assert.deepEqual([t.state, t.failures.cause, t.agent, t.resume, tg.waitsForYou(cut.graph, "sa_1")], ["failed", "merge", "sa_1", null, true]);
  assert.match(t.why, /a Filament restart came before its worker went on with its rebase/);
  // Applied with markers: its line names them.
  const applied = /** @type {any} */ (tg.sideApplied(failed, "sa_1", files, T0 + 5, ["src/ui/harness/lib/now.js"]));
  assert.deepEqual(task(applied, "nowgap").merged, { files: 1, added: 4, removed: 1, marked: ["src/ui/harness/lib/now.js"] });
  assert.ok(tipsOf(drawGraph(tg.graphView(applied), { h: fakeH, now: T0 + 60_000 }).el).some((tip) => tip.includes("\ndone · applied · 1 file (+4 −1) · markers in now.js")));
});

// (fails before: yes — the Hunter's of 10-28: the graph took the task back for a worker that could not go on, which then
// failed or went to a new worker, and its marked work stayed "sent back to rebase", no Apply's)
test("the runner sends a task back to rebase only to a worker that can go on with it, and waits for it only while it does", () => {
  const can = { why: /** @type {string | null} */ ("Filament restarted since it ran, and its conversation went with it") };
  const r = rig({ resumable: () => can.why });
  let g = ok(tg.sideRun(graph(), [PICK], { at: T0, crew: AGENT, starts: "now" })).graph;
  g = /** @type {any} */ (tg.launched(g, "nowgap", "sa_1", T0 + 1, "sub-agent"));
  const files = [{ path: "src/ui/harness/lib/now.js", added: 4, removed: 1 }];
  const end = /** @type {any} */ ({ agent: "sa_1", status: "done", stoppedBy: null, error: null, report: { status: "done", did: "Closed it.", met: true, evidence: "e", left: "" }, words: "", files, shared: false, wrote: true, workError: null, ran: [], calls: [], written: [], spentUsd: 0, ms: 1, cut: false });
  const ended = /** @type {any} */ (tg.taskEnded(g, "nowgap", end, T0 + 2)).graph;
  const failed = /** @type {any} */ (tg.taskMergeFailed(ended, "nowgap", "1 file does not come through cleanly", T0 + 3));
  r.put(failed);
  const no = r.runner.rebaseTask({ chainId: "c1", agentId: "sa_1", taskId: "nowgap", note: "N" });
  assert.deepEqual(no, { ok: false, error: "sa_1 can't go on with task nowgap: Filament restarted since it ran, and its conversation went with it" });
  assert.equal(task(r.g(), "nowgap").state, "failed", "the graph as it was");
  assert.equal(r.runner.rebaseWaits("c1", "sa_1"), false);

  can.why = null;
  assert.deepEqual(r.runner.rebaseTask({ chainId: "c1", agentId: "sa_1", taskId: "nowgap", note: "N" }), { ok: true });
  assert.equal(r.runner.rebaseWaits("c1", "sa_1"), true, "due while its task waits for it");
  // Its resume refused at the start, the task fails: the graph waits for it no more.
  r.put(tg.resumeRefused(r.g(), "nowgap", "its model is switched off", T0 + 9));
  assert.equal(r.runner.rebaseWaits("c1", "sa_1"), false);
});
