// @ts-check
// A coding agent's turn says what it waits on, by name (HarnessV3-FailurePoints §5.1 item 2): before its session is up,
// the turn's phase on the session's lock ("starting Claude Code", "opening Claude Code's session"); after, the run's
// ("sent — Claude Code is working", "thinking · about 2,000 tokens"). Claude's tasks while they run reach its transcript
// and the events feed (`turns`, with the chat's id): the bridge says the whole list at every change, heard here where it
// says it, and the feed says the lists at most once each TASKS_FEED_MS, the newest always (server.js `tasksOnFeed`). An
// agent process that exits says so in one line, where it was, with what it wrote to stderr under it (§5.2). Through
// the app and the fake agent in Claude's shape (fixtures/fake-acp-agent.mjs).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startApp, parseSse } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { alignEvents, turnPhaseWords, turnStateWords } from "../src/ui/harness/lib/labels.js";
import { failureWords } from "../src/app/acp-turn.js";
import { AcpBridge } from "../src/adapters/agents/acp/bridge.js";
import { CursorSdkBridge } from "../src/adapters/agents/cursor-sdk.js";
import { pathToFileURL } from "node:url";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-acp-agent.mjs");

describe("a coding agent's turn says what it waits on", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-agent-steps-"));
  const projDir = join(root, "project");
  const gates = join(root, "gates");
  before(async () => {
    mkdirSync(projDir);
    mkdirSync(gates);
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "claude", name: "Claude Code", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_WAKE_GATE: gates }, cwdDefault: projDir, permissions: "allow-all", hints: false } },
          { id: "crashy", name: "Crashy", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_NEW_CRASH: "1" }, cwdDefault: projDir, permissions: "allow-all", hints: false } },
          { id: "dying", name: "Dying", type: "acp", acp: { command: process.execPath, args: [FAKE], cwdDefault: projDir, permissions: "allow-all", hints: false } },
        ];
        cfg.routes = ["claude", "crashy", "dying"].map((id) => ({ match: `${id}/*`, upstream: id, upstreamModel: "{1}", enabled: true }));
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
    // What the bridge says of each session's tasks, every change, heard on its way to the server's own hook.
    const tasksSaid = shim.app.acp.onTasks;
    shim.app.acp.onTasks = (said) => {
      if (!told.has(said.chain)) told.set(said.chain, []);
      told.get(said.chain)?.push(said.tasks);
      tasksSaid?.(said);
    };
  });
  /** What the events feed's `turns` said of each session, in order, heard as it was said: the bus keeps nothing. */
  /** @type {Map<string, any[]>} */
  const heard = new Map();
  /** Each list the bridge said of each session, in order: every change, where the feed says one at most each TASKS_FEED_MS. */
  /** @type {Map<string, any[][]>} */
  const told = new Map();
  /** @type {(() => void)[]} */
  const unhear = [];
  after(async () => {
    for (const un of unhear) un();
    await shim.stop();
    await removeDirs(root);
  });
  /** A harness session on the agent `model`'s route names, what the feed says of it heard. @param {string} model */
  const session = async (model) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model, preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    const id = String((await r.json()).id);
    /** @type {any[]} */
    const seen = [];
    heard.set(id, seen);
    unhear.push(shim.app.events.subscribe("turns", (/** @type {any} */ p) => void (p?.chainId === id && seen.push(p))));
    return id;
  };
  /** A harness turn read to its end: its request id and its stream's events. @param {string} id @param {string} content */
  const turn = async (id, content, status = 200, extra = {}) => {
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: true, runEvents: true, ...extra } });
    assert.equal(res.status, status, await res.clone().text());
    const text = await res.text();
    return { requestId: String(res.headers.get("x-filament-request-id")), events: status === 200 ? parseSse(text) : [], body: status === 200 ? null : JSON.parse(text) };
  };
  /** A finished turn's record. @param {string} requestId */
  const recordOf = (requestId) =>
    until(async () => {
      const r = await shim.record(requestId);
      return r?.status && r.status !== "pending" ? r : null;
    }, "the turn's record");
  /** What the feed said of the session, in order. @param {string} id @returns {any[]} */
  const said = (id) => heard.get(id) || [];
  /** Each list the bridge said of the session, as ids: every change. @param {string} id */
  const toldLists = (id) => (told.get(id) || []).map((l) => l.map((/** @type {any} */ x) => x.id));
  /** Each list the feed said of the session, as ids: the first at once, the newest always. @param {string} id */
  const fedLists = (id) => said(id).filter((p) => p.type === "agent-tasks").map((p) => p.tasks.map((/** @type {any} */ x) => x.id));
  /** Each phase the session's lock said, in order (null: none). @param {string} id */
  const phases = (id) => said(id).filter((p) => p.type === "turn").map((p) => p.holder?.phase ?? null);
  /** @param {string} runId @returns {Promise<any[]>} */
  const runEvents = async (runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events;
  /** @param {string} id */
  const transcript = async (id) => (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();

  // (fails before: yes — nothing said the agent starting or its session opening, and the run said nothing between the
  // prompt and the agent's first output: mx774dfh turns 10, 13 and 21)
  test("each step before the session is up is the turn's phase, by name, until the run starts; the run says the prompt went", async () => {
    const id = await session("claude/haiku");
    /** Each holder change of the session and each turn-state of a run, in the order said. @type {string[]} */
    const order = [];
    const unhearAll = shim.app.events.subscribe("*", (/** @type {any} */ p, /** @type {any} */ entry) => {
      if (entry.topic === "turns" && p.type === "turn" && p.chainId === id) order.push(p.holder ? `phase:${p.holder.phase?.step || "none"}` : "released");
      else if (String(entry.topic).startsWith("run:") && p.type === "turn-state") order.push(`run:${p.to}`);
    });
    const first = await turn(id, "hello there");
    unhearAll();
    const opened = order.lastIndexOf("phase:opening");
    assert.deepEqual(order.slice(opened, opened + 3), ["phase:opening", "phase:none", "run:sent"], "the run's start ends the step's phase, before the run says anything");
    const seen = phases(id);
    const steps = seen.filter((p) => p?.kind === "agent");
    assert.deepEqual(
      steps.map((p) => [p.step, p.agent, turnPhaseWords(p)]),
      [
        ["starting", "Claude Code", "starting Claude Code"],
        ["opening", "Claude Code", "opening Claude Code's session"],
      ],
    );
    const last = seen.findLastIndex((p) => p?.kind === "agent");
    assert.ok(last >= 0 && seen.slice(last + 1).length > 0 && seen[last + 1] === null, `the run's start ends the phase: ${JSON.stringify(seen)}`);
    const evs = await runEvents(first.requestId);
    const sent = evs.findIndex((e) => e.type === "turn-state" && e.to === "sent");
    assert.ok(sent >= 0, JSON.stringify(evs.filter((e) => e.type === "turn-state")));
    assert.equal(turnStateWords(evs[sent]), "sent — Claude Code is working");
    assert.ok(sent < evs.findIndex((e) => e.type === "round-start"), "said before the agent's first output");

    const before = seen.length;
    await turn(id, "and again");
    assert.deepEqual(phases(id).slice(before).filter((p) => p?.kind === "agent"), [], "the agent and its session up: no step to wait on");
  });

  // (fails before: yes — Claude's thinking before its words, and its tasks while they ran, were never asked for: the
  // page was blank until its first words, and a background task unseen until it ended — mx774dfh turns 10, 11, 25)
  test("Claude's thinking before its words is said as it grows; its tasks while they run reach the session's page and transcript", async () => {
    const id = await session("claude/haiku");
    const t = await turn(id, "~thinking now");
    const evs = await runEvents(t.requestId);
    const thinking = evs.filter((e) => e.type === "turn-state" && e.tokens);
    assert.deepEqual(thinking.map((e) => e.tokens), [40, 150, 260, 400, 520, 900, 2000, 30], "said as it grows by a quarter, a hundred at least; a new block starts again; never while a tool runs");
    assert.equal(turnStateWords(thinking[6]), "thinking · about 2,000 tokens");
    assert.equal(turnStateWords(thinking[0]), "thinking · about 40 tokens");
    assert.deepEqual(toldLists(id), [["sh1"], ["sh1", "ag1"], ["sh1", "ag1"], ["sh1"]], "every change, and a housekeeping task is nobody's to see");
    const progressed = (told.get(id) || [])[2][1];
    assert.deepEqual(
      [progressed.kind, progressed.description, progressed.background, progressed.call, progressed.subagent, progressed.tokens, progressed.tools, progressed.lastTool, progressed.summary],
      ["local_agent", "Find hello", false, "t_agent", "Explore", 1200, 3, "Grep", "Searching for hello"],
    );
    // The feed says them at most once each TASKS_FEED_MS: the first at once, and the newest always (the shell's end, below).
    assert.deepEqual(fedLists(id)[0], ["sh1"], "the first at once");
    const running = (await transcript(id)).agentTasks;
    assert.deepEqual(running.map((/** @type {any} */ x) => [x.id, x.kind, x.description, x.background]), [["sh1", "local_bash", "npm test", true]], "the turn is over; its shell runs on");
    writeFileSync(join(gates, "sh1"), "");
    await until(() => fedLists(id).at(-1)?.length === 0 || null, "the shell's end said on the feed");
    assert.deepEqual((await transcript(id)).agentTasks, []);
    // (fails before: no — a guard the mutation pass asked for: an estimate said between turns was held for the next
    // turn, which said a thinking it never did)
    const next = await runEvents((await turn(id, "and again")).requestId);
    assert.deepEqual(next.filter((e) => e.type === "turn-state" && e.tokens).map((e) => e.tokens), [], "the estimate said between turns is nobody's");
    const kept = [...shim.app.acp.convs.values()].find((/** @type {any} */ c) => c.chain === id)?.raw || [];
    assert.ok(kept.length > 0 && !kept.some((/** @type {any} */ k) => /thinking_tokens|task_(started|updated|progress)/.test(k.type)), "progress frames are not kept with the session's raw messages");
  });

  // (fails before: no — a guard the mutation pass asked for: tasks of an agent process that ended stayed on the page)
  test("an agent process that ends while its task runs ends the task on the page and in the transcript", async () => {
    rmSync(join(gates, "sh1"), { force: true });
    const id = await session("claude/haiku");
    await turn(id, "~thinking again");
    assert.deepEqual(toldLists(id).at(-1), ["sh1"], "its shell runs on after the turn");
    const conv = [...shim.app.acp.convs.values()].find((/** @type {any} */ c) => c.chain === id);
    shim.app.acp.procs.get(conv.procKey).kill();
    await until(() => fedLists(id).at(-1)?.length === 0 || null, "the tasks' end said on the feed");
    assert.deepEqual((await transcript(id)).agentTasks, []);
  });

  // (fails before: yes — the page's headline was the process's stderr: "agent process exited (code 1): [session/create]
  // …", mx774dfh turn 14)
  test("an agent process that exits says so in one line, where it was; what it wrote to stderr goes under it", async () => {
    const crashy = await session("crashy/m");
    const opening = await turn(crashy, "hello", 502);
    const held = said(crashy).filter((p) => p.type === "turn").map((p) => (p.holder ? p.holder.phase?.step || "none" : "released"));
    assert.deepEqual(held.slice(held.lastIndexOf("opening")), ["opening", "none", "released"], "its step ends with the turn, while it still holds the session: a fallback may run under it");
    assert.deepEqual(
      [opening.body.error.message, opening.body.error.detail],
      ['ACP agent "crashy" failed: agent process exited (code 1) while opening its session', "[session/create] fake: the session store is locked"],
      "before any output: the reply's error",
    );
    const rec = await recordOf(opening.requestId);
    assert.deepEqual([rec.error, rec.errorDetail], ["agent process exited (code 1) while opening its session", "[session/create] fake: the session store is locked"]);

    const dying = await session("dying/m");
    const during = await turn(dying, "~lastwords now");
    const err = during.events.at(-1);
    assert.equal(err?.event, "error", "its words went out first: the stream's error");
    assert.deepEqual([err.data.error.message, err.data.error.detail], ["agent process exited (code 3) during the turn", "fake agent: gone for good"]);
    const rec2 = await recordOf(during.requestId);
    assert.deepEqual([rec2.error, rec2.errorDetail], ["agent process exited (code 3) during the turn", "fake agent: gone for good"]);
    // (fails before: yes — HarnessV4_Tasks B1: a coding agent's turn that failed kept nothing in the session: no work
    // and no mark, so a reload showed a bare failure and the next turn's history never heard of the edit it had made)
    const kept = (await transcript(dying)).turns.at(-1);
    assert.deepEqual([kept.open, kept.final, kept.failed?.cause, kept.failed?.text], [true, null, "agent process exited (code 3) during the turn", "last words"]);
    assert.deepEqual(shapeOf(kept.work), [["assistant", ["tool_use:t1"]], ["user", ["tool_result:t1"]], ["assistant", ["working… ", "tool_use:e9"]], ["user", ["tool_result:e9"]]], "its work as the agent gave it, every call answered");
  });

  // (fails before: yes — HarnessV4_Tasks B6: the wait for a new session's commands said nothing)
  test("the wait for a session's commands is a step with words of its own", () => {
    assert.equal(turnPhaseWords({ kind: "agent", step: "commands", agent: "Claude Code" }), "waiting for Claude Code to say its commands");
  });

  /** A turn's work, each message by its role and its blocks: a text's words, a call or a result by its id. @param {any[]} work */
  const shapeOf = (work) => work.map((m) => [m.role, m.content.map((/** @type {any} */ b) => (b.type === "text" ? b.text : `${b.type}:${b.id || b.tool_use_id}`))]);
  /** A message's words. @param {any} m */
  const textOf = (m) => (Array.isArray(m?.content) ? m.content.filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("") : String(m?.content || ""));

  // (fails before: yes — HarnessV4_Tasks B15: the adapter's failure over calls left unanswered ended a turn the agent
  // had answered as an error, its reply and work dropped; and a turn that did fail said nothing of what the agent's
  // context held, B1)
  test("a turn the agent's adapter failed over unanswered calls: kept as ended where the agent had answered, a failure with its work and its count where it had not", async () => {
    const id = await session("dying/m");
    const ended = await turn(id, "~openend now");
    assert.equal(ended.events.some((e) => e.event === "error"), false, "no error on the stream");
    const rec = await recordOf(ended.requestId);
    assert.deepEqual([rec.status, rec.error ?? null, rec.stopReason], ["ok", null, "end_turn"]);
    assert.equal(rec.changes.filter((/** @type {string} */ c) => /^acp: Dying's adapter failed this prompt after Dying had answered: 1 tool call had no result when the turn ended/.test(c)).length, 1, "the adapter's complaint is the turn's note");
    const done = (await transcript(id)).turns.at(-1);
    assert.deepEqual([done.open, done.failed ?? null, textOf(done.final)], [false, null, "all done"]);
    assert.deepEqual(shapeOf(done.work), [["assistant", ["tool_use:t1", "tool_use:bg1"]], ["user", ["tool_result:t1", "tool_result:bg1"]]], "its work is the turn's");
    assert.equal(/** @type {any} */ (done.work.at(-1)).content[1].content, "Claude ended the turn without returning a result for this tool.", "the call reads as the adapter closed it");

    const failed = await turn(id, "~openend noreply");
    const err = failed.events.at(-1);
    assert.deepEqual([err?.event, err?.data.error.message], ["error", "Internal error: Claude ended the turn without returning results for tool calls: bg1"], "nothing answered the person: the failure stands");
    const rec2 = await recordOf(failed.requestId);
    assert.deepEqual([rec2.status, rec2.context?.last?.held, rec2.context?.window], ["error", 4321, 200000], "and its record says what the agent's context held");
    const open = (await transcript(id)).turns.at(-1);
    assert.deepEqual([open.open, open.failed?.cause, open.facts?.context?.held], [true, "Internal error: Claude ended the turn without returning results for tool calls: bg1", 4321]);
    assert.deepEqual(shapeOf(open.work), [["assistant", ["tool_use:t1", "tool_use:bg1"]], ["user", ["tool_result:t1", "tool_result:bg1"]]], "the failed turn's work is kept");
  });

  // (fails before: yes — HarnessV4_Tasks B8: a message sent again after its turn failed rode twice in the request and
  // was one turn of the chat; the agent's session counted two, and took the next turn another engine answered for one
  // it had seen: it came back knowing nothing of it)
  test("a message sent again after its turn failed is one turn to the agent's session: the turn another engine answers next is handed to it", async () => {
    const id = await session("dying/m");
    await turn(id, "first of all");
    const message = `~failonce b8${Math.random().toString(36).slice(2, 8)} fix the parser`;
    const failed = await turn(id, message);
    assert.equal(failed.events.at(-1)?.event, "error", "the first try fails");
    const kept = (await transcript(id)).turns;
    assert.deepEqual([kept.length, kept.at(-1).open, kept.at(-1).failed?.text, kept.at(-1).work.length > 0], [2, true, "half done", true], "and keeps what it did");
    const again = await turn(id, message);
    assert.equal(again.events.some((e) => e.event === "error"), false);
    const after = (await transcript(id)).turns;
    assert.deepEqual([after.length, after.at(-1).open, after.at(-1).failed ?? null], [2, false, null], "the message again goes on in the same turn of the chat");
    const notes = async (/** @type {string} */ requestId) => (await recordOf(requestId)).changes.filter((/** @type {string} */ c) => /handled elsewhere/.test(c));
    assert.deepEqual(await notes(again.requestId), [], "its own earlier try is no turn of another assistant's");
    /** @param {string} model */
    const to = async (model) => assert.equal((await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { model: { name: model } } } })).status, 200);
    // Each switch answers its question Send as it is (HarnessV4_Tasks A7).
    await to("claude/haiku");
    await turn(id, "a turn elsewhere", 200, { sendAsIs: true });
    await to("dying/m");
    const back = await turn(id, "back here", 200, { sendAsIs: true });
    assert.deepEqual(await notes(back.requestId), ["acp: 1 turn(s) handled elsewhere since this session's last turn were included so the agent catches up"]);
  });
});

// (fails before: yes — nothing said a session being found and resumed, or reopened in another agent process, before
// the prompt went: HarnessV3-FailurePoints §5.1 item 2)
test("a session resumed, or reopened in another agent process, is said as such before the prompt goes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-agent-steps-resume-"));
  const b = new AcpBridge(/** @type {any} */ ({ log: () => {} }));
  const upstream = { id: "resumer", name: "Resumer", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_ALLOW_LOAD: "1" }, cwdDefault: dir, permissions: "allow-all" } };
  /** The steps of a turn of chat R on the agent's `sess_old1`, on `model`'s process. @param {string} model */
  const steps = async (model) => {
    /** @type {any[]} */
    const events = [];
    const body = { model: "m", max_tokens: 100, messages: [{ role: "user", content: "hello" }] };
    await b.run({ upstream, modelId: model, format: "anthropic", body, conversationId: "R", resumeSessionId: "sess_old1", onEvent: (/** @type {any} */ e) => void events.push(e) });
    return events.filter((e) => e.type === "step").map((e) => e.step);
  };
  try {
    assert.deepEqual(await steps("fake-b"), ["starting", "resuming", "sent"], "the session found, and resumed");
    assert.deepEqual(await steps("fake-a"), ["starting", "resuming", "sent"], "reopened in the other model's process");
    assert.deepEqual(await steps("fake-a"), ["sent"], "up in its process: nothing to wait on");
  } finally {
    b.shutdown();
    await removeDirs(dir);
  }
});

// (fails before: yes — nothing said the session's mode, model or effort switching before the prompt went; then the
// effort set as the model's own option was said as the model again: "switching Claude to sonnet" while it set "high")
test("a session's switches are said as each is asked, with what to: its mode, its model, its effort", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-agent-steps-switch-"));
  const b = new AcpBridge(/** @type {any} */ ({ log: () => {} }));
  const upstream = { id: "switcher", name: "Switcher", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_CONFIG: "1" }, cwdDefault: dir, permissions: "allow-all", modelSelection: "session" } };
  /** The steps of chat S's turn, as `[step, to]`. @param {string} model @param {string} mode @param {string} effort */
  const steps = async (model, mode, effort) => {
    /** @type {any[]} */
    const events = [];
    const body = { model: "m", max_tokens: 100, messages: [{ role: "user", content: "hello" }] };
    await b.run({ upstream, modelId: model, mode, effort, format: "anthropic", body, conversationId: "S", onEvent: (/** @type {any} */ e) => void events.push(e) });
    return events.filter((e) => e.type === "step").map((e) => (e.to ? [e.step, e.to] : [e.step]));
  };
  try {
    assert.deepEqual(await steps("sonnet", "plan", "high"), [["starting"], ["opening"], ["mode", "plan"], ["model", "sonnet"], ["effort", "high"], ["sent"]]);
    assert.deepEqual(await steps("sonnet", "plan", "high"), [["sent"]], "each as it was: nothing asked");
    assert.deepEqual(await steps("opus[1m]", "agent", "low"), [["mode", "bypassPermissions"], ["model", "opus[1m]"], ["effort", "low"], ["sent"]], "the agent's own name for the mode");
    assert.deepEqual(await steps("default", "agent", "xhigh"), [["effort", "xhigh"], ["sent"]], "the effort alone, as its own option");
    // An agent that offers no model option: its model set on its own (`session/set_model`), said the same way.
    const plain = { ...upstream, id: "plain-switcher", acp: { ...upstream.acp, env: {} } };
    /** @type {any[]} */
    const events = [];
    await b.run({ upstream: plain, modelId: "fake-b", format: "anthropic", body: { model: "m", max_tokens: 100, messages: [{ role: "user", content: "hello" }] }, conversationId: "P", onEvent: (/** @type {any} */ e) => void events.push(e) });
    assert.deepEqual(events.filter((e) => e.type === "step").map((e) => (e.to ? [e.step, e.to] : [e.step])), [["starting"], ["opening"], ["model", "fake-b"], ["sent"]]);
  } finally {
    b.shutdown();
    await removeDirs(dir);
  }
});

// (fails before: yes — nothing said Cursor's agent opening or resumed, or the message gone out: HarnessV3-FailurePoints
// §5.1 item 2)
test("Cursor's agent opened or resumed, and the message gone out, are said as with every agent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-agent-steps-cursor-"));
  const SDK = pathToFileURL(join(dirname(FAKE), "fake-cursor-sdk.mjs")).href;
  const b = new CursorSdkBridge(/** @type {any} */ ({ log: () => {}, loader: () => import(SDK) }));
  const upstream = { id: "steps-sdk", name: "Cursor", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: dir, permissions: "allow-all" } };
  /** A turn of `chat`: its result and its steps. @param {string} chat @param {string | null} [resume] */
  const turn = async (chat, resume = null) => {
    /** @type {any[]} */
    const events = [];
    const body = { model: "m", max_tokens: 100, messages: [{ role: "user", content: "hello" }] };
    const out = await b.run({ upstream, modelId: "composer-2.5", format: "anthropic", body, conversationId: chat, resumeSessionId: resume, onEvent: (/** @type {any} */ e) => void events.push(e) });
    return { out, steps: events.filter((e) => e.type === "step").map((e) => e.step) };
  };
  try {
    const first = await turn("B");
    assert.deepEqual(first.steps, ["opening", "sent"]);
    assert.deepEqual((await turn("B")).steps, ["sent"], "its agent up: nothing to wait on");
    assert.deepEqual((await turn("A", first.out.sessionId)).steps, ["sent"], "another chat's agent, up: nothing to wait on");
    b.agents.delete(first.out.sessionId); // let go of, as a restart of Filament's does
    assert.deepEqual((await turn("B")).steps, ["resuming", "sent"], "the chat's agent, resumed");
  } finally {
    b.shutdown();
    await removeDirs(dir);
  }
});

test("a failure's words: an exit's headline and where the agent was, its stderr apart; any other in its own words", () => {
  const exit = Object.assign(new Error("agent process exited (code 1): boom"), { exit: { code: 1, signal: null, headline: "agent process exited (code 1)", stderr: "boom" } });
  assert.deepEqual(failureWords(exit, "starting"), { said: "agent process exited (code 1) while it started", detail: "boom" });
  assert.deepEqual(failureWords(exit, "resuming"), { said: "agent process exited (code 1) while resuming its session", detail: "boom" });
  assert.deepEqual(failureWords(exit, "mode"), { said: "agent process exited (code 1) while switching its mode", detail: "boom" });
  assert.deepEqual(failureWords(exit, "model"), { said: "agent process exited (code 1) while switching its model", detail: "boom" });
  assert.deepEqual(failureWords(exit, "effort"), { said: "agent process exited (code 1) while setting its effort", detail: "boom" });
  assert.deepEqual(failureWords(exit, ""), { said: "agent process exited (code 1)", detail: "boom" }, "no step named: the exit alone");
  const quiet = Object.assign(new Error("agent process exited (code 2)"), { exit: { code: 2, signal: null, headline: "agent process exited (code 2)", stderr: "" } });
  assert.deepEqual(failureWords(quiet, "sent"), { said: "agent process exited (code 2) during the turn", detail: null });
  assert.deepEqual(failureWords(new Error("Overloaded"), "sent"), { said: "Overloaded", detail: null });
});

test("the page keeps the run's estimate of the agent's thinking, in its words", () => {
  const { turnState } = alignEvents([{ type: "turn-state", from: "idle", to: "planning", why: "thinking", tokens: 2000 }]);
  assert.equal(turnStateWords(turnState), "thinking · about 2,000 tokens");
});

test("a coding agent's steps in the turn's words: its mode, model and effort switches too", () => {
  const p = (/** @type {string} */ step, /** @type {string} */ to = "") => turnPhaseWords({ kind: "agent", step, agent: "Claude", ...(to ? { to } : {}) });
  assert.deepEqual(
    [p("resuming"), p("mode", "plan"), p("model", "sonnet"), p("effort", "high"), p("effort"), p("mode"), p("model"), p("unknown"), turnPhaseWords({ kind: "agent", step: "opening" })],
    ["resuming Claude's session", "switching Claude to plan mode", "switching Claude to sonnet", "setting Claude's effort to high", "setting Claude's effort", "switching Claude to another mode", "switching Claude to another model", "", "opening the agent's session"],
  );
});
