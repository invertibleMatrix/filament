// @ts-check
// Sub-agents (app/agent/subagents.js, HarnessV3 §15 item 86). The registry launches each sub-agent as its own
// request (`agent/<model>` on the launching session's chain) and keeps its conversation for follow-ups; a report
// reaches the session's loop — at its next round, before the turn may end, or with the next turn — worded for who
// launched it. The loop runs a reply's agent calls side by side, waits for its own background sub-agents before it
// ends and holds a round for the developer's paused one. End to end, a sub-agent is a record of its own (source
// `subagent`) and a run of its own (kind `subagent`), offered the session's tools minus ask, plan and agent.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { createSubagentRegistry, forkMessages, forkTaskAt, forkWeight, KEPT_CHARS, RETRY_HEAD, SUBAGENT_NOTES } from "../src/app/agent/subagents.js";
import { CATCH_UP_TASK } from "../src/services/subagent-starts.js";
import { FORK_REFUSALS, toolSetFor } from "../src/app/agent/tools.js";
import { alignEvents } from "../src/ui/harness/lib/labels.js";
import { rowWords, openingWords } from "../src/ui/harness/lib/subagents.js";
import { arrivalWhere } from "../src/ui/harness/conversation/subagent-marks.js";
import { carryMarks } from "../src/ui/harness/conversation/history.js";
import { parseSubagentCommand } from "../src/app/commands/parse.js";
import { DEFAULT_OUTPUT_TOKENS } from "../src/core/tokens.js";
import { POWERSHELL } from "../src/adapters/tools/shell.js";
import { fakeUpstream, anthropicReply, startApp } from "./helpers/app.js";
import { until, readEvents } from "./helpers/wait.js";
import { SUBAGENT_VIEWS } from "../src/services/session-settings.js";
import { SHIPPED_CARDS } from "../src/services/agent-cards.js";

/** What a launch that names no kind is told after a fork's note: it runs in Builder's place, with Builder's words. */
const BUILDER_WORDS = SHIPPED_CARDS.builder.thinks;

const root = tmpdir();
const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
/** @param {any[]} content @param {string | null} [id] */
const reply = (content, id = null) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id, upstream: "m", retryAfter: null, shouldRetry: null });
const sink = () => ({ blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } });
/** The text of a message, whatever shape its content has. @param {any} m */
const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("\n"));
/** A promise and the hand that settles it. */
const deferred = () => {
  /** @type {(v?: any) => void} */
  let resolve = () => {};
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

/**
 * A registry whose front door is a scripted host: each launch is "served" the way turn.js serves one — attach, the
 * run's tool events relayed, finish before the reply — by `serve`, which answers with how the run went. A house call
 * (Enhance) is answered by `house`. Marks recorded between turns land in `marks`, each after turn 7. `config`: Filament's
 * config as the registry reads it — one naming a model's window weighs a fork against its line. `keptChars`: the ended
 * conversations' budget, where a test holds the registry to its own.
 * @param {(o: { id: string, body: any, headers: Record<string, string>, relay: (e: any) => void, n: number, signal: AbortSignal | null }) => Promise<{ report: string, status?: string, spentUsd?: number, error?: string | null, convo?: any[] }>} serve
 * @param {Partial<import("../src/app/agent/subagents.js").SubagentContext>} [context]
 * @param {{ now?: () => number, house?: (body: any) => any, config?: () => any, keptChars?: number }} [o]
 */
function scripted(serve, context = {}, { now = Date.now, house = () => reply([{ type: "text", text: "A BRIEF" }], "fork-1"), config = () => ({ agentLoop: {} }), keptChars = undefined } = {}) {
  /** @type {any[]} */
  const posts = [];
  /** @type {any[]} */
  const published = [];
  /** @type {any[]} */
  const marks = [];
  /** @type {any[]} what memory's brief was asked for */
  const briefs = [];
  let n = 0;
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config,
    log: () => {},
    events: { publish: (topic, e) => published.push({ topic, e }) },
    runs: null,
    now,
    ...(keptChars ? { keptChars } : {}),
    context: {
      settings: () => ({ subagents: { pool: [{ model: "", seats: 2 }] }, loop: { permissions: "edit" } }),
      session: () => ({ cwd: root, model: "m", projectId: "p1" }),
      view: async () => ({ text: "User: fix the parser\nAssistant: Fixed it.", turns: 1 }),
      brief: async (o) => {
        briefs.push(o);
        return null;
      },
      modelProblem: (name) => (name === "bad" ? "no route matches it" : null),
      mark: (chainId, m) => {
        const stored = { ...m, afterTurn: 7 };
        marks.push({ chainId, ...stored });
        return stored;
      },
      ...context,
    },
    call: async ({ body, headers = {}, onDelta = null, signal = null }) => {
      posts.push({ body, headers, stream: !!onDelta });
      const id = headers["x-filament-subagent"];
      if (!id) return house(body);
      const runId = `run-${++n}`;
      registry.attach(id, runId);
      const r = await serve({ id, body, headers, relay: (e) => registry.relay(id, e), n, signal });
      registry.finish(id, { status: r.status || "done", error: r.error ?? null, report: r.report, convo: r.convo || [...body.messages, { role: "assistant", content: [{ type: "text", text: r.report }] }], rounds: 1, toolCalls: 0, tokensIn: 10, tokensOut: 5, spentUsd: r.spentUsd ?? 0, roundIds: [runId] });
      return reply([{ type: "text", text: r.report }], runId);
    },
  });
  return { registry, posts, published, marks, briefs };
}

/** A turn's door onto the scripted registry, with what its loop would hand over. @param {ReturnType<typeof scripted>["registry"]} registry @param {Partial<Parameters<ReturnType<typeof createSubagentRegistry>["openTurn"]>[0]>} [over] */
const openDoor = (registry, over = {}) => registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: root, mode: "edit", model: "m", thinking: null, fork: null, ...over });

test("a launch is its own request: agent/<model> on the session's chain, its folder and mode, and a first message of view, memory's brief, task", async () => {
  /** @type {any[]} */
  const briefs = [];
  const { registry, posts, published } = scripted(async () => ({ report: "FOUND IT" }), {
    brief: async (o) => {
      briefs.push(o);
      return { text: "Memory for your task (Filament): - [i3 fact · user said] the parser lives in src/parse.js", count: 1 };
    },
  });
  const r = await registry.launch({ origin: "owner", chainId: "c1", prompt: "find the bug", worker: "reviewer", view: "folded" });
  assert.ok(r.ok, JSON.stringify(r));
  const o = await (r.ok ? r.done : null);
  assert.equal(o?.report, "FOUND IT");
  const { body, headers } = posts[0];
  assert.equal(body.model, "agent/m", "the session's model, as the loop's lane");
  assert.deepEqual(
    [headers["x-filament-chain"], headers["x-filament-cwd"], headers["x-filament-permissions"], headers["x-filament-subagent-of"], headers["x-filament-memory"]],
    ["c1", root, "read-only", "owner", "tools"],
    "an explorer runs read-only whatever the session's mode",
  );
  const blocks = body.messages[0].content.map((/** @type {any} */ b) => b.text);
  assert.equal(blocks.length, 3);
  assert.match(blocks[0], /^<conversation view="folded" turns="1">[\s\S]*User: fix the parser/);
  assert.equal(blocks[1], "<memory>\nMemory for your task (Filament): - [i3 fact · user said] the parser lives in src/parse.js\n</memory>");
  // The model its calls go out on rides with it, which Memory settings may leave out (the review of dc9d0b837).
  assert.deepEqual(briefs, [{ chainId: "c1", projectId: "p1", launchedBy: null, task: "find the bug", tools: ["read", "bash", "bash_output", "bash_kill", ...(POWERSHELL ? ["powershell"] : []), "grep", "glob"], model: "agent/m" }], "an explorer's brief, for the hands it may use — bash and powershell for the commands that only read (AH-F2, HarnessV4_Tasks C10); the developer's launch has no turn behind it");
  assert.equal(blocks[2], "find the bug", "the task comes last, whole");
  const seen = registry.get(r.ok ? r.id : "");
  assert.deepEqual([seen?.status, seen?.runId, seen?.exchanges[0].report], ["done", "run-1", "FOUND IT"]);
  const whole = registry.detail(r.ok ? r.id : "");
  assert.deepEqual(whole?.opening?.map((b) => [b.kind, b.count]), [["view", 1], ["brief", 1]], "the viewer sees the context the sub-agent was handed");
  assert.equal(whole?.opening?.[0].text, blocks[0]);
  assert.equal(seen && "opening" in seen, false, "the list's form stays small");
  assert.deepEqual(
    published.filter((p) => p.topic === "subagents" && p.e.type === "subagent").map((p) => [p.e.status, p.e.runId]),
    [["running", null], ["running", "run-1"], ["done", "run-1"]],
    "the bus hears the launch, the run's id and the end",
  );
});

test("refusals are words: no task, a model that cannot run one, a view that is not one, its model's limit", async () => {
  const gate = deferred();
  // (the owner's word of 11-05: a model's limit, set on its row, is the only one — across every chat)
  const { registry } = scripted(async () => {
    await gate.promise;
    return { report: "ok" };
  }, { modelFacts: (/** @type {string} */ m) => ({ problem: m === "bad" ? "no route matches it" : null, limit: null, at: { upstream: "u", model: m } }) }, { config: () => ({ agentLoop: { subagents: { slots: [{ upstream: "u", model: "m", n: 2 }] } } }) });
  assert.match(String(/** @type {any} */ (await registry.launch({ origin: "owner", chainId: "c1", prompt: "  " })).error), /needs a task/);
  assert.match(String(/** @type {any} */ (await registry.launch({ origin: "owner", chainId: "c1", prompt: "x", model: "bad" })).error), /cannot run on "bad": no route/);
  assert.match(String(/** @type {any} */ (await registry.launch({ origin: "owner", chainId: "c1", prompt: "x", view: "everything" })).error), /view must be one of/);
  const a = await registry.launch({ origin: "owner", chainId: "c1", prompt: "one" });
  const b = await registry.launch({ origin: "owner", chainId: "c1", prompt: "two" });
  const c = await registry.launch({ origin: "owner", chainId: "c1", prompt: "three" });
  assert.ok(a.ok && b.ok);
  assert.equal(/** @type {any} */ (c).error, "The limit is 2 at once, and 2 are running. Wait for one to finish.");
  assert.equal((await registry.launch({ origin: "owner", chainId: "c2", prompt: "elsewhere" })).ok, false, "a model's limit holds across every chat");
  gate.resolve();
  await Promise.all([a.ok && a.done, b.ok && b.done]);
});

test("a launch exists while its first message is still composed: a pause holds the turn, a stop means it is never sent", async () => {
  const slow = deferred();
  const { registry, posts } = scripted(async () => ({ report: "never" }), {
    view: async () => {
      await slow.promise;
      return { text: "User: hi", turns: 1 };
    },
  });
  const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: root, mode: "edit", model: "m", thinking: null, fork: null });
  const r = await registry.launch({ origin: "owner", chainId: "c1", prompt: "look", view: "folded", pause: true });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(door.inbox.hold(), "the paused launch holds the turn before its view is composed");
  assert.equal(registry.stop(r.ok ? r.id : "").ok, true, "and it can be stopped then");
  slow.resolve();
  const o = await (r.ok ? r.done : null);
  assert.deepEqual([o?.status, o?.error], ["aborted", "stopped before it finished"]);
  assert.equal(posts.length, 0, "the host request was never sent");
  door.close();
});

test("a follow-up continues the same conversation; refused while it runs and from another session", async () => {
  const gate = deferred();
  const { registry, posts } = scripted(async ({ n }) => {
    if (n === 1) await gate.promise;
    return { report: n === 1 ? "3 BUGS" : "ALL FIXED" };
  });
  const r = await registry.launch({ origin: "owner", chainId: "c1", prompt: "find bugs" });
  assert.ok(r.ok);
  const id = r.ok ? r.id : "";
  assert.match(String(/** @type {any} */ (registry.followUp(id, { prompt: "again", chainId: "c1" })).error), /still working/);
  gate.resolve();
  await (r.ok && r.done);
  assert.match(String(/** @type {any} */ (registry.followUp(id, { prompt: "again", chainId: "c2" })).error), /no sub-agent/);
  const f = registry.followUp(id, { prompt: "check again", chainId: "c1" });
  assert.ok(f.ok);
  const o = await (f.ok ? f.done : null);
  assert.equal(o?.report, "ALL FIXED");
  const second = posts[1].body.messages;
  assert.deepEqual(second.map((/** @type {any} */ m) => m.role), ["user", "assistant", "user"]);
  assert.equal(textOf(second[1]), "3 BUGS", "its own first report is in its context");
  assert.equal(textOf(second[2]), "check again");
  assert.equal(registry.get(id)?.exchanges.length, 2);
});

// (fails before: yes — the owner's word of 10-24: Retry on a failed side agent started a fresh thread; a follow-up with
// its question said it twice)
test("a retry asks a failed exchange's question again in the same thread: once, from where its conversation stood; one that had begun its work hears it is asked again; refused where nothing failed", async () => {
  const { registry, posts } = scripted(async ({ body, n }) =>
    n === 1 ? { status: "failed", error: "Failed to refresh OAuth token", report: "", convo: body.messages } : n === 3 ? { status: "failed", error: "overloaded", report: "", convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: "half way" }] }] } : { report: `ANSWER ${n}` },
  );
  const r = await registry.launch({ origin: "owner", chainId: "c1", prompt: "review the token check" });
  assert.ok(r.ok);
  const id = r.ok ? r.id : "";
  await (r.ok && r.done);
  assert.equal(registry.get(id)?.status, "failed");
  const again = registry.followUp(id, { prompt: "", chainId: "c1", by: "owner", again: true });
  assert.ok(again.ok, JSON.stringify(again));
  assert.equal(again.ok && again.id, id, "the same thread");
  assert.equal((await (again.ok ? again.done : null))?.report, "ANSWER 2");
  assert.deepEqual(posts[1].body.messages, posts[0].body.messages, "its question once, as it was sent");
  assert.deepEqual(registry.get(id)?.exchanges.map((x) => x.prompt), ["review the token check", "review the token check"]);
  assert.match(String(/** @type {any} */ (registry.followUp(id, { prompt: "", chainId: "c1", again: true })).error), /did not fail, so there is nothing to retry/);
  // An exchange that failed after it began: the question once more, after what it did, with Filament's word.
  const f = registry.followUp(id, { prompt: "and the refresh path?", chainId: "c1" });
  await (f.ok && f.done);
  assert.equal(registry.get(id)?.status, "failed");
  const g = registry.followUp(id, { prompt: "", chainId: "c1", again: true });
  await (g.ok && g.done);
  const last = posts[3].body.messages;
  assert.deepEqual(last.slice(-2).map((/** @type {any} */ m) => [m.role, textOf(m)]), [["assistant", "half way"], ["user", `${RETRY_HEAD}\n\nand the refresh path?`]]);
  assert.equal(registry.get(id)?.exchanges.length, 4);
});

// (fails before: yes — an exchange carried no line of its own, and the registry dropped a follow-up call's description)
test("each exchange keeps the line it was asked in: a launch's is the sub-agent's, the agent's follow-up its call's description, one without its prompt's first line (HarnessV3-Launch RD-D5)", async () => {
  const { registry } = scripted(async ({ n }) => ({ report: `REPORT ${n}` }));
  const door = openDoor(registry);
  const emit = () => {};
  await door.subagents.run({ id: "toolu_1", input: { run_in_background: false, description: "List src exports", prompt: "Read every file under src/ and list its exports.", subagent_type: "reviewer" }, emit, signal: null });
  const id = registry.list("c1")[0]?.id || "";
  // rd1a's S7b: the model sent its task to the sub-agent it already had, with a description of its own
  await door.subagents.run({ id: "toolu_2", input: { run_in_background: false, agent_id: id, description: "Check retry path coverage", prompt: "Read test/runner.test.js and src/runner.js: does the test exercise the retry path?" }, emit, signal: null });
  // the developer's follow-up from the viewer names no line: its prompt's first, clipped as a launch's is
  const f = registry.followUp(id, { prompt: "Look again at the null return that run gives after the third failure\nand say what a caller sees.", chainId: "c1" });
  await (f.ok ? f.done : null);
  // (fails before: no — L4's mutation pass: a first line past the clip hid whether the line was the first or the whole)
  const g = registry.followUp(id, { prompt: "Check the parser.\nThen the lexer.", chainId: "c1" });
  await (g.ok ? g.done : null);
  assert.deepEqual(
    registry.get(id)?.exchanges.map((x) => x.description),
    ["List src exports", "Check retry path coverage", "Look again at the null return that run gives after the thir…", "Check the parser."],
  );
  assert.equal(registry.get(id)?.description, "List src exports", "the sub-agent keeps its own name");
  assert.deepEqual(registry.detail(id)?.exchanges.map((x) => x.description), registry.get(id)?.exchanges.map((x) => x.description), "the viewer's whole form says the same");
  door.close();
});

test("what an exchange that ended done found goes to memory — its task, its calls (a failed one marked, a secret redacted) and its report; a failed, stopped or empty one never does (M7-2)", async () => {
  /** @type {any[]} */
  const told = [];
  /** @type {any} */
  let next = null;
  /** @type {string[]} */
  const logged = [];
  const { registry } = scripted(async () => next, { reported: (o) => told.push(o) });
  const convo = [
    { role: "user", content: [{ type: "text", text: "find the bug" }] },
    { role: "assistant", content: [{ type: "text", text: "Looking." }, toolUse("t1", "grep", { pattern: "parse" }), toolUse("t2", "bash", { command: "curl -H 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz' x" }), toolUse("t3", "write", { path: "notes.md", content: "x".repeat(500) })] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "src/parse.js" }, { type: "tool_result", tool_use_id: "t2", content: "denied", is_error: true }, { type: "tool_result", tool_use_id: "t3", content: "written" }] },
    { role: "assistant", content: [{ type: "text", text: "The parser lives in src/parse.js." }] },
  ];
  next = { report: "The parser lives in src/parse.js.", convo };
  const r = await registry.launch({ origin: "owner", chainId: "c1", prompt: "find the bug", worker: "reviewer" });
  assert.ok(r.ok);
  await (r.ok && r.done);
  const id = r.ok ? r.id : "";
  assert.deepEqual(told, [
    {
      chainId: "c1",
      launchedBy: null,
      agentId: id,
      agentType: "reviewer",
      model: "m",
      // As its calls went out: the model Memory settings may leave out (the review of dc9d0b837).
      sentModel: "agent/m",
      task: "find the bug",
      report: "The parser lives in src/parse.js.",
      calls: [
        { tool: "grep", input: '{"pattern":"parse"}', ok: true },
        { tool: "bash", input: `{"command":"curl -H 'Authorization: Bearer [redacted]' x"}`, ok: false },
        { tool: "write", input: `${JSON.stringify({ path: "notes.md", content: "x".repeat(500) }).slice(0, 199)}…`, ok: true },
      ],
    },
  ]);
  for (const ended of [{ report: "half of it", status: "failed", error: "it broke" }, { report: "cut short", status: "aborted", error: "stopped" }, { report: "  \n" }]) {
    next = ended;
    const f = await registry.launch({ origin: "owner", chainId: "c1", prompt: "look again" });
    await (f.ok && f.done);
  }
  assert.equal(told.length, 1, "a failed, stopped or empty exchange tells memory nothing");
  next = { report: "And the lexer is in src/lex.js." };
  const f = registry.followUp(id, { prompt: "where is the lexer?", chainId: "c1" });
  await (f.ok && f.done);
  assert.deepEqual(
    told.slice(1).map((o) => [o.agentId, o.task, o.report, o.calls.map((/** @type {any} */ c) => c.tool)]),
    [[id, "where is the lexer?", "And the lexer is in src/lex.js.", ["grep", "bash", "write"]]],
    "a follow-up's report, with its own task and the calls of its conversation so far",
  );
  // Memory refusing never fails the exchange: it is said in the log.
  const loud = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: (_level, msg) => logged.push(msg),
    events: { publish: () => {} },
    runs: null,
    context: {
      settings: () => ({ subagents: {}, loop: { permissions: "edit" } }),
      session: () => ({ cwd: root, model: "m", projectId: "p1" }),
      view: async () => null,
      brief: async () => null,
      modelProblem: () => null,
      mark: () => null,
      reported: () => {
        throw new Error("memory is closed");
      },
    },
    call: async ({ body, headers = {} }) => {
      const sid = headers["x-filament-subagent"];
      loud.attach(sid, "run-x");
      loud.finish(sid, { status: "done", error: null, report: "OK", convo: body.messages, rounds: 1, toolCalls: 0, tokensIn: 1, tokensOut: 1, spentUsd: 0, roundIds: [] });
      return reply([{ type: "text", text: "OK" }], "run-x");
    },
  });
  const l = await loud.launch({ origin: "owner", chainId: "c1", prompt: "say ok" });
  const o = await (l.ok ? l.done : null);
  assert.equal(o?.status, "done");
  assert.ok(logged.some((m) => /its report did not reach memory \(memory is closed\)/.test(m)), JSON.stringify(logged));
});

test("the developer's launch reports to the session: queued while idle, worded as theirs; inform announces it, and the report supersedes a notice nobody read", async () => {
  const gate = deferred();
  const { registry } = scripted(async () => {
    await gate.promise;
    return { report: "THE REPORT" };
  });
  const r = await registry.launch({ origin: "owner", chainId: "c1", prompt: "audit the cache", inform: true });
  const [notice] = registry.peekQueued("c1");
  assert.deepEqual([notice.kind, notice.description], ["notice", "audit the cache"]);
  assert.match(notice.text, /^\[Filament: the developer launched sub-agent sa_[0-9a-f]{8} \("audit the cache"\)[\s\S]*Don't start the same work yourself/);
  gate.resolve();
  await (r.ok && r.done);
  const queued = registry.peekQueued("c1");
  assert.deepEqual(queued.map((d) => d.kind), ["report"], "the report carries the task: the unread notice is gone");
  assert.match(queued[0].text, /^\[Filament: the developer ran sub-agent [\s\S]*The developer's task for it:\naudit the cache[\s\S]*THE REPORT[\s\S]*agent_id "sa_/);
  assert.equal(registry.queued("c1"), 1, "a look leaves it queued: a turn refused before it is sent must not lose it");
  registry.ackQueued("c1", queued);
  assert.equal(registry.queued("c1"), 0);
});

test("what waits for a session's loop is kept on the session: a restart restores its reports — not a notice whose sub-agent died with the process — and a turn that carried them clears them", async () => {
  /** @type {Map<string, any[]>} */
  const kept = new Map();
  const store = { saveQueue: (/** @type {string} */ chainId, /** @type {any[]} */ list) => void kept.set(chainId, structuredClone(list)), loadQueue: (/** @type {string} */ chainId) => structuredClone(kept.get(chainId) || []) };
  const slow = deferred();
  const before = scripted(async ({ body }) => {
    if (/slow one/.test(textOf(body.messages.at(-1)))) await slow.promise;
    return { report: "KEPT REPORT" };
  }, store);
  const quick = await before.registry.launch({ origin: "owner", chainId: "c1", prompt: "look around", description: "Look" });
  await (quick.ok && quick.done);
  await before.registry.launch({ origin: "owner", chainId: "c1", prompt: "slow one", description: "Slow", inform: true });
  assert.deepEqual(kept.get("c1")?.map((d) => [d.kind, d.from.slice(0, 3), d.exchange]), [["report", "sa_", 0], ["notice", "sa_", 0]], "each change is kept as it happens, with the exchange it belongs to");
  assert.equal("spentUsd" in (kept.get("c1")?.[0] || {}), false, "the accounting stays behind: its turn is gone after a restart");
  // (fails before: yes — HarnessV4_Tasks decision 10: the session kept the developer's words to a sub-agent as a
  // report, so a restart read them back as that sub-agent's report)
  kept.get("c1")?.push({ text: "[Filament: the developer wrote to your sub-agent sa_00000009 directly, past you:\nUse v2.]", from: "sa_00000009", description: "Fix it", kind: "told" });
  const service = readFileSync(new URL("../src/app/sessions/service.js", import.meta.url), "utf8");
  assert.match(service, /const QUEUE_KINDS = .*"told"/, "the session keeps their kind");
  const after = scripted(async () => ({ report: "x" }), store);
  const restored = after.registry.peekQueued("c1");
  assert.deepEqual(restored.map((d) => [d.kind, d.exchange]), [["report", 0]], "the notice's sub-agent died with the process: its report will never come; nor will the one the developer told read their words");
  assert.match(restored[0].text, /^\[Filament: the developer ran sub-agent [\s\S]*KEPT REPORT/);
  assert.equal(after.registry.queued("c1"), 1);
  after.registry.ackQueued("c1", restored);
  assert.deepEqual(kept.get("c1"), [], "the turn that carried it cleared it");
  slow.resolve();
});

// (fails before: yes — the bug hunt of 10-30, SUB-4: past 20 messages waiting for a session's next turn the oldest were
// let go, from the session's copy too, said in the log alone)
test("however many messages wait for a session's next turn, each is kept in the order it came — on the session too, and across a restart", () => {
  /** @type {Map<string, any[]>} */
  const kept = new Map();
  const store = { saveQueue: (/** @type {string} */ chainId, /** @type {any[]} */ list) => void kept.set(chainId, structuredClone(list)), loadQueue: (/** @type {string} */ chainId) => structuredClone(kept.get(chainId) || []) };
  const before = scripted(async () => ({ report: "x" }), store);
  const ends = Array.from({ length: 25 }, (_, i) => `t${i + 1}`);
  for (const id of ends) before.registry.tell("c1", { text: `[Filament: task ${id} is done.]`, from: "", description: `${id}: a task`, task: id, state: "done", spends: [], wrote: false });
  assert.deepEqual(before.registry.peekQueued("c1").map((d) => d.task), ends, "none is let go for another");
  assert.deepEqual(kept.get("c1")?.map((d) => d.task), ends, "the session keeps each");
  const after = scripted(async () => ({ report: "x" }), store);
  assert.deepEqual(after.registry.peekQueued("c1").map((d) => [d.task, d.text]), ends.map((id) => [id, `[Filament: task ${id} is done.]`]), "a restart gives each back, in order");
});

test("Filament's own notice — a flow's word to the main agent that drives it (OA4) — is kept across a restart; a sub-agent's launch notice is not", () => {
  /** @type {Map<string, any[]>} */
  const kept = new Map([
    [
      "c1",
      [
        { text: '[Filament: the flow you drive, "A" (step 1 of 2):\n- PM is done.\n]', from: "", description: 'the flow "A": PM done', kind: "notice" },
        { text: "[Filament: you launched sub-agent sa_00000003 …]", from: "sa_00000003", description: "Slow", kind: "notice" },
      ],
    ],
  ]);
  const store = { saveQueue: (/** @type {string} */ chainId, /** @type {any[]} */ list) => void kept.set(chainId, structuredClone(list)), loadQueue: (/** @type {string} */ chainId) => structuredClone(kept.get(chainId) || []) };
  const after = scripted(async () => ({ report: "x" }), store);
  // (fails before: yes — the restore dropped every notice, so the word of a flow driven In place was lost with a restart)
  assert.deepEqual(after.registry.peekQueued("c1").map((d) => [d.kind, d.from, d.description]), [["notice", "", 'the flow "A": PM done']]);
});

test("a turn acknowledges exactly what it carried: a report that superseded the peeked notice meanwhile waits for the next turn", async () => {
  const gate = deferred();
  const { registry } = scripted(async () => {
    await gate.promise;
    return { report: "LATE" };
  });
  const r = await registry.launch({ origin: "owner", chainId: "c1", prompt: "look", inform: true });
  const carried = registry.peekQueued("c1");
  gate.resolve();
  await (r.ok && r.done);
  registry.ackQueued("c1", carried);
  assert.deepEqual(registry.peekQueued("c1").map((d) => [d.kind, /LATE/.test(d.text)]), [["report", true]]);
});

test("pause holds only the turn running at the launch: idle there is nothing to pause, a later turn is neither held nor told it was paused", async () => {
  const gate = deferred();
  const { registry } = scripted(async () => {
    await gate.promise;
    return { report: "IDLE REPORT" };
  });
  const r = await registry.launch({ origin: "owner", chainId: "c1", prompt: "look while idle", pause: true });
  const id = r.ok ? r.id : "";
  assert.equal(registry.get(id)?.pause, false, "nothing ran to pause");
  const door = openDoor(registry, { runId: "turn-2" });
  assert.equal(door.inbox.hold(), null, "a turn started later is not held");
  assert.equal(door.inbox.owed(), null, "nor kept from ending");
  gate.resolve();
  await (r.ok && r.done);
  const [d] = door.inbox.take();
  assert.match(d.text, /^\[Filament: the developer ran sub-agent [\s\S]*alongside you/, "never 'paused your work'");
  door.close();
});

test("a paused launch lets go of its turn when that turn ends, and a follow-up never pauses", async () => {
  const gate = deferred();
  const { registry } = scripted(async ({ n }) => {
    if (n === 1) await gate.promise;
    return { report: `R${n}` };
  });
  const a = openDoor(registry, { runId: "turn-a" });
  const r = await registry.launch({ origin: "owner", chainId: "c1", prompt: "hold turn a", pause: true });
  const id = r.ok ? r.id : "";
  assert.ok(a.inbox.hold(), "turn A waits for it");
  assert.equal(registry.get(id)?.pause, true);
  a.close();
  const b = openDoor(registry, { runId: "turn-b" });
  assert.equal(b.inbox.hold(), null, "turn B is not the turn it paused");
  assert.equal(registry.get(id)?.pause, false);
  gate.resolve();
  await (r.ok && r.done);
  assert.match(b.inbox.take()[0].text, /alongside you/);
  const f = registry.followUp(id, { prompt: "again", chainId: "c1" });
  assert.ok(f.ok);
  assert.equal(b.inbox.hold(), null, "a follow-up does not hold the running turn");
  await (f.ok && f.done);
  b.close();
});

test("a launch kept aside: its reports are the developer's until sent on — into a running turn, else the next; pause and inform need the report", async () => {
  const { registry } = scripted(async ({ n }) => ({ report: n === 1 ? "PRIVATE" : "MORE" }));
  assert.match(String(/** @type {any} */ (await registry.launch({ origin: "owner", chainId: "c1", prompt: "x", deliver: false, pause: true })).error), /pause holds the main agent's turn/);
  assert.match(String(/** @type {any} */ (await registry.launch({ origin: "owner", chainId: "c1", prompt: "x", deliver: false, inform: true })).error), /inform tells the main agent/);
  const r = await registry.launch({ origin: "owner", chainId: "c1", prompt: "look aside", deliver: false });
  const id = r.ok ? r.id : "";
  await (r.ok && r.done);
  assert.equal(registry.queued("c1"), 0, "nothing went to the main agent");
  assert.deepEqual([registry.get(id)?.aside, registry.get(id)?.exchanges[0].delivery], [true, "held"]);
  const door = openDoor(registry);
  assert.deepEqual(registry.send(id, "c1"), { ok: true, into: "turn" });
  const [d] = door.inbox.take();
  assert.match(d.text, /^\[Filament: the developer is passing you the report of sub-agent sa_[0-9a-f]{8} \("look aside"\), which ran on the side and finished[\s\S]*PRIVATE/);
  assert.equal(registry.get(id)?.exchanges[0].delivery, "sent");
  assert.match(String(/** @type {any} */ (registry.send(id, "c1")).error), /already with the main agent/);
  assert.match(String(/** @type {any} */ (registry.send(id, "c2")).error), /no sub-agent/);
  door.close();
  const f = registry.followUp(id, { prompt: "more", chainId: "c1" });
  await (f.ok && f.done);
  assert.deepEqual([registry.queued("c1"), registry.get(id)?.exchanges[1].delivery], [0, "held"], "its follow-up stays aside too");
  assert.deepEqual(registry.send(id, "c1"), { ok: true, into: "queue" });
  assert.equal(registry.queued("c1"), 1);
  assert.equal(registry.peekQueued("c1")[0]?.exchange, 1, "the follow-up's report names its exchange: the turn that carries it says so (decision 23)");
});

// (fails before: yes — HarnessV4_Tasks E15 step 5 (BW-8, AG-128): `send` took no `when`, and a report sent while a turn
// ran always joined that turn)
test("a report sent \"with my next message\" while a turn runs is not read by that turn: the developer's note carries it in, else their next message's turn opens with it", async () => {
  const { registry } = scripted(async ({ n }) => ({ report: `R${n}` }));
  // One after the other: the scripted model numbers its replies in the order they are asked for.
  const a = await registry.launch({ origin: "owner", chainId: "c1", prompt: "one", deliver: false });
  await (a.ok && a.done);
  const b = await registry.launch({ origin: "owner", chainId: "c1", prompt: "two", deliver: false });
  await (b.ok && b.done);
  const [one, two] = [a.ok ? a.id : "", b.ok ? b.id : ""];
  const door = openDoor(registry);
  let woke = 0;
  void door.inbox.arrival().then(() => woke++);
  assert.deepEqual(registry.send(one, "c1", -1, { when: "next" }), { ok: true, into: "queue" });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual([door.inbox.take().length, registry.queued("c1"), woke], [0, 1, 0], "the running turn reads nothing, and is not woken");
  assert.equal(registry.get(one)?.exchanges[0].delivery, "sent");
  assert.match(String(/** @type {any} */ (registry.send(one, "c1", -1, { when: "next" })).error), /already with the main agent/);
  assert.equal(registry.release("c1"), 1, "their note went into the turn: the report goes with it");
  await new Promise((r) => setImmediate(r));
  assert.equal(woke, 1, "a loop waiting on its sub-agents hears it at once");
  const [d] = door.inbox.take();
  assert.match(d.text, /^\[Filament: the developer is passing you the report of sub-agent sa_[0-9a-f]{8} \("one"\)[\s\S]*R1/);
  assert.deepEqual([d.kind, d.sent, registry.queued("c1"), registry.release("c1")], ["report", true, 0, 0]);
  assert.deepEqual(registry.send(two, "c1", -1, { when: "next" }), { ok: true, into: "queue" });
  door.close();
  assert.deepEqual([registry.queued("c1"), registry.peekQueued("c1")[0]?.from, registry.release("c1")], [1, two, 0], "no note came: it waits for the next message's turn, and nothing releases it while none runs");
  assert.equal(registry.queued("c1"), 1);
});

test("the developer's own launches are marked in the transcript: idle, on the session and the bus; in a turn, on its timeline at its round", async () => {
  const gate = deferred();
  const { registry, marks, published } = scripted(async ({ n }) => {
    if (n === 1) await gate.promise;
    return { report: "R" };
  });
  const r = await registry.launch({ origin: "owner", chainId: "c1", prompt: "idle launch", view: "folded" });
  assert.deepEqual(marks.map((m) => [m.chainId, m.event, m.agentId === (r.ok && r.id), m.exchange, m.view, m.deliver, m.pause]), [["c1", "dispatch", true, 0, "folded", true, false]]);
  gate.resolve();
  await (r.ok && r.done);
  assert.deepEqual(marks.map((m) => m.event), ["dispatch", "arrival"]);
  assert.deepEqual([marks[1].status, marks[1].delivery, marks[1].rounds], ["done", "auto", 1]);
  const told = published.filter((p) => p.topic === "subagents" && p.e.type === "subagent-mark");
  assert.deepEqual(told.map((p) => [p.e.chainId, p.e.mark.event, p.e.mark.afterTurn]), [["c1", "dispatch", 7], ["c1", "arrival", 7]], "the bus announces each with the turn it follows");
  /** @type {any[]} */
  const emitted = [];
  let round = 3;
  const door = openDoor(registry, { emit: (e) => emitted.push({ ...e, round }) });
  const r2 = await registry.launch({ origin: "owner", chainId: "c1", prompt: "turn launch", deliver: false });
  round = 4;
  await (r2.ok && r2.done);
  assert.deepEqual(emitted.map((e) => [e.type, e.round, e.description, e.delivery ?? null]), [["subagent-dispatch", 3, "turn launch", null], ["subagent-arrival", 4, "turn launch", "held"]]);
  assert.equal(marks.length, 2, "a running turn carries its own marks: nothing more on the session");
  const r3 = await registry.launch({ origin: "command", chainId: "c1", prompt: "waited for", deliver: false });
  await (r3.ok && r3.done);
  assert.equal(emitted.length, 2, "a command that waited answers with the report itself: no marks");
  door.close();
});

test("with a turn running, the report lands in its inbox; a paused launch holds the turn's rounds until it reports", async () => {
  const gate = deferred();
  const { registry } = scripted(async () => {
    await gate.promise;
    return { report: "MID-TURN" };
  });
  const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: root, mode: "edit", model: "m", thinking: null, fork: null });
  assert.equal(door.inbox.hold(), null, "nothing holds the turn yet");
  const r = await registry.launch({ origin: "owner", chainId: "c1", prompt: "look first", pause: true });
  const held = door.inbox.hold();
  assert.ok(held, "the paused launch holds the next round");
  assert.ok(door.inbox.owed(), "and the turn's end");
  gate.resolve();
  await held;
  await (r.ok && r.done);
  const due = door.inbox.take();
  assert.equal(due.length, 1);
  assert.match(due[0].text, /^\[Filament: the developer paused your work while their sub-agent/);
  assert.deepEqual([due[0].kind, due[0].spentUsd], ["report", 0], "the developer's spend is not the turn's");
  door.close();
  assert.equal(registry.queued("c1"), 0);
});

test("the fork keeps every byte of the loop's conversation and answers each running call; a user message gets the instruction appended", () => {
  const running = [{ role: "user", content: "go" }, { role: "assistant", content: [{ type: "text", text: "reading" }, toolUse("t1", "read", { path: "a" }), toolUse("t2", "grep", { pattern: "b" })] }];
  const forked = forkMessages(running, "REWRITE");
  assert.deepEqual(forked.slice(0, 2), running, "the prefix is the loop's, untouched");
  assert.deepEqual(forked[2].content.map((/** @type {any} */ b) => b.type === "tool_result" ? b.tool_use_id : b.text), ["t1", "t2", "REWRITE"]);
  const between = [{ role: "user", content: "go" }, { role: "assistant", content: [toolUse("t1", "read", {})] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "x" }] }];
  const f2 = forkMessages(between, "REWRITE");
  assert.equal(f2.length, 3);
  assert.deepEqual(f2[2].content.map((/** @type {any} */ b) => b.type), ["tool_result", "text"]);
  assert.deepEqual(between[2].content.length, 1, "the loop's own message is not changed");
});

test("enhance forks the main agent's newest request while its cache is warm — mid-turn or after it — and reads a view when it is cold", async () => {
  let clock = 1_000_000;
  const TTL = 300_000;
  const FORK_HEADERS = { "x-filament-subagent-of": "owner", "x-filament-memory": "tools", "x-filament-chain": "c1" };
  const briefed = (/** @type {any} */ body) =>
    body.system === "SYS"
      ? { ...reply([{ type: "text", text: "**Title:** Trim parser fields\n\nA BRIEF" }], "fork-1"), json: { content: [{ type: "text", text: "**Title:** Trim parser fields\n\nA BRIEF" }], usage: { input_tokens: 40, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0, output_tokens: 20 } } }
      : reply([{ type: "text", text: "Title: From a view\n\nVIEW BRIEF" }], "view-1");
  const { registry, posts } = scripted(async () => ({ report: "x" }), {}, { now: () => clock, house: briefed });
  const convo = [{ role: "user", content: "fix the parser" }, { role: "assistant", content: [toolUse("t1", "read", { path: "parse.js" })] }];
  const base = { model: "m", max_tokens: 100, system: "SYS", tools: [{ name: "read" }] };
  let sentAt = clock - 1000;
  /** @type {boolean | null} */
  let cached = true;
  const door = openDoor(registry, {
    fork: () => ({ body: { ...base, messages: structuredClone(convo) }, headers: FORK_HEADERS }),
    cache: () => ({ body: { ...base, messages: [{ role: "user", content: "fix the parser" }, { role: "assistant", content: [{ type: "text", text: "Trimmed." }] }] }, headers: FORK_HEADERS, sentAt, ttlMs: TTL, cached, tokens: 9040 }),
  });
  assert.deepEqual(registry.cacheOf("c1"), { state: "warm", running: true, leftMs: TTL - 1000, ttlMs: TTL, tokens: 9040, model: "m", thinking: null, forkable: true });
  const e = /** @type {any} */ (await registry.enhance({ chainId: "c1", prompt: "find bugs", readOnly: true, view: "folded" }));
  assert.deepEqual([e.ok, e.how, e.title, e.text, e.usage.cacheRead], [true, "fork", "Trim parser fields", "A BRIEF", 9000], "the title line opens the rewrite, the brief follows");
  const fork = posts[0];
  assert.deepEqual([fork.body.system, fork.body.tools, fork.headers], ["SYS", [{ name: "read" }], FORK_HEADERS], "the loop's request as it stands, under the developer's lineage");
  assert.deepEqual(fork.body.messages.slice(0, 2), convo, "every byte before the instruction is the loop's");
  const instruction = textOf(fork.body.messages[2]);
  assert.match(instruction, /read-only — it can read and search, never change a file/);
  assert.match(instruction, /except a folded rendering of it \(every completed turn folded, tool results trimmed\)/);
  assert.match(instruction, /The developer's task:\nfind bugs$/);
  assert.equal(convo.length, 2, "the loop's conversation is not the fork's");
  sentAt = clock - TTL - 1;
  assert.equal(registry.cacheOf("c1").state, "cold", "a step that ran past the cache's lifetime");
  const cold = /** @type {any} */ (await registry.enhance({ chainId: "c1", prompt: "find bugs" }));
  assert.deepEqual([cold.how, cold.title, cold.text], ["view", "From a view", "VIEW BRIEF"]);
  assert.match(textOf(posts[1].body.messages[0]), /^<conversation view="folded">/);
  // (fails before: yes — the view's rewrite asked for 2,000 tokens, all a reasoning model's thinking: HarnessV3-FailurePoints §13)
  assert.ok(posts[1].body.max_tokens >= 32_000, `the rewrite asks for the most its model can write (got ${posts[1].body.max_tokens})`);
  sentAt = clock - 1000;
  door.close();
  assert.equal(registry.cacheOf("c1").state, "warm", "the turn's newest request is kept after it ends");
  clock += 60_000;
  const idle = /** @type {any} */ (await registry.enhance({ chainId: "c1", prompt: "check the tests" }));
  assert.equal(idle.how, "fork");
  assert.deepEqual(posts[2].body.messages.slice(0, 2).map((/** @type {any} */ m) => m.role), ["user", "assistant"], "the last request and its answer, then the instruction");
  assert.equal(textOf(posts[2].body.messages[1]), "Trimmed.");
  assert.equal(registry.cacheOf("c1").leftMs, TTL, "a cache read renews the lifetime from the fork");
  clock += TTL + 1;
  assert.equal(registry.cacheOf("c1").state, "cold");
  assert.equal(/** @type {any} */ (await registry.enhance({ chainId: "c1", prompt: "x" })).how, "view");
  cached = false;
  const d2 = openDoor(registry, { runId: "turn-2", fork: () => ({ body: { ...base, messages: [] }, headers: FORK_HEADERS }), cache: () => ({ body: { ...base, messages: [] }, headers: FORK_HEADERS, sentAt: clock, ttlMs: TTL, cached, tokens: 500 }) });
  assert.equal(registry.cacheOf("c1").state, "uncached", "a reply that read and wrote nothing from the cache");
  assert.equal(/** @type {any} */ (await registry.enhance({ chainId: "c1", prompt: "x" })).how, "view");
  d2.close();
});

// (fails before: yes — a kept request carries the loop's whole max_tokens, and at the compaction line that pair is one
// the provider refuses: the compaction fork always fell back to the transcript)
test("forkCall fits the reply to what the window leaves; too little room, or a thinking budget it would have to change, declines the fork; it streams when asked", async () => {
  const clock = 1_000_000;
  const FORK_HEADERS = { "x-filament-subagent-of": "owner", "x-filament-memory": "tools", "x-filament-chain": "c1" };
  const summary = () => ({ ...reply([{ type: "text", text: "THE SUMMARY" }], "fork-1"), json: { content: [{ type: "text", text: "THE SUMMARY" }], usage: { input_tokens: 40, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0, output_tokens: 20 } } });
  const { registry, posts } = scripted(async () => ({ report: "x" }), {}, { now: () => clock, house: summary });
  /** A finished turn's request kept warm: ≈9k tokens of conversation, the loop's whole 64k output allowance. @param {any} [thinking] */
  const keep = (thinking = null) => {
    const door = openDoor(registry, {
      cache: () => ({ body: { model: "m", max_tokens: 64_000, ...(thinking ? { thinking } : {}), system: "SYS", tools: [], messages: [{ role: "user", content: "the parser reads the file ".repeat(1500) }, { role: "assistant", content: [{ type: "text", text: "Done." }] }] }, headers: FORK_HEADERS, sentAt: clock - 1000, ttlMs: 300_000, cached: true, tokens: 9_000 }),
    });
    door.close();
  };
  keep();
  const f = /** @type {any} */ (await registry.forkCall("c1", "SUMMARIZE", { window: 20_000, minTokens: 2048, stream: true, endsWith: "Done.", forkFor: "compaction", job: "compaction-j1" }));
  assert.deepEqual([f.ok, f.text], [true, "THE SUMMARY"]);
  const sent = posts.at(-1);
  assert.ok(sent.body.max_tokens >= 2048 && sent.body.max_tokens <= 20_000 - 9_000 - 1536, `fitted under what the window leaves: ${sent.body.max_tokens}`);
  assert.equal(sent.stream, true, "a long summary streams");
  assert.equal(textOf(sent.body.messages.at(-1)), "SUMMARIZE");
  // (fails before: yes — the compactor's fork went out as the developer's sub-agent, and Traffic said so; decision 27)
  // (the job: HarnessV3-FailurePoints §5.1 item 3 — the request log knows the fork as its compaction's)
  assert.deepEqual(sent.headers, { ...FORK_HEADERS, "x-filament-fork": "compaction", "x-filament-job": "compaction-j1" }, "the compactor's fork says what it is for");
  const n = posts.length;
  assert.equal(await registry.forkCall("c1", "SUMMARIZE", { window: 12_000, minTokens: 2048 }), null, "no room for a summary: no fork");
  assert.equal(posts.length, n, "and nothing sent");
  keep({ type: "enabled", budget_tokens: 9900 });
  assert.equal(registry.cacheOf("c1").thinking, 9900, "the kept thinking budget, for the compactor's preview of a fork");
  assert.equal(await registry.forkCall("c1", "SUMMARIZE", { window: 20_000, minTokens: 2048 }), null, "the kept thinking budget does not fit under the room: changing it would miss the cache");
  keep({ type: "enabled", budget_tokens: 2000 });
  assert.equal(/** @type {any} */ (await registry.forkCall("c1", "SUMMARIZE", { window: 20_000, minTokens: 2048 })).ok, true);
  assert.deepEqual(posts.at(-1).body.thinking, { type: "enabled", budget_tokens: 2000 }, "the thinking goes out as it was cached");
  // (fails before: yes — a fork's summary was capped at the kept request's 64,000 and the compactor's 20,000: a fork is
  // Filament's own call and asks for all the model can write, inside the window; HarnessV3-FailurePoints §13)
  assert.equal(/** @type {any} */ (await registry.forkCall("c1", "SUMMARIZE", { window: 1_000_000, minTokens: 2048 })).ok, true);
  assert.equal(posts.at(-1).body.max_tokens, DEFAULT_OUTPUT_TOKENS, "a roomy window: the most the model can write (no ceiling stated here)");
  // A reply that calls a tool is no summary: `textOnly` makes it a failure (the compactor then reads the transcript).
  const toolReply = { ...reply([{ type: "text", text: "Let me look first." }, toolUse("x1", "read", { path: "a" })], "fork-2"), json: { content: [{ type: "text", text: "Let me look first." }, toolUse("x1", "read", { path: "a" })], usage: { input_tokens: 40, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0, output_tokens: 20 } } };
  const { registry: r2 } = scripted(async () => ({ report: "x" }), {}, { now: () => clock, house: () => toolReply });
  const d3 = openDoor(r2, { cache: () => ({ body: { model: "m", max_tokens: 64_000, system: "SYS", tools: [], messages: [{ role: "user", content: "go" }, { role: "assistant", content: [{ type: "text", text: "Done." }] }] }, headers: FORK_HEADERS, sentAt: clock - 1000, ttlMs: 300_000, cached: true, tokens: 100 }) });
  d3.close();
  assert.deepEqual(await r2.forkCall("c1", "SUMMARIZE", { textOnly: true }), { ok: false, error: "the fork called a tool instead of answering" });
  assert.equal(/** @type {any} */ (await r2.forkCall("c1", "REWRITE")).text, "Let me look first.", "without it the words stand, as Enhance has always had them");
  // Enhance's call, no window named: the kept request as it was.
  await registry.forkCall("c1", "REWRITE");
  assert.equal(posts.at(-1).body.max_tokens, 64_000);
  assert.equal(posts.at(-1).stream, false);
  assert.deepEqual(posts.at(-1).headers, FORK_HEADERS, "Enhance's says nothing: it stays the developer's sub-agent");
});

// (fails before: yes — the compactor's fork was tried once: one overloaded reply sent its summary to the transcript path)
test("forkCall with retry tries a busy provider again, as the loop's rounds are; Enhance's fork is tried once (HarnessV3-AtHome AH-F4)", async () => {
  const clock = 1_000_000;
  const FORK_HEADERS = { "x-filament-subagent-of": "owner", "x-filament-memory": "tools", "x-filament-chain": "c1" };
  const overloaded = { ok: false, status: 529, json: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, id: null, upstream: "m", retryAfter: 0, shouldRetry: null };
  let n = 0;
  const { registry, posts } = scripted(async () => ({ report: "x" }), {}, { now: () => clock, house: () => (++n === 1 ? overloaded : reply([{ type: "text", text: "THE SUMMARY" }], "fork-2")) });
  const door = openDoor(registry, { cache: () => ({ body: { model: "m", max_tokens: 64_000, system: "SYS", tools: [], messages: [{ role: "user", content: "go" }, { role: "assistant", content: [{ type: "text", text: "Done." }] }] }, headers: FORK_HEADERS, sentAt: clock - 1000, ttlMs: 300_000, cached: true, tokens: 100 }) });
  door.close();
  const f = await registry.forkCall("c1", "SUMMARIZE", { retry: true, forkFor: "compaction" });
  assert.deepEqual([f?.ok, f && "text" in f ? f.text : null, posts.length], [true, "THE SUMMARY", 2]);
  n = 0;
  assert.deepEqual(await registry.forkCall("c1", "REWRITE"), { ok: false, error: "Overloaded" });
  assert.equal(posts.length, 3, "Enhance's fork: one try");
});

test("an idle fork that read the cache renews the request it forked — never over a newer turn's that landed while it was out", async () => {
  const clock = 1_000_000;
  const TTL = 300_000;
  const out = deferred();
  const base = { model: "m", max_tokens: 100, system: "SYS", tools: [] };
  const snapOf = (/** @type {string} */ text, /** @type {number} */ tokens) => () => ({ body: { ...base, messages: [{ role: "user", content: text }] }, headers: {}, sentAt: clock - 1000, ttlMs: TTL, cached: true, tokens });
  const read = { content: [{ type: "text", text: "Title: Look\n\nA BRIEF" }], usage: { input_tokens: 5, cache_read_input_tokens: 900, output_tokens: 5 } };
  const house = async () => {
    await out.promise;
    return { ...reply(read.content, "fork-1"), json: read };
  };
  const { registry, posts } = scripted(async () => ({ report: "x" }), {}, { now: () => clock, house });
  openDoor(registry, { runId: "turn-1", cache: snapOf("turn one", 1000) }).close();
  const enhanced = registry.enhance({ chainId: "c1", prompt: "look" });
  assert.equal(textOf(posts[0].body.messages[0]).startsWith("turn one"), true, "the fork went out on the first turn's request");
  openDoor(registry, { runId: "turn-2", cache: snapOf("turn two", 2000) }).close();
  out.resolve();
  assert.equal(/** @type {any} */ (await enhanced).how, "fork");
  assert.equal(registry.cacheOf("c1").tokens, 2000, "the newer turn's request stays the one the next Enhance forks");
});

// ---- the loop with its door ----------------------------------------------------------------------------------------

/**
 * The launcher's LoopArgs over a scripted registry's door.
 * @param {ReturnType<typeof scripted>["registry"]} registry @param {Partial<import("../src/app/agent/loop.js").LoopArgs>} over
 */
const turnOn = (registry, over) => {
  const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: root, mode: "edit", model: "m", thinking: null, fork: null });
  return {
    door,
    args: /** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
      model: "m",
      root,
      readerModel: "",
      maxTokens: 100,
      thinking: null,
      costOf: () => 0,
      runHand: async (name) => `${name} ran`,
      delegateRead: null,
      permissions: null,
      rules: [],
      hooks: null,
      mcpReadOnly: new Set(),
      previewChars: 200,
      messages: [{ role: "user", content: "go" }],
      system: "launcher",
      tools: toolSetFor({ delegateRead: false }),
      modeNow: () => "edit",
      subagents: door.subagents,
      inbox: door.inbox,
      mailbox: null,
      tree: null,
      onEvent: () => {},
      sink: sink(),
      signal: null,
      resume: null,
      call: async () => reply([{ type: "text", text: "Done." }]),
      ...over,
    }),
  };
};

test("a reply's agent calls run side by side; the reports come back in the reply's order, the children's calls under their stubs", async () => {
  let arrived = 0;
  const both = deferred();
  /** @type {any[]} */
  const told = [];
  const { registry, briefs } = scripted(
    async ({ body, relay }) => {
      if (++arrived === 2) both.resolve();
      await both.promise;
      const task = textOf(body.messages[0]);
      relay({ type: "tool-start", round: 1, id: `r-${task}`, name: "read", args: "x", card: { kind: "read", title: "Read", subject: "x" } });
      relay({ type: "tool-end", round: 1, id: `r-${task}`, name: "read", ok: true, ms: 1, chars: 10 });
      return { report: `REPORT ${task}`, spentUsd: 0.5 };
    },
    { reported: (o) => told.push(o) },
  );
  /** @type {any[]} */
  const events = [];
  /** @type {any[]} */
  const calls = [];
  const { args, door } = turnOn(registry, {
    onEvent: (e) => events.push(e),
    call: async ({ body }) => {
      calls.push(structuredClone(body));
      return calls.length === 1
        ? reply([toolUse("a1", "agent", { run_in_background: false, description: "Find routes", prompt: "A", subagent_type: "reviewer" }), toolUse("a2", "agent", { run_in_background: false, description: "Count tests", prompt: "B" })])
        : reply([{ type: "text", text: "Done." }]);
    },
  });
  const out = await runAgentTurn(args);
  door.close();
  assert.equal(out.status, "done", JSON.stringify(out.notes));
  const back = calls[1].messages.at(-1).content;
  assert.deepEqual(back.map((/** @type {any} */ b) => b.tool_use_id), ["a1", "a2"]);
  assert.match(back[0].content, /^REPORT A\n\n\[Filament: sub-agent sa_[0-9a-f]{8} — to ask it more in the same context, call agent with agent_id/);
  assert.equal(out.totals.spentUsd, 1, "their spend is the turn's");
  const starts = events.filter((e) => e.type === "subagent-start");
  assert.deepEqual(starts.map((e) => [e.parent, e.agent, e.description, e.round]), [["a1", "reviewer", "Find routes", 1], ["a2", "builder", "Count tests", 1]]);
  assert.ok(starts.every((e) => /^sa_/.test(e.agentId)));
  const child = events.find((e) => e.type === "subagent-tool-start" && e.parent === "a1");
  assert.deepEqual([child.name, child.round, child.card?.kind], ["read", 1, "read"]);
  assert.ok(events.filter((e) => e.type === "subagent-end").every((e) => e.ok));
  assert.deepEqual(
    briefs.map((o) => [o.task, o.launchedBy, o.tools.includes("write"), o.tools.includes("bash")]),
    [["A", "turn-1", false, true], ["B", "turn-1", true, true]],
    "each brief is for its task, on the launching turn's run, for the hands it may use",
  );
  assert.deepEqual(told.map((o) => [o.task, o.launchedBy, o.agentType, o.report]).sort(), [["A", "turn-1", "reviewer", "REPORT A"], ["B", "turn-1", "builder", "REPORT B"]], "what each found is told with the launching turn's run");
});

test("a background launch answers at once; the turn waits for its report before it ends, then carries on with it", async () => {
  const gate = deferred();
  const { registry } = scripted(async () => {
    await gate.promise;
    return { report: "LATE REPORT", spentUsd: 0.25 };
  });
  /** @type {any[]} */
  const calls = [];
  /** @type {any[]} */
  const events = [];
  const { args, door } = turnOn(registry, {
    onEvent: (e) => events.push(e),
    call: async ({ body }) => {
      calls.push(structuredClone(body));
      if (calls.length === 1) return reply([toolUse("a1", "agent", { description: "Scan", prompt: "SCAN", run_in_background: true })]);
      if (calls.length === 2) {
        setTimeout(() => gate.resolve(), 50);
        return reply([{ type: "text", text: "I'll wait for the scan." }]);
      }
      return reply([{ type: "text", text: "Done with the scan." }]);
    },
  });
  const out = await runAgentTurn(args);
  door.close();
  assert.equal(out.status, "done");
  assert.match(calls[1].messages.at(-1).content[0].content, /^Launched sub-agent sa_[0-9a-f]{8} \("Scan"\) in the background/);
  assert.equal(calls.length, 3, "the report reopened the turn");
  const delivered = calls[2].messages.at(-1);
  assert.equal(delivered.role, "user");
  assert.match(textOf(delivered), /^\[Filament: your background sub-agent sa_[0-9a-f]{8} \("Scan"\) finished\. You asked it:\nSCAN[\s\S]*LATE REPORT/);
  assert.equal(calls[2].messages.at(-2).role, "assistant", "its words before the wait stay in the conversation");
  assert.equal(out.totals.spentUsd, 0.25, "a background run it launched is its spend too");
  assert.ok(events.some((e) => e.type === "waiting"));
  assert.ok(events.some((e) => e.type === "subagent-report" && /^sa_/.test(e.agentId) && e.kind === "report"));
});

// (fails before: yes — the loop's call that said nothing waited for the report, the owner's "priority should be to run
// the agent in background the way you are doing" of 10-27; a coding agent's own default is agents-coder-launch's)
test("the loop's agent call runs in the background unless it asks to wait: no run_in_background answers at once, false waits for the report", async () => {
  const gate = deferred();
  const { registry } = scripted(async ({ body }) => {
    if (/WAIT/.test(JSON.stringify(body.messages))) return { report: "WAITED REPORT" };
    await gate.promise;
    return { report: "LATE REPORT" };
  });
  /** @type {any[]} */
  const calls = [];
  const { args, door } = turnOn(registry, {
    call: async ({ body }) => {
      calls.push(structuredClone(body));
      if (calls.length === 1) return reply([toolUse("a1", "agent", { description: "Scan", prompt: "SCAN" })]);
      if (calls.length === 2) return reply([toolUse("a2", "agent", { description: "Wait", prompt: "WAIT", run_in_background: false })]);
      if (calls.length === 3) {
        setTimeout(() => gate.resolve(), 50);
        return reply([{ type: "text", text: "I'll wait for the scan." }]);
      }
      return reply([{ type: "text", text: "Done." }]);
    },
  });
  const out = await runAgentTurn(args);
  door.close();
  assert.equal(out.status, "done");
  assert.match(calls[1].messages.at(-1).content[0].content, /^Launched sub-agent sa_[0-9a-f]{8} \("Scan"\) in the background/, "said nothing: the background");
  assert.match(calls[2].messages.at(-1).content[0].content, /^WAITED REPORT/, "false: the report is the call's answer");
  assert.equal(calls.length, 4, "the background report reopened the turn");
  assert.match(textOf(calls[3].messages.at(-1)), /your background sub-agent sa_[0-9a-f]{8} \("Scan"\) finished[\s\S]*LATE REPORT/);
});

// (fails before: no — a guard the mutation pass asked for: nothing checked that a pause hands its resume the turn's own
// background launches alone, never the developer's own launch running beside them, HarnessV3-Views V6-17)
test("a pause hands its resume the turn's own background launches, never the developer's", async () => {
  const gate = deferred();
  const { registry } = scripted(async () => {
    await gate.promise;
    return { report: "LATE" };
  });
  const theirs = await registry.launch({ origin: "owner", chainId: "c1", prompt: "theirs" });
  assert.ok(theirs.ok);
  const door = openDoor(registry);
  const r = await door.subagents.run({ id: "a1", input: { description: "Scan", prompt: "SCAN", run_in_background: true }, emit: () => {}, signal: null });
  const ours = String(/sa_[0-9a-f]{8}/.exec(String(r.text))?.[0]);
  assert.deepEqual(door.close(), { own: [ours], runs: ["turn-1"] }, "the turn's own launch alone, and its run");
  const resumed = openDoor(registry, { runId: "turn-2", before: { own: [ours], runs: ["turn-1"] } });
  const owed = resumed.inbox.owed();
  assert.ok(owed, "the resumed turn may not end before its launch reports");
  gate.resolve();
  await owed;
  resumed.close();
});

// (fails before: yes — a report carried its spend only into the run that launched it, and the answer to a pause opens
// a new run: the resumed turn counted none of what its launches spent, whether a report came during the pause or after
// the answer)
test("what a turn's launches spend counts on it across a pause — a report that came while it waited, and one after the answer — and never on another turn", async () => {
  /** @type {Record<string, ReturnType<typeof deferred>>} */
  const gates = { SOON: deferred(), LATER: deferred(), AWAY: deferred() };
  const { registry } = scripted(async ({ body }) => {
    const said = JSON.stringify(body.messages);
    await gates[/** @type {string} */ (Object.keys(gates).find((k) => said.includes(k)))].promise;
    return { report: "REPORTED", spentUsd: 0.25 };
  });
  /** @param {ReturnType<typeof openDoor>} door @param {string} id @param {string} prompt */
  const launch = async (door, id, prompt) => String(/sa_[0-9a-f]{8}/.exec(String((await door.subagents.run({ id, input: { description: prompt, prompt, run_in_background: true }, emit: () => {}, signal: null })).text))?.[0]);
  /** @param {ReturnType<typeof openDoor>} door */
  const counts = (door) => door.inbox.take().map((d) => [d.from, d.spentUsd, d.roundIds.length]);
  const asking = openDoor(registry);
  const soon = await launch(asking, "a1", "SOON");
  const later = await launch(asking, "a2", "LATER");
  const soFar = asking.close();
  gates.SOON.resolve();
  await until(() => registry.get(soon)?.status === "done", "the first report, while the turn waits on its question");
  const resumed = openDoor(registry, { runId: "turn-2", before: soFar });
  assert.deepEqual(counts(resumed), [[soon, 0.25, 1]], "the report that came during the pause");
  gates.LATER.resolve();
  await resumed.inbox.arrival();
  assert.deepEqual(counts(resumed), [[later, 0.25, 1]], "and the one after the answer");
  resumed.close();
  // A turn that reads what another turn launched counts none of it.
  const gone = openDoor(registry, { runId: "turn-3" });
  const away = await launch(gone, "a3", "AWAY");
  gone.close();
  const next = openDoor(registry, { runId: "turn-4" });
  gates.AWAY.resolve();
  await next.inbox.arrival();
  assert.deepEqual(counts(next), [[away, 0, 0]]);
  next.close();
});

// BUG-12 (2026-09-30): the loop waited for every background sub-agent before it heard any report or any message the
// developer typed — three reports and three messages arrived together 42 minutes after the first one landed.
/** Two background launches, one fast, one held; `settle` lets the slow one finish. */
const fastAndSlow = () => {
  const slow = deferred();
  let slowDone = false;
  const { registry } = scripted(async ({ body }) => {
    if (/SLOW/.test(textOf(body.messages.at(-1)))) {
      await slow.promise;
      slowDone = true;
      return { report: "SLOW REPORT" };
    }
    return { report: "FAST REPORT" };
  });
  return { registry, settle: () => slow.resolve(), get slowDone() { return slowDone; } };
};
const launchTwo = () => reply([
  toolUse("a1", "agent", { description: "Fast", prompt: "FAST", run_in_background: true }),
  toolUse("a2", "agent", { description: "Slow", prompt: "SLOW", run_in_background: true }),
]);

test("each background report reaches the model the moment it lands, while the others still run", async () => {
  const s = fastAndSlow();
  /** @type {{ body: any, slowDone: boolean }[]} */
  const calls = [];
  /** @type {any[]} */
  const events = [];
  const { args, door } = turnOn(s.registry, {
    onEvent: (e) => events.push(e),
    call: async ({ body }) => {
      calls.push({ body: structuredClone(body), slowDone: s.slowDone });
      if (calls.length === 1) return launchTwo();
      if (calls.length === 2) {
        setTimeout(() => s.settle(), 3000).unref?.(); // the old loop would wait for this; the new one must not
        return reply([{ type: "text", text: "I'll wait for both." }]);
      }
      if (calls.length === 3) {
        s.settle();
        return reply([{ type: "text", text: "The fast one is in; still waiting." }]);
      }
      return reply([{ type: "text", text: "Both are in." }]);
    },
  });
  const out = await runAgentTurn(args);
  door.close();
  assert.equal(out.status, "done");
  assert.equal(calls.length, 4, "one round per report");
  const third = textOf(calls[2].body.messages.at(-1));
  assert.match(third, /FAST REPORT/, "the fast report went out on its own round");
  assert.doesNotMatch(third, /SLOW REPORT/);
  assert.equal(calls[2].slowDone, false, "… while the slow sub-agent was still running");
  assert.match(textOf(calls[3].body.messages.at(-1)), /SLOW REPORT/);
  const reports = events.filter((e) => e.type === "subagent-report" && e.kind === "report");
  assert.equal(reports.length, 2);
  assert.notEqual(reports[0].round, reports[1].round, "each report is marked at its own round on the timeline");
});

test("a message the developer types while the turn waits on sub-agents reaches the model at once", async () => {
  const s = fastAndSlow();
  /** @type {any[]} */
  const queue = [];
  /** @type {(() => void)[]} */
  const waiters = [];
  const mailbox = {
    read: () => queue.splice(0),
    next: () => (queue.length ? Promise.resolve() : new Promise((r) => waiters.push(() => r(undefined)))),
  };
  /** @type {{ body: any, slowDone: boolean }[]} */
  const calls = [];
  const { args, door } = turnOn(s.registry, {
    mailbox,
    call: async ({ body }) => {
      calls.push({ body: structuredClone(body), slowDone: s.slowDone });
      if (calls.length === 1) return reply([toolUse("a2", "agent", { description: "Slow", prompt: "SLOW", run_in_background: true })]);
      if (calls.length === 2) {
        setTimeout(() => {
          queue.push({ id: "n1", kind: "note", text: "also check the logs" });
          for (const w of waiters.splice(0)) w();
        }, 100).unref?.();
        setTimeout(() => s.settle(), 3000).unref?.();
        return reply([{ type: "text", text: "Waiting on the slow one." }]);
      }
      if (calls.length === 3) {
        s.settle();
        return reply([{ type: "text", text: "Heard you; still waiting." }]);
      }
      return reply([{ type: "text", text: "Done." }]);
    },
  });
  const out = await runAgentTurn(args);
  door.close();
  assert.equal(out.status, "done");
  const third = textOf(calls[2].body.messages.at(-1));
  assert.match(third, /also check the logs/, "the note went out on the next round");
  assert.doesNotMatch(third, /SLOW REPORT/, "… not held back until the sub-agent reported");
  assert.equal(calls[2].slowDone, false);
  assert.match(textOf(calls[3].body.messages.at(-1)), /SLOW REPORT/, "the report still arrives, on its own round");
});

// BUG-12's Detach (the owner's ask): a foreground sub-agent holds its launching call until it reports;
// the developer can free the main agent from it — with its report still coming as a message, or kept for themselves.
/** A foreground launch held on a gate that opens by itself after 3 s (so a loop that cannot detach still ends). */
const heldForeground = () => {
  const gate = deferred();
  setTimeout(() => gate.resolve(), 3000).unref?.();
  const { registry, marks } = scripted(async () => {
    await gate.promise;
    return { report: "LONG REPORT" };
  });
  return { registry, marks, open: () => gate.resolve() };
};

test("detach and auto-report: the launching call answers at once, the sub-agent runs on, its report arrives as a message", async () => {
  const s = heldForeground();
  /** @type {any[]} */
  const calls = [];
  let id = "";
  const { args, door } = turnOn(s.registry, {
    onEvent: (e) => {
      if (e.type === "subagent-start" && !id) {
        id = e.agentId;
        setTimeout(() => s.registry.detach?.(id, { report: true }), 20);
      }
    },
    call: async ({ body }) => {
      calls.push(structuredClone(body));
      if (calls.length === 1) return reply([toolUse("a1", "agent", { run_in_background: false, description: "Long", prompt: "LONG" })]);
      if (calls.length === 2) {
        setTimeout(() => s.open(), 50);
        return reply([{ type: "text", text: "Carrying on without it." }]);
      }
      return reply([{ type: "text", text: "Its report is in." }]);
    },
  });
  const out = await runAgentTurn(args);
  door.close();
  assert.equal(out.status, "done");
  const answered = calls[1].messages.at(-1).content.find((/** @type {any} */ c) => c.type === "tool_result");
  assert.match(String(answered?.content), /the developer sent sub-agent sa_[0-9a-f]{8} \("Long"\) to the background, freeing this call/, "the call answered when the developer sent it to the background, not with the report");
  assert.doesNotMatch(String(answered?.content), /LONG REPORT/);
  assert.equal(calls.length, 3, "the turn waited for the detached sub-agent's report");
  assert.match(textOf(calls[2].messages.at(-1)), /LONG REPORT/, "… which arrived as a message of its own");
  assert.equal(s.registry.get(id)?.background, true);
});

test("detach without report: the call answers at once, the turn may end, the report stays the developer's to send on", async () => {
  const s = heldForeground();
  /** @type {any[]} */
  const calls = [];
  let id = "";
  const { args, door } = turnOn(s.registry, {
    onEvent: (e) => {
      if (e.type === "subagent-start" && !id) {
        id = e.agentId;
        setTimeout(() => s.registry.detach?.(id, { report: false }), 20);
      }
    },
    call: async ({ body }) => {
      calls.push(structuredClone(body));
      if (calls.length === 1) return reply([toolUse("a1", "agent", { run_in_background: false, description: "Long", prompt: "LONG" })]);
      return reply([{ type: "text", text: "Done without it." }]);
    },
  });
  const t0 = Date.now();
  const out = await runAgentTurn(args);
  door.close();
  assert.equal(out.status, "done");
  assert.ok(Date.now() - t0 < 2500, "the turn did not wait for the sub-agent");
  assert.equal(calls.length, 2);
  const answered = calls[1].messages.at(-1).content.find((/** @type {any} */ c) => c.type === "tool_result");
  assert.match(String(answered?.content), /the developer sent sub-agent sa_[0-9a-f]{8} \("Long"\) to the background and took its report/);
  assert.match(String(answered?.content), /goes to the developer/);
  s.open();
  await until(() => s.registry.get(id)?.status === "done", "the detached sub-agent to finish");
  const sent = s.registry.send(id, "c1");
  assert.equal(sent.ok, true, `the developer can pass its report on: ${JSON.stringify(sent)}`);
  // (fails before: no — a guard the mutation pass asked for: nothing checked that a report the developer took over and
  // sends on counts on no turn, the launching turn's resumed half included)
  const resumed = openDoor(s.registry, { runId: "turn-2", before: { own: [], runs: ["turn-1"] } });
  assert.deepEqual(resumed.inbox.take().map((d) => [d.from, d.sent, d.toolCalls, d.roundIds]), [[id, true, 0, []]], "the developer's to count, not the turn's");
  resumed.close();
});

test("the windows name memory's brief: the viewer's block is Memory brief · N lines under the brain, the heads say memory brief, and the Agents widget's switch is on unless the settings say off (M7-1, M7-D11)", () => {
  const viewer = readFileSync("src/ui/harness/subagent-viewer.js", "utf8");
  assert.deepEqual([openingWords({ kind: "brief", count: 3 }), openingWords({ kind: "brief", count: 1 })], ["Memory brief · 3 lines", "Memory brief · 1 line"]);
  assert.match(viewer, /html: b\.kind === "brief" \? ICONS\.brain : patch \? ICONS\.fileDiff : ICONS\.messageSquare \}\), h\("span", \{\}, openingWords\(b\)\)/);
  assert.match(viewer, /sa\.memory \? "memory brief" : ""/);
  assert.match(readFileSync("src/ui/harness/conversation/subagent-marks.js", "utf8"), /m\.memory \? "memory brief" : ""/);
});

test("the sub-agent window offers Detach for a running foreground launch of the agent's, through the session's detach route", () => {
  const viewer = readFileSync("src/ui/harness/subagent-viewer.js", "utf8");
  assert.match(viewer, /running\(\) && !sa\.background && sa\.origin === "agent"/, "only a launch the main agent waits on");
  assert.match(viewer, /routes\.detach\(id, report\)/);
  assert.match(readFileSync("src/ui/harness/lib/subagents.js", "utf8"), /\/detach`, \{ report \}/);
  assert.match(readFileSync("src/http/admin/sessions.js", "utf8"), /"\/sessions\/:id\/subagents\/:sid\/detach"/);
});

test("detach is refused for a sub-agent that is not a running foreground launch", async () => {
  const s = heldForeground();
  let id = "";
  /** @type {any} */
  let refused = null;
  const { args, door } = turnOn(s.registry, {
    onEvent: (e) => {
      if (e.type === "subagent-start" && !id) {
        id = e.agentId;
        setTimeout(() => {
          refused = s.registry.detach?.(id, { report: true });
          s.open();
        }, 20);
      }
    },
    call: async ({ body }) => (body.messages.length === 1 ? reply([toolUse("a1", "agent", { description: "Bg", prompt: "BG", run_in_background: true })]) : reply([{ type: "text", text: "ok" }])),
  });
  await runAgentTurn(args);
  door.close();
  assert.equal(refused?.ok, false);
  assert.match(String(refused?.error), /background/);
  assert.equal(s.registry.detach("sa_nope", { report: true }).ok, false);
});

test("a stop typed while the turn waits on a sub-agent ends the turn", async () => {
  const gate = deferred();
  const { registry } = scripted(async () => {
    await gate.promise;
    return { report: "never read" };
  });
  let read = 0;
  let n = 0;
  const { args, door } = turnOn(registry, {
    mailbox: { read: () => (++read === 3 ? [{ id: "m1", kind: "stop", text: "enough" }] : []) },
    call: async () => (++n === 1 ? reply([toolUse("a1", "agent", { description: "Slow", prompt: "SLOW", run_in_background: true })]) : reply([{ type: "text", text: "waiting" }])),
  });
  const out = await runAgentTurn(args);
  door.close();
  gate.resolve();
  assert.equal(out.status, "stopped");
});

test("the page hangs a sub-agent's events on its launching call's stub", () => {
  const { byRound } = alignEvents([
    { type: "tool-start", round: 1, id: "a1", name: "agent", args: "Find the routes", card: { kind: "subagent", title: "agent", subject: "Find the routes" } },
    { type: "subagent-start", round: 1, parent: "a1", agentId: "sa_0123abcd", description: "Find the routes", agent: "scout", model: "m", prompt: "TASK A" },
    { type: "subagent-tool-start", round: 1, parent: "a1", id: "r1", name: "read", args: "routes.js", card: { kind: "read", title: "Read", subject: "routes.js" } },
    { type: "subagent-tool-end", round: 1, parent: "a1", id: "r1", name: "read", ok: true, ms: 3, chars: 120 },
    { type: "subagent-end", round: 1, parent: "a1", agentId: "sa_0123abcd", status: "done", ok: true, ms: 900, rounds: 2, toolCalls: 1, tokensIn: 300, tokensOut: 40, report: "REPORT A" },
    { type: "tool-end", round: 1, id: "a1", name: "agent", ok: true, ms: 910, chars: 8 },
  ]);
  const cell = byRound.get(1);
  assert.deepEqual(cell.order, ["a1"], "the sub-agent's own calls are not the round's");
  const stub = cell.tools.get("a1");
  assert.equal(stub.state, "done");
  assert.deepEqual([stub.sub.agent, stub.sub.agentId, stub.sub.state, stub.sub.tokens, stub.sub.report, stub.sub.prompt], ["scout", "sa_0123abcd", "done", 340, "REPORT A", "TASK A"]);
  assert.deepEqual(stub.sub.order, ["r1"]);
});

// (fails before: yes — HarnessV3-Views V3's drive: a worker that asked the developer read "Starting · in the
// background" on its launch's row all the while, beside its order row's "asks you")
test("a worker's waiting call reads on its launch's row as its order row says it, until it is settled", () => {
  const events = [
    { type: "tool-start", round: 1, id: "a1", name: "agent", args: "Check node's version", card: { kind: "subagent", title: "agent", subject: "Check node's version" } },
    { type: "subagent-start", round: 1, parent: "a1", agentId: "sa_1", description: "Check node's version", agent: "tester", model: "m", team: "methodical", role: "tester", prompt: "P", background: true },
    { type: "tool-end", round: 1, id: "a1", name: "agent", ok: true, ms: 5, chars: 8 },
    { type: "subagent-ask", round: 1, parent: "a1", agentId: "sa_1", tool: "bash", args: "node --version", question: "May I run this command?" },
  ];
  const sub = (/** @type {any[]} */ evs) => alignEvents(evs).byRound.get(1).tools.get("a1").sub;
  assert.deepEqual(sub(events).asking, { tool: "bash", args: "node --version" });
  assert.equal(sub([...events, { type: "subagent-ask-end", round: 1, parent: "a1", agentId: "sa_1", answered: true }]).asking, null, "settled");
  // TG2-D49: a worker's question to its lead reads as that, beside the developer's own "Asks you" — and its plan, while
  // its lead reviews it, as its plan (TG2-D50).
  assert.match(readFileSync("src/ui/harness/conversation/tools/render.js", "utf8"), /\[s\?\.asking \? \(s\.asking\.to === "lead" \? \(s\.asking\.plan \? "Sent its lead its plan" : "Asks its lead"\) : "Asks you"\) : now && named \? line\(/, "the row's words");
});

// (fails before: yes — no rowWords: a row named the launch's line, so a follow-up's task showed nowhere on the panel)
test("a sub-agent's row names its newest exchange and says follow-up; its title says where it began (HarnessV3-Launch RD-D5)", () => {
  const ex = (/** @type {string} */ description) => ({ prompt: "p", description, by: /** @type {const} */ ("agent"), runId: null, status: "done", startedAt: 0, endedAt: 1, delivery: /** @type {const} */ ("tool") });
  const once = /** @type {any} */ ({ id: "sa_519b27d3", card: { tag: "scout", name: "Scout", kind: "worker" }, description: "List src exports", exchanges: [ex("List src exports")] });
  // (fails before: yes — HarnessV4_Tasks E15 step 4: a worker's row named its task alone, whatever card it ran as)
  assert.deepEqual(rowWords(once), { name: "Scout: List src exports", followUp: false, title: "Open its conversation" });
  const again = { ...once, exchanges: [ex("List src exports"), ex("Check retry path coverage")] };
  assert.deepEqual(rowWords(again), { name: "Scout: Check retry path coverage", followUp: true, title: "Open its conversation — it began as “List src exports”" });
  // A team's worker says its role on its own card: the row's words leave the name out.
  assert.equal(rowWords({ ...once, card: { tag: "builder", name: "Builder", kind: "worker" }, team: { key: "architect", name: "Architect", role: "builder" } }).name, "List src exports");
  // (fails before: yes — HarnessV4_Tasks E15 step 2, found by hand in the browser: the running turn's panel listed four
  // saved agents as four rows of the same question)
  assert.equal(rowWords({ ...once, card: { tag: "pm", name: "PM", kind: "lead" }, description: "should this queue or fail?" }).name, "PM: should this queue or fail?");
  assert.equal(rowWords({ ...again, card: { tag: "pm", name: "PM", kind: "lead" } }).name, "PM: Check retry path coverage");
  const panel = readFileSync("src/ui/harness/conversation/status-panel.js", "utf8");
  assert.match(panel, /const w = rowWords\(r\);/);
  assert.match(panel, /title: w\.title, onclick: \(\) => cb\.onOpenSubagent\?\.\(r\.id\) \}, w\.name\)/);
  assert.match(panel, /\[asks \? "asks you" : r\.status === "running" \? r\.model : statusWord\(r\.status\), took, w\.followUp \? "follow-up" : ""\]\.filter\(Boolean\)\.join\(" · "\)/);
});

test("the page puts the developer's marks in the round they happened and folds the main agent's reading of them in", () => {
  // The loop stamps a report with the round that just ended: it joins the conversation before the next one.
  const { byRound } = alignEvents([
    { type: "subagent-dispatch", round: 0, agentId: "sa_1", exchange: 0, description: "Audit", model: "m", view: "folded", inform: true, deliver: true, pause: false },
    { type: "subagent-arrival", round: 0, agentId: "sa_3", exchange: 1, description: "Quick", status: "done", ms: 50, rounds: 1, toolCalls: 0, delivery: "auto" },
    { type: "round-start", round: 1, blocksBefore: 0 },
    { type: "subagent-dispatch", round: 1, agentId: "sa_2", exchange: 0, description: "Aside", model: "m", deliver: false },
    { type: "subagent-report", round: 1, agentId: "sa_1", description: "Audit", kind: "notice" },
    { type: "subagent-report", round: 1, agentId: "sa_3", description: "Quick", kind: "report" },
    { type: "round-start", round: 2, blocksBefore: 1 },
    { type: "subagent-arrival", round: 2, agentId: "sa_1", exchange: 0, description: "Audit", status: "done", ms: 900, rounds: 2, toolCalls: 3, delivery: "auto" },
    { type: "subagent-arrival", round: 2, agentId: "sa_2", exchange: 0, description: "Aside", status: "done", ms: 400, rounds: 1, toolCalls: 0, delivery: "held" },
    { type: "subagent-report", round: 2, agentId: "sa_1", description: "Audit", kind: "report" },
    { type: "round-start", round: 3, blocksBefore: 2 },
    { type: "subagent-report", round: 3, agentId: "sa_2", description: "Aside", kind: "report", sent: true },
    { type: "subagent-report", round: 3, agentId: "sa_9", description: "Other", kind: "report" },
  ]);
  const zero = byRound.get(0);
  assert.deepEqual(zero.marks.map((/** @type {any} */ m) => [m.event, m.agentId, m.exchange]), [["dispatch", "sa_1", 0], ["arrival", "sa_3", 1]]);
  assert.equal(zero.marks[0].told, true, "the notice the loop read makes the dispatch 'told', not a row of its own");
  assert.equal(zero.marks[1].read, 2, "a report that arrived before round 1 is read before round 2");
  const two = byRound.get(2);
  assert.deepEqual([two.marks[0].agentId, two.marks[0].read], ["sa_1", "here"], "read at the top of the round after the one it arrived in: it joined here");
  assert.deepEqual([two.marks[1].delivery, two.marks[1].read], ["held", undefined], "a report kept aside is not the main agent's");
  assert.deepEqual([byRound.get(1).reports, two.reports], [[], []], "nothing drawn twice");
  assert.deepEqual(byRound.get(3).reports, [{ agentId: "sa_2", kind: "report", description: "Aside", sent: true }, { agentId: "sa_9", kind: "report", description: "Other" }], "a report sent on is a row where it was read; one this run never marked is a row of its own");
});

// HarnessV3-FixRound item 31, decision 23. (fails before: the row had no carried turn to read, and the feed's word no
// rows to rewrite)
test("a between-turns row says where its report went — goes, then went with the next turn or a later one — and the feed rewrites the rows that waited", () => {
  const m = /** @type {any} */ ({ event: "arrival", agentId: "sa_1", exchange: 0, description: "Audit", afterTurn: 4 });
  assert.equal(arrivalWhere(m, true), " — its report goes with the main agent's next turn");
  assert.equal(arrivalWhere({ ...m, carriedBy: 5 }, true), " — its report went with the next turn");
  assert.equal(arrivalWhere({ ...m, carriedBy: 7 }, true), " — its report went with turn 7", "a command turn came between");
  assert.equal(arrivalWhere({ ...m, carriedBy: 5 }, false), " — the main agent reads it at its next step", "a running turn's row reads its rounds");
  const launch = { type: "subagent", event: "dispatch", agentId: "sa_1", exchange: 0, inform: true, afterTurn: 4 };
  const arrival = { type: "subagent", ...m };
  const other = { type: "subagent", event: "arrival", agentId: "sa_2", exchange: 0, afterTurn: 4 };
  const turns = [{ n: 4, boundaries: [], boundariesAfter: [launch, arrival, other] }, { n: 5, boundaries: [], boundariesAfter: [] }];
  const changed = carryMarks(turns, { turn: 5, carried: [{ agentId: "sa_1", exchange: 0, kind: "notice" }, { agentId: "sa_1", exchange: 0, kind: "report" }] });
  assert.deepEqual(changed.map((t) => t.n), [4], "only the turn holding the rows is drawn again");
  assert.deepEqual([/** @type {any} */ (launch).told, /** @type {any} */ (arrival).carriedBy, /** @type {any} */ (other).carriedBy], [true, 5, undefined]);
  assert.deepEqual(carryMarks(turns, { turn: 6, carried: [{ agentId: "sa_1", exchange: 1, kind: "report" }] }), [], "another exchange's report is not this row's");
  const told = { type: "subagent", event: "dispatch", agentId: "sa_3", exchange: 0, inform: true, afterTurn: 4 };
  const back = { type: "subagent", event: "arrival", agentId: "sa_3", exchange: 0, afterTurn: 4 };
  carryMarks([{ n: 4, boundaries: [], boundariesAfter: [told, back] }], { turn: 5, carried: [{ agentId: "sa_3", exchange: 0, kind: "notice" }] });
  assert.deepEqual([/** @type {any} */ (told).told, /** @type {any} */ (back).carriedBy], [true, undefined], "a turn that carried the launch's notice alone: the report still waits");
  const marks = readFileSync(new URL("../src/ui/harness/conversation/subagent-marks.js", import.meta.url), "utf8");
  assert.match(marks, /if \(!held\) where\.textContent = arrivalWhere\(m, between\);/, "the row reads its place between turns (a source contract: the row builds real DOM; the hand test draws it)");
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  assert.match(app, /if \(msg\?\.type !== "subagent-carried"\) return;[\s\S]{0,200}for \(const t of carryMarks\(chat\.turns, msg\)\) transcript\.drawBoundaries\(t\);/, "the page rewrites the rows as the feed says it (a source contract: the page boots a DOM at import)");
});

test("/subagent parses its key=value options before the task, keeps the task's own words and lines, and knows its verbs", () => {
  assert.deepEqual(parseSubagentCommand("/subagent"), { action: "list", raw: "/subagent", command: "/subagent" });
  const l = /** @type {any} */ (parseSubagentCommand("/subagent model=m-2 view=folded may=read pause=on inform=yes  find the bug\nin the parser"));
  assert.deepEqual([l.action, l.model, l.view, l.may, l.pause, l.inform, l.wait, l.prompt], ["launch", "m-2", "folded", "read", true, true, null, "find the bug\nin the parser"]);
  // (fails before: yes — memory=off launched one with no memory brief; the owner's of 11-09: memory is core, and the
  // word, no option now, is said rather than handed to the sub-agent as its task's first)
  assert.deepEqual(/** @type {any} */ (parseSubagentCommand("/subagent memory=off look")), { action: "unknown", arg: "memory=off (memory= is not an option: memory's brief opens every sub-agent's task while this chat's memory is on)", raw: "/subagent memory=off look", command: "/subagent" });
  // (fails before: yes — type= was an option the launch read; unread, it would open the task and run as Helper)
  assert.deepEqual(/** @type {any} */ (parseSubagentCommand("/subagent type=explore look")), { action: "unknown", arg: "type=explore (type= is not an option: as=reviewer asks the Reviewer, who only reads, and may=read holds any launch to reading)", raw: "/subagent type=explore look", command: "/subagent" });
  assert.equal(/** @type {any} */ (parseSubagentCommand("/subagent ask sa_0123abcd type=explore is what I typed")).prompt, "type=explore is what I typed", "a follow-up's words are its own");
  assert.equal(/** @type {any} */ (parseSubagentCommand("/subagent wait=off look")).wait, false);
  const words = /** @type {any} */ (parseSubagentCommand("/subagent wait for the tests, then explore memory use"));
  assert.deepEqual([words.wait, words.may, words.prompt], [null, null, "wait for the tests, then explore memory use"], "a bare word is the task's, never an option");
  assert.match(/** @type {any} */ (parseSubagentCommand("/subagent pause=maybe look")).arg, /pause= takes on or off/);
  assert.deepEqual(/** @type {any} */ (parseSubagentCommand("/subagent sa_0123abcd")), { action: "show", id: "sa_0123abcd", raw: "/subagent sa_0123abcd", command: "/subagent" });
  const a = /** @type {any} */ (parseSubagentCommand("/subagent ask sa_0123abcd wait=on check again"));
  assert.deepEqual([a.action, a.id, a.prompt, a.wait], ["ask", "sa_0123abcd", "check again", true]);
  assert.deepEqual(/** @type {any} */ (parseSubagentCommand("/subagent send SA_0123ABCD")), { action: "send", id: "sa_0123abcd", raw: "/subagent send SA_0123ABCD", command: "/subagent" });
  assert.equal(/** @type {any} */ (parseSubagentCommand("/subagent send sa_0123abcd now")).action, "unknown", "send takes the id alone");
  assert.deepEqual(/** @type {any} */ (parseSubagentCommand("/subagent apply sa_0123abcd")), { action: "apply", id: "sa_0123abcd", raw: "/subagent apply sa_0123abcd", command: "/subagent" });
  assert.deepEqual(/** @type {any} */ (parseSubagentCommand("/subagent changes sa_0123abcd")), { action: "changes", id: "sa_0123abcd", raw: "/subagent changes sa_0123abcd", command: "/subagent" });
  assert.equal(/** @type {any} */ (parseSubagentCommand("/subagent apply sa_0123abcd please")).action, "unknown", "apply takes the id alone");
  const w = /** @type {any} */ (parseSubagentCommand("/subagent worktree=off view=fork edit in place"));
  assert.deepEqual([w.action, w.worktree, w.view, w.prompt], ["launch", false, "fork", "edit in place"]);
  assert.equal(/** @type {any} */ (parseSubagentCommand("/subagent look")).worktree, null, "left out: the session's choice");
  assert.equal(/** @type {any} */ (parseSubagentCommand("/subagent stop nope")).action, "unknown");
  assert.equal(/** @type {any} */ (parseSubagentCommand("/subagent pause=on")).action, "unknown", "options with no task");
  assert.equal(parseSubagentCommand("/subagents list"), null);
});

test("a fork copies the main agent's request as it stands: every message, its launching call answered, one note and the task — on the main agent's model, its furniture handed to the host", async () => {
  /** @type {any} */
  let host = null;
  const { registry, posts } = scripted(async ({ id }) => {
    host = registry.hostOf(id);
    return { report: "FORKED REPORT" };
  });
  const base = { model: "m-big", max_tokens: 64000, thinking: { type: "enabled", budget_tokens: 2048 }, system: "SYS", tools: [{ name: "read" }, { name: "agent" }] };
  const convo = [
    { role: "user", content: "fix the parser" },
    { role: "assistant", content: [{ type: "thinking", thinking: "hm", signature: "sig" }, toolUse("toolu_f", "agent", { description: "look", prompt: "look again", context: "fork" }), toolUse("toolu_r", "read", { path: "a" })] },
  ];
  const door = openDoor(registry, { model: "m-big", fork: () => ({ body: { ...base, messages: structuredClone(convo) }, headers: {} }) });
  const res = await door.subagents.run({ id: "toolu_f", input: { run_in_background: false, description: "look", prompt: "look again", context: "fork" }, emit: () => {}, signal: null });
  assert.match(res.text, /^FORKED REPORT/);
  assert.deepEqual([posts[0].body.model, posts[0].body.thinking], ["agent/m-big", base.thinking], "the main agent's model and thinking, whatever the session's sub-agent model says");
  assert.deepEqual([host.fork.system, host.fork.tools, host.fork.thinking, host.fork.maxTokens], ["SYS", base.tools, base.thinking, 64000], "the host runs on the main agent's furniture");
  assert.deepEqual(host.fork.messages.slice(0, 2), convo, "every message, byte for byte");
  assert.deepEqual(host.fork.messages[2].content, [
    { type: "tool_result", tool_use_id: "toolu_f", content: SUBAGENT_NOTES.forkOwnCall },
    { type: "tool_result", tool_use_id: "toolu_r", content: SUBAGENT_NOTES.forkOtherCall },
    { type: "text", text: `${SUBAGENT_NOTES.fork}\n\n${BUILDER_WORDS}\n\nlook again` },
  ]);
  assert.deepEqual(posts[0].body.messages, host.fork.messages, "the request carries the same messages the host runs on");
  // The host knows where its own task stands (turn.js `exchangesGiveWay` keeps that message as its start): after the
  // main agent's messages it carries, in the message the launching call's results and the task make.
  assert.equal(host.fork.opens, convo.length, "how many of the main agent's messages it opens with");
  assert.equal(forkTaskAt(host.fork.messages, host.fork.opens), 2, "its task's message, found from what the host is handed");
  const sa = /** @type {any} */ (registry.list("c1")[0]);
  assert.deepEqual([sa.view, sa.model], ["fork", "m-big"]);
  const whole = /** @type {any} */ (registry.detail(sa.id));
  assert.deepEqual([whole.opening[0].kind, whole.opening[0].count], ["fork", 2]);
  const other = registry.launch({ origin: "owner", chainId: "c1", prompt: "x", view: "fork", model: "m-small" });
  assert.match(String(other.ok ? "" : other.error), /a fork runs on the main agent's model \(m-big\), whose cache it reads/);
  door.close();
  const none = registry.launch({ origin: "owner", chainId: "c2", prompt: "x", view: "fork" });
  assert.match(String(none.ok ? "" : none.error), /a fork copies the main agent's newest request, which Filament holds only while a turn runs/, "nothing to copy: said, not guessed");
  // (fails before: yes — it said to choose "the full view", a view a sub-agent no longer has: Hunter's of 10-31)
  const instead = String(none.ok ? "" : none.error).match(/or choose (\w+):/)?.[1];
  assert.ok(instead && Object.hasOwn(SUBAGENT_VIEWS, instead) && instead !== "fork", `the view it offers instead is one a launch can choose (${instead})`);
});

// The owner's word of 11-02: forks only from small parents — a fork carries the main agent's conversation into every
// round of its own.
// (fails before: yes — a fork launched by name was never weighed: one of a 251,000-token conversation started, half its
// own 400,000-token line past before its first round)
test("a fork is refused in words where the main agent's conversation is past half the fork's own line, and starts where it is not", async () => {
  const config = () => ({ agentLoop: {}, upstreams: [{ id: "m", name: "m", type: "anthropic", baseUrl: "http://127.0.0.1:9", apiKey: "s", enabled: true, pricing: { "m-big": { input: 1, output: 1, contextTokens: 1_000_000 } } }], routes: [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }] });
  const { registry } = scripted(async () => ({ report: "FORKED" }), {}, { config });
  const base = { model: "m-big", max_tokens: 100, system: "SYS", tools: [] };
  const convo = [{ role: "user", content: "fix the parser" }, { role: "assistant", content: [{ type: "text", text: "Looking." }] }];
  let tokens = 250_000;
  const door = openDoor(registry, { model: "m-big", fork: () => ({ body: { ...base, messages: structuredClone(convo) }, headers: {} }), cache: () => ({ body: { ...base, messages: convo }, headers: {}, sentAt: Date.now(), ttlMs: 300_000, cached: true, tokens, reply: 1_000 }) });
  const big = registry.launch({ origin: "owner", chainId: "c1", prompt: "look", view: "fork" });
  assert.equal(big.ok ? "" : big.error, "the main agent's conversation is 251,000 tokens, past half a fork's 400,000-token compaction line: a fork would carry all of it into every round and compact almost at once — choose folded or none, and put what it needs in the task");
  tokens = 199_000;
  const small = registry.launch({ origin: "owner", chainId: "c1", prompt: "look", view: "fork" });
  assert.ok(small.ok, JSON.stringify(small));
  assert.equal((await (small.ok && small.done))?.report, "FORKED");
  door.close();
});

// (fails before: yes — the bug hunt of 11-02: with no window known a fork launched by name was weighed against no line
// at all, so one of a 61,000-token conversation started, past half the 108,800-token line of the window assumed for it)
test("with no window known a fork is weighed against the assumed window's line: refused in words past half of it, started under it", async () => {
  const config = () => ({ agentLoop: {}, upstreams: [{ id: "m", name: "m", type: "anthropic", baseUrl: "http://127.0.0.1:9", apiKey: "s", enabled: true }], routes: [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }] });
  const { registry } = scripted(async () => ({ report: "FORKED" }), {}, { config });
  const base = { model: "m-big", max_tokens: 100, system: "SYS", tools: [] };
  const convo = [{ role: "user", content: "fix the parser" }, { role: "assistant", content: [{ type: "text", text: "Looking." }] }];
  let tokens = 60_000;
  const door = openDoor(registry, { model: "m-big", fork: () => ({ body: { ...base, messages: structuredClone(convo) }, headers: {} }), cache: () => ({ body: { ...base, messages: convo }, headers: {}, sentAt: Date.now(), ttlMs: 300_000, cached: true, tokens, reply: 1_000 }) });
  const big = registry.launch({ origin: "owner", chainId: "c1", prompt: "look", view: "fork" });
  assert.equal(big.ok ? "" : big.error, "the main agent's conversation is 61,000 tokens, past half a fork's 108,800-token compaction line: a fork would carry all of it into every round and compact almost at once — choose folded or none, and put what it needs in the task");
  tokens = 53_000;
  const small = registry.launch({ origin: "owner", chainId: "c1", prompt: "look", view: "fork" });
  assert.ok(small.ok, JSON.stringify(small));
  assert.equal((await (small.ok && small.done))?.report, "FORKED");
  door.close();
});

// (fails before: yes — the bug hunt of 11-02: a fork was weighed by the newest request's count, the request before the
// one in flight, while it copies the conversation as it stands: a 40,000-token result read since let a 230,000-token
// conversation fork under a 400,000-token line)
test("a fork of a running turn is weighed by the conversation it copies where that is larger than the newest request's count", async () => {
  const config = () => ({ agentLoop: {}, upstreams: [{ id: "m", name: "m", type: "anthropic", baseUrl: "http://127.0.0.1:9", apiKey: "s", enabled: true, pricing: { "m-big": { input: 1, output: 1, contextTokens: 1_000_000 } } }], routes: [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }] });
  const { registry } = scripted(async () => ({ report: "FORKED" }), {}, { config });
  const base = { model: "m-big", max_tokens: 100, system: "SYS", tools: [] };
  const convo = [{ role: "user", content: "fix the parser" }, { role: "assistant", content: [{ type: "text", text: "Looking." }] }];
  /** What the loop weighs its conversation as it stands. @type {number | null} */
  let now = 230_000;
  const door = openDoor(registry, { model: "m-big", fork: () => ({ body: { ...base, messages: structuredClone(convo) }, headers: {}, tokens: now }), cache: () => ({ body: { ...base, messages: convo }, headers: {}, sentAt: Date.now(), ttlMs: 300_000, cached: true, tokens: 180_000, reply: 1_000 }) });
  const big = registry.launch({ origin: "owner", chainId: "c1", prompt: "look", view: "fork" });
  assert.match(big.ok ? "" : big.error, /^the main agent's conversation is 230,000 tokens, past half a fork's 400,000-token compaction line/);
  // Just after a fold the conversation is the smaller: the newest request's count, rounds behind, still weighs it.
  now = 90_000;
  const folded = registry.launch({ origin: "owner", chainId: "c1", prompt: "look", view: "fork" });
  assert.ok(folded.ok, JSON.stringify(folded));
  await (folded.ok && folded.done);
  now = null;
  const unknown = registry.launch({ origin: "owner", chainId: "c1", prompt: "look", view: "fork" });
  assert.ok(unknown.ok, "no weight from the loop: the newest request's count alone");
  await (unknown.ok && unknown.done);
  assert.equal(forkWeight(181_000, 230_000), 230_000);
  assert.equal(forkWeight(181_000, 90_000), 181_000);
  assert.equal(forkWeight(181_000, null), 181_000);
  door.close();
});

test("between turns a fork copies the last turn's newest request while Filament keeps it, and is refused once that lifetime is over", async () => {
  let t = 1_000_000;
  /** @type {any} */
  let host = null;
  const { registry } = scripted(async ({ id }) => {
    host = registry.hostOf(id);
    return { report: "ok" };
  }, {}, { now: () => t });
  const kept = { model: "m", max_tokens: 100, system: "S", tools: [], messages: [{ role: "user", content: "hi" }, { role: "assistant", content: [{ type: "text", text: "hello" }] }] };
  const door = openDoor(registry, { cache: () => ({ body: kept, headers: {}, sentAt: t, ttlMs: 300_000, cached: true, tokens: 50 }) });
  door.close();
  assert.equal(registry.cacheOf("c1").forkable, true);
  const r = await registry.launch({ origin: "owner", chainId: "c1", prompt: "go on", view: "fork" });
  assert.ok(r.ok, JSON.stringify(r));
  await (r.ok && r.done);
  assert.deepEqual(host.fork.messages, [...kept.messages, { role: "user", content: [{ type: "text", text: `${SUBAGENT_NOTES.fork}\n\n${BUILDER_WORDS}\n\ngo on` }] }], "the kept request, its reply, then the note, its card's words and the task");
  t += 300_001;
  const late = await registry.launch({ origin: "owner", chainId: "c1", prompt: "again", view: "fork" });
  assert.equal(late.ok, false, "past the cache's lifetime there is nothing to fork");
});

// (fails before: yes — the owner's of 11-05: "if cache is warm then simply use that fork behind the scene and the models
// and efforts should exactly match the main agent's": Catch me up read the session folded, on its card's model, always)
test("Catch me up starts as a live copy of the main agent where its cache is warm, a fork pays and its model has a seat — else as its view says", async () => {
  let t = 1_000_000;
  /** @type {any} */
  let host = null;
  let pool = [{ model: "", seats: 2 }];
  const { registry } = scripted(async ({ id }) => {
    host = registry.hostOf(id);
    return { report: "Five lines." };
  }, { settings: () => ({ subagents: { pool }, loop: { permissions: "edit" } }) }, { now: () => t });
  const base = { model: "m", max_tokens: 100, thinking: { type: "enabled", budget_tokens: 1024 }, system: "S", tools: [{ name: "read" }] };
  const messages = [{ role: "user", content: "fix the parser" }, { role: "assistant", content: [{ type: "text", text: "Fixed it." }] }];
  let turns = 0;
  /** A turn closes, its newest request kept as this snapshot says. @param {Record<string, any> | null} snap */
  const turnEnds = (snap) => openDoor(registry, { runId: `turn-${++turns}`, cache: snap ? () => ({ body: { ...base, messages }, headers: {}, sentAt: t, ttlMs: 300_000, cached: true, tokens: 50, ...snap }) : null }).close();
  /** Catch me up, as its start launches it. @param {Record<string, any>} [more] */
  const catchUp = async (more = {}) => {
    host = null;
    const r = registry.launch({ origin: "owner", chainId: "c1", prompt: CATCH_UP_TASK, worker: "reviewer", may: "read", view: "folded", running: true, since: "message", deliver: false, warm: true, ...more });
    assert.ok(r.ok, JSON.stringify(r));
    await (r.ok && r.done);
    const sa = /** @type {any} */ (registry.get(r.ok ? r.id : ""));
    return { view: sa.view, model: sa.model, fork: host?.fork || null };
  };
  turnEnds({});
  const warm = await catchUp();
  assert.deepEqual([warm.view, warm.model], ["fork", "m"], "a live copy, on the main agent's model");
  assert.deepEqual([warm.fork?.system, warm.fork?.tools, warm.fork?.thinking], ["S", base.tools, base.thinking], "its system prompt, tools and thinking, as sent");
  assert.deepEqual(warm.fork?.messages.slice(0, 2), messages, "the conversation as the provider caches it");
  assert.match(JSON.stringify(warm.fork?.messages[2]), /Catch me up\. In five lines/);
  assert.deepEqual([(await catchUp({ effort: "low" })).view, (await catchUp({ model: "m" })).view], ["folded", "folded"], "an effort or a model named: as its view says");
  turnEnds({ cached: false });
  assert.equal((await catchUp()).view, "folded", "a request that read and wrote no cache");
  turnEnds({ tokens: 60_000 });
  assert.equal((await catchUp()).view, "folded", "past half the line a fork would carry");
  turnEnds({});
  pool = [{ model: "other", seats: 2 }];
  const seatless = await catchUp();
  assert.deepEqual([seatless.view, seatless.model], ["folded", "other"], "no seat for the main agent's model");
  pool = [{ model: "", seats: 2 }];
  t += 300_001;
  assert.equal((await catchUp()).view, "folded", "the cache's lifetime over");
  // A turn that sent no request of Filament's (a coding agent's) lets the older one go: a copy of it would miss that turn.
  t += 1;
  turnEnds({});
  assert.equal(registry.cacheOf("c1").state, "warm");
  turnEnds(null);
  assert.equal(registry.cacheOf("c1").state, "none");
  assert.equal((await catchUp()).view, "folded");
});

test("a fork's copy of the main agent's tools offers ask, plan and agent: each call is answered in words, never run or paused on", async () => {
  /** @type {any[]} */
  const calls = [];
  /** @type {any[]} */
  const events = [];
  const out = await runAgentTurn(/** @type {any} */ ({
    model: "m",
    root,
    readerModel: "",
    maxTokens: 100,
    thinking: null,
    costOf: () => 0,
    runHand: async (/** @type {string} */ name) => `${name} ran`,
    delegateRead: null,
    permissions: null,
    rules: [],
    hooks: null,
    mcpReadOnly: new Set(),
    messages: [{ role: "user", content: "go" }],
    system: "S",
    tools: toolSetFor({ delegateRead: false }),
    modeNow: () => "auto",
    subagents: null,
    inbox: null,
    unattended: "subagent",
    notCallable: FORK_REFUSALS,
    mailbox: null,
    tree: null,
    onEvent: (/** @type {any} */ e) => events.push(e),
    sink: sink(),
    signal: null,
    resume: null,
    call: async (/** @type {any} */ { body }) => {
      calls.push(structuredClone(body));
      return calls.length === 1
        ? reply([toolUse("p1", "plan", { items: [{ text: "x", status: "doing" }] }), toolUse("q1", "ask", { question: "which?" }), toolUse("g1", "agent", { run_in_background: false, description: "d", prompt: "p" }), toolUse("r1", "read", { path: "a" })])
        : reply([{ type: "text", text: "done" }]);
    },
  }));
  assert.equal(out.status, "done", JSON.stringify(out.notes));
  const results = calls[1].messages.at(-1).content;
  assert.deepEqual(results.map((/** @type {any} */ b) => [b.tool_use_id, b.is_error === true, b.content]), [["p1", true, FORK_REFUSALS.plan], ["q1", true, FORK_REFUSALS.ask], ["g1", true, FORK_REFUSALS.agent], ["r1", false, "read ran"]]);
  assert.ok(!events.some((e) => e.type === "plan" || e.type === "ask"), "no checklist published, no question asked");
});

// (fails before: yes — the review of 3664a7358: a sub-agent that called an MCP tool its server vouches for as read-only
// counted as one that acted, so its run was never sent anew on its next row)
test("an MCP tool its server vouches for as read-only ends saying it read; one that may change something does not", async () => {
  /** @type {any[]} */
  const events = [];
  let n = 0;
  const schema = { type: "object", properties: {} };
  const out = await runAgentTurn(/** @type {any} */ ({
    model: "m",
    root,
    readerModel: "",
    maxTokens: 100,
    thinking: null,
    costOf: () => 0,
    runHand: async (/** @type {string} */ name) => `${name} ran`,
    delegateRead: null,
    permissions: null,
    rules: [],
    hooks: null,
    mcpReadOnly: new Set(["mcp__gh__get_issue"]),
    messages: [{ role: "user", content: "go" }],
    system: "S",
    tools: [...toolSetFor({ delegateRead: false }), { name: "mcp__gh__get_issue", description: "d", input_schema: schema }, { name: "mcp__gh__add_comment", description: "d", input_schema: schema }],
    modeNow: () => "auto",
    subagents: null,
    inbox: null,
    unattended: "subagent",
    mailbox: null,
    tree: null,
    onEvent: (/** @type {any} */ e) => events.push(e),
    sink: sink(),
    signal: null,
    resume: null,
    call: async () => (++n === 1 ? reply([toolUse("g1", "mcp__gh__get_issue", {}), toolUse("a1", "mcp__gh__add_comment", {})]) : reply([{ type: "text", text: "done" }])),
  }));
  assert.equal(out.status, "done", JSON.stringify(out.notes));
  const ends = events.filter((e) => e.type === "tool-end");
  assert.deepEqual(ends.map((e) => [e.name, e.reads === true]).sort(), [["mcp__gh__add_comment", false], ["mcp__gh__get_issue", true]]);
});

// ---- end to end: the real wiring (turn.js host mode, the registry, the REST endpoints, /subagent) ----
/** @type {string} */ let folder;
/** @type {any} */ let up;
/** @type {any} */ let shim;
const CHILD = "You are a sub-agent run by Filament";
/** The main agent's "hold on" call answers once the test lets it: a turn that runs while the test acts. */
let holdGate = deferred();
/** The "audit slowly" sub-agent reports once the test lets it: a turn runs before its report arrives. */
const slowChild = deferred();
/** The "fold warm work" sub-agent's second round answers once the test lets it: a Compact reaches it meanwhile. */
const foldChild = deferred();
/** The calls a request's newest message answers. @param {any} c */
const answersTo = (c) => (Array.isArray(c.body?.messages?.at(-1)?.content) ? c.body.messages.at(-1).content : []).filter((/** @type {any} */ b) => b?.type === "tool_result").map((/** @type {any} */ b) => b.tool_use_id);
/** The words a fork of the loop's conversation is asked for its fold with. */
const FOLD_ASK = /^\[Filament: (this turn has reached the compaction line|the developer asked to compact this turn now)\./;
before(async () => {
  folder = mkdtempSync(join(tmpdir(), "filament-sub-"));
  up = await fakeUpstream(async (call) => {
    const system = JSON.stringify(call.body?.system ?? "");
    const messages = call.body?.messages || [];
    const model = call.body?.model || "m-1";
    // A conversation that says "warm" is one the provider caches: its replies read the prefix back.
    const cached = /warm/.test(JSON.stringify(messages)) ? { cache_read_input_tokens: 100 } : {};
    const blocks = (/** @type {any[]} */ b, stop = "end_turn") => anthropicReply("", { model, stop, blocks: b, usage: { input_tokens: 5, output_tokens: 3, ...cached } });
    const lastText = textOf(messages.at(-1));
    const last = messages.at(-1);
    const answered = Array.isArray(last?.content) && last.content.some((/** @type {any} */ b) => b?.type === "tool_result");
    // A fork of a conversation the loop folds: the summary.
    if (FOLD_ASK.test(lastText)) return blocks([{ type: "text", text: "<summary>\nTHE WARM WORK, FOLDED\n</summary>" }]);
    if (system.includes(CHILD)) {
      // A writing child the developer compacts as it works: a write, a read the test holds, then its report.
      if (/fold warm work/.test(textOf(messages[0]))) {
        if (answersTo(call).includes("toolu_fw2")) return blocks([{ type: "text", text: "FOLDED IT" }]);
        if (!answersTo(call).includes("toolu_fw1")) return blocks([{ type: "tool_use", id: "toolu_fw1", name: "write", input: { path: "warm.txt", content: "warm\n" } }], "tool_use");
        await foldChild.promise;
        return blocks([{ type: "tool_use", id: "toolu_fw2", name: "read", input: { path: "warm.txt" } }], "tool_use");
      }
      if (/audit slowly/.test(textOf(messages[0]))) await slowChild.promise;
      // A writing child: one write through the hands, then its report.
      if (/write made\.txt/.test(textOf(messages[0]))) return answered ? blocks([{ type: "text", text: "WROTE IT" }]) : blocks([{ type: "tool_use", id: "toolu_w1", name: "write", input: { path: "made.txt", content: "hello from the sub-agent\n" } }], "tool_use");
      return blocks([{ type: "text", text: /check again/.test(lastText) ? "SECOND REPORT" : "CHILD REPORT" }]);
    }
    // A fork: the main agent's own conversation and Filament's note after it. It reaches for plan first, then reports.
    if (JSON.stringify(messages).includes("from here on you are a sub-agent")) {
      const refused = Array.isArray(last?.content) && last.content.some((/** @type {any} */ b) => b?.type === "tool_result" && b.content === FORK_REFUSALS.plan);
      return refused ? blocks([{ type: "text", text: "FORK REPORT" }]) : blocks([{ type: "tool_use", id: "toolu_p1", name: "plan", input: { items: [{ text: "look", status: "doing" }] } }], "tool_use");
    }
    if (/The developer's task:/.test(lastText)) return blocks([{ type: "text", text: "Title: Map the folder\n\nBRIEF FROM THE FORK" }]);
    if (lastText === "hold on") await holdGate.promise;
    if (answered) return blocks([{ type: "text", text: "PARENT DONE" }]);
    if (/map it/.test(lastText)) return blocks([{ type: "tool_use", id: "toolu_a1", name: "agent", input: { run_in_background: false, description: "Map the folder", prompt: "List what is here and report." } }], "tool_use");
    if (/fork it/.test(lastText)) return blocks([{ type: "tool_use", id: "toolu_f1", name: "agent", input: { run_in_background: false, description: "Forked look", prompt: "Look again, as me.", context: "fork" } }], "tool_use");
    return blocks([{ type: "text", text: "PLAIN ANSWER" }]);
  });
  shim = await startApp({
    memory: true,
    keep: true,
    configure: (cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
      cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
      cfg.memory.autopilot = { enabled: false };
    },
  });
});
after(async () => {
  await shim.stop();
  await up.close();
  for (const dir of [shim.dataDir, folder]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

const isChild = (/** @type {any} */ c) => JSON.stringify(c.body?.system ?? "").includes(CHILD);
const newSession = async () => {
  const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1" } });
  assert.equal(s.status, 200, await s.clone().text());
  return String((await s.json()).id);
};
/** Wait until the session's sub-agents have all reported. @param {string} id @returns {Promise<any[]>} */
/**
 * How long a wait on a sub-agent's report is given: a writer in a session's repository works in its own copy, a git
 * worktree made for it, which a full suite's load spreads over many times the second it takes alone.
 */
const WORK = { timeoutMs: 60_000 };
const settled = (id) =>
  until(async () => {
    const { subagents } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json();
    return subagents.length && subagents.every((/** @type {any} */ s) => s.status !== "running") ? subagents : null;
  }, "the session's sub-agents to report", WORK);

// (fails before: yes — HarnessV4_ShippedAgents_Plan SA2: no agent had tools of its own to go without)
test("a sub-agent whose card goes without the shell is offered none of it, and its prompt says so; put back, it has it again", async () => {
  const off = await shim.api("/api/agents/builder", { method: "PUT", body: { toolsOff: ["shell"] } });
  assert.equal(off.status, 200, await off.clone().text());
  try {
    const id = await newSession();
    const mark = up.received.length;
    const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "map it", stream: false } });
    assert.equal(t.status, 200, await t.clone().text());
    const child = up.received.slice(mark).find(isChild);
    assert.ok(child, "a sub-agent ran");
    const names = child.body.tools.map((/** @type {any} */ x) => x.name);
    for (const gone of ["bash", "bash_background", "bash_output", "bash_kill", "powershell"]) assert.ok(!names.includes(gone), `${gone} is not offered: ${names}`);
    assert.ok(names.includes("read") && names.includes("write"), "writing files is its level's, never a switch");
    assert.match(JSON.stringify(child.body.system), /Not offered in this session \(the developer switched them off\): bash/);
    await settled(id);
  } finally {
    assert.equal((await shim.api("/api/agents/builder", { method: "PUT", body: { toolsOff: null } })).status, 200);
  }
  const id = await newSession();
  const mark = up.received.length;
  await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "map it", stream: false } });
  const child = up.received.slice(mark).find(isChild);
  assert.ok(child?.body.tools.some((/** @type {any} */ x) => x.name === "bash"), "put back: the shell again");
  await settled(id);
});

// (fails before: yes — the recall tool rode only once a fold, a cap or a results policy hid something: a fresh
// session's ticks and its sub-agent's went without it, and the first fold changed the tools under the cached prefix)
test("a fresh session's ticks and its sub-agent's each offer filament_recall from the first", async () => {
  const id = await newSession();
  const mark = up.received.length;
  const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "map it", stream: false } });
  assert.equal(t.status, 200, await t.clone().text());
  const calls = up.received.slice(mark).filter((/** @type {any} */ c) => Array.isArray(c.body?.tools));
  assert.ok(calls.some(isChild) && calls.filter((/** @type {any} */ c) => !isChild(c)).length >= 2, `the session's two ticks and the sub-agent's: ${calls.length}`);
  for (const c of calls) {
    const names = c.body.tools.map((/** @type {any} */ x) => x.name);
    assert.ok(names.includes("filament_recall"), `${isChild(c) ? "the sub-agent's" : "the session's"} tick: ${names}`);
  }
  await settled(id);
});

test("a harness turn's sub-agent is a request and a run of its own, offered no ask, plan or agent; its report is the call's result", async () => {
  const id = await newSession();
  const mark = up.received.length;
  const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "map it", stream: false } });
  assert.equal(t.status, 200, await t.clone().text());
  assert.match(await t.clone().text(), /PARENT DONE/);
  const calls = up.received.slice(mark);
  const child = calls.find(isChild);
  assert.ok(child, "a sub-agent ran");
  const childNames = child.body.tools.map((/** @type {any} */ x) => x.name);
  for (const never of ["ask", "plan", "agent", "wait"]) assert.ok(!childNames.includes(never), `${never} is not offered to the sub-agent: ${childNames}`);
  assert.ok(childNames.includes("envelope"), "its envelope writes the agent that launched it (the owner's of 11-04)");
  assert.equal(textOf(child.body.messages[0]), "List what is here and report.", "no view unless one is asked for");
  const launcherLast = calls.filter((/** @type {any} */ c) => !isChild(c)).at(-1);
  const result = launcherLast.body.messages.at(-1).content.find((/** @type {any} */ b) => b?.type === "tool_result");
  assert.match(textOf({ content: result.content }) || String(result.content), /^CHILD REPORT/);
  const rid = String(t.headers.get("x-filament-request-id"));
  const page = await (await shim.api(`/api/runs/${encodeURIComponent(rid)}/events?since=0`)).json();
  const end = page.events.find((/** @type {any} */ e) => e.type === "subagent-end");
  assert.deepEqual([end.parent, end.ok, end.report], ["toolu_a1", true, "CHILD REPORT"]);
  // The main loop's end state, for the meter: its newest round as the provider counted it, and the sub-agent's
  // launching call and report inside it — what the sub-agent occupies of the main agent's window.
  const turnRec = await shim.record(rid);
  assert.equal(turnRec.context?.last?.held, 5, "the newest round's prompt, as the provider counted it");
  assert.equal(turnRec.context.last.composition.subagentCalls, 1);
  const launch = JSON.stringify({ description: "Map the folder", prompt: "List what is here and report." }).length;
  assert.ok(turnRec.context.last.composition.subagents > launch + "CHILD REPORT".length, "its call and its whole result, Filament's words around the report included");
  const [sa] = await settled(id);
  assert.equal(sa.origin, "agent");
  const reqs = (await (await shim.api("/api/requests?scope=all&limit=100")).json()).requests;
  const host = reqs.find((/** @type {any} */ r) => r.id === sa.runId);
  assert.deepEqual([host?.source, host?.subagentOf, host?.subagent], ["subagent", rid, sa.id], "its own record, under the turn that launched it");
  const { run } = await (await shim.api(`/api/runs/${encodeURIComponent(sa.runId)}`)).json();
  assert.deepEqual([run.kind, run.parentId], ["subagent", rid]);
});

test("the developer's launch: REST spawns it, inform and the report open the session's next turn, a follow-up continues it", async () => {
  const id = await newSession();
  const spawn = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`, { method: "POST", body: { prompt: "audit the folder", description: "Audit", inform: true } });
  assert.equal(spawn.status, 200, await spawn.clone().text());
  const { subagent } = await spawn.json();
  assert.equal(subagent.origin, "owner");
  const [done] = await settled(id);
  assert.deepEqual([done.status, done.exchanges[0].report, done.exchanges[0].delivery], ["done", "CHILD REPORT", "auto"]);
  const listed = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json();
  assert.equal(listed.queued, 1, "the report waits for the next turn, and carries the task the unread notice announced");
  const before = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
  assert.deepEqual(
    before.boundaries.filter((/** @type {any} */ b) => b.type === "subagent").map((/** @type {any} */ b) => [b.event, b.agentId, b.afterTurn, b.inform ?? null, b.delivery ?? null]),
    [["dispatch", subagent.id, 0, true, null], ["arrival", subagent.id, 0, null, "auto"]],
    "no turn ran: both marks are the session's, before its first turn",
  );
  const mark = up.received.length;
  const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "hello", stream: false } });
  assert.equal(t.status, 200, await t.clone().text());
  // The head says it at once, so the live page labels the message without a reload (HarnessV3-Readiness RD1 c).
  assert.deepEqual([t.headers.get("x-filament-deliveries"), t.headers.get("x-filament-shell-exits")], ["1", null], "the head counts the report, and no shell's exit");
  const first = up.received.slice(mark).find((/** @type {any} */ c) => !isChild(c));
  const opened = textOf(first.body.messages.at(-1));
  assert.match(opened, /^\[Filament: the developer ran sub-agent [\s\S]*The developer's task for it:\naudit the folder[\s\S]*CHILD REPORT[\s\S]*hello$/);
  assert.doesNotMatch(opened, /launched sub-agent/);
  const transcript = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
  const turn = transcript.turns.at(-1);
  assert.equal(turn.deliveries, 1, "the transcript says which leading blocks were Filament's, not typed");
  assert.equal(textOf({ content: turn.user.content.slice(turn.deliveries) }), "hello");
  const f = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents/${subagent.id}/follow-up`, { method: "POST", body: { prompt: "check again" } });
  assert.equal(f.status, 200, await f.clone().text());
  const after2 = await settled(id);
  const again = after2.find((/** @type {any} */ s) => s.id === subagent.id);
  assert.deepEqual([again.exchanges.length, again.exchanges[1].report, again.exchanges[1].by], [2, "SECOND REPORT", "owner"]);
  const followCall = up.received.filter(isChild).at(-1);
  assert.ok(followCall.body.messages.some((/** @type {any} */ m) => m.role === "assistant" && /CHILD REPORT/.test(textOf(m))), "the follow-up carries its first report");
  const later = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
  assert.deepEqual(
    later.boundaries.filter((/** @type {any} */ b) => b.type === "subagent" && b.afterTurn === 1).map((/** @type {any} */ b) => [b.event, b.exchange, b.followUp ?? false]),
    [["dispatch", 1, true], ["arrival", 1, false]],
    "the follow-up from the viewer is marked after the turn it followed",
  );
});

// HarnessV3-FixRound item 31, decision 23. (fails before: no turn recorded what it carried, so the rows kept "is told"
// and "its report goes with the main agent's next turn" after that turn had carried them)
test("a turn that carries a between-turns message records it: the launch was told, the arrival names its turn, said on the feed as the stamp lands", async () => {
  const id = await newSession();
  const feed = readEvents(await shim.api("/api/events"));
  const said = () => feed.events.filter((/** @type {any} */ e) => e.data?.type === "subagent-carried" && e.data.chainId === id).map((/** @type {any} */ e) => e.data);
  const rows = async () => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json()).boundaries.filter((/** @type {any} */ b) => b.type === "subagent").map((/** @type {any} */ b) => [b.event, b.afterTurn, b.told ?? null, b.carriedBy ?? null]);
  /** @param {string} content */
  const send = async (content) => {
    const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(t.status, 200, await t.clone().text());
  };
  try {
    await until(() => feed.events.some((/** @type {any} */ e) => e.data?.type === "hello"), "the feed to open");
    const spawn = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`, { method: "POST", body: { prompt: "audit slowly", description: "Slow audit", inform: true } });
    assert.equal(spawn.status, 200, await spawn.clone().text());
    const { subagent } = await spawn.json();
    assert.deepEqual(await rows(), [["dispatch", 0, null, null]], "the notice waits for the next turn");
    await send("hello");
    await until(() => said().length === 1, "the first turn's carry to be said");
    assert.deepEqual(said()[0], { type: "subagent-carried", chainId: id, turn: 1, carried: [{ agentId: subagent.id, exchange: 0, kind: "notice" }] });
    assert.deepEqual(await rows(), [["dispatch", 0, true, null]], "turn 1 told the main agent of the launch");
    slowChild.resolve();
    await settled(id);
    assert.deepEqual(await rows(), [["dispatch", 0, true, null], ["arrival", 1, null, null]], "the report waits: no turn has carried it yet");
    await send("/status");
    assert.deepEqual(said().length, 1, "a command defers the report and carries nothing");
    // The report still waits, so it wakes the chat once the command's turn lets go (the owner's of 10-28): turn 3,
    // Filament's own, carries it. The developer's next message goes once that turn has let go, as the page sends it:
    // sent while it ran, it was refused (409, "a turn is already running", under a parallel run of 11-10).
    await until(() => said().length === 2, "the third turn's carry to be said");
    await until(async () => ((await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json()).live ? null : true), "the third turn to let go");
    await send("carry on");
    assert.deepEqual(said()[1], { type: "subagent-carried", chainId: id, turn: 3, carried: [{ agentId: subagent.id, exchange: 0, kind: "report" }] });
    assert.deepEqual(await rows(), [["dispatch", 0, true, null], ["arrival", 1, null, 3]], "the report went with turn 3, past the command");
  } finally {
    await feed.stop();
  }
});

test("a launch kept aside: marked between turns, its report the developer's until they send it, then it opens the next turn", async () => {
  const id = await newSession();
  const spawn = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`, { method: "POST", body: { prompt: "audit quietly", description: "Quiet audit", deliver: false } });
  assert.equal(spawn.status, 200, await spawn.clone().text());
  const { subagent } = await spawn.json();
  const refused = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`, { method: "POST", body: { prompt: "x", deliver: false, pause: true } });
  assert.equal(refused.status, 400, "a report kept aside cannot hold the main agent");
  const [done] = await settled(id);
  assert.deepEqual([done.aside, done.exchanges[0].delivery], [true, "held"]);
  assert.equal((await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json()).queued, 0, "nothing went to the main agent");
  const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
  assert.deepEqual(
    tr.boundaries.filter((/** @type {any} */ b) => b.type === "subagent").map((/** @type {any} */ b) => [b.event, b.deliver ?? null, b.delivery ?? null]),
    [["dispatch", false, null], ["arrival", null, "held"]],
  );
  const s = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents/${subagent.id}/send`, { method: "POST", body: {} });
  assert.equal(s.status, 200, await s.clone().text());
  const sent = await s.json();
  assert.deepEqual([sent.into, sent.subagent.exchanges[0].delivery], ["queue", "sent"]);
  const twice = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents/${subagent.id}/send`, { method: "POST", body: {} });
  assert.equal(twice.status, 409);
  assert.match((await twice.json()).error, /already with the main agent/);
  const kept = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
  assert.deepEqual(kept.subagentSent, [`${subagent.id}:0`], "the session records the send: its arrival row reads it once the registry forgets the sub-agent");
  assert.deepEqual(kept.boundaries.filter((/** @type {any} */ b) => b.type === "subagent").map((/** @type {any} */ b) => b.event), ["dispatch", "arrival"], "a send is no row of its own");
  const mark = up.received.length;
  const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "hello", stream: false } });
  assert.equal(t.status, 200, await t.clone().text());
  // This chat's request: another test's chat may be woken meanwhile by a follow-up's report, its turn a request too.
  const first = up.received.slice(mark).find((/** @type {any} */ c) => !isChild(c) && /hello$/.test(textOf(c.body.messages.at(-1))));
  assert.match(textOf(first.body.messages.at(-1)), /^\[Filament: the developer is passing you the report of sub-agent sa_[0-9a-f]{8} \("Quiet audit"\), which ran on the side and finished[\s\S]*CHILD REPORT[\s\S]*hello$/);
});

// (fails before: yes — BW-8, AG-128: the route took no `when`; a note released nothing)
test("Send with my next message, through the routes: the running turn does not read the report by itself, a note into it carries one along, and the other opens the next message's turn", async () => {
  const id = await newSession();
  const sub = `/api/sessions/${encodeURIComponent(id)}/subagents`;
  for (const description of ["Audit one", "Audit two"]) {
    const spawn = await shim.api(sub, { method: "POST", body: { prompt: `audit ${description}`, description, deliver: false } });
    assert.equal(spawn.status, 200, await spawn.clone().text());
  }
  const both = await settled(id);
  const [one, two] = ["Audit one", "Audit two"].map((d) => both.find((/** @type {any} */ s) => s.description === d));
  const queued = async () => (await (await shim.api(sub)).json()).queued;
  holdGate = deferred();
  const mark = up.received.length;
  const turn = shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "hold on", stream: false } });
  try {
    await until(() => up.received.slice(mark).some((/** @type {any} */ c) => textOf(c.body?.messages?.at(-1)) === "hold on"), "the turn's first call to reach the upstream");
    const bad = await shim.api(`${sub}/${one.id}/send`, { method: "POST", body: { when: "soon" } });
    assert.deepEqual([bad.status, (await bad.json()).error], [400, 'when is "now" or "next"']);
    const s = await shim.api(`${sub}/${one.id}/send`, { method: "POST", body: { when: "next" } });
    assert.equal(s.status, 200, await s.clone().text());
    const sent = await s.json();
    assert.deepEqual([sent.into, sent.subagent.exchanges[0].delivery, await queued()], ["queue", "sent", 1]);
    const { runs } = await (await shim.api("/api/runs?kind=agent-turn")).json();
    const live = runs.find((/** @type {any} */ x) => x.status === "running" && x.meta?.chain === id);
    assert.ok(live, "the turn's run");
    const stop = await shim.api(`/api/runs/${encodeURIComponent(live.id)}/steer`, { method: "POST", body: { kind: "veto", text: "not that", from: "harness" } });
    assert.equal((await stop.json()).carried, undefined, "only their note is their next message");
    const note = await shim.api(`/api/runs/${encodeURIComponent(live.id)}/steer`, { method: "POST", body: { kind: "note", text: "read what I sent", from: "harness" } });
    assert.equal(note.status, 200, await note.clone().text());
    assert.deepEqual([(await note.json()).carried, await queued()], [1, 0], "the note carried it into the turn");
    const s2 = await shim.api(`${sub}/${two.id}/send`, { method: "POST", body: { when: "next" } });
    assert.equal((await s2.json()).into, "queue");
  } finally {
    holdGate.resolve();
  }
  const t = await turn;
  assert.equal(t.status, 200, await t.clone().text());
  const mine = up.received.slice(mark).filter((/** @type {any} */ c) => !isChild(c));
  const read = mine.map((/** @type {any} */ c) => textOf(c.body.messages.at(-1))).join("\n\u0000\n");
  assert.match(read, /the developer is passing you the report of sub-agent sa_[0-9a-f]{8} \("Audit one"\)/, "the turn read the one the note carried");
  assert.match(read, /read what I sent/);
  assert.doesNotMatch(JSON.stringify(mine.map((/** @type {any} */ c) => c.body.messages)), /Audit two/, "and never the one that waits for the next message");
  assert.equal(await queued(), 1);
  const from = up.received.length;
  const next = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "hello", stream: false } });
  assert.equal(next.status, 200, await next.clone().text());
  const first = up.received.slice(from).find((/** @type {any} */ c) => !isChild(c));
  assert.match(textOf(first.body.messages.at(-1)), /^\[Filament: the developer is passing you the report of sub-agent sa_[0-9a-f]{8} \("Audit two"\), which ran on the side and finished[\s\S]*CHILD REPORT[\s\S]*hello$/);
  assert.equal(await queued(), 0);
});

test("the developer's launch while a turn runs is marked on that turn's timeline at its round, and its report joins the turn before it ends", async () => {
  const id = await newSession();
  holdGate = deferred();
  const mark = up.received.length;
  const turn = shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "hold on", stream: false } });
  /** @type {any} */
  let subagent;
  try {
    await until(() => up.received.slice(mark).some((/** @type {any} */ c) => textOf(c.body?.messages?.at(-1)) === "hold on"), "the turn's first call to reach the upstream");
    const { cache } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json();
    assert.equal(cache.running, true, "the turn is in its first round");
    const spawn = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`, { method: "POST", body: { prompt: "look while it works", description: "Side look" } });
    assert.equal(spawn.status, 200, await spawn.clone().text());
    ({ subagent } = await spawn.json());
    await settled(id);
  } finally {
    // The held call answers whatever happened above: a failed assertion must not leave the turn waiting forever.
    holdGate.resolve();
  }
  const t = await turn;
  assert.equal(t.status, 200, await t.clone().text());
  const rid = String(t.headers.get("x-filament-request-id"));
  const { events } = await (await shim.api(`/api/runs/${encodeURIComponent(rid)}/events?since=0`)).json();
  const marks = events.filter((/** @type {any} */ e) => e.type === "subagent-dispatch" || e.type === "subagent-arrival");
  assert.deepEqual(marks.map((/** @type {any} */ e) => [e.type, e.round, e.agentId, e.may ?? null, e.delivery ?? null]), [["subagent-dispatch", 1, subagent.id, "edit", null], ["subagent-arrival", 1, subagent.id, null, "auto"]]);
  const report = events.find((/** @type {any} */ e) => e.type === "subagent-report");
  assert.deepEqual([report?.agentId, report?.kind, report?.round], [subagent.id, "report", 1]);
  const last = up.received.slice(mark).filter((/** @type {any} */ c) => !isChild(c)).at(-1);
  assert.match(textOf(last.body.messages.at(-1)), /^\[Filament: the developer ran sub-agent [\s\S]*alongside you[\s\S]*CHILD REPORT/, "the loop's next call carries it");
  assert.equal(alignEvents(events).byRound.get(1).marks[1].read, "here");
  const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
  assert.equal(tr.boundaries.filter((/** @type {any} */ b) => b.type === "subagent").length, 0, "a running turn carries its own marks: none on the session");
});

/** A request as the provider reads it, less the cache markers (which move to the newest user message). @param {any} v */
const unmarked = (v) => JSON.parse(JSON.stringify(v ?? null, (k, x) => (k === "cache_control" ? undefined : x)));

test("Enhance after a turn forks its newest request while the cache is warm: the provider reads the same prefix, then the reply and the instruction", async () => {
  const id = await newSession();
  const cold = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json();
  assert.equal(cold.cache.state, "none", "no turn yet: nothing to fork");
  const mark = up.received.length;
  const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "keep this warm", stream: false } });
  assert.equal(t.status, 200, await t.clone().text());
  const tick = up.received.slice(mark).filter((/** @type {any} */ c) => !isChild(c)).at(-1);
  const { cache } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json();
  assert.deepEqual([cache.state, cache.running, cache.ttlMs, cache.model], ["warm", false, 300_000, "m-1"]);
  assert.ok(cache.leftMs > 250_000 && cache.leftMs <= 300_000, `${cache.leftMs}`);
  const at = up.received.length;
  const e = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents/enhance`, { method: "POST", body: { prompt: "map the folder", readOnly: true, view: "folded" } });
  assert.equal(e.status, 200, await e.clone().text());
  const out = await e.json();
  assert.deepEqual([out.how, out.title, out.text, out.usage?.cacheRead], ["fork", "Map the folder", "BRIEF FROM THE FORK", 100]);
  const fork = up.received[at];
  assert.equal(fork.body.model, tick.body.model);
  assert.deepEqual(unmarked(fork.body.system), unmarked(tick.body.system), "the same system prompt");
  assert.deepEqual(unmarked(fork.body.tools), unmarked(tick.body.tools), "the same tools");
  const n = tick.body.messages.length;
  assert.deepEqual(unmarked(fork.body.messages.slice(0, n)), unmarked(tick.body.messages), "every message the turn's last call sent, byte for byte");
  assert.deepEqual([fork.body.messages[n].role, textOf(fork.body.messages[n])], ["assistant", "PLAIN ANSWER"], "then its reply");
  assert.match(textOf(fork.body.messages[n + 1]), /read-only[\s\S]*folded rendering[\s\S]*The developer's task:\nmap the folder$/, "then the instruction, the newest user text");
  assert.equal(fork.body.messages.length, n + 2);
  const reqs = (await (await shim.api("/api/requests?scope=all&limit=100")).json()).requests;
  const rec = reqs.find((/** @type {any} */ r) => r.id === out.requestId);
  assert.equal(rec?.subagentOf, "owner", "booked on the session, never on the turn it forked");
  const transcript = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
  assert.equal(transcript.turns.length, 1, "nothing of the fork joined the conversation");
});

// (fails before: yes — the owner's words of 10-29: the cache's lifetime was the route's rules alone, five minutes on the
// Anthropic API, and no chat could choose an hour for a long session)
test("a chat's cache lifetime: model.cacheTtl 1h asks the provider for an hour on the markers its turn adds, and the cache counts an hour; 5m from the next turn", async () => {
  const id = await newSession();
  const markers = (/** @type {any} */ c) => JSON.stringify(c.body).match(/"cache_control":\{[^}]*\}/g) || [];
  const setTtl = async (/** @type {string} */ ttl) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { model: { cacheTtl: ttl } } } });
    assert.equal(r.status, 200, await r.clone().text());
    return (await r.json()).cache;
  };
  const turn = async (/** @type {string} */ content) => {
    const mark = up.received.length;
    const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(t.status, 200, await t.clone().text());
    return up.received.slice(mark).filter((/** @type {any} */ c) => !isChild(c)).at(-1);
  };
  const before = (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`)).json()).cache;
  assert.deepEqual(before, { ttl: "5m", from: "rules", settable: true }, "the route's rules, which the chat may override");
  assert.deepEqual(await setTtl("1h"), { ttl: "1h", from: "chat", settable: true });
  const hour = await turn("a long session");
  assert.ok(markers(hour).length > 0 && markers(hour).every((m) => m === '"cache_control":{"type":"ephemeral","ttl":"1h"}'), markers(hour).join(" "));
  const { cache } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json();
  assert.equal(cache.ttlMs, 3_600_000, "the cache the turn wrote lasts an hour");
  await setTtl("5m");
  const five = await turn("a short one now");
  assert.ok(markers(five).length > 0 && markers(five).every((m) => m === '"cache_control":{"type":"ephemeral"}'), markers(five).join(" "));
  assert.equal((await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json()).cache.ttlMs, 300_000);
});

test("a fork the agent launches starts from its request byte for byte — model, system prompt, tools, every message — its launching call answered, and plan refused in words", async () => {
  const id = await newSession();
  const mark = up.received.length;
  const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "fork it", stream: false } });
  assert.equal(t.status, 200, await t.clone().text());
  assert.match(await t.clone().text(), /PARENT DONE/);
  const calls = up.received.slice(mark);
  const isFork = (/** @type {any} */ c) => JSON.stringify(c.body?.messages || []).includes("from here on you are a sub-agent");
  const parent = calls.find((/** @type {any} */ c) => !isFork(c) && textOf(c.body?.messages?.at(-1)) === "fork it");
  const forks = calls.filter(isFork);
  assert.ok(parent && forks.length === 2, `the main agent's call and the fork's two: ${calls.length} calls`);
  const [fork, second] = forks;
  assert.deepEqual([fork.body.model, fork.body.max_tokens], [parent.body.model, parent.body.max_tokens]);
  assert.deepEqual(unmarked(fork.body.system), unmarked(parent.body.system), "the main agent's system prompt");
  assert.deepEqual(unmarked(fork.body.tools), unmarked(parent.body.tools), "its tools — agent, ask and plan included");
  assert.ok(fork.body.tools.some((/** @type {any} */ x) => x.name === "plan"));
  const n = parent.body.messages.length;
  assert.deepEqual(unmarked(fork.body.messages.slice(0, n)), unmarked(parent.body.messages), "every message the main agent sent, byte for byte");
  assert.deepEqual(fork.body.messages[n].content.filter((/** @type {any} */ b) => b.type === "tool_use").map((/** @type {any} */ b) => b.id), ["toolu_f1"], "then its reply, the launching call in it");
  const opened = unmarked(fork.body.messages[n + 1].content);
  assert.deepEqual([opened[0].type, opened[0].tool_use_id, opened[0].content], ["tool_result", "toolu_f1", SUBAGENT_NOTES.forkOwnCall]);
  assert.equal(textOf({ content: opened.slice(1) }), `${SUBAGENT_NOTES.fork}\n\n${BUILDER_WORDS}\n\nLook again, as me.`);
  assert.equal(fork.body.messages.length, n + 2);
  const refused = second.body.messages.at(-1).content.find((/** @type {any} */ b) => b.type === "tool_result");
  assert.deepEqual([refused.is_error, refused.content], [true, FORK_REFUSALS.plan]);
  const result = calls.filter((/** @type {any} */ c) => !isFork(c)).at(-1).body.messages.at(-1).content.find((/** @type {any} */ b) => b?.type === "tool_result");
  assert.match(typeof result.content === "string" ? result.content : textOf({ content: result.content }), /^FORK REPORT/, "the fork's report is the call's result");
  const [sa] = await settled(id);
  assert.deepEqual([sa.view, sa.model], ["fork", "m-1"]);
  const rec = await shim.record(sa.runId);
  assert.equal(rec.agent?.fork, true, "its record says it ran as a fork");
});

test("a writing sub-agent works in its own worktree: its changes wait, shown as files and a diff, and apply brings them into the session's folder — once", async () => {
  const repoDir = join(folder, `repo-${Date.now()}`);
  mkdirSync(repoDir);
  const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: repoDir, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(repoDir, "a.txt"), "one\n");
  git("add", "-A");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: repoDir, model: "m-1" } });
  assert.equal(s.status, 200, await s.clone().text());
  const id = String((await s.json()).id);
  const spawn = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`, { method: "POST", body: { prompt: "write made.txt", description: "Writer", deliver: false } });
  assert.equal(spawn.status, 200, await spawn.clone().text());
  const { subagent } = await spawn.json();
  const [done] = await settled(id);
  assert.deepEqual([done.status, done.exchanges[0].report, done.work?.pending, done.work?.files.map((/** @type {any} */ f) => f.path)], ["done", "WROTE IT", 1, ["made.txt"]]);
  assert.equal(existsSync(join(repoDir, "made.txt")), false, "the session's folder is untouched");
  assert.equal(git("status", "--porcelain"), "", "and its repository sees nothing of the worktree");
  const { projects } = await (await shim.api("/api/memory/projects?canon=0")).json();
  assert.deepEqual(projects.filter((/** @type {any} */ p) => /filament-worktrees|sa_[0-9a-f]{8}/.test(`${p.cwd} ${p.name}`)), [], "its worktree never became a project: its requests name the session's folder");
  const c = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents/${subagent.id}/changes`)).json();
  assert.deepEqual(c.files.map((/** @type {any} */ f) => [f.path, f.status, f.added]), [["made.txt", "A", 1]]);
  assert.match(c.diff, /\+hello from the sub-agent/);
  const ap = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents/${subagent.id}/apply`, { method: "POST", body: {} });
  assert.equal(ap.status, 200, await ap.clone().text());
  assert.deepEqual((await ap.json()).subagent.work.applied, 1);
  assert.equal(readFileSync(join(repoDir, "made.txt"), "utf8"), "hello from the sub-agent\n");
  assert.equal(git("status", "--porcelain"), "?? made.txt", "a file in the folder; nothing staged, HEAD where it was");
  const twice = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents/${subagent.id}/apply`, { method: "POST", body: {} });
  assert.equal(twice.status, 409);
  const cmd = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: `/subagent apply ${subagent.id}`, stream: false } });
  assert.match(await cmd.text(), /Nothing applied: sub-agent sa_[0-9a-f]{8} has no changes waiting to be applied/);
});

// (fails before: yes — 10-29: a change brought in by hand, its apply refused, waited for an Apply for good: no route said
// it was in)
test("Mark as applied over HTTP: nothing written and nothing waits; DELETE undoes the mark, its work waiting again; each refused in words where it cannot be", async () => {
  const repoDir = join(folder, `repo-mark-${Date.now()}`);
  mkdirSync(repoDir);
  const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: repoDir, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(repoDir, "a.txt"), "one\n");
  git("add", "-A");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: repoDir, model: "m-1" } });
  const id = String((await s.json()).id);
  const sub = `/api/sessions/${encodeURIComponent(id)}/subagents`;
  const spawn = await shim.api(sub, { method: "POST", body: { prompt: "write made.txt", description: "Writer", deliver: false } });
  assert.equal(spawn.status, 200, await spawn.clone().text());
  const [done] = await settled(id);
  // Brought in by hand.
  writeFileSync(join(repoDir, "made.txt"), "hello from the sub-agent, by hand\n");
  const marked = await shim.api(`${sub}/${done.id}/mark-applied`, { method: "POST", body: {} });
  assert.equal(marked.status, 200, await marked.clone().text());
  const m = await marked.json();
  const w = m.subagent.work;
  assert.deepEqual([m.files.map((/** @type {any} */ f) => f.path), w.pending, w.applied, w.lastApplied.by, w.lastApplied.hand, w.lastApplied.undo], [["made.txt"], 0, 1, "owner", true, true]);
  assert.equal(readFileSync(join(repoDir, "made.txt"), "utf8"), "hello from the sub-agent, by hand\n", "nothing written");
  const again = await shim.api(`${sub}/${done.id}/mark-applied`, { method: "POST", body: {} });
  assert.deepEqual([again.status, (await again.json()).error], [409, `sub-agent ${done.id}'s changes were marked as applied by the developer: nothing of them waits`]);
  const undone = await shim.api(`${sub}/${done.id}/mark-applied`, { method: "DELETE" });
  assert.equal(undone.status, 200, await undone.clone().text());
  const u = (await undone.json()).subagent.work;
  assert.deepEqual([u.pending, u.applied, u.lastApplied], [1, 0, null], "its work waits again");
  const twice = await shim.api(`${sub}/${done.id}/mark-applied`, { method: "DELETE" });
  assert.deepEqual([twice.status, (await twice.json()).error], [409, `sub-agent ${done.id}'s newest apply is no mark as applied: there is none to undo`]);
  const gone = await shim.api(`/api/sessions/nope/subagents/${done.id}/mark-applied`, { method: "POST", body: {} });
  assert.equal(gone.status, 404);
});

/** A repository of one commit under the tests' folder, as a session's folder. @param {string} name */
const repoOf = (name) => {
  const repoDir = join(folder, `${name}-${Date.now()}`);
  mkdirSync(repoDir);
  const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: repoDir, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(repoDir, "a.txt"), "one\n");
  git("add", "-A");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  return repoDir;
};
const APPLIED_LINE = /^\[Filament: the developer applied the changes of sub-agent sa_[0-9a-f]{8} \("Writer"\) to your folder: 1 file changed under you — made\.txt\. What you read of it before may be out of date: read again before you edit\.\]/;

// (fails before: yes — HarnessV4_Tasks E15 step 5 (BW-8, AG-129): the developer's apply told the session's agent
// nothing, so it could edit a file as it remembered it, over the change)
test("the developer's apply tells the main agent in one line which files changed under it: at its running turn's next step, said on the turn's run", async () => {
  const repoDir = repoOf("repo-applied-turn");
  const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: repoDir, model: "m-1" } });
  const id = String((await s.json()).id);
  const sub = `/api/sessions/${encodeURIComponent(id)}/subagents`;
  holdGate = deferred();
  const mark = up.received.length;
  const turn = shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "hold on", stream: false } });
  try {
    await until(() => up.received.slice(mark).some((/** @type {any} */ c) => textOf(c.body?.messages?.at(-1)) === "hold on"), "the turn's first call to reach the upstream");
    const spawn = await shim.api(sub, { method: "POST", body: { prompt: "write made.txt", description: "Writer", deliver: false } });
    assert.equal(spawn.status, 200, await spawn.clone().text());
    const [done] = await settled(id);
    const ap = await shim.api(`${sub}/${done.id}/apply`, { method: "POST", body: {} });
    assert.equal(ap.status, 200, await ap.clone().text());
    assert.equal((await (await shim.api(sub)).json()).queued, 0, "into the turn that runs, not the queue");
  } finally {
    holdGate.resolve();
  }
  const t = await turn;
  assert.equal(t.status, 200, await t.clone().text());
  const last = up.received.slice(mark).filter((/** @type {any} */ c) => !isChild(c)).at(-1);
  assert.match(textOf(last.body.messages.at(-1)), APPLIED_LINE, "the loop's next call carries the line");
  const { events } = await (await shim.api(`/api/runs/${encodeURIComponent(String(t.headers.get("x-filament-request-id")))}/events?since=0`)).json();
  const said = events.find((/** @type {any} */ e) => e.type === "subagent-report");
  assert.deepEqual([said?.kind, said?.description], ["applied", "Writer"]);
  assert.deepEqual(alignEvents(events).byRound.get(said.round).reports.map((/** @type {any} */ r) => [r.kind, r.description]), [["applied", "Writer"]], "its own row on the turn: the page tells it from a report");
});

// (fails before: yes — the same; and a kind the session's queue did not know was kept as a report's, then dropped)
test("an apply while the main agent is idle: its line waits for the developer's next message, through a restart; the main agent's own apply and a command's leave none", async () => {
  /** @param {any} cfg */
  const configure = (cfg) => {
    cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
    cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
    cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
    cfg.memory.autopilot = { enabled: false };
  };
  const one = await startApp({ memory: true, keep: true, configure });
  let oneUp = true;
  /** @type {any} */
  let two = null;
  try {
    const repoDir = repoOf("repo-applied-idle");
    const s = await one.api("/api/sessions", { method: "POST", body: { cwd: repoDir, model: "m-1" } });
    const id = String((await s.json()).id);
    const sub = `/api/sessions/${encodeURIComponent(id)}/subagents`;
    const writer = async () => {
      const spawn = await one.api(sub, { method: "POST", body: { prompt: "write made.txt", description: "Writer", deliver: false } });
      assert.equal(spawn.status, 200, await spawn.clone().text());
      const { subagent } = await spawn.json();
      await until(async () => (await (await one.api(sub)).json()).subagents.every((/** @type {any} */ x) => x.status !== "running"), "the writer to report", WORK);
      return String(subagent.id);
    };
    const first = await writer();
    // A command's apply: its answer stands in the chat the agent reads.
    const cmd = await one.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: `/subagent apply ${first}`, stream: false } });
    assert.match(await cmd.text(), /Applied/);
    assert.equal((await (await one.api(sub)).json()).queued, 0, "a command's apply queues no line");
    execFileSync("git", ["clean", "-fdq"], { cwd: repoDir });
    const second = await writer();
    const ap = await one.api(`${sub}/${second}/apply`, { method: "POST", body: {} });
    assert.equal(ap.status, 200, await ap.clone().text());
    assert.equal((await (await one.api(sub)).json()).queued, 1, "the developer's apply: one line waits");
    await one.stop();
    oneUp = false;
    two = await startApp({ memory: true, keep: true, dataDir: one.dataDir, configure });
    assert.equal((await (await two.api(sub)).json()).queued, 1, "kept across the restart, as a report is");
    const mark = up.received.length;
    const t = await two.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "carry on", stream: false } });
    assert.equal(t.status, 200, await t.clone().text());
    const call = up.received.slice(mark).find((/** @type {any} */ c) => !isChild(c));
    const read = textOf(call.body.messages.at(-1));
    assert.match(read, APPLIED_LINE);
    assert.match(read, /carry on$/);
    assert.equal((await (await two.api(sub)).json()).queued, 0);
  } finally {
    if (oneUp) await one.stop();
    if (two) await two.stop();
    rmSync(one.dataDir, { recursive: true, force: true });
  }
});

// (fails before: yes — the 10-29 Changes tab: what an Apply wrote sat in your folder as no agent's, "Other changes",
// though a sub-agent wrote every line of it)
test("what a sub-agent's Apply wrote stays under its name in Changes until committed, across a restart", async () => {
  /** @param {any} cfg */
  const configure = (cfg) => {
    cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
    cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
    cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
    cfg.memory.autopilot = { enabled: false };
  };
  const one = await startApp({ memory: true, keep: true, configure });
  let oneUp = true;
  /** @type {any} */
  let two = null;
  try {
    const repoDir = repoOf("repo-applied-name");
    const s = await one.api("/api/sessions", { method: "POST", body: { cwd: repoDir, model: "m-1" } });
    const id = String((await s.json()).id);
    const t = await one.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "hello", stream: false } });
    assert.equal(t.status, 200, await t.clone().text());
    const sub = `/api/sessions/${encodeURIComponent(id)}/subagents`;
    const spawn = await one.api(sub, { method: "POST", body: { prompt: "write made.txt", description: "Writer", deliver: false } });
    const { subagent } = await spawn.json();
    await until(async () => (await (await one.api(sub)).json()).subagents.every((/** @type {any} */ x) => x.status !== "running"), "the writer to report", WORK);
    const ap = await one.api(`${sub}/${subagent.id}/apply`, { method: "POST", body: {} });
    assert.equal(ap.status, 200, await ap.clone().text());
    /** Who wrote made.txt, as the Changes tab reads your folder. @param {any} app */
    const byOf = async (app) => {
      const a = await (await app.api(`/api/git/changes?cwd=${encodeURIComponent(repoDir)}&chain=${encodeURIComponent(id)}&fresh=1`)).json();
      const f = (a.places || []).find((/** @type {any} */ p) => p.kind === "folder")?.files.find((/** @type {any} */ x) => x.path === "made.txt");
      return f ? f.by.map((/** @type {any} */ w) => [w.chain, w.agent]) : null;
    };
    await until(async () => (await byOf(one))?.length, "the apply's files under its name");
    assert.deepEqual(await byOf(one), [[id, subagent.id]]);
    await one.stop();
    oneUp = false;
    two = await startApp({ memory: true, keep: true, dataDir: one.dataDir, configure });
    assert.deepEqual(await byOf(two), [[id, subagent.id]], "across a restart");
    // Committed, then changed by hand: no longer the sub-agent's.
    const later = new Date(Date.now() + 60_000).toISOString();
    const env = { ...process.env, GIT_AUTHOR_DATE: later, GIT_COMMITTER_DATE: later };
    execFileSync("git", ["add", "made.txt"], { cwd: repoDir });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "take it"], { cwd: repoDir, env });
    writeFileSync(join(repoDir, "made.txt"), "mine now\n");
    assert.deepEqual(await byOf(two), [], "until committed");
  } finally {
    if (oneUp) await one.stop();
    if (two) await two.stop();
    rmSync(one.dataDir, { recursive: true, force: true });
  }
});

// (fails before: yes — the owner's of 11-10: the Changes tab's dot said a sub-agent's work waited for an Apply, and the tab
// showed none of it — its copy's folder had gone, its work kept on the repository's refs, and the tab drew copies there
// on disk alone)
test("a sub-agent's work that waits after its copy's folder went is in Changes, as its copy's block, and its Apply brings it in", async () => {
  /** @param {any} cfg */
  const configure = (cfg) => {
    cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
    cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
    cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
    cfg.memory.autopilot = { enabled: false };
  };
  const app = await startApp({ memory: true, configure });
  try {
    const repoDir = repoOf("repo-copy-gone");
    const s = await app.api("/api/sessions", { method: "POST", body: { cwd: repoDir, model: "m-1" } });
    const id = String((await s.json()).id);
    const t = await app.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "hello", stream: false } });
    assert.equal(t.status, 200, await t.clone().text());
    const sub = `/api/sessions/${encodeURIComponent(id)}/subagents`;
    const spawn = await app.api(sub, { method: "POST", body: { prompt: "write made.txt", description: "Writer", deliver: false } });
    const { subagent } = await spawn.json();
    await until(async () => (await (await app.api(sub)).json()).subagents.every((/** @type {any} */ x) => x.status !== "running"), "the writer to report", WORK);
    const row = (await (await app.api(sub)).json()).subagents.find((/** @type {any} */ x) => x.id === subagent.id);
    assert.ok(row.work?.pending > 0 && row.work.folder, "its work waits in its copy");
    // Its copy's folder goes — by hand, or by a clean-up — while its work stays on the repository's refs.
    rmSync(row.work.folder, { recursive: true, force: true });
    execFileSync("git", ["worktree", "prune"], { cwd: repoDir });
    assert.ok(!existsSync(row.work.folder));
    const after = (await (await app.api(sub)).json()).subagents.find((/** @type {any} */ x) => x.id === subagent.id);
    assert.ok(after.work?.pending > 0, "the list still says its work waits: the tab's dot");
    const changes = await (await app.api(`/api/git/changes?cwd=${encodeURIComponent(repoDir)}&chain=${encodeURIComponent(id)}&fresh=1`)).json();
    const copy = (changes.places || []).find((/** @type {any} */ p) => p.kind === "copy" && p.sub === subagent.id);
    assert.ok(copy, `its copy's block, its folder gone: ${JSON.stringify(changes.places.map((/** @type {any} */ p) => [p.kind, p.sub || p.cwd]))}`);
    assert.equal(copy.ok, true);
    assert.equal(copy.saved, true, "its work is kept on the repository's refs, its folder gone");
    const ap = await app.api(`${sub}/${subagent.id}/apply`, { method: "POST", body: {} });
    assert.equal(ap.status, 200, await ap.clone().text());
    assert.ok(existsSync(join(repoDir, "made.txt")), "its Apply brings it in from the refs");
    const done = await (await app.api(`/api/git/changes?cwd=${encodeURIComponent(repoDir)}&chain=${encodeURIComponent(id)}&fresh=1`)).json();
    assert.ok(!(done.places || []).some((/** @type {any} */ p) => p.kind === "copy" && p.sub === subagent.id), "applied, nothing of it waits: no block");
  } finally {
    await app.stop();
  }
});

// (fails before: yes — the fork that writes a sub-agent's fold named its worktree as the folder, so memory made a
// project of the worktree)
test("a worktree sub-agent's fold, forked from its warm cache, books on the session's folder: its worktree never becomes a project", async () => {
  const repoDir = join(folder, `repo-fold-${Date.now()}`);
  mkdirSync(repoDir);
  const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: repoDir, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(repoDir, "a.txt"), "one\n");
  git("add", "-A");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: repoDir, model: "m-1" } });
  assert.equal(s.status, 200, await s.clone().text());
  const id = String((await s.json()).id);
  const mark = up.received.length;
  try {
    const spawn = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`, { method: "POST", body: { prompt: "fold warm work", description: "Folder", deliver: false } });
    assert.equal(spawn.status, 200, await spawn.clone().text());
    const { subagent } = await spawn.json();
    await until(() => up.received.slice(mark).some((/** @type {any} */ c) => isChild(c) && answersTo(c).includes("toolu_fw1")), "the sub-agent's second round to be in flight");
    const { subagents } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json();
    const runId = subagents.find((/** @type {any} */ x) => x.id === subagent.id)?.runId;
    const steer = await shim.api(`/api/runs/${encodeURIComponent(String(runId))}/steer`, { method: "POST", body: { kind: "compact", text: "", from: "harness" } });
    assert.equal(steer.status, 200, await steer.clone().text());
  } finally {
    foldChild.resolve();
  }
  const [done] = await settled(id);
  assert.deepEqual([done.status, done.exchanges[0].report], ["done", "FOLDED IT"]);
  assert.ok(up.received.slice(mark).some((/** @type {any} */ c) => FOLD_ASK.test(textOf(c.body?.messages?.at(-1)))), "its fold was written by a fork of its warm conversation");
  const { projects } = await (await shim.api("/api/memory/projects?canon=0")).json();
  assert.deepEqual(projects.filter((/** @type {any} */ p) => /filament-worktrees|sa_[0-9a-f]{8}/.test(`${p.cwd} ${p.name}`)), []);
});

test("/subagent in a harness session launches into the session's loop; list and status answer locally", async () => {
  const id = await newSession();
  const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "/subagent view=folded look around", stream: false } });
  assert.equal(t.status, 200, await t.clone().text());
  const said = await t.text();
  assert.match(said, /Launched sub-agent `sa_[0-9a-f]{8}`[\s\S]*Its report goes to this session's agent/);
  const [sa] = await settled(id);
  assert.deepEqual([sa.origin, sa.view], ["command", "folded"]);
  const list = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "/subagent list", stream: false } });
  assert.match(await list.text(), new RegExp(`${sa.id}\` — done`));
  const show = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: `/subagent ${sa.id}`, stream: false } });
  assert.match(await show.text(), /Its report:\\n\\nCHILD REPORT/);
});

test("/subagent ask keeps a kept-aside sub-agent's standing: the follow-up answers in the chat and its report stays the developer's, unless wait= says otherwise", async () => {
  const id = await newSession();
  const spawn = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`, { method: "POST", body: { prompt: "audit quietly", description: "Quiet audit", deliver: false } });
  assert.equal(spawn.status, 200, await spawn.clone().text());
  const { subagent } = await spawn.json();
  await settled(id);
  const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: `/subagent ask ${subagent.id} check again`, stream: false } });
  assert.equal(t.status, 200, await t.clone().text());
  assert.match(await t.text(), /SECOND REPORT/, "the command waited and answered with the follow-up's report");
  const [kept] = await settled(id);
  assert.deepEqual([kept.aside, kept.exchanges.map((/** @type {any} */ e) => e.delivery)], [true, ["held", "held"]]);
  assert.equal((await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json()).queued, 0, "nothing went to the main agent");
  const loud = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: `/subagent ask ${subagent.id} wait=off check again`, stream: false } });
  assert.match(await loud.text(), /Its report goes to this session's agent/, "wait=off sends this one follow-up's report on");
  const [sent] = await settled(id);
  assert.deepEqual([sent.aside, sent.exchanges.at(-1).delivery], [true, "auto"], "the standing stays: the next bare follow-up is kept again");
});

// (fails before: yes — its second half, HarnessV4_Tasks E15 step 5 (BW-10): the sub-agent was gone with the process,
// and a message to it was refused)
test("a report waiting for the session's next turn survives a restart, and so does its sub-agent's thread: the first turn after it carries the report, and a message to the sub-agent goes on in its conversation", async () => {
  /** @param {any} cfg */
  const configure = (cfg) => {
    cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
    cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
    cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
    cfg.memory.autopilot = { enabled: false };
  };
  const one = await startApp({ memory: true, keep: true, configure });
  let oneUp = true;
  /** @type {any} */
  let two = null;
  try {
    const s = await one.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1" } });
    const id = String((await s.json()).id);
    // A chat with no turn yet is never woken for a report (the owner's of 10-28): its first message carries it.
    const spawn = await one.api(`/api/sessions/${encodeURIComponent(id)}/subagents`, { method: "POST", body: { prompt: "survive this", description: "Survivor" } });
    assert.equal(spawn.status, 200, await spawn.clone().text());
    await until(async () => (await (await one.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json()).queued === 1, "the report to wait for the next turn");
    await one.stop();
    oneUp = false;
    two = await startApp({ memory: true, keep: true, dataDir: one.dataDir, configure });
    const list = await (await two.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json();
    assert.deepEqual([list.subagents.length, list.queued], [1, 1], "the session kept its sub-agent's thread, and its report");
    const [kept] = list.subagents;
    assert.deepEqual([kept.status, kept.restored, kept.description, kept.exchanges[0].prompt, kept.exchanges[0].report, kept.exchanges[0].delivery], ["done", null, "Survivor", "survive this", "CHILD REPORT", "auto"], "its conversation kept too (10-26)");
    assert.ok(kept.exchanges[0].runId, "its run names the log that holds its work");
    const one1 = await two.api(`/api/sessions/${encodeURIComponent(id)}/subagents/${kept.id}`);
    assert.equal(one1.status, 200, "opened by its id alone");
    assert.deepEqual((await one1.json()).subagent.exchanges.map((/** @type {any} */ e) => e.report), ["CHILD REPORT"]);
    const mark = up.received.length;
    const t = await two.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "carry on", stream: false } });
    assert.equal(t.status, 200, await t.clone().text());
    // Its own chat's call: another test's chat may be woken by a late report meanwhile (the owner's of 10-28).
    const first = up.received.slice(mark).find((/** @type {any} */ c) => !isChild(c) && /carry on$/.test(textOf(c.body.messages.at(-1))));
    assert.match(textOf(first.body.messages.at(-1)), /^\[Filament: the developer ran sub-agent sa_[0-9a-f]{8} \("Survivor"\)[\s\S]*CHILD REPORT[\s\S]*carry on$/);
    assert.equal((await (await two.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json()).queued, 0, "carried: nothing waits any more");
    const tr = await (await two.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    const arrival = tr.boundaries.find((/** @type {any} */ b) => b.type === "subagent" && b.event === "arrival");
    assert.equal(arrival?.carriedBy, 1, "the session kept the report's exchange across the restart: its row names the turn that carried it");
    const from = up.received.length;
    const more = await two.api(`/api/sessions/${encodeURIComponent(id)}/subagents/${kept.id}/follow-up`, { method: "POST", body: { prompt: "check again" } });
    assert.equal(more.status, 200, await more.clone().text());
    const [went] = await until(async () => {
      const { subagents } = await (await two.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json();
      return subagents.every((/** @type {any} */ s) => s.status !== "running") ? subagents : null;
    }, "the follow-up to report");
    assert.deepEqual([went.restored, went.exchanges.map((/** @type {any} */ e) => [e.report, e.fresh])], [null, [["CHILD REPORT", undefined], ["SECOND REPORT", undefined]]]);
    const next = up.received.slice(from).find((/** @type {any} */ c) => isChild(c));
    const sent = next.body.messages;
    assert.deepEqual([sent.length >= 3, sent[0].role, sent.at(-1).role], [true, "user", "user"], "its conversation before, then the message");
    assert.match(textOf(sent[0]), /survive this/);
    assert.ok(sent.some((/** @type {any} */ m) => m.role === "assistant" && /CHILD REPORT/.test(textOf(m))), "its answer, as it gave it");
    assert.match(textOf(sent.at(-1)), /check again$/);
    assert.doesNotMatch(JSON.stringify(sent), /<thread messages=/, "no fresh agent's reading of the thread");
  } finally {
    if (oneUp) await one.stop();
    if (two) await two.stop();
    rmSync(one.dataDir, { recursive: true, force: true });
  }
});

// The reviews of 2026-09-30 (the other agent's test gap; the UI/UX review's kept report nobody saw).
// (fails before: without the detach's unhook, the parent's stop reaches the detached sub-agent and cuts it)
test("a detached sub-agent keeps running when the developer then stops the main turn", async () => {
  const s = heldForeground();
  const stopper = new AbortController();
  /** @type {any} */
  let queued = null;
  const mailbox = {
    /** @param {((m: any) => boolean) | undefined} [pick] */
    read: (pick) => {
      if (!queued || (pick && !pick(queued))) return [];
      const m = queued;
      queued = null;
      return [m];
    },
    unheard: () => {},
    stopSignal: stopper.signal,
  };
  let id = "";
  /** @type {any[]} */
  const calls = [];
  const { args, door } = turnOn(s.registry, {
    mailbox,
    onEvent: (e) => {
      if (e.type === "subagent-start" && !id) {
        id = e.agentId;
        setTimeout(() => s.registry.detach?.(id, { report: true }), 20);
      }
    },
    call: async ({ body }) => {
      calls.push(structuredClone(body));
      if (calls.length === 1) return reply([toolUse("a1", "agent", { run_in_background: false, description: "Long", prompt: "LONG" })]);
      // The developer stops the main turn after the detach.
      queued = { id: "st1", kind: "stop", text: "", from: "harness" };
      stopper.abort();
      return reply([toolUse("r1", "read", { path: "x" })]);
    },
  });
  const out = await runAgentTurn(args);
  door.close();
  assert.equal(out.status, "stopped", "the main turn stopped");
  assert.equal(s.registry.get(id)?.status, "running", "the stop left the detached sub-agent running");
  s.open();
  await until(() => s.registry.get(id)?.status !== "running", "the detached sub-agent to finish");
  assert.equal(s.registry.get(id)?.status, "done", "it finished on its own, not stopped with the turn");
});

// (fails before: a launch of the agent's marked no arrival — the report the developer kept waited unseen)
test("detached with its report kept for the developer: its arrival is marked when it finishes, delivery held", async () => {
  const s = heldForeground();
  let id = "";
  /** @type {any[]} */
  const emitted = [];
  const { args, door } = turnOn(s.registry, {
    onEvent: (e) => {
      emitted.push(e);
      if (e.type === "subagent-start" && !id) {
        id = e.agentId;
        setTimeout(() => s.registry.detach?.(id, { report: false }), 20);
      }
    },
    call: async ({ body }) => (body.messages.length === 1 ? reply([toolUse("a1", "agent", { run_in_background: false, description: "Long", prompt: "LONG" })]) : reply([{ type: "text", text: "Done without it." }])),
  });
  await runAgentTurn(args);
  door.close();
  assert.ok(emitted.some((e) => e.type === "subagent-detached" && e.agentId === id && e.report === false), "the detach is on the parent's run");
  s.open();
  await until(() => s.registry.get(id)?.status === "done", "the detached sub-agent to finish");
  const arrival = s.marks.find((m) => m.event === "arrival" && m.agentId === id);
  assert.ok(arrival, `its arrival is marked on the session: ${JSON.stringify(s.marks)}`);
  assert.equal(arrival.delivery, "held", "the report is the developer's to send on");
});

// BUG-26: a restart used to leave a sub-agent that was mid-call to die with the process when the drain's cap ran out —
// its run "unknown", no word to anyone. Now Filament cuts every running sub-agent as it starts to stop, while the drain
// still lets each one end, and the session hears of it with its next turn, in words that say it was a restart.
test("a restart cuts every running sub-agent at once and leaves its session a notice worded as a restart, which outlives the restart", async () => {
  /** @type {Map<string, any[]>} */
  const kept = new Map();
  const store = { saveQueue: (/** @type {string} */ chainId, /** @type {any[]} */ list) => void kept.set(chainId, structuredClone(list)), loadQueue: (/** @type {string} */ chainId) => structuredClone(kept.get(chainId) || []) };
  // A long call that only ends when it is cut, as a real upstream call does.
  const { registry } = scripted(
    ({ signal }) =>
      new Promise((_, reject) => {
        const cutNow = () => reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
        if (signal?.aborted) return cutNow();
        signal?.addEventListener("abort", cutNow, { once: true });
      }),
    store,
  );
  const r = await registry.launch({ origin: "owner", chainId: "c1", prompt: "audit the whole cache layer", description: "Cache audit" });
  assert.ok(r.ok, JSON.stringify(r));
  const id = r.ok ? r.id : "";
  await until(() => registry.get(id)?.status === "running", "the sub-agent to be running");
  assert.equal(registry.shutdown(), 1, "one sub-agent was running");
  const o = await (r.ok ? r.done : null);
  assert.equal(o?.status, "aborted");
  assert.match(String(o?.error), /Filament restarted before it finished/, "its end says why, not 'the client disconnected'");
  const q = registry.peekQueued("c1");
  assert.equal(q.length, 1, JSON.stringify(q.map((d) => d.text.slice(0, 80))));
  assert.match(q[0].text, /^\[Filament: sub-agent sa_[0-9a-f]{8} \("Cache audit"\) was cut by a Filament restart before it finished\./);
  assert.match(q[0].text, /audit the whole cache layer/, "the task it had, so the model can relaunch it");
  assert.doesNotMatch(q[0].text, /agent_id/, "no follow-up hint: the registry forgets it with the restart");
  const after = scripted(async () => ({ report: "x" }), store);
  assert.match(after.registry.peekQueued("c1")[0]?.text || "", /was cut by a Filament restart/, "the notice outlives the restart");
  assert.equal(registry.shutdown(), 0, "nothing is left running");
});

test("the server cuts the sub-agents as it starts to stop, before the drain waits on the turns in flight", () => {
  const src = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  const stop = src.slice(src.indexOf("stop({ drainMs"), src.indexOf("const finish = async"));
  assert.match(stop, /draining = true;[\s\S]*subagents\.shutdown\(\)/, "right after new model requests are refused");
});

// (fails before: yes — what landed in a running turn's inbox as Filament stopped went into the turn's next round, which
// the draining Filament refuses: it was lost with that round)
test("as Filament stops, a running turn's loop takes nothing more: what lands waits for the session's next turn, kept across the restart", async () => {
  /** @type {Map<string, any[]>} */
  const kept = new Map();
  const store = { saveQueue: (/** @type {string} */ chainId, /** @type {any[]} */ list) => void kept.set(chainId, structuredClone(list)), loadQueue: (/** @type {string} */ chainId) => structuredClone(kept.get(chainId) || []) };
  const { registry } = scripted(async () => ({ report: "x" }), store);
  const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: root, mode: "edit", model: "m", thinking: null, fork: null });
  /** @param {string} text @param {string} task */
  const told = (text, task) => registry.tell("c1", { text, from: "sa-1", description: `${task}: Fix`, task, state: "failed", spends: [], wrote: false });
  told("[Filament: before the stop]", "t1");
  registry.shutdown();
  told("[Filament: as Filament stops]", "t2");
  assert.deepEqual(door.inbox.take(), [], "nothing for a round the draining Filament would refuse");
  door.close();
  const after = scripted(async () => ({ report: "x" }), store);
  assert.deepEqual(after.registry.peekQueued("c1").map((d) => d.text), ["[Filament: before the stop]", "[Filament: as Filament stops]"], "both wait for the next turn, across the restart");
});

// The round's code review (sa_714e5fad): the restart made every running sub-agent report to the main agent — one the
// developer kept aside too — and it would word as cut one whose host had just finished its work.
test("a restart keeps a sub-agent kept aside the developer's: no notice to the main agent, its cut report held for them", async () => {
  const { registry } = scripted(
    ({ signal }) =>
      new Promise((_, reject) => {
        const cutNow = () => reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
        if (signal?.aborted) return cutNow();
        signal?.addEventListener("abort", cutNow, { once: true });
      }),
  );
  const r = await registry.launch({ origin: "owner", chainId: "c1", prompt: "look aside", description: "Aside", deliver: false });
  const id = r.ok ? r.id : "";
  await until(() => registry.get(id)?.status === "running", "the sub-agent to be running");
  assert.equal(registry.shutdown(), 1);
  const o = await (r.ok ? r.done : null);
  assert.match(String(o?.error), /Filament restarted before it finished/);
  assert.equal(registry.queued("c1"), 0, "the developer kept its reports: none goes to the main agent");
  assert.equal(registry.get(id)?.exchanges[0].delivery, "held");
});

test("a sub-agent whose host finished its work as the restart cut it reports as finished, not as cut", async () => {
  let serving = false;
  const { registry } = scripted(
    ({ signal }) =>
      new Promise((resolve) => {
        serving = true;
        const done = () => resolve({ report: "ALL DONE" });
        if (signal?.aborted) return done();
        signal?.addEventListener("abort", done, { once: true });
      }),
  );
  const r = await registry.launch({ origin: "owner", chainId: "c1", prompt: "finish up", description: "Finisher" });
  await until(() => serving, "its host to be serving it");
  registry.shutdown();
  const o = await (r.ok ? r.done : null);
  assert.equal(o?.status, "done", "its host said done: that stands");
  const q = registry.peekQueued("c1");
  assert.equal(q.length, 1);
  assert.doesNotMatch(q[0].text, /cut by a Filament restart/);
  assert.match(q[0].text, /ALL DONE/);
});

/** A session's store across a "restart": what the registry keeps on the session, cloned as the archive would. */
const keptStore = () => {
  /** @type {Map<string, any[]>} */
  const queue = new Map();
  /** @type {Map<string, any[]>} */
  const held = new Map();
  return {
    saveQueue: (/** @type {string} */ c, /** @type {any[]} */ list) => void queue.set(c, structuredClone(list)),
    loadQueue: (/** @type {string} */ c) => structuredClone(queue.get(c) || []),
    saveHeld: (/** @type {string} */ c, /** @type {any[]} */ list) => void held.set(c, structuredClone(list)),
    loadHeld: (/** @type {string} */ c) => structuredClone(held.get(c) || []),
    held,
  };
};

// BUG-26's crash case (HarnessV3-FixRound F4 item 19): a process that died mid-sub-agent ran no shutdown, so no
// session heard of it. The next start finds the run left open and tells its session once, in a restart's words.
test("a sub-agent run an earlier process left open tells its session once, with its task and how far it got", () => {
  const store = keptStore();
  const { registry, marks, published } = scripted(async () => ({ report: "x" }), store);
  const brief = { agentId: "sa_0badf00d", exchange: 0, description: "Cache audit", task: "audit the whole cache layer", by: "owner", deliver: true };
  assert.equal(registry.orphaned({ runId: "r1", chainId: "c1", brief, rounds: 3 }), true);
  const q = registry.peekQueued("c1");
  assert.equal(q.length, 1);
  assert.equal(q[0].exchange, 0, "it names its exchange: the turn that carries it says so (decision 23)");
  assert.match(q[0].text, /^\[Filament: sub-agent sa_0badf00d \("Cache audit"\) was cut by a Filament restart before it finished, after 3 rounds\./);
  assert.match(q[0].text, /Its task:\naudit the whole cache layer/);
  assert.doesNotMatch(q[0].text, /agent_id/, "no follow-up hint: no registry knows it");
  const arrival = marks.find((m) => m.event === "arrival");
  assert.deepEqual([arrival?.agentId, arrival?.status, arrival?.delivery, arrival?.error], ["sa_0badf00d", "aborted", "auto", "Filament stopped before it finished"], "the developer's launch gets its row");
  assert.ok(published.some((p) => p.topic === "subagents" && p.e.type === "subagent-mark"), "an open transcript draws it at once");
  // The same run found again (its end was not written in time): no second notice — nor after a restart of the registry.
  assert.equal(registry.orphaned({ runId: "r1", chainId: "c1", brief, rounds: 3 }), false);
  const again = scripted(async () => ({ report: "x" }), store);
  assert.equal(again.registry.orphaned({ runId: "r1", chainId: "c1", brief, rounds: 3 }), false);
  assert.equal(again.registry.peekQueued("c1").length, 1);
});

test("a left-open sub-agent's session must exist, and the agent's own launch gets no developer row", () => {
  const gone = scripted(async () => ({ report: "x" }), { ...keptStore(), session: () => null });
  assert.equal(gone.registry.orphaned({ runId: "r1", chainId: "c1", brief: { agentId: "sa_0badf00d", task: "t", by: "owner" } }), false, "a session that is gone hears nothing");
  assert.equal(gone.registry.peekQueued("c1").length, 0);
  const { registry, marks } = scripted(async () => ({ report: "x" }), keptStore());
  assert.equal(registry.orphaned({ runId: "r2", chainId: "c1", brief: { agentId: "sa_0badf00e", description: "Reader", task: "read it", by: "agent", deliver: true } }), true);
  assert.equal(registry.peekQueued("c1").length, 1, "the main agent hears it");
  assert.equal(marks.length, 0, "the agent launched it: no developer row");
  // A run from before the brief existed: the id from its meta, no task to quote.
  assert.equal(registry.orphaned({ runId: "r3", chainId: "c1", brief: null, agentId: "sa_0badf00f" }), true);
  assert.match(registry.peekQueued("c1")[1].text, /sub-agent sa_0badf00f \("sa_0badf00f"\) was cut by a Filament restart before it finished\. What it had not reported is lost; launch it anew if its task is still needed\.\]$/);
});

// (fails before: yes — the bug hunt of 10-30, SUB-6: the registry kept a deleted chat's entry, its warm request and the
// reports kept aside for it for as long as the process ran)
test("a deleted chat leaves the registry: its waiting messages, its warm request with that request's timer and the reports kept aside for it go — at once, or as its running turn closes", () => {
  const store = keptStore();
  const reads = { queue: 0, held: 0 };
  const counted = {
    ...store,
    loadQueue: (/** @type {string} */ c) => (reads.queue++, store.loadQueue(c)),
    loadHeld: (/** @type {string} */ c) => (reads.held++, store.loadHeld(c)),
  };
  // The warm request's timer, known by its delay: what the snapshot's lifetime leaves at the registry's clock.
  const TTL = 123_456;
  /** @type {any[]} */
  const warmTimers = [];
  /** @type {Set<any>} */
  const cleared = new Set();
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  globalThis.setTimeout = /** @type {any} */ ((/** @type {any} */ fn, /** @type {number} */ ms, /** @type {any[]} */ ...rest) => {
    const t = realSet(fn, ms, ...rest);
    if (ms === TTL) warmTimers.push(t);
    return t;
  });
  globalThis.clearTimeout = /** @type {any} */ ((/** @type {any} */ t) => {
    cleared.add(t);
    return realClear(t);
  });
  try {
    const { registry } = scripted(async () => ({ report: "x" }), counted, { now: () => 1_000 });
    const brief = { agentId: "sa_0badf00d", description: "Kept", task: "t", by: "owner", deliver: false };
    // An idle chat: a message waiting for its next turn, a report kept aside for the person.
    registry.notice("c1", { text: "[Filament: waiting]", description: "a notice" });
    assert.equal(registry.orphaned({ runId: "r1", chainId: "c1", brief }), true);
    registry.peekQueued("c1");
    assert.deepEqual(reads, { queue: 1, held: 1 }, "each read from the chat's store once, then kept");
    registry.forgetChat("c1");
    registry.peekQueued("c1");
    assert.equal(reads.queue, 2, "its entry went: the next look reads its store again");
    assert.equal(registry.orphaned({ runId: "r1", chainId: "c1", brief }), false);
    assert.equal(reads.held, 2, "and so did the reports kept aside for it");

    const snap = /** @type {any} */ ({ body: { model: "m", tools: [{ name: "report" }], messages: [] }, sentAt: 1_000, ttlMs: TTL });
    // A chat deleted while its turn runs keeps what that turn needs until it closes.
    const door = registry.openTurn({ chainId: "c2", runId: "turn-1", cwd: root, mode: "edit", model: "m", thinking: null, fork: null, cache: () => snap });
    registry.forgetChat("c2");
    assert.equal(registry.turnRuns("c2"), true, "its turn runs on");
    door.close();
    assert.equal(warmTimers.length, 1, "its close kept its newest request warm, as any turn's");
    assert.equal(registry.keptFork("c2", "m"), null, "and it went with the deleted chat");
    assert.ok(cleared.has(warmTimers[0]), "its timer cleared with it");
    // A chat that stays keeps its warm request as before.
    registry.openTurn({ chainId: "c3", runId: "turn-2", cwd: root, mode: "edit", model: "m", thinking: null, fork: null, cache: () => snap }).close();
    assert.equal(registry.keptFork("c3", "m"), snap);
    assert.ok(!cleared.has(warmTimers[1]));
  } finally {
    globalThis.setTimeout = realSet;
    globalThis.clearTimeout = realClear;
    // Every warm timer this test made goes with it.
    for (const t of warmTimers) realClear(t);
  }
});

test("a graceful stop's notice already waiting is not doubled by the next start finding its run open", async () => {
  const store = keptStore();
  const { registry } = scripted(
    ({ signal }) =>
      new Promise((_, reject) => {
        const cutNow = () => reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
        if (signal?.aborted) return cutNow();
        signal?.addEventListener("abort", cutNow, { once: true });
      }),
    store,
  );
  const r = await registry.launch({ origin: "owner", chainId: "c1", prompt: "audit it", description: "Audit" });
  const id = r.ok ? r.id : "";
  await until(() => registry.get(id)?.status === "running", "the sub-agent to be running");
  registry.shutdown();
  await (r.ok ? r.done : null);
  const next = scripted(async () => ({ report: "x" }), store);
  assert.equal(next.registry.orphaned({ runId: "r1", chainId: "c1", brief: { agentId: id, exchange: 0, description: "Audit", task: "audit it", by: "owner", deliver: true } }), false);
  assert.equal(next.registry.peekQueued("c1").length, 1);
});

// BUG-26's check: a report the developer kept aside lived only in the registry, so a restart lost it while its row
// still said "report kept for you". The session keeps it now, and Send works after a restart.
test("a report kept for the developer outlives a restart: Send passes it on once, without a follow-up hint", async () => {
  const store = keptStore();
  const first = scripted(async () => ({ report: "FOUND THE LEAK" }), store);
  const r = await first.registry.launch({ origin: "owner", chainId: "c1", prompt: "find the leak", description: "Leak", deliver: false });
  const id = r.ok ? r.id : "";
  await (r.ok ? r.done : null);
  assert.equal(first.registry.get(id)?.exchanges[0].delivery, "held");
  assert.equal(store.held.get("c1")?.length, 1, "the session keeps it");
  const after = scripted(async () => ({ report: "x" }), store);
  const sent = after.registry.send(id, "c1", 0);
  assert.deepEqual(sent, { ok: true, into: "queue" });
  const q = after.registry.peekQueued("c1");
  assert.equal(q.length, 1);
  assert.equal(q[0].exchange, 0, "it names its exchange: the turn that carries it says so (decision 23)");
  assert.match(q[0].text, /the developer is passing you the report of sub-agent sa_[0-9a-f]{8} \("Leak"\)[\s\S]*find the leak[\s\S]*FOUND THE LEAK/);
  assert.doesNotMatch(q[0].text, /agent_id/, "no registry knows it now: no follow-up hint");
  assert.ok(after.marks.some((m) => m.event === "sent" && m.agentId === id && m.exchange === 0), "the arrival row reads sent");
  assert.equal(store.held.get("c1")?.length, 0, "sent: no longer kept");
  assert.equal(after.registry.send(id, "c1", 0).ok, false, "once");
});

test("a kept report sent before any restart is no longer kept for after one", async () => {
  const store = keptStore();
  const { registry } = scripted(async () => ({ report: "R" }), store);
  const r = await registry.launch({ origin: "owner", chainId: "c1", prompt: "p", description: "D", deliver: false });
  await (r.ok ? r.done : null);
  assert.equal(registry.send(r.ok ? r.id : "", "c1").ok, true);
  assert.equal(store.held.get("c1")?.length, 0);
});

test("a left-open sub-agent the developer kept aside: its notice is kept for them, not told to the main agent", async () => {
  const store = keptStore();
  const { registry, marks } = scripted(async () => ({ report: "x" }), store);
  const brief = { agentId: "sa_0badf0aa", exchange: 0, description: "Aside", task: "look aside", by: "owner", deliver: false };
  assert.equal(registry.orphaned({ runId: "r9", chainId: "c1", brief, rounds: 2 }), true);
  assert.equal(registry.peekQueued("c1").length, 0, "the main agent hears nothing");
  assert.equal(store.held.get("c1")?.length, 1, "kept for the developer");
  assert.match(store.held.get("c1")?.[0].text || "", /was cut by a Filament restart before it finished, after 2 rounds/);
  assert.equal(marks.find((m) => m.event === "arrival")?.delivery, "held", "its row offers Send");
  const after = scripted(async () => ({ report: "x" }), store);
  assert.equal(after.registry.send("sa_0badf0aa", "c1", 0).ok, true, "sent on after a restart");
  assert.equal(after.registry.peekQueued("c1").length, 1);
});

test("a kept restart notice is told once too, and a session keeps the newest 20 reports kept for the developer", () => {
  const store = keptStore();
  const { registry, marks } = scripted(async () => ({ report: "x" }), store);
  const brief = (/** @type {number} */ i) => ({ agentId: `sa_${String(i).padStart(8, "0")}`, exchange: 0, description: `Aside ${i}`, task: "look aside", by: "owner", deliver: false });
  assert.equal(registry.orphaned({ runId: "r1", chainId: "c1", brief: brief(1) }), true);
  assert.equal(registry.orphaned({ runId: "r1", chainId: "c1", brief: brief(1) }), false, "already kept: not told again");
  assert.equal(marks.filter((m) => m.event === "arrival").length, 1, "one row");
  for (let i = 2; i <= 21; i++) registry.orphaned({ runId: `r${i}`, chainId: "c1", brief: brief(i) });
  const kept = store.held.get("c1") || [];
  assert.equal(kept.length, 20, "the newest 20");
  assert.deepEqual([kept[0].agentId, kept.at(-1).agentId], ["sa_00000002", "sa_00000021"], "the oldest went first");
});

/** A session's store across a "restart" with its sub-agents' threads (BW-10), each cloned as the archive would. */
const threadStore = () => {
  /** @type {Map<string, any[]>} */
  const threads = new Map();
  return {
    ...keptStore(),
    saveThread: (/** @type {string} */ c, /** @type {any} */ t) => {
      const kept = threads.get(c) || [];
      const at = kept.findIndex((x) => x.id === t.id);
      const next = structuredClone(t);
      threads.set(c, at < 0 ? [...kept, next] : kept.map((x, i) => (i === at ? next : x)));
    },
    loadThreads: (/** @type {string} */ c) => structuredClone(threads.get(c) || []),
    threads,
  };
};
/** A host that works until it is cut. @param {{ signal: AbortSignal | null }} o @returns {Promise<any>} */
const untilCut = ({ signal }) =>
  new Promise((_, reject) => {
    const cutNow = () => reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
    if (signal?.aborted) return cutNow();
    signal?.addEventListener("abort", cutNow, { once: true });
  });
/** The text blocks of a request's first message. @param {any} post */
const firstBlocks = (post) => post.body.messages[0].content.map((/** @type {any} */ b) => b.text);

// (fails before: yes — the session kept what was said alone, so after a restart its next message started a fresh
// agent, its calls and what they returned gone)
test("a session keeps each sub-agent's conversation as its exchange ends: after a restart its next message goes on in it", async () => {
  const store = threadStore();
  const first = scripted(async () => ({ report: "FOUND THE LEAK", spentUsd: 0.02 }), store);
  const r = await first.registry.launch({ origin: "owner", chainId: "c1", prompt: "find the leak", description: "Leak", view: "folded", deliver: false });
  const id = r.ok ? r.id : "";
  await (r.ok ? r.done : null);
  const was = store.threads.get("c1")?.[0].convo;
  assert.deepEqual([was.length, was[0].role, textOf(was[1])], [2, "user", "FOUND THE LEAK"], "the session keeps its conversation as the exchange left it");

  const after = scripted(async () => ({ report: "THE README IS FINE" }), store);
  const [row] = /** @type {any[]} */ (after.registry.list("c1"));
  assert.deepEqual([row.id, row.status, row.restored], [id, "done", null], "given back with its conversation: nothing to start afresh");
  const f = after.registry.followUp(id, { prompt: "and the README?", chainId: "c1" });
  assert.ok(f.ok, JSON.stringify(f));
  await (f.ok ? f.done : null);
  const sent = after.posts[0].body.messages;
  assert.deepEqual(sent.slice(0, was.length), was, "its conversation before, as it was");
  assert.deepEqual([sent.length, sent[was.length - 1].role, sent.at(-1).role], [was.length + 1, "assistant", "user"]);
  assert.match(textOf(sent.at(-1)), /and the README\?$/);
  assert.doesNotMatch(JSON.stringify(sent), /<thread/, "no fresh agent's reading of the thread");
  assert.deepEqual(/** @type {any} */ (after.registry.get(id)).exchanges.map((/** @type {any} */ e) => [e.report, e.fresh]), [["FOUND THE LEAK", undefined], ["THE README IS FINE", undefined]]);
});

// (fails before: yes — HarnessV4_Tasks E15 step 5 (BW-10): the registry held every sub-agent in memory alone, so a
// restart emptied the session's list, and a message to one answered "no sub-agent … none outlives a restart")
test("a session keeps each sub-agent's thread: after a restart it is in the list with its words and figures, and where its conversation is not there whole its next message starts a fresh agent that reads the session and the thread", async () => {
  const store = threadStore();
  const first = scripted(async () => ({ report: "FOUND THE LEAK", spentUsd: 0.02 }), store);
  const r = await first.registry.launch({ origin: "owner", chainId: "c1", prompt: "find the leak", description: "Leak", view: "folded", deliver: false });
  const id = r.ok ? r.id : "";
  await (r.ok ? r.done : null);
  const was = /** @type {any} */ (first.registry.get(id));
  assert.equal(was.restored, null, "it holds its conversation");
  // A message of its conversation is kept no more (cut at the archive's size cap): the session gives back none of it.
  (store.threads.get("c1") || [])[0].convo = null;

  const after = scripted(async ({ n }) => ({ report: n === 1 ? "THE README IS FINE" : "NOTHING MORE" }), store);
  const [row] = /** @type {any[]} */ (after.registry.list("c1"));
  assert.deepEqual([row.id, row.status, row.restored, row.card, row.model, row.view, row.aside, row.may], [id, "done", "restart", was.card, "m", "folded", true, was.may]);
  assert.deepEqual(
    [row.exchanges[0].prompt, row.exchanges[0].report, row.exchanges[0].delivery, row.exchanges[0].runId, row.exchanges[0].spentUsd, row.exchanges[0].rounds],
    ["find the leak", "FOUND THE LEAK", "held", "run-1", 0.02, 1],
    "what was said, and the figures; its run names the log that holds the work between",
  );
  const whole = /** @type {any} */ (after.registry.detail(id));
  assert.deepEqual(whole.opening.map((/** @type {any} */ b) => [b.kind, b.count, b.text, b.chars > 0]), [["view", 1, "", true]], "what it was shown, by kind and size: the words are kept no more");

  const f = after.registry.followUp(id, { prompt: "and the README?", chainId: "c1" });
  assert.ok(f.ok, JSON.stringify(f));
  await (f.ok ? f.done : null);
  assert.equal(after.posts[0].body.messages.length, 1, "a fresh agent: one message, nothing of the conversation before");
  const blocks = firstBlocks(after.posts[0]);
  assert.match(blocks[0], /^<conversation view="folded" turns="1">/, "the session as its card says, as it stands now");
  assert.match(blocks[1], /^<thread messages="1">\nFilament restarted since you last worked in this thread: the calls you made then and what they returned are gone, and you start fresh\.[\s\S]*\n\nMessage 1, from the developer:\nfind the leak\n\nYour answer:\nFOUND THE LEAK\n<\/thread>$/);
  assert.equal(blocks.at(-1), "and the README?", "the new message comes last, whole");
  const now = /** @type {any} */ (after.registry.get(id));
  assert.deepEqual([now.restored, now.exchanges[1].fresh, now.exchanges[1].report, now.exchanges[1].delivery], [null, "restart", "THE README IS FINE", "held"], "the exchange says a fresh agent took it up; it holds a conversation of its own again");

  const g = after.registry.followUp(id, { prompt: "anything else?", chainId: "c1" });
  await (g.ok ? g.done : null);
  const again = after.posts[1].body.messages;
  assert.deepEqual([again[0].role, again[1].role, again.at(-1).role], ["user", "assistant", "user"], "the next message goes on in that conversation");
  assert.doesNotMatch(textOf(again.at(-1)), /<thread/);
  assert.equal(/** @type {any} */ (after.registry.get(id)).exchanges[2].fresh, undefined);

  const third = scripted(async () => ({ report: "x" }), store);
  assert.deepEqual(/** @type {any[]} */ (third.registry.list("c1"))[0].exchanges.map((/** @type {any} */ e) => [e.report, e.fresh]), [["FOUND THE LEAK", undefined], ["THE README IS FINE", "restart"], ["NOTHING MORE", undefined]], "a second restart keeps all three, and where the fresh agent took over");
});

// (fails before: yes — the review of c7f132f19: a follow-up started afresh after a restart took its launch's brief out of
// the launch's context and put its own there, after the change the launch reviewed: the viewer showed the later message's
// brief, whole, as what the launch was handed)
test("a thread started afresh after a restart: its launch's context stays its launch's — memory's brief by its size, in its place — never the brief the fresh agent read, after another restart too", async () => {
  const store = threadStore();
  /** Memory's brief, written for the task it is given. @param {any} o */
  const brief = async (o) => ({ text: `Memory for your task (Filament), "${o.task}": - [i3 rule · user said] Never push without the owner's word.`, count: 1 });
  const review = { of: "sa_0000beef", files: 1, diff: "diff --git a/parse.js b/parse.js\n+fixed\n" };
  const first = scripted(async () => ({ report: "LOOKS RIGHT" }), { ...store, brief });
  const r = await first.registry.launch({ origin: "owner", chainId: "c1", prompt: "review the parser fix", description: "Review", view: "folded", review, deliver: false });
  const id = r.ok ? r.id : "";
  await (r.ok ? r.done : null);
  /** Its launch's context as the viewer draws it: each block's kind, words and size. @param {any} reg */
  const context = (reg) => reg.detail(id).opening.map((/** @type {any} */ b) => [b.kind, b.text, b.chars ?? b.text.length]);
  const launched = context(first.registry);
  assert.deepEqual(launched.map(([kind]) => kind), ["view", "brief", "review"]);
  assert.match(launched[1][1], /"review the parser fix"/, "a brief written for its task");
  // A message of its conversation is kept no more: its next message starts a fresh agent.
  (store.threads.get("c1") || [])[0].convo = null;

  const after = scripted(async () => ({ report: "THE TESTS PASS" }), { ...store, brief });
  const f = after.registry.followUp(id, { prompt: "and the tests?", chainId: "c1" });
  assert.ok(f.ok, JSON.stringify(f));
  await (f.ok ? f.done : null);
  assert.match(firstBlocks(after.posts[0])[1], /^<memory>\nMemory for your task \(Filament\), "and the tests\?"/, "the fresh agent read a brief written for its message");
  const want = launched.map(([kind, , chars]) => [kind, "", chars]);
  assert.deepEqual(context(after.registry), want, "the launch's blocks, in their order, by kind and size: its brief's words went with the conversation it opened");
  const third = scripted(async () => ({ report: "x" }), { ...store, brief });
  third.registry.list("c1");
  assert.deepEqual(context(third.registry), want, "after another restart too");
});

// (fails before: yes — the notice of a cut sub-agent said "launch it anew": no registry knew it after the restart)
test("a thread cut by a clean stop is kept as cut: its session's notice names the way on, and its next message starts fresh", async () => {
  const store = threadStore();
  const first = scripted(untilCut, store);
  const r = await first.registry.launch({ origin: "owner", chainId: "c1", prompt: "audit the cache", description: "Cache audit" });
  const id = r.ok ? r.id : "";
  await until(() => !!first.registry.get(id)?.runId, "the sub-agent's run to exist");
  first.registry.shutdown();
  await (r.ok ? r.done : null);
  assert.match(
    first.registry.peekQueued("c1")[0].text,
    new RegExp(`^\\[Filament: sub-agent ${id} \\("Cache audit"\\) was cut by a Filament restart before it finished\\. What it had not reported is lost\\. To go on with it, call agent with agent_id "${id}": it starts fresh there, and reads what was said in its thread\\. Its task:\\naudit the cache\\]$`),
  );

  const after = scripted(async () => ({ report: "AUDITED" }), store);
  const [row] = /** @type {any[]} */ (after.registry.list("c1"));
  assert.deepEqual([row.status, row.restored, row.exchanges[0].status, row.exchanges[0].error, row.exchanges[0].delivery], ["aborted", "restart", "aborted", "Filament restarted before it finished", "auto"]);
  assert.equal(after.registry.orphaned({ runId: "run-1", chainId: "c1", brief: { agentId: id, exchange: 0, description: "Cache audit", task: "audit the cache", by: "owner", deliver: true } }), false, "the stop told its session: the next start tells it nothing more");
  const f = after.registry.followUp(id, { prompt: "go on", chainId: "c1" });
  const o = await (f.ok ? f.done : null);
  assert.equal(o?.report, "AUDITED");
  assert.match(firstBlocks(after.posts[0]).find((/** @type {string} */ t) => t.startsWith("<thread")) || "", /Message 1, from the developer:\naudit the cache\n\nYour work on it was cut off before it finished \(Filament restarted before it finished\)\.\n<\/thread>$/);
  assert.deepEqual([/** @type {any} */ (after.registry.get(id)).status, /** @type {any} */ (after.registry.get(id)).exchanges[1].error], ["done", null], "the new exchange ends in its own words, not the cut's");
});

// (fails before: yes — a process that died left the session's list empty: nothing said the thread had been cut)
test("a thread left running by a process that died reads as cut at the next start: its session hears it once, with the way on, and its kept notice can be sent", async () => {
  const store = threadStore();
  const first = scripted(() => new Promise(() => {}), store);
  const r = await first.registry.launch({ origin: "owner", chainId: "c1", prompt: "audit the cache", description: "Cache audit", deliver: false });
  const id = r.ok ? r.id : "";
  await until(() => !!first.registry.get(id)?.runId, "the sub-agent's run to exist");
  assert.equal(store.threads.get("c1")?.[0].exchanges[0].outcome, null, "the session's record says it runs");

  const after = scripted(async () => ({ report: "x" }), store);
  const brief = { agentId: id, exchange: 0, description: "Cache audit", task: "audit the cache", by: "owner", deliver: false };
  assert.equal(after.registry.orphaned({ runId: "run-1", chainId: "c1", brief, rounds: 2 }), true);
  assert.match(store.held.get("c1")?.[0].text || "", new RegExp(`was cut by a Filament restart before it finished, after 2 rounds\\. What it had not reported is lost\\. To go on with it, call agent with agent_id "${id}"`));
  assert.equal(after.registry.orphaned({ runId: "run-1", chainId: "c1", brief, rounds: 2 }), false, "once");
  const [row] = /** @type {any[]} */ (after.registry.list("c1"));
  assert.deepEqual([row.status, row.restored, row.exchanges[0].status, row.exchanges[0].error, row.exchanges[0].delivery, row.exchanges[0].runId], ["aborted", "restart", "aborted", "Filament restarted before it finished", "held", "run-1"], "never 'running' on something that cannot be running");
  assert.deepEqual(after.registry.send(id, "c1", 0), { ok: true, into: "queue" });
  assert.match(after.registry.peekQueued("c1")[0].text, /was cut by a Filament restart before it finished/);
  assert.equal(/** @type {any} */ (after.registry.get(id)).exchanges[0].delivery, "sent");
});

// (fails before: yes — a sub-agent the registry dropped past its newest 100 was gone for good)
test("the registry lets a thread go past the newest it holds and its session gives it back: with its conversation, it goes on in it; without, its next message starts fresh, in words that claim no restart", async () => {
  const store = threadStore();
  const { registry, posts } = scripted(async ({ body }) => ({ report: `REPORT ON ${textOf(body.messages.at(-1)).split("\n").at(-1)}` }), store);
  const a = await registry.launch({ origin: "owner", chainId: "c1", prompt: "the first task", description: "First", deliver: false });
  const id = a.ok ? a.id : "";
  await (a.ok ? a.done : null);
  const b = await registry.launch({ origin: "owner", chainId: "c1", prompt: "the second task", description: "Second", deliver: false });
  const whole = b.ok ? b.id : "";
  await (b.ok ? b.done : null);
  for (let i = 0; i < 100; i++) {
    const r = await registry.launch({ origin: "owner", chainId: `c${2 + (i % 4)}`, prompt: `task ${i}`, deliver: false });
    await (r.ok ? r.done : null);
  }
  assert.deepEqual([registry.get(id), registry.get(whole)], [null, null], "the registry holds the newest 100, across every session");
  // The first one's conversation is not there whole; the second's is.
  const kept = store.threads.get("c1") || [];
  kept[kept.findIndex((t) => t.id === id)].convo = null;
  const rows = /** @type {any[]} */ (registry.list("c1"));
  const row = rows.find((x) => x.id === id);
  assert.deepEqual([row.id, row.restored, row.exchanges[0].report], [id, "let-go", "REPORT ON the first task"], "its session's record gives it back");
  assert.equal(rows.find((x) => x.id === whole)?.restored, null, "the other, with its conversation");
  const mark = posts.length;
  const f = registry.followUp(id, { prompt: "and now?", chainId: "c1" });
  await (f.ok ? f.done : null);
  const thread = firstBlocks(posts[mark]).find((/** @type {string} */ t) => t.startsWith("<thread")) || "";
  assert.match(thread, /^<thread messages="1">\nFilament holds the conversation you had in this thread no more: /);
  assert.doesNotMatch(thread, /restart/);
  assert.equal(/** @type {any} */ (registry.get(id)).exchanges[1].fresh, "let-go");
  const g = registry.followUp(whole, { prompt: "and then?", chainId: "c1" });
  await (g.ok ? g.done : null);
  const went = posts.at(-1).body.messages;
  assert.deepEqual([went.length > 1, went[1].role, JSON.stringify(went).includes("<thread")], [true, "assistant", false], "goes on in its conversation");
  assert.equal(/** @type {any} */ (registry.get(whole)).exchanges[1].fresh, undefined);
});

/** The ended conversations' budget the registry's tests hold it to: KEPT_CHARS itself is 100M characters. */
const BUDGET = 10_000;

test("the registry holds ended conversations to KEPT_CHARS, about 150 MB of heap, unless told another", () => {
  assert.equal(KEPT_CHARS, 100_000_000);
  const subagents = readFileSync(new URL("../src/app/agent/subagents.js", import.meta.url), "utf8");
  assert.match(subagents, /remoteWait = undefined, keptChars = KEPT_CHARS, dataDir = null \}\) \{/);
});

// (fails before: yes — the registry kept every ended sub-agent's conversation whole, a hundred of them: a lead's twelve
// held 251 MB of the server's heap, the owner's of 11-17)
test("past what the registry keeps of ended conversations, the oldest let theirs go: each keeps its record, and its next message starts fresh from what was said", async () => {
  const big = "x".repeat(Math.ceil(BUDGET / 2.5));
  let clock = 1_000;
  const { registry, posts } = scripted(async ({ body }) => ({ report: `${big} REPORT ON ${textOf(body.messages.at(-1)).split("\n").at(-1)}` }), {}, { now: () => (clock += 1_000), keptChars: BUDGET });
  /** @type {string[]} */
  const ids = [];
  for (const task of ["the first task", "the second task", "the third task", "the fourth task"]) {
    const r = await registry.launch({ origin: "owner", chainId: "c1", prompt: task, description: task, deliver: false });
    await (r.ok ? r.done : null);
    ids.push(r.ok ? r.id : "");
  }
  const census = registry.census();
  assert.ok(census.keptChars <= BUDGET * 1.25 && census.keptChars > BUDGET / 2, `the ended conversations kept come to ${census.keptChars} characters: the budget, and the one that just ended`);
  const rows = /** @type {any[]} */ (registry.list("c1"));
  const row = (/** @type {string} */ id) => rows.find((x) => x.id === id);
  assert.deepEqual(ids.map((id) => row(id)?.restored ?? null), ["let-go", null, null, null], "the oldest let its conversation go; the newer keep theirs");
  assert.deepEqual([row(ids[0]).exchanges.length, row(ids[0]).status], [1, "done"], "its record stays");
  const mark = posts.length;
  const f = registry.followUp(ids[0], { prompt: "and now?", chainId: "c1" });
  await (f.ok ? f.done : null);
  const thread = firstBlocks(posts[mark]).find((/** @type {string} */ t) => t.startsWith("<thread")) || "";
  assert.match(thread, /^<thread messages="1">\nFilament holds the conversation you had in this thread no more: /);
  assert.match(thread, /REPORT ON the first task/, "from what was said");
  const g = registry.followUp(ids[3], { prompt: "and then?", chainId: "c1" });
  await (g.ok ? g.done : null);
  assert.equal(JSON.stringify(posts.at(-1).body.messages).includes("<thread"), false, "the newest goes on in its conversation");
});

// (fails before: yes — Fable 5.2's review of 11-17: the registry let go in the order the sub-agents were launched, one
// asked again a moment ago before one idle for an hour; and it could let go the one whose exchange had just ended)
test("the conversations idle the longest go first, and never the one whose exchange just ended, however big", async () => {
  const big = "x".repeat(Math.ceil(BUDGET / 2.5));
  let clock = 1_000;
  /** The size of each report: the next one's. */
  let size = big;
  const { registry } = scripted(async ({ body }) => ({ report: `${size} REPORT ON ${textOf(body.messages.at(-1)).split("\n").at(-1)}` }), {}, { now: () => (clock += 1_000), keptChars: BUDGET });
  /** @param {string} task */
  const launch = async (task) => {
    const r = await registry.launch({ origin: "owner", chainId: "c1", prompt: task, description: task, deliver: false });
    await (r.ok ? r.done : null);
    return r.ok ? r.id : "";
  };
  const restored = (/** @type {string[]} */ ids) => ids.map((id) => /** @type {any} */ (registry.get(id))?.restored ?? null);
  const ids = [await launch("one"), await launch("two"), await launch("three"), await launch("four")];
  assert.deepEqual(restored(ids), ["let-go", null, null, null]);
  // The second is asked again: its conversation is the newest now, and the third and fourth are idle the longest.
  const f = registry.followUp(ids[1], { prompt: "and now?", chainId: "c1" });
  await (f.ok ? f.done : null);
  ids.push(await launch("five"));
  assert.deepEqual(restored(ids), ["let-go", null, "let-go", "let-go", null], "the third and fourth went; the second, asked since, stays");
  // One alone past the whole budget: it just ended, and keeps its conversation for its next message.
  size = "y".repeat(BUDGET + 10);
  const huge = await launch("six");
  assert.equal(restored([huge])[0], null, "the one that just ended keeps it");
  assert.ok(registry.census().keptChars > BUDGET, "held whole, past the budget");
});

// (fails before: yes — Fable 5.2's review of 11-17: after a restart every thread a chat kept came back with its
// conversation whole, and nothing held them to the budget until some exchange ended)
test("threads read back after a restart are held to the budget at once, in place, the longest idle first", async () => {
  const store = threadStore();
  const big = "x".repeat(Math.ceil(BUDGET / 2.5));
  let clock = 1_000;
  const before = scripted(async ({ body }) => ({ report: `${big} REPORT ON ${textOf(body.messages.at(-1)).split("\n").at(-1)}` }), store, { now: () => (clock += 1_000), keptChars: BUDGET * 10 });
  /** @type {string[]} */
  const ids = [];
  for (const task of ["one", "two", "three", "four"]) {
    const r = await before.registry.launch({ origin: "owner", chainId: "c1", prompt: task, description: task, deliver: false });
    await (r.ok ? r.done : null);
    ids.push(r.ok ? r.id : "");
  }
  assert.ok((store.threads.get("c1") || []).every((t) => t.convo?.length), "each kept whole");
  const after = scripted(async () => ({ report: "x" }), store, { now: () => (clock += 1_000), keptChars: BUDGET });
  const rows = /** @type {any[]} */ (after.registry.list("c1"));
  assert.deepEqual(ids.map((id) => rows.find((x) => x.id === id)?.restored ?? null), ["let-go", "let-go", null, null], "the two idle the longest let theirs go; the newer two keep theirs");
  assert.ok(after.registry.census().keptChars <= BUDGET);
  assert.equal(rows.length, 4, "every thread is there");
});

// (fails before: yes — Fable 5.2's review of 11-17: conversations a graph will ask for again counted against the budget
// they can never come under, so every other ended conversation went; and a worker that had let its conversation go was
// sent back into an empty one, reading the task's next step as though it were the whole of it)
test("what a graph holds counts for nothing against the budget, and a graph's worker that let its conversation go is sent back no more", async () => {
  const big = "x".repeat(Math.ceil(BUDGET / 2.5));
  let clock = 1_000;
  /** @type {Set<string>} */
  const held = new Set();
  const { registry } = scripted(async ({ body }) => ({ report: `${big} REPORT ON ${textOf(body.messages.at(-1)).split("\n").at(-1)}` }), { holds: () => (/** @type {string} */ id) => held.has(id), exchangeEnded: () => {} }, { now: () => (clock += 1_000), keptChars: BUDGET });
  /** @param {string} task @param {any} [o] */
  const launch = async (task, o = {}) => {
    const r = await registry.launch({ origin: "owner", chainId: "c1", prompt: task, description: task, deliver: false, ...o });
    await (r.ok ? r.done : null);
    return r.ok ? r.id : "";
  };
  const restored = (/** @type {string[]} */ ids) => ids.map((id) => /** @type {any} */ (registry.get(id))?.restored ?? null);
  // Three a graph holds, past the budget between them, then two of the side's.
  const workers = [];
  for (const t of ["t1", "t2", "t3"]) {
    const id = await launch(`task ${t}`, { origin: "agent", background: true, task: { id: t, review: false }, requestId: "turn-1" });
    held.add(id);
    workers.push(id);
  }
  const side = [await launch("side one"), await launch("side two")];
  assert.deepEqual(restored([...workers, ...side]), [null, null, null, null, null], "the graph's stay, and the side's are under the budget alone");
  // The graph lets the first go: past the budget now, the worker idle the longest lets its conversation go.
  held.delete(workers[0]);
  await launch("side three");
  assert.equal(restored([workers[0]])[0], "let-go");
  assert.equal(registry.resumable(workers[0], "c1"), "Filament let its conversation go to keep its memory bounded", "sent back, a new worker takes the task");
  const r = registry.resumeTask(workers[0], { chainId: "c1", prompt: "fix the review's findings", requestId: "turn-2" });
  assert.deepEqual(r, { ok: false, error: `sub-agent ${workers[0]} can't go on with its task: Filament let its conversation go to keep its memory bounded` });
  assert.equal(registry.resumable(workers[1], "c1"), null, "one that kept its conversation goes on in it");
  const subagents = readFileSync(new URL("../src/app/agent/subagents.js", import.meta.url), "utf8");
  assert.match(subagents, /sa\.convo = \[\];\s+if \(sa\.remote\) sa\.remote\.held = 0;\s+else sa\.restored = "let-go";/, "one on another machine sends its next message there whole");
});

// (fails before: no — a graph task's record is its graph, and a session that keeps no threads refuses in words)
test("a graph task's sub-agent is not kept as a thread, and a session that kept none says so of an unknown id", async () => {
  const store = threadStore();
  const { registry } = scripted(async () => ({ report: "TASK DONE" }), { ...store, exchangeEnded: () => {} });
  const t = await registry.launch({ origin: "agent", chainId: "c1", prompt: "THE BRIEF OF t1", description: "t1: Fix the parser", background: true, task: { id: "t1", review: false }, requestId: "turn-1" });
  await (t.ok ? t.done : null);
  assert.equal(store.threads.get("c1"), undefined, "the graph keeps its tasks' agents (the Plan tab)");
  const after = scripted(async () => ({ report: "x" }), store);
  assert.deepEqual(after.registry.list("c1"), []);
  const f = after.registry.followUp(t.ok ? t.id : "", { prompt: "again", chainId: "c1" });
  assert.equal(f.ok ? "" : f.error, `no sub-agent ${t.ok ? t.id : ""} in this session (the person may have deleted it; a session keeps its newest 30, and every one whose work waits for the person's Apply)`);
});

// (fails before: yes — after a restart a kept answer went on in its held words, with no way to ask the agent more)
test("an answer kept with the developer is sent on after a restart in the registry's own words, with the way to ask more, once", async () => {
  const store = threadStore();
  const first = scripted(async () => ({ report: "FOUND THE LEAK" }), store);
  const r = await first.registry.launch({ origin: "owner", chainId: "c1", prompt: "find the leak", description: "Leak", deliver: false });
  const id = r.ok ? r.id : "";
  await (r.ok ? r.done : null);
  const after = scripted(async () => ({ report: "x" }), store);
  assert.deepEqual(after.registry.send(id, "c1", 0), { ok: true, into: "queue" });
  const q = after.registry.peekQueued("c1");
  // Its conversation kept, it is asked more in the same context, after the restart too.
  assert.match(q[0].text, new RegExp(`the developer is passing you the report of sub-agent ${id} \\("Leak"\\)[\\s\\S]*FOUND THE LEAK[\\s\\S]*To ask it more in the same context, call agent with agent_id "${id}"\\.\\]$`));
  assert.equal(store.held.get("c1")?.length, 0, "sent: no longer kept");
  assert.equal(/** @type {any} */ (after.registry.list("c1"))[0].exchanges[0].delivery, "sent");
  const twice = after.registry.send(id, "c1", 0);
  assert.equal(twice.ok ? "" : twice.error, `that report of ${id} is already with the main agent`);
  const next = scripted(async () => ({ report: "x" }), store);
  assert.equal(/** @type {any} */ (next.registry.list("c1"))[0].exchanges[0].delivery, "sent", "the session's record says so after another restart");
});

// (fails before: yes — the main agent's follow-up after a restart was refused: "no sub-agent … none outlives a restart")
test("the main agent follows up its own sub-agent after a restart: with its conversation kept it goes on in it; without, a fresh agent answers its call, and the call's answer says so", async () => {
  const store = threadStore();
  const first = scripted(async () => ({ report: "THREE CALLERS" }), store);
  const door = openDoor(first.registry);
  const res = await door.subagents.run({ id: "toolu_1", input: { run_in_background: false, description: "Callers", prompt: "who calls parse()?" }, emit: () => {}, signal: null });
  const id = String(/** @type {any} */ (first.registry.list("c1"))[0].id);
  assert.match(res.text, /^THREE CALLERS/);
  door.close();

  // Its conversation kept (10-26): its call's answer offers the same context, and says nothing of a fresh start.
  const kept = scripted(async () => ({ report: "AND ONE TEST" }), store);
  const door1 = openDoor(kept.registry, { runId: "turn-2" });
  const went = await door1.subagents.run({ id: "toolu_2", input: { run_in_background: false, agent_id: id, prompt: "and its tests?" }, emit: () => {}, signal: null });
  assert.match(went.text, new RegExp(`^AND ONE TEST[\\s\\S]*to ask it more in the same context, call agent with agent_id "${id}"`));
  assert.doesNotMatch(went.text, /started fresh/);
  assert.deepEqual(kept.posts[0].body.messages.map((/** @type {any} */ m) => m.role), ["user", "assistant", "user"], "its conversation, then the call's message");
  door1.close();

  // A conversation not there whole (a message of it kept no more): a fresh agent takes the thread up.
  for (const t of store.threads.get("c1") || []) t.convo = null;
  // The thread as it stood before the follow-up above: its first exchange alone.
  const t0 = (store.threads.get("c1") || [])[0];
  t0.exchanges = t0.exchanges.slice(0, 1);

  const after = scripted(async () => ({ report: "AND ONE TEST" }), store);
  const door2 = openDoor(after.registry, { runId: "turn-2" });
  const again = await door2.subagents.run({ id: "toolu_2", input: { run_in_background: false, agent_id: id, prompt: "and its tests?" }, emit: () => {}, signal: null });
  assert.match(again.text, new RegExp(`^AND ONE TEST[\\s\\S]*\\[Filament: sub-agent ${id} — to ask it more in the same context, call agent with agent_id "${id}"\\. It started fresh for this message, from what was said in its thread: Filament restarted since it last worked\\. `));
  assert.match(firstBlocks(after.posts[0]).find((/** @type {string} */ t) => t.startsWith("<thread")) || "", /Message 1, from the session's main agent:\nwho calls parse\(\)\?\n\nYour answer:\nTHREE CALLERS\n<\/thread>$/);
  assert.equal(firstBlocks(after.posts[0]).at(-1), "and its tests?", "the main agent's follow-up says what it wants said: nothing is added to it");
  door2.close();
});

// (fails before: yes — a copy of the main agent was gone with the process, like every other)
test("a thread begun as a copy of the main agent goes on fresh on the same model: it reads the session folded, and runs as its card", async () => {
  const store = threadStore();
  const first = scripted(async () => ({ report: "FORKED REPORT" }), store);
  const base = { model: "m-big", max_tokens: 64000, thinking: { type: "enabled", budget_tokens: 2048 }, system: "SYS", tools: [{ name: "read" }] };
  const door = openDoor(first.registry, { model: "m-big", fork: () => ({ body: { ...base, messages: [{ role: "user", content: "fix the parser" }] }, headers: {} }) });
  const r = await first.registry.launch({ origin: "owner", chainId: "c1", prompt: "look again", description: "Look", view: "fork", deliver: false });
  const id = r.ok ? r.id : "";
  await (r.ok ? r.done : null);
  door.close();

  /** @type {any} */
  let host = null;
  /** @type {any[]} */
  const views = [];
  const after = scripted(
    async ({ id: sid }) => {
      host = after.registry.hostOf(sid);
      return { report: "LOOKED" };
    },
    { ...store, view: async (/** @type {string} */ _c, /** @type {any} */ strategy) => (views.push(strategy), { text: "User: fix the parser", turns: 1 }) },
  );
  const [row] = /** @type {any[]} */ (after.registry.list("c1"));
  assert.deepEqual([row.view, row.model, row.restored], ["fork", "m-big", "restart"]);
  assert.deepEqual(/** @type {any} */ (after.registry.detail(id)).opening.map((/** @type {any} */ b) => [b.kind, b.text]), [["fork", ""]]);
  const f = after.registry.followUp(id, { prompt: "and now?", chainId: "c1" });
  await (f.ok ? f.done : null);
  assert.equal(after.posts[0].body.model, "agent/m-big", "the model it ran on");
  assert.equal(host.fork, null, "no request of the main agent's to copy again: it runs as its card");
  assert.match(firstBlocks(after.posts[0])[0], /^<conversation view="folded" turns="1">/, "the session folded");
  assert.equal(views.length, 1);
});

// (fails before: yes — HarnessV4_Tasks E15 step 2: the turn running when an agent was asked, and a change handed to it
// as a patch, both stood under "Memory brief · N lines" and the brain in its conversation)
test("the context an agent was handed is named for what it is: the conversation, the running turn, the question that waited, a patch", () => {
  assert.deepEqual(
    [["view", 2], ["view", 1], ["running", 3], ["running", 1], ["waiting", 1], ["changes", 2], ["changes", 1], ["fork", 12], ["review", 1]].map(([kind, count]) => openingWords({ kind: String(kind), count: Number(count) })),
    ["Conversation · 2 turns", "Conversation · 1 turn", "The running turn · 3 rounds", "The running turn · 1 round", "The question waiting for your answer", "What changed · 2 files", "What changed · 1 file", "The main agent's conversation · 12 messages, as sent", "The change it reviews · 1 file"],
  );
});

// (fails before: yes — HarnessV4_OneAgent_Plan L47: nothing said which reply of the main agent sent an agent, so the
// picture of its own work could not stand one reply's agents side by side)
test("each launch says the reply that sent it — the turn's run and its round — kept through a restart; one you started, and a follow-up you sent, say none", async () => {
  const store = threadStore();
  let round = 3;
  const first = scripted(async () => ({ report: "SEEN" }), store);
  const door = openDoor(first.registry, { round: () => round });
  /** @param {string} id @param {string} prompt */
  const launch = async (id, prompt) => String(/sa_[0-9a-f]{8}/.exec(String((await door.subagents.run({ id, input: { description: prompt, prompt, run_in_background: true }, emit: () => {}, signal: null })).text))?.[0]);
  const a = await launch("a1", "SCOUT ONE");
  const b = await launch("a2", "SCOUT TWO");
  await until(() => [a, b].every((id) => first.registry.get(id)?.status === "done"), "the two reported: the chat runs two at once");
  round = 5;
  const c = await launch("a3", "BUILD IT");
  const mine = await first.registry.launch({ origin: "owner", chainId: "c1", prompt: "mine", description: "Mine", deliver: false });
  assert.ok(mine.ok);
  await (mine.ok ? mine.done : null);
  await until(() => [a, b, c].every((id) => first.registry.get(id)?.status === "done"), "the three reported");
  /** @param {any} reg */
  const sentOf = (reg) => Object.fromEntries(reg.list("c1").map((/** @type {any} */ r) => [r.id, r.exchanges.map((/** @type {any} */ x) => x.sentIn ?? null)]));
  const want = { [a]: [{ run: "turn-1", round: 3 }], [b]: [{ run: "turn-1", round: 3 }], [c]: [{ run: "turn-1", round: 5 }], [mine.ok ? mine.id : ""]: [null] };
  assert.deepEqual(sentOf(first.registry), want, "one reply's two side by side, the later reply's apart, yours none");
  door.close();
  const after = scripted(async () => ({ report: "AGAIN" }), store);
  assert.deepEqual(sentOf(after.registry), want, "kept through a restart");
  const f = after.registry.followUp(a, { prompt: "and more?", chainId: "c1" });
  assert.ok(f.ok, JSON.stringify(f));
  await (f.ok ? f.done : null);
  assert.deepEqual(sentOf(after.registry)[a], [{ run: "turn-1", round: 3 }, null], "a follow-up you sent: no reply of your agent's");
});

// (fails before: yes — the review of a8e034ded: any effort asked refused a fork, so a side run's task picked at the main
// agent's own level lost its fork and started from its brief)
test("a fork asked at the main agent's own effort forks all the same; at another level it is refused in words", async () => {
  const { registry } = scripted(async () => ({ report: "FORKED" }), { settings: () => ({ subagents: { pool: [{ model: "", seats: 2 }] }, loop: { permissions: "edit" }, model: { effort: "high" } }) });
  const base = { model: "m-big", max_tokens: 64000, system: "SYS", tools: [{ name: "read" }] };
  const door = openDoor(registry, { model: "m-big", fork: () => ({ body: { ...base, messages: [{ role: "user", content: "fix the parser" }] }, headers: {} }) });
  const other = registry.launch({ origin: "owner", chainId: "c1", prompt: "x", view: "fork", effort: "low" });
  assert.match(String(other.ok ? "" : other.error), /a fork runs as the main agent's request does, its effort with it/);
  const same = registry.launch({ origin: "owner", chainId: "c1", prompt: "x", view: "fork", effort: "High" });
  assert.ok(same.ok, String(same.ok ? "" : same.error));
  assert.equal(/** @type {any} */ (registry.list("c1")[0]).view, "fork");
  if (same.ok) await same.done;
  door.close();
});

// (fails before: yes — the review of 5b35e53aa: a fork's level was read from the chat's setting as it is now, which may
// have moved since the turn it copies went)
test("a fork's level is the one its copied request went at, as its model's name spells it: the chat's setting since does not move it", async () => {
  const effortOf = (/** @type {string} */ m) => {
    const s = /-(low|medium|high)$/.exec(m);
    return { level: s ? s[1] : null, wire: m, levels: ["low", "medium", "high"], spelled: !!s };
  };
  const { registry } = scripted(async () => ({ report: "FORKED" }), { effortOf, settings: () => ({ subagents: { pool: [{ model: "", seats: 2 }] }, loop: { permissions: "edit" }, model: { effort: "low" } }) });
  const base = { model: "m-big-high", max_tokens: 64000, system: "SYS", tools: [{ name: "read" }] };
  const door = openDoor(registry, { model: "m-big-high", fork: () => ({ body: { ...base, messages: [{ role: "user", content: "fix the parser" }] }, headers: {} }) });
  const low = registry.launch({ origin: "owner", chainId: "c1", prompt: "x", view: "fork", effort: "low" });
  assert.match(String(low.ok ? "" : low.error), /a fork runs as the main agent's request does, its effort with it/, "the chat moved to low after its turn went at high");
  const high = registry.launch({ origin: "owner", chainId: "c1", prompt: "x", view: "fork", effort: "high" });
  assert.ok(high.ok, String(high.ok ? "" : high.error));
  if (high.ok) await high.done;
  door.close();
});

// (fails before: yes — the owner's of 11-17: the page's list carried each exchange's words to 4,000 characters, 2.28 of
// its 2.48 MB, read again at each move of an agent; there was no head form)
test("the page's list carries each exchange's words as heads, saying which were cut; every other field, and every other reader's list, as before", async () => {
  const { registry } = scripted(async ({ n }) => ({ report: n === 1 ? `R${"r".repeat(2999)}` : n === 2 ? "SHORT ANSWER" : `L${"l".repeat(4999)}` }));
  const asks = [`P${"p".repeat(1999)}`, "short ask", `Q${"q".repeat(4499)}`];
  for (const prompt of asks) {
    const r = registry.launch({ origin: "owner", chainId: "c1", prompt, description: prompt.slice(0, 8), view: "none", deliver: false });
    assert.ok(r.ok, String(r.ok ? "" : r.error));
    await (r.ok ? r.done : null);
  }
  const cards = /** @type {any[]} */ (registry.list("c1"));
  const heads = /** @type {any[]} */ (registry.list("c1", { head: true }));
  const xs = (/** @type {any[]} */ rows) => rows.map((r) => r.exchanges[0]);
  const cut = (/** @type {string} */ s, /** @type {number} */ n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  // Newest first: the 4,500-character ask, the short one, the 2,000-character one.
  assert.deepEqual(xs(cards).map((x) => [x.prompt.length, x.report.length, x.promptHead, x.reportHead]), [[4000, 4000, undefined, undefined], [9, 12, undefined, undefined], [2000, 3000, undefined, undefined]], "the cards' form as before: no word of a head");
  assert.deepEqual(xs(heads).map((x) => [x.prompt, x.report, x.promptHead, x.reportHead]), [
    [cut(asks[2], 600), cut(`L${"l".repeat(4999)}`, 600), true, true],
    ["short ask", "SHORT ANSWER", undefined, undefined],
    [cut(asks[0], 600), cut(`R${"r".repeat(2999)}`, 600), true, true],
  ], "each the whole cut at 600, and said so where it was");
  /** A row with its exchanges' words left out. @param {any} r */
  const rest = (r) => ({ ...r, exchanges: r.exchanges.map((/** @type {any} */ { prompt, report, promptHead, reportHead, ...x }) => x) });
  assert.deepEqual(heads.map(rest), cards.map(rest), "every other field the same");
  assert.deepEqual(registry.list("c1"), cards, "the cards' form again, unmoved by a head read");
});

// (fails before: no — it guards the event's own word against the list's: a rename had made it `reportHead`, which the
// page reads nowhere, so a card that heard a long end read its cut as whole and never asked for the rest)
test("a turn's subagent-end says its report was cut at the card with `reportCut`, as before the list's heads; a short one says nothing", async () => {
  const { registry } = scripted(async ({ n }) => ({ report: n === 1 ? `L${"l".repeat(4499)}` : "SHORT" }));
  const door = openDoor(registry);
  /** @type {any[]} */
  const events = [];
  for (const [id, prompt] of [["toolu_1", "the long one"], ["toolu_2", "the short one"]])
    await door.subagents.run({ id, input: { run_in_background: false, description: prompt, prompt }, emit: (/** @type {any} */ e) => events.push(e), signal: null });
  const ends = events.filter((e) => e.type === "subagent-end");
  assert.deepEqual(ends.map((e) => [e.report.length, e.reportCut, e.reportHead]), [[4000, true, undefined], [5, undefined, undefined]]);
  door.close();
});
