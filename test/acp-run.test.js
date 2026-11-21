// @ts-check
// HarnessV3-ACP AC1 through the app and a fake agent in Claude's shape (fixtures/fake-acp-agent.mjs, FAKE_ACP_CLAUDE):
// a coding agent's turn in the harness is a run the page draws as it draws the loop's — rounds, cards, a plan, a
// sub-agent, a snapshot, the agent's words a block per round, the archive's copy the loop's — and Stop and Force stop
// reach the agent. An outside client's reply keeps its text. Cursor's SDK (fixtures/fake-cursor-sdk.mjs) shares the
// turn's code. The translator on its own is in agent-run-parts.test.js.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startApp, parseSse } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-acp-agent.mjs");
const FAKE_SDK = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-cursor-sdk.mjs")).href;

/** A reply's content blocks, rebuilt from its stream, as `[type, words]`. @param {{ event?: string | null, data: any }[]} frames */
const blocksOf = (frames) => {
  /** @type {[string, string][]} */
  const blocks = [];
  for (const { data } of frames) {
    if (data?.type === "content_block_start") blocks[data.index] = [data.content_block.type, data.content_block.text || data.content_block.thinking || ""];
    else if (data?.type === "content_block_delta") blocks[data.index][1] += data.delta.text ?? data.delta.thinking ?? "";
  }
  return blocks;
};

describe("a coding agent's turn as a run (HarnessV3-ACP AC1)", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-acp-run-"));
  const projDir = join(root, "project");
  const logs = { claude: join(root, "claude-prompts.jsonl"), slow: join(root, "slow-prompts.jsonl"), slowCalls: join(root, "slow-calls.jsonl"), sdk: join(root, "sdk.jsonl"), deafstuck: join(root, "deafstuck-prompts.jsonl"), deafslow: join(root, "deafslow-prompts.jsonl") };
  /** The fake agent's gates for a turn it will not end: `off`, `~deaf` is no trigger any more; `end`, the deaf turn ends cancelled. */
  const gates = { off: join(root, "deaf-off"), end: join(root, "deaf-end"), unsaved: join(root, "close-unsaved") };
  before(async () => {
    mkdirSync(projDir);
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: projDir, stdio: "ignore" });
    git("init", "-q");
    git("add", ".");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init");
    /** @param {Record<string, string>} env */
    const acp = (env) => ({ command: process.execPath, args: [FAKE], env: { FAKE_ACP_CLAUDE: "1", ...env }, cwdDefault: projDir, permissions: "allow-all", hints: false });
    process.env.FAKE_SDK_LOG = logs.sdk;
    shim = await startApp({
      memory: true,
      overrides: { cursorSdkLoader: () => import(FAKE_SDK) },
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "claude", name: "claude", type: "acp", acp: acp({ FAKE_ACP_LOG: logs.claude }) },
          // Claude as an agent that resumes a session in a process of its own (`session/resume`).
          { id: "claudeback", name: "claudeback", type: "acp", acp: acp({ FAKE_ACP_SESSION_CAPS: "resume" }) },
          // Claude for the turns that price runs: its sessions' first counts are its own, out of the agent's share
          // Filament fits over `claude`'s starts in this folder (token-calib.js `ownFit`).
          { id: "claudecost", name: "claudecost", type: "acp", acp: acp({}) },
          // Claude as an agent that closes a session a harness chat left idle an hour, and resumes it (`session/close`,
          // `session/resume`).
          { id: "claudeidle", name: "claudeidle", type: "acp", acp: { ...acp({ FAKE_ACP_SESSION_CAPS: "resume,close" }), sessionIdleMinutes: 60 } },
          // The same, whose close saves nothing while its gate is there (Claude Code killed before it wrote its totals).
          { id: "claudeunsaved", name: "claudeunsaved", type: "acp", acp: { ...acp({ FAKE_ACP_SESSION_CAPS: "resume,close", FAKE_ACP_UNSAVED: gates.unsaved }), sessionIdleMinutes: 60 } },
          { id: "slow", name: "slow", type: "acp", acp: acp({ FAKE_ACP_LOG: logs.slow, FAKE_ACP_CALLS: logs.slowCalls, FAKE_ACP_SLOW_NEW_MS: "1500" }) },
          { id: "cursor", name: "cursor", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: projDir, permissions: "allow-all", hints: false } },
          { id: "cursorslow", name: "cursorslow", type: "cursor-sdk", apiKey: "ck-slow-me", acp: { cwdDefault: projDir, permissions: "allow-all", hints: false } },
          // A turn the agent will not end (`~deaf`): one never ends it, one ends it late, at its gate.
          { id: "deafstuck", name: "deafstuck", type: "acp", acp: acp({ FAKE_ACP_LOG: logs.deafstuck, FAKE_ACP_DEAF_OFF: gates.off }) },
          { id: "deafslow", name: "deafslow", type: "acp", acp: acp({ FAKE_ACP_LOG: logs.deafslow, FAKE_ACP_DEAF_END: gates.end }) },
          { id: "keep2", name: "keep2", type: "acp", acp: { ...acp({}), rawMessages: 2 } },
          { id: "keep0", name: "keep0", type: "acp", acp: { ...acp({}), rawMessages: 0 } },
          { id: "keepnull", name: "keepnull", type: "acp", acp: { ...acp({}), rawMessages: null } },
          { id: "keepneg", name: "keepneg", type: "acp", acp: { ...acp({}), rawMessages: -1 } },
          { id: "cmds", name: "Commands (agent via ACP)", type: "acp", acp: acp({ FAKE_ACP_SESSION_COMMANDS: "1" }) },
          { id: "textual", name: "textual", type: "acp", acp: { ...acp({}), thoughts: "text" } },
          { id: "hinted", name: "hinted", type: "acp", acp: { ...acp({}), hints: true } },
          // Cursor's ACP server: none of Claude's marks.
          { id: "cursoracp", name: "cursoracp", type: "acp", acp: { command: process.execPath, args: [FAKE], env: {}, cwdDefault: projDir, permissions: "allow-all", hints: false } },
        ];
        cfg.routes = [
          { match: "claude/*", upstream: "claude", upstreamModel: "{1}", enabled: true },
          { match: "claudeback/*", upstream: "claudeback", upstreamModel: "{1}", enabled: true },
          { match: "claudecost/*", upstream: "claudecost", upstreamModel: "{1}", enabled: true },
          { match: "claudeidle/*", upstream: "claudeidle", upstreamModel: "{1}", enabled: true },
          { match: "claudeunsaved/*", upstream: "claudeunsaved", upstreamModel: "{1}", enabled: true },
          { match: "slow/*", upstream: "slow", upstreamModel: "{1}", enabled: true },
          { match: "cursor/*", upstream: "cursor", upstreamModel: "{1}", enabled: true },
          { match: "cursorslow/*", upstream: "cursorslow", upstreamModel: "{1}", enabled: true },
          { match: "deafstuck/*", upstream: "deafstuck", upstreamModel: "{1}", enabled: true },
          { match: "deafslow/*", upstream: "deafslow", upstreamModel: "{1}", enabled: true },
          { match: "keep2/*", upstream: "keep2", upstreamModel: "{1}", enabled: true },
          { match: "keep0/*", upstream: "keep0", upstreamModel: "{1}", enabled: true },
          { match: "keepnull/*", upstream: "keepnull", upstreamModel: "{1}", enabled: true },
          { match: "keepneg/*", upstream: "keepneg", upstreamModel: "{1}", enabled: true },
          { match: "cmds/*", upstream: "cmds", upstreamModel: "{1}", enabled: true },
          { match: "textual/*", upstream: "textual", upstreamModel: "{1}", enabled: true },
          { match: "hinted/*", upstream: "hinted", upstreamModel: "{1}", enabled: true },
          { match: "cursoracp/*", upstream: "cursoracp", upstreamModel: "{1}", enabled: true },
        ];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    delete process.env.FAKE_SDK_LOG;
    await removeDirs(root);
  });
  /** A harness session on a model. @param {string} model */
  const session = async (model) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model, preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** A harness turn, as the page sends one. @param {string} id @param {string} content */
  const turn = (id, content) => shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: true, runEvents: true } });
  /** @param {string} runId */
  const runEvents = async (runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events;
  /** @param {string} runId @param {Record<string, unknown>} body */
  const steer = (runId, body) => shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body });
  /** The turn's record, once its run's account is on it. @param {string} id */
  const recordOf = (id) =>
    until(async () => {
      const rec = await shim.record(id);
      return rec?.acp?.run ? rec : null;
    }, `${id}'s record`);
  /** The session's stop, as a page with no run id in hand sends it. @param {string} id @param {Record<string, unknown>} [b] */
  const stopSession = async (id, b) => (await shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST", ...(b ? { body: b } : {}) })).json();
  /** Who holds the session's turn. @param {string} id */
  const holderOf = (id) => /** @type {any} */ (shim.app).sessionTurns.holder(/** @type {any} */ (shim.app).memory.archive.getChain(id).key);
  /** The agent session a harness chat runs in, as the bridge keeps it. @param {string} id */
  const convOf = (id) => [.../** @type {any} */ (shim.app).acp.convs.values()].find((/** @type {any} */ c) => c.chain === id);
  /** A JSONL log the fake agent keeps: the prompts it was sent, or its session methods. @param {string} file @returns {any[]} */
  const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

  // (fails before: yes — an agent's turn had no run: its reply carried no run events and its tools were ⚙ lines in
  // the text)
  test("the run: rounds, cards, a plan, a sub-agent and a snapshot; the words a block per round; archived as the loop's", async () => {
    const id = await session("claude/haiku");
    const res = await turn(id, "~work on the readme");
    assert.equal(res.status, 200);
    assert.deepEqual([res.headers.get("x-filament-run-events"), res.headers.get("x-filament-run")], ["1", "1"]);
    const runId = String(res.headers.get("x-filament-request-id"));
    const frames = parseSse(await res.text());
    const evs = frames.filter((f) => f.event === "filament_run").map((f) => f.data.event);
    assert.deepEqual(evs, await runEvents(runId), "the reply carries the run's own log");
    const [start, end] = [evs[0], evs.at(-1)];
    assert.deepEqual(
      [start.type, start.kind, start.meta.engine, start.meta.upstream, start.meta.model, start.meta.root, end.type, end.status],
      ["run-start", "coding-agent", "acp", "claude", "haiku", projDir, "run-end", "done"],
    );
    const of = (/** @type {string} */ type) => evs.filter((e) => e.type === type);
    assert.deepEqual(of("round-start").map((e) => [e.round, e.blocksBefore]), [[1, 0], [2, 2], [3, 3], [4, 3], [5, 3]], "a round per model call; the reply's blocks before each");
    assert.deepEqual(of("tool-start").map((e) => [e.round, e.name, e.id]), [[1, "Read", "w_r1"], [2, "Edit", "w_e1"], [3, "Bash", "w_b1"], [4, "agent", "sa:task_1"]]);
    assert.deepEqual(of("tool-end").map((e) => [e.id, e.ok]), [["w_r1", true], ["w_e1", true], ["w_b1", true], ["sa:task_1", true]]);
    // (fails before: yes — the review of 46a624ab4: a sub-agent's run read a write by its loop's tool names alone, so
    // Claude's Edit and Bash, and a write through an MCP server's tool, changed nothing it knew of)
    assert.deepEqual(of("tool-end").map((e) => [e.id, e.writes === true]), [["w_r1", false], ["w_e1", true], ["w_b1", true], ["sa:task_1", false]], "its end says it writes");
    assert.deepEqual(
      of("plan").map((e) => [e.round, e.items.map((/** @type {any} */ i) => `${i.status}:${i.text}`)]),
      [[1, ["doing:Read the readme", "pending:Edit it"]], [2, ["done:Read the readme", "doing:Edit it"]]],
      "the turn's plan; the sub-agent's is its own",
    );
    // Its words ride the run as it writes them, on a timer of their own (E15 step 5, AG-154): read apart from the order.
    const sub = evs.filter((e) => e.type.startsWith("subagent-") && e.type !== "subagent-words");
    assert.deepEqual(sub.map((e) => [e.type, e.parent]), [["subagent-start", "sa:task_1"], ["subagent-tool-start", "sa:task_1"], ["subagent-tool-end", "sa:task_1"], ["subagent-plan", "sa:task_1"], ["subagent-end", "sa:task_1"]]);
    // (fails before: yes — a sub-agent's words reached the run at its end alone, as its report)
    assert.deepEqual(of("subagent-words").map((e) => [e.parent, e.text]), [["sa:task_1", "Searching."], ["sa:task_1", "Found one TODO in src/a.js."]], "its words, a message at a time");
    // (fails before: yes — the session's list answered Filament's own agents alone: a coding agent's own was a card in
    // the chat and nothing else)
    const listed = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json();
    assert.deepEqual(
      listed.own.map((/** @type {any} */ g) => [g.id, g.guest, g.of, g.description, g.prompt, g.status, g.toolCalls, g.report]),
      [[`${runId}~sa:task_1`, true, start.meta.agent, "Look for TODOs", "Find the TODOs in src", "done", 1, "Found one TODO in src/a.js."]],
      "its own agent is a row of the session's list, read from the turn's run (E15 step 5, AG-151)",
    );
    assert.ok(start.meta.agent, "the run names whose it is");
    assert.deepEqual([listed.subagents, listed.limit.running], [[], 0], "it is none of Filament's agents, and counts toward no limit (AG-156)");
    assert.deepEqual([sub[1].name, sub.at(-1).report], ["Grep", "Found one TODO in src/a.js."]);
    assert.deepEqual(sub[3].items, [{ text: "Search src", status: "done" }], "the sub-agent's plan, on its card (AC3-4)");
    // (fails before: no — a guard the mutation pass asked for: what the sub-agent was asked was never looked at)
    assert.deepEqual([sub[0].description, sub[0].prompt], ["Look for TODOs", "Find the TODOs in src"], "its name; what it was asked, Claude's `task`");
    assert.deepEqual(of("snapshot").map((e) => e.round), [2], "the round that edited; the command changed nothing");
    // (fails before: yes — HarnessV4_Git_Plan GWC-9: the round named no file, its changes were the folder's whole diff)
    assert.deepEqual(of("snapshot").map((e) => [e.agent, e.own, e.command, e.base]), [["", ["README.md"], false, "last"]], "the file its edit's call named");
    const changes = await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/changes`)).json();
    assert.deepEqual(changes.totals, { files: 1, added: 1, removed: 0 }, JSON.stringify(changes));
    // The reply: the agent's words, a block per round, its thought a thinking block; the cards draw the rest.
    const blocks = blocksOf(frames.filter((f) => f.event !== "filament_run"));
    assert.deepEqual(blocks, [["thinking", "Plan first."], ["text", "Reading the readme."], ["text", "Editing it."], ["text", "Done: README.md edited."]]);
    const rec = await recordOf(runId);
    const { status, rounds, tools, subagents, snapshots } = rec.acp.run;
    assert.deepEqual({ status, rounds, tools, subagents, snapshots }, { status: "done", rounds: 5, tools: 3, subagents: 1, snapshots: 1 });
    // Archived as the loop archives its turns: the calls with the results the model read, the closing words apart.
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript?work=1`)).json();
    const t = tr.turns.at(-1);
    const parts = t.work.flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content : []));
    assert.deepEqual(parts.filter((/** @type {any} */ b) => b.type === "tool_use").map((/** @type {any} */ b) => b.name), ["Read", "Edit", "Bash", "Task"]);
    assert.deepEqual(parts.filter((/** @type {any} */ b) => b.type === "tool_result").map((/** @type {any} */ b) => b.tool_use_id), ["w_r1", "w_e1", "w_b1", "w_task"]);
    assert.deepEqual(t.final.content, [{ type: "text", text: "Done: README.md edited." }]);
    assert.ok(!JSON.stringify(t).includes("⚙"), "no tool lines in the archive's copy");
  });

  // (fails before: yes — an agent's writing turn in a folder holding work not committed yet counted that work as its
  // own: the turn's card and the header's +N −N listed a file the agent never touched)
  test("an agent's changes start where the folder stood as its turn began: work not committed yet is not the agent's", async () => {
    writeFileSync(join(projDir, "mine.txt"), "the developer's, not committed\n");
    const id = await session("claude/haiku");
    const res = await turn(id, "~work on the readme");
    const runId = String(res.headers.get("x-filament-request-id"));
    await res.text();
    const changes = await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/changes`)).json();
    assert.deepEqual(changes.whole.files.map((/** @type {any} */ f) => [f.path, f.added, f.removed]), [["README.md", 1, 0]], JSON.stringify(changes));
    const rec = await recordOf(runId);
    const t = await (await shim.api(`/api/memory/sessions/${encodeURIComponent(rec.memory.chain)}/changes?turn=${rec.memory.turn}`)).json();
    assert.deepEqual(t.files.map((/** @type {any} */ f) => [f.path, f.added, f.removed]), [["README.md", 1, 0]], JSON.stringify(t));
  });

  // (fails before: no — a guard the mutation pass asked for: no sub-agent had one of its own, so a session two launches
  // deep was never traced back to its turn)
  test("a sub-agent's own sub-agent reaches the turn that launched the first: a call on its card, its calls too", async () => {
    const res = await turn(await session("claude/haiku"), "~nested please");
    const runId = String(res.headers.get("x-filament-request-id"));
    await res.text();
    const evs = await runEvents(runId);
    const on = (/** @type {string} */ type) => evs.filter((/** @type {any} */ e) => e.type === type).map((/** @type {any} */ e) => [e.parent, e.id, e.ok ?? null]);
    assert.deepEqual(on("subagent-tool-start"), [["sa:task_o", "sa:task_i", null], ["sa:task_o", "n_r1", null]]);
    assert.deepEqual(on("subagent-tool-end"), [["sa:task_o", "n_r1", true], ["sa:task_o", "sa:task_i", true]]);
  });

  // (fails before: yes — claude-agent-acp 0.93 announces a sub-agent in ACP's sub-agents RFD, `subagent_update`, which
  // Filament did not read: the sub-agent's own session reached no turn, and its calls, words and questions were nobody's
  // — seen live 10-17, the day the adapter came)
  test("a sub-agent as Claude's adapter says one from 0.93 (ACP's sub-agents RFD) reaches its card: its calls, its words, its end", async () => {
    const res = await turn(await session("claude/haiku"), "~rfdsub please");
    const runId = String(res.headers.get("x-filament-request-id"));
    const frames = parseSse(await res.text());
    const evs = await runEvents(runId);
    const of = (/** @type {string} */ type) => evs.filter((/** @type {any} */ e) => e.type === type);
    assert.deepEqual(evs.filter((/** @type {any} */ e) => /^(tool|subagent)-/.test(e.type) && e.type !== "subagent-words").map((/** @type {any} */ e) => [e.type, e.id ?? e.parent]), [
      ["tool-start", "r_task"],
      ["subagent-start", "r_task"],
      ["subagent-tool-start", "r_g1"],
      ["subagent-tool-end", "r_g1"],
      ["subagent-end", "r_task"],
      ["tool-end", "r_task"],
    ], "one card, the launch's: its own calls on it");
    assert.deepEqual(of("subagent-start").map((/** @type {any} */ e) => [e.description, e.agent, e.prompt]), [["Look for TODOs", "Explore", "Find the TODOs in src"]], "its name, its agent's type, what it was asked");
    assert.deepEqual(of("subagent-words").map((/** @type {any} */ e) => [e.parent, e.text]), [["r_task", "Searching."], ["r_task", "Found one TODO in src/a.js."]]);
    assert.deepEqual(of("subagent-end").map((/** @type {any} */ e) => [e.status, e.ok, e.report]), [["done", true, "Found one TODO in src/a.js."]]);
    assert.deepEqual(blocksOf(frames.filter((f) => f.event !== "filament_run")), [["text", "Done: one TODO."]]);
    const rec = await recordOf(runId);
    assert.ok(!rec.changes.some((/** @type {string} */ c) => /subagent_update|session_message|background task/.test(c)), `all of it read, and no task left to answer: ${rec.changes.join(" | ")}`);
  });

  // (fails before: yes — HarnessV4_Tasks E6: a sub-agent Claude ran in the background worked on after its turn, and
  // nothing but Claude, or a stop of the chat's whole agent, ended it)
  test("a sub-agent working on after its turn is listed with its Stop, which stops it alone; one Filament cannot stop says why", async () => {
    const id = await session("claude/haiku");
    const res = await turn(id, "~rfdsub-bg please");
    assert.equal(res.status, 200);
    await res.text();
    const tasksOf = async () => /** @type {any[]} */ ((await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json()).agentTasks || []);
    const listed = /** @type {any[]} */ (await until(async () => {
      const t = await tasksOf();
      return t.length ? t : null;
    }, "the background sub-agent listed"));
    assert.deepEqual(listed.map((t) => [t.id, t.kind, t.background, t.stop]), [["a7f00d", "local_agent", true, true]], "its row says Filament can stop it");
    const none = await shim.api(`/api/sessions/${encodeURIComponent(id)}/agent-tasks/nope/stop`, { method: "POST" });
    assert.equal(none.status, 409);
    assert.equal((await none.json()).error, "not stopped: no such task runs in this chat now");
    const proc = convOf(id)?.procKey;
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/agent-tasks/a7f00d/stop`, { method: "POST" });
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual(await r.json(), { ok: true });
    await until(async () => ((await tasksOf()).length === 0 ? true : null), "the stopped sub-agent's row gone, as its agent said it ended");
    assert.equal(convOf(id)?.procKey, proc, "the agent goes on: the same process holds the chat");
    const next = await turn(id, "hello again");
    assert.equal(next.status, 200);
    assert.match(blocksOf(parseSse(await next.text()).filter((f) => f.event !== "filament_run")).map(([, w]) => w).join(""), /hello again/, "and takes the next turn");
  });

  // (fails before: no — a guard the mutation pass asked for: the fake agent never surfaced a call before its own
  // message)
  test("Claude's call surfaced before its own message waits for it, and lands in its model call's round", async () => {
    const res = await turn(await session("claude/haiku"), "~early please");
    const runId = String(res.headers.get("x-filament-request-id"));
    await res.text();
    const evs = await runEvents(runId);
    assert.deepEqual(evs.filter((/** @type {any} */ e) => e.type === "round-start").map((/** @type {any} */ e) => e.round), [1, 2, 3]);
    assert.deepEqual(evs.filter((/** @type {any} */ e) => e.type === "tool-start").map((/** @type {any} */ e) => [e.round, e.name, e.id]), [[2, "Bash", "e_b1"]]);
  });

  // (fails before: yes — the sub-agent's card ended when its call came back, the launch's placeholder its report, and
  // Claude's answer to its task, which came after the prompt settled, reached no one)
  test("Claude's sub-agent launched in the background: its card runs to its task's end, and Claude's answer is the turn's", async () => {
    const res = await turn(await session("claude/haiku"), "~background please");
    const runId = String(res.headers.get("x-filament-request-id"));
    const frames = parseSse(await res.text());
    const evs = await runEvents(runId);
    assert.deepEqual(evs.filter((/** @type {any} */ e) => /^(tool|subagent)-/.test(e.type)).map((/** @type {any} */ e) => [e.type, e.id ?? e.parent]), [
      ["tool-start", "b_task"],
      ["subagent-start", "b_task"],
      ["subagent-tool-start", "b_g1"],
      ["subagent-tool-end", "b_g1"],
      ["subagent-words", "b_task"],
      ["subagent-end", "b_task"],
      ["tool-end", "b_task"],
    ]);
    assert.equal(evs.find((/** @type {any} */ e) => e.type === "subagent-end").report, "README.md says hello.");
    assert.ok(!JSON.stringify(evs).includes("internal metadata"), "the launch's placeholder is never drawn");
    const blocks = blocksOf(frames.filter((f) => f.event !== "filament_run"));
    assert.deepEqual(blocks.map(([, words]) => words), ["Launching a sub-agent.", "It runs in the background; I will answer when it reports.", "The sub-agent found it: README.md says hello."]);
    const rec = await recordOf(runId);
    assert.ok(!rec.changes.some((/** @type {string} */ c) => /background task/.test(c)), rec.changes.join(" | "));
  });

  // (fails before: no — a guard the mutation pass asked for: Claude here always answered its background task at once,
  // and no turn was stopped while it waited for that answer, so an answer that never came, one Claude took a while to
  // begin saying, and a stop during the wait all went unseen)
  test("Claude's answer to a background task: never begun, the turn says so; slow, the turn waits; a stop ends the wait", async () => {
    /** A `~background` turn's words, and its record. @param {string} words */
    const answered = async (words) => {
      const res = await turn(await session("claude/haiku"), words);
      const runId = String(res.headers.get("x-filament-request-id"));
      const said = blocksOf(parseSse(await res.text()).filter((f) => f.event !== "filament_run")).map(([, w]) => w);
      return { said, rec: await recordOf(runId) };
    };
    const idle = await answered("~background-idle please");
    assert.equal(idle.said.at(-1), "It runs in the background; I will answer when it reports.");
    assert.ok(idle.rec.changes.includes("acp: Claude went idle without answering a background task that ended during the turn; the turn ended without its answer, which comes as a turn of its own when Claude gives it"), idle.rec.changes.join(" | "));
    // Claude says it is working, so the turn waits past its idle limit for words that take Claude 4 s to begin.
    const slow = await answered("~background-slow please");
    assert.equal(slow.said.at(-1), "The sub-agent found it: README.md says hello.");
    assert.ok(!slow.rec.changes.some((/** @type {string} */ c) => /background task/.test(c)), slow.rec.changes.join(" | "));
    const res = await turn(await session("claude/haiku"), "~background-stuck please");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await until(async () => (await runEvents(runId)).some((/** @type {any} */ e) => e.type === "tool-end" && e.id === "b_r1"), "Claude's answer to begin");
    assert.equal((await steer(runId, { kind: "stop", text: "", from: "harness" })).status, 200);
    assert.match(String(blocksOf(parseSse(await body)).at(-1)?.[1]), /^\(Filament: the developer stopped this turn after \d+ tool calls?; what was finished is above\.\)$/);
    const evs = await runEvents(runId);
    assert.deepEqual(evs.filter((/** @type {any} */ e) => ["notice", "run-end"].includes(e.type)).map((/** @type {any} */ e) => e.kind || e.status), ["stop", "stopped"]);
    const rec = await recordOf(runId);
    assert.deepEqual([rec.acp.run.status, rec.acp.run.stoppedBy], ["stopped", "harness"]);
  });

  // (fails before: yes — Claude's answer to a background task is a cycle of its own, whose spend Claude's adapter leaves
  // out of every prompt's answer, and the turn read its prompts' answers and its own cycles alone: 100/10/1000/0, finished
  // or failed)
  test("Claude's answer to a background task inside a turn counts in the turn's spend, the turn finished or failed after it", async () => {
    /** A turn of `words`: how it ended, and what its record says it spent. @param {string} words */
    const spentBy = async (words) => {
      const res = await turn(await session("claude/haiku"), words);
      const runId = String(res.headers.get("x-filament-request-id"));
      await res.text();
      const rec = await recordOf(runId);
      const { input, output, cacheRead, cacheWrite } = rec.tokens;
      return [rec.status, { input, output, cacheRead, cacheWrite }];
    };
    const both = { input: 400, output: 40, cacheRead: 3000, cacheWrite: 50 };
    assert.deepEqual(await spentBy("~background-spent please"), ["ok", both], "the turn's cycle and Claude's answer");
    assert.deepEqual(await spentBy("~background-spentfail please"), ["error", both], "so, the prompt failing once the answer ended");
  });

  /**
   * A turn of `words` whose Claude answers its background task taking in words Filament sends meanwhile: what it said
   * last, how it ended, and what its record says it spent.
   * @param {string} words
   */
  const folded = async (words) => {
    const res = await turn(await session("claude/haiku"), words);
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await until(async () => (await runEvents(runId)).some((/** @type {any} */ e) => e.type === "tool-start" && e.id === "b_r1"), "Claude's answer to begin");
    // Filament's own words go at once; the developer's would wait for the agent's next call (HarnessV4_Tasks C34).
    assert.equal((await steer(runId, { kind: "note", text: "and check the docs", from: "filament" })).status, 200);
    const said = blocksOf(parseSse(await body).filter((f) => f.event !== "filament_run")).map(([, w]) => w);
    const rec = await recordOf(runId);
    const { input, output, cacheRead, cacheWrite } = rec.tokens;
    return [said.at(-1), rec.status, { input, output, cacheRead, cacheWrite }];
  };

  // (fails before: no — a guard for the count above: Claude's answer to a background task that took in a message sent
  // meanwhile is that message's answer too, which says what it spent; counted again, the turn said 700/70/5000/100)
  test("Claude's answer to a background task that took in a message sent meanwhile counts once: the message's answer says it", async () => {
    assert.deepEqual(await folded("~background-fold please"), ["heard:and check the docs", "ok", { input: 400, output: 40, cacheRead: 3000, cacheWrite: 50 }]);
  });

  // (fails before: yes — the message's answer failed, so nothing said what that answer spent: 100/10/1000/0, the turn's
  // own cycle alone)
  test("Claude's answer to a background task that took in a message sent meanwhile counts where that message's answer fails", async () => {
    const [, status, spent] = await folded("~background-foldfail please");
    assert.deepEqual([status, spent], ["error", { input: 400, output: 40, cacheRead: 3000, cacheWrite: 50 }]);
  });

  // (fails before: yes — once no clock cut a turn (HarnessV3-FailurePoints §4 B), Claude's process ending while the turn
  // waited for its answer to a background task left the turn waiting forever)
  test("Claude's process ends while the turn waits for its answer to a background task: the turn fails in the process's words", async () => {
    const id = await session("claude/haiku");
    const res = await turn(id, "~background-stuck please");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await until(async () => (await runEvents(runId)).some((/** @type {any} */ e) => e.type === "tool-end" && e.id === "b_r1"), "Claude's answer to begin");
    const acp = /** @type {any} */ (shim.app).acp;
    const conv = [...acp.convs.values()].find((/** @type {any} */ c) => c.chain === id);
    acp.procs.get(conv.procKey).child.kill();
    await body;
    const rec = await until(async () => {
      const x = await shim.record(runId);
      return x?.status === "error" ? x : null;
    }, "the failed turn's record");
    assert.match(String(rec.error), /agent process exited/);
    const evs = await runEvents(runId);
    assert.equal(evs.find((/** @type {any} */ e) => e.type === "run-end")?.status, "error");
  });

  // (fails before: yes — the harness's turn carried the hint that points a chat client at Filament's chat commands)
  // HarnessV3-ACP AC2-1.
  test("Claude compacting its own context: live, then its mark with its figures where it happened; not a call", async () => {
    const res = await turn(await session("claude/haiku"), "~compact");
    const runId = String(res.headers.get("x-filament-request-id"));
    const evs = parseSse(await res.text()).filter((f) => f.event === "filament_run").map((f) => f.data.event);
    const marks = evs.filter((/** @type {any} */ e) => ["round-start", "compacting", "compaction", "tool-start"].includes(e.type));
    assert.deepEqual(marks.map((/** @type {any} */ e) => [e.type, e.round]), [["round-start", 1], ["compacting", 1], ["compaction", 1], ["round-start", 2]], "the mark before the work that followed it");
    const { type, round, own, by, tokensBefore, tokensAfter, ms } = marks[2];
    assert.deepEqual({ type, round, own, by, tokensBefore, tokensAfter, ms }, { type: "compaction", round: 1, own: true, by: "claude", tokensBefore: 180000, tokensAfter: 31000, ms: 42000 });
    const rec = await recordOf(runId);
    assert.deepEqual([rec.acp.run.tools, rec.acp.tools], [0, []], "no call the model made");
    assert.ok([...(rec.priorChanges || []), ...(rec.changes || [])].includes("acp: the agent compacted its context during this turn"));
  });

  // (fails before: yes — HarnessV4_Tasks C21: Filament told the agent of no notices, so Claude's adapter wrote its model
  // fallback into its answer: the reply's words, kept in Filament's copy as the agent's)
  test("a notice Claude's adapter sends is the run's own line: none of the reply's words, nor of the turn kept", async () => {
    const id = await session("claude/haiku");
    const res = await turn(id, "~notice");
    assert.equal(res.status, 200);
    const frames = parseSse(await res.text());
    const evs = frames.filter((f) => f.event === "filament_run").map((f) => f.data.event);
    const notices = evs.filter((/** @type {any} */ e) => e.type === "agent-notice");
    assert.deepEqual(notices.map((/** @type {any} */ e) => [e.severity, e.title, e.description]), [["warning", "Model fallback", "claude-opus-5-5 was overloaded, so it went on with claude-sonnet-5-5 (as a notice)."]], "the agent was told Filament draws notices");
    const words = blocksOf(frames).filter(([t]) => t === "text").map(([, w]) => w).join("");
    assert.match(words, /Before\. After\./);
    assert.ok(!/Model fallback/.test(words), `none of the reply's words: ${words}`);
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    assert.ok(!/Model fallback/.test(JSON.stringify(tr.turns.at(-1)?.blocks || [])), "nor of the turn kept");
  });

  // (fails before: yes — the owner's report of 10-26: the Cache said the last turn's figure all through a running turn,
  // and after it the turn's whole sum as "the last request": 806K tokens at 75% from the cache)
  test("Claude's model calls as it works: each one's prompt is the run's `round-cache` once; the session's last request is its newest, not the turn's sum", async () => {
    const id = await session("claude/haiku");
    const res = await turn(id, "~cachecalls");
    const runId = String(res.headers.get("x-filament-request-id"));
    await res.text();
    const calls = (await runEvents(runId)).filter((/** @type {any} */ e) => e.type === "round-cache");
    assert.deepEqual(calls.map((/** @type {any} */ e) => [e.round, e.input, e.cacheRead, e.cacheWrite]), [[1, 3, 0, 20000], [2, 8, 20000, 400]], "a call's blocks repeat its usage: said once");
    const rec = await recordOf(runId);
    assert.deepEqual([rec.tokens.input, rec.tokens.cacheRead, rec.tokens.cacheWrite], [11, 20000, 20400], "the record keeps what the turn billed");
    assert.equal(rec._lastModelCall, undefined, "the newest call rides to the ledger alone, never to a client");
    const spend = /** @type {any} */ (shim.app).memory.archive.getChain(id).meta.spend;
    const { input, cacheRead, cacheWrite, usd } = spend.last;
    assert.deepEqual({ input, cacheRead, cacheWrite, usd }, { input: 8, cacheRead: 20000, cacheWrite: 400, usd: undefined }, "the last request is the turn's newest call");
    assert.deepEqual([spend.cacheReadTokens, spend.cacheWriteTokens], [20000, 20400], "the totals book the turn's sum");
  });

  // (fails before: yes — the review of b1f4c556b: the adapter's error carries no usage and Claude's result was read for
  // its own cycles alone, so the record kept 0 tokens and no price, and the session's spend booked none of it)
  test("a Claude turn that fails after its cycle's result said what it spent keeps it: its tokens, its price at the API's rates and the models that counted them, on its record and the session's spend", async () => {
    const id = await session("claude/haiku");
    const res = await turn(id, "~spentfail");
    const runId = String(res.headers.get("x-filament-request-id"));
    await res.text();
    const rec = await recordOf(runId);
    const { input, output, cacheRead, cacheWrite } = rec.tokens;
    assert.deepEqual([rec.status, { input, output, cacheRead, cacheWrite }, rec.listCost], ["error", { input: 600, output: 40, cacheRead: 2000, cacheWrite: 300 }, 0.0123]);
    assert.deepEqual(rec.acp.modelUsage, [{ model: "claude-haiku-5", input: 600, output: 40, cacheRead: 2000, cacheWrite: 300 }]);
    const spend = /** @type {any} */ (shim.app).memory.archive.getChain(id).meta.spend || {};
    assert.deepEqual([spend.inputTokens, spend.outputTokens, spend.cacheReadTokens, spend.cacheWriteTokens], [600, 40, 2000, 300]);
  });

  /** A turn of `words` on the session `id`, read to its end: its record. @param {string} id @param {string} words */
  const recordAfter = async (id, words) => {
    const res = await turn(id, words);
    const runId = String(res.headers.get("x-filament-request-id"));
    await res.text();
    return recordOf(runId);
  };

  // (fails before: yes — Claude's adapter says what its session's query has cost so far, and each turn booked that running
  // total whole: the second turn on one query booked 0.0618, both turns' cost)
  test("each turn of a Claude session books what its own run cost: the running total's growth, or the whole of a total begun again", async () => {
    const id = await session("claude/haiku");
    const booked = [];
    /** @type {boolean[]} */
    const reused = [];
    for (const words of ["~priced", "~priced", "~priced", "~cleared ~priced"]) {
      const rec = await recordAfter(id, words);
      booked.push(rec.listCost);
      reused.push(!!rec.acp.reused);
    }
    // A session's second turn may hand Claude Code its compaction line, in a session of its own here (this agent opens
    // none again); the third and fourth go on in one query.
    assert.deepEqual(reused.slice(2), [true, true]);
    assert.deepEqual(booked, [0.0309, 0.0309, 0.0309, 0.0309], "each new query's first figure, the total's growth, and a /clear's new total");
  });

  // (fails before: yes — a turn whose run crashed said its session had cost nothing, and that zeroed figure became the
  // one the next turn counted from: the next turn booked the session's whole running total, 0.1236)
  test("a Claude turn whose run crashed with its cost zeroed leaves the last real figure the next turn's start: its own tokens at the card, saying why, and the next turn its own run's", async () => {
    const id = await session("claudecost/claude-sonnet-5");
    /** @type {any[]} */
    const recs = [];
    for (const words of ["~priced", "~priced", "~priced", "~zeroed", "~priced"]) recs.push(await recordAfter(id, words));
    // A session's second turn may hand Claude Code its compaction line, in a session of its own here; the rest go on in
    // one query.
    assert.deepEqual([recs[2], recs[4]].map((r) => !!r.acp.reused), [true, true]);
    assert.deepEqual(recs.map((r) => r.listCost ?? null), [0.0309, 0.0309, 0.0309, 0, 0.0309], "the crashed turn's zeroed tokens at the card, and the next turn's own run");
    const said = recs[3].changes || [];
    assert.ok(said.some((/** @type {string} */ c) => /not known: it said its session had cost nothing/.test(c) && /priced from its tokens at the card/.test(c)), said.join("\n"));
  });

  // (fails before: yes — a query Claude's adapter restarted in a fresh context counts from nothing, and the turn booked
  // its first figure less the last of the query before: 0.0273 for a run that cost 0.12)
  test("a Claude turn whose query restarted in a fresh context books the new total's figure whole, higher or lower than the last of the query before, and the next turn its own run's", async () => {
    const id = await session("claudecost/claude-sonnet-5");
    /** @type {any[]} */
    const recs = [];
    for (const words of ["~ran", "~ran", "~ran", "~ran ~fresh ~dear", "~ran", "~ran ~fresh", "~ran"]) recs.push(await recordAfter(id, words));
    // A session's second turn may hand Claude Code its compaction line, in a session of its own here; the rest go on in
    // the one agent session, its query restarted under it twice.
    assert.deepEqual(recs.slice(2).map((r) => !!r.acp.reused), [true, true, true, true, true]);
    assert.deepEqual(recs.map((r) => r.listCost ?? null), [0.0309, 0.0309, 0.0309, 0.12, 0.0309, 0.0309, 0.0309], "each fresh total's first figure whole, and each run's own after");
  });

  // (fails before: yes — a turn whose query restarted in a fresh context partway, a plan accepted with one, booked the
  // fresh query's figure alone: 0.12 for a turn that spent 0.0309 in the query before the restart too)
  test("a Claude turn whose query restarted in a fresh context partway books what it spent in the query before it as well: that query's last total's growth, with the new total's figure", async () => {
    const id = await session("claudecost/claude-sonnet-5");
    /** @type {any[]} */
    const recs = [];
    for (const words of ["~ran", "~ran", "~ran", "~ran ~planfresh ~dear", "~ran"]) recs.push(await recordAfter(id, words));
    assert.deepEqual(recs.slice(2).map((r) => !!r.acp.reused), [true, true, true]);
    assert.deepEqual(recs.map((r) => r.listCost ?? null), [0.0309, 0.0309, 0.0309, 0.1509, 0.0309], "both queries' parts of the turn, and the next turn its own run's");
  });

  // (fails before: yes — a session opened again in a new agent process goes on from a running total Claude Code saved out
  // of Filament's sight, and its turn booked what the agent said whole: 0.0309 on either model)
  test("a Claude turn whose session opened again in a new agent process books its tokens at the price card, where its running total began is out of sight; with no card, its tokens alone, saying why", async () => {
    /**
     * Three turns of a session on `model`, its agent exiting on its own after the first, as one that crashed — what the
     * session's transcript saved is not known: what each booked, and the second's changes. @param {string} model
     */
    const across = async (model) => {
      const id = await session(model);
      const booked = [];
      /** @type {string[]} */
      let said = [];
      for (let i = 0; i < 3; i++) {
        if (i === 1) {
          const conv = convOf(id);
          /** @type {any} */ (shim.app).acp.procs.get(conv.procKey).child.kill();
          await until(() => (!conv.procKey ? conv : null), "the agent's process gone");
        }
        const rec = await recordAfter(id, "~priced");
        booked.push(rec.listCost ?? null);
        if (i === 1) said = rec.changes || [];
      }
      return { booked, said };
    };
    const priced = await across("claudeback/claude-sonnet-5");
    assert.deepEqual(priced.booked, [0.0309, 0.0055, 0.0309], "the reopened session's first turn at the card, then the total's growth again");
    assert.ok(priced.said.some((c) => /not known: its session opened again/.test(c) && /priced from its tokens at the card/.test(c)), priced.said.join("\n"));
    const unpriced = await across("claudeback/haiku");
    assert.deepEqual(unpriced.booked, [0.0309, null, 0.0309]);
    assert.ok(unpriced.said.some((c) => /no price card prices haiku/.test(c)), unpriced.said.join("\n"));
  });

  /** A record's tokens and the models that counted them. @param {any} rec */
  const spentOn = (rec) => {
    const { input, output, cacheRead, cacheWrite } = rec.tokens;
    return { tokens: { input, output, cacheRead, cacheWrite }, models: rec.acp.modelUsage };
  };
  /** What a `~ran ~sub` turn spent: its main loop's call and its sub-agent's, each under its model. */
  const RAN_WITH_SUB = {
    tokens: { input: 310, output: 106, cacheRead: 100, cacheWrite: 2000 },
    models: [
      { model: "claude-sonnet-5", input: 10, output: 46, cacheRead: 100, cacheWrite: 2000 },
      { model: "claude-haiku-4-5", input: 300, output: 60, cacheRead: 0, cacheWrite: 0 },
    ],
  };

  // (fails before: yes — Claude's adapter lists a resumed query's first cycle as its main loop's alone, and the turn kept
  // that: 10/46 tokens on claude-sonnet-5, its sub-agent's 300/60 on claude-haiku-4-5 counted nowhere)
  test("the first Claude turn of a session opened again in a new agent process counts its sub-agents' calls, each under its model: its agent ended, the totals its transcript saved are none", async () => {
    const id = await session("claudeback/claude-sonnet-5");
    await recordAfter(id, "~ran");
    /** @type {any} */ (shim.app).acp.letGo("claudeback");
    assert.deepEqual(spentOn(await recordAfter(id, "~ran ~sub")), RAN_WITH_SUB);
  });

  // (fails before: yes — the same: the turn after the session's close kept its main loop's 10/46 alone)
  test("the first Claude turn of a session its agent closed counts its sub-agents' calls from the totals that close saved, which the session's record keeps for a restart", async () => {
    const id = await session("claudeidle/claude-sonnet-5");
    await recordAfter(id, "~ran ~sub");
    const conv = convOf(id);
    // Idle past its hour, the chat rests: its agent closes the session, and Claude Code saves its totals as it exits.
    /** @type {any} */ (shim.app).acp.sweep(Date.now() + 61 * 60_000);
    await until(() => (conv.saved?.usage?.["claude-haiku-4-5"] ? conv : null), "the close to save the session's totals");
    const map = /** @type {any} */ (shim.app).acp.convs;
    map.flush();
    const kept = Object.values(JSON.parse(readFileSync(map.stateFile, "utf8")).conversations).find((/** @type {any} */ c) => c.sessionId === conv.sessionId);
    assert.deepEqual(kept?.saved, conv.saved, "kept on disk for a restart");
    assert.deepEqual(spentOn(await recordAfter(id, "~ran ~sub")), RAN_WITH_SUB);
  });

  // (fails before: yes — the turn after the close booked its tokens at the price card, 0.0055, its start said to be out
  // of sight, where the total that close saved was its start; so did the turn after Filament ended a new session's
  // agent, whose transcript had saved nothing)
  test("the first Claude turn of a session opened again from what its transcript saved books its own run's cost: the running total's growth since the one its agent's close saved, or since nothing for a session its agent never closed", async () => {
    const id = await session("claudeidle/claude-sonnet-5");
    const first = await recordAfter(id, "~ran");
    const conv = convOf(id);
    /** @type {any} */ (shim.app).acp.sweep(Date.now() + 61 * 60_000);
    await until(() => (conv.saved?.usage?.["claude-sonnet-5"] ? conv : null), "the close to save the session's totals");
    const after = await recordAfter(id, "~ran");
    assert.deepEqual([first.listCost, after.listCost], [0.0309, 0.0309]);
    assert.ok(!(after.changes || []).some((/** @type {string} */ c) => /cost is not known/.test(c)), (after.changes || []).join("\n"));
    // A new session's agent Filament ended, its tree with it: the session's transcript saved nothing.
    const made = await session("claudeback/claude-sonnet-5");
    await recordAfter(made, "~priced");
    /** @type {any} */ (shim.app).acp.letGo("claudeback");
    assert.equal((await recordAfter(made, "~priced")).listCost, 0.0309);
  });

  /** A harness chat's session rested, its agent closing it: once the close is answered. @param {string} id */
  const rested = async (id) => {
    const conv = convOf(id);
    const was = conv.saved;
    /** @type {any} */ (shim.app).acp.sweep(Date.now() + 61 * 60_000);
    await until(() => (conv.saved !== was && conv.saved?.usage?.["claude-sonnet-5"] ? conv : null), "the close to save the session's totals");
  };

  // (fails before: yes — a /clear as the first prompt of a session opened again from what its close saved, before any
  // result had named its run, left its turns counting from the total that close saved: 0.0891 for a run of 0.12)
  test("a Claude turn after a /clear books the new total's figure whole, even as the first prompt of a session opened again from what its close saved", async () => {
    const id = await session("claudeidle/claude-sonnet-5");
    const first = await recordAfter(id, "~ran");
    await rested(id);
    const cleared = await recordAfter(id, "~cleared ~ran ~dear");
    const next = await recordAfter(id, "~ran");
    assert.deepEqual([first.listCost, cleared.listCost, next.listCost], [0.0309, 0.12, 0.0309]);
    assert.deepEqual(spentOn(cleared).tokens, { input: 10, output: 46, cacheRead: 100, cacheWrite: 2000 });
  });

  // (fails before: yes — the turn after a close that saved nothing booked its resumed query's first figure whole,
  // 0.0618, and its rows the reading whole: the totals the transcript had saved before, 10/46/100/2000 more, with its own)
  test("a Claude turn whose session's close saved nothing books its own tokens at the price card, saying why: its resumed query's totals fell below what that close was to save, so where they began is not known", async () => {
    const id = await session("claudeunsaved/claude-sonnet-5");
    const booked = [];
    booked.push((await recordAfter(id, "~ran")).listCost);
    await rested(id);
    for (let i = 0; i < 2; i++) booked.push((await recordAfter(id, "~ran")).listCost);
    writeFileSync(gates.unsaved, "");
    try {
      await rested(id);
    } finally {
      rmSync(gates.unsaved, { force: true });
    }
    const rec = await recordAfter(id, "~ran");
    booked.push(rec.listCost);
    assert.deepEqual(booked, [0.0309, 0.0309, 0.0309, 0.0055]);
    assert.ok((rec.changes || []).some((/** @type {string} */ c) => /not known: .*below the one/.test(c) && /priced from its tokens at the card/.test(c)), (rec.changes || []).join("\n"));
    assert.deepEqual(spentOn(rec).tokens, { input: 10, output: 46, cacheRead: 100, cacheWrite: 2000 });
  });

  // (fails before: yes — Claude Code, ended with its agent as the close was answered, saved nothing, and the turn after
  // booked its fresh query's figure less the total that close was to save: 0.0891 for a run of 0.12)
  test("a Claude turn whose session's agent ended while Claude Code had its time to save its totals at a close books its tokens at the price card, saying why", async () => {
    const id = await session("claudeidle/claude-sonnet-5");
    await recordAfter(id, "~ran");
    await rested(id);
    // Its agent killed from the console at once, Claude Code's process with it.
    const acp = /** @type {any} */ (shim.app).acp;
    const [key, proc] = [...acp.procs].find(([k]) => k.startsWith("claudeidle|"));
    acp.killProcess(key);
    await until(() => proc.exited || null, "the agent's process gone");
    const rec = await recordAfter(id, "~ran ~dear");
    assert.equal(rec.listCost, 0.0055);
    assert.ok((rec.changes || []).some((/** @type {string} */ c) => /not known: its session opened again/.test(c)), (rec.changes || []).join("\n"));
  });

  // (fails before: yes — a failed turn's cycle, read from its raw result, counted its main loop's usage alone: 600/40 on
  // claude-sonnet-5, its sub-agent's 300/60 on claude-haiku-4-5 named nowhere)
  test("a Claude turn that fails after its cycle ran a sub-agent counts the sub-agent's calls beside its main loop's, each under its model", async () => {
    const rec = await recordAfter(await session("claudecost/claude-sonnet-5"), "~spentfail ~sub");
    assert.equal(rec.status, "error");
    assert.deepEqual(spentOn(rec), {
      tokens: { input: 900, output: 100, cacheRead: 2000, cacheWrite: 300 },
      models: [
        { model: "claude-sonnet-5", input: 600, output: 40, cacheRead: 2000, cacheWrite: 300 },
        { model: "claude-haiku-4-5", input: 300, output: 60, cacheRead: 0, cacheWrite: 0 },
      ],
    });
  });

  // (fails before: yes — the answer's `usage` is Claude's main loop alone, as Claude's SDK counts a result's, and the
  // record kept it: 100/20, its sub-agent's 300/60 named under its model and in no token of the turn's)
  test("a Claude turn whose sub-agent ran on a model of its own counts that sub-agent's tokens beside the main loop's, each under its model", async () => {
    const rec = await recordAfter(await session("claude/haiku"), "~subspent");
    const { input, output, cacheRead, cacheWrite } = rec.tokens;
    assert.deepEqual({ input, output, cacheRead, cacheWrite }, { input: 400, output: 80, cacheRead: 1000, cacheWrite: 0 }, "every model call's, the main loop's counted once");
    assert.deepEqual(rec.acp.modelUsage, [
      { model: "claude-haiku-5", input: 100, output: 20, cacheRead: 1000, cacheWrite: 0 },
      { model: "claude-haiku-4-5", input: 300, output: 60, cacheRead: 0, cacheWrite: 0 },
    ]);
  });

  // (fails before: yes — the result's `modelUsage` was read as the cycle's own, and Claude's SDK says the session's
  // running total there: the failed turn named the turn before it too, helper-model 300/60 and claude-sonnet-5 610/60)
  test("a Claude turn that fails names the models its own cycle counted, never the session's running total its result carries", async () => {
    const id = await session("claude/haiku");
    const first = await turn(id, "~counted claude-sonnet-5");
    await first.text();
    const res = await turn(id, "~spentfail");
    const runId = String(res.headers.get("x-filament-request-id"));
    await res.text();
    const rec = await recordOf(runId);
    assert.deepEqual([rec.status, rec.acp.reused], ["error", true], "the session's second turn");
    assert.deepEqual(rec.acp.modelUsage, [{ model: "claude-haiku-5", input: 600, output: 40, cacheRead: 2000, cacheWrite: 300 }]);
  });

  // (fails before: yes — the review of b1f4c556b: the failure's close kept no newest call, and Cursor said none of its
  // calls, so the session's last request was the turn's sum: Claude's 600/2000/300, Cursor's 700/500)
  test("a turn that fails after several model calls books its newest call as the session's last request, not the turn's sum: Claude's, by its messages, and Cursor's, by each call's end", async () => {
    /** The session's last request as its spend keeps it, once a turn of `content` on `model` failed. @param {string} model @param {string} content */
    const lastAfter = async (model, content) => {
      const id = await session(model);
      const res = await turn(id, content);
      const runId = String(res.headers.get("x-filament-request-id"));
      await res.text();
      const rec = await recordOf(runId);
      assert.equal(rec.status, "error");
      const { input, cacheRead, cacheWrite } = /** @type {any} */ (shim.app).memory.archive.getChain(id).meta.spend?.last || {};
      return { input, cacheRead, cacheWrite };
    };
    assert.deepEqual(await lastAfter("claude/haiku", "~spentfail"), { input: 400, cacheRead: 1100, cacheWrite: 0 }, "Claude's second call's prompt");
    assert.deepEqual(await lastAfter("cursor/composer-2.5", "~fail-spent"), { input: 400, cacheRead: 300, cacheWrite: 0 }, "Cursor's second call's prompt");
  });

  test("Claude's count as it works is the run's `held`; the record's context is the agent's, its window too, no verdict", async () => {
    const id = await session("claude/haiku");
    const res = await turn(id, "~compact");
    const runId = String(res.headers.get("x-filament-request-id"));
    await res.text();
    const held = (await runEvents(runId)).filter((/** @type {any} */ e) => e.type === "held");
    assert.deepEqual(held.map((/** @type {any} */ e) => [e.round, e.tokens, e.window, e.exact]), [[1, 31000, 200000, true]]);
    const rec = await recordOf(runId);
    const { window, source, usable, verdict, last } = rec.context;
    assert.deepEqual({ window, source, usable, verdict, last }, { window: 200000, source: "agent", usable: null, verdict: null, last: { held: 31000 } }, "what the meter shows once the turn ends");
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    const { point, ...said } = tr.turns.at(-1).facts?.context || {};
    // `own` (HarnessV4_Tasks C33): the agent's own share, its first count in a session new to it less what Filament sent.
    assert.deepEqual(said, { window: 200000, usable: null, verdict: null, source: "agent", held: 31000, own: 30993 }, "and after a reload");
    // The point its session makes room at by itself rides the record and the facts alike (HarnessV4_Tasks U3-2): the
    // line it was handed — 85% of the window, once an earlier turn here has named the window — else none yet.
    assert.deepEqual(point, rec.context.point);
    if (point) assert.deepEqual(point, { at: 170000, line: 170000 });
    // The page reads the session as the agent's whatever its model list carries: the server names the agent.
    const coder = async (/** @type {string} */ sid) => (await (await shim.api(`/api/sessions/${encodeURIComponent(sid)}/settings`)).json()).engine?.coder;
    assert.deepEqual([await coder(id), await coder(await session("nowhere/model"))], ["claude", null]);
  });

  // (fails before: no — a guard the mutation pass asked for: no agent's usage wrote to its cache without a count of its
  // context)
  test("an agent that counts no context: the record's figure is its turn's usage whole, the cache it wrote too, an estimate", async () => {
    const res = await turn(await session("claude/haiku"), "~cachewrite please");
    const runId = String(res.headers.get("x-filament-request-id"));
    await res.text();
    assert.deepEqual((await recordOf(runId)).context.last, { held: 2110, estimated: true });
  });

  test("the harness's turn carries no hint meant for a chat client, hints on or not", async () => {
    const out = await shim.post("/v1/messages", { model: "hinted/haiku@yolo", max_tokens: 400, messages: [{ role: "user", content: "hello there" }] });
    const told = (await out.json()).content.map((/** @type {any} */ b) => b.text || "").join("");
    assert.match(told, /_filament: mode @yolo is not one hinted has/, "an outside client's reply says it");
    const res = await turn(await session("hinted/haiku@yolo"), "hello there");
    const words = blocksOf(parseSse(await res.text()).filter((f) => f.event !== "filament_run")).map(([, w]) => w).join("\n");
    assert.ok(words.includes("hello there"), words);
    assert.ok(!words.includes("_filament:"), words);
    const rec = await recordOf(String(res.headers.get("x-filament-request-id")));
    assert.ok(rec.changes.some((/** @type {string} */ c) => /^acp: mode yolo not offered/.test(c)), "the record keeps it");
  });

  // (fails before: no — a guard the mutation pass asked for: every agent here left its thoughts on auto, which reads
  // the harness's turn as thinking blocks anyway)
  test("the harness reads an agent's thoughts as thinking blocks, whatever outside clients are given", async () => {
    const res = await turn(await session("textual/haiku"), "hello there");
    const blocks = blocksOf(parseSse(await res.text()).filter((f) => f.event !== "filament_run"));
    assert.deepEqual(blocks[0], ["thinking", "thinking about it"]);
  });

  // (fails before: no — a guard the mutation pass asked for: every agent here said something)
  test("an agent's turn that says nothing ends in the loop's words for it", async () => {
    const res = await turn(await session("claude/haiku"), "~mute");
    const blocks = blocksOf(parseSse(await res.text()).filter((f) => f.event !== "filament_run"));
    assert.deepEqual(blocks, [["text", "(Filament: the agent finished without saying anything)"]]);
  });

  // (fails before: yes — an agent's turn had no run: the stop's steer was refused, and the turn ran on)
  // (the note's part fails before: yes — the note was refused, 400: Claude took no words while it worked; then it was
  // queued at Claude, whose stop drops it, HarnessV3-FailurePoints §7.2; now it waits in Filament for Claude's next
  // call, HarnessV4_Tasks C34)
  test("Stop cancels the agent's turn, which ends in the stop's words; a note waiting for the agent's next call ends with it, unread, and goes as the next message", async () => {
    const id = await session("claude/haiku");
    const res = await turn(id, "hang on");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await until(async () => (await runEvents(runId)).some((/** @type {any} */ e) => e.type === "tool-end" && e.id === "t1"), "the read to end");
    assert.equal((await (await shim.api(`/api/runs/${encodeURIComponent(runId)}`)).json()).run.meta.steer, "queued", "the composer reads it off the run");
    const note = await steer(runId, { kind: "note", text: "also check the tests", from: "harness" });
    assert.equal(note.status, 200);
    const noteId = String((await note.json()).message.id);
    await until(async () => (await runEvents(runId)).some((/** @type {any} */ e) => e.type === "steer" && e.id === noteId), "the note to be queued");
    assert.equal((await steer(runId, { kind: "stop", text: "", from: "harness" })).status, 200);
    const blocks = blocksOf(parseSse(await body));
    assert.deepEqual(blocks.at(-1), ["text", "(Filament: the developer stopped this turn after 1 tool call; what was finished is above.)"]);
    assert.notEqual(blocks.at(-2)?.[1], "", "the stop's line is a block of its own");
    const evs = await runEvents(runId);
    assert.deepEqual(
      evs.filter((/** @type {any} */ e) => ["notice", "run-end"].includes(e.type)).map((/** @type {any} */ e) => e.kind || e.status),
      ["stop", "stopped"],
    );
    const rec = await recordOf(runId);
    assert.deepEqual([rec.acp.run.status, rec.acp.run.stoppedBy, rec.acp.run.forced], ["stopped", "harness", undefined]);
    assert.ok(rec.changes.includes("acp: the developer stopped the turn; claude cancelled it"), rec.changes.join("\n"));
    assert.ok(rec.changes.includes("acp: a message sent while claude worked waited for its next tool call, and its turn ended first: it goes as the next message"), rec.changes.join("\n"));
    assert.ok(!evs.some((/** @type {any} */ e) => e.type === "steer-read" && (e.ids || [e.id]).includes(noteId)), "the note was never read: the harness sends it next");
    assert.ok(evs.some((/** @type {any} */ e) => e.type === "steer-unread" && e.ids.includes(noteId)), "the run's end says it unread");
    assert.ok(!blocks.some((/** @type {any} */ b) => String(b[1]).includes("also check the tests")), "nor did the agent answer it");
    // (fails before: no — a guard the mutation pass asked for: a stopped agent turn's stamp was never read back, and no
    // harness turn here ended in a line of Filament's after the agent's words)
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    assert.equal(tr.turns.at(-1).stopped?.by, "harness", "after a reload the turn reads as stopped");
    assert.equal(tr.turns.at(-1).final.content.at(-1)?.text, blocks.at(-1)?.[1], "after a reload the stop's line is still the turn's last");
  });

  // (fails before: yes — an agent's turn had no run, so no Force stop reached it: an agent that never ends its turn
  // held it)
  test("Force stop ends a turn the agent will not end, in the force's words", async () => {
    const id = await session("claude/haiku");
    const res = await turn(id, "~deaf to everything");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await until(async () => (await runEvents(runId)).some((/** @type {any} */ e) => e.type === "tool-end" && e.id === "t1"), "the read to end");
    assert.equal((await steer(runId, { kind: "stop", text: "", from: "harness" })).status, 200);
    assert.equal((await steer(runId, { kind: "stop", text: "", from: "harness", force: true })).status, 200);
    const blocks = blocksOf(parseSse(await body));
    assert.deepEqual(blocks.at(-1), ["text", "(Filament: the developer force-stopped this turn after 1 tool call; what was finished is above.)"]);
    const rec = await recordOf(runId);
    assert.deepEqual([rec.acp.run.status, rec.acp.run.stoppedBy, rec.acp.run.forced], ["stopped", "harness", true]);
    assert.ok(rec.changes.includes("acp: the developer force-stopped the turn; Filament did not wait for claude to end it"), rec.changes.join("\n"));
  });

  // (fails before: no — a guard the mutation pass asked for: the agent a Force stop left running never spoke again)
  test("what the agent says after a Force stop is no one's: the reply ends in the force's words", async () => {
    const res = await turn(await session("claude/haiku"), "~chatty to the end");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await until(async () => (await runEvents(runId)).some((/** @type {any} */ e) => e.type === "tool-end" && e.id === "t1"), "the read to end");
    // (fails before: no — a guard the mutation pass asked for: no page joined an agent's turn while it talked)
    await until(() => shim.app.liveWords.blocks(runId).some((b) => b.type === "text" && /\bw1 /.test(b.text)), "its words, held for a page that joins");
    assert.equal((await steer(runId, { kind: "stop", text: "", from: "harness", force: true })).status, 200);
    const last = blocksOf(parseSse(await body)).at(-1);
    assert.equal(last?.[0], "text");
    assert.match(String(last?.[1]), /^\(Filament: the developer force-stopped this turn after 1 tool call; (what was finished is above|no reply had been written yet)\.\)$/);
  });

  // (fails before: yes — the session's stop only steered. With no run id in hand (a page that reloaded, another window)
  // a turn its agent would not end held the session for good: the harness's own turn has no lease, HarnessV4_Tasks A5)
  // (the next turn's part fails before: yes — the bridge still waited for the agent's answer to the forced turn, so the
  // chat's next message queued behind it for good, with no run and nothing said)
  test("the session's stop with force ends a turn the agent will not end; the chat's next turn lets that session go and starts a new one from Filament's copy", async () => {
    const id = await session("deafstuck/haiku");
    const res = await turn(id, "~deaf to everything");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await until(async () => (await runEvents(runId)).some((/** @type {any} */ e) => e.type === "tool-end" && e.id === "t1"), "the read to end");
    // The stop alone reaches the run, and the agent ignores its cancel: the turn runs on, the lock still its own.
    assert.equal((await stopSession(id)).stopped, "steered");
    await until(async () => (await runEvents(runId)).some((/** @type {any} */ e) => e.type === "steer" && e.kind === "stop"), "the stop to be queued");
    assert.equal(holderOf(id)?.requestId, runId, "the turn still holds its session");
    const forced = await stopSession(id, { force: true });
    assert.deepEqual([forced.ok, forced.stopped, forced.holder?.requestId], [true, "forced", runId]);
    const blocks = blocksOf(parseSse(await body));
    assert.deepEqual(blocks.at(-1), ["text", "(Filament: the developer force-stopped this turn after 1 tool call; what was finished is above.)"]);
    const rec = await recordOf(runId);
    assert.deepEqual([rec.acp.run.status, rec.acp.run.stoppedBy, rec.acp.run.forced], ["stopped", "harness", true]);
    await until(() => holderOf(id) === null, "the lock to be free");
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    assert.equal(tr.live, null, "no turn runs in the session");
    assert.deepEqual([tr.turns.at(-1).stopped?.by, tr.turns.at(-1).stopped?.forced], ["harness", true], "the turn reads as force-stopped");
    assert.ok(tr.turns.at(-1).final.content.some((/** @type {any} */ b) => /working/.test(String(b.text || ""))), "what the agent had said is the turn's");
    // Nothing runs now: a force has nothing to take, and says it reached no turn.
    const none = await stopSession(id, { force: true });
    assert.deepEqual(none, { ok: true, holder: null, stopped: null });
    // The agent still has not ended that turn: its session holds the open prompt.
    const stuck = convOf(id);
    assert.equal(stuck.unended, 1);
    writeFileSync(gates.off, "");
    const next = await turn(id, "and now?");
    assert.equal(next.status, 200, "the session takes its next turn");
    const nextRun = String(next.headers.get("x-filament-request-id"));
    const said = blocksOf(parseSse(await next.text()));
    assert.equal(said[0]?.[1], "_filament: deafstuck had not ended the turn you force-stopped, so this turn starts a new deafstuck session from Filament's copy of the conversation._\n\n");
    const rec2 = await recordOf(nextRun);
    assert.equal(rec2.acp.run.status, "done");
    assert.ok(rec2.changes.includes("acp: deafstuck had not ended the turn that was force-stopped, so its session was let go; this turn starts a new one from Filament's copy of the conversation"), rec2.changes.join("\n"));
    const sent = lines(logs.deafstuck);
    assert.equal(sent.length, 2, "the two turns' prompts, one each");
    assert.notEqual(sent[1].sessionId, sent[0].sessionId, "a new session of the agent's");
    assert.match(sent[1].text, /^Earlier conversation \(from another assistant/, "started from Filament's copy");
    assert.match(sent[1].text, /~deaf to everything[\s\S]*the developer force-stopped this turn[\s\S]*and now\?/, "which holds the forced turn, then the new words");
    assert.equal(convOf(id).sessionId, sent[1].sessionId);
    assert.ok(!convOf(id).unended, "the new session holds no open prompt");
  });

  // (fails before: yes — nothing let go of the agent's prompt, so the next turn waited behind it. Now a turn that ends
  // late after all, before the next message, keeps its session: no new one, no copy read again)
  test("an agent that ends a force-stopped turn late keeps its session: the chat's next turn goes on in it", async () => {
    const id = await session("deafslow/haiku");
    const res = await turn(id, "~deaf to everything");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await until(async () => (await runEvents(runId)).some((/** @type {any} */ e) => e.type === "tool-end" && e.id === "t1"), "the read to end");
    assert.equal((await stopSession(id, { force: true })).stopped, "forced");
    await body;
    await until(() => holderOf(id) === null, "the lock to be free");
    assert.equal(convOf(id).unended, 1, "the agent has not ended the turn yet");
    writeFileSync(gates.end, "");
    await until(() => !convOf(id).unended, "the agent's late end of the turn");
    const next = await turn(id, "and now?");
    const said = blocksOf(parseSse(await next.text()));
    assert.ok(!said.some((b) => /force-stopped/.test(String(b[1]))), "nothing is said of a new session");
    const sent = lines(logs.deafslow);
    assert.deepEqual(sent.map((p) => p.sessionId), [sent[0].sessionId, sent[0].sessionId], "the same session");
    assert.ok(!/Earlier conversation/.test(sent[1].text), "which is told the new words alone");
    assert.match(sent[1].text, /and now\?/);
  });

  // (fails before: yes — the session the refusal ended took the next turn, and a session started later was seeded with
  // the refused turn whole: every message the chat sent after it was refused the same way)
  test("a turn the provider refuses: the chat's next turn starts a new session from Filament's copy, which leaves the refused turn out but for the files it wrote", async () => {
    const id = await session("claude/haiku");
    const res = await turn(id, "~work on the readme ~refuse");
    const runId = String(res.headers.get("x-filament-request-id"));
    const blocks = blocksOf(parseSse(await res.text()));
    assert.equal(blocks.at(-1)?.[1], "_filament: claude refused this request. Filament leaves this turn out of the chat's history, and your next message starts a new claude session without it._");
    assert.equal((await recordOf(runId)).stopReason, "refusal");
    assert.equal(convOf(id).refused, true, "the session that heard the refused turn is marked");
    await until(() => holderOf(id) === null, "the lock to be free");
    await until(async () => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json()).turns.at(-1)?.facts?.stopReason === "refusal", "the turn's facts");
    const next = await turn(id, "and now?");
    const nextRun = String(next.headers.get("x-filament-request-id"));
    await next.text();
    const rec2 = await recordOf(nextRun);
    assert.equal(rec2.stopReason, "end_turn");
    assert.ok(rec2.changes.includes("acp: claude refused the chat's last turn, so its session was let go; this turn starts a new one from Filament's copy of the conversation"), rec2.changes.join("\n"));
    const said2 = rec2.changes.join("\n");
    assert.match(said2, /claude refused the chat's last turn, so this turn starts a fresh agent session from Filament's copy of the chat/, "the session's side knows the turn starts fresh, and asks nothing first");
    assert.match(said2, /1 turn the model's provider refused left out of the history, each as Filament's line on what it wrote/);
    assert.doesNotMatch(said2, /failed after doing work|unanswered turn/, "the refused turn counts as neither");
    const sent = lines(logs.claude).slice(-2);
    assert.notEqual(sent[1].sessionId, sent[0].sessionId, "a new session of the agent's");
    assert.match(sent[1].text, /^Earlier conversation \(from another assistant/, "started from Filament's copy");
    assert.doesNotMatch(sent[1].text, /~refuse|~work on the readme|Done: README\.md edited/, "which leaves the refused turn's words out");
    assert.match(sent[1].text, /provider refused this turn[\s\S]*README\.md[\s\S]*and now\?/, "and says what it wrote, then the new words");
    assert.equal(convOf(id).sessionId, sent[1].sessionId);
    assert.ok(!convOf(id).refused, "the new session heard no refused turn");
  });

  // (fails before: no — a guard the mutation pass asked for: no agent's turn here failed)
  test("a turn the agent fails ends its run in error", async () => {
    const res = await turn(await session("claude/haiku"), "~rpcrefuse this");
    const runId = String(res.headers.get("x-filament-request-id"));
    await res.text();
    const end = (await runEvents(runId)).at(-1);
    assert.deepEqual([end.type, end.status], ["run-end", "error"]);
  });

  // (fails before: yes — Claude's words for an API error it met were drawn as its reply, Filament's line said the
  // failure again, and the archived turn kept no word of it: a reload read "no reply was recorded")
  test("an API error Claude met ends the turn once: its words are the failure's, not the reply's, and the turn keeps them", async () => {
    const WORDS = "API Error: the model's server failed mid-turn";
    const id = await session("claude/haiku");
    const res = await turn(id, "~apierror now");
    const runId = String(res.headers.get("x-filament-request-id"));
    const frames = parseSse(await res.text());
    const text = blocksOf(frames.filter((f) => f.event !== "filament_run")).filter(([type]) => type === "text").map(([, words]) => words).join("");
    assert.equal(text, "Looking at it. ", "the agent's words alone: no API error, no line of Filament's");
    assert.deepEqual(frames.filter((f) => f.event === "error").map((f) => f.data.error.message), [`Internal error: ${WORDS}`]);
    const rec = await recordOf(runId);
    assert.deepEqual([rec.status, rec.error], ["error", `Internal error: ${WORDS}`]);
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    assert.deepEqual([tr.turns.at(-1).open, tr.turns.at(-1).facts?.error], [true, `Internal error: ${WORDS}`]);
    // An outside client draws no banner: its reply says the failure once, in Filament's line.
    const out = await shim.post("/v1/messages", { model: "claude/haiku", max_tokens: 400, stream: true, messages: [{ role: "user", content: "~apierror there" }] });
    const said = blocksOf(parseSse(await out.text())).filter(([type]) => type === "text").map(([, words]) => words).join("");
    assert.equal(said.split(WORDS).length - 1, 1, said);
    assert.match(said, /_filament: claude failed: Internal error: API Error: the model's server failed mid-turn_$/);
  });

  // (fails before: yes — an API error the adapter's failure left unsaid was drawn as the reply, and the failure said
  // only "Internal error"; one the turn went on from stayed in the reply)
  test("an API error's words reach the failure that leaves them out; a turn that went on keeps them as its note", async () => {
    const WORDS = "API Error: the model's server failed mid-turn";
    const bare = await turn(await session("claude/haiku"), "~apierrorbare now");
    const bareId = String(bare.headers.get("x-filament-request-id"));
    await bare.text();
    assert.equal((await recordOf(bareId)).error, `Internal error: ${WORDS}`);
    const ok = await turn(await session("claude/haiku"), "~apierrorok now");
    const okId = String(ok.headers.get("x-filament-request-id"));
    const text = blocksOf(parseSse(await ok.text()).filter((f) => f.event !== "filament_run")).filter(([type]) => type === "text").map(([, words]) => words).join("");
    assert.equal(text, "Looking at it. ");
    const rec = await recordOf(okId);
    assert.equal(rec.acp.run.status, "done");
    assert.ok(rec.changes.includes(`acp: Claude met an API error during this turn: ${WORDS}`), rec.changes.join("\n"));
  });

  // (fails before: no — a guard the mutation pass asked for: no session here switched its snapshots off)
  test("a session with its snapshots off takes none of an agent's turn", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "claude/haiku", preset: "plain", settings: { loop: { treeSnapshots: false } } } });
    assert.equal(r.status, 200, await r.clone().text());
    const res = await turn(String((await r.json()).id), "~work on the readme");
    const runId = String(res.headers.get("x-filament-request-id"));
    await res.text();
    assert.deepEqual((await runEvents(runId)).filter((/** @type {any} */ e) => e.type === "snapshot"), []);
    assert.equal((await recordOf(runId)).acp.run.snapshots, 0);
  });

  // (fails before: yes — an outside client's turn had no run: no `x-filament-run` head, no run on its record. Its text
  // with the tool lines, and no run events in its reply, are a guard)
  test("an outside client's reply keeps its text, with the tool lines; no run events ride it", async () => {
    const res = await shim.post("/v1/messages", { model: "claude/haiku", max_tokens: 400, stream: true, messages: [{ role: "user", content: "~work once more" }] });
    assert.equal(res.status, 200);
    assert.deepEqual([res.headers.get("x-filament-run"), res.headers.get("x-filament-run-events")], ["1", null]);
    const frames = parseSse(await res.text());
    assert.ok(!frames.some((f) => f.event === "filament_run"));
    const text = blocksOf(frames).filter(([type]) => type === "text").map(([, words]) => words).join("");
    assert.match(text, /⚙ Read .*README\.md/);
    assert.match(text, /Done: README\.md edited\./);
    const rec = await recordOf(String(res.headers.get("x-filament-request-id")));
    assert.deepEqual([rec.acp.run.status, rec.acp.run.snapshots], ["done", 0], "snapshots are the harness's");
  });

  // (fails before: yes — Filament answered an outside client's `/status` and `/sessions` on a coding agent's route
  // itself, with its status card and its list of the agent's sessions, and the agent never heard them)
  test("an outside client's /status and /sessions reach its agent as typed; a harness chat's /status is Filament's", async () => {
    const heard = lines(logs.claude).length;
    for (const words of ["/status", "/sessions"]) {
      const res = await shim.post("/v1/messages", { model: "claude/haiku", max_tokens: 400, messages: [{ role: "user", content: words }] }, { "x-session-id": `outside-${words.slice(1)}` });
      assert.equal(res.status, 200);
      const text = (await res.json()).content.filter((/** @type {any} */ b) => b.type === "text").map((/** @type {any} */ b) => b.text).join("");
      assert.ok(!text.includes("Filament status for this chat") && !text.includes("knows about"), text);
      assert.match(text, new RegExp(`echo\\(1\\): ${words}$`), "the agent's answer");
      assert.equal(lines(logs.claude).at(-1)?.prompt, words, "the agent heard the words as typed");
      const rec = await recordOf(String(res.headers.get("x-filament-request-id")));
      assert.ok(!rec.changes.some((/** @type {string} */ c) => /answered by Filament/.test(c)), rec.changes.join("\n"));
    }
    assert.equal(lines(logs.claude).length, heard + 2);
    const res = await turn(await session("claude/haiku"), "/status");
    const said = blocksOf(parseSse(await res.text()).filter((f) => f.event !== "filament_run")).map(([, w]) => w).join("\n");
    assert.match(said, /^\*\*Filament status for this chat\*\*\n- claude/, said);
    assert.equal(lines(logs.claude).length, heard + 2, "the harness chat's agent was not asked");
  });

  // (fails before: yes — a harness chat's agent conversation was keyed by its first message: the second chat continued
  // the first's agent session)
  test("two harness chats opened with the same words are two agent sessions; a chat's next turn continues its own", async () => {
    /** A turn's agent session, from its run. @param {string} id @param {string} words */
    const sessionOf = async (id, words) => {
      const res = await turn(id, words);
      const runId = String(res.headers.get("x-filament-request-id"));
      await res.text();
      await recordOf(runId);
      return (await runEvents(runId))[0].meta.session;
    };
    const a = await session("claude/haiku");
    const b = await session("claude/haiku");
    const first = await sessionOf(a, "the same words");
    assert.notEqual(await sessionOf(b, "the same words"), first);
    assert.equal(await sessionOf(a, "and more"), first);
  });

  // (fails before: yes — an agent session kept none of its raw messages: the Agents page had nothing to show)
  test("an agent session keeps its newest raw messages in memory, as many as acp.rawMessages says (AC1-7)", async () => {
    /** One `~work` turn on a model: its agent session, and that session's row on the Agents page. @param {string} model */
    const kept = async (model) => {
      const res = await turn(await session(model), "~work on the readme");
      const runId = String(res.headers.get("x-filament-request-id"));
      await res.text();
      const rec = await recordOf(runId);
      const sessionId = (await runEvents(runId))[0].meta.session;
      const row = (await (await shim.api("/api/acp/status")).json()).conversations.find((/** @type {any} */ c) => c.sessionId === sessionId);
      const got = await (await shim.api(`/api/acp/conversations/${encodeURIComponent(row.key)}/raw`)).json();
      return { rec, row, raw: got.raw };
    };
    const all = await kept("claude/haiku");
    const byType = /** @type {Record<string, number>} */ ({});
    for (const m of all.raw) byType[m.type] = (byType[m.type] || 0) + 1;
    assert.deepEqual(byType, all.rec.acp.run.raw, "every one kept: the record's count by type");
    // (fails before: no — a guard the mutation pass asked for: the count and the kept list name a type alike, so a
    // subtype lost from both went unseen; and the fake sent nothing the list leaves out, so asking for every message
    // went unseen too)
    // The prompt's echo is one of the user messages: Claude's adapter echoes each prompt it takes (FP-D5).
    assert.deepEqual(all.rec.acp.run.raw, { assistant: 8, user: 6, "result/success": 1 }, "a result by how it ended; nothing unasked");
    assert.equal(all.row.raw, all.raw.length);
    assert.ok(all.raw.every((/** @type {any} */ m) => Number.isFinite(m.at) && m.type.split("/")[0] === m.message?.type));
    const two = await kept("keep2/haiku");
    assert.deepEqual(two.raw.map((/** @type {any} */ m) => m.message), all.raw.slice(-2).map((/** @type {any} */ m) => m.message), "the newest two");
    const none = await kept("keep0/haiku");
    assert.deepEqual([none.row.raw, none.raw], [0, []]);
    assert.ok(Object.keys(none.rec.acp.run.raw).length, "kept or not, the turn read them");
    // (fails before: no — a guard the mutation pass asked for: a cleared field and a negative one were never tried)
    for (const model of ["keepnull/haiku", "keepneg/haiku"]) assert.equal((await kept(model)).raw.length, all.raw.length, `${model}: the default, 50`);
    assert.equal((await shim.api("/api/acp/conversations/no-such-key/raw")).status, 404);
  });

  // (fails before: no — a guard the mutation pass asked for: nothing read the Agents page's raw column, so a count that
  // opened nothing went unseen)
  test("Home → Agents: a session's raw count opens the raw messages it kept", () => {
    const home = readFileSync(new URL("../src/ui/pages/home.js", import.meta.url), "utf8");
    assert.match(home, /title: "Show the raw messages this session kept", onclick: \(\) => openRawMessages\(cv\) \}/);
    const app = readFileSync(new URL("../src/ui/app.js", import.meta.url), "utf8");
    assert.match(app, /function openRawMessages\(c\) \{[\s\S]*?api\(`\/acp\/conversations\/\$\{encodeURIComponent\(c\.key\)\}\/raw`\)/);
  });

  // (fails before: yes — the agent's published commands were only a list in a `/commands` reply: no route for the menu)
  test("the commands the agent published, read by a run of its, for the composer's menu (AC1-6)", async () => {
    const id = await session("claude/haiku");
    const res = await turn(id, "hello there");
    const runId = String(res.headers.get("x-filament-request-id"));
    await res.text();
    await recordOf(runId);
    const got = await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/agent-commands`)).json();
    assert.deepEqual(got, {
      runId,
      agent: "claude",
      commands: [
        { name: "review", description: "Review the diff", hint: "" },
        { name: "commit", description: "Commit", hint: "" },
      ],
    });
    assert.equal((await shim.api("/api/runs/no-such-run/agent-commands")).status, 404);
  });

  // (fails before: no — a guard the mutation pass asked for: every session of an agent here published the same
  // commands)
  test("a run reads the commands its own session published, not another session's of the same agent", async () => {
    /** @type {string[][]} */
    const seen = [];
    for (let i = 0; i < 2; i++) {
      const res = await turn(await session("cmds/haiku"), "hello there");
      const runId = String(res.headers.get("x-filament-request-id"));
      await res.text();
      await recordOf(runId);
      const sessionId = (await runEvents(runId))[0].meta.session;
      const got = await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/agent-commands`)).json();
      seen.push([got.commands.at(-1).name, `for-${sessionId}`]);
      // (fails before: no — a guard the mutation pass asked for: every agent here was named as its id)
      assert.equal(got.agent, "Commands", "the agent by its name, as the page shows it");
    }
    assert.deepEqual(seen.map(([said]) => said), seen.map(([, own]) => own));
    assert.notEqual(seen[0][1], seen[1][1], "two sessions");
  });

  // (fails before: yes — a stop that came while the agent's session was being readied was forgotten: the prompt went
  // out)
  test("a stop before the session is up keeps the prompt from going out", async () => {
    const id = await session("slow/haiku");
    const pending = turn(id, "words that must not go out");
    await until(() => lines(logs.slowCalls).some((c) => c.method === "session/new"), "the agent to be readying the session");
    const stop = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST" })).json();
    assert.equal(stop.stopped, "cancelled", "no run yet: the session's stop cancels the turn");
    await (await pending).text();
    // The agent reads its messages in order: the next turn's prompt comes after any the stopped turn sent.
    // No session of the agent's was up for the stopped turn, so none is lost: the next message asks nothing first
    // (HarnessV4_Tasks C26).
    const next = await turn(id, "the next words");
    assert.equal(next.status, 200, "sent, with no question of a lost session");
    await next.text();
    const sent = lines(logs.slow);
    assert.equal(sent.length, 1, sent.map((p) => p.text).join("\n---\n"));
    assert.match(sent[0].text, /the next words/);
  });

  test("Cursor's own tools over ACP: its sub-agent whole, with its kind and model; its to-do list as it keeps it; its image", async () => {
    const res = await turn(await session("cursoracp/auto"), "~cursor please");
    const runId = String(res.headers.get("x-filament-request-id"));
    const frames = parseSse(await res.text());
    const evs = await runEvents(runId);
    const of = (/** @type {string} */ type) => evs.filter((/** @type {any} */ e) => e.type === type);
    // Each extension is answered as Cursor's page documents it, in the agent's order.
    assert.deepEqual(blocksOf(frames.filter((f) => f.event !== "filament_run")).at(-1), ["text", "answers: task=completed update_todos=accepted update_todos=accepted generate_image=generated"]);
    // The sub-agent: drawn once its call started, its prompt whole; the model it ran on, from its extension.
    assert.deepEqual(of("subagent-start").map((e) => [e.parent, e.description, e.agent, e.prompt]), [["c_task", "Look for TODOs", "explore", "Find the TODOs in src"]]);
    assert.deepEqual(of("subagent-end").map((e) => [e.parent, e.ok, e.model]), [["c_task", true, "composer-2.5"]]);
    // Its to-do list: an update merged by id into the list it keeps; a cancelled item is no longer part of the work.
    assert.deepEqual(
      of("plan").map((e) => e.items.map((/** @type {any} */ i) => `${i.status}:${i.text}`)),
      [["done:Read the code", "doing:Fix the bug"], ["done:Read the code", "done:Fix the bug", "pending:Run the tests"]],
    );
    // The image: its card, and the file it saved, in the working folder's words.
    assert.deepEqual(of("tool-start").filter((e) => e.id === "c_img").map((e) => [e.card.kind, e.card.subject]), [["image", "a red square"]]);
    assert.deepEqual(of("tool-end").filter((e) => e.id === "c_img").map((e) => [e.ok, e.file]), [[true, "red.png"]]);
  });

  // (fails before: yes — a Cursor turn had no run, and its task call was two cards: the sub-agent's and an `other` one)
  test("Cursor's SDK shares the turn: its run, a card per call, its task one card with its sub-agent's calls on it", async () => {
    const id = await session("cursor/composer-2.5");
    const res = await turn(id, "~shell ~edit ~task please");
    const runId = String(res.headers.get("x-filament-request-id"));
    const frames = parseSse(await res.text());
    const evs = frames.filter((f) => f.event === "filament_run").map((f) => f.data.event);
    assert.deepEqual([evs[0].kind, evs[0].meta.engine, evs[0].meta.upstream, evs.at(-1).status], ["coding-agent", "cursor-sdk", "cursor", "done"]);
    assert.deepEqual(evs.filter((e) => e.type === "tool-start").map((e) => [e.name, e.id]), [["bash", "c1"], ["edit", "c2"], ["agent", "c5"]]);
    assert.deepEqual(
      evs.filter((e) => e.type.startsWith("subagent-")).map((e) => [e.type, e.parent]),
      [["subagent-start", "c5"], ["subagent-tool-start", "c5"], ["subagent-end", "c5"], ["subagent-tool-end", "c5"]],
      "the nested read the agent never ended is ended with the turn",
    );
    assert.deepEqual(blocksOf(frames.filter((f) => f.event !== "filament_run")), [["thinking", "pondering "], ["text", "echo(1): ~shell ~edit ~task please"]]);
    const rec = await recordOf(runId);
    assert.deepEqual([rec.acp.run.status, rec.acp.run.tools, rec.acp.run.subagents], ["done", 3, 1]);
    // (fails before: no — a guard the mutation pass asked for: only an ACP agent's run ever asked for its commands)
    const cmds = await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/agent-commands`)).json();
    assert.deepEqual([cmds.agent, cmds.commands], [null, []], "Cursor's SDK publishes no commands: no agent names a menu");
  });

  // (fails before: yes — a Cursor sub-agent's todo list was read as the turn's plan)
  test("a Cursor sub-agent's todo list is its own: on its card, no plan of the turn's", async () => {
    const res = await turn(await session("cursor/composer-2.5"), "~subtodo please");
    const runId = String(res.headers.get("x-filament-request-id"));
    await res.text();
    const evs = await runEvents(runId);
    assert.deepEqual(evs.filter((/** @type {any} */ e) => e.type === "subagent-start").map((/** @type {any} */ e) => e.parent), ["c7"]);
    assert.deepEqual(evs.filter((/** @type {any} */ e) => e.type === "plan"), []);
    assert.deepEqual(evs.filter((/** @type {any} */ e) => e.type === "subagent-plan").map((/** @type {any} */ e) => [e.parent, e.items]), [["c7", [{ text: "Find the bug", status: "doing" }]]], "AC3-4");
  });

  // (fails before: yes — the SDK route drew a sub-agent from its call's first words as its model wrote them, its task's
  // words standing for its prompt, and never read its kind or its model)
  test("a Cursor SDK sub-agent reads as its task, with its prompt, its kind and its model, once its call has started", async () => {
    const res = await turn(await session("cursor/composer-2.5"), "~task please");
    const runId = String(res.headers.get("x-filament-request-id"));
    await res.text();
    const start = (await runEvents(runId)).filter((/** @type {any} */ e) => e.type === "subagent-start");
    assert.deepEqual(start.map((/** @type {any} */ e) => [e.parent, e.description, e.agent, e.model, e.prompt]), [["c5", "explore the repo", "explore", "composer-2.5", "Find where the app starts"]]);
  });

  // (fails before: yes — the SDK route dropped a sub-agent's own words and thinking: its thread showed its calls and
  // an end with no report)
  test("a Cursor SDK sub-agent's own words and thinking reach its run as pieces, its last message is its report, and the turn's answer holds none of them", async () => {
    const res = await turn(await session("cursor/composer-2.5"), "~subsays please");
    const runId = String(res.headers.get("x-filament-request-id"));
    const frames = parseSse(await res.text());
    const ev = await runEvents(runId);
    const words = ev.filter((/** @type {any} */ e) => e.type === "subagent-words");
    assert.ok(words.length >= 2 && words.every((/** @type {any} */ e) => e.parent === "c13"), JSON.stringify(words));
    assert.equal(words.filter((/** @type {any} */ e) => e.thinking).map((/** @type {any} */ e) => e.text).join(""), "Where would it start? ");
    assert.equal(words.filter((/** @type {any} */ e) => !e.thinking).map((/** @type {any} */ e) => e.text).join(""), "Looking at the entry file. It starts in src/index.js.");
    // What it said before its call is written down before that call.
    const order = ev.filter((/** @type {any} */ e) => e.type === "subagent-words" || e.type === "subagent-tool-start").map((/** @type {any} */ e) => (e.type === "subagent-words" ? (e.thinking ? "thinking" : "words") : "call"));
    assert.deepEqual([order.indexOf("call") > order.indexOf("words"), order.lastIndexOf("words") > order.indexOf("call")], [true, true], order.join(" "));
    assert.equal(ev.find((/** @type {any} */ e) => e.type === "subagent-end")?.report, "It starts in src/index.js.");
    assert.deepEqual(blocksOf(frames.filter((f) => f.event !== "filament_run")), [["thinking", "pondering "], ["text", "echo(1): ~subsays please"]], "the turn's own answer and thinking hold none of its words");
  });

  // (fails before: yes — the SDK route drew the list from each update's own items: an update naming only what changed
  // stood for the whole list, and a cancelled item read as done)
  test("Cursor's SDK to-do list is the one its result keeps: an update naming only what changed, a cancelled item gone", async () => {
    const res = await turn(await session("cursor/composer-2.5"), "~plan please");
    const runId = String(res.headers.get("x-filament-request-id"));
    await res.text();
    const plans = (await runEvents(runId)).filter((/** @type {any} */ e) => e.type === "plan");
    assert.deepEqual(plans.map((/** @type {any} */ e) => e.items.map((/** @type {any} */ i) => `${i.status}:${i.text}`)), [["pending:Read the test", "pending:Fix it"], ["done:Read the test", "doing:Fix it"]]);
  });

  test("Cursor's SDK: its image's file, its compaction marked where it happened, the key's owner on the turn's record", async () => {
    const res = await turn(await session("cursor/composer-2.5"), "~compact ~image please");
    const runId = String(res.headers.get("x-filament-request-id"));
    await res.text();
    const evs = await runEvents(runId);
    const of = (/** @type {string} */ type) => evs.filter((/** @type {any} */ e) => e.type === type);
    assert.deepEqual(of("tool-start").filter((e) => e.id === "c9").map((e) => [e.card.kind, e.card.subject]), [["image", "a red square"]]);
    assert.deepEqual(of("tool-end").filter((e) => e.id === "c9").map((e) => [e.ok, e.file]), [[true, "assets/red.png"]]);
    assert.deepEqual(of("compacting").map((e) => [e.round, e.own]), [[1, true]]);
    assert.deepEqual(of("compaction").map((e) => [e.round, e.own]), [[1, true]]);
    const { account } = (await recordOf(runId)).acp;
    assert.deepEqual(account, { kind: "api-key", label: "Cursor API key “Filament test key”", plan: null, email: "dev@example.com", organization: null, detail: "Filament test key", billing: "plan", windows: [], at: account.at });
    assert.equal(typeof account.at, "number");
  });

  // (fails before: yes — a failed turn's record had no `acp` block: a Cursor turn that failed lost the key's owner, its
  // model and its run's end; HarnessV3-ACP AC2-5)
  test("a Cursor SDK turn that fails keeps the key's owner, the model and its run's end on its record", async () => {
    const res = await turn(await session("cursor/composer-2.5"), "~fail now");
    const runId = String(res.headers.get("x-filament-request-id"));
    await res.text();
    const rec = await recordOf(runId);
    assert.deepEqual([rec.status, rec.acp.run.status, rec.acp.agentModel, rec.acp.account?.email], ["error", "failed", "composer-2.5", "dev@example.com"]);
  });

  test("Cursor's estimate as it works, from its second turn: each model call's, an estimate; the turn ends on the same figure", async () => {
    const id = await session("cursor/composer-2.5");
    const first = await turn(id, "hello");
    const firstRun = String(first.headers.get("x-filament-request-id"));
    await first.text();
    assert.deepEqual((await runEvents(firstRun)).filter((/** @type {any} */ e) => e.type === "held"), [], "its base is calibrated as its first turn ends: nothing to count by before");
    await recordOf(firstRun);
    const res = await turn(id, "~shell ~task please");
    const runId = String(res.headers.get("x-filament-request-id"));
    await res.text();
    const held = (await runEvents(runId)).filter((/** @type {any} */ e) => e.type === "held");
    assert.deepEqual(held.map((/** @type {any} */ e) => [e.tokens, e.window, e.exact]), [[5030, null, false], [5060, null, false]], "the tool's result, then the answer; its sub-agent's calls are its own");
    const rec = await recordOf(runId);
    assert.deepEqual([rec.context.last, rec.context.source === "agent", rec.context.verdict], [{ held: 5060, estimated: true }, false, null], "Cursor names no window");
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    assert.deepEqual([tr.turns.at(-1).facts?.context?.held, tr.turns.at(-1).facts?.context?.estimated], [5060, true]);
    // (fails before: no — a guard the mutation pass asked for: a sub-agent's model call always came after one of the
    // turn's own)
    const third = await turn(id, "~task please");
    const thirdRun = String(third.headers.get("x-filament-request-id"));
    await third.text();
    const counts = (await runEvents(thirdRun)).filter((/** @type {any} */ e) => e.type === "held").map((/** @type {any} */ e) => e.tokens);
    assert.deepEqual(counts, [5090], "its sub-agent's call counts a context of its own, not the turn's");
  });

  // (fails before: no — a guard the mutation pass asked for: no Cursor sub-agent compacted its context)
  test("a Cursor sub-agent compacting its context is its own: the turn draws no compaction", async () => {
    const res = await turn(await session("cursor/composer-2.5"), "~subcompact please");
    const runId = String(res.headers.get("x-filament-request-id"));
    await res.text();
    const evs = await runEvents(runId);
    assert.deepEqual(evs.filter((/** @type {any} */ e) => e.type === "subagent-start").map((/** @type {any} */ e) => e.parent), ["c11"]);
    assert.deepEqual(evs.filter((/** @type {any} */ e) => e.type === "compacting" || e.type === "compaction"), []);
  });

  // (fails before: no — a guard the mutation pass asked for: Cursor always named the key's owner before a turn ended)
  test("a Cursor SDK turn waits for the key's owner when Cursor names it late", async () => {
    const res = await turn(await session("cursorslow/composer-2.5"), "hello");
    const runId = String(res.headers.get("x-filament-request-id"));
    await res.text();
    assert.equal((await recordOf(runId)).acp.account?.email, "ops@example.com");
  });

  // (fails before: yes — a Cursor turn had no run: the stop's steer was refused, and the turn ran on)
  test("Stop cancels Cursor's run, which ends in the stop's words", async () => {
    const id = await session("cursor/composer-2.5");
    const res = await turn(id, "~hang please");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await until(async () => (await runEvents(runId)).some((/** @type {any} */ e) => e.type === "round-start"), "the run to be under way");
    assert.equal((await steer(runId, { kind: "stop", text: "", from: "harness" })).status, 200);
    assert.deepEqual(blocksOf(parseSse(await body)).at(-1), ["text", "(Filament: the developer stopped this turn after 0 tool calls; what was finished is above.)"]);
    const rec = await recordOf(runId);
    assert.deepEqual([rec.acp.run.status, rec.acp.run.stoppedBy], ["stopped", "harness"]);
    assert.ok(rec.changes.includes("acp: the developer stopped the turn; cursor cancelled it"), rec.changes.join("\n"));
  });

  // (fails before: yes — a stop that came while Cursor's run was being created had no run to cancel: the run went on)
  test("a stop while Cursor's run is being created cancels it once it is", async () => {
    const id = await session("cursor/composer-2.5");
    const res = await turn(id, "~slowsend then answer");
    const runId = String(res.headers.get("x-filament-request-id"));
    assert.equal((await steer(runId, { kind: "stop", text: "", from: "harness" })).status, 200);
    assert.deepEqual(blocksOf(parseSse(await res.text())).at(-1), ["text", "(Filament: the developer stopped this turn after 0 tool calls; no reply had been written yet.)"]);
    assert.equal((await recordOf(runId)).acp.run.status, "stopped");
  });

  // (fails before: yes — a stop that came while Cursor's agent was being readied was forgotten: the message went out)
  test("a stop while Cursor's agent is being readied keeps the message from going out", async () => {
    const id = await session("cursor/composer-2.5");
    const created = lines(logs.sdk).filter((e) => e.event === "create").length;
    const sends = lines(logs.sdk).filter((e) => e.event === "send").length;
    process.env.FAKE_SDK_SLOW_CREATE_MS = "1500";
    try {
      const pending = turn(id, "words that must not go out");
      await until(() => lines(logs.sdk).filter((e) => e.event === "create").length > created, "Cursor's agent to be readied");
      const stop = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST" })).json();
      assert.equal(stop.stopped, "cancelled", "no run yet: the session's stop cancels the turn");
      await (await pending).text();
    } finally {
      delete process.env.FAKE_SDK_SLOW_CREATE_MS;
    }
    assert.equal(lines(logs.sdk).filter((e) => e.event === "send").length, sends, "nothing was sent");
  });
});
