// @ts-check
// A Space's presses (the plan of 11-11, its w0): while the desktop app holds its key, this computer's caller without it
// is refused every Space write after which a routine, a dashboard or a card does what the person did not press for —
// an agent's own shell reaches the admin API as the person does, so a routine it proposed with `acts` was switched on,
// a draft it wrote sent, a card moved back in its service, by one `curl`. Each is refused in words, by the press, and
// changes nothing; with the key it is the person's, and what it wrote is read back — on a Space that has the routine,
// the draft, the pull and the dashboard each row names (the re-read of 11-11: the half with the key ran against a
// project with no Space, and passed on any answer but a press's). A write that makes less run — a pause, a removal —
// needs no key. Through a real Filament, a fake provider and two stand-in servers; nothing runs a model.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FAKE_ACP_AGENT, anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { PRESS_HEADER, setPressKey } from "../src/http/guards.js";
import { routineFields } from "../src/core/routines.js";

const KEY = randomBytes(32).toString("base64url");
const PRESS = { [PRESS_HEADER]: KEY };
const REFUSED = /Filament app/;
const BYPASS = "coder/fake-a@bypassPermissions";
/** The stand-in servers: a CI's runs with a message tool (a dashboard's, a draft's), and a Linear's issues (a pull's). */
const RUNS_SERVER = fileURLToPath(new URL("./fixtures/mcp-runs-server.mjs", import.meta.url));
const ISSUES_SERVER = fileURLToPath(new URL("./fixtures/mcp-issues-server.mjs", import.meta.url));
/** The runs the CI stand-in lists, from its folder's runs.json: one red. */
const RUNS = [
  { id: 8812, run_number: 412, head_branch: "main", head_commit: { message: "Fix login redirect" }, conclusion: "failure", created_at: "2026-10-24T13:46:00Z" },
  { id: 8807, run_number: 411, head_branch: "main", head_commit: { message: "Add PLAY-88 retry" }, conclusion: "success", created_at: "2026-10-24T12:00:00Z" },
];
/** The dashboard a chat's agent publishes: the runs read through the server's tool, a button that acts, and one that sends. */
const CI = {
  tiles: [
    { kind: "status", title: "CI on main", from: "runs", field: "status", bad: { status: "failure" }, good: { status: "success" } },
    { kind: "table", title: "Runs", from: "runs", columns: ["when", "run", "commit", "status"], actions: ["rerun", "post"] },
  ],
  tables: { runs: [{ when: "2026-10-24T13:46:00Z", run: 412, commit: "Fix login redirect", status: "failure" }] },
  sources: {
    runs: { tool: { connection: "ci", name: "list_runs", args: { branch: "main" } }, rows: "workflow_runs", key: "id", order: "-when", every: "2m", columns: { when: "created_at", run: "run_number", commit: "head_commit.message", status: "conclusion" } },
  },
  actions: {
    rerun: { label: "Re-run failed jobs…", on: "runs", only: { status: "failure" }, tool: { connection: "ci", name: "rerun", args: { run_id: "{row.key}" } }, check: { "row.key": "^[0-9]+$" }, says: "Re-run the failed jobs of run {row.run}? They start at once.", secondLook: true },
    post: { label: "Tell #releases…", on: "runs", tool: { connection: "ci", name: "post_message", args: { channel: "releases", text: "{row.key}" } }, check: { "row.key": "^[0-9]+$" }, says: "Tell #releases about run {row.run}?", effect: "sends" },
  },
};
/** A Linear pull as its sheet sends it, with the tool that moves a card back. */
const LINEAR = {
  service: "linear",
  title: "Linear",
  connection: "linear",
  tool: "list_issues",
  args: { assignee: "me" },
  rows: "",
  key: "identifier",
  name: "title",
  state: "status",
  url: "url",
  line: "assignee.name",
  columns: { Todo: "planned", "In Progress": "doing", "In Review": "waits", Done: "done", Canceled: "done" },
  back: { tool: "update_issue", args: { id: "{key}", state: "{state}" } },
};

/**
 * A request over node:http, so the test sets every header itself.
 * @param {number} port @param {string} path @param {{ method?: string, headers?: Record<string, string>, body?: any }} [o]
 * @returns {Promise<{ status: number, json: any, text: string }>}
 */
const ask = (port, path, { method = "GET", headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const text = body === undefined ? "" : JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port, path, method, headers: { host: `127.0.0.1:${port}`, ...(text ? { "content-type": "application/json" } : {}), ...headers } });
    req.on("response", (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(b);
        } catch {}
        resolve({ status: Number(res.statusCode), json, text: b });
      });
    });
    req.on("error", reject);
    req.end(text || undefined);
  });

describe("a Space's presses, on one Filament whose app holds its key", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-press-space-"));
  /** What the stand-in servers were called with, one JSON line each. */
  const log = join(root, "calls.log");
  let P = "";
  /** The chat whose agent published the dashboard. */
  let chat = "";
  /** The dashboard's name in the Space. */
  let D = "";
  /** @type {any} */
  let spaces;
  /** @param {string} path @param {{ method?: string, headers?: Record<string, string>, body?: any }} [o] */
  const call = (path, o) => ask(shim.port, `/api${path}`, o);
  /** A press refused in words, the press marked so a client can tell. @param {{ status: number, json: any, text: string }} r @param {string} what */
  const refused = (r, what) => {
    assert.equal(r.status, 403, `${what}: ${r.text}`);
    assert.match(String(r.json?.error), REFUSED, what);
    assert.equal(r.json?.press, true, what);
  };
  /** The row did what it was asked: 200, its own answer. @param {{ status: number, json: any, text: string }} r @param {string} what */
  const landed = (r, what) => (assert.equal(r.status, 200, `${what}: ${r.text}`), r.json);
  const routine = (/** @type {string} */ id) => spaces.get(P).routines.find((/** @type {any} */ x) => x.id === id);
  /** The dashboard as the Space keeps it: nothing while it is a draft nobody kept. */
  const dashboard = () => spaces.get(P).dashboards.find((/** @type {any} */ d) => d.name === D) ?? null;
  const pull = (/** @type {string} */ id) => (spaces.get(P).pulls || []).find((/** @type {any} */ p) => p.id === id);
  /** The calls the stand-in servers took since the log was last emptied. @returns {any[]} */
  const calls = () => readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const lines = () => spaces.get(P).log.map((/** @type {any} */ e) => e.text);
  /** A routine proposed by a chat's agent, with a connection's tool it acts through unasked. @param {string} title */
  const proposed = (title) => {
    const f = routineFields({ title, when: "weekdays 09:00", text: "Answer who tagged me.", acts: ["mcp__ci__post_message"] }, { create: true });
    assert.ok(f.ok);
    return spaces.routinePropose(P, f.ok ? f.fields : {}, { chain: chat, byName: "Release", model: "agent/brain-model" }).id;
  };

  before(async () => {
    writeFileSync(log, "");
    writeFileSync(join(root, "runs.json"), JSON.stringify(RUNS));
    // The chat's agent publishes the dashboard when asked to "make ci"; any other turn is answered in words.
    up = await fakeUpstream(async (c) => {
      const body = c.body || {};
      const last = body.messages?.at(-1);
      const parts = Array.isArray(last?.content) ? last.content : [{ type: "text", text: String(last?.content || "") }];
      if (parts.some((/** @type {any} */ p) => p?.type === "tool_result")) return anthropicReply("Published.", { model: "brain-model" });
      if (body.tools?.length && parts.some((/** @type {any} */ p) => String(p?.text || "").includes("make ci")))
        return anthropicReply("", { model: "brain-model", stop: "tool_use", blocks: [{ type: "tool_use", id: "pub1", name: "artifact", input: { action: "publish", type: "dashboard", title: "CI", ...CI } }] });
      return anthropicReply("MODEL ANSWER", { model: "brain-model" });
    });
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true },
          { id: "coder", name: "coder", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: {}, cwdDefault: root, permissions: "allow-all", hints: false } },
        ];
        cfg.routes = [
          { match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true },
          { match: "coder/*", upstream: "coder", upstreamModel: "{1}", enabled: true },
        ];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
    spaces = /** @type {any} */ (shim.app).spaces;
    // Before the app holds its key: the chat, its Space, the project's two servers, and the dashboard its agent publishes.
    const s = await call("/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { loop: { permissions: "auto" } } } });
    assert.equal(s.status, 200, s.text);
    chat = String(s.json.id);
    P = String((await call(`/sessions/${encodeURIComponent(chat)}/settings`)).json.projectId);
    landed(await call(`/space/${encodeURIComponent(P)}`, { method: "POST" }), "the Space made");
    const servers = [
      { name: "ci", command: process.execPath, args: [RUNS_SERVER], env: { MCP_FIXTURE_LOG: log } },
      { name: "linear", command: process.execPath, args: [ISSUES_SERVER], env: { MCP_FIXTURE_LOG: log } },
    ];
    landed(await call(`/projects/${encodeURIComponent(P)}/settings`, { method: "POST", body: { patch: { plugins: { mcp: servers } } } }), "the project's servers");
    landed(await call(`/sessions/${encodeURIComponent(chat)}/turns`, { method: "POST", body: { content: "make ci", stream: false } }), "the turn that publishes");
    D = String((await until(async () => (await call(`/space/${encodeURIComponent(P)}`)).json.dashboards?.[0] || null, "the dashboard's draft in the Space")).name);
    setPressKey(KEY);
  });
  after(async () => {
    setPressKey("");
    await shim.stop();
    await up.close();
    await removeDirs(root);
  });

  // (fails before: yes — an agent's own shell switched on the routine it proposed, acting through Slack unasked from then on)
  test("Switch on: refused without the key and the routine stays proposed; with it, on", async () => {
    const id = proposed("Triage");
    const at = `/space/${encodeURIComponent(P)}/routines/${id}`;
    refused(await call(`${at}/on`, { method: "POST", body: {} }), "Switch on");
    assert.equal(routine(id).state, "proposed");
    landed(await call(`${at}/on`, { method: "POST", headers: PRESS, body: {} }), "Switch on with the key");
    assert.equal(routine(id).state, "on");
  });

  // (fails before: yes — the person's pause, their removal and Pause all were undone by a program here, and the routine ran again)
  test("a pause or a removal needs no key; Resume, Put back and Pause all off are refused without it and change nothing", async () => {
    const id = proposed("Digest");
    const at = `/space/${encodeURIComponent(P)}/routines/${id}`;
    landed(await call(`${at}/on`, { method: "POST", headers: PRESS, body: {} }), "Switch on with the key");
    landed(await call(`${at}/pause`, { method: "POST", body: { paused: true } }), "a pause");
    refused(await call(`${at}/pause`, { method: "POST", body: { paused: false } }), "Resume");
    assert.equal(routine(id).paused, true);
    landed(await call(`${at}/pause`, { method: "POST", headers: PRESS, body: { paused: false } }), "Resume with the key");
    assert.equal(routine(id).paused, false);
    landed(await call(at, { method: "DELETE" }), "a removal");
    refused(await call(`${at}/back`, { method: "POST", body: {} }), "Put back");
    assert.equal(routine(id).state, "removed");
    landed(await call(`${at}/back`, { method: "POST", headers: PRESS, body: {} }), "Put back with the key");
    assert.equal(routine(id).state, "on");
    landed(await call("/spaces/pause", { method: "POST", body: { on: true } }), "Pause all");
    refused(await call("/spaces/pause", { method: "POST", body: { on: false } }), "Pause all off");
    assert.ok(spaces.pausedSince(), "Pause all holds");
    landed(await call("/spaces/pause", { method: "POST", headers: PRESS, body: { on: false } }), "Pause all off with the key");
    assert.equal(spaces.pausedSince(), null);
  });

  // (fails before: yes — Run now, and a model named with its coding agent's mode, ran a routine past what the person pressed for)
  test("Run now is refused without the key, and with it the routine's chat runs; a model that names its coding agent's mode is refused, and kept with the key; another model needs none", async () => {
    const id = proposed("Weekly");
    const at = `/space/${encodeURIComponent(P)}/routines/${id}`;
    landed(await call(`${at}/on`, { method: "POST", headers: PRESS, body: {} }), "Switch on with the key");
    refused(await call(`${at}/run`, { method: "POST", body: {} }), "Run now");
    const ran = landed(await call(`${at}/run`, { method: "POST", headers: PRESS, body: {} }), "Run now with the key");
    assert.equal((await call(`/sessions/${encodeURIComponent(String(ran.chain))}`)).status, 200, "its run's chat is there");
    refused(await call(`${at}/model`, { method: "POST", body: { model: BYPASS } }), "a model with its mode");
    assert.equal(routine(id).model, "agent/brain-model");
    landed(await call(`${at}/model`, { method: "POST", headers: PRESS, body: { model: BYPASS } }), "a model with its mode, with the key");
    assert.equal(routine(id).model, BYPASS);
    landed(await call(`${at}/model`, { method: "POST", body: { model: "agent/brain-model", effort: "high" } }), "a plain model");
    assert.equal(routine(id).model, "agent/brain-model");
  });

  // (fails before: yes — a draft an agent wrote was sent to Slack by its own shell, with no Send of the person's)
  test("a draft's Send is refused without the key, the draft waits on and nothing leaves; with the key it is sent through its server", async () => {
    const draft = { title: "Reply to Sara", connection: "ci", tool: "post_message", args: { channel: "releases", text: "{words}" }, words: "Not today: CI is red.", to: "#releases", answers: null, from: [] };
    const n = spaces.writeDraft(P, draft, { chain: chat, byName: "Release", account: "" });
    const at = `/space/${encodeURIComponent(P)}/needs/${n.id}`;
    writeFileSync(log, "");
    refused(await call(`${at}/send`, { method: "POST", body: { words: "Sent by a program." } }), "Send");
    const still = spaces.get(P).needs.find((/** @type {any} */ x) => x.id === n.id);
    assert.equal(still?.kind, "draft");
    assert.equal(still?.state ?? "open", "open", "waits in Needs you");
    assert.deepEqual(calls(), [], "nothing left this machine");
    const sent = landed(await call(`${at}/send`, { method: "POST", headers: PRESS, body: { words: "Not today: tomorrow." } }), "Send with the key");
    assert.deepEqual([sent.sent, sent.row.outcome], [true, "sent"]);
    assert.deepEqual(calls(), [{ tool: "post_message", args: { channel: "releases", text: "Not today: tomorrow." } }]);
  });

  // (fails before: yes — a pull was saved with a way back into its service, and with Always, by any caller: no key was
  // asked for, and Always set so said nothing in What happened)
  test("a pull saved with a way back into its service, or with Always, is a press, and Always set so is said in What happened; a card back in its service and Always are refused without the key; a move on the board alone is not", async () => {
    const S = `/space/${encodeURIComponent(P)}`;
    const got = landed(await call(`${S}/pulls/try`, { method: "POST", body: { service: "linear", connection: "linear", tool: "list_issues", args: { assignee: "me" } } }), "Read once");
    const sheet = { ...LINEAR, rows: got.rows, columns: got.columns };
    // No way back: its moves stay on the board, and nobody is asked less.
    const id = String(landed(await call(`${S}/pulls`, { method: "POST", body: { ...sheet, back: null } }), "a pull that only reads").pull.id);
    const at = `${S}/pulls/${id}`;
    const withBack = await call(`${S}/pulls`, { method: "POST", body: { ...sheet, id } });
    const withAlways = await call(`${S}/pulls`, { method: "POST", body: { ...sheet, id, always: true } });
    assert.deepEqual([pull(id).back, pull(id).always], [null, false], "the pull is as it was");
    refused(withBack, "a pull saved with a way back");
    refused(withAlways, "a pull saved with Always");
    landed(await call(`${S}/pulls`, { method: "POST", headers: PRESS, body: { ...sheet, id } }), "a way back, with the key");
    assert.deepEqual(pull(id).back, LINEAR.back);
    // The same way back again asks nothing more; another tool, other arguments or another connection do.
    landed(await call(`${S}/pulls`, { method: "POST", body: { ...sheet, id, title: "Linear (mine)" } }), "its title changed");
    assert.equal(pull(id).title, "Linear (mine)");
    refused(await call(`${S}/pulls`, { method: "POST", body: { ...sheet, id, back: { tool: "update_issue", args: { id: "{key}", state: "Done" } } } }), "another way back");
    refused(await call(`${S}/pulls`, { method: "POST", body: { ...sheet, id, connection: "ci" } }), "the same way back through another connection");
    assert.deepEqual([pull(id).connection, pull(id).back], ["linear", LINEAR.back]);
    // Always from the sheet: said in What happened as its switch says it, both ways.
    const before = lines().length;
    landed(await call(`${S}/pulls`, { method: "POST", headers: PRESS, body: { ...sheet, id, always: true } }), "Always, with the key");
    assert.equal(pull(id).always, true);
    assert.deepEqual(lines().slice(before), ["Moves of Linear's cards on this board go back to Linear without asking you."]);
    // Always kept as it is, with the same way back, asks nothing more: its sheet's other fields are saved with no key,
    // and nothing is said again. Another way back under it is still a press.
    landed(await call(`${S}/pulls`, { method: "POST", body: { ...sheet, id, always: true, title: "Linear (mine)" } }), "its title changed, Always as it was");
    assert.deepEqual([pull(id).title, pull(id).always, lines().length], ["Linear (mine)", true, before + 1]);
    refused(await call(`${S}/pulls`, { method: "POST", body: { ...sheet, id, always: true, back: { tool: "update_issue", args: { id: "{key}", state: "Done" } } } }), "another way back under Always");
    landed(await call(`${S}/pulls`, { method: "POST", body: { ...sheet, id } }), "saved without Always: it asks again, and that needs no key");
    assert.equal(pull(id).always, false);
    assert.deepEqual(lines().slice(before + 1), ["Moves of Linear's cards on this board ask you again before they go back to Linear."]);
    assert.equal(new Set(spaces.get(P).log.map((/** @type {any} */ e) => e.id)).size, spaces.get(P).log.length, "each line its own id");
    // Its cards: one moved back in its service, or always so, is a press; a move on the board alone is not.
    landed(await call(`${at}/read`, { method: "POST" }), "read again");
    writeFileSync(log, "");
    refused(await call(`${at}/move`, { method: "POST", body: { key: "LIN-43", column: "doing", back: true } }), "a card back in its service");
    refused(await call(`${at}/move`, { method: "POST", body: { key: "LIN-43", column: "doing", always: true } }), "a card back, always");
    refused(await call(`${at}/always`, { method: "POST", body: { on: true } }), "Always");
    assert.deepEqual([calls(), pull(id).always], [[], false], "nothing went to Linear");
    const here = landed(await call(`${at}/move`, { method: "POST", body: { key: "LIN-42", column: "waits" } }), "a move on the board alone");
    assert.deepEqual([here.went, calls()], [null, []]);
    const back = landed(await call(`${at}/move`, { method: "POST", headers: PRESS, body: { key: "LIN-43", column: "doing", back: true } }), "a card back, with the key");
    assert.equal(back.went, "In Progress");
    assert.deepEqual(calls(), [{ tool: "update_issue", args: { id: "LIN-43", state: "In Progress" } }]);
    landed(await call(`${at}/always`, { method: "POST", headers: PRESS, body: { on: true } }), "Always, with the key");
    assert.equal(pull(id).always, true);
    landed(await call(`${at}/always`, { method: "POST", body: { on: false } }), "Always off needs no key");
    assert.equal(pull(id).always, false);
  });

  // (fails before: yes — each of these ran without the key: a dashboard's grant kept or put back, its button run or let
  // run unasked, a look on a model that names its mode; and a paused dashboard was resumed by any caller)
  test("a dashboard's Keep, its button's run, a button let to agents, a look on a model that names its mode, Resume and Put back: refused without the key, nothing changed; with it each lands; a pause and a removal need none", async () => {
    const at = `/space/${encodeURIComponent(P)}/dashboards/${encodeURIComponent(D)}`;
    const conclusion = () => JSON.parse(readFileSync(join(root, "runs.json"), "utf8"))[0].conclusion;
    refused(await call(`${at}/keep`, { method: "POST", body: { v: 1 } }), "Keep");
    assert.equal(dashboard(), null, "a draft still: the Space keeps nothing of it");
    landed(await call(`${at}/keep`, { method: "POST", headers: PRESS, body: { v: 1 } }), "Keep with the key");
    assert.equal(dashboard().state, "kept");
    const read = landed(await call(`${at}/read`, { method: "POST", body: { source: "runs" } }), "its rows read: a read needs no key");
    assert.equal(read.sources.runs.error, null);
    // A second look: on a model that names its coding agent's mode it is a press; on a plain one it starts.
    refused(await call(`${at}/actions/rerun/look`, { method: "POST", body: { key: "8812", model: BYPASS } }), "a look on a model with its mode");
    assert.match(String(landed(await call(`${at}/actions/rerun/look`, { method: "POST", body: { key: "8812", model: "agent/brain-model" } }), "a look on a plain model").agent), /\S/);
    assert.match(String(landed(await call(`${at}/actions/rerun/look`, { method: "POST", headers: PRESS, body: { key: "8812", model: BYPASS } }), "a look on a model with its mode, with the key").agent), /\S/);
    // Its button.
    writeFileSync(log, "");
    refused(await call(`${at}/actions/rerun/run`, { method: "POST", body: { key: "8812" } }), "its button run");
    assert.deepEqual([conclusion(), calls()], ["failure", []], "nothing ran");
    const ran = landed(await call(`${at}/actions/rerun/run`, { method: "POST", headers: PRESS, body: { key: "8812" } }), "its button run with the key");
    assert.equal(ran.done, true);
    assert.equal(conclusion(), "queued", "the server's tool ran");
    // A button that sends, let to agents without asking.
    refused(await call(`${at}/allow`, { method: "POST", body: { action: "post", on: true } }), "a button let to agents");
    assert.deepEqual(dashboard()?.allowed || [], []);
    assert.deepEqual(landed(await call(`${at}/allow`, { method: "POST", headers: PRESS, body: { action: "post", on: true } }), "let to agents with the key").allowed, ["post"]);
    assert.deepEqual(landed(await call(`${at}/allow`, { method: "POST", body: { action: "post", on: false } }), "taken back with no key").allowed, []);
    // Paused, it reads nothing; going on again is the press.
    landed(await call(`${at}/pause`, { method: "POST", body: { paused: true } }), "a pause");
    refused(await call(`${at}/pause`, { method: "POST", body: { paused: false } }), "Resume");
    assert.equal(dashboard().paused, true);
    landed(await call(`${at}/pause`, { method: "POST", headers: PRESS, body: { paused: false } }), "Resume with the key");
    assert.equal(!!dashboard().paused, false);
    // Taken out, nothing of it runs; put back, it is kept as it was.
    landed(await call(at, { method: "DELETE" }), "taken out");
    refused(await call(`${at}/back`, { method: "POST", body: {} }), "Put back");
    assert.equal(dashboard().state, "removed");
    landed(await call(`${at}/back`, { method: "POST", headers: PRESS, body: {} }), "Put back with the key");
    assert.equal(dashboard().state, "kept");
  });

  // (fails before: yes — a Space's model set to skip its coding agent's asking, an app's ask run on one, and a deleted
  // Space brought back, ran without the key; and an app's asks were set to run without asking first by any caller)
  test("a Space's model that names its coding agent's mode, an app's asks run without asking first, an ask on such a model, and Bring back: refused without the key, nothing changed; with it each lands; the settings that ask no less need none", async () => {
    const S = `/space/${encodeURIComponent(P)}`;
    /** @type {[string, any, string][]} */
    const presses = [
      ["/spaces/settings", { model: BYPASS }, "Settings › Space's model with its mode"],
      ["/spaces/settings", { asks: "run" }, "every Space's apps' asks run without asking first"],
      [`${S}/settings`, { model: BYPASS }, "this Space's model with its mode"],
      [`${S}/settings`, { asks: "run" }, "this Space's apps' asks run without asking first"],
    ];
    for (const [path, body, what] of presses) refused(await call(path, { method: "PATCH", body }), what);
    assert.deepEqual([spaces.defaults().model, spaces.defaults().asks, spaces.settingsOf(P).model, spaces.settingsOf(P).asks].map((x) => x === BYPASS || x === "run"), [false, false, false, false], "the settings are as they were");
    for (const [path, body, what] of presses) landed(await call(path, { method: "PATCH", headers: PRESS, body }), `${what}, with the key`);
    assert.deepEqual([spaces.defaults().model, spaces.defaults().asks, spaces.settingsOf(P).model, spaces.settingsOf(P).asks], [BYPASS, "run", BYPASS, "run"]);
    // A plain model, its effort, asking first again, and a setting taken away: no key.
    landed(await call("/spaces/settings", { method: "PATCH", body: { model: "agent/brain-model", asks: "ask", effort: "high" } }), "Settings › Space asking no less");
    landed(await call(`${S}/settings`, { method: "PATCH", body: { model: null, asks: null } }), "this Space's own taken away");
    assert.deepEqual([spaces.defaults().model, spaces.defaults().asks, spaces.defaults().effort, spaces.settingsOf(P).model ?? null, spaces.settingsOf(P).asks ?? null], ["agent/brain-model", "ask", "high", null, null]);
    // An app's ask.
    refused(await call(`${S}/asks`, { method: "POST", body: { words: "What changed?", model: BYPASS } }), "an ask on a model with its mode");
    const named = landed(await call(`${S}/asks`, { method: "POST", headers: PRESS, body: { words: "What changed?", model: BYPASS } }), "an ask on a model with its mode, with the key");
    assert.equal((await call(`/sessions/${encodeURIComponent(String(named.chain))}`)).status, 200, "its chat is there");
    landed(await call(`${S}/asks`, { method: "POST", body: { words: "What changed since Monday?", model: "agent/brain-model" } }), "an ask on a plain model");
    // A deleted Space brought back, with what ran in it.
    landed(await call(S, { method: "DELETE" }), "the Space deleted");
    refused(await call(`${S}/back`, { method: "POST", body: {} }), "Bring back");
    assert.equal(spaces.has(P), false, "it stays deleted");
    landed(await call(`${S}/back`, { method: "POST", headers: PRESS, body: {} }), "Bring back with the key");
    assert.equal(spaces.has(P), true);
  });
});
