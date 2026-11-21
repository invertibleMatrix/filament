// @ts-check
// HarnessV3-ACP AC3-9 through the app and a fake agent in Claude's shape (fixtures/fake-acp-agent.mjs, FAKE_ACP_CLAUDE,
// `~wake`): a cycle Claude begins by itself between a harness chat's turns — a background task it launched ended —
// shows in that chat as a turn of its own, run as the chat's turns are: its run and record, its words and thoughts,
// the tasks it answers, the lock while it runs, the Stop, the session's switch for what it asks. A background
// sub-agent's work draws none, nor does a session no harness chat holds. The page's side: the row in the message's
// place, the words for who holds the turn, and what a way on sends again.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeUpstream, startApp, parseSse } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { AcpBridge } from "../src/adapters/agents/acp/bridge.js";
import { startCommandShell } from "../src/adapters/tools/hands.js";
import { COMPACTION_HEADER } from "../src/adapters/agents/compactions.js";
import { summaryHead, summaryLead } from "../src/app/sessions/compaction.js";
import { ownTurnText } from "../src/core/messages.js";
import { wireOwnTurns } from "../src/app/own-turns.js";
import { SessionTurns } from "../src/services/session-turns.js";
import { houseAuth, houseKey } from "../src/services/house.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { ownRow, footerEl } from "../src/ui/harness/conversation/turn.js";
import { transcriptTurns } from "../src/ui/harness/conversation/history.js";
import { workingWords, wordsAgain, againOf, agentQueuesWords } from "../src/ui/harness/lib/labels.js";
import { queueText, waitingToast } from "../src/ui/harness/waiting.js";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-acp-agent.mjs");
const CODEX = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-codex-app-server.mjs");

describe("a coding agent's own turns (HarnessV3-ACP AC3-9)", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-acp-own-"));
  const projDir = join(root, "project");
  const log = join(root, "prompts.jsonl");
  /** The session methods the agent was sent (FAKE_ACP_CALLS), the prompts queued at it among them. */
  const calls = join(root, "calls.jsonl");
  const gates = join(root, "gates");
  /** Where a test says the agent's next call comes (FAKE_ACP_TICK_DIR). */
  const ticks = join(root, "ticks");
  /**
   * The agent's next call: what the developer typed waits in Filament for it (HarnessV4_Tasks C34), and goes then. Its
   * agent has made it once the file is gone.
   */
  const tick = async () => {
    writeFileSync(join(ticks, "tick"), "");
    await until(() => !existsSync(join(ticks, "tick")) || null, "the agent's next call");
  };
  /**
   * The bridge's asks for a turn of the agent's own, as they reach the app's asker: all of them; the asks of the chat
   * `hold` names wait in `held` until `forward` sends them on.
   * @type {{ all: any[], hold: string, held: any[], real: (cycle: any) => void, forward: () => void }}
   */
  const asks = {
    all: [],
    hold: "",
    held: [],
    real: () => {},
    forward() {
      asks.hold = "";
      for (const cycle of asks.held.splice(0)) asks.real(cycle);
    },
  };
  /** A chat's asks. @param {string} chain */
  const asksOf = (chain) => asks.all.filter((a) => a.chain === chain);
  /** What the bridge logged. @type {string[]} */
  const logged = [];
  before(async () => {
    mkdirSync(projDir);
    mkdirSync(gates);
    mkdirSync(ticks);
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "claude", name: "Claude Code", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_LOG: log, FAKE_ACP_CALLS: calls, FAKE_ACP_WAKE_GATE: gates, FAKE_ACP_TICK_DIR: ticks }, cwdDefault: projDir, permissions: "allow-all", hints: false } },
          { id: "plain", name: "Plain", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_WAKE_GATE: gates }, cwdDefault: projDir, permissions: "allow-all", hints: false } },
          { id: "cx", name: "Codex", type: "codex", acp: { command: process.execPath, args: [CODEX], env: { FAKE_CODEX_CALLS: join(root, "cx.jsonl") }, cwdDefault: projDir, permissions: "allow-all" } },
        ];
        cfg.routes = [
          { match: "claude/*", upstream: "claude", upstreamModel: "{1}", enabled: true },
          { match: "duo/*", upstream: "claude", upstreamModel: "{1}", enabled: true },
          { match: "plain/*", upstream: "plain", upstreamModel: "{1}", enabled: true },
          { match: "cx/*", upstream: "cx", upstreamModel: "{1}", enabled: true },
        ];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
    const acp = bridge();
    asks.real = acp.onOwnCycle;
    acp.onOwnCycle = (/** @type {any} */ cycle) => {
      asks.all.push(cycle);
      if (cycle.chain === asks.hold) asks.held.push(cycle);
      else asks.real(cycle);
    };
    const bridgeLog = acp.log;
    acp.log = (/** @type {string} */ level, /** @type {string} */ msg) => {
      logged.push(msg);
      bridgeLog(level, msg);
    };
  });
  after(async () => {
    await shim.stop();
    await removeDirs(root);
  });
  /** A harness session on Claude, or on the agent `model`'s route names, its switch at `mode`. @param {string} [mode] @param {string} [model] */
  const session = async (mode = "auto", model = "claude/haiku") => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model, preset: "plain", settings: { loop: { permissions: mode } } } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** A harness turn, as the page sends one. @param {string} id @param {string} content */
  const send = (id, content) => shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: true, runEvents: true } });
  /** A harness turn read to its end. @param {string} id @param {string} content */
  const turn = async (id, content) => {
    const res = await send(id, content);
    assert.equal(res.status, 200, await res.clone().text());
    await res.text();
    return String(res.headers.get("x-filament-request-id"));
  };
  /** @param {string} id */
  const transcript = async (id) => (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
  /**
   * The session once it holds `n` finished turns and none runs. A turn of the agent's own is its cycle in the agent's
   * process, then Filament's door and a whole turn of the pipeline's: two of them after a turn took 1 s alone, 4 s
   * beside 48 busy processes and past the default 10 s in the full suite, so the wait is given half a minute.
   * @param {string} id @param {number} n
   */
  const settled = (id, n) =>
    until(async () => {
      const t = await transcript(id);
      return t.turns.length >= n && t.turns.every((/** @type {any} */ x) => x.final) && !t.live ? t : null;
    }, `${n} finished turns`, { timeoutMs: 30_000 });
  /** The turn of the agent's own while it runs. @param {string} id */
  const running = (id) => until(async () => ((await transcript(id)).live?.own ? (await transcript(id)).live : null), "the agent's own turn running");
  /** @param {string} runId @returns {Promise<any[]>} */
  const runEvents = async (runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events;
  /** A turn's record, once its run's account is on it. @param {string} runId */
  const recordOf = (runId) =>
    until(async () => {
      const rec = await shim.record(runId);
      return rec?.acp?.run ? rec : null;
    }, `${runId}'s record`);
  /** The words of a turn's final. @param {any} t */
  const said = (t) => (t.final?.content || []).filter((/** @type {any} */ b) => b.type === "text").map((/** @type {any} */ b) => b.text).join("");
  /** The text of a turn's message. @param {any} t */
  const asked = (t) => (t.user?.content || []).map((/** @type {any} */ b) => b.text || "").join("");
  /** The prompts the agent was sent. @returns {any[]} */
  const prompts = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  /** The ACP bridge. @returns {any} */
  function bridge() {
    return /** @type {any} */ (shim.app).acp;
  }
  /** The bridge's conversation a harness chat holds. @param {string} id @returns {any} */
  const convOf = (id) => [...bridge().convs.values()].find((/** @type {any} */ c) => c.chain === id);
  /** Lets what the agent says after its turn come (the fake's FAKE_ACP_WAKE_GATE). @param {string} agentSession */
  const open = (agentSession) => writeFileSync(join(gates, agentSession), "");
  /** Until the agent gave the session `title`: all it said before has been heard. @param {string} id @param {string} title */
  const titled = (id, title) => until(() => convOf(id)?.title === title || null, `the title "${title}"`);
  /** Filament's door for a turn of the agent's own, called as Filament calls it. @param {string} id @param {any} body */
  const door = (id, body) =>
    fetch(`${shim.url}/api/sessions/${encodeURIComponent(id)}/own-turns`, { method: "POST", headers: { "content-type": "application/json", ...houseAuth() }, body: JSON.stringify(body) });

  test("Claude's own cycle is a turn of its own: its run, its thought and words, the task it answers, its usage", async () => {
    const id = await session();
    await turn(id, "~wake please");
    const tr = await settled(id, 2);
    const own = tr.turns[1];
    assert.deepEqual(own.own, { agent: "Claude Code", tasks: [{ id: "t1", status: "completed", summary: "The tests pass." }] });
    assert.equal(asked(own), "A background task ended (completed): The tests pass.");
    assert.equal(said(own), "The tests pass.");
    assert.equal(tr.turns.length, 2, "one turn for the one cycle");
    // (fails before: no — a guard the mutation pass asked for: a second ask for the same cycle would have met a busy
    // session, and waited)
    assert.equal(asksOf(id).length, 1, "one turn asked for");
    assert.equal(own.run, true);
    const runId = own.requestIds.at(-1);
    const { run } = await (await shim.api(`/api/runs/${encodeURIComponent(runId)}`)).json();
    // (fails before: yes — "queue": a message waited for the turn's end, HarnessV3-FailurePoints §7.2)
    assert.deepEqual([run.kind, run.meta.own, run.meta.chain, run.meta.steer], ["coding-agent", { agent: "Claude Code" }, id, "queued"]);
    const evs = await runEvents(runId);
    assert.ok(evs.some((e) => e.type === "thinking" && /Reading report 1\./.test(e.text || "")) || JSON.stringify(evs).includes("Reading report 1."), "the thought is the run's");
    assert.ok(JSON.stringify(evs).includes("The tests pass."));
    const rec = await recordOf(runId);
    assert.deepEqual([rec.upstream, rec.acp.own, rec.acp.run.status], ["claude", true, "done"]);
    assert.deepEqual([rec.tokens.input, rec.tokens.output, rec.contextUsed, rec.contextSize], [901, 41, 4001, 200000], "the cycle's own usage and the context it left");
    // (fails before: yes — an own turn named no models: `listen` set its usage alone, and the record's `acp.modelUsage`
    // was empty)
    assert.deepEqual(rec.acp.modelUsage, [{ model: "claude-haiku-5", input: 901, output: 41, cacheRead: 3000, cacheWrite: 0 }], "the model the cycle ran on, as a turn of the person's names it");
    // The learner reads it as the agent's, never as the person's words.
    const text = (await (await shim.api(`/api/memory/sessions/${encodeURIComponent(id)}?view=chat`)).json()).rendered.text;
    assert.match(text, /No user message — the assistant went on by itself: A background task ended \(completed\): The tests pass\./);
    assert.equal((await transcript(id)).title ?? null, null, "no title from Filament's words");
  });

  // (fails before: yes — the rewind stood after the agent's own turn: its check read a start no turn row carries, so the
  // transcript kept offering the rewind, and Undo took it back after a turn that came after it)
  test("a turn of the agent's own after a rewind ends its Undo; the person's next message still says what the rewind did", async () => {
    const id = await session();
    asks.hold = id;
    await turn(id, "~wake please");
    const cycle = await until(() => asks.held.find((a) => a.chain === id) || null, "the cycle's ask");
    asks.held.splice(asks.held.indexOf(cycle), 1);
    asks.hold = "";
    const back = await shim.api(`/api/sessions/${encodeURIComponent(id)}/rewind`, { method: "POST", body: { turn: 1, what: "conversation" } });
    assert.equal(back.status, 200, await back.clone().text());
    assert.equal((await transcript(id)).rewind?.turn, 1, "the rewind stands");
    asks.real(cycle);
    const tr = await settled(id, 2);
    assert.ok(tr.turns[1].own, "the agent's own turn, after the rewind");
    assert.equal(tr.rewind, undefined, "the transcript offers the rewind no more");
    const undo = await shim.api(`/api/sessions/${encodeURIComponent(id)}/rewind/undo`, { method: "POST", body: {} });
    assert.equal(undo.status, 409, "nor does Undo take it back");
    assert.match((await undo.json()).error, /^no rewind to undo here: Undo lasts until the next message/, "refused for having no rewind to undo, not for a turn running");
    await turn(id, "and now");
    assert.match(JSON.stringify(prompts().at(-1)), /rewound the conversation to before their message of turn 1/, "the next message says what the rewind did");
  });

  // (fails before: no — a guard the mutation pass asked for: no turn of the agent's own ran with memory's autopilot on)
  test("with memory's autopilot on, a turn of the agent's own is archived only: nothing recalled into it, so its record names no memory it never showed", async () => {
    const st = await (await shim.api("/api/state")).json();
    /** @param {any} autopilot */
    const put = (autopilot) => shim.api("/api/config", { method: "PUT", body: { ...st.config, memory: { ...st.config.memory, autopilot } } });
    const kept = await shim.api("/api/memory/remember", { method: "POST", body: { text: "A background task ended when the tests pass." } });
    assert.equal(kept.status, 200, await kept.clone().text());
    assert.equal((await put({ ...st.config.memory.autopilot, enabled: true })).status, 200);
    try {
      const id = await session();
      await turn(id, "~wake please");
      const tr = await settled(id, 2);
      const rec = await recordOf(tr.turns[1].requestIds.at(-1));
      assert.deepEqual([rec.acp.own, rec.memory.injected, rec.memory.ids, rec.memory.tools], [true, 0, [], false]);
    } finally {
      assert.equal((await put(st.config.memory.autopilot)).status, 200);
    }
  });

  test("two tasks one cycle reads, one turn; a cycle on the first one's heels is a turn of its own", async () => {
    const two = await session();
    await turn(two, "~wake-two please");
    const t2 = await settled(two, 2);
    assert.equal(t2.turns.length, 2);
    assert.equal(asked(t2.turns[1]), "2 background tasks ended:\n- (completed) The tests pass.\n- (completed) The linter is clean.");
    assert.equal(t2.turns[1].own.tasks.length, 2);
    const twice = await session();
    await turn(twice, "~wake-twice please");
    const tt = await settled(twice, 3);
    assert.deepEqual(tt.turns.map((/** @type {any} */ t) => [t.own?.tasks?.map((/** @type {any} */ x) => x.id) ?? null, said(t)]), [
      [null, "I will say when they end."],
      [["t1"], "The tests pass."],
      [["t2"], "The build is done too."],
    ]);
  });

  // (fails before: yes — the hunt of 11-02 on the full suite's lost turn: an own turn read on past its cycle's result,
  // so the next cycle, come in one read with that cycle's close, was the first own turn's — its words there, its spend
  // booked nowhere — and no turn was asked for it: "timed out after 30000 ms waiting for 3 finished turns")
  test("a cycle that comes in one read with the close of the cycle an own turn shows is a turn of its own, spending its own", async () => {
    const id = await session();
    await turn(id, "~wake-heels please");
    const sid = convOf(id).sessionId;
    // The own turn reads the session live once it has taken what it held, the cycle's thought: the rest comes to it.
    await until(() => bridge().turns.get(sid)?.done === false || null, "the first own turn reading");
    open(sid);
    const tr = await settled(id, 3);
    assert.deepEqual(tr.turns.map((/** @type {any} */ t) => [t.own?.tasks?.map((/** @type {any} */ x) => x.id) ?? null, said(t)]), [
      [null, "I will say when they end."],
      [["t1"], "The tests pass."],
      [["t2"], "The build is done too."],
    ]);
    assert.deepEqual(asksOf(id).map((a) => a.tasks.map((/** @type {any} */ t) => t.id)), [["t1"], ["t2"]]);
    const spent = await Promise.all(tr.turns.slice(1).map(async (/** @type {any} */ t) => (await recordOf(t.requestIds.at(-1))).tokens));
    assert.deepEqual(spent.map((s) => [s.input, s.output]), [[901, 41], [902, 42]], "each cycle's spend on its own turn");
  });

  // (fails before: yes — the review of 11-02 on 67db5cbf8: the question of a cycle held past an own turn went to the
  // turn that still read the session, not yet ended, so it was asked and answered there while the next own turn drew
  // its card: "timed out after 10000 ms waiting for the card")
  test("what a cycle on the heels of an own turn asks, come in one read with that turn's close, is asked on its own turn", async () => {
    const id = await session("ask");
    await turn(id, "~wake-heelsperm please");
    const sid = convOf(id).sessionId;
    await until(() => bridge().turns.get(sid)?.done === false || null, "the first own turn reading");
    open(sid);
    const live = await until(async () => {
      const t = await transcript(id);
      return t.live?.own && t.turns.length >= 3 ? t.live : null;
    }, "the second own turn running");
    const card = await until(async () => (await runEvents(live.requestId)).find((e) => e.type === "ask") || null, "the card");
    assert.equal(card.form.judged.command, "npm test");
    const r = await shim.api(`/api/runs/${encodeURIComponent(live.requestId)}/answer`, { method: "POST", body: { ask: card.id, outcome: "answered", answers: { permission: { chosen: ["allow"] } } } });
    assert.equal(r.status, 200, await r.clone().text());
    const tr = await settled(id, 3);
    assert.deepEqual(tr.turns.slice(1).map((/** @type {any} */ t) => [t.own.tasks.map((/** @type {any} */ x) => x.id), said(t)]), [
      [["t1"], "The tests pass."],
      [["t2"], "The build is done too. Told: allow-once."],
    ]);
    assert.ok(!(await runEvents(tr.turns[1].requestIds.at(-1))).some((e) => e.type === "ask"), "nothing asked on the first own turn");
  });

  // (fails before: yes — the developer's Hunter on 547594c77: the engine stage asked only that the request be the
  // sessions API's, and the agent's own cycle is one, sent by Filament itself, so in a chat a team leads the team took
  // the agent's own cycle as a turn to lead)
  test("in a chat a team leads, the agent's own cycle is the agent's: the engine leaves it as it is", async () => {
    const id = await session();
    const set = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { engine: { mode: "team", team: "builders" } } } });
    assert.equal(set.status, 200, await set.clone().text());
    const first = await recordOf(await turn(id, "~wake please"));
    assert.ok((first.changes || []).some((/** @type {string} */ c) => c.startsWith("engine: team Builders answers")), (first.changes || []).join("\n"));
    const tr = await settled(id, 2);
    const own = await recordOf(String(tr.turns[1].requestIds.at(-1)));
    assert.equal(own.acp.own, true);
    assert.ok(!(own.changes || []).some((/** @type {string} */ c) => c.startsWith("engine:")), (own.changes || []).join("\n"));
    assert.equal(said(tr.turns[1]), "The tests pass.");
  });

  test("the person's next turn is its own words alone: the agent saw its own turn", async () => {
    const id = await session();
    await turn(id, "~wake please");
    await settled(id, 2);
    const runId = await turn(id, "and now the docs");
    assert.equal(prompts().at(-1).text, "and now the docs");
    const rec = await recordOf(runId);
    assert.ok(!(rec.changes || []).some((/** @type {string} */ c) => /catches up/.test(c)), (rec.changes || []).join(" | "));
  });

  test("while it runs a message waits for it, as the holder says; the Stop ends it, and the chat goes on", async () => {
    const id = await session();
    await turn(id, "~wake-stuck please");
    const live = await running(id);
    assert.deepEqual([live.window, live.label, live.own], ["harness", "Claude Code", { agent: "Claude Code" }]);
    const busy = await send(id, "are you there?");
    assert.equal(busy.status, 409);
    const body = await busy.json();
    assert.equal(body.error, "Claude Code is running a turn of its own in this session — it can be stopped from the harness, or waited out");
    assert.deepEqual([body.holder.own, body.holder.label], [{ agent: "Claude Code" }, "Claude Code"]);
    const stop = await shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST", body: {} });
    assert.equal(stop.status, 200);
    const tr = await settled(id, 2);
    const rec = await recordOf(tr.turns[1].requestIds.at(-1));
    assert.equal(rec.acp.run.status, "stopped");
    await turn(id, "hello again");
    assert.equal(said((await settled(id, 3)).turns[2]).length > 0, true);
  });

  // (fails before: yes — the owner's list of 11-08: an agent woken by its own background work called Filament's agent
  // and wait, and was told no turn of the person's held the session)
  test("a turn of the agent's own holds Filament's door: its wait and its launches go through it, as in a turn of the person's", async () => {
    const id = await session();
    await turn(id, "~wake-stuck please");
    await running(id);
    const at = await bridge().contextForMcpToken(convOf(id).mcpToken).settled();
    assert.equal(at.launch, true, "the chat's session was given Filament's agent and wait");
    const ctx = { cwd: projDir, upstream: "claude", chain: at.chain, turn: at.turnId, graph: at.graph, launch: true, emit: at.emit };
    const r = await bridge().agentTools.call("wait", { seconds: 1 }, ctx);
    assert.doesNotMatch(String(r.text), /holds no turn/, r.text);
    assert.notEqual(r.isError, true, r.text);
    const stop = await shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST", body: {} });
    assert.equal(stop.status, 200);
    await settled(id, 2);
    // Its end shuts the door: a call after it is told so, as after a turn of the person's.
    const after = await bridge().agentTools.call("wait", { seconds: 1 }, ctx);
    assert.match(String(after.text), /holds no turn/);
  });

  // (fails before: yes — the wait named the task with the loop's words, "give it to a sub-agent with tasks change (by)",
  // which a coding agent's tasks tool refuses)
  test("its wait with nothing running names its own task at work, and what its own tools do with it", async () => {
    const id = await session();
    await turn(id, "~wake-stuck please");
    await running(id);
    const at = await bridge().contextForMcpToken(convOf(id).mcpToken).settled();
    assert.equal(at.graph, true, "the chat's session was given the task graph");
    const ctx = { cwd: projDir, upstream: "claude", chain: at.chain, turn: at.turnId, graph: at.graph, launch: true, emit: at.emit };
    const added = await bridge().agentTools.call("tasks", { action: "add", goal: "The docs", tasks: [{ id: "t1", name: "Write the docs" }] }, ctx);
    assert.notEqual(added.isError, true, added.text);
    const started = await bridge().agentTools.call("tasks", { action: "start", id: "t1" }, ctx);
    assert.notEqual(started.isError, true, started.text);
    const r = await bridge().agentTools.call("wait", { seconds: 1 }, ctx);
    assert.match(String(r.text), /^Nothing to wait for: .* Your task graph's t1 "Write the docs" runs as your own work: no sub-agent does it\. Do it now — or launch a sub-agent on it with Filament's agent tool, the task in task\. /, r.text);
    const stop = await shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST", body: {} });
    assert.equal(stop.status, 200);
    await settled(id, 2);
  });

  // (fails before: yes — with `&& !ownCycle` back at acp-turn.js's door a turn of the agent's own opened none, and its
  // launch was refused: "Filament holds no turn of the developer's"; the test beside it called wait alone)
  test("a turn of the agent's own launches through Filament's agent tool, as a turn of the person's does", async () => {
    const id = await session();
    await turn(id, "~wake-stuck please");
    await running(id);
    const at = await bridge().contextForMcpToken(convOf(id).mcpToken).settled();
    assert.equal(at.launch, true, "the chat's session was given Filament's agent and wait");
    const ctx = { cwd: projDir, upstream: "claude", chain: at.chain, turn: at.turnId, graph: at.graph, launch: true, emit: at.emit };
    const r = await bridge().agentTools.call("agent", { description: "Look", prompt: "List the files", subagent_type: "reviewer", run_in_background: true }, ctx);
    assert.notEqual(r.isError, true, r.text);
    assert.match(String(r.text), /^Launched sub-agent sa_[0-9a-f]{8} \("Look"\) in the background\./, r.text);
    const stop = await shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST", body: {} });
    assert.equal(stop.status, 200);
    await settled(id, 2);
  });

  test("in a chat a team leads, a turn of its lead's own holds its team's door: its wait and its worker go to its team, as in a turn of the person's", async () => {
    const id = await session();
    const set = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { engine: { mode: "team", team: "builders" } } } });
    assert.equal(set.status, 200, await set.clone().text());
    await turn(id, "~wake-stuck please");
    await running(id);
    const at = await bridge().contextForMcpToken(convOf(id).mcpToken).settled();
    assert.equal(at.team, true, "the chat's session was given its team's tools");
    const ctx = { cwd: projDir, upstream: "claude", chain: at.chain, turn: at.turnId, graph: at.graph, team: true, emit: at.emit };
    const waited = await bridge().agentTools.call("wait", { seconds: 1 }, ctx);
    assert.notEqual(waited.isError, true, waited.text);
    assert.match(String(waited.text), /^Nothing to wait for: no worker you launched is running, and none of your background commands runs\./, waited.text);
    const worker = await bridge().agentTools.call("worker", { task: "nothing" }, ctx);
    assert.doesNotMatch(String(worker.text), /has no worker tool|turn as the team's lead has ended/, worker.text);
    const stop = await shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST", body: {} });
    assert.equal(stop.status, 200);
    await settled(id, 2);
  });

  // (fails before: yes — the message waited in Filament for the cycle's end, which Claude's adapter would have added to
  // it: HarnessV3-FailurePoints §7.2)
  test("a message sent while Claude's own turn runs is queued at Claude, which adds it to the running cycle: read where Claude took it, answered in that turn", async () => {
    const id = await session();
    await turn(id, "~wake-fold please");
    await running(id);
    const tr = await transcript(id);
    const runId = String(tr.turns[1]?.requestIds?.at(-1) || "");
    await until(async () => (await runEvents(runId)).some((e) => e.type === "tool-start"), "the cycle to read its file");
    const r = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "note", text: "and check the docs", from: "harness" } });
    assert.equal(r.status, 200, await r.clone().text());
    const noteId = String((await r.json()).message.id);
    await tick();
    const own = (await settled(id, 2)).turns[1];
    assert.equal(said(own), "heard:and check the docs");
    const evs = await runEvents(runId);
    assert.deepEqual(evs.filter((e) => e.type.startsWith("steer")).map((e) => [e.type, e.ids || [e.id]]), [["steer", [noteId]], ["steer-sent", [noteId]], ["steer-read", [noteId]]]);
    const rec = await recordOf(runId);
    assert.equal(rec.acp.run.status, "done");
    assert.ok(rec.changes.includes("acp: a message sent while Claude Code worked was queued and went in at its next step"), rec.changes.join("\n"));
    assert.deepEqual([rec.tokens.input, rec.tokens.output], [700, 30], "the cycle's usage once: the message shares its result");
    assert.equal((await settled(id, 2)).turns.length, 2, "no turn of its own for the message");
  });

  // (fails before: yes — the review of 11-02 on 67db5cbf8: an own turn read on while a message it queued waited for its
  // answer, which settles only once the read that brought it is over, so a cycle in that read after the result of the
  // cycle that took the message was the first own turn's, and no turn was asked for it: "timed out after 30000 ms
  // waiting for 3 finished turns")
  test("a message Claude took into its own cycle keeps the turn reading that cycle alone: a cycle in the same read as the message's answer is a turn of its own", async () => {
    const id = await session();
    await turn(id, "~wake-foldtwice please");
    await running(id);
    const runId = String((await transcript(id)).turns[1]?.requestIds?.at(-1) || "");
    await until(async () => (await runEvents(runId)).some((e) => e.type === "tool-start"), "the cycle to read its file");
    const r = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "note", text: "and check the docs", from: "harness" } });
    assert.equal(r.status, 200, await r.clone().text());
    await tick();
    const tr = await settled(id, 3);
    assert.deepEqual(tr.turns.map((/** @type {any} */ t) => [t.own?.tasks?.map((/** @type {any} */ x) => x.id) ?? null, said(t)]), [
      [null, "I will say when they end."],
      [["t1"], "heard:and check the docs"],
      [["t2"], "The build is done too."],
    ]);
    const spent = await Promise.all(tr.turns.slice(1).map(async (/** @type {any} */ t) => (await recordOf(t.requestIds.at(-1))).tokens));
    assert.deepEqual(spent.map((s) => [s.input, s.output]), [[700, 30], [902, 42]], "each cycle's spend on its own turn");
  });

  // (fails before: yes — the review of 11-02 on 67db5cbf8: words queued once the session held the next cycle's start
  // made the own turn read on, so the rest of that cycle was read into it, its start left held, and the turn asked for
  // that start alone ended without its result)
  test("words sent to an own turn once the session holds the next cycle are handed back: that cycle stays held whole, for a turn of its own", async () => {
    const id = await session();
    await turn(id, "~wake-foldlate please");
    await running(id);
    const sid = convOf(id).sessionId;
    const runId = String((await transcript(id)).turns[1]?.requestIds?.at(-1) || "");
    await until(async () => (await runEvents(runId)).some((e) => e.type === "tool-start"), "the cycle to read its file");
    /** @param {string} text @param {string} from */
    const steer = async (text, from) => {
      const r = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "note", text, from } });
      assert.equal(r.status, 200, await r.clone().text());
      return String((await r.json()).message.id);
    };
    /** @param {string} type @param {string} note */
    const seen = async (type, note) => (await runEvents(runId)).some((e) => e.type === type && (e.ids || [e.id]).includes(note)) || null;
    const folded = await steer("and check the docs", "harness");
    await tick();
    // Claude took them into its cycle, which ended in the read that began the next: the turn waits for their answer.
    await until(() => seen("steer-read", folded), "the words read where Claude took them");
    // Words Filament sends, never the developer's to take back, go without waiting for the agent's next call (C34).
    const late = await steer("then list the tests", "filament");
    await until(() => seen("steer-sent", late), "the later words handed over");
    open(sid);
    const tr = await settled(id, 3);
    assert.deepEqual(tr.turns.map((/** @type {any} */ t) => [t.own?.tasks?.map((/** @type {any} */ x) => x.id) ?? null, said(t)]), [
      [null, "I will say when they end."],
      [["t1"], "heard:and check the docs"],
      [["t2"], "The build is done too."],
    ]);
    assert.equal(await seen("steer-read", late), null, "the later words never went in");
    const queuedAt = readFileSync(calls, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((c) => c.method === "queued prompt" && c.sessionId === sid);
    assert.deepEqual(queuedAt.map((c) => c.words), ["and check the docs"], "the agent was never sent the later words");
    const rec = await recordOf(runId);
    assert.ok(rec.changes.includes("acp: Claude Code never took a message queued while it worked — its turn ended or stopped first, or it refused the message; it goes as the next message"), rec.changes.join("\n"));
  });

  // (fails before: no — a guard the mutation pass asked for: no message sent during Claude's own turn ran as its next
  // prompt, so the turn's wait for it, its end and its spend went unseen)
  test("a message Claude runs as its next prompt, its own cycle having ended first, is in the same turn: the turn waits for it, ends as it did, and spends both", async () => {
    const id = await session();
    await turn(id, "~wake-next please");
    await running(id);
    const tr = await transcript(id);
    const runId = String(tr.turns[1]?.requestIds?.at(-1) || "");
    await until(async () => (await runEvents(runId)).some((e) => e.type === "tool-start"), "the cycle to read its file");
    const r = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "note", text: "then list the tests", from: "harness" } });
    assert.equal(r.status, 200, await r.clone().text());
    await tick();
    const own = (await settled(id, 2)).turns[1];
    assert.equal(said(own), "next:then list the tests", "the turn's answer is its last prompt's");
    const rec = await recordOf(runId);
    assert.ok(rec.changes.includes("acp: a message sent while Claude Code worked was queued and ran as its next prompt: its turn had ended first"), rec.changes.join("\n"));
    assert.ok(rec.changes.some((/** @type {string} */ c) => c.startsWith("acp: stop reason max_tokens")), rec.changes.join("\n"));
    assert.deepEqual([rec.tokens.input, rec.tokens.output], [750, 35], "the cycle's and the next prompt's: each its own");
    assert.equal((await settled(id, 2)).turns.length, 2, "no turn of its own for the message");
  });

  test("what Claude asks between turns waits for its own turn, and the session's switch judges it", async () => {
    const auto = await session("auto");
    await turn(auto, "~wake-perm please");
    const ta = await settled(auto, 2);
    assert.equal(said(ta.turns[1]), "The tests pass. Told: allow-once.");
    const rec = await recordOf(ta.turns[1].requestIds.at(-1));
    assert.ok((rec.changes || []).includes("permission: Claude Code asked to run `npm test` — ran (auto mode)"), (rec.changes || []).join(" | "));
    const ask = await session("ask");
    await turn(ask, "~wake-perm please");
    const live = await running(ask);
    const card = await until(async () => (await runEvents(live.requestId)).find((e) => e.type === "ask") || null, "the card");
    assert.equal(card.form.judged.command, "npm test");
    const r = await shim.api(`/api/runs/${encodeURIComponent(live.requestId)}/answer`, { method: "POST", body: { ask: card.id, outcome: "answered", answers: { permission: { chosen: ["allow"] } } } });
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal(said((await settled(ask, 2)).turns[1]), "The tests pass. Told: allow-once.");
  });

  // (fails before: yes — with no cycle of Claude's running, the sub-agent's question drew no turn and was refused as no
  // turn's: a helper launched in the background could run no command once the turn that launched it ended)
  test("what a background sub-agent asks after the turn, no cycle of Claude's running, draws its own turn, whose switch judges it; the turn waits for the person's answer", async () => {
    const auto = await session("auto");
    await turn(auto, "~wake-subperm please");
    await titled(auto, "The sub-agent was told: allow-once");
    const ta = await settled(auto, 2);
    const rec = await recordOf(ta.turns[1].requestIds.at(-1));
    assert.ok((rec.changes || []).some((/** @type {string} */ c) => /^permission: Claude Code asked to run `npm test` — ran \(auto mode\)/.test(c)), (rec.changes || []).join(" | "));
    assert.ok(!(rec.changes || []).some((/** @type {string} */ c) => /went idle before its cycle's result/.test(c)), "no cycle ran for it to end without");
    const ask = await session("ask");
    await turn(ask, "~wake-subperm please");
    const live = await running(ask);
    const card = await until(async () => (await runEvents(live.requestId)).find((e) => e.type === "ask") || null, "the card");
    assert.equal(card.form.judged.command, "npm test");
    // Longer than Claude may stay idle before a turn stops waiting for it: the question it put keeps the turn open.
    await new Promise((r) => setTimeout(r, 3500));
    assert.equal((await transcript(ask)).live?.requestId, live.requestId, "the turn still runs while its question waits");
    const r = await shim.api(`/api/runs/${encodeURIComponent(live.requestId)}/answer`, { method: "POST", body: { ask: card.id, outcome: "answered", answers: { permission: { chosen: ["allow"] } } } });
    assert.equal(r.status, 200, await r.clone().text());
    await titled(ask, "The sub-agent was told: allow-once");
    await settled(ask, 2);
  });

  test("a background sub-agent's work draws no turn: the person's next turn shows it", async () => {
    const id = await session();
    await turn(id, "~wake-sub please");
    await new Promise((r) => setTimeout(r, 1200));
    const tr = await transcript(id);
    assert.deepEqual([tr.turns.length, tr.live], [1, null]);
    const runId = await turn(id, "how is it going?");
    assert.ok(JSON.stringify(await runEvents(runId)).includes("k_g1"), "the sub-agent's call comes with the next turn");
  });

  test("a session no harness chat holds draws no turn", async () => {
    const before = (await shim.records(200)).length;
    const res = await shim.post("/v1/messages", { model: "claude/haiku", max_tokens: 100, stream: false, messages: [{ role: "user", content: "~wake please" }] }, { "x-session-id": "outside-1" });
    assert.equal(res.status, 200, await res.clone().text());
    await res.json();
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal((await shim.records(200)).length, before + 1, "the client's turn alone");
    // (fails before: no — a guard the mutation pass asked for: a turn asked for with no chat to show it was refused,
    // and left no record)
    assert.deepEqual(asks.all.filter((a) => !a.chain), [], "no turn asked for");
  });

  // (fails before: no — a guard the mutation pass asked for: no agent asked anything between turns on a session no
  // harness chat holds)
  test("what the agent asks between turns on a session no harness chat holds is answered by the upstream's policy", async () => {
    const acp = bridge();
    const since = Date.now();
    const res = await shim.post("/v1/messages", { model: "claude/haiku", max_tokens: 100, stream: false, messages: [{ role: "user", content: "~wake-perm please" }] }, { "x-session-id": "outside-perm" });
    assert.equal(res.status, 200, await res.clone().text());
    await res.json();
    const answer = await until(() => acp.permissionLog.find((/** @type {any} */ p) => p.at >= since && p.title === "npm test") || null, "the question answered between turns", { timeoutMs: 5000 });
    assert.deepEqual([answer.policy, answer.decision], ["allow-all", "allow-once"]);
  });

  // (fails before: no — a guard the mutation pass asked for: no housekeeping task ended, and no task ended while a
  // cycle's model call ran)
  test("a cycle reads no housekeeping task, and reads a task that ended while its model call was tried again", async () => {
    const id = await session();
    await turn(id, "~wake-mix please");
    const own = (await settled(id, 2)).turns[1];
    assert.deepEqual(own.own.tasks.map((/** @type {any} */ t) => t.id), ["t1", "t2"]);
    assert.equal(said(own), "Both came back: the tests pass and the linter is clean.");
  });

  // (fails before: no — a guard the mutation pass asked for: Claude said nothing between turns but in a cycle of its
  // own)
  test("what Claude says after its turn's result, in no cycle, draws no turn: the person's next turn shows it", async () => {
    const id = await session();
    await turn(id, "~trail please");
    open(convOf(id).sessionId);
    await titled(id, "Trail said");
    assert.deepEqual(asksOf(id), []);
    const runId = await turn(id, "and then?");
    assert.ok(JSON.stringify(await runEvents(runId)).includes("One more thing."), "the next turn shows it");
  });

  // (fails before: yes — the owner's of 11-05: what the session said after the turn, held for the next, read as a turn
  // of the agent's own on its way: a chat whose command outlived its turn stood under Working an hour after the person
  // stopped that command)
  test("what Claude says after its turn that asks for no turn is no turn coming: the person's Stop of the command that kept the chat at work ends its stretch", async () => {
    const id = await session();
    const stretchOf = async () => ((await (await shim.api("/api/sessions/holders")).json()).stretches || []).find((/** @type {any} */ x) => x.chainId === id) || null;
    // A command of the chat's runs as its turn ends: its stretch outlives the turn.
    const cmd = startCommandShell(`"${process.execPath}" -e "setTimeout(()=>{},60000)"`, projDir, { session: id, agent: null }, { onEnd: () => {} });
    await turn(id, "~trail please");
    assert.equal((await stretchOf())?.waits?.commands, 1, "the command keeps it past its turn");
    open(convOf(id).sessionId);
    await titled(id, "Trail said");
    assert.deepEqual(asksOf(id), [], "what it said asks for no turn of its own");
    assert.equal(bridge().ownComing(id), false, "held for the person's next turn, it is no turn on its way");
    const stop = await shim.api(`/api/sessions/${encodeURIComponent(id)}/commands/${encodeURIComponent(cmd.id)}/stop`, { method: "POST", body: {} });
    assert.equal(stop.status, 200, await stop.clone().text());
    await until(async () => !(await stretchOf()) || null, "the stretch over at the Stop", { timeoutMs: 5000 });
  });

  // (fails before: yes — the hunt of 11-05 over the Working fix: only a result ended a cycle, and Claude's adapter calls
  // its session gone idle the turn's end, a result or none (its issue #825, a model stream dropped mid-turn): the cycle
  // stood running for good, read as a turn of the agent's own on its way, and kept the chat under Working)
  test("a cycle Claude ends idle with no result is over: no turn of its own is on its way, and the chat's stretch ends with the turn", async () => {
    const id = await session();
    const stretchOf = async () => ((await (await shim.api("/api/sessions/holders")).json()).stretches || []).find((/** @type {any} */ x) => x.chainId === id) || null;
    await turn(id, "~noresult please");
    assert.equal(bridge().ownComing(id), false, "idle: the cycle is over");
    await until(async () => !(await stretchOf()) || null, "the stretch over with its turn", { timeoutMs: 5000 });
  });

  // (fails before: no — a guard the mutation pass asked for: no sub-agent spoke on a session of its own while Claude's
  // cycle ran)
  test("a sub-agent's work on its own session draws no turn of Claude's own, though Claude's cycle runs", async () => {
    const id = await session();
    await turn(id, "~wake-child please");
    await titled(id, "Child done");
    assert.deepEqual(asksOf(id), []);
    assert.equal((await transcript(id)).turns.length, 1);
  });

  // (fails before: no — a guard the mutation pass asked for: every agent here marked its cycles as Claude's adapter
  // does)
  test("an agent that marks no cycles holds nothing between turns: what it says then is logged, and no turn shows it", async () => {
    const id = await session("auto", "plain/haiku");
    await turn(id, "~trail please");
    const sid = convOf(id).sessionId;
    open(sid);
    await titled(id, "Trail said");
    assert.ok(logged.includes(`[acp] ${sid.slice(0, 8)}: the agent worked between turns; no harness chat shows this session's own turns`), logged.join(" | "));
    const runId = await turn(id, "and then?");
    assert.ok(!JSON.stringify(await runEvents(runId)).includes("One more thing."));
  });

  // (fails before: no — a guard the mutation pass asked for: no turn of the agent's own met a busy session here)
  test("an own turn the session was too busy for is asked for again once it is free, naming the same tasks", async () => {
    const id = await session();
    const app = /** @type {any} */ (shim.app);
    const key = app.memory.archive.getChain(id).key;
    asks.hold = id;
    await turn(id, "~wake please");
    await until(() => asks.held.length > 0 || null, "the cycle's ask");
    const lock = await until(async () => {
      const got = await app.sessionTurns.acquire(key, { window: "move", client: "the move to another folder" });
      return got.ok ? got : null;
    }, "the session's lock: the chat's move holds it");
    let waits = false;
    app.sessionTurns.onChange = (/** @type {string} */ k, /** @type {any} */ fn) => {
      if (k === key) waits = true;
      return SessionTurns.prototype.onChange.call(app.sessionTurns, k, fn);
    };
    try {
      asks.forward();
      await until(() => waits || null, "the asker's wait for the session");
    } finally {
      delete app.sessionTurns.onChange;
    }
    app.sessionTurns.release(key, lock.token);
    const own = (await settled(id, 2)).turns[1];
    assert.deepEqual(asksOf(id).map((a) => a.tasks.map((/** @type {any} */ t) => t.id)), [["t1"], ["t1"]]);
    assert.deepEqual(own.own.tasks.map((/** @type {any} */ t) => t.id), ["t1"]);
  });

  // (fails before: no — a guard the mutation pass asked for: every app here wired the asker)
  test("with no asker, what Claude asks between turns is answered at once as no turn's: refused, and the chat's next turn shows the call refused, saying why", async () => {
    const id = await session();
    const acp = bridge();
    const keep = acp.onOwnCycle;
    const since = Date.now();
    acp.onOwnCycle = null;
    /** @type {any} */ let answer = null;
    let runId = "";
    try {
      await turn(id, "~wake-perm please");
      answer = await until(() => acp.permissionLog.find((/** @type {any} */ p) => p.at >= since && p.title === "npm test") || null, "the question answered between turns", { timeoutMs: 5000 });
      runId = await turn(id, "and then?");
    } finally {
      acp.onOwnCycle = keep;
    }
    const rec = await recordOf(runId);
    assert.ok(!(rec.changes || []).some((/** @type {string} */ c) => /^permission: .*npm test/.test(c)), (rec.changes || []).join(" | "));
    // (fails before: yes — the upstream's allow-all answered it: the agent's own command ran between turns, with
    // nothing standing for the person's switch)
    assert.deepEqual([answer.policy, answer.decision], ["refused: no turn of the harness chat runs to judge it", "reject"]);
    const end = (await runEvents(runId)).find((e) => e.type === "tool-end" && e.id === "k_b1");
    assert.deepEqual([end?.ok, end?.refused, end?.reason], [false, true, "Filament, as no turn of the chat ran to judge it"]);
  });

  // (fails before: yes — with no turn to judge them, the upstream's allow-all had Filament write the files and run the
  // command for the agent)
  test("what Claude has Filament do between turns, for itself or its sub-agent, waits for its own turn, whose switch judges it; with no turn to judge it, Filament does nothing", async () => {
    const acp = bridge();
    const keep = acp.onOwnCycle;
    const alone = await session();
    acp.onOwnCycle = null;
    try {
      await turn(alone, "~wake-write please");
      await titled(alone, "Between: refused, refused, refused");
    } finally {
      acp.onOwnCycle = keep;
    }
    const sid = convOf(alone).sessionId;
    assert.deepEqual([existsSync(join(projDir, `between-${sid}.txt`)), existsSync(join(projDir, `between-${sid}-sub.txt`))], [false, false], "nothing written");
    const id = await session();
    await turn(id, "~wake-write please");
    assert.equal(said((await settled(id, 2)).turns[1]), "The tests pass. Writes: done, the sub-agent's done; the command: between.");
    const own = convOf(id).sessionId;
    for (const name of [`between-${own}.txt`, `between-${own}-sub.txt`]) assert.equal(readFileSync(join(projDir, name), "utf8"), "written between turns\n", name);
  });

  // (fails before: yes — Filament's tools took the session's newest turn, ended: nothing stood for the person's switch,
  // and the call showed in no turn)
  test("a call to Filament's tools between turns finds its turn as the session's requests do: the agent's own, once it takes the session", async () => {
    const id = await session();
    asks.hold = id;
    await turn(id, "~wake please");
    await until(() => asks.held.length > 0 || null, "the cycle's ask");
    const token = convOf(id).mcpToken;
    assert.ok(token, "memory's tools gave the session Filament's MCP server");
    const ctx = bridge().contextForMcpToken(token);
    assert.deepEqual([ctx.turn.done, ctx.chat], [true, true], "between turns the session's newest turn has ended");
    let waits = true;
    const found = ctx.settled().then((/** @type {any} */ x) => ((waits = false), x));
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(waits, true, "the call waits while the agent's own turn is asked for");
    asks.forward();
    const at = await found;
    assert.notEqual(at.turn, ctx.turn);
    assert.deepEqual([at.turn === bridge().turns.get(convOf(id).sessionId), at.chat], [true, true], "the agent's own turn, live");
    // What the call says goes to that turn's reader (its `sayer`, read as the call's context was made).
    const reader = at.turn.sink;
    /** @type {any[]} */
    const heard = [];
    at.turn.sink = (/** @type {any} */ ev) => void heard.push(ev);
    at.emit({ type: "note", text: "from the call" });
    at.turn.sink = reader;
    assert.deepEqual(heard, [{ type: "note", text: "from the call" }], "to the agent's own turn");
    await settled(id, 2);
  });

  // (fails before: no — a guard the mutation pass asked for: nothing asked again for a turn while an own turn read the
  // session)
  test("a word to ask again while an own turn reads the session asks nothing: the cycle on its heels waits for its end", async () => {
    const id = await session();
    asks.hold = id;
    await turn(id, "~wake-quiet please");
    await titled(id, "Two cycles");
    const sid = asksOf(id)[0].sessionId;
    asks.forward();
    // The turn the bridge runs on the session is the own turn's from the moment it reads the session.
    await until(() => bridge().turns.get(sid)?.done === false || null, "the first own turn reading");
    bridge().ownAgain(sid);
    assert.equal(asksOf(id).length, 1, "no turn asked for while one reads the session");
    const tr = await settled(id, 3);
    assert.deepEqual(tr.turns.slice(1).map((/** @type {any} */ t) => [t.own.tasks.map((/** @type {any} */ x) => x.id), said(t)]), [
      [["t1"], "The tests pass."],
      [["t2"], "The build is done too."],
    ]);
  });

  // (fails before: yes — the review of 11-02 on 67db5cbf8: the word to ask again, said once while the own turn still
  // read the session, was dropped, and the cycle held on its heels was never asked for: "timed out after 30000 ms
  // waiting for 3 finished turns")
  test("the word to ask again that comes while the own turn still reads the session is heard once it lets go: the cycle on its heels is asked for then", async () => {
    const id = await session();
    asks.hold = id;
    await turn(id, "~wake-quiet please");
    await titled(id, "Two cycles");
    const [held] = asks.held.splice(0);
    asks.hold = "";
    const sid = held.sessionId;
    // The test asks for the own turn through Filament's door, as Filament's asker does, and says its word to ask again
    // early, as a reply cut short brings it: while the own turn still reads the session — and never again.
    const reply = await door(id, { upstream: held.upstreamId, sessionId: sid, model: held.model, tasks: held.tasks });
    assert.equal(reply.status, 200);
    await until(() => bridge().turns.get(sid)?.done === false || null, "the first own turn reading");
    bridge().ownAgain(sid);
    await reply.arrayBuffer();
    const tr = await settled(id, 3);
    assert.deepEqual(tr.turns.slice(1).map((/** @type {any} */ t) => [t.own.tasks.map((/** @type {any} */ x) => x.id), said(t)]), [
      [["t1"], "The tests pass."],
      [["t2"], "The build is done too."],
    ]);
  });

  // (fails before: no — a guard the mutation pass asked for: the agent said nothing between turns that asked for no
  // turn)
  test("asked again, what the session said since its own turn asks for a turn only if it is work", async () => {
    const id = await session();
    await turn(id, "~wake-late please");
    await settled(id, 2);
    const sid = asksOf(id)[0].sessionId;
    open(sid);
    await titled(id, "Late word");
    bridge().ownAgain(sid);
    assert.equal(asksOf(id).length, 1, "a title is no work");
  });

  // (fails before: no — a guard the mutation pass asked for: no own turn was refused while the agent asked something)
  test("an own turn not shown lets go of what the session held: what Claude asked meanwhile is refused, as no turn's", async () => {
    const id = await session();
    asks.hold = id;
    await turn(id, "~wake-perm please");
    await titled(id, "Asked to run npm test");
    const [held] = asks.held.splice(0);
    asks.hold = "";
    bridge().declineOwn(held.sessionId, "the test turned it down");
    // (fails before: yes — the upstream's allow-all answered it once no turn would: the agent was told allow-once)
    assert.equal(said((await settled(id, 2)).turns[1]), "The tests pass. Told: reject.");
  });

  // (fails before: no — a guard the mutation pass asked for: no own turn was stopped before it opened)
  test("an own turn stopped before it opened lets go of what the session held: no later turn shows it", async () => {
    const id = await session();
    asks.hold = id;
    await turn(id, "~wake-late please");
    const [held] = /** @type {any[]} */ (await until(() => (asks.held.length ? asks.held.splice(0) : null), "the cycle's ask"));
    asks.hold = "";
    open(held.sessionId);
    await titled(id, "Late word");
    const upstream = /** @type {any} */ (shim.app).config.upstreams.find((/** @type {any} */ u) => u.id === "claude");
    const out = await bridge().listen({ upstream, sessionId: held.sessionId, signal: AbortSignal.abort() });
    assert.equal(out.stopReason, "cancelled");
    const runId = await turn(id, "and then?");
    assert.ok(!JSON.stringify(await runEvents(runId)).includes("The tests pass."), "what it held went with the stop");
  });

  // (fails before: no — a guard the mutation pass asked for: only Filament called the door here, and on a free session)
  test("Filament's door for an own turn: Filament's call alone, and never beside a turn that runs", async () => {
    const id = await session();
    const body = { upstream: "claude", sessionId: "sess_none", model: "claude/haiku", tasks: [] };
    const outside = await shim.api(`/api/sessions/${encodeURIComponent(id)}/own-turns`, { method: "POST", body });
    assert.deepEqual([outside.status, (await outside.json()).error], [403, "a coding agent's own turn is asked for by Filament alone"]);
    const app = /** @type {any} */ (shim.app);
    const key = app.memory.archive.getChain(id).key;
    const lock = await app.sessionTurns.acquire(key, { window: "harness" });
    try {
      const r = await door(id, body);
      assert.deepEqual([r.status, await r.json()], [409, { error: "a turn runs in this session", busy: true }]);
    } finally {
      app.sessionTurns.release(key, lock.token);
    }
  });

  // (fails before: no — a guard the mutation pass asked for: every own turn's route here named its agent first)
  test("an own turn goes to the agent whose cycle it shows, though its route now names another first", async () => {
    const id = await session("auto", "duo/haiku");
    asks.hold = id;
    await turn(id, "~wake please");
    await until(() => asks.held.length > 0 || null, "the cycle's ask");
    const cfg = (await (await shim.api("/api/state")).json()).config;
    const put = async (/** @type {any[]} */ routes) => assert.equal((await shim.api("/api/config", { method: "PUT", body: { ...cfg, routes } })).status, 200);
    await put(cfg.routes.map((/** @type {any} */ rt) => (rt.match === "duo/*" ? { ...rt, upstream: "plain", fallbacks: [{ upstream: "claude" }] } : rt)));
    try {
      asks.forward();
      const own = (await settled(id, 2)).turns[1];
      assert.equal(said(own), "The tests pass.");
      assert.equal((await recordOf(own.requestIds.at(-1))).upstream, "claude");
    } finally {
      await put(cfg.routes);
    }
  });

  // (fails before: yes — the developer's Hunter of 11-01 on 7fe49b58d: parse ran a session turn on the loop wherever
  // its route names a plain model first, the agent's own cycle among them, so the cycle went to the loop, which refused
  // it — the agent, the route's fallback, is no model of its own — and never to the agent whose cycle it shows)
  test("an own turn goes to the agent whose cycle it shows, though its route now names a plain model first: never to the loop", async () => {
    const up = await fakeUpstream();
    const id = await session("auto", "duo/haiku");
    asks.hold = id;
    await turn(id, "~wake please");
    await until(() => asks.held.length > 0 || null, "the cycle's ask");
    const cfg = (await (await shim.api("/api/state")).json()).config;
    /** @param {any[]} upstreams @param {any[]} routes */
    const put = async (upstreams, routes) => assert.equal((await shim.api("/api/config", { method: "PUT", body: { ...cfg, upstreams, routes } })).status, 200);
    const llm = { id: "llm", name: "llm", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true };
    await put([...cfg.upstreams, llm], cfg.routes.map((/** @type {any} */ rt) => (rt.match === "duo/*" ? { ...rt, upstream: "llm", fallbacks: [{ upstream: "claude" }] } : rt)));
    try {
      asks.forward();
      const own = (await settled(id, 2)).turns[1];
      assert.equal(said(own), "The tests pass.");
      const rec = await recordOf(own.requestIds.at(-1));
      // (fails before: yes — the review of 11-01: served from the route's backup place, the turn read as a failover)
      assert.deepEqual([rec.upstream, rec.attempt, rec.failover ?? null], ["claude", 1, null], "its agent, no failover");
      assert.deepEqual(up.received.filter((c) => c.kind !== "models").map((c) => c.path), [], "the plain model was asked nothing");
    } finally {
      await put(cfg.upstreams, cfg.routes);
      await up.close();
    }
  });

  // (fails before: yes — the developer's Hunter of 11-01 on 644726d9b: with failover off the route's fallbacks were
  // dropped, the agent among them, so the agent's own cycle had no way to it and was refused 502)
  test("with failover off, an own turn whose route names a plain model first still goes to the agent, its fallback", async () => {
    const up = await fakeUpstream();
    const id = await session("auto", "duo/haiku");
    asks.hold = id;
    await turn(id, "~wake please");
    await until(() => asks.held.length > 0 || null, "the cycle's ask");
    const cfg = (await (await shim.api("/api/state")).json()).config;
    /** @param {any} body */
    const put = async (body) => assert.equal((await shim.api("/api/config", { method: "PUT", body })).status, 200);
    const llm = { id: "llm", name: "llm", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true };
    const routes = cfg.routes.map((/** @type {any} */ rt) => (rt.match === "duo/*" ? { ...rt, upstream: "llm", fallbacks: [{ upstream: "claude" }] } : rt));
    await put({ ...cfg, upstreams: [...cfg.upstreams, llm], routes, rules: { ...cfg.rules, resilience: { ...cfg.rules.resilience, failover: false } } });
    try {
      asks.forward();
      const own = (await settled(id, 2)).turns[1];
      assert.equal(said(own), "The tests pass.");
      const rec = await recordOf(own.requestIds.at(-1));
      assert.deepEqual([rec.upstream, rec.attempt, rec.failover ?? null], ["claude", 1, null], "its agent, no failover");
      assert.ok(!(rec.changes || []).some((/** @type {string} */ c) => /failover is off|picked .* first/.test(c)), (rec.changes || []).join("\n"));
      assert.deepEqual(up.received.filter((c) => c.kind !== "models").map((c) => c.path), [], "the plain model was asked nothing");
    } finally {
      await put(cfg);
      await up.close();
    }
  });

  // (fails before: yes — the developer's Hunter of 11-01 on 7fe49b58d, its other way: with no agent left on the route,
  // the loop ran the agent's own cycle on the plain model, Filament's words its prompt, and the cycle, never listened
  // to, was asked for again and again, each a turn the plain model was paid for)
  test("an own turn whose route now names a plain model alone has no way to its agent: one turn, refused so, the plain model asked nothing", async () => {
    const up = await fakeUpstream();
    const id = await session("auto", "duo/haiku");
    asks.hold = id;
    await turn(id, "~wake please");
    await until(() => asks.held.length > 0 || null, "the cycle's ask");
    const cfg = (await (await shim.api("/api/state")).json()).config;
    /** @param {any[]} upstreams @param {any[]} routes */
    const put = async (upstreams, routes) => assert.equal((await shim.api("/api/config", { method: "PUT", body: { ...cfg, upstreams, routes } })).status, 200);
    const llm = { id: "llm", name: "llm", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true };
    await put([...cfg.upstreams, llm], cfg.routes.map((/** @type {any} */ rt) => (rt.match === "duo/*" ? { ...rt, upstream: "llm" } : rt)));
    try {
      asks.forward();
      const own = await until(async () => (await transcript(id)).turns[1]?.requestIds?.length ? (await transcript(id)).turns[1] : null, "the agent's own turn");
      const rec = await until(async () => {
        const r = await shim.record(own.requestIds.at(-1));
        return r && r.status !== "pending" ? r : null;
      }, "its record");
      assert.deepEqual([rec.status, rec.httpStatus], ["error", 502]);
      assert.match(String(rec.error), /claude is on this session's route no longer/);
      const agentSession = String(asksOf(id)[0].sessionId).slice(0, 8);
      await until(() => logged.some((m) => m.includes(`${agentSession}: the agent's own turn was not shown (HTTP 502`)) || null, "the bridge to hear it declined");
      assert.equal((await transcript(id)).turns.length, 2, "one turn of the agent's own");
      assert.equal(asksOf(id).length, 1, "asked for once");
      assert.deepEqual(up.received.filter((c) => c.kind !== "models").map((c) => c.path), [], "the plain model was asked nothing");
    } finally {
      await put(cfg.upstreams, cfg.routes);
      await up.close();
    }
  });

  // (fails before: yes — the review of 11-01: memory read who answers from the route's first, a plain model, so a turn
  // of the agent's own on such a route had memory's autopilot recall into it and offer its tools, in a body the agent
  // never reads, its record naming memory it never showed)
  test("with memory's autopilot on, an own turn whose route names a plain model first is archived only, as any of the agent's own", async () => {
    const up = await fakeUpstream();
    const kept = await shim.api("/api/memory/remember", { method: "POST", body: { text: "A background task ended when the build is green." } });
    assert.equal(kept.status, 200, await kept.clone().text());
    const id = await session("auto", "duo/haiku");
    asks.hold = id;
    await turn(id, "~wake please");
    await until(() => asks.held.length > 0 || null, "the cycle's ask");
    const cfg = (await (await shim.api("/api/state")).json()).config;
    /** @param {any} body */
    const put = async (body) => assert.equal((await shim.api("/api/config", { method: "PUT", body })).status, 200);
    const llm = { id: "llm", name: "llm", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true };
    const routes = cfg.routes.map((/** @type {any} */ rt) => (rt.match === "duo/*" ? { ...rt, upstream: "llm", fallbacks: [{ upstream: "claude" }] } : rt));
    await put({ ...cfg, upstreams: [...cfg.upstreams, llm], routes, memory: { ...cfg.memory, autopilot: { ...cfg.memory.autopilot, enabled: true } } });
    try {
      asks.forward();
      const own = (await settled(id, 2)).turns[1];
      const rec = await recordOf(own.requestIds.at(-1));
      assert.deepEqual([rec.acp.own, rec.upstream, rec.memory.injected, rec.memory.ids, rec.memory.tools], [true, "claude", 0, [], false]);
    } finally {
      await put(cfg);
      await up.close();
    }
  });

  // (fails before: no — a guard the mutation pass asked for: every own turn here was asked for on an agent that shows
  // them)
  test("an agent that shows no turns it begins by itself runs none: no prompt goes out with Filament's words", async () => {
    const id = await session();
    const r = await door(id, { upstream: "cx", sessionId: "thr_1", model: "cx/gpt-5", tasks: [] });
    assert.equal(r.status, 502);
    assert.match(await r.text(), /cx shows no turns its agent begins by itself/);
  });

  // (fails before: no — a guard the mutation pass asked for: no own turn failed here)
  test("an own turn that fails says nothing of the agent's health", async () => {
    const id = await session();
    await turn(id, "hello");
    const sessionId = convOf(id).sessionId;
    bridge().letGo("claude");
    const r = await door(id, { upstream: "claude", sessionId, model: "claude/haiku", tasks: [] });
    await r.text();
    const rid = String(r.headers.get("x-filament-request-id"));
    const rec = await until(async () => {
      const x = await shim.record(rid);
      return x?.status === "error" ? x : null;
    }, "the failed turn's record");
    assert.deepEqual([(rec.changes || []).filter((/** @type {string} */ c) => c.startsWith("acp: claude failed")), rec.failure ?? null], [[], null]);
  });

  // (fails before: yes — an own turn that failed left the chat idle from before it began: the next sweep let go of the
  // chat and the session a "continue" goes on in, and the state file kept it so for a restart (the bug report's H8);
  // and once no clock cut a turn (HarnessV3-FailurePoints §4 B), an own turn whose agent's process ended waited for its
  // cycle forever)
  test("an own turn whose agent's process ends fails, and leaves the chat idle from its end: the sweep after it keeps the chat, and a restart reads it so", async () => {
    const id = await session();
    await turn(id, "~wake-stuck please");
    await running(id);
    const conv = convOf(id);
    conv.lastUsed -= 5 * 3600_000;
    bridge().procs.get(conv.procKey).child.kill();
    // A failed agent turn keeps no reply in the transcript: its end is its record's.
    const rec = await until(async () => {
      const t = await transcript(id);
      const rid = t.live ? null : t.turns[1]?.requestIds?.at(-1);
      const x = rid ? await shim.record(rid) : null;
      return x?.status === "error" ? x : null;
    }, "the own turn's failed record");
    assert.match(String(rec.error), /agent process exited/, "the agent's process ending failed its own turn, in the process's own words");
    bridge().sweep(Date.now());
    assert.equal(convOf(id), conv, "the chat is kept");
    const key = [...bridge().convs].find(([, c]) => c === conv)?.[0];
    /** @returns {any} */
    const saved = () => {
      try {
        return JSON.parse(readFileSync(bridge().stateFile, "utf8")).conversations?.[key];
      } catch {
        return undefined;
      }
    };
    await until(() => saved()?.lastUsed > Date.now() - 3600_000, "the own turn's end saved, for a restart to read");
  });

  // (fails before: yes — what the session held between turns went with its process, unread, and the own turn asked for
  // it failed with no facts of its own: its record kept 0 tokens and no cost)
  test("a cycle Claude ran by itself whose process ended before its own turn showed it books what it spent on that turn's failed record", async () => {
    const id = await session();
    asks.hold = id;
    try {
      await turn(id, "~wake please");
      await until(() => asks.held.length > 0 || null, "the cycle's ask");
      // The cycle's words, its result and its cost come with the piece that asked: all of them held.
      await new Promise((r) => setTimeout(r, 200));
      const conv = convOf(id);
      bridge().procs.get(conv.procKey).child.kill();
      await until(() => !convOf(id)?.procKey || null, "the agent's process gone");
    } finally {
      asks.forward();
    }
    const rec = await until(async () => {
      const t = await transcript(id);
      const rid = t.live ? null : t.turns[1]?.requestIds?.at(-1);
      const x = rid ? await shim.record(rid) : null;
      return x?.status === "error" ? x : null;
    }, "the own turn's failed record");
    assert.match(String(rec.error), /session closed before its own turn could show it/);
    const { input, output, cacheRead, cacheWrite } = rec.tokens;
    assert.deepEqual([{ input, output, cacheRead, cacheWrite }, rec.listCost], [{ input: 901, output: 41, cacheRead: 3000, cacheWrite: 0 }, 0.012], "the cycle's tokens, and its run's cost");
    assert.deepEqual(rec.acp.modelUsage, [{ model: "claude-haiku-5", input: 901, output: 41, cacheRead: 3000, cacheWrite: 0 }]);
  });

  // (fails before: yes — what the cycle spent waited on the conversation for its own turn, which never came, and the
  // chat's next turn booked none of it: that turn's record kept 64/16, an estimate of its own words alone)
  test("a cycle Claude ran by itself whose process ended, its own turn never shown, is booked with the chat's next turn, which says so", async () => {
    const id = await session();
    asks.hold = id;
    try {
      await turn(id, "~wake please");
      await until(() => asks.held.length > 0 || null, "the cycle's ask");
      await new Promise((r) => setTimeout(r, 200));
      bridge().procs.get(convOf(id).procKey).child.kill();
      await until(() => !convOf(id)?.procKey || null, "the agent's process gone");
    } finally {
      // The ask is never served, as one Filament's door never answered.
      asks.held.splice(0);
      asks.hold = "";
    }
    const rec = await recordOf(await turn(id, "hello again"));
    const { input, output, cacheRead, cacheWrite } = rec.tokens || {};
    assert.deepEqual({ input, output, cacheRead, cacheWrite }, { input: 901, output: 41, cacheRead: 3000, cacheWrite: 0 }, "the cycle's tokens, with the turn's own (none)");
    assert.deepEqual(rec.acp.modelUsage, [{ model: "claude-haiku-5", input: 901, output: 41, cacheRead: 3000, cacheWrite: 0 }]);
    assert.ok((rec.changes || []).some((/** @type {string} */ c) => /spent in a cycle of its own between turns, which no turn showed, is booked with this turn/.test(c)), (rec.changes || []).join("\n"));
  });

  // (fails before: yes — the chat at rest let go of what its session held, and what the cycle spent with it: the chat's
  // next turn booked none of it)
  test("a cycle Claude ran by itself while its own turn waited, its chat resting idle meanwhile, is booked with the chat's next turn, which says so", async () => {
    const id = await session();
    asks.hold = id;
    try {
      await turn(id, "~wake please");
      await until(() => asks.held.length > 0 || null, "the cycle's ask");
      await new Promise((r) => setTimeout(r, 200));
      // Idle past its limit while its own turn waits, as one waits for the answer to a question its chat asked.
      bridge().sweep(Date.now() + 5 * 3600_000);
      await until(() => !convOf(id)?.procKey || null, "the chat at rest");
    } finally {
      asks.held.splice(0);
      asks.hold = "";
    }
    const rec = await recordOf(await turn(id, "hello again"));
    const { input, output, cacheRead, cacheWrite } = rec.tokens || {};
    assert.deepEqual({ input, output, cacheRead, cacheWrite }, { input: 901, output: 41, cacheRead: 3000, cacheWrite: 0 }, "the cycle's tokens, with the turn's own (none)");
    assert.ok((rec.changes || []).some((/** @type {string} */ c) => /spent in a cycle of its own between turns, which no turn showed, is booked with this turn/.test(c)), (rec.changes || []).join("\n"));
  });

  /** A cycle Claude ran by itself in chat `id`, its own turn never asked, kept for the chat as its process ended. @param {string} id */
  const keptAsItEnded = async (id) => {
    asks.hold = id;
    try {
      await turn(id, "~wake please");
      await until(() => asks.held.length > 0 || null, "the cycle's ask");
      await new Promise((r) => setTimeout(r, 200));
      bridge().procs.get(convOf(id).procKey).child.kill();
      await until(() => !convOf(id)?.procKey || null, "the agent's process gone");
    } finally {
      asks.held.splice(0);
      asks.hold = "";
    }
    assert.ok(bridge().convs.unshown.has(id), "kept for the chat's next turn");
  };

  // (fails before: yes — the chat let go of unused past its keep limit left what it kept of the cycle behind, an entry
  // no turn of it would book: the chat's spend did not move)
  test("a cycle Claude ran by itself that no turn showed is booked on its chat's spend, under its last turn, as the chat is let go of past its keep limit", async () => {
    const id = await session();
    await keptAsItEnded(id);
    /** @returns {any} */
    const spendOf = () => /** @type {any} */ (shim.app).memory.archive.getChain(id).meta.spend || {};
    const was = spendOf();
    // Unused past its keep limit: the sweep lets the chat's record go.
    convOf(id).lastUsed = Date.now() - 31 * 24 * 3600_000;
    bridge().sweep();
    assert.equal(convOf(id), undefined, "the chat's record let go of");
    const now = spendOf();
    /** @param {string} k */
    const grew = (k) => Math.round(((Number(now[k]) || 0) - (Number(was[k]) || 0)) * 1e6) / 1e6;
    assert.deepEqual(["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "listUsd"].map(grew), [901, 41, 3000, 0, 0.012], "the cycle's tokens, and its run's cost at the API's prices");
    assert.equal(bridge().convs.unshown.has(id), false, "nothing left behind");
    assert.ok(logged.some((l) => l.includes(id) && /is booked on the chat as it goes/.test(l)), logged.slice(-5).join("\n"));
  });

  // (fails before: yes — the bridge heard nothing of a chat deleted: its conversation stayed, and what it kept of the
  // cycle with it, an entry nobody would book, nothing said)
  test("a cycle Claude ran by itself that no turn showed goes with its chat as the chat is deleted: the log names what it was, and nothing is left behind", async () => {
    const id = await session();
    await keptAsItEnded(id);
    const del = await shim.api(`/api/memory/sessions/${encodeURIComponent(id)}/delete`, { method: "POST", body: {} });
    assert.equal(del.status, 200, await del.clone().text());
    assert.equal(convOf(id), undefined, "the chat's conversation goes with it");
    assert.equal(bridge().convs.unshown.has(id), false, "nothing left behind");
    assert.ok(logged.some((l) => l.includes(id) && /goes with the chat \(its chat was deleted\), booked nowhere: 901 input, 41 output, 3,000 cache-read and 0 cache-write tokens, \$0\.012 at the API's prices/.test(l)), logged.slice(-5).join("\n"));
  });

  // (fails before: yes — the decline let go of what the session held, and what the cycle spent with it: the chat's next
  // turn kept 64/10, an estimate of its own words alone)
  test("a cycle Claude ran by itself whose own turn was not shown is booked with the chat's next turn, which says so", async () => {
    const id = await session();
    asks.hold = id;
    try {
      await turn(id, "~wake please");
      await until(() => asks.held.length > 0 || null, "the cycle's ask");
      await new Promise((r) => setTimeout(r, 200));
      // Filament's door did not answer: the own turn is not shown, and what the session held is let go of.
      bridge().declineOwn(convOf(id).sessionId, "Filament's door did not answer");
    } finally {
      asks.held.splice(0);
      asks.hold = "";
    }
    const rec = await recordOf(await turn(id, "hello again"));
    const { input, output, cacheRead, cacheWrite } = rec.tokens || {};
    assert.deepEqual({ input, output, cacheRead, cacheWrite }, { input: 901, output: 41, cacheRead: 3000, cacheWrite: 0 }, "the cycle's tokens, with the turn's own (none)");
    assert.ok((rec.changes || []).some((/** @type {string} */ c) => /spent in a cycle of its own between turns, which no turn showed, is booked with this turn/.test(c)), (rec.changes || []).join("\n"));
  });

  // (fails before: yes — the stop let go of what the session held, and the stopped turn's facts kept none of what the
  // cycle spent: no usage)
  test("an own turn stopped before it opened keeps what the cycle it was to show spent, on its facts", async () => {
    const id = await session();
    asks.hold = id;
    await turn(id, "~wake-late please");
    const [held] = /** @type {any[]} */ (await until(() => (asks.held.length ? asks.held.splice(0) : null), "the cycle's ask"));
    asks.hold = "";
    open(held.sessionId);
    await titled(id, "Late word");
    const upstream = /** @type {any} */ (shim.app).config.upstreams.find((/** @type {any} */ u) => u.id === "claude");
    const out = await bridge().listen({ upstream, sessionId: held.sessionId, signal: AbortSignal.abort() });
    assert.equal(out.stopReason, "cancelled");
    const { input, output, cacheRead, cacheWrite } = out.usage || {};
    assert.deepEqual({ input, output, cacheRead, cacheWrite }, { input: 901, output: 41, cacheRead: 3000, cacheWrite: 0 }, "the cycle's tokens");
  });

  // (fails before: yes — an own turn that failed kept nothing of what it spent on its facts: the cycle's 700/30 and the
  // message's 50/5 came before that message's answer failed, and the record kept 0 tokens)
  test("an own turn that fails keeps what it spent: its cycle's by its result, and a message it ran next by that one's", async () => {
    const id = await session();
    await turn(id, "~wake-nextfail please");
    await running(id);
    const runId = String((await transcript(id)).turns[1]?.requestIds?.at(-1) || "");
    await until(async () => (await runEvents(runId)).some((e) => e.type === "tool-start"), "the cycle to read its file");
    const r = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "note", text: "then list the tests", from: "harness" } });
    assert.equal(r.status, 200, await r.clone().text());
    await tick();
    const rec = await until(async () => {
      const x = await shim.record(runId);
      return x?.status === "error" ? x : null;
    }, "the own turn's failed record");
    assert.match(String(rec.error), /the model's server failed mid-turn/);
    assert.deepEqual([rec.tokens.input, rec.tokens.output], [750, 35], "the cycle's, and the message's that failed");
  });

  test("the words of a turn of the agent's own", () => {
    assert.equal(ownTurnText("Claude Code", []), "Claude Code went on by itself.");
    assert.equal(ownTurnText("Claude Code", [{ status: "failed", summary: "" }]), "A background task ended (failed).");
    assert.equal(ownTurnText("Claude Code", [{ status: "", summary: "Done." }, { status: "stopped", summary: "" }]), "2 background tasks ended:\n- (ended) Done.\n- (stopped) (no summary)");
  });
});

describe("a cycle's turn asked for through Filament's own door (app/own-turns.js, HarnessV3-ACP AC3-9)", () => {
  // (fails before: no — a guard the mutation pass asked for: no own turn met a busy session, a refusal or a door that
  // did not answer)
  test("shown, the bridge is told; busy, it asks again once nobody holds the session; refused or unanswered, it lets go", async () => {
    /** The door's answers, in order; then 200. @type {number[]} */
    const answers = [];
    /** @type {any[]} */
    const heard = [];
    const door = createServer(async (req, res) => {
      const parts = [];
      for await (const c of req) parts.push(c);
      heard.push({ url: req.url, house: req.headers["x-api-key"] === houseKey(), body: JSON.parse(Buffer.concat(parts).toString("utf8")) });
      const status = answers.shift() ?? 200;
      res.writeHead(status, { "content-type": "text/plain" });
      res.end(status === 500 ? "boom" : "ok");
    });
    await new Promise((r) => door.listen(0, "127.0.0.1", () => r(undefined)));
    const port = /** @type {import("node:net").AddressInfo} */ (door.address()).port;
    const turns = new SessionTurns();
    /** @type {string[]} */
    const told = [];
    /** @type {string[]} */
    const logged = [];
    /** @type {any} */
    const bridge = { onOwnCycle: null, ownAgain: (/** @type {string} */ s) => told.push(`again ${s}`), declineOwn: (/** @type {string} */ s, /** @type {string} */ why) => told.push(`decline ${s}: ${why}`) };
    wireOwnTurns(bridge, { base: () => `http://127.0.0.1:${port}`, log: (_level, msg) => logged.push(msg), sessionTurns: turns, chainKeyOf: (chain) => (chain === "gone" ? null : `key-${chain}`), questionOver: () => () => {} });
    const tasks = [{ id: "t1", status: "completed", summary: "The tests pass." }];
    /** @param {string} sessionId @param {string} [chain] */
    const cycle = (sessionId, chain = "c1") => bridge.onOwnCycle({ upstreamId: "claude", sessionId, chain, model: "claude/haiku", tasks });
    cycle("s1");
    await until(async () => told.length === 1, "the shown turn");
    assert.deepEqual(told, ["again s1"]);
    assert.deepEqual(heard, [{ url: "/api/sessions/c1/own-turns", house: true, body: { upstream: "claude", sessionId: "s1", model: "claude/haiku", tasks } }]);
    // Busy: the person's turn holds the session. Asked again once nobody holds it.
    const person = await turns.acquire("key-c1", { window: "harness", client: "harness" });
    answers.push(409);
    cycle("s2");
    await until(async () => logged.length === 1, "the wait for the session");
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(told, ["again s1"], "not while the person's turn runs");
    turns.release("key-c1", /** @type {string} */ (person.token));
    await until(async () => told.length === 2, "the ask again");
    assert.equal(told[1], "again s2");
    answers.push(409);
    cycle("s3", "gone");
    answers.push(500);
    cycle("s4");
    await until(async () => told.length === 4, "the refusals");
    assert.deepEqual(told.slice(2).sort(), ["decline s3: its chat is gone", "decline s4: HTTP 500: boom"]);
    await new Promise((r) => door.close(() => r(undefined)));
    cycle("s5");
    await until(async () => told.length === 5, "the door's silence");
    assert.match(told[4], /^decline s5: Filament's door did not answer \(.+\)$/);
  });
});

describe("the page's side of a turn of the agent's own (HarnessV3-ACP AC3-9)", () => {
  const claude = { agent: "Claude Code", tasks: [{ id: "t1", status: "completed", summary: "The tests pass." }] };

  test("the transcript's turn keeps who went on, and the tasks", () => {
    const turns = transcriptTurns({ turns: [
      { n: 1, turnId: 1, requestIds: ["r1"], open: false, user: { role: "user", content: "~wake please" }, work: [], final: { role: "assistant", content: [{ type: "text", text: "Started." }] } },
      { n: 2, turnId: 2, requestIds: ["r2"], open: false, own: claude, user: { role: "user", content: [{ type: "text", text: ownTurnText("Claude Code", claude.tasks) }] }, work: [], final: { role: "assistant", content: [{ type: "text", text: "The tests pass." }] } },
    ] });
    assert.deepEqual(turns.map((t) => t.own), [null, claude]);
  });

  test("the row in the message's place: who went on and why, each task's end in its tone", () => {
    const doc = stubDocument();
    try {
      /** @param {any} own */
      const row = (own) => /** @type {any} */ (ownRow({ own }));
      const one = row(claude);
      assert.equal(one.querySelector(".boundary-label").textContent, "Claude Code · a background task ended");
      assert.deepEqual(one.querySelectorAll(".own-task").map((/** @type {any} */ t) => [t.className, t.textContent, t.getAttribute("title")]), [["own-task tone-ok", "✓The tests pass.", "The task completed"]]);
      assert.equal(one.querySelectorAll("button").length, 0, "no Copy, no Edit: the words were Filament's");
      const two = row({ agent: "Claude Code", tasks: [{ status: "failed", summary: "" }, { status: "stopped", summary: "Cut short." }, { status: "", summary: "Odd." }] });
      assert.equal(two.querySelector(".boundary-label").textContent, "Claude Code · 3 background tasks ended");
      assert.deepEqual(two.querySelectorAll(".own-task").map((/** @type {any} */ t) => [t.className, t.textContent]), [
        ["own-task tone-error", "!The task failed, with no summary"],
        ["own-task tone-warn", "!Cut short."],
        ["own-task", "•Odd."],
      ]);
      const none = row({ agent: "Claude Code", tasks: [] });
      assert.equal(none.querySelector(".boundary-label").textContent, "Claude Code went on by itself");
      assert.equal(none.querySelector(".own-tasks"), null);
    } finally {
      doc.restore();
    }
  });

  test("its footer offers no Retry: there is no text of the developer's to send again", () => {
    const doc = stubDocument();
    try {
      const cb = { onCopy() {}, onFork() {}, onRetry() {}, onWatchRun() {} };
      /** @param {any} turn */
      const titles = (turn) => /** @type {any} */ (footerEl(turn, cb)).querySelectorAll("button").map((/** @type {any} */ b) => String(b.getAttribute("title")).split(" — ")[0]);
      assert.deepEqual(titles({ n: 2, status: "done", own: claude }), ["Copy", "Fork from here"]);
      assert.deepEqual(titles({ n: 2, status: "done" }), ["Copy", "Fork from here", "Retry"]);
    } finally {
      doc.restore();
    }
  });

  test("who holds the turn, in the spinner's words, the queue's line and the toast", () => {
    const holder = { window: "harness", client: "harness", label: "Claude Code", since: 0, idleMs: 2000, own: { agent: "Claude Code" } };
    assert.equal(workingWords(holder), "Claude Code is working on its own");
    assert.equal(queueText(holder, () => 61_000), "Waiting — Claude Code is working on its own · 1 min · idle 2 s");
    assert.equal(waitingToast(holder), "Claude Code is working on its own — the message waits and sends itself when it's done");
    assert.equal(waitingToast({ ...holder, window: "move", client: "the move to another folder", label: "the move to another folder", own: null }), "This chat is moving to another folder — the message waits and sends itself once it has moved");
    assert.equal(agentQueuesWords("Claude Code"), "Queued — Claude Code is working on its own; your message goes out when it's done");
    assert.equal(agentQueuesWords(null), "Queued — this agent can't take a message mid-turn; it goes out when this turn ends");
  });

  // The page's half the look drives (scratchpad ac39_look.mjs): the pins it rests on, where no DOM runs here.
  test("the page draws it, follows it, says who holds the turn, and says its end out loud from the writing tab", () => {
    const src = (/** @type {string} */ f) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "ui", "harness", f), "utf8");
    const app = src("app.js");
    // Beside it, the row of the turn Filament sent after a restart (HarnessV3-TaskGraph-v2 TG2-D83, resume-cut.test.js).
    assert.match(src("conversation/timeline.js"), /const userEl = card \? h\("div"\) : turn\.own \? ownRow\(turn\) : turn\.resumed \? resumedRow\(\) : turn\.goalRound \? goalRoundRow\(turn\) : turn\.woke \? wokeRow\(turn\) : turn\.synced \? syncRow\(turn\) : turn\.teamResult \? teamResultRow\(turn\) : turn\.flowSaid \? flowSaidRow\(turn\) : turn\.brief \? briefRow\(turn, [^]*?\) : userRow\(turn, \{/);
    assert.match(app, /live\.own = run\.meta\?\.own\?\.agent \|\| null;/);
    assert.match(app, /toast\(agentQueuesWords\(chat\.live\.own\)\);\s+return "queue";/);
    assert.match(app, /requeueHeld\(chat, live, live\.held\.release\(\), agentQueuesWords\(live\.own\)\)/);
    assert.match(app, /const waits = \{ text: typed, attachments, holder, opts \};\s+wstore\.save\(String\(chat\.chainId\), waits\);\s+armWaiting\(chat, turn, waits\);\s+if \(!away\) toast\(waitingToast\(holder\)\);/);
    assert.match(app, /if \(turn\.own && document\.hidden && !\(writing\.chainId === chat\.chainId && !writing\.you\)\) \{\s+sayEnded\(chat, turnNumbered\(chat\.turns, turn\.n\)\?\.status === "error" \? "error" : "done"\);/);
    // A card's answers send through `sendAsked`, which acts on what the send came to; Compact and send's through
    // `compactAndSend`, once room is made.
    assert.equal((app.match(/\bsendAgain\(chat, turn(, \{[^}]*\}|, o)?\)(\.then\(|;)/g) || []).length, 2, "Continue on, and sendAsked's");
    assert.equal((app.match(/\breturn (?:await )?sendAsked\(chat, turn(, \{[^}]*\}|, cold \|\| changed \? \{ sendAsIs: true, carry \} : \{\})?\);/g) || []).length, 7, "Retry, Compact and send, Switch and send with a form, a switch's Send as it is, a switch's handoff, Send as it is, Don't ask again");
    // (a thread's brief goes again as the brief it was: the line before the message's)
    assert.match(app, /function sendAgain\(chat, turn, o = \{\}\) \{\s+const again = againOf\(turn\);\s+if \(again\.brief\) return sendMessage\("", \[\], "normal", \{ \.\.\.o, replaces: turn, \.\.\.sendsIn\(chat\), brief: \{ block: again\.brief, view: turn\.brief \} \}\);\s+const overrules = turn\.overrules\?\.length \? \{ overrules: turn\.overrules \} : \{\};\s+return again\.text \|\| again\.attachments\.length \? sendMessage\(again\.text, again\.attachments, "normal", \{ \.\.\.o, \.\.\.overrules, replaces: turn, \.\.\.sendsIn\(chat\) \}\) : Promise\.resolve\(false\);/);
    assert.match(app, /attachments: attachments\.map\(\(a\) => \(\{ name: a\.name, size: a\.size, kind: a\.kind \}\)\),\s+\/\/ [^\n]*\n\s+sent: \[\.\.\.attachments\],/);
    assert.doesNotMatch(app, /wordsAgain\(/, "no way on sends the words alone");
    assert.match(src("composer/composer.js"), /ownAgent = agentQueues \? run\?\.own \|\| null : null;/);
    assert.match(src("sidebar.js"), /state\.holders\.set\(h\.chainId, \{ window: h\.window, client: h\.client, label: h\.label, since: h\.since, own: h\.own \|\| null \}\);/);
  });

  test("a way on sends the developer's words again; for a turn of the agent's own, \"continue\"", () => {
    assert.equal(wordsAgain({ userText: "fix the test" }), "fix the test");
    assert.equal(wordsAgain({ userText: "(attachments)" }), "");
    assert.equal(wordsAgain({ userText: ownTurnText("Claude Code", claude.tasks), own: claude }), "continue");
  });

  // A message stopped by the card that asks before it is sent (HarnessV4_Tasks C26) went again with its words alone:
  // its pictures were lost, and pictures alone sent nothing.
  test("a way on sends the whole message again: the words and what went with them", () => {
    const pic = { kind: "image", name: "shot.png", size: 3, type: "image/png", data: "QUJD" };
    const file = { kind: "text", name: "notes.md", size: 5, text: "hello" };
    // A turn this page sent: the composer's own list, files with the pictures.
    assert.deepEqual(againOf({ userText: "look", sent: [pic, file] }), { text: "look", attachments: [pic, file] });
    assert.deepEqual(againOf({ userText: "(attachments)", sent: [pic] }), { text: "", attachments: [pic] }, "pictures alone go again");
    assert.deepEqual(againOf({ userText: "just words", sent: [] }), { text: "just words", attachments: [] });
    // A turn drawn from the record: its pictures, named as its attachments name them, in order.
    const drawn = {
      userText: "two",
      attachments: [{ kind: "image", name: "a.png" }],
      userContent: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } },
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "REVGR0hJ" } },
        { type: "image", source: { type: "url", url: "https://example.com/x.png" } },
        { type: "text", text: "two" },
      ],
    };
    assert.deepEqual(againOf(drawn), {
      text: "two",
      attachments: [
        { kind: "image", name: "a.png", size: 3, type: "image/png", data: "QUJD" },
        { kind: "image", name: "picture", size: 6, type: "image/jpeg", data: "REVGR0hJ" },
      ],
    });
    assert.deepEqual(againOf(/** @type {any} */ ({ userText: "x", userContent: "not a list" })), { text: "x", attachments: [] });
    // A turn its agent began by itself had nothing with it.
    assert.deepEqual(againOf({ userText: ownTurnText("Claude Code", claude.tasks), own: claude, sent: [pic] }), { text: "continue", attachments: [] });
  });
});

describe("a turn of the agent's own on a session that has not counted the chat's turns (HarnessV3-ACP AC3-9, AC5-1)", () => {
  let root = "";
  const log = () => join(root, "prompts.jsonl");
  /** @type {AcpBridge} */
  let bridge;
  /** The bridge's asks for a turn of the agent's own. @type {any[]} */
  const asked = [];
  const up = () => ({ id: "claude", name: "Claude Code", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_ALLOW_LOAD: "1", FAKE_ACP_SESSION_CAPS: "resume,close", FAKE_ACP_LOG: log() }, cwdDefault: root, permissions: "allow-all", hints: false } });
  before(() => {
    root = mkdtempSync(join(tmpdir(), "filament-acp-own-count-"));
    bridge = new AcpBridge(/** @type {any} */ ({ log: () => {}, stateFile: join(root, "acp-sessions.json") }));
    bridge.onOwnCycle = (cycle) => void asked.push(cycle);
  });
  after(async () => {
    bridge.shutdown();
    await removeDirs(root);
  });
  /** A harness request's headers, naming the chat's newest compaction. @param {number} base */
  const naming = (base) => ({ [COMPACTION_HEADER]: String(base) });
  /** A request's body: the history, then the person's words. @param {string} text @param {any[]} [history] */
  const bodyOf = (text, history = []) => ({ model: "claude/fake-a", max_tokens: 100, messages: [...history, { role: "user", content: text }] });
  /** The chat's `/resume sess_old1`, on its compaction `base`. @param {number} base @param {any[]} [history] */
  const resume = (base, history = []) =>
    bridge.attach({ upstream: up(), modelId: "fake-a", format: "anthropic", body: bodyOf("/resume sess_old1", history), cwdHint: null, conversationId: "chat", sessionId: "sess_old1", headers: naming(base) });
  /** A turn of the harness chat. @param {string} text @param {number} base @param {any[]} [history] */
  const turn = (text, base, history = []) =>
    bridge.run({ upstream: up(), modelId: "fake-a", format: "anthropic", body: bodyOf(text, history), conversationId: "chat", chain: "chat", headers: naming(base), onEvent: () => {} });
  /** Each prompt the agent was sent, whole. @returns {string[]} */
  const prompts = () => (existsSync(log()) ? readFileSync(log(), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).prompt) : []);

  // (fails before: yes — the review of 11-01 on 1c8b72028: a session the chat's /resume took onto a newer compaction
  // had no count of the chat's turns, and its cycle made that 1, so the chat's next turn handed the agent its own cycle
  // back as another assistant's: "Meanwhile, this conversation continued with another assistant…")
  test("a cycle on a session whose count of the chat's turns is unknown leaves it so: the chat's next turn hands the agent nothing back", async () => {
    assert.equal((await resume(0)).ok, true);
    assert.equal((await turn("~wake please", 0)).sessionId, "sess_old1");
    await until(() => asked.length > 0 || null, "the cycle's ask");
    // Filament's copy compacted turn 1 since: the chat's /resume of the session it holds takes the session onto that
    // compaction, the turns it counted on the copy from before gone, and no turn prompts before the cycle, as where the
    // command's follow-up turn is stopped first.
    const copy = summaryHead(summaryLead(1, 1, "The person had the tests run in the background."));
    const r = await resume(6, copy);
    assert.equal(r.ok, true, JSON.stringify(r));
    const conv = [...bridge.convs.values()].find((/** @type {any} */ c) => c.chain === "chat");
    assert.equal(conv?.sessionId, "sess_old1");
    assert.equal(conv.seenUserTurns ?? null, null, "the session's count unknown");
    assert.equal((await bridge.listen({ upstream: up(), sessionId: "sess_old1" })).stopReason, "end_turn");
    const sent = prompts().length;
    // The chat as the harness composes it now: the summary, the agent's own turn, then the person's words.
    const next = await turn("go on", 6, [...copy, { role: "user", content: ownTurnText("Claude Code", asked[0].tasks) }, { role: "assistant", content: "The tests pass." }]);
    assert.equal(next.sessionId, "sess_old1");
    assert.deepEqual(prompts().slice(sent), ["go on"], "the person's words alone: the session ran the cycle itself, so nothing is handed back");
    assert.equal(conv.seenUserTurns, 3, "its count taken at that prompt");
  });
});

describe("what a cycle of the agent's own spent, which no turn of its own shows, is booked once, with the chat's next turn (HarnessV3-ACP AC3-9)", () => {
  /** What the fake's `~wake` cycle spent: its result's usage. */
  const CYCLE = { input: 901, output: 41, cacheRead: 3000, cacheWrite: 0 };
  const BOOKED = /spent in a cycle of its own between turns, which no turn showed, is booked with this turn/;
  /** A turn's tokens. @param {any} out */
  const tokensOf = (out) => {
    const { input, output, cacheRead, cacheWrite } = out.usage || {};
    return { input, output, cacheRead, cacheWrite };
  };
  /**
   * A bridge of its own, whose asks for the agent's own turns are never served, and a harness chat's turns on it.
   * @param {Record<string, string>} [env]
   */
  const world = (env = {}) => {
    const root = mkdtempSync(join(tmpdir(), "filament-acp-own-spent-"));
    const upstream = { id: "claude", name: "Claude Code", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_ALLOW_LOAD: "1", FAKE_ACP_SESSION_CAPS: "resume,close", ...env }, cwdDefault: root, permissions: "allow-all", hints: false } };
    /** @type {any[]} */
    const asked = [];
    /** What the bridge logged. @type {string[]} */
    const logged = [];
    const make = () => {
      const b = new AcpBridge(/** @type {any} */ ({ log: (/** @type {string} */ _level, /** @type {string} */ msg) => void logged.push(msg), stateFile: join(root, "acp-sessions.json") }));
      b.onOwnCycle = (cycle) => void asked.push(cycle);
      return b;
    };
    let bridge = make();
    /**
     * A turn of `conversationId`: the harness chat's, naming its newest compaction `base`, where `base` is given.
     * @param {string} text @param {{ conversationId?: string, base?: number | null, resume?: string }} [o]
     */
    const turn = (text, { conversationId = "chat", base = 0, resume } = {}) =>
      bridge.run({ upstream, modelId: "fake-a", format: "anthropic", body: { model: "claude/fake-a", max_tokens: 100, messages: [{ role: "user", content: text }] }, conversationId, ...(base == null ? {} : { chain: conversationId, headers: { [COMPACTION_HEADER]: String(base) } }), ...(resume ? { resumeSessionId: resume } : {}), onEvent: () => {} });
    /** The cycle the chat's session began by itself, held: its ask came, and its result a moment after. */
    const held = async () => {
      await until(() => asked.length > 0 || null, "the cycle's ask");
      await new Promise((r) => setTimeout(r, 200));
    };
    const chat = () => [...bridge.convs.values()].find((/** @type {any} */ c) => c.chain === "chat");
    /** The chat's session's agent process ends on its own, what the session held kept for the chat. */
    const exits = async () => {
      bridge.procs.get(chat().procKey).child.kill();
      await until(() => !chat().procKey || null, "the agent's process gone");
    };
    /** Filament restarts: the bridge shuts down, and one started after reads its map. */
    const restart = () => {
      bridge.shutdown();
      bridge = make();
    };
    const done = async () => {
      bridge.shutdown();
      await removeDirs(root);
    };
    return { get bridge() { return bridge; }, upstream, turn, held, chat, exits, restart, logged, root, done };
  };

  // (fails before: yes — the summary that lost the session let go of what it held, and the chat's next turn booked none
  // of the cycle: no usage)
  test("a cycle held while Filament's summary lost the session is booked with the chat's next turn, which says so", async () => {
    const w = world();
    try {
      await w.turn("~wake please");
      await w.held();
      await assert.rejects(w.bridge.summarize({ upstream: w.upstream, conversationId: "chat", instruction: "~losesession s1" }), /exited unexpectedly/);
      const next = await w.turn("hello again");
      assert.deepEqual(tokensOf(next), CYCLE);
      assert.ok(next.notes.some((/** @type {string} */ n) => BOOKED.test(n)), next.notes.join("\n"));
    } finally {
      await w.done();
    }
  });

  // (fails before: yes — the session the chat's compaction left let go of what it held, and the chat's next turn, in a
  // fresh session, booked none of the cycle: no usage)
  test("a cycle held on a session the chat's compaction leaves is booked with the chat's next turn, in its fresh session, which says so", async () => {
    const w = world();
    try {
      const first = await w.turn("~wake please");
      await w.held();
      const next = await w.turn("hello again", { base: 3 });
      assert.notEqual(next.sessionId, first.sessionId, "a fresh session, from the compaction");
      assert.deepEqual(tokensOf(next), CYCLE);
      assert.ok(next.notes.some((/** @type {string} */ n) => BOOKED.test(n)), next.notes.join("\n"));
      // (fails before: no — a guard: booked once)
      assert.equal((await w.turn("and again", { base: 3 })).usage, undefined, "the turn after books none of it again");
    } finally {
      await w.done();
    }
  });

  // (fails before: yes — the process's end went through the session's conversations in order, and the client's, first,
  // which shows none of the agent's own turns, let go of what the session held: the chat's next turn booked none of it)
  test("a cycle held on a session a client's conversation shares with the chat, ahead of it, is booked with the chat's next turn once its process ends", async () => {
    const w = world();
    try {
      await w.turn("hello", { conversationId: "client", base: null, resume: "sess_old1" });
      await w.turn("~wake please", { resume: "sess_old1" });
      await w.held();
      const proc = w.bridge.procs.get(w.chat().procKey);
      proc.child.kill();
      await until(() => !w.chat().procKey || null, "the agent's process gone");
      const next = await w.turn("hello again");
      assert.deepEqual(tokensOf(next), CYCLE);
      assert.ok(next.notes.some((/** @type {string} */ n) => BOOKED.test(n)), next.notes.join("\n"));
    } finally {
      await w.done();
    }
  });

  // (fails before: yes — the cycle's result, a peer's message's and no background task's answer, was read as one of
  // the turn's prompts' cycles, which their answers report: the turn booked none of its tokens, though its cost came
  // with the session's figure)
  test("a cycle Claude ran by itself for another session's message, held until the person's next turn shows it, is booked with that turn: its tokens with its cost", async () => {
    const w = world();
    try {
      await w.turn("~wake-peer please");
      await w.held();
      const next = await w.turn("hello again");
      assert.deepEqual(tokensOf(next), CYCLE);
      assert.equal(next.context?.cost, 0.012, "its run's cost, by the session's figure");
      // (fails before: no — a guard: booked once)
      assert.equal((await w.turn("and again")).usage, undefined, "the turn after books none of it again");
    } finally {
      await w.done();
    }
  });

  // (fails before: yes — what the chat kept of the cycle lived in the bridge's memory alone: after a restart, the chat's
  // next turn booked none of it, no usage)
  test("a cycle held as its agent's process ended is booked with the chat's next turn after a Filament restart, once", async () => {
    const w = world();
    try {
      await w.turn("~wake please");
      await w.held();
      await w.exits();
      w.restart();
      const next = await w.turn("hello again");
      assert.deepEqual(tokensOf(next), CYCLE);
      assert.ok(next.notes.some((/** @type {string} */ n) => BOOKED.test(n)), next.notes.join("\n"));
      // (fails before: no — a guard: booked once, the map written without it before a restart could book it again)
      w.restart();
      assert.equal((await w.turn("and again")).usage, undefined, "booked once");
    } finally {
      await w.done();
    }
  });
});
