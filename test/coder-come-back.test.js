// @ts-check
// x50: a timer an agent sets for later fires, whatever becomes of its process. Claude Code's own (CronCreate,
// ScheduleWakeup) lived in its process alone, which Filament lets go after 90 minutes unasked (acp/bridge.js `sweep`):
// a wake set on 11-25 for two hours out never came. A harness chat's coding agent comes back with Filament's
// come_back now, kept across that and a restart, a minute to a day out, and its Claude Code is opened without its own
// timers wherever Filament's server serves it.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLAUDE_OWN_WAKES, planToolset } from "../src/adapters/agents/acp/toolset.js";
import { cancelComeBack, comeBackOf, tellLater } from "../src/adapters/tools/hands.js";
import { COME_BACK, COME_BACK_OFF, COME_BACK_SWITCHED_OFF } from "../src/app/agent/come-back.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { serverInstructions } from "../src/http/mcp.js";
import { comeBackClock } from "../src/ui/harness/lib/come-back.js";
import { FAKE_ACP_AGENT, startApp } from "./helpers/app.js";
import { removeDirs, scaledMs, until } from "./helpers/wait.js";
import { WAKE_SETTLE_MS } from "../src/app/sessions/wake.js";

// (fails before: yes — a coding agent had no come_back: its only way back was its own timer)
test("a harness chat's own coding agent is offered come_back; its call sets the chat's come-back while the chat's switch is on", async () => {
  let on = true;
  const memory = /** @type {any} */ ({ archive: { metaOf: (/** @type {string} */ chain) => (chain === "c-theirs" ? { agentDevice: "d1" } : {}) } });
  const tools = createAgentTools({ memory, memoryToolsOn: () => false, graphs: () => null, turns: { get: () => null }, subagents: () => null, membersOf: () => null, comeBackOn: () => on });
  const ctx = (/** @type {any} */ extra) => /** @type {any} */ ({ cwd: "/w", upstream: "u", turn: null, graph: false, chain: "c-mine", launch: true, ...extra });
  const at = (/** @type {any} */ extra) => tools.list(ctx(extra)).find((t) => t.name === COME_BACK) || null;
  assert.equal(at({})?.upfront, true, "the chat's own agent, loaded whole");
  assert.equal(at({ by: { id: "sa_00000001", exchange: 1 } }), null, "a sub-agent: its run ends with its report");
  assert.equal(at({ team: true }), null, "a team's lead");
  assert.equal(at({ launch: false }), null, "no chat's own agent");
  assert.equal(at({ chain: "c-theirs" }), null, "a chat of another machine's agents");
  assert.deepEqual(await tools.call(COME_BACK, { seconds: 7200, note: "x" }, ctx({ by: { id: "sa_00000001", exchange: 1 } })), { text: COME_BACK_OFF, isError: true }, "a sub-agent's call");
  // (fails before: yes — x50's review: its session reads its tools once as it opens, so the switch is asked at each call)
  on = false;
  assert.equal(at({})?.upfront, true, "the chat's switch off: still listed, as the session opened with it");
  assert.deepEqual(await tools.call(COME_BACK, { seconds: 7200, note: "x" }, ctx({})), { text: COME_BACK_SWITCHED_OFF, isError: true }, "refused in words that name the switch");
  assert.equal(comeBackOf("c-mine"), null);
  on = true;
  assert.ok(tools.has(COME_BACK));
  const r = await tools.call(COME_BACK, { seconds: 7200, note: "Resume x20 once the usage limit resets." }, ctx({}));
  assert.match(r.text, /^Set: Filament comes back to this chat in 2 h \(at \d\d:\d\d(?: tomorrow)?\), with your note\./);
  assert.equal(comeBackOf("c-mine")?.note, "Resume x20 once the usage limit resets.");
  cancelComeBack("c-mine");
  assert.match(serverInstructions({ cwd: "/w", comeBack: true }), /Its `come_back` comes back to this chat by itself at a time you set, with your note: Filament keeps it across a restart/);
  assert.doesNotMatch(serverInstructions({ cwd: "/w" }), /come_back/);
});

// (fails before: yes — its Claude Code kept CronCreate and ScheduleWakeup, whose wakes ended with its process)
test("its Claude Code is opened without its own timers wherever Filament's server serves a chat's agent or a sub-agent; a lead keeps them", () => {
  /** @param {Record<string, any>} want @param {boolean} [http] */
  const plan = (want, http = true) =>
    planToolset(/** @type {any} */ ({ relay: false, acp: {}, upstream: { id: "claude" }, proc: { initResult: { agentCapabilities: { mcpCapabilities: { http } } } }, profile: { rawMessages: true }, turn: { bridge: "prompts" }, fullBridge: false, cwd: "/w", mcpBase: "http://127.0.0.1:9", memoryWanted: false, existingToken: null, notes: [], ...want }));
  const off = (/** @type {any} */ p) => p.sessionMeta._meta?.claudeCode?.options?.disallowedTools;
  assert.deepEqual(CLAUDE_OWN_WAKES, ["CronCreate", "CronDelete", "CronList", "ScheduleWakeup"]);
  assert.deepEqual(off(plan({ launchWanted: "agent" })), ["Agent", "Task", ...CLAUDE_OWN_WAKES], "the chat's own agent");
  assert.deepEqual(off(plan({ teamWanted: true })), ["Agent", "Task"], "a team's lead keeps its own: no come_back stands in for them");
  assert.deepEqual(off(plan({ teamWanted: true, launchWanted: "agent" })), ["Agent", "Task"], "a lead offered Filament's agent tool too");
  assert.deepEqual(off(plan({ turn: { bridge: "prompts", toolsAt: { chain: "c1", by: { id: "sa_00000001", exchange: 1 } } } })), [...CLAUDE_OWN_WAKES], "a sub-agent");
  assert.equal(off(plan({ launchWanted: "agent" }, false)), undefined, "no server of Filament's, no come_back: its own stay");
  assert.equal(off(plan({ memoryWanted: true })), undefined, "a session no chat's agent or sub-agent holds");
});

// (fails before: yes — a come-back was an hour out at most, and its time said no day)
test("a come-back past midnight says tomorrow on the page", () => {
  const now = new Date(2026, 10, 25, 22, 0, 0);
  assert.equal(comeBackClock({ at: new Date(2026, 10, 26, 5, 1).getTime(), note: "" }, now), "05:01 tomorrow");
  assert.equal(comeBackClock({ at: new Date(2026, 10, 25, 23, 30).getTime(), note: "" }, now), "23:30");
  // A day's wait across a clock moved forward lands two dates on: said so, never "tomorrow".
  assert.equal(comeBackClock({ at: new Date(2026, 10, 27, 0, 30).getTime(), note: "" }, new Date(2026, 10, 25, 23, 30)), "00:30 the day after tomorrow");
});

describe("a coding agent's turn that runs as its time comes", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-coder-come-back-"));
  const projDir = join(root, "project");
  const gates = join(root, "gates");
  before(async () => {
    mkdirSync(projDir);
    mkdirSync(gates);
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "own", name: "own", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_QUEUE_GATE: gates }, cwdDefault: projDir, permissions: "allow-all", hints: false } }];
        cfg.routes = [{ match: "own/*", upstream: "own", upstreamModel: "{1}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await removeDirs(root);
  });

  // (fails before: yes — x50's review: the waker took the turn's open door for a turn that would hear it, no step of a
  // coding agent's took it, and nothing woke the chat as the turn ended: the note waited for the person's next message)
  test("its note waits for the turn's end, and the chat goes on by itself with it then", async () => {
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "own/fake-a", preset: "plain" } });
    assert.equal(made.status, 200, await made.clone().text());
    const id = String((await made.json()).id);
    const turns = async () => /** @type {any[]} */ ((await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json()).turns || []);
    // A turn held at its first step (fixtures/fake-acp-agent.mjs `~queue`): its gates open once the time has come.
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "~queue", stream: true } });
    const body = res.text();
    await until(async () => (await turns()).length >= 1 || null, "the held turn to be under way");
    // Its time, now, as hands.js `comeBackCame` tells it: the test does not wait a minute.
    tellLater({ session: id, agent: null }, { id: "wake_c", command: "", code: null, kind: "wake", text: "[Filament: the time you set has come — 10 min ago you asked to come back to this chat. Your note: look at CI]" });
    // The turn runs on past the waker's look (it settles first): a wake it judged then finds the turn still running.
    await new Promise((r) => setTimeout(r, scaledMs(WAKE_SETTLE_MS * 5)));
    for (const g of ["q1", "q2", "end"]) writeFileSync(join(gates, g), "");
    await body;
    const all = /** @type {any[]} */ (
      await until(async () => {
        const t = await turns();
        return t.length >= 2 && t[1].final ? t : null;
      }, "the chat's second turn, woken for the note", { timeoutMs: 20_000 })
    );
    assert.equal(all[1].woke, true, "Filament started it by itself");
    assert.ok(JSON.stringify(all[1].user).includes("Your note: look at CI"), "it carries the note");
  });
});
