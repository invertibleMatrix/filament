// The idle-only stop (`POST /api/shutdown { ifIdle: true }`) and the work a restart would end that holds no request
// and no turn: a sub-agent of Filament's between its calls, and a coding agent's own sub-agent or workflow after its
// session's turn ended — Claude's background agent dies with its process. A shell of either is not waited for: it may
// serve for ever.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { systemRoutes } from "../src/http/admin/system.js";
import { anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { gate, removeDirs, until } from "./helpers/wait.js";

/** A task of Claude's as its bridge says it (`AgentTask`). @param {string} kind */
const task = (kind) => ({ id: `t-${kind}`, kind, description: kind, background: true, call: null, subagent: null, since: 0, tokens: null, tools: null, lastTool: null, summary: null });

/**
 * The stop route over a context where nothing else runs.
 * @param {{ live?: any[], holders?: any[], compactions?: any[], running?: number, tasks?: any[],
 *   titles?: Record<string, string | null>, previews?: Record<string, string> }} now
 */
const shutdownRoute = ({ live = [], holders = [], compactions = [], running = 0, tasks = [], titles = {}, previews = {} }) => {
  const stops = { drained: 0, exited: 0 };
  /** @type {Record<string, string | null>} */
  const named = titles;
  /** @type {Record<string, string>} */
  const first = previews;
  const a = {
    usage: { live: () => live },
    // The archive maps a turn's key to its chat: `titles` by key, with its first words (`previews`); a key it does not
    // hold names no chat.
    memory: { archive: { chainIdForKey: (/** @type {string} */ k) => (k in named ? `c-${k}` : null), getChain: (/** @type {string} */ id) => ({ title: named[id.slice(2)], preview: first[id.slice(2)] ?? null }) } },
    sessionTurns: { holders: () => holders },
    sessions: { compactionsNow: () => compactions },
    subagents: { running: () => running },
    agentTasksNow: () => tasks,
    log: () => {},
    ops: { record: () => {} },
    drain: () => (stops.drained += 1),
    stopApi: async () => {},
    onShutdown: () => (stops.exited += 1),
  };
  const row = systemRoutes(a).find(([method, path]) => method === "POST" && path === "/shutdown");
  assert.ok(row);
  /** @param {any} body */
  const ask = async (body) => {
    const res = { status: 0, text: "", writableEnded: false, destroyed: false, writeHead(/** @type {number} */ s) { this.status = s; }, end(/** @type {string} */ t) { this.text = t; } };
    await /** @type {any} */ (row)[2]({ json: async () => body, res });
    return { status: res.status, body: JSON.parse(res.text) };
  };
  return { ask, stops };
};

// (fails before: yes — the gate counted requests, turns and compactions alone: a sub-agent running a long command, or
// Claude's background agent after its turn ended, was killed by a restart the caller asked for only while idle)
test("an idle-only stop waits for sub-agents at work, Filament's and a coding agent's, but not for a coding agent's shell", async () => {
  const subs = shutdownRoute({ running: 2 });
  assert.deepEqual(await subs.ask({ ifIdle: true }), { status: 409, body: { ok: false, inflight: 0, turns: 0, chats: [], compacting: 0, subagents: 2, agentTasks: 0, note: "not stopped: 2 sub-agents working" } });
  assert.deepEqual(subs.stops, { drained: 0, exited: 0 }, "Filament goes on");

  const claude = shutdownRoute({ tasks: [task("local_agent"), task("local_workflow"), task("remote_agent"), task("local_bash")] });
  assert.deepEqual(await claude.ask({ ifIdle: true }), { status: 409, body: { ok: false, inflight: 0, turns: 0, chats: [], compacting: 0, subagents: 0, agentTasks: 3, note: "not stopped: 3 coding-agent tasks working" } });

  const both = shutdownRoute({ live: [{}], running: 1, tasks: [task("local_agent")] });
  assert.equal((await both.ask({ ifIdle: true })).body.note, "not stopped: 1 request in flight, 1 sub-agent working, 1 coding-agent task working");

  // A shell alone holds nothing back, and the plain stop waits for no sub-agent: it cuts Filament's (each session hears
  // of it with its next turn).
  for (const now of [{ tasks: [task("local_bash")] }, { running: 1, tasks: [task("local_agent")], plain: true }]) {
    const { ask, stops } = shutdownRoute(now);
    const r = await ask("plain" in now ? {} : { ifIdle: true });
    assert.equal(r.status, 200, JSON.stringify(now));
    assert.equal(r.body.ok, true);
    await until(() => stops.exited === 1, "the stop to run");
    assert.equal(stops.drained, 1);
  }
});

// (fails before: yes — the refusal counted the turns and named no chat: the harness's Restart could not say which to
// wait for, HarnessV4_Settings_Plan HC-65)
test("an idle-only stop held by turns names their chats as the sidebar does, and a key with no chat not at all", async () => {
  const { ask, stops } = shutdownRoute({
    holders: [{ key: "k1" }, { key: "k2" }, { key: "k3" }, { key: "k4" }],
    titles: { k1: "Fix the parser", k2: null, k4: null },
    previews: { k4: "why does   the build fail on Windows when the path has a space in it" },
  });
  const r = await ask({ ifIdle: true });
  assert.equal(r.status, 409);
  assert.deepEqual(r.body.chats, ["Fix the parser", "an untitled chat", "why does the build fail on Windows when the pat…"]);
  assert.equal(r.body.turns, 4, "every turn counts, named or not");
  assert.equal(r.body.note, "not stopped: 4 turns running in “Fix the parser”, “an untitled chat”, “why does the build fail on Windows when the pat…”");
  assert.deepEqual(stops, { drained: 0, exited: 0 }, "nothing stops");
});

// (fails before: yes — neither the registry's running sub-agents nor the bridge's tasks reached the stop route)
test("a real Filament reads its running sub-agents and its coding agents' tasks at an idle-only stop, and stops once they end", async () => {
  const held = gate();
  const up = await fakeUpstream(async (/** @type {any} */ req) => {
    const last = req.body?.messages?.at(-1);
    const text = typeof last?.content === "string" ? last.content : (last?.content || []).map((/** @type {any} */ b) => b?.text || "").join("");
    if (/audit slowly/.test(text)) await held.promise;
    return anthropicReply("DONE", { model: "m-1" });
  });
  const folder = mkdtempSync(join(tmpdir(), "filament-idle-cwd-"));
  let exited = false;
  const shim = await startApp({
    memory: true,
    keep: true,
    onShutdown: () => (exited = true),
    configure: (cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
      cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
      cfg.memory.autopilot = { enabled: false };
    },
  });
  const stop = async () => {
    const r = await shim.api("/api/shutdown", { method: "POST", body: { ifIdle: true } });
    return { status: r.status, body: await r.json() };
  };
  try {
    // Claude's background agent, as its bridge reports it, after the turn that started it ended.
    const acp = /** @type {any} */ (shim.app).acp;
    acp.onTasks({ chain: "chat-1", sessionId: "s-1", tasks: [task("local_agent")] });
    assert.deepEqual(await stop(), { status: 409, body: { ok: false, inflight: 0, turns: 0, chats: [], compacting: 0, subagents: 0, agentTasks: 1, note: "not stopped: 1 coding-agent task working" } });
    // Its agent ended; a shell of Claude's still serves.
    acp.onTasks({ chain: "chat-1", sessionId: "s-1", tasks: [task("local_bash")] });

    // A sub-agent of Filament's at work.
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1" } });
    assert.equal(made.status, 200, await made.clone().text());
    const id = String((await made.json()).id);
    const launched = await shim.api(`/api/sessions/${id}/subagents`, { method: "POST", body: { prompt: "audit slowly", description: "Slow audit" } });
    assert.equal(launched.status, 200, await launched.clone().text());
    await until(() => up.received.some((/** @type {any} */ c) => JSON.stringify(c.body?.messages || []).includes("audit slowly")), "the sub-agent's call");
    const busy = await stop();
    assert.equal(busy.status, 409);
    assert.equal(busy.body.subagents, 1);
    assert.equal(busy.body.agentTasks, 0, "a shell is not waited for");
    assert.match(busy.body.note, /1 sub-agent working/);
    assert.equal(exited, false);

    held.open();
    await until(async () => (await (await shim.api(`/api/sessions/${id}/subagents`)).json()).subagents.every((/** @type {any} */ s) => s.status !== "running"), "the sub-agent to finish");
    // Once nothing works, the same call stops Filament (anything brief still settling answers 409 first).
    await until(async () => (await stop()).status === 200, "the stop to be taken");
    await until(() => exited, "Filament to stop");
  } finally {
    held.open();
    if (!exited) await shim.stop();
    delete process.env.FILAMENT_MEMORY_SIDECAR;
    await up.close();
    await removeDirs(shim.dataDir, folder);
  }
});
