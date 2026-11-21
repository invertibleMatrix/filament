// @ts-check
// HarnessV3-ACP AC2-1: Codex as an upstream type of its own, through the whole app and a fake app-server
// (fixtures/fake-codex-app-server.mjs): the type table every surface reads, its settings' defaults, a chat client's
// turn and its record, the Agents page's rows and buttons, a harness turn as a run, and the doctor's section. The
// bridge on its own is in codex.test.js.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, parseSse, FIXTURES } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { ACP, AGENT_TYPES, UPSTREAM_TYPES, isAgentUpstream, isLeaf } from "../src/core/schema.js";
import { normalizeConfig, sparseConfig } from "../src/services/config/store.js";
import { runDoctor } from "../src/cli/doctor.js";
import { defaultConfig } from "../src/config.js";
import { commandLine } from "../src/core/catalogues.js";
import { recordSource } from "../src/services/records.js";
import { isMemoryRecord } from "../src/services/daily-usage.js";
import { ownAgentCall } from "../src/core/turn-facts.js";

const FAKE = join(FIXTURES, "fake-codex-app-server.mjs");
/**
 * The account the fake answers with, as the record keeps it (HarnessV3-ACP AC3-6): its identity — a plan's login, which
 * pays on the plan (AC3's drive D3) —, then its windows.
 */
const ACCOUNT = {
  kind: "account",
  label: "ChatGPT Plus",
  plan: "plus",
  email: "dev@example.com",
  organization: null,
  detail: null,
  billing: "plan",
  windows: [
    { id: "primary", kind: "session", label: "5-hour", usedPercent: 12, resetsAt: 1791400000000, windowMins: 300, status: null },
    { id: "secondary", kind: "weekly", label: "Weekly", usedPercent: 40, resetsAt: 1791900000000, windowMins: 10080, status: null },
  ],
};

describe("Codex's upstream type", () => {
  test("a coding agent in the type table, which every surface reads; the agent settings it leaves unused are real ones", () => {
    assert.deepEqual([...AGENT_TYPES].sort(), ["acp", "codex", "cursor-sdk"]);
    assert.deepEqual([isAgentUpstream({ type: "codex" }), isAgentUpstream({ type: "anthropic" }), isAgentUpstream(null)], [true, false, false]);
    const t = /** @type {any} */ (UPSTREAM_TYPES.codex);
    assert.deepEqual([t.keyless, t.local, t.kind], [true, true, "coding agent"]);
    for (const k of t.unused) assert.ok(isLeaf(/** @type {any} */ (ACP)[k]), `${k} is an agent setting`);
  });

  test("a codex upstream that names no command runs `codex app-server`, saved and loaded again; its own command stays", () => {
    const raw = {
      upstreams: [
        { id: "cx", type: "codex" },
        { id: "cx2", type: "codex", acp: { command: "C:/tools/codex.exe", args: ["app-server", "--verbose"] } },
        { id: "cur", type: "acp" },
      ],
    };
    const once = normalizeConfig(raw);
    const again = normalizeConfig(sparseConfig(once));
    for (const cfg of [once, again]) {
      const [bare, own, acp] = cfg.upstreams;
      assert.deepEqual([bare.acp.command, bare.acp.args], ["codex", ["app-server"]]);
      assert.deepEqual([own.acp.command, own.acp.args], ["C:/tools/codex.exe", ["app-server", "--verbose"]]);
      assert.deepEqual([acp.acp.command, acp.acp.args], ["agent", ["acp"]], "an ACP agent keeps ACP's defaults");
    }
  });
});

describe("Codex through the app", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-codex-app-"));
  const projDir = join(root, "project");
  const calls = join(root, "codex-calls.jsonl");
  before(async () => {
    mkdirSync(projDir);
    writeFileSync(join(projDir, "notes.txt"), "hello\n");
    const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: projDir, stdio: "ignore" });
    git("init", "-q");
    git("add", ".");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init");
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.rules.resilience.failover = true; // the backups below are tried: off until switched on (the owner's of 11-09)
        cfg.upstreams = [
          { id: "codex", name: "Codex", type: "codex", acp: { command: process.execPath, args: [FAKE], env: { FAKE_CODEX_CALLS: calls }, cwdDefault: projDir, permissions: "allow-all" } },
          // A Codex whose every turn fails after a model call that said nothing: the route below backs it with the other.
          { id: "codexq", name: "Codex quiet", type: "codex", acp: { command: process.execPath, args: [FAKE], env: { FAKE_CODEX_FAIL_QUIET: "1" }, cwdDefault: projDir, permissions: "allow-all" } },
          // A Codex whose own sandbox is not set up: a thread asked to write in its folder opens read-only.
          { id: "codexro", name: "Codex read-only", type: "codex", acp: { command: process.execPath, args: [FAKE], env: { FAKE_CODEX_READONLY: "1" }, cwdDefault: projDir, permissions: "allow-all" } },
          // The same, one for each kind of request whose failed attempt names its lineage: each meets its limit once.
          ...["sub", "fork", "mem"].map((k) => ({ id: `codexq-${k}`, name: `Codex quiet ${k}`, type: "codex", acp: { command: process.execPath, args: [FAKE], env: { FAKE_CODEX_FAIL_QUIET: "1" }, cwdDefault: projDir, permissions: "allow-all" } })),
        ];
        cfg.routes = [
          { match: "codex/*", upstream: "codex", upstreamModel: "{1}", enabled: true },
          { match: "codexro/*", upstream: "codexro", upstreamModel: "{1}", enabled: true },
          { match: "backed/*", upstream: "codexq", upstreamModel: "{1}", enabled: true, fallbacks: [{ upstream: "codex", upstreamModel: "gpt-6-astra" }] },
          ...["sub", "fork", "mem"].map((k) => ({ match: `backed-${k}/*`, upstream: `codexq-${k}`, upstreamModel: "{1}", enabled: true, fallbacks: [{ upstream: "codex", upstreamModel: "gpt-6-astra" }] })),
        ];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await removeDirs(root);
  });
  /** What the fake heard of one method. @param {string} method @returns {any[]} */
  const heard = (method) =>
    existsSync(calls)
      ? readFileSync(calls, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((m) => m.method === method)
      : [];
  /** A chat client's turn, the chat named by its header. @param {string} chat @param {any[]} messages */
  const ask = async (chat, messages) => {
    const res = await shim.post("/v1/messages", { model: "codex/gpt-6-astra", max_tokens: 200, system: `Working directory: ${projDir}`, messages }, { "x-session-id": chat });
    assert.equal(res.status, 200, await res.clone().text());
    return { id: String(res.headers.get("x-filament-request-id")), reply: await res.json() };
  };
  const status = async () => (await shim.api("/api/acp/status")).json();
  /** A turn's record, once its agent block is on it. @param {string} id */
  const recordOf = (id) =>
    until(async () => {
      const rec = await shim.record(id);
      return rec?.acp ? rec : null;
    }, `${id}'s record`);

  test("a chat client's turn: Codex's words; its record keeps who Codex ran as and the plan's windows", async () => {
    const { id, reply } = await ask("client-1", [{ role: "user", content: "hello" }]);
    assert.deepEqual(reply.content.filter((/** @type {any} */ b) => b.type === "text").map((/** @type {any} */ b) => b.text), ["Echo: hello"]);
    const rec = await recordOf(id);
    assert.equal(rec.upstream, "codex");
    const { at, ...account } = rec.acp.account;
    assert.equal(typeof at, "number");
    assert.deepEqual(account, ACCOUNT);
  });

  test("the Agents page: Codex's app-server and its chat beside the other agents'; Forget starts a new thread", async () => {
    await ask("client-2", [{ role: "user", content: "first" }]);
    let s = await status();
    const conv = s.conversations.find((/** @type {any} */ c) => c.upstreamId === "codex" && c.title === "first");
    assert.ok(conv, JSON.stringify(s.conversations));
    assert.deepEqual([conv.turns, conv.live], [1, true]);
    assert.ok(s.processes.some((/** @type {any} */ p) => p.key === "codex|app-server"), JSON.stringify(s.processes));
    const forgot = await (await shim.api(`/api/acp/conversations/${encodeURIComponent(conv.key)}`, { method: "DELETE" })).json();
    assert.equal(forgot.ok, true);
    s = await status();
    assert.ok(!s.conversations.some((/** @type {any} */ c) => c.key === conv.key), "forgotten");
    const started = heard("thread/start").length;
    await ask("client-2", [{ role: "user", content: "first" }, { role: "assistant", content: "Echo: first" }, { role: "user", content: "second" }]);
    assert.equal(heard("thread/start").length, started + 1, "the chat's next turn opens a new thread");
  });

  test("Kill stops Codex's app-server; the chat's next turn starts it again and resumes its thread", async () => {
    await ask("client-3", [{ role: "user", content: "one" }]);
    const killed = await (await shim.api(`/api/acp/processes/${encodeURIComponent("codex|app-server")}/kill`, { method: "POST" })).json();
    assert.equal(killed.ok, true);
    assert.ok(!(await status()).processes.some((/** @type {any} */ p) => p.key === "codex|app-server"), "no app-server running");
    const resumed = heard("thread/resume").length;
    const { reply } = await ask("client-3", [{ role: "user", content: "one" }, { role: "assistant", content: "Echo: one" }, { role: "user", content: "two" }]);
    assert.deepEqual(reply.content.filter((/** @type {any} */ b) => b.type === "text").map((/** @type {any} */ b) => b.text), ["Echo: two"]);
    assert.equal(heard("thread/resume").length, resumed + 1);
  });

  test("a harness turn on Codex is a run: its calls are cards, its plan is the turn's, the record counts them", async () => {
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "codex/gpt-6-astra", preset: "plain" } });
    assert.equal(made.status, 200, await made.clone().text());
    const id = String((await made.json()).id);
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "~work", stream: true, runEvents: true } });
    assert.equal(res.status, 200);
    const runId = String(res.headers.get("x-filament-request-id"));
    const evs = parseSse(await res.text()).filter((f) => f.event === "filament_run").map((f) => f.data.event);
    const [start, end] = [evs[0], evs.at(-1)];
    assert.deepEqual(
      [start.type, start.kind, start.meta.engine, start.meta.upstream, start.meta.model, start.meta.root, end.type, end.status],
      ["run-start", "coding-agent", "codex", "codex", "gpt-6-astra", projDir, "run-end", "done"],
    );
    const of = (/** @type {string} */ type) => evs.filter((e) => e.type === type);
    assert.deepEqual(of("tool-start").map((e) => [e.name, e.id]), [["read", "cmd_read"], ["bash", "cmd_run"], ["edit", "patch_1#0"]], "the loop's own tool names");
    assert.deepEqual(of("tool-end").map((e) => [e.id, e.ok]), [["cmd_read", true], ["cmd_run", true], ["patch_1#0", true]]);
    assert.deepEqual(of("plan").at(-1).items.map((/** @type {any} */ i) => `${i.status}:${i.text}`), ["done:Read notes", "doing:Add a line"]);
    const rec = await until(async () => {
      const r = await shim.record(runId);
      return r?.acp?.run ? r : null;
    }, "the run's record");
    const { status: ended, tools } = rec.acp.run;
    assert.deepEqual({ ended, tools }, { ended: "done", tools: 3 });
    assert.deepEqual(rec.acp.account && rec.acp.account.email, ACCOUNT.email);
  });

  // (fails before: yes — the notice left the bridge as the thread opened, ahead of the session's event: the turn had no
  // run to draw it on yet, and a harness chat reads no line of the reply for it, so the person never saw it)
  test("a harness chat is told that Codex works read-only: a line of the turn's run, once for the chat", async () => {
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "codexro/gpt-6-astra", preset: "plain", settings: { loop: { permissions: "edit" } } } });
    assert.equal(made.status, 200, await made.clone().text());
    const id = String((await made.json()).id);
    /** A turn's run events. @param {string} content */
    const turn = async (content) => {
      const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: true, runEvents: true } });
      assert.equal(res.status, 200);
      const runId = String(res.headers.get("x-filament-request-id"));
      const evs = parseSse(await res.text()).filter((f) => f.event === "filament_run").map((f) => f.data.event);
      const rec = await until(async () => ((await shim.record(runId))?.acp?.run ? shim.record(runId) : null), "the run's record");
      return { evs, rec };
    };
    const first = await turn("hello");
    const notices = first.evs.filter((e) => e.type === "agent-notice");
    assert.deepEqual(notices.map((e) => [e.round, e.severity, e.description]), [[0, "warning", "its changes and commands come to Filament to approve, one by one"]], "before Codex's first word");
    assert.match(notices[0].title, /^Codex works read-only in this chat/);
    assert.ok(first.rec.changes.some((/** @type {string} */ c) => /^codex: Codex runs this thread with a readOnly sandbox, not workspaceWrite/.test(c)), first.rec.changes.join("\n"));
    // Its app-server gone, the chat's next turn opens the thread again: the record says the sandbox it got, the chat is
    // not told twice.
    const killed = await (await shim.api(`/api/acp/processes/${encodeURIComponent("codexro|app-server")}/kill`, { method: "POST" })).json();
    assert.equal(killed.ok, true);
    const second = await turn("again");
    assert.ok(second.rec.changes.some((/** @type {string} */ c) => /^codex: thread [0-9a-f]{8} loaded again$/.test(c)), second.rec.changes.join("\n"));
    assert.ok(second.rec.changes.some((/** @type {string} */ c) => /^codex: Codex runs this thread with a readOnly sandbox, not workspaceWrite/.test(c)), second.rec.changes.join("\n"));
    assert.deepEqual(second.evs.filter((e) => e.type === "agent-notice"), [], "said once for the chat");
  });

  // (fails before: yes — a failed turn's record had no `acp` block: a turn that hit the plan's limit lost who Codex ran
  // as, its windows and its model; HarnessV3-ACP AC2-5)
  test("a turn that hits the plan's limit: its record keeps who Codex ran as, the plan's windows, the model", async () => {
    const res = await shim.post("/v1/messages", { model: "codex/gpt-6-astra", max_tokens: 200, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: "~fail" }] }, { "x-session-id": "client-limit" });
    assert.equal(res.status, 502, await res.clone().text());
    const rec = await recordOf(String(res.headers.get("x-filament-request-id")));
    assert.deepEqual([rec.status, rec.failure?.kind, rec.acp.run?.status], ["error", "limit", "failed"]);
    const { at, ...account } = rec.acp.account;
    assert.equal(typeof at, "number");
    assert.deepEqual(account, ACCOUNT);
    assert.equal(rec.acp.agentModel, "gpt-6-astra");
    assert.match(String(rec.acp.sessionId), /^[0-9a-f]{8}-/);
  });

  // (fails before: yes — the review of bfc1154da: a turn that failed after Codex reported its usage kept none of it, its
  // record 0 tokens, so /cost's cache line counted 1 request and the first turn's tokens alone, and the session's spend
  // booked none of the failed turn's)
  test("a turn that fails after Codex reported its usage keeps it: /cost counts the turn, and the session's spend books its tokens", async () => {
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "codex/gpt-6-astra", preset: "plain" } });
    assert.equal(made.status, 200, await made.clone().text());
    const id = String((await made.json()).id);
    /** A turn of the chat: its request's id and its words. @param {string} content */
    const say = async (content) => {
      const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
      const j = await r.json();
      return { status: r.status, id: String(r.headers.get("x-filament-request-id")), text: (j.content || []).map((/** @type {any} */ b) => b.text || "").join("") };
    };
    assert.equal((await say("hello")).text, "Echo: hello");
    const failed = await say("~fail-spent");
    assert.equal(failed.status, 502);
    const rec = await recordOf(failed.id);
    const { input, cacheRead, cacheWrite, output } = rec.tokens;
    assert.deepEqual([rec.status, { input, cacheRead, cacheWrite, output }, rec.estimatedTokens], ["error", { input: 400, cacheRead: 1000, cacheWrite: 0, output: 50 }, false], "what Codex reported its model call spent");
    const cost = (await say("/cost")).text;
    assert.match(cost, /Prompt cache: +2 requests · /, cost);
    assert.match(cost, /gpt-6-astra: {2}1\.3k input, 62 output, 1\.0k cache read, 0 cache write/, cost);
    const spend = /** @type {any} */ (shim.app).memory.archive.getChain(id).meta.spend;
    assert.deepEqual([spend.inputTokens, spend.cacheReadTokens, spend.outputTokens], [1300, 1000, 62], "the session's spend books both turns' tokens");
  });

  // (fails before: yes — the review of b1f4c556b: an agent that failed before its first word handed the request on and
  // kept nothing of what it spent, so the session's spend booked the backup's 900 in and 12 out alone)
  test("a Codex that fails before its first word after a model call of its own, a backup serving the request: what the failed attempt spent counts, as its own agent's", async () => {
    const res = await shim.post("/v1/messages", { model: "backed/gpt-6-astra", max_tokens: 200, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: "hello" }] }, { "x-session-id": "client-backed" });
    assert.equal(res.status, 200, await res.clone().text());
    const served = await recordOf(String(res.headers.get("x-filament-request-id")));
    assert.deepEqual([served.upstream, served.tokens.input, served.tokens.output, served.failover?.servedBy], ["codex", 900, 12, "codex"], "the request's record is its backup's");
    const spend = /** @type {any} */ (shim.app).memory.archive.getChain(served.memory.chain).meta.spend || {};
    assert.deepEqual([spend.inputTokens, spend.cacheReadTokens, spend.outputTokens], [1300, 1000, 62], "the session's spend books the failed attempt's model call too");
    const kept = /** @type {any} */ (shim.app).usage.records.find((/** @type {any} */ r) => r.parentRequest === served.id);
    assert.deepEqual([kept?.upstream, kept?.status, kept?.tokens?.input, kept?.tokens?.cacheRead, kept?.tokens?.output], ["codexq", "error", 400, 1000, 50], "the failed attempt's own record, its agent's");
  });

  // (fails before: yes — the review of b1f4c556b: the failure's close kept no newest call, so the session's last request
  // was the failed turn's sum (500 input, 2000 cache read) and the failed attempt's record carried none)
  test("a turn that fails after several model calls books its newest call as the session's last request, not the turn's sum; so does an attempt that failed before its first word", async () => {
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "codex/gpt-6-astra", preset: "plain" } });
    assert.equal(made.status, 200, await made.clone().text());
    const id = String((await made.json()).id);
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "~fail-calls", stream: false } });
    assert.equal(r.status, 502);
    await recordOf(String(r.headers.get("x-filament-request-id")));
    const spend = /** @type {any} */ (shim.app).memory.archive.getChain(id).meta.spend;
    const { input, cacheRead, cacheWrite } = spend.last;
    assert.deepEqual([{ input, cacheRead, cacheWrite }, spend.inputTokens, spend.cacheReadTokens], [{ input: 300, cacheRead: 1200, cacheWrite: 0 }, 500, 2000], "its newest call's prompt; the totals its two calls'");
    // The attempt's own record carries its newest call to the ledger as the request's does (finish.js reads it there).
    const res = await shim.post("/v1/messages", { model: "backed/gpt-6-astra", max_tokens: 200, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: "hello" }] }, { "x-session-id": "client-backed-call" });
    assert.equal(res.status, 200, await res.clone().text());
    const served = String(res.headers.get("x-filament-request-id"));
    await recordOf(served);
    const kept = /** @type {any} */ (shim.app).usage.records.find((/** @type {any} */ x) => x.parentRequest === served);
    assert.deepEqual(kept?._lastModelCall, { input: 400, cacheRead: 1000, cacheWrite: 0 });
  });

  // (fails before: yes — the review of sa_94fe0839: the failed attempt's record copied none of its request's lineage, so a
  // sub-agent's attempt was a client's in Traffic and the session's own agent's call, a compaction fork's was no call of
  // its job, and a memory call's was the client's)
  test("a failed attempt's own record carries its request's lineage: a sub-agent's, a compaction fork's and a memory call's attempt read as their requests do", async () => {
    /**
     * A house call through a route whose first agent fails before its first word (`backed-<kind>`, each its own agent):
     * its record and its attempt's.
     * @param {string} kind @param {Record<string, string>} lineage
     */
    const attempt = async (kind, lineage) => {
      const res = await shim.house("/v1/messages", { model: `backed-${kind}/gpt-6-astra`, max_tokens: 200, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: "hello" }] }, lineage);
      assert.equal(res.status, 200, await res.clone().text());
      const served = await recordOf(String(res.headers.get("x-filament-request-id")));
      const kept = /** @type {any} */ (shim.app).usage.records.find((/** @type {any} */ r) => r.parentRequest === served.id);
      assert.ok(kept, "the failed attempt's own record");
      return { served, kept };
    };
    const byId = (/** @type {string} */ id) => /** @type {any} */ (shim.app).usage.byId?.get(id) || null;
    const sub = await attempt("sub", { "x-filament-subagent-of": "owner" });
    assert.deepEqual([recordSource(sub.served), recordSource(sub.kept)], ["subagent", "subagent"], "Traffic names the attempt as its request");
    assert.equal(ownAgentCall(sub.kept, byId), false, "a side agent's call, not the session's own agent's");
    const fork = await attempt("fork", { "x-filament-fork": "compaction", "x-filament-job": "job-attempt" });
    assert.deepEqual([recordSource(fork.kept), fork.kept.jobId], ["compaction", "job-attempt"], "a call of its compaction's job");
    const mem = await attempt("mem", { "x-filament-memory-purpose": "learning" });
    assert.deepEqual([recordSource(mem.kept), isMemoryRecord(mem.kept)], ["memory", true], "memory's own call");
  });
});

describe("Codex that cannot start", () => {
  test("its Refresh's model list says why, in Codex's words, and so do the reads after it", async () => {
    // (fails before: yes — the list said 0 models and nothing more: the refresh dropped Codex's words, AC2's drive)
    const shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "codex", name: "Codex", type: "codex", acp: { command: process.execPath, args: [FAKE], env: { FAKE_CODEX_START_FAIL: "1" }, permissions: "allow-all" } }];
        cfg.routes = [{ match: "codex/*", upstream: "codex", upstreamModel: "{1}", enabled: true }];
      },
    });
    try {
      /** @param {string} path */
      const said = async (path) => (await (await shim.api(path)).json()).upstreams.codex;
      const refreshed = await said("/api/models?refresh=1");
      assert.match(String(refreshed.error), /^Codex's app-server did not start: agent process exited \(code 1\): Error: failed to initialize sqlite state runtime/, JSON.stringify(refreshed));
      assert.match(refreshed.error, /Run `codex app-server` in a terminal to see its whole message\.$/);
      assert.equal(refreshed.count, 0);
      assert.equal((await said("/api/models")).error, refreshed.error, "a read after it still says why");
    } finally {
      await shim.stop();
    }
  });
});

/** A port nothing listens on: the doctor finds no server there at once. @returns {Promise<number>} */
const closedPort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = /** @type {import("node:net").AddressInfo} */ (s.address());
      s.close(() => resolve(port));
    });
  });

describe("Filament doctor: a Codex upstream", () => {
  test("its app-server answers, who it is signed in as, its models; signed out, how to sign in; not installed, how to install", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "filament-doctor-"));
    try {
      const cfg = defaultConfig();
      cfg.server.port = await closedPort();
      cfg.memory.enabled = false;
      cfg.observability.logFile = "";
      /** @param {string} id @param {Record<string, string>} [env] */
      const up = (id, env = {}) => ({ id, name: id, type: "codex", acp: { command: process.execPath, args: [FAKE], env, permissions: "allow-all" } });
      cfg.upstreams = [up("cx-in"), up("cx-out", { FAKE_CODEX_SIGNED_OUT: "1" }), { id: "cx-none", name: "cx-none", type: "codex", acp: { command: "codex-not-installed-here" } }];
      cfg.routes = cfg.upstreams.map((u) => ({ match: `${u.id}/*`, upstream: u.id, upstreamModel: "{1}", enabled: true }));
      writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
      const report = await runDoctor({ dataDir });
      /** @param {string} id */
      const items = (id) => report.sections.find((/** @type {any} */ s) => s.title === `Codex: ${id}`)?.items || [];
      const signedIn = items("cx-in");
      assert.match(signedIn[0].what, /^app-server answers in \d+ ms$/);
      assert.deepEqual(signedIn.slice(1, 3).map((/** @type {any} */ i) => [i.level, i.what]), [["ok", "signed in: ChatGPT Plus (dev@example.com)"], ["ok", "2 models"]]);
      assert.match(signedIn[2].detail, /efforts low\/medium\/high\/xhigh/);
      const out = items("cx-out").find((/** @type {any} */ i) => i.what === "not signed in");
      const login = commandLine([process.execPath, FAKE, "login"], {}, process.platform);
      assert.deepEqual([out?.level, out?.fix], ["fail", `Sign in under Settings → Coding agents in Filament's harness, or run \`${login}\` in a terminal`]);
      const none = items("cx-none");
      assert.deepEqual([none[0].level, none[0].what], ["fail", "command not found: codex-not-installed-here"]);
      assert.match(none[0].fix, /^install it: npm install -g @openai\/codex/);
      assert.ok(!report.sections.some((/** @type {any} */ s) => /^Agent: cx-/.test(s.title)), "no ACP handshake is tried on Codex");
    } finally {
      await removeDirs(dataDir);
    }
  });
});
